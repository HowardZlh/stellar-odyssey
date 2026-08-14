/**
 * 退款巡检纯逻辑（A6-2，REQUIREMENTS_UNLOCK.md §A6 / §0.15 契约）：
 * scheduled cron（每 3 小时）与管理台手动巡检共用——分页拉取爱发电
 * 订单（最新在前）→ 回看窗口按订单号内嵌日期截断（stock_analysis
 * `order_date` 先例）→ `status != 2` 且 KV 存在 `order:<单号>` 兑换记录
 * → 登记疑似退款单（KV `refund:suspects`，按 orderId 去重幂等）。
 *
 * 安全模式 A（裁决 ⑧）：默认只**检测 + 登记**，人工核实后在管理台一键
 * 吊销；`REFUND_AUTO_REVOKE`（vars，默认空 = 关）置 "1" 后命中即写
 * `revoke:list`（从 order 记录取 token → sha256 哈希）——**检测口径
 * 未经真实退款单校准前禁开**（stock_analysis "status != 2 待实测"
 * 登记继承）。
 *
 * 免费额度防御（§0.16，10000 贡献者规模复核）：
 * - 页数 ≤ REFUND_SYNC_MAX_PAGES（20）/次（子请求 50/invocation 限额留余量）；
 * - KV 读：suspects/revoke 名单各 1 + 仅疑似单的 order 键（正常日 0）；
 * - KV 写：suspects（有新增才写）+ cursor（恒 1 写）≤2/次（模式 A），
 *   8 次/天 ≤16 写（1000/天限额 1.6%）——测试断言锁定。
 */
import {
  sanitizeRevocationList,
  unlockTokenHash,
  type RevocationEntry,
} from "../../../src/utils/revocationList";
import {
  buildAfdianQueryOrderPageRequest,
  parseAfdianQueryOrderPageResponse,
  type AfdianPagedOrder,
} from "./afdian";
import { parseOrderEpochSec } from "./orderTime";
import { REVOKE_LIST_KV_KEY } from "./revocations";
import type { FetchLike, UnlockKvLike } from "./redeem";

/** KV 键：疑似退款单名单（§0.15 冻结 schema） */
export const REFUND_SUSPECTS_KV_KEY = "refund:suspects";

/** KV 键：巡检统计 cursor（§0.15 冻结 schema） */
export const REVOKE_CURSOR_KV_KEY = "revoke:cursor";

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

/** 疑似退款单名单（KV `refund:suspects` 单键 JSON） */
export interface RefundSuspectsV1 {
  readonly v: 1;
  readonly orders: readonly RefundSuspect[];
}

/** 巡检统计（KV `revoke:cursor`，§0.15 冻结 schema） */
export interface RefundSyncCursor {
  readonly lastRun: string;
  readonly scanned: number;
  readonly suspects: number;
  readonly by: "cron" | "admin";
}

/** 巡检注入依赖（scheduled 壳 / 管理台本地直跑共用） */
export interface RefundSyncDeps {
  readonly kv: UnlockKvLike | null;
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
  /** 本次 KV 写次数（额度断言：模式 A ≤2） */
  readonly kvWrites: number;
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

/** KV `order:<单号>` 记录中的 token/exp 提取（自动吊销分支消费，防御式） */
function parseOrderRecord(raw: string): { token: string; exp: number } | null {
  try {
    const rec = JSON.parse(raw) as Record<string, unknown>;
    if (typeof rec.token !== "string" || rec.token === "") return null;
    const exp = typeof rec.exp === "number" && Number.isFinite(rec.exp) ? rec.exp : null;
    if (exp === null) return null;
    return { token: rec.token, exp };
  } catch {
    return null;
  }
}

/**
 * 巡检主流程（纯逻辑，jest mock fetch/KV 直测）。
 *
 * 分页终止条件（任一满足即停）：① 页内出现回看窗口外订单（订单号内嵌
 * 日期 < cutoff——最新在前，后续页更旧）；② 空页；③ 上游错误（已收
 * 集的候选照常登记，登记口径：部分扫描仍写 cursor）；④ 页数达上限 20。
 */
export async function runRefundSync(deps: RefundSyncDeps): Promise<RefundSyncResult> {
  const { kv, secrets } = deps;
  if (kv === null || !secrets.afdianUserId || !secrets.afdianToken) {
    return { ok: false, error: "not_configured", scanned: 0, newSuspects: 0, kvWrites: 0 };
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

  // 2) 候选过滤：KV 存在 order:<单号> 兑换记录才登记（仅疑似单读 KV，
  //    正常日零读——§0.16 额度口径）
  const existing = sanitizeRefundSuspects(
    await readJsonKey(kv, REFUND_SUSPECTS_KV_KEY),
  );
  const known = new Set(existing.orders.map((o) => o.orderId));
  const nowIso = new Date(deps.nowSec * 1000).toISOString();
  const newSuspects: RefundSuspect[] = [];
  const redeemedRecords = new Map<string, string>();
  for (const cand of candidates) {
    if (known.has(cand.orderId)) continue; // 已登记：幂等跳过
    const record = await kv.get(`order:${cand.orderId}`);
    if (record === null) continue; // 未兑换过：退款安全，无需登记
    known.add(cand.orderId);
    redeemedRecords.set(cand.orderId, record);
    newSuspects.push({
      orderId: cand.orderId,
      detectedAt: nowIso,
      status: cand.status,
    });
  }

  // 3) KV 写（额度断言口径：模式 A ≤2 写/次）
  let kvWrites = 0;
  if (newSuspects.length > 0) {
    const merged: RefundSuspectsV1 = {
      v: 1,
      orders: [...existing.orders, ...newSuspects],
    };
    await kv.put(REFUND_SUSPECTS_KV_KEY, JSON.stringify(merged));
    kvWrites += 1;

    // 自动吊销（REFUND_AUTO_REVOKE="1"，模式 A 默认关——校准前禁开）
    if (deps.autoRevoke) {
      const list = sanitizeRevocationList(
        await readJsonKey(kv, REVOKE_LIST_KV_KEY),
      );
      const seen = new Set(list.entries.map((e) => e.h));
      const added: RevocationEntry[] = [];
      for (const suspect of newSuspects) {
        const record = parseOrderRecord(redeemedRecords.get(suspect.orderId) ?? "");
        if (record === null) continue; // 记录形状异常：留给人工核实（登记）
        const h = unlockTokenHash(record.token);
        if (seen.has(h)) continue;
        seen.add(h);
        added.push({ h, exp: record.exp, at: nowIso, reason: "refund" });
      }
      if (added.length > 0) {
        await kv.put(
          REVOKE_LIST_KV_KEY,
          JSON.stringify({ v: 1, entries: [...list.entries, ...added] }),
        );
        kvWrites += 1;
      }
    }
  }

  const cursor: RefundSyncCursor = {
    lastRun: nowIso,
    scanned,
    suspects: existing.orders.length + newSuspects.length,
    by: deps.by,
  };
  await kv.put(REVOKE_CURSOR_KV_KEY, JSON.stringify(cursor));
  kvWrites += 1;

  return {
    ok: !upstreamError,
    ...(upstreamError ? { error: "upstream_error" as const } : {}),
    scanned,
    newSuspects: newSuspects.length,
    kvWrites,
  };
}

/** KV JSON 键读取（无记录/非法 JSON → null，交消毒函数回退空名单） */
async function readJsonKey(kv: UnlockKvLike, key: string): Promise<unknown> {
  const raw = await kv.get(key);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}
