"use client";

/**
 * 解锁权益运行时接入（U2-1）
 *
 * 挂载时一次：
 * - localStorage 恢复权益（验签通过注入，过期/非法清除存值）与演示配额；
 * - `?token=` 启动参数注入（B2B/人工发 token 一键激活路径）：解析口径
 *   与 useLaunchInit 同源（直读 `window.location.search` 经 parseLaunchParams，
 *   **勿用 useSearchParams**——静态导出 + Suspense 边界要求，登记）；
 *   验签失败静默 + console.warn（控制台无未捕获异常）。
 *
 * 到期降级：30 秒轻量 interval 调 entitlementTick（到期 → 免费态 +
 * 清 persist）。选型登记（§U2-1 二选一）：不走帧循环——权益时效为
 * 秒级语义，interval 避免每帧时钟读取，且暂停/后台标签页仍能降级。
 */
import { useEffect } from "react";
import { parseLaunchParams } from "@/utils/launchParams";
import { useSimulationStore } from "@/store";

/** 权益到期检查周期（毫秒，登记：到期最长 30 秒宽限——弱门口径内可接受） */
export const ENTITLEMENT_TICK_INTERVAL_MS = 30_000;

/** 权益初始化 + 到期检查（应用根组件挂载时一次） */
export function useUnlockInit(): void {
  useEffect(() => {
    const store = useSimulationStore.getState();
    store.restoreUnlockState();

    // `?token=` 注入：验签通过即激活并 persist；失败静默降级免费态
    const token = parseLaunchParams(window.location.search).token;
    if (token !== null) {
      const result = useSimulationStore.getState().applyUnlockToken(token);
      if (!result.ok) {
        console.warn(`[unlock] ?token= 注入验签失败（${result.reason}），忽略`);
      }
    }

    const timer = setInterval(() => {
      useSimulationStore.getState().entitlementTick();
    }, ENTITLEMENT_TICK_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);
}
