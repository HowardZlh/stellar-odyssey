/**
 * 太阳活动事件纯逻辑（S2，IMPROVEMENT_REQUIREMENTS_SOLAR §4.3-2/3/4/6）：
 * 耀斑（flare）、日冕物质抛射（CME）、太阳风（solar wind）、日珥/日冕环。
 *
 * 科学背景（数据来源：NOAA GOES X 射线耀斑分级；NASA/SOHO LASCO CME 目录；
 * Yashiro et al. 2005 耀斑-CME 关联统计；Parker 1958 太阳风理论）：
 * - 耀斑：活动区磁重联释放能量，按软 X 射线峰值通量分级 C/M/X
 *   （每级 10 倍），几分钟内可释放相当于数十亿颗氢弹的能量。
 * - CME：大团等离子体从日冕喷出，速度 250–3,000 km/s；与耀斑的
 *   关联率随级别升高（X 级 ~90%）；朝地球方向时可能引发地磁暴。
 * - 太阳风：日冕持续外流的带电粒子流（质子/电子），速度 400–800 km/s。
 * - 日珥：色球物质沿磁力线悬浮于日冕中的弧状结构，寿命数天至数月。
 *
 * ── 艺术化/近似登记（需求 §3、AGENTS.md 数据准确性）──────────────────
 * - 耀斑时长（速率钳制类减速登记）：真实几分钟至几小时；模拟以
 *   FLARE_DURATION_DAYS（模拟天）呈现——L1 默认时间压缩比（1 秒≈4 小时）
 *   下约 10 秒动画；暂停冻结、快进联动（共享模拟时间轴）。
 * - 耀斑触发频率：真实频率随活动周期在"每天数次～数周一次"间变化
 *   （周期联动属 S3），模拟按泊松过程取理想化平均间隔
 *   FLARE_MEAN_INTERVAL_DAYS，且 C/M/X 概率分布向高级别倾斜以便演示。
 * - CME/太阳风速度：物理速度量级真实（km/s 按场景尺度换算），
 *   CME 粒子在 CME_MAX_RADIUS_UNITS（约 2.6 AU）处淡出回收（真实 CME
 *   持续传播至日球层边缘）。
 * - 日珥高度取 ~0.22 R☉（真实大日珥数万公里 ≈ 0.05–0.1 R☉，特大爆发
 *   日珥可达 0.5 R☉；此处取放大值保证近观可辨）。
 */

import type { SolarFlareClass } from '@/types';
import { AU_KM, SCENE_UNITS_PER_AU } from '@/utils/scale';

// ---------------------------------------------------------------------------
// 耀斑（solar flare）
// ---------------------------------------------------------------------------

/** 耀斑动画总时长（模拟天；L1 压缩比下约 10 秒，减速登记见文件头） */
export const FLARE_DURATION_DAYS = 1.6;

/** 耀斑自动触发平均间隔（模拟天，泊松过程；频率理想化登记见文件头） */
export const FLARE_MEAN_INTERVAL_DAYS = 60;

/** 单帧模拟时间增量上限（天）：防时间跳变/快进后瞬间连爆 */
export const FLARE_TRIGGER_DELTA_CLAMP_DAYS = 1;

/** 耀斑亮起阶段占比（其余为指数衰减） */
export const FLARE_RISE_FRACTION = 0.18;

/** 耀斑级别分布（演示倾斜登记见文件头）：C 50% / M 35% / X 15% */
export const FLARE_CLASS_THRESHOLDS = { c: 0.5, m: 0.85 } as const;

/** 光球局部增亮峰值倍数（Bloom 阈值 0.55 之上，自然联动泛光） */
export const FLARE_BRIGHTNESS_BOOST = 3.2;

/** 耀斑增亮区角半径（弧度） */
export const FLARE_SPOT_RADIUS_RAD = 0.22;

/**
 * 耀斑级别判定（确定性映射，触发时刻一次性采样随机数）
 */
export function flareClassRoll(rand01: number): SolarFlareClass {
  const r = Math.min(1, Math.max(0, rand01));
  if (r < FLARE_CLASS_THRESHOLDS.c) return 'C';
  if (r < FLARE_CLASS_THRESHOLDS.m) return 'M';
  return 'X';
}

/**
 * 耀斑级内量级（1.0–9.9，如 X2.3 的 2.3）
 */
export function flareMagnitudeRoll(rand01: number): number {
  const r = Math.min(1, Math.max(0, rand01));
  return Math.round((1 + r * 8.9) * 10) / 10;
}

/**
 * 耀斑强度曲线（0-1）：局部快速增亮（easeOut）→ 峰值 → 指数衰减
 * （需求 §4.3-2 阶段动画；衰减常数使结束时 ≈0.018）。
 *
 * @param t01 事件进度（<0 或 ≥1 时返回 0）
 */
export function flareIntensity01(t01: number): number {
  if (!Number.isFinite(t01)) {
    throw new RangeError(`事件进度必须为有限数，收到 ${t01}`);
  }
  if (t01 <= 0 || t01 >= 1) return 0;
  if (t01 < FLARE_RISE_FRACTION) {
    const t = t01 / FLARE_RISE_FRACTION;
    return 1 - Math.pow(1 - t, 3);
  }
  const t = (t01 - FLARE_RISE_FRACTION) / (1 - FLARE_RISE_FRACTION);
  return Math.exp(-4 * t);
}

// --- B2 多峰光变（§4.7-B2）---------------------------------------------------

/** 脉冲相占比（快速尖峰前导，硬 X 射线/微波脉冲相示意） */
export const FLARE_IMPULSIVE_FRACTION = 0.1;
/** 脉冲相峰值相对主峰的高度（略低于主峰的前导尖峰） */
export const FLARE_IMPULSIVE_PEAK = 0.7;
/** 主峰（渐进相）中心位置（事件进度） */
export const FLARE_MAIN_PEAK_AT = 0.28;

