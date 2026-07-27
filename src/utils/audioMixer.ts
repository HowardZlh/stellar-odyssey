/**
 * 音效混合核心逻辑（需求 3.4，纯函数，与播放引擎解耦以便测试）
 *
 * 声明：真空中无声音，本系统音效为艺术化设计（UI 中提供说明）。
 */

import type { ViewLevel } from '@/types';
import { VIEW_LEVELS } from '@/types';

/** 音景交叉淡入淡出时长（秒），需求 3.4.2：1–3 秒 */
export const CROSSFADE_DURATION_SECONDS = 2;

export interface CrossfadeState {
  /** 正在淡出的层级（无过渡时与 to 相同） */
  from: ViewLevel;
  /** 正在淡入的层级 */
  to: ViewLevel;
  /** 过渡进度 [0, 1]，1 表示完成 */
  progress: number;
}

/**
 * 计算各层级音景的目标增益（0-1）
 *
 * - 静音或音量为 0 时全部为 0
 * - 过渡中：from 层级线性淡出、to 层级线性淡入（等功率曲线用 sqrt 防止中段音量塌陷）
 * - 其余层级增益为 0
 */
export function computeSoundscapeGains(
  state: CrossfadeState,
  masterVolume: number,
  muted: boolean,
): Record<ViewLevel, number> {
  const volume = clamp01(masterVolume);
  const gains = {} as Record<ViewLevel, number>;
  for (const level of VIEW_LEVELS) {
    gains[level] = 0;
  }
  if (muted || volume === 0) {
    return gains;
  }
  const p = clamp01(state.progress);
  if (state.from === state.to || p >= 1) {
    gains[state.to] = volume;
    return gains;
  }
  // 等功率交叉淡入淡出
  gains[state.from] = Math.sqrt(1 - p) * volume;
  gains[state.to] = Math.sqrt(p) * volume;
  return gains;
}

/**
 * 开始一次新的音景过渡（纯函数）
 *
 * 若目标与当前淡入目标相同则维持原状态；
 * 若在过渡中途切换，则以当前淡入层级作为新的淡出起点。
 */
export function startCrossfade(state: CrossfadeState, target: ViewLevel): CrossfadeState {
  if (target === state.to) {
    return state;
  }
  return { from: state.to, to: target, progress: 0 };
}

/**
 * 推进过渡进度（纯函数）
 */
export function advanceCrossfade(
  state: CrossfadeState,
  deltaSeconds: number,
  durationSeconds = CROSSFADE_DURATION_SECONDS,
): CrossfadeState {
  if (state.progress >= 1) return state;
  const progress =
    durationSeconds <= 0 ? 1 : Math.min(1, state.progress + deltaSeconds / durationSeconds);
  return { ...state, progress };
}

/**
 * 连续缩放音景混合（需求 3.4.2：音景随尺度比例实时混合，跟随维度而非仅切换事件）
 *
 * 各层级权重取三角窗（相邻两层线性互补），再开方保持等功率过渡：
 * 连续层级 2.5 时 L2/L3 各占 sqrt(0.5)，与离散交叉淡化中点一致。
 *
 * @param continuousLevel 连续层级（1.0–4.0）
 */
export function computeContinuousSoundscapeGains(
  continuousLevel: number,
  masterVolume: number,
  muted: boolean,
): Record<ViewLevel, number> {
  const volume = clamp01(masterVolume);
  const gains = {} as Record<ViewLevel, number>;
  for (const level of VIEW_LEVELS) {
    gains[level] = 0;
  }
  if (muted || volume === 0) {
    return gains;
  }
  const f = Math.min(4, Math.max(1, continuousLevel));
  for (let i = 0; i < VIEW_LEVELS.length; i += 1) {
    const weight = Math.max(0, 1 - Math.abs(f - (i + 1)));
    gains[VIEW_LEVELS[i]] = Math.sqrt(weight) * volume;
  }
  return gains;
}

export function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

// ---------------------------------------------------------------------------
// L1 行星差异化音景混合（P3-6，需求 §3.4.1 登记差异消除）
// ---------------------------------------------------------------------------

/** 程序化环境音合成参数（与 data/sounds.ProceduralSoundParams 结构一致） */
export interface SoundParams {
  filterFrequency: number;
  oscillatorFrequency: number;
  noiseGain: number;
  oscGain: number;
}

