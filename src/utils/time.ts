/**
 * 时间系统（需求 3.3）
 *
 * - 全局共享一条模拟时间轴（自 J2000 历元起的天数）
 * - 各层级默认时间压缩比不同（需求第 2 节表格）
 * - 跨层级切换时压缩比在对数空间平滑插值，避免速度突变
 */

import type { ViewLevel } from '@/types';
import { J2000_EPOCH_MS, MS_PER_DAY } from '@/utils/physics';

/** 各层级默认时间压缩比：1 真实秒 ≈ N 模拟秒（需求第 2 节） */
export const TIME_COMPRESSION: Record<ViewLevel, number> = {
  /** L1：1秒 ≈ 4小时（可观察自转） */
  L1: 4 * 3600,
  /** L2：1秒 ≈ 4天（可观察公转） */
  L2: 4 * 86400,
  /** L3：1秒 ≈ 200万年 */
  L3: 2e6 * 365.25 * 86400,
  /** L4：1秒 ≈ 2000万年 */
  L4: 2e7 * 365.25 * 86400,
};

/** 全局速度倍率允许范围 */
export const MIN_SPEED_MULTIPLIER = 0;
export const MAX_SPEED_MULTIPLIER = 100;

/**
 * 推进模拟时间（纯函数，便于测试）
 *
 * @param simDays 当前模拟时间（J2000 起天数）
 * @param realDeltaSeconds 真实经过秒数
 * @param level 当前视角层级（决定默认压缩比）
 * @param speedMultiplier 用户全局速度倍率（0 = 暂停效果）
 * @param paused 是否暂停
 * @returns 新的模拟时间（天数）
 */
export function advanceSimTime(
  simDays: number,
  realDeltaSeconds: number,
  level: ViewLevel,
  speedMultiplier: number,
  paused: boolean,
): number {
  if (realDeltaSeconds < 0) {
    throw new RangeError(`时间增量不能为负，收到 ${realDeltaSeconds}`);
  }
  if (paused) return simDays;
  const multiplier = clampSpeedMultiplier(speedMultiplier);
  const simSeconds = realDeltaSeconds * TIME_COMPRESSION[level] * multiplier;
  return simDays + simSeconds / 86400;
}

/**
 * 速度倍率钳制
 */
export function clampSpeedMultiplier(multiplier: number): number {
  if (Number.isNaN(multiplier)) return 1;
  return Math.min(MAX_SPEED_MULTIPLIER, Math.max(MIN_SPEED_MULTIPLIER, multiplier));
}

/**
 * 跨层级时间压缩比平滑插值（对数空间，避免数量级跳变）
 *
 * @param t 过渡进度 [0, 1]
 */
export function interpolateTimeCompression(from: ViewLevel, to: ViewLevel, t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  const logFrom = Math.log10(TIME_COMPRESSION[from]);
  const logTo = Math.log10(TIME_COMPRESSION[to]);
  return Math.pow(10, logFrom + (logTo - logFrom) * clamped);
}

/**
 * 连续层级（1.0–4.0）→ 时间压缩比（对数空间插值，需求 3.3）
 *
 * 跨层级连续缩放时压缩比平滑过渡，避免速度数量级跳变。
 */
export function timeCompressionForContinuousLevel(continuousLevel: number): number {
  const f = Math.min(4, Math.max(1, continuousLevel));
  const levels: ViewLevel[] = ['L1', 'L2', 'L3', 'L4'];
  const lower = Math.min(2, Math.floor(f - 1));
  const t = f - 1 - lower;
  // 整数层级直接返回精确值（避免 pow/log 往返的浮点误差）
  if (t === 0) return TIME_COMPRESSION[levels[lower]];
  if (t === 1) return TIME_COMPRESSION[levels[lower + 1]];
  return interpolateTimeCompression(levels[lower], levels[lower + 1], t);
}

/**
 * 按连续层级推进模拟时间（连续维度缩放模式下使用，需求 3.2.2 / 3.3）
 */
export function advanceSimTimeContinuous(
  simDays: number,
  realDeltaSeconds: number,
  continuousLevel: number,
  speedMultiplier: number,
  paused: boolean,
): number {
  if (realDeltaSeconds < 0) {
    throw new RangeError(`时间增量不能为负，收到 ${realDeltaSeconds}`);
  }
  if (paused) return simDays;
  const multiplier = clampSpeedMultiplier(speedMultiplier);
  const compression = timeCompressionForContinuousLevel(continuousLevel);
  return simDays + (realDeltaSeconds * compression * multiplier) / 86400;
}

// ---------------------------------------------------------------------------
// 快周期天体速率钳制（需求 3.3）
// ---------------------------------------------------------------------------

/** 视觉角速度阈值：超过 0.5 圈/秒的天体做速率钳制，避免闪烁 */
export const MAX_VISUAL_REVS_PER_SECOND = 0.5;

/**
 * 天体在当前时间压缩比下的视觉转速（圈/真实秒）
 *
 * @param periodDays 公转周期（天，取绝对值）
 * @param compressionSimSecondsPerRealSecond 当前压缩比（模拟秒/真实秒）
 * @param speedMultiplier 全局速度倍率
 */
