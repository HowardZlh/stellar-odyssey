/**
 * 宇宙级运动与大尺度结构（需求 3.1.3）
 *
 * 坐标约定：本星系群质心系 / 银河系中心系。场景方向单位矢量由数据层提供；
 * 本文件输出光年（星系位置）或场景单位（宇宙网直接输出场景单位）。
 *
 * 数据来源：
 * - 银河系-仙女座（M31）当前距离约 250 万光年，视向接近速度约 110 km/s，
 *   预计约 45 亿年后开始合并（van der Marel et al. 2012, ApJ）
 * - 本星系群相对 CMB 本动速度约 620 km/s，朝巨引源方向
 *   （Kogut et al. 1993, ApJ；用于渲染端整体漂移示意）
 * - 大麦哲伦云距离约 16 万光年、小麦哲伦云约 20 万光年（ESA/NASA）
 * - M31 质量占 MW+M31 约 0.556（质量比约 1.25:1 的一阶近似，
 *   双方到质心的距离与质量成反比）
 */

import type { Vec3 } from '@/types';
import { easeInOutCubic } from '@/utils/animation';
import { DAYS_PER_MYR, KM_S_TO_LY_PER_MYR, simDaysToMyr } from '@/utils/galaxy';
import { createSeededRandom } from '@/utils/random';

/** 银河系可视半径（场景单位）：银盘半径 5 万光年 × 0.05 场景单位/光年 */
export const MW_VISUAL_RADIUS_UNITS = 2500;

/**
 * 星系贴图平面透视夸大抑制系数（渲染登记：压缩距离下的透视夸大抑制，
 * 与 Universe.tsx / cameraFocus.ts 历史魔法数字 0.55 同源收敛，R2-8）
 */
export const GALAXY_PLANE_SHRINK_FACTOR = 0.55;

/**
 * 河外星系贴图平面边长（场景单位，R2-8 同源公式收敛）：
 * 直径相对银河系（10 万光年）换算 × 银河系可视直径 × 抑制系数。
 * Universe.tsx（渲染）/ cameraFocus.ts（飞往观察距离）/ galaxyNearView.ts
 * （近观激活距离与粒子层尺度）三处同源，禁止两套参数。
 */
export function galaxyPlaneSizeUnits(diameterLy: number): number {
  if (!Number.isFinite(diameterLy) || diameterLy <= 0) {
    throw new RangeError(`星系直径必须为正有限数，收到 ${diameterLy}`);
  }
  return (diameterLy / 100000) * MW_VISUAL_RADIUS_UNITS * 2 * GALAXY_PLANE_SHRINK_FACTOR;
}

/** MW–M31 当前距离（光年）：约 250 万光年 */
export const MW_M31_INITIAL_SEPARATION_LY = 2.5e6;

/** MW–M31 当前接近速度（km/s）：约 110 km/s */
export const MW_M31_APPROACH_KM_S = 110;

/** MW–M31 合并倒计时（百万年）：约 45 亿年 */
export const MW_M31_MERGE_MYR = 4500;

/** 本星系群相对 CMB 本动速度（km/s）：约 620 km/s 朝巨引源方向 */
export const LG_PECULIAR_VELOCITY_KM_S = 620;

/** M31 质量占比（双方到质心的距离与质量成反比） */
export const M31_MASS_FRACTION = 0.556;

/** 初速度（光年/百万年）：110 km/s × 3.3357 */
const MW_M31_V0_LY_PER_MYR = MW_M31_APPROACH_KM_S * KM_S_TO_LY_PER_MYR;

/**
 * 匀加速接近模型的等效加速度 A（光年/Myr²）：
 * d(t) = d0 − v0·t − ½·A·t²，要求 d(T) = 0（T = 4500 Myr）
 * → A = 2(d0 − v0·T)/T²
 * 这是引力加速下轨道衰减的一阶近似（真实 N 体演化有多次穿越振荡，
 * 此处取首次并合时间的匀加速插值，已登记为示意性近似）。
 */