/**
 * 耀斑多峰光变曲线（S4 B2，0-1）：脉冲相尖峰（impulsive phase，硬 X 射线/
 * 微波爆发）→ 短暂回落 → 主峰（gradual phase，软 X 射线主极大）→ 指数余辉。
 * 替代单峰指数（flareIntensity01 保留供 CME 联动阈值等既有逻辑）。
 * 数据来源：Fletcher et al. 2011 耀斑标准模型脉冲相/渐进相光变。
 *
 * @param t01 事件进度（<0 或 ≥1 时返回 0）
 * @returns 相对强度 ∈ [0,1]
 */
export function flareMultiPeakIntensity01(t01: number): number {
  if (!Number.isFinite(t01)) {
    throw new RangeError(`事件进度必须为有限数，收到 ${t01}`);
  }
  if (t01 <= 0 || t01 >= 1) return 0;
  // 脉冲相：快速尖峰（前 FLARE_IMPULSIVE_FRACTION 内起落）
  let impulsive = 0;
  if (t01 < FLARE_IMPULSIVE_FRACTION * 2) {
    const x = t01 / (FLARE_IMPULSIVE_FRACTION * 2);
    // 三角/正弦尖峰
    impulsive = FLARE_IMPULSIVE_PEAK * Math.sin(Math.PI * Math.min(1, x));
  }
  // 主峰 + 余辉：主峰位于 FLARE_MAIN_PEAK_AT，之后指数衰减
  let gradual: number;
  if (t01 < FLARE_MAIN_PEAK_AT) {
    const x = t01 / FLARE_MAIN_PEAK_AT;
    gradual = x * x * (3 - 2 * x); // 平滑上升到主峰
  } else {
    const x = (t01 - FLARE_MAIN_PEAK_AT) / (1 - FLARE_MAIN_PEAK_AT);
    gradual = Math.exp(-4 * x); // 指数余辉
  }
  return Math.min(1, Math.max(impulsive, gradual));
}

// --- B3 耀斑后环（§4.7-B3）---------------------------------------------------

/** 耀斑后环起始进度（耀斑峰后才拱起，post-flare loop arcade） */
export const POST_FLARE_LOOP_START = 0.35;
/** 耀斑后环拱顶高度（× 足点间距，比常态日冕环略高，热后环高拱） */
export const POST_FLARE_LOOP_HEIGHT_RATIO = 0.85;
/** 耀斑后环最大条数（沿中性线铺开的后环拱） */
export const POST_FLARE_LOOP_COUNT = 5;

/**
 * 耀斑后环强度（S4 B3，0-1）：耀斑峰后活动区上方磁力线重联冷却，形成
 * 明亮的 post-flare loop arcade。峰后（POST_FLARE_LOOP_START 起）快速拱起、
 * 缓慢消退，延续到事件末。数据来源：Švestka 1996 耀斑后环系统。
 *
 * @param t01 耀斑事件进度 ∈ [0,1]
 * @returns 后环强度 ∈ [0,1]（峰前为 0）
 */
export function postFlareLoopStrength01(t01: number): number {
  if (t01 <= POST_FLARE_LOOP_START || t01 >= 1) return 0;
  const x = (t01 - POST_FLARE_LOOP_START) / (1 - POST_FLARE_LOOP_START);
  // 前 30% 快速拱起（easeOut），其后缓慢消退
  if (x < 0.3) {
    const u = x / 0.3;
    return 1 - Math.pow(1 - u, 2);
  }
  const u = (x - 0.3) / 0.7;
  // 平滑消退到 0（事件结束无跳变）
  return 1 - u * u * (3 - 2 * u);
}

/**
 * 耀斑光球局部增亮量（shader 镜像）：增亮区平滑衰减窗 × 峰值倍数 × 强度。
 * 峰值亮度远超 Bloom 阈值（0.55），自然联动泛光（需求 §4.3-2 峰值闪光）。
 *
 * @param angDistRad 片元方向与耀斑源的角距（弧度）
 * @param intensity01 耀斑强度（flareIntensity01 结果）
 */
export function flareLocalBoost(angDistRad: number, intensity01: number): number {
  const t = Math.min(1, Math.max(0, angDistRad / FLARE_SPOT_RADIUS_RAD));
  const w = 1 - t * t * (3 - 2 * t);
  return FLARE_BRIGHTNESS_BOOST * Math.min(1, Math.max(0, intensity01)) * w * w;
}

// ---------------------------------------------------------------------------
// S4 B1：双带耀斑（two-ribbon flare，§4.7-B1）
// ---------------------------------------------------------------------------

/**
 * 双带耀斑带半宽（弧度）：沿磁中性线两侧各一条带状增亮的横向半宽。
 * 数据来源：Yashiro et al. (2005) 耀斑-CME 关联；two-ribbon 为最典型耀斑形态。
 */
export const FLARE_RIBBON_HALF_WIDTH_RAD = 0.05;

/** 双带中心相对中性线的横向偏移（弧度）：两条带分列中性线两侧 */
export const FLARE_RIBBON_OFFSET_RAD = 0.055;

/** 双带沿中性线的纵向延伸倍数（相对中性线段长，带比黑子群略长） */
export const FLARE_RIBBON_ALONG_EXTEND = 1.15;

/**
 * 双带耀斑局部增亮量（S4 B1，shader 镜像）：沿磁中性线两侧的两条带状增亮。
 * 片元到最近一条带中心线的横向角距在半宽内则增亮，沿带方向以 sin 包络两端
 * 渐隐。峰值同 flareLocalBoost 量级（超 Bloom 阈值自然泛光）。
 *
 * 几何约定：调用方已将片元投影到中性线局部坐标——
 *   perpDistRad：片元到中性线的横向（垂直）角距（带符号，两侧异号）；
 *   alongFrac：沿中性线的归一化位置 ∈ [0,1]（0/1 为两端，超出不增亮）。
 *
 * @param perpDistRad 片元到中性线的带符号横向角距（弧度）
 * @param alongFrac 沿中性线归一化位置 ∈ [0,1]
 * @param intensity01 耀斑强度（flareIntensity01 结果）
 * @returns 增亮量（≥0）
 */
