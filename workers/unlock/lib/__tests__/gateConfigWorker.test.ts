/**
 * @jest-environment node
 *
 * A2 Worker gate-config 测试（REQUIREMENTS_UNLOCK.md §A2 验收；
 * Z 迭代 M1：mock KV → FakeD1 内存替身，响应契约逐条回归零变化）：
 * lib 纯逻辑全分支（kv_state 行注入）+ index.ts 路由矩阵
 * （GET 200 + 缓存头 / CORS 放行与拒绝 / POST 405 / OPTIONS 204 /
 * redeem 路径回归）。断言零 DB 写（防额度攻击复核）。
 */
import worker, { type UnlockWorkerEnv } from "../../index";
import { PROD_ORIGIN } from "../cors";
import { GATE_CONFIG_STATE_KEY } from "../db";
import {
  handleGateConfig,
  type GateConfigResponseBody,
} from "../gateConfig";
import { FakeD1 } from "./helpers/fakeD1";

// ---------------------------------------------------------------------------
// FakeD1 构造（kv_state 预置 + 读写计数：_select/_write 引擎入口 spy）
// ---------------------------------------------------------------------------

interface CountedDb {
  readonly db: FakeD1;
  readonly selects: jest.SpyInstance;
  readonly writes: jest.SpyInstance;
}

function makeDb(states?: Record<string, string>): CountedDb {
  const db = new FakeD1();
  for (const [k, v] of Object.entries(states ?? {})) {
    db.seed("kv_state", { k, v, updated_at: "seed" });
  }
  return {
    db,
    selects: jest.spyOn(db, "_select"),
    writes: jest.spyOn(db, "_write"),
  };
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
  it("DB 未绑定（undefined）→ not_configured", async () => {
    const body = await handleGateConfig(undefined);
    expect(body).toEqual({ ok: false, error: "not_configured" });
  });

  it("DB 未绑定（null）→ not_configured", async () => {
    const body = await handleGateConfig(null);
    expect(body).toEqual({ ok: false, error: "not_configured" });
  });

  it("无记录 → ok + 空对象 config", async () => {
    const { db, selects } = makeDb();
    const body = await handleGateConfig(db);
    expect(body).toEqual({ ok: true, config: {} });
    expect(selects).toHaveBeenCalledTimes(1);
  });

  it("有记录 → 原样透传（含嵌套对象，不消毒）", async () => {
    // 故意混入契约外字段与非法值：Worker 不消毒，消毒单点在前端/管理台
    const config = {
      v: 1,
      demo: { dailyLimit: 3, freeWindow: { enabled: true, startUtc: "2026-08-01T00:00:00Z", endUtc: "2026-09-01T00:00:00Z" } },
      detail: { premiumBodyIds: ["betelgeuse"] },
      unknownField: { nested: [1, "two", null] },
    };
    const { db } = makeDb({ [GATE_CONFIG_STATE_KEY]: JSON.stringify(config) });
    const body = await handleGateConfig(db);
    expect(body).toEqual({ ok: true, config });
  });

  it("非法 JSON → 视同无记录 + console.warn", async () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    const { db } = makeDb({ [GATE_CONFIG_STATE_KEY]: "{broken" });
    const body = await handleGateConfig(db);
    expect(body).toEqual({ ok: true, config: {} });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });

  it("kv_state 行 v 非字符串（形状异常）→ 视同无记录", async () => {
    const { db } = makeDb();
    db.seed("kv_state", { k: GATE_CONFIG_STATE_KEY, v: 42, updated_at: "seed" });
    expect(await handleGateConfig(db)).toEqual({ ok: true, config: {} });
  });

  it("零 DB 写（防额度攻击复核）", async () => {
    const { db, writes } = makeDb({ [GATE_CONFIG_STATE_KEY]: "{}" });
    await handleGateConfig(db);
    expect(writes).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// index.ts 路由矩阵
// ---------------------------------------------------------------------------

describe("worker 路由：GET /api/gate-config", () => {
  it("GET（DB 已绑定，有记录）→ 200 + 透传 + 缓存头 + CORS 放行", async () => {
    const { db, writes } = makeDb({
      [GATE_CONFIG_STATE_KEY]: '{"v":1,"demo":{"dailyLimit":3}}',
    });
    const res = await worker.fetch(gateRequest(), { UNLOCK_DB: db });
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=300");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(PROD_ORIGIN);
    expect(res.headers.get("Content-Type")).toBe("application/json; charset=utf-8");
    const body = (await res.json()) as GateConfigResponseBody;
    expect(body).toEqual({ ok: true, config: { v: 1, demo: { dailyLimit: 3 } } });
    expect(writes).not.toHaveBeenCalled();
  });

  it("GET（DB 未绑定）→ HTTP 200 + 体内 not_configured（恒 200 契约）", async () => {
    const res = await worker.fetch(gateRequest(), {});
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=300");
    expect(await res.json()).toEqual({ ok: false, error: "not_configured" });
  });

  it("GET（陌生 Origin）→ 200 但无 ACAO（CORS 拒绝）", async () => {
    const res = await worker.fetch(gateRequest("GET", "https://evil.example.com"), {
      UNLOCK_DB: makeDb().db,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("POST → 405 method_not_allowed（零 DB 访问）", async () => {
    const { db, selects, writes } = makeDb();
    const res = await worker.fetch(gateRequest("POST"), { UNLOCK_DB: db });
    expect(res.status).toBe(405);
    expect(await res.json()).toEqual({
      ok: false,
      error: "method_not_allowed",
      message: "仅支持 GET。",
    });
    expect(selects).not.toHaveBeenCalled();
    expect(writes).not.toHaveBeenCalled();
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
