/**
 * @jest-environment node
 *
 * 运营日报纯逻辑测试（自动运营第1步）：
 * 1) extractGateSchedule 宽松解析矩阵（单窗口/排期数组/形状不符/
 *    enabled=false/日期非法/生效中/未来窗口取最远终点）；
 * 2) buildDailyReport 取数与文案（FakeD1 播种漏斗/订单/贡献者/疑似单/
 *    gate:config，断言昨日口径、JS 聚合、待拍板小节）。
 */
import {
  GATE_CONFIG_STATE_KEY,
  REFUND_SUSPECTS_STATE_KEY,
} from "../db";
import {
  buildDailyReport,
  extractGateSchedule,
  GATE_DOMAINS,
  GATE_RUNWAY_WARN_DAYS,
} from "../opsReport";
import { FakeD1 } from "./helpers/fakeD1";

/** 固定"当前时刻"：2026-09-01T00:00:00Z（UTC 昨日 = 2026-08-31） */
const NOW_MS = Date.parse("2026-09-01T00:00:00Z");
const YESTERDAY = "2026-08-31";

/** 生效中窗口（覆盖 now ± 2 天） */
const ACTIVE_WINDOW = {
  enabled: true,
  startUtc: "2026-08-30T00:00:00Z",
  endUtc: "2026-09-03T00:00:00Z",
};

/** 未来窗口（now + 5 天起，覆盖 10 天） */
const FUTURE_WINDOW = {
  enabled: true,
  startUtc: "2026-09-06T00:00:00Z",
  endUtc: "2026-09-16T00:00:00Z",
};

/** 过期窗口 */
const PAST_WINDOW = {
  enabled: true,
  startUtc: "2026-08-01T00:00:00Z",
  endUtc: "2026-08-10T00:00:00Z",
};

function seedState(db: FakeD1, key: string, value: unknown): void {
  db.seed("kv_state", {
    k: key,
    v: JSON.stringify(value),
    updated_at: new Date(NOW_MS).toISOString(),
  });
}

// ---------------------------------------------------------------------------
// extractGateSchedule
// ---------------------------------------------------------------------------

