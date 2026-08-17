/**
 * GET /api/gate-config 纯逻辑（REQUIREMENTS_UNLOCK.md §A2-1 + §0.11 契约；
 * Z 迭代 M1：存储层 KV `gate:config` → D1 kv_state 行，响应契约不变）：
 * kv_state 读 `gate:config` 原样透传——**不消毒**（消毒单点在
 * `src/utils/remoteGateConfig.ts`，前端/管理台两端共享，防逻辑漂移）。
 * 零 DB 写、无请求体解析（防额度攻击，§A2 复核）。
 */
import { GATE_CONFIG_STATE_KEY, getStateRaw, type UnlockDbLike } from "./db";

/** 响应契约（HTTP 恒 200，体内报错——redeem 惯例） */
export type GateConfigResponseBody =
  | { readonly ok: true; readonly config: unknown }
  | { readonly ok: false; readonly error: "not_configured" };

/**
 * DB 未绑定 → not_configured；无记录 → `config: {}`；
 * 合法 JSON → 原样透传；非法 JSON → 视同无记录 + console.warn。
 */
export async function handleGateConfig(
  db: UnlockDbLike | null | undefined,
): Promise<GateConfigResponseBody> {
  if (db === null || db === undefined) {
    return { ok: false, error: "not_configured" };
  }
  const raw = await getStateRaw(db, GATE_CONFIG_STATE_KEY);
  if (raw === null) {
    return { ok: true, config: {} };
  }
  try {
    return { ok: true, config: JSON.parse(raw) as unknown };
  } catch {
    console.warn("[gate-config] kv_state gate:config 非合法 JSON，视同无记录");
    return { ok: true, config: {} };
  }
}
