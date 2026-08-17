/**
 * 支付宝当面付三接口 + 贡献者名单接口纯逻辑（Z 迭代 M2，
 * REQUIREMENTS_ALIPAY_UNLOCK.md §2/§3/E4/D-z4/D-z8；流程结构自
 * stock_analysis `functions/api/alipay/{create,notify,status}.js` 与
 * `functions/api/contributors.js`（提交 126eabe，已真机验收）平移，
 * 发码层改为本项目 Ed25519 token（signToken，与爱发电 redeem 同一编码路径）。
 *
 * 安全纪律（§7，一项不可省）：
 *   1. notify 验签 + app_id/seller_id/金额三重核验（伪造通知 = 免费领 token）；
 *   2. 金额一律服务端定价（UNLOCK_TIERS）；notify/status 金额核验以订单行为准；
 *   3. 隐私 D-z8：buyer_logon_id 等买家身份字段一律不解析不落库；
 *   4. 幂等：orders.ext_order_no UNIQUE + 条件 UPDATE 抢占，同单永远同一 token。
 *
 * notify 与 status deep 兜底走**同一发码函数** issuePaidAlipayOrder（幂等关键，
 * stock 结构沿用）：条件 UPDATE（WHERE status = 读取时状态）为并发互斥点——
 * 后到者 changes=0 → 回读首发 token 幂等返回，贡献者行只由抢占成功者写入。
 * 偏离登记（相对 stock batch 三写）：stock 靠 codes.order_id UNIQUE 触发
 * batch 回滚兜底并发；本项目无 codes 表，改用条件 UPDATE meta.changes 判定，
 * UPDATE 成功与 contributors INSERT 之间非原子（极端中断 = 已发码未上名单，
 * M4 对账 Cron 兜底补登）。
 */
import { UNLOCK_TIERS, type UnlockTier } from "../../../src/data/unlockPricing";
import { unlockTokenHash } from "../../../src/utils/revocationList";
import {
  hexToBytes,
  signToken,
  type UnlockTokenPayload,
} from "../../../src/utils/unlockToken";
import { alipayCall, verifyNotifySign, type AlipayEnv } from "./alipay";
import type { UnlockDbLike } from "./db";
import {
  loadFilterWords,
  validateMessage,
  validateNickname,
} from "./textFilter";

/** notify_url（生产固定域名，E4；dev 联调时通知不可达属预期，靠 deep 兜底） */
export const ALIPAY_NOTIFY_URL = "https://stellar.guushu.com/api/alipay/notify";

/** precreate subject 前缀（中性文案，不含敏感词风险；档位名见 TIER_SUBJECT） */
export const ALIPAY_SUBJECT_PREFIX = "星海奥德赛支持者解锁";

const TIER_SUBJECT: Readonly<Record<UnlockTier, string>> = {
  week: "周卡",
  month: "月卡",
  year: "年卡",
};

/** 商户订单号形态：so + 时间（36 进制）+ 8 位随机（≤64 位官方约束） */
export const OUT_TRADE_NO_RE = /^so[0-9a-z]{6,40}$/;

const SECONDS_PER_DAY = 86_400;

/** Worker env 中支付宝相关绑定面（index.ts 注入） */
export interface AlipayHandlerEnv extends AlipayEnv {
  readonly ALIPAY_SELLER_ID?: string;
}

/** 三接口共享注入依赖 */
export interface AlipayDeps {
  readonly db: UnlockDbLike | null;
  readonly env: AlipayHandlerEnv;
  /** Ed25519 签发私钥（32 字节 hex，wrangler secret，严禁入库） */
  readonly ed25519PrivateKeyHex?: string;
  /** 当前 epoch 秒（token iat/exp 基准 = 支付成功时刻，D-z3） */
  readonly nowSec: number;
}

/** create/status 失败机器码（前端映射 i18n；message 为服务端中文回退文案） */
export type AlipayErrorCode =
  | "invalid_tier"
  | "nickname_too_long"
  | "nickname_blocked"
  | "message_too_long"
  | "message_blocked"
  | "not_configured"
  | "gateway_error"
  | "invalid_order"
  | "order_not_found";

export interface AlipayFailure {
  readonly ok: false;
  readonly error: AlipayErrorCode;
  readonly message: string;
}

/** POST /api/alipay/create 成功体（字段名对齐 stock：snake_case） */
export interface AlipayCreateSuccess {
  readonly ok: true;
  readonly out_trade_no: string;
  readonly qr_code: string;
  readonly amount: number;
}

