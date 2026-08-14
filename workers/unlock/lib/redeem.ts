/**
 * `/api/redeem` 主流程纯逻辑（REQUIREMENTS_UNLOCK.md §U4-1，响应契约 §0.5）。
 *
 * 依赖全部注入（KV/fetch/secrets/时钟），jest 可直测；Response 构造留给
 * `workers/unlock/index.ts` 薄壳。
 *
 * 流程（§0.6 自 stock_analysis redeem.js 平移 + 三档改造）：
 *   订单号正则（不合法即拒，零 KV 访问）
 *   → KV 读 `order:<订单号>`（命中 → 幂等返回存量 token）
 *   → 爱发电 query-order 验单（status!==2 → order_not_paid）
 *   → 档位判定（U6 plan_id 映射强制归档优先；映射未全配置回退
 *     商品单按单件归档防误判 + resolveTierFromAmount 金额链）
 *   → exp = 订单号前 14 位下单时间 + 档位天数
 *   → Ed25519 签发（与 U1 verifyToken 同一编码路径 signToken）
 *   → KV 写 `order:<订单号>`（永久，幂等重兑依据）
 *
 * 防写额度攻击（§U4-1 硬约束）：全部快速失败路径零 KV 写；
 * 正则不合法路径连 KV 读都没有。
 */
import {
  resolveTierFromAmount,
  UNLOCK_TIERS,
  type UnlockTier,
} from "../../../src/data/unlockPricing";
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

/** KV 结构化最小接口（生产 = CF KVNamespace，测试 = jest mock） */
export interface UnlockKvLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
}

/** fetch 结构化最小接口（生产 = 全局 fetch，测试 = fixture mock） */
export type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
  },
) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

/** Worker secrets（未配置项为 undefined，触发 not_configured 降级） */
export interface RedeemSecrets {
  readonly afdianUserId?: string;
  readonly afdianToken?: string;
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
  readonly kv: UnlockKvLike | null;
  readonly fetchFn: FetchLike;
  readonly secrets: RedeemSecrets;
  /** 当前 epoch 秒（token iat 与爱发电签名 ts 共用） */
  readonly nowSec: number;
  /** 档位 plan_id 映射（U6，env vars 注入） */
  readonly planTiers: PlanTierMapping;
}

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

/** KV 存量兑换记录（`order:<订单号>` 的 JSON 值） */
interface StoredRedemption {
  readonly token: string;
  readonly tier: UnlockTier;
  readonly exp: number;
}

/** KV 存量记录防御式解析（形状异常返回 null → already_redeemed_conflict） */
function parseStoredRedemption(raw: string): StoredRedemption | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const rec = parsed as Record<string, unknown>;
  const { token, tier, exp } = rec;
  if (typeof token !== "string" || token === "") return null;
  if (tier !== "week" && tier !== "month" && tier !== "year") return null;
  if (typeof exp !== "number" || !Number.isFinite(exp)) return null;
  return { token, tier, exp };
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

/** `/api/redeem` 主流程（响应恒为 §0.5 契约体，HTTP 层恒 200） */
export async function handleRedeem(
  orderIdRaw: unknown,
  deps: RedeemDeps,
): Promise<RedeemBody> {
  // 1. 订单号格式校验——不合法即拒，零 KV 访问（防写额度攻击）
  const orderId = typeof orderIdRaw === "string" ? orderIdRaw.trim() : "";
  if (!ORDER_ID_RE.test(orderId)) {
    return fail("invalid_order", "订单号格式不正确，请核对后重试。");
  }

  // 2. 配置检查——Secrets/KV 未配置友好降级，不抛 500
  const { afdianUserId, afdianToken, ed25519PrivateKeyHex } = deps.secrets;
  const notConfigured = fail(
    "not_configured",
    "兑换服务尚未配置完成，请稍后重试或邮件联系作者。",
  );
  if (!afdianUserId || !afdianToken || !ed25519PrivateKeyHex || !deps.kv) {
    return notConfigured;
  }
  const privateKey = hexToBytes(ed25519PrivateKeyHex);
  if (privateKey === null || privateKey.length !== 32) return notConfigured;

  // 3. KV 幂等读——已兑换订单直接返回首发 token
  const kvKey = `order:${orderId}`;
  const storedRaw = await deps.kv.get(kvKey);
  if (storedRaw !== null) {
    const stored = parseStoredRedemption(storedRaw);
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

  // 5. 档位判定（U6：映射全配置态下未命中 → plan_not_eligible，零 KV 写）
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

  // 7. Ed25519 签发（U1 同一编码路径）+ KV 落账（每笔兑换恰 1 次写）
  const payload: UnlockTokenPayload = {
    v: 1,
    tier: resolved.tier,
    exp,
    iat: deps.nowSec,
    ch: "afdian",
  };
  const token = signToken(payload, privateKey);
  // planId 为审计字段（U6：排查哪笔兑换来自哪个商品）；
  // parseStoredRedemption 只解构 token/tier/exp，存量老记录无此字段不受影响
  await deps.kv.put(
    kvKey,
    JSON.stringify({ token, tier: resolved.tier, exp, planId: result.order.planId }),
  );
  return { ok: true, token, tier: resolved.tier, expiresAt: exp };
}
