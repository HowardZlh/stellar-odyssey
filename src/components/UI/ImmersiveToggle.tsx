'use client';

import type { JSX } from 'react';
import { useEffect } from 'react';
import { useT } from '@/hooks/useI18n';
import { useSimulationStore } from '@/store';

/**
 * 页面最大化（沉浸模式）按钮（UI 布局优化）：
 *
 * - 点击进入：请求浏览器全屏 + 收起左侧控制面板 + 关闭当前天体信息面板
 *   （面板联动经 store.setImmersiveMode；点击天体仍正常弹出信息面板）；
 * - 再次点击退出：还原控制面板展开态，并在用户未另选天体时恢复进入前
 *   选中的天体信息面板；
 * - 全屏请求随用户手势发起，被拒/不支持时静默降级为仅收起面板
 *   （与展馆模式全屏口径一致）；监听 fullscreenchange——Esc/系统手势
 *   退出全屏时同步退出沉浸模式，按钮状态不失联。
 */
export function ImmersiveToggle(): JSX.Element {
  const immersive = useSimulationStore((s) => s.immersiveMode);
  const tr = useT();

  useEffect(() => {
    const onFullscreenChange = (): void => {
      const state = useSimulationStore.getState();
      if (!document.fullscreenElement && state.immersiveMode) {
        state.setImmersiveMode(false);
      }
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () =>
      document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  const handleToggle = (): void => {
    const state = useSimulationStore.getState();
    const next = !state.immersiveMode;
    state.setImmersiveMode(next);
    if (next) {
      document.documentElement.requestFullscreen?.()?.catch(() => undefined);
    } else if (document.fullscreenElement) {
      document.exitFullscreen?.()?.catch(() => undefined);
    }
  };

  return (
    <button
      type="button"
      onClick={handleToggle}
      aria-pressed={immersive}
      aria-label={tr(immersive ? 'hud.immersiveExit' : 'hud.immersiveEnter')}
      title={tr(immersive ? 'hud.immersiveExit' : 'hud.immersiveEnter')}
      className="rounded bg-white/10 px-1.5 py-0.5 text-xs text-gray-300 transition-colors hover:bg-white/20 hover:text-white"
    >
      {immersive ? '🗗' : '⛶'}
    </button>
  );
}
