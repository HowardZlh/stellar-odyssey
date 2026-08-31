/**
 * 统一对账纯逻辑（A6-2 爱发电退款巡检 + Z 迭代 M4 支付宝对账，
 * REQUIREMENTS_UNLOCK.md §A6 / §0.15 契约 + REQUIREMENTS_ALIPAY_UNLOCK.md
 * §1-D8 / §2 / §3 末段 / D-z6；支付宝段自 stock_analysis
 * `workers/refund-sync/worker.js`（提交 a30b90e，已真机验收）平移——
 * fastpay.refund.query 字段已经官方 SDK 源码核对，直接采信）。
 *
 * 【爱发电巡检（runRefundSync，M4 保留不动）】scheduled cron（每 3 小时）
 * 与管理台手动巡检共用——分页拉取爱发电订单（最新在前）→ 回看窗口按
 * 订单号内嵌日期截断（stock_analysis `order_date` 先例）→ `status != 2`
 * 且 orders 表存在兑换记录 → 登记疑似退款单（kv_state `refund:suspects`，
 * 按 orderId 去重幂等）。
 * 安全模式 A（裁决 ⑧）：默认只**检测 + 登记**，人工核实后在管理台一键
 * 吊销；`REFUND_AUTO_REVOKE`（vars，默认空 = 关）置 "1" 后命中即写
 * revocations 表（从 orders 行取 token → sha256 哈希）——**检测口径
 * 未经真实退款单校准前禁开**（stock_analysis "status != 2 待实测"
 * 登记继承）。
 *
 * 【支付宝对账（runAlipayReconcile，M4 新增；E4 三层自愈的最后防线）】
 * 与爱发电巡检同一条 cron 顺序执行（D-z6 单 cron，区别于 stock 双 cron
 * ——偏离登记：本项目无解锁日志表无日清任务，免费档 5 排程额度省 1 条）：
 *   1. 超时 pending（>30m，D-z2）→ trade.query 复核：已付 → 金额核验后
 *      走与 notify/status 同一发码函数补发；未付/交易不存在 →
 *      trade.close → 标 closed；
 *   2. 近 N 天 paid → fastpay.refund.query 兜底（捕获绕过管理台的退款，
 *      如商家中心人工退款）：REFUND_SUCCESS → 吊销闭环（revocations
 *      reason='refund' + orders→refunded）；顺带补登贡献者行（M2 登记 7：
 *      发码 UPDATE 与 contributors INSERT 非原子的极端中断兜底）；
 *   3. 吊销登记核对：窗口内 refunded 单如缺 revocations 行（管理台退款
 *      中断等）→ 补登。
 * 硬性纪律：**仅状态变化才写 D1**（无变化一轮零写入，测试断言锁定）；
 * 吊销只增不删（§7-6）；退款仅全额（部分退款留二期）。
 *
 * 免费额度防御（§0.16 纪律沿用；单 cron 合并后子请求预算重算）：
 * - 子请求 ≤ 50/invocation：爱发电分页 ≤20 + 支付宝 pending 复核
 *   ≤8×2（query+close）+ 退款兜底查询 ≤8 + 面包多复查 ≤5 = **≤49**
 *   （偏离登记：stock 双 cron 各 45 上限，本项目单 cron 合并故扫描
 *   上限 15→8，漏扫由下一轮 3h 后补齐）；
 * - 爱发电段 DB 写：suspects（有新增才写）+ cursor（恒 1 写）≤2 行/次
 *   （模式 A），8 次/天 ≤16 行写——测试断言锁定；
 * - 支付宝段 DB 写：全部条件写（补发/关单/吊销/补登/游标值变化），
 *   正常日 0 行。
 */
import {
  unlockTokenHash,
} from "../../../src/utils/revocationList";
import { hexToBytes } from "../../../src/utils/unlockToken";
import {
  buildAfdianQueryOrderPageRequest,
  parseAfdianQueryOrderPageResponse,
  type AfdianPagedOrder,
} from "./afdian";
import { alipayCall } from "./alipay";
import {
  amountMatches,
  issuePaidAlipayOrder,
  parseAlipayOrderRow,
  type AlipayHandlerEnv,
} from "./alipayHandlers";
import {
  ALIPAY_REFUND_CURSOR_STATE_KEY,
  getStateJson,
  getStateRaw,
  MBD_REFUND_CURSOR_STATE_KEY,
  putStateRaw,
  REFUND_SUSPECTS_STATE_KEY,
  REVOKE_CURSOR_STATE_KEY,
  type UnlockDbLike,
  type UnlockDbStatement,
} from "./db";
import {
  buildMbdOrderDetailRequest,
  parseMbdOrderDetailResponse,
} from "./mbd";
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

