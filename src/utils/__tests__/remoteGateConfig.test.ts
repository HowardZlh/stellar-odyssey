/**
 * A1 远程门控配置纯逻辑层单测（REQUIREMENTS_UNLOCK.md §A1）
 *
 * 覆盖：
 * - sanitizeRemoteGateConfig 消毒矩阵：合法全量/空对象/v 缺失或非 1/
 *   各域各字段逐项非法与合法混杂/嵌套形状污染/null/数组/字符串——
 *   输出恒为合法 RemoteGateConfigV1 且永不抛；
 * - remoteFreeWindowActive 边界：start 含/end 不含/倒置/不可解析/
 *   enabled=false/非有限时钟/undefined；
 * - demoQuota 参数化：limit 注入生效/缺省与旧版全等/非法 limit 回退 5；
 * - premiumGate 参数化：替换名单缩表放行与扩表拦截/限免旁路/缺省与旧版全等。
 */

import { OBSERVATORY_GATE_CONFIG } from "@/data/observatoryGate";
import {
  remoteFreeWindowActive,
  sanitizeRemoteGateConfig,
  type RemoteFreeWindow,
  type RemoteGateConfigV1,
} from "@/utils/remoteGateConfig";
import {
  FREE_DEMO_DAILY_LIMIT,
  demoQuotaRemaining,
  demoQuotaUpdate,
  type DemoQuotaState,
} from "@/utils/demoQuota";
import {
  PREMIUM_DETAIL_BODY_IDS,
  isPremiumDetailBody,
  premiumDetailGateUpdate,
  premiumGateAllows,
  type UnlockEntitlement,
} from "@/utils/premiumGate";

// ---------------------------------------------------------------------------
// 公共夹具
// ---------------------------------------------------------------------------

const VALID_WINDOW: RemoteFreeWindow = {
  enabled: true,
  startUtc: "2026-09-01T00:00:00Z",
  endUtc: "2026-09-08T00:00:00Z",
};

const WINDOW_START_MS = Date.parse(VALID_WINDOW.startUtc);
const WINDOW_END_MS = Date.parse(VALID_WINDOW.endUtc);

/** 合法全量配置（四域全填） */
const FULL_VALID: RemoteGateConfigV1 = {
  v: 1,
  observatory: {
    freeWindow: { ...VALID_WINDOW },
    dailyLimit: 20,
    premiumTrialDailyLimit: 5,
    premiumBodyIds: ["m87", "betelgeuse"],
  },
  detail: {
    freeWindow: { ...VALID_WINDOW },
    premiumBodyIds: ["m31", "m87"],
  },
  tour: { freeWindow: { ...VALID_WINDOW } },
  demo: { freeWindow: { ...VALID_WINDOW }, dailyLimit: 8 },
};

// ---------------------------------------------------------------------------
// sanitizeRemoteGateConfig：顶层形状矩阵
// ---------------------------------------------------------------------------

describe("sanitizeRemoteGateConfig 顶层形状", () => {
  it("合法全量配置原样保留（四域齐全）", () => {
    expect(sanitizeRemoteGateConfig(FULL_VALID)).toEqual(FULL_VALID);
  });

  it("最小合法配置 { v: 1 } 原样通过", () => {
    expect(sanitizeRemoteGateConfig({ v: 1 })).toEqual({ v: 1 });
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["数组", [1, 2]],
    ["字符串", "gate"],
    ["数字", 42],
    ["布尔", true],
    ["空对象（v 缺失）", {}],
    ["v 非 1（数字）", { v: 2, demo: { dailyLimit: 8 } }],
    ["v 非 1（字符串 '1'）", { v: "1", demo: { dailyLimit: 8 } }],
    ["v = null", { v: null }],
  ])("形状不符 → 空配置：%s", (_label, raw) => {
    expect(sanitizeRemoteGateConfig(raw)).toEqual({ v: 1 });
  });

  it("未知顶层键剥离（不透传进输出）", () => {
    const result = sanitizeRemoteGateConfig({ v: 1, hacker: "x", demo: { dailyLimit: 3 } });
    expect(result).toEqual({ v: 1, demo: { dailyLimit: 3 } });
    expect("hacker" in result).toBe(false);
  });

  it.each([
    ["域为 null", { v: 1, demo: null }],
    ["域为数组", { v: 1, tour: [] }],
    ["域为字符串", { v: 1, detail: "free" }],
    ["域为空对象（无合法字段）", { v: 1, demo: {}, detail: {}, tour: {}, observatory: {} }],
  ])("域形状污染 → 该域省略：%s", (_label, raw) => {
    expect(sanitizeRemoteGateConfig(raw)).toEqual({ v: 1 });
  });
});

