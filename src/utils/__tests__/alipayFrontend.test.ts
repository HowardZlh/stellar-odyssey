/**
 * src/utils/alipayOrder.ts + src/utils/contributorsFeed.ts —
 * 支付宝付款 modal 与贡献者动态名单前端纯逻辑单测（Z 迭代 M2）。
 */
import {
  ALIPAY_CREATE_API_PATH,
  ALIPAY_DEEP_AFTER_MS,
  ALIPAY_MESSAGE_MAX_LEN,
  ALIPAY_NICKNAME_MAX_LEN,
  ALIPAY_POLL_BASE_MS,
  ALIPAY_POLL_SLOW_AFTER_MS,
  ALIPAY_POLL_SLOW_MS,
  ALIPAY_QR_EXPIRE_MS,
  ALIPAY_STATUS_API_PATH,
  alipayErrorMessageKey,
  alipayFieldTooLong,
  parseAlipayCreateResponse,
  parseAlipayStatusResponse,
  planAlipayPoll,
  resolveAlipayApiUrl,
} from "@/utils/alipayOrder";
import {
  mergeDonorLists,
  parseContributorsResponse,
  remoteContributorsToDonors,
  resolveContributorsApiUrl,
} from "@/utils/contributorsFeed";
import type { DonorRecord } from "@/utils/donors";

describe("resolveAlipayApiUrl / resolveContributorsApiUrl", () => {
  it("缺省回退生产基址；覆写去尾斜杠", () => {
    expect(resolveAlipayApiUrl(ALIPAY_CREATE_API_PATH)).toBe(
      "https://stellar.guushu.com/api/alipay/create",
    );
    expect(
      resolveAlipayApiUrl(ALIPAY_STATUS_API_PATH, "http://127.0.0.1:8787/"),
    ).toBe("http://127.0.0.1:8787/api/alipay/status");
    expect(resolveAlipayApiUrl(ALIPAY_STATUS_API_PATH, "  ")).toBe(
      "https://stellar.guushu.com/api/alipay/status",
    );
    expect(resolveContributorsApiUrl(null)).toBe(
      "https://stellar.guushu.com/api/contributors",
    );
    expect(resolveContributorsApiUrl("http://localhost:8787")).toBe(
      "http://localhost:8787/api/contributors",
    );
  });
});

describe("parseAlipayCreateResponse", () => {
  it("合法成功体 → camelCase 投影", () => {
    expect(
      parseAlipayCreateResponse({
        ok: true,
        out_trade_no: "so123abc",
        qr_code: "https://qr.alipay.com/x",
        amount: 6,
      }),
    ).toEqual({
      ok: true,
      outTradeNo: "so123abc",
      qrCode: "https://qr.alipay.com/x",
      amount: 6,
    });
  });

  it("失败体透传 error；形状不符返回 null", () => {
    expect(
      parseAlipayCreateResponse({ ok: false, error: "nickname_blocked" }),
    ).toEqual({ ok: false, error: "nickname_blocked" });
    expect(parseAlipayCreateResponse({ ok: false })).toEqual({
      ok: false,
      error: "",
    });
    expect(parseAlipayCreateResponse(null)).toBeNull();
    expect(parseAlipayCreateResponse("x")).toBeNull();
    expect(parseAlipayCreateResponse({})).toBeNull();
    expect(
      parseAlipayCreateResponse({ ok: true, out_trade_no: "", qr_code: "q", amount: 6 }),
    ).toBeNull();
    expect(
      parseAlipayCreateResponse({ ok: true, out_trade_no: "so1", qr_code: "", amount: 6 }),
    ).toBeNull();
    expect(
      parseAlipayCreateResponse({
        ok: true,
        out_trade_no: "so1",
        qr_code: "q",
        amount: NaN,
      }),
    ).toBeNull();
  });
});

describe("parseAlipayStatusResponse", () => {
  it("paid 附 token/tier/expiresAt；pending 各字段 null", () => {
    expect(
      parseAlipayStatusResponse({
        ok: true,
        status: "paid",
        token: "SO1.x.y",
        tier: "week",
        expiresAt: 123,
      }),
    ).toEqual({
      ok: true,
      status: "paid",
      token: "SO1.x.y",
      tier: "week",
      expiresAt: 123,
    });
    expect(parseAlipayStatusResponse({ ok: true, status: "pending" })).toEqual({
      ok: true,
      status: "pending",
      token: null,
      tier: null,
      expiresAt: null,
    });
  });

  it("非法 status / 形状不符返回 null；失败体透传", () => {
    expect(
      parseAlipayStatusResponse({ ok: true, status: "unknown" }),
    ).toBeNull();
    expect(parseAlipayStatusResponse(42)).toBeNull();
    expect(parseAlipayStatusResponse({})).toBeNull();
    expect(
      parseAlipayStatusResponse({ ok: false, error: "order_not_found" }),
    ).toEqual({ ok: false, error: "order_not_found" });
  });
});

describe("alipayErrorMessageKey（机器码 → i18n 键）", () => {
  it.each([
    ["nickname_too_long", "unlock.alipay.errNicknameTooLong"],
    ["nickname_blocked", "unlock.alipay.errNicknameBlocked"],
    ["message_too_long", "unlock.alipay.errMessageTooLong"],
    ["message_blocked", "unlock.alipay.errMessageBlocked"],
    ["not_configured", "unlock.alipay.errNotConfigured"],
    ["gateway_error", "unlock.alipay.errGateway"],
    ["invalid_order", "unlock.alipay.errOrderLost"],
    ["order_not_found", "unlock.alipay.errOrderLost"],
    ["whatever_new", "unlock.alipay.errUnknown"],
  ] as const)("%s → %s", (code, key) => {
    expect(alipayErrorMessageKey(code)).toBe(key);
  });
});

