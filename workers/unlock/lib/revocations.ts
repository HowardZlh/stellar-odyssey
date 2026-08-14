/**
 * GET /api/revocations 纯逻辑（REQUIREMENTS_UNLOCK.md §A6-2 + §0.15 契约）：
 * KV 读 `revoke:list` 原样透传——**不消毒**（消毒单点在
 * `src/utils/revocationList.ts`，前端/管理台/Worker 测试三端共享，
 * 防逻辑漂移；gateConfig.ts 完全同构）。
 * 零 KV 写、无请求体解析（防额度攻击，§0.16 复核）。
 */
import type { UnlockKvLike } from "./redeem";

/** KV 键（§0.15：单键 JSON，管理台/巡检写、Worker 读、前端消费） */
export const REVOKE_LIST_KV_KEY = "revoke:list";

/** 响应契约（HTTP 恒 200，体内报错——gate-config 惯例） */
export type RevocationsResponseBody =
  | { readonly ok: true; readonly list: unknown }
  | { readonly ok: false; readonly error: "not_configured" };

/**
 * KV 未绑定 → not_configured；无记录 → `list: {}`；
 * 合法 JSON → 原样透传；非法 JSON → 视同无记录 + console.warn。
 */
export async function handleRevocations(
  kv: UnlockKvLike | null | undefined,
): Promise<RevocationsResponseBody> {
  if (kv === null || kv === undefined) {
    return { ok: false, error: "not_configured" };
  }
  const raw = await kv.get(REVOKE_LIST_KV_KEY);
  if (raw === null) {
    return { ok: true, list: {} };
  }
  try {
    return { ok: true, list: JSON.parse(raw) as unknown };
  } catch {
    console.warn("[revocations] KV revoke:list 非合法 JSON，视同无记录");
    return { ok: true, list: {} };
  }
}
