/**
 * 支付宝当面付前端纯逻辑（Z 迭代 M2，REQUIREMENTS_ALIPAY_UNLOCK.md §3/§5.1/D-z5）
 *
 * /unlock 付款 modal 可单测的纯函数收口：create/status 响应解析、错误码 →
 * i18n 键映射、轮询节奏规划（3s → 60s 起带 deep=1 → 5min 起降频 10s →
 * 30min 过期）、昵称/留言前端长度预检。全部函数防御式（非法输入不抛异常）。
 *
 * API 基址与 unlockRedeem 同机制（NEXT_PUBLIC_UNLOCK_API_BASE 覆写）。
 */
import type { MessageKey } from "@/i18n";
import type { UnlockTier } from "@/data/unlockPricing";
import { REDEEM_API_DEFAULT_BASE } from "@/utils/unlockRedeem";

/** Worker 端点路径（M2 契约） */
export const ALIPAY_CREATE_API_PATH = "/api/alipay/create";
export const ALIPAY_STATUS_API_PATH = "/api/alipay/status";

/** 轮询节奏常量（D-z5 + §8 免费额度测算口径，勿改动数值） */
export const ALIPAY_POLL_BASE_MS = 3_000;
export const ALIPAY_POLL_SLOW_MS = 10_000;
export const ALIPAY_POLL_SLOW_AFTER_MS = 5 * 60_000;
export const ALIPAY_DEEP_AFTER_MS = 60_000;
export const ALIPAY_QR_EXPIRE_MS = 30 * 60_000;

/** E3 前端长度预检上限（服务端 textFilter 同源数值，人工同步登记） */
export const ALIPAY_NICKNAME_MAX_LEN = 20;
export const ALIPAY_MESSAGE_MAX_LEN = 50;

/** API 基址解析（unlockRedeem 同机制；path 由本模块常量传入） */
export function resolveAlipayApiUrl(
  path: string,
  baseOverride?: string | null,
): string {
  const trimmed = baseOverride?.trim() ?? "";
  const base =
    trimmed === "" ? REDEEM_API_DEFAULT_BASE : trimmed.replace(/\/+$/, "");
  return `${base}${path}`;
}

/** POST /api/alipay/create 成功响应（Worker M2 契约） */
export interface AlipayCreateSuccess {
  readonly ok: true;
  readonly outTradeNo: string;
  readonly qrCode: string;
  readonly amount: number;
}

/** 失败响应（error 为机器码，message 为服务端中文回退文案） */
export interface AlipayApiFailure {
  readonly ok: false;
  readonly error: string;
}

/** create 响应体解析（形状不符返回 null，页面按 errUnknown 提示） */
export function parseAlipayCreateResponse(
  raw: unknown,
): AlipayCreateSuccess | AlipayApiFailure | null {
  if (typeof raw !== "object" || raw === null) return null;
  const rec = raw as Record<string, unknown>;
  if (rec.ok === true) {
    const outTradeNo = rec.out_trade_no;
    const qrCode = rec.qr_code;
    const amount = rec.amount;
    if (typeof outTradeNo !== "string" || outTradeNo === "") return null;
    if (typeof qrCode !== "string" || qrCode === "") return null;
    if (typeof amount !== "number" || !Number.isFinite(amount)) return null;
    return { ok: true, outTradeNo, qrCode, amount };
  }
  if (rec.ok === false) {
    return { ok: false, error: typeof rec.error === "string" ? rec.error : "" };
  }
  return null;
}

/** GET /api/alipay/status 成功响应（paid 且已发码时附 token/tier/expiresAt） */
export interface AlipayStatusSuccess {
  readonly ok: true;
  readonly status: "pending" | "paid" | "closed" | "refunded";
  readonly token: string | null;
  readonly tier: UnlockTier | null;
  readonly expiresAt: number | null;
}

/** status 响应体解析（形状不符返回 null） */
export function parseAlipayStatusResponse(
  raw: unknown,
): AlipayStatusSuccess | AlipayApiFailure | null {
  if (typeof raw !== "object" || raw === null) return null;
  const rec = raw as Record<string, unknown>;
  if (rec.ok === true) {
    const status = rec.status;
    if (
      status !== "pending" &&
      status !== "paid" &&
      status !== "closed" &&
      status !== "refunded"
    ) {
      return null;
    }
    const token = typeof rec.token === "string" && rec.token !== "" ? rec.token : null;
    const tier =
      rec.tier === "week" || rec.tier === "month" || rec.tier === "year"
        ? rec.tier
        : null;
    const expiresAt =
      typeof rec.expiresAt === "number" && Number.isFinite(rec.expiresAt)
        ? rec.expiresAt
        : null;
    return { ok: true, status, token, tier, expiresAt };
  }
  if (rec.ok === false) {
    return { ok: false, error: typeof rec.error === "string" ? rec.error : "" };
  }
  return null;
}

/** M2 错误机器码 → i18n 键（未知码回退通用错误） */
export function alipayErrorMessageKey(code: string): MessageKey {
  switch (code) {
    case "nickname_too_long":
      return "unlock.alipay.errNicknameTooLong";
    case "nickname_blocked":
      return "unlock.alipay.errNicknameBlocked";
    case "message_too_long":
      return "unlock.alipay.errMessageTooLong";
    case "message_blocked":
      return "unlock.alipay.errMessageBlocked";
    case "not_configured":
      return "unlock.alipay.errNotConfigured";
    case "gateway_error":
      return "unlock.alipay.errGateway";
    case "invalid_order":
    case "order_not_found":
      return "unlock.alipay.errOrderLost";
    default:
      return "unlock.alipay.errUnknown";
  }
}

/** 轮询规划结果 */
export interface AlipayPollPlan {
  /** 已超 30 分钟二维码有效期：停止轮询，提示重新生成 */
  readonly expired: boolean;
  /** 本次轮询带 deep=1（≥60s 仍未支付，服务端实时 trade.query 兜底补发） */
  readonly deep: boolean;
  /** 距下次轮询的间隔毫秒 */
  readonly delayMs: number;
}

/**
 * 轮询节奏规划（D-z5）：3s 基准；≥60s 带 deep=1；≥5min 降频 10s；
 * ≥30min 过期停止。elapsedMs 为距生成付款码的毫秒（非法输入按 0）。
 */
export function planAlipayPoll(elapsedMs: number): AlipayPollPlan {
  const elapsed = Number.isFinite(elapsedMs) && elapsedMs > 0 ? elapsedMs : 0;
  if (elapsed >= ALIPAY_QR_EXPIRE_MS) {
    return { expired: true, deep: false, delayMs: 0 };
  }
  return {
    expired: false,
    deep: elapsed >= ALIPAY_DEEP_AFTER_MS,
    delayMs:
      elapsed >= ALIPAY_POLL_SLOW_AFTER_MS
        ? ALIPAY_POLL_SLOW_MS
        : ALIPAY_POLL_BASE_MS,
  };
}

/** 昵称/留言前端长度预检（code point 计数；服务端仍为最终裁决） */
export function alipayFieldTooLong(value: string, maxLen: number): boolean {
  return [...value.trim()].length > maxLen;
}
