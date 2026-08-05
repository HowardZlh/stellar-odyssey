'use client';

import type { JSX } from 'react';
import { useT } from '@/hooks/useI18n';
import { useSimulationStore } from '@/store';

/**
 * M4-3：H 键（UI 显隐总开关）的触屏等价入口（REQUIREMENTS_MOBILE §M4-3）。
 *
 * - `HideUiButton`：沉浸按钮旁的"隐藏界面"按钮（HudStatusPanel 桌面行 +
 *   移动状态条展开详情两处挂载）；**仅 isTouch 渲染**——桌面键鼠布局
 *   与行为零变化（H 键仍可用），登记为二选一裁决：桌面不加可见按钮。
 * - `UiRestoreButton`：uiVisible=false 时的半透明角落恢复按钮，挂载于
 *   SolarSystemApp 的 uiVisible 受控容器**之外**（触屏用户不可永久失去
 *   UI）；kiosk 非 inactive 时不渲染（登记：展馆巡游的沉浸态由 kiosk
 *   任意输入唤醒语义承担——tap 即 pointerdown 输入信号，无需常驻按钮，
 *   且避免破坏影院式全隐藏观感）。
 */
export function HideUiButton(): JSX.Element | null {
  const tr = useT();
  const isTouch = useSimulationStore((s) => s.isTouch);
  const setUiVisible = useSimulationStore((s) => s.setUiVisible);
  if (!isTouch) return null;
  return (
    <button
      type="button"
      onClick={() => setUiVisible(false)}
      className="rounded bg-white/10 px-1.5 py-0.5 text-xs text-gray-300 transition-colors hover:bg-white/20 hover:text-white max-md:px-4 max-md:py-3"
    >
      🫥 {tr('hud.uiHide')}
    </button>
  );
}

export function UiRestoreButton(): JSX.Element | null {
  const tr = useT();
  const isTouch = useSimulationStore((s) => s.isTouch);
  const uiVisible = useSimulationStore((s) => s.uiVisible);
  const kioskActive = useSimulationStore((s) => s.kiosk.phase !== 'inactive');
  const setUiVisible = useSimulationStore((s) => s.setUiVisible);
  if (!isTouch || uiVisible || kioskActive) return null;
  return (
    <button
      type="button"
      onClick={() => setUiVisible(true)}
      className="fixed right-3 top-3 z-40 mt-safe-t rounded-full border border-white/10 bg-white/10 px-4 py-3 text-xs text-gray-300/80 backdrop-blur transition-colors hover:bg-white/20 hover:text-white"
    >
      👁 {tr('hud.uiShow')}
    </button>
  );
}
