/**
 * D1 结构化最小接口与 kv_state 读写助手（Z 迭代 M1，
 * REQUIREMENTS_ALIPAY_UNLOCK.md §4；范式对照 stock_analysis 6d147cd）。
 *
 * 生产 = CF D1Database 绑定（wrangler.toml `UNLOCK_DB`），测试 =
 * `__tests__/helpers/fakeD1.ts` 内存替身，管理台 = D1 REST API 适配器
 * （docs/internal/unlock-admin/server.mjs）——三端共用本接口面。
 *
 * 纪律：SQL 一律参数绑定（fakeD1 强制拒绝字面量条件，防注入 + 防测试
 * 替身与生产行为漂移）；单键 JSON 状态（refund:suspects / revoke:cursor /
 * gate:config）统一走 kv_state 表，键名与 KV 时代一致（§0.15 契约零漂移）。
 */

/** D1 run()/batch() 结果最小面（meta.changes 供 UPDATE 命中数断言） */
export interface UnlockDbRunResult {
  readonly success: boolean;
  readonly meta?: { readonly changes?: number };
}

/** D1 预编译语句最小面（生产 = D1PreparedStatement） */
export interface UnlockDbStatement {
  bind(...params: readonly unknown[]): UnlockDbStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ readonly results: readonly T[] }>;
  run(): Promise<UnlockDbRunResult>;
}

/** D1 数据库最小面（生产 = CF D1Database，测试 = FakeD1） */
export interface UnlockDbLike {
  prepare(sql: string): UnlockDbStatement;
  batch(statements: readonly UnlockDbStatement[]): Promise<readonly UnlockDbRunResult[]>;
}

/** kv_state 键：门控远程配置（原 KV `gate:config`，§0.11 契约） */
export const GATE_CONFIG_STATE_KEY = "gate:config";

/** kv_state 键：疑似退款单名单（原 KV `refund:suspects`，§0.15 契约） */
export const REFUND_SUSPECTS_STATE_KEY = "refund:suspects";

/** kv_state 键：巡检统计 cursor（原 KV `revoke:cursor`，§0.15 契约） */
export const REVOKE_CURSOR_STATE_KEY = "revoke:cursor";

/**
 * kv_state 键：支付宝退款兜底扫描滚动游标（Z 迭代 M4 新增，无 KV 前身）。
 * 值形态 `{"last": "<paid_at ISO 或空串>"}`——每轮按 paid_at 升序推进，
 * 扫完窗口归零重扫；**仅值变化才写**（零变化零写入纪律，对账 §M4）。
 */
export const ALIPAY_REFUND_CURSOR_STATE_KEY = "alipay:refund-cursor";

/**
 * kv_state 键：面包多退款巡检滚动游标（面包多集成，形态与支付宝游标
 * 同构 `{"last": "<paid_at ISO 或空串>"}`；仅值变化才写）。
 */
export const MBD_REFUND_CURSOR_STATE_KEY = "mbd:refund-cursor";

/**
 * kv_state 键：运营日报发送状态（自动运营第1步，无 KV 前身）。
 * 值形态 `{"lastDate": "YYYY-MM-DD"}`（UTC 日期）——每 UTC 日首轮
 * cron 经 `claimState` 抢占推进后发送日报，同日后续轮次（含平台重复
 * 投递的同槽调用）抢不到即跳过；发送失败 `releaseState` 回滚（下一轮重试）。
 */
export const OPS_REPORT_STATE_KEY = "ops:report";

/**
 * kv_state 键：运营告警去重状态（自动运营第1步，无 KV 前身）。
 * 值形态 `{"sig": "<告警行拼接>", "date": "YYYY-MM-DD"}`——同日同内容
 * 告警只发一封（上游持续异常时 3 小时轮次不刷屏，次日重提醒）。
 */
export const OPS_ALERT_STATE_KEY = "ops:alert";

