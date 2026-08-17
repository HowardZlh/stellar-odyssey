/**
 * @jest-environment node
 *
 * workers/unlock/lib/alipayHandlers.ts — 当面付三接口 + 贡献者名单测试
 * （Z 迭代 M2；用例矩阵对照 stock_analysis
 * `tests/js/alipay_{create,notify,status}.test.mjs` + `contributors.test.mjs`，
 * 发码层改为本项目 Ed25519 token 断言）。
 *
 * 安全验收（§7-1，一项不可少）：伪造签名 / 错 app_id / 错 seller_id /
 * 金额不符 / 重复通知幂等 / 买家身份字段不落库（D-z8）。
 */
import * as ed from "@noble/ed25519";

import { UNLOCK_TIERS } from "../../../../src/data/unlockPricing";
import { unlockTokenHash } from "../../../../src/utils/revocationList";
import { bytesToHex, verifyToken } from "../../../../src/utils/unlockToken";
import {
  ALIPAY_NOTIFY_URL,
  ALIPAY_SUBJECT_PREFIX,
  handleAlipayCreate,
  handleAlipayNotify,
  handleAlipayStatus,
  handleContributors,
  newOutTradeNo,
  OUT_TRADE_NO_RE,
  type AlipayDeps,
} from "../alipayHandlers";
import { putStateRaw, type UnlockDbLike } from "../db";
import { FILTER_WORDS_STATE_KEY } from "../textFilter";
import {
  buildNotifyBody,
  genKeyPair,
  stubGateway,
} from "./helpers/alipayTestKeys";
import { FakeD1, type FakeRow } from "./helpers/fakeD1";

// ---------------------------------------------------------------------------
// 共享 fixture（RSA 与 Ed25519 密钥均为测试临时生成，禁止真实密钥）
// ---------------------------------------------------------------------------
const merchant = genKeyPair();
const alipayPair = genKeyPair();
const forgerPair = genKeyPair();

const TEST_PRIVATE_KEY = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
const TEST_PRIVATE_KEY_HEX = bytesToHex(TEST_PRIVATE_KEY);
const TEST_PUBLIC_KEY_HEX = bytesToHex(ed.getPublicKey(TEST_PRIVATE_KEY));

const APP_ID = "2021006190642255";
const SELLER = "2088123456789012";
const OUT_NO = "solfa3k9x8abcdefgh";
const NOW_SEC = 1_786_000_000;

function depsOf(db: UnlockDbLike | null, over: Partial<AlipayDeps> = {}): AlipayDeps {
  return {
    db,
    env: {
      ALIPAY_APP_ID: APP_ID,
      ALIPAY_PRIVATE_KEY: merchant.privatePem,
      ALIPAY_PUBLIC_KEY: alipayPair.publicPem,
      ALIPAY_SELLER_ID: SELLER,
    },
    ed25519PrivateKeyHex: TEST_PRIVATE_KEY_HEX,
    nowSec: NOW_SEC,
    ...over,
  };
}

function seedPending(db: FakeD1, extra: FakeRow = {}): FakeD1 {
  db.seed("orders", {
    id: "o1",
    channel: "alipay",
    ext_order_no: OUT_NO,
    trade_no: null,
    amount_cny: 6,
    tier: "week",
    months: null,
    status: "pending",
    token: null,
    token_hash: null,
    expires_at: null,
    plan_id: null,
    nickname: "老王",
    message: "加油",
    contributor_id: null,
    created_at: "2026-08-17T00:00:00Z",
    paid_at: null,
    refunded_at: null,
    ...extra,
  });
  return db;
}

/** 合法通知字段（字段名依据官方 SDK 核对；buyer_* 仅用于验证不落库） */
function notifyFields(extra: Record<string, string> = {}): Record<string, string> {
  return {
    app_id: APP_ID,
    seller_id: SELLER,
    out_trade_no: OUT_NO,
    trade_no: "2026081722001400000000000001",
    trade_status: "TRADE_SUCCESS",
    total_amount: "6.00",
    buyer_id: "2088000000000001",
    buyer_logon_id: "buy***@example.com",
    notify_id: "ac2026081712345",
    notify_type: "trade_status_sync",
    ...extra,
  };
}

