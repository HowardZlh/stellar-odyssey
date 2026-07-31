'use client';


import type { JSX } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { ClampedHtmlLabel } from '@/components/Scene/ClampedHtmlLabel';
import { BodyNameText } from '@/components/Scene/LocalizedLabelText';
import type { CometData } from '@/types';
import { useSimulationStore } from '@/store';
import {
  DAYS_PER_YEAR,
  DEG_TO_RAD,
  heliocentricPosition,
  normalizeAngle,
  orbitalPeriodYears,
} from '@/utils/physics';
import { eclipticToScene } from '@/utils/scale';
import {
  advanceClampedPhase,
  equivalentDaysForPhase,
  planetFrozen,
  planetVisibilityWeight,
  reportPlanetRateClamp,
} from '@/utils/freezeGate';
import { rateClampFactor, timeCompressionForContinuousLevel } from '@/utils/time';
import {
  clearRenderedSatellitePhase,
  setRenderedSatellitePhase,
} from '@/utils/satellitePhase';
import {
  ION_SWAY_WAVE_NUMBER,
  TAIL_FADE_EXPONENT,
  TAIL_MAX_LENGTH_UNITS,
  TAIL_SPREAD_EXPONENT,
  cometActivity01,
  dustTailBendDirection,
  dustTailBendMagnitude,
  dustTailLengthUnits,
  ionTailDirection,
  ionTailLengthUnits,
  orbitalVelocityAuPerDay,
} from '@/utils/cometTail';
import { ELONGATION_RATIO, cometNucleusRadialScale } from '@/utils/cometNucleus';
import { createSeededRandom } from '@/utils/random';
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

// ---------------------------------------------------------------------------
// 粒子化彗尾（彗尾细节增强，需求 §4.7）：
// 两条尾均为 THREE.Points + ShaderMaterial（复用 Belt/Galaxy 粒子范式），
// 公式与 utils/cometTail.ts 纯函数镜像（tailFlowT01 / tailSpreadRadius /
// ionTailSwayOffset / tailAxialFade01 / dustTailBendOffset，均有单测）。
// 粒子预算：每彗星 2600 + 2400 = 5000，两颗彗星共 1 万（现有 5 万粒子
// 场景实测 60 FPS 满帧，余量充足）。
// ---------------------------------------------------------------------------

/** 离子尾粒子数（细长射线感需要较高轴向密度） */
const ION_TAIL_PARTICLES = 2600;
/** 尘埃尾粒子数 */
const DUST_TAIL_PARTICLES = 2400;
/** 离子尾横向扩散：核心/最大半径（场景单位）——细长 */
const ION_CORE_RADIUS = 0.04;
const ION_MAX_RADIUS = 0.5;
/** 尘埃尾横向扩散——宽而蓬松（与原圆锥宽度量级一致） */
const DUST_CORE_RADIUS = 0.06;
const DUST_MAX_RADIUS = 1.05;
/** 离子尾摆动幅度（场景单位，尾端最大值；太阳风扰动示意） */
const ION_SWAY_AMP = 0.32;
/** 物质外流循环周期（秒，实时钟；离子尾快、尘埃尾慢） */
const ION_FLOW_CYCLE_SEC = 2.4;
const DUST_FLOW_CYCLE_SEC = 7.5;

/**
 * 彗尾粒子顶点 shader：
 * - 流动：t = fract(seed + flow)（tailFlowT01 镜像，物质持续外流循环）
 * - 横向扩散包络 r(t) = core + (max−core)·t^0.7（tailSpreadRadius 镜像）
 * - 尘埃尾二次弯曲 offset = uBendWorld·t²（dustTailBendOffset 镜像，离子尾为 0）
 * - 离子尾摆动 amp·t·sin(phase − t·波数)（ionTailSwayOffset 镜像，尘埃尾为 0）
 * 尾轴 = 局部 -Y（尖端在彗核原点，与原圆锥朝向约定一致）
 */
