/**
 * 支付宝开放平台网关封装（Z 迭代 M2，REQUIREMENTS_ALIPAY_UNLOCK.md §2；
 * 自 stock_analysis `functions/_alipay.js`（提交 126eabe，已真机验收）
 * 直译为 TS——字段名/拼串口径/验签策略零发明，勿凭记忆改动）。
 *
 * 签名模式：普通公钥 RSA2（SHA256withRSA，裁决 D1），WebCrypto
 * RSASSA-PKCS1-v1_5 原生实现，零 npm 依赖（Worker 内签名耗时 ~1ms）。
 *
 * 字段与规则均已由 stock 逐字段核对官方 SDK 源码（opendocs 为 SPA 无法直读）：
 *   - 公共请求参数/常量：alipay-sdk-java-all AlipayConstants.java
 *     （app_id/method/format/charset/sign_type/timestamp/version/notify_url/
 *      biz_content，时间格式 yyyy-MM-dd HH:mm:ss GMT+8）
 *   - 请求签名：AlipaySignature.getSignContent — 按 key 排序、跳过空值、
 *     k=v 以 & 拼接后 RSA2 签名
 *   - 同步响应验签：AlipaySignature.extractSignContent /
 *     alipay-sdk-nodejs-all getSignStr — 提取 `<method>_response` 节点原文
 *     （大括号配对、引号/转义感知）对 sign 验签
 *   - 异步通知验签：AlipaySignature.rsaCheckV1（排除 sign/sign_type）与
 *     alipay-sdk-nodejs-all checkNotifySignV2（保留 sign_type）双口径，
 *     先 V1 后 V2 各验一次（与官方 Node SDK 兼容策略一致）
 *
 * 密钥形态（D-z9）：应用私钥 PKCS#8 PEM（Secret ALIPAY_PRIVATE_KEY），
 * 支付宝公钥 SPKI PEM（Secret ALIPAY_PUBLIC_KEY，非应用公钥）。
 */

export const ALIPAY_GATEWAY = "https://openapi.alipay.com/gateway.do";

/** 网关调用所需 env 面（Worker secrets/vars 注入；缺省由调用方降级） */
export interface AlipayEnv {
  readonly ALIPAY_APP_ID?: string;
  readonly ALIPAY_PRIVATE_KEY?: string;
  readonly ALIPAY_PUBLIC_KEY?: string;
}

/** 网关调用结果（业务失败 code != 10000 时 ok=false，error 透出可读信息） */
export interface AlipayCallResult {
  readonly ok: boolean;
  readonly data?: Record<string, unknown>;
  readonly error?: string;
}

// ---------------------------------------------------------------------------
// PEM / base64 工具
// ---------------------------------------------------------------------------
function pemToBytes(pem: string): Uint8Array {
  const b64 = String(pem || "")
    .replace(/-----[^-]+-----/g, "")
    .replace(/\s+/g, "");
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf;
}

function bufToB64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function b64ToBuf(b64: string): Uint8Array {
  const bin = atob(String(b64 || ""));
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf;
}

// ---------------------------------------------------------------------------
// RSA2（SHA256withRSA）签名 / 验签
// ---------------------------------------------------------------------------
export async function rsa2Sign(
  content: string,
  privateKeyPem: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToBytes(privateKeyPem) as unknown as ArrayBuffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(content),
  );
  return bufToB64(sig);
}

export async function rsa2Verify(
  content: string,
  signB64: string,
  publicKeyPem: string,
): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey(
      "spki",
      pemToBytes(publicKeyPem) as unknown as ArrayBuffer,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    return await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      b64ToBuf(signB64) as unknown as ArrayBuffer,
      new TextEncoder().encode(content),
    );
  } catch {
    return false; // 签名/密钥格式非法一律视为验签失败
  }
}

// ---------------------------------------------------------------------------
// 签名串组装（排序 + 跳过空值 + k=v&，官方 getSignContent 口径）
// ---------------------------------------------------------------------------
export function buildSignContent(
  params: Record<string, string | undefined | null>,
): string {
  return Object.keys(params)
    .filter(
      (k) =>
        k !== "sign" &&
        params[k] !== undefined &&
        params[k] !== null &&
        params[k] !== "",
    )
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");
}

