/**
 * @jest-environment node
 *
 * A6-2 退款巡检纯逻辑测试（REQUIREMENTS_UNLOCK.md §A6-2 / §0.15 / §0.16）：
 * 1) 分页请求构造（签名族复用）与分页响应解析（防御矩阵）
 * 2) runRefundSync：not_configured / 疑似单检出（status != 2 且 KV 有
 *    兑换记录）/ 幂等去重 / 回看窗口日期截断终止 / 页数 ≤20 上限 /
 *    上游错误部分扫描 / 模式 A KV 写 ≤2 断言 / 自动吊销分支
 * 3) index.ts scheduled 壳挂接（waitUntil 被调用）
 */
import { md5hex } from "../md5";
import {
  buildAfdianQueryOrderPageRequest,
  parseAfdianQueryOrderPageResponse,
} from "../afdian";
import {
  REFUND_SUSPECTS_KV_KEY,
  REFUND_SYNC_MAX_PAGES,
  REVOKE_CURSOR_KV_KEY,
  runRefundSync,
  sanitizeRefundSuspects,
  type RefundSyncDeps,
} from "../refundSync";
import { REVOKE_LIST_KV_KEY } from "../revocations";
import worker from "../../index";
import { unlockTokenHash } from "../../../../src/utils/revocationList";
import type { UnlockKvLike } from "../redeem";

// ---------------------------------------------------------------------------
// mock KV / fetch
// ---------------------------------------------------------------------------

interface MockKv extends UnlockKvLike {
  readonly store: Map<string, string>;
  getCalls: number;
  putCalls: number;
}

function makeKv(entries?: Record<string, string>): MockKv {
  const store = new Map<string, string>(Object.entries(entries ?? {}));
  const kv: MockKv = {
    store,
    getCalls: 0,
    putCalls: 0,
    async get(key: string): Promise<string | null> {
      kv.getCalls += 1;
      return store.get(key) ?? null;
    },
    async put(key: string, value: string): Promise<void> {
      kv.putCalls += 1;
      store.set(key, value);
    },
  };
  return kv;
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
    kv: makeKv(),
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
});

// ---------------------------------------------------------------------------
// runRefundSync 主流程
// ---------------------------------------------------------------------------

