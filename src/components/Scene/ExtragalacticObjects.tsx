'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { getGalaxyById } from '@/data/galaxies';
import { getSpecialBodyById } from '@/data/specialBodies';
import { useSimulationStore } from '@/store';
import { cosmicDistanceToSceneUnits, trapezoidWeight } from '@/utils/scale';
import { setObjectTreeRaycastEnabled } from '@/utils/raycastGate';
import { grbFlashState, jetFlowPhase01, quasarFlicker } from '@/utils/specialBodies';
import {
  createGalaxySpriteCanvas,
  createGlowSpriteCanvas,
} from '@/components/CelestialBody/proceduralTextures';

/** 与 Universe.tsx 一致的宇宙级 LOD 渐变区间 */
function fadeWeight(continuousLevel: number): number {
  return trapezoidWeight(continuousLevel, 3.05, 3.6, 4.5, 5);
}

/** 可交互阈值：淡入权重低于该值时禁用 raycast（隐形对象不拦截点击） */
const INTERACTIVE_WEIGHT = 0.05;

/** 喷流流动粒子节数（沿喷流方向循环流动，需求 3.1.5 流动动画） */
const JET_SEGMENTS = 5;

interface JetProps {
  /** 喷流方向（单位矢量，局部坐标） */
  direction: THREE.Vector3;
  lengthUnits: number;
  color: string;
  /** 是否双向（类星体双向 / M87 单侧可见） */
  bilateral: boolean;
  baseOpacity: number;
}

/**
 * 相对论喷流：细长锥体 + 沿喷流方向循环流动的辉光节点（流动动画）
 */
