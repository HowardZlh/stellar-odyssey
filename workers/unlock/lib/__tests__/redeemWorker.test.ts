/**
 * @jest-environment node
 *
 * U4 Worker 纯逻辑测试（REQUIREMENTS_UNLOCK.md §U4 验收）：
 * /api/redeem 全分支（mock fetch 爱发电 fixture 参数化）+ 订单时间解析 /
 * 档位归档 / CORS 判定 / MD5 / 验单请求构造与响应解析纯函数。
 * 逐分支断言响应契约与 KV 读写次数（防写额度攻击验收）。
 */
import * as ed from "@noble/ed25519";

import {
  bytesToHex,
  verifyToken,
} from "../../../../src/utils/unlockToken";
import {
  AFDIAN_QUERY_ORDER_URL,
  buildAfdianQueryOrderRequest,
  parseAfdianQueryOrderResponse,
  type AfdianOrder,
} from "../afdian";
import { buildCorsHeaders, PROD_ORIGIN, resolveCorsOrigin } from "../cors";
import { md5hex } from "../md5";
import { parseOrderEpochSec } from "../orderTime";
import {
  classifyOrder,
  handleRedeem,
  isPlanMappingComplete,
  ORDER_ID_RE,
  type FetchLike,
  type PlanTierMapping,
  type RedeemDeps,
  type UnlockKvLike,
} from "../redeem";

// ---------------------------------------------------------------------------
// 共享 fixture（一次性测试密钥：种子 0x01..0x20，与 unlockU1.test.ts 同源；
// 生产公钥在 src/data/unlockPublicKey.ts，私钥不入库——测试不触碰生产密钥）
// ---------------------------------------------------------------------------

const TEST_PRIVATE_KEY = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
const TEST_PRIVATE_KEY_HEX = bytesToHex(TEST_PRIVATE_KEY);
const TEST_PUBLIC_KEY_HEX = bytesToHex(ed.getPublicKey(TEST_PRIVATE_KEY));

const NOW_SEC = 1_755_000_000;
/** 2026-08-12 12:00:00 +08:00 下单 + 6 位序列 */
const ORDER_ID = "20260812120000123456";
const ORDER_SEC = Date.parse("2026-08-12T12:00:00+08:00") / 1000;

const SECRETS = {
  afdianUserId: "test-user",
  afdianToken: "test-token",
  ed25519PrivateKeyHex: TEST_PRIVATE_KEY_HEX,
};

/** plan 映射未配置（U6 回退链态：既有金额判定用例语义零破坏） */
const EMPTY_PLAN_TIERS: PlanTierMapping = { week: "", month: "", year: "" };

/** plan 映射全配置（U6 强制归档态 fixture） */
const PLAN_TIERS: PlanTierMapping = {
  week: "plan-week-0001",
  month: "plan-month-0002",
  year: "plan-year-0003",
};

/** 爱发电订单 fixture（覆盖项按用例参数化） */
function afdianOrderFixture(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    out_trade_no: ORDER_ID,
    status: 2,
    total_amount: "15.00",
    month: 1,
    product_type: 0,
    sku_detail: [],
    ...overrides,
  };
}

function afdianResponseFixture(orders: unknown[]): unknown {
  return { ec: 200, em: "ok", data: { list: orders } };
}

interface MockKv extends UnlockKvLike {
  get: jest.Mock<Promise<string | null>, [string]>;
  put: jest.Mock<Promise<void>, [string, string]>;
  store: Map<string, string>;
}

function makeKv(initial: Record<string, string> = {}): MockKv {
  const store = new Map(Object.entries(initial));
  const kv: MockKv = {
    store,
    get: jest.fn(async (key: string) => store.get(key) ?? null),
    put: jest.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
  };
  return kv;
}

function makeFetch(raw: unknown, ok = true): jest.MockedFunction<FetchLike> {
  return jest.fn(
    async () => ({ ok, json: async () => raw }),
  ) as unknown as jest.MockedFunction<FetchLike>;
}