// ---------------------------------------------------------------------------
// sanitizeRemoteGateConfig：freeWindow 字段矩阵（detail/tour/demo 共用消毒器）
// ---------------------------------------------------------------------------

describe("sanitizeRemoteGateConfig freeWindow 字段消毒", () => {
  it.each([
    ["合法窗口", { ...VALID_WINDOW }, true],
    ["enabled=false 仍保留（日期合法即可）", { ...VALID_WINDOW, enabled: false }, true],
    ["enabled 非布尔", { ...VALID_WINDOW, enabled: "true" }, false],
    ["startUtc 非字符串", { ...VALID_WINDOW, startUtc: 123 }, false],
    ["endUtc 缺失", { enabled: true, startUtc: VALID_WINDOW.startUtc }, false],
    ["起点不可解析", { ...VALID_WINDOW, startUtc: "not-a-date" }, false],
    ["终点不可解析", { ...VALID_WINDOW, endUtc: "someday" }, false],
    ["起止倒置", { enabled: true, startUtc: VALID_WINDOW.endUtc, endUtc: VALID_WINDOW.startUtc }, false],
    ["起止相等（start >= end 判非法）", { enabled: true, startUtc: VALID_WINDOW.startUtc, endUtc: VALID_WINDOW.startUtc }, false],
    ["窗口为数组", [VALID_WINDOW], false],
    ["窗口为字符串", "2026-09-01/2026-09-08", false],
  ])("tour.freeWindow %s", (_label, freeWindow, kept) => {
    const result = sanitizeRemoteGateConfig({ v: 1, tour: { freeWindow } });
    if (kept) {
      expect(result.tour?.freeWindow).toEqual(freeWindow);
    } else {
      expect(result).toEqual({ v: 1 });
    }
  });

  it("demo 域：freeWindow 非法丢弃但 dailyLimit 保留（细粒度回退）", () => {
    const result = sanitizeRemoteGateConfig({
      v: 1,
      demo: { freeWindow: { enabled: true }, dailyLimit: 7 },
    });
    expect(result).toEqual({ v: 1, demo: { dailyLimit: 7 } });
  });

  it("detail 域：premiumBodyIds 非法丢弃但 freeWindow 保留", () => {
    const result = sanitizeRemoteGateConfig({
      v: 1,
      detail: { freeWindow: { ...VALID_WINDOW }, premiumBodyIds: ["m31", ""] },
    });
    expect(result).toEqual({ v: 1, detail: { freeWindow: VALID_WINDOW } });
  });
});

// ---------------------------------------------------------------------------
// sanitizeRemoteGateConfig：demo.dailyLimit / detail.premiumBodyIds 字段矩阵
// ---------------------------------------------------------------------------

describe("sanitizeRemoteGateConfig 标量与名单字段消毒", () => {
  it.each([
    ["正整数保留", 8, true],
    ["1 保留（下界）", 1, true],
    ["0 丢弃", 0, false],
    ["负数丢弃", -3, false],
    ["小数丢弃", 2.5, false],
    ["NaN 丢弃", Number.NaN, false],
    ["Infinity 丢弃", Number.POSITIVE_INFINITY, false],
    ["字符串数字丢弃", "8", false],
    ["null 丢弃", null, false],
  ])("demo.dailyLimit %s", (_label, dailyLimit, kept) => {
    const result = sanitizeRemoteGateConfig({ v: 1, demo: { dailyLimit } });
    if (kept) {
      expect(result.demo?.dailyLimit).toBe(dailyLimit);
    } else {
      expect(result).toEqual({ v: 1 });
    }
  });

  it.each([
    ["合法名单保留", ["m31", "m87"], true],
    ["空数组保留（整表替换为零付费项 = 全部免费，运营自担）", [], true],
    ["含空串丢弃", ["m31", ""], false],
    ["含重复丢弃", ["m31", "m31"], false],
    ["含非字符串丢弃", ["m31", 7], false],
    ["非数组（对象）丢弃", { 0: "m31" }, false],
    ["非数组（字符串）丢弃", "m31", false],
  ])("detail.premiumBodyIds %s", (_label, premiumBodyIds, kept) => {
    const result = sanitizeRemoteGateConfig({ v: 1, detail: { premiumBodyIds } });
    if (kept) {
      expect(result.detail?.premiumBodyIds).toEqual(premiumBodyIds);
    } else {
      expect(result).toEqual({ v: 1 });
    }
  });
});

