/**
 * @jest-environment node
 *
 * workers/unlock/lib/refundSync.ts — 支付宝对账段测试（Z 迭代 M4；
 * 用例矩阵对照 stock_analysis `tests/js/alipay_reconcile.test.mjs`
 * （提交 a30b90e，315 行），发码层改本项目 Ed25519 token / 吊销层改
 * revocations 表 / 单 cron 统一入口 runUnifiedSync）。
 *
 * 验收口径（提示词硬性约束）：
 * - 超时关单 / 已付补发幂等 / 金额不符拒补 / 退款吊销闭环 / 吊销登记
 *   核对 / 贡献者补登 / 爱发电巡检回归（runUnifiedSync 两段独立降级）；
 * - **无变化零写入**（对账仅状态变化才写 D1，_write spy 断言）；
 * - 吊销只增不删（revocations 幂等补行，含 restored 行不重写）。
 */
import * as ed from "@noble/ed25519";

import { UNLOCK_TIERS } from "../../../../src/data/unlockPricing";
import { unlockTokenHash } from "../../../../src/utils/revocationList";
import { bytesToHex, verifyToken } from "../../../../src/utils/unlockToken";
import worker from "../../index";
import { ALIPAY_REFUND_CURSOR_STATE_KEY } from "../db";
import {
  ALIPAY_PENDING_SCAN_LIMIT,
  ALIPAY_PENDING_TIMEOUT_SEC,
  ALIPAY_REFUND_SCAN_LIMIT,
  alipayRefundRequestNo,
  runAlipayReconcile,
  runUnifiedSync,
  type AlipayReconcileDeps,
} from "../refundSync";
import {
  genKeyPair,
  stubGateway,
  type GatewayStub,
} from "./helpers/alipayTestKeys";
import { FakeD1, type FakeRow } from "./helpers/fakeD1";

// ---------------------------------------------------------------------------
// 共享 fixture（RSA 与 Ed25519 密钥均为测试临时生成，禁止真实密钥）
// ---------------------------------------------------------------------------
const merchant = genKeyPair();
const alipayPair = genKeyPair();

const TEST_PRIVATE_KEY = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
const TEST_PRIVATE_KEY_HEX = bytesToHex(TEST_PRIVATE_KEY);
const TEST_PUBLIC_KEY_HEX = bytesToHex(ed.getPublicKey(TEST_PRIVATE_KEY));

const NOW_SEC = 1_786_000_000;
const NOW_ISO = new Date(NOW_SEC * 1000).toISOString();
/** 远超 30m 超时阈值的下单时刻 */
const OLD_ISO = new Date(
  (NOW_SEC - ALIPAY_PENDING_TIMEOUT_SEC - 3600) * 1000,
).toISOString();
/** 回看窗口内的支付时刻 */
const PAID_ISO = new Date((NOW_SEC - 86_400) * 1000).toISOString();

function depsOf(
  db: FakeD1 | null,
  over: Partial<AlipayReconcileDeps> = {},
): AlipayReconcileDeps {
  return {
    db,
    env: {
      ALIPAY_APP_ID: "2021006190642255",
      ALIPAY_PRIVATE_KEY: merchant.privatePem,
      ALIPAY_PUBLIC_KEY: alipayPair.publicPem,
      ALIPAY_SELLER_ID: "2088123456789012",
    },
    ed25519PrivateKeyHex: TEST_PRIVATE_KEY_HEX,
    nowSec: NOW_SEC,
    lookbackDays: 15,
    ...over,
  };
}

interface CountedDb {
  readonly db: FakeD1;
  readonly writes: jest.SpyInstance;
}

function makeDb(): CountedDb {
  const db = new FakeD1();
  return { db, writes: jest.spyOn(db, "_write") };
}

/** 超时 pending 订单（周卡 ¥6，含昵称/留言——补发时应带入贡献者行） */
function seedPendingOrder(db: FakeD1, extra: FakeRow = {}): void {
  db.seed("orders", {
    id: "op1",
    channel: "alipay",
    ext_order_no: "sooldpending01",
    trade_no: null,
    amount_cny: 6,
    tier: "week",
    months: null,
    status: "pending",
    token: null,
    token_hash: null,
    expires_at: null,
    plan_id: null,
    nickname: "张三",
    message: "加油",
    contributor_id: null,
    created_at: OLD_ISO,
    paid_at: null,
    refunded_at: null,
    ...extra,
  });
}

