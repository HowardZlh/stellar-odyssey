/**
 * @jest-environment node
 *
 * 运营邮件 MIME 构造纯函数测试（自动运营第1步，免费发信通道适配）：
 * RFC 5322 头部结构 / RFC 2047 编码字（中文主题与显示名）/ base64 正文
 * 折行与可逆解码 / 确定性时钟注入。
 */
import { buildOpsMailRaw, encodeHeaderWord } from "../opsMime";
import type { OpsMailMessage } from "../opsNotify";

/** 固定时钟：2026-09-01T00:00:00Z */
const NOW_MS = Date.parse("2026-09-01T00:00:00Z");

const BASE_MESSAGE: OpsMailMessage = {
  to: "stevenzearo@163.com",
  from: { email: "ops@guushu.com", name: "Stellar Ops" },
  subject: "[Stellar Ops] 日报 2026-08-31",
  text: "== 漏斗转化 ==\n- 锁定提示曝光：20\n",
};

/** base64 正文解码回读（折行剥离后 UTF-8 逆转换） */
function decodeBody(raw: string): string {
  const body = raw.split("\r\n\r\n")[1] ?? "";
  const b64 = body.replace(/\r\n/g, "");
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

describe("encodeHeaderWord（RFC 2047 B-encoding）", () => {
  it("纯 ASCII 原样返回（零编码开销）", () => {
    expect(encodeHeaderWord("Stellar Ops")).toBe("Stellar Ops");
    expect(encodeHeaderWord("")).toBe("");
  });

  it("含非 ASCII → utf-8 B 编码字（可逆）", () => {
    const encoded = encodeHeaderWord("日报");
    expect(encoded).toMatch(/^=\?utf-8\?B\?[A-Za-z0-9+/=]+\?=$/);
    const b64 = /\?B\?(.+)\?=$/.exec(encoded)![1];
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    expect(new TextDecoder().decode(bytes)).toBe("日报");
  });
});

describe("buildOpsMailRaw（RFC 5322 报文）", () => {
  it("头部结构齐全且值正确（ASCII 显示名不编码、中文主题编码）", () => {
    const raw = buildOpsMailRaw(BASE_MESSAGE, NOW_MS);
    const headers = raw.split("\r\n\r\n")[0].split("\r\n");
    expect(headers).toContain("From: Stellar Ops <ops@guushu.com>");
    expect(headers).toContain("To: <stevenzearo@163.com>");
    expect(headers).toContain(`Date: ${new Date(NOW_MS).toUTCString()}`);
    expect(headers).toContain(`Message-ID: <ops-${NOW_MS}@guushu.com>`);
    expect(headers).toContain("MIME-Version: 1.0");
    expect(headers).toContain('Content-Type: text/plain; charset="utf-8"');
    expect(headers).toContain("Content-Transfer-Encoding: base64");
    const subject = headers.find((h) => h.startsWith("Subject: "))!;
    expect(subject).toMatch(/^Subject: =\?utf-8\?B\?/);
  });

  it("正文 base64 可逆解码回原文（中文 + 换行保留）", () => {
    const raw = buildOpsMailRaw(BASE_MESSAGE, NOW_MS);
    expect(decodeBody(raw)).toBe(BASE_MESSAGE.text);
  });

  it("长正文按 76 字符折行（RFC 2045）", () => {
    const longText = "转化数据 ".repeat(200);
    const raw = buildOpsMailRaw({ ...BASE_MESSAGE, text: longText }, NOW_MS);
    const bodyLines = (raw.split("\r\n\r\n")[1] ?? "").split("\r\n");
    for (const line of bodyLines) {
      expect(line.length).toBeLessThanOrEqual(76);
    }
    expect(decodeBody(raw)).toBe(longText);
  });

  it("非 ASCII 显示名编码为编码字（From 头仍含尖括号地址）", () => {
    const raw = buildOpsMailRaw(
      { ...BASE_MESSAGE, from: { email: "ops@guushu.com", name: "星旅运营" } },
      NOW_MS,
    );
    const from = raw.split("\r\n").find((h) => h.startsWith("From: "))!;
    expect(from).toMatch(/^From: =\?utf-8\?B\?[A-Za-z0-9+/=]+\?= <ops@guushu\.com>$/);
  });

  it("时钟注入确定性：同入参同时钟 → 逐字节一致", () => {
    expect(buildOpsMailRaw(BASE_MESSAGE, NOW_MS)).toBe(
      buildOpsMailRaw(BASE_MESSAGE, NOW_MS),
    );
  });

  it("发件地址缺 @（防御分支）→ Message-ID 域名回退 invalid", () => {
    const raw = buildOpsMailRaw(
      { ...BASE_MESSAGE, from: { email: "broken-address", name: "Ops" } },
      NOW_MS,
    );
    expect(raw).toContain(`Message-ID: <ops-${NOW_MS}@invalid>`);
  });
});
