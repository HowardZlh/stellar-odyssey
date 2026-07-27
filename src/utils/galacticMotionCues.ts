/**
 * 太阳系银心轨道运动线索强化（P6，需求 3.1.2；R2-6 可感知性增强）
 *
 * 背景：跟随模式（太阳系居原点）下，即便运动逻辑正确，用户仍"看不到太阳系
 * 在轨道内运行"。本模块提供各类运动线索的纯几何/相位计算，供 Galaxy.tsx
 * 渲染消费、供单测校验：
 *
 * 1. 预测轨迹改为**非闭合弧段**（前方约 1/4 银河年），随时间滚动刷新，
 *    与历史尾迹首尾衔接不重叠——避免"一整个银河年闭合圆绕圆心转看不出动"。
 * 2. 轨道**银河年刻度**（R2-6 §6.1，替换 P6 流动光点，差异登记见下）：
 *    沿轨道均匀分布、**在银心系内静止**的进度刻度（含 0%/25%/50%/75% 主刻度），
 *    如同公路里程碑——跟随模式下刻度以太阳真实公转速度整体滑过场景原点，
 *    "银河系相对滑动"直接可辨；银心固定模式下标记依次掠过静止刻度。
 *    刻度角与 HUD"银河年进度（绕行 N°）"严格同源（同一 θ=2π·t/T 公式）。
 * 3. 垂直振荡**视觉放大**：默认模式下将 y 分量放大固定倍数使波浪起伏在 L3
 *    默认相机距离下可辨；真实比例模式不放大（科学事实）。
 * 4. 当前位置**脉动高亮**（R2-6 §6.1）：You are here 标记的雷达波纹扩散环与
 *    呼吸脉动相位（真实秒驱动，与模拟时间无关——属 UI 高亮而非物理演算）。
 *
 * ── 艺术化/视觉夸大登记（需求 §4 / §5 / R2-6 §6.1）───────────────────────
 * - VERTICAL_VISUAL_GAIN = 10（R2-6 由 6 提升，上限依需求建议 ≤×10）：
 *   太阳垂直振荡真实振幅仅 ±300 ly（≈15 场景单位、轨道半径的 1.2%），在 L3
 *   默认相机距离（约 2900 单位）下不可辨。默认（非真实比例）模式下对
 *   **尾迹/预测线/标记高度指示**的 y 分量放大 10 倍（±150 单位，约轨道半径
 *   11%）使波浪起伏可辨识且不破坏"准圆轨道"认知；此为纯视觉夸大，轨道半径/
 *   角速度/周期均不改变。真实比例模式下增益为 1（不放大，垂直振荡过小
 *   不可辨属科学事实）。
 * - 预测弧段取 1/4 银河年（PREDICTION_ARC_FRACTION）为可视化选择，非物理常数。
 * - P6→R2-6 差异登记：P6 的"流动刻度光点"随太阳以同一角速度共转，跟随模式下
 *   与太阳的相对方位恒定（整环绕原点刚性旋转），运动线索弱——用户实测反馈
 *   "看不出在轨道上动"。R2-6 改为银心系静止的进度刻度（orbitGradationAngle），
 *   orbitFlowPhase01/orbitFlowTickAngle 已移除。
 * - 标记脉动（周期 2.4 s、波纹扩散 3 倍）为 UI 高亮节奏，非任何物理量。
 */

import type { Vec3 } from '@/types';
import { GALACTIC_YEAR_MYR, sunGalacticPositionLy, simDaysToMyr } from '@/utils/galaxy';

/** 预测弧段占银河年比例：前方 1/4 银河年（非闭合，滚动刷新） */
export const PREDICTION_ARC_FRACTION = 0.25;

/** 垂直振荡视觉放大倍数（默认模式，见文件头登记；真实比例模式为 1） */
export const VERTICAL_VISUAL_GAIN = 10;

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

// ---------------------------------------------------------------------------
// 轨道银河年刻度（R2-6 §6.1：银心系静止的进度"里程碑"，替换 P6 流动光点）
// ---------------------------------------------------------------------------

/** 轨道刻度总数（每 15° 一格 = 银河年的 1/24 ≈ 9.6 Myr） */
export const ORBIT_GRADATION_COUNT = 24;

/** 主刻度间隔（每 6 格一个主刻度 → 0%/25%/50%/75% 银河年进度） */
export const ORBIT_MAJOR_GRADATION_EVERY = 6;

