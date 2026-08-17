/**
 * 支付宝测试密钥工具（Z 迭代 M2；自 stock_analysis
 * `tests/js/helpers/alipay_keys.mjs` 直译 TS）。
 *
 * 纪律：密钥全部为测试内临时生成，**禁止出现任何真实密钥**。
 * 两对密钥模拟真实拓扑：
 *   merchant 对：私钥配置在服务端（ALIPAY_PRIVATE_KEY），用于请求签名；
 *   alipay 对：  私钥仅存在于测试中扮演支付宝网关签发响应/通知，
 *                公钥配置在服务端（ALIPAY_PUBLIC_KEY）用于验签。
 */
import { createSign, generateKeyPairSync } from "node:crypto";

export interface TestKeyPair {
  readonly privatePem: string;
  readonly publicPem: string;
}

export function genKeyPair(): TestKeyPair {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  return {
    privatePem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
}

/** SHA256withRSA（RSA2）签名，输出 base64 — 扮演支付宝侧签名 */
export function rsa2SignNode(content: string, privatePem: string): string {
  return createSign("RSA-SHA256")
    .update(content, "utf8")
    .sign(privatePem, "base64");
}

/** 按官方口径（排序/跳空值/k=v&）拼签名串 — 供测试侧构造合法通知 */
export function signContentOf(
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

/** 构造一条已签名的异步通知表单体（application/x-www-form-urlencoded） */
export function buildNotifyBody(
  fields: Record<string, string>,
  alipayPrivatePem: string,
): string {
  const params: Record<string, string> = { ...fields, sign_type: "RSA2" };
  const v1: Record<string, string> = { ...params };
  delete v1.sign_type; // rsaCheckV1 口径：sign_type 不参与签名
  params.sign = rsa2SignNode(signContentOf(v1), alipayPrivatePem);
  return new URLSearchParams(params).toString();
}

export interface GatewayCall {
  readonly url: string;
  readonly method: string;
  readonly biz: Record<string, unknown>;
  readonly form: URLSearchParams;
}

export interface GatewayStub {
  readonly calls: GatewayCall[];
  restore(): void;
}

/**
 * 构造带合法签名的网关响应 fetch 打桩：
 * handler(bizContent, method) → 业务节点对象；节点原文由 alipay 私钥签名。
 */
export function stubGateway(
  alipayPrivatePem: string,
  handler: (
    biz: Record<string, unknown>,
    method: string,
  ) => Record<string, unknown>,
): GatewayStub {
  const orig = globalThis.fetch;
  const calls: GatewayCall[] = [];
  globalThis.fetch = (async (
    url: unknown,
    opts: { body?: string } | undefined,
  ) => {
    const form = new URLSearchParams(opts?.body ?? "");
    const method = form.get("method") ?? "";
    const biz = JSON.parse(form.get("biz_content") ?? "{}") as Record<
      string,
      unknown
    >;
    calls.push({ url: String(url), method, biz, form });
    const node = handler(biz, method);
    const nodeRaw = JSON.stringify(node);
    const key = `${method.replace(/\./g, "_")}_response`;
    const sign = rsa2SignNode(nodeRaw, alipayPrivatePem);
    const text = `{"${key}":${nodeRaw},"sign":"${sign}"}`;
    return { ok: true, text: async () => text };
  }) as unknown as typeof fetch;
  return {
    calls,
    restore: (): void => {
      globalThis.fetch = orig;
    },
  };
}