/** 行星音景切换过渡时长（秒），需求 §3.4.1：平滑过渡 1–3 秒 */
export const PLANET_AMBIENCE_FADE_SECONDS = 2;

/** 行星音景过渡状态（fromId/toId 为行星 id，null = 地球基准音景） */
export interface PlanetAmbienceTransition {
  fromId: string | null;
  toId: string | null;
  /** 过渡进度 [0, 1]，1 表示完成 */
  progress: number;
}

/**
 * 混合两组合成参数（纯函数）：
 * 频率按对数插值（听感线性，避免滑音突兀），增益线性插值。
 */
export function mixSoundParams(from: SoundParams, to: SoundParams, t01: number): SoundParams {
  const t = clamp01(t01);
  // 端点精确返回（避免对数插值的浮点残差）
  if (t === 0) return { ...from };
  if (t === 1) return { ...to };
  const logLerp = (a: number, b: number): number => {
    if (a <= 0 || b <= 0) {
      throw new RangeError(`频率必须为正数，收到 ${a}, ${b}`);
    }
    return Math.exp(Math.log(a) + (Math.log(b) - Math.log(a)) * t);
  };
  return {
    filterFrequency: logLerp(from.filterFrequency, to.filterFrequency),
    oscillatorFrequency: logLerp(from.oscillatorFrequency, to.oscillatorFrequency),
    noiseGain: from.noiseGain + (to.noiseGain - from.noiseGain) * t,
    oscGain: from.oscGain + (to.oscGain - from.oscGain) * t,
  };
}

/**
 * 开始行星音景过渡（纯函数）：目标不变时维持原状态；
 * 过渡中途切换时以当前淡入目标作为新的淡出起点。
 */
export function startPlanetAmbienceTransition(
  state: PlanetAmbienceTransition,
  targetId: string | null,
): PlanetAmbienceTransition {
  if (targetId === state.toId) {
    return state;
  }
  return { fromId: state.toId, toId: targetId, progress: 0 };
}

/**
 * 推进行星音景过渡进度（纯函数）
 */
export function advancePlanetAmbienceTransition(
  state: PlanetAmbienceTransition,
  deltaSeconds: number,
  durationSeconds = PLANET_AMBIENCE_FADE_SECONDS,
): PlanetAmbienceTransition {
  if (state.progress >= 1) return state;
  const progress =
    durationSeconds <= 0 ? 1 : Math.min(1, state.progress + deltaSeconds / durationSeconds);
  return { ...state, progress };
}

// ---------------------------------------------------------------------------
// L1 太阳近观"沸腾"颗粒噪声音景（S3，IMPROVEMENT_REQUIREMENTS_SOLAR §4.6）
// ---------------------------------------------------------------------------

/**
 * 太阳沸腾音景峰值增益（叠加在 sun-hum 低频轰鸣之上的颗粒噪声层）：
 * 亮度克制，仅 L1 近观显著（真空无声，艺术化设计，UI 说明）。
 */
export const SUN_BOIL_MAX_GAIN = 0.18;

/**
 * 太阳沸腾颗粒噪声层增益（纯逻辑，§4.6）：随 L1 近观强度与活动周期相位微调。
 * - 近观强度（nearStrength01）：L1 贴近太阳时最强，远离淡出（主导因子）；
 * - 周期包络（cycleEnvelope01）：极大期活动旺盛，颗粒噪声略增（±20% 调制）。
 *
 * @param nearStrength01 太阳近观细节强度 ∈ [0,1]（planetDetail.detailStrength01）
 * @param cycleEnvelope01 活动周期黑子包络 ∈ [0,1]（solarCycle.cycleSunspotEnvelope）
 * @returns 沸腾层增益 ∈ [0, SUN_BOIL_MAX_GAIN]
 */
export function sunBoilLayerGain(nearStrength01: number, cycleEnvelope01: number): number {
  const near = clamp01(nearStrength01);
  const cyc = clamp01(cycleEnvelope01);
  // 周期相位微调：极小期 0.8 倍、极大期 1.2 倍
  const cycleMod = 0.8 + 0.4 * cyc;
  return SUN_BOIL_MAX_GAIN * near * cycleMod;
}