const MW_M31_ACCEL_LY_PER_MYR2 =
  (2 * (MW_M31_INITIAL_SEPARATION_LY - MW_M31_V0_LY_PER_MYR * MW_M31_MERGE_MYR)) /
  (MW_M31_MERGE_MYR * MW_M31_MERGE_MYR);

/**
 * MW–M31 合并前接近曲线（光年，未钳制——同源公式唯一出处）
 *
 * 匀加速接近：d(t) = d0 − v0·t − ½·A·t²，保证 d(0)=2.5e6、d(4500 Myr)=0。
 * t > 4500 Myr 时为负值（抛物线延伸，无物理意义）——合并时刻之后的
 * 演化语义由 utils/galaxyMerger.mwM31SignedSeparationLy 接管（R2-11：
 * 首次穿越/回摆振荡/终态并合，替换旧 clamp≥0 的"原地重叠"停滞语义）。
 */
export function mwM31ApproachSeparationLy(simDays: number): number {
  const t = simDaysToMyr(simDays);
  return (
    MW_M31_INITIAL_SEPARATION_LY -
    MW_M31_V0_LY_PER_MYR * t -
    0.5 * MW_M31_ACCEL_LY_PER_MYR2 * t * t
  );
}

/** 合并时刻的接近速度（光年/Myr）：v(T) = v0 + A·T（R2-11 穿越速度登记） */
export const MW_M31_V_AT_MERGE_LY_PER_MYR =
  MW_M31_V0_LY_PER_MYR + MW_M31_ACCEL_LY_PER_MYR2 * MW_M31_MERGE_MYR;

/**
 * MW–M31 当前距离（光年，非负）
 *
 * 合并时刻前 = 接近曲线；合并后钳 0（"已并合"的一阶近似）。
 * 渲染端位置解析请改用 galaxyMerger.mwM31SignedSeparationLy（R2-11，
 * 合并后有回摆振荡）；本函数保留给"距离必须非负"的标量消费者
 * （倒计时/质心分解等）。
 */
export function mwM31SeparationLy(simDays: number): number {
  return Math.max(0, mwM31ApproachSeparationLy(simDays));
}

/**
 * MW–M31 合并倒计时（百万年）：max(0, 4500 − t)
 */
export function mwM31MergeCountdownMyr(simDays: number): number {
  return Math.max(0, MW_M31_MERGE_MYR - simDaysToMyr(simDays));
}

/**
 * 本星系群质心系下 MW 与 M31 的位置（光年）
 *
 * 双体到质心的距离与质量成反比：
 * mw = −d̂·d·M31_MASS_FRACTION，m31 = +d̂·d·(1 − M31_MASS_FRACTION)
 *
 * @param directionToM31 指向 M31 的方向矢量（内部归一化，零矢量抛 RangeError）
 */
export function localGroupPositionsLy(
  simDays: number,
  directionToM31: Vec3,
): { mw: Vec3; m31: Vec3 } {
  const len = Math.hypot(directionToM31.x, directionToM31.y, directionToM31.z);
  if (len === 0) {
    throw new RangeError('指向 M31 的方向矢量不能为零矢量');
  }
  const ux = directionToM31.x / len;
  const uy = directionToM31.y / len;
  const uz = directionToM31.z / len;
  const d = mwM31SeparationLy(simDays);
  const mwDist = d * M31_MASS_FRACTION;
  const m31Dist = d * (1 - M31_MASS_FRACTION);
  return {
    mw: { x: -ux * mwDist, y: -uy * mwDist, z: -uz * mwDist },
    m31: { x: ux * m31Dist, y: uy * m31Dist, z: uz * m31Dist },
  };
}

