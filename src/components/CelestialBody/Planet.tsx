'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import type { PlanetData } from '@/types';
import { getMoonsByParent } from '@/data/moons';
import { useSimulationStore } from '@/store';
import { DEG_TO_RAD, heliocentricPosition, rotationAngleAtTime } from '@/utils/physics';
import { bodyDisplayRadius, eclipticToScene } from '@/utils/scale';
import { ringDisplayRadii } from '@/utils/satellites';
import { Moon } from '@/components/CelestialBody/Moon';
import {
  createBodyTextureCanvas,
  createCloudTextureCanvas,
  createNightLightsCanvas,
  createRingTextureCanvas,
} from '@/components/CelestialBody/proceduralTextures';

interface PlanetProps {
  data: PlanetData;
}

/** 纹理 LOD：远距离低分辨率 / 行星视角高分辨率（需求 3.1.1，切换无突变） */
const TEXTURE_LOW_RES = 256;
const TEXTURE_HIGH_RES = 1024;
/** 进入该连续层级以下时升级高分辨率纹理 */
const HIGH_RES_LEVEL_THRESHOLD = 1.6;
/** 外层视角下内层运动退化阈值（需求 3.3）：冻结行星位置更新并隐藏 */
const FREEZE_LEVEL_THRESHOLD = 3.2;

/**
 * 行星：开普勒轨道公转 + 真实轴倾角自转 + 表面细节 + 卫星系统
 *
 * - 位置每帧由模拟时间求解开普勒方程得到（匀面速度，需求 3.1.1）
 * - 轴倾角按 NASA 数据设置；金星 177.36°、天王星 97.77° 的"翻转轴"
 *   本身就表现了逆向自转
 * - 表面：程序化纹理（大陆/海洋、大红斑、环缝等特征可辨识），LOD 两级切换
 * - 地球：独立旋转云层 + 大气边缘辉光；土星：环系（含卡西尼缝）
 * - 卫星：赤道面参考平面的卫星挂在轴倾角组内，月球（黄道面例外）挂在外层
 * - 高时间压缩比（L3+）下冻结更新（返回时按共享时间轴重新求值，需求 3.3）
 */
