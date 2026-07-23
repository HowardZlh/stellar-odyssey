'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import type { CometData } from '@/types';
import { useSimulationStore } from '@/store';
import { heliocentricPosition } from '@/utils/physics';
import { eclipticToScene } from '@/utils/scale';
import {
  cometActivity01,
  dustTailBendDirection,
  dustTailBendMagnitude,
  dustTailLengthUnits,
  ionTailDirection,
  ionTailLengthUnits,
  orbitalVelocityAuPerDay,
} from '@/utils/cometTail';
import { ELONGATION_RATIO, cometNucleusRadialScale } from '@/utils/cometNucleus';
import { detailGateUpdate } from '@/utils/planetDetail';
import {
  createCometNucleusTextureCanvas,
  createGlowSpriteCanvas,
} from '@/components/CelestialBody/proceduralTextures';

interface CometProps {
  data: CometData;
}

// 圆锥几何体尖端朝 +Y：将 -Y 对齐彗尾方向，使尖端位于彗核、开口朝外
const UP = new THREE.Vector3(0, -1, 0);

/** 彗核基础显示半径（场景单位，视觉夸大与其他小天体一致） */
const NUCLEUS_RADIUS_UNITS = 0.18;

/** 尘埃尾横向缩放（与原实现一致） */
const DUST_TAIL_WIDTH_SCALE = 1.8;

/**
 * 尘埃尾弯曲 shader（P4，需求 §4.7）：
 * 顶点沿局部 +X 做二次弯曲位移 offset = uBendLocal · t²
 * （t = 沿尾轴归一化距离，utils/cometTail.dustTailBendOffset 镜像），
 * 透明度沿尾轴渐隐。
 */
const DUST_TAIL_VERTEX_SHADER = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  uniform float uBendLocal;
  varying float vT;
  void main() {
    // 圆锥高 1 居中：y=+0.5 尖端（彗核处）→ y=-0.5 底面（尾端）
    float t = clamp(0.5 - position.y, 0.0, 1.0);
    vT = t;
    vec3 p = position;
    p.x += uBendLocal * t * t;
    vec4 world = modelMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * viewMatrix * world;
    #include <logdepthbuf_vertex>
  }
