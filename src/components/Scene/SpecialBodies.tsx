'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import type { SpecialBodyData } from '@/types';
import {
  PULSAR_VISUAL_SPIN_PERIOD_SEC,
  SIRIUS_MASS_RATIO,
  SIRIUS_VISUAL_ORBIT_PERIOD_SEC,
  SPECIAL_BODIES,
} from '@/data/specialBodies';
import { useSimulationStore } from '@/store';
import { SCENE_UNITS_PER_LY, trapezoidWeight } from '@/utils/scale';
import { sunGalacticPositionLy } from '@/utils/galaxy';
import { createSeededRandom } from '@/utils/random';
import {
  accretionDiskAngularSpeed,
  binaryStarPositions,
  blueGiantFlicker,
  cepheidBrightness,
  nebulaExpansionScale,
  pulsarBeamAngle,
  pulsarPulseIntensity,
  redGiantPulsation,
  stellarWindPhase01,
} from '@/utils/specialBodies';
import { createGlowSpriteCanvas } from '@/components/CelestialBody/proceduralTextures';

/**
 * 特殊天体 LOD 淡入淡出（需求 3.1.5 通用要求）：
 * L3 完整可见，进入 L4 前淡出（恒星级天体在 L4 不可见，如脉冲星）
 */
const SPECIAL_FADE = { x0: 2.1, x1: 2.6, x2: 3.4, x3: 4.0 } as const;

function specialFadeWeight(continuousLevel: number): number {
  return trapezoidWeight(
    continuousLevel,
    SPECIAL_FADE.x0,
    SPECIAL_FADE.x1,
    SPECIAL_FADE.x2,
    SPECIAL_FADE.x3,
  );
}

interface BodyProps {
  body: SpecialBodyData;
}

/** 共用：把 sun-relative / galactic-center 天体定位到银心系本地坐标（场景单位） */
function useGalacticPlacement(
  body: SpecialBodyData,
  groupRef: React.RefObject<THREE.Group>,
): void {
  useFrame(() => {
    const group = groupRef.current;
    if (!group) return;
    const state = useSimulationStore.getState();
    const weight = specialFadeWeight(state.continuousLevel);
    group.visible = weight > 0.001;
    if (!group.visible) return;
    if (body.positionMode === 'galactic-center') {
      group.position.set(0, 0, 0);
      return;
    }
    const offset = body.offsetLy;
    if (!offset) return;
    // 随太阳共转（近似处理已登记）：位置 = 太阳银心系位置 + 固定偏移
    const sun = sunGalacticPositionLy(state.simDays);
    group.position.set(
      (sun.x + offset.x) * SCENE_UNITS_PER_LY,
      (sun.y + offset.y) * SCENE_UNITS_PER_LY,
      (sun.z + offset.z) * SCENE_UNITS_PER_LY,
    );
  });
}

/** 共用：标签 */
function BodyLabel({ body, sizeUnits }: { body: SpecialBodyData; sizeUnits: number }): JSX.Element | null {
  const showLabels = useSimulationStore((s) => s.showLabels);
  const inRange = useSimulationStore((s) => s.continuousLevel > 2.35 && s.continuousLevel < 3.9);
  if (!showLabels || !inRange) return null;
  return (
    <Html
      position={[0, sizeUnits * 1.3, 0]}
      center
      distanceFactor={2600}
      style={{ pointerEvents: 'none' }}
    >
      <span className="whitespace-nowrap rounded bg-black/40 px-1.5 py-0.5 text-xs text-sky-200/90">
        {body.nameZh}
      </span>
    </Html>
  );
}

/**
 * 红巨星（参宿四）：橙红色巨星 + 弥散气体壳，半规则脉动（需求 3.1.5）
 */
function RedGiant({ body }: BodyProps): JSX.Element {
  const groupRef = useRef<THREE.Group>(null);
  const coreRef = useRef<THREE.Mesh>(null);
  const glowRef = useRef<THREE.Sprite>(null);
  const selectBody = useSimulationStore((s) => s.selectBody);
  const size = body.visualRadiusLy * SCENE_UNITS_PER_LY;

  const glowTexture = useMemo(
    () => new THREE.CanvasTexture(createGlowSpriteCanvas(body.color, 128)),
    [body.color],
  );
  useEffect(() => () => glowTexture.dispose(), [glowTexture]);

  useGalacticPlacement(body, groupRef);
  useFrame(({ clock }) => {
    const group = groupRef.current;
    if (!group || !group.visible) return;
    const weight = specialFadeWeight(useSimulationStore.getState().continuousLevel);
    const { scale, brightness } = redGiantPulsation(clock.elapsedTime);
    if (coreRef.current) {
      coreRef.current.scale.setScalar(scale);
      (coreRef.current.material as THREE.MeshBasicMaterial).opacity = weight;
    }
    if (glowRef.current) {
      const s = size * 3.4 * scale;
      glowRef.current.scale.set(s, s, 1);
      (glowRef.current.material as THREE.SpriteMaterial).opacity =
        0.65 * brightness * weight;
    }
  });

  return (
    <group ref={groupRef} name={body.id}>
      <mesh
        ref={coreRef}
        onClick={(e) => {
          e.stopPropagation();
          selectBody(body.id);
        }}
      >
        <sphereGeometry args={[size, 24, 24]} />
        <meshBasicMaterial color={body.color} transparent />
      </mesh>
      {/* 外层弥散气体壳 */}
      <mesh>
        <sphereGeometry args={[size * 1.5, 16, 16]} />
        <meshBasicMaterial
          color={body.color}
          transparent
          opacity={0.12}
          side={THREE.BackSide}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
      <sprite ref={glowRef}>
        <spriteMaterial
          map={glowTexture}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </sprite>
      <BodyLabel body={body} sizeUnits={size} />
    </group>
  );
}