/**
 * 卫星星系轨道平面正交基（R2-10 direction 一致性修复）
 *
 * u = 归一化 direction（t=0 的径向单位矢量——首帧位置 = u·distance，
 *     与数据登记的真实天区方位及静态首帧渲染位置严格一致，消除跳变）；
 * v = t=0 处的轨道切向单位矢量：h = normalize(ŷ×u)（银道面内水平切向），
 *     m = u×h（轨道面内"极向"切向），v = h·cos(incl) + m·sin(incl)。
 *
 * inclinationDeg 为轨道平面姿态参数（示意登记）：0° → 过 direction 且
 * 尽可能贴近银道面的轨道；90° → 极轨道（轨道平面包含 direction 与银河系
 * 极轴 ŷ）。direction ∥ ŷ 时水平切向退化，回退 h = x̂。
 *
 * @throws RangeError direction 为零矢量或含非有限分量
 */
export function satelliteOrbitBasis(
  direction: Vec3,
  inclinationDeg: number,
): { u: Vec3; v: Vec3 } {
  const len = Math.hypot(direction.x, direction.y, direction.z);
  if (!Number.isFinite(len) || len === 0) {
    throw new RangeError('卫星星系 direction 必须为非零有限矢量');
  }
  const u: Vec3 = { x: direction.x / len, y: direction.y / len, z: direction.z / len };
  // h = normalize(ŷ × u) = normalize((u.z, 0, −u.x))
  const hLen = Math.hypot(u.z, u.x);
  const h: Vec3 =
    hLen < 1e-9 ? { x: 1, y: 0, z: 0 } : { x: u.z / hLen, y: 0, z: -u.x / hLen };
  // m = u × h（u ⊥ h 且均为单位矢量 → m 亦为单位矢量）
  const m: Vec3 = {
    x: u.y * h.z - u.z * h.y,
    y: u.z * h.x - u.x * h.z,
    z: u.x * h.y - u.y * h.x,
  };
  const incl = (inclinationDeg * Math.PI) / 180;
  const cos = Math.cos(incl);
  const sin = Math.sin(incl);
  return {
    u,
    v: { x: h.x * cos + m.x * sin, y: h.y * cos + m.y * sin, z: h.z * cos + m.z * sin },
  };
}

/** 轨道基下角度 θ 处的圆轨道点（位置/轨道线共用的唯一公式，禁止两套参数） */
function orbitPointLy(distanceLy: number, u: Vec3, v: Vec3, thetaRad: number): Vec3 {
  const c = Math.cos(thetaRad);
  const s = Math.sin(thetaRad);
  return {
    x: distanceLy * (u.x * c + v.x * s),
    y: distanceLy * (u.y * c + v.y * s),
    z: distanceLy * (u.z * c + v.z * s),
  };
}

/**
 * 卫星星系（大小麦哲伦云/人马座矮星系）绕银河系的圆轨道位置
 * （光年，银河系中心系）
 *
 * θ = 2π·t/period，p(t) = d·(u·cosθ + v·sinθ)——t=0 时 p = direction×distance
 * （R2-10 direction 一致性修复，轨道从数据登记的天区方位起步）。
 * 真实麦哲伦云轨道为高椭圆且周期有争议（约 15–25 亿年）、人马座矮星系
 * 轨道周期约 8.5–10 亿年，此处采用圆轨道示意（已登记为近似处理）。
 */
export function satelliteGalaxyPositionLy(
  distanceLy: number,
  periodMyr: number,
  direction: Vec3,
  inclinationDeg: number,
  simDays: number,
): Vec3 {
  if (distanceLy <= 0) {
    throw new RangeError(`卫星星系距离必须为正数，收到 ${distanceLy}`);
  }
  if (periodMyr <= 0) {
    throw new RangeError(`卫星星系轨道周期必须为正数，收到 ${periodMyr}`);
  }
  const { u, v } = satelliteOrbitBasis(direction, inclinationDeg);
  const theta = (Math.PI * 2 * simDaysToMyr(simDays)) / periodMyr;
  return orbitPointLy(distanceLy, u, v, theta);
}