export function Planet({ data }: PlanetProps): JSX.Element {
  const groupRef = useRef<THREE.Group>(null);
  const bodyRef = useRef<THREE.Mesh>(null);
  const cloudRef = useRef<THREE.Mesh>(null);
  const nightRef = useRef<THREE.Mesh>(null);
  const showLabels = useSimulationStore((s) => s.showLabels);
  const selectBody = useSimulationStore((s) => s.selectBody);
  // Html 标签不随父级 visible 隐藏，需单独按层级门控（布尔选择器，变化时才重渲染）
  const frozen = useSimulationStore((s) => s.continuousLevel > FREEZE_LEVEL_THRESHOLD);
  // 真实比例模式（需求 4.1）：半径按真实线性比例映射（对数压缩的真实开关）
  const realScaleMode = useSimulationStore((s) => s.realScaleMode);
  const [highRes, setHighRes] = useState(false);

  const radius = bodyDisplayRadius(data.radiusKm, realScaleMode);
  const tiltRad = data.rotation.axialTiltDeg * DEG_TO_RAD;
  const moons = useMemo(() => getMoonsByParent(data.id), [data.id]);
  const equatorialMoons = moons.filter((m) => m.referencePlane === 'planetEquator');
  const eclipticMoons = moons.filter((m) => m.referencePlane === 'ecliptic');

  // 表面纹理（确定性程序化生成；高分辨率按需升级，同一生成器保证无突变）
  const texture = useMemo(() => {
    const canvas = createBodyTextureCanvas(
      data.id,
      data.color,
      highRes ? TEXTURE_HIGH_RES : TEXTURE_LOW_RES,
    );
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }, [data.id, data.color, highRes]);

  const cloudTexture = useMemo(() => {
    if (!data.surface?.hasCloudLayer) return null;
    const canvas = createCloudTextureCanvas(highRes ? 512 : 256);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }, [data.surface, highRes]);

  // 夜半球城市灯光（可选需求 3.1.1）：仅背向太阳的半球显示暖黄灯光
  const nightMaterial = useMemo(() => {
    if (!data.surface?.hasNightLights) return null;
    const tex = new THREE.CanvasTexture(createNightLightsCanvas(highRes ? 1024 : 512));
    tex.colorSpace = THREE.SRGBColorSpace;
    return new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uMap: { value: tex } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vNormalW;
        varying vec3 vPosW;
        void main() {
          vUv = uv;
          vNormalW = normalize(mat3(modelMatrix) * normal);
          vec4 world = modelMatrix * vec4(position, 1.0);
          vPosW = world.xyz;
          gl_Position = projectionMatrix * viewMatrix * world;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        varying vec2 vUv;
        varying vec3 vNormalW;
        varying vec3 vPosW;
        void main() {
          // 太阳位于场景原点：日照方向 = 表面点指向原点
          vec3 sunDir = normalize(-vPosW);
          float ndl = dot(normalize(vNormalW), sunDir);
          // 仅夜半球显示（晨昏线附近平滑过渡）
          float night = smoothstep(0.08, -0.18, ndl);
          vec4 tex = texture2D(uMap, vUv);
          gl_FragColor = vec4(tex.rgb, tex.a * night);
        }
      `,
    });
  }, [data.surface, highRes]);

  const ringAssets = useMemo(() => {
    if (!data.ring) return null;
    const { innerUnits, outerUnits } = ringDisplayRadii(
      data.radiusKm,
      data.ring.innerRadiusKm,
      data.ring.outerRadiusKm,
      realScaleMode,
    );
    const geometry = new THREE.RingGeometry(innerUnits, outerUnits, 128, 1);
    // UV 重映射为径向坐标（环纹理 x 方向 = 内缘 → 外缘）
    const pos = geometry.attributes.position;
    const uv = geometry.attributes.uv;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i += 1) {
      v.fromBufferAttribute(pos, i);
      uv.setXY(i, (v.length() - innerUnits) / (outerUnits - innerUnits), 0.5);
    }
    const tex = new THREE.CanvasTexture(createRingTextureCanvas(data.ring));
    tex.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      opacity: data.ring.opacity,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    return { geometry, material, texture: tex };
  }, [data.ring, data.radiusKm, realScaleMode]);

  useEffect(() => {
    return () => {
      texture.dispose();
    };
  }, [texture]);

  useEffect(() => {
    return () => {
      cloudTexture?.dispose();
    };
  }, [cloudTexture]);

  useEffect(() => {
    return () => {
      if (nightMaterial) {
        (nightMaterial.uniforms.uMap.value as THREE.Texture).dispose();
        nightMaterial.dispose();
      }
    };
  }, [nightMaterial]);

  useEffect(() => {
    return () => {
      if (ringAssets) {
        ringAssets.geometry.dispose();
        ringAssets.material.dispose();
        ringAssets.texture.dispose();
      }
    };
  }, [ringAssets]);

  useFrame(() => {
    const state = useSimulationStore.getState();
    const { simDays, continuousLevel } = state;

    // 外层视角下内层运动退化（需求 3.3）：冻结演算，返回时按共享时间轴重求
    if (groupRef.current) {
      const frozen = continuousLevel > FREEZE_LEVEL_THRESHOLD;
      groupRef.current.visible = !frozen;
      if (frozen) return;
    }

    // 纹理 LOD 升级：首次进入行星视角时切换高分辨率
    if (!highRes && continuousLevel < HIGH_RES_LEVEL_THRESHOLD) {
      setHighRes(true);
    }

    // 公转位置：求解开普勒方程（近日点快、远日点慢）
    const ecliptic = heliocentricPosition(data.orbit, simDays);
    const scene = eclipticToScene(ecliptic);
    if (groupRef.current) {
      groupRef.current.position.set(scene.x, scene.y, scene.z);
    }
    // 自转：绕倾斜后的自身轴，周期取绝对值（逆向由轴倾角 >90° 表达）
    const rotation = rotationAngleAtTime(Math.abs(data.rotation.siderealPeriodHours), simDays);
    if (bodyRef.current) {
      bodyRef.current.rotation.y = rotation;
    }
    // 云层独立旋转（比地表略快，体现大气环流）
    if (cloudRef.current) {
      cloudRef.current.rotation.y = rotation * 1.12;
    }
    // 夜灯层与地表同步旋转（灯光固定在大陆上）
    if (nightRef.current) {
      nightRef.current.rotation.y = rotation;
    }
  });

  return (
    <group ref={groupRef} name={data.id}>
      {/* 轴倾角组：绕 Z 轴倾斜（相对轨道面，此处近似相对黄道面） */}
      <group rotation={[0, 0, tiltRad]}>
        <mesh
          ref={bodyRef}
          onClick={(e) => {
            e.stopPropagation();
            selectBody(data.id);
          }}
        >
          <sphereGeometry args={[radius, 48, 48]} />
          <meshStandardMaterial map={texture} roughness={0.85} metalness={0.05} />
        </mesh>

        {/* 夜半球城市灯光（可选需求 3.1.1：背向太阳的半球显示） */}
        {nightMaterial && (
          <mesh ref={nightRef} material={nightMaterial}>
            <sphereGeometry args={[radius * 1.005, 48, 48]} />
          </mesh>
        )}

        {/* 云层（独立旋转，需求 3.1.1 地球） */}
        {cloudTexture && (
          <mesh ref={cloudRef}>
            <sphereGeometry args={[radius * 1.02, 48, 48]} />
            <meshStandardMaterial
              map={cloudTexture}
              transparent
              opacity={0.85}
              depthWrite={false}
              roughness={1}
            />
          </mesh>
        )}

        {/* 大气边缘辉光（蓝色薄层，需求 3.1.1） */}
        {data.surface?.hasAtmosphereGlow && (
          <mesh>
            <sphereGeometry args={[radius * 1.07, 48, 48]} />
            <meshBasicMaterial
              color={data.surface.atmosphereColor ?? '#6ab7ff'}
              transparent
              opacity={0.16}
              side={THREE.BackSide}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
            />
          </mesh>
        )}

        {/* 行星环（土星：分层环纹 + 卡西尼缝，需求 3.1.1） */}
        {ringAssets && (
          <mesh
            rotation={[-Math.PI / 2, 0, 0]}
            geometry={ringAssets.geometry}
            material={ringAssets.material}
          />
        )}

        {/* 赤道面参考平面卫星（需求 3.1.1：参考平面统一为行星赤道面） */}
        {equatorialMoons.map((moon) => (
          <Moon key={moon.id} data={moon} parentRadiusKm={data.radiusKm} />
        ))}
      </group>

      {/* 黄道面参考平面卫星（月球例外：相对黄道面约 5.1°） */}
      {eclipticMoons.map((moon) => (
        <Moon key={moon.id} data={moon} parentRadiusKm={data.radiusKm} />
      ))}

      {showLabels && !frozen && (
        <Html
          position={[0, radius + 0.6, 0]}
          center
          distanceFactor={60}
          style={{ pointerEvents: 'none' }}
        >
          <span className="whitespace-nowrap text-xs text-gray-200/80">{data.nameZh}</span>
        </Html>
      )}
    </group>
  );
}