function okGateway(): ReturnType<typeof stubGateway> {
  return stubGateway(alipayPair.privatePem, (biz) => ({
    code: "10000",
    msg: "Success",
    out_trade_no: biz.out_trade_no,
    qr_code: "https://qr.alipay.com/test123",
  }));
}

// ---------------------------------------------------------------------------
// POST /api/alipay/create
// ---------------------------------------------------------------------------
describe("handleAlipayCreate（预下单）", () => {
  it("周卡下单：pending 入库 + 返回 qr_code，金额服务端定价（客户端金额忽略）", async () => {
    const db = new FakeD1();
    const gw = okGateway();
    try {
      const body = await handleAlipayCreate(
        {
          tier: "week",
          nickname: " 老王 ",
          message: "加油",
          amount: 0.01,
          total_amount: "0.01", // 客户端金额字段一律忽略
        },
        depsOf(db),
      );
      expect(body.ok).toBe(true);
      if (!body.ok) return;
      expect(body.out_trade_no).toMatch(OUT_TRADE_NO_RE);
      expect(body.qr_code).toBe("https://qr.alipay.com/test123");
      expect(body.amount).toBe(UNLOCK_TIERS.week.priceCny);
      // 网关请求金额 = 服务端定价（两位小数字符串），与入参无关
      const biz = gw.calls[0].biz;
      expect(biz.total_amount).toBe("6.00");
      expect(biz.timeout_express).toBe("30m");
      expect(biz.product_code).toBe("FACE_TO_FACE_PAYMENT");
      expect(String(biz.subject)).toContain(ALIPAY_SUBJECT_PREFIX);
      expect(String(biz.subject)).toContain("周卡");
      expect(gw.calls[0].form.get("notify_url")).toBe(ALIPAY_NOTIFY_URL);
      // 订单行：pending + 昵称留言 trim 暂存 + 未发码
      const o = db.rows("orders")[0];
      expect(o.status).toBe("pending");
      expect(o.amount_cny).toBe(6);
      expect(o.tier).toBe("week");
      expect(o.months).toBeNull();
      expect(o.nickname).toBe("老王");
      expect(o.message).toBe("加油");
      expect(o.token).toBeUndefined(); // 未发码（INSERT 未含 token 列）
    } finally {
      gw.restore();
    }
  });

  it.each([
    ["week", "6.00", null],
    ["month", "15.00", 1],
    ["year", "88.00", null],
  ] as const)("三档定价：%s → total_amount %s", async (tier, expectAmount, months) => {
    const db = new FakeD1();
    const gw = okGateway();
    try {
      const body = await handleAlipayCreate({ tier }, depsOf(db));
      expect(body.ok).toBe(true);
      expect(gw.calls[0].biz.total_amount).toBe(expectAmount);
      expect(db.rows("orders")[0].months).toBe(months);
    } finally {
      gw.restore();
    }
  });

  it("档位白名单：非法/缺失 tier → invalid_tier，零 DB 行", async () => {
    const db = new FakeD1();
    let body = await handleAlipayCreate({ tier: "lifetime" }, depsOf(db));
    expect(body).toMatchObject({ ok: false, error: "invalid_tier" });
    body = await handleAlipayCreate(null, depsOf(db));
    expect(body).toMatchObject({ ok: false, error: "invalid_tier" });
    expect(db.rows("orders")).toHaveLength(0);
  });

  it("敏感词命中拒绝下单（词库 D-z7 从 kv_state 读；昵称与留言都过滤）", async () => {
    const db = new FakeD1();
    await putStateRaw(
      db,
      FILTER_WORDS_STATE_KEY,
      JSON.stringify(["测试屏蔽词"]),
      "x",
    );
    let body = await handleAlipayCreate(
      { tier: "week", nickname: "我是测试屏蔽词" },
      depsOf(db),
    );
    expect(body).toMatchObject({ ok: false, error: "nickname_blocked" });
    body = await handleAlipayCreate(
      { tier: "week", message: "含 测试屏蔽词 内容" },
      depsOf(db),
    );
    expect(body).toMatchObject({ ok: false, error: "message_blocked" });
    body = await handleAlipayCreate(
      { tier: "week", nickname: "x".repeat(21) },
      depsOf(db),
    );
    expect(body).toMatchObject({ ok: false, error: "nickname_too_long" });
    body = await handleAlipayCreate(
      { tier: "week", message: "y".repeat(51) },
      depsOf(db),
    );
    expect(body).toMatchObject({ ok: false, error: "message_too_long" });
    expect(db.rows("orders")).toHaveLength(0); // 被拒请求不得入库
  });

  it("缺 D1/支付宝 Secrets 降级为 not_configured（非抛错）", async () => {
    let body = await handleAlipayCreate({ tier: "week" }, depsOf(null));
    expect(body).toMatchObject({ ok: false, error: "not_configured" });
    if (!body.ok) expect(body.message).toMatch(/存储服务未配置/);
    body = await handleAlipayCreate(
      { tier: "week" },
      depsOf(new FakeD1(), {
        env: { ALIPAY_APP_ID: APP_ID, ALIPAY_SELLER_ID: SELLER },
      }),
    );
    expect(body).toMatchObject({ ok: false, error: "not_configured" });
    if (!body.ok) expect(body.message).toMatch(/支付宝支付未配置/);
  });

  it("网关业务失败 → gateway_error 透出错误（pending 行留待 Cron 关单）", async () => {
    const db = new FakeD1();
    const gw = stubGateway(alipayPair.privatePem, () => ({
      code: "40004",
      msg: "Business Failed",
      sub_msg: "商户状态异常",
    }));
    try {
      const body = await handleAlipayCreate({ tier: "week" }, depsOf(db));
      expect(body).toMatchObject({ ok: false, error: "gateway_error" });
      if (!body.ok) expect(body.message).toMatch(/商户状态异常/);
      expect(db.rows("orders")).toHaveLength(1);
      expect(db.rows("orders")[0].status).toBe("pending");
    } finally {
      gw.restore();
    }
  });

  it("newOutTradeNo 形态：so 前缀 + 36 进制（status 正则同源）", () => {
    for (let i = 0; i < 5; i++) {
      expect(newOutTradeNo()).toMatch(OUT_TRADE_NO_RE);
    }
  });
});

