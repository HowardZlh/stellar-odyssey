'use client';

import { useEffect } from 'react';
import type { ViewLevel } from '@/types';
import { useSimulationStore } from '@/store';

/** 数字键 → 视角层级映射 */
const LEVEL_KEYS: Record<string, ViewLevel> = {
  '1': 'L1',
  '2': 'L2',
  '3': 'L3',
  '4': 'L4',
};

/**
 * 键盘快捷键（需求 3.5.3）：
 * 1-4 视角切换 / 空格 暂停 / M 静音 / O 轨道线 / L 标签 /
 * F 飞往选中天体 / R 真实比例模式 / Esc 取消跟随（P2）
 */
export function useKeyboardShortcuts(): void {
  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      // 输入框聚焦时不响应
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      const state = useSimulationStore.getState();
      const level = LEVEL_KEYS[event.key];
      if (level) {
        state.setViewLevel(level);
        return;
      }
      switch (event.key) {
        case ' ':
          event.preventDefault();
          state.togglePaused();
          break;
        case 'm':
        case 'M':
          state.toggleAudio();
          break;
        case 'o':
        case 'O':
          state.setShowOrbits(!state.showOrbits);
          break;
        case 'l':
        case 'L':
          state.setShowLabels(!state.showLabels);
          break;
        case 'f':
        case 'F':
          // 飞往选中天体（需求 3.2.3）
          if (state.selectedBodyId) {
            state.requestFlyTo(state.selectedBodyId);
          }
          break;
        case 'r':
        case 'R':
          state.toggleRealScaleMode();
          break;
        case 'Escape':
          state.setFollowBody(null);
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
}