export type AlipayCreateBody = AlipayCreateSuccess | AlipayFailure;

/** GET /api/alipay/status 成功体（paid 且已发码时附 token/tier/expiresAt） */
export interface AlipayStatusSuccess {
  readonly ok: true;
  readonly status: "pending" | "paid" | "closed" | "refunded";
  readonly token?: string;
  readonly tier?: UnlockTier;
  readonly expiresAt?: number;
}

export type AlipayStatusBody = AlipayStatusSuccess | AlipayFailure;

/** GET /api/contributors 响应条目（D-z4：仅公开展示字段，无任何身份字段） */
export interface ContributorEntry {
  readonly nickname: string | null;
  readonly message: string | null;
  readonly channel: string;
  readonly amountCny: number | null;
  readonly date: string;
}

export interface ContributorsBody {
  readonly ok: true;
  readonly contributors: readonly ContributorEntry[];
}

function fail(error: AlipayErrorCode, message: string): AlipayFailure {
  return { ok: false, error, message };
}

const NOT_CONFIGURED_DB = fail(
  "not_configured",
  "存储服务未配置，请稍后重试或邮件联系作者。",
);
const NOT_CONFIGURED_ALIPAY = fail(
  "not_configured",
  "支付宝支付未配置，请改用爱发电或其他渠道。",
);

/** 商户订单号生成（stock newOutTradeNo 口径，前缀改本项目 so） */
export function newOutTradeNo(nowMs: number = Date.now()): string {
  const rand = Array.from(crypto.getRandomValues(new Uint8Array(8)))
    .map((b) => (b % 36).toString(36))
    .join("");
  return `so${nowMs.toString(36)}${rand}`;
}

/** 支付宝 secrets 是否齐备（create/status deep 网关调用前置） */
function alipayConfigured(env: AlipayHandlerEnv): boolean {
  return Boolean(
    env.ALIPAY_APP_ID && env.ALIPAY_PRIVATE_KEY && env.ALIPAY_PUBLIC_KEY,
  );
}

// ---------------------------------------------------------------------------
// 订单行投影（发码/核验共用最小面）
// ---------------------------------------------------------------------------
interface AlipayOrderRow {
  readonly id: string;
  readonly tier: UnlockTier;
  readonly status: string;
  readonly token: string | null;
  readonly expiresAt: number | null;
  readonly amountCny: number;
  readonly nickname: string | null;
  readonly message: string | null;
}

const ORDER_SELECT =
  "SELECT id, tier, status, token, expires_at, amount_cny, nickname, message" +
  " FROM orders WHERE channel = ? AND ext_order_no = ?";

/** 订单行防御式解析（形状异常返回 null，调用方按订单不存在/失败处理） */
function parseOrderRow(row: Record<string, unknown> | null): AlipayOrderRow | null {
  if (row === null) return null;
  const { id, tier, status } = row;
  if (typeof id !== "string" || typeof status !== "string") return null;
  if (tier !== "week" && tier !== "month" && tier !== "year") return null;
  const token = typeof row.token === "string" && row.token !== "" ? row.token : null;
  const exp =
    typeof row.expires_at === "number" && Number.isFinite(row.expires_at)
      ? row.expires_at
      : null;
  const amount = typeof row.amount_cny === "number" ? row.amount_cny : NaN;
  return {
    id,
    tier,
    status,
    token,
    expiresAt: exp,
    amountCny: amount,
    nickname: typeof row.nickname === "string" ? row.nickname : null,
    message: typeof row.message === "string" ? row.message : null,
  };
}

async function selectOrder(
  db: UnlockDbLike,
  outTradeNo: string,
): Promise<AlipayOrderRow | null> {
  const row = await db.prepare(ORDER_SELECT).bind("alipay", outTradeNo).first();
  return parseOrderRow(row);
}

/** 金额核验（分，防浮点）：通知/查询回报的 total_amount 必须与订单行一致 */
function amountMatches(totalAmount: unknown, orderAmountCny: number): boolean {
  const cents = Math.round(parseFloat(String(totalAmount ?? "0")) * 100);
  return Number.isFinite(cents) && cents === Math.round(orderAmountCny * 100);
}

// ---------------------------------------------------------------------------
// 发码事务（notify 与 status deep 兜底共用，幂等关键）
// ---------------------------------------------------------------------------

/** 发码结果（幂等：并发后到者返回首发 token） */
export interface IssueResult {
  readonly token: string;
  readonly tier: UnlockTier;
  readonly expiresAt: number;
}