export function flareRibbonBoost(
  perpDistRad: number,
  alongFrac: number,
  intensity01: number,
): number {
  if (alongFrac < 0 || alongFrac > 1) return 0;
  const s = Math.min(1, Math.max(0, intensity01));
  if (s <= 0) return 0;
  // 到两条带中心（±FLARE_RIBBON_OFFSET_RAD）的最近距离
  const dToRibbon = Math.min(
    Math.abs(perpDistRad - FLARE_RIBBON_OFFSET_RAD),
    Math.abs(perpDistRad + FLARE_RIBBON_OFFSET_RAD),
  );
  if (dToRibbon >= FLARE_RIBBON_HALF_WIDTH_RAD) return 0;
  // 横向三角窗（带心最亮）× 沿带 sin 包络（两端渐隐）
  const across = 1 - dToRibbon / FLARE_RIBBON_HALF_WIDTH_RAD;
  const along = Math.sin(Math.PI * alongFrac);
  const w = across * along;
  return FLARE_BRIGHTNESS_BOOST * s * w * w;
}

/**
 * 耀斑事件进度（0-1，超出范围钳制到边界外由 flareIntensity01 归零）
 */
export function flareProgress01(simDays: number, startedAtSimDays: number, durationDays: number): number {
  if (!(durationDays > 0)) {
    throw new RangeError(`事件时长必须为正数，收到 ${durationDays}`);
  }
  return (simDays - startedAtSimDays) / durationDays;
}

/**
 * 周期调制后的泊松平均间隔（S3，§4.4）：基础均值按活动周期频率因子缩放。
 * 频率因子越大（极大期）→ 平均间隔越短 → 触发越频繁；反之极小期更稀疏。
 *
 * @param baseMeanIntervalDays 基础平均间隔（FLARE_MEAN_INTERVAL_DAYS 等）
 * @param frequencyFactor 周期频率因子（solarCycle.cycleFrequencyFactor 结果，>0）
 * @returns 调制后的平均间隔（天）= 基础均值 / 因子
 */
export function cycleModulatedMeanInterval(
  baseMeanIntervalDays: number,
  frequencyFactor: number,
): number {
  if (!(baseMeanIntervalDays > 0)) {
    throw new RangeError(`基础均值必须为正数，收到 ${baseMeanIntervalDays}`);
  }
  if (!(frequencyFactor > 0)) {
    throw new RangeError(`频率因子必须为正数，收到 ${frequencyFactor}`);
  }
  return baseMeanIntervalDays / frequencyFactor;
}

/**
 * 自动触发判定（泊松过程，同超新星范式）：Δt 内至少发生一次的概率
 * p = 1 − exp(−Δt/mean)；Δt 先按 FLARE_TRIGGER_DELTA_CLAMP_DAYS 钳制。
 */
export function shouldAutoTriggerFlare(
  rand01: number,
  deltaSimDays: number,
  meanIntervalDays: number = FLARE_MEAN_INTERVAL_DAYS,
): boolean {
  if (meanIntervalDays <= 0) {
    throw new RangeError(`平均间隔必须为正数，收到 ${meanIntervalDays}`);
  }
  if (deltaSimDays <= 0) return false;
  const clamped = Math.min(deltaSimDays, FLARE_TRIGGER_DELTA_CLAMP_DAYS);
  return rand01 < 1 - Math.exp(-clamped / meanIntervalDays);
}

// ---------------------------------------------------------------------------
// CME（日冕物质抛射）
// ---------------------------------------------------------------------------

/** CME 速度范围（km/s，真实量级） */
export const CME_SPEED_KM_S_MIN = 250;
export const CME_SPEED_KM_S_MAX = 3000;

/** CME 粒子壳层最大半径（场景单位 ≈ 2.6 AU，淡出回收边界，登记见文件头） */
export const CME_MAX_RADIUS_UNITS = 26;

/** CME 锥面半张角（度，典型 CME 角宽 ~45°–60°，取半角 30°） */
export const CME_CONE_HALF_ANGLE_DEG = 30;

/** 朝地球判定角阈值（度）：抛射方向与日-地连线夹角小于该值视为朝向地球 */
export const CME_EARTH_DIRECTED_DEG = 25;

/** 独立 CME（无耀斑前导）自动触发平均间隔（模拟天，泊松；频率理想化登记见文件头） */
export const CME_INDEPENDENT_MEAN_INTERVAL_DAYS = 180;

/** 耀斑-CME 关联概率（Yashiro et al. 2005 量级）：级别越高关联率越高 */
export function cmeLinkProbability(flareClass: SolarFlareClass): number {
  switch (flareClass) {
    case 'X':
      return 0.9;
    case 'M':
      return 0.4;
    default:
      return 0.1;
  }
}

/**
 * 按耀斑级别取 CME 速度（km/s）：级别越高越快（观测统计趋势）
 */
export function cmeSpeedForClass(flareClass: SolarFlareClass, rand01: number): number {
  const r = Math.min(1, Math.max(0, rand01));
  switch (flareClass) {
    case 'X':
      return 1200 + r * (CME_SPEED_KM_S_MAX - 1200);
    case 'M':
      return 600 + r * 900;
    default:
      return CME_SPEED_KM_S_MIN + r * 450;
  }
}

/**
 * km/s → 场景单位/模拟天（物理速度按场景尺度换算，1 AU = 10 单位）
 */