// ---------------------------------------------------------------------------
// sanitizeRemoteGateConfig：observatory 域（复用 validateObservatoryGateConfig 口径）
// ---------------------------------------------------------------------------

describe("sanitizeRemoteGateConfig observatory 域消毒", () => {
  it("合法 Partial 原样保留（可直通 resolveObservatoryGateConfig）", () => {
    const observatory = { dailyLimit: 20, premiumTrialDailyLimit: 5 };
    expect(sanitizeRemoteGateConfig({ v: 1, observatory })).toEqual({
      v: 1,
      observatory,
    });
  });

  it("联合合法组合整体保留：dailyLimit=2 + premiumTrialDailyLimit=1（成对下调）", () => {
    const observatory = { dailyLimit: 2, premiumTrialDailyLimit: 1 };
    expect(sanitizeRemoteGateConfig({ v: 1, observatory })).toEqual({
      v: 1,
      observatory,
    });
  });

  it.each([
    ["dailyLimit=0", { dailyLimit: 0 }],
    ["dailyLimit 小数", { dailyLimit: 2.5 }],
    ["premiumTrialDailyLimit 超过默认 dailyLimit（10）", { premiumTrialDailyLimit: 11 }],
    ["premiumBodyIds 含空串", { premiumBodyIds: ["m87", ""] }],
    ["premiumBodyIds 含重复", { premiumBodyIds: ["m87", "m87"] }],
    ["freeWindow 起止倒置", {
      freeWindow: { enabled: true, startUtc: VALID_WINDOW.endUtc, endUtc: VALID_WINDOW.startUtc },
    }],
    ["freeWindow 日期不可解析", {
      freeWindow: { enabled: true, startUtc: "bad", endUtc: "worse" },
    }],
  ])("单字段非法 → 域内丢弃：%s", (_label, observatory) => {
    expect(sanitizeRemoteGateConfig({ v: 1, observatory })).toEqual({ v: 1 });
  });

  it("非法字段丢弃、合法字段保留（细粒度回退）", () => {
    const result = sanitizeRemoteGateConfig({
      v: 1,
      observatory: { dailyLimit: 0, premiumBodyIds: ["m87"] },
    });
    expect(result).toEqual({ v: 1, observatory: { premiumBodyIds: ["m87"] } });
  });

  it("幸存字段跨字段冲突 → 丢弃整域（各自合法但组合越界）", () => {
    // dailyLimit=3（默认 trial=3 ≤ 3 合法）+ trial=5（默认 limit=10 ≥ 5 合法），
    // 组合 5 > 3 越界 → 整域丢弃
    const result = sanitizeRemoteGateConfig({
      v: 1,
      observatory: { dailyLimit: 3, premiumTrialDailyLimit: 5 },
    });
    expect(result).toEqual({ v: 1 });
  });

  it("freeWindow 部分窗口（字段不齐）丢弃，其余字段保留", () => {
    const result = sanitizeRemoteGateConfig({
      v: 1,
      observatory: { freeWindow: { enabled: false }, dailyLimit: 15 },
    });
    expect(result).toEqual({ v: 1, observatory: { dailyLimit: 15 } });
  });

  it("嵌套类型污染（dailyLimit 为字符串 / freeWindow 为数组）不抛且丢弃", () => {
    const result = sanitizeRemoteGateConfig({
      v: 1,
      observatory: { dailyLimit: "10", freeWindow: [] },
    });
    expect(result).toEqual({ v: 1 });
  });
});

// ---------------------------------------------------------------------------
// remoteFreeWindowActive：边界矩阵（委托 observatoryFreeWindowActive 口径）
// ---------------------------------------------------------------------------

