/**
 * @jest-environment node
 *
 * A6-2 Worker /api/revocations 测试（REQUIREMENTS_UNLOCK.md §A6-2 / §0.15）：
 * lib 纯逻辑全分支（mock KV = 内存 Map）+ index.ts 路由矩阵
 * （GET 200 + 缓存头 / CORS / POST 405 / 既有路径回归）。
 * 断言零 KV 写（§0.16 防额度复核）。gateConfigWorker.test 同构。
 */
import worker, { type UnlockWorkerEnv } from "../../index";
import { PROD_ORIGIN } from "../cors";
import {
  REVOKE_LIST_KV_KEY,
  handleRevocations,
  type RevocationsResponseBody,
} from "../revocations";
import type { UnlockKvLike } from "../redeem";

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

const REVOCATIONS_URL = "https://stellar.guushu.com/api/revocations";

function revRequest(method = "GET", origin: string | null = PROD_ORIGIN): Request {
  const headers: Record<string, string> = {};
  if (origin !== null) headers.Origin = origin;
  return new Request(REVOCATIONS_URL, { method, headers });
}

describe("handleRevocations（§0.15 契约）", () => {
  it("KV 未绑定（undefined/null）→ not_configured", async () => {
    expect(await handleRevocations(undefined)).toEqual({
      ok: false,
      error: "not_configured",
    });
    expect(await handleRevocations(null)).toEqual({
      ok: false,
      error: "not_configured",
    });
  });

  it("无记录 → ok + 空对象 list", async () => {
    const kv = makeKv();
    expect(await handleRevocations(kv)).toEqual({ ok: true, list: {} });
    expect(kv.getCalls).toBe(1);
  });

  it("有记录 → 原样透传（不消毒——消毒单点在 src/utils/revocationList）", async () => {
    // 故意混入非法条目：Worker 不消毒，前端 sanitize 单点裁决
    const list = {
      v: 1,
      entries: [
        { h: "a".repeat(64), exp: 100, at: "2026-08-14T00:00:00Z", reason: "refund" },
        { h: "bad", exp: "junk" },
      ],
    };
    const kv = makeKv({ [REVOKE_LIST_KV_KEY]: JSON.stringify(list) });
    expect(await handleRevocations(kv)).toEqual({ ok: true, list });
  });

  it("非法 JSON → 视同无记录 + console.warn", async () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    const kv = makeKv({ [REVOKE_LIST_KV_KEY]: "{broken" });
    expect(await handleRevocations(kv)).toEqual({ ok: true, list: {} });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });

  it("零 KV 写（§0.16 防额度攻击复核）", async () => {
    const kv = makeKv({ [REVOKE_LIST_KV_KEY]: "{}" });
    await handleRevocations(kv);
    expect(kv.putCalls).toBe(0);
  });
});

describe("worker 路由：GET /api/revocations", () => {
  it("GET（有记录）→ 200 + 透传 + 缓存头 300s + CORS 放行 + 零 KV 写", async () => {
    const kv = makeKv({
      [REVOKE_LIST_KV_KEY]: '{"v":1,"entries":[]}',
    });
    const res = await worker.fetch(revRequest(), { UNLOCK_KV: kv });
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=300");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(PROD_ORIGIN);
    const body = (await res.json()) as RevocationsResponseBody;
    expect(body).toEqual({ ok: true, list: { v: 1, entries: [] } });
    expect(kv.putCalls).toBe(0);
  });

  it("GET（KV 未绑定）→ HTTP 200 + 体内 not_configured（恒 200 契约）", async () => {
    const res = await worker.fetch(revRequest(), {});
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: false, error: "not_configured" });
  });

  it("GET（陌生 Origin）→ 200 但无 ACAO（CORS 拒绝）", async () => {
    const res = await worker.fetch(
      revRequest("GET", "https://evil.example.com"),
      { UNLOCK_KV: makeKv() },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("POST → 405 method_not_allowed（零 KV 访问）", async () => {
    const kv = makeKv();
    const res = await worker.fetch(revRequest("POST"), { UNLOCK_KV: kv });
    expect(res.status).toBe(405);
    expect(kv.getCalls).toBe(0);
  });

  it("OPTIONS 预检 → 204", async () => {
    const res = await worker.fetch(revRequest("OPTIONS"), {});
    expect(res.status).toBe(204);
  });
});

describe("worker 既有路径回归（A6 分支零影响）", () => {
  it("GET /api/gate-config 照常（透传 + 缓存头）", async () => {
    const kv = makeKv({ "gate:config": '{"v":1}' });
    const res = await worker.fetch(
      new Request("https://stellar.guushu.com/api/gate-config", {
        method: "GET",
        headers: { Origin: PROD_ORIGIN },
      }),
      { UNLOCK_KV: kv },
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