// ---------------------------------------------------------------------------
// POST /api/alipay/notify（安全核心）
// ---------------------------------------------------------------------------
describe("handleAlipayNotify（收款异步通知）", () => {
  it("合法通知：success + 订单 paid + Ed25519 token 签发 + 贡献者上名单", async () => {
    const db = seedPending(new FakeD1());
    const out = await handleAlipayNotify(
      buildNotifyBody(notifyFields(), alipayPair.privatePem),
      depsOf(db),
    );
    expect(out).toBe("success");
    const o = db.rows("orders")[0];
    expect(o.status).toBe("paid");
    expect(o.trade_no).toBe("2026081722001400000000000001");
    expect(o.paid_at).toBeTruthy();
    // token：与 U1 verifyToken 同一验签路径；exp = 支付时刻 + 档位天数（D-z3）
    const token = String(o.token);
    const verified = verifyToken(token, TEST_PUBLIC_KEY_HEX, NOW_SEC);
    expect(verified.ok).toBe(true);
    if (verified.ok) {
      expect(verified.payload.ch).toBe("alipay");
      expect(verified.payload.tier).toBe("week");
      expect(verified.payload.exp).toBe(NOW_SEC + 7 * 86_400);
      expect(verified.payload.iat).toBe(NOW_SEC);
    }
    expect(o.token_hash).toBe(unlockTokenHash(token));
    expect(o.expires_at).toBe(NOW_SEC + 7 * 86_400);
    // 贡献者行（D4：randomUUID 主键回填订单行；昵称留言随单登记）
    const c = db.rows("contributors")[0];
    expect(c.id).toBe(o.contributor_id);
    expect(c.nickname).toBe("老王");
    expect(c.message).toBe("加油");
    expect(c.channel).toBe("alipay");
    expect(c.amount_cny).toBe(6);
    expect(c.hidden).toBe(0);
  });

  it("伪造签名拒绝：failure 且零写入", async () => {
    const db = seedPending(new FakeD1());
    const out = await handleAlipayNotify(
      buildNotifyBody(notifyFields(), forgerPair.privatePem),
      depsOf(db),
    );
    expect(out).toBe("failure");
    expect(db.rows("orders")[0].status).toBe("pending");
    expect(db.rows("contributors")).toHaveLength(0);
  });

  it("篡改字段拒绝：合法签名 + 改金额", async () => {
    const db = seedPending(new FakeD1());
    const body = buildNotifyBody(notifyFields(), alipayPair.privatePem);
    const tampered = new URLSearchParams(body);
    tampered.set("total_amount", "0.01");
    expect(await handleAlipayNotify(tampered.toString(), depsOf(db))).toBe(
      "failure",
    );
    expect(db.rows("orders")[0].status).toBe("pending");
  });

  it("app_id 不符拒绝（跨应用重放）", async () => {
    const db = seedPending(new FakeD1());
    const out = await handleAlipayNotify(
      buildNotifyBody(
        notifyFields({ app_id: "2021000000000000" }),
        alipayPair.privatePem,
      ),
      depsOf(db),
    );
    expect(out).toBe("failure");
    expect(db.rows("orders")[0].status).toBe("pending");
  });

  it("seller_id 不符拒绝（跨商户重放）", async () => {
    const db = seedPending(new FakeD1());
    const out = await handleAlipayNotify(
      buildNotifyBody(
        notifyFields({ seller_id: "2088999999999999" }),
        alipayPair.privatePem,
      ),
      depsOf(db),
    );
    expect(out).toBe("failure");
    expect(db.rows("orders")[0].status).toBe("pending");
  });

  it("金额不符拒绝（签名合法但与下单金额对不上）", async () => {
    const db = seedPending(new FakeD1());
    const out = await handleAlipayNotify(
      buildNotifyBody(
        notifyFields({ total_amount: "5.99" }),
        alipayPair.privatePem,
      ),
      depsOf(db),
    );
    expect(out).toBe("failure");
    expect(db.rows("orders")[0].status).toBe("pending");
  });

  it("重复通知幂等：同一订单只发一码、贡献者只登记一次", async () => {
    const db = seedPending(new FakeD1());
    const body = buildNotifyBody(notifyFields(), alipayPair.privatePem);
    expect(await handleAlipayNotify(body, depsOf(db))).toBe("success");
    const token1 = db.rows("orders")[0].token;
    expect(await handleAlipayNotify(body, depsOf(db))).toBe("success");
    expect(db.rows("contributors")).toHaveLength(1);
    expect(db.rows("orders")[0].token).toBe(token1);
  });

  it("trade_status 非成功态忽略（ack 但不发码）", async () => {
    for (const st of ["WAIT_BUYER_PAY", "TRADE_CLOSED"]) {
      const db = seedPending(new FakeD1());
      const out = await handleAlipayNotify(
        buildNotifyBody(
          notifyFields({ trade_status: st }),
          alipayPair.privatePem,
        ),
        depsOf(db),
      );
      expect(out).toBe("success");
      expect(db.rows("orders")[0].status).toBe("pending");
      expect(db.rows("contributors")).toHaveLength(0);
    }
  });

  it("未知订单 / 非法订单号拒绝", async () => {
    const db = new FakeD1(); // 无订单
    expect(
      await handleAlipayNotify(
        buildNotifyBody(notifyFields(), alipayPair.privatePem),
        depsOf(db),
      ),
    ).toBe("failure");
    const db2 = seedPending(new FakeD1());
    expect(
      await handleAlipayNotify(
        buildNotifyBody(
          notifyFields({ out_trade_no: "bad;drop--" }),
          alipayPair.privatePem,
        ),
        depsOf(db2),
      ),
    ).toBe("failure");
  });

  it("已退款订单不再发码（迟到通知 ack）", async () => {
    const db = seedPending(new FakeD1(), { status: "refunded" });
    expect(
      await handleAlipayNotify(
        buildNotifyBody(notifyFields(), alipayPair.privatePem),
        depsOf(db),
      ),
    ).toBe("success");
    expect(db.rows("contributors")).toHaveLength(0);
  });

  it("匿名订单：昵称/留言 NULL 照样上名单（D4）", async () => {
    const db = seedPending(new FakeD1(), {
      nickname: null,
      message: null,
      tier: "year",
      amount_cny: 88,
    });
    const out = await handleAlipayNotify(
      buildNotifyBody(
        notifyFields({ total_amount: "88.00" }),
        alipayPair.privatePem,
      ),
      depsOf(db),
    );
    expect(out).toBe("success");
    const c = db.rows("contributors")[0];
    expect(c.nickname).toBeNull();
    expect(c.message).toBeNull();
    expect(c.amount_cny).toBe(88);
  });

  it("隐私 D-z8：buyer_id / buyer_logon_id 等身份字段不落库", async () => {
    const db = seedPending(new FakeD1());
    await handleAlipayNotify(
      buildNotifyBody(notifyFields(), alipayPair.privatePem),
      depsOf(db),
    );
    const dump = JSON.stringify({
      orders: db.rows("orders"),
      contributors: db.rows("contributors"),
      kv_state: db.rows("kv_state"),
    });
    expect(dump).not.toContain("2088000000000001");
    expect(dump).not.toContain("buy***@example.com");
  });

  it("缺 D1/Secrets/签发私钥：failure 让支付宝重试自愈", async () => {
    const body = buildNotifyBody(notifyFields(), alipayPair.privatePem);
    expect(await handleAlipayNotify(body, depsOf(null))).toBe("failure");
    expect(
      await handleAlipayNotify(
        body,
        depsOf(seedPending(new FakeD1()), { ed25519PrivateKeyHex: undefined }),
      ),
    ).toBe("failure");
    expect(
      await handleAlipayNotify(
        body,
        depsOf(seedPending(new FakeD1()), {
          env: { ALIPAY_APP_ID: APP_ID, ALIPAY_PUBLIC_KEY: alipayPair.publicPem },
        }),
      ),
    ).toBe("failure");
  });
});

