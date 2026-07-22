/**
 * 全局状态管理（Zustand）
 *
 * 管理：模拟时间轴、速度控制、视角层级、显示开关、音效设置、选中天体
 */

import { create } from 'zustand';
import type { ViewLevel } from '@/types';
import { daysSinceJ2000 } from '@/utils/physics';
import { advanceSimTime, clampSpeedMultiplier } from '@/utils/time';

export interface SimulationState {
  /** 模拟时间：J2000 历元起天数（初始为真实当前日期，需求 3.1.1 真实日期模式） */
  simDays: number;
  /** 是否暂停 */
  paused: boolean;
  /** 全局速度倍率 */
  speedMultiplier: number;
  /** 当前视角层级 */
  viewLevel: ViewLevel;
  /** 视角切换代次（每次切换 +1，供相机过渡动画识别新目标） */
  viewTransitionId: number;
  /** 轨道线显示 */
  showOrbits: boolean;
  /** 标签显示 */
  showLabels: boolean;
  /** 音效开关 */
  audioEnabled: boolean;
  /** 音量（0-1） */
  audioVolume: number;
  /** 选中天体 id（null 为未选中） */
  selectedBodyId: string | null;

  // actions
  tick: (realDeltaSeconds: number) => void;
  setPaused: (paused: boolean) => void;
  togglePaused: () => void;
  setSpeedMultiplier: (multiplier: number) => void;
  setViewLevel: (level: ViewLevel) => void;
  setShowOrbits: (show: boolean) => void;
  setShowLabels: (show: boolean) => void;
  setAudioEnabled: (enabled: boolean) => void;
  toggleAudio: () => void;
  setAudioVolume: (volume: number) => void;
  selectBody: (id: string | null) => void;
  resetToNow: () => void;
}

/**
 * 初始模拟时间：真实当前日期（行星初始相位与 J2000 历元数据一致，需求 3.1.1）
 */
export function initialSimDays(now: Date = new Date()): number {
  return daysSinceJ2000(now);
}

export const useSimulationStore = create<SimulationState>((set) => ({
  simDays: initialSimDays(),
  paused: false,
  speedMultiplier: 1,
  viewLevel: 'L2',
  viewTransitionId: 0,
  showOrbits: true,
  showLabels: true,
  audioEnabled: false,
  audioVolume: 0.6,
  selectedBodyId: null,

  tick: (realDeltaSeconds) =>
    set((state) => ({
      simDays: advanceSimTime(
        state.simDays,
        realDeltaSeconds,
        state.viewLevel,
        state.speedMultiplier,
        state.paused,
      ),
    })),

  setPaused: (paused) => set({ paused }),

  togglePaused: () => set((state) => ({ paused: !state.paused })),

  setSpeedMultiplier: (multiplier) => set({ speedMultiplier: clampSpeedMultiplier(multiplier) }),

  setViewLevel: (level) =>
    set((state) =>
      state.viewLevel === level
        ? state
        : { viewLevel: level, viewTransitionId: state.viewTransitionId + 1 },
    ),

  setShowOrbits: (show) => set({ showOrbits: show }),

  setShowLabels: (show) => set({ showLabels: show }),

  setAudioEnabled: (enabled) => set({ audioEnabled: enabled }),

  toggleAudio: () => set((state) => ({ audioEnabled: !state.audioEnabled })),

  setAudioVolume: (volume) => set({ audioVolume: Math.min(1, Math.max(0, volume)) }),

  selectBody: (id) => set({ selectedBodyId: id }),

  resetToNow: () => set({ simDays: initialSimDays() }),
}));
