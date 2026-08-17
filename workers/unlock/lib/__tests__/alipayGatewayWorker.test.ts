/**
 * @jest-environment node
 *
 * workers/unlock/lib/alipay.ts — RSA2 签名/验签/拼串/响应原文提取单测
 * （Z 迭代 M2；用例矩阵对照 stock_analysis `tests/js/alipay_sign.test.mjs`）。
 * 密钥全部为测试临时生成（禁止真实密钥）。
 */
import {
  ALIPAY_GATEWAY,
  alipayCall,
  buildSignContent,
  extractResponseRaw,
  gmt8Timestamp,
  rsa2Sign,
  rsa2Verify,
  verifyNotifySign,
} from "../alipay";
import {
  buildNotifyBody,
  genKeyPair,
  rsa2SignNode,
  stubGateway,
} from "./helpers/alipayTestKeys";

const merchant = genKeyPair();
const alipayPair = genKeyPair();

describe("RSA2 签名/验签", () => {
  it("签名/验签往返（WebCrypto ↔ node:crypto 互认）", async () => {
    const content = 'app_id=2021&biz_content={"a":1}&charset=utf-8';
    const sig = await rsa2Sign(content, merchant.privatePem);
    expect(await rsa2Verify(content, sig, merchant.publicPem)).toBe(true);
    // node:crypto 签名 → WebCrypto 验签
    const sig2 = rsa2SignNode(content, alipayPair.privatePem);
    expect(await rsa2Verify(content, sig2, alipayPair.publicPem)).toBe(true);
    // 内容被篡改 → 验签失败
    expect(await rsa2Verify(`${content}x`, sig, merchant.publicPem)).toBe(false);
    // 非法签名不抛异常，返回 false
    expect(await rsa2Verify(content, "!!!", merchant.publicPem)).toBe(false);
  });
});

