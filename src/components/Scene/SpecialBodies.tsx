"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import type { SpecialBodyData } from "@/types";
import {
  PULSAR_VISUAL_SPIN_PERIOD_SEC,
  SIRIUS_MASS_RATIO,
  SIRIUS_VISUAL_ORBIT_PERIOD_SEC,
  SPECIAL_BODIES,
} from "@/data/specialBodies";
import { useSimulationStore } from "@/store";
import { SCENE_UNITS_PER_LY, trapezoidWeight } from "@/utils/scale";
import { setObjectTreeRaycastEnabled } from "@/utils/raycastGate";
import { advanceFrameTransition } from "@/utils/galacticFrame";
import { verticalVisualGain } from "@/utils/galacticMotionCues";
import { sunGalacticPositionLy } from "@/utils/galaxy";
import { createSeededRandom } from "@/utils/random";
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
} from "@/utils/specialBodies";
import {
  createDiffractionSpikeCanvas,
  createGlowSpriteCanvas,
} from "@/components/CelestialBody/proceduralTextures";
import { getSoftPointTexture } from "@/components/CelestialBody/sharedTextures";
import { getNebulaTexture } from "@/components/CelestialBody/nebulaTextures";
import { stellarSphereSegments } from "@/utils/stellarSurface";

/**
 * 特殊天体 LOD 淡入淡出（需求 3.1.5 通用要求）：
 * L3 完整可见，进入 L4 前淡出（恒星级天体在 L4 不可见，如脉冲星）。
 * 淡入起点 2.5 与 L2/L3 离散边界一致（discreteLevelFromContinuous）：
 * HUD 显示"太阳系视角"期间银河系层内容完全不可见、不可点击。
 */
const SPECIAL_FADE = { x0: 2.5, x1: 2.9, x2: 3.4, x3: 4.0 } as const;

/** 可交互阈值：淡入权重低于该值时禁用 raycast（隐形对象不拦截点击） */
const INTERACTIVE_WEIGHT = 0.05;

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

/**
 * 恒星表面 shader（P6 §3.2）：对流颗粒 fBm（缓慢演化）+ 边缘昏暗（limb
 * darkening）+ 色温梯度（边缘偏暗红）。GLSL 与 utils/stellarSurface.ts 纯函数
 * 镜像一致（valueNoise/limbDarkening/色温梯度公式），单测覆盖 CPU 侧。
 *
 * 视觉夸大登记：对流演化速率加速、色温梯度为简化 RGB 近似（见 stellarSurface 文件头）。
 * 门控：仅 L3 可见时推进 uTime（uniform），L1/L2/L4 零开销。
 */
interface StellarSurfaceProps {
  radius: number;
  segments: number;
  color: string;
  /** 边缘昏暗系数（红巨星大、蓝巨星小） */
  limbU: number;
  /** 对流胞尺度（红巨星小 → 大胞；蓝巨星大 → 细） */
  cellScale: number;
  /** 对流对比强度 ∈ [0,1] */
  convection: number;
  /** 色温梯度边缘偏红强度 ∈ [0,1] */
  rednessStrength: number;
  /** 读取本帧有效可见权重（由 useGalacticPlacement 提供，含聚焦提升） */
  getWeight: () => number;
  onClick?: (e: { stopPropagation: () => void }) => void;
}

