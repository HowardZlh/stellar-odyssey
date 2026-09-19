/**
 * @jest-environment node
 *
 * 运营通知编排测试（自动运营第1步）：
 * 1) buildSyncAlerts 告警口径矩阵（upstream/not_configured/疑似退款/
 *    自愈动作；closed 不告警）；
 * 2) claimState / releaseState 抢占原语（首抢/同值/并发/回滚/不吞错）；
 * 3) runOpsNotify 编排：not_configured 降级、日报到期发送 + 状态写、
 *    同日去重、告警签名去重、告警并入日报单封、发送失败回滚重试、
 *    组装失败回滚、同槽重复投递恰一封（2026-09-19 双发事故复现）、
 *    永不抛兜底。
 */
import {
  claimState,
  getStateRaw,
  OPS_ALERT_STATE_KEY,
  OPS_REPORT_STATE_KEY,
  releaseState,
} from "../db";
import {
  buildSyncAlerts,
  runOpsNotify,
  type OpsMailMessage,
  type OpsNotifyDeps,
} from "../opsNotify";
import type { UnifiedSyncResult } from "../refundSync";
import { FakeD1 } from "./helpers/fakeD1";

/** 固定"当前时刻"：2026-09-01T00:00:00Z */
const NOW_MS = Date.parse("2026-09-01T00:00:00Z");
const TODAY = "2026-09-01";

/** 三段全正常的对账结果 */
function healthySync(): UnifiedSyncResult {
  return {
    afdian: { ok: true, scanned: 3, newSuspects: 0, dbWrites: 1 },
    alipay: {
      ok: true,
      pendingChecked: 0,
      reissued: 0,
      closed: 0,
      refundChecked: 0,
      revoked: 0,
      revocationsRepaired: 0,
      contributorsRepaired: 0,
      dbWrites: 0,
    },
    mbd: { ok: true, checked: 0, newSuspects: 0, dbWrites: 0 },
  };
}

/** 录制型 mailer（可注入失败） */
class FakeMailer {
  readonly sent: OpsMailMessage[] = [];
  failNext = false;
  async send(message: OpsMailMessage): Promise<unknown> {
    if (this.failNext) throw new Error("smtp down");
    this.sent.push(message);
    return { ok: true };
  }
}

function depsOf(overrides: Partial<OpsNotifyDeps> = {}): OpsNotifyDeps {
  return {
    db: new FakeD1(),
    mailer: new FakeMailer(),
    fromEmail: "ops@guushu.com",
    toEmail: "steve@example.com",
    nowMs: NOW_MS,
    sync: healthySync(),
    ...overrides,
  };
}

function stateOf(db: FakeD1, key: string): unknown {
  const row = db.rows("kv_state").find((r) => r.k === key);
  return row === undefined ? null : JSON.parse(String(row.v));
}

// ---------------------------------------------------------------------------
// buildSyncAlerts
// ---------------------------------------------------------------------------

describe("buildSyncAlerts（告警口径）", () => {
  it("三段全正常 → 空告警", () => {
    expect(buildSyncAlerts(healthySync())).toEqual([]);
  });

  it("上游异常 / not_configured / 疑似退款 / 自愈动作全量覆盖", () => {
    const sync: UnifiedSyncResult = {
      afdian: {
        ok: false,
        error: "upstream_error",
        scanned: 1,
        newSuspects: 2,
        dbWrites: 2,
      },
      alipay: {
        ok: false,
        error: "not_configured",
        pendingChecked: 0,
        reissued: 1,
        closed: 5,
        refundChecked: 0,
        revoked: 2,
        revocationsRepaired: 3,
        contributorsRepaired: 4,
        dbWrites: 0,
      },
      mbd: {
        ok: false,
        error: "not_configured",
        checked: 0,
        newSuspects: 1,
        dbWrites: 0,
      },
    };
    const lines = buildSyncAlerts(sync);
    expect(lines).toEqual([
      "爱发电退款巡检上游异常（本轮部分扫描，下一轮自动重试）",
      "【待拍板】爱发电新增疑似退款 2 单，请人工核实（管理台 refund:suspects）",
      "支付宝对账未配置（ALIPAY/ED25519 secrets 缺失）",
      "支付宝对账补发 1 单（notify 缺失自愈）",
      "支付宝退款兜底吊销 2 单",
      "吊销登记补登 3 行",
      "贡献者名单补登 4 行",
      "面包多退款巡检未配置（MBD_DEVELOPER_KEY 缺失）",
      "【待拍板】面包多新增疑似退款 1 单，请人工核实（管理台 refund:suspects）",
    ]);
    // closed（未支付超时关单）为常规流量，不出现在告警中
    expect(lines.join("\n")).not.toContain("关单");
  });

  it("afdian not_configured 单独口径", () => {
    const sync = healthySync();
    const lines = buildSyncAlerts({
      ...sync,
      afdian: { ...sync.afdian, ok: false, error: "not_configured" },
    });
    expect(lines).toEqual([
      "爱发电退款巡检未配置（AFDIAN secrets / D1 绑定缺失）",
    ]);
  });
});