/** 公共参数 timestamp：yyyy-MM-dd HH:mm:ss（GMT+8，AlipayConstants.DATE_TIMEZONE） */
export function gmt8Timestamp(now: Date = new Date()): string {
  const t = new Date(now.getTime() + 8 * 3600 * 1000);
  return t.toISOString().slice(0, 19).replace("T", " ");
}

// ---------------------------------------------------------------------------
// 同步响应验签原文提取：`<method>_response` 节点的原始 JSON 子串
// （大括号配对 + 引号/转义感知，对齐官方 extractSignContent）
// ---------------------------------------------------------------------------
export function extractResponseRaw(
  text: string,
  responseKey: string,
): string | null {
  const keyIdx = String(text || "").indexOf(`"${responseKey}"`);
  if (keyIdx < 0) return null;
  const start = text.indexOf("{", keyIdx + responseKey.length + 2);
  if (start < 0) return null;
  let depth = 0;
  let inQuotes = false;
  let escapes = 0;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"' && escapes % 2 === 0) inQuotes = !inQuotes;
    else if (ch === "{" && !inQuotes) depth++;
    else if (ch === "}" && !inQuotes) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
    escapes = ch === "\\" ? escapes + 1 : 0;
  }
  return null;
}

// ---------------------------------------------------------------------------
// 异步通知验签（安全核心）：先按 rsaCheckV1（排除 sign/sign_type），
// 失败再按保留 sign_type 口径重验一次（官方 Node SDK 兼容策略）
// ---------------------------------------------------------------------------
export async function verifyNotifySign(
  params: Record<string, string>,
  publicKeyPem: string,
): Promise<boolean> {
  const sign = params.sign;
  if (!sign) return false;
  const v1: Record<string, string> = { ...params };
  delete v1.sign;
  delete v1.sign_type;
  if (await rsa2Verify(buildSignContent(v1), sign, publicKeyPem)) return true;
  const v2: Record<string, string> = { ...params };
  delete v2.sign;
  return rsa2Verify(buildSignContent(v2), sign, publicKeyPem);
}

// ---------------------------------------------------------------------------
// 网关调用：组公共参数 → RSA2 签名 → POST 表单 → 提取响应节点原文验签
// 返回 { ok, data?, error? }；业务失败（code != 10000）时 ok=false。
// fetch 走全局（stock 平移口径；测试以 stubGateway 替换 globalThis.fetch）。
// ---------------------------------------------------------------------------
export async function alipayCall(
  env: AlipayEnv,
  method: string,
  biz: Record<string, unknown>,
  opts: { notifyUrl?: string } = {},
): Promise<AlipayCallResult> {
  const params: Record<string, string> = {
    app_id: env.ALIPAY_APP_ID ?? "",
    method,
    format: "JSON",
    charset: "utf-8",
    sign_type: "RSA2",
    timestamp: gmt8Timestamp(),
    version: "1.0",
    biz_content: JSON.stringify(biz),
  };
  if (opts.notifyUrl !== undefined) params.notify_url = opts.notifyUrl;
  params.sign = await rsa2Sign(
    buildSignContent(params),
    env.ALIPAY_PRIVATE_KEY ?? "",
  );

  let text: string;
  try {
    const resp = await fetch(ALIPAY_GATEWAY, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=utf-8",
      },
      body: new URLSearchParams(params).toString(),
    });
    text = await resp.text();
  } catch {
    return { ok: false, error: "支付宝网关请求失败，请稍后重试。" };
  }

  const responseKey = `${method.replace(/\./g, "_")}_response`;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { ok: false, error: "支付宝网关响应格式异常。" };
  }
  const node = (parsed[responseKey] ?? parsed.error_response) as
    | Record<string, unknown>
    | undefined;
  if (!node) return { ok: false, error: "支付宝网关响应缺少业务节点。" };

  // 业务失败路径（不下发任何权益）直接透出错误；成功路径必须验签
  if (node.code !== "10000") {
    const msg = `${String(node.msg ?? "")} ${String(node.sub_msg ?? "")}`.trim();
    return { ok: false, error: msg || "支付宝返回业务失败。", data: node };
  }
  const raw = extractResponseRaw(text, responseKey);
  if (
    typeof parsed.sign !== "string" ||
    raw === null ||
    !(await rsa2Verify(raw, parsed.sign, env.ALIPAY_PUBLIC_KEY ?? ""))
  ) {
    return { ok: false, error: "支付宝响应验签失败。" };
  }
  return { ok: true, data: node };
}
