/**
 * 银河系视角天体垂直展开纯逻辑（R3-6，IMPROVEMENT_REQUIREMENTS_3 §6.1）
 *
 * 背景：L3 特殊天体的 offsetLy.y 原为示意值（垂直/水平比中位数 ≈0.12），
 * 天体折算后淹没在银盘粒子云厚度内，观感"挤在一个平面上"（用户反馈）。
 * 两层方案：
 * 1. 数据修正（默认生效）：sun-relative 天体 offsetLy.y 按真实银纬 b 重定
 *    y = round(√(x²+z²) × tan(b))——"从太阳看的方向按真实银纬、水平距离示意"
 *    口径（b 值来源 SIMBAD，逐天体登记于 data/specialBodies.ts）。
 * 2. 展开开关（观察辅助）：开启后 offset.y 乘展开增益（滑块 [1,6]、默认 ×3、
 *    步进 0.5），约 1 秒平滑过渡，并显示每天体高度指示线。
 *
 * 视觉夸大登记（AGENTS.md 数据准确性要求）：
 * - 展开增益为**观察辅助的视觉夸大**，非科学事实；高度指示线标注展示的是
 *   未乘增益的银纬推算真实高度（示意水平距离 × tan(b)）；
 * - 展开范围仅 13 个 L3 特殊天体（sgr-a-star 为银心原点无 offset 不参与）；
 *   银盘粒子/旋臂/超新星事件与遗迹/太阳系标记不展开（盘语境内容，展开会与
 *   旋臂视觉脱节）；太阳垂直振荡 ×10 增益（galacticMotionCues.ts）机制不变，
 *   与展开增益互不相乘。
 */

import { easeInOutCubic } from '@/utils/animation';

/** 展开增益滑块最小值（×1 = 不展开） */
export const GALAXY_EXPAND_GAIN_MIN = 1;

/** 展开增益滑块最大值 */
export const GALAXY_EXPAND_GAIN_MAX = 6;

/** 展开增益默认值（用户确认项 2：滑块可调，默认 ×3） */
export const GALAXY_EXPAND_GAIN_DEFAULT = 3;

/** 展开增益滑块步进 */
export const GALAXY_EXPAND_GAIN_STEP = 0.5;

/** 展开开关过渡时长（秒）：生效增益 1 ↔ 滑块值 的平滑过渡 */
export const GALAXY_EXPAND_TRANSITION_SECONDS = 1;

/**
 * 滑块值平滑跟随速率（增益单位/秒）：滑块拖动期间生效增益以该速率
 * 追踪新值（全量程 [1,6] 约 1 秒走完），避免 0.5 步进的位置跳变。
 */
export const GALAXY_EXPAND_GAIN_RATE_PER_SECOND =
  (GALAXY_EXPAND_GAIN_MAX - GALAXY_EXPAND_GAIN_MIN) / GALAXY_EXPAND_TRANSITION_SECONDS;

/**
 * 按真实银纬推算垂直偏移：y = horizontalLy × tan(latitudeDeg)
 *
 * 口径："从太阳看的方向按真实银纬、水平距离示意"——x/z 为既有视觉示意值，
 * y 由示意水平距离与真实银纬联立推出（四舍五入到整数光年）。
 *
 * @param horizontalLy 水平距离 √(x²+z²)（光年，≥0）
 * @param latitudeDeg 银纬 b（度，|b| < 90）
 * @throws RangeError 非有限输入 / horizontalLy < 0 / |b| ≥ 90
 */
export function offsetYFromLatitude(horizontalLy: number, latitudeDeg: number): number {
  if (!Number.isFinite(horizontalLy) || horizontalLy < 0) {
    throw new RangeError(`水平距离必须为非负有限数，收到 ${horizontalLy}`);
  }
  if (!Number.isFinite(latitudeDeg) || Math.abs(latitudeDeg) >= 90) {
    throw new RangeError(`银纬必须为 (−90°, 90°) 内的有限数，收到 ${latitudeDeg}`);
  }
  return Math.round(horizontalLy * Math.tan((latitudeDeg * Math.PI) / 180));
}