interface StellarWindProps {
  /** 恒星视觉半径（场景单位） */
  sizeUnits: number;
  color: string;
  /** 粒子数 */
  count: number;
  /** 外流最大半径（相对恒星半径倍数） */
  maxRadiusFactor: number;
  /** 外流循环周期（秒） */
  cycleSec: number;
  /** 确定性种子 */
  seed: number;
}

/**
 * 强星风粒子外流（可选需求 3.1.5：蓝巨星/沃尔夫-拉叶星）
 *
 * 粒子沿确定性随机方向从恒星表面径向外流（stellarWindPhase01 驱动），
 * 越远越暗（加色混合下用顶点色衰减表达），到达外缘后循环回收。
 */
function StellarWind({
  sizeUnits,
  color,
  count,
  maxRadiusFactor,
  cycleSec,
  seed,
}: StellarWindProps): JSX.Element {
  const { geometry, material, directions, seeds, baseColor } = useMemo(() => {
    const rand = createSeededRandom(seed);
    const dirs = new Float32Array(count * 3);
    const seedArr = new Float32Array(count);
    for (let i = 0; i < count; i += 1) {
      const cosPolar = rand() * 2 - 1;
      const azimuth = Math.PI * 2 * rand();
      const sinPolar = Math.sqrt(1 - cosPolar * cosPolar);
      dirs[i * 3] = sinPolar * Math.cos(azimuth);
      dirs[i * 3 + 1] = cosPolar;
      dirs[i * 3 + 2] = sinPolar * Math.sin(azimuth);
      seedArr[i] = rand();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    geo.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(0, 0, 0),
      sizeUnits * maxRadiusFactor * 1.2,
    );
    const mat = new THREE.PointsMaterial({
      size: sizeUnits * 0.14,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    const c = new THREE.Color(color);
    return { geometry: geo, material: mat, directions: dirs, seeds: seedArr, baseColor: c };
  }, [sizeUnits, color, count, maxRadiusFactor, seed]);

  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  useFrame(({ clock }) => {
    const weight = specialFadeWeight(useSimulationStore.getState().continuousLevel);
    const pos = geometry.attributes.position as THREE.BufferAttribute;
    const col = geometry.attributes.color as THREE.BufferAttribute;
    for (let i = 0; i < seeds.length; i += 1) {
      const phase = stellarWindPhase01(clock.elapsedTime, seeds[i], cycleSec);
      const r = sizeUnits * (1 + phase * (maxRadiusFactor - 1));
      pos.setXYZ(i, directions[i * 3] * r, directions[i * 3 + 1] * r, directions[i * 3 + 2] * r);
      // 越远越暗（加色混合下颜色变暗即透明度下降）
      const fade = (1 - phase) * weight;
      col.setXYZ(i, baseColor.r * fade, baseColor.g * fade, baseColor.b * fade);
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
  });

  return <points geometry={geometry} material={material} />;
}

/**
 * 蓝巨星（参宿七）：蓝白色 + 强光晕，高频微闪烁 + 强星风粒子外流
 * （需求 3.1.5，含可选项星风）
 */
function BlueGiant({ body }: BodyProps): JSX.Element {
  const groupRef = useRef<THREE.Group>(null);
  const glowRef = useRef<THREE.Sprite>(null);
  const selectBody = useSimulationStore((s) => s.selectBody);
  const size = body.visualRadiusLy * SCENE_UNITS_PER_LY;

  const glowTexture = useMemo(
    () => new THREE.CanvasTexture(createGlowSpriteCanvas(body.color, 128)),
    [body.color],
  );
  useEffect(() => () => glowTexture.dispose(), [glowTexture]);

  useGalacticPlacement(body, groupRef);
  useFrame(({ clock }) => {
    const group = groupRef.current;
    if (!group || !group.visible) return;
    const weight = specialFadeWeight(useSimulationStore.getState().continuousLevel);
    if (glowRef.current) {
      (glowRef.current.material as THREE.SpriteMaterial).opacity =
        0.8 * blueGiantFlicker(clock.elapsedTime) * weight;
    }
  });

  return (
    <group ref={groupRef} name={body.id}>
      <mesh
        onClick={(e) => {
          e.stopPropagation();
          selectBody(body.id);
        }}
      >
        <sphereGeometry args={[size, 24, 24]} />
        <meshBasicMaterial color="#eaf2ff" />
      </mesh>
      <sprite ref={glowRef} scale={[size * 5, size * 5, 1]}>
        <spriteMaterial
          map={glowTexture}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </sprite>
      {/* 强星风粒子外流（可选需求 3.1.5） */}
      <StellarWind
        sizeUnits={size}
        color={body.color}
        count={36}
        maxRadiusFactor={3.2}
        cycleSec={6}
        seed={20260731}
      />
      <BodyLabel body={body} sizeUnits={size} />
    </group>
  );
}

/**
 * 沃尔夫-拉叶星（WR 124，可选需求 3.1.5）：炽热蓝白核心 + 强星风外流
 * + M1-67 抛射星云壳（缓慢膨胀）
 */
function WolfRayet({ body }: BodyProps): JSX.Element {
  const groupRef = useRef<THREE.Group>(null);
  const glowRef = useRef<THREE.Sprite>(null);
  const shellRef = useRef<THREE.Mesh>(null);
  const selectBody = useSimulationStore((s) => s.selectBody);
  const size = body.visualRadiusLy * SCENE_UNITS_PER_LY;

  const glowTexture = useMemo(
    () => new THREE.CanvasTexture(createGlowSpriteCanvas(body.color, 128)),
    [body.color],
  );
  useEffect(() => () => glowTexture.dispose(), [glowTexture]);

  useGalacticPlacement(body, groupRef);
  useFrame(({ clock }) => {
    const group = groupRef.current;
    if (!group || !group.visible) return;
    const weight = specialFadeWeight(useSimulationStore.getState().continuousLevel);
    if (glowRef.current) {
      (glowRef.current.material as THREE.SpriteMaterial).opacity =
        0.85 * blueGiantFlicker(clock.elapsedTime * 1.4) * weight;
    }
    if (shellRef.current) {
      // M1-67 抛射星云壳：缓慢膨胀（艺术化加速，已登记）
      shellRef.current.scale.setScalar(nebulaExpansionScale(clock.elapsedTime, 80, 0.14));
      (shellRef.current.material as THREE.MeshBasicMaterial).opacity = 0.14 * weight;
    }
  });

  return (
    <group ref={groupRef} name={body.id}>
      {/* 炽热核心（约 44,000 K，蓝白色） */}
      <mesh
        onClick={(e) => {
          e.stopPropagation();
          selectBody(body.id);
        }}
      >
        <sphereGeometry args={[size * 0.6, 20, 20]} />
        <meshBasicMaterial color="#e8f0ff" />
      </mesh>
      <sprite ref={glowRef} scale={[size * 4, size * 4, 1]}>
        <spriteMaterial
          map={glowTexture}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </sprite>
      {/* M1-67 抛射星云壳 */}
      <mesh ref={shellRef}>
        <sphereGeometry args={[size * 1.9, 20, 20]} />
        <meshBasicMaterial
          color="#c8a8d8"
          transparent
          side={THREE.BackSide}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
      {/* 数千 km/s 强星风（比蓝巨星更快的循环周期） */}
      <StellarWind
        sizeUnits={size * 0.6}
        color="#cfe0ff"
        count={52}
        maxRadiusFactor={5}
        cycleSec={3.2}
        seed={20260732}
      />
      <BodyLabel body={body} sizeUnits={size} />
    </group>
  );
}

/**
 * 造父变星（造父一，可选需求 3.1.5）：周期性脉动光变
 * （快速增亮、缓慢变暗的锯齿曲线，"量天尺"科普说明见信息面板）
 */
function Cepheid({ body }: BodyProps): JSX.Element {
  const groupRef = useRef<THREE.Group>(null);
  const coreRef = useRef<THREE.Mesh>(null);
  const glowRef = useRef<THREE.Sprite>(null);
  const selectBody = useSimulationStore((s) => s.selectBody);
  const size = body.visualRadiusLy * SCENE_UNITS_PER_LY;

  const glowTexture = useMemo(
    () => new THREE.CanvasTexture(createGlowSpriteCanvas(body.color, 128)),
    [body.color],
  );
  useEffect(() => () => glowTexture.dispose(), [glowTexture]);

  useGalacticPlacement(body, groupRef);
  useFrame(({ clock }) => {
    const group = groupRef.current;
    if (!group || !group.visible) return;
    const weight = specialFadeWeight(useSimulationStore.getState().continuousLevel);
    const brightness = cepheidBrightness(clock.elapsedTime);
    // 脉动：亮度与尺寸同步变化（κ 机制的外层膨胀收缩）
    if (coreRef.current) {
      coreRef.current.scale.setScalar(0.9 + 0.15 * (brightness - 0.65));
    }
    if (glowRef.current) {
      const s = size * 3.6 * (0.8 + 0.35 * brightness);
      glowRef.current.scale.set(s, s, 1);
      (glowRef.current.material as THREE.SpriteMaterial).opacity =
        0.75 * brightness * weight;
    }
  });

  return (
    <group ref={groupRef} name={body.id}>
      <mesh
        ref={coreRef}
        onClick={(e) => {
          e.stopPropagation();
          selectBody(body.id);
        }}
      >
        <sphereGeometry args={[size * 0.5, 20, 20]} />
        <meshBasicMaterial color={body.color} />
      </mesh>
      <sprite ref={glowRef}>
        <spriteMaterial
          map={glowTexture}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </sprite>
      <BodyLabel body={body} sizeUnits={size} />
    </group>
  );
}

/**
 * 疏散星团（昴星团，可选需求 3.1.5）：松散分布的年轻热蓝星
 * + 蓝色反射星云（与球状星团的致密老年恒星形成对比）
 */
function OpenCluster({ body }: BodyProps): JSX.Element {
  const groupRef = useRef<THREE.Group>(null);
  const selectBody = useSimulationStore((s) => s.selectBody);
  const size = body.visualRadiusLy * SCENE_UNITS_PER_LY;

  const nebulaTexture = useMemo(
    () => new THREE.CanvasTexture(createGlowSpriteCanvas(body.color, 128)),
    [body.color],
  );
  useEffect(() => () => nebulaTexture.dispose(), [nebulaTexture]);
  const nebulaRef = useRef<THREE.Sprite>(null);

  const { geometry, material } = useMemo(() => {
    const rand = createSeededRandom(20260733);
    const count = 120;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) {
      // 疏散分布：半径接近均匀（无强中心聚集，与球状星团的 rand² 相对）
      const r = size * Math.sqrt(rand());
      const cosPolar = rand() * 2 - 1;
      const azimuth = Math.PI * 2 * rand();
      const sinPolar = Math.sqrt(1 - cosPolar * cosPolar);
      positions[i * 3] = r * sinPolar * Math.cos(azimuth);
      positions[i * 3 + 1] = r * cosPolar * 0.7;
      positions[i * 3 + 2] = r * sinPolar * Math.sin(azimuth);
      // 年轻热蓝星（B 型为主）+ 少量白色
      const blue = 0.85 + 0.15 * rand();
      const brightness = 0.6 + 0.4 * rand();
      colors[i * 3] = 0.7 * brightness;
      colors[i * 3 + 1] = 0.82 * brightness;
      colors[i * 3 + 2] = blue * brightness;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.PointsMaterial({
      size: size * 0.09,
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    return { geometry: geo, material: mat };
  }, [size]);

  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  useGalacticPlacement(body, groupRef);
  useFrame(({ clock }) => {
    const group = groupRef.current;
    if (!group || !group.visible) return;
    const weight = specialFadeWeight(useSimulationStore.getState().continuousLevel);
    material.opacity = 0.95 * weight;
    if (nebulaRef.current) {
      // 反射星云微闪烁（星光散射）
      (nebulaRef.current.material as THREE.SpriteMaterial).opacity =
        0.28 * blueGiantFlicker(clock.elapsedTime * 0.5) * weight;
    }
  });

  return (
    <group ref={groupRef} name={body.id}>
      {/* 蓝色反射星云（星光被尘埃散射，非电离发光） */}
      <sprite ref={nebulaRef} scale={[size * 2.6, size * 2, 1]}>
        <spriteMaterial
          map={nebulaTexture}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </sprite>
      <points geometry={geometry} material={material} />
      {/* 点选热区 */}
      <mesh
        onClick={(e) => {
          e.stopPropagation();
          selectBody(body.id);
        }}
      >
        <sphereGeometry args={[size * 0.7, 12, 12]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      <BodyLabel body={body} sizeUnits={size} />
    </group>
  );
}

/**
 * 暗星云（马头星云，可选需求 3.1.5）：剪影遮挡效果——
 * 前景冷分子云（不发光、普通混合的暗色块）遮挡背景发射星云 IC 434 的红光
 */
function DarkNebula({ body }: BodyProps): JSX.Element {
  const groupRef = useRef<THREE.Group>(null);
  const selectBody = useSimulationStore((s) => s.selectBody);
  const size = body.visualRadiusLy * SCENE_UNITS_PER_LY;

  const textures = useMemo(
    () => ({
      emission: new THREE.CanvasTexture(createGlowSpriteCanvas('#ff8898', 128)),
      dark: new THREE.CanvasTexture(createGlowSpriteCanvas('#050308', 128)),
    }),
    [],
  );
  useEffect(
    () => () => {
      textures.emission.dispose();
      textures.dark.dispose();
    },
    [textures],
  );

  useGalacticPlacement(body, groupRef);
  useFrame(() => {
    const group = groupRef.current;
    if (!group || !group.visible) return;
    const weight = specialFadeWeight(useSimulationStore.getState().continuousLevel);
    group.traverse((obj) => {
      if (obj instanceof THREE.Sprite) {
        obj.material.opacity = (obj.userData.baseOpacity as number) * weight;
      }
    });
  });

  // 马头剪影示意：垂直"颈部" + 顶部"头部"偏移暗块（前景，普通混合遮光）
  const silhouette = [
    { x: 0, y: -size * 0.25, scale: 0.55, opacity: 0.92 },
    { x: 0, y: size * 0.12, scale: 0.42, opacity: 0.95 },
    { x: size * 0.18, y: size * 0.34, scale: 0.3, opacity: 0.95 },
  ];

  return (
    <group ref={groupRef} name={body.id}>
      {/* 背景发射星云 IC 434（氢α红光，加色混合） */}
      <sprite
        position={[0, 0, -size * 0.5]}
        scale={[size * 2.8, size * 2.2, 1]}
        userData={{ baseOpacity: 0.4 }}
        onClick={(e) => {
          e.stopPropagation();
          selectBody(body.id);
        }}
      >
        <spriteMaterial
          map={textures.emission}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </sprite>
      {/* 前景暗分子云剪影（普通混合遮挡背景红光） */}
      {silhouette.map((s, i) => (
        <sprite
          key={i}
          position={[s.x, s.y, size * 0.3]}
          scale={[size * s.scale, size * s.scale * 1.3, 1]}
          userData={{ baseOpacity: s.opacity }}
          renderOrder={10}
        >
          <spriteMaterial
            map={textures.dark}
            transparent
            depthWrite={false}
            blending={THREE.NormalBlending}
          />
        </sprite>
      ))}
      <BodyLabel body={body} sizeUnits={size} />
    </group>
  );
}

/**
 * 天狼星A/B 双星系统：白矮星与主星绕共同质心互绕
 * （轨道周期真实约 50 年，按 3.3 速率钳制策略降速显示，需求 3.1.5）
 */
function SiriusBinary({ body }: BodyProps): JSX.Element {
  const groupRef = useRef<THREE.Group>(null);
  const primaryRef = useRef<THREE.Group>(null);
  const secondaryRef = useRef<THREE.Group>(null);
  const selectBody = useSimulationStore((s) => s.selectBody);
  const size = body.visualRadiusLy * SCENE_UNITS_PER_LY;
  const separation = size * 1.7;

  const glowTexture = useMemo(
    () => new THREE.CanvasTexture(createGlowSpriteCanvas('#eef4ff', 128)),
    [],
  );
  useEffect(() => () => glowTexture.dispose(), [glowTexture]);

  useGalacticPlacement(body, groupRef);
  useFrame(({ clock }) => {
    const group = groupRef.current;
    if (!group || !group.visible) return;
    const phase = (Math.PI * 2 * clock.elapsedTime) / SIRIUS_VISUAL_ORBIT_PERIOD_SEC;
    const { primary, secondary } = binaryStarPositions(separation, SIRIUS_MASS_RATIO, phase);
    primaryRef.current?.position.set(primary.x, primary.y, primary.z);
    secondaryRef.current?.position.set(secondary.x, secondary.y, secondary.z);
  });

  return (
    <group ref={groupRef} name={body.id}>
      {/* 天狼星A：主序星（大而亮） */}
      <group ref={primaryRef}>
        <mesh
          onClick={(e) => {
            e.stopPropagation();
            selectBody(body.id);
          }}
        >
          <sphereGeometry args={[size * 0.42, 20, 20]} />
          <meshBasicMaterial color="#f4f8ff" />
        </mesh>
        <sprite scale={[size * 2.2, size * 2.2, 1]}>
          <spriteMaterial
            map={glowTexture}
            transparent
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            opacity={0.7}
          />
        </sprite>
      </group>
      {/* 天狼星B：白矮星（极小、白色，高密度在信息面板强调） */}
      <group ref={secondaryRef}>
        <mesh
          onClick={(e) => {
            e.stopPropagation();
            selectBody(body.id);
          }}
        >
          <sphereGeometry args={[size * 0.1, 12, 12]} />
          <meshBasicMaterial color="#ffffff" />
        </mesh>
      </group>
      <BodyLabel body={body} sizeUnits={size} />
    </group>
  );
}

/**
 * 蟹状星云脉冲星 + 超新星遗迹（同一对象联动，需求 3.1.5）：
 * 丝状膨胀星云 + 中心中子星 + 双极射束旋转扫描（灯塔效应）
 */
function PulsarRemnant({ body }: BodyProps): JSX.Element {
  const groupRef = useRef<THREE.Group>(null);
  const beamsRef = useRef<THREE.Group>(null);
  const flashRef = useRef<THREE.Sprite>(null);
  const nebulaRef = useRef<THREE.Sprite>(null);
  const selectBody = useSimulationStore((s) => s.selectBody);
  const size = body.visualRadiusLy * SCENE_UNITS_PER_LY;

  const textures = useMemo(
    () => ({
      nebula: new THREE.CanvasTexture(createGlowSpriteCanvas('#8fb8ff', 128)),
      flash: new THREE.CanvasTexture(createGlowSpriteCanvas('#dff2ff', 128)),
    }),
    [],
  );
  useEffect(
    () => () => {
      textures.nebula.dispose();
      textures.flash.dispose();
    },
    [textures],
  );

  useGalacticPlacement(body, groupRef);
  useFrame(({ clock }) => {
    const group = groupRef.current;
    if (!group || !group.visible) return;
    const weight = specialFadeWeight(useSimulationStore.getState().continuousLevel);
    const t = clock.elapsedTime;
    // 射束旋转扫描（可视化降频周期，已登记）
    if (beamsRef.current) {
      beamsRef.current.rotation.y = pulsarBeamAngle(t, PULSAR_VISUAL_SPIN_PERIOD_SEC);
    }
    // 射束扫过视线方向 → 周期性脉冲闪烁
    if (flashRef.current) {
      (flashRef.current.material as THREE.SpriteMaterial).opacity =
        pulsarPulseIntensity(t, PULSAR_VISUAL_SPIN_PERIOD_SEC) * 0.95 * weight;
    }
    // 遗迹星云缓慢膨胀（联动蟹状星云）
    if (nebulaRef.current) {
      const s = size * 2.6 * nebulaExpansionScale(t, 90, 0.1);
      nebulaRef.current.scale.set(s, s, 1);
      (nebulaRef.current.material as THREE.SpriteMaterial).opacity = 0.4 * weight;
    }
  });

  return (
    <group ref={groupRef} name={body.id}>
      {/* 超新星遗迹：丝状膨胀星云（蟹状星云） */}
      <sprite ref={nebulaRef}>
        <spriteMaterial
          map={textures.nebula}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </sprite>
      {/* 中心中子星（极小天体 + 强磁场视觉暗示：蓝白色） */}
      <mesh
        onClick={(e) => {
          e.stopPropagation();
          selectBody(body.id);
        }}
      >
        <sphereGeometry args={[size * 0.08, 12, 12]} />
        <meshBasicMaterial color="#dff2ff" />
      </mesh>
      {/* 双极射束（磁轴相对自转轴倾斜 → 灯塔效应） */}
      <group ref={beamsRef}>
        <group rotation={[0, 0, 0.7]}>
          {[1, -1].map((dir) => (
            <mesh key={dir} position={[0, dir * size * 0.9, 0]} rotation={[dir < 0 ? Math.PI : 0, 0, 0]}>
              <coneGeometry args={[size * 0.22, size * 1.8, 12, 1, true]} />
              <meshBasicMaterial
                color="#bfe4ff"
                transparent
                opacity={0.5}
                blending={THREE.AdditiveBlending}
                depthWrite={false}
                side={THREE.DoubleSide}
              />
            </mesh>
          ))}
        </group>
      </group>
      {/* 脉冲闪烁（射束扫过视线时增亮） */}
      <sprite ref={flashRef} scale={[size * 1.8, size * 1.8, 1]}>
        <spriteMaterial
          map={textures.flash}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </sprite>
      <BodyLabel body={body} sizeUnits={size} />
    </group>
  );
}

/**
 * 人马座A* 黑洞（需求 3.1.5）：事件视界（纯黑球体）+ 吸积盘
 * （开普勒较差旋转 + 多普勒不对称，shader）+ 引力透镜环状扭曲（shader）
 */
function BlackHole({ body }: BodyProps): JSX.Element {
  const groupRef = useRef<THREE.Group>(null);
  const lensRef = useRef<THREE.Mesh>(null);
  const selectBody = useSimulationStore((s) => s.selectBody);
  const size = body.visualRadiusLy * SCENE_UNITS_PER_LY;
  const horizonRadius = size * 0.32;

  // 吸积盘 shader：较差旋转（ω ∝ r^-1.5）+ 内亮外暗 + 多普勒集束不对称
  const diskMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        uniforms: {
          uTime: { value: 0 },
          uOpacity: { value: 1 },
        },
        vertexShader: /* glsl */ `
          varying vec2 vLocal;
          varying vec3 vWorldPos;
          void main() {
            vLocal = position.xy; // ring 几何在 x-y 平面
            vec4 world = modelMatrix * vec4(position, 1.0);
            vWorldPos = world.xyz;
            gl_Position = projectionMatrix * viewMatrix * world;
          }
        `,
        fragmentShader: /* glsl */ `
          uniform float uTime;
          uniform float uOpacity;
          varying vec2 vLocal;
          varying vec3 vWorldPos;

          void main() {
            float r = length(vLocal);
            float rNorm = clamp(r / ${(size * 2.0).toFixed(3)}, 0.05, 1.0);
            // 开普勒较差旋转：ω ∝ r^-1.5（内圈快外圈慢）
            float omega = pow(rNorm, -1.5) * 0.6;
            float angle = atan(vLocal.y, vLocal.x) - omega * uTime;
            // 气体流纹理（角向条纹 + 径向衰减）
            float streaks = 0.55 + 0.45 * sin(angle * 9.0 + rNorm * 14.0);
            float radial = smoothstep(1.0, 0.15, rNorm);
            // 多普勒集束近似（可选需求）：接近侧亮、远离侧暗
            vec3 tangent = normalize(vec3(-vLocal.y, vLocal.x, 0.0));
            vec3 viewDir = normalize(cameraPosition - vWorldPos);
            float cosT = dot(tangent, viewDir);
            float doppler = 1.0 / pow(1.0 - 0.35 * cosT, 3.0);
            // 内圈白热 → 外圈橙红
            vec3 hot = vec3(1.0, 0.96, 0.88);
            vec3 warm = vec3(1.0, 0.55, 0.25);
            vec3 color = mix(hot, warm, rNorm);
            float alpha = radial * streaks * uOpacity;
            gl_FragColor = vec4(color * doppler * 0.55, alpha);
          }
        `,
      }),
    [size],
  );

  // 引力透镜 shader：爱因斯坦环 + 背景星光弯曲的弧状扭曲（面向相机的公告板）
  const lensMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: {
          uTime: { value: 0 },
          uOpacity: { value: 1 },
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
          varying vec2 vUv;

          void main() {
            vec2 c = (vUv - 0.5) * 2.0;
            float d = length(c);
            float theta = atan(c.y, c.x);
            // 爱因斯坦环：视界外的亮环（光子环示意）
            float ring = exp(-pow((d - 0.62) / 0.055, 2.0));
            // 弧状扭曲：背景星光被弯曲成沿环切向拉长的光弧（缓慢旋转）
            float arcs = exp(-pow((d - 0.78) / 0.12, 2.0)) *
              (0.5 + 0.5 * sin(theta * 5.0 + uTime * 0.15));
            float glow = ring * 1.1 + arcs * 0.45;
            vec3 color = vec3(0.82, 0.9, 1.0);
            gl_FragColor = vec4(color * glow, glow * uOpacity);
          }
        `,
      }),
    [],
  );

  useEffect(
    () => () => {
      diskMaterial.dispose();
      lensMaterial.dispose();
    },
    [diskMaterial, lensMaterial],
  );

  useGalacticPlacement(body, groupRef);
  useFrame(({ clock, camera }) => {
    const group = groupRef.current;
    if (!group || !group.visible) return;
    const weight = specialFadeWeight(useSimulationStore.getState().continuousLevel);
    // 动态效果按需渲染（需求 3.1.5）：仅可见时推进 shader 时间
    diskMaterial.uniforms.uTime.value = clock.elapsedTime;
    diskMaterial.uniforms.uOpacity.value = weight;
    lensMaterial.uniforms.uTime.value = clock.elapsedTime;
    lensMaterial.uniforms.uOpacity.value = weight * 0.85;
    // 透镜公告板始终面向相机
    if (lensRef.current) {
      lensRef.current.quaternion.copy(camera.quaternion);
    }
  });

  return (
    <group ref={groupRef} name={body.id}>
      {/* 事件视界：纯黑球体 */}
      <mesh
        onClick={(e) => {
          e.stopPropagation();
          selectBody(body.id);
        }}
      >
        <sphereGeometry args={[horizonRadius, 32, 32]} />
        <meshBasicMaterial color="#000000" />
      </mesh>
      {/* 吸积盘（较差旋转 + 多普勒不对称） */}
      <mesh rotation={[-Math.PI / 2.6, 0, 0]} material={diskMaterial}>
        <ringGeometry args={[horizonRadius * 1.5, size * 2.0, 96, 1]} />
      </mesh>
      {/* 引力透镜（爱因斯坦环 + 弧状扭曲，面向相机） */}
      <mesh ref={lensRef} material={lensMaterial}>
        <planeGeometry args={[size * 3.6, size * 3.6]} />
      </mesh>
      <BodyLabel body={body} sizeUnits={size} />
    </group>
  );
}

/**
 * 发射星云（猎户座星云）：氢α粉红雾状层 + 内部年轻恒星点亮局部
 */
function EmissionNebula({ body }: BodyProps): JSX.Element {
  const groupRef = useRef<THREE.Group>(null);
  const selectBody = useSimulationStore((s) => s.selectBody);
  const size = body.visualRadiusLy * SCENE_UNITS_PER_LY;

  const textures = useMemo(
    () => ({
      pink: new THREE.CanvasTexture(createGlowSpriteCanvas(body.color, 128)),
      star: new THREE.CanvasTexture(createGlowSpriteCanvas('#eef6ff', 64)),
    }),
    [body.color],
  );
  useEffect(
    () => () => {
      textures.pink.dispose();
      textures.star.dispose();
    },
    [textures],
  );

  // 内部年轻恒星（确定性位置）
  const youngStars = useMemo(() => {
    const rand = createSeededRandom(42);
    return Array.from({ length: 5 }, () => ({
      x: (rand() - 0.5) * size * 0.9,
      y: (rand() - 0.5) * size * 0.5,
      z: (rand() - 0.5) * size * 0.9,
    }));
  }, [size]);

  useGalacticPlacement(body, groupRef);
  useFrame(() => {
    const group = groupRef.current;
    if (!group || !group.visible) return;
    const weight = specialFadeWeight(useSimulationStore.getState().continuousLevel);
    group.traverse((obj) => {
      if (obj instanceof THREE.Sprite) {
        obj.material.opacity = (obj.userData.baseOpacity as number) * weight;
      }
    });
  });

  return (
    <group ref={groupRef} name={body.id}>
      {/* 雾状气体层（多层叠加体积感） */}
      {[
        { scale: 2.8, opacity: 0.35 },
        { scale: 1.9, opacity: 0.45 },
        { scale: 1.1, opacity: 0.5 },
      ].map((layer, i) => (
        <sprite
          key={i}
          scale={[size * layer.scale, size * layer.scale * 0.8, 1]}
          userData={{ baseOpacity: layer.opacity }}
          onClick={(e) => {
            e.stopPropagation();
            selectBody(body.id);
          }}
        >
          <spriteMaterial
            map={textures.pink}
            transparent
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </sprite>
      ))}
      {/* 内部年轻恒星（点亮局部） */}
      {youngStars.map((p, i) => (
        <sprite key={i} position={[p.x, p.y, p.z]} scale={[size * 0.3, size * 0.3, 1]} userData={{ baseOpacity: 0.9 }}>
          <spriteMaterial
            map={textures.star}
            transparent
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </sprite>
      ))}
      <BodyLabel body={body} sizeUnits={size} />
    </group>
  );
}

/**
 * 行星状星云（环状星云 M57）：环壳结构 + 中心白矮星 + 缓慢膨胀动画
 */
function PlanetaryNebula({ body }: BodyProps): JSX.Element {
  const groupRef = useRef<THREE.Group>(null);
  const shellRef = useRef<THREE.Mesh>(null);
  const selectBody = useSimulationStore((s) => s.selectBody);
  const size = body.visualRadiusLy * SCENE_UNITS_PER_LY;

  useGalacticPlacement(body, groupRef);
  useFrame(({ clock }) => {
    const group = groupRef.current;
    if (!group || !group.visible) return;
    const weight = specialFadeWeight(useSimulationStore.getState().continuousLevel);
    if (shellRef.current) {
      // 缓慢膨胀（真实约 20–30 km/s，动画为艺术化加速，已登记）
      shellRef.current.scale.setScalar(nebulaExpansionScale(clock.elapsedTime, 75, 0.12));
      (shellRef.current.material as THREE.MeshBasicMaterial).opacity = 0.4 * weight;
    }
  });

  return (
    <group ref={groupRef} name={body.id}>
      {/* 环壳（环面示意抛射气体壳层） */}
      <mesh
        ref={shellRef}
        rotation={[Math.PI / 3, 0.4, 0]}
        onClick={(e) => {
          e.stopPropagation();
          selectBody(body.id);
        }}
      >
        <torusGeometry args={[size, size * 0.34, 12, 48]} />
        <meshBasicMaterial
          color={body.color}
          transparent
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
      {/* 中心白矮星 */}
      <mesh>
        <sphereGeometry args={[size * 0.07, 12, 12]} />
        <meshBasicMaterial color="#ffffff" />
      </mesh>
      <BodyLabel body={body} sizeUnits={size} />
    </group>
  );
}

/**
 * 球状星团（M13）：银晕中的致密老年恒星集团（偏红黄色调）
 */
function GlobularCluster({ body }: BodyProps): JSX.Element {
  const groupRef = useRef<THREE.Group>(null);
  const selectBody = useSimulationStore((s) => s.selectBody);
  const size = body.visualRadiusLy * SCENE_UNITS_PER_LY;

  const { geometry, material } = useMemo(() => {
    const rand = createSeededRandom(20260722);
    const count = 420;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) {
      // 中心致密的球状分布（半径取 rand² 使中心更密）
      const r = size * rand() * rand();
      const cosPolar = rand() * 2 - 1;
      const azimuth = Math.PI * 2 * rand();
      const sinPolar = Math.sqrt(1 - cosPolar * cosPolar);
      positions[i * 3] = r * sinPolar * Math.cos(azimuth);
      positions[i * 3 + 1] = r * cosPolar;
      positions[i * 3 + 2] = r * sinPolar * Math.sin(azimuth);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: body.color,
      size: size * 0.06,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    return { geometry: geo, material: mat };
  }, [size, body.color]);

  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  useGalacticPlacement(body, groupRef);
  useFrame(() => {
    const group = groupRef.current;
    if (!group || !group.visible) return;
    const weight = specialFadeWeight(useSimulationStore.getState().continuousLevel);
    material.opacity = 0.9 * weight;
  });

  return (
    <group ref={groupRef} name={body.id}>
      <points geometry={geometry} material={material} />
      {/* 点选热区（透明球） */}
      <mesh
        onClick={(e) => {
          e.stopPropagation();
          selectBody(body.id);
        }}
      >
        <sphereGeometry args={[size * 0.6, 12, 12]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      <BodyLabel body={body} sizeUnits={size} />
    </group>
  );
}

/**
 * L3 特殊天体总装（需求 3.1.5）：渲染于 Galaxy 组内（银心系本地坐标），
 * 随银河系组变换保持与旋臂/太阳系位置一致（嵌套一致性 3.1.4）。
 */
export function SpecialBodies(): JSX.Element {
  const bodies = SPECIAL_BODIES.filter((b) => b.level === 'L3');
  return (
    <group name="special-bodies">
      {bodies.map((body) => {
        switch (body.kind) {
          case 'red-giant':
            return <RedGiant key={body.id} body={body} />;
          case 'blue-giant':
            return <BlueGiant key={body.id} body={body} />;
          case 'binary-white-dwarf':
            return <SiriusBinary key={body.id} body={body} />;
          case 'pulsar-remnant':
            return <PulsarRemnant key={body.id} body={body} />;
          case 'black-hole':
            return <BlackHole key={body.id} body={body} />;
          case 'emission-nebula':
            return <EmissionNebula key={body.id} body={body} />;
          case 'planetary-nebula':
            return <PlanetaryNebula key={body.id} body={body} />;
          case 'globular-cluster':
            return <GlobularCluster key={body.id} body={body} />;
          case 'wolf-rayet':
            return <WolfRayet key={body.id} body={body} />;
          case 'cepheid':
            return <Cepheid key={body.id} body={body} />;
          case 'open-cluster':
            return <OpenCluster key={body.id} body={body} />;
          case 'dark-nebula':
            return <DarkNebula key={body.id} body={body} />;
          default:
            return null;
        }
      })}
    </group>
  );
}
