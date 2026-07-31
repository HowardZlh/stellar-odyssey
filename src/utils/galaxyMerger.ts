/**
 * 银河系—仙女座碰撞合并后续演化（R2-11，用户反馈点 7）
 *
 * 合并时刻 T0（模拟时间 4500 Myr，van der Marel et al. 2012 的首次并合
 * 预测）之后的演化序列——全部为模拟时间 simDays 的确定性纯函数：
 * 时间回退即复原（"恢复预览前时间"全复原）、重复预览结果一致。
 *
 * 演化阶段（参考 NASA/ESA Milkomeda 情景）：
 * 1. 首次穿越（τ ∈ [0, P/2)）：M31 越过银河系沿运动方向减速远离；
 * 2. 回摆振荡（τ ∈ [P/2, 并合启动)）：两核心 1–2 次减幅往返
 *    （指数衰减包络近似动力摩擦的轨道能量耗散）；
 * 3. 潮汐扭曲：穿越/回摆期双方盘面沿连线拉伸（顶点着色器扰动）；
 * 4. 星暴：每次穿越时刻短暂蓝白增亮（气体压缩触发恒星形成爆发）；
 * 5. 终态椭圆星系 Milkomeda（τ ≥ 400 Myr 登记值）：旋臂消失、
 *    盘面增厚为椭球粒子云、色调偏老年恒星红黄。
 *
 * 艺术化/夸大处理登记（附录 A §4，面板说明见 HudInfo 合并演化卡片）：
 * - 时间压缩：真实回摆振荡 + 并合约 20–30 亿年，压缩为 T0 后 400 Myr
 *   模拟时间（L4 默认压缩比 2000 万年/秒下全程约 20 真实秒，
 *   其中终态过渡 200 Myr ≈ 10 秒）；
 * - 振荡次数简化为约 2 次减幅往返（真实 N 体模拟为多次穿越）；
 * - 回摆幅度取 1.5e5 光年（首次远心点，van der Marel et al. 2012 量级），
 *   与穿越速度解耦（时间压缩后不再满足 C1 速度连续，已登记）；
 * - 星暴亮度为艺术化高斯脉冲（真实星暴持续数千万至上亿年）。
 *
 * 数据来源：van der Marel et al. 2012, ApJ 753, 9；NASA GSFC /
 * STScI 银河系—仙女座并合模拟新闻资料（2012）。
 */

import { simDaysToMyr } from '@/utils/galaxy';
import { cosmicDistanceToSceneUnits } from '@/utils/scale';
import {
  MW_M31_MERGE_MYR,
  mwM31ApproachSeparationLy,
} from '@/utils/universe';

/** 合并时刻 T0（百万年，模拟时间轴） */
export const MERGER_T0_MYR = MW_M31_MERGE_MYR;

/** 回摆振荡全周期（百万年，时间压缩登记：真实约 15–20 亿年/次往返） */
export const MERGER_OSC_PERIOD_MYR = 160;

/** 回摆振荡幅度（光年）：首次远心点量级（van der Marel et al. 2012） */
export const MERGER_OSC_AMPLITUDE_LY = 1.5e5;

/**
 * 振荡包络衰减率（1/Myr）：每半周期（一次穿越）幅度衰减到 45%
 * （阻尼近似动力摩擦，约 2 次可辨往返后并入终态）
 */
export const MERGER_OSC_DECAY_PER_MYR =
  Math.log(1 / 0.45) / (MERGER_OSC_PERIOD_MYR / 2);

/** 终态椭圆星系过渡起点（T0 后百万年） */
export const MERGER_ELLIPTICAL_START_MYR = 200;

/** 终态椭圆星系过渡终点（T0 后百万年；真实约 20 亿年，压缩登记） */
export const MERGER_ELLIPTICAL_END_MYR = 400;

/** 星暴脉冲宽度（高斯 σ，百万年） */
export const MERGER_STARBURST_SIGMA_MYR = 18;

/** 各次穿越的星暴强度权重（第 0/1/2 次，随气体耗尽递减） */
export const MERGER_STARBURST_WEIGHTS: readonly number[] = [1, 0.55, 0.3];

/** 潮汐扭曲显现距离（光年）：两盘接近该距离内潮汐拉伸渐强 */
export const MERGER_TIDAL_ONSET_LY = 5e5;

/** 演化阶段（HUD 标签/科普卡片联动） */
export type MergerStage =
  | 'approaching'
  | 'first-passage'
  | 'oscillation'
  | 'coalescing'
  | 'merged';

