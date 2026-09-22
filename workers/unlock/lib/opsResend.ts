/**
 * 运营通知邮件 → Resend HTTP API 适配（2026-09-22 起替代 Email Routing
 * `send_email` 绑定）。
 *
 * 换通道原因：`send_email` 绑定要求 Worker 与发件域 zone（guushu.com）在
 * 同一 Cloudflare 账号；stellar 全部资源迁到独立账号 D 后该绑定不可用。
 * Resend 发件域 `mail.guushu.com` 已验证（DKIM / return-path 记录在 zone A），
 * 免费 3000 封/月、100 封/天，运营通知每日 ≤ 8 封远在额度内。
 *
 * 本文件：请求体纯构造 `buildResendBody`（jest 直测）+ mailer 工厂
 * `resendMailerOf`（fetch 注入，非 2xx 抛错 → opsNotify 回滚抢占）。
 */
import type { OpsMailerLike, OpsMailMessage } from "./opsNotify";

export const RESEND_API_URL = "https://api.resend.com/emails";

/** Resend `POST /emails` 请求体（纯文本；显示名来自 message.from.name） */
export interface ResendBody {
  readonly from: string;
  readonly to: readonly string[];
  readonly subject: string;
  readonly text: string;
}

export function buildResendBody(message: OpsMailMessage): ResendBody {
  return {
    from: `${message.from.name} <${message.from.email}>`,
    to: [message.to],
    subject: message.subject,
    text: message.text,
  };
}

/** fetch 最小面（生产 = 全局 fetch，测试 = mock） */
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number }>;

/**
 * apiKey 缺失 → null（通知层 not_configured 降级，与旧绑定缺失语义一致）。
 */
export function resendMailerOf(
  apiKey: string | undefined,
  fetchFn: FetchLike,
): OpsMailerLike | null {
  if (!apiKey) return null;
  return {
    async send(message) {
      const res = await fetchFn(RESEND_API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(buildResendBody(message)),
      });
      if (!res.ok) throw new Error(`resend_http_${res.status}`);
      return res;
    },
  };
}