/**
 * 支付成功订单发码：条件 UPDATE 抢占（WHERE id AND status = 读取时状态）→
 * 抢占成功者签发 token 回填订单行 + INSERT contributors（D4：主键
 * randomUUID，匿名照样上名单）；抢占失败（并发首写已落定）回读首发 token
 * 幂等返回。exp = 支付成功时刻 + 档位天数（D-z3）。
 *
 * @throws 抢占失败且回读行仍未发码（存量异常）时抛错，调用方按失败处理
 */
export async function issuePaidAlipayOrder(
  db: UnlockDbLike,
  order: AlipayOrderRow,
  tradeNo: string,
  privateKey: Uint8Array,
  nowSec: number,
): Promise<IssueResult> {
  const exp = nowSec + UNLOCK_TIERS[order.tier].days * SECONDS_PER_DAY;
  const payload: UnlockTokenPayload = {
    v: 1,
    tier: order.tier,
    exp,
    iat: nowSec,
    ch: "alipay",
  };
  const token = signToken(payload, privateKey);
  const nowIso = new Date(nowSec * 1000).toISOString();
  const contributorId = crypto.randomUUID();

  const updated = await db
    .prepare(
      `UPDATE orders SET status = ?, trade_no = ?, token = ?, token_hash = ?,
         expires_at = ?, paid_at = ?, contributor_id = ?
       WHERE id = ? AND status = ?`,
    )
    .bind(
      "paid",
      tradeNo || null,
      token,
      unlockTokenHash(token),
      exp,
      nowIso,
      contributorId,
      order.id,
      order.status,
    )
    .run();

  if ((updated.meta?.changes ?? 0) !== 1) {
    // 并发抢占失败：首写已落定 → 回读首发 token 幂等返回
    const raced = parseOrderRow(
      await db
        .prepare(
          "SELECT id, tier, status, token, expires_at, amount_cny, nickname, message FROM orders WHERE id = ?",
        )
        .bind(order.id)
        .first(),
    );
    if (
      raced !== null &&
      raced.status === "paid" &&
      raced.token !== null &&
      raced.expiresAt !== null
    ) {
      return { token: raced.token, tier: raced.tier, expiresAt: raced.expiresAt };
    }
    throw new Error("alipay-issue: 发码抢占失败且存量记录异常");
  }

  await db
    .prepare(
      `INSERT INTO contributors (id, nickname, message, channel, amount_cny, created_at, hidden)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      contributorId,
      order.nickname,
      order.message,
      "alipay",
      order.amountCny,
      nowIso,
      0,
    )
    .run();

  return { token, tier: order.tier, expiresAt: exp };
}

// ---------------------------------------------------------------------------
// POST /api/alipay/create — 预下单（订单码支付）
// ---------------------------------------------------------------------------
export async function handleAlipayCreate(
  bodyRaw: unknown,
  deps: AlipayDeps,
): Promise<AlipayCreateBody> {
  const body =
    typeof bodyRaw === "object" && bodyRaw !== null
      ? (bodyRaw as Record<string, unknown>)
      : {};

  // 档位白名单（D5：三选一单份；服务端定价，客户端金额字段一律忽略）
  const tier = body.tier;
  if (tier !== "week" && tier !== "month" && tier !== "year") {
    return fail("invalid_tier", "档位不正确，仅支持周卡/月卡/年卡。");
  }
  const amountCny = UNLOCK_TIERS[tier].priceCny;

  if (deps.db === null) return NOT_CONFIGURED_DB;
  if (!alipayConfigured(deps.env)) return NOT_CONFIGURED_ALIPAY;
  const db = deps.db;

  // 昵称/留言：长度 + 敏感词过滤（命中拒绝提交，D4；词库 D-z7 从 D1 读）
  const words = await loadFilterWords(db);
  const nick = validateNickname(body.nickname, words);
  if (!nick.ok) {
    return fail(
      nick.error === "blocked" ? "nickname_blocked" : "nickname_too_long",
      nick.message,
    );
  }
  const msg = validateMessage(body.message, words);
  if (!msg.ok) {
    return fail(
      msg.error === "blocked" ? "message_blocked" : "message_too_long",
      msg.message,
    );
  }

  // 先 INSERT orders(pending) 再调 precreate；预下单失败的 pending 行
  // 由对账 Cron 超时关单清理（M4，stock 同口径）
  const outTradeNo = newOutTradeNo(deps.nowSec * 1000);
  const nowIso = new Date(deps.nowSec * 1000).toISOString();
  await db
    .prepare(
      `INSERT INTO orders (id, channel, ext_order_no, amount_cny, tier, months,
         status, nickname, message, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      "alipay",
      outTradeNo,
      amountCny,
      tier,
      tier === "month" ? 1 : null,
      "pending",
      nick.value,
      msg.value,
      nowIso,
    )
    .run();

  // 字段依据 alipay.trade.precreate 官方模型（stock 已核对）：
  // out_trade_no / total_amount（元，两位小数字符串）/ subject /
  // timeout_express（D-z2：30m）/ product_code（当面付）
  const r = await alipayCall(
    deps.env,
    "alipay.trade.precreate",
    {
      out_trade_no: outTradeNo,
      total_amount: amountCny.toFixed(2),
      subject: `${ALIPAY_SUBJECT_PREFIX}·${TIER_SUBJECT[tier]}`,
      timeout_express: "30m",
      product_code: "FACE_TO_FACE_PAYMENT",
    },
    { notifyUrl: ALIPAY_NOTIFY_URL },
  );

  if (!r.ok || !r.data || typeof r.data.qr_code !== "string") {
    return fail("gateway_error", r.error ?? "支付宝预下单失败，请稍后重试。");
  }
  return {
    ok: true,
    out_trade_no: outTradeNo,
    qr_code: r.data.qr_code,
    amount: amountCny,
  };
}

// ---------------------------------------------------------------------------
// POST /api/alipay/notify — 收款异步通知（安全核心）
// 返回纯文本 "success"/"failure"（支付宝只认 "success"，否则 25h 内梯度重试
// 8 次，天然自愈）；Response 构造留给 index.ts 薄壳。
// ---------------------------------------------------------------------------
export async function handleAlipayNotify(
  rawBody: string,
  deps: AlipayDeps,
): Promise<"success" | "failure"> {
  const { env } = deps;
  const privateKey =
    deps.ed25519PrivateKeyHex !== undefined
      ? hexToBytes(deps.ed25519PrivateKeyHex)
      : null;
  if (
    deps.db === null ||
    !env.ALIPAY_APP_ID ||
    !env.ALIPAY_PUBLIC_KEY ||
    !env.ALIPAY_SELLER_ID ||
    privateKey === null ||
    privateKey.length !== 32
  ) {
    return "failure"; // 缺绑定/Secrets：让支付宝重试，配置补齐后自愈
  }
  const db = deps.db;

  const params: Record<string, string> = {};
  try {
    for (const [k, v] of new URLSearchParams(rawBody)) params[k] = v;
  } catch {
    return "failure";
  }

  // 1. RSA2 验签 — 伪造通知 = 免费领 token，验签失败一律拒绝
  if (!(await verifyNotifySign(params, env.ALIPAY_PUBLIC_KEY))) {
    console.log("alipay-notify: 验签失败, 已拒绝"); // 不落任何报文内容
    return "failure";
  }

  // 2. app_id / seller_id 核验（防跨应用/跨商户重放）
  if (String(params.app_id ?? "") !== env.ALIPAY_APP_ID) return "failure";
  if (String(params.seller_id ?? "") !== env.ALIPAY_SELLER_ID) return "failure";

  // 3. 订单核验（输入先正则再入库查询）
  const outTradeNo = String(params.out_trade_no ?? "");
  if (!OUT_TRADE_NO_RE.test(outTradeNo)) return "failure";
  const order = await selectOrder(db, outTradeNo);
  if (order === null) return "failure";

  // 金额核验（分，防浮点）：total_amount 必须与下单金额一致（防改价）
  if (!amountMatches(params.total_amount, order.amountCny)) {
    console.log("alipay-notify: 金额不符, 已拒绝");
    return "failure";
  }

  // 4. 状态路由：仅 TRADE_SUCCESS / TRADE_FINISHED 视为已付
  const tradeStatus = String(params.trade_status ?? "");
  if (tradeStatus !== "TRADE_SUCCESS" && tradeStatus !== "TRADE_FINISHED") {
    return "success"; // 其他状态不处理，ack 停止重试
  }

  // 幂等：已发码直接回 success（支付宝重试通知）；已退款不再发码
  if (order.status === "paid" && order.token !== null) return "success";
  if (order.status === "refunded") return "success";

  try {
    await issuePaidAlipayOrder(
      db,
      order,
      String(params.trade_no ?? ""),
      privateKey,
      deps.nowSec,
    );
  } catch {
    console.log("alipay-notify: 发码失败, 等待支付宝重试");
    return "failure";
  }
  return "success";
}

// ---------------------------------------------------------------------------
// GET /api/alipay/status — 轮询 + trade.query 兜底补发（E4 第二层自愈）
// ---------------------------------------------------------------------------
function statusResult(order: AlipayOrderRow): AlipayStatusSuccess {
  if (
    order.status === "paid" &&
    order.token !== null &&
    order.expiresAt !== null
  ) {
    return {
      ok: true,
      status: "paid",
      token: order.token,
      tier: order.tier,
      expiresAt: order.expiresAt,
    };
  }
  const status =
    order.status === "paid" ||
    order.status === "closed" ||
    order.status === "refunded"
      ? order.status
      : "pending";
  return { ok: true, status };
}

export async function handleAlipayStatus(
  outTradeNoRaw: string | null,
  deep: boolean,
  deps: AlipayDeps,
): Promise<AlipayStatusBody> {
  const outTradeNo = String(outTradeNoRaw ?? "");
  // 只接受本站生成的商户订单号形态（newOutTradeNo）——不合法即拒，零 DB 访问
  if (!OUT_TRADE_NO_RE.test(outTradeNo)) {
    return fail("invalid_order", "订单号格式不正确。");
  }
  if (deps.db === null) return NOT_CONFIGURED_DB;
  const db = deps.db;

  const order = await selectOrder(db, outTradeNo);
  if (order === null) return fail("order_not_found", "未找到该订单。");

  // 非 pending/closed 或未要求兜底：直接返回当前状态（D1 强一致写后即读）
  const needFallback =
    deep && (order.status === "pending" || order.status === "closed");
  if (!needFallback) return statusResult(order);
  const privateKey =
    deps.ed25519PrivateKeyHex !== undefined
      ? hexToBytes(deps.ed25519PrivateKeyHex)
      : null;
  if (
    !alipayConfigured(deps.env) ||
    privateKey === null ||
    privateKey.length !== 32
  ) {
    return statusResult(order); // 未配置 Secrets 时退化为纯轮询
  }

  // trade.query 兜底（覆盖 notify 丢失/延迟；字段依据官方
  // AlipayTradeQueryResponse：trade_status / total_amount / trade_no）
  const q = await alipayCall(deps.env, "alipay.trade.query", {
    out_trade_no: outTradeNo,
  });
  if (!q.ok || !q.data) return statusResult(order);
  const tradeStatus = String(q.data.trade_status ?? "");
  if (tradeStatus === "TRADE_SUCCESS" || tradeStatus === "TRADE_FINISHED") {
    // 与 notify 同口径金额核验后走同一发码事务
    if (!amountMatches(q.data.total_amount, order.amountCny)) {
      return statusResult(order);
    }
    try {
      const issued = await issuePaidAlipayOrder(
        db,
        order,
        String(q.data.trade_no ?? ""),
        privateKey,
        deps.nowSec,
      );
      return {
        ok: true,
        status: "paid",
        token: issued.token,
        tier: issued.tier,
        expiresAt: issued.expiresAt,
      };
    } catch {
      // 与 notify 并发且回读异常：复读订单行按当前状态返回
      const again = await selectOrder(db, outTradeNo);
      return statusResult(again ?? order);
    }
  }
  return statusResult(order);
}

// ---------------------------------------------------------------------------
// GET /api/contributors — 贡献者名单（D-z4：仅公开展示字段；hidden=0）
// ---------------------------------------------------------------------------
export async function handleContributors(
  db: UnlockDbLike | null,
): Promise<ContributorsBody> {
  if (db === null) return { ok: true, contributors: [] };
  let results: readonly Record<string, unknown>[];
  try {
    ({ results } = await db
      .prepare(
        `SELECT nickname, message, channel, amount_cny, created_at
         FROM contributors WHERE hidden = ? ORDER BY created_at DESC LIMIT 500`,
      )
      .bind(0)
      .all());
  } catch {
    return { ok: true, contributors: [] }; // 表未初始化等异常：空名单降级
  }
  const contributors = (results ?? []).map((r): ContributorEntry => {
    const nickname = String(r.nickname ?? "").trim();
    const message = String(r.message ?? "").trim();
    return {
      nickname: nickname === "" ? null : nickname,
      message: message === "" ? null : message,
      channel: String(r.channel ?? ""),
      amountCny: typeof r.amount_cny === "number" ? r.amount_cny : null,
      date: String(r.created_at ?? "").slice(0, 10),
    };
  });
  return { ok: true, contributors };
}