/**
 * 展开增益滑块值钳制到 [GALAXY_EXPAND_GAIN_MIN, GALAXY_EXPAND_GAIN_MAX]
 *
 * @throws RangeError 非有限输入
 */
export function clampExpandGain(value: number): number {
  if (!Number.isFinite(value)) {
    throw new RangeError(`展开增益必须为有限数，收到 ${value}`);
  }
  return Math.min(GALAXY_EXPAND_GAIN_MAX, Math.max(GALAXY_EXPAND_GAIN_MIN, value));
}

/**
 * 滑块值平滑跟随（帧推进）：当前值以恒定速率向目标滑块值靠拢
 *
 * @param current 当前平滑值
 * @param target 目标滑块值（内部钳制到合法范围）
 * @param deltaSeconds 帧时长（秒，负值按 0 处理）
 * @param ratePerSecond 跟随速率（默认全量程约 1 秒）
 */
export function advanceExpandGainValue(
  current: number,
  target: number,
  deltaSeconds: number,
  ratePerSecond = GALAXY_EXPAND_GAIN_RATE_PER_SECOND,
): number {
  if (!(ratePerSecond > 0)) {
    throw new RangeError(`跟随速率必须为正数，收到 ${ratePerSecond}`);
  }
  const clampedTarget = clampExpandGain(target);
  const from = clampExpandGain(current);
  const step = Math.max(0, deltaSeconds) * ratePerSecond;
  if (clampedTarget > from) return Math.min(clampedTarget, from + step);
  return Math.max(clampedTarget, from - step);
}

/**
 * 当前帧生效展开增益：开关线性进度经 easeInOutCubic 缓动后在
 * 1（关）与滑块平滑值（开）之间插值——开/关切换约 1 秒完成，
 * 与滑块值大小无关；进度 0 时恒为 1（默认零视觉影响）。
 *
 * @param sliderGain 滑块平滑值（内部钳制）
 * @param progress01 开关线性过渡进度 ∈ [0,1]（advanceFrameTransition 推进）
 */
export function effectiveExpandGain(sliderGain: number, progress01: number): number {
  const gain = clampExpandGain(sliderGain);
  return 1 + (gain - 1) * easeInOutCubic(progress01);
}

/**
 * 高度指示线在天体本地坐标下的下落长度（场景单位）：
 * 天体（本地原点）→ 银盘面（组内 y=0）投影点的 y 向位移，
 * 与 SpecialBodies.useGalacticPlacement 的 y 通道公式镜像同源。
 *
 * @returns 负值 = 天体在盘面上方（指示线向下）；正值 = 盘面下方（向上）
 */
export function heightLineDropUnits(
  sunYLy: number,
  sunVerticalGain: number,
  offsetYLy: number,
  expandGain: number,
  unitsPerLy: number,
): number {
  if (!(unitsPerLy > 0)) {
    throw new RangeError(`unitsPerLy 必须为正数，收到 ${unitsPerLy}`);
  }
  return -(sunYLy * sunVerticalGain + offsetYLy * expandGain) * unitsPerLy;
}

/**
 * 高度标注文案：银纬推算的真实高度（未乘展开增益，登记），
 * 正负区分盘上/盘下，千分位分隔（如 "+4,858 ly" / "−1,616 ly"）。
 */
export function heightLabelText(offsetYLy: number): string {
  if (!Number.isFinite(offsetYLy)) {
    throw new RangeError(`高度必须为有限数，收到 ${offsetYLy}`);
  }
  const sign = offsetYLy < 0 ? '−' : '+';
  return `${sign}${Math.abs(Math.round(offsetYLy)).toLocaleString('en-US')} ly`;
}
