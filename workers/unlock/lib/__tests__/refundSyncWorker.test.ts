/**
 * @jest-environment node
 *
 * A6-2 退款巡检纯逻辑测试（REQUIREMENTS_UNLOCK.md §A6-2 / §0.15 / §0.16；
 * Z 迭代 M1：mock KV → FakeD1——疑似名单/cursor 走 kv_state 行，兑换记录
 * 查 orders 表，自动吊销写 revocations 表；检测/幂等/截断语义逐条回归）：
 * 1) 分页请求构造（签名族复用）与分页响应解析（防御矩阵）
 * 2) runRefundSync：not_configured / 疑似单检出（status != 2 且 orders 有
 *    兑换记录）/ 幂等去重 / 回看窗口日期截断终止 / 页数 ≤20 上限 /
 *    上游错误部分扫描 / 模式 A DB 写 ≤2 断言 / 自动吊销分支
 * 3) index.ts scheduled 壳挂接（waitUntil 被调用）
 */
import { md5hex } from "../md5";
import {
  buildAfdianQueryOrderPageRequest,
  parseAfdianQueryOrderPageResponse,
} from "../afdian";
import {
  REFUND_SUSPECTS_STATE_KEY,
  REVOKE_CURSOR_STATE_KEY,
} from "../db";
import {
  REFUND_SYNC_MAX_PAGES,
  runRefundSync,
  sanitizeRefundSuspects,
  type RefundSyncDeps,
} from "../refundSync";
import worker from "../../index";
import { unlockTokenHash } from "../../../../src/utils/revocationList";
import { FakeD1, type FakeRow } from "./helpers/fakeD1";

// ---------------------------------------------------------------------------
// FakeD1 构造 / fetch mock
// ---------------------------------------------------------------------------

interface CountedDb {
  readonly db: FakeD1;
  readonly writes: jest.SpyInstance;
}

function makeDb(): CountedDb {
  const db = new FakeD1();
  return { db, writes: jest.spyOn(db, "_write") };
}

/** 已兑换订单行注入（KV 时代 `order:<单号>` 记录的 D1 等价物） */
function seedOrder(db: FakeD1, orderId: string, token: string, exp: number): void {
  db.seed("orders", {
    id: `seed-${orderId}`,
    channel: "afdian",
    ext_order_no: orderId,
    token,
    expires_at: exp,
    status: "paid",
    created_at: "seed",
  });
}

/** kv_state 单键 JSON 读取（断言辅助；无记录 → null） */
function stateOf(db: FakeD1, key: string): unknown {
  const row = db.rows("kv_state").find((r) => r.k === key);
  if (!row) return null;
  return JSON.parse(String(row.v));
}

function seedState(db: FakeD1, key: string, value: unknown): void {
  db.seed("kv_state", { k: key, v: JSON.stringify(value), updated_at: "seed" });
}

const NOW_SEC = Date.parse("2026-08-14T12:00:00Z") / 1000;

