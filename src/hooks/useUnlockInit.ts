"use client";

/**
 * 解锁权益运行时接入（U2-1）+ 远程门控配置拉取（A3-1）
 *
 * 挂载时一次：
 * - localStorage 恢复权益（验签通过注入，过期/非法清除存值）与演示配额；
 * - 远程门控配置：同步读缓存消毒即用 → 异步 fetch 刷新（stale-while-
 *   revalidate）；失败/超时/非 ok/形状不符 → 静默保持现值（缓存或内置
 *   默认）+ console.warn 一次，零用户可见影响（弱门口径不变）。不新增
 *   interval（登记：配置为会话级快照，Worker 侧 HTTP 5 分钟缓存已够）；
 * - `?token=` 启动参数注入（B2B/人工发 token 一键激活路径）：解析口径
 *   与 useLaunchInit 同源（直读 `window.location.search` 经 parseLaunchParams，
 *   **勿用 useSearchParams**——静态导出 + Suspense 边界要求，登记）；
 *   验签失败静默 + console.warn（控制台无未捕获异常）。
 *
 * 到期降级：30 秒轻量 interval 调 entitlementTick（到期 → 免费态 +
 * 清 persist；A3 起兼任限免窗口跨界的派生布尔刷新）。选型登记（§U2-1
 * 二选一）：不走帧循环——权益时效为秒级语义，interval 避免每帧时钟
 * 读取，且暂停/后台标签页仍能降级。
 */
import { useEffect } from "react";
import { parseLaunchParams } from "@/utils/launchParams";
import {
  parseGateConfigResponse,
  resolveGateConfigApiUrl,
} from "@/utils/remoteGateConfigClient";
import { persistGateConfig, readStoredGateConfig } from "@/utils/unlockStorage";
import { useSimulationStore } from "@/store";

/** 权益到期检查周期（毫秒，登记：到期最长 30 秒宽限——弱门口径内可接受） */
export const ENTITLEMENT_TICK_INTERVAL_MS = 30_000;

/**
 * gate-config 拉取 URL（redeem 同基址：生产默认 + 构建期
 * `NEXT_PUBLIC_UNLOCK_API_BASE` 覆写，如 wrangler dev 的 8787）
 */
const GATE_CONFIG_API_URL = resolveGateConfigApiUrl(
  process.env.NEXT_PUBLIC_UNLOCK_API_BASE,
);

/**
 * 异步拉取远程门控配置并应用（A3-1，fetch IO 壳层）：成功 → 写缓存 +
 * store（applyRemoteGateConfig 内消毒）；网络失败/HTTP 非 2xx/响应体
 * 非 JSON/形状不符（含 not_configured）→ 静默保持现值 + console.warn。
 */
export async function refreshRemoteGateConfig(): Promise<void> {
  try {
    const res = await fetch(GATE_CONFIG_API_URL);
    if (!res.ok) {
      console.warn("[unlock] 远程门控配置拉取失败（HTTP 非 2xx），沿用缓存/默认");
      return;
    }
    const parsed = parseGateConfigResponse(await res.json());
    if (parsed === null) {
      console.warn("[unlock] 远程门控配置响应形状不符，沿用缓存/默认");
      return;
    }
    persistGateConfig(parsed);
    useSimulationStore.getState().applyRemoteGateConfig(parsed);
  } catch {
    console.warn("[unlock] 远程门控配置拉取失败，沿用缓存/默认");
  }
}

/** 权益初始化 + 远程门控配置接入 + 到期检查（应用根组件挂载时一次） */
export function useUnlockInit(): void {
  useEffect(() => {
    const store = useSimulationStore.getState();
    store.restoreUnlockState();

    // A3：远程门控配置——缓存同步消毒即用（本组件树后续 effect 即可
    // 消费，如观察站门控判定），再异步拉取刷新（stale-while-revalidate）
    const cached = readStoredGateConfig();
    if (cached !== null) {
      useSimulationStore.getState().applyRemoteGateConfig(cached);
    }
    void refreshRemoteGateConfig();

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