/** kv_state 读（无记录 → null；与 KV get 语义对齐） */
export async function getStateRaw(
  db: UnlockDbLike,
  key: string,
): Promise<string | null> {
  const row = await db
    .prepare("SELECT v FROM kv_state WHERE k = ?")
    .bind(key)
    .first<{ v: unknown }>();
  if (row === null || typeof row.v !== "string") return null;
  return row.v;
}

/** kv_state 写（INSERT OR REPLACE 幂等整写；与 KV put 语义对齐） */
export async function putStateRaw(
  db: UnlockDbLike,
  key: string,
  value: string,
  nowIso: string,
): Promise<void> {
  await db
    .prepare("INSERT OR REPLACE INTO kv_state (k, v, updated_at) VALUES (?, ?, ?)")
    .bind(key, value, nowIso)
    .run();
}

/** 单条件写命中判定（D1 meta.changes；FakeD1 同形） */
function hitOnce(result: UnlockDbRunResult): boolean {
  return result.success && (result.meta?.changes ?? 0) === 1;
}

/**
 * kv_state 抢占式写（at-least-once 幂等原语）：仅当当前值 **不等于**
 * `value` 时把该键写成 `value`，返回是否由本次调用完成写入。
 *
 * 语义 = "谁先把状态推进到目标值，谁负责做副作用"——同一 cron 被平台
 * 重复投递（2026-09-17 起 Cloudflare 账户级双触发实证：同槽两条
 * scheduledDatetime 相差 3s）时，两次调用只有一次拿到 `true`，另一次
 * 读到"已是目标值"直接跳过。之前的 "读 → 发 → 写" 三步在两次调用
 * 间隔 < 对账耗时时会各发一封（2026-09-19 日报双发事故根因）。
 *
 * 原子性依赖单条 SQL：已有行走条件 UPDATE（`v <> ?`），无行走裸 INSERT
 * （主键冲突 = 他人已抢到 → false）；两条语句均由 D1 串行化执行。
 * 调用方副作用失败时用 `releaseState` 回滚，保留"失败顺延重试"语义。
 */
export async function claimState(
  db: UnlockDbLike,
  key: string,
  value: string,
  nowIso: string,
): Promise<boolean> {
  const updated = await db
    .prepare("UPDATE kv_state SET v = ?, updated_at = ? WHERE k = ? AND v <> ?")
    .bind(value, nowIso, key, value)
    .run();
  if (hitOnce(updated)) return true;
  try {
    const inserted = await db
      .prepare("INSERT INTO kv_state (k, v, updated_at) VALUES (?, ?, ?)")
      .bind(key, value, nowIso)
      .run();
    return hitOnce(inserted);
  } catch (e) {
    // 主键冲突 = 行已存在且值等于 value（UPDATE 未命中的唯一另一种情形）
    if (/UNIQUE|constraint/i.test(String(e))) return false;
    throw e;
  }
}

/**
 * kv_state 抢占回滚：仅当该键仍为 `claimed`（本次抢到的值）时恢复为
 * `previous`（抢占前原值；null = 原本无行 → 删除）。条件写保证不会覆盖
 * 期间由他人推进的新值。
 */
export async function releaseState(
  db: UnlockDbLike,
  key: string,
  claimed: string,
  previous: string | null,
  nowIso: string,
): Promise<void> {
  if (previous === null) {
    await db
      .prepare("DELETE FROM kv_state WHERE k = ? AND v = ?")
      .bind(key, claimed)
      .run();
    return;
  }
  await db
    .prepare("UPDATE kv_state SET v = ?, updated_at = ? WHERE k = ? AND v = ?")
    .bind(previous, nowIso, key, claimed)
    .run();
}

/** kv_state JSON 读（无记录/非法 JSON → null，交消毒函数回退空名单） */
export async function getStateJson(
  db: UnlockDbLike,
  key: string,
): Promise<unknown> {
  const raw = await getStateRaw(db, key);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}
