"use client";


import type { JSX } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { ClampedHtmlLabel } from "@/components/Scene/ClampedHtmlLabel";
import * as THREE from "three";
import type { SpecialBodyData, Vec3 } from "@/types";
import {
  PULSAR_VISUAL_SPIN_PERIOD_SEC,
  SIRIUS_MASS_RATIO,
  SIRIUS_VISUAL_ORBIT_PERIOD_SEC,
  SPECIAL_BODIES,
} from "@/data/specialBodies";
import { useSimulationStore } from "@/store";
import { SCENE_UNITS_PER_LY, trapezoidWeight } from "@/utils/scale";
import { setObjectTreeRaycastEnabled } from "@/utils/raycastGate";
import {
  advanceFrameTransition,
  renderedGalacticFrame,
} from "@/utils/galacticFrame";
import { isHeliopauseNearFocusId } from "@/utils/heliopause";
import { verticalVisualGain } from "@/utils/galacticMotionCues";
import {
  heightLabelText,
  heightLineDropUnits,
} from "@/utils/galacticLatitude";
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
  NEAR_VIEW_PARTICLE_INCREMENTS,
  nearViewEnterDistanceUnits,
  nearViewExitDistanceUnits,
  nebulaPuffLayout,
} from "@/utils/nearView";
import { estimateGpuBytes, type DetailLayerSpec } from "@/utils/detailLayer";
import { useDetailLayer } from "@/hooks/useDetailLayer";
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
export interface StellarSurfaceProps {
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

export function StellarSurface({
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
  groupRef: React.RefObject<THREE.Group | null>,
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
    // 会相对太阳系产生 ±(gain−1)·300 ly 的垂直振荡漂移。
    // offset.y 乘垂直展开增益（R3-6：Galaxy.tsx 每帧缓动后写入注册表，
    // 渲染与 cameraFocus 解析同源；与太阳振荡增益互不相乘）
    const sun = sunGalacticPositionLy(state.simDays);
    const gain = verticalVisualGain(state.realScaleMode);
    const expandGain = renderedGalacticFrame().expandGain;
    group.position.set(
      (sun.x + offset.x) * SCENE_UNITS_PER_LY,
      (sun.y * gain + offset.y * expandGain) * SCENE_UNITS_PER_LY,
      (sun.z + offset.z) * SCENE_UNITS_PER_LY,
    );
  });
  return getWeight;
}

/**
 * 近观 LOD 门控 hook（R2-7 §7.1-B；R4-2 起为统一细节层机制
 * hooks/useDetailLayer 的薄包装——kind='particles'、退出即释放语义、
 * 阈值/0.5s 淡入淡出逐项与现状一致，行为零回退）。
 *
 * @returns nearActive 近观层是否挂载（React state，卸载即释放几何/材质）；
 *   getNear01 读取平滑激活权重（0.5s 淡入淡出，淡出完成后才卸载）
 */
function useNearViewGate(
  body: SpecialBodyData,
  groupRef: React.RefObject<THREE.Group | null>,
): { nearActive: boolean; getNear01: () => number } {
  const spec = useMemo<DetailLayerSpec>(() => {
    const particles = NEAR_VIEW_PARTICLE_INCREMENTS[body.id] ?? 0;
    return {
      bodyId: body.id,
      kind: "particles",
      enterDistanceUnits: nearViewEnterDistanceUnits(body.id),
      exitDistanceUnits: nearViewExitDistanceUnits(body.id),
      budget: { particles, gpuBytesEstimate: estimateGpuBytes({ particles }) },
    };
  }, [body.id]);
  const { active, opacity01 } = useDetailLayer(spec, { objectRef: groupRef });
  return { nearActive: active, getNear01: opacity01 };
}

/**
 * 星云近观体积感云团（R2-7 §7.1-B 星云类共用）：确定性布局
 * （utils/nearView.nebulaPuffLayout）的多张 billboard 云团 sprite，
 * 形成多层视差体积感——绕行观察不再是"单张圆形光晕"。
 * 材质由 R3F 声明式创建（卸载自动 dispose）；纹理来自 nebulaTextures
 * 进程内缓存（不可 dispose，共享复用）。
 */