/** 距 now 若干天前的订单号（前 14 位 = 北京时间下单时刻，UTC+8） */
function orderIdDaysAgo(days: number, suffix = "000001"): string {
  const d = new Date((NOW_SEC - days * 86_400 + 8 * 3600) * 1000);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}` +
    suffix
  );
}

/** 分页 fetch mock：pages[i] = 第 i+1 页订单数组；越界返回空页 */
function makePagedFetch(
  pages: readonly { out_trade_no: string; status: number }[][],
): { fetchFn: RefundSyncDeps["fetchFn"]; calls: number[] } {
  const calls: number[] = [];
  const fetchFn: RefundSyncDeps["fetchFn"] = async (_url, init) => {
    const body = JSON.parse(init.body) as { params: string };
    const page = (JSON.parse(body.params) as { page: number }).page;
    calls.push(page);
    return {
      ok: true,
      json: async () => ({ ec: 200, data: { list: pages[page - 1] ?? [] } }),
    };
  };
  return { fetchFn, calls };
}

function makeDeps(overrides: Partial<RefundSyncDeps>): RefundSyncDeps {
  return {
    db: makeDb().db,
    fetchFn: async () => ({ ok: true, json: async () => ({ ec: 200, data: { list: [] } }) }),
    secrets: { afdianUserId: "user1", afdianToken: "tok1" },
    nowSec: NOW_SEC,
    lookbackDays: 15,
    autoRevoke: false,
    by: "cron",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 分页请求构造 / 响应解析
// ---------------------------------------------------------------------------

describe("A6-2 buildAfdianQueryOrderPageRequest（签名族复用）", () => {
  it("params = { page }；MD5 签名与单号形态同算法", () => {
    const req = buildAfdianQueryOrderPageRequest("uid", "tok", 3, 1_755_000_000);
    const body = JSON.parse(req.body) as Record<string, unknown>;
    expect(body.user_id).toBe("uid");
    expect(body.params).toBe('{"page":3}');
    expect(body.ts).toBe(1_755_000_000);
    expect(body.sign).toBe(
      md5hex('tokparams{"page":3}ts1755000000user_iduid'),
    );
    expect(req.url).toBe("https://afdian.com/api/open/query-order");
  });
});

describe("A6-2 parseAfdianQueryOrderPageResponse（防御矩阵）", () => {
  it.each([
    ["null", null],
    ["非对象", "junk"],
    ["ec ≠ 200", { ec: 400, data: { list: [] } }],
    ["data 缺失", { ec: 200 }],
    ["list 非数组", { ec: 200, data: { list: "nope" } }],
  ])("%s → upstream_error", (_name, raw) => {
    expect(parseAfdianQueryOrderPageResponse(raw)).toEqual({
      kind: "upstream_error",
    });
  });

  it("合法响应：归一化订单号与 status；非法条目丢弃", () => {
    const raw = {
      ec: 200,
      data: {
        list: [
          { out_trade_no: "202608140001", status: 2 },
          { out_trade_no: "202608140002", status: "3" },
          { out_trade_no: 123, status: 2 }, // 订单号非字符串 → 丢弃
          { out_trade_no: "", status: 2 }, // 空订单号 → 丢弃
          null, // 非对象 → 丢弃
        ],
      },
    };
    expect(parseAfdianQueryOrderPageResponse(raw)).toEqual({
      kind: "ok",
      orders: [
        { orderId: "202608140001", status: 2 },
        { orderId: "202608140002", status: 3 },
      ],
    });
  });
});

describe("A6-2 sanitizeRefundSuspects（防御式）", () => {
  it("形状不符 → 空名单；条目非法丢弃；orderId 去重", () => {
    expect(sanitizeRefundSuspects(null)).toEqual({ v: 1, orders: [] });
    expect(sanitizeRefundSuspects({ v: 2, orders: [] })).toEqual({ v: 1, orders: [] });
    const good = { orderId: "1", detectedAt: "t", status: 3 };
    expect(
      sanitizeRefundSuspects({
        v: 1,
        orders: [good, { orderId: "1", detectedAt: "dup", status: 4 },
          { orderId: 2, detectedAt: "t", status: 3 }, "junk",
          { orderId: "3", detectedAt: "t", status: 4, note: "n" }],
      }),
    ).toEqual({
      v: 1,
      orders: [good, { orderId: "3", detectedAt: "t", status: 4, note: "n" }],
    });
  });

  it.each([
    ["数组", []],
    ["detectedAt 非字符串", { v: 1, orders: [{ orderId: "1", detectedAt: 5, status: 3 }] }],
    ["status NaN", { v: 1, orders: [{ orderId: "1", detectedAt: "t", status: Number.NaN }] }],
  ])("防御矩阵补充（%s）→ 归空/丢弃", (_l, raw) => {
    expect(sanitizeRefundSuspects(raw)).toEqual({ v: 1, orders: [] });
  });
});

// ---------------------------------------------------------------------------
// runRefundSync 主流程
// ---------------------------------------------------------------------------

describe("A6-2 runRefundSync", () => {
  it("DB 未绑定 / secrets 缺失 → not_configured 零写", async () => {
    const { db, writes } = makeDb();
    expect(await runRefundSync(makeDeps({ db: null }))).toEqual(
      expect.objectContaining({ ok: false, error: "not_configured", dbWrites: 0 }),
    );
    expect(
      await runRefundSync(makeDeps({ db, secrets: { afdianToken: "t" } })),
    ).toEqual(expect.objectContaining({ ok: false, error: "not_configured" }));
    expect(writes).not.toHaveBeenCalled();
  });

  it("疑似单检出：status != 2 且 orders 有兑换记录 → 登记 suspects + cursor（写 = 2）", async () => {
    const refunded = orderIdDaysAgo(2, "111111");
    const unpaidNoRecord = orderIdDaysAgo(1, "222222");
    const paid = orderIdDaysAgo(3, "333333");
    const { db } = makeDb();
    seedOrder(db, refunded, "SO1.a.b", NOW_SEC + 86400);
    const { fetchFn } = makePagedFetch([[
      { out_trade_no: unpaidNoRecord, status: 1 }, // 未支付且无记录 → 不登记
      { out_trade_no: refunded, status: 3 }, // 已兑换后退款 → 登记
      { out_trade_no: paid, status: 2 }, // 正常已支付 → 跳过
    ]]);
    const result = await runRefundSync(makeDeps({ db, fetchFn }));
    expect(result).toEqual({ ok: true, scanned: 3, newSuspects: 1, dbWrites: 2 });
    expect(stateOf(db, REFUND_SUSPECTS_STATE_KEY)).toEqual({
      v: 1,
      orders: [
        {
          orderId: refunded,
          detectedAt: new Date(NOW_SEC * 1000).toISOString(),
          status: 3,
        },
      ],
    });
    expect(stateOf(db, REVOKE_CURSOR_STATE_KEY)).toEqual({
      lastRun: new Date(NOW_SEC * 1000).toISOString(),
      scanned: 3,
      suspects: 1,
      by: "cron",
    });
    // 模式 A：不写 revocations 表
    expect(db.rows("revocations")).toHaveLength(0);
  });

  it("幂等：已登记疑似单再次巡检不重复登记（suspects 不重写，仅 cursor 1 写）", async () => {
    const refunded = orderIdDaysAgo(2, "111111");
    const { db } = makeDb();
    seedOrder(db, refunded, "SO1.a.b", NOW_SEC + 86400);
    seedState(db, REFUND_SUSPECTS_STATE_KEY, {
      v: 1,
      orders: [{ orderId: refunded, detectedAt: "earlier", status: 3 }],
    });
    const { fetchFn } = makePagedFetch([[{ out_trade_no: refunded, status: 3 }]]);
    const result = await runRefundSync(makeDeps({ db, fetchFn }));
    expect(result).toEqual({ ok: true, scanned: 1, newSuspects: 0, dbWrites: 1 });
    // 已登记单不再查 orders 行（先查 known 集合）
    expect(
      (stateOf(db, REFUND_SUSPECTS_STATE_KEY) as { orders: unknown[] }).orders,
    ).toHaveLength(1);
  });

  it("订单号日期不可解析 → 跳过不计 scanned（防御）；存量名单非法 JSON → 视同空名单", async () => {
    const refunded = orderIdDaysAgo(2, "111111");
    const { db } = makeDb();
    seedOrder(db, refunded, "SO1.a.b", NOW_SEC + 86400);
    // kv_state 存量疑似名单为非法 JSON → getStateJson 归 null → 空名单
    db.seed("kv_state", { k: REFUND_SUSPECTS_STATE_KEY, v: "{broken", updated_at: "seed" });
    const { fetchFn } = makePagedFetch([[
      { out_trade_no: "not-a-date-order", status: 3 }, // 日期不可解析 → 跳过
      { out_trade_no: refunded, status: 3 },
    ]]);
    const result = await runRefundSync(makeDeps({ db, fetchFn }));
    expect(result).toEqual({ ok: true, scanned: 1, newSuspects: 1, dbWrites: 2 });
    expect(
      (stateOf(db, REFUND_SUSPECTS_STATE_KEY) as { orders: unknown[] }).orders,
    ).toHaveLength(1);
  });

  it("lookbackDays 非法（≤0/NaN）→ 回退默认 15 天窗口", async () => {
    const inWindow = orderIdDaysAgo(10, "111111"); // 15 天默认窗口内
    const outWindow = orderIdDaysAgo(20, "222222");
    const { fetchFn } = makePagedFetch([[
      { out_trade_no: inWindow, status: 2 },
      { out_trade_no: outWindow, status: 2 },
    ]]);
    const result = await runRefundSync(makeDeps({ fetchFn, lookbackDays: 0 }));
    expect(result.scanned).toBe(1); // 默认窗口生效：仅 10 天前订单计入
  });

  it("回看窗口截断：页内出现窗口外订单即终止分页（不再拉后续页）", async () => {
    const inWindow = orderIdDaysAgo(10, "111111");
    const outWindow = orderIdDaysAgo(20, "222222"); // 15 天窗口外
    const { fetchFn, calls } = makePagedFetch([
      [
        { out_trade_no: inWindow, status: 2 },
        { out_trade_no: outWindow, status: 3 },
      ],
      [{ out_trade_no: orderIdDaysAgo(25, "333333"), status: 3 }],
    ]);
    const { db } = makeDb();
    const result = await runRefundSync(makeDeps({ db, fetchFn }));
    expect(calls).toEqual([1]); // 第 2 页未拉取
    expect(result.scanned).toBe(1); // 窗口外订单不计 scanned
    expect(result.newSuspects).toBe(0);
  });

  it("页数上限：恒有单的上游最多拉 REFUND_SYNC_MAX_PAGES 页（子请求限额防御）", async () => {
    const pages = Array.from({ length: 30 }, (_, i) => [
      { out_trade_no: orderIdDaysAgo(1, String(100000 + i)), status: 2 },
    ]);
    const { fetchFn, calls } = makePagedFetch(pages);
    const result = await runRefundSync(makeDeps({ fetchFn }));
    expect(calls).toHaveLength(REFUND_SYNC_MAX_PAGES);
    expect(result.scanned).toBe(REFUND_SYNC_MAX_PAGES);
  });

  it("上游错误：终止分页但已收集候选照常登记 + cursor 照写（部分扫描口径）", async () => {
    const refunded = orderIdDaysAgo(2, "111111");
    const { db } = makeDb();
    seedOrder(db, refunded, "SO1.a.b", NOW_SEC + 86400);
    let call = 0;
    const fetchFn: RefundSyncDeps["fetchFn"] = async () => {
      call += 1;
      if (call === 1) {
        return {
          ok: true,
          json: async () => ({
            ec: 200,
            data: { list: [{ out_trade_no: refunded, status: 3 }] },
          }),
        };
      }
      throw new Error("network down");
    };
    const result = await runRefundSync(makeDeps({ db, fetchFn }));
    expect(result).toEqual({
      ok: false,
      error: "upstream_error",
      scanned: 1,
      newSuspects: 1,
      dbWrites: 2,
    });
    expect(stateOf(db, REVOKE_CURSOR_STATE_KEY)).not.toBeNull();
  });

  it("HTTP 非 2xx → upstream_error（首页失败零候选，仅 cursor 1 写）", async () => {
    const { db } = makeDb();
    const fetchFn: RefundSyncDeps["fetchFn"] = async () => ({
      ok: false,
      json: async () => ({}),
    });
    const result = await runRefundSync(makeDeps({ db, fetchFn }));
    expect(result).toEqual({
      ok: false,
      error: "upstream_error",
      scanned: 0,
      newSuspects: 0,
      dbWrites: 1,
    });
  });

  it("模式 A DB 写上限断言：任何巡检 ≤2 行写（§0.16 额度契约沿用）", async () => {
    // 多个疑似单也只合并为一次 suspects 写 + 一次 cursor 写
    const r1 = orderIdDaysAgo(1, "111111");
    const r2 = orderIdDaysAgo(2, "222222");
    const { db, writes } = makeDb();
    seedOrder(db, r1, "SO1.a.b", NOW_SEC + 1);
    seedOrder(db, r2, "SO1.c.d", NOW_SEC + 2);
    const { fetchFn } = makePagedFetch([[
      { out_trade_no: r1, status: 3 },
      { out_trade_no: r2, status: 4 },
    ]]);
    const result = await runRefundSync(makeDeps({ db, fetchFn }));
    expect(result.dbWrites).toBeLessThanOrEqual(2);
    expect(writes.mock.calls.length).toBeLessThanOrEqual(2);
    expect(result.newSuspects).toBe(2);
  });

  it("自动吊销分支（REFUND_AUTO_REVOKE=1）：token 哈希入 revocations 表（reason=refund）", async () => {
    const refunded = orderIdDaysAgo(2, "111111");
    const token = "SO1.payload.sig";
    const exp = NOW_SEC + 5 * 86_400;
    const { db } = makeDb();
    seedOrder(db, refunded, token, exp);
    // 既有吊销条目（他单）保留不动
    db.seed("revocations", {
      token_hash: "f".repeat(64),
      exp: NOW_SEC + 999,
      revoked_at: "existing",
      reason: null,
      restored: 0,
    });
    const { fetchFn } = makePagedFetch([[{ out_trade_no: refunded, status: 3 }]]);
    const result = await runRefundSync(makeDeps({ db, fetchFn, autoRevoke: true }));
    expect(result.dbWrites).toBe(3); // suspects + revocations 1 行 + cursor
    const rows = db.rows("revocations");
    expect(rows).toHaveLength(2); // 既有条目保留 + 新增
    expect(rows[1]).toEqual({
      token_hash: unlockTokenHash(token),
      exp,
      reason: "refund",
      revoked_at: new Date(NOW_SEC * 1000).toISOString(),
      restored: 0,
    });
  });

  it("自动吊销幂等：哈希已在名单（含 restored 行）→ 不重写 revocations", async () => {
    const refunded = orderIdDaysAgo(2, "111111");
    const token = "SO1.payload.sig";
    const { db } = makeDb();
    seedOrder(db, refunded, token, NOW_SEC + 86400);
    db.seed("revocations", {
      token_hash: unlockTokenHash(token),
      exp: NOW_SEC + 86400,
      revoked_at: "existing",
      reason: "manual",
      restored: 0,
    });
    const { fetchFn } = makePagedFetch([[{ out_trade_no: refunded, status: 3 }]]);
    const result = await runRefundSync(makeDeps({ db, fetchFn, autoRevoke: true }));
    expect(result.dbWrites).toBe(2); // 仅 suspects + cursor
    expect(db.rows("revocations")).toHaveLength(1);
  });

  it.each([
    ["token 空串", { token: "" }],
    ["token 为 NULL", { token: null }],
    ["expires_at 非数字", { expires_at: "soon" }],
  ])("自动吊销：orders 行形状异常（%s）→ 留给人工核实，不写 revocations", async (_l, overrides) => {
    const refunded = orderIdDaysAgo(2, "111111");
    const { db } = makeDb();
    db.seed("orders", {
      id: "seed-broken",
      channel: "afdian",
      ext_order_no: refunded,
      token: "SO1.ok.sig",
      expires_at: NOW_SEC + 86400,
      status: "paid",
      created_at: "seed",
      ...overrides,
    });
    const { fetchFn } = makePagedFetch([[{ out_trade_no: refunded, status: 3 }]]);
    const result = await runRefundSync(makeDeps({ db, fetchFn, autoRevoke: true }));
    expect(result.newSuspects).toBe(1); // 照常登记疑似
    expect(db.rows("revocations")).toHaveLength(0);
    expect(result.dbWrites).toBe(2);
  });

  it("自动吊销：两疑似单同一 token（同哈希）→ 名单只写一行（seen 去重）", async () => {
    const r1 = orderIdDaysAgo(1, "111111");
    const r2 = orderIdDaysAgo(2, "222222");
    const token = "SO1.same.sig";
    const { db } = makeDb();
    seedOrder(db, r1, token, NOW_SEC + 86400);
    seedOrder(db, r2, token, NOW_SEC + 86400);
    const { fetchFn } = makePagedFetch([[
      { out_trade_no: r1, status: 3 },
      { out_trade_no: r2, status: 3 },
    ]]);
    const result = await runRefundSync(makeDeps({ db, fetchFn, autoRevoke: true }));
    expect(result.newSuspects).toBe(2);
    expect(db.rows("revocations")).toHaveLength(1);
    expect(result.dbWrites).toBe(3); // suspects + revocations 1 行 + cursor
  });
});

// ---------------------------------------------------------------------------
// index.ts scheduled 壳
// ---------------------------------------------------------------------------

describe("A6-2 index.ts scheduled 壳", () => {
  it("挂接 waitUntil 并注入 env 绑定（DB 未绑定 → 两段 not_configured 零副作用；M4 统一对账壳）", async () => {
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