const TAIL_VERTEX_SHADER = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  attribute float aSeed;
  attribute float aAngle;
  attribute float aRadius01;
  attribute float aJitter;
  uniform float uFlow;
  uniform float uTime;
  uniform float uLength;
  uniform float uCoreRadius;
  uniform float uMaxRadius;
  uniform float uBendWorld;
  uniform float uSwayAmp;
  uniform float uSize;
  varying float vT;
  varying float vRadius01;
  varying float vJitter;

  void main() {
    float t = fract(aSeed + uFlow);
    vT = t;
    vRadius01 = aRadius01;
    vJitter = aJitter;
    float spread = uCoreRadius + (uMaxRadius - uCoreRadius) * pow(t, ${TAIL_SPREAD_EXPONENT.toFixed(2)});
    vec3 p = vec3(cos(aAngle), 0.0, sin(aAngle)) * (aRadius01 * spread);
    p.y = -t * uLength;
    p.x += uBendWorld * t * t;
    float swayPhase = uTime * 1.4 + aSeed * 6.2831853;
    p.x += uSwayAmp * t * sin(swayPhase - t * ${ION_SWAY_WAVE_NUMBER.toFixed(1)});
    p.z += uSwayAmp * t * cos(swayPhase * 0.83 - t * ${ION_SWAY_WAVE_NUMBER.toFixed(1)});
    vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = clamp(uSize * (0.55 + 0.9 * aJitter) * (150.0 / -mvPosition.z), 1.0, 20.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <logdepthbuf_vertex>
  }
`;

/**
 * 彗尾粒子片元 shader：
 * - 柔和圆点（smoothstep 中心亮边缘淡，消除硬边）
 * - 轴向衰减 (1−t)^1.2（tailAxialFade01 镜像，尾端平滑消隐）
 * - 横向轴心亮、边缘暗；颜色沿尾轴与径向从核心色渐变到边缘色
 */
const TAIL_FRAGMENT_SHADER = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_fragment>
  uniform vec3 uColorCore;
  uniform vec3 uColorEdge;
  uniform float uOpacity;
  varying float vT;
  varying float vRadius01;
  varying float vJitter;

  void main() {
    #include <logdepthbuf_fragment>
    vec2 c = gl_PointCoord - vec2(0.5);
    float d2 = dot(c, c);
    if (d2 > 0.25) discard;
    float soft = 1.0 - smoothstep(0.02, 0.25, d2);
    float axial = pow(1.0 - vT, ${TAIL_FADE_EXPONENT.toFixed(2)});
    float lateral = 1.0 - vRadius01 * 0.55;
    vec3 color = mix(uColorCore, uColorEdge, clamp(vT * 0.8 + vRadius01 * 0.35, 0.0, 1.0));
    float alpha = uOpacity * axial * lateral * soft * (0.65 + 0.35 * vJitter);
    gl_FragColor = vec4(color, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

interface TailAssets {
  geometry: THREE.BufferGeometry;
  material: THREE.ShaderMaterial;
}

/**
 * 构建一条粒子彗尾：确定性随机属性（种子派生自彗星 id，跨会话一致）。
 * aRadius01 取 sqrt 使横截面盘内均匀分布；aSeed 为流动初始相位。
 */
function createTailAssets(
  count: number,
  seed: number,
  opts: {
    colorCore: string;
    colorEdge: string;
    coreRadius: number;
    maxRadius: number;
    size: number;
  },
): TailAssets {
  const rand = createSeededRandom(seed);
  const seeds = new Float32Array(count);
  const angles = new Float32Array(count);
  const radii = new Float32Array(count);
  const jitters = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    seeds[i] = rand();
    angles[i] = Math.PI * 2 * rand();
    radii[i] = Math.sqrt(rand());
    jitters[i] = rand();
  }
  const geometry = new THREE.BufferGeometry();
  // position 属性仅作占位（实际位置由着色器计算）
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
  geometry.setAttribute('aAngle', new THREE.BufferAttribute(angles, 1));
  geometry.setAttribute('aRadius01', new THREE.BufferAttribute(radii, 1));
  geometry.setAttribute('aJitter', new THREE.BufferAttribute(jitters, 1));
  // 视锥剔除包围球：覆盖最大尾长 + 弯曲/摆动横向偏移
  geometry.boundingSphere = new THREE.Sphere(
    new THREE.Vector3(0, -TAIL_MAX_LENGTH_UNITS / 2, 0),
    TAIL_MAX_LENGTH_UNITS,
  );
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uFlow: { value: 0 },
      uTime: { value: 0 },
      uLength: { value: 0.01 },
      uCoreRadius: { value: opts.coreRadius },
      uMaxRadius: { value: opts.maxRadius },
      uBendWorld: { value: 0 },
      uSwayAmp: { value: 0 },
      uSize: { value: opts.size },
      uOpacity: { value: 0 },
      uColorCore: { value: new THREE.Color(opts.colorCore) },
      uColorEdge: { value: new THREE.Color(opts.colorEdge) },
    },
    vertexShader: TAIL_VERTEX_SHADER,
    fragmentShader: TAIL_FRAGMENT_SHADER,
  });
  return { geometry, material };
}

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
  const comaCoreRef = useRef<THREE.Sprite>(null);
  const dustTailRef = useRef<THREE.Points>(null);
  const ionTailRef = useRef<THREE.Points>(null);
  const nucleusRef = useRef<THREE.Mesh>(null);
  const camera = useThree((s) => s.camera);
  const selectBody = useSimulationStore((s) => s.selectBody);
  const showLabels = useSimulationStore((s) => s.showLabels);
  // R3-4 §4.1-D：跟随/飞往本彗星时隐藏自身标签（与行星/L3 特殊天体机制对称）
  const focused = useSimulationStore(
    (s) => s.followBodyId === data.id || s.flyToBodyId === data.id,
  );
  // R3-4 §4.1-D：近距隐藏（P7 同款距离规则，相机贴近彗核时标签让位）
  const [labelHidden, setLabelHidden] = useState(false);
  const labelHiddenRef = useRef(false);
  // Html 标签不随父级 visible 隐藏，需单独按层级门控
  // R2-3：冻结判定收敛至 utils/freezeGate（与行星同步淡出-冻结）
  const frozen = useSimulationStore((s) => planetFrozen(s.continuousLevel));
  // P4 彗核近观细节门控（仅 L1 近观渲染，滞回与行星一致）
  const [nearView, setNearView] = useState(false);
  const nearViewRef = useRef(false);
  // R2-3 速率钳制（淡出区间兜底）：累计相位 / 上帧模拟时间 / 钳制状态 / 标签淡出
  const clampedPhaseRef = useRef<number | null>(null);
  const lastSimDaysRef = useRef<number | null>(null);
  const clampedRef = useRef(false);
  const labelElRef = useRef<HTMLSpanElement>(null);
  const periodDays = useMemo(
    () => orbitalPeriodYears(data.orbit.semiMajorAxisAu) * DAYS_PER_YEAR,
    [data.orbit.semiMajorAxisAu],
  );

  const comaTexture = useMemo(() => {
    const tex = new THREE.CanvasTexture(createGlowSpriteCanvas(data.color, 128));
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }, [data.color]);

  // 彗发内层白心（多层彗发：内亮白心 + 外彩色晕，层次感）
  const comaCoreTexture = useMemo(() => {
    const tex = new THREE.CanvasTexture(createGlowSpriteCanvas('#ffffff', 64));
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }, []);

  useEffect(() => {
    return () => {
      comaTexture.dispose();
      comaCoreTexture.dispose();
    };
  }, [comaTexture, comaCoreTexture]);

  // R2-3：卸载时清除渲染相位注册与钳制提示上报
  useEffect(() => {
    const bodyId = data.id;
    return () => {
      clearRenderedSatellitePhase(bodyId);
      if (clampedRef.current) {
        clampedRef.current = false;
        useSimulationStore
          .getState()
          .setPlanetRateClampNotice(reportPlanetRateClamp(bodyId, false));
      }
    };
  }, [data.id]);

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

  // 粒子彗尾资产（确定性种子派生自彗星 id）
  const ionTail = useMemo(
    () =>
      createTailAssets(ION_TAIL_PARTICLES, shapeSeed(data.id) + 101, {
        colorCore: '#eaf6ff',
        colorEdge: '#3f8fff',
        coreRadius: ION_CORE_RADIUS,
        maxRadius: ION_MAX_RADIUS,
        size: 5.5,
      }),
    [data.id],
  );
  const dustTail = useMemo(
    () =>
      createTailAssets(DUST_TAIL_PARTICLES, shapeSeed(data.id) + 202, {
        colorCore: '#fff3d8',
        colorEdge: '#d8b890',
        coreRadius: DUST_CORE_RADIUS,
        maxRadius: DUST_MAX_RADIUS,
        size: 7.0,
      }),
    [data.id],
  );

  useEffect(() => {
    return () => {
      ionTail.geometry.dispose();
      ionTail.material.dispose();
      dustTail.geometry.dispose();
      dustTail.material.dispose();
    };
  }, [ionTail, dustTail]);

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

  useFrame(({ clock }) => {
    const state = useSimulationStore.getState();
    const { simDays, continuousLevel } = state;
    const group = groupRef.current;
    if (!group) return;

    // R2-3 外层视角退化（与行星一致）：2.6→3.0 渐变淡出（缩放收敛登记同
    // Planet.tsx），淡出完毕冻结演算；返回时按共享时间轴重求
    const weight = planetVisibilityWeight(continuousLevel);
    group.visible = weight > 0;
    group.scale.setScalar(Math.max(weight, 1e-6));
    if (labelElRef.current) {
      labelElRef.current.style.opacity = weight.toFixed(3);
    }
    if (weight === 0) {
      if (clampedRef.current) {
        clampedRef.current = false;
        clearRenderedSatellitePhase(data.id);
        const notice = reportPlanetRateClamp(data.id, false);
        if (notice !== state.planetRateClampNotice) state.setPlanetRateClampNotice(notice);
      }
      clampedPhaseRef.current = null;
      lastSimDaysRef.current = null;
      return;
    }

    // R2-3 速率钳制兜底（与行星一致 0.5 圈/秒阈值）：钳制中按降速角速度
    // 累计相位，以等效时间调用开普勒求解入口（位置/速度/活动度全链一致）
    const compression = timeCompressionForContinuousLevel(continuousLevel);
    const factor = rateClampFactor(periodDays, compression, state.speedMultiplier);
    const clamped = factor < 1;
    if (clamped !== clampedRef.current) {
      clampedRef.current = clamped;
      if (!clamped) clearRenderedSatellitePhase(data.id);
      const notice = reportPlanetRateClamp(data.id, clamped);
      if (notice !== state.planetRateClampNotice) state.setPlanetRateClampNotice(notice);
    }
    const meanMotion = (Math.PI * 2) / periodDays;
    let orbitDays = simDays;
    if (clamped) {
      const exactPhase = normalizeAngle(
        data.orbit.meanAnomalyAtEpochDeg * DEG_TO_RAD + meanMotion * simDays,
      );
      const last = lastSimDaysRef.current;
      clampedPhaseRef.current = advanceClampedPhase(
        last === null ? null : clampedPhaseRef.current,
        exactPhase,
        last === null ? 0 : simDays - last,
        meanMotion,
        factor,
      );
      setRenderedSatellitePhase(data.id, clampedPhaseRef.current);
      orbitDays = equivalentDaysForPhase(
        clampedPhaseRef.current,
        data.orbit.meanAnomalyAtEpochDeg,
        periodDays,
      );
    } else {
      clampedPhaseRef.current = null;
    }
    lastSimDaysRef.current = simDays;

    const ecliptic = heliocentricPosition(data.orbit, orbitDays);
    const scene = eclipticToScene(ecliptic);
    group.position.set(scene.x, scene.y, scene.z);

    const distanceAu = Math.hypot(ecliptic.x, ecliptic.y, ecliptic.z);
    // 活动度：近日点 1 → 激活阈值 0（utils/cometTail.cometActivity01）
    const activity = cometActivity01(distanceAu, data.tailActivationAu);

    // P4 彗核近观门控（仅 L1 近观渲染细节几何/纹理）
    const distToComet = camera.position.distanceTo(group.position);
    // R3-4：近距标签避让（P7 同款，Moon 阈值风格 max(1.2, 半径×6)）
    const hideLabel = distToComet < Math.max(1.2, NUCLEUS_RADIUS_UNITS * 6);
    if (hideLabel !== labelHiddenRef.current) {
      labelHiddenRef.current = hideLabel;
      setLabelHidden(hideLabel);
    }
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
    // 彗核缓慢自转（哈雷自转周期约 2.2 天，ESA Giotto）；R2-3：钳制中沿
    // 等效时间轴推进（与公转位置同一时间轴）
    if (nucleusRef.current) {
      nucleusRef.current.rotation.y = (orbitDays / 2.2) * Math.PI * 2;
      nucleusRef.current.rotation.z = 0.35;
    }

    if (comaRef.current) {
      const comaScale = 0.6 + activity * 2.2;
      comaRef.current.scale.set(comaScale, comaScale, comaScale);
      (comaRef.current.material as THREE.SpriteMaterial).opacity = 0.15 + activity * 0.8;
      comaRef.current.visible = activity > 0.01;
    }
    // 彗发内层白心（约外层 42% 尺寸，更亮——层次感与尾根融合）
    if (comaCoreRef.current) {
      const coreScale = (0.6 + activity * 2.2) * 0.42;
      comaCoreRef.current.scale.set(coreScale, coreScale, coreScale);
      (comaCoreRef.current.material as THREE.SpriteMaterial).opacity = 0.1 + activity * 0.85;
      comaCoreRef.current.visible = activity > 0.01;
    }

    // 离子尾方向：严格背向太阳（utils/cometTail.ionTailDirection）
    const anti = ionTailDirection({ x: scene.x, y: scene.y, z: scene.z });
    tailDirection.set(anti.x, anti.y, anti.z);
    tailQuaternion.setFromUnitVectors(UP, tailDirection);

    const elapsed = clock.elapsedTime;
    const tailLength = ionTailLengthUnits(activity);
    if (ionTailRef.current) {
      ionTailRef.current.visible = activity > 0.05;
      // 粒子尾根在彗核原点、沿局部 -Y 延伸，仅需对齐尾轴
      ionTailRef.current.quaternion.copy(tailQuaternion);
      const u = ionTail.material.uniforms;
      u.uLength.value = Math.max(tailLength, 0.01);
      u.uFlow.value = (elapsed / ION_FLOW_CYCLE_SEC) % 1;
      u.uTime.value = elapsed;
      // 摆幅随活动度增强（远离太阳时太阳风扰动表现减弱）
      u.uSwayAmp.value = ION_SWAY_AMP * activity;
      u.uOpacity.value = activity * 0.85;
    }

    // 尘埃尾（P4）：沿轨道后方弯曲——弯曲量随轨道速度/日心距变化
    if (dustTailRef.current) {
      const dustLength = dustTailLengthUnits(activity);
      dustTailRef.current.visible = activity > 0.05;

      const vel = orbitalVelocityAuPerDay(data.orbit, orbitDays);
      // 黄道坐标 → 场景坐标方向（与 eclipticToScene 同轴序，方向无需缩放）
      const velScene = { x: vel.x, y: vel.z, z: -vel.y };
      const speed = Math.hypot(vel.x, vel.y, vel.z);
      const bend = dustTailBendMagnitude(speed, distanceAu);
      const bendDir = dustTailBendDirection(anti, velScene);
      const u = dustTail.material.uniforms;
      if (bendDir) {
        // 局部基：+X = 弯曲方向、-Y = 尾轴（尖端朝彗核，与粒子布局一致）
        dustBasis.x.set(bendDir.x, bendDir.y, bendDir.z);
        dustBasis.y.copy(tailDirection).negate();
        dustBasis.z.crossVectors(dustBasis.x, dustBasis.y);
        dustBasis.m.makeBasis(dustBasis.x, dustBasis.y, dustBasis.z);
        dustTailRef.current.quaternion.setFromRotationMatrix(dustBasis.m);
        // 世界横向偏移 = bend·尾长·t²（dustTailBendOffset 镜像）
        u.uBendWorld.value = bend * dustLength;
      } else {
        dustTailRef.current.quaternion.copy(tailQuaternion);
        u.uBendWorld.value = 0;
      }
      u.uLength.value = Math.max(dustLength, 0.01);
      u.uFlow.value = (elapsed / DUST_FLOW_CYCLE_SEC) % 1;
      u.uTime.value = elapsed;
      u.uOpacity.value = activity * 0.55;
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

      {/* 彗发（近日点附近出现）：外层彩色晕 + 内层亮白心 */}
      <sprite ref={comaRef}>
        <spriteMaterial
          map={comaTexture}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </sprite>
      <sprite ref={comaCoreRef}>
        <spriteMaterial
          map={comaCoreTexture}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </sprite>

      {/* 离子尾：蓝色细长粒子流（严格背向太阳，流动 + 太阳风摆动） */}
      <points ref={ionTailRef} geometry={ionTail.geometry} material={ionTail.material} />

      {/* 尘埃尾：黄白色宽短粒子流，沿轨道后方二次弯曲（P4 公式不变） */}
      <points ref={dustTailRef} geometry={dustTail.geometry} material={dustTail.material} />

      {showLabels && !frozen && !focused && !labelHidden && (
        // R3-4：近距反向缩放钳制 + 焦点/近距隐藏（治理缺口补齐，§4.1-D）
        <ClampedHtmlLabel
          position={[0, 0.8, 0]}
          distanceFactor={60}
          style={{ pointerEvents: 'none' }}
        >
          <span ref={labelElRef} className="whitespace-nowrap text-xs text-cyan-200/80">
            <BodyNameText body={data} />
          </span>
        </ClampedHtmlLabel>
      )}
    </group>
  );
}
