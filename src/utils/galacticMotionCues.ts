/**
 * 太阳系银心轨道运动线索强化（P6，需求 3.1.2）
 *
 * 背景：跟随模式（太阳系居原点）下，即便运动逻辑正确，用户仍"看不到太阳系
 * 在轨道内运行"。本模块提供三类运动线索的纯几何/相位计算，供 Galaxy.tsx
 * 渲染消费、供单测校验：
 *
 * 1. 预测轨迹改为**非闭合弧段**（前方约 1/4 银河年），随时间滚动刷新，
 *    与历史尾迹首尾衔接不重叠——避免"一整个银河年闭合圆绕圆心转看不出动"。
 * 2. 轨道**流动刻度**：沿轨道以实际角速度流动的光点相位，使"银河系相对滑动"
 *    可感知（相位推进速率 = 2π/银河年，与太阳公转严格一致）。
 * 3. 垂直振荡**视觉放大**：默认模式下将 y 分量放大固定倍数使波浪起伏在 L3
 *    默认相机距离下可辨；真实比例模式不放大（科学事实）。
 *
 * ── 艺术化/视觉夸大登记（需求 §4 / §5）─────────────────────────────────
 * - VERTICAL_VISUAL_GAIN = 6：太阳垂直振荡真实振幅仅 ±300 ly（≈15 场景单位、
 *   轨道半径的 1.2%），在 L3 默认相机距离（约 2900 单位）下不可辨。默认（非真实
 *   比例）模式下对**尾迹/预测线/标记高度指示**的 y 分量放大 6 倍（±90 单位，
 *   约轨道半径 7%）使波浪起伏可辨识；此为纯视觉夸大，轨道半径/角速度/周期
 *   均不改变。真实比例模式下增益为 1（不放大，垂直振荡过小不可辨属科学事实）。
 * - 预测弧段取 1/4 银河年（PREDICTION_ARC_FRACTION）为可视化选择，非物理常数。
 */

import type { Vec3 } from '@/types';
import { GALACTIC_YEAR_MYR, sunGalacticPositionLy, simDaysToMyr } from '@/utils/galaxy';

/** 预测弧段占银河年比例：前方 1/4 银河年（非闭合，滚动刷新） */
export const PREDICTION_ARC_FRACTION = 0.25;

/** 垂直振荡视觉放大倍数（默认模式，见文件头登记；真实比例模式为 1） */
export const VERTICAL_VISUAL_GAIN = 6;

/**
 * 当前生效的垂直放大增益：真实比例模式返回 1（不放大），否则返回 VERTICAL_VISUAL_GAIN
 */
export function verticalVisualGain(realScaleMode: boolean): number {
  return realScaleMode ? 1 : VERTICAL_VISUAL_GAIN;
}

/**
 * 预测弧段采样点（银心系本地坐标，光年）
 *
 * 从当前时间 tMyr 起，向前采样 PREDICTION_ARC_FRACTION 个银河年，
 * 共 segments+1 个点。返回的是**非闭合弧段**（终点 ≠ 起点，除非 fraction≥1）。
 * y 分量按 gain 放大（供可视化；单测可传 gain=1 校验原始几何）。
 *
 * @param tMyr 当前时间（百万年）
 * @param segments 采样段数（≥1）
 * @param gain 垂直放大增益（默认 1）
 * @param arcFraction 弧段占银河年比例（默认 PREDICTION_ARC_FRACTION）
 */
export function samplePredictionArc(
  tMyr: number,
  segments: number,
  gain = 1,
  arcFraction = PREDICTION_ARC_FRACTION,
): Vec3[] {
  if (!Number.isInteger(segments) || segments < 1) {
    throw new RangeError(`采样段数必须为 ≥1 的整数，收到 ${segments}`);
  }
  if (arcFraction <= 0) {
    throw new RangeError(`弧段比例必须为正数，收到 ${arcFraction}`);
  }
  const span = GALACTIC_YEAR_MYR * arcFraction;
  const out: Vec3[] = [];
  for (let s = 0; s <= segments; s += 1) {
    const t = tMyr + (s / segments) * span;
    const p = sunGalacticPositionLy(t * 365.25e6);
    out.push({ x: p.x, y: p.y * gain, z: p.z });
  }
  return out;
}

/**
 * 判定预测弧段是否为非闭合（首尾点距离显著 > 0）
 * 供单测断言"不再是近闭合圆"。
 */
export function isPredictionArcOpen(samples: Vec3[]): boolean {
  if (samples.length < 2) return false;
  const a = samples[0];
  const b = samples[samples.length - 1];
  const d = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  // 弧段跨度（1/4 银河年 ≈ 半径量级）远大于任何数值噪声
  return d > 1;
}

/**
 * 轨道流动刻度相位（0..1，随时间循环）
 *
 * 流动光点沿轨道以太阳实际公转角速度前移。相位 = frac(tMyr / 银河年 · tickCount)，
 * 使 tickCount 个等距光点整体以角速度 2π/银河年 沿轨道流动（与"银河系相对滑动"
 * 速率一致）。返回 [0,1) 的整体相位偏移。
 *
 * @param simDays 模拟时间（天）
 * @param tickCount 流动光点数（≥1，决定相邻光点间距 = 银河年/tickCount）
 */
export function orbitFlowPhase01(simDays: number, tickCount: number): number {
  if (!Number.isInteger(tickCount) || tickCount < 1) {
    throw new RangeError(`流动刻度数必须为 ≥1 的整数，收到 ${tickCount}`);
  }
  const tMyr = simDaysToMyr(simDays);
  const raw = (tMyr / GALACTIC_YEAR_MYR) * tickCount;
  const frac = raw - Math.floor(raw);
  return frac;
}

/**
 * 第 i 个流动光点当前所在的银河年角度（弧度，[0,2π)）
 *
 * 光点均匀分布并整体随时间流动：angle_i = 2π·((i + phase)/tickCount 的循环) ，
 * 但为体现真实角速度，直接取 baseAngle_i + 2π·(tMyr/银河年)。
 */
export function orbitFlowTickAngle(
  simDays: number,
  index: number,
  tickCount: number,
): number {
  if (!Number.isInteger(tickCount) || tickCount < 1) {
    throw new RangeError(`流动刻度数必须为 ≥1 的整数，收到 ${tickCount}`);
  }
  if (!Number.isInteger(index) || index < 0 || index >= tickCount) {
    throw new RangeError(`光点索引必须在 [0, ${tickCount}) 内，收到 ${index}`);
  }
  const tMyr = simDaysToMyr(simDays);
  const base = (index / tickCount) * Math.PI * 2;
  const advance = (tMyr / GALACTIC_YEAR_MYR) * Math.PI * 2;
  const a = (base + advance) % (Math.PI * 2);
  return a < 0 ? a + Math.PI * 2 : a;
}

/**
 * 已走过弧段角度（用于 HUD/轨道高亮：银河年进度对应的绕行角度，弧度）
 * = 当前圈内进度角（[0,2π)），与 galacticYearProgress().angleRad 一致但独立可测。
 */
export function traveledArcAngleRad(simDays: number): number {
  const tMyr = simDaysToMyr(simDays);
  const raw = (tMyr / GALACTIC_YEAR_MYR) * Math.PI * 2;
  const a = raw % (Math.PI * 2);
  return a < 0 ? a + Math.PI * 2 : a;
}