/**
 * 卫星星系轨道线采样点（光年，银河系中心系，R2-10 卫星星系轨道线）
 *
 * 与 satelliteGalaxyPositionLy 共用同一 orbitPointLy 公式（同源，
 * 禁止两套参数）——任意时刻的运动位置严格落在该轨道线上。
 * 返回 segments+1 个点（首尾闭合）。
 *
 * @param segments 采样段数（≥ 3 的整数）
 */
export function satelliteOrbitPointsLy(
  distanceLy: number,
  direction: Vec3,
  inclinationDeg: number,
  segments: number,
): Vec3[] {
  if (distanceLy <= 0) {
    throw new RangeError(`卫星星系距离必须为正数，收到 ${distanceLy}`);
  }
  if (!Number.isInteger(segments) || segments < 3) {
    throw new RangeError(`轨道线采样段数必须为 ≥ 3 的整数，收到 ${segments}`);
  }
  const { u, v } = satelliteOrbitBasis(direction, inclinationDeg);
  const points: Vec3[] = [];
  for (let s = 0; s <= segments; s += 1) {
    points.push(orbitPointLy(distanceLy, u, v, (s / segments) * Math.PI * 2));
  }
  return points;
}

// ---------------------------------------------------------------------------
// 银河系—仙女座碰撞合并快进预览（可选需求 3.1.3）
// ---------------------------------------------------------------------------

/** 合并预览动画时长（真实秒） */
export const MERGE_PREVIEW_DURATION_SEC = 12;

/** 合并时刻的模拟时间（J2000 起天数）：4500 Myr × 365.25e6 天/Myr */
export const MERGE_TARGET_SIM_DAYS = MW_M31_MERGE_MYR * DAYS_PER_MYR;

/**
 * 合并预览的模拟时间插值（可选需求：时间快进预览碰撞合并）
 *
 * 从当前模拟时间平滑快进到合并时刻（easeInOutCubic 缓动），
 * progress01 = 1 时精确到达 MERGE_TARGET_SIM_DAYS。
 */
export function mergePreviewSimDays(startSimDays: number, progress01: number): number {
  const p = Math.min(1, Math.max(0, progress01));
  return startSimDays + (MERGE_TARGET_SIM_DAYS - startSimDays) * easeInOutCubic(p);
}

/** 合并辉光起始距离（光年）：两星系相距该距离内开始显现合并辉光 */
export const MERGE_GLOW_ONSET_LY = 5e5;

/**
 * 合并辉光不透明度（0-1）：距离越近越亮，separation=0 时为 1
 *
 * 两星系接近至 MERGE_GLOW_ONSET_LY 内时线性增强（碰撞合并过程示意）。
 */
export function mergeGlowOpacity01(separationLy: number): number {
  if (separationLy < 0 || !Number.isFinite(separationLy)) {
    throw new RangeError(`距离必须为非负有限数，收到 ${separationLy}`);
  }
  return Math.min(1, Math.max(0, 1 - separationLy / MERGE_GLOW_ONSET_LY));
}

// ---------------------------------------------------------------------------
// 哈勃膨胀示意（可选需求 3.1.3：遥远星系红移退行）
// ---------------------------------------------------------------------------

/**
 * 哈勃常数（1/Myr）：H₀ ≈ 70 km/s/Mpc ≈ 7.16e-5 /Myr
 * 推导：70 km/s/Mpc × 3.2408e-20 /km·Mpc × 3.1557e13 s/Myr ≈ 7.16e-5
 * 来源：Planck 2018 / SH0ES 折中取值
 */
export const HUBBLE_H0_PER_MYR = 7.16e-5;

/** 哈勃缩放因子上限（避免长时间快进后宇宙网粒子飞出可视范围） */
export const HUBBLE_MAX_SCALE = 2.5;

/**
 * 哈勃膨胀缩放因子（线性一阶近似，示意已登记）
 *
 * a(t) = 1 + H₀·t：以整体缩放宇宙网实现"退行速度与距离成正比"
 * （v = H·d，哈勃定律的几何本质）。t < 0（回溯）时收缩，下限 0.2。
 */