export function kmPerSecToUnitsPerDay(kmPerSec: number): number {
  if (!(kmPerSec > 0) || !Number.isFinite(kmPerSec)) {
    throw new RangeError(`速度必须为正有限数，收到 ${kmPerSec}`);
  }
  return (kmPerSec * 86400 * SCENE_UNITS_PER_AU) / AU_KM;
}

/**
 * CME 壳层半径（场景单位）：匀速扩张 r = r0 + v·t
 */
export function cmeShellRadiusUnits(
  elapsedDays: number,
  speedUnitsPerDay: number,
  startRadiusUnits: number,
): number {
  if (elapsedDays < 0) return startRadiusUnits;
  return startRadiusUnits + speedUnitsPerDay * elapsedDays;
}

// --- C2 加速段运动学（§4.7-C2）---------------------------------------------

/**
 * CME 加速段时长占比（S4 C2）：真实 CME 在低日冕经历初始加速（数十分钟至
 * 数小时），随后转为近匀速传播。此处以事件总时长的该占比作加速段
 * （数据来源：Zhang et al. 2001 CME 三阶段运动学；加速段量级 ~1–2 小时）。
 */
export const CME_ACCEL_FRACTION = 0.12;

/**
 * CME 加速段位移曲线因子（S4 C2）：加速段内速度从 0 线性升至巡航速度
 * （匀加速，位移 ∝ t²/2），加速段后转匀速。返回"等效已行进时间"
 * （单位：天），供 r = r0 + v·teff 复用现有匀速公式，运动学连续。
 *
 * 设加速段时长 ta = CME_ACCEL_FRACTION × 总时长；加速段内 v(t)=v·(t/ta)，
 * 位移 s(t)=v·t²/(2ta)，等效时间 teff=t²/(2ta)；加速段末 teff=ta/2；
 * 之后 teff = (t − ta) + ta/2（匀速接续）。
 *
 * @param elapsedDays 自喷发起经过的模拟天
 * @param totalDurationDays 事件总时长（用于定加速段长度）
 * @returns 等效已行进时间（天，≥0）
 */
export function cmeAcceleratedElapsedDays(
  elapsedDays: number,
  totalDurationDays: number,
): number {
  if (!(totalDurationDays > 0)) {
    throw new RangeError(`事件总时长必须为正数，收到 ${totalDurationDays}`);
  }
  if (elapsedDays <= 0) return 0;
  const ta = CME_ACCEL_FRACTION * totalDurationDays;
  if (ta <= 0) return elapsedDays;
  if (elapsedDays < ta) {
    return (elapsedDays * elapsedDays) / (2 * ta);
  }
  return elapsedDays - ta + ta / 2;
}

// --- C1 三分量结构（§4.7-C1）-----------------------------------------------

/**
 * CME 三分量径向壳层归属（S4 C1）：真实 CME 经典结构为
 * 亮前沿（leading front，最外，被扫积压缩的日冕物质）+ 暗腔（cavity，
 * 中层低密度磁通量绳空腔）+ 亮核（core，最内，抛出的日珥物质）。
 * 数据来源：Illing & Hundhausen 1985 三分量形态；Vourlidas et al. 2013。
 *
 * 按粒子的确定性随机 [0,1) 分配层号：0 亮核 / 1 暗腔 / 2 亮前沿。
 * 概率分配：前沿粒子最多（壳最亮最厚）、暗腔次之、亮核较少。
 *
 * @param rand01 粒子确定性随机 [0,1)
 * @returns 层号 0/1/2
 */
export const CME_LAYER_THRESHOLDS = { core: 0.28, cavity: 0.6 } as const;

export function cmeParticleLayer(rand01: number): 0 | 1 | 2 {
  const r = Math.min(1, Math.max(0, rand01));
  if (r < CME_LAYER_THRESHOLDS.core) return 0;
  if (r < CME_LAYER_THRESHOLDS.cavity) return 1;
  return 2;
}

/**
 * CME 三分量径向位置因子（S4 C1）：各层粒子在壳层内的相对径向位置——
 * 亮核最内（~0.55–0.75 R_shell）、暗腔中层（~0.75–0.9）、亮前沿最外
 * （~0.9–1.0）。渲染端 r = r_shell × factor，形成分层结构。
 *
 * @param layer 层号（cmeParticleLayer 结果）
 * @param jitter01 层内径向抖动 [0,1)
 * @returns 径向位置因子 ∈ (0,1]
 */
export function cmeLayerRadialFactor(layer: 0 | 1 | 2, jitter01: number): number {
  const j = Math.min(1, Math.max(0, jitter01));
  switch (layer) {
    case 0:
      return 0.55 + 0.2 * j; // 亮核
    case 1:
      return 0.75 + 0.15 * j; // 暗腔
    default:
      return 0.9 + 0.1 * j; // 亮前沿
  }
}

/**
 * CME 三分量亮度因子（S4 C1）：亮前沿最亮、暗腔明显偏暗（空腔低密度）、
 * 亮核较亮（发光日珥物质）。用于 shader 分层着色。
 *
 * @param layer 层号
 * @returns 亮度倍数 ∈ (0,1]
 */
export function cmeLayerBrightness(layer: 0 | 1 | 2): number {
  switch (layer) {
    case 0:
      return 0.9; // 亮核
    case 1:
      return 0.35; // 暗腔（低密度显著偏暗）
    default:
      return 1.0; // 亮前沿
  }
}

/**
 * CME 事件进度（0-1）：壳层半径相对最大回收半径
 */
export function cmeProgress01(shellRadiusUnits: number, maxRadiusUnits: number = CME_MAX_RADIUS_UNITS): number {
  if (!(maxRadiusUnits > 0)) {
    throw new RangeError(`最大半径必须为正数，收到 ${maxRadiusUnits}`);
  }
  return Math.min(1, Math.max(0, shellRadiusUnits / maxRadiusUnits));
}

