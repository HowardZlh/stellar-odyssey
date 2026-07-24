'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useSimulationStore } from '@/store';
import type { Vec3 } from '@/types';
import { getPlanetById } from '@/data/planets';
import { heliocentricPosition } from '@/utils/physics';
import { createSeededRandom } from '@/utils/random';
import { eclipticToScene, trapezoidWeight } from '@/utils/scale';
import {
  CME_INDEPENDENT_MEAN_INTERVAL_DAYS,
  CME_MAX_RADIUS_UNITS,
  CME_PARTICLE_COUNT,
  CORONAL_LOOP_HEIGHT_RATIO,
  CORONAL_LOOP_MAX,
  FLARE_RISE_FRACTION,
  PROMINENCE_COUNT,
  PROMINENCE_HEIGHT_FRAC,
  PROMINENCE_SPAN_RAD,
  prominenceEruptionLift,
  WIND_BASE_ALPHA,
  WIND_MAX_RADIUS_UNITS,
  WIND_PARTICLE_COUNT,
  cmeConeDirections,
  cmeIsEarthDirected,
  cmeLinkProbability,
  cmeOpacity01,
  cmeProgress01,
  cmeShellRadiusUnits,
  cmeSpeedForClass,
  cycleModulatedMeanInterval,
  FLARE_MEAN_INTERVAL_DAYS,
  flareClassRoll,
  flareIntensity01,
  flareMagnitudeRoll,
  flareProgress01,
  kmPerSecToUnitsPerDay,
  loopArcPoint,
  prominenceEvolveFactor,
  shouldAutoTriggerFlare,
  windCycleDays,
  windShaderDays,
  windSpeedFactorForDirection,
  cmeArrivalDelayDays,
  AURORA_ENHANCEMENT_DAYS,
} from '@/utils/solarActivity';
import { CORONAL_HOLE_DIR } from '@/utils/sunSurface';
import { solarRotationAngleRad } from '@/utils/solarRotation';
import type { SunspotInstance } from '@/utils/sunspots';
import {
  SUNSPOT_PAIR_SLOTS,
  activeRegionLatLon,
  sunspotDirection,
  sunspotEarthCount,
  sunspotHash01,
  sunspotPairInto,
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

  // ---- 太阳风常驻粒子（§4.3-4）：径向外流 + 循环回收，顶点着色器推进 ----
  const wind = useMemo(() => {
    const rand = createSeededRandom(WIND_SEED);
    const dirs = new Float32Array(WIND_PARTICLE_COUNT * 3);
    const seeds = new Float32Array(WIND_PARTICLE_COUNT);
    // S3 日冕洞快风：粒子方向落在冕洞锥内时速度增益（快风源）
    const speedFac = new Float32Array(WIND_PARTICLE_COUNT);
    for (let i = 0; i < WIND_PARTICLE_COUNT; i += 1) {
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
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(WIND_PARTICLE_COUNT * 3), 3));
    geometry.setAttribute('aDir', new THREE.BufferAttribute(dirs, 3));
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    geometry.setAttribute('aSpeedFac', new THREE.BufferAttribute(speedFac, 1));
    // 位置由着色器计算，手动设置包围球供视锥剔除
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), WIND_MAX_RADIUS_UNITS * 1.1);
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
      },
      vertexShader: /* glsl */ `
        attribute vec3 aDir;
        attribute float aSeed;
        attribute float aSpeedFac;
        uniform float uDays;
        uniform float uCycleDays;
        uniform float uR0;
        uniform float uRMax;
        uniform float uSize;
        varying float vPhase;
        void main() {
          // 外流相位循环回收（solarActivity.windPhase01 镜像）；
          // S3 日冕洞快风：该方向粒子相位推进更快（速度增益）
          float phase = fract(uDays * aSpeedFac / uCycleDays + aSeed);
          vPhase = phase;
          vec3 pos = aDir * mix(uR0, uRMax, phase);
          vec4 mv = modelViewMatrix * vec4(pos, 1.0);
          gl_PointSize = uSize * (320.0 / -mv.z);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uAlpha;
        varying float vPhase;
        void main() {
          vec2 c = gl_PointCoord - vec2(0.5);
          float d2 = dot(c, c);
          if (d2 > 0.25) discard;
          float soft = 1.0 - smoothstep(0.0, 0.25, d2);
          // 亮度随外流衰减（solarActivity.windParticleAlpha 镜像）
          float a = uAlpha * (1.0 - vPhase) * soft;
          gl_FragColor = vec4(vec3(1.0, 0.94, 0.8) * a, a);
        }
      `,
    });
    return { geometry, material };
  }, [windCycle, windStartRadius]);

  // ---- CME 粒子壳层（§4.3-3）：锥面扩张，事件间复用同一缓冲（环形缓冲思想）----
  const cme = useMemo(() => {
    const rand = createSeededRandom(CME_SEED);
    const dirs = cmeConeDirections(CME_PARTICLE_COUNT, rand);
    const jitter = new Float32Array(CME_PARTICLE_COUNT);
    const seeds = new Float32Array(CME_PARTICLE_COUNT);
    for (let i = 0; i < CME_PARTICLE_COUNT; i += 1) {
      // 壳层厚度：径向速度抖动 ±15%（壳层随扩张增厚，真实 CME 形态）
      jitter[i] = 0.85 + 0.3 * rand();
      seeds[i] = rand();
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(CME_PARTICLE_COUNT * 3), 3));
    geometry.setAttribute('aDir', new THREE.BufferAttribute(dirs, 3));
    geometry.setAttribute('aJitter', new THREE.BufferAttribute(jitter, 1));
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), CME_MAX_RADIUS_UNITS * 1.2);
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
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
        uniform float uElapsedDays;
        uniform float uSpeed;
        uniform float uR0;
        uniform float uSize;
        varying float vSeed;
        void main() {
          // 壳层匀速扩张（solarActivity.cmeShellRadiusUnits 镜像）
          float r = uR0 + uSpeed * uElapsedDays * aJitter;
          vSeed = aSeed;
          vec3 pos = aDir * r;
          vec4 mv = modelViewMatrix * vec4(pos, 1.0);
          gl_PointSize = uSize * (320.0 / -mv.z);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uOpacity;
        varying float vSeed;
        void main() {
          vec2 c = gl_PointCoord - vec2(0.5);
          float d2 = dot(c, c);
          if (d2 > 0.25) discard;
          float soft = 1.0 - smoothstep(0.0, 0.25, d2);
          float a = uOpacity * (0.55 + 0.45 * vSeed) * soft;
          gl_FragColor = vec4(vec3(1.0, 0.62, 0.38) * a, a);
        }
      `,
    });
    return { geometry, material };
  }, [radius]);

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
    const promMaterial = new THREE.MeshBasicMaterial({
      color: '#ff5540',
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
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
    return { promGeometry, promMaterial, loopGeometry, loopMaterials };
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
      leader: { latRad: 0, lonRad: 0, radiusRad: 0, strength01: 0 } as SunspotInstance,
      follower: { latRad: 0, lonRad: 0, radiusRad: 0, strength01: 0 } as SunspotInstance,
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
      arcs.promMaterial.dispose();
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
    const { simDays, continuousLevel, activeSolarFlare, activeCme, sunCutawayMode } = state;

    // ---- 事件生命周期（组不可见时仍推进，保证事件正常触发/收尾）----
    const last = lastSimDaysRef.current;
    lastSimDaysRef.current = simDays;
    // 时间跳变（回退/超大步进）只重置基准，不触发/不残留（需求 §8）
    const delta = last === null ? 0 : simDays - last;
    const timeJumped = delta < 0 || delta > 50;

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
    } else if (!sunCutawayMode && !timeJumped) {
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
      const shellRadius = cmeShellRadiusUnits(
        elapsed,
        kmPerSecToUnitsPerDay(activeCme.speedKmS),
        radius * 1.05,
      );
      if (elapsed < 0 || shellRadius >= CME_MAX_RADIUS_UNITS) {
        state.completeCme();
      }
    } else if (!sunCutawayMode && !timeJumped) {
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
        const shellRadius = cmeShellRadiusUnits(elapsed, speedUnits, radius * 1.05);
        cme.material.uniforms.uElapsedDays.value = elapsed;
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

    // ---- 耀斑辉光广告牌 ----
    const glow = flareGlowRef.current;
    if (glow) {
      let intensity = 0;
      if (activeSolarFlare) {
        const progress = flareProgress01(
          simDays,
          activeSolarFlare.startedAtSimDays,
          activeSolarFlare.durationDays,
        );
        intensity = flareIntensity01(Math.min(1, Math.max(0, progress)));
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
    arcs.promMaterial.opacity = 0.5 * nearWeight;
    for (let i = 0; i < PROMINENCE_COUNT; i += 1) {
      const mesh = promMeshRefs.current[i];
      if (!mesh) continue;
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

    let loopIndex = 0;
    if (nearWeight > 0.002) {
      for (let slot = 0; slot < SUNSPOT_PAIR_SLOTS && loopIndex < CORONAL_LOOP_MAX; slot += 1) {
        if (!sunspotPairInto(slot, simDays, tmp.leader, tmp.follower)) continue;
        if (tmp.leader.strength01 < 0.2) continue;
        const mesh = loopMeshRefs.current[loopIndex];
        if (!mesh) break;
        const dl = sunspotDirection(tmp.leader.latRad, tmp.leader.lonRad);
        const df = sunspotDirection(tmp.follower.latRad, tmp.follower.lonRad);
        tmp.v1.set(dl.x, dl.y, dl.z);
        tmp.v2.set(df.x, df.y, df.z);
        tmp.center.addVectors(tmp.v1, tmp.v2).normalize();
        tmp.xAxis.subVectors(tmp.v1, tmp.v2).normalize();
        const halfSpan =
          0.5 * Math.acos(Math.min(1, Math.max(-1, tmp.v1.dot(tmp.v2)))) + tmp.leader.radiusRad;
        const chord = 2 * radius * Math.sin(halfSpan);
        placeArc(mesh, tmp.center, tmp.xAxis, halfSpan, chord * CORONAL_LOOP_HEIGHT_RATIO);
        arcs.loopMaterials[loopIndex].opacity = 0.5 * tmp.leader.strength01 * nearWeight;
        mesh.visible = true;
        loopIndex += 1;
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
      if (nearWeight > 0.002 && sunspotPairInto(slot, simDays, tmp.leader, tmp.follower)) {
        const d = sunspotDirection(tmp.leader.latRad, tmp.leader.lonRad);
        hs.position.set(d.x, d.y, d.z).multiplyScalar(radius * 1.01);
        // 热区半径按黑子角半径对应的弦长（略放大便于点选）
        const hsR = Math.max(radius * 0.04, radius * Math.sin(tmp.leader.radiusRad) * 1.3);
        hs.scale.setScalar(hsR);
        spotRadiusRef.current[slot] = tmp.leader.radiusRad;
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
      descZh:
        '强磁场抑制对流形成的低温暗区（本影 ~3,500–4,500 °C，对比光球 ~5,500 °C）。' +
        '成对出现（前导/后随，磁极相反——Hale 极性定律），随较差自转移动。',
      earthCount,
    });
  };

  /** 日珥点选：科普卡片（§4.5） */
  const handleProminenceClick = (): void => {
    useSimulationStore.getState().setSelectedSolarFeature({
      kind: 'prominence',
      titleZh: '日珥',
      descZh:
        '色球物质沿磁力线悬浮于高温日冕中的拱状结构（氢α 红色调），寿命数天至数月；' +
        '在日面上投影为暗条。爆发日珥可作为日冕物质抛射（CME）的前导。',
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
          material={arcs.promMaterial}
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
