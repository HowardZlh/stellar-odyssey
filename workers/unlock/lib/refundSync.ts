/**
 * 退款巡检纯逻辑（A6-2，REQUIREMENTS_UNLOCK.md §A6 / §0.15 契约；
 * Z 迭代 M1：存储层 KV → D1——疑似名单与 cursor 走 kv_state 行（键名
 * 不变），兑换记录查 orders 表，自动吊销写 revocations 表）：
 * scheduled cron（每 3 小时）与管理台手动巡检共用——分页拉取爱发电
 * 订单（最新在前）→ 回看窗口按订单号内嵌日期截断（stock_analysis
 * `order_date` 先例）→ `status != 2` 且 orders 表存在兑换记录
 * → 登记疑似退款单（kv_state `refund:suspects`，按 orderId 去重幂等）。
 *
 * 安全模式 A（裁决 ⑧）：默认只**检测 + 登记**，人工核实后在管理台一键
 * 吊销；`REFUND_AUTO_REVOKE`（vars，默认空 = 关）置 "1" 后命中即写
 * revocations 表（从 orders 行取 token → sha256 哈希）——**检测口径
 * 未经真实退款单校准前禁开**（stock_analysis "status != 2 待实测"
 * 登记继承）。
 *
 * 免费额度防御（§0.16 纪律沿用；D1 写限额 10 万行/天，较 KV 1000 写/天
 * 宽松两个量级，写次数断言继续锁定防漂移）：
 * - 页数 ≤ REFUND_SYNC_MAX_PAGES（20）/次（子请求 50/invocation 限额留余量）；
 * - DB 读：suspects 1 + 仅疑似单的 orders 行（正常日 0）+ 自动吊销分支
 *   的去重查询；
 * - DB 写：suspects（有新增才写）+ cursor（恒 1 写）≤2 行/次（模式 A），
 *   8 次/天 ≤16 行写——测试断言锁定。
 */
import {
  unlockTokenHash,
} from "../../../src/utils/revocationList";
import {
  buildAfdianQueryOrderPageRequest,
  parseAfdianQueryOrderPageResponse,
  type AfdianPagedOrder,
} from "./afdian";
import {
  getStateJson,
  putStateRaw,
  REFUND_SUSPECTS_STATE_KEY,
  REVOKE_CURSOR_STATE_KEY,
  type UnlockDbLike,
  type UnlockDbStatement,
} from "./db";
import { parseOrderEpochSec } from "./orderTime";
import type { FetchLike } from "./redeem";

/** 单次巡检分页上限（Workers Free 子请求 50/invocation，留余量登记） */
export const REFUND_SYNC_MAX_PAGES = 20;

/** 回看窗口默认天数（vars `REFUND_LOOKBACK_DAYS` 缺省值） */
export const REFUND_LOOKBACK_DAYS_DEFAULT = 15;

/** 疑似退款单条目（§0.15 冻结 schema） */
export interface RefundSuspect {
  readonly orderId: string;
  readonly detectedAt: string;
  readonly status: number;
  readonly note?: string;
}

/** 疑似退款单名单（kv_state `refund:suspects` 单键 JSON） */
export interface RefundSuspectsV1 {
  readonly v: 1;
  readonly orders: readonly RefundSuspect[];
}

/** 巡检统计（kv_state `revoke:cursor`，§0.15 冻结 schema） */
export interface RefundSyncCursor {
  readonly lastRun: string;
  readonly scanned: number;
  readonly suspects: number;
  readonly by: "cron" | "admin";
}

/** 巡检注入依赖（scheduled 壳 / 管理台本地直跑共用） */
export interface RefundSyncDeps {
  readonly db: UnlockDbLike | null;
  readonly fetchFn: FetchLike;
  readonly secrets: { readonly afdianUserId?: string; readonly afdianToken?: string };
  readonly nowSec: number;
  /** 回看窗口天数（≤0/非有限回退默认 15） */
  readonly lookbackDays: number;
  /** 自动吊销开关（模式 A 默认 false，校准前禁开——裁决 ⑧） */
  readonly autoRevoke: boolean;
  readonly by: "cron" | "admin";
}