/**
 * CME 壳层透明度（0-1）：喷发初期快速浮现，扩张中随进度衰减淡出
 */
export function cmeOpacity01(progress01: number): number {
  const p = Math.min(1, Math.max(0, progress01));
  const appear = Math.min(1, p / 0.04);
  return appear * Math.pow(1 - p, 1.4);
}

/**
 * 是否朝向地球（点积角阈值判定）
 *
 * @param cmeDir CME 抛射方向（单位矢量）
 * @param earthDir 日→地方向（单位矢量）
 */
export function cmeIsEarthDirected(
  cmeDir: { x: number; y: number; z: number },
  earthDir: { x: number; y: number; z: number },
  thresholdDeg: number = CME_EARTH_DIRECTED_DEG,
): boolean {
  const dot = cmeDir.x * earthDir.x + cmeDir.y * earthDir.y + cmeDir.z * earthDir.z;
  return dot >= Math.cos((thresholdDeg * Math.PI) / 180);
}

/** 地球极光增强示意时长（模拟天，S3 §4.3-3）：CME 抵达后极区增亮窗口 */
export const AURORA_ENHANCEMENT_DAYS = 1.5;

/**
 * CME 抵达地球的传播延迟（模拟天，S3 §4.3-3）：按真实传播时间
 * 距离（1 AU）÷ 事件速度。真实 CME 抵达地球约 1–3 天（快 CME 更短），
 * 与场景 km/s→单位换算一致（1 AU = SCENE_UNITS_PER_AU 场景单位）。
 *
 * @param speedKmS CME 速度（km/s）
 * @returns 抵达延迟（模拟天）
 */
export function cmeArrivalDelayDays(speedKmS: number): number {
  if (!(speedKmS > 0) || !Number.isFinite(speedKmS)) {
    throw new RangeError(`速度必须为正有限数，收到 ${speedKmS}`);
  }
  // 1 AU 路程 / 速度：AU_KM / (km/s) 得秒，再换算为天
  return AU_KM / speedKmS / 86400;
}

/**
 * 极光增强强度（0-1，S3 §4.3-3）：CME 抵达后极区大气短暂增亮，
 * 快速起亮 → 缓慢消退（克制、可退化）。
 *
 * @param daysSinceArrival 自抵达起经过的模拟天
 * @returns 增强强度 ∈ [0,1]（窗口外为 0）
 */
export function auroraEnhancement01(daysSinceArrival: number): number {
  if (daysSinceArrival <= 0 || daysSinceArrival >= AURORA_ENHANCEMENT_DAYS) return 0;
  const t = daysSinceArrival / AURORA_ENHANCEMENT_DAYS;
  // 前 15% 快速起亮，其后指数消退
  if (t < 0.15) return t / 0.15;
  const x = (t - 0.15) / 0.85;
  return Math.exp(-3 * x);
}

/**
 * CME 锥内粒子方向（围绕 +Y 轴的确定性分布，渲染端整体旋转到抛射方向）：
 * 极角在 [0, 半张角] 内按面积均匀，方位角低差异分布 + 哈希抖动。
 *
 * @param count 粒子数
 * @param rand 随机数生成器（createSeededRandom 保证确定性）
 */