/** 太阳系命运科普（信息面板卡片，R2-11 §11.1） */
export const MERGER_FATE_NOTE_ZH =
  '太阳系命运：并合过程中太阳系大概率被潮汐甩入 Milkomeda 外围更远的轨道' +
  '（也可能一度被抛向 M31 一侧）；恒星之间相距极远，恒星间直接碰撞的概率' +
  '微乎其微，行星轨道基本不受影响。';

/** 太阳系命运科普（英文，i18n 全站覆盖） */
export const MERGER_FATE_NOTE_EN =
  'Fate of the Solar System: during the merger it will most likely be tidally ' +
  'flung onto a wider orbit in the outskirts of Milkomeda (and may briefly be ' +
  'thrown toward the M31 side); stars are so far apart that direct stellar ' +
  'collisions are vanishingly unlikely, and planetary orbits are barely affected.';

/** 参考来源标注（科学性登记，附录 A §4） */
export const MERGER_SOURCE_NOTE_ZH =
  '来源：van der Marel et al. 2012 (ApJ) / NASA GSFC 并合模拟；' +
  '回摆周期与并合时长经时间压缩（真实约 20–30 亿年 → 4 亿模拟年），' +
  '振荡简化为约 2 次减幅往返，星暴亮度为艺术化示意。';

/** 参考来源标注（英文，i18n 全站覆盖） */
export const MERGER_SOURCE_NOTE_EN =
  'Source: van der Marel et al. 2012 (ApJ) / NASA GSFC merger simulations; ' +
  'oscillation period and merger duration are time-compressed (a real ~2–3 Gyr ' +
  'to 400 simulated Myr), the oscillation is simplified to about two damped ' +
  'passes, and starburst brightness is an artistic cue.';

/**
 * T0 后经过的模拟时间 τ（百万年；T0 前为负）
 */
export function mergerTauMyr(simDays: number): number {
  if (!Number.isFinite(simDays)) {
    throw new RangeError(`模拟时间必须为有限数，收到 ${simDays}`);
  }
  return simDaysToMyr(simDays) - MERGER_T0_MYR;
}

/**
 * 回摆振荡包络（光年）：A·e^(−λτ)，τ < 0 时按 τ=0 计
 */
export function mergerOscillationEnvelopeLy(tauMyr: number): number {
  if (!Number.isFinite(tauMyr)) {
    throw new RangeError(`τ 必须为有限数，收到 ${tauMyr}`);
  }
  return (
    MERGER_OSC_AMPLITUDE_LY *
    Math.exp(-MERGER_OSC_DECAY_PER_MYR * Math.max(0, tauMyr))
  );
}

/**
 * 终态椭圆星系形态插值（0-1）：smoothstep(200, 400 Myr)
 *
 * 0 = 现状盘星系；1 = Milkomeda 椭球粒子云（旋臂消失、老年恒星色调）。
 */
export function mergerEllipticalMix01(simDays: number): number {
  const tau = mergerTauMyr(simDays);
  const t = Math.min(
    1,
    Math.max(
      0,
      (tau - MERGER_ELLIPTICAL_START_MYR) /
        (MERGER_ELLIPTICAL_END_MYR - MERGER_ELLIPTICAL_START_MYR),
    ),
  );
  return t * t * (3 - 2 * t);
}

/**
 * MW–M31 签名分离距离（光年，沿"银河系 → M31 初始方向"轴的投影）
 *
 * - τ < 0：合并前接近曲线（同源 utils/universe.mwM31ApproachSeparationLy，
 *   恒为正——M31 在初始方向一侧）；
 * - τ ≥ 0：阻尼振荡 s(τ) = −A·e^(−λτ)·sin(2πτ/P)·(1 − 椭圆插值)。
 *   τ=0⁺ 时为负（首次穿越：M31 越过原点到另一侧减速远离），
 *   之后 1–2 次减幅往返，终态过渡完成后严格归零（核心并合）。
 */
export function mwM31SignedSeparationLy(simDays: number): number {
  const tau = mergerTauMyr(simDays);
  if (tau < 0) {
    return mwM31ApproachSeparationLy(simDays);
  }
  return (
    -mergerOscillationEnvelopeLy(tau) *
      Math.sin((Math.PI * 2 * tau) / MERGER_OSC_PERIOD_MYR) *
      (1 - mergerEllipticalMix01(simDays)) +
    0 // 归一化 −0 → +0（终态并合严格为 0）
  );
}

/**
 * MW–M31 签名分离距离（场景单位）——渲染/相机同源换算，禁止两套公式
 *
 * 符号沿"银河系 → M31 初始方向"轴：正 = 初始方向一侧，负 = 穿越后另一侧。
 */
export function mwM31SignedSeparationSceneUnits(simDays: number): number {
  const s = mwM31SignedSeparationLy(simDays);
  return Math.sign(s) * cosmicDistanceToSceneUnits(Math.abs(s));
}