/** 巡检结果（管理台手动巡检展示 + 测试断言） */
export interface RefundSyncResult {
  readonly ok: boolean;
  readonly error?: "not_configured" | "upstream_error";
  /** 回看窗口内检查过的订单数 */
  readonly scanned: number;
  /** 本次新登记的疑似单数 */
  readonly newSuspects: number;
  /** 本次 DB 写行数（额度断言：模式 A ≤2） */
  readonly dbWrites: number;
}

/** 疑似名单消毒（防御式：形状不符 → 空名单；条目非法丢弃该条） */
export function sanitizeRefundSuspects(raw: unknown): RefundSuspectsV1 {
  if (
    typeof raw !== "object" ||
    raw === null ||
    Array.isArray(raw) ||
    (raw as Record<string, unknown>).v !== 1 ||
    !Array.isArray((raw as Record<string, unknown>).orders)
  ) {
    return { v: 1, orders: [] };
  }
  const orders: RefundSuspect[] = [];
  const seen = new Set<string>();
  for (const item of (raw as { orders: unknown[] }).orders) {
    if (typeof item !== "object" || item === null) continue;
    const o = item as Record<string, unknown>;
    if (typeof o.orderId !== "string" || o.orderId === "") continue;
    if (typeof o.detectedAt !== "string") continue;
    if (typeof o.status !== "number" || !Number.isFinite(o.status)) continue;
    if (seen.has(o.orderId)) continue;
    seen.add(o.orderId);
    orders.push({
      orderId: o.orderId,
      detectedAt: o.detectedAt,
      status: o.status,
      ...(typeof o.note === "string" ? { note: o.note } : {}),
    });
  }
  return { v: 1, orders };
}

/** orders 行中的 token/exp 提取（自动吊销分支消费，防御式） */
function parseOrderRow(
  row: Record<string, unknown>,
): { token: string; exp: number } | null {
  const { token, expires_at: exp } = row;
  if (typeof token !== "string" || token === "") return null;
  if (typeof exp !== "number" || !Number.isFinite(exp)) return null;
  return { token, exp };
}

/**
 * 巡检主流程（纯逻辑，jest mock fetch/DB 直测）。
 *
 * 分页终止条件（任一满足即停）：① 页内出现回看窗口外订单（订单号内嵌
 * 日期 < cutoff——最新在前，后续页更旧）；② 空页；③ 上游错误（已收
 * 集的候选照常登记，登记口径：部分扫描仍写 cursor）；④ 页数达上限 20。
 */
