/**
 * POST /api/ev 纯逻辑（G 迭代 M4 G8，REQUIREMENTS_GROWTH.md §4）：
 * 匿名漏斗计数按天聚合 UPSERT 到 D1 `funnel_daily` 宽行表
 * （每天 1 行、7 计数列——形态裁决与额度测算见 migrations/0002_funnel.sql）。
 *
 * 防刷与隐私（§4 硬约束）：
 * - 事件键**白名单**（前端 src/utils/funnel.ts 同表，人工同步登记），
 *   未知键静默丢弃；
 * - body 体积上限 + 单键计数上限钳制；日期仅接受服务端 UTC 今日 ±1 天
 *   （时区/跨午夜容差，同时封死垃圾日期行）；
 * - **不落任何用户标识、不落 IP、不设 Cookie**；零 KV 访问；
 * - 每请求恰 1 条语句 = 1 行写（原子 ON CONFLICT 累加，无读改写竞态）。
 */
import type { UnlockDbLike } from "./db";

/** 事件键白名单（初版 7 键；`share_click` 为 2026-08-31 追加裁决） */
export const FUNNEL_EVENTS = [
  "lock_shown",
  "lock_cta",
  "unlock_view",
  "tier_cta",
  "pay_open",
  "redeem_submit",
  "share_click",
] as const;

export type FunnelEventKey = (typeof FUNNEL_EVENTS)[number];

/** 单键单请求计数上限（前端同数值；超出钳制不拒绝） */
export const FUNNEL_COUNT_CAP = 200;

/** body 体积上限（合法载荷 <200 字符，1 KiB 已含充分余量） */
export const FUNNEL_BODY_MAX_CHARS = 1_024;

/** 日期容差（服务端 UTC 今日 ±1 天；超窗拒绝） */
const FUNNEL_DATE_TOLERANCE_DAYS = 1;

/** 响应契约（非法 body 走 400——beacon 无消费方，状态码仅供观测） */
export interface FunnelResponse {
  readonly status: 200 | 400;
  readonly body:
    | { readonly ok: true }
    | { readonly ok: false; readonly error: "invalid_body" | "not_configured" };
}

/** UTC 日期串 */
function utcDateOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** 日期校验：形如 YYYY-MM-DD 且落在服务端 UTC 今日 ±1 天窗口内 */
export function isAcceptableFunnelDate(d: unknown, nowMs: number): d is string {
  if (typeof d !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  const parsed = Date.parse(`${d}T00:00:00Z`);
  if (Number.isNaN(parsed)) return false;
  // 解析回读一致性（拒绝 2026-02-31 之类进位日期）
  if (utcDateOf(parsed) !== d) return false;
  const dayMs = 86_400_000;
  return Math.abs(parsed - Date.parse(`${utcDateOf(nowMs)}T00:00:00Z`)) <=
    FUNNEL_DATE_TOLERANCE_DAYS * dayMs;
}

/**
 * 事件计数消毒：白名单外键丢弃、非正整数丢弃、超上限钳制。
 * 非对象输入返回 null（区别于"合法但全被丢弃"的空表）。
 */
export function sanitizeFunnelEvents(
  raw: unknown,
): Partial<Record<FunnelEventKey, number>> | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const out: Partial<Record<FunnelEventKey, number>> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!(FUNNEL_EVENTS as readonly string[]).includes(key)) continue;
    if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
      continue;
    }
    out[key as FunnelEventKey] = Math.min(value, FUNNEL_COUNT_CAP);
  }
  return out;
}

/** 宽行 UPSERT（每天 1 行；缺席键补 0，冲突时逐列原子累加） */
const UPSERT_SQL =
  "INSERT INTO funnel_daily (d, lock_shown, lock_cta, unlock_view, tier_cta, pay_open, redeem_submit, share_click) " +
  "VALUES (?, ?, ?, ?, ?, ?, ?, ?) " +
  "ON CONFLICT(d) DO UPDATE SET " +
  "lock_shown = lock_shown + excluded.lock_shown, " +
  "lock_cta = lock_cta + excluded.lock_cta, " +
  "unlock_view = unlock_view + excluded.unlock_view, " +
  "tier_cta = tier_cta + excluded.tier_cta, " +
  "pay_open = pay_open + excluded.pay_open, " +
  "redeem_submit = redeem_submit + excluded.redeem_submit, " +
  "share_click = share_click + excluded.share_click";

/**
 * POST /api/ev 处理：文本 body → 校验 → 单语句按天聚合 UPSERT。
 * 合法 body 但事件全被白名单过滤 → 200 零写入（垃圾键不产生 DB 消耗）。
 */
export async function handleFunnelEvent(
  rawText: string,
  db: UnlockDbLike | null,
  nowMs: number,
): Promise<FunnelResponse> {
  if (rawText.length === 0 || rawText.length > FUNNEL_BODY_MAX_CHARS) {
    return { status: 400, body: { ok: false, error: "invalid_body" } };
  }
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(rawText) as unknown;
  } catch {
    return { status: 400, body: { ok: false, error: "invalid_body" } };
  }
  if (typeof parsed !== "object" || parsed === null) {
    return { status: 400, body: { ok: false, error: "invalid_body" } };
  }
  const { d, e } = parsed as { d?: unknown; e?: unknown };
  if (!isAcceptableFunnelDate(d, nowMs)) {
    return { status: 400, body: { ok: false, error: "invalid_body" } };
  }
  const events = sanitizeFunnelEvents(e);
  if (events === null) {
    return { status: 400, body: { ok: false, error: "invalid_body" } };
  }
  if (Object.keys(events).length === 0) {
    return { status: 200, body: { ok: true } }; // 全被过滤：零写入
  }
  if (db === null) {
    return { status: 200, body: { ok: false, error: "not_configured" } };
  }
  await db
    .prepare(UPSERT_SQL)
    .bind(d, ...FUNNEL_EVENTS.map((key) => events[key] ?? 0))
    .run();
  return { status: 200, body: { ok: true } };
}