export function hubbleScaleFactor(simDays: number, h0PerMyr = HUBBLE_H0_PER_MYR): number {
  if (h0PerMyr < 0) {
    throw new RangeError(`哈勃常数不能为负，收到 ${h0PerMyr}`);
  }
  const scale = 1 + h0PerMyr * simDaysToMyr(simDays);
  return Math.min(HUBBLE_MAX_SCALE, Math.max(0.2, scale));
}

// ---------------------------------------------------------------------------
// 麦哲伦星流（可选需求 3.1.3：LMC/SMC 拖曳的气体流）
// ---------------------------------------------------------------------------

/** 麦哲伦星流回溯时长（百万年）：气体流沿卫星星系轨道拖尾的示意长度 */
export const MAGELLANIC_STREAM_TRAIL_MYR = 600;

/** 潮汐流采样配置（R2-10：麦哲伦星流/人马座潮汐流共用） */
export interface TidalStreamConfig {
  /** 沿轨道向后回溯时长（百万年，尾随臂） */
  backMyr: number;
  /** 沿轨道向前延伸时长（百万年，前导臂；0 = 仅拖尾） */
  forwardMyr: number;
  /** 横向抖动幅度（相对轨道半径的比例） */
  jitterFrac: number;
  /** 确定性种子 */
  seed: number;
}

/**
 * 潮汐流采样点（光年，银河系中心系，R2-10 泛化）
 *
 * 沿卫星星系轨道从 +forwardMyr（前导臂端）到 −backMyr（尾随臂端）
 * 等时距采样（历史/未来路径上剥离的气体与恒星示意，已登记），
 * 每个点加确定性横向抖动模拟弥散——离卫星星系越远弥散越大。
 *
 * @param count 采样点数（≥ 2 的整数）
 */
export function tidalStreamPointsLy(
  distanceLy: number,
  periodMyr: number,
  direction: Vec3,
  inclinationDeg: number,
  simDays: number,
  count: number,
  config: TidalStreamConfig,
): Vec3[] {
  if (count < 2 || !Number.isInteger(count)) {
    throw new RangeError(`采样点数必须为 ≥ 2 的整数，收到 ${count}`);
  }
  if (config.backMyr < 0 || config.forwardMyr < 0 || config.backMyr + config.forwardMyr <= 0) {
    throw new RangeError(
      `潮汐流时长必须非负且总和为正，收到 back=${config.backMyr} forward=${config.forwardMyr}`,
    );
  }
  if (config.jitterFrac < 0) {
    throw new RangeError(`抖动比例不能为负，收到 ${config.jitterFrac}`);
  }
  const rand = createSeededRandom(config.seed);
  const spanMyr = config.backMyr + config.forwardMyr;
  const maxAbsMyr = Math.max(config.backMyr, config.forwardMyr);
  const points: Vec3[] = [];
  for (let i = 0; i < count; i += 1) {
    const t01 = i / (count - 1);
    // 时间偏移：+forwardMyr（前导端）→ −backMyr（尾随端）
    const offsetMyr = config.forwardMyr - t01 * spanMyr;
    const p = satelliteGalaxyPositionLy(
      distanceLy,
      periodMyr,
      direction,
      inclinationDeg,
      simDays + offsetMyr * DAYS_PER_MYR,
    );
    // 弥散：离卫星星系当前位置越远（|offset| 越大）抖动越大
    const dist01 = Math.abs(offsetMyr) / maxAbsMyr;
    const jitter = distanceLy * config.jitterFrac * (0.3 + dist01);
    points.push({
      x: p.x + (rand() * 2 - 1) * jitter,
      y: p.y + (rand() * 2 - 1) * jitter,
      z: p.z + (rand() * 2 - 1) * jitter,
    });
  }
  return points;
}

/**
 * 麦哲伦星流采样点（光年，银河系中心系）
 *
 * 真实麦哲伦星流为 LMC/SMC 受银河系潮汐剥离的中性氢气体流，
 * 横跨南天约 100°。此处沿卫星星系轨道向后回溯采样（拖尾示意，已登记；
 * R2-10 起委托 tidalStreamPointsLy，与 LMC 运动位置同源）。
 *
 * @param count 采样点数（≥ 2）
 */
