/**
 * `/api/redeem` 主流程纯逻辑（REQUIREMENTS_UNLOCK.md §U4-1，响应契约 §0.5；
 * Z 迭代 M1：存储层 KV `order:<订单号>` → D1 orders 表，对外契约零变化）。
 *
 * 依赖全部注入（DB/fetch/secrets/时钟），jest 可直测；Response 构造留给
 * `workers/unlock/index.ts` 薄壳。
 *
 * 流程（§0.6 自 stock_analysis redeem.js 平移 + 三档改造）：
 *   订单号正则（不合法即拒，零 DB 访问）
 *   → D1 读 orders（ext_order_no UNIQUE 幂等基石，命中 → 幂等返回首发 token）
 *   → 爱发电 query-order 验单（status!==2 → order_not_paid）
 *   → 档位判定（U6 plan_id 映射强制归档优先；映射未全配置回退
 *     商品单按单件归档防误判 + resolveTierFromAmount 金额链）
 *   → exp = 订单号前 14 位下单时间 + 档位天数
 *   → Ed25519 签发（与 U1 verifyToken 同一编码路径 signToken）
 *   → D1 INSERT orders（幂等重兑依据；UNIQUE 冲突 = 并发首写落定，
 *     回读首发 token——KV 时代无此保护，迁移增强登记）
 *
 * 防写额度攻击（§U4-1 硬约束沿用）：全部快速失败路径零 DB 写；
 * 正则不合法路径连 DB 读都没有。
 */
import {
  resolveTierFromAmount,
  UNLOCK_TIERS,
  type UnlockTier,
} from "../../../src/data/unlockPricing";
import { unlockTokenHash } from "../../../src/utils/revocationList";
import {
  hexToBytes,
  signToken,
  type UnlockTokenPayload,
} from "../../../src/utils/unlockToken";
import {
  buildAfdianQueryOrderRequest,
  parseAfdianQueryOrderResponse,
  type AfdianOrder,
  type AfdianQueryResult,
} from "./afdian";
import type { UnlockDbLike } from "./db";
import {
  buildMbdOrderDetailRequest,
  MBD_ORDER_ID_RE,
  normalizeMbdOrderId,
  parseMbdOrderDetailResponse,
  type MbdOrder,
  type MbdQueryResult,
} from "./mbd";
import { parseOrderEpochSec } from "./orderTime";

/** §0.5 失败机器码（v1.1：U6 追加 plan_not_eligible，前端未知码回退兼容） */
export type RedeemErrorCode =
  | "invalid_order"
  | "order_not_paid"
  | "amount_too_low"
  | "already_redeemed_conflict"
  | "upstream_error"
  | "not_configured"
  | "plan_not_eligible";

/** §0.5 冻结的响应契约 */
export type RedeemBody =
  | {
      readonly ok: true;
      readonly token: string;
      readonly tier: UnlockTier;
      readonly expiresAt: number;
    }
  | {
      readonly ok: false;
      readonly error: RedeemErrorCode;
      readonly message: string;
    };

/** fetch 结构化最小接口（生产 = 全局 fetch，测试 = fixture mock；
 * body 可缺省——面包多 order-detail 为 GET 无请求体） */
export type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: string;
  },
) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

/** Worker secrets（未配置项为 undefined，触发 not_configured 降级） */
export interface RedeemSecrets {
  readonly afdianUserId?: string;
  readonly afdianToken?: string;
  /** 面包多开发者 key（mbd.pub「开发设置」，wrangler secret，严禁入库） */
  readonly mbdDeveloperKey?: string;
  /** Ed25519 私钥（32 字节 hex，wrangler secret，严禁入库） */
  readonly ed25519PrivateKeyHex?: string;
}

/**
 * 档位 ↔ 爱发电 plan_id 映射（U6，来自 wrangler `[vars]`，非机密）：
 * 空串/缺失 = 未配置。三者**全部配置**才启用映射强制归档（裁决 ②），
 * 任一未配置整体回退纯金额判定（部署安全，防漏配置全量拒绝）。
 */
