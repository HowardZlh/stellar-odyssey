/**
 * 流星雨实验室夜天光纯函数层（M3.8，需求 §M3.8-1/2/3；登记为契约 C1
 * 相邻纯函数模块——不动 meteorShower.ts 既有签名，只消费其球面公式链）。
 *
 * 物理口径（科学准确性红线）：
 * - 真实夜空从不纯黑（大气气辉/黄道光/光害散射），地平线恒亮于天顶；
 * - 光害 ↔ 极限星等 ↔ 流量三重自洽：光害度 p = (6.5 − lm)/5.5 与既有
 *   lm 控件（恒星剔除 + 流量压低，§1.4）同一物理参数；
 * - 晨昏蒙影采用标准定义锚点：民用/航海/天文蒙影 = 太阳高度 −6°/−12°/−18°；
 * - 禁止加月光（英仙座/天鹅座κ两历元均无月，需求 §M3.8 方案三否决登记）。
 *
 * 零 GC 约定：labSkyColors / labGroundColor 提供可选 out 参数（useFrame
 * 每帧消费时复用外部对象，渲染循环零分配——契约 C2.1 口径）。
 *
 * 纯 TS 模块（不 import three/React，labGestures 同规格），单测全覆盖。
 */

import { horizontalFromEquatorial, localClockHours } from '@/utils/meteorShower';
import { createSeededRandom } from '@/utils/random';

/** 度 → 弧度（单位换算，非球面公式） */
const DEG = Math.PI / 180;

/** 天光穹壳半径因子（× 星穹半径 10000 = 12000 < far 25000，置星点深度之后） */
export const SKY_DOME_RADIUS_FACTOR = 1.2;

/**
 * 晨昏蒙影 → 有效极限星等上限锚点（[太阳高度角°, lm 上限]；分段线性）：
 * −18°（天文蒙影结束）不设限 → −12°（航海蒙影）5.0 → −6°（民用蒙影）2.0
 * → 0°（日出）−4；≥0° 恒 −4（全星剔除 + 流量 ≈0 颗/h 物理自洽）。
 * −18° 锚点值取 lm 控件域上限 6.5（夜间域透传连续）。
 */
export const TWILIGHT_LM_ANCHORS: readonly (readonly [number, number])[] = [
  [-18, 6.5],
  [-12, 5.0],
  [-6, 2.0],
  [0, -4],
];

/** 白昼有效极限星等（太阳高度 ≥ 0°；金星量级 −4——白昼全星绝迹口径） */
export const DAYLIGHT_LIMITING_MAG = -4;

/** 夜间天顶基色（lm 6.5 深空：微弱蓝灰气辉，非纯黑） */
export const NIGHT_ZENITH_BASE: readonly [number, number, number] = [0.012, 0.016, 0.028];

/** 夜间地平基色（气辉/黄道光在低空视线路径更长 → 恒亮于天顶） */
export const NIGHT_HORIZON_BASE: readonly [number, number, number] = [0.03, 0.04, 0.06];

/** 光害天顶增量（p=1 城市：钠灯橙灰上散射，天顶增幅小于地平） */
export const LIGHT_POLLUTION_ZENITH_GAIN: readonly [number, number, number] = [
  0.045, 0.038, 0.028,
];

/** 光害地平增量（城市地平橙灰光害穹的主体） */
export const LIGHT_POLLUTION_HORIZON_GAIN: readonly [number, number, number] = [0.22, 0.16, 0.09];

/** 白昼天顶色（瑞利散射蓝） */
export const DAY_ZENITH: readonly [number, number, number] = [0.16, 0.36, 0.78];

/** 白昼地平色（气溶胶散射偏白） */
export const DAY_HORIZON: readonly [number, number, number] = [0.6, 0.74, 0.92];

/** 地面反照系数（地面色 = 地平天光 × 本系数——夜天光照亮地景的量级） */
export const GROUND_ALBEDO_FACTOR = 0.35;

/** 山脊剪影加深系数（剪影色 = 地面色 × 本系数，暗于地面盘） */
export const RIDGE_DARKEN_FACTOR = 0.55;

/** 山脊剪影环半径（km；仰角 0.1–1.7° 真实山脊线量级的基准距离） */
export const RIDGE_RADIUS_KM = 30;

/** 山脊剖面段数（三角带环 256 段 × 2 顶点） */
export const RIDGE_SEGMENTS = 256;

/** 山脊高度域下限（km；30 km 处仰角 ≈ 0.1°） */
export const RIDGE_MIN_HEIGHT_KM = 0.05;

/** 山脊高度域上限（km；30 km 处仰角 ≈ 1.7°） */
export const RIDGE_MAX_HEIGHT_KM = 0.9;