/**
 * 星暴强度（0-1）：每次核心穿越（签名距离过零，τ_k = k·P/2）处的
 * 高斯脉冲叠加，权重随气体耗尽递减（艺术化登记见文件头）
 */
export function mergerStarburst01(simDays: number): number {
  const tau = mergerTauMyr(simDays);
  let sum = 0;
  for (let k = 0; k < MERGER_STARBURST_WEIGHTS.length; k += 1) {
    const center = (k * MERGER_OSC_PERIOD_MYR) / 2;
    const x = (tau - center) / MERGER_STARBURST_SIGMA_MYR;
    sum += MERGER_STARBURST_WEIGHTS[k] * Math.exp(-x * x);
  }
  return Math.min(1, sum);
}

/**
 * 潮汐扭曲强度（0-1）：接近显现（1 − |s|/onset）×（1 − 椭圆插值）
 *
 * 接近段随距离缩短渐强；回摆期间持续（|s| ≪ onset）；
 * 终态过渡期随椭球成形淡出（扭曲被并合抹平）。
 */
export function mergerTidalDistortion01(simDays: number): number {
  const s = Math.abs(mwM31SignedSeparationLy(simDays));
  const proximity = Math.min(1, Math.max(0, 1 - s / MERGER_TIDAL_ONSET_LY));
  return proximity * (1 - mergerEllipticalMix01(simDays));
}

/**
 * 演化阶段判定（τ 分段，边界见常量登记）
 */
export function mergerStage(simDays: number): MergerStage {
  const tau = mergerTauMyr(simDays);
  if (tau < 0) return 'approaching';
  if (tau < MERGER_OSC_PERIOD_MYR / 2) return 'first-passage';
  if (tau < MERGER_ELLIPTICAL_START_MYR) return 'oscillation';
  if (tau < MERGER_ELLIPTICAL_END_MYR) return 'coalescing';
  return 'merged';
}

/** 各阶段 HUD 标签（3D 场景标签 + 科普卡片共用） */
const STAGE_LABEL_ZH: Record<MergerStage, string> = {
  approaching: '相互接近中',
  'first-passage': '首次穿越——两盘交错而过，M31 减速远离',
  oscillation: '回摆振荡——动力摩擦下的减幅往返',
  coalescing: '核心并合中——旋臂瓦解，向椭球过渡',
  merged: '并合完成：椭圆星系 Milkomeda（银河仙女星系）',
};

/** 各阶段 HUD 标签（英文，i18n 全站覆盖；与 ZH 键集合一致） */
const STAGE_LABEL_EN: Record<MergerStage, string> = {
  approaching: 'Approaching each other',
  'first-passage': 'First passage — the disks sweep past each other, M31 decelerates and recedes',
  oscillation: 'Oscillation — damped passes under dynamical friction',
  coalescing: 'Cores coalescing — spiral arms dissolve, transitioning to a spheroid',
  merged: 'Merger complete: elliptical galaxy Milkomeda',
};

/**
 * 阶段 HUD 标签文案（合并前返回 null——接近段由倒计时文案负责）
 */
export function mergerStageLabelZh(simDays: number): string | null {
  const stage = mergerStage(simDays);
  return stage === 'approaching' ? null : STAGE_LABEL_ZH[stage];
}

/**
 * 阶段 HUD 标签文案（locale 感知，i18n 全站覆盖；语义同 mergerStageLabelZh）
 */
export function mergerStageLabel(locale: 'zh' | 'en', simDays: number): string | null {
  const stage = mergerStage(simDays);
  if (stage === 'approaching') return null;
  return locale === 'en' ? STAGE_LABEL_EN[stage] : STAGE_LABEL_ZH[stage];
}

/**
 * L4 合并演化科普卡片内容（合并前返回 null）
 */
export function mergerNoticeZh(
  simDays: number,
): { stageZh: string; tauMyr: number } | null {
  const stage = mergerStage(simDays);
  if (stage === 'approaching') return null;
  return { stageZh: STAGE_LABEL_ZH[stage], tauMyr: mergerTauMyr(simDays) };
}

/**
 * L4 合并演化科普卡片内容（locale 感知；stageText 按 locale 取用）
 */
export function mergerNotice(
  locale: 'zh' | 'en',
  simDays: number,
): { stageText: string; tauMyr: number } | null {
  const stage = mergerStage(simDays);
  if (stage === 'approaching') return null;
  return {
    stageText: locale === 'en' ? STAGE_LABEL_EN[stage] : STAGE_LABEL_ZH[stage],
    tauMyr: mergerTauMyr(simDays),
  };
}