export interface PlanTierMapping {
  readonly week?: string;
  readonly month?: string;
  readonly year?: string;
}

/** plan 映射是否全配置（映射态判定唯一入口，classifyOrder 与错误码共用） */
export function isPlanMappingComplete(planTiers: PlanTierMapping): boolean {
  return (
    (planTiers.week ?? "").trim() !== "" &&
    (planTiers.month ?? "").trim() !== "" &&
    (planTiers.year ?? "").trim() !== ""
  );
}

/** 主流程注入依赖 */
export interface RedeemDeps {
  readonly db: UnlockDbLike | null;
  readonly fetchFn: FetchLike;
  readonly secrets: RedeemSecrets;
  /** 当前 epoch 秒（token iat 与爱发电签名 ts 共用） */
  readonly nowSec: number;
  /** 档位 plan_id 映射（U6，env vars 注入） */
  readonly planTiers: PlanTierMapping;
  /**
   * 档位 ↔ 面包多 urlkey 映射（对等 planTiers 的双态机制：三者全配置
   * 才启用强制归档，任一为空回退纯金额判定）。缺省 = 全空（回退态）。
   */
  readonly mbdUrlkeys?: PlanTierMapping;
}

/** 兑换渠道（请求体 `channel` 字段取值；缺省 'afdian' 向后兼容） */
export type RedeemChannel = "afdian" | "mbd";

/** 订单号格式（爱发电订单号 14-40 位数字，§0.5） */
export const ORDER_ID_RE = /^\d{14,40}$/;

const SECONDS_PER_DAY = 86_400;

/** 金额不足提示（价格取自 unlockPricing 单一事实源，勿写死数字） */
function amountTooLowMessage(): string {
  const { week, month, year } = UNLOCK_TIERS;
  return `订单金额不足（周卡 ¥${week.priceCny} / 月卡 ¥${month.priceCny}×月数 / 年卡 ¥${year.priceCny}）。`;
}

function fail(error: RedeemErrorCode, message: string): RedeemBody {
  return { ok: false, error, message };
}

/**
 * 档位归档（U6：plan 映射层优先，金额判定降为回退链）：
 *
 * **映射全配置**（三 plan_id 均非空，裁决 ①②）：
 * - planId 命中 → 强制归档**无视实付金额**（折扣/特价/会员优惠安全；
 *   仅 status===2 已在主流程校验）：week/year（商品）= 档位天数 ×
 *   goodsCount；month（订阅）= 31 × months；
 * - 未命中（赞助方案/未知 plan）→ null（handleRedeem 按映射态归
 *   `plan_not_eligible`，堵赞助单兑换）。
 *
 * **任一未配置** → 整体回退现行纯金额判定（§0.6 平移三档，部署安全）：
 * - 商品单（product_type===1）按**单件金额**归档防误判——如 3 份 ¥6 周卡
 *   合计 ¥18 不得被金额规则误判为月卡，而是周卡天数 × 份数；
 * - 订阅方案单按总金额 + 月数走 `resolveTierFromAmount`；
 * - 金额不足返回 null（对应 amount_too_low）。
 */
export function classifyOrder(
  order: AfdianOrder,
  planTiers: PlanTierMapping,
): { tier: UnlockTier; days: number } | null {
  if (isPlanMappingComplete(planTiers)) {
    const planId = order.planId;
    const tier: UnlockTier | null =
      planId !== "" && planId === (planTiers.week ?? "").trim()
        ? "week"
        : planId !== "" && planId === (planTiers.month ?? "").trim()
          ? "month"
          : planId !== "" && planId === (planTiers.year ?? "").trim()
            ? "year"
            : null;
    if (tier === null) return null;
    if (tier === "month") {
      return { tier, days: UNLOCK_TIERS.month.days * order.months };
    }
    return { tier, days: UNLOCK_TIERS[tier].days * order.goodsCount };
  }
  if (order.isGoods) {
    const unitAmount = order.totalAmountCny / order.goodsCount;
    const resolved = resolveTierFromAmount(unitAmount, 1);
    if (resolved === null) return null;
    return { tier: resolved.tier, days: resolved.days * order.goodsCount };
  }
  return resolveTierFromAmount(order.totalAmountCny, order.months);
}

