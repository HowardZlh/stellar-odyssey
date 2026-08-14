/**
 * GET /api/gate-config 纯逻辑（REQUIREMENTS_UNLOCK.md §A2-1 + §0.11 契约）：
 * KV 读 `gate:config` 原样透传——**不消毒**（消毒单点在
 * `src/utils/remoteGateConfig.ts`，前端/管理台两端共享，防逻辑漂移）。
 * 零 KV 写、无请求体解析（防额度攻击，§A2 复核）。
 */
import type { UnlockKvLike } from "./redeem";

/** KV 键（§0.11：单键 JSON，管理台写、Worker 读、前端消费） */
export const GATE_CONFIG_KV_KEY = "gate:config";

/** 响应契约（HTTP 恒 200，体内报错——redeem 惯例） */
export type GateConfigResponseBody =
  | { readonly ok: true; readonly config: unknown }
  | { readonly ok: false; readonly error: "not_configured" };

/**
 * KV 未绑定 → not_configured；无记录 → `config: {}`；
 * 合法 JSON → 原样透传；非法 JSON → 视同无记录 + console.warn。
 */
export async function handleGateConfig(
  kv: UnlockKvLike | null | undefined,
): Promise<GateConfigResponseBody> {
  if (kv === null || kv === undefined) {
    return { ok: false, error: "not_configured" };
  }
  const raw = await kv.get(GATE_CONFIG_KV_KEY);
  if (raw === null) {
    return { ok: true, config: {} };
  }
  try {
    return { ok: true, config: JSON.parse(raw) as unknown };
  } catch {
    console.warn("[gate-config] KV gate:config 非合法 JSON，视同无记录");
    return { ok: true, config: {} };
  }
}
