'use client';


import type { JSX } from 'react';
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useSimulationStore } from '@/store';
import type { Vec3 } from '@/types';
import { getPlanetById } from '@/data/planets';
import { eventAutoTriggerAllowed } from '@/utils/eventScopes';
import { qualityTierSpec } from '@/utils/qualityTier';
import { heliocentricPosition } from '@/utils/physics';
import { createSeededRandom } from '@/utils/random';
import { eclipticToScene, trapezoidWeight } from '@/utils/scale';
import {
  CME_INDEPENDENT_MEAN_INTERVAL_DAYS,
  CME_MAX_RADIUS_UNITS,
  CME_PARTICLE_COUNT,
  CORONAL_LOOP_HEIGHT_RATIO,
  CORONAL_LOOP_MAX,
  coronalLoopArcadeHeightScale,
  coronalLoopArcadeOffset,
  coronalLoopCountForGroup,
  FLARE_RISE_FRACTION,
  PROMINENCE_COUNT,
  PROMINENCE_EVOLVE_DAYS,
  PROMINENCE_HEIGHT_FRAC,
  PROMINENCE_SPAN_RAD,
  prominenceEruptionLift,
  WIND_BASE_ALPHA,
  WIND_MAX_RADIUS_UNITS,
  WIND_PARTICLE_COUNT,
  cmeAcceleratedElapsedDays,
  cmeConeDirections,
  cmeIsEarthDirected,
  cmeLayerBrightness,
  cmeLayerRadialFactor,
  cmeLinkProbability,
  cmeOpacity01,
  cmeParticleLayer,
  cmeProgress01,
  cmeShellRadiusUnits,
  cmeSpeedForClass,
  cycleModulatedMeanInterval,
  FLARE_MEAN_INTERVAL_DAYS,
  flareClassRoll,
  flareMagnitudeRoll,
  flareMultiPeakIntensity01,
  flareProgress01,
  kmPerSecToUnitsPerDay,
  loopArcPoint,
  POST_FLARE_LOOP_COUNT,
  POST_FLARE_LOOP_HEIGHT_RATIO,
  postFlareLoopStrength01,
  prominenceEvolveFactor,
  prominenceIsActive,
  PROMINENCE_ACTIVE_FIBRIL_AMP,
  PROMINENCE_FIBRIL_FREQ,
  PROMINENCE_QUIET_FIBRIL_AMP,
  shouldAutoTriggerFlare,
  SUN_ROTATION_RAD_PER_DAY,
  windCycleDays,
  windShaderDays,
  windSpeedFactorForDirection,
  cirBrightnessFactor,
  cmeArrivalDelayDays,
  AURORA_ENHANCEMENT_DAYS,
} from '@/utils/solarActivity';
import { CORONAL_HOLE_DIR } from '@/utils/sunSurface';
import { solarRotationAngleRad } from '@/utils/solarRotation';
import type { SunspotGroup } from '@/utils/sunspots';
import {
  SUNSPOT_PAIR_SLOTS,
  activeRegionLatLon,
  createSunspotGroup,
  sunspotDirection,
  sunspotEarthCount,
  sunspotGroupInto,
  sunspotHash01,
} from '@/utils/sunspots';
import { advanceCutawayProgress, externalActivityFade } from '@/utils/sunCutaway';
import { cycleFrequencyFactor, cycleSunspotEnvelope, solarCyclePhase01 } from '@/utils/solarCycle';

/**
 * 太阳活动系统（S2，IMPROVEMENT_REQUIREMENTS_SOLAR §4.3/§5）：
 * 太阳风常驻粒子外流 + CME 粒子壳层事件 + 耀斑辉光与事件驱动 +
 * 日珥/日冕环（锚定活动区、随较差自转移动、缓慢演化）。
 *
 * - 粒子推进全部在顶点着色器完成（Belt.tsx 范式）：参数烘进 attribute，
 *   每帧仅更新标量 uniform；渲染循环零分配（临时向量 useMemo 复用）。
 * - 事件驱动（超新星范式）：泊松自动触发 + 手动演示（ControlPanel）+
 *   耀斑→CME 联动（X/M 级按观测关联概率）；全部由模拟时间轴驱动
 *   （暂停冻结、快进联动、时间跳变重置）。
 * - 可见性门控（§5.2 硬性）：层级淡出 + 剖面模式互斥淡出；组不可见时
 *   跳过全部视觉/uniform 更新（事件生命周期仍推进，保证事件正常收尾）。
 * - 粒子预算（§5.3）：太阳风 6,000 + CME 9,000 = 峰值 15,000 ≤ 20,000。
 *
 * 纯逻辑镜像与艺术化登记见 utils/solarActivity.ts 文件头
 * （耀斑时长减速/触发频率理想化/CME 回收边界/日珥高度放大）。
 */

/** 太阳风粒子方向种子（确定性） */
const WIND_SEED = 20260724;

/** CME 锥面粒子种子（确定性，事件间复用同一缓冲） */
const CME_SEED = 20260725;

/** 日珥锚点（确定性哈希导出：纬度 ±12°–40°、初始经度、演化种子） */
const PROMINENCES = Array.from({ length: PROMINENCE_COUNT }, (_, i) => {
  const h1 = sunspotHash01(i, 0, 41);
  const h2 = sunspotHash01(i, 0, 42);
  const h3 = sunspotHash01(i, 0, 43);
  return {
    latRad: (((h1 < 0.5 ? -1 : 1) * (12 + 28 * h2)) * Math.PI) / 180,
    lon0Rad: h3 * Math.PI * 2,
    seed01: h1,
  };
});

const EARTH = getPlanetById('earth');

/** 日→地方向（场景坐标单位矢量，CME 朝地球判定用） */
export function earthDirectionAt(simDays: number): Vec3 {
  if (!EARTH) return { x: 1, y: 0, z: 0 };
  const scene = eclipticToScene(heliocentricPosition(EARTH.orbit, simDays));
  const len = Math.hypot(scene.x, scene.y, scene.z) || 1;
  return { x: scene.x / len, y: scene.y / len, z: scene.z / len };
}