function makeDeps(overrides: Partial<RedeemDeps> = {}): RedeemDeps {
  return {
    kv: makeKv(),
    fetchFn: makeFetch(afdianResponseFixture([afdianOrderFixture()])),
    secrets: SECRETS,
    nowSec: NOW_SEC,
    planTiers: EMPTY_PLAN_TIERS,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// handleRedeem 成功分支（订阅单/商品单三档 + 幂等）
// ---------------------------------------------------------------------------

describe("handleRedeem 成功签发", () => {
  it.each([
    // [说明, 订单覆盖, 期望档位, 期望天数]
    [
      "已付订阅单 1 月 ¥15 → month 31 天",
      { total_amount: "15.00", month: 1, product_type: 0 },
      "month",
      31,
    ],
    [
      "已付订阅单 2 月 ¥30 → month 62 天",
      { total_amount: "30.00", month: 2, product_type: 0 },
      "month",
      62,
    ],
    [
      "已付商品单周卡 ¥6 → week 7 天",
      { total_amount: "6.00", product_type: 1, sku_detail: [{ count: 1 }] },
      "week",
      7,
    ],
    [
      "已付商品单年卡 ¥88 → year 366 天",
      { total_amount: "88.00", product_type: 1, sku_detail: [{ count: 1 }] },
      "year",
      366,
    ],
    [
      "商品单周卡 ×3 合计 ¥18 → 强制按单件归档 week 21 天（防月卡误判）",
      { total_amount: "18.00", product_type: 1, sku_detail: [{ count: 3 }] },
      "week",
      21,
    ],
    [
      "订阅单金额 ≥¥88 → year 366 天",
      { total_amount: "88.00", month: 1, product_type: 0 },
      "year",
      366,
    ],
  ])("%s", async (_label, orderOverrides, tier, days) => {
    const kv = makeKv();
    const fetchFn = makeFetch(
      afdianResponseFixture([afdianOrderFixture(orderOverrides)]),
    );
    const body = await handleRedeem(ORDER_ID, makeDeps({ kv, fetchFn }));

    const expectedExp = ORDER_SEC + days * 86_400;
    expect(body).toEqual({
      ok: true,
      token: expect.stringMatching(/^SO1\./),
      tier,
      expiresAt: expectedExp,
    });
    if (!body.ok) throw new Error("unreachable");

    // token 与 U1 verifyToken（前端同模块）验签互通
    const verified = verifyToken(body.token, TEST_PUBLIC_KEY_HEX, NOW_SEC);
    expect(verified).toEqual({
      ok: true,
      payload: { v: 1, tier, exp: expectedExp, iat: NOW_SEC, ch: "afdian" },
    });

    // KV 读写次数：恰 1 读 + 1 写（每笔兑换 ≤1 条写，§0.3 零成本指标）
    expect(kv.get).toHaveBeenCalledTimes(1);
    expect(kv.put).toHaveBeenCalledTimes(1);
    expect(kv.put).toHaveBeenCalledWith(
      `order:${ORDER_ID}`,
      // U6：KV 值追加审计字段 planId（fixture 无 plan_id → 归空串）
      JSON.stringify({ token: body.token, tier, exp: expectedExp, planId: "" }),
    );
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0][0]).toBe(AFDIAN_QUERY_ORDER_URL);
  });

  it("重复兑换幂等：KV 命中直接返回首发 token，零验单零写", async () => {
    const stored = { token: "SO1.stored.sig", tier: "month", exp: 1_760_000_000 };
    const kv = makeKv({ [`order:${ORDER_ID}`]: JSON.stringify(stored) });
    const fetchFn = makeFetch(afdianResponseFixture([afdianOrderFixture()]));
    const body = await handleRedeem(ORDER_ID, makeDeps({ kv, fetchFn }));

    expect(body).toEqual({
      ok: true,
      token: stored.token,
      tier: "month",
      expiresAt: stored.exp,
    });
    expect(kv.get).toHaveBeenCalledTimes(1);
    expect(kv.put).not.toHaveBeenCalled();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("两次真实兑换返回同一 token（首发 → KV → 幂等回放）", async () => {
    const kv = makeKv();
    const deps = makeDeps({ kv });
    const first = await handleRedeem(ORDER_ID, deps);
    const second = await handleRedeem(ORDER_ID, deps);
    expect(first.ok && second.ok).toBe(true);
    expect(second).toEqual(first);
    expect(kv.put).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// handleRedeem 失败分支（逐分支断言契约 + KV 读写次数）
// ---------------------------------------------------------------------------

describe("handleRedeem 失败分支", () => {
  it.each([
    ["过短", "1234567890123"],
    ["过长（41 位）", "1".repeat(41)],
    ["含字母", "2026081212000012345a"],
    ["空串", ""],
    ["非字符串（null）", null],
    ["非字符串（数字）", 12345678901234],
  ])("订单号不合法（%s）→ invalid_order，零 KV/fetch 访问", async (_l, raw) => {
    const kv = makeKv();
    const fetchFn = makeFetch(afdianResponseFixture([]));
    const body = await handleRedeem(raw, makeDeps({ kv, fetchFn }));
    expect(body).toEqual({
      ok: false,
      error: "invalid_order",
      message: expect.stringContaining("订单号格式不正确"),
    });
    expect(kv.get).not.toHaveBeenCalled();
    expect(kv.put).not.toHaveBeenCalled();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it.each([
    ["缺 AFDIAN_USER_ID", { ...SECRETS, afdianUserId: undefined }],
    ["缺 AFDIAN_TOKEN", { ...SECRETS, afdianToken: undefined }],
    ["缺 ED25519_PRIVATE_KEY", { ...SECRETS, ed25519PrivateKeyHex: undefined }],
    ["私钥非 hex", { ...SECRETS, ed25519PrivateKeyHex: "zz" }],
    ["私钥长度非 32 字节", { ...SECRETS, ed25519PrivateKeyHex: "abcd" }],
  ])("未配置降级（%s）→ not_configured，零 KV 访问", async (_l, secrets) => {
    const kv = makeKv();
    const body = await handleRedeem(ORDER_ID, makeDeps({ kv, secrets }));
    expect(body).toEqual({
      ok: false,
      error: "not_configured",
      message: expect.stringContaining("兑换服务尚未配置完成"),
    });
    expect(kv.get).not.toHaveBeenCalled();
    expect(kv.put).not.toHaveBeenCalled();
  });

  it("KV 未绑定 → not_configured", async () => {
    const body = await handleRedeem(ORDER_ID, makeDeps({ kv: null }));
    expect(body).toMatchObject({ ok: false, error: "not_configured" });
  });

  it("未付订单（status=1）→ order_not_paid，零 KV 写", async () => {
    const kv = makeKv();
    const fetchFn = makeFetch(
      afdianResponseFixture([afdianOrderFixture({ status: 1 })]),
    );
    const body = await handleRedeem(ORDER_ID, makeDeps({ kv, fetchFn }));
    expect(body).toEqual({
      ok: false,
      error: "order_not_paid",
      message: "订单未完成支付。",
    });
    expect(kv.put).not.toHaveBeenCalled();
  });

  it("订单不存在（list 无匹配）→ invalid_order，零 KV 写", async () => {
    const kv = makeKv();
    const fetchFn = makeFetch(afdianResponseFixture([]));
    const body = await handleRedeem(ORDER_ID, makeDeps({ kv, fetchFn }));
    expect(body).toEqual({
      ok: false,
      error: "invalid_order",
      message: expect.stringContaining("未查询到该订单"),
    });
    expect(kv.put).not.toHaveBeenCalled();
  });

  it("金额不足（¥3）→ amount_too_low（提示价格取自定价单一事实源）", async () => {
    const kv = makeKv();
    const fetchFn = makeFetch(
      afdianResponseFixture([afdianOrderFixture({ total_amount: "3.00" })]),
    );
    const body = await handleRedeem(ORDER_ID, makeDeps({ kv, fetchFn }));
    expect(body).toMatchObject({ ok: false, error: "amount_too_low" });
    if (body.ok) throw new Error("unreachable");
    expect(body.message).toContain("¥6");
    expect(body.message).toContain("¥15");
    expect(body.message).toContain("¥88");
    expect(kv.put).not.toHaveBeenCalled();
  });

  it("KV 存量记录损坏 → already_redeemed_conflict，零写", async () => {
    const kv = makeKv({ [`order:${ORDER_ID}`]: "not-json{" });
    const body = await handleRedeem(ORDER_ID, makeDeps({ kv }));
    expect(body).toMatchObject({
      ok: false,
      error: "already_redeemed_conflict",
    });
    expect(kv.put).not.toHaveBeenCalled();
  });

  it.each([
    ["字段缺失", JSON.stringify({ token: "SO1.x.y" })],
    ["tier 非法", JSON.stringify({ token: "SO1.x.y", tier: "vip", exp: 1 })],
    ["exp 非数字", JSON.stringify({ token: "SO1.x.y", tier: "week", exp: "1" })],
    ["token 空串", JSON.stringify({ token: "", tier: "week", exp: 1 })],
    ["非对象", JSON.stringify("SO1.x.y")],
  ])("KV 存量记录形状异常（%s）→ already_redeemed_conflict", async (_l, raw) => {
    const kv = makeKv({ [`order:${ORDER_ID}`]: raw });
    const body = await handleRedeem(ORDER_ID, makeDeps({ kv }));
    expect(body).toMatchObject({
      ok: false,
      error: "already_redeemed_conflict",
    });
  });

  it("上游 5xx（resp.ok=false）→ upstream_error，零 KV 写", async () => {
    const kv = makeKv();
    const fetchFn = makeFetch(null, false);
    const body = await handleRedeem(ORDER_ID, makeDeps({ kv, fetchFn }));
    expect(body).toMatchObject({ ok: false, error: "upstream_error" });
    expect(kv.put).not.toHaveBeenCalled();
  });

  it("fetch 抛异常（网络故障）→ upstream_error，不抛出", async () => {
    const fetchFn: FetchLike = jest.fn(async () => {
      throw new Error("network down");
    });
    const body = await handleRedeem(ORDER_ID, makeDeps({ fetchFn }));
    expect(body).toMatchObject({ ok: false, error: "upstream_error" });
  });

  it("上游 ec!==200 → upstream_error", async () => {
    const fetchFn = makeFetch({ ec: 400001, em: "bad sign" });
    const body = await handleRedeem(ORDER_ID, makeDeps({ fetchFn }));
    expect(body).toMatchObject({ ok: false, error: "upstream_error" });
  });

  it("订单号通过正则但时间非法（99 月）→ invalid_order 订单时间解析失败", async () => {
    const badTimeId = "20269912120000123456";
    const fetchFn = makeFetch(
      afdianResponseFixture([afdianOrderFixture({ out_trade_no: badTimeId })]),
    );
    const kv = makeKv();
    const body = await handleRedeem(badTimeId, makeDeps({ kv, fetchFn }));
    expect(body).toEqual({
      ok: false,
      error: "invalid_order",
      message: expect.stringContaining("订单时间解析失败"),
    });
    expect(kv.put).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// handleRedeem U6：plan 映射强制归档（主流程接线）
// ---------------------------------------------------------------------------

describe("handleRedeem plan 映射（U6）", () => {
  it("映射命中 + 8 折金额（¥70.4）→ 强制归档 year，KV 值含 planId 审计字段", async () => {
    const kv = makeKv();
    const fetchFn = makeFetch(
      afdianResponseFixture([
        afdianOrderFixture({
          total_amount: "70.40",
          product_type: 1,
          sku_detail: [{ count: 1 }],
          plan_id: PLAN_TIERS.year,
        }),
      ]),
    );
    const body = await handleRedeem(
      ORDER_ID,
      makeDeps({ kv, fetchFn, planTiers: PLAN_TIERS }),
    );

    const expectedExp = ORDER_SEC + 366 * 86_400;
    expect(body).toEqual({
      ok: true,
      token: expect.stringMatching(/^SO1\./),
      tier: "year",
      expiresAt: expectedExp,
    });
    if (!body.ok) throw new Error("unreachable");
    expect(kv.put).toHaveBeenCalledWith(
      `order:${ORDER_ID}`,
      JSON.stringify({
        token: body.token,
        tier: "year",
        exp: expectedExp,
        planId: PLAN_TIERS.year,
      }),
    );
  });

  it("映射命中 + 周卡 8 折（¥4.8，回退态会 amount_too_low）→ week 7 天", async () => {
    const fetchFn = makeFetch(
      afdianResponseFixture([
        afdianOrderFixture({
          total_amount: "4.80",
          product_type: 1,
          sku_detail: [{ count: 1 }],
          plan_id: PLAN_TIERS.week,
        }),
      ]),
    );
    const body = await handleRedeem(
      ORDER_ID,
      makeDeps({ fetchFn, planTiers: PLAN_TIERS }),
    );
    expect(body).toMatchObject({ ok: true, tier: "week" });
  });

  it("映射全配置 + 赞助方案/未知 plan → plan_not_eligible，零 KV 写", async () => {
    const kv = makeKv();
    const fetchFn = makeFetch(
      afdianResponseFixture([
        afdianOrderFixture({ total_amount: "30.00", plan_id: "plan-sponsor-9999" }),
      ]),
    );
    const body = await handleRedeem(
      ORDER_ID,
      makeDeps({ kv, fetchFn, planTiers: PLAN_TIERS }),
    );
    expect(body).toEqual({
      ok: false,
      error: "plan_not_eligible",
      message: expect.stringContaining("不支持解锁兑换"),
    });
    expect(kv.put).not.toHaveBeenCalled();
  });

  it("映射任一未配置 → 回退纯金额判定（金额不足仍归 amount_too_low）", async () => {
    const kv = makeKv();
    const fetchFn = makeFetch(
      afdianResponseFixture([
        afdianOrderFixture({ total_amount: "4.80", plan_id: "plan-sponsor-9999" }),
      ]),
    );
    const body = await handleRedeem(
      ORDER_ID,
      makeDeps({ kv, fetchFn, planTiers: { ...PLAN_TIERS, year: "" } }),
    );
    expect(body).toMatchObject({ ok: false, error: "amount_too_low" });
    expect(kv.put).not.toHaveBeenCalled();
  });

  it("老格式 KV 存量记录（无 planId）幂等读照常返回（解析侧零改动）", async () => {
    const stored = { token: "SO1.legacy.sig", tier: "week", exp: 1_760_000_000 };
    const kv = makeKv({ [`order:${ORDER_ID}`]: JSON.stringify(stored) });
    const body = await handleRedeem(
      ORDER_ID,
      makeDeps({ kv, planTiers: PLAN_TIERS }),
    );
    expect(body).toEqual({
      ok: true,
      token: stored.token,
      tier: "week",
      expiresAt: stored.exp,
    });
    expect(kv.put).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 纯函数：档位归档 classifyOrder
// ---------------------------------------------------------------------------

describe("classifyOrder 档位归档", () => {
  function order(overrides: Partial<AfdianOrder>): AfdianOrder {
    return {
      status: 2,
      totalAmountCny: 15,
      months: 1,
      isGoods: false,
      goodsCount: 1,
      planId: "",
      ...overrides,
    };
  }

  it("订阅单走 resolveTierFromAmount（总金额 + 月数）", () => {
    expect(
      classifyOrder(order({ totalAmountCny: 30, months: 2 }), EMPTY_PLAN_TIERS),
    ).toEqual({
      tier: "month",
      days: 62,
    });
    expect(
      classifyOrder(order({ totalAmountCny: 14, months: 1 }), EMPTY_PLAN_TIERS),
    ).toEqual({
      tier: "week",
      days: 7,
    });
    expect(classifyOrder(order({ totalAmountCny: 5 }), EMPTY_PLAN_TIERS)).toBeNull();
  });

  it("商品单按单件金额归档 × 份数（防多份误判高档）", () => {
    expect(
      classifyOrder(
        order({ totalAmountCny: 18, isGoods: true, goodsCount: 3 }),
        EMPTY_PLAN_TIERS,
      ),
    ).toEqual({ tier: "week", days: 21 });
    expect(
      classifyOrder(
        order({ totalAmountCny: 176, isGoods: true, goodsCount: 2 }),
        EMPTY_PLAN_TIERS,
      ),
    ).toEqual({ tier: "year", days: 732 });
    expect(
      classifyOrder(
        order({ totalAmountCny: 5, isGoods: true, goodsCount: 1 }),
        EMPTY_PLAN_TIERS,
      ),
    ).toBeNull();
  });

  // -------------------------------------------------------------------------
  // U6：plan 映射强制归档（裁决 ①②）
  // -------------------------------------------------------------------------

  it.each([
    // [说明, planId, 订单覆盖, 期望档位, 期望天数]——金额无关（原价/8 折/¥1 极端折扣）
    ["week 原价 ¥6 ×1", PLAN_TIERS.week, { totalAmountCny: 6, isGoods: true }, "week", 7],
    ["week 8 折 ¥4.8 ×1", PLAN_TIERS.week, { totalAmountCny: 4.8, isGoods: true }, "week", 7],
    ["week ¥1 极端折扣 ×1", PLAN_TIERS.week, { totalAmountCny: 1, isGoods: true }, "week", 7],
    [
      "week 8 折 ×3 份叠加",
      PLAN_TIERS.week,
      { totalAmountCny: 14.4, isGoods: true, goodsCount: 3 },
      "week",
      21,
    ],
    ["month 原价 ¥15 ×1 月", PLAN_TIERS.month, { totalAmountCny: 15, months: 1 }, "month", 31],
    ["month 8 折 ¥12 ×1 月", PLAN_TIERS.month, { totalAmountCny: 12, months: 1 }, "month", 31],
    ["month ¥1 极端折扣 ×1 月", PLAN_TIERS.month, { totalAmountCny: 1, months: 1 }, "month", 31],
    [
      "month 8 折 ×3 月叠加",
      PLAN_TIERS.month,
      { totalAmountCny: 36, months: 3 },
      "month",
      93,
    ],
    ["year 原价 ¥88 ×1", PLAN_TIERS.year, { totalAmountCny: 88, isGoods: true }, "year", 366],
    ["year 8 折 ¥70.4 ×1", PLAN_TIERS.year, { totalAmountCny: 70.4, isGoods: true }, "year", 366],
    ["year ¥1 极端折扣 ×1", PLAN_TIERS.year, { totalAmountCny: 1, isGoods: true }, "year", 366],
    [
      "year 8 折 ×3 份叠加",
      PLAN_TIERS.year,
      { totalAmountCny: 211.2, isGoods: true, goodsCount: 3 },
      "year",
      1098,
    ],
  ])(
    "映射命中强制归档（%s）→ %s",
    (_label, planId, overrides, tier, days) => {
      expect(
        classifyOrder(order({ ...overrides, planId: planId as string }), PLAN_TIERS),
      ).toEqual({ tier, days });
    },
  );

  it("映射全配置：未命中 plan（赞助方案/未知/空串）→ null（plan_not_eligible）", () => {
    // 赞助方案 plan：即使金额 ≥¥6 也不得兑出周卡（U6 堵模糊地带）
    expect(
      classifyOrder(order({ totalAmountCny: 30, planId: "plan-sponsor-9999" }), PLAN_TIERS),
    ).toBeNull();
    expect(
      classifyOrder(order({ totalAmountCny: 88, planId: "unknown" }), PLAN_TIERS),
    ).toBeNull();
    // planId 空串（上游缺字段防御归空）不得命中任何映射
    expect(
      classifyOrder(order({ totalAmountCny: 88, planId: "" }), PLAN_TIERS),
    ).toBeNull();
  });

  it.each([
    ["week 空", { ...PLAN_TIERS, week: "" }],
    ["month 空", { ...PLAN_TIERS, month: "" }],
    ["year 空", { ...PLAN_TIERS, year: "" }],
    ["month 仅空白", { ...PLAN_TIERS, month: "   " }],
    ["全部缺失（undefined）", {}],
  ])("映射未全配置（%s）→ 整体回退纯金额判定", (_label, planTiers) => {
    // 未知 plan + 金额 ¥15 → 回退态按金额判 month（映射态会拒绝）
    expect(
      classifyOrder(
        order({ totalAmountCny: 15, planId: "plan-sponsor-9999" }),
        planTiers,
      ),
    ).toEqual({ tier: "month", days: 31 });
    // 金额不足照旧 null（amount_too_low）
    expect(
      classifyOrder(order({ totalAmountCny: 5, planId: "plan-sponsor-9999" }), planTiers),
    ).toBeNull();
  });

  it("isPlanMappingComplete：全非空 true；任一空/空白/缺失 false", () => {
    expect(isPlanMappingComplete(PLAN_TIERS)).toBe(true);
    expect(isPlanMappingComplete(EMPTY_PLAN_TIERS)).toBe(false);
    expect(isPlanMappingComplete({ ...PLAN_TIERS, week: " " })).toBe(false);
    expect(isPlanMappingComplete({ week: "a", month: "b" })).toBe(false);
    expect(isPlanMappingComplete({})).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 纯函数：订单时间解析
// ---------------------------------------------------------------------------

describe("parseOrderEpochSec 订单时间解析", () => {
  it("前 14 位按北京时间解析为 epoch 秒", () => {
    expect(parseOrderEpochSec(ORDER_ID)).toBe(ORDER_SEC);
    expect(parseOrderEpochSec("20260101000000")).toBe(
      Date.parse("2026-01-01T00:00:00+08:00") / 1000,
    );
  });

  it.each([
    ["13 月", "20261312120000000000"],
    ["32 日", "20260832120000000000"],
    // 注：ISO 8601 允许 24:00:00（当日末午夜），故 24 时不在拒绝范围
    ["25 时", "20260812250000000000"],
    ["60 分", "20260812126000000000"],
    ["60 秒", "20260812120060000000"],
    ["不足 14 位", "2026081212"],
    ["非数字开头", "a0260812120000000000"],
  ])("非法输入（%s）→ null", (_l, input) => {
    expect(parseOrderEpochSec(input)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 纯函数：CORS 判定
// ---------------------------------------------------------------------------

describe("CORS 判定", () => {
  it.each([
    PROD_ORIGIN,
    "http://localhost:3000",
    "http://localhost:3100",
    "http://localhost:3200",
    "http://127.0.0.1:3100",
  ])("放行 %s", (origin) => {
    expect(resolveCorsOrigin(origin)).toBe(origin);
  });

  it.each([
    ["其他站点", "https://evil.example.com"],
    ["前缀伪装", "https://stellar.guushu.com.evil.com"],
    ["https 本地", "https://localhost:3000"],
    ["未放行端口", "http://localhost:4000"],
    ["http 生产域", "http://stellar.guushu.com"],
  ])("拒绝（%s）", (_l, origin) => {
    expect(resolveCorsOrigin(origin)).toBeNull();
  });

  it("无 Origin 头（curl 等非浏览器）→ null", () => {
    expect(resolveCorsOrigin(null)).toBeNull();
  });

  it("放行 origin → 完整 CORS 头；不放行 → 仅 Content-Type", () => {
    const allowed = buildCorsHeaders(PROD_ORIGIN);
    expect(allowed).toEqual({
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": PROD_ORIGIN,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
      Vary: "Origin",
    });
    expect(buildCorsHeaders(null)).toEqual({
      "Content-Type": "application/json; charset=utf-8",
    });
  });
});

// ---------------------------------------------------------------------------
// 纯函数：MD5（RFC 1321 已知向量 + 填充边界）
// ---------------------------------------------------------------------------

describe("md5hex", () => {
  it.each([
    ["", "d41d8cd98f00b204e9800998ecf8427e"],
    ["abc", "900150983cd24fb0d6963f7d28e17f72"],
    // 填充边界：55/56/64 字节（56 触发额外补块分支）
    ["a".repeat(55), "ef1772b6dff9a122358552954ad0df65"],
    ["a".repeat(56), "3b0c8ac703f828b04c6c197006d17218"],
    ["a".repeat(64), "014842d480b571495a4a0363793f7367"],
    [
      "The quick brown fox jumps over the lazy dog and keeps running far beyond the horizon",
      "d2f5c84160bf8997bbe1074c710588ea",
    ],
    // UTF-8 多字节（与 node:crypto 结果对齐）
    ["星海征程·解锁", "faa116e92e4356266b2fa21c5a438ee4"],
  ])("md5hex(%j) 与标准实现一致", (input, expected) => {
    expect(md5hex(input)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// 纯函数：爱发电验单请求构造 / 响应解析
// ---------------------------------------------------------------------------

describe("buildAfdianQueryOrderRequest", () => {
  it("MD5 签名与请求体符合开放平台格式（固定向量）", () => {
    const { url, body } = buildAfdianQueryOrderRequest(
      "test-user",
      "test-token",
      ORDER_ID,
      NOW_SEC,
    );
    expect(url).toBe(AFDIAN_QUERY_ORDER_URL);
    const parsed = JSON.parse(body) as Record<string, unknown>;
    expect(parsed).toEqual({
      user_id: "test-user",
      params: JSON.stringify({ out_trade_no: ORDER_ID }),
      ts: NOW_SEC,
      // md5("test-token" + "params" + params_json + "ts" + ts + "user_id" + "test-user")
      sign: "8f30a743837d40eaa2f05a4bc5d96c8d",
    });
  });
});

describe("parseAfdianQueryOrderResponse", () => {
  it.each([
    ["非对象", "oops"],
    ["null", null],
    ["ec 非 200", { ec: 400001 }],
    ["data 缺失", { ec: 200 }],
    ["data 非对象", { ec: 200, data: 1 }],
    ["list 非数组", { ec: 200, data: { list: "x" } }],
  ])("形状异常（%s）→ upstream_error", (_l, raw) => {
    expect(parseAfdianQueryOrderResponse(raw, ORDER_ID)).toEqual({
      kind: "upstream_error",
    });
  });

  it("list 空/无匹配/含非对象项 → not_found", () => {
    expect(
      parseAfdianQueryOrderResponse(afdianResponseFixture([]), ORDER_ID),
    ).toEqual({ kind: "not_found" });
    expect(
      parseAfdianQueryOrderResponse(
        afdianResponseFixture([
          null,
          "x",
          afdianOrderFixture({ out_trade_no: "20260101000000999999" }),
        ]),
        ORDER_ID,
      ),
    ).toEqual({ kind: "not_found" });
  });

  it("匹配订单字段归一化（正常值）", () => {
    const result = parseAfdianQueryOrderResponse(
      afdianResponseFixture([
        afdianOrderFixture({
          total_amount: "30.00",
          month: 2,
          product_type: 0,
        }),
      ]),
      ORDER_ID,
    );
    expect(result).toEqual({
      kind: "found",
      order: {
        status: 2,
        totalAmountCny: 30,
        months: 2,
        isGoods: false,
        goodsCount: 1,
        planId: "",
      },
    });
  });

  it("字段缺失/非法的防御回退（金额 0、月数 1、份数 1）", () => {
    const result = parseAfdianQueryOrderResponse(
      afdianResponseFixture([{ out_trade_no: ORDER_ID, status: "2" }]),
      ORDER_ID,
    );
    expect(result).toEqual({
      kind: "found",
      order: {
        status: 2,
        totalAmountCny: 0,
        months: 1,
        isGoods: false,
        goodsCount: 1,
        planId: "",
      },
    });
  });

  it.each([
    ["month 为 0", { month: 0 }, 1],
    ["month 为字符串数字", { month: "3" }, 3],
    ["month 非数字", { month: "abc" }, 1],
  ])("月数防御（%s → %i）", (_l, overrides, months) => {
    const result = parseAfdianQueryOrderResponse(
      afdianResponseFixture([afdianOrderFixture(overrides)]),
      ORDER_ID,
    );
    if (result.kind !== "found") throw new Error("unreachable");
    expect(result.order.months).toBe(months);
  });

  it.each([
    ["字符串原样保留", { plan_id: "plan-week-0001" }, "plan-week-0001"],
    ["缺失归空串", {}, ""],
    ["非字符串（数字）归空串", { plan_id: 123 }, ""],
    ["非字符串（null）归空串", { plan_id: null }, ""],
  ])("plan_id 防御解析（%s）", (_l, overrides, planId) => {
    const result = parseAfdianQueryOrderResponse(
      afdianResponseFixture([afdianOrderFixture(overrides)]),
      ORDER_ID,
    );
    if (result.kind !== "found") throw new Error("unreachable");
    expect(result.order.planId).toBe(planId);
  });

  it.each([
    ["多 sku 求和", [{ count: 2 }, { count: 3 }], 5],
    ["count 非法回退 1", [{ count: 0 }, { count: "x" }], 1],
    ["sku 非对象跳过", [null, { count: 2 }], 2],
    ["sku_detail 非数组", "x", 1],
  ])("商品单份数解析（%s）", (_l, skuDetail, count) => {
    const result = parseAfdianQueryOrderResponse(
      afdianResponseFixture([
        afdianOrderFixture({ product_type: "1", sku_detail: skuDetail }),
      ]),
      ORDER_ID,
    );
    if (result.kind !== "found") throw new Error("unreachable");
    expect(result.order.isGoods).toBe(true);
    expect(result.order.goodsCount).toBe(count);
  });
});

// ---------------------------------------------------------------------------
// 常量断言（订单号正则）
// ---------------------------------------------------------------------------

describe("常量", () => {
  it("订单号正则边界：14 位与 40 位放行，13/41 位拒绝", () => {
    expect(ORDER_ID_RE.test("1".repeat(14))).toBe(true);
    expect(ORDER_ID_RE.test("1".repeat(40))).toBe(true);
    expect(ORDER_ID_RE.test("1".repeat(13))).toBe(false);
    expect(ORDER_ID_RE.test("1".repeat(41))).toBe(false);
  });
});