describe("签名串组装与公共参数", () => {
  it("buildSignContent：排序 + 跳过空值 + 排除 sign", () => {
    const content = buildSignContent({
      method: "alipay.trade.precreate",
      app_id: "2021",
      sign: "x",
      empty: "",
      missing: null,
      biz_content: '{"a":1}',
    });
    expect(content).toBe(
      'app_id=2021&biz_content={"a":1}&method=alipay.trade.precreate',
    );
  });

  it("gmt8Timestamp：yyyy-MM-dd HH:mm:ss（东八区）", () => {
    const ts = gmt8Timestamp(new Date("2026-08-15T16:30:05Z"));
    expect(ts).toBe("2026-08-16 00:30:05"); // UTC+8 跨日
    expect(gmt8Timestamp()).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it("extractResponseRaw：大括号配对 + 引号/转义感知", () => {
    const raw =
      '{"code":"10000","msg":"Success","qr_code":"https://qr.alipay.com/x?a={\\"b\\":1}"}';
    const text = `{"alipay_trade_precreate_response":${raw},"sign":"abc"}`;
    expect(extractResponseRaw(text, "alipay_trade_precreate_response")).toBe(raw);
    expect(extractResponseRaw("{}", "nope_response")).toBeNull();
    // 键存在但无对象体 / 截断文本
    expect(extractResponseRaw('{"a_response":1}', "a_response")).toBeNull();
    expect(
      extractResponseRaw('{"a_response":{"code":"10000"', "a_response"),
    ).toBeNull();
  });
});

describe("verifyNotifySign（异步通知验签，安全核心）", () => {
  const fields = {
    app_id: "2021",
    out_trade_no: "so1",
    trade_no: "T1",
    trade_status: "TRADE_SUCCESS",
    total_amount: "6.00",
    seller_id: "2088",
  };

  it("合法通知通过，伪造/篡改/缺签拒绝", async () => {
    const body = buildNotifyBody(fields, alipayPair.privatePem);
    const params = Object.fromEntries(new URLSearchParams(body));
    expect(await verifyNotifySign(params, alipayPair.publicPem)).toBe(true);
    // 伪造：换一把私钥签
    const forged = Object.fromEntries(
      new URLSearchParams(buildNotifyBody(fields, merchant.privatePem)),
    );
    expect(await verifyNotifySign(forged, alipayPair.publicPem)).toBe(false);
    // 篡改金额
    const tampered = { ...params, total_amount: "0.01" };
    expect(await verifyNotifySign(tampered, alipayPair.publicPem)).toBe(false);
    // 缺 sign
    expect(await verifyNotifySign({ a: "1" }, alipayPair.publicPem)).toBe(false);
  });

  it("V2 口径兜底：sign_type 参与签名的通知同样通过", async () => {
    // 保留 sign_type 拼串签名（checkNotifySignV2 口径）
    const params: Record<string, string> = { ...fields, sign_type: "RSA2" };
    const content = Object.keys(params)
      .sort()
      .map((k) => `${k}=${params[k]}`)
      .join("&");
    params.sign = rsa2SignNode(content, alipayPair.privatePem);
    expect(await verifyNotifySign(params, alipayPair.publicPem)).toBe(true);
  });
});

describe("alipayCall（网关调用）", () => {
  const env = {
    ALIPAY_APP_ID: "2021",
    ALIPAY_PRIVATE_KEY: merchant.privatePem,
    ALIPAY_PUBLIC_KEY: alipayPair.publicPem,
  };

  it("合法响应验签通过 + 公共参数完整（官方 AlipayConstants 字段）", async () => {
    const gw = stubGateway(alipayPair.privatePem, () => ({
      code: "10000",
      msg: "Success",
      qr_code: "https://qr.alipay.com/abc",
    }));
    try {
      const r = await alipayCall(
        env,
        "alipay.trade.precreate",
        { out_trade_no: "so1" },
        { notifyUrl: "https://x/notify" },
      );
      expect(r.ok).toBe(true);
      expect(r.data?.qr_code).toBe("https://qr.alipay.com/abc");
      expect(gw.calls[0].url).toBe(ALIPAY_GATEWAY);
      const form = gw.calls[0].form;
      for (const k of [
        "app_id",
        "method",
        "format",
        "charset",
        "sign_type",
        "timestamp",
        "version",
        "notify_url",
        "biz_content",
        "sign",
      ]) {
        expect(form.get(k)).toBeTruthy();
      }
      expect(form.get("sign_type")).toBe("RSA2");
    } finally {
      gw.restore();
    }
  });

  it("篡改响应节点（签名未变）→ 验签失败", async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = (async () => ({
      ok: true,
      text: async () =>
        '{"alipay_trade_precreate_response":{"code":"10000","qr_code":"https://evil"},"sign":"AAAA"}',
    })) as unknown as typeof fetch;
    try {
      const r = await alipayCall(env, "alipay.trade.precreate", {});
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/验签失败/);
    } finally {
      globalThis.fetch = orig;
    }
  });

  it("业务失败透出错误信息（不验签直接拒发权益）", async () => {
    const gw = stubGateway(alipayPair.privatePem, () => ({
      code: "40004",
      msg: "Business Failed",
      sub_msg: "交易不存在",
    }));
    try {
      const r = await alipayCall(env, "alipay.trade.query", {
        out_trade_no: "x",
      });
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/交易不存在/);
    } finally {
      gw.restore();
    }
  });

  it("网关网络失败/非 JSON/缺业务节点均结构化降级", async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    try {
      expect((await alipayCall(env, "alipay.trade.query", {})).error).toMatch(
        /网关请求失败/,
      );
    } finally {
      globalThis.fetch = orig;
    }

    globalThis.fetch = (async () => ({
      ok: true,
      text: async () => "not json",
    })) as unknown as typeof fetch;
    try {
      expect((await alipayCall(env, "alipay.trade.query", {})).error).toMatch(
        /响应格式异常/,
      );
    } finally {
      globalThis.fetch = orig;
    }

    globalThis.fetch = (async () => ({
      ok: true,
      text: async () => "{}",
    })) as unknown as typeof fetch;
    try {
      expect((await alipayCall(env, "alipay.trade.query", {})).error).toMatch(
        /缺少业务节点/,
      );
    } finally {
      globalThis.fetch = orig;
    }
  });
});