export function magellanicStreamPointsLy(
  distanceLy: number,
  periodMyr: number,
  direction: Vec3,
  inclinationDeg: number,
  simDays: number,
  count: number,
  seed = 20260725,
): Vec3[] {
  return tidalStreamPointsLy(distanceLy, periodMyr, direction, inclinationDeg, simDays, count, {
    backMyr: MAGELLANIC_STREAM_TRAIL_MYR,
    forwardMyr: 0,
    jitterFrac: 0.04,
    seed,
  });
}

// ---------------------------------------------------------------------------
// M31 接近进度流动光点（R2-10：对数距离压缩下"正在接近"的进度感）
// ---------------------------------------------------------------------------

/** 接近虚线上的流动光点数量 */
export const M31_APPROACH_FLOW_COUNT = 6;

/**
 * 流动光点循环周期（真实秒）。
 * UI 节奏示意（已登记）：真实接近速度（~110 km/s）经对数距离压缩后
 * 不可感知，光点自 M31 端流向银河系端仅表达"正在接近"的方向与进度，
 * 流速非物理量（同 Galaxy.tsx 流动刻度模式的 UI 高亮性质）。
 */
export const M31_APPROACH_FLOW_PERIOD_SEC = 7;

/**
 * 第 index 个流动光点在接近虚线上的归一化位置（[0,1) 循环）
 *
 * 0 = M31 当前位置端，1 = 银河系（原点）端；随真实经过秒数由
 * M31 端流向银河系端，count 个光点等相位间隔分布。
 */
export function m31ApproachFlow01(
  elapsedSeconds: number,
  index: number,
  count = M31_APPROACH_FLOW_COUNT,
  periodSec = M31_APPROACH_FLOW_PERIOD_SEC,
): number {
  if (!Number.isFinite(elapsedSeconds)) {
    throw new RangeError(`经过秒数必须为有限数，收到 ${elapsedSeconds}`);
  }
  if (!Number.isInteger(count) || count < 1) {
    throw new RangeError(`光点数必须为 ≥1 的整数，收到 ${count}`);
  }
  if (!Number.isInteger(index) || index < 0 || index >= count) {
    throw new RangeError(`光点索引必须在 [0, ${count}) 内，收到 ${index}`);
  }
  if (!(periodSec > 0)) {
    throw new RangeError(`流动周期必须为正数，收到 ${periodSec}`);
  }
  const raw = elapsedSeconds / periodSec + index / count;
  return raw - Math.floor(raw);
}

// ---------------------------------------------------------------------------
// 可观测宇宙边界（可选需求 3.1.3）
// ---------------------------------------------------------------------------

/** 可观测宇宙半径（光年）：约 465 亿光年（共动距离，Planck 2018） */
export const OBSERVABLE_UNIVERSE_RADIUS_LY = 4.65e10;

/** 宇宙网生成配置（场景单位） */
export interface CosmicWebConfig {
  /** 确定性种子 */
  seed: number;
  /** 星系团节点数 */
  nodeCount: number;
  /** 节点分布球壳内半径（场景单位） */
  minRadiusUnits: number;
  /** 节点分布球壳外半径（场景单位） */
  maxRadiusUnits: number;
  /** 每节点连接的近邻数（纤维） */
  linksPerNode: number;
  /** 每条纤维上的星系数 */
  galaxiesPerLink: number;
  /** 每个节点团块星系数 */
  galaxiesPerNode: number;
  /** 纤维横向抖动（高斯 σ，场景单位） */
  filamentJitterUnits: number;
  /** 节点团块半径（高斯 σ，场景单位） */
  clusterRadiusUnits: number;
}

