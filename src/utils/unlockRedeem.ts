/**
 * /unlock 解锁页兑换纯逻辑（U3，REQUIREMENTS_UNLOCK.md §U3-2 / §0.5）
 *
 * 页面侧可单测的纯函数收口：订单号前端校验、`/api/redeem` 响应解析、
 * 错误码 → i18n 键映射、API 基址解析、到期日/token 验签失败提示格式化。
 * 全部函数防御式（任何非法输入不抛未捕获异常）。
 *
 * API 基址机制（登记）：生产默认 `https://stellar.guushu.com`；dev 联调
 * 经构建期环境变量 `NEXT_PUBLIC_UNLOCK_API_BASE` 覆写（如 wrangler dev 的
 * `http://127.0.0.1:8787`）。静态导出下 NEXT_PUBLIC_* 于构建期内联，
 * 正式产物勿设该变量。
 */
import type { MessageKey } from "@/i18n";
import type { UnlockTier } from "@/data/unlockPricing";
import type { Locale } from "@/types";

/** Worker 兑换端点路径（§0.5 冻结契约） */
export const REDEEM_API_PATH = "/api/redeem";

/** 生产 API 基址（§0.5：Worker 以路由形态挂 stellar.guushu.com/api/*） */
export const REDEEM_API_DEFAULT_BASE = "https://stellar.guushu.com";

/**
 * 解析兑换 API 完整 URL：`base` 缺省/空白回退生产基址；尾部斜杠归一。
 *
 * @param baseOverride 构建期 `NEXT_PUBLIC_UNLOCK_API_BASE`（页面侧传入）
 */
export function resolveRedeemApiUrl(baseOverride?: string | null): string {
  const trimmed = baseOverride?.trim() ?? "";
  const base =
    trimmed === "" ? REDEEM_API_DEFAULT_BASE : trimmed.replace(/\/+$/, "");
  return `${base}${REDEEM_API_PATH}`;
}

/** 爱发电订单号前端校验（§0.5：14-40 位纯数字） */
export function isValidAfdianOrderId(orderId: string): boolean {
  return /^\d{14,40}$/.test(orderId);
}

/** §0.5 契约错误码（v1.1 含 U6 plan_not_eligible）→ i18n 键（未知码回退通用错误） */
export function redeemErrorMessageKey(code: string): MessageKey {
  switch (code) {
    case "invalid_order":
      return "unlock.errInvalidOrder";
    case "order_not_paid":
      return "unlock.errOrderNotPaid";
    case "amount_too_low":
      return "unlock.errAmountTooLow";
    case "already_redeemed_conflict":
      return "unlock.errAlreadyRedeemed";
    case "upstream_error":
      return "unlock.errUpstream";
    case "not_configured":
      return "unlock.errNotConfigured";
    case "plan_not_eligible":
      return "unlock.errPlanNotEligible";
    default:
      return "unlock.errUnknown";
  }
}

/** verifyToken 拒绝原因 → 提示 i18n 键（格式/签名/过期分开提示，§U3-2） */
export function tokenErrorMessageKey(
  reason: "format" | "signature" | "expired",
): MessageKey {
  switch (reason) {
    case "format":
      return "unlock.tokenErrFormat";
    case "signature":
      return "unlock.tokenErrSignature";
    case "expired":
      return "unlock.tokenErrExpired";
  }
}

/** `/api/redeem` 成功响应（§0.5 冻结契约） */
export interface RedeemSuccess {
  readonly ok: true;
  readonly token: string;
  readonly tier: UnlockTier;
  readonly expiresAt: number;
}

/** `/api/redeem` 失败响应（§0.5 冻结契约） */
export interface RedeemFailure {
  readonly ok: false;
  readonly error: string;
}

/**
 * 响应体解析（unknown → 契约类型）：形状不符返回 null（页面侧按
 * `errUnknown` 提示）；防御各字段类型逐项校验。
 */
export function parseRedeemResponse(
  raw: unknown,
): RedeemSuccess | RedeemFailure | null {
  if (typeof raw !== "object" || raw === null) return null;
  const rec = raw as Record<string, unknown>;
  if (rec.ok === true) {
    const { token, tier, expiresAt } = rec;
    if (typeof token !== "string" || token === "") return null;
    if (tier !== "week" && tier !== "month" && tier !== "year") return null;
    if (typeof expiresAt !== "number" || !Number.isFinite(expiresAt)) {
      return null;
    }
    return { ok: true, token, tier, expiresAt };
  }
  if (rec.ok === false) {
    return { ok: false, error: typeof rec.error === "string" ? rec.error : "" };
  }
  return null;
}

/**
 * 到期日展示格式化（epoch 秒 → 本地日期串）：zh → `2026/8/12` 风格
 * （zh-CN locale），en → `8/12/2026`（en-US）；非法输入返回空串。
 */
export function formatExpiryDate(expSec: number, locale: Locale): string {
  if (!Number.isFinite(expSec)) return "";
  return new Date(expSec * 1000).toLocaleDateString(
    locale === "zh" ? "zh-CN" : "en-US",
  );
}