export function visualRevsPerRealSecond(
  periodDays: number,
  compressionSimSecondsPerRealSecond: number,
  speedMultiplier: number,
): number {
  if (periodDays === 0) {
    throw new RangeError('周期不能为 0');
  }
  const simDaysPerRealSecond =
    (compressionSimSecondsPerRealSecond * clampSpeedMultiplier(speedMultiplier)) / 86400;
  return Math.abs(simDaysPerRealSecond / periodDays);
}

/**
 * 速率钳制因子（≤1）：乘在天体平均运动上使视觉转速不超过阈值
 *
 * 返回 1 表示无需钳制；<1 表示"运动已减速显示"（UI 需提示，需求 3.3）。
 */
export function rateClampFactor(
  periodDays: number,
  compressionSimSecondsPerRealSecond: number,
  speedMultiplier: number,
  maxRevsPerSecond = MAX_VISUAL_REVS_PER_SECOND,
): number {
  const revs = visualRevsPerRealSecond(
    periodDays,
    compressionSimSecondsPerRealSecond,
    speedMultiplier,
  );
  if (revs <= maxRevsPerSecond || revs === 0) return 1;
  return maxRevsPerSecond / revs;
}

/**
 * 模拟时间（J2000 起天数）→ 日期对象
 */
export function simDaysToDate(simDays: number): Date {
  return new Date(J2000_EPOCH_MS + simDays * MS_PER_DAY);
}

/** 超出该年数（|年|）后日期表示退化为"距今约 N"通俗表示（Date 安全范围约 ±27万年） */
export const SIM_DATE_CALENDAR_LIMIT_YEARS = 250000;

/**
 * 模拟时间显示的两段式结果：
 * - primary：主行（正常范围为 UTC 日期；大时间尺度为"距今约 4,273 万年后"
 *   通俗表示，中文按 万年/亿年、英文按 years/million/billion 自适应单位）
 * - epoch：副行专业历元表示（"J2000 + 42.73 Myr"，仅大时间尺度非 null）
 */
export interface SimDateParts {
  primary: string;
  epoch: string | null;
}

/** 大时间尺度通俗量值文案（中文 万年/亿年、英文 years/million/billion 自适应） */
function humanYearsText(absYears: number, locale: 'zh' | 'en'): string {
  if (locale === 'zh') {
    if (absYears < 1e8) {
      // 万年档（阈值起点 25 万年，量值恒 ≥25，取整 + 千分组）
      return `${Math.round(absYears / 1e4).toLocaleString('en-US')} 万年`;
    }
    // 亿年档：<100 亿年保留 1 位小数，更大取整
    const yi = absYears / 1e8;
    return `${yi < 100 ? yi.toFixed(1) : Math.round(yi).toLocaleString('en-US')} 亿年`;
  }
  if (absYears < 1e6) {
    return `${Math.round(absYears).toLocaleString('en-US')} years`;
  }
  if (absYears < 1e9) {
    const m = absYears / 1e6;
    return `${m < 100 ? m.toFixed(1) : Math.round(m).toLocaleString('en-US')} million years`;
  }
  const b = absYears / 1e9;
  return `${b < 100 ? b.toFixed(2) : Math.round(b).toLocaleString('en-US')} billion years`;
}

/**
 * 模拟时间格式化（两段式，UI 布局优化：通俗主行 + 专业历元副行）
 *
 * 正常范围（|年| ≤ 25 万）：primary 为 `YYYY-MM-DD HH:mm UTC`（语言无关），
 * epoch 为 null。大时间尺度：primary 为"距今约 … 后/前"（en:
 * "~… from now/ago"），epoch 为 "J2000 ± N.NN Myr"（保持原专业口径）。
 *
 * i18n：通俗文案单位词按 locale 输出（沿用本文件既有 locale 三元判断
 * 豁免口径——纯函数不触达字典）；数字千分组统一 en-US 分组符。
 */
export function formatSimDateParts(simDays: number, locale: 'zh' | 'en' = 'zh'): SimDateParts {
  const years = simDays / 365.25;
  if (Math.abs(years) > SIM_DATE_CALENDAR_LIMIT_YEARS) {
    const millionYears = years / 1e6;
    const epoch = `J2000 ${millionYears >= 0 ? '+' : '−'} ${Math.abs(millionYears).toFixed(2)} Myr`;
    const amount = humanYearsText(Math.abs(years), locale);
    const primary =
      locale === 'en'
        ? `~${amount} ${years >= 0 ? 'from now' : 'ago'}`
        : `距今约 ${amount}${years >= 0 ? '后' : '前'}`;
    return { primary, epoch };
  }
  const date = simDaysToDate(simDays);
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const mm = String(date.getUTCMinutes()).padStart(2, '0');
  return { primary: `${y}-${m}-${d} ${hh}:${mm} UTC`, epoch: null };
}

/**
 * 模拟时间格式化为单行 UI 文案（兼容入口：取两段式的主行）
 */
export function formatSimDate(simDays: number, locale: 'zh' | 'en' = 'zh'): string {
  return formatSimDateParts(simDays, locale).primary;
}