/** 宇宙网数据（Float32Array 可直接上传 GPU） */
export interface CosmicWeb {
  /** 节点位置（nodeCount*3，场景单位） */
  nodePositions: Float32Array;
  /** 星系位置（galaxyCount*3，场景单位） */
  galaxyPositions: Float32Array;
  /** 星系颜色（galaxyCount*3，昏暗的多样色调） */
  galaxyColors: Float32Array;
  galaxyCount: number;
}

/** 宇宙网星系基色（昏暗多样色调：淡紫 / 暖灰 / 冷蓝灰） */
const WEB_PALETTE: readonly { r: number; g: number; b: number }[] = [
  hexToRgb('#c8c2d8'),
  hexToRgb('#d8c8b8'),
  hexToRgb('#b8c8d8'),
];

/**
 * 确定性生成宇宙网（需求 3.1.3：星系团节点—纤维—空洞的非均匀分布，
 * 禁止均匀随机撒点）
 *
 * 实现：
 * 1. 节点在球壳 [minRadius, maxRadius] 内确定性随机分布（星系团）；
 * 2. 每个节点连接 linksPerNode 个最近邻节点，按 (小索引-大索引) 去重（纤维）；
 * 3. 沿每条边线性插值采样 galaxiesPerLink 个点 + 高斯横向抖动；
 * 4. 每个节点周围高斯团块 galaxiesPerNode 个；
 * 5. 未被节点/纤维覆盖的区域自然形成空洞。
 */