/** 存量兑换记录（orders 行的 token/tier/expires_at 投影） */
interface StoredRedemption {
  readonly token: string;
  readonly tier: UnlockTier;
  readonly exp: number;
}

/** orders 存量行防御式解析（形状异常返回 null → already_redeemed_conflict） */
function parseStoredRow(row: Record<string, unknown>): StoredRedemption | null {
  const { token, tier, expires_at: exp } = row;
  if (typeof token !== "string" || token === "") return null;
  if (tier !== "week" && tier !== "month" && tier !== "year") return null;
  if (typeof exp !== "number" || !Number.isFinite(exp)) return null;
  return { token, tier, exp };
}

/** 幂等读：ext_order_no 命中的渠道订单行（无记录 → null） */
async function selectStoredRow(
  db: UnlockDbLike,
  channel: RedeemChannel,
  orderId: string,
): Promise<Record<string, unknown> | null> {
  return db
    .prepare(
      "SELECT token, tier, expires_at FROM orders WHERE channel = ? AND ext_order_no = ?",
    )
    .bind(channel, orderId)
    .first();
}

/**
 * 面包多档位归档（对等 classifyOrder 的双态机制，面包多集成）：
 *
 * **urlkey 映射全配置**：命中 → 强制归档**无视实付金额**（折扣/优惠码
 * 安全——启用映射态后才允许在面包多发优惠码，UNLOCK_OPS 部署顺序）；
 * 未命中（非解锁商品）→ null（主流程按映射态归 plan_not_eligible）。
 *
 * **任一未配置** → 回退纯金额判定（上线初期形态，**商品页禁折扣**）。
 * 三档在面包多均为一次性商品（无订阅/份数概念），months 恒 1、无
 * goodsCount 叠加——比爱发电判定简单。
 */
export function classifyMbdOrder(
  order: MbdOrder,
  urlkeys: PlanTierMapping,
): { tier: UnlockTier; days: number } | null {
  if (isPlanMappingComplete(urlkeys)) {
    const urlkey = order.urlkey;
    const tier: UnlockTier | null =
      urlkey !== "" && urlkey === (urlkeys.week ?? "").trim()
        ? "week"
        : urlkey !== "" && urlkey === (urlkeys.month ?? "").trim()
          ? "month"
          : urlkey !== "" && urlkey === (urlkeys.year ?? "").trim()
            ? "year"
            : null;
    if (tier === null) return null;
    return { tier, days: UNLOCK_TIERS[tier].days };
  }
  const resolved = resolveTierFromAmount(order.amountCny, 1);
  if (resolved === null) return null;
  return { tier: resolved.tier, days: resolved.days };
}

/** 面包多验单（GET order-detail；网络/形状异常一律归 upstream_error） */
async function queryMbdOrder(
  deps: RedeemDeps,
  developerKey: string,
  orderId: string,
): Promise<MbdQueryResult> {
  try {
    const req = buildMbdOrderDetailRequest(developerKey, orderId);
    const resp = await deps.fetchFn(req.url, {
      method: "GET",
      headers: req.headers,
    });
    // 面包多 4xx 也可能带 JSON body（code 400/403 语义在 body 里），
    // 故不看 resp.ok，一律进解析器按 code 分流
    return parseMbdOrderDetailResponse(await resp.json());
  } catch {
    return { kind: "upstream_error" };
  }
}

