/**
 * 行星冻结-淡出门控（R2-3，用户反馈点 2 前半）
 *
 * 背景：原行星/彗星/矮行星冻结硬阈值为 continuousLevel > 3.2（Planet.tsx/
 * Comet.tsx/SolarSystem.tsx 三处魔法数字重复），而 L3 锚点 ≈3.0，该处时间
 * 压缩比已按对数插值达 ~2×10⁶ 年/秒 → 连续层级 2.5–3.2 区间行星每帧
 * 数千圈视觉乱跳（"高压缩比未冻结"窗口）。
 *
 * 方案（本模块统一收敛全部阈值常量，纯逻辑供单元测试）：
 * 1. 硬阈值改为渐变淡出区间 2.6 → 3.0（smoothstep），行星在进入 L3 锚点
 *    （~3.0）前已完成淡出隐藏；与 Belt.tsx 带状结构 2.6–3.2 淡出节奏协调。
 * 2. 淡出区间内行星仍部分可见时，公转视觉角速度应用与卫星一致的
 *    rateClampFactor（utils/time.ts，0.5 圈/秒阈值），钳制中按降速角速度
 *    累计相位（无跳变），提示文案区分"行星运动已减速显示"。
 * 3. 冻结/淡出只影响视觉呈现：返回 L2/L1 时按共享模拟时间轴 simDays
 *    重新求值位置（钳制解除即回到精确相位），无时间跳变（需求 3.3）。
 *
 * 视觉登记：淡出以"整组缩放收敛 + 标签透明度"实现（行星在该层级下已为
 * 亚像素点，缩放收敛与透明度淡出在观感上等效，且无需给全部材质加
 * transparent 通道）；轨道线为该区间主要可见要素，按同一权重做真正的
 * 透明度淡出（OrbitLine.tsx）。
 */

import { normalizeAngle } from '@/utils/physics';

/** 行星淡出起点（连续层级）：低于该值完全可见 */
export const PLANET_FADE_START_LEVEL = 2.6;
/** 行星淡出终点（连续层级）：达到该值完全隐藏并冻结演算（L3 锚点 ~3.0 前完成） */
export const PLANET_FADE_END_LEVEL = 3.0;

/**
 * 行星可见度权重 [0,1]：连续层级 2.6 → 3.0 平滑淡出（smoothstep）。
 *
 * 行星/矮行星/彗星本体、其标签与轨道线共用该权重（同步淡出，R2-3）。
 * 太阳本体不受影响（L3 太阳系标记热区依赖，Sun.tsx 不接入本门控）。
 */
export function planetVisibilityWeight(continuousLevel: number): number {
  if (!Number.isFinite(continuousLevel)) {
    throw new RangeError(`连续层级必须为有限数，收到 ${continuousLevel}`);
  }
  if (continuousLevel <= PLANET_FADE_START_LEVEL) return 1;
  if (continuousLevel >= PLANET_FADE_END_LEVEL) return 0;
  const t =
    (continuousLevel - PLANET_FADE_START_LEVEL) /
    (PLANET_FADE_END_LEVEL - PLANET_FADE_START_LEVEL);
  const s = t * t * (3 - 2 * t);
  return 1 - s;
}

/**
 * 行星是否完全冻结（不可见 + 跳过演算，需求 3.3 外层退化）。
 *
 * 原 FREEZE_LEVEL_THRESHOLD = 3.2 硬阈值的统一替代：淡出完毕即冻结。
 */
export function planetFrozen(continuousLevel: number): boolean {
  return planetVisibilityWeight(continuousLevel) === 0;
}

/**
 * 钳制相位推进（R2-3，镜像 Moon.tsx 卫星钳制逻辑）：
 * - 接管帧（prevPhaseRad 为 null）：以精确相位为起点，无跳变；
 * - 钳制中：按降速后的角速度增量累计（因子变化时相位连续）。
 *
 * @param prevPhaseRad 上一帧累计相位（弧度）；null 表示本帧开始接管
 * @param exactPhaseRad 按共享模拟时间轴求值的精确相位（弧度）
 * @param deltaSimDays 模拟时间增量（天，可为负——时间回拨同样降速回退）
 * @param meanMotionRadPerDay 平均运动（弧度/天）
 * @param clampFactor 速率钳制因子（utils/time.rateClampFactor，(0,1]）
 */
export function advanceClampedPhase(
  prevPhaseRad: number | null,
  exactPhaseRad: number,
  deltaSimDays: number,
  meanMotionRadPerDay: number,
  clampFactor: number,
): number {
  if (!Number.isFinite(exactPhaseRad)) {
    throw new RangeError(`精确相位必须为有限数，收到 ${exactPhaseRad}`);
  }
  if (!Number.isFinite(clampFactor) || clampFactor <= 0 || clampFactor > 1) {
    throw new RangeError(`钳制因子必须在 (0, 1] 内，收到 ${clampFactor}`);
  }
  if (prevPhaseRad === null) return normalizeAngle(exactPhaseRad);
  return normalizeAngle(prevPhaseRad + meanMotionRadPerDay * deltaSimDays * clampFactor);
}

/**
 * 相位（平近点角，弧度）→ 等效历元后天数：
 * 使 meanAnomalyAtTime(elements, 等效天数) 恰等于该相位。
 *
 * 用途（R2-3）：钳制中的行星/彗星以等效时间调用既有开普勒求解入口
 * （heliocentricPosition / orbitalVelocityAuPerDay），位置、速度与
 * 渲染相位严格一致；相机跟随（cameraFocus）读取渲染相位注册表后
 * 同样经本函数换算，保证"相机跟随的点"与"渲染的天体"一致（P7 范式）。
 */
export function equivalentDaysForPhase(
  phaseRad: number,
  meanAnomalyAtEpochDeg: number,
  periodDays: number,
): number {
  if (!Number.isFinite(phaseRad)) {
    throw new RangeError(`相位必须为有限数，收到 ${phaseRad}`);
  }
  if (!Number.isFinite(periodDays) || periodDays === 0) {
    throw new RangeError(`周期必须为非零有限数，收到 ${periodDays}`);
  }
  const m0 = (meanAnomalyAtEpochDeg * Math.PI) / 180;
  const n = (Math.PI * 2) / periodDays;
  return normalizeAngle(phaseRad - m0) / n;
}

// ---------------------------------------------------------------------------
// 行星速率钳制提示聚合（"行星运动已减速显示"，与卫星提示文案区分）
// ---------------------------------------------------------------------------

const clampedBodies = new Set<string>();

/**
 * 上报单个天体的钳制状态，返回聚合结果（任一行星/矮行星/彗星被钳制
 * 且可见即为 true）。多天体共享一条 store 布尔提示时，直接互写会因
 * 钳制阈值随周期不同（水星先于海王星激活）而逐帧抖动，故以引用计数
 * 聚合后再写入。
 */
export function reportPlanetRateClamp(bodyId: string, clamped: boolean): boolean {
  if (clamped) {
    clampedBodies.add(bodyId);
  } else {
    clampedBodies.delete(bodyId);
  }
  return clampedBodies.size > 0;
}

/** 清空钳制上报（测试用） */
export function clearPlanetRateClampReports(): void {
  clampedBodies.clear();
}
