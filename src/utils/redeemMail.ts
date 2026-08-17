/**
 * 人工渠道兑换邮件模板拼装（Z 迭代 M3，/unlock 与 /donate 两页同源消费）
 *
 * 文案本体在 i18n 字典（`unlock.emailSubject` / `unlock.mailTpl*` 键组，
 * {email} 由 CONTACT_EMAIL 同源常量插值）；本模块只做纯函数拼装：
 * - mailto 预填链接（subject/body URL 编码，对齐 stock 6093826 mailto_url）；
 * - 展示用可复制模板文本（收件人/主题标签行 + 空行 + 正文）。
 * 两页消费同一函数输出，模板不存在第二份副本（同源纪律）。
 */

/** 预填主题与正文的 mailto 链接 */
export function buildRedeemMailtoHref(
  email: string,
  subject: string,
  body: string,
): string {
  return `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/** 展示用可复制邮件模板全文（labels 经 i18n 注入，保持双语） */
export function formatRedeemMailTemplate(params: {
  toLabel: string;
  subjectLabel: string;
  email: string;
  subject: string;
  body: string;
}): string {
  const { toLabel, subjectLabel, email, subject, body } = params;
  return `${toLabel}: ${email}\n${subjectLabel}: ${subject}\n\n${body}`;
}