export function cmeConeDirections(count: number, rand: () => number): Float32Array {
  if (!Number.isInteger(count) || count <= 0) {
    throw new RangeError(`粒子数必须为正整数，收到 ${count}`);
  }
  const out = new Float32Array(count * 3);
  const cosHalf = Math.cos((CME_CONE_HALF_ANGLE_DEG * Math.PI) / 180);
  for (let i = 0; i < count; i += 1) {
    // 球冠面积均匀采样：cosθ ∈ [cosHalf, 1]
    const cosTheta = cosHalf + (1 - cosHalf) * rand();
    const sinTheta = Math.sqrt(Math.max(0, 1 - cosTheta * cosTheta));
    const phi = rand() * Math.PI * 2;
    out[i * 3] = sinTheta * Math.cos(phi);
    out[i * 3 + 1] = cosTheta;
    out[i * 3 + 2] = sinTheta * Math.sin(phi);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 太阳风（solar wind）
// ---------------------------------------------------------------------------

/** 太阳风典型速度（km/s，慢风 ~400 / 快风 ~800，取中值示意） */
export const WIND_SPEED_KM_S = 500;

/** 太阳风粒子数（常驻低密度；与 CME 峰值合计 ≤ 20,000，需求 §5.3） */
export const WIND_PARTICLE_COUNT = 6000;

/** CME 单事件粒子数（环形缓冲复用，事件间不增长） */
export const CME_PARTICLE_COUNT = 9000;

/** 太阳风外边界（场景单位 ≈ 2.4 AU） */
export const WIND_MAX_RADIUS_UNITS = 24;

/**
 * 太阳风单粒子循环周期（模拟天）：外边界距离 / 速度
 */
export function windCycleDays(
  startRadiusUnits: number,
  maxRadiusUnits: number = WIND_MAX_RADIUS_UNITS,
  speedKmS: number = WIND_SPEED_KM_S,
): number {
  if (!(maxRadiusUnits > startRadiusUnits)) {
    throw new RangeError(`外边界必须大于起始半径，收到 ${startRadiusUnits} → ${maxRadiusUnits}`);
  }
  return (maxRadiusUnits - startRadiusUnits) / kmPerSecToUnitsPerDay(speedKmS);
}

/**
 * 太阳风相位（0-1 循环回收，shader 镜像）：fract(t/cycle + seed)
 */
export function windPhase01(simDays: number, seed01: number, cycleDays: number): number {
  if (!(cycleDays > 0)) {
    throw new RangeError(`循环周期必须为正数，收到 ${cycleDays}`);
  }
  const raw = (simDays / cycleDays + seed01) % 1;
  return raw < 0 ? raw + 1 : raw;
}

/**
 * 太阳风 shader 时间回卷（天）：窗口取周期的 2048 倍整数倍——
 * fract((t+W)/cycle) ≡ fract(t/cycle)，回卷零观感差异（精确周期对齐）。
 */
export function windShaderDays(simDays: number, cycleDays: number): number {
  if (!Number.isFinite(simDays)) {
    throw new RangeError(`模拟时间必须为有限数，收到 ${simDays}`);
  }
  if (!(cycleDays > 0)) {
    throw new RangeError(`循环周期必须为正数，收到 ${cycleDays}`);
  }
  const wrap = cycleDays * 2048;
  const wrapped = simDays % wrap;
  return wrapped < 0 ? wrapped + wrap : wrapped;
}

/** 太阳风粒子基础透明度（亮度克制，不喧宾夺主——需求 §4.3-4） */
export const WIND_BASE_ALPHA = 0.16;

/**
 * 日冕洞方向快风速度增益（S3 §4.2）：日冕洞是高速太阳风源，该方向粒子
 * 显著更快（真实快风 ~800 km/s vs 慢风 ~400 km/s）。
 */
export const WIND_FAST_SPEED_GAIN = 1.6;

/** 日冕洞快风方向角半径（弧度，与 sunSurface.CORONAL_HOLE_RADIUS_RAD 呼应） */
export const WIND_FAST_CONE_RAD = 0.6;

/**
 * 太阳风方向速度因子（shader/CPU 镜像，§4.2）：粒子方向落在日冕洞锥内时
 * 速度增益（快风），锥外为常速慢风；锥内外平滑过渡。
 *
 * @param cosAngle 粒子方向与日冕洞方向的余弦（点积）
 * @returns 速度倍数 ∈ [1, WIND_FAST_SPEED_GAIN]
 */
export function windSpeedFactorForDirection(cosAngle: number): number {
  const c = Math.min(1, Math.max(-1, cosAngle));
  const ang = Math.acos(c);
  if (ang >= WIND_FAST_CONE_RAD) return 1;
  const t = ang / WIND_FAST_CONE_RAD;
  const smooth = t * t * (3 - 2 * t);
  // 锥中心最快、锥缘回落到 1
  return 1 + (WIND_FAST_SPEED_GAIN - 1) * (1 - smooth);
}

// --- D1 帕克螺旋（§4.7-D1）---------------------------------------------------

/**
 * 太阳自转角速度（弧度/模拟天，赤道值示意）：真实 25.4 天/周（赤道），
 * 帕克螺旋以赤道自转率示意流线弯曲（Parker 1958）。
 */
export const SUN_ROTATION_RAD_PER_DAY = (2 * Math.PI) / 25.4;

/**
 * 帕克螺旋方位偏转角（S4 D1，弧度）：太阳风以恒定径向速度外流，而源点
 * 随太阳自转，导致流线在惯性系中弯曲成阿基米德螺旋。粒子在半径 r 处相对
 * 出发方位的方位偏转 Δφ = −Ω·(r − r0)/v_r（负号：滞后于自转方向）。
 *
 * 以相位归一化表达（渲染端 phase01 ∈ [0,1] 对应 r0→rMax）：
 * Δφ = −windingTurns · phase01 · 2π，windingTurns 为外边界处累计圈数。
 *
 * @param phase01 外流相位 ∈ [0,1]（0 出发 / 1 到外边界）
 * @param windingTurns 到外边界的累计缠绕圈数（正值）
 * @returns 方位偏转角（弧度，随相位增大而负向增大）
 */
export function parkerSpiralOffsetRad(phase01: number, windingTurns: number): number {
  const p = Math.min(1, Math.max(0, phase01));
  return -windingTurns * p * Math.PI * 2;
}

/**
 * 帕克螺旋外边界缠绕圈数（S4 D1）：Ω·(rMax−r0)/v_r 换算为圈数。
 * 距离用场景单位，速度用 units/day（kmPerSecToUnitsPerDay 换算），
 * 自转率用 SUN_ROTATION_RAD_PER_DAY。真实 1 AU 处帕克螺旋约 45° 偏转
 * （不足 1 圈），场景压缩范围内圈数示意登记。
 *
 * @param r0Units 起始半径（场景单位）
 * @param rMaxUnits 外边界半径（场景单位）
 * @param speedUnitsPerDay 径向速度（units/day）
 * @returns 缠绕圈数（≥0）
 */
export function parkerWindingTurns(
  r0Units: number,
  rMaxUnits: number,
  speedUnitsPerDay: number,
): number {
  if (!(rMaxUnits > r0Units)) {
    throw new RangeError(`外边界必须大于起始半径，收到 ${r0Units} → ${rMaxUnits}`);
  }
  if (!(speedUnitsPerDay > 0)) {
    throw new RangeError(`速度必须为正数，收到 ${speedUnitsPerDay}`);
  }
  const travelDays = (rMaxUnits - r0Units) / speedUnitsPerDay;
  const totalRad = SUN_ROTATION_RAD_PER_DAY * travelDays;
  return totalRad / (Math.PI * 2);
}

// --- D2 快慢风交界 CIR（§4.7-D2）--------------------------------------------

/**
 * 共转相互作用区（CIR）密度/亮度调制（S4 D2）：快风追赶前方慢风，在快慢
 * 风交界处压缩形成高密度region（CIR）。以粒子方向与日冕洞（快风源）方向的
 * 夹角定"快慢风交界带"，交界带内亮度增强（压缩致密）。
 * 数据来源：Pizzo 1978 CIR 模型；示意性密度增强登记。
 *
 * @param cosAngle 粒子方向与日冕洞方向余弦
 * @returns 亮度增强倍数 ∈ [1, 1+CIR_BRIGHTNESS_GAIN]
 */
export const CIR_BRIGHTNESS_GAIN = 0.8;

export function cirBrightnessFactor(cosAngle: number): number {
  const c = Math.min(1, Math.max(-1, cosAngle));
  const ang = Math.acos(c);
  // 交界带中心：日冕洞锥缘（快慢风相遇处）
  const edge = WIND_FAST_CONE_RAD;
  const bandHalf = 0.22;
  const d = Math.abs(ang - edge);
  if (d >= bandHalf) return 1;
  const w = 1 - d / bandHalf;
  return 1 + CIR_BRIGHTNESS_GAIN * w * w;
}

/**
 * 太阳风粒子透明度（shader 镜像）：随外流相位衰减 × 近观强度微增
 *
 * @param phase01 外流相位（0 出发 → 1 回收）
 * @param nearStrength01 近观细节强度（L1 更明显，L2 微弱可感知）
 */
export function windParticleAlpha(phase01: number, nearStrength01: number): number {
  const p = Math.min(1, Math.max(0, phase01));
  const s = Math.min(1, Math.max(0, nearStrength01));
  return WIND_BASE_ALPHA * (1 - p) * (0.45 + 0.55 * s);
}

// ---------------------------------------------------------------------------
// 日珥 / 日冕环（prominence / coronal loop）
// ---------------------------------------------------------------------------

/** 常驻日珥数量（少量常驻 + 缓慢演化，需求 §4.3-6） */
export const PROMINENCE_COUNT = 3;

/** 日珥拱顶高度（× 太阳半径，放大登记见文件头） */
export const PROMINENCE_HEIGHT_FRAC = 0.22;

/** 日珥足点跨度（弧度，日面大圆角距） */
export const PROMINENCE_SPAN_RAD = 0.5;

/** 日珥形态缓慢演化周期（模拟天，数天至数月量级取下限便于观察） */
export const PROMINENCE_EVOLVE_DAYS = 9;

/**
 * 日冕环渲染上限（锚定活跃黑子群足点）：S4 E2 由"每组单环"扩为"复杂群
 * 多重同源环拱（arcade）"，故池上限扩容（5 群 × 最多 4 环 = 20，池化
 * TubeGeometry 复用，登记见 SunActivity 文件头）。
 */
export const CORONAL_LOOP_MAX = 20;

/** 单群最大日冕环数（S4 E2）：复杂群渲染多重同源环拱 */
export const CORONAL_LOOP_MAX_PER_GROUP = 4;

/** 日冕环拱顶高度（× 足点间距） */
export const CORONAL_LOOP_HEIGHT_RATIO = 0.6;

/**
 * 活动区磁环族环数（S4 E2，§4.7-E2）：按黑子群复杂度（群内黑子颗数）
 * 决定同源环拱的环数——单极群 1 环、双极群 2 环、复杂群按颗数最多
 * CORONAL_LOOP_MAX_PER_GROUP 环，构成多重环拱（真实活动区磁环族）。
 *
 * @param groupSpotCount 群内黑子颗数（sunspotGroupInto 的 count，≥1）
 * @returns 该群渲染的日冕环数 ∈ [1, CORONAL_LOOP_MAX_PER_GROUP]
 */
export function coronalLoopCountForGroup(groupSpotCount: number): number {
  if (!Number.isFinite(groupSpotCount) || groupSpotCount <= 1) return 1;
  return Math.min(CORONAL_LOOP_MAX_PER_GROUP, Math.round(groupSpotCount));
}

/**
 * 环拱内第 i 环的横向偏移分数（S4 E2）：多重同源环拱沿磁中性线法向
 * 均匀铺开（-1..1 归一化）。单环时居中（0）。
 *
 * @param loopIndex 环序号 [0, loopCount)
 * @param loopCount 该群环数（≥1）
 * @returns 横向偏移分数 ∈ [-1, 1]
 */
export function coronalLoopArcadeOffset(loopIndex: number, loopCount: number): number {
  if (loopCount <= 1) return 0;
  return (loopIndex / (loopCount - 1)) * 2 - 1;
}

/**
 * 环拱内第 i 环的拱顶高度缩放（S4 E2）：中间环最高、两侧环略矮
 * （真实磁环族中央环拱最高），构成拱形包络。
 *
 * @param loopIndex 环序号 [0, loopCount)
 * @param loopCount 该群环数（≥1）
 * @returns 高度缩放 ∈ (0, 1]
 */
export function coronalLoopArcadeHeightScale(loopIndex: number, loopCount: number): number {
  if (loopCount <= 1) return 1;
  const offset = coronalLoopArcadeOffset(loopIndex, loopCount);
  // 拱形包络：中央（offset=0）为 1，两端回落到 0.6
  return 1 - 0.4 * offset * offset;
}

/** 爆发日珥前导时长（模拟天，S3 §4.3-6）：日珥拉升脱离领先 CME 的窗口 */
export const PROMINENCE_ERUPTION_DAYS = 0.5;

/** 爆发日珥峰值抬升倍数（相对常态高度，示意拉升脱离） */
export const PROMINENCE_ERUPTION_LIFT = 3.5;

/**
 * 爆发日珥抬升因子（S3 §4.3-6）：CME 触发时对应方位日珥先行拉升脱离
 * （eruptive prominence 作为 CME 前导）。0 起始 → 快速拉升 → 脱离后回落至 0
 * （日珥物质随 CME 抛出，日面重建）。
 *
 * @param elapsedDays 自爆发起经过的模拟天
 * @returns 额外抬升高度倍数（≥0，叠加在常态高度之上）
 */
export function prominenceEruptionLift(elapsedDays: number): number {
  if (elapsedDays <= 0 || elapsedDays >= PROMINENCE_ERUPTION_DAYS) return 0;
  const t = elapsedDays / PROMINENCE_ERUPTION_DAYS;
  // 前 60% 快速拉升（easeOut），后 40% 脱离回落
  if (t < 0.6) {
    const x = t / 0.6;
    return PROMINENCE_ERUPTION_LIFT * (1 - Math.pow(1 - x, 2));
  }
  const x = (t - 0.6) / 0.4;
  return PROMINENCE_ERUPTION_LIFT * (1 - x);
}

// --- E1 日珥纤维结构（§4.7-E1）----------------------------------------------

/** 日珥纤维细丝频率（沿弧面的细丝纹理条纹密度） */
export const PROMINENCE_FIBRIL_FREQ = 14.0;
/** 宁静日珥纤维幅度（细密柔和） */
export const PROMINENCE_QUIET_FIBRIL_AMP = 0.25;
/** 活动日珥纤维幅度（更粗更动荡） */
export const PROMINENCE_ACTIVE_FIBRIL_AMP = 0.5;

/**
 * 日珥纤维透明度调制（S4 E1）：日珥并非均匀弧面，而是由沿磁力线排列的
 * 细丝（fibrils）构成。以沿弧参数 t01 的条纹 × 噪声调制不透明度，区分
 * 宁静日珥（quiescent，细密柔和）与活动日珥（active，粗动荡）形态。
 * 数据来源：Mackay et al. 2010 日珥纤维结构综述。
 *
 * @param t01 沿日珥弧线参数 ∈ [0,1]
 * @param noise01 附加噪声 ∈ [0,1]
 * @param isActive 是否活动日珥（true 幅度更大）
 * @returns 不透明度调制因子 ∈ [1-amp, 1+amp] 钳制到 ≥0
 */
export function prominenceFibrilFactor(
  t01: number,
  noise01: number,
  isActive: boolean,
): number {
  const t = Math.min(1, Math.max(0, t01));
  const n = Math.min(1, Math.max(0, noise01));
  const amp = isActive ? PROMINENCE_ACTIVE_FIBRIL_AMP : PROMINENCE_QUIET_FIBRIL_AMP;
  const stripes = Math.sin(t * PROMINENCE_FIBRIL_FREQ * Math.PI + (n - 0.5) * 4);
  return Math.max(0, 1 + amp * stripes * (0.6 + 0.4 * n));
}

/**
 * 日珥类型判定（S4 E1）：按锚点种子确定性区分宁静/活动日珥
 * （活动日珥靠近活动区、形变快；宁静日珥远离活动区、稳定）。
 *
 * @param seed01 日珥锚点种子 ∈ [0,1)
 * @returns true 为活动日珥
 */
export function prominenceIsActive(seed01: number): boolean {
  return seed01 >= 0.5;
}

/**
 * 日珥缓慢演化因子（0.75–1.25 高度脉动，模拟时间驱动、暂停冻结）
 */
export function prominenceEvolveFactor(simDays: number, seed01: number): number {
  if (!Number.isFinite(simDays)) {
    throw new RangeError(`模拟时间必须为有限数，收到 ${simDays}`);
  }
  const phase = (simDays / PROMINENCE_EVOLVE_DAYS + seed01 * 7.31) * Math.PI * 2;
  return 1 + 0.25 * Math.sin(phase);
}

/**
 * 日珥/日冕环单位弧线采样点（局部坐标：足点 (±0.5, 0, 0)，拱顶 (0, h, 0)）：
 * 半椭圆参数化，渲染端按足点间距缩放并贴附到日面。
 *
 * @param t01 弧线参数 0-1
 * @param heightRatio 拱顶高度与足点间距之比
 */
export function loopArcPoint(t01: number, heightRatio: number): { x: number; y: number; z: number } {
  const t = Math.min(1, Math.max(0, t01));
  const angle = Math.PI * (1 - t);
  return {
    x: 0.5 * Math.cos(angle),
    y: heightRatio * Math.sin(angle),
    z: 0,
  };
}

// ---------------------------------------------------------------------------
// 信息面板扩展（§4.5：当前活动事件行，供 HudInfo 渲染、可单测）
// ---------------------------------------------------------------------------

/** 与 data/catalog.BodyInfoLine 同构（避免 utils → data 反向依赖） */
export interface ActivityInfoLine {
  label: string;
  value: string;
}

/**
 * 太阳信息面板"当前活动事件"行（§4.5）
 *
 * i18n：label 保持中文键（UI 层经 catalogText 直映射），value 按
 * locale 生成（默认 zh——既有测试断言零改动）。
 */
export function sunActivityStatusLines(
  flare: { class: SolarFlareClass; magnitude: number } | null,
  cme: { speedKmS: number; earthDirected: boolean } | null,
  locale: 'zh' | 'en' = 'zh',
): ActivityInfoLine[] {
  const en = locale === 'en';
  const lines: ActivityInfoLine[] = [];
  if (flare) {
    lines.push({
      label: '当前耀斑',
      value: en
        ? `${flare.class}${flare.magnitude.toFixed(1)} (magnetic reconnection in progress)`
        : `${flare.class}${flare.magnitude.toFixed(1)} 级（磁重联爆发进行中）`,
    });
  }
  if (cme) {
    lines.push({
      label: '当前 CME',
      value: en
        ? `${Math.round(cme.speedKmS)} km/s${cme.earthDirected ? ', Earth-directed (may trigger a geomagnetic storm)' : ''}`
        : `${Math.round(cme.speedKmS)} km/s${cme.earthDirected ? '，朝向地球（可能引发地磁暴）' : ''}`,
    });
  }
  if (lines.length === 0) {
    lines.push({
      label: '当前活动',
      value: en
        ? 'Quiet (demos can be triggered from the control panel)'
        : '平静（可在控制面板手动触发演示）',
    });
  }
  return lines;
}