// ---------------------------------------------------------------------------
// GET /api/alipay/status（轮询 + deep 兜底）
// ---------------------------------------------------------------------------
describe("handleAlipayStatus（轮询 + trade.query 兜底补发）", () => {
  it("常规轮询：pending/refunded 直读；paid 附 token/tier/expiresAt", async () => {
    let body = await handleAlipayStatus(
      OUT_NO,
      false,
      depsOf(seedPending(new FakeD1())),
    );
    expect(body).toEqual({ ok: true, status: "pending" });
    body = await handleAlipayStatus(
      OUT_NO,
      false,
      depsOf(
        seedPending(new FakeD1(), {
          status: "paid",
          token: "SO1.x.y",
          expires_at: NOW_SEC + 100,
        }),
      ),
    );
    expect(body).toMatchObject({
      ok: true,
      status: "paid",
      token: "SO1.x.y", // 明文 token 只下发给付款者本人页面（§7-5 边界）
      tier: "week",
      expiresAt: NOW_SEC + 100,
    });
    body = await handleAlipayStatus(
      OUT_NO,
      false,
      depsOf(seedPending(new FakeD1(), { status: "refunded" })),
    );
    expect(body).toEqual({ ok: true, status: "refunded" });
  });

  it("deep=1 兜底：支付宝已收款 → 当场发码（notify 丢失自愈，同一发码函数）", async () => {
    const db = seedPending(new FakeD1());
    const gw = stubGateway(alipayPair.privatePem, (biz) => ({
      code: "10000",
      msg: "Success",
      out_trade_no: biz.out_trade_no,
      trade_no: "T100",
      trade_status: "TRADE_SUCCESS",
      total_amount: "6.00",
    }));
    try {
      const body = await handleAlipayStatus(OUT_NO, true, depsOf(db));
      expect(body.ok).toBe(true);
      if (!body.ok) return;
      expect(body.status).toBe("paid");
      const verified = verifyToken(
        String(body.token),
        TEST_PUBLIC_KEY_HEX,
        NOW_SEC,
      );
      expect(verified.ok).toBe(true);
      expect(gw.calls[0].method).toBe("alipay.trade.query");
      const o = db.rows("orders")[0];
      expect(o.status).toBe("paid");
      expect(o.trade_no).toBe("T100");
      expect(db.rows("contributors")).toHaveLength(1);
    } finally {
      gw.restore();
    }
  });

  it("notify 先到 + deep 后到：幂等返回同一 token（不重复登记贡献者）", async () => {
    const db = seedPending(new FakeD1());
    await handleAlipayNotify(
      buildNotifyBody(notifyFields(), alipayPair.privatePem),
      depsOf(db),
    );
    const token1 = String(db.rows("orders")[0].token);
    const body = await handleAlipayStatus(OUT_NO, true, depsOf(db));
    expect(body.ok).toBe(true);
    if (body.ok) expect(body.token).toBe(token1);
    expect(db.rows("contributors")).toHaveLength(1);
  });

  it("deep 并发抢占失败：回读首发 token 幂等返回（发码函数 changes=0 分支）", async () => {
    const db = seedPending(new FakeD1());
    // 网关回包期间订单被 notify 并发发码（stub handler 内直改行模拟交错）
    const gw = stubGateway(alipayPair.privatePem, () => {
      const row = db.rows("orders")[0];
      row.status = "paid";
      row.token = "SO1.first.token";
      row.expires_at = NOW_SEC + 7 * 86_400;
      return {
        code: "10000",
        msg: "Success",
        trade_no: "T200",
        trade_status: "TRADE_SUCCESS",
        total_amount: "6.00",
      };
    });
    try {
      const body = await handleAlipayStatus(OUT_NO, true, depsOf(db));
      expect(body.ok).toBe(true);
      if (body.ok) expect(body.token).toBe("SO1.first.token");
      // 后到者不重复登记贡献者
      expect(db.rows("contributors")).toHaveLength(0);
    } finally {
      gw.restore();
    }
  });

  it("deep 抢占失败且存量异常：复读订单按当前状态返回（不发 token）", async () => {
    const db = seedPending(new FakeD1());
    const gw = stubGateway(alipayPair.privatePem, () => {
      const row = db.rows("orders")[0];
      row.status = "paid"; // 已 paid 但 token 缺失（存量异常）
      return {
        code: "10000",
        msg: "Success",
        trade_no: "T201",
        trade_status: "TRADE_SUCCESS",
        total_amount: "6.00",
      };
    });
    try {
      const body = await handleAlipayStatus(OUT_NO, true, depsOf(db));
      expect(body).toEqual({ ok: true, status: "paid" });
    } finally {
      gw.restore();
    }
  });

  it("closed 订单 deep=1 已付 → 同样补发（超时关单后实付兜底）", async () => {
    const db = seedPending(new FakeD1(), { status: "closed" });
    const gw = stubGateway(alipayPair.privatePem, () => ({
      code: "10000",
      msg: "Success",
      trade_no: "T300",
      trade_status: "TRADE_FINISHED",
      total_amount: "6.00",
    }));
    try {
      const body = await handleAlipayStatus(OUT_NO, true, depsOf(db));
      expect(body.ok).toBe(true);
      if (body.ok) expect(body.status).toBe("paid");
    } finally {
      gw.restore();
    }
  });

  it("deep=1 金额不符：不发码，维持 pending", async () => {
    const db = seedPending(new FakeD1());
    const gw = stubGateway(alipayPair.privatePem, () => ({
      code: "10000",
      msg: "Success",
      trade_status: "TRADE_SUCCESS",
      total_amount: "0.01",
    }));
    try {
      const body = await handleAlipayStatus(OUT_NO, true, depsOf(db));
      expect(body).toEqual({ ok: true, status: "pending" });
      expect(db.rows("contributors")).toHaveLength(0);
    } finally {
      gw.restore();
    }
  });

  it("deep=1 未支付（WAIT_BUYER_PAY）/ 网关业务失败：维持当前状态", async () => {
    for (const node of [
      { code: "10000", msg: "Success", trade_status: "WAIT_BUYER_PAY", total_amount: "6.00" },
      { code: "40004", msg: "Business Failed", sub_msg: "交易不存在" },
    ]) {
      const db = seedPending(new FakeD1());
      const gw = stubGateway(alipayPair.privatePem, () => node);
      try {
        const body = await handleAlipayStatus(OUT_NO, true, depsOf(db));
        expect(body).toEqual({ ok: true, status: "pending" });
      } finally {
        gw.restore();
      }
    }
  });

  it("订单号非法/未知/缺绑定的降级", async () => {
    let body = await handleAlipayStatus(
      "DROP TABLE",
      false,
      depsOf(new FakeD1()),
    );
    expect(body).toMatchObject({ ok: false, error: "invalid_order" });
    body = await handleAlipayStatus(null, false, depsOf(new FakeD1()));
    expect(body).toMatchObject({ ok: false, error: "invalid_order" });
    body = await handleAlipayStatus(OUT_NO, false, depsOf(new FakeD1()));
    expect(body).toMatchObject({ ok: false, error: "order_not_found" });
    body = await handleAlipayStatus(OUT_NO, false, depsOf(null));
    expect(body).toMatchObject({ ok: false, error: "not_configured" });
  });

  it("deep=1 但缺支付宝 Secrets/签发私钥：退化为纯轮询", async () => {
    let body = await handleAlipayStatus(
      OUT_NO,
      true,
      depsOf(seedPending(new FakeD1()), { env: {} }),
    );
    expect(body).toEqual({ ok: true, status: "pending" });
    body = await handleAlipayStatus(
      OUT_NO,
      true,
      depsOf(seedPending(new FakeD1()), { ed25519PrivateKeyHex: undefined }),
    );
    expect(body).toEqual({ ok: true, status: "pending" });
  });
});

