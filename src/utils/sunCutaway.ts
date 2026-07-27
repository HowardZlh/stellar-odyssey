/**
 * 太阳内部结构剖面模式纯逻辑（S2，IMPROVEMENT_REQUIREMENTS_SOLAR §4.1）
 *
 * 1/4 球体切除（cutaway）视图：沿经度 0° → 90° 的楔形区域被切除，
 * 两个过极轴的半圆形切面呈现从内到外的分层色带：
 *   1. 核心（0–0.25 R☉）：核聚变区（质子-质子链，氢→氦），~1.57×10⁷ K
 *   2. 辐射区（0.25–0.7 R☉）：光子随机游走缓慢外传（数万至十几万年逸出）
 *   3. 对流区（0.7–1.0 R☉）：等离子体对流传能
 *   （差旋层 tachocline 位于 0.7 R☉ 交界，信息面板标注，不单独建模）
 *
 * 分层半径比例基于标准太阳模型（Christensen-Dalsgaard et al. 1996；
 * NASA Sun Fact Sheet）。
 *
 * ── 艺术化/近似登记（需求 §3、AGENTS.md 数据准确性）──────────────────
 * - 核心"能量脉动"与对流区对流胞循环动画为艺术化示意（真实核心
 *   无可见脉动、对流时标约一个月），速率取近观可辨值。
 * - 剖面切面色带按温度梯度示意着色（核心白热 → 辐射区橙黄 → 对流区
 *   橙红），非光谱学精确色。
 * - 开合过渡动画 CUTAWAY_OPEN_SECONDS（真实时间驱动的 UI 过渡，≤2 秒）。
 */

/** 核心外边界（× R☉，标准太阳模型） */
export const SUN_CORE_OUTER_FRAC = 0.25;

/** 辐射区外边界 = 差旋层位置（× R☉，标准太阳模型） */
export const SUN_RADIATIVE_OUTER_FRAC = 0.7;

/** 剖面开合过渡时长（秒，需求 ≤2 秒） */
export const CUTAWAY_OPEN_SECONDS = 1.2;

/** 楔形切除张角（弧度，1/4 球体） */
export const CUTAWAY_WEDGE_RAD = Math.PI / 2;

/** 剖面模式下的分层 id（可点选层） */
export type SunCutawayLayerId = 'core' | 'radiative' | 'convective';

/** 分层切面色带（0-1 RGB，温度梯度示意，登记见文件头） */
export const CUTAWAY_LAYER_COLORS: Record<SunCutawayLayerId, { r: number; g: number; b: number }> = {
  core: { r: 1.0, g: 0.98, b: 0.9 },
  radiative: { r: 1.0, g: 0.62, b: 0.18 },
  convective: { r: 0.92, g: 0.36, b: 0.1 },
};

/**
 * 剖面开合进度推进（每帧调用，真实时间驱动的 UI 过渡）
 *
 * @param progress01 当前进度（0 闭合 – 1 全开）
 * @param opening 目标状态（true 展开 / false 闭合）
 * @param deltaSec 帧间隔（秒）
 */
export function advanceCutawayProgress(progress01: number, opening: boolean, deltaSec: number): number {
  if (deltaSec < 0) {
    throw new RangeError(`时间增量不能为负，收到 ${deltaSec}`);
  }
  const step = deltaSec / CUTAWAY_OPEN_SECONDS;
  const next = opening ? progress01 + step : progress01 - step;
  return Math.min(1, Math.max(0, next));
}

/** easeInOutCubic（过渡平滑，与 utils/animation.ts 同公式） */
export function cutawayEase(t01: number): number {
  const t = Math.min(1, Math.max(0, t01));
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * 当前楔形张角（弧度）：进度经缓动映射到 [0, π/2]
 */
export function cutawayWedgeAngleRad(progress01: number): number {
  return CUTAWAY_WEDGE_RAD * cutawayEase(progress01);
}

/**
 * 片元是否位于切除楔形内（shader discard 镜像）：
 * 方位角 φ = atan2(−z, x) ∈ (−π, π]，楔形为 φ ∈ [0, wedge]。
 */
export function isInCutawayWedge(x: number, z: number, wedgeRad: number): boolean {
  const phi = Math.atan2(-z, x);
  return phi >= 0 && phi <= wedgeRad;
}

/**
 * 按归一化半径判定分层（切面点选 → 层 id）
 *
 * @param r01 距太阳中心距离（× R☉，0–1）
 */
export function cutawayLayerAtRadius(r01: number): SunCutawayLayerId {
  if (!(r01 >= 0) || r01 > 1 || !Number.isFinite(r01)) {
    throw new RangeError(`归一化半径必须在 [0,1] 内，收到 ${r01}`);
  }
  if (r01 <= SUN_CORE_OUTER_FRAC) return 'core';
  if (r01 <= SUN_RADIATIVE_OUTER_FRAC) return 'radiative';
  return 'convective';
}

/** 核心能量脉动周期（模拟天，艺术化示意登记见文件头） */
export const CORE_PULSE_PERIOD_DAYS = 1.2;

/**
 * 核心能量脉动亮度因子（0.94–1.06 缓慢呼吸，模拟时间驱动、暂停冻结）
 */
export function corePulseFactor(simDays: number): number {
  if (!Number.isFinite(simDays)) {
    throw new RangeError(`模拟时间必须为有限数，收到 ${simDays}`);
  }
  return 1 + 0.06 * Math.sin((simDays / CORE_PULSE_PERIOD_DAYS) * Math.PI * 2);
}

/**
 * 剖面模式下外部活动特效的强度因子（互斥渲染，需求 §4.1/§5.3）：
 * 随开合进度平滑淡出（开合过渡期间不突变）。
 */
export function externalActivityFade(cutawayProgress01: number): number {
  const p = Math.min(1, Math.max(0, cutawayProgress01));
  return 1 - p;
}
