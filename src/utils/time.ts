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
 * 模拟时间（J2000 起天数）→ 日期对象
 */
export function simDaysToDate(simDays: number): Date {
  return new Date(J2000_EPOCH_MS + simDays * MS_PER_DAY);
}

/**
 * 模拟时间格式化为 UI 显示文案
 *
 * 超出 Date 安全范围（约 ±27万年）时退化为"J2000 + N 年"。
 */
export function formatSimDate(simDays: number): string {
  const years = simDays / 365.25;
  if (Math.abs(years) > 250000) {
    const millionYears = years / 1e6;
    return `J2000 ${millionYears >= 0 ? '+' : '−'} ${Math.abs(millionYears).toFixed(2)} 百万年`;
  }
  const date = simDaysToDate(simDays);
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const mm = String(date.getUTCMinutes()).padStart(2, '0');
  return `${y}-${m}-${d} ${hh}:${mm} UTC`;
}
