/**
 * @jest-environment node
 *
 * M4 G8 漏斗计数 Worker 测试（REQUIREMENTS_GROWTH.md §4 验收）：
 * lib 纯逻辑（日期窗口/白名单消毒/体积上限/UPSERT 幂等累加）+
 * index.ts 路由矩阵（POST 200 / 非法 body 400 / GET 405 / OPTIONS 204 /
 * CORS）。隐私断言：落库行仅日期 + 计数列，零用户标识。
 */
import worker from "../../index";
import { PROD_ORIGIN } from "../cors";
import {
  FUNNEL_BODY_MAX_CHARS,
  FUNNEL_COUNT_CAP,
  FUNNEL_EVENTS,
  handleFunnelEvent,
  isAcceptableFunnelDate,
  sanitizeFunnelEvents,
} from "../funnel";
import { FakeD1 } from "./helpers/fakeD1";

/** 固定"当前时刻"：2026-08-31T12:00:00Z */
const NOW_MS = Date.parse("2026-08-31T12:00:00Z");
const TODAY = "2026-08-31";

function bodyOf(e: Record<string, unknown>, d: string = TODAY): string {
  return JSON.stringify({ d, e });
}

// ---------------------------------------------------------------------------
// 纯函数：日期窗口 / 消毒
// ---------------------------------------------------------------------------

describe("isAcceptableFunnelDate（UTC 今日 ±1 天窗口）", () => {
  it.each([
    ["今日", "2026-08-31", true],
    ["昨日（时区容差）", "2026-08-30", true],
    ["明日（跨午夜容差）", "2026-09-01", true],
    ["前日（超窗）", "2026-08-29", false],
    ["后日（超窗）", "2026-09-02", false],
  ])("%s %s → %s", (_l, d, expected) => {
    expect(isAcceptableFunnelDate(d, NOW_MS)).toBe(expected);
  });

  it.each([
    ["非字符串", 20260831],
    ["格式不符", "2026/08/31"],
    ["进位日期", "2026-02-31"],
    ["非法数字", "0000-99-99"],
    ["null", null],
  ])("非法输入（%s）→ false", (_l, d) => {
    expect(isAcceptableFunnelDate(d, NOW_MS)).toBe(false);
  });
});

describe("sanitizeFunnelEvents（白名单 + 计数钳制）", () => {
  it("非对象输入 → null（数组/字符串/null 均拒绝）", () => {
    expect(sanitizeFunnelEvents(null)).toBeNull();
    expect(sanitizeFunnelEvents([1, 2])).toBeNull();
    expect(sanitizeFunnelEvents("lock_shown")).toBeNull();
    expect(sanitizeFunnelEvents(42)).toBeNull();
  });

  it("白名单外键静默丢弃、白名单键保留", () => {
    expect(
      sanitizeFunnelEvents({ lock_shown: 2, evil_key: 5, token: "SO1.x" }),
    ).toEqual({ lock_shown: 2 });
  });

  it("非正整数计数丢弃（0/负数/小数/字符串）", () => {
    expect(
      sanitizeFunnelEvents({
        lock_shown: 0,
        lock_cta: -3,
        unlock_view: 1.5,
        tier_cta: "9",
        pay_open: 1,
      }),
    ).toEqual({ pay_open: 1 });
  });

  it("超上限钳制到 FUNNEL_COUNT_CAP（防刷）", () => {
    expect(sanitizeFunnelEvents({ share_click: 999_999 })).toEqual({
      share_click: FUNNEL_COUNT_CAP,
    });
  });

  it("7 键白名单与前端约定一致（人工同步登记的双端锚点）", () => {
    expect(FUNNEL_EVENTS).toEqual([
      "lock_shown",
      "lock_cta",
      "unlock_view",
      "tier_cta",
      "pay_open",
      "redeem_submit",
      "share_click",
    ]);
  });
});

// ---------------------------------------------------------------------------
// handleFunnelEvent：校验 + UPSERT
// ---------------------------------------------------------------------------