// ---------------------------------------------------------------------------
// 支付宝对账（M4；stock a30b90e runAlipayReconcile 平移，发码层改
// issuePaidAlipayOrder / 吊销层改 revocations 表）
// ---------------------------------------------------------------------------

/** 超时 pending 判定阈值（D-z2：timeout_express=30m，与 create 同源口径） */
export const ALIPAY_PENDING_TIMEOUT_SEC = 30 * 60;

/** 每轮最多复核的超时 pending 单（偏离 stock 15：单 cron 子请求预算见文件头） */
export const ALIPAY_PENDING_SCAN_LIMIT = 8;

/** 每轮最多兜底退款查询的 paid 单（同上，滚动游标跨轮全覆盖） */
export const ALIPAY_REFUND_SCAN_LIMIT = 8;

/** 吊销登记核对/贡献者补登每轮扫描上限（纯 D1 读，无网关调用） */
export const ALIPAY_REPAIR_SCAN_LIMIT = 20;

/** 退款请求号（幂等键）：与管理台退款同源 `refund-<out_trade_no>`
 * （stock 同口径——fastpay.refund.query 以它定位退款请求） */
export function alipayRefundRequestNo(outTradeNo: string): string {
  return `refund-${outTradeNo}`;
}

/** 支付宝对账注入依赖（scheduled 壳组装；管理台不跑本段） */
export interface AlipayReconcileDeps {
  readonly db: UnlockDbLike | null;
  readonly env: AlipayHandlerEnv;
  /** Ed25519 签发私钥（32 字节 hex；补发分支消费，缺失 = not_configured） */
  readonly ed25519PrivateKeyHex?: string;
  readonly nowSec: number;
  /** 退款兜底回看窗口天数（与爱发电巡检共用 REFUND_LOOKBACK_DAYS） */
  readonly lookbackDays: number;
}

/** 支付宝对账结果（测试断言 + scheduled 日志） */
export interface AlipayReconcileResult {
  readonly ok: boolean;
  readonly error?: "not_configured";
  /** 超时 pending 复核单数 */
  readonly pendingChecked: number;
  /** 已付补发单数 */
  readonly reissued: number;
  /** 关单数 */
  readonly closed: number;
  /** 退款兜底查询单数 */
  readonly refundChecked: number;
  /** 退款吊销闭环单数 */
  readonly revoked: number;
  /** 吊销登记核对补登行数（refunded 单缺 revocations 行） */
  readonly revocationsRepaired: number;
  /** 贡献者补登行数（paid 单缺 contributors 行，M2 登记 7 兜底） */
  readonly contributorsRepaired: number;
  /** 本次 DB 写行数（零变化零写入断言） */
  readonly dbWrites: number;
}

/** 可变统计（内部累加器，返回前冻结为 AlipayReconcileResult） */
interface ReconcileStats {
  pendingChecked: number;
  reissued: number;
  closed: number;
  refundChecked: number;
  revoked: number;
  revocationsRepaired: number;
  contributorsRepaired: number;
  dbWrites: number;
}

/** 关单落库（仅状态变化才写：以 status='pending' 为写入前提，
 * 并发补发后不覆盖——stock markClosed 同口径） */
async function markClosed(db: UnlockDbLike, orderId: string): Promise<number> {
  const r = await db
    .prepare("UPDATE orders SET status = ? WHERE id = ? AND status = ?")
    .bind("closed", orderId, "pending")
    .run();
  return r.meta?.changes ?? 0;
}

/** revocations 补行（token_hash PK 天然幂等：已有行（含 restored）不重写；
 * 返回写入行数）。只增不删纪律 §7-6。 */
