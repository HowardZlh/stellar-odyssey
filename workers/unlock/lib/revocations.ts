/**
 * GET /api/revocations 纯逻辑（REQUIREMENTS_UNLOCK.md §A6-2 + §0.15 契约；
 * Z 迭代 M1：存储层 KV `revoke:list` 单键 JSON → D1 revocations 表逐条成行，
 * 对外响应契约不变——仍返回 `{ ok, list: { v: 1, entries: [...] } }`，
 * 条目字段序 h/exp/at/reason 与 KV 时代 sanitize 输出一致，前端零改动）。
 *
 * 不消毒纪律沿用：消毒单点在 `src/utils/revocationList.ts`（前端/管理台/
 * Worker 测试三端共享，防逻辑漂移）；本模块只做行 → 契约条目的形状映射。
 * 只增不删纪律（§7-6）：解除吊销 = restored 翻转（管理台执行），本查询
 * 恒过滤 restored=0。零 DB 写、无请求体解析（防额度攻击，§0.16 复核）。
 */
import type { UnlockDbLike } from "./db";

/** 响应契约（HTTP 恒 200，体内报错——gate-config 惯例） */
export type RevocationsResponseBody =
  | { readonly ok: true; readonly list: unknown }
  | { readonly ok: false; readonly error: "not_configured" };

/**
 * DB 未绑定 → not_configured；查询异常 → 视同空名单 + console.warn
 * （KV 时代"非法 JSON 视同无记录"同口径的防御降级）；
 * 正常 → `{ v: 1, entries: [...] }`（restored=0，按吊销时刻升序 =
 * KV 时代 append 顺序）。
 */
export async function handleRevocations(
  db: UnlockDbLike | null | undefined,
): Promise<RevocationsResponseBody> {
  if (db === null || db === undefined) {
    return { ok: false, error: "not_configured" };
  }
  try {
    const { results } = await db
      .prepare(
        "SELECT token_hash, exp, revoked_at, reason FROM revocations WHERE restored = ? ORDER BY revoked_at",
      )
      .bind(0)
      .all();
    const entries = results.map((row) => ({
      h: row.token_hash,
      exp: row.exp,
      at: row.revoked_at,
      // reason 可 NULL（§0.15 条目 reason 可选）：NULL 略去字段，与
      // sanitizeRevocationList 输出形状一致
      ...(typeof row.reason === "string" ? { reason: row.reason } : {}),
    }));
    return { ok: true, list: { v: 1, entries } };
  } catch {
    console.warn("[revocations] D1 revocations 查询异常，视同空名单");
    return { ok: true, list: { v: 1, entries: [] } };
  }
}