export function generateCosmicWeb(config: CosmicWebConfig): CosmicWeb {
  if (config.nodeCount < 2 || !Number.isInteger(config.nodeCount)) {
    throw new RangeError(`节点数必须为 ≥ 2 的整数，收到 ${config.nodeCount}`);
  }
  if (config.minRadiusUnits <= 0) {
    throw new RangeError(`球壳内半径必须为正数，收到 ${config.minRadiusUnits}`);
  }
  if (config.maxRadiusUnits <= config.minRadiusUnits) {
    throw new RangeError('球壳外半径必须大于内半径');
  }
  if (config.linksPerNode < 0) {
    throw new RangeError(`每节点连接数不能为负，收到 ${config.linksPerNode}`);
  }
  if (config.galaxiesPerLink < 0) {
    throw new RangeError(`每条纤维星系数不能为负，收到 ${config.galaxiesPerLink}`);
  }
  if (config.galaxiesPerNode < 0) {
    throw new RangeError(`每节点团块星系数不能为负，收到 ${config.galaxiesPerNode}`);
  }

  const rand = createSeededRandom(config.seed);
  const nodeCount = config.nodeCount;

  // ---- 1. 节点：球壳内确定性随机分布 ----
  const nodePositions = new Float32Array(nodeCount * 3);
  for (let i = 0; i < nodeCount; i += 1) {
    const r = config.minRadiusUnits + (config.maxRadiusUnits - config.minRadiusUnits) * rand();
    const cosPolar = rand() * 2 - 1;
    const azimuth = Math.PI * 2 * rand();
    const sinPolar = Math.sqrt(1 - cosPolar * cosPolar);
    nodePositions[i * 3] = r * sinPolar * Math.cos(azimuth);
    nodePositions[i * 3 + 1] = r * cosPolar;
    nodePositions[i * 3 + 2] = r * sinPolar * Math.sin(azimuth);
  }

  // ---- 2. 纤维：每节点连接最近邻，去重 ----
  const edges: Array<[number, number]> = [];
  const edgeSet = new Set<string>();
  const maxLinks = Math.min(config.linksPerNode, nodeCount - 1);
  for (let i = 0; i < nodeCount; i += 1) {
    const neighbors: Array<{ index: number; distSq: number }> = [];
    for (let j = 0; j < nodeCount; j += 1) {
      if (j === i) continue;
      const dx = nodePositions[j * 3] - nodePositions[i * 3];
      const dy = nodePositions[j * 3 + 1] - nodePositions[i * 3 + 1];
      const dz = nodePositions[j * 3 + 2] - nodePositions[i * 3 + 2];
      neighbors.push({ index: j, distSq: dx * dx + dy * dy + dz * dz });
    }
    // 距离升序；ES2019 稳定排序保证等距时保持索引序 → 结果确定
    neighbors.sort((a, b) => a.distSq - b.distSq);
    for (let k = 0; k < maxLinks; k += 1) {
      const j = neighbors[k].index;
      const lo = Math.min(i, j);
      const hi = Math.max(i, j);
      const key = `${lo}-${hi}`;
      if (!edgeSet.has(key)) {
        edgeSet.add(key);
        edges.push([lo, hi]);
      }
    }
  }

  // ---- 3+4. 星系：纤维采样 + 节点团块 ----
  const galaxyCount = edges.length * config.galaxiesPerLink + nodeCount * config.galaxiesPerNode;
  const galaxyPositions = new Float32Array(galaxyCount * 3);
  const galaxyColors = new Float32Array(galaxyCount * 3);
  let cursor = 0;

  const writeGalaxy = (x: number, y: number, z: number): void => {
    galaxyPositions[cursor * 3] = x;
    galaxyPositions[cursor * 3 + 1] = y;
    galaxyPositions[cursor * 3 + 2] = z;
    const base = WEB_PALETTE[Math.floor(rand() * WEB_PALETTE.length)];
    const brightness = 0.3 + 0.5 * rand();
    // 红移示意（可选需求 3.1.3 哈勃膨胀）：越远的星系颜色越偏红、越暗
    // （红移退行的视觉示意，已登记；真实红移为光谱移动而非简单变红）
    // 通过压低 G/B 通道实现色调偏红 + 整体变暗，保持"昏暗"亮度上限不变
    const redshift01 = Math.min(
      1,
      Math.hypot(x, y, z) / Math.max(config.maxRadiusUnits, 1e-6),
    );
    const gShift = 1 - 0.3 * redshift01;
    const bShift = 1 - 0.5 * redshift01;
    galaxyColors[cursor * 3] = base.r * brightness;
    galaxyColors[cursor * 3 + 1] = base.g * brightness * gShift;
    galaxyColors[cursor * 3 + 2] = base.b * brightness * bShift;
    cursor += 1;
  };

  for (const [a, b] of edges) {
    for (let k = 0; k < config.galaxiesPerLink; k += 1) {
      const t = (k + 1) / (config.galaxiesPerLink + 1);
      writeGalaxy(
        nodePositions[a * 3] * (1 - t) +
          nodePositions[b * 3] * t +
          gaussian(rand) * config.filamentJitterUnits,
        nodePositions[a * 3 + 1] * (1 - t) +
          nodePositions[b * 3 + 1] * t +
          gaussian(rand) * config.filamentJitterUnits,
        nodePositions[a * 3 + 2] * (1 - t) +
          nodePositions[b * 3 + 2] * t +
          gaussian(rand) * config.filamentJitterUnits,
      );
    }
  }

  for (let i = 0; i < nodeCount; i += 1) {
    for (let k = 0; k < config.galaxiesPerNode; k += 1) {
      writeGalaxy(
        nodePositions[i * 3] + gaussian(rand) * config.clusterRadiusUnits,
        nodePositions[i * 3 + 1] + gaussian(rand) * config.clusterRadiusUnits,
        nodePositions[i * 3 + 2] + gaussian(rand) * config.clusterRadiusUnits,
      );
    }
  }

  return { nodePositions, galaxyPositions, galaxyColors, galaxyCount };
}

/**
 * 标准正态分布随机数（Box-Muller 变换）
 */
function gaussian(rand: () => number): number {
  const u = 1 - rand(); // (0, 1]，避免 log(0)
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(Math.PI * 2 * v);
}

/**
 * #RRGGBB → RGB（0-1）。仅用于本文件内置色板常量，不做格式校验。
 */
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const v = hex.replace('#', '');
  return {
    r: parseInt(v.slice(0, 2), 16) / 255,
    g: parseInt(v.slice(2, 4), 16) / 255,
    b: parseInt(v.slice(4, 6), 16) / 255,
  };
}