function StellarSurface({
  radius,
  segments,
  color,
  limbU,
  cellScale,
  convection,
  rednessStrength,
  getWeight,
  onClick,
}: StellarSurfaceProps): JSX.Element {
  const meshRef = useRef<THREE.Mesh>(null);
  const material = useMemo(() => {
    const c = new THREE.Color(color);
    return new THREE.ShaderMaterial({
      transparent: true,
      uniforms: {
        uTime: { value: 0 },
        uOpacity: { value: 1 },
        uColor: { value: new THREE.Vector3(c.r, c.g, c.b) },
        uLimbU: { value: limbU },
        uCellScale: { value: cellScale },
        uConvection: { value: convection },
        uRedness: { value: rednessStrength },
      },
      vertexShader: /* glsl */ `
        varying vec3 vNormal;
        varying vec3 vViewDir;
        varying vec3 vObjPos;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          vObjPos = normalize(position);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vViewDir = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform float uOpacity;
        uniform vec3 uColor;
        uniform float uLimbU;
        uniform float uCellScale;
        uniform float uConvection;
        uniform float uRedness;
        varying vec3 vNormal;
        varying vec3 vViewDir;
        varying vec3 vObjPos;

        // 与 utils/stellarSurface.ts hash3/valueNoise3D/convectionFbm3 镜像一致。
        // 3D 噪声直接以单位球面坐标采样（P6 自查修复）：原 2D 球面参数化
        // （atan 经度展开）在 ±180° 经线处不连续，恒星表面出现垂直接缝
        float hash3(vec3 p) {
          return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
        }
        float smooth01(float t) { t = clamp(t, 0.0, 1.0); return t*t*(3.0-2.0*t); }
        float valueNoise3(vec3 p) {
          vec3 i = floor(p);
          vec3 f = p - i;
          vec3 t = vec3(smooth01(f.x), smooth01(f.y), smooth01(f.z));
          float v000 = hash3(i);
          float v100 = hash3(i + vec3(1.0, 0.0, 0.0));
          float v010 = hash3(i + vec3(0.0, 1.0, 0.0));
          float v110 = hash3(i + vec3(1.0, 1.0, 0.0));
          float v001 = hash3(i + vec3(0.0, 0.0, 1.0));
          float v101 = hash3(i + vec3(1.0, 0.0, 1.0));
          float v011 = hash3(i + vec3(0.0, 1.0, 1.0));
          float v111 = hash3(i + vec3(1.0, 1.0, 1.0));
          float a = mix(mix(v000, v100, t.x), mix(v010, v110, t.x), t.y);
          float b = mix(mix(v001, v101, t.x), mix(v011, v111, t.x), t.y);
          return mix(a, b, t.z);
        }
        float fbm3(vec3 p, float t) {
          float sum = 0.0; float amp = 1.0; float total = 0.0; float freq = uCellScale;
          for (int o = 0; o < 4; o++) {
            float drift = t * (0.05 + float(o) * 0.02);
            sum += valueNoise3(p * freq + vec3(drift, -drift, drift * 0.7)) * amp;
            total += amp; amp *= 0.5; freq *= 2.0;
          }
          return sum / total;
        }

        void main() {
          // 单位球面坐标直接采样 3D 噪声（无经度接缝、无极点收缩）
          float cells = fbm3(vObjPos * 1.5, uTime);
          // 边缘昏暗 μ = N·V
          float mu = clamp(dot(normalize(vNormal), normalize(vViewDir)), 0.0, 1.0);
          float limb = 1.0 - uLimbU * (1.0 - mu);
          // 对流亮度调制
          float bright = limb * (1.0 - uConvection * 0.5 + uConvection * cells);
          // 色温梯度：边缘偏暗红
          float edge = pow(1.0 - mu, 1.5) * uRedness;
          vec3 col = uColor * vec3(1.0 - 0.15*edge, 1.0 - 0.55*edge, 1.0 - 0.75*edge);
          gl_FragColor = vec4(col * bright, uOpacity);
        }
      `,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [color, limbU, cellScale, convection, rednessStrength]);

  useEffect(() => () => material.dispose(), [material]);

  useFrame(({ clock }) => {
    const group = meshRef.current;
    if (!group) return;
    const weight = getWeight();
    // 门控：不可见时跳过 uniform 更新（L1/L2/L4 零开销）
    if (weight <= 0.001) return;
    material.uniforms.uTime.value = clock.elapsedTime;
    material.uniforms.uOpacity.value = weight;
  });

  return (
    <mesh ref={meshRef} material={material} onClick={onClick}>
      <sphereGeometry args={[radius, segments, segments]} />
    </mesh>
  );
}

/** 聚焦权重提升过渡时长（秒）：跟随开始/结束时淡入淡出，避免可见性突变 */
const FOCUS_BOOST_SECONDS = 0.5;

/**
 * 共用：把 sun-relative / galactic-center 天体定位到银心系本地坐标（场景单位）
 *
 * @returns 读取本帧有效可见权重的函数（层级淡入权重与聚焦提升取最大值）。
 *   聚焦提升（bug 修复）：特殊天体距场景原点仅 150–400 单位，飞往/跟随后
 *   相机距原点落入 L2 连续层级区间，按层级门控（2.5 以下淡出）目标会完全
 *   不可见——"飞过去却看不到"。跟随/飞往本天体期间权重提升至 1（0.5 秒
 *   平滑），取消跟随后恢复层级门控；常规 L2 游览（无跟随）行为不变。
 */
function useGalacticPlacement(
  body: SpecialBodyData,
  groupRef: React.RefObject<THREE.Group>,
): () => number {
  const weightRef = useRef(0);
  const boostRef = useRef(0);
  const getWeight = useCallback(() => weightRef.current, []);
  // 挂载即按当前层级门控（消除首帧 visible/raycast 默认开启的竞态）
  useEffect(() => {
    const group = groupRef.current;
    if (!group) return;
    const initialWeight = specialFadeWeight(
      useSimulationStore.getState().continuousLevel,
    );
    weightRef.current = initialWeight;
    group.visible = initialWeight > 0.001;
    setObjectTreeRaycastEnabled(group, initialWeight > INTERACTIVE_WEIGHT);
  }, [groupRef]);
  useFrame((_, delta) => {
    const group = groupRef.current;
    if (!group) return;
    const state = useSimulationStore.getState();
    const focused =
      state.followBodyId === body.id || state.flyToBodyId === body.id;
    boostRef.current = advanceFrameTransition(
      boostRef.current,
      focused ? 1 : 0,
      delta,
      FOCUS_BOOST_SECONDS,
    );
    const weight = Math.max(
      specialFadeWeight(state.continuousLevel),
      boostRef.current,
    );
    weightRef.current = weight;
    group.visible = weight > 0.001;
    // three.js Raycaster 不检查 visible：淡出后必须显式禁用 raycast，
    // 否则太阳系视角下隐形的星云/星团热区仍会拦截点击（bug 修复）
    setObjectTreeRaycastEnabled(group, weight > INTERACTIVE_WEIGHT);
    if (!group.visible) return;
    if (body.positionMode === "galactic-center") {
      group.position.set(0, 0, 0);
      return;
    }
    const offset = body.offsetLy;
    if (!offset) return;
    // 随太阳共转（近似处理已登记）：位置 = 太阳银心系位置 + 固定偏移。
    // 太阳 y 分量乘垂直视觉增益，与 Galaxy 组偏移一致（P6 自查修复）：
    // 否则跟随模式下组偏移按增益后 y 平移、此处按原始 y 定位，特殊天体
    // 会相对太阳系产生 ±(gain−1)·300 ly 的垂直振荡漂移
    const sun = sunGalacticPositionLy(state.simDays);
    const gain = verticalVisualGain(state.realScaleMode);
    group.position.set(
      (sun.x + offset.x) * SCENE_UNITS_PER_LY,
      (sun.y * gain + offset.y) * SCENE_UNITS_PER_LY,
      (sun.z + offset.z) * SCENE_UNITS_PER_LY,
    );
  });
  return getWeight;
}

/** 共用：标签 */
function BodyLabel({
  body,
  sizeUnits,
}: {
  body: SpecialBodyData;
  sizeUnits: number;
}): JSX.Element | null {
  const showLabels = useSimulationStore((s) => s.showLabels);
  const inRange = useSimulationStore(
    (s) => s.continuousLevel > 2.5 && s.continuousLevel < 3.9,
  );
  if (!showLabels || !inRange) return null;
  return (
    <Html
      position={[0, sizeUnits * 1.3, 0]}
      center
      distanceFactor={2600}
      style={{ pointerEvents: "none" }}
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
  const coreRef = useRef<THREE.Group>(null);
  const glowRef = useRef<THREE.Sprite>(null);
  const selectBody = useSimulationStore((s) => s.selectBody);
  const size = body.visualRadiusLy * SCENE_UNITS_PER_LY;
  const segments = stellarSphereSegments(size);

  const glowTexture = useMemo(
    () => new THREE.CanvasTexture(createGlowSpriteCanvas(body.color, 128)),
    [body.color],
  );
  useEffect(() => () => glowTexture.dispose(), [glowTexture]);

  const getWeight = useGalacticPlacement(body, groupRef);
  useFrame(({ clock }) => {
    const group = groupRef.current;
    if (!group || !group.visible) return;
    const weight = getWeight();
    const { scale, brightness } = redGiantPulsation(clock.elapsedTime);
    if (coreRef.current) {
      coreRef.current.scale.setScalar(scale);
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
      {/* 恒星表面（对流颗粒 + 边缘昏暗 + 色温梯度，P6 §3.2）；
          红巨星：大对流胞（cellScale 小）、强边缘昏暗、显著边缘偏红 */}
      <group ref={coreRef}>
        <StellarSurface
          getWeight={getWeight}
          radius={size}
          segments={segments}
          color={body.color}
          limbU={0.75}
          cellScale={2.2}
          convection={0.7}
          rednessStrength={0.6}
          onClick={(e) => {
            e.stopPropagation();
            selectBody(body.id);
          }}
        />
      </group>
      {/* 外层弥散气体壳（分段 32：近观轮廓无棱角，与恒星表面标准一致） */}
      <mesh>
        <sphereGeometry args={[size * 1.5, 32, 32]} />
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
  /** 读取本帧有效可见权重（由 useGalacticPlacement 提供，含聚焦提升） */
  getWeight: () => number;
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
  getWeight,
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
    geo.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(count * 3), 3),
    );
    geo.setAttribute(
      "color",
      new THREE.BufferAttribute(new Float32Array(count * 3), 3),
    );
    geo.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(0, 0, 0),
      sizeUnits * maxRadiusFactor * 1.2,
    );
    const mat = new THREE.PointsMaterial({
      size: sizeUnits * 0.14,
      map: getSoftPointTexture(),
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    const c = new THREE.Color(color);
    return {
      geometry: geo,
      material: mat,
      directions: dirs,
      seeds: seedArr,
      baseColor: c,
    };
  }, [sizeUnits, color, count, maxRadiusFactor, seed]);

  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  useFrame(({ clock }) => {
    const weight = getWeight();
    const pos = geometry.attributes.position as THREE.BufferAttribute;
    const col = geometry.attributes.color as THREE.BufferAttribute;
    for (let i = 0; i < seeds.length; i += 1) {
      const phase = stellarWindPhase01(clock.elapsedTime, seeds[i], cycleSec);
      const r = sizeUnits * (1 + phase * (maxRadiusFactor - 1));
      pos.setXYZ(
        i,
        directions[i * 3] * r,
        directions[i * 3 + 1] * r,
        directions[i * 3 + 2] * r,
      );
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

  const getWeight = useGalacticPlacement(body, groupRef);
  useFrame(({ clock }) => {
    const group = groupRef.current;
    if (!group || !group.visible) return;
    const weight = getWeight();
    if (glowRef.current) {
      (glowRef.current.material as THREE.SpriteMaterial).opacity =
        0.8 * blueGiantFlicker(clock.elapsedTime) * weight;
    }
  });

  return (
    <group ref={groupRef} name={body.id}>
      {/* 蓝巨星表面：细对流颗粒、弱边缘昏暗、无边缘偏红（高温） */}
      <StellarSurface
        getWeight={getWeight}
        radius={size}
        segments={stellarSphereSegments(size)}
        color="#cfe0ff"
        limbU={0.3}
        cellScale={9}
        convection={0.35}
        rednessStrength={0}
        onClick={(e) => {
          e.stopPropagation();
          selectBody(body.id);
        }}
      />
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
        getWeight={getWeight}
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

  const getWeight = useGalacticPlacement(body, groupRef);
  useFrame(({ clock }) => {
    const group = groupRef.current;
    if (!group || !group.visible) return;
    const weight = getWeight();
    if (glowRef.current) {
      (glowRef.current.material as THREE.SpriteMaterial).opacity =
        0.85 * blueGiantFlicker(clock.elapsedTime * 1.4) * weight;
    }
    if (shellRef.current) {
      // M1-67 抛射星云壳：缓慢膨胀（艺术化加速，已登记）
      shellRef.current.scale.setScalar(
        nebulaExpansionScale(clock.elapsedTime, 80, 0.14),
      );
      (shellRef.current.material as THREE.MeshBasicMaterial).opacity =
        0.14 * weight;
    }
  });

  return (
    <group ref={groupRef} name={body.id}>
      {/* 炽热核心（约 44,000 K，蓝白色）：极细对流颗粒 + 强湍流 */}
      <StellarSurface
        getWeight={getWeight}
        radius={size * 0.6}
        segments={stellarSphereSegments(size * 0.6)}
        color="#e8f0ff"
        limbU={0.25}
        cellScale={12}
        convection={0.45}
        rednessStrength={0}
        onClick={(e) => {
          e.stopPropagation();
          selectBody(body.id);
        }}
      />
      <sprite ref={glowRef} scale={[size * 4, size * 4, 1]}>
        <spriteMaterial
          map={glowTexture}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </sprite>
      {/* M1-67 抛射星云壳（分段 32：近观轮廓无棱角） */}
      <mesh ref={shellRef}>
        <sphereGeometry args={[size * 1.9, 32, 32]} />
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
        getWeight={getWeight}
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
  const coreRef = useRef<THREE.Group>(null);
  const glowRef = useRef<THREE.Sprite>(null);
  const selectBody = useSimulationStore((s) => s.selectBody);
  const size = body.visualRadiusLy * SCENE_UNITS_PER_LY;

  const glowTexture = useMemo(
    () => new THREE.CanvasTexture(createGlowSpriteCanvas(body.color, 128)),
    [body.color],
  );
  useEffect(() => () => glowTexture.dispose(), [glowTexture]);

  const getWeight = useGalacticPlacement(body, groupRef);
  useFrame(({ clock }) => {
    const group = groupRef.current;
    if (!group || !group.visible) return;
    const weight = getWeight();
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
      {/* 造父变星表面：中等对流颗粒（黄超巨星） */}
      <group ref={coreRef}>
        <StellarSurface
          getWeight={getWeight}
          radius={size * 0.5}
          segments={stellarSphereSegments(size * 0.5)}
          color={body.color}
          limbU={0.55}
          cellScale={5}
          convection={0.5}
          rednessStrength={0.3}
          onClick={(e) => {
            e.stopPropagation();
            selectBody(body.id);
          }}
        />
      </group>
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

  // 昴星团蓝色反射星云：不规则云状 + 丝缕感（包裹亮星，P6 §3.2）
  const nebulaTexture = useMemo(
    () =>
      getNebulaTexture({
        size: 256,
        seed: 45,
        innerColor: "#bcd4ff",
        outerColor: "#5a78c8",
        filamentStrength: 0.6,
        irregularity: 0.75,
        octaves: 5,
        shape: "cloud",
      }),
    [],
  );
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
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.PointsMaterial({
      size: size * 0.09,
      map: getSoftPointTexture(),
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

  const getWeight = useGalacticPlacement(body, groupRef);
  useFrame(({ clock }) => {
    const group = groupRef.current;
    if (!group || !group.visible) return;
    const weight = getWeight();
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

  // 背景 IC 434 红光（发射星云不规则云）+ 前景暗云柱剪影（噪声侵蚀边缘）
  const emissionTexture = useMemo(
    () =>
      getNebulaTexture({
        size: 256,
        seed: 434,
        innerColor: "#ff8898",
        outerColor: "#a03848",
        filamentStrength: 0.5,
        irregularity: 0.6,
        octaves: 5,
        shape: "cloud",
      }),
    [],
  );
  const darkTexture = useMemo(
    () =>
      getNebulaTexture({
        size: 256,
        seed: 4340,
        innerColor: "#0a0608",
        outerColor: "#050308",
        filamentStrength: 0.7,
        irregularity: 0.85,
        octaves: 5,
        shape: "cloud",
      }),
    [],
  );

  const getWeight = useGalacticPlacement(body, groupRef);
  useFrame(() => {
    const group = groupRef.current;
    if (!group || !group.visible) return;
    const weight = getWeight();
    group.traverse((obj) => {
      const base = obj.userData.baseOpacity as number | undefined;
      if (base === undefined) return;
      if (obj instanceof THREE.Sprite) {
        obj.material.opacity = base * weight;
      } else if (obj instanceof THREE.Mesh) {
        (obj.material as THREE.Material & { opacity: number }).opacity =
          base * weight;
      }
    });
  });

  // 暗云柱剪影块（前景，普通混合遮光）：垂直"颈部" + 顶部"头部"偏移
  const silhouette = [
    { x: 0, y: -size * 0.25, scale: 0.7, opacity: 0.92 },
    { x: 0, y: size * 0.12, scale: 0.5, opacity: 0.95 },
    { x: size * 0.2, y: size * 0.36, scale: 0.36, opacity: 0.95 },
  ];

  return (
    <group ref={groupRef} name={body.id}>
      {/* 背景发射星云 IC 434（氢α红光不规则云，加色混合） */}
      <mesh
        position={[0, 0, -size * 0.5]}
        userData={{ baseOpacity: 0.45 }}
        onClick={(e) => {
          e.stopPropagation();
          selectBody(body.id);
        }}
      >
        <planeGeometry args={[size * 3.0, size * 2.4]} />
        <meshBasicMaterial
          map={emissionTexture}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          side={THREE.DoubleSide}
        />
      </mesh>
      {/* 前景暗分子云柱剪影（噪声侵蚀边缘的暗云形态，普通混合遮挡背景红光） */}
      {silhouette.map((s, i) => (
        <mesh
          key={i}
          position={[s.x, s.y, size * 0.3]}
          userData={{ baseOpacity: s.opacity }}
          renderOrder={10}
        >
          <planeGeometry args={[size * s.scale, size * s.scale * 1.4]} />
          <meshBasicMaterial
            map={darkTexture}
            transparent
            depthWrite={false}
            blending={THREE.NormalBlending}
            side={THREE.DoubleSide}
          />
        </mesh>
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
    () => new THREE.CanvasTexture(createGlowSpriteCanvas("#eef4ff", 128)),
    [],
  );
  // 白矮星衍射芒线（P6 §3.2）：致密高亮点星的观测质感
  const spikeTexture = useMemo(
    () => new THREE.CanvasTexture(createDiffractionSpikeCanvas("#eaf0ff", 128)),
    [],
  );
  useEffect(() => () => glowTexture.dispose(), [glowTexture]);
  useEffect(() => () => spikeTexture.dispose(), [spikeTexture]);

  useGalacticPlacement(body, groupRef);
  useFrame(({ clock }) => {
    const group = groupRef.current;
    if (!group || !group.visible) return;
    const phase =
      (Math.PI * 2 * clock.elapsedTime) / SIRIUS_VISUAL_ORBIT_PERIOD_SEC;
    const { primary, secondary } = binaryStarPositions(
      separation,
      SIRIUS_MASS_RATIO,
      phase,
    );
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
      {/* 天狼星B：白矮星（极小、白蓝色致密高亮点 + 衍射芒线，高密度在信息面板强调） */}
      <group ref={secondaryRef}>
        <mesh
          onClick={(e) => {
            e.stopPropagation();
            selectBody(body.id);
          }}
        >
          <sphereGeometry args={[size * 0.1, 20, 20]} />
          <meshBasicMaterial color="#eaf2ff" />
        </mesh>
        <sprite scale={[size * 1.6, size * 1.6, 1]}>
          <spriteMaterial
            map={spikeTexture}
            transparent
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            opacity={0.9}
          />
        </sprite>
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

  // 蟹状星云：丝状遗迹壳（红色氢丝网络，与超新星遗迹共用生成路径，P6 §3.2）
  const nebulaTexture = useMemo(
    () =>
      getNebulaTexture({
        size: 256,
        seed: 1054, // 蟹状星云 SN 1054
        innerColor: "#ffdca0",
        outerColor: "#ff5545",
        filamentStrength: 0.85,
        irregularity: 0.55,
        octaves: 5,
        shape: "shell",
      }),
    [],
  );
  const flashTexture = useMemo(
    () => new THREE.CanvasTexture(createGlowSpriteCanvas("#dff2ff", 128)),
    [],
  );
  useEffect(() => () => flashTexture.dispose(), [flashTexture]);

  // 射束 shader（P6 §3.2）：径向渐变（轴心亮边缘淡）+ 沿轴噪声扰动，
  // 替换纯色 cone。锥体侧面 uv.y 为沿轴归一化坐标、uv.x 为环向
  const beamMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        uniforms: { uTime: { value: 0 }, uOpacity: { value: 0.5 } },
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
          float hash(float x){ return fract(sin(x*127.1)*43758.5453); }
          void main() {
            // 沿轴：根部（uv.y≈0）亮，尖端淡出
            float axial = smoothstep(1.0, 0.0, vUv.y);
            // 环向径向渐变：中心线亮、边缘淡
            float radial = 1.0 - abs(vUv.x - 0.5) * 2.0;
            radial = pow(clamp(radial, 0.0, 1.0), 1.5);
            // 噪声扰动（沿轴流动的等离子体团块）
            float n = hash(floor(vUv.y * 12.0) + floor(uTime * 3.0));
            float flow = 0.7 + 0.3 * n;
            vec3 col = vec3(0.75, 0.9, 1.0);
            float a = axial * radial * flow * uOpacity;
            gl_FragColor = vec4(col, a);
          }
        `,
      }),
    [],
  );
  useEffect(() => () => beamMaterial.dispose(), [beamMaterial]);

  const getWeight = useGalacticPlacement(body, groupRef);
  useFrame(({ clock }) => {
    const group = groupRef.current;
    if (!group || !group.visible) return;
    const weight = getWeight();
    const t = clock.elapsedTime;
    beamMaterial.uniforms.uTime.value = t;
    beamMaterial.uniforms.uOpacity.value = 0.5 * weight;
    // 射束旋转扫描（可视化降频周期，已登记）
    if (beamsRef.current) {
      beamsRef.current.rotation.y = pulsarBeamAngle(
        t,
        PULSAR_VISUAL_SPIN_PERIOD_SEC,
      );
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
      (nebulaRef.current.material as THREE.SpriteMaterial).opacity =
        0.4 * weight;
    }
  });

  return (
    <group ref={groupRef} name={body.id}>
      {/* 超新星遗迹：丝状膨胀星云（蟹状星云红色氢丝网络） */}
      <sprite ref={nebulaRef}>
        <spriteMaterial
          map={nebulaTexture}
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
            <mesh
              key={dir}
              position={[0, dir * size * 0.9, 0]}
              rotation={[dir < 0 ? Math.PI : 0, 0, 0]}
              material={beamMaterial}
            >
              <coneGeometry args={[size * 0.22, size * 1.8, 20, 1, true]} />
            </mesh>
          ))}
        </group>
      </group>
      {/* 脉冲闪烁（射束扫过视线时增亮） */}
      <sprite ref={flashRef} scale={[size * 1.8, size * 1.8, 1]}>
        <spriteMaterial
          map={flashTexture}
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

  const getWeight = useGalacticPlacement(body, groupRef);
  useFrame(({ clock, camera }) => {
    const group = groupRef.current;
    if (!group || !group.visible) return;
    const weight = getWeight();
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

  // 星点贴图（内部年轻恒星）；星云云层用程序化多层不规则纹理（P6 §3.2）
  const starTexture = useMemo(
    () => new THREE.CanvasTexture(createGlowSpriteCanvas("#eef6ff", 64)),
    [],
  );
  useEffect(() => () => starTexture.dispose(), [starTexture]);

  // 猎户座多层不规则云状纹理（3 层不同噪声种子，形成视差与不规则形态）
  const cloudLayers = useMemo(
    () => [
      getNebulaTexture({
        size: 256,
        seed: 4201,
        innerColor: "#ff9bb5",
        outerColor: "#7a4a8a",
        filamentStrength: 0.55,
        irregularity: 0.7,
        octaves: 5,
        shape: "cloud",
      }),
      getNebulaTexture({
        size: 256,
        seed: 4202,
        innerColor: "#ffd0b0",
        outerColor: "#a05070",
        filamentStrength: 0.65,
        irregularity: 0.8,
        octaves: 5,
        shape: "cloud",
      }),
      getNebulaTexture({
        size: 256,
        seed: 4203,
        innerColor: "#c8d8ff",
        outerColor: "#5a3a7a",
        filamentStrength: 0.5,
        irregularity: 0.85,
        octaves: 4,
        shape: "cloud",
      }),
    ],
    [],
  );

  // 内部年轻恒星（确定性位置）；含中心四边形聚星（Trapezium）示意
  const youngStars = useMemo(() => {
    const rand = createSeededRandom(42);
    const scattered = Array.from({ length: 5 }, () => ({
      x: (rand() - 0.5) * size * 0.9,
      y: (rand() - 0.5) * size * 0.5,
      z: (rand() - 0.5) * size * 0.9,
      s: 0.3,
    }));
    // Trapezium 四边形聚星（中心紧密四星，形态参考哈勃影像）
    const trap = [
      { x: -size * 0.06, y: size * 0.05, z: 0, s: 0.22 },
      { x: size * 0.07, y: size * 0.04, z: 0, s: 0.2 },
      { x: -size * 0.02, y: -size * 0.06, z: 0, s: 0.24 },
      { x: size * 0.05, y: -size * 0.03, z: 0, s: 0.18 },
    ];
    return [...scattered, ...trap];
  }, [size]);

  const getWeight = useGalacticPlacement(body, groupRef);
  useFrame(() => {
    const group = groupRef.current;
    if (!group || !group.visible) return;
    const weight = getWeight();
    group.traverse((obj) => {
      const base = obj.userData.baseOpacity as number | undefined;
      if (base === undefined) return;
      if (obj instanceof THREE.Sprite) {
        obj.material.opacity = base * weight;
      } else if (obj instanceof THREE.Mesh) {
        (obj.material as THREE.Material & { opacity: number }).opacity =
          base * weight;
      }
    });
  });

  return (
    <group ref={groupRef} name={body.id}>
      {/* 多层不规则云状气体（程序化 fBm/域扭曲纹理，替换同心圆光斑）：
          不同种子 + 不同缩放/旋转形成视差与不规则形态（P6 §3.2） */}
      {[
        { scale: 2.9, opacity: 0.4, rot: 0.2 },
        { scale: 2.0, opacity: 0.5, rot: -0.6 },
        { scale: 1.3, opacity: 0.55, rot: 1.1 },
      ].map((layer, i) => (
        <mesh
          key={i}
          rotation={[0, 0, layer.rot]}
          userData={{ baseOpacity: layer.opacity }}
          onClick={(e) => {
            e.stopPropagation();
            selectBody(body.id);
          }}
        >
          <planeGeometry
            args={[size * layer.scale, size * layer.scale * 0.85]}
          />
          <meshBasicMaterial
            map={cloudLayers[i]}
            transparent
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            side={THREE.DoubleSide}
          />
        </mesh>
      ))}
      {/* 内部年轻恒星 + Trapezium 聚星（点亮局部） */}
      {youngStars.map((p, i) => (
        <sprite
          key={i}
          position={[p.x, p.y, p.z]}
          scale={[size * p.s, size * p.s, 1]}
          userData={{ baseOpacity: 0.9 }}
        >
          <spriteMaterial
            map={starTexture}
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

  // 环状星云 M57：环壳纹理（内缘 OIII 蓝绿 / 外缘 Hα 红的真实色层，P6 §3.2）
  const ringTexture = useMemo(
    () =>
      getNebulaTexture({
        size: 256,
        seed: 57,
        innerColor: "#7fffcf", // 内缘 OIII 蓝绿
        outerColor: "#ff5a55", // 外缘 Hα 红
        filamentStrength: 0.5,
        irregularity: 0.4,
        octaves: 5,
        shape: "ring",
      }),
    [],
  );

  const getWeight = useGalacticPlacement(body, groupRef);
  useFrame(({ clock }) => {
    const group = groupRef.current;
    if (!group || !group.visible) return;
    const weight = getWeight();
    if (shellRef.current) {
      // 缓慢膨胀（真实约 20–30 km/s，动画为艺术化加速，已登记）
      shellRef.current.scale.setScalar(
        nebulaExpansionScale(clock.elapsedTime, 75, 0.12),
      );
      (shellRef.current.material as THREE.MeshBasicMaterial).opacity =
        0.85 * weight;
    }
  });

  return (
    <group ref={groupRef} name={body.id}>
      {/* 环壳（带径向色层与噪声扰动的环纹理，替换硬边 torus，倾斜呈现椭圆环） */}
      <mesh
        ref={shellRef}
        rotation={[Math.PI / 3, 0.4, 0]}
        onClick={(e) => {
          e.stopPropagation();
          selectBody(body.id);
        }}
      >
        <planeGeometry args={[size * 2.6, size * 2.6]} />
        <meshBasicMaterial
          map={ringTexture}
          color={body.color}
          transparent
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          side={THREE.DoubleSide}
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
    const colors = new Float32Array(count * 3);
    // M13 星族色板（P6 §3.2）：老年星族以红黄为主 + 少量蓝离散星
    // （HST 测光；蓝离散星为并合/物质转移形成的偏蓝恒星）
    const old = [
      [1.0, 0.82, 0.55], // 橙黄（K/G 巨星，老年星族主体）
      [1.0, 0.7, 0.42], // 橙红
      [1.0, 0.9, 0.72], // 黄白
    ];
    const blueStraggler = [0.72, 0.82, 1.0];
    for (let i = 0; i < count; i += 1) {
      // 中心致密的球状分布（半径取 rand² 使中心更密）
      const r = size * rand() * rand();
      const cosPolar = rand() * 2 - 1;
      const azimuth = Math.PI * 2 * rand();
      const sinPolar = Math.sqrt(1 - cosPolar * cosPolar);
      positions[i * 3] = r * sinPolar * Math.cos(azimuth);
      positions[i * 3 + 1] = r * cosPolar;
      positions[i * 3 + 2] = r * sinPolar * Math.sin(azimuth);
      // 约 8% 蓝离散星，其余老年红黄星族
      const isBlue = rand() < 0.08;
      const c = isBlue ? blueStraggler : old[Math.floor(rand() * old.length)];
      const brightness = 0.6 + 0.4 * rand();
      colors[i * 3] = c[0] * brightness;
      colors[i * 3 + 1] = c[1] * brightness;
      colors[i * 3 + 2] = c[2] * brightness;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.PointsMaterial({
      map: getSoftPointTexture(),
      vertexColors: true,
      size: size * 0.06,
      transparent: true,
      opacity: 0.9,
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

  const getWeight = useGalacticPlacement(body, groupRef);
  useFrame(() => {
    const group = groupRef.current;
    if (!group || !group.visible) return;
    const weight = getWeight();
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
  const bodies = SPECIAL_BODIES.filter((b) => b.level === "L3");
  return (
    <group name="special-bodies">
      {bodies.map((body) => {
        switch (body.kind) {
          case "red-giant":
            return <RedGiant key={body.id} body={body} />;
          case "blue-giant":
            return <BlueGiant key={body.id} body={body} />;
          case "binary-white-dwarf":
            return <SiriusBinary key={body.id} body={body} />;
          case "pulsar-remnant":
            return <PulsarRemnant key={body.id} body={body} />;
          case "black-hole":
            return <BlackHole key={body.id} body={body} />;
          case "emission-nebula":
            return <EmissionNebula key={body.id} body={body} />;
          case "planetary-nebula":
            return <PlanetaryNebula key={body.id} body={body} />;
          case "globular-cluster":
            return <GlobularCluster key={body.id} body={body} />;
          case "wolf-rayet":
            return <WolfRayet key={body.id} body={body} />;
          case "cepheid":
            return <Cepheid key={body.id} body={body} />;
          case "open-cluster":
            return <OpenCluster key={body.id} body={body} />;
          case "dark-nebula":
            return <DarkNebula key={body.id} body={body} />;
          default:
            return null;
        }
      })}
    </group>
  );
}
