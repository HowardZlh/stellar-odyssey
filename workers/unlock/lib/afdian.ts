/**
 * 爱发电开放平台 query-order 验单（REQUIREMENTS_UNLOCK.md §0.6 平移项，
 * 对照 stock_analysis `functions/api/redeem.js` queryAfdianOrder）：
 * MD5 签名 `md5(token + "params" + params_json + "ts" + ts + "user_id" + user_id)`，
 * 响应 `ec===200` 且 `data.list` 内按 out_trade_no 匹配订单。
 *
 * 本模块只做请求构造与响应解析（纯函数，jest 可直测）；
 * 实际 fetch 由 redeem 主流程注入执行。
 */
import { md5hex } from "./md5";

/** 爱发电 query-order 端点 */
export const AFDIAN_QUERY_ORDER_URL = "https://afdian.com/api/open/query-order";

/** 归一化后的订单字段（仅取档位判定所需，防御式解析自 unknown） */
export interface AfdianOrder {
  /** 支付状态（2 = 已支付） */
  readonly status: number;
  /** 实付人民币金额（元） */
  readonly totalAmountCny: number;
  /** 订阅月数（订阅方案单；商品单无意义，默认 1） */
  readonly months: number;
  /** product_type===1（售卖商品单，强制按单件归档防误判） */
  readonly isGoods: boolean;
  /** 商品单购买份数（sku_detail count 合计，默认 1） */
  readonly goodsCount: number;
  /**
   * 商品/订阅方案 plan id（U6 强制归档依据；爱发电把商品与订阅统一
   * 建模为 plan）。防御式：缺失/非字符串归空串（空串永不命中映射）。
   */
  readonly planId: string;
}

/** 验单解析结果三分支 */
export type AfdianQueryResult =
  | { readonly kind: "found"; readonly order: AfdianOrder }
  | { readonly kind: "not_found" }
  | { readonly kind: "upstream_error" };

/** query-order 请求构造（签名算法为爱发电开放平台固定格式） */
export function buildAfdianQueryOrderRequest(
  userId: string,
  token: string,
  orderId: string,
  epochSec: number,
): { url: string; body: string } {
  const params = JSON.stringify({ out_trade_no: orderId });
  const sign = md5hex(`${token}params${params}ts${epochSec}user_id${userId}`);
  return {
    url: AFDIAN_QUERY_ORDER_URL,
    body: JSON.stringify({ user_id: userId, params, ts: epochSec, sign }),
  };
}

/**
 * query-order **分页形态**请求构造（A6-2 退款巡检消费，§0.13 锚点）：
 * params = `{ page }`（按页拉全量订单，最新在前——stock_analysis
 * run_refund_sync 先例）；签名算法与单号形态同族复用。
 */
export function buildAfdianQueryOrderPageRequest(
  userId: string,
  token: string,
  page: number,
  epochSec: number,
): { url: string; body: string } {
  const params = JSON.stringify({ page });
  const sign = md5hex(`${token}params${params}ts${epochSec}user_id${userId}`);
  return {
    url: AFDIAN_QUERY_ORDER_URL,
    body: JSON.stringify({ user_id: userId, params, ts: epochSec, sign }),
  };
}

/** 分页巡检所需的最小订单字段（订单号 + 支付状态） */
export interface AfdianPagedOrder {
  readonly orderId: string;
  /** 支付状态（2 = 已支付；≠2 = 疑似退款/未支付，巡检登记依据） */
  readonly status: number;
}

/** 分页响应解析结果 */
export type AfdianPageResult =
  | { readonly kind: "ok"; readonly orders: readonly AfdianPagedOrder[] }
  | { readonly kind: "upstream_error" };

/**
 * query-order 分页响应解析（防御式）：`ec !== 200` / `data.list` 非数组
 * → upstream_error；条目缺 out_trade_no（非字符串）→ 丢弃该条；
 * status 非法归 NaN（`≠2` 判定按疑似处理由调用方裁决——巡检侧要求
 * KV 存在兑换记录才登记，误报由此收敛）。
 */
export function parseAfdianQueryOrderPageResponse(
  raw: unknown,
): AfdianPageResult {
  if (typeof raw !== "object" || raw === null) return { kind: "upstream_error" };
  const rec = raw as Record<string, unknown>;
  if (rec.ec !== 200) return { kind: "upstream_error" };
  const data = rec.data;
  if (typeof data !== "object" || data === null) {
    return { kind: "upstream_error" };
  }
  const list = (data as Record<string, unknown>).list;
  if (!Array.isArray(list)) return { kind: "upstream_error" };
  const orders: AfdianPagedOrder[] = [];
  for (const item of list) {
    if (typeof item !== "object" || item === null) continue;
    const o = item as Record<string, unknown>;
    if (typeof o.out_trade_no !== "string" || o.out_trade_no === "") continue;
    orders.push({ orderId: o.out_trade_no, status: Number(o.status) });
  }
  return { kind: "ok", orders };
}

/** 商品单份数解析：sku_detail 各项 count 合计（缺失/非法回退 1） */
function parseGoodsCount(skuDetail: unknown): number {
  if (!Array.isArray(skuDetail)) return 1;
  let total = 0;
  for (const sku of skuDetail) {
    if (typeof sku !== "object" || sku === null) continue;
    const count = Number((sku as Record<string, unknown>).count);
    if (Number.isFinite(count) && count >= 1) total += Math.floor(count);
  }
  return total >= 1 ? total : 1;
}

/**
 * query-order 响应解析（防御式，任何形状异常归 upstream_error）：
 * - `ec !== 200` 或 `data.list` 非数组 → upstream_error；
 * - list 内无 out_trade_no 匹配项 → not_found；
 * - 匹配项字段归一化（金额/月数/商品单份数缺省防御）。
 */
export function parseAfdianQueryOrderResponse(
  raw: unknown,
  orderId: string,
): AfdianQueryResult {
  if (typeof raw !== "object" || raw === null) return { kind: "upstream_error" };
  const rec = raw as Record<string, unknown>;
  if (rec.ec !== 200) return { kind: "upstream_error" };
  const data = rec.data;
  if (typeof data !== "object" || data === null) {
    return { kind: "upstream_error" };
  }
  const list = (data as Record<string, unknown>).list;
  if (!Array.isArray(list)) return { kind: "upstream_error" };

  const match = list.find(
    (o) =>
      typeof o === "object" &&
      o !== null &&
      (o as Record<string, unknown>).out_trade_no === orderId,
  ) as Record<string, unknown> | undefined;
  if (match === undefined) return { kind: "not_found" };

  const amount = parseFloat(String(match.total_amount ?? "0"));
  const rawMonths = parseInt(String(match.month ?? "1"), 10);
  return {
    kind: "found",
    order: {
      status: Number(match.status),
      totalAmountCny: Number.isFinite(amount) ? amount : 0,
      months: Number.isFinite(rawMonths) && rawMonths >= 1 ? rawMonths : 1,
      // product_type: 0=订阅方案, 1=售卖商品（爱发电开放平台订单字段）
      isGoods: String(match.product_type ?? "0") === "1",
      goodsCount: parseGoodsCount(match.sku_detail),
      planId: typeof match.plan_id === "string" ? match.plan_id : "",
    },
  };
}