/**
 * 第 index 个轨道刻度的银心系固定角度（弧度，[0,2π)）
 *
 * 刻度在银心系内**静止**（与 P6 流动光点的差异登记见文件头）：
 * angle_k = 2π·k/count。与 sunGalacticPositionLy 的 θ=2π·t/T 同一角度约定
 * （x=R·cosθ，z=−R·sinθ），因此第 k 格刻度恰对应 HUD 银河年进度 k/count
 * （如 count=24 时第 6 格 = 进度 25%）——进度与轨道标记位置严格一致。
 */
export function orbitGradationAngle(index: number, count = ORBIT_GRADATION_COUNT): number {
  if (!Number.isInteger(count) || count < 1) {
    throw new RangeError(`刻度数必须为 ≥1 的整数，收到 ${count}`);
  }
  if (!Number.isInteger(index) || index < 0 || index >= count) {
    throw new RangeError(`刻度索引必须在 [0, ${count}) 内，收到 ${index}`);
  }
  return (index / count) * Math.PI * 2;
}

/** 判定第 index 格是否为主刻度（0%/25%/50%/75% 进度位） */
export function isMajorGradation(
  index: number,
  every = ORBIT_MAJOR_GRADATION_EVERY,
): boolean {
  if (!Number.isInteger(every) || every < 1) {
    throw new RangeError(`主刻度间隔必须为 ≥1 的整数，收到 ${every}`);
  }
  if (!Number.isInteger(index) || index < 0) {
    throw new RangeError(`刻度索引必须为非负整数，收到 ${index}`);
  }
  return index % every === 0;
}

/**
 * 刻度进度标签（"银河年 25%" 样式，主刻度 Html 标注用）
 */
export function gradationProgressLabel(
  index: number,
  count = ORBIT_GRADATION_COUNT,
): string {
  const angle = orbitGradationAngle(index, count); // 复用参数校验
  const percent = (angle / (Math.PI * 2)) * 100;
  return `银河年 ${percent % 1 === 0 ? percent.toFixed(0) : percent.toFixed(1)}%`;
}

// ---------------------------------------------------------------------------
// 当前位置脉动高亮（R2-6 §6.1：You are here 联动，真实秒驱动的 UI 节奏）
// ---------------------------------------------------------------------------

/** 脉动周期（真实秒；UI 高亮节奏，非物理量，登记见文件头） */
export const MARKER_PULSE_PERIOD_SEC = 2.4;

/** 波纹扩散环最大缩放倍数（相对标记基础尺寸） */
export const PULSE_RING_MAX_SCALE = 3;

/** 波纹扩散环峰值不透明度 */
export const PULSE_RING_PEAK_OPACITY = 0.7;

/** 标记本体呼吸脉动幅度（±12%） */
export const MARKER_BREATH_AMPLITUDE = 0.12;

/**
 * 脉动相位（[0,1) 循环）：真实经过秒数 → 当前周期内进度
 */
export function markerPulse01(
  elapsedSeconds: number,
  periodSec = MARKER_PULSE_PERIOD_SEC,
): number {
  if (!Number.isFinite(elapsedSeconds)) {
    throw new RangeError(`经过秒数必须为有限数，收到 ${elapsedSeconds}`);
  }
  if (!(periodSec > 0)) {
    throw new RangeError(`脉动周期必须为正数，收到 ${periodSec}`);
  }
  const raw = elapsedSeconds / periodSec;
  const frac = raw - Math.floor(raw);
  return frac;
}

/**
 * 波纹扩散环缩放因子：1 → PULSE_RING_MAX_SCALE（easeOutQuad，先快后慢扩散）
 */
export function pulseRingScale(phase01: number): number {
  assertPhase01(phase01);
  const eased = 1 - (1 - phase01) * (1 - phase01);
  return 1 + (PULSE_RING_MAX_SCALE - 1) * eased;
}

/**
 * 波纹扩散环不透明度：峰值 → 0（随扩散平方衰减，扩散尽头完全消隐）
 */
export function pulseRingOpacity(phase01: number): number {
  assertPhase01(phase01);
  return PULSE_RING_PEAK_OPACITY * (1 - phase01) * (1 - phase01);
}

/**
 * 标记本体呼吸缩放因子：1 ± MARKER_BREATH_AMPLITUDE（正弦呼吸）
 */
export function markerBreathScale(phase01: number): number {
  assertPhase01(phase01);
  return 1 + MARKER_BREATH_AMPLITUDE * Math.sin(Math.PI * 2 * phase01);
}

function assertPhase01(phase01: number): void {
  if (!Number.isFinite(phase01) || phase01 < 0 || phase01 >= 1) {
    throw new RangeError(`脉动相位必须在 [0,1) 内，收到 ${phase01}`);
  }
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