async function insertRevocationIfMissing(
  db: UnlockDbLike,
  tokenHash: string,
  exp: number,
  nowIso: string,
): Promise<number> {
  const dup = await db
    .prepare("SELECT token_hash FROM revocations WHERE token_hash = ?")
    .bind(tokenHash)
    .first();
  if (dup !== null) return 0;
  await db
    .prepare(
      "INSERT INTO revocations (token_hash, exp, reason, revoked_at, restored) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(tokenHash, exp, "refund", nowIso, 0)
    .run();
  return 1;
}

/** paid 订单行的吊销素材提取（token_hash 列优先，缺列回退哈希 token；
 * exp 缺失回退 nowSec——名单条目仅供过期清理，宁短勿长） */
function revocationMaterialOf(
  row: Record<string, unknown>,
  nowSec: number,
): { hash: string; exp: number } | null {
  const hash =
    typeof row.token_hash === "string" && row.token_hash !== ""
      ? row.token_hash
      : typeof row.token === "string" && row.token !== ""
        ? unlockTokenHash(row.token)
        : null;
  if (hash === null) return null;
  const exp =
    typeof row.expires_at === "number" && Number.isFinite(row.expires_at)
      ? row.expires_at
      : nowSec;
  return { hash, exp };
}

/**
 * 1) 超时 pending 复核：已付补发 / 未付关单（stock reconcilePending 平移）。
 * 网关/网络异常单留待下一轮重试；金额不符拒绝补发保持 pending 待人工。
 */
async function reconcilePending(
  db: UnlockDbLike,
  deps: AlipayReconcileDeps,
  privateKey: Uint8Array,
  stats: ReconcileStats,
): Promise<void> {
  const cutoffIso = new Date(
    (deps.nowSec - ALIPAY_PENDING_TIMEOUT_SEC) * 1000,
  ).toISOString();
  const { results } = await db
    .prepare(
      `SELECT id, tier, status, token, expires_at, amount_cny, nickname,
         message, ext_order_no
       FROM orders WHERE channel = ? AND status = ? AND created_at < ?
       ORDER BY created_at ASC LIMIT ${ALIPAY_PENDING_SCAN_LIMIT}`,
    )
    .bind("alipay", "pending", cutoffIso)
    .all();

  for (const row of results) {
    const order = parseAlipayOrderRow(row);
    const outTradeNo =
      typeof row.ext_order_no === "string" ? row.ext_order_no : "";
    if (order === null || outTradeNo === "") continue; // 形状异常：留人工
    stats.pendingChecked += 1;

    // trade.query 复核（字段依据 AlipayTradeQueryResponse，stock 已核对）
    const q = await alipayCall(deps.env, "alipay.trade.query", {
      out_trade_no: outTradeNo,
    });
    if (q.ok && q.data) {
      const tradeStatus = String(q.data.trade_status ?? "");
      if (tradeStatus === "TRADE_SUCCESS" || tradeStatus === "TRADE_FINISHED") {
        // 已付 → 与 notify/status 同口径：金额核验后走同一发码函数补发
        if (!amountMatches(q.data.total_amount, order.amountCny)) {
          console.log(`reconcile: 订单 ${outTradeNo} 金额不符, 跳过补发`);
          continue;
        }
        try {
          const issued = await issuePaidAlipayOrder(
            db,
            order,
            String(q.data.trade_no ?? ""),
            privateKey,
            deps.nowSec,
          );
          if (issued.wrote) {
            stats.reissued += 1;
            stats.dbWrites += 2; // orders UPDATE + contributors INSERT
            console.log(`reconcile: 订单 ${outTradeNo} 已付补发 token`); // 不含明文
          }
          // wrote=false：与 notify/status 并发抢占失败，首写已落定零写入
        } catch {
          // 抢占失败且回读异常（存量异常）：留待下一轮/人工
        }
      } else if (
        tradeStatus === "WAIT_BUYER_PAY" ||
        tradeStatus === "TRADE_CLOSED"
      ) {
        // 未付 → 关单（已关闭态无需再调 close）；close 失败不阻塞标记，
        // 支付宝侧 timeout_express=30m 到期自动关闭，状态以本地为准
        if (tradeStatus === "WAIT_BUYER_PAY") {
          await alipayCall(deps.env, "alipay.trade.close", {
            out_trade_no: outTradeNo,
          });
        }
        const changed = await markClosed(db, order.id);
        stats.closed += changed;
        stats.dbWrites += changed;
      }
      // 其余 trade_status：不动，留待下一轮
    } else if (q.data && String(q.data.sub_code ?? "") === "ACQ.TRADE_NOT_EXIST") {
      // 用户从未扫码，交易未创建 → 直接标 closed（无单可关）
      const changed = await markClosed(db, order.id);
      stats.closed += changed;
      stats.dbWrites += changed;
    }
    // 其余网关/网络异常：留待下一轮重试
  }
}

/**
 * 2) 近 N 天 paid → fastpay.refund.query 兜底（stock reconcileRefunds 平移；
 * 入参 out_trade_no + out_request_no（AlipayTradeFastpayRefundQueryModel），
 * 响应 refund_status='REFUND_SUCCESS' 为退款成功，未返回该字段/业务失败
 * （无退款记录）均视为未退款不动）。滚动游标按 paid_at 升序推进、扫完
 * 归零重扫（窗口内订单多于单轮上限时跨轮全覆盖）；**游标仅值变化才写**。
 * 顺带贡献者补登（M2 登记 7：极端中断 = 已发码未上名单）。
 */
async function reconcileRefunds(
  db: UnlockDbLike,
  deps: AlipayReconcileDeps,
  lookbackDays: number,
  nowIso: string,
  stats: ReconcileStats,
): Promise<void> {
  const cutoffIso = new Date(
    (deps.nowSec - lookbackDays * 86_400) * 1000,
  ).toISOString();
  const prevRaw = await getStateRaw(db, ALIPAY_REFUND_CURSOR_STATE_KEY);
  let last = "";
  if (prevRaw !== null) {
    try {
      const parsed = JSON.parse(prevRaw) as Record<string, unknown>;
      if (typeof parsed.last === "string") last = parsed.last;
    } catch {
      /* 非法游标视同从头扫 */
    }
  }
  const { results } = await db
    .prepare(
      `SELECT id, token, token_hash, expires_at, ext_order_no, paid_at,
         contributor_id, nickname, message, amount_cny
       FROM orders WHERE channel = ? AND status = ? AND paid_at >= ? AND paid_at > ?
       ORDER BY paid_at ASC LIMIT ${ALIPAY_REFUND_SCAN_LIMIT}`,
    )
    .bind("alipay", "paid", cutoffIso, last)
    .all();

  for (const row of results) {
    const outTradeNo =
      typeof row.ext_order_no === "string" ? row.ext_order_no : "";
    const orderId = typeof row.id === "string" ? row.id : "";
    if (outTradeNo === "" || orderId === "") continue;
    stats.refundChecked += 1;

    // 贡献者补登（纯 D1 读写，先于退款查询——退款单照样上过名单）
    const contributorId =
      typeof row.contributor_id === "string" && row.contributor_id !== ""
        ? row.contributor_id
        : null;
    if (contributorId !== null) {
      const has = await db
        .prepare("SELECT id FROM contributors WHERE id = ?")
        .bind(contributorId)
        .first();
      if (has === null) {
        await db
          .prepare(
            `INSERT INTO contributors (id, nickname, message, channel, amount_cny, created_at, hidden)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            contributorId,
            typeof row.nickname === "string" ? row.nickname : null,
            typeof row.message === "string" ? row.message : null,
            "alipay",
            typeof row.amount_cny === "number" ? row.amount_cny : null,
            typeof row.paid_at === "string" ? row.paid_at : nowIso,
            0,
          )
          .run();
        stats.contributorsRepaired += 1;
        stats.dbWrites += 1;
      }
    }

    const r = await alipayCall(deps.env, "alipay.trade.fastpay.refund.query", {
      out_trade_no: outTradeNo,
      out_request_no: alipayRefundRequestNo(outTradeNo),
    });
    if (!r.ok || !r.data) continue;
    if (String(r.data.refund_status ?? "") !== "REFUND_SUCCESS") continue;

    // 吊销闭环（D8 口径与管理台退款一致）：revocations 补行（幂等）→
    // orders 条件 UPDATE → refunded（仅状态变化才写）
    const material = revocationMaterialOf(row, deps.nowSec);
    if (material !== null) {
      stats.dbWrites += await insertRevocationIfMissing(
        db,
        material.hash,
        material.exp,
        nowIso,
      );
    }
    const upd = await db
      .prepare(
        "UPDATE orders SET status = ?, refunded_at = ? WHERE id = ? AND status = ?",
      )
      .bind("refunded", nowIso, orderId, "paid")
      .run();
    const changed = upd.meta?.changes ?? 0;
    stats.revoked += changed;
    stats.dbWrites += changed;
    if (changed === 1) {
      console.log(`reconcile: 订单 ${outTradeNo} 已退款, 吊销登记完成`);
    }
  }

  // 滚动游标：扫满一轮推进到末行 paid_at，未扫满归零（下一轮从头）；
  // 仅值变化才写（零变化零写入断言依赖此分支）
  const nextLast =
    results.length < ALIPAY_REFUND_SCAN_LIMIT
      ? ""
      : String(results[results.length - 1]?.paid_at ?? "");
  if (nextLast !== last) {
    await putStateRaw(
      db,
      ALIPAY_REFUND_CURSOR_STATE_KEY,
      JSON.stringify({ last: nextLast }),
      nowIso,
    );
    stats.dbWrites += 1;
  }
}

/**
 * 3) 吊销登记核对：窗口内 refunded 单缺 revocations 行 → 补登
 * （管理台退款「退款成功→落库」中断的兜底；纯 D1 读写零网关调用）。
 * 顺序在 reconcileRefunds 之后——本轮刚吊销的单在此按 dup 幂等跳过。
 */
async function repairRevocations(
  db: UnlockDbLike,
  deps: AlipayReconcileDeps,
  lookbackDays: number,
  nowIso: string,
  stats: ReconcileStats,
): Promise<void> {
  const cutoffIso = new Date(
    (deps.nowSec - lookbackDays * 86_400) * 1000,
  ).toISOString();
  const { results } = await db
    .prepare(
      `SELECT token, token_hash, expires_at FROM orders
       WHERE channel = ? AND status = ? AND refunded_at >= ?
       LIMIT ${ALIPAY_REPAIR_SCAN_LIMIT}`,
    )
    .bind("alipay", "refunded", cutoffIso)
    .all();
  for (const row of results) {
    const material = revocationMaterialOf(row, deps.nowSec);
    if (material === null) continue; // 未发码即退款（pending 退款不可能）：无码可吊
    const wrote = await insertRevocationIfMissing(
      db,
      material.hash,
      material.exp,
      nowIso,
    );
    stats.revocationsRepaired += wrote;
    stats.dbWrites += wrote;
  }
}

/** not_configured 零结果（零写入） */
const RECONCILE_NOT_CONFIGURED: AlipayReconcileResult = {
  ok: false,
  error: "not_configured",
  pendingChecked: 0,
  reissued: 0,
  closed: 0,
  refundChecked: 0,
  revoked: 0,
  revocationsRepaired: 0,
  contributorsRepaired: 0,
  dbWrites: 0,
};

/**
 * 支付宝对账主流程（M4，E4 三层自愈最后防线；jest stubGateway + FakeD1
 * 直测）。Secrets 未配齐（支付宝 3 项 + Ed25519 私钥）→ not_configured
 * 降级零副作用（爱发电巡检不受影响——两段独立降级）。
 */
export async function runAlipayReconcile(
  deps: AlipayReconcileDeps,
): Promise<AlipayReconcileResult> {
  const { db, env } = deps;
  const privateKey =
    deps.ed25519PrivateKeyHex !== undefined
      ? hexToBytes(deps.ed25519PrivateKeyHex)
      : null;
  if (
    db === null ||
    !env.ALIPAY_APP_ID ||
    !env.ALIPAY_PRIVATE_KEY ||
    !env.ALIPAY_PUBLIC_KEY ||
    privateKey === null ||
    privateKey.length !== 32
  ) {
    return RECONCILE_NOT_CONFIGURED;
  }
  const lookbackDays =
    Number.isFinite(deps.lookbackDays) && deps.lookbackDays > 0
      ? deps.lookbackDays
      : REFUND_LOOKBACK_DAYS_DEFAULT;
  const nowIso = new Date(deps.nowSec * 1000).toISOString();
  const stats: ReconcileStats = {
    pendingChecked: 0,
    reissued: 0,
    closed: 0,
    refundChecked: 0,
    revoked: 0,
    revocationsRepaired: 0,
    contributorsRepaired: 0,
    dbWrites: 0,
  };
  await reconcilePending(db, deps, privateKey, stats);
  await reconcileRefunds(db, deps, lookbackDays, nowIso, stats);
  await repairRevocations(db, deps, lookbackDays, nowIso, stats);
  return { ok: true, ...stats };
}

// ---------------------------------------------------------------------------
// 面包多退款巡检（面包多集成；模式 A 同款：只登记疑似，人工核实吊销）
// ---------------------------------------------------------------------------

/**
 * 面包多巡检每轮扫描上限（Workers Free 子请求 50/invocation 预算重算：
 * 爱发电分页 ≤20 + 支付宝 ≤8×2 + 退款兜底 ≤8 + 面包多 ≤5 = **≤49**；
 * 窗口内订单多于单轮上限时滚动游标跨轮全覆盖）。
 */
export const MBD_REFUND_SCAN_LIMIT = 5;

/** 面包多巡检注入依赖（scheduled 壳组装） */
export interface MbdRefundSyncDeps {
  readonly db: UnlockDbLike | null;
  readonly fetchFn: FetchLike;
  readonly secrets: { readonly mbdDeveloperKey?: string };
  readonly nowSec: number;
  /** 回看窗口天数（与爱发电巡检共用 REFUND_LOOKBACK_DAYS） */
  readonly lookbackDays: number;
  /** 自动吊销开关（与爱发电共用 REFUND_AUTO_REVOKE；面包多退款态
   * 未经首笔真实退款校准前禁开——文档未定义"已退款"state，盲区登记） */
  readonly autoRevoke: boolean;
}

/** 面包多巡检结果（测试断言 + scheduled 日志） */
export interface MbdRefundSyncResult {
  readonly ok: boolean;
  readonly error?: "not_configured";
  /** 本轮复查的已兑换订单数 */
  readonly checked: number;
  /** 本次新登记的疑似单数 */
  readonly newSuspects: number;
  /** 本次 DB 写行数（零变化时仅游标条件写） */
  readonly dbWrites: number;
}

/**
 * 面包多退款巡检主流程（与爱发电巡检方向相反：爱发电分页拉全量单
 * 比对本地，面包多无分页拉单接口——改为**对已兑换单逐一复查**
 * order-detail，state !== 'success' 或查无此单 → 登记疑似退款
 * （共用 refund:suspects 名单，note 前缀 'mbd:' 区分渠道）。
 * 滚动游标按 paid_at 升序推进（支付宝兜底同构），扫完归零重扫。
 */
export async function runMbdRefundSync(
  deps: MbdRefundSyncDeps,
): Promise<MbdRefundSyncResult> {
  const { db, secrets } = deps;
  if (db === null || !secrets.mbdDeveloperKey) {
    return { ok: false, error: "not_configured", checked: 0, newSuspects: 0, dbWrites: 0 };
  }
  const lookbackDays =
    Number.isFinite(deps.lookbackDays) && deps.lookbackDays > 0
      ? deps.lookbackDays
      : REFUND_LOOKBACK_DAYS_DEFAULT;
  const cutoffIso = new Date(
    (deps.nowSec - lookbackDays * 86_400) * 1000,
  ).toISOString();
  const nowIso = new Date(deps.nowSec * 1000).toISOString();

  // 滚动游标（形态与支付宝兜底游标同构；非法游标视同从头扫）
  const prevRaw = await getStateRaw(db, MBD_REFUND_CURSOR_STATE_KEY);
  let last = "";
  if (prevRaw !== null) {
    try {
      const parsed = JSON.parse(prevRaw) as Record<string, unknown>;
      if (typeof parsed.last === "string") last = parsed.last;
    } catch {
      /* 非法游标视同从头扫 */
    }
  }

  const { results } = await db
    .prepare(
      `SELECT token, expires_at, ext_order_no, paid_at
       FROM orders WHERE channel = ? AND status = ? AND paid_at >= ? AND paid_at > ?
       ORDER BY paid_at ASC LIMIT ${MBD_REFUND_SCAN_LIMIT}`,
    )
    .bind("mbd", "paid", cutoffIso, last)
    .all();

  // 逐单复查（候选收集；上游/网络异常单跳过留待下一轮）
  let checked = 0;
  const candidates: { orderId: string; note: string; row: Record<string, unknown> }[] = [];
  for (const row of results) {
    const orderId =
      typeof row.ext_order_no === "string" ? row.ext_order_no : "";
    if (orderId === "") continue;
    checked += 1;
    const req = buildMbdOrderDetailRequest(secrets.mbdDeveloperKey, orderId);
    let parsed: ReturnType<typeof parseMbdOrderDetailResponse>;
    try {
      const resp = await deps.fetchFn(req.url, {
        method: "GET",
        headers: req.headers,
      });
      parsed = parseMbdOrderDetailResponse(await resp.json());
    } catch {
      continue; // 网络异常：留待下一轮
    }
    if (parsed.kind === "upstream_error") continue;
    if (parsed.kind === "not_found") {
      // 已兑换单在面包多侧消失——异常态，登记疑似留人工核实
      candidates.push({ orderId, note: "mbd:not_found", row });
    } else if (parsed.order.state !== "success") {
      candidates.push({ orderId, note: `mbd:${parsed.order.state}`, row });
    }
  }

  // 登记疑似（共用 refund:suspects；orderId 幂等去重）
  const existing = sanitizeRefundSuspects(
    await getStateJson(db, REFUND_SUSPECTS_STATE_KEY),
  );
  const known = new Set(existing.orders.map((o) => o.orderId));
  const newSuspects: RefundSuspect[] = [];
  const redeemedRecords = new Map<string, { token: string; exp: number }>();
  for (const cand of candidates) {
    if (known.has(cand.orderId)) continue;
    known.add(cand.orderId);
    const record = parseOrderRow(cand.row);
    if (record !== null) redeemedRecords.set(cand.orderId, record);
    newSuspects.push({
      orderId: cand.orderId,
      detectedAt: nowIso,
      status: 0, // 面包多 state 为字符串，数值位恒 0，语义在 note
      note: cand.note,
    });
  }

  let dbWrites = 0;
  if (newSuspects.length > 0) {
    const merged: RefundSuspectsV1 = {
      v: 1,
      orders: [...existing.orders, ...newSuspects],
    };
    await putStateRaw(db, REFUND_SUSPECTS_STATE_KEY, JSON.stringify(merged), nowIso);
    dbWrites += 1;

    // 自动吊销（爱发电巡检同构；校准前禁开——盲区登记见 deps 注释）
    if (deps.autoRevoke) {
      const inserts: UnlockDbStatement[] = [];
      const seen = new Set<string>();
      for (const suspect of newSuspects) {
        const record = redeemedRecords.get(suspect.orderId);
        if (!record) continue;
        const h = unlockTokenHash(record.token);
        if (seen.has(h)) continue;
        seen.add(h);
        const dup = await db
          .prepare("SELECT token_hash FROM revocations WHERE token_hash = ?")
          .bind(h)
          .first();
        if (dup !== null) continue;
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

  // 滚动游标：扫满一轮推进到末行 paid_at，未扫满归零；仅值变化才写
  const nextLast =
    results.length < MBD_REFUND_SCAN_LIMIT
      ? ""
      : String(results[results.length - 1]?.paid_at ?? "");
  if (nextLast !== last) {
    await putStateRaw(
      db,
      MBD_REFUND_CURSOR_STATE_KEY,
      JSON.stringify({ last: nextLast }),
      nowIso,
    );
    dbWrites += 1;
  }

  return { ok: true, checked, newSuspects: newSuspects.length, dbWrites };
}

// ---------------------------------------------------------------------------
// 统一对账入口（D-z6：单 cron 每 3h，scheduled 壳唯一消费点）
// ---------------------------------------------------------------------------

/** 统一对账结果（三段独立降级：任一 not_configured 不影响其余段） */
export interface UnifiedSyncResult {
  readonly afdian: RefundSyncResult;
  readonly alipay: AlipayReconcileResult;
  readonly mbd: MbdRefundSyncResult;
}

/** 爱发电巡检 → 支付宝对账 → 面包多巡检顺序执行（子请求预算合并
 * 测算见文件头与 MBD_REFUND_SCAN_LIMIT 注释：≤49/invocation） */
export async function runUnifiedSync(
  afdianDeps: RefundSyncDeps,
  alipayDeps: AlipayReconcileDeps,
  mbdDeps: MbdRefundSyncDeps,
): Promise<UnifiedSyncResult> {
  const afdian = await runRefundSync(afdianDeps);
  const alipay = await runAlipayReconcile(alipayDeps);
  const mbd = await runMbdRefundSync(mbdDeps);
  return { afdian, alipay, mbd };
}