/** 爱发电验单（网络/形状异常一律归 upstream_error，不抛异常） */
async function queryAfdianOrder(
  deps: RedeemDeps,
  userId: string,
  token: string,
  orderId: string,
): Promise<AfdianQueryResult> {
  try {
    const req = buildAfdianQueryOrderRequest(
      userId,
      token,
      orderId,
      deps.nowSec,
    );
    const resp = await deps.fetchFn(req.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: req.body,
    });
    if (!resp.ok) return { kind: "upstream_error" };
    return parseAfdianQueryOrderResponse(await resp.json(), orderId);
  } catch {
    return { kind: "upstream_error" };
  }
}

/**
 * `/api/redeem` 主流程（响应恒为 §0.5 契约体，HTTP 层恒 200）。
 *
 * channelRaw（面包多集成扩展）：请求体 `channel` 字段——缺省/'afdian'
 * 走爱发电流程（对外契约向后兼容），'mbd' 走面包多流程，其余值按
 * invalid_order 拒绝（零 DB 访问）。
 */
export async function handleRedeem(
  orderIdRaw: unknown,
  deps: RedeemDeps,
  channelRaw?: unknown,
): Promise<RedeemBody> {
  if (
    channelRaw !== undefined &&
    channelRaw !== "afdian" &&
    channelRaw !== "mbd"
  ) {
    return fail("invalid_order", "不支持的兑换渠道，请核对后重试。");
  }
  if (channelRaw === "mbd") return handleMbdRedeem(orderIdRaw, deps);

  // 1. 订单号格式校验——不合法即拒，零 DB 访问（防写额度攻击）
  const orderId = typeof orderIdRaw === "string" ? orderIdRaw.trim() : "";
  if (!ORDER_ID_RE.test(orderId)) {
    return fail("invalid_order", "订单号格式不正确，请核对后重试。");
  }

  // 2. 配置检查——Secrets/DB 未配置友好降级，不抛 500
  const { afdianUserId, afdianToken, ed25519PrivateKeyHex } = deps.secrets;
  const notConfigured = fail(
    "not_configured",
    "兑换服务尚未配置完成，请稍后重试或邮件联系作者。",
  );
  if (!afdianUserId || !afdianToken || !ed25519PrivateKeyHex || !deps.db) {
    return notConfigured;
  }
  const privateKey = hexToBytes(ed25519PrivateKeyHex);
  if (privateKey === null || privateKey.length !== 32) return notConfigured;

  // 3. D1 幂等读——已兑换订单直接返回首发 token（ext_order_no UNIQUE）
  const db = deps.db;
  const storedRow = await selectStoredRow(db, "afdian", orderId);
  if (storedRow !== null) {
    const stored = parseStoredRow(storedRow);
    if (stored === null) {
      return fail(
        "already_redeemed_conflict",
        "该订单已兑换过，但存量记录异常，请邮件联系作者处理。",
      );
    }
    return {
      ok: true,
      token: stored.token,
      tier: stored.tier,
      expiresAt: stored.exp,
    };
  }

  // 4. 爱发电验单
  const result = await queryAfdianOrder(deps, afdianUserId, afdianToken, orderId);
  if (result.kind === "upstream_error") {
    return fail("upstream_error", "爱发电订单查询暂时不可用，请稍后重试。");
  }
  if (result.kind === "not_found") {
    return fail(
      "invalid_order",
      "未查询到该订单，请核对订单号（仅支持本创作者的爱发电订单）。",
    );
  }
  if (result.order.status !== 2) {
    return fail("order_not_paid", "订单未完成支付。");
  }

  // 5. 档位判定（U6：映射全配置态下未命中 → plan_not_eligible，零 DB 写）
  const resolved = classifyOrder(result.order, deps.planTiers);
  if (resolved === null) {
    if (isPlanMappingComplete(deps.planTiers)) {
      return fail(
        "plan_not_eligible",
        "该订单对应的商品不支持解锁兑换，请购买解锁档位商品。",
      );
    }
    return fail("amount_too_low", amountTooLowMessage());
  }

  // 6. exp = 下单时间起算 + 档位天数（订单号前 14 位，§0.6）
  const orderEpochSec = parseOrderEpochSec(orderId);
  if (orderEpochSec === null) {
    return fail("invalid_order", "订单时间解析失败，请邮件联系作者处理。");
  }
  const exp = orderEpochSec + resolved.days * SECONDS_PER_DAY;

  // 7. Ed25519 签发（U1 同一编码路径）+ D1 落账（每笔兑换恰 1 行写）。
  //    plan_id 为审计字段（U6：排查哪笔兑换来自哪个商品）；D-z8：不落
  //    任何买家身份字段。paid_at = 爱发电下单时刻（status===2 已核验）。
  const payload: UnlockTokenPayload = {
    v: 1,
    tier: resolved.tier,
    exp,
    iat: deps.nowSec,
    ch: "afdian",
  };
  const token = signToken(payload, privateKey);
  const nowIso = new Date(deps.nowSec * 1000).toISOString();
  try {
    await db
      .prepare(
        `INSERT INTO orders (id, channel, ext_order_no, amount_cny, tier, months,
           status, token, token_hash, expires_at, plan_id, created_at, paid_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        "afdian",
        orderId,
        result.order.totalAmountCny,
        resolved.tier,
        result.order.isGoods ? null : result.order.months,
        "paid",
        token,
        unlockTokenHash(token),
        exp,
        result.order.planId,
        nowIso,
        new Date(orderEpochSec * 1000).toISOString(),
      )
      .run();
  } catch {
    // UNIQUE 冲突 = 并发兑换首写已落定 → 回读首发 token 保持幂等
    // （同单永远返回同一 token；回读仍异常才归 conflict）
    const raced = await selectStoredRow(db, "afdian", orderId);
    const stored = raced === null ? null : parseStoredRow(raced);
    if (stored === null) {
      return fail(
        "already_redeemed_conflict",
        "该订单已兑换过，但存量记录异常，请邮件联系作者处理。",
      );
    }
    return {
      ok: true,
      token: stored.token,
      tier: stored.tier,
      expiresAt: stored.exp,
    };
  }
  return { ok: true, token, tier: resolved.tier, expiresAt: exp };
}

/**
 * 面包多兑换流程（面包多集成，骨架与爱发电流程同构：正则 → 配置检查 →
 * D1 幂等读 → 验单 → 档位判定 → 签发落账；差异点：
 * - 订单号 32 位 hex（小写归一后作幂等键）；
 * - 验单为 GET + x-token（无签名拼串）；
 * - 权益起算自响应 `ordertime`（支付时刻），无需解析订单号；
 * - 档位判定 urlkey 映射态 / 金额回退态（classifyMbdOrder）；
 * - 一次性商品无 months/份数概念，months 落 null、plan_id 落 urlkey）。
 */
async function handleMbdRedeem(
  orderIdRaw: unknown,
  deps: RedeemDeps,
): Promise<RedeemBody> {
  // 1. 订单号格式校验——不合法即拒，零 DB 访问（防写额度攻击）
  const trimmed = typeof orderIdRaw === "string" ? orderIdRaw.trim() : "";
  if (!MBD_ORDER_ID_RE.test(trimmed)) {
    return fail("invalid_order", "订单号格式不正确，请核对后重试。");
  }
  const orderId = normalizeMbdOrderId(trimmed);

  // 2. 配置检查——Secrets/DB 未配置友好降级，不抛 500
  const { mbdDeveloperKey, ed25519PrivateKeyHex } = deps.secrets;
  const notConfigured = fail(
    "not_configured",
    "兑换服务尚未配置完成，请稍后重试或邮件联系作者。",
  );
  if (!mbdDeveloperKey || !ed25519PrivateKeyHex || !deps.db) {
    return notConfigured;
  }
  const privateKey = hexToBytes(ed25519PrivateKeyHex);
  if (privateKey === null || privateKey.length !== 32) return notConfigured;

  // 3. D1 幂等读——已兑换订单直接返回首发 token（ext_order_no UNIQUE）
  const db = deps.db;
  const storedRow = await selectStoredRow(db, "mbd", orderId);
  if (storedRow !== null) {
    const stored = parseStoredRow(storedRow);
    if (stored === null) {
      return fail(
        "already_redeemed_conflict",
        "该订单已兑换过，但存量记录异常，请邮件联系作者处理。",
      );
    }
    return {
      ok: true,
      token: stored.token,
      tier: stored.tier,
      expiresAt: stored.exp,
    };
  }

  // 4. 面包多验单
  const result = await queryMbdOrder(deps, mbdDeveloperKey, orderId);
  if (result.kind === "upstream_error") {
    return fail("upstream_error", "面包多订单查询暂时不可用，请稍后重试。");
  }
  if (result.kind === "not_found") {
    return fail(
      "invalid_order",
      "未查询到该订单，请核对订单号（仅支持本创作者的面包多订单）。",
    );
  }
  if (result.order.state !== "success") {
    return fail("order_not_paid", "订单未完成支付。");
  }

  // 5. 档位判定（urlkey 映射态未命中 → plan_not_eligible，零 DB 写）
  const urlkeys = deps.mbdUrlkeys ?? {};
  const resolved = classifyMbdOrder(result.order, urlkeys);
  if (resolved === null) {
    if (isPlanMappingComplete(urlkeys)) {
      return fail(
        "plan_not_eligible",
        "该订单对应的商品不支持解锁兑换，请购买解锁档位商品。",
      );
    }
    return fail("amount_too_low", amountTooLowMessage());
  }

  // 6. exp = 支付时刻起算 + 档位天数（响应 ordertime；缺失 = 上游形状
  //    异常，按 upstream_error 拒绝——不用兑换时刻兜底，防时长凭空延长）
  const paidAtSec = result.order.paidAtSec;
  if (paidAtSec === null) {
    return fail("upstream_error", "订单支付时间缺失，请稍后重试或邮件联系作者。");
  }
  const exp = paidAtSec + resolved.days * SECONDS_PER_DAY;

  // 7. Ed25519 签发 + D1 落账（爱发电同构；plan_id 落 urlkey 供审计，
  //    D-z8：不落任何买家身份字段）。
  const payload: UnlockTokenPayload = {
    v: 1,
    tier: resolved.tier,
    exp,
    iat: deps.nowSec,
    ch: "mbd",
  };
  const token = signToken(payload, privateKey);
  const nowIso = new Date(deps.nowSec * 1000).toISOString();
  try {
    await db
      .prepare(
        `INSERT INTO orders (id, channel, ext_order_no, amount_cny, tier, months,
           status, token, token_hash, expires_at, plan_id, created_at, paid_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        "mbd",
        orderId,
        result.order.amountCny,
        resolved.tier,
        null,
        "paid",
        token,
        unlockTokenHash(token),
        exp,
        result.order.urlkey,
        nowIso,
        new Date(paidAtSec * 1000).toISOString(),
      )
      .run();
  } catch {
    // UNIQUE 冲突 = 并发兑换首写已落定 → 回读首发 token 保持幂等
    const raced = await selectStoredRow(db, "mbd", orderId);
    const stored = raced === null ? null : parseStoredRow(raced);
    if (stored === null) {
      return fail(
        "already_redeemed_conflict",
        "该订单已兑换过，但存量记录异常，请邮件联系作者处理。",
      );
    }
    return {
      ok: true,
      token: stored.token,
      tier: stored.tier,
      expiresAt: stored.exp,
    };
  }
  return { ok: true, token, tier: resolved.tier, expiresAt: exp };
}