describe("A6-2 runRefundSync", () => {
  it("KV 未绑定 / secrets 缺失 → not_configured 零写", async () => {
    const kv = makeKv();
    expect(await runRefundSync(makeDeps({ kv: null }))).toEqual(
      expect.objectContaining({ ok: false, error: "not_configured", kvWrites: 0 }),
    );
    expect(
      await runRefundSync(makeDeps({ kv, secrets: { afdianToken: "t" } })),
    ).toEqual(expect.objectContaining({ ok: false, error: "not_configured" }));
    expect(kv.putCalls).toBe(0);
  });

  it("疑似单检出：status != 2 且 KV 有兑换记录 → 登记 suspects + cursor（写 = 2）", async () => {
    const refunded = orderIdDaysAgo(2, "111111");
    const unpaidNoRecord = orderIdDaysAgo(1, "222222");
    const paid = orderIdDaysAgo(3, "333333");
    const kv = makeKv({
      [`order:${refunded}`]: JSON.stringify({ token: "SO1.a.b", tier: "week", exp: NOW_SEC + 86400 }),
    });
    const { fetchFn } = makePagedFetch([[
      { out_trade_no: unpaidNoRecord, status: 1 }, // 未支付且无记录 → 不登记
      { out_trade_no: refunded, status: 3 }, // 已兑换后退款 → 登记
      { out_trade_no: paid, status: 2 }, // 正常已支付 → 跳过
    ]]);
    const result = await runRefundSync(makeDeps({ kv, fetchFn }));
    expect(result).toEqual({ ok: true, scanned: 3, newSuspects: 1, kvWrites: 2 });
    expect(JSON.parse(kv.store.get(REFUND_SUSPECTS_KV_KEY) ?? "")).toEqual({
      v: 1,
      orders: [
        {
          orderId: refunded,
          detectedAt: new Date(NOW_SEC * 1000).toISOString(),
          status: 3,
        },
      ],
    });
    expect(JSON.parse(kv.store.get(REVOKE_CURSOR_KV_KEY) ?? "")).toEqual({
      lastRun: new Date(NOW_SEC * 1000).toISOString(),
      scanned: 3,
      suspects: 1,
      by: "cron",
    });
    // 模式 A：不写 revoke:list
    expect(kv.store.has(REVOKE_LIST_KV_KEY)).toBe(false);
  });

  it("幂等：已登记疑似单再次巡检不重复登记（suspects 不重写，仅 cursor 1 写）", async () => {
    const refunded = orderIdDaysAgo(2, "111111");
    const kv = makeKv({
      [`order:${refunded}`]: JSON.stringify({ token: "SO1.a.b", tier: "week", exp: NOW_SEC + 86400 }),
      [REFUND_SUSPECTS_KV_KEY]: JSON.stringify({
        v: 1,
        orders: [{ orderId: refunded, detectedAt: "earlier", status: 3 }],
      }),
    });
    const { fetchFn } = makePagedFetch([[{ out_trade_no: refunded, status: 3 }]]);
    const result = await runRefundSync(makeDeps({ kv, fetchFn }));
    expect(result).toEqual({ ok: true, scanned: 1, newSuspects: 0, kvWrites: 1 });
    // 已登记单不再读 order 键（先查 known 集合）
    expect(
      JSON.parse(kv.store.get(REFUND_SUSPECTS_KV_KEY) ?? "").orders,
    ).toHaveLength(1);
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
    const kv = makeKv();
    const result = await runRefundSync(makeDeps({ kv, fetchFn }));
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
    const kv = makeKv({
      [`order:${refunded}`]: JSON.stringify({ token: "SO1.a.b", tier: "week", exp: NOW_SEC + 86400 }),
    });
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
    const result = await runRefundSync(makeDeps({ kv, fetchFn }));
    expect(result).toEqual({
      ok: false,
      error: "upstream_error",
      scanned: 1,
      newSuspects: 1,
      kvWrites: 2,
    });
    expect(kv.store.has(REVOKE_CURSOR_KV_KEY)).toBe(true);
  });

  it("HTTP 非 2xx → upstream_error（首页失败零候选，仅 cursor 1 写）", async () => {
    const kv = makeKv();
    const fetchFn: RefundSyncDeps["fetchFn"] = async () => ({
      ok: false,
      json: async () => ({}),
    });
    const result = await runRefundSync(makeDeps({ kv, fetchFn }));
    expect(result).toEqual({
      ok: false,
      error: "upstream_error",
      scanned: 0,
      newSuspects: 0,
      kvWrites: 1,
    });
  });

  it("模式 A KV 写上限断言：任何巡检 ≤2 写（§0.16 额度契约）", async () => {
    // 多个疑似单也只合并为一次 suspects 写 + 一次 cursor 写
    const r1 = orderIdDaysAgo(1, "111111");
    const r2 = orderIdDaysAgo(2, "222222");
    const kv = makeKv({
      [`order:${r1}`]: JSON.stringify({ token: "SO1.a.b", tier: "week", exp: NOW_SEC + 1 }),
      [`order:${r2}`]: JSON.stringify({ token: "SO1.c.d", tier: "year", exp: NOW_SEC + 2 }),
    });
    const { fetchFn } = makePagedFetch([[
      { out_trade_no: r1, status: 3 },
      { out_trade_no: r2, status: 4 },
    ]]);
    const result = await runRefundSync(makeDeps({ kv, fetchFn }));
    expect(result.kvWrites).toBeLessThanOrEqual(2);
    expect(kv.putCalls).toBeLessThanOrEqual(2);
    expect(result.newSuspects).toBe(2);
  });

  it("自动吊销分支（REFUND_AUTO_REVOKE=1）：token 哈希入 revoke:list（reason=refund）", async () => {
    const refunded = orderIdDaysAgo(2, "111111");
    const token = "SO1.payload.sig";
    const exp = NOW_SEC + 5 * 86_400;
    const kv = makeKv({
      [`order:${refunded}`]: JSON.stringify({ token, tier: "week", exp }),
      [REVOKE_LIST_KV_KEY]: JSON.stringify({
        v: 1,
        entries: [{ h: "f".repeat(64), exp: NOW_SEC + 999, at: "existing" }],
      }),
    });
    const { fetchFn } = makePagedFetch([[{ out_trade_no: refunded, status: 3 }]]);
    const result = await runRefundSync(makeDeps({ kv, fetchFn, autoRevoke: true }));
    expect(result.kvWrites).toBe(3); // suspects + revoke:list + cursor
    const list = JSON.parse(kv.store.get(REVOKE_LIST_KV_KEY) ?? "") as {
      entries: { h: string; exp: number; reason?: string }[];
    };
    expect(list.entries).toHaveLength(2); // 既有条目保留 + 新增
    expect(list.entries[1]).toEqual({
      h: unlockTokenHash(token),
      exp,
      at: new Date(NOW_SEC * 1000).toISOString(),
      reason: "refund",
    });
  });
});

// ---------------------------------------------------------------------------
// index.ts scheduled 壳
// ---------------------------------------------------------------------------

describe("A6-2 index.ts scheduled 壳", () => {
  it("挂接 waitUntil 并注入 env 绑定（KV 未绑定 → not_configured 零副作用）", async () => {
    const captured: Promise<unknown>[] = [];
    worker.scheduled(
      null,
      { REFUND_LOOKBACK_DAYS: "15", REFUND_AUTO_REVOKE: "" },
      { waitUntil: (p) => captured.push(p) },
    );
    expect(captured).toHaveLength(1);
    await expect(captured[0]).resolves.toEqual(
      expect.objectContaining({ ok: false, error: "not_configured" }),
    );
  });
});