/** 山脊剖面正弦叠加个数 */
export const RIDGE_SINE_COUNT = 5;

/** 近观头部细节层最大张角（弧度；任意观距 scale ≤ dist×tan(θ/2)，不吞屏） */
export const HEAD_MAX_ANGLE_RAD = (8 * Math.PI) / 180;

/** 近景条痕 ribbon 渐显观距阈值（km；相机—头部距离低于此值淡入） */
export const RIBBON_NEAR_DISTANCE_KM = 8;

/**
 * 实验室太阳高度角（弧度；与 labSunDirection 同一球面公式链只出高度标量）：
 * clock = localClockHours(...)，时角 H = (clock − 12)×15°，
 * sin(alt) = sinδ·sinφ + cosδ·cosφ·cos(H)（复用 horizontalFromEquatorial）。
 *
 * @param epochLocalHour 历元当地时（小时，EPOCH_LOCAL_HOURS 按雨登记）
 * @param sunDecDeg 太阳赤纬（度，EPOCH_SUN_DECLINATION_DEG 按雨登记）
 * @param hourOffset 地方时偏移控件（小时）
 * @param elapsedHours 场景推进时长（小时）
 * @param latDeg 观测纬度（度）
 */
export function labSunAltitudeRad(
  epochLocalHour: number,
  sunDecDeg: number,
  hourOffset: number,
  elapsedHours: number,
  latDeg: number
): number {
  if (!Number.isFinite(sunDecDeg) || !Number.isFinite(latDeg)) {
    throw new RangeError(`赤纬/纬度必须有限，收到 dec=${sunDecDeg}, lat=${latDeg}`);
  }
  const clock = localClockHours(epochLocalHour, hourOffset, elapsedHours);
  const hourAngleRad = (clock - 12) * 15 * DEG;
  // ra=0 时时角 = LST（labSunDirection 同式，M3.6-3 登记）
  return horizontalFromEquatorial(0, sunDecDeg, latDeg, hourAngleRad).altRad;
}

/**
 * 有效极限星等（M3.8-2 晨昏蒙影链）：min(用户 lm, 晨昏 lm 上限)。
 * 上限按 TWILIGHT_LM_ANCHORS 分段线性；alt ≤ −18° 夜间域透传用户值，
 * alt ≥ 0° 恒 DAYLIGHT_LIMITING_MAG（白昼全星剔除 + 流量 ≈0 自洽）。
 * 统一接管全部 lm 消费点（星穹剔除/流量链/倒计时），只换输入不改
 * visibleHourlyRate/fluxFraction 签名与公式（契约 C1）。
 */
export function effectiveLimitingMag(userLm: number, sunAltRad: number): number {
  if (!Number.isFinite(userLm) || !Number.isFinite(sunAltRad)) {
    throw new RangeError(`极限星等/太阳高度必须有限，收到 lm=${userLm}, alt=${sunAltRad}`);
  }
  const altDeg = sunAltRad / DEG;
  const [firstAltDeg] = TWILIGHT_LM_ANCHORS[0];
  if (altDeg <= firstAltDeg) return userLm;
  const [lastAltDeg, lastCap] = TWILIGHT_LM_ANCHORS[TWILIGHT_LM_ANCHORS.length - 1];
  if (altDeg >= lastAltDeg) return Math.min(userLm, lastCap);
  let cap = lastCap;
  for (let i = 0; i < TWILIGHT_LM_ANCHORS.length - 1; i += 1) {
    const [a0, v0] = TWILIGHT_LM_ANCHORS[i];
    const [a1, v1] = TWILIGHT_LM_ANCHORS[i + 1];
    if (altDeg >= a0 && altDeg <= a1) {
      cap = v0 + ((altDeg - a0) / (a1 - a0)) * (v1 - v0);
      break;
    }
  }
  return Math.min(userLm, cap);
}

/** 天光配色（LabSkyDome uniforms / 地面盘 / 山脊剪影的共同事实源） */
export interface LabSkyColors {
  /** 天顶色（线性 RGB，通道 ∈ [0,1]） */
  zenith: [number, number, number];
  /** 地平色（线性 RGB；亮度恒 ≥ 天顶——夜空亮度分布红线） */
  horizon: [number, number, number];
  /** 晨昏辉光斑强度 ∈ [0,1]（朝太阳方位的地平辉光包络） */
  sunGlow: number;
}

/** 空配色工厂（组件 useMemo 持有，useFrame 每帧作 out 复用——零 GC） */
export function emptyLabSkyColors(): LabSkyColors {
  return { zenith: [0, 0, 0], horizon: [0, 0, 0], sunGlow: 0 };
}