describe("extractGateSchedule（排期摘要宽松解析）", () => {
  it("配置缺失/形状不符 → 四域空摘要", () => {
    for (const raw of [null, undefined, "x", 42, [1]]) {
      const out = extractGateSchedule(raw, NOW_MS);
      expect(out.map((s) => s.domain)).toEqual([...GATE_DOMAINS]);
      for (const s of out) {
        expect(s.activeNow).toBe(false);
        expect(s.lastEndMs).toBeNull();
      }
    }
  });

  it("单窗口生效中 → activeNow=true 且终点正确", () => {
    const out = extractGateSchedule(
      { observatory: { freeWindow: ACTIVE_WINDOW } },
      NOW_MS,
    );
    const obs = out.find((s) => s.domain === "observatory");
    expect(obs?.activeNow).toBe(true);
    expect(obs?.lastEndMs).toBe(Date.parse(ACTIVE_WINDOW.endUtc));
  });

  it("排期数组：生效中 + 未来窗口 → 终点取最远；纯未来窗口 activeNow=false", () => {
    const out = extractGateSchedule(
      {
        tour: { freeWindows: [ACTIVE_WINDOW, FUTURE_WINDOW, PAST_WINDOW] },
        demo: { freeWindows: [FUTURE_WINDOW] },
      },
      NOW_MS,
    );
    const tour = out.find((s) => s.domain === "tour");
    expect(tour?.activeNow).toBe(true);
    expect(tour?.lastEndMs).toBe(Date.parse(FUTURE_WINDOW.endUtc));
    const demo = out.find((s) => s.domain === "demo");
    expect(demo?.activeNow).toBe(false);
    expect(demo?.lastEndMs).toBe(Date.parse(FUTURE_WINDOW.endUtc));
  });

  it("enabled=false / 日期非法 / 起止倒置 / 已过期 → 不计入", () => {
    const out = extractGateSchedule(
      {
        detail: {
          freeWindow: { ...ACTIVE_WINDOW, enabled: false },
          freeWindows: [
            { enabled: true, startUtc: "咕", endUtc: "2026-09-09T00:00:00Z" },
            {
              enabled: true,
              startUtc: "2026-09-09T00:00:00Z",
              endUtc: "2026-09-06T00:00:00Z",
            },
            PAST_WINDOW,
            "not-an-object",
          ],
        },
      },
      NOW_MS,
    );
    const detail = out.find((s) => s.domain === "detail");
    expect(detail?.activeNow).toBe(false);
    expect(detail?.lastEndMs).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// buildDailyReport
// ---------------------------------------------------------------------------

describe("buildDailyReport（FakeD1 播种取数）", () => {
  it("空库 → 零值日报（不抛、含四小节、待拍板=无）", async () => {
    const db = new FakeD1();
    const report = await buildDailyReport(db, NOW_MS);
    expect(report.subject).toContain(YESTERDAY);
    expect(report.subject).toContain("订单 0 单");
    expect(report.text).toContain("== 漏斗转化 ==");
    expect(report.text).toContain("== 订单 ==");
    expect(report.text).toContain("== 限免排期 ==");
    expect(report.text).toContain("== 待拍板 ==");
    expect(report.text).toContain("- 无支付成功订单");
    expect(report.text).toMatch(/== 待拍板 ==\n- 无/);
    expect(report.text).toContain("无生效/未来限免排期");
  });

  it("漏斗：昨日行 + 前 7 日均值（缺行按 0 摊入 7 天）", async () => {
    const db = new FakeD1();
    db.seed("funnel_daily", {
      d: YESTERDAY,
      lock_shown: 20,
      lock_cta: 5,
      unlock_view: 10,
      tier_cta: 4,
      pay_open: 2,
      redeem_submit: 1,
      share_click: 3,
    });
    // 前 7 日只有一行有数据（lock_shown=14 → 日均 2.0）
    db.seed("funnel_daily", {
      d: "2026-08-28",
      lock_shown: 14,
      lock_cta: 0,
      unlock_view: 0,
      tier_cta: 0,
      pay_open: 0,
      redeem_submit: 0,
      share_click: 0,
    });
    const report = await buildDailyReport(db, NOW_MS);
    expect(report.text).toContain("锁定提示曝光：20（前7日均 2.0）");
    // 转化率：lock_cta/lock_shown = 25.0%；pay_open/unlock_view = 20.0%
    expect(report.text).toContain("锁定→点击解锁：25.0%");
    expect(report.text).toContain("解锁页→支付面板：20.0%");
    expect(report.subject).toContain("锁定曝光 20");
  });

  it("订单：昨日 paid 按渠道 JS 聚合；窗口外/非 paid 不计", async () => {
    const db = new FakeD1();
    const paidAt = `${YESTERDAY}T08:00:00.000Z`;
    db.seed("orders", {
      id: "o1", channel: "alipay", ext_order_no: "a1", status: "paid",
      amount_cny: 15, tier: "month", created_at: paidAt, paid_at: paidAt,
    });
    db.seed("orders", {
      id: "o2", channel: "alipay", ext_order_no: "a2", status: "paid",
      amount_cny: 6, tier: "week", created_at: paidAt, paid_at: paidAt,
    });
    db.seed("orders", {
      id: "o3", channel: "afdian", ext_order_no: "f1", status: "paid",
      amount_cny: 88, tier: "year", created_at: paidAt, paid_at: paidAt,
    });
    // 今日单（窗口外）与 pending 单（状态外）不计
    db.seed("orders", {
      id: "o4", channel: "alipay", ext_order_no: "a4", status: "paid",
      amount_cny: 6, tier: "week", created_at: paidAt,
      paid_at: "2026-09-01T01:00:00.000Z",
    });
    db.seed("orders", {
      id: "o5", channel: "alipay", ext_order_no: "a5", status: "pending",
      amount_cny: 6, tier: "week", created_at: paidAt, paid_at: paidAt,
    });
    db.seed("contributors", {
      id: "c1", nickname: "星友", channel: "alipay", amount_cny: 15,
      created_at: paidAt, hidden: 0,
    });
    const report = await buildDailyReport(db, NOW_MS);
    expect(report.text).toContain("- alipay：2 单 / ¥21.00");
    expect(report.text).toContain("- afdian：1 单 / ¥88.00");
    expect(report.text).toContain("- 合计：3 单 / ¥109.00；新增贡献者 1 人");
    expect(report.subject).toContain("订单 3 单 ¥109.00");
  });

  it("待拍板：疑似退款存量 + 排期余量 ≤3 天预警；充足排期不催办", async () => {
    const db = new FakeD1();
    seedState(db, REFUND_SUSPECTS_STATE_KEY, {
      v: 1,
      orders: [
        { orderId: "x1", detectedAt: "2026-08-30T00:00:00Z", status: 3 },
        { orderId: "x2", detectedAt: "2026-08-30T00:00:00Z", status: 4 },
      ],
    });
    seedState(db, GATE_CONFIG_STATE_KEY, {
      v: 1,
      observatory: { freeWindow: ACTIVE_WINDOW }, // 终点 now+2 天 ≤ 阈值 3
      tour: { freeWindows: [FUTURE_WINDOW] }, // 终点 now+15 天，不催办
    });
    const report = await buildDailyReport(db, NOW_MS);
    expect(report.text).toContain("疑似退款存量 2 单待人工核实");
    expect(report.text).toContain("观察站限免排期 2.0 天后用尽");
    expect(report.text).not.toContain("L3/L4 巡游限免排期");
    // 排期小节展示状态
    expect(report.text).toContain("观察站：限免生效中");
    expect(report.text).toContain("L3/L4 巡游：排期待生效");
    expect(report.text).toContain(`剩 ${(2).toFixed(1)} 天`);
    // 阈值常量本身参与断言（防无意改动）
    expect(GATE_RUNWAY_WARN_DAYS).toBe(3);
  });
});