export async function runRefundSync(deps: RefundSyncDeps): Promise<RefundSyncResult> {
  const { db, secrets } = deps;
  if (db === null || !secrets.afdianUserId || !secrets.afdianToken) {
    return { ok: false, error: "not_configured", scanned: 0, newSuspects: 0, dbWrites: 0 };
  }
  const lookbackDays =
    Number.isFinite(deps.lookbackDays) && deps.lookbackDays > 0
      ? deps.lookbackDays
      : REFUND_LOOKBACK_DAYS_DEFAULT;
  const cutoffSec = deps.nowSec - lookbackDays * 86_400;

  // 1) 分页拉单（最新在前），回看窗口内收集 status != 2 的候选
  let scanned = 0;
  let upstreamError = false;
  const candidates: AfdianPagedOrder[] = [];
  pages: for (let page = 1; page <= REFUND_SYNC_MAX_PAGES; page++) {
    const req = buildAfdianQueryOrderPageRequest(
      secrets.afdianUserId,
      secrets.afdianToken,
      page,
      deps.nowSec,
    );
    let parsed: ReturnType<typeof parseAfdianQueryOrderPageResponse>;
    try {
      const resp = await deps.fetchFn(req.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: req.body,
      });
      parsed = resp.ok
        ? parseAfdianQueryOrderPageResponse(await resp.json())
        : { kind: "upstream_error" };
    } catch {
      parsed = { kind: "upstream_error" };
    }
    if (parsed.kind === "upstream_error") {
      upstreamError = true;
      break;
    }
    if (parsed.orders.length === 0) break; // 空页 = 拉完
    for (const order of parsed.orders) {
      const orderSec = parseOrderEpochSec(order.orderId);
      // 日期不可解析的订单号跳过（防御，不计 scanned）
      if (orderSec === null) continue;
      if (orderSec < cutoffSec) break pages; // 窗口外（更旧）→ 终止分页
      scanned += 1;
      if (order.status !== 2) candidates.push(order);
    }
  }

  // 2) 候选过滤：orders 表存在兑换记录才登记（仅疑似单查 orders 行，
  //    正常日零读——§0.16 额度口径沿用）
  const existing = sanitizeRefundSuspects(
    await getStateJson(db, REFUND_SUSPECTS_STATE_KEY),
  );
  const known = new Set(existing.orders.map((o) => o.orderId));
  const nowIso = new Date(deps.nowSec * 1000).toISOString();
  const newSuspects: RefundSuspect[] = [];
  // 形状合法的兑换记录（自动吊销分支消费；异常行不入 map = 留人工核实）
  const redeemedRecords = new Map<string, { token: string; exp: number }>();
  for (const cand of candidates) {
    if (known.has(cand.orderId)) continue; // 已登记：幂等跳过
    const row = await db
      .prepare("SELECT token, expires_at FROM orders WHERE ext_order_no = ?")
      .bind(cand.orderId)
      .first();
    if (row === null) continue; // 未兑换过：退款安全，无需登记
    known.add(cand.orderId);
    const record = parseOrderRow(row);
    if (record !== null) redeemedRecords.set(cand.orderId, record);
    newSuspects.push({
      orderId: cand.orderId,
      detectedAt: nowIso,
      status: cand.status,
    });
  }

  // 3) DB 写（额度断言口径：模式 A ≤2 行写/次）
  let dbWrites = 0;
  if (newSuspects.length > 0) {
    const merged: RefundSuspectsV1 = {
      v: 1,
      orders: [...existing.orders, ...newSuspects],
    };
    await putStateRaw(db, REFUND_SUSPECTS_STATE_KEY, JSON.stringify(merged), nowIso);
    dbWrites += 1;

    // 自动吊销（REFUND_AUTO_REVOKE="1"，模式 A 默认关——校准前禁开）：
    // token 哈希逐条 INSERT revocations（token_hash PK 天然去重；
    // batch 原子提交，任一失败整体回滚——只增不删纪律 §7-6）
    if (deps.autoRevoke) {
      const inserts: UnlockDbStatement[] = [];
      const seen = new Set<string>();
      for (const suspect of newSuspects) {
        const record = redeemedRecords.get(suspect.orderId);
        if (!record) continue; // 记录形状异常：留给人工核实（登记）
        const h = unlockTokenHash(record.token);
        if (seen.has(h)) continue;
        seen.add(h);
        const dup = await db
          .prepare("SELECT token_hash FROM revocations WHERE token_hash = ?")
          .bind(h)
          .first();
        if (dup !== null) continue; // 已在名单（含 restored 行）：不重写
        inserts.push(
          db
            .prepare(
              "INSERT INTO revocations (token_hash, exp, reason, revoked_at, restored) VALUES (?, ?, ?, ?, ?)",
            )
            .bind(h, record.exp, "refund", nowIso, 0),
        );
      }
      if (inserts.length > 0) {
        await db.batch(inserts);
        dbWrites += inserts.length;
      }
    }
  }

  const cursor: RefundSyncCursor = {
    lastRun: nowIso,
    scanned,
    suspects: existing.orders.length + newSuspects.length,
    by: deps.by,
  };
  await putStateRaw(db, REVOKE_CURSOR_STATE_KEY, JSON.stringify(cursor), nowIso);
  dbWrites += 1;

  return {
    ok: !upstreamError,
    ...(upstreamError ? { error: "upstream_error" as const } : {}),
    scanned,
    newSuspects: newSuspects.length,
    dbWrites,
  };
}