describe("planAlipayPoll（D-z5 轮询节奏）", () => {
  it("0~60s：3s 间隔不带 deep", () => {
    expect(planAlipayPoll(0)).toEqual({
      expired: false,
      deep: false,
      delayMs: ALIPAY_POLL_BASE_MS,
    });
    expect(planAlipayPoll(ALIPAY_DEEP_AFTER_MS - 1).deep).toBe(false);
  });

  it("≥60s：带 deep=1（trade.query 兜底补发）", () => {
    expect(planAlipayPoll(ALIPAY_DEEP_AFTER_MS)).toEqual({
      expired: false,
      deep: true,
      delayMs: ALIPAY_POLL_BASE_MS,
    });
  });

  it("≥5min：降频 10s（§8 请求额度测算口径）", () => {
    expect(planAlipayPoll(ALIPAY_POLL_SLOW_AFTER_MS)).toEqual({
      expired: false,
      deep: true,
      delayMs: ALIPAY_POLL_SLOW_MS,
    });
  });

  it("≥30min：过期停止；非法输入按 0 处理", () => {
    expect(planAlipayPoll(ALIPAY_QR_EXPIRE_MS)).toEqual({
      expired: true,
      deep: false,
      delayMs: 0,
    });
    expect(planAlipayPoll(NaN)).toEqual({
      expired: false,
      deep: false,
      delayMs: ALIPAY_POLL_BASE_MS,
    });
    expect(planAlipayPoll(-5)).toEqual({
      expired: false,
      deep: false,
      delayMs: ALIPAY_POLL_BASE_MS,
    });
  });
});

describe("alipayFieldTooLong（前端长度预检）", () => {
  it("code point 计数 + 去首尾空白；上限与服务端同源（20/50）", () => {
    expect(alipayFieldTooLong("x".repeat(20), ALIPAY_NICKNAME_MAX_LEN)).toBe(false);
    expect(alipayFieldTooLong("x".repeat(21), ALIPAY_NICKNAME_MAX_LEN)).toBe(true);
    expect(alipayFieldTooLong(`  ${"x".repeat(20)}  `, ALIPAY_NICKNAME_MAX_LEN)).toBe(false);
    expect(alipayFieldTooLong("🌟".repeat(50), ALIPAY_MESSAGE_MAX_LEN)).toBe(false);
    expect(alipayFieldTooLong("🌟".repeat(51), ALIPAY_MESSAGE_MAX_LEN)).toBe(true);
  });
});

describe("parseContributorsResponse", () => {
  it("合法响应逐条投影；非法条目丢弃不拖垮整单", () => {
    const parsed = parseContributorsResponse({
      ok: true,
      contributors: [
        {
          nickname: "老王",
          message: "加油",
          channel: "alipay",
          amountCny: 6,
          date: "2026-08-17",
        },
        { nickname: null, message: null, channel: "alipay", amountCny: null, date: "2026-08-16" },
        { channel: 42, date: "x" }, // channel 非法 → 丢弃
        "garbage",
        null,
      ],
    });
    expect(parsed).toEqual([
      {
        nickname: "老王",
        message: "加油",
        channel: "alipay",
        amountCny: 6,
        date: "2026-08-17",
      },
      {
        nickname: null,
        message: null,
        channel: "alipay",
        amountCny: null,
        date: "2026-08-16",
      },
    ]);
  });

  it("形状不符返回 null（页面静默降级）", () => {
    expect(parseContributorsResponse(null)).toBeNull();
    expect(parseContributorsResponse({ ok: false })).toBeNull();
    expect(parseContributorsResponse({ ok: true, contributors: "x" })).toBeNull();
  });
});

describe("remoteContributorsToDonors / mergeDonorLists", () => {
  const REMOTE = [
    {
      nickname: "老王",
      message: "加油",
      channel: "alipay",
      amountCny: 88,
      date: "2026-08-17",
    },
    {
      nickname: null,
      message: null,
      channel: "unknown-channel",
      amountCny: null,
      date: "2026-08-16",
    },
  ] as const;

  it("空昵称 → 匿名展示名；未知渠道回退 alipay；金额缺失回退 0", () => {
    const donors = remoteContributorsToDonors(REMOTE, "匿名用户");
    expect(donors[0]).toEqual({
      id: "remote-0",
      name: "老王",
      amountCny: 88,
      platform: "alipay",
      date: "2026-08-17",
      message: "加油",
    });
    expect(donors[1].name).toBe("匿名用户");
    expect(donors[1].platform).toBe("alipay");
    expect(donors[1].amountCny).toBe(0);
    expect(donors[1]).not.toHaveProperty("message");
  });

  it("已注册渠道保留原平台 id", () => {
    const donors = remoteContributorsToDonors(
      [{ nickname: "a", message: null, channel: "afdian", amountCny: 15, date: "d" }],
      "匿名用户",
    );
    expect(donors[0].platform).toBe("afdian");
  });

  it("mergeDonorLists：静态 + 动态合并后金额降序（排序器同源）", () => {
    const staticDonors: DonorRecord[] = [
      { id: "s1", name: "静态甲", amountCny: 50, platform: "wechat", date: "2026-08-01" },
    ];
    const merged = mergeDonorLists(
      staticDonors,
      remoteContributorsToDonors(REMOTE, "匿名用户"),
    );
    expect(merged.map((d) => d.name)).toEqual(["老王", "静态甲", "匿名用户"]);
  });
});
