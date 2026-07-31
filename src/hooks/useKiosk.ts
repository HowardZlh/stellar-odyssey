'use client';

/**
 * 展馆模式驱动 hook（B5 §5.1-C，方案 K5）
 *
 * 挂载于 SolarSystemApp：
 * - 启动入口 2：`?mode=kiosk`（B4 launch 参数）挂载后即派发 'start'
 *   （启动即 touring；URL 启动**不尝试全屏**——无用户手势必被拒，
 *   直接静默降级为不全屏照常巡游，登记；有手势全屏入口在
 *   ControlPanel"展馆模式"按钮）；
 * - kiosk 激活期间以 KIOSK_TICK_INTERVAL_MS 定时派发 'tick'、全局
 *   pointerdown/wheel/keydown（window 捕获前被动监听，不拦截场景交互）
 *   派发 'input'——状态转移与副作用统一收口在 store.kioskEvent
 *   （utils/kiosk.ts 纯函数状态机）；
 * - 未激活时定时器与输入监听全部不挂（按 kiosk.phase 订阅開关），
 *   卸载全清理（防泄漏，附录 A#1）；本 hook 不在渲染循环内运行，
 *   回调内零新对象分配。
 *
 * 退出时的 exitFullscreen 由 KioskBadge 退出按钮处理（用户手势内，
 * 与进入全屏对称）；本 hook 不触达全屏 API。
 */

import { useEffect } from 'react';
import { useSimulationStore } from '@/store';

/** kiosk 时钟派发间隔（毫秒）：0.5s 粒度对 5–600s dwell 足够 */
export const KIOSK_TICK_INTERVAL_MS = 500;

/** 统一时钟基准（秒）：与 store kioskEvent 的 nowSec 口径一致 */
export function kioskNowSec(): number {
  return performance.now() / 1000;
}

export function useKiosk(): void {
  // 仅激活态挂定时器/监听（布尔选择器，域边界跨越时才重执行 effect）
  const active = useSimulationStore((s) => s.kiosk.phase !== 'inactive');

  // 入口 2：?mode=kiosk 启动即 touring（挂载后一次；launch 已由
  // useLaunchInit 在先序 hook 的同批 effect 中写入 store）
  useEffect(() => {
    if (useSimulationStore.getState().launch.mode === 'kiosk') {
      useSimulationStore.getState().kioskEvent('start', kioskNowSec());
    }
  }, []);

  useEffect(() => {
    if (!active) return undefined;
    const dispatchTick = (): void => {
      useSimulationStore.getState().kioskEvent('tick', kioskNowSec());
    };
    const dispatchInput = (): void => {
      useSimulationStore.getState().kioskEvent('input', kioskNowSec());
    };
    const timer = setInterval(dispatchTick, KIOSK_TICK_INTERVAL_MS);
    // 捕获阶段 + 被动监听：任何用户输入（含 UI 内点击/快捷键）都算
    // 活跃信号；不拦截不 preventDefault，场景交互零影响
    window.addEventListener('pointerdown', dispatchInput, { capture: true, passive: true });
    window.addEventListener('wheel', dispatchInput, { capture: true, passive: true });
    window.addEventListener('keydown', dispatchInput, { capture: true, passive: true });
    return () => {
      clearInterval(timer);
      window.removeEventListener('pointerdown', dispatchInput, { capture: true });
      window.removeEventListener('wheel', dispatchInput, { capture: true });
      window.removeEventListener('keydown', dispatchInput, { capture: true });
    };
  }, [active]);
}