const PAID_TOKEN = "SO1.paidpayload.paidsig";

/** 已发码 paid 订单（退款兜底扫描对象；contributor 行一并就位 = 无需补登） */
function seedPaidOrder(db: FakeD1, extra: FakeRow = {}): void {
  const id = typeof extra.id === "string" ? extra.id : "oq1";
  const contributorId = `c-${id}`;
  db.seed("orders", {
    id,
    channel: "alipay",
    ext_order_no: "sopaid000001",
    trade_no: "T100",
    amount_cny: 6,
    tier: "week",
    months: null,
    status: "paid",
    token: PAID_TOKEN,
    token_hash: unlockTokenHash(PAID_TOKEN),
    expires_at: NOW_SEC + 5 * 86_400,
    plan_id: null,
    nickname: "李四",
    message: null,
    contributor_id: contributorId,
    created_at: PAID_ISO,
    paid_at: PAID_ISO,
    refunded_at: null,
    ...extra,
  });
  db.seed("contributors", {
    id: typeof extra.contributor_id === "string" ? extra.contributor_id : contributorId,
    nickname: "李四",
    message: null,
    channel: "alipay",
    amount_cny: 6,
    created_at: PAID_ISO,
    hidden: 0,
  });
}

/** 无退款记录的 fastpay.refund.query 业务失败节点（stock 同口径） */
const NO_REFUND_NODE = {
  code: "40004",
  msg: "Business Failed",
  sub_code: "ACQ.TRADE_NOT_EXIST",
};

/** 按 method 分流的网关打桩（对账单轮会混合 query/close/refund.query） */
function stubMethods(
  handlers: Record<string, (biz: Record<string, unknown>) => Record<string, unknown>>,
): GatewayStub {
  return stubGateway(alipayPair.privatePem, (biz, method) => {
    const h = handlers[method];
    if (!h) throw new Error(`意外的网关方法：${method}`);
    return h(biz);
  });
}