describe("handleFunnelEvent", () => {
  it.each([
    ["空 body", ""],
    ["超体积 body", `{"d":"${TODAY}","e":{"x":"${"a".repeat(FUNNEL_BODY_MAX_CHARS)}"}}`],
    ["非法 JSON", "{broken"],
    ["JSON 非对象", "42"],
    ["缺 d", JSON.stringify({ e: { lock_shown: 1 } })],
    ["d 超窗", bodyOf({ lock_shown: 1 }, "2020-01-01")],
    ["e 缺失", JSON.stringify({ d: TODAY })],
    ["e 非对象", JSON.stringify({ d: TODAY, e: [1] })],
  ])("非法 body（%s）→ 400 invalid_body + 零 DB 访问", async (_l, raw) => {
    const db = new FakeD1();
    const writes = jest.spyOn(db, "_write");
    const out = await handleFunnelEvent(raw, db, NOW_MS);
    expect(out).toEqual({
      status: 400,
      body: { ok: false, error: "invalid_body" },
    });
    expect(writes).not.toHaveBeenCalled();
  });

  it("事件全被白名单过滤 → 200 ok + 零写入（垃圾键零 DB 消耗）", async () => {
    const db = new FakeD1();
    const writes = jest.spyOn(db, "_write");
    const out = await handleFunnelEvent(bodyOf({ junk: 3 }), db, NOW_MS);
    expect(out).toEqual({ status: 200, body: { ok: true } });
    expect(writes).not.toHaveBeenCalled();
  });

  it("DB 未绑定 → 200 not_configured（既有降级口径）", async () => {
    const out = await handleFunnelEvent(bodyOf({ lock_shown: 1 }), null, NOW_MS);
    expect(out).toEqual({
      status: 200,
      body: { ok: false, error: "not_configured" },
    });
  });

  it("首次写入：宽行建行，缺席键补 0；每请求恰 1 条语句（额度口径）", async () => {
    const db = new FakeD1();
    const writes = jest.spyOn(db, "_write");
    const out = await handleFunnelEvent(
      bodyOf({ lock_shown: 3, lock_cta: 1 }),
      db,
      NOW_MS,
    );
    expect(out).toEqual({ status: 200, body: { ok: true } });
    expect(writes).toHaveBeenCalledTimes(1);
    expect(db.rows("funnel_daily")).toEqual([
      {
        d: TODAY,
        lock_shown: 3,
        lock_cta: 1,
        unlock_view: 0,
        tier_cta: 0,
        pay_open: 0,
        redeem_submit: 0,
        share_click: 0,
      },
    ]);
  });

  it("按天 UPSERT 幂等累加：同日多请求累加、跨日新行", async () => {
    const db = new FakeD1();
    await handleFunnelEvent(bodyOf({ lock_shown: 2, share_click: 1 }), db, NOW_MS);
    await handleFunnelEvent(bodyOf({ lock_shown: 5, unlock_view: 1 }), db, NOW_MS);
    // 次日请求（服务端时钟推进一天，d 落窗口内）
    await handleFunnelEvent(
      bodyOf({ pay_open: 1 }, "2026-09-01"),
      db,
      NOW_MS + 86_400_000,
    );
    const rows = db.rows("funnel_daily");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      d: TODAY,
      lock_shown: 7,
      unlock_view: 1,
      share_click: 1,
    });
    expect(rows[1]).toMatchObject({ d: "2026-09-01", pay_open: 1 });
  });

  it("隐私断言：落库行仅 d + 7 计数列，无任何用户标识字段", async () => {
    const db = new FakeD1();
    await handleFunnelEvent(bodyOf({ redeem_submit: 1 }), db, NOW_MS);
    expect(Object.keys(db.rows("funnel_daily")[0]).sort()).toEqual(
      ["d", ...FUNNEL_EVENTS].sort(),
    );
  });
});

// ---------------------------------------------------------------------------
// index.ts 路由矩阵：POST /api/ev
// ---------------------------------------------------------------------------

const EV_URL = "https://stellar.guushu.com/api/ev";

function evRequest(
  method: string,
  body?: string,
  origin: string | null = PROD_ORIGIN,
): Request {
  const headers: Record<string, string> = {};
  if (origin !== null) headers.Origin = origin;
  // beacon 字符串 body 即 text/plain（简单请求无预检），服务端按文本读
  return new Request(EV_URL, { method, headers, body });
}

describe("worker 路由：POST /api/ev", () => {
  it("POST 合法 body → 200 ok + CORS 放行 + 落库", async () => {
    const db = new FakeD1();
    const today = new Date().toISOString().slice(0, 10);
    const res = await worker.fetch(
      evRequest("POST", bodyOf({ tier_cta: 1 }, today)),
      { UNLOCK_DB: db },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(PROD_ORIGIN);
    expect(await res.json()).toEqual({ ok: true });
    expect(db.rows("funnel_daily")).toHaveLength(1);
  });

  it("POST 非法 body → 400 invalid_body", async () => {
    const res = await worker.fetch(evRequest("POST", "{broken"), {
      UNLOCK_DB: new FakeD1(),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: "invalid_body" });
  });

  it("POST 无 body → 400（读体回退空串）", async () => {
    const res = await worker.fetch(evRequest("POST"), { UNLOCK_DB: new FakeD1() });
    expect(res.status).toBe(400);
  });

  it("GET → 405 method_not_allowed + 零 DB 访问", async () => {
    const db = new FakeD1();
    const selects = jest.spyOn(db, "_select");
    const writes = jest.spyOn(db, "_write");
    const res = await worker.fetch(evRequest("GET"), { UNLOCK_DB: db });
    expect(res.status).toBe(405);
    expect(await res.json()).toEqual({
      ok: false,
      error: "method_not_allowed",
      message: "仅支持 POST。",
    });
    expect(selects).not.toHaveBeenCalled();
    expect(writes).not.toHaveBeenCalled();
  });

  it("OPTIONS 预检 → 204（零 DB 访问既有分支）", async () => {
    const res = await worker.fetch(evRequest("OPTIONS"), {});
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(PROD_ORIGIN);
  });

  it("陌生 Origin → 处理照常但无 ACAO（CORS 拒绝口径）", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const res = await worker.fetch(
      evRequest("POST", bodyOf({ lock_shown: 1 }, today), "https://evil.example.com"),
      { UNLOCK_DB: new FakeD1() },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});