/** 耀斑事件参数（自动触发/手动演示共用；级别/量级/活动区锚定/CME 联动判定） */
export function rollFlareParams(
  simDays: number,
  rand: () => number = Math.random,
): {
  flareClass: 'C' | 'M' | 'X';
  magnitude: number;
  sourceDir: Vec3;
  startedAtSimDays: number;
  cmeLinked: boolean;
} {
  const flareClass = flareClassRoll(rand());
  const region = activeRegionLatLon(simDays, rand());
  return {
    flareClass,
    magnitude: flareMagnitudeRoll(rand()),
    sourceDir: sunspotDirection(region.latRad, region.lonRad),
    startedAtSimDays: simDays,
    cmeLinked: rand() < cmeLinkProbability(flareClass),
  };
}

/** CME 事件参数（独立触发/手动演示共用；方向源自活动区、朝地球判定） */
export function rollCmeParams(
  simDays: number,
  rand: () => number = Math.random,
): { direction: Vec3; speedKmS: number; startedAtSimDays: number; earthDirected: boolean } {
  const region = activeRegionLatLon(simDays, rand());
  const direction = sunspotDirection(region.latRad, region.lonRad);
  return {
    direction,
    speedKmS: cmeSpeedForClass(flareClassRoll(rand()), rand()),
    startedAtSimDays: simDays,
    earthDirected: cmeIsEarthDirected(direction, earthDirectionAt(simDays)),
  };
}

/** 日珥/日冕环单位弧线（utils/solarActivity.loopArcPoint 包装） */
class ArcCurve extends THREE.Curve<THREE.Vector3> {
  constructor(private readonly heightRatio: number) {
    super();
  }

  getPoint(t: number, target: THREE.Vector3 = new THREE.Vector3()): THREE.Vector3 {
    const p = loopArcPoint(t, this.heightRatio);
    return target.set(p.x, p.y, p.z);
  }
}

interface SunActivityProps {
  /** 太阳显示半径（场景单位，随真实比例模式变化） */
  radius: number;
}