// ---------------------------------------------------------------------------
// GET /api/contributors
// ---------------------------------------------------------------------------
describe("handleContributors（贡献者名单）", () => {
  function seedContributor(db: FakeD1, extra: FakeRow = {}): void {
    db.seed("contributors", {
      id: crypto.randomUUID(),
      nickname: "老王",
      message: "加油",
      channel: "alipay",
      amount_cny: 6,
      created_at: "2026-08-17T01:00:00Z",
      hidden: 0,
      ...extra,
    });
  }

  it("返回公开展示字段（created_at DESC，日期截前 10 位），空昵称 → null", async () => {
    const db = new FakeD1();
    seedContributor(db, { created_at: "2026-08-15T01:00:00Z", nickname: "早鸟" });
    seedContributor(db, {
      created_at: "2026-08-17T01:00:00Z",
      nickname: null,
      message: null,
      amount_cny: 88,
    });
    const body = await handleContributors(db);
    expect(body.ok).toBe(true);
    expect(body.contributors).toEqual([
      {
        nickname: null,
        message: null,
        channel: "alipay",
        amountCny: 88,
        date: "2026-08-17",
      },
      {
        nickname: "早鸟",
        message: "加油",
        channel: "alipay",
        amountCny: 6,
        date: "2026-08-15",
      },
    ]);
  });

  it("hidden=1 条目排除（管理台隐藏开关，不删行）", async () => {
    const db = new FakeD1();
    seedContributor(db);
    seedContributor(db, { hidden: 1, nickname: "隐藏者" });
    const body = await handleContributors(db);
    expect(body.contributors).toHaveLength(1);
    expect(JSON.stringify(body)).not.toContain("隐藏者");
  });

  it("缺 DB / 查询异常 → 空名单降级（不抛错）", async () => {
    expect(await handleContributors(null)).toEqual({ ok: true, contributors: [] });
    const broken = {
      prepare(): never {
        throw new Error("d1 down");
      },
      batch(): never {
        throw new Error("d1 down");
      },
    } as unknown as UnlockDbLike;
    expect(await handleContributors(broken)).toEqual({
      ok: true,
      contributors: [],
    });
  });
});