// ---------------------------------------------------------------------------
// claimState / releaseState（at-least-once 幂等原语）
// ---------------------------------------------------------------------------

describe("claimState / releaseState（抢占式状态推进）", () => {
  const KEY = "ops:test";
  const NOW = "2026-09-19T00:00:34.000Z";

  it("无行 → 首次抢到（INSERT）；同值再抢 → false；不同值 → 抢到（UPDATE）", async () => {
    const db = new FakeD1();
    expect(await claimState(db, KEY, "a", NOW)).toBe(true);
    expect(await claimState(db, KEY, "a", NOW)).toBe(false);
    expect(await claimState(db, KEY, "b", NOW)).toBe(true);
    expect(await getStateRaw(db, KEY)).toBe("b");
    expect(db.rows("kv_state").filter((r) => r.k === KEY)).toHaveLength(1);
  });

  it("并发抢占同一目标值 → 恰一个 true", async () => {
    const db = new FakeD1();
    const results = await Promise.all(
      Array.from({ length: 5 }, () => claimState(db, KEY, "x", NOW)),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("INSERT 非唯一约束异常照常上抛（不吞错）", async () => {
    const db = new FakeD1();
    jest.spyOn(db, "prepare").mockImplementation((sql: string) => {
      if (/^INSERT/i.test(sql)) throw new Error("D1_ERROR: storage unavailable");
      return {
        bind: () => ({
          run: async () => ({ success: true, meta: { changes: 0 } }),
        }),
      } as unknown as ReturnType<FakeD1["prepare"]>;
    });
    await expect(claimState(db, KEY, "x", NOW)).rejects.toThrow("storage unavailable");
  });

  it("releaseState：原本无行 → 删除；原本有行 → 恢复原值；值已被他人推进 → 不动", async () => {
    const db = new FakeD1();
    await claimState(db, KEY, "a", NOW);
    await releaseState(db, KEY, "a", null, NOW);
    expect(await getStateRaw(db, KEY)).toBeNull();

    await claimState(db, KEY, "old", NOW);
    await claimState(db, KEY, "new", NOW);
    await releaseState(db, KEY, "new", "old", NOW);
    expect(await getStateRaw(db, KEY)).toBe("old");

    await claimState(db, KEY, "mine", NOW);
    await claimState(db, KEY, "theirs", NOW); // 他人已推进
    await releaseState(db, KEY, "mine", "old", NOW);
    expect(await getStateRaw(db, KEY)).toBe("theirs");
  });
});

// ---------------------------------------------------------------------------
// runOpsNotify
// ---------------------------------------------------------------------------

describe("runOpsNotify（编排）", () => {
  it("db/mailer/from/to 任一缺失 → not_configured 零副作用", async () => {
    const mailer = new FakeMailer();
    for (const partial of [
      { db: null },
      { mailer: null },
      { fromEmail: "" },
      { toEmail: undefined },
    ] as Partial<OpsNotifyDeps>[]) {
      const out = await runOpsNotify(depsOf({ mailer, ...partial }));
      expect(out.error).toBe("not_configured");
      expect(out.mailed).toBe("none");
      expect(out.dbWrites).toBe(0);
    }
    expect(mailer.sent).toHaveLength(0);
  });

  it("日报到期（首轮）→ 发日报 + 写 ops:report；同日第二轮无告警 → 不发", async () => {
    const db = new FakeD1();
    const mailer = new FakeMailer();
    const first = await runOpsNotify(depsOf({ db, mailer }));
    expect(first.mailed).toBe("report");
    expect(first.dbWrites).toBe(1);
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0].subject).toContain("[Stellar Ops] 日报");
    expect(mailer.sent[0].to).toBe("steve@example.com");
    expect(mailer.sent[0].from).toEqual({
      email: "ops@guushu.com",
      name: "Stellar Ops",
    });
    expect(stateOf(db, OPS_REPORT_STATE_KEY)).toEqual({ lastDate: TODAY });

    // 同日 3 小时后第二轮：日报已发、无告警 → 零邮件零写入
    const second = await runOpsNotify(
      depsOf({ db, mailer, nowMs: NOW_MS + 3 * 3_600_000 }),
    );
    expect(second.mailed).toBe("none");
    expect(second.dbWrites).toBe(0);
    expect(mailer.sent).toHaveLength(1);
  });

  it("告警并入到期日报（单封）并写双状态；同日同签名告警不重发", async () => {
    const db = new FakeD1();
    const mailer = new FakeMailer();
    const sync = healthySync();
    const alerting: UnifiedSyncResult = {
      ...sync,
      afdian: { ...sync.afdian, newSuspects: 1 },
    };
    const first = await runOpsNotify(depsOf({ db, mailer, sync: alerting }));
    expect(first.mailed).toBe("report");
    expect(first.dbWrites).toBe(2); // ops:report + ops:alert
    expect(mailer.sent[0].text).toContain("== 本轮告警 ==");
    expect(mailer.sent[0].text).toContain("疑似退款 1 单");
    expect(stateOf(db, OPS_ALERT_STATE_KEY)).toEqual({
      sig: "【待拍板】爱发电新增疑似退款 1 单，请人工核实（管理台 refund:suspects）",
      date: TODAY,
    });

    // 同日第二轮同样告警（上游状态未变）：签名相同 → 去重不发
    const second = await runOpsNotify(
      depsOf({ db, mailer, sync: alerting, nowMs: NOW_MS + 3 * 3_600_000 }),
    );
    expect(second.mailed).toBe("none");
    expect(mailer.sent).toHaveLength(1);

    // 内容变化（新增第二条告警）→ 签名不同 → 发纯告警邮件
    const changed: UnifiedSyncResult = {
      ...alerting,
      mbd: { ...alerting.mbd, newSuspects: 1 },
    };
    const third = await runOpsNotify(
      depsOf({ db, mailer, sync: changed, nowMs: NOW_MS + 6 * 3_600_000 }),
    );
    expect(third.mailed).toBe("alert");
    expect(third.dbWrites).toBe(1); // 仅 ops:alert
    expect(mailer.sent).toHaveLength(2);
    expect(mailer.sent[1].subject).toBe(`[Stellar Ops] 告警 ${TODAY}`);
    expect(mailer.sent[1].text).toContain("面包多新增疑似退款 1 单");
  });

  it("跨日后同签名告警重新提醒（次日再发）", async () => {
    const db = new FakeD1();
    const mailer = new FakeMailer();
    const sync = healthySync();
    const alerting: UnifiedSyncResult = {
      ...sync,
      afdian: { ...sync.afdian, ok: false, error: "upstream_error" },
    };
    await runOpsNotify(depsOf({ db, mailer, sync: alerting }));
    expect(mailer.sent).toHaveLength(1);
    // 次日首轮：日报到期 + 告警跨日重置 → 日报携带同签名告警
    const nextDay = await runOpsNotify(
      depsOf({ db, mailer, sync: alerting, nowMs: NOW_MS + 24 * 3_600_000 }),
    );
    expect(nextDay.mailed).toBe("report");
    expect(mailer.sent).toHaveLength(2);
    expect(mailer.sent[1].text).toContain("爱发电退款巡检上游异常");
  });

  it("发送失败 → send_failed 零状态写；下一轮自动重试成功", async () => {
    const db = new FakeD1();
    const mailer = new FakeMailer();
    mailer.failNext = true;
    const failed = await runOpsNotify(depsOf({ db, mailer }));
    expect(failed.error).toBe("send_failed");
    expect(failed.dbWrites).toBe(0);
    expect(stateOf(db, OPS_REPORT_STATE_KEY)).toBeNull();

    mailer.failNext = false;
    const retried = await runOpsNotify(
      depsOf({ db, mailer, nowMs: NOW_MS + 3 * 3_600_000 }),
    );
    expect(retried.mailed).toBe("report");
    expect(stateOf(db, OPS_REPORT_STATE_KEY)).toEqual({ lastDate: TODAY });
  });

  it("组装日报失败（D1 中途异常）→ 释放抢占，ops:report 不残留今日值", async () => {
    // 抢占成功后 buildDailyReport 的 SELECT 抛错：若不回滚，当日日报将永久丢失
    const db = new FakeD1();
    const mailer = new FakeMailer();
    const realPrepare = db.prepare.bind(db);
    let armed = false;
    jest.spyOn(db, "prepare").mockImplementation((sql: string) => {
      if (armed && /FROM orders/i.test(sql)) throw new Error("d1 hiccup");
      return realPrepare(sql);
    });
    armed = true;
    const out = await runOpsNotify(depsOf({ db, mailer }));
    expect(out.error).toBe("send_failed");
    expect(mailer.sent).toHaveLength(0);
    expect(stateOf(db, OPS_REPORT_STATE_KEY)).toBeNull();
    armed = false;
    const retried = await runOpsNotify(
      depsOf({ db, mailer, nowMs: NOW_MS + 3 * 3_600_000 }),
    );
    expect(retried.mailed).toBe("report");
  });

  it("同一 cron 槽被平台重复投递（并发两次）→ 日报恰发 1 封", async () => {
    // 2026-09-19 事故复现：两次 scheduled 相差 3s，均在对方写状态前进入编排。
    // mailer 发送挂起直到两次调用都完成了抢占判定，模拟旧实现的竞态窗口。
    const db = new FakeD1();
    const gate = { release: (): void => undefined };
    const opened = new Promise<void>((resolve) => {
      gate.release = resolve;
    });
    const sent: OpsMailMessage[] = [];
    const slowMailer = {
      async send(message: OpsMailMessage): Promise<unknown> {
        await opened;
        sent.push(message);
        return { ok: true };
      },
    };
    const a = runOpsNotify(depsOf({ db, mailer: slowMailer }));
    const b = runOpsNotify(depsOf({ db, mailer: slowMailer, nowMs: NOW_MS + 3_000 }));
    // 让两条编排都跑到抢占判定之后，再放行发送
    await new Promise((r) => setTimeout(r, 0));
    gate.release();
    const [ra, rb] = await Promise.all([a, b]);
    expect([ra.mailed, rb.mailed].sort()).toEqual(["none", "report"]);
    expect(ra.dbWrites + rb.dbWrites).toBe(1);
    expect(sent).toHaveLength(1);
    expect(stateOf(db, OPS_REPORT_STATE_KEY)).toEqual({ lastDate: TODAY });
  });

  it("重复投递且携带告警 → 日报 + 告警仍合计恰一次", async () => {
    const db = new FakeD1();
    const mailer = new FakeMailer();
    const sync = healthySync();
    const alerting: UnifiedSyncResult = {
      ...sync,
      afdian: { ...sync.afdian, newSuspects: 1 },
    };
    const [ra, rb] = await Promise.all([
      runOpsNotify(depsOf({ db, mailer, sync: alerting })),
      runOpsNotify(depsOf({ db, mailer, sync: alerting, nowMs: NOW_MS + 3_000 })),
    ]);
    expect(ra.dbWrites + rb.dbWrites).toBe(2); // ops:report + ops:alert 各恰一次
    const all = mailer.sent.map((m) => m.text).join("\n");
    expect(all.match(/== 本轮告警 ==/g)).toHaveLength(1);
    expect(mailer.sent.filter((m) => m.subject.includes("日报"))).toHaveLength(1);
  });

  it("D1 异常兜底：编排层捕获不抛（send_failed 折算）", async () => {
    const broken = {
      prepare(): never {
        throw new Error("d1 down");
      },
      batch(): never {
        throw new Error("d1 down");
      },
    };
    const out = await runOpsNotify(
      depsOf({ db: broken as unknown as OpsNotifyDeps["db"] }),
    );
    expect(out.error).toBe("send_failed");
    expect(out.mailed).toBe("none");
  });
});
