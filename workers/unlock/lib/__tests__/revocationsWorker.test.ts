/**
 * @jest-environment node
 *
 * A6-2 Worker /api/revocations 测试（REQUIREMENTS_UNLOCK.md §A6-2 / §0.15；
 * Z 迭代 M1：mock KV → FakeD1 revocations 表，响应契约逐条回归——
 * `{ ok, list: { v: 1, entries: [{ h, exp, at, reason? }] } }` 形状与
 * KV 时代一致，前端零改动）：
 * lib 纯逻辑全分支 + index.ts 路由矩阵
 * （GET 200 + 缓存头 / CORS / POST 405 / 既有路径回归）。
 * 断言零 DB 写（§0.16 防额度复核）。gateConfigWorker.test 同构。
 */
import worker, { type UnlockWorkerEnv } from "../../index";
import { PROD_ORIGIN } from "../cors";
import {
  handleRevocations,
  type RevocationsResponseBody,
} from "../revocations";
import { FakeD1, type FakeRow } from "./helpers/fakeD1";

interface CountedDb {
  readonly db: FakeD1;
  readonly selects: jest.SpyInstance;
  readonly writes: jest.SpyInstance;
}

function makeDb(revocations: readonly FakeRow[] = []): CountedDb {
  const db = new FakeD1();
  for (const row of revocations) {
    db.seed("revocations", {
      reason: null,
      restored: 0,
      ...row,
    });
  }
  return {
    db,
    selects: jest.spyOn(db, "_select"),
    writes: jest.spyOn(db, "_write"),
  };
}

const REVOCATIONS_URL = "https://stellar.guushu.com/api/revocations";

function revRequest(method = "GET", origin: string | null = PROD_ORIGIN): Request {
  const headers: Record<string, string> = {};
  if (origin !== null) headers.Origin = origin;
  return new Request(REVOCATIONS_URL, { method, headers });
}

describe("handleRevocations（§0.15 契约）", () => {
  it("DB 未绑定（undefined/null）→ not_configured", async () => {
    expect(await handleRevocations(undefined)).toEqual({
      ok: false,
      error: "not_configured",
    });
    expect(await handleRevocations(null)).toEqual({
      ok: false,
      error: "not_configured",
    });
  });

  it("无记录 → ok + 空 entries（前端 sanitize 同口径为空名单）", async () => {
    const { db, selects } = makeDb();
    expect(await handleRevocations(db)).toEqual({
      ok: true,
      list: { v: 1, entries: [] },
    });
    expect(selects).toHaveBeenCalledTimes(1);
  });

  it("有记录 → 行映射为 §0.15 契约条目（h/exp/at/reason，按吊销时刻升序）", async () => {
    const { db } = makeDb([
      {
        token_hash: "b".repeat(64),
        exp: 200,
        revoked_at: "2026-08-15T00:00:00Z",
        reason: "manual",
      },
      {
        token_hash: "a".repeat(64),
        exp: 100,
        revoked_at: "2026-08-14T00:00:00Z",
        reason: "refund",
      },
    ]);
    expect(await handleRevocations(db)).toEqual({
      ok: true,
      list: {
        v: 1,
        entries: [
          { h: "a".repeat(64), exp: 100, at: "2026-08-14T00:00:00Z", reason: "refund" },
          { h: "b".repeat(64), exp: 200, at: "2026-08-15T00:00:00Z", reason: "manual" },
        ],
      },
    });
  });

  it("reason 为 NULL → 条目略去 reason 字段（sanitize 输出形状一致）", async () => {
    const { db } = makeDb([
      { token_hash: "c".repeat(64), exp: 300, revoked_at: "2026-08-16T00:00:00Z" },
    ]);
    const body = await handleRevocations(db);
    if (!body.ok) throw new Error("unreachable");
    const entries = (body.list as { entries: Record<string, unknown>[] }).entries;
    expect(entries).toEqual([
      { h: "c".repeat(64), exp: 300, at: "2026-08-16T00:00:00Z" },
    ]);
    expect("reason" in entries[0]).toBe(false);
  });

  it("restored=1 条目恒过滤（解除吊销以翻转记录，只增不删纪律）", async () => {
    const { db } = makeDb([
      {
        token_hash: "a".repeat(64),
        exp: 100,
        revoked_at: "2026-08-14T00:00:00Z",
        restored: 1,
      },
      {
        token_hash: "b".repeat(64),
        exp: 200,
        revoked_at: "2026-08-15T00:00:00Z",
      },
    ]);
    const body = await handleRevocations(db);
    if (!body.ok) throw new Error("unreachable");
    expect((body.list as { entries: { h: string }[] }).entries.map((e) => e.h)).toEqual([
      "b".repeat(64),
    ]);
  });

  it("查询异常 → 视同空名单 + console.warn（防御降级，恒 200 契约）", async () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    const { db } = makeDb();
    jest.spyOn(db, "_select").mockImplementation(() => {
      throw new Error("db down");
    });
    expect(await handleRevocations(db)).toEqual({
      ok: true,
      list: { v: 1, entries: [] },
    });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });

  it("零 DB 写（§0.16 防额度攻击复核）", async () => {
    const { db, writes } = makeDb([
      { token_hash: "a".repeat(64), exp: 100, revoked_at: "t" },
    ]);
    await handleRevocations(db);
    expect(writes).not.toHaveBeenCalled();
  });
});