// ---------------------------------------------------------------------------
// not_configured 降级
// ---------------------------------------------------------------------------
describe("M4 runAlipayReconcile · not_configured 降级", () => {
  const CASES: readonly (readonly [string, Partial<AlipayReconcileDeps>])[] = [
    ["db 未绑定", { db: null }],
    [
      "缺 ALIPAY_APP_ID",
      { env: { ALIPAY_PRIVATE_KEY: "x", ALIPAY_PUBLIC_KEY: "y" } },
    ],
    ["缺 Ed25519 私钥", { ed25519PrivateKeyHex: undefined }],
    ["Ed25519 私钥长度非 32 字节", { ed25519PrivateKeyHex: "abcd" }],
  ];
  it.each(CASES)("%s → not_configured 零写入", async (_l, over) => {
    const { db, writes } = makeDb();
    seedPendingOrder(db);
    const result = await runAlipayReconcile(depsOf(db, over));
    expect(result).toEqual(
      expect.objectContaining({ ok: false, error: "not_configured", dbWrites: 0 }),
    );
    expect(writes).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 1) 超时 pending 复核（关单 / 补发）
// ---------------------------------------------------------------------------
describe("M4 超时 pending 复核", () => {
  it("网关已付 → 与 notify 同一发码函数补发（token/贡献者行/幂等键全量断言）", async () => {
    const { db } = makeDb();
    seedPendingOrder(db);
    const gw = stubMethods({
      "alipay.trade.query": (biz) => {
        expect(biz.out_trade_no).toBe("sooldpending01");
        return {
          code: "10000",
          msg: "Success",
          trade_status: "TRADE_SUCCESS",
          total_amount: "6.00",
          trade_no: "T900",
          out_trade_no: biz.out_trade_no,
        };
      },
      // 补发后订单转 paid（paid_at=now 在窗口内）→ 同轮退款兜底会扫到
      "alipay.trade.fastpay.refund.query": () => NO_REFUND_NODE,
    });
    try {
      const result = await runAlipayReconcile(depsOf(db));
      expect(result).toEqual({
        ok: true,
        pendingChecked: 1,
        reissued: 1,
        closed: 0,
        refundChecked: 1, // 刚补发的 paid 单被退款兜底扫到（无退款不动）
        revoked: 0,
        revocationsRepaired: 0,
        contributorsRepaired: 0,
        dbWrites: 2, // orders UPDATE + contributors INSERT
      });
      const order = db.rows("orders")[0];
      expect(order.status).toBe("paid");
      expect(order.trade_no).toBe("T900");
      expect(order.paid_at).toBe(NOW_ISO);
      const token = String(order.token);
      const verified = verifyToken(token, TEST_PUBLIC_KEY_HEX, NOW_SEC);
      expect(verified).toEqual({
        ok: true,
        payload: {
          v: 1,
          tier: "week",
          exp: NOW_SEC + UNLOCK_TIERS.week.days * 86_400,
          iat: NOW_SEC,
          ch: "alipay",
        },
      });
      expect(order.token_hash).toBe(unlockTokenHash(token));
      // 贡献者行（D4：昵称留言带入；主键 = 订单行 contributor_id 回填值）
      const contrib = db.rows("contributors")[0];
      expect(contrib.nickname).toBe("张三");
      expect(contrib.message).toBe("加油");
      expect(contrib.channel).toBe("alipay");
      expect(contrib.amount_cny).toBe(6);
      expect(contrib.id).toBe(order.contributor_id);
    } finally {
      gw.restore();
    }
  });

  it("未付（WAIT_BUYER_PAY）→ 调 trade.close 并标 closed（不发码）", async () => {
    const { db } = makeDb();
    seedPendingOrder(db);
    const gw = stubMethods({
      "alipay.trade.query": () => ({
        code: "10000",
        trade_status: "WAIT_BUYER_PAY",
        total_amount: "6.00",
      }),
      "alipay.trade.close": (biz) => {
        expect(biz.out_trade_no).toBe("sooldpending01");
        return { code: "10000", msg: "Success" };
      },
    });
    try {
      const result = await runAlipayReconcile(depsOf(db));
      expect(result).toEqual(
        expect.objectContaining({ closed: 1, reissued: 0, dbWrites: 1 }),
      );
      expect(db.rows("orders")[0].status).toBe("closed");
      expect(gw.calls.map((c) => c.method)).toEqual([
        "alipay.trade.query",
        "alipay.trade.close",
      ]);
      expect(db.rows("contributors")).toHaveLength(0);
      expect(db.rows("orders")[0].token).toBeNull();
    } finally {
      gw.restore();
    }
  });

  it("已关闭态（TRADE_CLOSED）→ 直接标 closed 不再调 close", async () => {
    const { db } = makeDb();
    seedPendingOrder(db);
    const gw = stubMethods({
      "alipay.trade.query": () => ({
        code: "10000",
        trade_status: "TRADE_CLOSED",
        total_amount: "6.00",
      }),
    });
    try {
      const result = await runAlipayReconcile(depsOf(db));
      expect(result.closed).toBe(1);
      expect(db.rows("orders")[0].status).toBe("closed");
      expect(gw.calls.map((c) => c.method)).toEqual(["alipay.trade.query"]);
    } finally {
      gw.restore();
    }
  });

  it("交易不存在（未扫码，ACQ.TRADE_NOT_EXIST）→ 直接标 closed 不调 close", async () => {
    const { db } = makeDb();
    seedPendingOrder(db);
    const gw = stubMethods({
      "alipay.trade.query": () => ({
        code: "40004",
        msg: "Business Failed",
        sub_code: "ACQ.TRADE_NOT_EXIST",
      }),
    });
    try {
      const result = await runAlipayReconcile(depsOf(db));
      expect(result.closed).toBe(1);
      expect(db.rows("orders")[0].status).toBe("closed");
      expect(gw.calls.map((c) => c.method)).toEqual(["alipay.trade.query"]);
    } finally {
      gw.restore();
    }
  });

  it("金额不符 → 拒绝补发，保持 pending 待人工核查（零写入）", async () => {
    const { db, writes } = makeDb();
    seedPendingOrder(db);
    const gw = stubMethods({
      "alipay.trade.query": () => ({
        code: "10000",
        trade_status: "TRADE_SUCCESS",
        total_amount: "999.00",
        trade_no: "T901",
      }),
    });
    try {
      const result = await runAlipayReconcile(depsOf(db));
      expect(result).toEqual(
        expect.objectContaining({ reissued: 0, closed: 0, dbWrites: 0 }),
      );
      expect(db.rows("orders")[0].status).toBe("pending");
      expect(writes).not.toHaveBeenCalled();
    } finally {
      gw.restore();
    }
  });

  it("网关异常（其余 sub_code / 网络失败）→ 不动，留待下一轮重试", async () => {
    const { db, writes } = makeDb();
    seedPendingOrder(db);
    const gw = stubMethods({
      "alipay.trade.query": () => ({
        code: "40004",
        msg: "Business Failed",
        sub_code: "ACQ.SYSTEM_ERROR",
      }),
    });
    try {
      const result = await runAlipayReconcile(depsOf(db));
      expect(result).toEqual(
        expect.objectContaining({ pendingChecked: 1, closed: 0, dbWrites: 0 }),
      );
      expect(db.rows("orders")[0].status).toBe("pending");
      expect(writes).not.toHaveBeenCalled();
    } finally {
      gw.restore();
    }
  });

  it("未超时 pending 不扫描（30m 阈值内零网关调用）", async () => {
    const { db, writes } = makeDb();
    seedPendingOrder(db, { created_at: NOW_ISO });
    const gw = stubMethods({});
    try {
      const result = await runAlipayReconcile(depsOf(db));
      expect(result.pendingChecked).toBe(0);
      expect(gw.calls).toHaveLength(0);
      expect(db.rows("orders")[0].status).toBe("pending");
      expect(writes).not.toHaveBeenCalled();
    } finally {
      gw.restore();
    }
  });

  it("形状异常订单行（tier 非法）→ 防御跳过，不计 pendingChecked", async () => {
    const { db, writes } = makeDb();
    seedPendingOrder(db, { tier: "lifetime" });
    const gw = stubMethods({});
    try {
      const result = await runAlipayReconcile(depsOf(db));
      expect(result.pendingChecked).toBe(0);
      expect(gw.calls).toHaveLength(0);
      expect(writes).not.toHaveBeenCalled();
    } finally {
      gw.restore();
    }
  });

  it("补发并发幂等：orders 抢占被先写者拿走 → 吞异常不重复计数", async () => {
    const { db } = makeDb();
    seedPendingOrder(db);
    // 打桩 trade.query 已付，但在补发 UPDATE 前订单已被 notify 抢先发码
    // （模拟：查询响应返回前直接改库为 paid+token → 条件 UPDATE changes=0，
    //   issuePaidAlipayOrder 回读 paid 行幂等返回，不再写）
    const gw = stubMethods({
      "alipay.trade.query": () => {
        const row = db.rows("orders")[0];
        row.status = "paid";
        row.token = PAID_TOKEN;
        row.token_hash = unlockTokenHash(PAID_TOKEN);
        row.expires_at = NOW_SEC + 7 * 86_400;
        return {
          code: "10000",
          trade_status: "TRADE_SUCCESS",
          total_amount: "6.00",
          trade_no: "T902",
        };
      },
      "alipay.trade.fastpay.refund.query": () => NO_REFUND_NODE,
    });
    try {
      const result = await runAlipayReconcile(depsOf(db));
      // 抢占失败走回读幂等路径：不计补发、orders/contributors 零写入
      expect(result.reissued).toBe(0);
      expect(db.rows("orders")[0].token).toBe(PAID_TOKEN);
      expect(db.rows("contributors")).toHaveLength(0);
    } finally {
      gw.restore();
    }
  });
});

// ---------------------------------------------------------------------------
// 2) 退款兜底（fastpay.refund.query → 吊销闭环）
// ---------------------------------------------------------------------------
describe("M4 退款兜底与吊销闭环", () => {
  it("REFUND_SUCCESS → revocations 落行（reason=refund）+ orders→refunded", async () => {
    const { db } = makeDb();
    seedPaidOrder(db);
    const gw = stubMethods({
      "alipay.trade.fastpay.refund.query": (biz) => {
        expect(biz.out_trade_no).toBe("sopaid000001");
        // 幂等键与管理台退款同源：refund-<out_trade_no>
        expect(biz.out_request_no).toBe(alipayRefundRequestNo("sopaid000001"));
        return {
          code: "10000",
          refund_status: "REFUND_SUCCESS",
          refund_amount: "6.00",
          out_trade_no: biz.out_trade_no,
          trade_no: "T100",
        };
      },
    });
    try {
      const result = await runAlipayReconcile(depsOf(db));
      expect(result).toEqual(
        expect.objectContaining({ refundChecked: 1, revoked: 1, dbWrites: 2 }),
      );
      const order = db.rows("orders")[0];
      expect(order.status).toBe("refunded");
      expect(order.refunded_at).toBe(NOW_ISO);
      expect(db.rows("revocations")).toEqual([
        {
          token_hash: unlockTokenHash(PAID_TOKEN),
          exp: NOW_SEC + 5 * 86_400,
          reason: "refund",
          revoked_at: NOW_ISO,
          restored: 0,
        },
      ]);
    } finally {
      gw.restore();
    }
  });

  it("幂等重跑：已 refunded 单不再扫描（refundChecked=0 零写入）", async () => {
    const { db, writes } = makeDb();
    seedPaidOrder(db);
    const gw = stubMethods({
      "alipay.trade.fastpay.refund.query": () => ({
        code: "10000",
        refund_status: "REFUND_SUCCESS",
        refund_amount: "6.00",
      }),
    });
    try {
      const first = await runAlipayReconcile(depsOf(db));
      expect(first.revoked).toBe(1);
      writes.mockClear(); // 第二轮单独计数
      const second = await runAlipayReconcile(depsOf(db));
      expect(second).toEqual(
        expect.objectContaining({
          pendingChecked: 0,
          refundChecked: 0,
          revoked: 0,
          revocationsRepaired: 0,
          dbWrites: 0,
        }),
      );
      expect(writes).not.toHaveBeenCalled();
    } finally {
      gw.restore();
    }
  });

  it("无 refund_status 字段（未退款）→ 不吊销零写入", async () => {
    const { db, writes } = makeDb();
    seedPaidOrder(db);
    const gw = stubMethods({
      "alipay.trade.fastpay.refund.query": () => ({
        code: "10000",
        out_trade_no: "sopaid000001",
        trade_no: "T100",
      }),
    });
    try {
      const result = await runAlipayReconcile(depsOf(db));
      expect(result).toEqual(
        expect.objectContaining({ refundChecked: 1, revoked: 0, dbWrites: 0 }),
      );
      expect(db.rows("orders")[0].status).toBe("paid");
      expect(db.rows("revocations")).toHaveLength(0);
      expect(writes).not.toHaveBeenCalled();
    } finally {
      gw.restore();
    }
  });

  it("退款查询业务失败（无退款记录）→ 不吊销", async () => {
    const { db } = makeDb();
    seedPaidOrder(db);
    const gw = stubMethods({
      "alipay.trade.fastpay.refund.query": () => NO_REFUND_NODE,
    });
    try {
      const result = await runAlipayReconcile(depsOf(db));
      expect(result.revoked).toBe(0);
      expect(db.rows("orders")[0].status).toBe("paid");
    } finally {
      gw.restore();
    }
  });

  it("token_hash 列缺失 → 回退哈希 token 明文；token 也缺 → 仅标 refunded 无吊销行", async () => {
    const { db } = makeDb();
    seedPaidOrder(db, { id: "oq1", ext_order_no: "sopaid000001", token_hash: null });
    seedPaidOrder(db, {
      id: "oq2",
      ext_order_no: "sopaid000002",
      contributor_id: "c-oq2",
      token: null,
      token_hash: null,
      paid_at: new Date((NOW_SEC - 86_000) * 1000).toISOString(),
    });
    const gw = stubMethods({
      "alipay.trade.fastpay.refund.query": () => ({
        code: "10000",
        refund_status: "REFUND_SUCCESS",
        refund_amount: "6.00",
      }),
    });
    try {
      const result = await runAlipayReconcile(depsOf(db));
      expect(result.revoked).toBe(2);
      // oq1：回退 unlockTokenHash(token)；oq2：无素材仅翻订单状态
      expect(db.rows("revocations")).toEqual([
        expect.objectContaining({ token_hash: unlockTokenHash(PAID_TOKEN) }),
      ]);
      expect(db.rows("orders").map((r) => r.status)).toEqual([
        "refunded",
        "refunded",
      ]);
    } finally {
      gw.restore();
    }
  });

  it("吊销幂等：哈希已在名单（含 restored 行）→ 不重写（只增不删 §7-6）", async () => {
    const { db } = makeDb();
    seedPaidOrder(db);
    db.seed("revocations", {
      token_hash: unlockTokenHash(PAID_TOKEN),
      exp: NOW_SEC + 5 * 86_400,
      reason: "manual",
      revoked_at: "earlier",
      restored: 1, // 曾解除——对账不得翻转/重写（恢复语义归管理台）
    });
    const gw = stubMethods({
      "alipay.trade.fastpay.refund.query": () => ({
        code: "10000",
        refund_status: "REFUND_SUCCESS",
        refund_amount: "6.00",
      }),
    });
    try {
      const result = await runAlipayReconcile(depsOf(db));
      expect(result.revoked).toBe(1); // 订单状态照翻
      expect(result.dbWrites).toBe(1); // 仅 orders UPDATE
      expect(db.rows("revocations")).toEqual([
        expect.objectContaining({ reason: "manual", restored: 1 }),
      ]);
    } finally {
      gw.restore();
    }
  });

  it("滚动游标：满轮推进 last（仅值变化才写），未满轮归零", async () => {
    const { db } = makeDb();
    const total = ALIPAY_REFUND_SCAN_LIMIT + 1;
    for (let i = 0; i < total; i++) {
      seedPaidOrder(db, {
        id: `og${i}`,
        ext_order_no: `sopaidcur${String(i).padStart(4, "0")}`,
        contributor_id: `c-og${i}`,
        token: `SO1.p${i}.s`,
        token_hash: unlockTokenHash(`SO1.p${i}.s`),
        paid_at: new Date((NOW_SEC - 86_400 + i * 60) * 1000).toISOString(),
      });
    }
    const gw = stubMethods({
      "alipay.trade.fastpay.refund.query": () => NO_REFUND_NODE,
    });
    try {
      const first = await runAlipayReconcile(depsOf(db));
      expect(first.refundChecked).toBe(ALIPAY_REFUND_SCAN_LIMIT);
      expect(first.dbWrites).toBe(1); // 仅游标推进 1 写
      const cursorRow = db
        .rows("kv_state")
        .find((r) => r.k === ALIPAY_REFUND_CURSOR_STATE_KEY);
      const last = (JSON.parse(String(cursorRow?.v)) as { last: string }).last;
      expect(last).toBe(
        new Date((NOW_SEC - 86_400 + (total - 2) * 60) * 1000).toISOString(),
      );

      const second = await runAlipayReconcile(depsOf(db));
      expect(second.refundChecked).toBe(1); // 游标之后仅剩 1 单
      expect(second.dbWrites).toBe(1); // 未满轮归零 → 游标翻回 '' 1 写
      const cursorRow2 = db
        .rows("kv_state")
        .find((r) => r.k === ALIPAY_REFUND_CURSOR_STATE_KEY);
      expect(JSON.parse(String(cursorRow2?.v))).toEqual({ last: "" });
    } finally {
      gw.restore();
    }
  });

  it("非法游标 JSON → 视同从头扫（防御）", async () => {
    const { db } = makeDb();
    db.seed("kv_state", {
      k: ALIPAY_REFUND_CURSOR_STATE_KEY,
      v: "{broken",
      updated_at: "seed",
    });
    seedPaidOrder(db);
    const gw = stubMethods({
      "alipay.trade.fastpay.refund.query": () => NO_REFUND_NODE,
    });
    try {
      const result = await runAlipayReconcile(depsOf(db));
      expect(result.refundChecked).toBe(1);
    } finally {
      gw.restore();
    }
  });

  it("lookbackDays 非法（≤0/NaN）→ 回退默认 15 天窗口", async () => {
    const { db } = makeDb();
    // 窗口外（20 天前）paid 单：默认 15 天窗口下不扫描
    seedPaidOrder(db, {
      paid_at: new Date((NOW_SEC - 20 * 86_400) * 1000).toISOString(),
    });
    const gw = stubMethods({});
    try {
      const result = await runAlipayReconcile(depsOf(db, { lookbackDays: 0 }));
      expect(result.refundChecked).toBe(0);
      expect(gw.calls).toHaveLength(0);
    } finally {
      gw.restore();
    }
  });
});

// ---------------------------------------------------------------------------
// 3) 修复段（吊销登记核对 + 贡献者补登）
// ---------------------------------------------------------------------------
describe("M4 修复段", () => {
  it("吊销登记核对：窗口内 refunded 单缺 revocations 行 → 补登（幂等）", async () => {
    const { db } = makeDb();
    // 管理台退款中断场景：orders 已 refunded 但 revocations 缺行
    seedPaidOrder(db, {
      status: "refunded",
      refunded_at: PAID_ISO,
    });
    const gw = stubMethods({});
    try {
      const first = await runAlipayReconcile(depsOf(db));
      expect(first).toEqual(
        expect.objectContaining({ revocationsRepaired: 1, dbWrites: 1 }),
      );
      expect(db.rows("revocations")).toEqual([
        expect.objectContaining({
          token_hash: unlockTokenHash(PAID_TOKEN),
          reason: "refund",
          restored: 0,
        }),
      ]);
      const second = await runAlipayReconcile(depsOf(db));
      expect(second).toEqual(
        expect.objectContaining({ revocationsRepaired: 0, dbWrites: 0 }),
      );
      expect(db.rows("revocations")).toHaveLength(1);
    } finally {
      gw.restore();
    }
  });

  it("吊销登记核对：窗口外 refunded 单不扫描；素材缺失（无 token）跳过", async () => {
    const { db, writes } = makeDb();
    seedPaidOrder(db, {
      id: "old1",
      ext_order_no: "sopaidold00001",
      contributor_id: "c-old1",
      status: "refunded",
      refunded_at: new Date((NOW_SEC - 20 * 86_400) * 1000).toISOString(),
    });
    seedPaidOrder(db, {
      id: "nul1",
      ext_order_no: "sopaidnul00001",
      contributor_id: "c-nul1",
      status: "refunded",
      refunded_at: PAID_ISO,
      token: null,
      token_hash: null,
    });
    const gw = stubMethods({});
    try {
      const result = await runAlipayReconcile(depsOf(db));
      expect(result.revocationsRepaired).toBe(0);
      expect(db.rows("revocations")).toHaveLength(0);
      expect(writes).not.toHaveBeenCalled();
    } finally {
      gw.restore();
    }
  });

  it("贡献者补登：paid 单 contributor_id 无对应行 → 补 INSERT（M2 登记 7 兜底）", async () => {
    const { db } = makeDb();
    seedPaidOrder(db);
    // 移除贡献者行模拟「已发码未上名单」的极端中断
    db.rows("contributors").length = 0;
    const gw = stubMethods({
      "alipay.trade.fastpay.refund.query": () => NO_REFUND_NODE,
    });
    try {
      const first = await runAlipayReconcile(depsOf(db));
      expect(first).toEqual(
        expect.objectContaining({ contributorsRepaired: 1, dbWrites: 1 }),
      );
      expect(db.rows("contributors")).toEqual([
        {
          id: "c-oq1",
          nickname: "李四",
          message: null,
          channel: "alipay",
          amount_cny: 6,
          created_at: PAID_ISO,
          hidden: 0,
        },
      ]);
      const second = await runAlipayReconcile(depsOf(db));
      expect(second.contributorsRepaired).toBe(0);
      expect(db.rows("contributors")).toHaveLength(1);
    } finally {
      gw.restore();
    }
  });
});

// ---------------------------------------------------------------------------
// 无变化零写入总断言（提示词硬性约束）
// ---------------------------------------------------------------------------
describe("M4 无变化零写入", () => {
  it("混合存量（未超时 pending / 无退款 paid / 已吊销 refunded / 名单齐全）→ 全程零写", async () => {
    const { db, writes } = makeDb();
    seedPendingOrder(db, { created_at: NOW_ISO }); // 未超时
    seedPaidOrder(db); // 无退款
    seedPaidOrder(db, {
      id: "or1",
      ext_order_no: "sorefunded0001",
      contributor_id: "c-or1",
      token: "SO1.r.s",
      token_hash: unlockTokenHash("SO1.r.s"),
      status: "refunded",
      refunded_at: PAID_ISO,
    });
    db.seed("revocations", {
      token_hash: unlockTokenHash("SO1.r.s"),
      exp: NOW_SEC + 86_400,
      reason: "refund",
      revoked_at: PAID_ISO,
      restored: 0,
    });
    const gw = stubMethods({
      "alipay.trade.fastpay.refund.query": () => NO_REFUND_NODE,
    });
    try {
      const result = await runAlipayReconcile(depsOf(db));
      expect(result).toEqual({
        ok: true,
        pendingChecked: 0,
        reissued: 0,
        closed: 0,
        refundChecked: 1,
        revoked: 0,
        revocationsRepaired: 0,
        contributorsRepaired: 0,
        dbWrites: 0,
      });
      expect(writes).not.toHaveBeenCalled();
    } finally {
      gw.restore();
    }
  });
});

// ---------------------------------------------------------------------------
// 统一入口 runUnifiedSync + scheduled 壳（爱发电巡检回归：两段独立降级）
// ---------------------------------------------------------------------------
describe("M4 runUnifiedSync（单 cron 统一对账）", () => {
  it("爱发电段照跑（空单页）+ 支付宝段照跑（超时关单）——两段结果并列返回", async () => {
    const { db } = makeDb();
    seedPendingOrder(db);
    const gw = stubMethods({
      "alipay.trade.query": () => ({
        code: "10000",
        trade_status: "TRADE_CLOSED",
        total_amount: "6.00",
      }),
    });
    try {
      const result = await runUnifiedSync(
        {
          db,
          // 爱发电走注入 fetchFn（与网关打桩互不干扰）
          fetchFn: async () => ({
            ok: true,
            json: async () => ({ ec: 200, data: { list: [] } }),
          }),
          secrets: { afdianUserId: "u", afdianToken: "t" },
          nowSec: NOW_SEC,
          lookbackDays: 15,
          autoRevoke: false,
          by: "cron",
        },
        depsOf(db),
      );
      expect(result.afdian).toEqual(
        expect.objectContaining({ ok: true, scanned: 0, dbWrites: 1 }),
      );
      expect(result.alipay).toEqual(
        expect.objectContaining({ ok: true, closed: 1 }),
      );
    } finally {
      gw.restore();
    }
  });

  it("独立降级：爱发电缺凭据 not_configured 不阻断支付宝段（反之亦然）", async () => {
    const { db } = makeDb();
    seedPendingOrder(db, { created_at: NOW_ISO });
    const gw = stubMethods({});
    try {
      const result = await runUnifiedSync(
        {
          db,
          fetchFn: async () => ({ ok: true, json: async () => ({}) }),
          secrets: {},
          nowSec: NOW_SEC,
          lookbackDays: 15,
          autoRevoke: false,
          by: "cron",
        },
        depsOf(db, { ed25519PrivateKeyHex: undefined }),
      );
      expect(result.afdian).toEqual(
        expect.objectContaining({ ok: false, error: "not_configured" }),
      );
      expect(result.alipay).toEqual(
        expect.objectContaining({ ok: false, error: "not_configured" }),
      );
    } finally {
      gw.restore();
    }
  });

  it("scheduled 壳：挂接 waitUntil 并注入两段 env 绑定（未配置 → 双 not_configured）", async () => {
    const captured: Promise<unknown>[] = [];
    worker.scheduled(
      null,
      { REFUND_LOOKBACK_DAYS: "15", REFUND_AUTO_REVOKE: "" },
      { waitUntil: (p) => captured.push(p) },
    );
    expect(captured).toHaveLength(1);
    await expect(captured[0]).resolves.toEqual({
      afdian: expect.objectContaining({ ok: false, error: "not_configured" }),
      alipay: expect.objectContaining({ ok: false, error: "not_configured" }),
    });
  });
});
