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
 * F 飞往选中天体 / R 真实比例模式 / Esc 取消跟随（P2）/
 * [ ] 视角域序列上一个/下一个天体（P4 行星序列；R2-5 §5.1-B 泛化至
 * 全部视角域按域路由：L1/L2 行星 / L3 银河系 / L4 宇宙）/
 * G 银河系视角参考系切换（跟随太阳系 ↔ 银心固定，P6，需求 3.1.1，仅 L3 生效）/
 * V 银河系视角垂直展开开关（R3-6/R3-8：仅 L3 生效，与面板选项
 * 可见性一致；域外已开启的展开状态与场景效果保留）
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
        case 'g':
        case 'G':
          // 银河系视角参考系切换（P6，需求 3.1.1；仅 L3 语境生效）
          if (state.viewLevel === 'L3') {
            state.toggleGalacticFrameMode();
          }
          break;
        case 'v':
        case 'V':
          // 银河系视角垂直展开（R3-6；R3-8 补 L3 门控，与 G 键同模式）
          if (state.viewLevel === 'L3') {
            state.toggleGalaxyVerticalExpand();
          }
          break;
        case '[':
          // 视角域序列上一个（R2-5 §5.1-B：按当前视角域路由）
          state.cycleScopeBody(-1);
          break;
        case ']':
          state.cycleScopeBody(1);
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