describe("remoteFreeWindowActive 边界", () => {
  it("undefined → false", () => {
    expect(remoteFreeWindowActive(undefined, WINDOW_START_MS)).toBe(false);
  });

  it.each([
    ["start 边界（含）", WINDOW_START_MS, true],
    ["窗口中点", (WINDOW_START_MS + WINDOW_END_MS) / 2, true],
    ["end 边界（不含）", WINDOW_END_MS, false],
    ["start 前 1ms", WINDOW_START_MS - 1, false],
    ["end 前 1ms（仍在期内）", WINDOW_END_MS - 1, true],
    ["NaN 时钟", Number.NaN, false],
    ["Infinity 时钟", Number.POSITIVE_INFINITY, false],
  ])("%s", (_label, nowMs, expected) => {
    expect(remoteFreeWindowActive(VALID_WINDOW, nowMs)).toBe(expected);
  });

  it("enabled=false → 期内也 false", () => {
    expect(
      remoteFreeWindowActive({ ...VALID_WINDOW, enabled: false }, WINDOW_START_MS),
    ).toBe(false);
  });

  it("不可解析日期 → false（消毒漏网防御）", () => {
    expect(
      remoteFreeWindowActive(
        { enabled: true, startUtc: "bad", endUtc: "worse" },
        WINDOW_START_MS,
      ),
    ).toBe(false);
  });

  it("倒置窗口 → 恒 false", () => {
    expect(
      remoteFreeWindowActive(
        { enabled: true, startUtc: VALID_WINDOW.endUtc, endUtc: VALID_WINDOW.startUtc },
        (WINDOW_START_MS + WINDOW_END_MS) / 2,
      ),
    ).toBe(false);
  });

  it("口径回归：与 observatoryGate 默认配置窗口判定一致（委托无漂移）", () => {
    const w = OBSERVATORY_GATE_CONFIG.freeWindow;
    const mid = (Date.parse(w.startUtc) + Date.parse(w.endUtc)) / 2;
    expect(remoteFreeWindowActive({ ...w }, mid)).toBe(true);
    expect(remoteFreeWindowActive({ ...w }, Date.parse(w.endUtc))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// demoQuota 参数化（A1-2）
// ---------------------------------------------------------------------------

describe("demoQuota limit 参数化", () => {
  const DAY1_NOON = new Date(2026, 7, 10, 12, 0, 0).getTime();

  it("limit=2 注入生效：前 2 次放行，第 3 次拒绝", () => {
    let state: DemoQuotaState | null = null;
    const r1 = demoQuotaUpdate(state, DAY1_NOON, 2);
    expect(r1.allowed).toBe(true);
    expect(r1.remaining).toBe(1);
    state = r1.state;
    const r2 = demoQuotaUpdate(state, DAY1_NOON + 1_000, 2);
    expect(r2.allowed).toBe(true);
    expect(r2.remaining).toBe(0);
    state = r2.state;
    const r3 = demoQuotaUpdate(state, DAY1_NOON + 2_000, 2);
    expect(r3.allowed).toBe(false);
    expect(r3.remaining).toBe(0);
    expect(r3.state.used).toBe(2); // 拒绝后计数不再增长
  });

  it("limit 上调后既有计数继续消费（remaining 随 limit 重算）", () => {
    const state: DemoQuotaState = { dateKey: "2026-08-10", used: 5 };
    expect(demoQuotaRemaining(state, DAY1_NOON)).toBe(0); // 默认 5 已满
    expect(demoQuotaRemaining(state, DAY1_NOON, 8)).toBe(3);
    const r = demoQuotaUpdate(state, DAY1_NOON, 8);
    expect(r.allowed).toBe(true);
    expect(r.remaining).toBe(2);
  });

  it("缺省行为与旧版全等（显式传默认 = 不传）", () => {
    const state: DemoQuotaState = { dateKey: "2026-08-10", used: 3 };
    expect(demoQuotaUpdate(state, DAY1_NOON)).toEqual(
      demoQuotaUpdate(state, DAY1_NOON, FREE_DEMO_DAILY_LIMIT),
    );
    expect(demoQuotaRemaining(state, DAY1_NOON)).toBe(
      demoQuotaRemaining(state, DAY1_NOON, FREE_DEMO_DAILY_LIMIT),
    );
  });

  it.each([
    ["0", 0],
    ["负数", -2],
    ["小数", 2.5],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
  ])("非法 limit（%s）回退默认 5", (_label, limit) => {
    expect(demoQuotaRemaining(null, DAY1_NOON, limit)).toBe(FREE_DEMO_DAILY_LIMIT);
    const r = demoQuotaUpdate(null, DAY1_NOON, limit);
    expect(r.allowed).toBe(true);
    expect(r.remaining).toBe(FREE_DEMO_DAILY_LIMIT - 1);
  });
});

// ---------------------------------------------------------------------------
// premiumGate 参数化（A1-2）
// ---------------------------------------------------------------------------

describe("premiumGate 参数化", () => {
  const NOW_SEC = 1_900_000_000;
  const valid: UnlockEntitlement = { tier: "month", expSec: NOW_SEC + 1000 };

  it("isPremiumDetailBody 替换名单：缩表放行 / 扩表拦截", () => {
    const shrunk: ReadonlySet<string> = new Set(["m87"]);
    expect(isPremiumDetailBody("m31", shrunk)).toBe(false); // 默认名单内 → 缩表后免费
    expect(isPremiumDetailBody("m87", shrunk)).toBe(true);
    const expanded: ReadonlySet<string> = new Set([...PREMIUM_DETAIL_BODY_IDS, "heliopause"]);
    expect(isPremiumDetailBody("heliopause", expanded)).toBe(true); // 免费项扩表后变付费
  });

  it("premiumGateAllows 缩表：m31 无权益放行；扩表：heliopause 无权益拦截", () => {
    const shrunk: ReadonlySet<string> = new Set(["m87"]);
    expect(premiumGateAllows(null, "m31", NOW_SEC, { premiumBodyIds: shrunk })).toBe(true);
    expect(premiumGateAllows(null, "m87", NOW_SEC, { premiumBodyIds: shrunk })).toBe(false);
    const expanded: ReadonlySet<string> = new Set(["heliopause"]);
    expect(
      premiumGateAllows(null, "heliopause", NOW_SEC, { premiumBodyIds: expanded }),
    ).toBe(false);
    expect(
      premiumGateAllows(valid, "heliopause", NOW_SEC, { premiumBodyIds: expanded }),
    ).toBe(true); // 有效权益不受名单影响
  });

  it("限免旁路：freeWindowActive=true 无权益付费天体放行", () => {
    expect(premiumGateAllows(null, "m31", NOW_SEC, { freeWindowActive: true })).toBe(true);
    expect(premiumGateAllows(null, "m31", NOW_SEC, { freeWindowActive: false })).toBe(false);
    const r = premiumDetailGateUpdate(true, null, "m31", NOW_SEC, { freeWindowActive: true });
    expect(r).toEqual({ active: true, lockedHit: false });
  });

  it("premiumDetailGateUpdate 替换名单生效（扩表拦截报告 lockedHit）", () => {
    const expanded: ReadonlySet<string> = new Set(["heliopause"]);
    expect(
      premiumDetailGateUpdate(true, null, "heliopause", NOW_SEC, { premiumBodyIds: expanded }),
    ).toEqual({ active: false, lockedHit: true });
    // gateActive=false 时透传（与旧版口径一致）
    expect(
      premiumDetailGateUpdate(false, null, "heliopause", NOW_SEC, { premiumBodyIds: expanded }),
    ).toEqual({ active: false, lockedHit: false });
  });

  it("缺省行为与旧版全等（heliopause 恒放行回归 / 空 options 同缺省）", () => {
    expect(premiumGateAllows(null, "heliopause", NOW_SEC)).toBe(true);
    expect(premiumGateAllows(null, "heliopause", NOW_SEC, {})).toBe(true);
    expect(premiumGateAllows(null, "m31", NOW_SEC, {})).toBe(false);
    expect(isPremiumDetailBody("m31")).toBe(true);
    expect(premiumDetailGateUpdate(true, valid, "m31", NOW_SEC, {})).toEqual(
      premiumDetailGateUpdate(true, valid, "m31", NOW_SEC),
    );
  });
});