function RelativisticJet({ direction, lengthUnits, color, bilateral, baseOpacity }: JetProps): JSX.Element {
  const nodesRef = useRef<THREE.Group>(null);
  const texture = useMemo(() => new THREE.CanvasTexture(createGlowSpriteCanvas(color, 64)), [color]);
  useEffect(() => () => texture.dispose(), [texture]);

  // 喷流 shader（P6 §3.4）：沿轴湍流噪声 + 亮节点（knots，M87 HST-1 观测特征）
  // 替换纯色 cone。uv.y 沿轴、uv.x 环向。
  const jetMaterial = useMemo(() => {
    const c = new THREE.Color(color);
    return new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uOpacity: { value: baseOpacity * 0.4 },
        uColor: { value: new THREE.Vector3(c.r, c.g, c.b) },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform float uOpacity;
        uniform vec3 uColor;
        varying vec2 vUv;
        float hash(float n){ return fract(sin(n)*43758.5453); }
        float noise(float x){ float i=floor(x); float f=fract(x); return mix(hash(i),hash(i+1.0),f*f*(3.0-2.0*f)); }
        void main() {
          // 环向径向渐变（中心线亮）
          float radial = pow(clamp(1.0 - abs(vUv.x - 0.5)*2.0, 0.0, 1.0), 1.4);
          // 沿轴湍流 + 亮节点（周期性 knots，随时间沿轴流动）
          float turb = 0.6 + 0.4 * noise(vUv.y * 10.0 - uTime * 0.6);
          float knots = smoothstep(0.75, 1.0, sin(vUv.y * 22.0 - uTime * 1.2) * 0.5 + 0.5);
          float axial = smoothstep(1.0, 0.05, vUv.y);
          float a = radial * axial * (turb + knots * 0.8) * uOpacity;
          gl_FragColor = vec4(uColor * (1.0 + knots), a);
        }
      `,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [color, baseOpacity]);
  useEffect(() => () => jetMaterial.dispose(), [jetMaterial]);

  const sides = bilateral ? [1, -1] : [1];

  // 锥体朝向：+Y 对齐 direction
  const quaternion = useMemo(() => {
    const q = new THREE.Quaternion();
    q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize());
    return q;
  }, [direction]);

  useFrame(({ clock }) => {
    const weight = fadeWeight(useSimulationStore.getState().continuousLevel);
    jetMaterial.uniforms.uTime.value = clock.elapsedTime;
    jetMaterial.uniforms.uOpacity.value = baseOpacity * 0.5 * weight;
    const nodes = nodesRef.current;
    if (!nodes) return;
    nodes.visible = weight > 0.001;
    if (!nodes.visible) return;
    // 流动动画：节点沿喷流方向循环外流
    const phase = jetFlowPhase01(clock.elapsedTime, 0.25);
    let idx = 0;
    for (const side of sides) {
      for (let s = 0; s < JET_SEGMENTS; s += 1) {
        const sprite = nodes.children[idx] as THREE.Sprite | undefined;
        idx += 1;
        if (!sprite) continue;
        const t = ((s / JET_SEGMENTS + phase) % 1 + 1) % 1;
        const d = t * lengthUnits;
        sprite.position.set(direction.x * d * side, direction.y * d * side, direction.z * d * side);
        // 距核心越远越暗
        (sprite.material as THREE.SpriteMaterial).opacity =
          baseOpacity * (1 - t * 0.8) * weight;
      }
    }
  });

  return (
    <group>
      {/* 喷流锥体（细长半透明） */}
      {sides.map((side) => (
        <mesh
          key={side}
          quaternion={quaternion}
          scale={[1, side, 1]}
          position={[
            (direction.x * lengthUnits * side) / 2,
            (direction.y * lengthUnits * side) / 2,
            (direction.z * lengthUnits * side) / 2,
          ]}
          material={jetMaterial}
        >
          <coneGeometry args={[lengthUnits * 0.035, lengthUnits, 16, 1, true]} />
        </mesh>
      ))}
      {/* 流动节点 */}
      <group ref={nodesRef}>
        {sides.flatMap((side) =>
          Array.from({ length: JET_SEGMENTS }, (_, s) => (
            <sprite key={`${side}-${s}`} scale={[lengthUnits * 0.1, lengthUnits * 0.1, 1]}>
              <spriteMaterial
                map={texture}
                transparent
                depthWrite={false}
                blending={THREE.AdditiveBlending}
              />
            </sprite>
          )),
        )}
      </group>
    </group>
  );
}

/**
 * 类星体 3C 273（需求 3.1.5 河外对象）：极亮核心 + 双向相对论喷流 + 光变闪烁
 */
export function Quasar(): JSX.Element | null {
  const body = getSpecialBodyById('quasar-3c273');
  const coreRef = useRef<THREE.Sprite>(null);
  const groupRef = useRef<THREE.Group>(null);
  const selectBody = useSimulationStore((s) => s.selectBody);
  const showLabels = useSimulationStore((s) => s.showLabels);
  const inRange = useSimulationStore((s) => s.continuousLevel > 3.05);

  const texture = useMemo(
    () => new THREE.CanvasTexture(createGlowSpriteCanvas('#dfeeff', 128)),
    [],
  );
  useEffect(() => () => texture.dispose(), [texture]);

  const jetDirection = useMemo(() => new THREE.Vector3(0.35, 0.9, 0.25).normalize(), []);

  useFrame(({ clock }) => {
    const group = groupRef.current;
    if (!group) return;
    const weight = fadeWeight(useSimulationStore.getState().continuousLevel);
    group.visible = weight > 0.001;
    setObjectTreeRaycastEnabled(group, weight > INTERACTIVE_WEIGHT);
    if (!group.visible) return;
    if (coreRef.current) {
      // 光变闪烁（不规则光变，需求 3.1.5）
      (coreRef.current.material as THREE.SpriteMaterial).opacity =
        0.95 * quasarFlicker(clock.elapsedTime) * weight;
    }
  });

  if (!body || !body.direction) return null;
  const d = cosmicDistanceToSceneUnits(body.realDistanceLy);
  const coreScale = 900;

  return (
    <group
      ref={groupRef}
      position={[body.direction.x * d, body.direction.y * d, body.direction.z * d]}
      name={body.id}
    >
      {/* 极亮核心 */}
      <sprite
        ref={coreRef}
        scale={[coreScale, coreScale, 1]}
        onClick={(e) => {
          e.stopPropagation();
          selectBody(body.id);
        }}
      >
        <spriteMaterial
          map={texture}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </sprite>
      {/* 双向相对论喷流（含流动动画） */}
      <RelativisticJet
        direction={jetDirection}
        lengthUnits={2400}
        color="#9fd0ff"
        bilateral
        baseOpacity={0.8}
      />
      {showLabels && inRange && (
        <Html position={[0, 700, 0]} center distanceFactor={12000} style={{ pointerEvents: 'none' }}>
          <span className="whitespace-nowrap rounded bg-black/50 px-2 py-0.5 text-xs text-sky-200">
            {body.nameZh}（约 24 亿光年）
          </span>
        </Html>
      )}
    </group>
  );
}

/**
 * 触须星系（NGC 4038/4039，可选需求 3.1.5）：星系碰撞现场——
 * 两个相互扭曲的旋涡星系盘 + 两条潮汐尾（"触须"）+ 星暴区亮斑
 */
export function AntennaeGalaxies(): JSX.Element | null {
  const body = getSpecialBodyById('antennae-galaxies');
  const groupRef = useRef<THREE.Group>(null);
  const selectBody = useSimulationStore((s) => s.selectBody);
  const showLabels = useSimulationStore((s) => s.showLabels);
  const inRange = useSimulationStore((s) => s.continuousLevel > 3.05);

  const textures = useMemo(
    () => ({
      diskA: new THREE.CanvasTexture(createGalaxySpriteCanvas('spiral', '#ffd8c8', 128, 40381)),
      diskB: new THREE.CanvasTexture(createGalaxySpriteCanvas('spiral', '#cfd8ff', 128, 40391)),
      burst: new THREE.CanvasTexture(createGlowSpriteCanvas('#ffb8d8', 64)),
    }),
    [],
  );
  useEffect(
    () => () => {
      textures.diskA.dispose();
      textures.diskB.dispose();
      textures.burst.dispose();
    },
    [textures],
  );

  // 潮汐尾曲线（确定性弧线，Toomre & Toomre 型潮汐尾示意）
  const tails = useMemo(() => {
    const makeTail = (sign: number): THREE.Line => {
      const segments = 40;
      const positions = new Float32Array((segments + 1) * 3);
      for (let s = 0; s <= segments; s += 1) {
        const t = s / segments;
        // 从星系盘甩出的弧线：半径增大 + 角度回卷
        const angle = sign * (0.4 + t * 2.2);
        const r = 220 + t * 1400;
        positions[s * 3] = Math.cos(angle) * r * sign;
        positions[s * 3 + 1] = Math.sin(angle) * r + sign * t * 300;
        positions[s * 3 + 2] = t * 180 * sign;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const mat = new THREE.LineBasicMaterial({
        color: sign > 0 ? '#ffd8c8' : '#cfd8ff',
        transparent: true,
        opacity: 0,
      });
      const line = new THREE.Line(geo, mat);
      line.frustumCulled = false;
      return line;
    };
    return [makeTail(1), makeTail(-1)];
  }, []);

  useEffect(
    () => () => {
      for (const tail of tails) {
        tail.geometry.dispose();
        (tail.material as THREE.Material).dispose();
      }
    },
    [tails],
  );

  useFrame(() => {
    const group = groupRef.current;
    if (!group) return;
    const weight = fadeWeight(useSimulationStore.getState().continuousLevel);
    group.visible = weight > 0.001;
    setObjectTreeRaycastEnabled(group, weight > INTERACTIVE_WEIGHT);
    if (!group.visible) return;
    group.traverse((obj) => {
      if (obj instanceof THREE.Mesh || obj instanceof THREE.Sprite) {
        const mat = obj.material as THREE.Material & { opacity: number };
        mat.opacity = ((obj.userData.baseOpacity as number | undefined) ?? 0.85) * weight;
      }
      if (obj instanceof THREE.Line) {
        (obj.material as THREE.LineBasicMaterial).opacity = 0.55 * weight;
      }
    });
  });

  if (!body || !body.direction) return null;
  const d = cosmicDistanceToSceneUnits(body.realDistanceLy);

  return (
    <group
      ref={groupRef}
      position={[body.direction.x * d, body.direction.y * d, body.direction.z * d]}
      name={body.id}
    >
      {/* 两个相互扭曲、部分重叠的星系盘 */}
      <mesh
        position={[-160, 60, 0]}
        rotation={[0.9, 0.3, 0.4]}
        userData={{ baseOpacity: 0.9 }}
        onClick={(e) => {
          e.stopPropagation();
          selectBody(body.id);
        }}
      >
        <planeGeometry args={[760, 760]} />
        <meshBasicMaterial
          map={textures.diskA}
          transparent
          depthWrite={false}
          side={THREE.DoubleSide}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
      <mesh
        position={[170, -70, 40]}
        rotation={[1.3, -0.2, -0.6]}
        userData={{ baseOpacity: 0.9 }}
        onClick={(e) => {
          e.stopPropagation();
          selectBody(body.id);
        }}
      >
        <planeGeometry args={[700, 700]} />
        <meshBasicMaterial
          map={textures.diskB}
          transparent
          depthWrite={false}
          side={THREE.DoubleSide}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
      {/* 碰撞界面的星暴区（气体压缩触发剧烈恒星形成） */}
      <sprite scale={[420, 420, 1]} position={[10, 0, 20]} userData={{ baseOpacity: 0.55 }}>
        <spriteMaterial
          map={textures.burst}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </sprite>
      {/* 两条潮汐尾（"触须"） */}
      {tails.map((tail, i) => (
        <primitive key={i} object={tail} />
      ))}
      {showLabels && inRange && (
        <Html position={[0, 900, 0]} center distanceFactor={12000} style={{ pointerEvents: 'none' }}>
          <span className="whitespace-nowrap rounded bg-black/50 px-2 py-0.5 text-xs text-orange-200">
            {body.nameZh}（星系碰撞现场，约 4500 万光年）
          </span>
        </Html>
      )}
    </group>
  );
}

/**
 * 星系团引力透镜弧（可选需求 3.1.5）：围绕星系团中心的蓝色弧状
 * 背景星系拉伸虚像（示意置于室女座星系团位置，原型 Abell 370，已登记）
 */
export function LensingArcs(): JSX.Element | null {
  const body = getSpecialBodyById('cluster-lensing');
  const groupRef = useRef<THREE.Group>(null);
  const selectBody = useSimulationStore((s) => s.selectBody);
  const showLabels = useSimulationStore((s) => s.showLabels);
  const inRange = useSimulationStore((s) => s.continuousLevel > 3.05);

  // 弧参数：围绕团中心不同半径/方位角/弧长的拉伸光弧（确定性）
  const arcs = useMemo(
    () => [
      { radius: 950, start: 0.3, length: 1.1, tilt: 0.2 },
      { radius: 1250, start: 2.4, length: 0.8, tilt: -0.35 },
      { radius: 1100, start: 4.2, length: 1.4, tilt: 0.5 },
    ],
    [],
  );

  useFrame(({ camera }) => {
    const group = groupRef.current;
    if (!group) return;
    const weight = fadeWeight(useSimulationStore.getState().continuousLevel);
    group.visible = weight > 0.001;
    setObjectTreeRaycastEnabled(group, weight > INTERACTIVE_WEIGHT);
    if (!group.visible) return;
    // 弧面朝向相机（透镜像沿视线方向观察）
    group.quaternion.copy(camera.quaternion);
    group.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        (obj.material as THREE.MeshBasicMaterial).opacity = 0.6 * weight;
      }
    });
  });

  if (!body || !body.direction) return null;
  const d = cosmicDistanceToSceneUnits(body.realDistanceLy);

  return (
    <group
      ref={groupRef}
      position={[body.direction.x * d, body.direction.y * d, body.direction.z * d]}
      name={body.id}
    >
      {arcs.map((arc, i) => (
        <mesh
          key={i}
          rotation={[0, 0, arc.tilt]}
          onClick={(e) => {
            e.stopPropagation();
            selectBody(body.id);
          }}
        >
          {/* 细环弧段：背景星系被拉伸成的弧状虚像 */}
          <ringGeometry args={[arc.radius - 28, arc.radius + 28, 48, 1, arc.start, arc.length]} />
          <meshBasicMaterial
            color="#a8d4ff"
            transparent
            side={THREE.DoubleSide}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </mesh>
      ))}
      {showLabels && inRange && (
        <Html position={[0, 1550, 0]} center distanceFactor={12000} style={{ pointerEvents: 'none' }}>
          <span className="whitespace-nowrap rounded bg-black/50 px-2 py-0.5 text-xs text-sky-200">
            星系团引力透镜弧（示意，原型 Abell 370）
          </span>
        </Html>
      )}
    </group>
  );
}

/**
 * 伽马射线暴（GRB 221009A，可选需求 3.1.5）：周期性重放的
 * 极亮闪光 + 双向窄喷流（真实为一次性事件，演示示意已登记）
 */
export function GammaRayBurst(): JSX.Element | null {
  const body = getSpecialBodyById('grb-221009a');
  const groupRef = useRef<THREE.Group>(null);
  const flashRef = useRef<THREE.Sprite>(null);
  const beamsRef = useRef<THREE.Group>(null);
  const selectBody = useSimulationStore((s) => s.selectBody);
  const showLabels = useSimulationStore((s) => s.showLabels);
  const inRange = useSimulationStore((s) => s.continuousLevel > 3.05);

  const texture = useMemo(
    () => new THREE.CanvasTexture(createGlowSpriteCanvas('#eef6ff', 128)),
    [],
  );
  useEffect(() => () => texture.dispose(), [texture]);

  useFrame(({ clock }) => {
    const group = groupRef.current;
    if (!group) return;
    const weight = fadeWeight(useSimulationStore.getState().continuousLevel);
    group.visible = weight > 0.001;
    setObjectTreeRaycastEnabled(group, weight > INTERACTIVE_WEIGHT);
    if (!group.visible) return;
    const { intensity01 } = grbFlashState(clock.elapsedTime);
    if (flashRef.current) {
      const s = 500 + 1800 * intensity01;
      flashRef.current.scale.set(s, s, 1);
      (flashRef.current.material as THREE.SpriteMaterial).opacity = intensity01 * weight;
    }
    if (beamsRef.current) {
      beamsRef.current.visible = intensity01 > 0.02;
      beamsRef.current.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          (obj.material as THREE.MeshBasicMaterial).opacity = 0.5 * intensity01 * weight;
        }
      });
    }
  });

  if (!body || !body.direction) return null;
  const d = cosmicDistanceToSceneUnits(body.realDistanceLy);

  return (
    <group
      ref={groupRef}
      position={[body.direction.x * d, body.direction.y * d, body.direction.z * d]}
      name={body.id}
    >
      {/* 极亮伽马闪光（FRED 光变曲线驱动） */}
      <sprite
        ref={flashRef}
        onClick={(e) => {
          e.stopPropagation();
          selectBody(body.id);
        }}
      >
        <spriteMaterial
          map={texture}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </sprite>
      {/* 双向窄相对论喷流（核坍缩喷流示意） */}
      <group ref={beamsRef} rotation={[0.4, 0, 0.9]}>
        {[1, -1].map((dir) => (
          <mesh key={dir} position={[0, dir * 900, 0]} rotation={[dir < 0 ? Math.PI : 0, 0, 0]}>
            <coneGeometry args={[70, 1800, 10, 1, true]} />
            <meshBasicMaterial
              color="#cfe8ff"
              transparent
              blending={THREE.AdditiveBlending}
              depthWrite={false}
              side={THREE.DoubleSide}
            />
          </mesh>
        ))}
      </group>
      {showLabels && inRange && (
        <Html position={[0, 800, 0]} center distanceFactor={12000} style={{ pointerEvents: 'none' }}>
          <span className="whitespace-nowrap rounded bg-black/50 px-2 py-0.5 text-xs text-violet-200">
            {body.nameZh}（演示重放，约 20 亿光年）
          </span>
        </Html>
      )}
    </group>
  );
}

/**
 * M87 活动星系核喷流（需求 3.1.5）：与室女座星系团 M87 条目联动为同一对象
 * （附着于 Universe 中 M87 星系的静态位置），单侧可见喷流。
 */
export function M87Jet(): JSX.Element | null {
  const galaxy = getGalaxyById('m87');
  const groupRef = useRef<THREE.Group>(null);

  const jetDirection = useMemo(() => new THREE.Vector3(0.55, 0.75, -0.37).normalize(), []);

  useFrame(() => {
    const group = groupRef.current;
    if (!group) return;
    group.visible = fadeWeight(useSimulationStore.getState().continuousLevel) > 0.001;
  });

  if (!galaxy) return null;
  const d = cosmicDistanceToSceneUnits(galaxy.distanceLy);

  return (
    <group
      ref={groupRef}
      position={[galaxy.direction.x * d, galaxy.direction.y * d, galaxy.direction.z * d]}
      name="m87-jet"
    >
      <RelativisticJet
        direction={jetDirection}
        lengthUnits={1500}
        color="#bfd8ff"
        bilateral={false}
        baseOpacity={0.7}
      />
    </group>
  );
}
