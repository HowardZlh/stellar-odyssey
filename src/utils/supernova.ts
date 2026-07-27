/**
 * 超新星爆炸动态事件（需求 3.1.5 核心动态效果）的纯逻辑
 *
 * 四阶段动画（总时长 10–30 秒可配置，真实时间驱动）：
 *   1. brightening：前身星亮度骤增至峰值（数秒内成为视野内最亮点）
 *   2. shockwave：球形冲击波壳层高速扩张（Sedov-Taylor 相 r ∝ t^0.4，
 *      物理上体现"抛射物减速膨胀"）
 *   3. decay：亮度按指数衰减曲线回落
 *   4. remnant：留下永久遗迹（膨胀星云 + 中心致密天体）
 *
 * 科学性说明（信息面板/通知展示）：银河系真实超新星频率约每 50–100 年一次；
 * 模拟中为可观赏性按 SN_MEAN_INTERVAL_MYR 的平均间隔触发（差异已登记）。
 *
 * 数据来源：Sedov-Taylor 冲击波解；核坍缩超新星前身星质量阈值
 * （约 8 M☉ 以上爆发；约 20 M☉ 以上遗迹为黑洞，否则为中子星）。
 */

import type { Vec3 } from '@/types';
import { normalizeAngle } from '@/utils/physics';

/** 阶段时长占比（brighten + shock + decay = 1，之后进入 remnant） */
export const SN_PHASE_FRACTIONS = {
  brighten: 0.12,
  shock: 0.45,
  decay: 0.43,
} as const;

/** 动画总时长可配置范围（秒） */
export const SN_MIN_DURATION_SEC = 10;
export const SN_MAX_DURATION_SEC = 30;
export const SN_DEFAULT_DURATION_SEC = 18;

/** 遗迹致密天体类型阈值：前身星 ≥ 20 M☉ → 黑洞，否则中子星 */
export const SN_BLACK_HOLE_MASS_THRESHOLD_SUN = 20;

/** 自动触发平均间隔（模拟时间，百万年）——真实频率约每 50–100 年一次，
 * 模拟中为可观赏性大幅降频（约 L3 默认压缩比下每 ~30 秒一次），差异已登记 */
export const SN_MEAN_INTERVAL_MYR = 60;

/** 遗迹保留上限（个，避免无限累积） */
export const SN_MAX_REMNANTS = 4;

/** 真实频率文案（科学性说明） */
export const SN_REAL_FREQUENCY_NOTE_ZH =
  '真实银河系超新星频率约每 50–100 年一次；模拟中为可观赏性已大幅提高触发频率（艺术化加速，已登记）';

export type SupernovaPhase = 'brightening' | 'shockwave' | 'decay' | 'remnant';

/** 超新星某时刻的可视状态 */
export interface SupernovaVisualState {
  phase: SupernovaPhase;
  /** 核心亮度（0-1，峰值 1） */
  brightness01: number;
  /** 冲击波壳层半径（0-1，相对最大半径） */
  shockRadius01: number;
  /** 冲击波壳层不透明度（0-1，扩张中渐弱） */
  shockOpacity01: number;
  /** 遗迹星云不透明度（0-1，decay 阶段渐显，remnant 阶段恒定） */
  remnantOpacity01: number;
}

/**
 * 校验并钳制动画时长到 [10, 30] 秒
 */
export function clampSupernovaDuration(durationSec: number): number {
  if (!Number.isFinite(durationSec)) {
    return SN_DEFAULT_DURATION_SEC;
  }
  return Math.min(SN_MAX_DURATION_SEC, Math.max(SN_MIN_DURATION_SEC, durationSec));
}

/**
 * 当前阶段判定
 */
export function supernovaPhaseAt(elapsedSec: number, durationSec: number): SupernovaPhase {
  if (durationSec <= 0) {
    throw new RangeError(`动画时长必须为正数，收到 ${durationSec}`);
  }
  const t01 = elapsedSec / durationSec;
  if (t01 >= 1) return 'remnant';
  if (t01 < SN_PHASE_FRACTIONS.brighten) return 'brightening';
  if (t01 < SN_PHASE_FRACTIONS.brighten + SN_PHASE_FRACTIONS.shock) return 'shockwave';
  return 'decay';
}

/**
 * 超新星完整可视状态（阶段 + 亮度 + 冲击波 + 遗迹透明度）
 *
 * - 亮度：brightening 阶段 easeOut 立方骤增至 1；之后按指数衰减
 *   （衰减常数使 decay 结束时约 0.05，遗迹期维持 0.05 余辉）
 * - 冲击波半径：Sedov-Taylor r ∝ t^0.4（扩张减速），remnant 期保持 1
 * - 遗迹星云：decay 阶段线性渐显至 1
 */
