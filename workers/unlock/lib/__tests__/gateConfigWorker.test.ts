/**
 * @jest-environment node
 *
 * A2 Worker gate-config 测试（REQUIREMENTS_UNLOCK.md §A2 验收）：
 * lib 纯逻辑全分支（mock KV = 内存 Map）+ index.ts 路由矩阵
 * （GET 200 + 缓存头 / CORS 放行与拒绝 / POST 405 / OPTIONS 204 /
 * redeem 路径回归）。断言零 KV 写（防额度攻击复核）。
 */
import worker, { type UnlockWorkerEnv } from "../../index";
import { PROD_ORIGIN } from "../cors";
import {
  GATE_CONFIG_KV_KEY,
  handleGateConfig,
  type GateConfigResponseBody,
} from "../gateConfig";
import type { UnlockKvLike } from "../redeem";

// ---------------------------------------------------------------------------
// mock KV（内存 Map + 读写计数）
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

const GATE_URL = "https://stellar.guushu.com/api/gate-config";

function gateRequest(method = "GET", origin: string | null = PROD_ORIGIN): Request {
  const headers: Record<string, string> = {};
  if (origin !== null) headers.Origin = origin;
  return new Request(GATE_URL, { method, headers });
}

// ---------------------------------------------------------------------------
// lib 纯逻辑：handleGateConfig
// ---------------------------------------------------------------------------

describe("handleGateConfig（§0.11 契约）", () => {
  it("KV 未绑定（undefined）→ not_configured", async () => {
    const body = await handleGateConfig(undefined);
    expect(body).toEqual({ ok: false, error: "not_configured" });
  });

  it("KV 未绑定（null）→ not_configured", async () => {
    const body = await handleGateConfig(null);
    expect(body).toEqual({ ok: false, error: "not_configured" });
  });

  it("无记录 → ok + 空对象 config", async () => {
    const kv = makeKv();
    const body = await handleGateConfig(kv);
    expect(body).toEqual({ ok: true, config: {} });
    expect(kv.getCalls).toBe(1);
  });

  it("有记录 → 原样透传（含嵌套对象，不消毒）", async () => {
    // 故意混入契约外字段与非法值：Worker 不消毒，消毒单点在前端/管理台
    const config = {
      v: 1,
      demo: { dailyLimit: 3, freeWindow: { enabled: true, startUtc: "2026-08-01T00:00:00Z", endUtc: "2026-09-01T00:00:00Z" } },
      detail: { premiumBodyIds: ["betelgeuse"] },
      unknownField: { nested: [1, "two", null] },
    };
    const kv = makeKv({ [GATE_CONFIG_KV_KEY]: JSON.stringify(config) });
    const body = await handleGateConfig(kv);
    expect(body).toEqual({ ok: true, config });
  });

  it("非法 JSON → 视同无记录 + console.warn", async () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    const kv = makeKv({ [GATE_CONFIG_KV_KEY]: "{broken" });
    const body = await handleGateConfig(kv);
    expect(body).toEqual({ ok: true, config: {} });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });

  it("零 KV 写（防额度攻击复核）", async () => {
    const kv = makeKv({ [GATE_CONFIG_KV_KEY]: "{}" });
    await handleGateConfig(kv);
    expect(kv.putCalls).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// index.ts 路由矩阵
// ---------------------------------------------------------------------------

describe("worker 路由：GET /api/gate-config", () => {
  it("GET（KV 已绑定，有记录）→ 200 + 透传 + 缓存头 + CORS 放行", async () => {
    const kv = makeKv({ [GATE_CONFIG_KV_KEY]: '{"v":1,"demo":{"dailyLimit":3}}' });
    const res = await worker.fetch(gateRequest(), { UNLOCK_KV: kv });
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=300");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(PROD_ORIGIN);
    expect(res.headers.get("Content-Type")).toBe("application/json; charset=utf-8");
    const body = (await res.json()) as GateConfigResponseBody;
    expect(body).toEqual({ ok: true, config: { v: 1, demo: { dailyLimit: 3 } } });
    expect(kv.putCalls).toBe(0);
  });

  it("GET（KV 未绑定）→ HTTP 200 + 体内 not_configured（恒 200 契约）", async () => {
    const res = await worker.fetch(gateRequest(), {});
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=300");
    expect(await res.json()).toEqual({ ok: false, error: "not_configured" });
  });

  it("GET（陌生 Origin）→ 200 但无 ACAO（CORS 拒绝）", async () => {
    const res = await worker.fetch(gateRequest("GET", "https://evil.example.com"), {
      UNLOCK_KV: makeKv(),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("POST → 405 method_not_allowed（零 KV 访问）", async () => {
    const kv = makeKv();
    const res = await worker.fetch(gateRequest("POST"), { UNLOCK_KV: kv });
    expect(res.status).toBe(405);
    expect(await res.json()).toEqual({
      ok: false,
      error: "method_not_allowed",
      message: "仅支持 GET。",
    });
    expect(kv.getCalls).toBe(0);
  });

  it("OPTIONS 预检 → 204", async () => {
    const res = await worker.fetch(gateRequest("OPTIONS"), {});
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(PROD_ORIGIN);
  });
});

describe("worker 路由：/api/redeem 回归（A2 分支零影响）", () => {
  const REDEEM_URL = "https://stellar.guushu.com/api/redeem";

  it("POST /api/redeem（secrets 未配置）→ 200 not_configured（既有降级不变）", async () => {
    const res = await worker.fetch(
      new Request(REDEEM_URL, {
        method: "POST",
        headers: { Origin: PROD_ORIGIN, "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: "20260812120000123456" }),
      }),
      {} satisfies UnlockWorkerEnv,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; error?: string };
    expect(body.ok).toBe(false);
    expect(body.error).toBe("not_configured");
  });

  it("GET /api/redeem → 405（仅支持 POST 不变）", async () => {
    const res = await worker.fetch(
      new Request(REDEEM_URL, { method: "GET", headers: { Origin: PROD_ORIGIN } }),
      {},
    );
    expect(res.status).toBe(405);
    expect(await res.json()).toEqual({
      ok: false,
      error: "method_not_allowed",
      message: "仅支持 POST。",
    });
  });

  it("未知路径 → 404 not_found 不变", async () => {
    const res = await worker.fetch(
      new Request("https://stellar.guushu.com/api/unknown", { method: "GET" }),
      {},
    );
    expect(res.status).toBe(404);
  });
});