function NebulaPuffCloud({
  seed,
  count,
  radiusUnits,
  flattenY,
  textures,
  getOpacity,
}: {
  seed: number;
  count: number;
  radiusUnits: number;
  flattenY: number;
  textures: readonly THREE.Texture[];
  /** 读取本帧不透明度权重（层级权重 × 近观权重） */
  getOpacity: () => number;
}): JSX.Element {
  const groupRef = useRef<THREE.Group>(null);
  const placements = useMemo(
    () => nebulaPuffLayout(seed, count, radiusUnits, flattenY, textures.length),
    [seed, count, radiusUnits, flattenY, textures.length],
  );
  useFrame(() => {
    const group = groupRef.current;
    if (!group) return;
    const k = getOpacity();
    for (let i = 0; i < group.children.length; i += 1) {
      const sprite = group.children[i] as THREE.Sprite;
      sprite.material.opacity = placements[i].opacity * k;
    }
  });
  return (
    <group ref={groupRef}>
      {placements.map((p, i) => (
        <sprite key={i} position={[p.x, p.y, p.z]} scale={[p.scale, p.scale, 1]}>
          <spriteMaterial
            map={textures[p.textureIndex]}
            rotation={p.rotationRad}
            transparent
            opacity={0}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </sprite>
      ))}
    </group>
  );
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
  // R2-7：跟随/飞往本天体期间隐藏 L3 标签（近距下 distanceFactor 缩放
  // 呈大字号遮挡近观细节，R2-5 目验登记的既有问题；信息面板已示名称）；
  // 日球层顶近观语境（含旅行者标记）同样隐藏全部 L3 特殊天体标签——
  // 相机距原点 ~836 单位时各天体标签放大 ~3 倍互相叠压，遮挡三层结构
  const focused = useSimulationStore(
    (s) =>
      s.followBodyId === body.id ||
      s.flyToBodyId === body.id ||
      isHeliopauseNearFocusId(s.followBodyId) ||
      isHeliopauseNearFocusId(s.flyToBodyId),
  );
  if (!showLabels || !inRange || focused) return null;
  return (
    // R3-4：近距反向缩放钳制（非焦点标签只钳制不隐藏，焦点隐藏 R2-7 保留）
    <ClampedHtmlLabel
      position={[0, sizeUnits * 1.3, 0]}
      distanceFactor={2600}
      style={{ pointerEvents: "none" }}
    >
      <span className="whitespace-nowrap rounded bg-black/40 px-1.5 py-0.5 text-xs text-sky-200/90">
        {body.nameZh}
      </span>
    </ClampedHtmlLabel>
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
  // R2-7 近观门控：跟随时挂载近观星场与"七姊妹"亮星，离开即释放
  const { nearActive, getNear01 } = useNearViewGate(body, groupRef);
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
      {/* R2-7 近观分级星场（+320 粒更小的暗成员星，疏散分布保持松散感） */}
      {nearActive && (
        <>
          <ClusterNearStarField
            seed={20260734}
            count={320}
            radiusUnits={size * 0.95}
            concentrationPow={0.5}
            flattenY={0.7}
            pointSizeUnits={size * 0.05}
            bluePalette
            getOpacity={() => getWeight() * getNear01()}
          />
          <PleiadesSistersNear
            sizeUnits={size}
            getOpacity={() => getWeight() * getNear01()}
          />
        </>
      )}
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
 * 昴星团"七姊妹"近观亮星（R2-7 §7.1-B）：7 颗最亮成员星的辉光 sprite
 * （确定性位置，扁平分布），近观时亮星等级与暗成员星形成大小分级对比。
 */
function PleiadesSistersNear({
  sizeUnits,
  getOpacity,
}: {
  sizeUnits: number;
  getOpacity: () => number;
}): JSX.Element {
  const groupRef = useRef<THREE.Group>(null);
  const glowTexture = useMemo(
    () => new THREE.CanvasTexture(createGlowSpriteCanvas("#cfe0ff", 64)),
    [],
  );
  useEffect(() => () => glowTexture.dispose(), [glowTexture]);
  const sisters = useMemo(() => {
    const rand = createSeededRandom(20260735);
    return Array.from({ length: 7 }, () => ({
      x: (rand() - 0.5) * sizeUnits * 1.1,
      y: (rand() - 0.5) * sizeUnits * 0.55,
      z: (rand() - 0.5) * sizeUnits * 1.1,
      scale: sizeUnits * (0.26 + 0.16 * rand()),
      opacity: 0.6 + 0.3 * rand(),
    }));
  }, [sizeUnits]);
  useFrame(() => {
    const group = groupRef.current;
    if (!group) return;
    const k = getOpacity();
    for (let i = 0; i < group.children.length; i += 1) {
      const sprite = group.children[i] as THREE.Sprite;
      sprite.material.opacity = sisters[i].opacity * k;
    }
  });
  return (
    <group ref={groupRef}>
      {sisters.map((s, i) => (
        <sprite key={i} position={[s.x, s.y, s.z]} scale={[s.scale, s.scale, 1]}>
          <spriteMaterial
            map={glowTexture}
            transparent
            opacity={0}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </sprite>
      ))}
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
  // R2-7 近观门控：跟随时挂载视差发射层与前景暗云团，离开即释放
  const { nearActive, getNear01 } = useNearViewGate(body, groupRef);
  useFrame(() => {
    const group = groupRef.current;
    if (!group || !group.visible) return;
    const weight = getWeight();
    const near01 = getNear01();
    group.traverse((obj) => {
      const base = obj.userData.baseOpacity as number | undefined;
      if (base === undefined) return;
      // 近观层（视差发射面/前景暗云团）额外乘近观权重淡入
      const factor = obj.userData.nearLayer ? weight * near01 : weight;
      if (obj instanceof THREE.Sprite) {
        obj.material.opacity = base * factor;
      } else if (obj instanceof THREE.Mesh) {
        (obj.material as THREE.Material & { opacity: number }).opacity =
          base * factor;
      }
    });
  });

  // 暗云柱剪影块（前景，普通混合遮光）：垂直"颈部" + 顶部"头部"偏移
  const silhouette = [
    { x: 0, y: -size * 0.25, scale: 0.7, opacity: 0.92 },
    { x: 0, y: size * 0.12, scale: 0.5, opacity: 0.95 },
    { x: size * 0.2, y: size * 0.36, scale: 0.36, opacity: 0.95 },
  ];

  // R2-7 近观增量：不同深度的发射层（视差）+ 前景暗云团（深度层次）
  const nearEmissionLayers = [
    { z: -size * 0.85, w: 3.4, h: 2.7, opacity: 0.28, seed: 4341 },
    { z: -size * 0.15, w: 2.2, h: 1.8, opacity: 0.32, seed: 4342 },
  ];
  const nearDarkPuffs = [
    { x: -size * 0.28, y: -size * 0.42, z: size * 0.5, scale: 0.4 },
    { x: size * 0.34, y: size * 0.05, z: size * 0.62, scale: 0.3 },
    { x: -size * 0.05, y: size * 0.5, z: size * 0.55, scale: 0.26 },
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
      {/* R2-7 近观增量：不同深度发射层（绕行视差）+ 前景暗云团（马头剪影
          获得前后景深，近观不再是同一深度的平面贴片组） */}
      {nearActive && (
        <>
          {nearEmissionLayers.map((layer, i) => (
            <mesh
              key={`near-emission-${i}`}
              position={[0, 0, layer.z]}
              userData={{ baseOpacity: layer.opacity, nearLayer: true }}
            >
              <planeGeometry args={[size * layer.w, size * layer.h]} />
              <meshBasicMaterial
                map={getNebulaTexture({
                  size: 256,
                  seed: layer.seed,
                  innerColor: "#ff8898",
                  outerColor: "#7a2838",
                  filamentStrength: 0.55,
                  irregularity: 0.7,
                  octaves: 5,
                  shape: "cloud",
                })}
                transparent
                opacity={0}
                depthWrite={false}
                blending={THREE.AdditiveBlending}
                side={THREE.DoubleSide}
              />
            </mesh>
          ))}
          {nearDarkPuffs.map((p, i) => (
            <sprite
              key={`near-dark-${i}`}
              position={[p.x, p.y, p.z]}
              scale={[size * p.scale, size * p.scale, 1]}
              userData={{ baseOpacity: 0.8, nearLayer: true }}
              renderOrder={11}
            >
              <spriteMaterial
                map={darkTexture}
                transparent
                opacity={0}
                depthWrite={false}
                blending={THREE.NormalBlending}
              />
            </sprite>
          ))}
        </>
      )}
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
  const showLabels = useSimulationStore((s) => s.showLabels);
  const size = body.visualRadiusLy * SCENE_UNITS_PER_LY;
  const separation = size * 1.7;
  // 绕共同质心的轨道半径（binaryStarPositions 同源公式：重星轨道小）
  const rPrimary = separation / (1 + SIRIUS_MASS_RATIO);
  const rSecondary = separation - rPrimary;

  const glowTexture = useMemo(
    () => new THREE.CanvasTexture(createGlowSpriteCanvas("#eef4ff", 128)),
    [],
  );
  // 白矮星衍射芒线（P6 §3.2）：致密高亮点星的观测质感
  const spikeTexture = useMemo(
    () => new THREE.CanvasTexture(createDiffractionSpikeCanvas("#dcebff", 128)),
    [],
  );
  useEffect(() => () => glowTexture.dispose(), [glowTexture]);
  useEffect(() => () => spikeTexture.dispose(), [spikeTexture]);

  const getWeight = useGalacticPlacement(body, groupRef);
  // R2-7 近观门控：跟随时挂载互绕轨道线与两星身份标注，离开即释放
  const { nearActive, getNear01 } = useNearViewGate(body, groupRef);
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
      {/* R2-7 近观：绕共同质心的双轨道线（互绕运动路径可辨） */}
      {nearActive && (
        <SiriusNearOrbits
          rPrimary={rPrimary}
          rSecondary={rSecondary}
          getOpacity={() => getWeight() * getNear01()}
        />
      )}
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
        {/* R2-7 近观两星身份标注（大小/颜色对比 + 名称可辨）；
            R3-4：近观专用标注只钳制不隐藏（用户确认项 3） */}
        {nearActive && showLabels && (
          <ClampedHtmlLabel
            position={[0, size * 0.62, 0]}
            distanceFactor={26}
            style={{ pointerEvents: "none" }}
          >
            <span className="whitespace-nowrap rounded bg-black/40 px-1.5 py-0.5 text-xs text-sky-100/90">
              天狼星A · 主序星
            </span>
          </ClampedHtmlLabel>
        )}
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
          {/* R2-7：白矮星取更蓝的色调（~25,000 K 高温白矮星，与主星对比清晰） */}
          <meshBasicMaterial color="#cfe4ff" />
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
        {nearActive && showLabels && (
          <ClampedHtmlLabel
            position={[0, size * 0.32, 0]}
            distanceFactor={26}
            style={{ pointerEvents: "none" }}
          >
            <span className="whitespace-nowrap rounded bg-black/40 px-1.5 py-0.5 text-xs text-blue-200/90">
              天狼星B · 白矮星
            </span>
          </ClampedHtmlLabel>
        )}
      </group>
      <BodyLabel body={body} sizeUnits={size} />
    </group>
  );
}

/**
 * 天狼星近观互绕轨道线（R2-7 §7.1-B）：绕共同质心的两个圆轨道
 * （与 binaryStarPositions 同源半径，重的 A 星轨道小、白矮星 B 轨道大），
 * 近观时互绕运动路径与质心结构清晰可辨。
 */
function SiriusNearOrbits({
  rPrimary,
  rSecondary,
  getOpacity,
}: {
  rPrimary: number;
  rSecondary: number;
  getOpacity: () => number;
}): JSX.Element {
  const { geoA, geoB, matA, matB } = useMemo(() => {
    const build = (radius: number): THREE.BufferGeometry => {
      const segments = 96;
      const positions = new Float32Array(segments * 3);
      for (let i = 0; i < segments; i += 1) {
        const theta = (Math.PI * 2 * i) / segments;
        positions[i * 3] = radius * Math.cos(theta);
        positions[i * 3 + 1] = 0;
        positions[i * 3 + 2] = -radius * Math.sin(theta);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      return geo;
    };
    const makeMat = (color: string): THREE.LineBasicMaterial =>
      new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
    return {
      geoA: build(rPrimary),
      geoB: build(rSecondary),
      matA: makeMat("#9fc3ff"),
      matB: makeMat("#cfe4ff"),
    };
  }, [rPrimary, rSecondary]);

  useEffect(
    () => () => {
      geoA.dispose();
      geoB.dispose();
      matA.dispose();
      matB.dispose();
    },
    [geoA, geoB, matA, matB],
  );

  useFrame(() => {
    const k = getOpacity();
    matA.opacity = 0.38 * k;
    matB.opacity = 0.3 * k;
  });

  return (
    <>
      <lineLoop geometry={geoA} material={matA} />
      <lineLoop geometry={geoB} material={matB} />
    </>
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

  // R2-7 近观丝状遗迹云团纹理（shell 形态 3 种子，复用 nebulaTextures 缓存）
  const filamentTextures = useMemo(
    () => [
      nebulaTexture,
      getNebulaTexture({
        size: 256,
        seed: 10542,
        innerColor: "#ffb28a",
        outerColor: "#ff4038",
        filamentStrength: 0.9,
        irregularity: 0.65,
        octaves: 5,
        shape: "shell",
      }),
      getNebulaTexture({
        size: 256,
        seed: 10543,
        innerColor: "#bfe0ff", // 中心同步辐射星风云（蓝白）
        outerColor: "#ff6a55",
        filamentStrength: 0.8,
        irregularity: 0.6,
        octaves: 5,
        shape: "shell",
      }),
    ],
    [nebulaTexture],
  );

  const getWeight = useGalacticPlacement(body, groupRef);
  // R2-7 近观门控：跟随时挂载丝状体积云团层，离开即释放
  const { nearActive, getNear01 } = useNearViewGate(body, groupRef);
  useFrame(({ clock }) => {
    const group = groupRef.current;
    if (!group || !group.visible) return;
    const weight = getWeight();
    const near01 = getNear01();
    const t = clock.elapsedTime;
    beamMaterial.uniforms.uTime.value = t;
    // 近观时射束增亮（扫描形态更清晰，R2-7）
    beamMaterial.uniforms.uOpacity.value = 0.5 * weight * (1 + 0.6 * near01);
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
    // 遗迹星云缓慢膨胀（联动蟹状星云）；近观时单张光晕减淡交叉过渡到
    // 体积云团（R2-7"无单张圆形光晕"）
    if (nebulaRef.current) {
      const s = size * 2.6 * nebulaExpansionScale(t, 90, 0.1);
      nebulaRef.current.scale.set(s, s, 1);
      (nebulaRef.current.material as THREE.SpriteMaterial).opacity =
        0.4 * weight * (1 - 0.45 * near01);
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
      {/* R2-7 近观丝状体积云团（16 sprite，遗迹壳层立体感） */}
      {nearActive && (
        <NebulaPuffCloud
          seed={1054}
          count={16}
          radiusUnits={size * 1.2}
          flattenY={0.85}
          textures={filamentTextures}
          getOpacity={() => getWeight() * getNear01()}
        />
      )}
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
  // R2-7 近观门控：跟随时挂载体积感云团层，离开即释放
  const { nearActive, getNear01 } = useNearViewGate(body, groupRef);
  useFrame(() => {
    const group = groupRef.current;
    if (!group || !group.visible) return;
    const weight = getWeight();
    const near01 = getNear01();
    group.traverse((obj) => {
      const base = obj.userData.baseOpacity as number | undefined;
      if (base === undefined) return;
      // 近观时基础平面层减淡（体积云团接管主体，削弱"平面贴片"观感）
      const factor = obj.userData.nearDim ? weight * (1 - 0.35 * near01) : weight;
      if (obj instanceof THREE.Sprite) {
        obj.material.opacity = base * factor;
      } else if (obj instanceof THREE.Mesh) {
        (obj.material as THREE.Material & { opacity: number }).opacity =
          base * factor;
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
          userData={{ baseOpacity: layer.opacity, nearDim: true }}
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
      {/* R2-7 近观体积感云团（18 sprite，绕行观察无"单张圆形光晕"） */}
      {nearActive && (
        <NebulaPuffCloud
          seed={4210}
          count={18}
          radiusUnits={size * 1.05}
          flattenY={0.55}
          textures={cloudLayers}
          getOpacity={() => getWeight() * getNear01()}
        />
      )}
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
  const shellRef = useRef<THREE.Group>(null);
  const planeRef = useRef<THREE.Mesh>(null);
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
  // R2-7 近观门控：跟随时挂载环体 3D 粒子与外晕层，离开即释放
  const { nearActive, getNear01 } = useNearViewGate(body, groupRef);
  useFrame(({ clock }) => {
    const group = groupRef.current;
    if (!group || !group.visible) return;
    const weight = getWeight();
    if (shellRef.current) {
      // 缓慢膨胀（真实约 20–30 km/s，动画为艺术化加速，已登记）；
      // 近观环体粒子挂在同一缩放组内与环面同步膨胀
      shellRef.current.scale.setScalar(
        nebulaExpansionScale(clock.elapsedTime, 75, 0.12),
      );
    }
    if (planeRef.current) {
      (planeRef.current.material as THREE.MeshBasicMaterial).opacity =
        0.85 * weight;
    }
  });

  return (
    <group ref={groupRef} name={body.id}>
      {/* 环壳缩放组（倾斜姿态 + 膨胀动画；环面与近观环体粒子同步） */}
      <group ref={shellRef} rotation={[Math.PI / 3, 0.4, 0]}>
        {/* 环面（带径向色层与噪声扰动的环纹理，替换硬边 torus，倾斜呈现椭圆环） */}
        <mesh
          ref={planeRef}
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
        {/* R2-7 近观环体 3D 粒子（环向软边粒子，侧向观察环体有厚度） */}
        {nearActive && (
          <RingNebulaNearTorus
            sizeUnits={size}
            getOpacity={() => getWeight() * getNear01()}
          />
        )}
      </group>
      {/* R2-7 近观外晕壳（外缘 Hα 弥散晕，体积包裹感） */}
      {nearActive && (
        <RingNebulaNearHalo
          sizeUnits={size}
          getOpacity={() => getWeight() * getNear01()}
        />
      )}
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
 * 环状星云近观环体粒子（R2-7 §7.1-B）：沿环面圆环分布的软边粒子环
 * （200 粒，管截面确定性散布），与环面纹理同姿态同膨胀——侧向观察
 * 环体呈现厚度与颗粒结构，而非一张平面贴图。
 */
function RingNebulaNearTorus({
  sizeUnits,
  getOpacity,
}: {
  sizeUnits: number;
  getOpacity: () => number;
}): JSX.Element {
  const { geometry, material } = useMemo(() => {
    const rand = createSeededRandom(57057);
    const count = 200;
    const ringRadius = sizeUnits * 0.85;
    const tubeRadius = sizeUnits * 0.16;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const inner = new THREE.Color("#7fffcf"); // 内缘 OIII 蓝绿
    const outer = new THREE.Color("#ff5a55"); // 外缘 Hα 红
    for (let i = 0; i < count; i += 1) {
      // 环向均匀 + 抖动；管截面 sqrt 分布（外密内稀的壳感）
      const theta = Math.PI * 2 * ((i + rand() * 0.8) / count);
      const tube = tubeRadius * Math.sqrt(rand());
      const phi = Math.PI * 2 * rand();
      const r = ringRadius + tube * Math.cos(phi);
      // 环面位于 x-y 平面（与 planeGeometry 同空间）
      positions[i * 3] = r * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.sin(theta);
      positions[i * 3 + 2] = tube * Math.sin(phi);
      // 径向色层：靠内偏 OIII 蓝绿、靠外偏 Hα 红（与环纹理色层一致）
      const t = (tube * Math.cos(phi)) / tubeRadius / 2 + 0.5;
      const c = inner.clone().lerp(outer, t);
      const brightness = 0.5 + 0.5 * rand();
      colors[i * 3] = c.r * brightness;
      colors[i * 3 + 1] = c.g * brightness;
      colors[i * 3 + 2] = c.b * brightness;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.PointsMaterial({
      size: sizeUnits * 0.11,
      map: getSoftPointTexture(),
      vertexColors: true,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    return { geometry: geo, material: mat };
  }, [sizeUnits]);

  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  useFrame(() => {
    material.opacity = 0.8 * getOpacity();
  });

  return <points geometry={geometry} material={material} />;
}

/** 环状星云近观外晕壳 + 中心 OIII 辉光（体积包裹感） */
function RingNebulaNearHalo({
  sizeUnits,
  getOpacity,
}: {
  sizeUnits: number;
  getOpacity: () => number;
}): JSX.Element {
  const groupRef = useRef<THREE.Group>(null);
  useFrame(() => {
    const group = groupRef.current;
    if (!group) return;
    const k = getOpacity();
    group.traverse((obj) => {
      const base = obj.userData.baseOpacity as number | undefined;
      if (base === undefined || !(obj instanceof THREE.Mesh)) return;
      (obj.material as THREE.Material & { opacity: number }).opacity = base * k;
    });
  });
  return (
    <group ref={groupRef}>
      <mesh userData={{ baseOpacity: 0.05 }}>
        <sphereGeometry args={[sizeUnits * 1.3, 32, 24]} />
        <meshBasicMaterial
          color="#ff5a55"
          transparent
          opacity={0}
          side={THREE.BackSide}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
      <mesh userData={{ baseOpacity: 0.09 }}>
        <sphereGeometry args={[sizeUnits * 0.4, 24, 18]} />
        <meshBasicMaterial
          color="#7fffcf"
          transparent
          opacity={0}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
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
  // R2-7 近观门控：跟随时挂载近观分级星场，离开即释放
  const { nearActive, getNear01 } = useNearViewGate(body, groupRef);
  useFrame(() => {
    const group = groupRef.current;
    if (!group || !group.visible) return;
    const weight = getWeight();
    material.opacity = 0.9 * weight;
  });

  return (
    <group ref={groupRef} name={body.id}>
      <points geometry={geometry} material={material} />
      {/* R2-7 近观分级星场（+1,200 粒更小的暗星，rand^2.4 分布中心更密——
          近观时中心密集/边缘稀疏的分辨力提升，粒子均为圆形软边贴图） */}
      {nearActive && (
        <ClusterNearStarField
          seed={20260723}
          count={1200}
          radiusUnits={size}
          concentrationPow={2.4}
          flattenY={1}
          pointSizeUnits={size * 0.035}
          bluePalette={false}
          getOpacity={() => getWeight() * getNear01()}
        />
      )}
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
 * 星团近观分级星场（R2-7 §7.1-B 星团类共用）：在基础星场之上叠加
 * 更多、更小的暗星层——近观时粒子数/大小分级提升，分布确定性生成
 * （两次飞往形态一致），粒子为圆形软边贴图（getSoftPointTexture，
 * 无方块粒子）。M13 用老年红黄星族色板（concentrationPow 大 → 中心
 * 致密），昴星团用年轻热蓝星色板（分布接近均匀）。
 */
function ClusterNearStarField({
  seed,
  count,
  radiusUnits,
  concentrationPow,
  flattenY,
  pointSizeUnits,
  bluePalette,
  getOpacity,
}: {
  seed: number;
  count: number;
  radiusUnits: number;
  /** 半径分布指数：r = R·rand^pow（越大中心越密；1 ≈ 疏散） */
  concentrationPow: number;
  flattenY: number;
  pointSizeUnits: number;
  bluePalette: boolean;
  getOpacity: () => number;
}): JSX.Element {
  const { geometry, material } = useMemo(() => {
    const rand = createSeededRandom(seed);
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    // 色板与基础星场一致（M13 老年红黄 + 蓝离散星 / 昴星团热蓝星）
    const old = [
      [1.0, 0.82, 0.55],
      [1.0, 0.7, 0.42],
      [1.0, 0.9, 0.72],
    ];
    const blueStraggler = [0.72, 0.82, 1.0];
    for (let i = 0; i < count; i += 1) {
      const r = radiusUnits * Math.pow(rand(), concentrationPow);
      const cosPolar = rand() * 2 - 1;
      const azimuth = Math.PI * 2 * rand();
      const sinPolar = Math.sqrt(1 - cosPolar * cosPolar);
      positions[i * 3] = r * sinPolar * Math.cos(azimuth);
      positions[i * 3 + 1] = r * cosPolar * flattenY;
      positions[i * 3 + 2] = r * sinPolar * Math.sin(azimuth);
      const brightness = 0.35 + 0.45 * rand();
      if (bluePalette) {
        const blue = 0.85 + 0.15 * rand();
        colors[i * 3] = 0.7 * brightness;
        colors[i * 3 + 1] = 0.82 * brightness;
        colors[i * 3 + 2] = blue * brightness;
      } else {
        const isBlue = rand() < 0.08;
        const c = isBlue ? blueStraggler : old[Math.floor(rand() * old.length)];
        colors[i * 3] = c[0] * brightness;
        colors[i * 3 + 1] = c[1] * brightness;
        colors[i * 3 + 2] = c[2] * brightness;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.PointsMaterial({
      map: getSoftPointTexture(),
      vertexColors: true,
      size: pointSizeUnits,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    return { geometry: geo, material: mat };
  }, [seed, count, radiusUnits, concentrationPow, flattenY, pointSizeUnits, bluePalette]);

  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  useFrame(() => {
    material.opacity = 0.85 * getOpacity();
  });

  return <points geometry={geometry} material={material} />;
}

// ---------------------------------------------------------------------------
// 高度指示线（R3-6 §6.1-C）：展开开启且 showLabels 时，每个 sun-relative
// 特殊天体显示"天体 → 银盘面（组内 y=0）投影点"虚线 + 高度标注。
// 标注为银纬推算的真实高度（未乘展开增益，登记）；sgr-a-star（银心原点，
// 无 offset）不参与。位置公式与 useGalacticPlacement 镜像同源。
// ---------------------------------------------------------------------------

/** 参与高度指示线的天体（12 个 sun-relative L3 特殊天体） */
const HEIGHT_INDICATOR_BODIES = SPECIAL_BODIES.filter(
  (b): b is SpecialBodyData & { offsetLy: Vec3 } =>
    b.level === "L3" &&
    b.positionMode === "sun-relative" &&
    b.offsetLy !== undefined,
);

/** 指示线虚线样式（场景单位；盘半径 ~2,635 单位尺度下可辨） */
const HEIGHT_LINE_DASH_UNITS = 14;
const HEIGHT_LINE_GAP_UNITS = 9;

/** 挂载门（R3-6）：展开开启且标签开启时才挂载（关闭即卸载/隐藏） */
function HeightIndicators(): JSX.Element | null {
  const active = useSimulationStore(
    (s) => s.galaxyVerticalExpand && s.showLabels,
  );
  if (!active) return null;
  return <HeightIndicatorsInner />;
}

function HeightIndicatorsInner(): JSX.Element {
  // 标签挂载窗口与 BodyLabel 一致（2.5–3.9）；跟随/飞往目标隐藏自身标注
  // （R2-7 同款语义：近距下标签遮挡近观细节）
  const inRange = useSimulationStore(
    (s) => s.continuousLevel > 2.5 && s.continuousLevel < 3.9,
  );
  const focusedId = useSimulationStore(
    (s) => s.followBodyId ?? s.flyToBodyId,
  );
  const groupsRef = useRef<(THREE.Group | null)[]>([]);
  // 虚线资产（预分配 position/lineDistance 属性，渲染循环零分配：
  // 不调用 computeLineDistances——其每次调用都会新建属性数组）
  const assets = useMemo(
    () =>
      HEIGHT_INDICATOR_BODIES.map(() => {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute(
          "position",
          new THREE.BufferAttribute(new Float32Array(2 * 3), 3),
        );
        geo.setAttribute(
          "lineDistance",
          new THREE.BufferAttribute(new Float32Array(2), 1),
        );
        const mat = new THREE.LineDashedMaterial({
          color: "#7fffd4",
          dashSize: HEIGHT_LINE_DASH_UNITS,
          gapSize: HEIGHT_LINE_GAP_UNITS,
          transparent: true,
          opacity: 0,
          depthWrite: false,
        });
        const line = new THREE.Line(geo, mat);
        line.frustumCulled = false;
        return { geo, mat, line };
      }),
    [],
  );
  useEffect(
    () => () => {
      for (const asset of assets) {
        asset.geo.dispose();
        asset.mat.dispose();
      }
    },
    [assets],
  );
  useFrame(() => {
    const state = useSimulationStore.getState();
    const weight = specialFadeWeight(state.continuousLevel);
    const visible = weight > 0.05;
    const sun = sunGalacticPositionLy(state.simDays);
    const gain = verticalVisualGain(state.realScaleMode);
    const expandGain = renderedGalacticFrame().expandGain;
    for (let i = 0; i < HEIGHT_INDICATOR_BODIES.length; i += 1) {
      const group = groupsRef.current[i];
      if (!group) continue;
      group.visible = visible;
      if (!visible) continue;
      const offset = HEIGHT_INDICATOR_BODIES[i].offsetLy;
      // 与 useGalacticPlacement 同源：天体本地位置的 y 通道含展开增益
      group.position.set(
        (sun.x + offset.x) * SCENE_UNITS_PER_LY,
        (sun.y * gain + offset.y * expandGain) * SCENE_UNITS_PER_LY,
        (sun.z + offset.z) * SCENE_UNITS_PER_LY,
      );
      const drop = heightLineDropUnits(
        sun.y,
        gain,
        offset.y,
        expandGain,
        SCENE_UNITS_PER_LY,
      );
      const asset = assets[i];
      const pos = asset.geo.attributes.position as THREE.BufferAttribute;
      pos.setXYZ(1, 0, drop, 0);
      pos.needsUpdate = true;
      const dist = asset.geo.attributes.lineDistance as THREE.BufferAttribute;
      dist.setX(1, Math.abs(drop));
      dist.needsUpdate = true;
      asset.mat.opacity = 0.55 * weight;
    }
  });
  return (
    <group name="height-indicators">
      {HEIGHT_INDICATOR_BODIES.map((body, i) => (
        <group
          key={body.id}
          ref={(g) => {
            groupsRef.current[i] = g;
          }}
          visible={false}
        >
          <primitive object={assets[i].line} />
          {inRange && focusedId !== body.id && (
            // R3-4 近距钳制标签：真实推算高度 ±ly（不乘展开增益，登记）
            <ClampedHtmlLabel
              position={[
                0,
                -body.visualRadiusLy * SCENE_UNITS_PER_LY * 1.3,
                0,
              ]}
              distanceFactor={2600}
              style={{ pointerEvents: "none" }}
            >
              <span className="whitespace-nowrap rounded bg-black/40 px-1.5 py-0.5 text-[10px] text-emerald-200/90">
                {heightLabelText(body.offsetLy.y)}
              </span>
            </ClampedHtmlLabel>
          )}
        </group>
      ))}
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
      {/* 高度指示线（R3-6）：展开开启且 showLabels 时显示 */}
      <HeightIndicators />
    </group>
  );
}