export function supernovaVisualState(
  elapsedSec: number,
  durationSec: number,
): SupernovaVisualState {
  const phase = supernovaPhaseAt(elapsedSec, durationSec);
  const clamped = Math.max(0, elapsedSec);
  const brightenEnd = durationSec * SN_PHASE_FRACTIONS.brighten;
  const shockEnd = durationSec * (SN_PHASE_FRACTIONS.brighten + SN_PHASE_FRACTIONS.shock);

  // ---- 核心亮度 ----
  let brightness01: number;
  if (phase === 'brightening') {
    const t = clamped / brightenEnd;
    brightness01 = 1 - Math.pow(1 - t, 3); // easeOutCubic：数秒内骤增至峰值
  } else {
    // 指数衰减：从峰值 1 → 遗迹余辉 0.05
    const decaySpan = durationSec - brightenEnd;
    const t = Math.min(1, (clamped - brightenEnd) / decaySpan);
    brightness01 = Math.max(0.05, Math.exp(-3 * t));
  }

  // ---- 冲击波壳层（Sedov-Taylor r ∝ t^0.4） ----
  let shockRadius01 = 0;
  let shockOpacity01 = 0;
  if (clamped >= brightenEnd) {
    const shockSpan = durationSec - brightenEnd;
    const t = Math.min(1, (clamped - brightenEnd) / shockSpan);
    shockRadius01 = Math.pow(t, 0.4);
    // 扩张中渐弱：外缘增亮由渲染端处理，整体透明度随扩张降低
    shockOpacity01 = phase === 'remnant' ? 0.12 : 0.85 * (1 - 0.75 * t);
  }

  // ---- 遗迹星云 ----
  let remnantOpacity01 = 0;
  if (phase === 'remnant') {
    remnantOpacity01 = 1;
  } else if (phase === 'decay') {
    const decaySpan = durationSec - shockEnd;
    remnantOpacity01 = Math.min(1, (clamped - shockEnd) / decaySpan);
  }

  return { phase, brightness01, shockRadius01, shockOpacity01, remnantOpacity01 };
}

/**
 * 自动触发判定（泊松过程）：在 Δt 模拟时间内至少发生一次的概率
 * p = 1 − exp(−Δt / 平均间隔)，rand01 < p 时触发。
 *
 * @param rand01 [0,1) 随机数
 * @param deltaSimMyr 本帧推进的模拟时间（百万年）
 * @param meanIntervalMyr 平均触发间隔（百万年）
 */
export function shouldAutoTriggerSupernova(
  rand01: number,
  deltaSimMyr: number,
  meanIntervalMyr: number = SN_MEAN_INTERVAL_MYR,
): boolean {
  if (meanIntervalMyr <= 0) {
    throw new RangeError(`平均间隔必须为正数，收到 ${meanIntervalMyr}`);
  }
  if (deltaSimMyr <= 0) return false;
  const probability = 1 - Math.exp(-deltaSimMyr / meanIntervalMyr);
  return rand01 < probability;
}

/** 旋臂内随机位置生成参数（与银盘粒子生成一致的对数螺旋公式） */
export interface ArmPositionParams {
  armCount: number;
  spiralTightness: number;
  bulgeRadiusLy: number;
  diskRadiusLy: number;
  /** 垂直散布（光年） */
  heightSpreadLy: number;
}

/**
 * 旋臂内随机爆发位置（银心系本地坐标，光年；需求 3.1.5 触发方式）
 *
 * 半径取核球外至银盘 85% 之间，方位角按对数螺旋臂公式 + 小抖动。
 *
 * @param rand 随机数生成器（[0,1)），传入 createSeededRandom 可保证确定性
 */
export function randomArmPositionLy(rand: () => number, params: ArmPositionParams): Vec3 {
  if (params.armCount < 1) {
    throw new RangeError(`旋臂数必须 ≥ 1，收到 ${params.armCount}`);
  }
  const rMin = params.bulgeRadiusLy;
  const rMax = params.diskRadiusLy * 0.85;
  const r = rMin + rand() * (rMax - rMin);
  const armIndex = Math.floor(rand() * params.armCount);
  const phase = normalizeAngle(
    armIndex * ((Math.PI * 2) / params.armCount) +
      params.spiralTightness * Math.log(1 + r / params.bulgeRadiusLy) +
      (rand() - 0.5) * 0.2,
  );
  const height = (rand() - 0.5) * 2 * params.heightSpreadLy;
  return {
    x: r * Math.cos(phase),
    y: height,
    z: -r * Math.sin(phase),
  };
}

/**
 * 遗迹致密天体类型：前身星质量 ≥ 20 M☉ → 黑洞，否则中子星
 */
export function remnantCompactObject(progenitorMassSun: number): 'neutron-star' | 'black-hole' {
  if (progenitorMassSun <= 0) {
    throw new RangeError(`前身星质量必须为正数，收到 ${progenitorMassSun}`);
  }
  return progenitorMassSun >= SN_BLACK_HOLE_MASS_THRESHOLD_SUN ? 'black-hole' : 'neutron-star';
}