`;

const DUST_TAIL_FRAGMENT_SHADER = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_fragment>
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vT;
  void main() {
    #include <logdepthbuf_fragment>
    gl_FragColor = vec4(uColor, uOpacity * (1.0 - vT * 0.55));
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/** 形状种子：由天体 id 派生（确定性，不同彗星形状不同） */
function shapeSeed(id: string): number {
  let seed = 0;
  for (let i = 0; i < id.length; i += 1) {
    seed = (seed * 31 + id.charCodeAt(i)) % 100000;
  }
  return seed;
}

/**
 * 彗星（需求 3.1.1，P4 §4.7 近观与彗尾增强）：
 * - 高离心率椭圆轨道，位置由开普勒方程精确求解 → 匀面速度效果显著
 *   （近日点疾驰、远日点缓慢）；哈雷倾角 162° 为逆行轨道
 * - 近日点附近（日心距 < tailActivationAu）出现彗发与彗尾
 * - 离子尾严格背向太阳（蓝色细长）；尘埃尾沿轨道后方弯曲
 *   （曲率随轨道速度/日心距变化，公式抽取于 utils/cometTail.ts 可单测），
 *   近日点掠过时两尾夹角变化清晰可见
 * - 彗核近观细节（仅 L1 近观渲染）：程序化岩石纹理 + 顶点噪声不规则外形
 *   （哈雷彗核 15×8 km 花生形，数据来源 ESA Giotto，utils/cometNucleus.ts）
 */
export function Comet({ data }: CometProps): JSX.Element {
  const groupRef = useRef<THREE.Group>(null);
  const comaRef = useRef<THREE.Sprite>(null);
  const dustTailRef = useRef<THREE.Mesh>(null);
  const ionTailRef = useRef<THREE.Mesh>(null);
  const nucleusRef = useRef<THREE.Mesh>(null);
  const camera = useThree((s) => s.camera);
  const selectBody = useSimulationStore((s) => s.selectBody);
  const showLabels = useSimulationStore((s) => s.showLabels);
  // Html 标签不随父级 visible 隐藏，需单独按层级门控
  const frozen = useSimulationStore((s) => s.continuousLevel > 3.2);
  // P4 彗核近观细节门控（仅 L1 近观渲染，滞回与行星一致）
  const [nearView, setNearView] = useState(false);
  const nearViewRef = useRef(false);

  const comaTexture = useMemo(() => {
    const tex = new THREE.CanvasTexture(createGlowSpriteCanvas(data.color, 128));
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }, [data.color]);

  useEffect(() => {
    return () => {
      comaTexture.dispose();
    };
  }, [comaTexture]);

  // P4 彗核近观资产（首次进入近观时才构建，离开后保留复用——几何/纹理极小）
  const nucleusAssets = useMemo(() => {
    if (!nearView) return null;
    const seed = shapeSeed(data.id);
    // 不规则外形：单位球顶点按径向噪声位移 + 长轴伸长（花生形）
    const geometry = new THREE.SphereGeometry(NUCLEUS_RADIUS_UNITS, 36, 24);
    const pos = geometry.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i += 1) {
      v.fromBufferAttribute(pos, i);
      const len = v.length();
      if (len < 1e-9) continue;
      v.divideScalar(len);
      const s = cometNucleusRadialScale({ x: v.x, y: v.y, z: v.z }, seed);
      pos.setXYZ(
        i,
        v.x * NUCLEUS_RADIUS_UNITS * s * ELONGATION_RATIO,
        v.y * NUCLEUS_RADIUS_UNITS * s,
        v.z * NUCLEUS_RADIUS_UNITS * s,
      );
    }
    geometry.computeVertexNormals();
    const texture = new THREE.CanvasTexture(createCometNucleusTextureCanvas(seed));
    texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.MeshStandardMaterial({
      map: texture,
      roughness: 0.98,
      metalness: 0.02,
    });
    return { geometry, texture, material };
  }, [nearView, data.id]);

  useEffect(() => {
    return () => {
      if (nucleusAssets) {
        nucleusAssets.geometry.dispose();
        nucleusAssets.texture.dispose();
        nucleusAssets.material.dispose();
      }
    };
  }, [nucleusAssets]);

  // 尘埃尾弯曲材质（P4：uBendLocal 每帧更新）
  const dustTailMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        uniforms: {
          uColor: { value: new THREE.Color('#f0e0b8') },
          uOpacity: { value: 0 },
          uBendLocal: { value: 0 },
        },
        vertexShader: DUST_TAIL_VERTEX_SHADER,
        fragmentShader: DUST_TAIL_FRAGMENT_SHADER,
      }),
    [],
  );

  useEffect(() => {
    return () => {
      dustTailMaterial.dispose();
    };
  }, [dustTailMaterial]);

  const tailDirection = useMemo(() => new THREE.Vector3(), []);
  const tailQuaternion = useMemo(() => new THREE.Quaternion(), []);
  const dustBasis = useMemo(
    () => ({
      x: new THREE.Vector3(),
      y: new THREE.Vector3(),
      z: new THREE.Vector3(),
      m: new THREE.Matrix4(),
    }),
    [],
  );

  useFrame(() => {
    const state = useSimulationStore.getState();
    const { simDays, continuousLevel } = state;
    const group = groupRef.current;
    if (!group) return;

    // 外层视角退化（与行星一致）
    const isFrozen = continuousLevel > 3.2;
    group.visible = !isFrozen;
    if (isFrozen) return;

    const ecliptic = heliocentricPosition(data.orbit, simDays);
    const scene = eclipticToScene(ecliptic);
    group.position.set(scene.x, scene.y, scene.z);

    const distanceAu = Math.hypot(ecliptic.x, ecliptic.y, ecliptic.z);
    // 活动度：近日点 1 → 激活阈值 0（utils/cometTail.cometActivity01）
    const activity = cometActivity01(distanceAu, data.tailActivationAu);

    // P4 彗核近观门控（仅 L1 近观渲染细节几何/纹理）
    const distToComet = camera.position.distanceTo(group.position);
    const gate = detailGateUpdate(
      nearViewRef.current,
      distToComet,
      NUCLEUS_RADIUS_UNITS,
      continuousLevel,
    );
    if (gate.active !== nearViewRef.current) {
      nearViewRef.current = gate.active;
      setNearView(gate.active);
    }
    // 彗核缓慢自转（哈雷自转周期约 2.2 天，ESA Giotto）
    if (nucleusRef.current) {
      nucleusRef.current.rotation.y = (simDays / 2.2) * Math.PI * 2;
      nucleusRef.current.rotation.z = 0.35;
    }

    if (comaRef.current) {
      const comaScale = 0.6 + activity * 2.2;
      comaRef.current.scale.set(comaScale, comaScale, comaScale);
      (comaRef.current.material as THREE.SpriteMaterial).opacity = 0.15 + activity * 0.8;
      comaRef.current.visible = activity > 0.01;
    }

    // 离子尾方向：严格背向太阳（utils/cometTail.ionTailDirection）
    const anti = ionTailDirection({ x: scene.x, y: scene.y, z: scene.z });
    tailDirection.set(anti.x, anti.y, anti.z);
    tailQuaternion.setFromUnitVectors(UP, tailDirection);

    const tailLength = ionTailLengthUnits(activity);
    if (ionTailRef.current) {
      ionTailRef.current.visible = activity > 0.05;
      ionTailRef.current.quaternion.copy(tailQuaternion);
      // 圆锥沿 +Y 方向，平移半长使尾根在彗核处
      ionTailRef.current.scale.set(1, Math.max(tailLength, 0.01), 1);
      ionTailRef.current.position.copy(tailDirection).multiplyScalar(tailLength / 2);
      (ionTailRef.current.material as THREE.MeshBasicMaterial).opacity = activity * 0.5;
    }

    // 尘埃尾（P4）：沿轨道后方弯曲——弯曲量随轨道速度/日心距变化
    if (dustTailRef.current) {
      const dustLength = dustTailLengthUnits(activity);
      dustTailRef.current.visible = activity > 0.05;
      dustTailRef.current.scale.set(DUST_TAIL_WIDTH_SCALE, Math.max(dustLength, 0.01), DUST_TAIL_WIDTH_SCALE);
      dustTailRef.current.position.copy(tailDirection).multiplyScalar(dustLength / 2);

      const vel = orbitalVelocityAuPerDay(data.orbit, simDays);
      // 黄道坐标 → 场景坐标方向（与 eclipticToScene 同轴序，方向无需缩放）
      const velScene = { x: vel.x, y: vel.z, z: -vel.y };
      const speed = Math.hypot(vel.x, vel.y, vel.z);
      const bend = dustTailBendMagnitude(speed, distanceAu);
      const bendDir = dustTailBendDirection(anti, velScene);
      if (bendDir) {
        // 局部基：+X = 弯曲方向、-Y = 尾轴（尖端朝彗核，与圆锥几何一致）
        dustBasis.x.set(bendDir.x, bendDir.y, bendDir.z);
        dustBasis.y.copy(tailDirection).negate();
        dustBasis.z.crossVectors(dustBasis.x, dustBasis.y);
        dustBasis.m.makeBasis(dustBasis.x, dustBasis.y, dustBasis.z);
        dustTailRef.current.quaternion.setFromRotationMatrix(dustBasis.m);
        // 世界偏移 = bend·尾长；除以横向缩放换算为锥体局部单位
        dustTailMaterial.uniforms.uBendLocal.value =
          (bend * dustLength) / DUST_TAIL_WIDTH_SCALE;
      } else {
        dustTailRef.current.quaternion.copy(tailQuaternion);
        dustTailMaterial.uniforms.uBendLocal.value = 0;
      }
      dustTailMaterial.uniforms.uOpacity.value = activity * 0.35;
    }
  });

  return (
    <group ref={groupRef} name={data.id}>
      {/* 彗核：远观简单球体 / 近观不规则岩石彗核（P4，仅 L1 近观渲染） */}
      {!nearView && (
        <mesh
          onClick={(e) => {
            e.stopPropagation();
            selectBody(data.id);
          }}
        >
          <sphereGeometry args={[NUCLEUS_RADIUS_UNITS, 16, 16]} />
          <meshStandardMaterial color="#b8c4cc" roughness={0.95} />
        </mesh>
      )}
      {nearView && nucleusAssets && (
        <mesh
          ref={nucleusRef}
          geometry={nucleusAssets.geometry}
          material={nucleusAssets.material}
          onClick={(e) => {
            e.stopPropagation();
            selectBody(data.id);
          }}
        />
      )}

      {/* 彗发（近日点附近出现） */}
      <sprite ref={comaRef}>
        <spriteMaterial
          map={comaTexture}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </sprite>

      {/* 离子尾：蓝色细长（始终背向太阳） */}
      <mesh ref={ionTailRef}>
        <coneGeometry args={[0.35, 1, 12, 1, true]} />
        <meshBasicMaterial
          color="#5fa8ff"
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* 尘埃尾：黄白色略宽短，沿轨道后方弯曲（P4 弯曲 shader） */}
      <mesh ref={dustTailRef} material={dustTailMaterial}>
        <coneGeometry args={[0.35, 1, 12, 8, true]} />
      </mesh>

      {showLabels && !frozen && (
        <Html position={[0, 0.8, 0]} center distanceFactor={60} style={{ pointerEvents: 'none' }}>
          <span className="whitespace-nowrap text-xs text-cyan-200/80">{data.nameZh}</span>
        </Html>
      )}
    </group>
  );
}
