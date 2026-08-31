/**
 * 面包多（mbd.pub 商店）order-detail 验单适配层（面包多集成，对等
 * lib/afdian.ts：本模块只做请求构造与响应解析——纯函数，jest 可直测；
 * 实际 fetch 由 redeem/refundSync 主流程注入执行）。
 *
 * 接口（面包多开放文档 https://mbd.pub/open_doc/ 「通过订单号获取订单信息」）：
 *   GET https://x.mbd.pub/api/order-detail?order_id=<32 位 hex>
 *   Header `x-token: <开发者key>`（无签名拼串，鉴权仅此一项）
 * 响应：`code` 200 正常 / 400 请求错误（含查无此单）/ 403 认证失败；
 *   `result.state` 'success' 已支付 / 'cancel' 取消支付 / 'invalid' 已过期；
 *   `result.orderamount` 单位**元**（粒度分，注意与面包多Pay 的"分"不同）；
 *   `result.ordertime` 支付时间戳（epoch 秒，权益起算点）；
 *   `result.urlkey` 作品查询 key（对等爱发电 plan_id 的强制归档依据）。
 *
 * 退款状态盲区登记：文档未定义"已退款"态（state 仅三值），退款后
 * state 是否离开 'success' 待首笔真实退款校准——巡检口径 state !== 'success'
 * 只登记疑似（模式 A），运维兜底"先吊销后退款"SOP 见 UNLOCK_OPS。
 */

/** 面包多 order-detail 端点 */
export const MBD_ORDER_DETAIL_URL = "https://x.mbd.pub/api/order-detail";

/** 面包多订单号格式（32 位 hex；接受大小写，查询/落库前经 normalize 小写归一） */
export const MBD_ORDER_ID_RE = /^[0-9a-fA-F]{32}$/;

/** 订单号归一化（trim + 小写——幂等键 ext_order_no 的唯一形态） */
export function normalizeMbdOrderId(orderIdRaw: string): string {
  return orderIdRaw.trim().toLowerCase();
}

/** 归一化后的订单字段（仅取档位判定所需，防御式解析自 unknown） */
export interface MbdOrder {
  /** 支付状态（'success' 已支付；'cancel'/'invalid' 未支付/已过期） */
  readonly state: string;
  /** 实付人民币金额（元；全家桶购买为 0——运营纪律：解锁商品不入全家桶） */
  readonly amountCny: number;
  /** 支付时间戳（epoch 秒；缺失/非法为 null，主流程按 upstream_error 拒绝） */
  readonly paidAtSec: number | null;
  /** 作品查询 key（urlkey 映射强制归档依据；缺失归空串，空串永不命中映射） */
  readonly urlkey: string;
}

/** 验单解析结果三分支（afdian 适配层同构） */
export type MbdQueryResult =
  | { readonly kind: "found"; readonly order: MbdOrder }
  | { readonly kind: "not_found" }
  | { readonly kind: "upstream_error" };

/** order-detail 请求构造（GET + x-token header，无请求体） */
export function buildMbdOrderDetailRequest(
  developerKey: string,
  orderId: string,
): { url: string; headers: Record<string, string> } {
  return {
    url: `${MBD_ORDER_DETAIL_URL}?order_id=${encodeURIComponent(
      normalizeMbdOrderId(orderId),
    )}`,
    headers: { "x-token": developerKey },
  };
}

/**
 * order-detail 响应解析（防御式，任何形状异常归 upstream_error）：
 * - `code === 400` → not_found（请求错误——用户粘贴了查无此单的订单号，
 *   按订单无效提示，不算上游故障）；
 * - `code === 403`（开发者 key 无效——我方配置问题）及其余非 200 /
 *   形状异常 → upstream_error；
 * - `code === 200` → result 字段归一化（state 非字符串归空串 = 未支付
 *   路径；ordertime 非法归 null 由主流程拒绝；urlkey 缺失归空串）。
 */
export function parseMbdOrderDetailResponse(raw: unknown): MbdQueryResult {
  if (typeof raw !== "object" || raw === null) return { kind: "upstream_error" };
  const rec = raw as Record<string, unknown>;
  const code = Number(rec.code);
  if (code === 400) return { kind: "not_found" };
  if (code !== 200) return { kind: "upstream_error" };
  const result = rec.result;
  if (typeof result !== "object" || result === null) {
    return { kind: "upstream_error" };
  }
  const r = result as Record<string, unknown>;
  const amount = Number(r.orderamount);
  const ordertime = Number(r.ordertime);
  return {
    kind: "found",
    order: {
      state: typeof r.state === "string" ? r.state : "",
      amountCny: Number.isFinite(amount) ? amount : 0,
      paidAtSec:
        Number.isFinite(ordertime) && ordertime > 0 ? ordertime : null,
      urlkey: typeof r.urlkey === "string" ? r.urlkey : "",
    },
  };
}