/** smoothstep（GLSL 同式；纯标量工具） */
function smoothstepRange(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

/**
 * 天光配色（M3.8-1）：光害度 p = clamp((6.5 − lm)/5.5, 0, 1) 驱动夜间
 * 基色（深空蓝灰气辉 → 城市橙灰光害穹）；晨昏因子 t = smoothstep 于
 * 太阳高度 [−18°, +5°] 混向白昼色；sunGlow = 晨昏带包络
 * smoothstep(−14°, −4°) × (1 − smoothstep(4°, 12°))——深夜与正午均 ≈0。
 *
 * @param out 可选复用对象（useFrame 消费零 GC）；缺省新建
 */
export function labSkyColors(userLm: number, sunAltRad: number, out?: LabSkyColors): LabSkyColors {
  if (!Number.isFinite(userLm) || !Number.isFinite(sunAltRad)) {
    throw new RangeError(`极限星等/太阳高度必须有限，收到 lm=${userLm}, alt=${sunAltRad}`);
  }
  const result = out ?? emptyLabSkyColors();
  const p = clamp01((6.5 - userLm) / 5.5);
  const altDeg = sunAltRad / DEG;
  // 晨昏因子：−18°（天文蒙影结束）→ +5° 全亮
  const t = smoothstepRange(0, 1, (altDeg + 18) / 23);
  for (let c = 0; c < 3; c += 1) {
    const nightZenith = NIGHT_ZENITH_BASE[c] + p * LIGHT_POLLUTION_ZENITH_GAIN[c];
    const nightHorizon = NIGHT_HORIZON_BASE[c] + p * LIGHT_POLLUTION_HORIZON_GAIN[c];
    result.zenith[c] = clamp01(nightZenith + (DAY_ZENITH[c] - nightZenith) * t);
    result.horizon[c] = clamp01(nightHorizon + (DAY_HORIZON[c] - nightHorizon) * t);
  }
  result.sunGlow =
    smoothstepRange(-14, -4, altDeg) * (1 - smoothstepRange(4, 12, altDeg));
  return result;
}

/**
 * 地面反照色（M3.8-1；地面盘动态色）：地平天光 × GROUND_ALBEDO_FACTOR
 * ——暗于地平、亮于纯黑（夜天光照亮地景的深蓝灰）。
 *
 * @param out 可选复用数组（useFrame 消费零 GC）；缺省新建
 */
export function labGroundColor(
  sky: LabSkyColors,
  out?: [number, number, number]
): [number, number, number] {
  const result = out ?? [0, 0, 0];
  result[0] = clamp01(sky.horizon[0] * GROUND_ALBEDO_FACTOR);
  result[1] = clamp01(sky.horizon[1] * GROUND_ALBEDO_FACTOR);
  result[2] = clamp01(sky.horizon[2] * GROUND_ALBEDO_FACTOR);
  return result;
}

/**
 * 地平山脊高度剖面（M3.8-3）：RIDGE_SINE_COUNT 个正弦叠加（随机振幅 +
 * 整数频率 + 随机相位——整数频率保证 2π 周期无缝），归一到
 * [RIDGE_MIN_HEIGHT_KM, RIDGE_MAX_HEIGHT_KM]。同种子确定性（跨会话一致）。
 *
 * @param segments 环向采样段数（下标 i 对应方位角 2πi/segments）
 * @param seed 随机种子（createSeededRandom，全项目粒子系统统一）
 * @returns 长度 = segments 的高度数组（km）
 */
export function ridgeHeightProfile(segments: number, seed: number): Float32Array {
  if (!Number.isInteger(segments) || segments < 8) {
    throw new RangeError(`段数必须为 ≥8 的整数，收到 ${segments}`);
  }
  const rand = createSeededRandom(seed);
  const amps: number[] = [];
  const freqs: number[] = [];
  const phases: number[] = [];
  for (let k = 0; k < RIDGE_SINE_COUNT; k += 1) {
    amps.push(0.3 + rand() * 0.7);
    freqs.push(2 + Math.floor(rand() * 8)); // 整数频率 ∈ [2, 9]（周期无缝）
    phases.push(rand() * Math.PI * 2);
  }
  const heights = new Float32Array(segments);
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < segments; i += 1) {
    const theta = (i / segments) * Math.PI * 2;
    let h = 0;
    for (let k = 0; k < RIDGE_SINE_COUNT; k += 1) {
      h += amps[k] * Math.sin(freqs[k] * theta + phases[k]);
    }
    heights[i] = h;
    if (h < min) min = h;
    if (h > max) max = h;
  }
  const range = max - min || 1;
  const span = RIDGE_MAX_HEIGHT_KM - RIDGE_MIN_HEIGHT_KM;
  for (let i = 0; i < segments; i += 1) {
    heights[i] = RIDGE_MIN_HEIGHT_KM + ((heights[i] - min) / range) * span;
  }
  return heights;
}
