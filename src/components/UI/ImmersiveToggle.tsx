'use client';

import type { JSX } from 'react';
import { useEffect, useState } from 'react';
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
 * - M3-5：`requestFullscreen` 不可用（iPhone Safari 无 Fullscreen API）
 *   时按钮保留但降级文案为"仅收起 UI"口径（二选一登记：取降级文案而非
 *   隐藏——收起面板功能仍有效）；检测经 useState 惰性初始化一次完成。
 * - M4-4 title 裁决：功能必要（沉浸态语义仅靠 ⛶/🗗 图标不明）——isTouch
 *   下 title 转为可见文本标签；桌面保留 title 悬停提示零变化。
 */
export function ImmersiveToggle(): JSX.Element {
  const immersive = useSimulationStore((s) => s.immersiveMode);
  const isTouch = useSimulationStore((s) => s.isTouch);
  const tr = useT();
  // M3-5：Fullscreen API 可用性（SSR/不支持环境为 false → 降级文案）
  const [fullscreenSupported] = useState(
    () =>
      typeof document !== 'undefined' &&
      typeof document.documentElement.requestFullscreen === 'function',
  );

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

  const label = immersive
    ? tr('hud.immersiveExit')
    : tr(fullscreenSupported ? 'hud.immersiveEnter' : 'hud.immersiveEnterNoFullscreen');

  return (
    <button
      type="button"
      onClick={handleToggle}
      aria-pressed={immersive}
      aria-label={label}
      title={label}
      className="rounded bg-white/10 px-1.5 py-0.5 text-xs text-gray-300 transition-colors hover:bg-white/20 hover:text-white max-md:px-4 max-md:py-3"
    >
      {immersive ? '🗗' : '⛶'}
      {/* M4-4：触屏无 hover tooltip，功能标签转可见文本（桌面不渲染） */}
      {isTouch && <span className="ml-1">{label}</span>}
    </button>
  );
}
