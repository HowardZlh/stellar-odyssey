/**
 * 运营通知邮件 MIME 构造纯函数（自动运营第1步，免费发信通道适配）。
 *
 * 通道裁决登记（2026-09-01 实证，探针 Worker stellar-mail-probe）：
 * - 新版 Email Sending（结构化 send() 入参）仅 Workers Paid 可用（Dashboard
 *   付费墙实锤），弃用；
 * - Email Routing（免费）附带的旧版 send_email 绑定仍可用：入参为
 *   `EmailMessage(from, to, rawMime)`（cloudflare:email），限制为**只能发到
 *   已验证目标地址**（Email Routing → 目标地址，需邮件链接确认）——与
 *   「运营通知只发给运营者本人」场景完全匹配；
 * - from 须为已启用 Email Routing 的自有域名地址（ops@guushu.com）；
 * - 实测坑：目标地址在 Worker 部署**之后**才验证的，需重新部署一次
 *   绑定才生效（部署时快照验证状态）。
 *
 * 本文件只做 OpsMailMessage → RFC 5322 原始报文的纯转换（jest 直测）；
 * EmailMessage 构造与绑定调用在 index.ts 壳层适配器（cloudflare:email
 * 动态 import，jest 不触达）。
 */
import type { OpsMailMessage } from "./opsNotify";

/** ASCII 可打印判定（含空格；命中则头部字段无需编码字） */
function isPrintableAscii(value: string): boolean {
  return /^[\x20-\x7e]*$/.test(value);
}

/** UTF-8 → base64（Workers/Node ≥16 均有全局 btoa） */
function utf8ToBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** RFC 2047 B-encoding 编码字（Subject / 显示名等含非 ASCII 时使用） */
export function encodeHeaderWord(value: string): string {
  if (isPrintableAscii(value)) return value;
  return `=?utf-8?B?${utf8ToBase64(value)}?=`;
}

/** base64 正文按 76 字符折行（RFC 2045） */
function wrapBase64(b64: string): string {
  return b64.replace(/(.{76})/g, "$1\r\n");
}

/**
 * OpsMailMessage → RFC 5322 原始报文（纯文本 utf-8 正文，base64 传输编码；
 * Subject/显示名非 ASCII 时按 RFC 2047 编码）。`nowMs` 供 Date 与
 * Message-ID 确定性生成（测试可注入固定时钟）。
 */
export function buildOpsMailRaw(message: OpsMailMessage, nowMs: number): string {
  const fromName = encodeHeaderWord(message.from.name);
  const domain = message.from.email.split("@")[1] ?? "invalid";
  return [
    `From: ${fromName} <${message.from.email}>`,
    `To: <${message.to}>`,
    `Subject: ${encodeHeaderWord(message.subject)}`,
    `Date: ${new Date(nowMs).toUTCString()}`,
    `Message-ID: <ops-${nowMs}@${domain}>`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="utf-8"',
    "Content-Transfer-Encoding: base64",
    "",
    wrapBase64(utf8ToBase64(message.text)),
    "",
  ].join("\r\n");
}
