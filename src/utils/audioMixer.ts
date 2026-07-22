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

export function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
