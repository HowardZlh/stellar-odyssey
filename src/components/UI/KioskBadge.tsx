'use client';

import type { JSX } from 'react';
import { useEffect, useState } from 'react';
import { useT, useTf } from '@/hooks/useI18n';
import { kioskNowSec } from '@/hooks/useKiosk';
import { kioskRemainingSec } from '@/utils/kiosk';
import { useSimulationStore } from '@/store';

/**
 * 展馆模式暂停角标（B5 §5.1-D）：仅 kiosk `paused` 态显示——
 * "展馆模式（暂停中，N 秒后恢复）· 退出"。
 *
 * - 位置登记：顶部中央（top-4），UI 占位总表（附录 A#5）该位空闲，
 *   与左上 ControlPanel / 右上 HUD+性能监控 / 底部中央组件无碰撞；
 * - 不纳入 uiVisible 顶层包裹（登记）：暂停态 uiVisible 恒为 true，
 *   但 H 键组合边界下角标须始终可见作为退出入口，置于包裹外；
 * - 倒计时：每秒读 store kiosk.nextAtSec 重算（本地 1s 定时器仅在
 *   paused 态挂载，卸载即清理）；
 * - 退出：派发 'exit'（恢复 uiVisible）+ exitFullscreen（用户手势内，
 *   与 ControlPanel 进入全屏对称；未全屏跳过，异常静默）。
 */
export function KioskBadge(): JSX.Element | null {
  const paused = useSimulationStore((s) => s.kiosk.phase === 'paused');
  const trf = useTf();
  const tr = useT();
  // 倒计时驱动：paused 态每秒重渲染一次（nowSec 状态变化触发）
  const [nowSec, setNowSec] = useState(0);

  useEffect(() => {
    if (!paused) return undefined;
    setNowSec(kioskNowSec());
    const timer = setInterval(() => setNowSec(kioskNowSec()), 1000);
    return () => clearInterval(timer);
  }, [paused]);

  if (!paused) return null;

  const remaining = kioskRemainingSec(useSimulationStore.getState().kiosk, nowSec);

  const handleExit = (): void => {
    useSimulationStore.getState().kioskEvent('exit', kioskNowSec());
    // 未全屏跳过；受限环境（无头/iframe）拒绝时静默（控制台零错误）
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => undefined);
    }
  };

  return (
    <div className="absolute left-1/2 top-4 -translate-x-1/2 select-none rounded-lg bg-space-panel px-4 py-2 text-xs text-gray-200 backdrop-blur">
      <span>🎪 {trf('kiosk.pausedBadge', { sec: remaining })}</span>
      <span className="mx-2 text-gray-500">·</span>
      <button
        type="button"
        onClick={handleExit}
        aria-label={tr('kiosk.exitAria')}
        className="text-space-accent hover:underline"
      >
        {tr('kiosk.exit')}
      </button>
    </div>
  );
}
