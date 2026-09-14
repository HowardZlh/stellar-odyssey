/**
 * 人工渠道兑换邮件 mailto 拼装（Z 迭代 M3 引入；微信赞赏码下线后仅
 * /unlock 页 Ko-fi 小节消费）
 *
 * 文案本体在 i18n 字典（`unlock.emailSubject` / `unlock.mailTplBody`，
 * {email} 由 CONTACT_EMAIL 同源常量插值）；本模块只做纯函数拼装：
 * mailto 预填链接（subject/body URL 编码，对齐 stock 6093826 mailto_url）。
 */

/** 预填主题与正文的 mailto 链接 */
export function buildRedeemMailtoHref(
  email: string,
  subject: string,
  body: string,
): string {
  return `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