export function SunActivity({ radius }: SunActivityProps): JSX.Element {
  const groupRef = useRef<THREE.Group>(null);
  const cmePointsRef = useRef<THREE.Points>(null);
  const flareGlowRef = useRef<THREE.Sprite>(null);
  const promMeshRefs = useRef<Array<THREE.Mesh | null>>([]);
  const loopMeshRefs = useRef<Array<THREE.Mesh | null>>([]);
  // S3 §4.5：黑子群/日珥点选热区（不可见球体，随特征位置更新）
  const spotHotspotRefs = useRef<Array<THREE.Mesh | null>>([]);
  const promHotspotRefs = useRef<Array<THREE.Mesh | null>>([]);
  // 缓存各黑子槽位当前渲染半径（供点选换算"可容纳 N 个地球"）
  const spotRadiusRef = useRef<Float32Array>(new Float32Array(SUNSPOT_PAIR_SLOTS));
  // 剖面互斥淡出进度（0 无剖面 → 1 全剖面）
  const cutawayFadeRef = useRef(0);
  const lastSimDaysRef = useRef<number | null>(null);
  // 每个耀斑事件至多联动一次 CME
  const linkedFlareIdRef = useRef<string | null>(null);
  // S3 爆发日珥前导：记录最近触发的 CME id、被选中拉升的日珥索引与起始时间
  const eruptCmeIdRef = useRef<string | null>(null);
  const eruptPromIndexRef = useRef<number>(-1);
  const eruptStartDaysRef = useRef<number>(0);

  const windStartRadius = radius * 1.15;
  const windCycle = useMemo(() => windCycleDays(windStartRadius), [windStartRadius]);

  // M2-3 太阳活动粒子按设备档缩放（qualityTier.ts：1 / 1 / 0.5——low 档
  // 风 3,000 + CME 4,500 = 峰值 7,500，近观预算 10,000 内；floor 缩放，
  // 比例 1 恒等 = 现状零回退；确定性种子序列不变，前 N 粒子一致）
  const solarScale = qualityTierSpec(useSimulationStore.getState().deviceTier).solarParticleScale;
  const windCount = Math.floor(WIND_PARTICLE_COUNT * solarScale);
  const cmeCount = Math.floor(CME_PARTICLE_COUNT * solarScale);

  // ---- 太阳风常驻粒子（§4.3-4 + S4 D1 帕克螺旋 / D2 CIR）----
  const wind = useMemo(() => {
    const rand = createSeededRandom(WIND_SEED);
    const dirs = new Float32Array(windCount * 3);
    const seeds = new Float32Array(windCount);
    // S3 日冕洞快风：粒子方向落在冕洞锥内时速度增益（快风源）
    const speedFac = new Float32Array(windCount);
    // S4 D2 CIR：快慢风交界带密度/亮度增强（方向静态，烘进 attribute）
    const cirFac = new Float32Array(windCount);
    for (let i = 0; i < windCount; i += 1) {
      // 均匀球面方向（全方向外流）
      const cosPolar = rand() * 2 - 1;
      const sinPolar = Math.sqrt(Math.max(0, 1 - cosPolar * cosPolar));
      const azimuth = rand() * Math.PI * 2;
      const dx = sinPolar * Math.cos(azimuth);
      const dy = cosPolar;
      const dz = sinPolar * Math.sin(azimuth);
      dirs[i * 3] = dx;
      dirs[i * 3 + 1] = dy;
      dirs[i * 3 + 2] = dz;
      seeds[i] = rand();
      // 方向与日冕洞方向的余弦 → 速度因子（快慢风方向加权，确定性）
      const cosHole = dx * CORONAL_HOLE_DIR.x + dy * CORONAL_HOLE_DIR.y + dz * CORONAL_HOLE_DIR.z;
      speedFac[i] = windSpeedFactorForDirection(cosHole);
      cirFac[i] = cirBrightnessFactor(cosHole);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(windCount * 3), 3));
    geometry.setAttribute('aDir', new THREE.BufferAttribute(dirs, 3));
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    geometry.setAttribute('aSpeedFac', new THREE.BufferAttribute(speedFac, 1));
    geometry.setAttribute('aCir', new THREE.BufferAttribute(cirFac, 1));
    // 位置由着色器计算，手动设置包围球供视锥剔除
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), WIND_MAX_RADIUS_UNITS * 1.1);
    // S4 D1 帕克螺旋：外边界累计缠绕角 = Ω × 慢风抵达时长（快风按 aSpeedFac 缩短）
    const spiralTotalRad = SUN_ROTATION_RAD_PER_DAY * windCycle;
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uDays: { value: 0 },
        uCycleDays: { value: windCycle },
        uR0: { value: windStartRadius },
        uRMax: { value: WIND_MAX_RADIUS_UNITS },
        uSize: { value: 1.1 },
        uAlpha: { value: 0 },
        // D1：慢风粒子到外边界的累计方位缠绕角（弧度）
        uSpiralRad: { value: spiralTotalRad },
      },
      vertexShader: /* glsl */ `
        attribute vec3 aDir;
        attribute float aSeed;
        attribute float aSpeedFac;
        attribute float aCir;
        uniform float uDays;
        uniform float uCycleDays;
        uniform float uR0;
        uniform float uRMax;
        uniform float uSize;
        uniform float uSpiralRad;
        varying float vPhase;
        varying float vCir;
        void main() {
          // 外流相位循环回收（solarActivity.windPhase01 镜像）；
          // S3 日冕洞快风：该方向粒子相位推进更快（速度增益）
          float phase = fract(uDays * aSpeedFac / uCycleDays + aSeed);
          vPhase = phase;
          vCir = aCir;
          // S4 D1 帕克螺旋（solarActivity.parkerSpiralOffsetRad 镜像）：
          // 源点随太阳自转而风径向外流，流线弯成阿基米德螺旋——
          // 方位偏转 Δφ = −Ω·t_travel·phase（快风更直、慢风更弯）
          float ang = -uSpiralRad / aSpeedFac * phase;
          float ca = cos(ang);
          float sa = sin(ang);
          vec3 dir = vec3(aDir.x * ca - aDir.z * sa, aDir.y, aDir.x * sa + aDir.z * ca);
          vec3 pos = dir * mix(uR0, uRMax, phase);
          vec4 mv = modelViewMatrix * vec4(pos, 1.0);
          gl_PointSize = uSize * (320.0 / -mv.z);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uAlpha;
        varying float vPhase;
        varying float vCir;
        void main() {
          vec2 c = gl_PointCoord - vec2(0.5);
          float d2 = dot(c, c);
          if (d2 > 0.25) discard;
          float soft = 1.0 - smoothstep(0.0, 0.25, d2);
          // 亮度随外流衰减（windParticleAlpha 镜像）× S4 D2 CIR 交界带增强
          float a = uAlpha * (1.0 - vPhase) * soft * vCir;
          gl_FragColor = vec4(vec3(1.0, 0.94, 0.8) * a, a);
        }
      `,
    });
    return { geometry, material };
  }, [windCycle, windStartRadius, windCount]);

  // ---- CME 粒子壳层（§4.3-3 + S4 C1 三分量 / C2 加速段）----
  const cme = useMemo(() => {
    const rand = createSeededRandom(CME_SEED);
    const dirs = cmeConeDirections(cmeCount, rand);
    const jitter = new Float32Array(cmeCount);
    const seeds = new Float32Array(cmeCount);
    // S4 C1 三分量：每粒子径向位置因子（亮核/暗腔/亮前沿）+ 分层亮度
    const radFactor = new Float32Array(cmeCount);
    const layerBright = new Float32Array(cmeCount);
    for (let i = 0; i < cmeCount; i += 1) {
      // 壳层厚度：径向速度抖动 ±15%（壳层随扩张增厚，真实 CME 形态）
      jitter[i] = 0.85 + 0.3 * rand();
      seeds[i] = rand();
      const layer = cmeParticleLayer(rand());
      radFactor[i] = cmeLayerRadialFactor(layer, rand());
      layerBright[i] = cmeLayerBrightness(layer);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(cmeCount * 3), 3));
    geometry.setAttribute('aDir', new THREE.BufferAttribute(dirs, 3));
    geometry.setAttribute('aJitter', new THREE.BufferAttribute(jitter, 1));
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    geometry.setAttribute('aRadFactor', new THREE.BufferAttribute(radFactor, 1));
    geometry.setAttribute('aLayerBright', new THREE.BufferAttribute(layerBright, 1));
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), CME_MAX_RADIUS_UNITS * 1.2);
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        // C2：等效已行进时间（加速段 → 匀速，CPU 侧 cmeAcceleratedElapsedDays 换算）
        uElapsedDays: { value: 0 },
        uSpeed: { value: 0 },
        uR0: { value: radius * 1.05 },
        uSize: { value: 1.5 },
        uOpacity: { value: 0 },
      },
      vertexShader: /* glsl */ `
        attribute vec3 aDir;
        attribute float aJitter;
        attribute float aSeed;
        attribute float aRadFactor;
        attribute float aLayerBright;
        uniform float uElapsedDays;
        uniform float uSpeed;
        uniform float uR0;
        uniform float uSize;
        varying float vSeed;
        varying float vBright;
        void main() {
          // 壳层扩张（uElapsedDays 已含 C2 加速段等效时间换算）；
          // S4 C1：径向位置按三分量因子分层（亮核内 / 暗腔中 / 亮前沿外）
          float rFront = uR0 + uSpeed * uElapsedDays * aJitter;
          float r = uR0 + (rFront - uR0) * aRadFactor;
          vSeed = aSeed;
          vBright = aLayerBright;
          vec3 pos = aDir * r;
          vec4 mv = modelViewMatrix * vec4(pos, 1.0);
          gl_PointSize = uSize * (320.0 / -mv.z);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uOpacity;
        varying float vSeed;
        varying float vBright;
        void main() {
          vec2 c = gl_PointCoord - vec2(0.5);
          float d2 = dot(c, c);
          if (d2 > 0.25) discard;
          float soft = 1.0 - smoothstep(0.0, 0.25, d2);
          // S4 C1：分层亮度（暗腔显著偏暗、亮前沿/亮核明亮），核偏白暖
          float a = uOpacity * vBright * (0.55 + 0.45 * vSeed) * soft;
          vec3 col = mix(vec3(1.0, 0.55, 0.32), vec3(1.0, 0.82, 0.6), vBright);
          gl_FragColor = vec4(col * a, a);
        }
      `,
    });
    return { geometry, material };
  }, [radius, cmeCount]);

  // ---- 耀斑辉光广告牌（局部增亮的体积感补充，Bloom 联动） ----
  const flareGlow = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
      gradient.addColorStop(0, 'rgba(255, 250, 230, 0.9)');
      gradient.addColorStop(0.3, 'rgba(255, 210, 120, 0.4)');
      gradient.addColorStop(1, 'rgba(255, 170, 60, 0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 128, 128);
    }
    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      opacity: 0,
    });
    return { texture, material };
  }, []);

  // ---- 日珥 / 日冕环（§4.3-6、§4.2）：共享单位弧线 tube 几何 + 材质池 ----
  const arcs = useMemo(() => {
    const promGeometry = new THREE.TubeGeometry(new ArcCurve(1), 32, 0.05, 6, false);
    // S4 E1 日珥纤维结构（§4.7-E1）：沿弧细丝条纹调制不透明度
    // （solarActivity.prominenceFibrilFactor 镜像），宁静/活动日珥幅度分档
    const promMaterials = Array.from({ length: PROMINENCE_COUNT }, (_, i) => {
      const isActive = prominenceIsActive(PROMINENCES[i].seed01);
      return new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: {
          uOpacity: { value: 0 },
          uAmp: {
            value: isActive ? PROMINENCE_ACTIVE_FIBRIL_AMP : PROMINENCE_QUIET_FIBRIL_AMP,
          },
          uTime: { value: 0 },
        },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform float uOpacity;
          uniform float uAmp;
          uniform float uTime;
          varying vec2 vUv;
          float hash3(vec3 p) {
            return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
          }
          void main() {
            // 沿弧细丝条纹（prominenceFibrilFactor 镜像）：uv.x 沿弧参数
            float n = hash3(vec3(floor(vUv.x * 20.0), floor(vUv.y * 4.0), floor(uTime)));
            float stripes = sin(vUv.x * ${PROMINENCE_FIBRIL_FREQ.toFixed(1)} * 3.14159265 + (n - 0.5) * 4.0);
            float fibril = max(0.0, 1.0 + uAmp * stripes * (0.6 + 0.4 * n));
            float a = uOpacity * fibril;
            gl_FragColor = vec4(vec3(1.0, 0.33, 0.25) * a, a);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }
        `,
      });
    });
    const loopGeometry = new THREE.TubeGeometry(
      new ArcCurve(CORONAL_LOOP_HEIGHT_RATIO),
      32,
      0.035,
      6,
      false,
    );
    const loopMaterials = Array.from(
      { length: CORONAL_LOOP_MAX },
      () =>
        new THREE.MeshBasicMaterial({
          color: '#ffd9a0',
          transparent: true,
          opacity: 0,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
    );
    return { promGeometry, promMaterials, loopGeometry, loopMaterials };
  }, []);

  // 渲染循环复用的临时对象（禁止每帧分配）
  const tmp = useMemo(
    () => ({
      v1: new THREE.Vector3(),
      v2: new THREE.Vector3(),
      center: new THREE.Vector3(),
      xAxis: new THREE.Vector3(),
      zAxis: new THREE.Vector3(),
      matrix: new THREE.Matrix4(),
      up: new THREE.Vector3(0, 1, 0),
      cmeDir: new THREE.Vector3(),
      // S4 E2：磁环族渲染复用群结构 + 中性线法向偏移向量（零分配）
      group: createSunspotGroup() as SunspotGroup,
      arcadeOffset: new THREE.Vector3(),
      normal: new THREE.Vector3(),
      // S4 B3：耀斑后环与常态日冕环的池化材质颜色（预分配防每帧解析）
      loopColorDefault: new THREE.Color('#ffd9a0'),
      loopColorPostFlare: new THREE.Color('#fff3d0'),
    }),
    [],
  );

  // 卸载释放（AGENTS.md 内存管理）
  useEffect(() => {
    return () => {
      wind.geometry.dispose();
      wind.material.dispose();
      cme.geometry.dispose();
      cme.material.dispose();
      flareGlow.texture.dispose();
      flareGlow.material.dispose();
      arcs.promGeometry.dispose();
      for (const material of arcs.promMaterials) {
        material.dispose();
      }
      arcs.loopGeometry.dispose();
      for (const material of arcs.loopMaterials) {
        material.dispose();
      }
    };
  }, [wind, cme, flareGlow, arcs]);

  /** 弧线放置（日珥/日冕环共用）：贴附日面、+Y 对准径向、X 沿足点连线 */
  const placeArc = (
    mesh: THREE.Mesh,
    centerDir: THREE.Vector3,
    xAxis: THREE.Vector3,
    halfSpanRad: number,
    heightUnits: number,
  ): void => {
    const chord = 2 * radius * Math.sin(halfSpanRad);
    tmp.zAxis.crossVectors(xAxis, centerDir).normalize();
    xAxis.crossVectors(centerDir, tmp.zAxis).normalize();
    tmp.matrix.makeBasis(xAxis, centerDir, tmp.zAxis);
    mesh.quaternion.setFromRotationMatrix(tmp.matrix);
    mesh.position.copy(centerDir).multiplyScalar(radius * Math.cos(halfSpanRad));
    mesh.scale.set(chord, heightUnits, chord * 0.6);
  };

  useFrame((_, rawDelta) => {
    const state = useSimulationStore.getState();
    const { simDays, continuousLevel, viewLevel, activeSolarFlare, activeCme, sunCutawayMode } =
      state;

    // ---- 事件生命周期（组不可见时仍推进，保证事件正常触发/收尾）----
    const last = lastSimDaysRef.current;
    lastSimDaysRef.current = simDays;
    // 时间跳变（回退/超大步进）只重置基准，不触发/不残留（需求 §8）
    const delta = last === null ? 0 : simDays - last;
    const timeJumped = delta < 0 || delta > 50;
    // R2-4 §4.1-D：耀斑/CME 泊松自动触发显式限定太阳系视角域（R5-8：
    // 判定源改离散 viewLevel ∈ {L1, L2}——跟随巡游天体期间与 HUD 视角
    // 标签一致，不随相机距离误触发）。此前 L3/L4 停摆仅是高时间压缩比下
    // delta>50 天恒触发 timeJumped 守卫的副作用，非显式设计；timeJumped
    // 本身的时间跳变防护语义保留。域外仅抑制新触发，活跃事件的衰减/收尾
    // 照常推进（§4.2 验收 3）。
    const solarAutoTriggerInScope = eventAutoTriggerAllowed('flare', viewLevel);

    if (activeSolarFlare) {
      const progress = flareProgress01(
        simDays,
        activeSolarFlare.startedAtSimDays,
        activeSolarFlare.durationDays,
      );
      if (progress >= 1 || progress < 0) {
        state.completeSolarFlare();
      } else if (
        activeSolarFlare.cmeLinked &&
        !activeCme &&
        progress >= FLARE_RISE_FRACTION &&
        linkedFlareIdRef.current !== activeSolarFlare.id
      ) {
        // 耀斑峰值联动 CME（§4.3-2/3）：方向沿耀斑源区
        linkedFlareIdRef.current = activeSolarFlare.id;
        const dir = activeSolarFlare.sourceDir;
        state.triggerCme({
          direction: dir,
          speedKmS: cmeSpeedForClass(activeSolarFlare.flareClass, Math.random()),
          startedAtSimDays: simDays,
          earthDirected: cmeIsEarthDirected(dir, earthDirectionAt(simDays)),
        });
      }
    } else if (!sunCutawayMode && !timeJumped && solarAutoTriggerInScope) {
      // S3 周期联动（§4.4）：耀斑泊松均值按活动周期频率因子缩放
      // （极大期更频繁、极小期更稀疏）
      const freqFactor = cycleFrequencyFactor(cycleSunspotEnvelope(solarCyclePhase01(simDays)));
      const flareMean = cycleModulatedMeanInterval(FLARE_MEAN_INTERVAL_DAYS, freqFactor);
      if (shouldAutoTriggerFlare(Math.random(), delta, flareMean)) {
        state.triggerSolarFlare(rollFlareParams(simDays));
      }
    }

    if (activeCme) {
      const elapsed = simDays - activeCme.startedAtSimDays;
      // S4 C2 加速段：以名义抵达时长定加速段长度，等效时间代入匀速公式
      const speedUnits = kmPerSecToUnitsPerDay(activeCme.speedKmS);
      const travelDays = (CME_MAX_RADIUS_UNITS - radius * 1.05) / speedUnits;
      const shellRadius = cmeShellRadiusUnits(
        cmeAcceleratedElapsedDays(Math.max(0, elapsed), travelDays),
        speedUnits,
        radius * 1.05,
      );
      if (elapsed < 0 || shellRadius >= CME_MAX_RADIUS_UNITS) {
        state.completeCme();
      }
    } else if (!sunCutawayMode && !timeJumped && solarAutoTriggerInScope) {
      // 独立低概率 CME（无耀斑前导，§4.3-3 触发方式）；
      // S3 周期联动：均值同样按频率因子缩放
      const freqFactor = cycleFrequencyFactor(cycleSunspotEnvelope(solarCyclePhase01(simDays)));
      const cmeMean = cycleModulatedMeanInterval(CME_INDEPENDENT_MEAN_INTERVAL_DAYS, freqFactor);
      if (shouldAutoTriggerFlare(Math.random(), delta, cmeMean)) {
        state.triggerCme(rollCmeParams(simDays));
      }
    }

    // ---- S3 爆发日珥前导（§4.3-6）：新 CME 触发时选取最接近抛射方向的
    // 日珥拉升脱离作为前导（联动动画，日珥池复用）----
    if (activeCme && activeCme.id !== eruptCmeIdRef.current) {
      eruptCmeIdRef.current = activeCme.id;
      // 选取当前方位与 CME 抛射方向夹角最小的日珥
      let bestIdx = -1;
      let bestDot = -Infinity;
      for (let i = 0; i < PROMINENCE_COUNT; i += 1) {
        const anchor = PROMINENCES[i];
        const lonRad = anchor.lon0Rad + solarRotationAngleRad(anchor.latRad, simDays);
        const dir = sunspotDirection(anchor.latRad, lonRad);
        const d =
          dir.x * activeCme.direction.x +
          dir.y * activeCme.direction.y +
          dir.z * activeCme.direction.z;
        if (d > bestDot) {
          bestDot = d;
          bestIdx = i;
        }
      }
      eruptPromIndexRef.current = bestIdx;
      eruptStartDaysRef.current = simDays;
      // S3 CME 抵达地球（§4.3-3）：朝地球 CME 按传播延迟排定抵达时间
      if (activeCme.earthDirected) {
        state.scheduleCmeArrival(simDays + cmeArrivalDelayDays(activeCme.speedKmS));
      }
    }
    if (!activeCme) {
      eruptCmeIdRef.current = null;
      eruptPromIndexRef.current = -1;
    }
    // CME 抵达地球检测（模拟时间越过排定抵达时刻，非时间跳变时触发）
    if (
      state.cmeArrivalSimDays !== null &&
      !timeJumped &&
      simDays >= state.cmeArrivalSimDays
    ) {
      state.triggerCmeArrival(simDays);
    }
    // 极光增强窗口结束后清除（Planet.tsx 读取 auroraStartedAtSimDays 增亮大气）
    if (state.auroraStartedAtSimDays !== null) {
      const since = simDays - state.auroraStartedAtSimDays;
      if (since < 0 || since >= AURORA_ENHANCEMENT_DAYS) {
        state.completeAurora();
      }
    }

    // ---- 可见性门控（§5.2 硬性）：层级淡出 × 剖面互斥淡出 ----
    cutawayFadeRef.current = advanceCutawayProgress(
      cutawayFadeRef.current,
      sunCutawayMode,
      Math.min(rawDelta, 0.1),
    );
    const fade = externalActivityFade(cutawayFadeRef.current);
    const levelWeight = trapezoidWeight(continuousLevel, 0.5, 0.9, 2.4, 3.0);
    const groupStrength = levelWeight * fade;
    const group = groupRef.current;
    if (!group) return;
    group.visible = groupStrength > 0.002;
    // 不可见时跳过全部演算与 uniform 更新（事件生命周期已在上方处理）
    if (!group.visible) return;

    // ---- 太阳风 ----
    const nearFactor = trapezoidWeight(continuousLevel, 0.5, 0.8, 1.4, 2.2);
    wind.material.uniforms.uDays.value = windShaderDays(simDays, windCycle);
    wind.material.uniforms.uAlpha.value =
      WIND_BASE_ALPHA * (0.45 + 0.55 * nearFactor) * groupStrength;

    // ---- CME 粒子 ----
    const cmePoints = cmePointsRef.current;
    if (cmePoints) {
      if (activeCme) {
        const elapsed = Math.max(0, simDays - activeCme.startedAtSimDays);
        const speedUnits = kmPerSecToUnitsPerDay(activeCme.speedKmS);
        // S4 C2 加速段：等效已行进时间（初始加速 → 匀速，运动学连续）
        const travelDays = (CME_MAX_RADIUS_UNITS - radius * 1.05) / speedUnits;
        const effElapsed = cmeAcceleratedElapsedDays(elapsed, travelDays);
        const shellRadius = cmeShellRadiusUnits(effElapsed, speedUnits, radius * 1.05);
        cme.material.uniforms.uElapsedDays.value = effElapsed;
        cme.material.uniforms.uSpeed.value = speedUnits;
        cme.material.uniforms.uOpacity.value =
          cmeOpacity01(cmeProgress01(shellRadius)) * groupStrength;
        // 锥轴 +Y 旋转到抛射方向
        tmp.cmeDir.set(activeCme.direction.x, activeCme.direction.y, activeCme.direction.z);
        cmePoints.quaternion.setFromUnitVectors(tmp.up, tmp.cmeDir);
        cmePoints.visible = true;
      } else {
        cmePoints.visible = false;
      }
    }

    // ---- 耀斑辉光广告牌（S4 B2：多峰光变——脉冲相尖峰 + 主峰 + 余辉）----
    const glow = flareGlowRef.current;
    let flareProgressNow = -1;
    if (glow) {
      let intensity = 0;
      if (activeSolarFlare) {
        const progress = flareProgress01(
          simDays,
          activeSolarFlare.startedAtSimDays,
          activeSolarFlare.durationDays,
        );
        flareProgressNow = progress;
        intensity = flareMultiPeakIntensity01(Math.min(1, Math.max(0, progress)));
        glow.position
          .set(
            activeSolarFlare.sourceDir.x,
            activeSolarFlare.sourceDir.y,
            activeSolarFlare.sourceDir.z,
          )
          .multiplyScalar(radius * 1.02);
        const glowScale = radius * (0.6 + 1.5 * intensity);
        glow.scale.set(glowScale, glowScale, 1);
      }
      flareGlow.material.opacity = Math.min(1, intensity * 1.2) * groupStrength;
      glow.visible = intensity > 0.001;
    }

    // ---- 日珥（常驻 + 缓慢演化 + 随较差自转移动）与日冕环（锚定黑子对）----
    const nearWeight = trapezoidWeight(continuousLevel, 0.5, 0.9, 1.7, 2.3) * fade;
    for (let i = 0; i < PROMINENCE_COUNT; i += 1) {
      const mesh = promMeshRefs.current[i];
      if (!mesh) continue;
      // S4 E1：日珥纤维材质逐条更新（不透明度 + 细丝噪声缓慢演化相位）
      const promMaterial = arcs.promMaterials[i];
      promMaterial.uniforms.uOpacity.value = 0.5 * nearWeight;
      promMaterial.uniforms.uTime.value = simDays / PROMINENCE_EVOLVE_DAYS;
      if (nearWeight <= 0.002) {
        mesh.visible = false;
        continue;
      }
      const anchor = PROMINENCES[i];
      const lonRad = anchor.lon0Rad + solarRotationAngleRad(anchor.latRad, simDays);
      const dir = sunspotDirection(anchor.latRad, lonRad);
      tmp.center.set(dir.x, dir.y, dir.z);
      tmp.xAxis.crossVectors(tmp.up, tmp.center).normalize();
      const evolve = prominenceEvolveFactor(simDays, anchor.seed01);
      // S3 爆发日珥前导：被选中的日珥在 CME 触发后短暂拉升脱离
      let eruptLift = 1;
      if (i === eruptPromIndexRef.current) {
        eruptLift = 1 + prominenceEruptionLift(simDays - eruptStartDaysRef.current);
      }
      placeArc(
        mesh,
        tmp.center,
        tmp.xAxis,
        PROMINENCE_SPAN_RAD / 2,
        radius * PROMINENCE_HEIGHT_FRAC * evolve * eruptLift,
      );
      mesh.visible = true;
    }

    // ---- S4 B3 耀斑后环（§4.7-B3）：耀斑峰后活动区上方拱起 post-flare
    // loop arcade（磁重联后冷却回落的明亮环系），复用日冕环池（优先占位）----
    let loopIndex = 0;
    const postFlareStrength =
      flareProgressNow >= 0 ? postFlareLoopStrength01(Math.min(1, flareProgressNow)) : 0;
    if (nearWeight > 0.002 && postFlareStrength > 0.01 && activeSolarFlare) {
      // 锚定耀斑源方位最近的活动区群中性线（与 Sun.tsx 双带耀斑同锚点）
      const fx = activeSolarFlare.sourceDir.x;
      const fy = activeSolarFlare.sourceDir.y;
      const fz = activeSolarFlare.sourceDir.z;
      let bestSlot = -1;
      let bestDot = -Infinity;
      for (let slot = 0; slot < SUNSPOT_PAIR_SLOTS; slot += 1) {
        if (!sunspotGroupInto(slot, simDays, tmp.group)) continue;
        const d =
          tmp.group.leaderDir.x * fx + tmp.group.leaderDir.y * fy + tmp.group.leaderDir.z * fz;
        if (d > bestDot) {
          bestDot = d;
          bestSlot = slot;
        }
      }
      if (bestSlot >= 0 && sunspotGroupInto(bestSlot, simDays, tmp.group)) {
        const gl = tmp.group.leaderDir;
        const gf = tmp.group.followerDir;
        tmp.v1.set(gl.x, gl.y, gl.z);
        tmp.v2.set(gf.x, gf.y, gf.z);
        tmp.center.addVectors(tmp.v1, tmp.v2).normalize();
        const axisLen = tmp.xAxis.subVectors(tmp.v1, tmp.v2).length();
        if (axisLen > 1e-4) {
          tmp.xAxis.normalize();
        } else {
          tmp.xAxis.set(0, 1, 0).cross(tmp.center).normalize();
        }
        tmp.normal.crossVectors(tmp.xAxis, tmp.center).normalize();
        const halfSpanBase =
          0.5 * Math.acos(Math.min(1, Math.max(-1, tmp.v1.dot(tmp.v2)))) +
          tmp.group.spots[0].radiusRad;
        const spreadRad = Math.max(halfSpanBase * 0.7, tmp.group.spots[0].radiusRad * 1.6);
        for (let li = 0; li < POST_FLARE_LOOP_COUNT && loopIndex < CORONAL_LOOP_MAX; li += 1) {
          const mesh = loopMeshRefs.current[loopIndex];
          if (!mesh) break;
          const offFrac = coronalLoopArcadeOffset(li, POST_FLARE_LOOP_COUNT);
          const heightScale = coronalLoopArcadeHeightScale(li, POST_FLARE_LOOP_COUNT);
          tmp.arcadeOffset
            .copy(tmp.center)
            .addScaledVector(tmp.normal, offFrac * spreadRad)
            .normalize();
          const chord = 2 * radius * Math.sin(halfSpanBase);
          tmp.v1.set(gl.x, gl.y, gl.z);
          tmp.v2.set(gf.x, gf.y, gf.z);
          tmp.xAxis.subVectors(tmp.v1, tmp.v2).normalize();
          placeArc(
            mesh,
            tmp.arcadeOffset,
            tmp.xAxis,
            halfSpanBase,
            // 后环拱顶更高（热环系高拱）并随后环强度拱起
            chord * POST_FLARE_LOOP_HEIGHT_RATIO * heightScale * postFlareStrength,
          );
          const material = arcs.loopMaterials[loopIndex];
          material.color.copy(tmp.loopColorPostFlare);
          material.opacity = 0.75 * postFlareStrength * nearWeight * (0.7 + 0.3 * heightScale);
          mesh.visible = true;
          loopIndex += 1;
        }
      }
    }

    // ---- S4 E2 活动区磁环族（§4.7-E2）：复杂群上方多重同源日冕环拱 ----
    // 每活跃群按复杂度（群内黑子颗数）渲染 1–4 条同源环拱，沿磁中性线法向
    // 铺开、拱形高度包络（中央环最高）。池化 TubeGeometry 复用，零分配。
    if (nearWeight > 0.002) {
      for (let slot = 0; slot < SUNSPOT_PAIR_SLOTS && loopIndex < CORONAL_LOOP_MAX; slot += 1) {
        if (!sunspotGroupInto(slot, simDays, tmp.group)) continue;
        if (tmp.group.strength01 < 0.2) continue;
        const gl = tmp.group.leaderDir;
        const gf = tmp.group.followerDir;
        tmp.v1.set(gl.x, gl.y, gl.z);
        tmp.v2.set(gf.x, gf.y, gf.z);
        // 群中点与中性线主轴（前导→后随）
        tmp.center.addVectors(tmp.v1, tmp.v2).normalize();
        const axisLen = tmp.xAxis.subVectors(tmp.v1, tmp.v2).length();
        // 中性线法向（用于环拱横向铺开）：主轴 × 径向
        if (axisLen > 1e-4) {
          tmp.xAxis.normalize();
        } else {
          // 单极群退化：主轴取任意切向
          tmp.xAxis.set(0, 1, 0).cross(tmp.center).normalize();
        }
        tmp.normal.crossVectors(tmp.xAxis, tmp.center).normalize();
        const halfSpanBase =
          0.5 * Math.acos(Math.min(1, Math.max(-1, tmp.v1.dot(tmp.v2)))) +
          tmp.group.spots[0].radiusRad;
        const loopCount = coronalLoopCountForGroup(tmp.group.count);
        // 环拱横向铺开幅度（沿中性线法向，与群角尺度相关）
        const spreadRad = Math.max(halfSpanBase * 0.6, tmp.group.spots[0].radiusRad * 1.5);
        for (let li = 0; li < loopCount && loopIndex < CORONAL_LOOP_MAX; li += 1) {
          const mesh = loopMeshRefs.current[loopIndex];
          if (!mesh) break;
          const offFrac = coronalLoopArcadeOffset(li, loopCount);
          const heightScale = coronalLoopArcadeHeightScale(li, loopCount);
          // 环中心沿法向偏移铺开（保持贴日面单位方向）
          tmp.arcadeOffset
            .copy(tmp.center)
            .addScaledVector(tmp.normal, offFrac * spreadRad)
            .normalize();
          const halfSpan = halfSpanBase;
          const chord = 2 * radius * Math.sin(halfSpan);
          // xAxis 每环需重算（placeArc 会改写），从主轴副本恢复
          tmp.v1.set(gl.x, gl.y, gl.z);
          tmp.v2.set(gf.x, gf.y, gf.z);
          tmp.xAxis.subVectors(tmp.v1, tmp.v2).normalize();
          placeArc(
            mesh,
            tmp.arcadeOffset,
            tmp.xAxis,
            halfSpan,
            chord * CORONAL_LOOP_HEIGHT_RATIO * heightScale,
          );
          const loopMaterial = arcs.loopMaterials[loopIndex];
          loopMaterial.color.copy(tmp.loopColorDefault);
          loopMaterial.opacity =
            0.5 * tmp.group.strength01 * nearWeight * (0.7 + 0.3 * heightScale);
          mesh.visible = true;
          loopIndex += 1;
        }
      }
    }
    for (let i = loopIndex; i < CORONAL_LOOP_MAX; i += 1) {
      const mesh = loopMeshRefs.current[i];
      if (mesh) mesh.visible = false;
    }

    // ---- S3 §4.5 点选热区：黑子群（前导黑子处）+ 日珥 ----
    for (let slot = 0; slot < SUNSPOT_PAIR_SLOTS; slot += 1) {
      const hs = spotHotspotRefs.current[slot];
      if (!hs) continue;
      // S4：热区锚定群前导黑子（含 A3 生长缩放的角半径），点选换算与渲染一致
      if (nearWeight > 0.002 && sunspotGroupInto(slot, simDays, tmp.group)) {
        const leader = tmp.group.spots[0];
        const d = sunspotDirection(leader.latRad, leader.lonRad);
        hs.position.set(d.x, d.y, d.z).multiplyScalar(radius * 1.01);
        // 热区半径按黑子角半径对应的弦长（略放大便于点选）
        const hsR = Math.max(radius * 0.04, radius * Math.sin(leader.radiusRad) * 1.3);
        hs.scale.setScalar(hsR);
        spotRadiusRef.current[slot] = leader.radiusRad;
        hs.visible = true;
      } else {
        hs.visible = false;
      }
    }
    for (let i = 0; i < PROMINENCE_COUNT; i += 1) {
      const hs = promHotspotRefs.current[i];
      const prom = promMeshRefs.current[i];
      if (!hs) continue;
      if (prom && prom.visible) {
        // 热区置于日珥拱顶附近（日珥 mesh 已定位，取其上方径向偏移）
        hs.position.copy(prom.position).multiplyScalar(1.12);
        hs.scale.setScalar(radius * 0.08);
        hs.visible = true;
      } else {
        hs.visible = false;
      }
    }
  });

  /** 黑子群点选：科普卡片 + "可容纳 N 个地球"动态换算（§4.5） */
  const handleSpotClick = (slot: number): void => {
    const radiusRad = spotRadiusRef.current[slot];
    const earthCount = radiusRad > 0 ? Math.round(sunspotEarthCount(radiusRad)) : null;
    useSimulationStore.getState().setSelectedSolarFeature({
      kind: 'sunspot',
      titleZh: '太阳黑子群',
      titleEn: 'Sunspot group',
      descZh:
        '强磁场抑制对流形成的低温暗区（本影 ~3,500–4,500 °C，对比光球 ~5,500 °C）。' +
        '成对出现（前导/后随，磁极相反——Hale 极性定律），随较差自转移动。',
      descEn:
        'Cooler dark regions where strong magnetic fields suppress convection ' +
        '(umbra ~3,500–4,500 °C vs. the ~5,500 °C photosphere). They appear in pairs ' +
        '(leading/trailing with opposite polarity — Hale\u2019s polarity law) and drift ' +
        'with the Sun\u2019s differential rotation.',
      earthCount,
    });
  };

  /** 日珥点选：科普卡片（§4.5） */
  const handleProminenceClick = (): void => {
    useSimulationStore.getState().setSelectedSolarFeature({
      kind: 'prominence',
      titleZh: '日珥',
      titleEn: 'Prominence',
      descZh:
        '色球物质沿磁力线悬浮于高温日冕中的拱状结构（氢α 红色调），寿命数天至数月；' +
        '在日面上投影为暗条。爆发日珥可作为日冕物质抛射（CME）的前导。',
      descEn:
        'Arch-shaped structures of chromospheric material suspended along magnetic ' +
        'field lines in the hot corona (Hα red hue), lasting days to months; seen ' +
        'against the disk they appear as dark filaments. Eruptive prominences can ' +
        'precede coronal mass ejections (CMEs).',
      earthCount: null,
    });
  };

  return (
    <group ref={groupRef} name="sun-activity">
      {/* 太阳风：常驻低密度径向外流（亮度克制，L1 近观更明显） */}
      <points geometry={wind.geometry} material={wind.material} raycast={() => null} />
      {/* CME：环状/泡状壳层扩张（事件驱动，缓冲复用） */}
      <points
        ref={cmePointsRef}
        geometry={cme.geometry}
        material={cme.material}
        visible={false}
        raycast={() => null}
      />
      {/* 耀斑辉光广告牌 */}
      <sprite ref={flareGlowRef} material={flareGlow.material} visible={false} raycast={() => null} />
      {/* 日珥：日面边缘弧状发光结构（色球红） */}
      {Array.from({ length: PROMINENCE_COUNT }, (_, i) => (
        <mesh
          key={`prom-${i}`}
          ref={(el) => {
            promMeshRefs.current[i] = el;
          }}
          geometry={arcs.promGeometry}
          material={arcs.promMaterials[i]}
          visible={false}
          raycast={() => null}
        />
      ))}
      {/* 日冕环：锚定活跃黑子对足点的磁力线环 */}
      {Array.from({ length: CORONAL_LOOP_MAX }, (_, i) => (
        <mesh
          key={`loop-${i}`}
          ref={(el) => {
            loopMeshRefs.current[i] = el;
          }}
          geometry={arcs.loopGeometry}
          material={arcs.loopMaterials[i]}
          visible={false}
          raycast={() => null}
        />
      ))}
      {/* S3 §4.5 黑子群点选热区（不可见球体，仅提供点击命中） */}
      {Array.from({ length: SUNSPOT_PAIR_SLOTS }, (_, i) => (
        <mesh
          key={`spot-hotspot-${i}`}
          ref={(el) => {
            spotHotspotRefs.current[i] = el;
          }}
          visible={false}
          onClick={(e) => {
            e.stopPropagation();
            handleSpotClick(i);
          }}
        >
          <sphereGeometry args={[1, 12, 12]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      ))}
      {/* S3 §4.5 日珥点选热区 */}
      {Array.from({ length: PROMINENCE_COUNT }, (_, i) => (
        <mesh
          key={`prom-hotspot-${i}`}
          ref={(el) => {
            promHotspotRefs.current[i] = el;
          }}
          visible={false}
          onClick={(e) => {
            e.stopPropagation();
            handleProminenceClick();
          }}
        >
          <sphereGeometry args={[1, 12, 12]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}
