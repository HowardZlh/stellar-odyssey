/**
 * unlockRedeem 纯逻辑单测（U3）：订单号校验 / 错误码映射 / API 基址 /
 * 响应解析 / 到期日格式化 / token 拒绝原因映射，全分支覆盖。
 */
import {
  REDEEM_API_DEFAULT_BASE,
  REDEEM_API_PATH,
  formatExpiryDate,
  isValidAfdianOrderId,
  parseRedeemResponse,
  redeemErrorMessageKey,
  resolveRedeemApiUrl,
  tokenErrorMessageKey,
} from "@/utils/unlockRedeem";
import { UNLOCK_PAGE_PATH } from "@/utils/unlockPage";
import { UNLOCK_PUBLIC_KEY_HEX } from "@/data/unlockPublicKey";
import { t } from "@/i18n";

describe("UNLOCK_PAGE_PATH（U3-1 路径常量）", () => {
  it("为 /unlock", () => {
    expect(UNLOCK_PAGE_PATH).toBe("/unlock");
  });
});

describe("UNLOCK_PUBLIC_KEY_HEX（§0.5 内嵌验签公钥）", () => {
  it("为 32 字节 Ed25519 公钥 hex（64 位十六进制）", () => {
    expect(UNLOCK_PUBLIC_KEY_HEX).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("resolveRedeemApiUrl（API 基址机制）", () => {
  it("缺省/空白回退生产基址", () => {
    expect(resolveRedeemApiUrl()).toBe(
      `${REDEEM_API_DEFAULT_BASE}${REDEEM_API_PATH}`,
    );
    expect(resolveRedeemApiUrl(undefined)).toBe(
      "https://stellar.guushu.com/api/redeem",
    );
    expect(resolveRedeemApiUrl(null)).toBe(
      "https://stellar.guushu.com/api/redeem",
    );
    expect(resolveRedeemApiUrl("")).toBe(
      "https://stellar.guushu.com/api/redeem",
    );
    expect(resolveRedeemApiUrl("   ")).toBe(
      "https://stellar.guushu.com/api/redeem",
    );
  });

  it("覆写基址（wrangler dev 本地联调）并归一尾部斜杠", () => {
    expect(resolveRedeemApiUrl("http://127.0.0.1:8787")).toBe(
      "http://127.0.0.1:8787/api/redeem",
    );
    expect(resolveRedeemApiUrl("http://127.0.0.1:8787/")).toBe(
      "http://127.0.0.1:8787/api/redeem",
    );
    expect(resolveRedeemApiUrl("http://127.0.0.1:8787//")).toBe(
      "http://127.0.0.1:8787/api/redeem",
    );
  });
});

describe("isValidAfdianOrderId（14-40 位数字）", () => {
  it("合法：14 位与 40 位边界", () => {
    expect(isValidAfdianOrderId("2".repeat(14))).toBe(true);
    expect(isValidAfdianOrderId("2".repeat(40))).toBe(true);
    expect(isValidAfdianOrderId("20260812123456789012")).toBe(true);
  });

  it("非法：位数不足/超长/非数字/空串/含空白", () => {
    expect(isValidAfdianOrderId("2".repeat(13))).toBe(false);
    expect(isValidAfdianOrderId("2".repeat(41))).toBe(false);
    expect(isValidAfdianOrderId("2026081212345a7890")).toBe(false);
    expect(isValidAfdianOrderId("")).toBe(false);
    expect(isValidAfdianOrderId(" 20260812123456789012 ")).toBe(false);
    expect(isValidAfdianOrderId("2026-0812-1234-5678")).toBe(false);
  });
});

describe("redeemErrorMessageKey（§0.5 全部错误码 → i18n 键）", () => {
  it.each([
    ["invalid_order", "unlock.errInvalidOrder"],
    ["order_not_paid", "unlock.errOrderNotPaid"],
    ["amount_too_low", "unlock.errAmountTooLow"],
    ["already_redeemed_conflict", "unlock.errAlreadyRedeemed"],
    ["upstream_error", "unlock.errUpstream"],
    ["not_configured", "unlock.errNotConfigured"],
  ] as const)("%s → %s", (code, key) => {
    expect(redeemErrorMessageKey(code)).toBe(key);
  });

  it("未知码回退通用错误键", () => {
    expect(redeemErrorMessageKey("some_future_code")).toBe("unlock.errUnknown");
    expect(redeemErrorMessageKey("")).toBe("unlock.errUnknown");
  });

  it("全部映射键在 zh/en 字典均有非空文案", () => {
    const keys = [
      "invalid_order",
      "order_not_paid",
      "amount_too_low",
      "already_redeemed_conflict",
      "upstream_error",
      "not_configured",
      "unknown",
    ].map((code) => redeemErrorMessageKey(code));
    for (const key of keys) {
      expect(t("zh", key)).not.toBe(key);
      expect(t("en", key)).not.toBe(key);
    }
  });
});

describe("tokenErrorMessageKey（格式/签名/过期分开提示）", () => {
  it.each([
    ["format", "unlock.tokenErrFormat"],
    ["signature", "unlock.tokenErrSignature"],
    ["expired", "unlock.tokenErrExpired"],
  ] as const)("%s → %s", (reason, key) => {
    expect(tokenErrorMessageKey(reason)).toBe(key);
  });
});

describe("parseRedeemResponse（§0.5 契约响应解析）", () => {
  it("成功响应：各字段合法", () => {
    expect(
      parseRedeemResponse({
        ok: true,
        token: "SO1.a.b",
        tier: "month",
        expiresAt: 1_790_000_000,
      }),
    ).toEqual({
      ok: true,
      token: "SO1.a.b",
      tier: "month",
      expiresAt: 1_790_000_000,
    });
  });

  it("成功形状缺陷一律 null（token 空/缺、tier 非法、expiresAt 非有限数）", () => {
    const base = {
      ok: true,
      token: "SO1.a.b",
      tier: "week",
      expiresAt: 1_790_000_000,
    };
    expect(parseRedeemResponse({ ...base, token: "" })).toBeNull();
    expect(parseRedeemResponse({ ...base, token: 123 })).toBeNull();
    expect(parseRedeemResponse({ ...base, tier: "decade" })).toBeNull();
    expect(parseRedeemResponse({ ...base, expiresAt: NaN })).toBeNull();
    expect(parseRedeemResponse({ ...base, expiresAt: "soon" })).toBeNull();
    expect(parseRedeemResponse({ ok: true })).toBeNull();
  });

  it("失败响应：error 透传；非字符串 error 降级空串", () => {
    expect(
      parseRedeemResponse({ ok: false, error: "order_not_paid" }),
    ).toEqual({ ok: false, error: "order_not_paid" });
    expect(parseRedeemResponse({ ok: false })).toEqual({ ok: false, error: "" });
    expect(parseRedeemResponse({ ok: false, error: 42 })).toEqual({
      ok: false,
      error: "",
    });
  });

  it("非对象/ok 字段非法一律 null", () => {
    expect(parseRedeemResponse(null)).toBeNull();
    expect(parseRedeemResponse(undefined)).toBeNull();
    expect(parseRedeemResponse("ok")).toBeNull();
    expect(parseRedeemResponse(42)).toBeNull();
    expect(parseRedeemResponse({})).toBeNull();
    expect(parseRedeemResponse({ ok: "true" })).toBeNull();
  });
});

describe("formatExpiryDate（到期日展示）", () => {
  // 2026-08-12T00:00:00Z 附近的固定时刻
  const EXP_SEC = 1_786_800_000;

  it("zh → zh-CN 本地日期串、en → en-US", () => {
    const expected = new Date(EXP_SEC * 1000);
    expect(formatExpiryDate(EXP_SEC, "zh")).toBe(
      expected.toLocaleDateString("zh-CN"),
    );
    expect(formatExpiryDate(EXP_SEC, "en")).toBe(
      expected.toLocaleDateString("en-US"),
    );
  });

  it("非法输入返回空串", () => {
    expect(formatExpiryDate(NaN, "zh")).toBe("");
    expect(formatExpiryDate(Infinity, "en")).toBe("");
  });
});