describe("worker 路由：GET /api/revocations", () => {
  it("GET（有记录）→ 200 + 契约体 + 缓存头 300s + CORS 放行 + 零 DB 写", async () => {
    const { db, writes } = makeDb([
      {
        token_hash: "a".repeat(64),
        exp: 100,
        revoked_at: "2026-08-14T00:00:00Z",
        reason: "refund",
      },
    ]);
    const res = await worker.fetch(revRequest(), { UNLOCK_DB: db });
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=300");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(PROD_ORIGIN);
    const body = (await res.json()) as RevocationsResponseBody;
    expect(body).toEqual({
      ok: true,
      list: {
        v: 1,
        entries: [
          { h: "a".repeat(64), exp: 100, at: "2026-08-14T00:00:00Z", reason: "refund" },
        ],
      },
    });
    expect(writes).not.toHaveBeenCalled();
  });

  it("GET（DB 未绑定）→ HTTP 200 + 体内 not_configured（恒 200 契约）", async () => {
    const res = await worker.fetch(revRequest(), {});
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: false, error: "not_configured" });
  });

  it("GET（陌生 Origin）→ 200 但无 ACAO（CORS 拒绝）", async () => {
    const res = await worker.fetch(
      revRequest("GET", "https://evil.example.com"),
      { UNLOCK_DB: makeDb().db },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("POST → 405 method_not_allowed（零 DB 访问）", async () => {
    const { db, selects } = makeDb();
    const res = await worker.fetch(revRequest("POST"), { UNLOCK_DB: db });
    expect(res.status).toBe(405);
    expect(selects).not.toHaveBeenCalled();
  });

  it("OPTIONS 预检 → 204", async () => {
    const res = await worker.fetch(revRequest("OPTIONS"), {});
    expect(res.status).toBe(204);
  });
});

describe("worker 既有路径回归（A6 分支零影响）", () => {
  it("GET /api/gate-config 照常（透传 + 缓存头）", async () => {
    const { db } = makeDb();
    db.seed("kv_state", { k: "gate:config", v: '{"v":1}', updated_at: "seed" });
    const res = await worker.fetch(
      new Request("https://stellar.guushu.com/api/gate-config", {
        method: "GET",
        headers: { Origin: PROD_ORIGIN },
      }),
      { UNLOCK_DB: db },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, config: { v: 1 } });
  });

  it("POST /api/redeem（secrets 未配置）→ not_configured 不变", async () => {
    const res = await worker.fetch(
      new Request("https://stellar.guushu.com/api/redeem", {
        method: "POST",
        headers: { Origin: PROD_ORIGIN, "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: "20260812120000123456" }),
      }),
      {} satisfies UnlockWorkerEnv,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; error?: string };
    expect(body).toEqual(expect.objectContaining({ ok: false, error: "not_configured" }));
  });

  it("未知路径 → 404 not_found 不变", async () => {
    const res = await worker.fetch(
      new Request("https://stellar.guushu.com/api/unknown", { method: "GET" }),
      {},
    );
    expect(res.status).toBe(404);
  });
});
