/**
 * 运营日报纯逻辑（自动运营第1步：以增长/转化为目标的半自动运营——
 * 每日一封邮件把「昨日漏斗转化 + 订单 + 待拍板事项」推给运营者，
 * 发送编排在 lib/opsNotify.ts，本文件只负责取数与文案组装，jest +
 * FakeD1 直测）。
 *
 * 取数纪律（FakeD1 SQL 子集约束 + 免费额度防御）：
 * - 不用聚合 SQL（GROUP BY/SUM 不在 FakeD1 子集），行量小（昨日订单/
 *   8 天漏斗行）JS 侧聚合；
 * - 每次日报 ≤5 条 D1 读、零 D1 写（发送状态写在 opsNotify 编排层）；
 * - 日报只在每 UTC 日首轮 cron 组装一次（编排层去重），额度可忽略。
 *
 * 排期余量提示（extractGateSchedule）为**展示专用宽松解析**：门控判定
 * 语义仍以前端消毒单点 src/utils/remoteGateConfig.ts 为准，本函数不回写
 * kv_state、不参与任何门控判定，不构成第二消毒副本（登记：Worker 直
 * import 该模块需引入 @ 别名解析链，wrangler 打包不支持，故日报侧独立
 * 做只读摘要）。
 */
import {
  GATE_CONFIG_STATE_KEY,
  getStateJson,
  REFUND_SUSPECTS_STATE_KEY,
  type UnlockDbLike,
} from "./db";
import { FUNNEL_EVENTS, type FunnelEventKey } from "./funnel";
import { sanitizeRefundSuspects } from "./refundSync";

/** 门控域键（gate:config schema v1 四域，顺序即日报展示顺序） */
export const GATE_DOMAINS = ["observatory", "detail", "tour", "demo"] as const;

export type GateDomainKey = (typeof GATE_DOMAINS)[number];

/** 门控域限免排期摘要（日报展示 + 待拍板判定素材） */
export interface GateDomainSchedule {
  readonly domain: GateDomainKey;
  /** 当前时刻是否有窗口生效 */
  readonly activeNow: boolean;
  /** 未来限免覆盖的最远终点（epoch ms；含生效中窗口；无 = null） */
  readonly lastEndMs: number | null;
}

/** 域中文名（日报文案；对内运营邮件，不入 i18n 字典） */
const GATE_DOMAIN_LABELS: Record<GateDomainKey, string> = {
  observatory: "观察站",
  detail: "细节层",
  tour: "L3/L4 巡游",
  demo: "手动演示",
};

/** 漏斗事件中文名（对内运营邮件，不入 i18n 字典） */
const FUNNEL_LABELS: Record<FunnelEventKey, string> = {
  lock_shown: "锁定提示曝光",
  lock_cta: "锁定→解锁点击",
  unlock_view: "解锁页曝光",
  tier_cta: "档位支付点击",
  pay_open: "支付面板打开",
  redeem_submit: "兑换提交",
  share_click: "分享点击",
};

/** 排期用尽预警阈值（剩余 ≤3 天进入「待拍板」小节） */
export const GATE_RUNWAY_WARN_DAYS = 3;

/** 普通对象判定 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** UTC 日期串 */
function utcDateOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** 单窗口宽松校验：enabled=true 且起止可解析、start < end 才计入摘要 */
function windowSpan(raw: unknown): { startMs: number; endMs: number } | null {
  if (!isPlainObject(raw) || raw.enabled !== true) return null;
  if (typeof raw.startUtc !== "string" || typeof raw.endUtc !== "string") {
    return null;
  }
  const startMs = Date.parse(raw.startUtc);
  const endMs = Date.parse(raw.endUtc);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs >= endMs) {
    return null;
  }
  return { startMs, endMs };
}

/**
 * gate:config 排期摘要提取（宽松解析，见文件头登记）：对每个域收集
 * freeWindow 单窗口 + freeWindows 排期数组中 enabled 且日期合法的窗口，
 * 汇总「当前是否生效」与「未来覆盖最远终点」。配置缺失/形状不符 → 四域
 * 全部空摘要（activeNow=false, lastEndMs=null）。
 */
export function extractGateSchedule(
  raw: unknown,
  nowMs: number,
): readonly GateDomainSchedule[] {
  const root = isPlainObject(raw) ? raw : {};
  return GATE_DOMAINS.map((domain) => {
    const domainRaw = root[domain];
    const spans: { startMs: number; endMs: number }[] = [];
    if (isPlainObject(domainRaw)) {
      const single = windowSpan(domainRaw.freeWindow);
      if (single !== null) spans.push(single);
      if (Array.isArray(domainRaw.freeWindows)) {
        for (const item of domainRaw.freeWindows) {
          const span = windowSpan(item);
          if (span !== null) spans.push(span);
        }
      }
    }
    let activeNow = false;
    let lastEndMs: number | null = null;
    for (const span of spans) {
      if (nowMs >= span.startMs && nowMs < span.endMs) activeNow = true;
      if (span.endMs > nowMs && (lastEndMs === null || span.endMs > lastEndMs)) {
        lastEndMs = span.endMs;
      }
    }
    return { domain, activeNow, lastEndMs };
  });
}

/** 日报组装产物（subject/text 直接进邮件） */
export interface DailyReport {
  readonly subject: string;
  readonly text: string;
}

/** funnel_daily 行形态（列名与 migrations/0002_funnel.sql 对齐） */
type FunnelRow = Record<string, unknown>;

/** 行内计数读取（缺列/脏值 → 0） */
function countOf(row: FunnelRow | undefined, key: FunnelEventKey): number {
  const v = row?.[key];
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;
}

/** 百分比文案（分母 0 → "—"） */
function pct(numer: number, denom: number): string {
  if (denom <= 0) return "—";
  return `${((numer / denom) * 100).toFixed(1)}%`;
}

/** 金额文案（null 安全求和后保留两位） */
function cny(amount: number): string {
  return `¥${amount.toFixed(2)}`;
}

/**
 * 组装运营日报（报告对象 = nowMs 的 UTC 昨日）：
 * 1. 昨日漏斗计数 + 前 7 日日均对比 + 关键转化率；
 * 2. 昨日支付成功订单（渠道/档位/金额，JS 聚合）；
 * 3. 昨日新增贡献者；
 * 4. 待拍板事项：疑似退款存量、限免排期余量（≤3 天 / 无排期预警）。
 */
export async function buildDailyReport(
  db: UnlockDbLike,
  nowMs: number,
): Promise<DailyReport> {
  const dayMs = 86_400_000;
  const today = utcDateOf(nowMs);
  const yesterday = utcDateOf(nowMs - dayMs);
  const windowStart = utcDateOf(nowMs - 8 * dayMs);
  const yStartIso = `${yesterday}T00:00:00.000Z`;
  const yEndIso = `${today}T00:00:00.000Z`;

  // 1) 漏斗：昨日 + 前 7 日（缺行 = 0；单查询 8 天窗口）
  const { results: funnelRows } = await db
    .prepare(
      "SELECT * FROM funnel_daily WHERE d >= ? AND d < ? ORDER BY d",
    )
    .bind(windowStart, today)
    .all<FunnelRow>();
  const yesterdayRow = funnelRows.find((r) => r.d === yesterday);
  const priorRows = funnelRows.filter((r) => r.d !== yesterday);
  const funnelLines = FUNNEL_EVENTS.map((key) => {
    const n = countOf(yesterdayRow, key);
    const avg =
      priorRows.reduce((sum, row) => sum + countOf(row, key), 0) / 7;
    return `- ${FUNNEL_LABELS[key]}：${n}（前7日均 ${avg.toFixed(1)}）`;
  });
  const lockShown = countOf(yesterdayRow, "lock_shown");
  const lockCta = countOf(yesterdayRow, "lock_cta");
  const unlockView = countOf(yesterdayRow, "unlock_view");
  const payOpen = countOf(yesterdayRow, "pay_open");
  const rateLines = [
    `- 锁定→点击解锁：${pct(lockCta, lockShown)}`,
    `- 解锁页→支付面板：${pct(payOpen, unlockView)}`,
  ];

  // 2) 昨日支付成功订单（paid_at ISO 串按字典序比较，与写入格式同源）
  const { results: orderRows } = await db
    .prepare(
      "SELECT channel, tier, amount_cny FROM orders WHERE status = ? AND paid_at >= ? AND paid_at < ?",
    )
    .bind("paid", yStartIso, yEndIso)
    .all<Record<string, unknown>>();
  let orderTotal = 0;
  const byChannel = new Map<string, { n: number; amount: number }>();
  for (const row of orderRows) {
    const channel = typeof row.channel === "string" ? row.channel : "unknown";
    const amount =
      typeof row.amount_cny === "number" && Number.isFinite(row.amount_cny)
        ? row.amount_cny
        : 0;
    orderTotal += amount;
    const agg = byChannel.get(channel) ?? { n: 0, amount: 0 };
    byChannel.set(channel, { n: agg.n + 1, amount: agg.amount + amount });
  }
  const orderLines =
    orderRows.length === 0
      ? ["- 无支付成功订单"]
      : [...byChannel.entries()].map(
          ([channel, agg]) =>
            `- ${channel}：${agg.n} 单 / ${cny(agg.amount)}`,
        );

  // 3) 昨日新增贡献者
  const { results: contribRows } = await db
    .prepare(
      "SELECT id FROM contributors WHERE created_at >= ? AND created_at < ?",
    )
    .bind(yStartIso, yEndIso)
    .all<Record<string, unknown>>();

  // 4) 待拍板事项：疑似退款存量 + 限免排期余量
  const suspects = sanitizeRefundSuspects(
    await getStateJson(db, REFUND_SUSPECTS_STATE_KEY),
  );
  const schedule = extractGateSchedule(
    await getStateJson(db, GATE_CONFIG_STATE_KEY),
    nowMs,
  );
  const scheduleLines = schedule.map((s) => {
    const label = GATE_DOMAIN_LABELS[s.domain];
    if (s.lastEndMs === null) {
      return `- ${label}：无生效/未来限免排期（代码默认关闭）`;
    }
    const days = (s.lastEndMs - nowMs) / dayMs;
    const state = s.activeNow ? "限免生效中" : "排期待生效";
    return `- ${label}：${state}，覆盖至 ${new Date(s.lastEndMs).toISOString()}（剩 ${days.toFixed(1)} 天）`;
  });
  const decisions: string[] = [];
  if (suspects.orders.length > 0) {
    decisions.push(
      `- 疑似退款存量 ${suspects.orders.length} 单待人工核实（管理台 refund:suspects）`,
    );
  }
  for (const s of schedule) {
    const label = GATE_DOMAIN_LABELS[s.domain];
    if (s.lastEndMs === null) continue; // 常态关闭不催办（代码默认即关）
    const days = (s.lastEndMs - nowMs) / dayMs;
    if (days <= GATE_RUNWAY_WARN_DAYS) {
      decisions.push(
        `- ${label}限免排期 ${days.toFixed(1)} 天后用尽——如需续期请在管理台下发 gate:config`,
      );
    }
  }

  const text = [
    `Stellar Odyssey 运营日报（${yesterday}，UTC 口径）`,
    "",
    "== 漏斗转化 ==",
    ...funnelLines,
    ...rateLines,
    "",
    "== 订单 ==",
    ...orderLines,
    `- 合计：${orderRows.length} 单 / ${cny(orderTotal)}；新增贡献者 ${contribRows.length} 人`,
    "",
    "== 限免排期 ==",
    ...scheduleLines,
    "",
    "== 待拍板 ==",
    ...(decisions.length > 0 ? decisions : ["- 无"]),
  ].join("\n");

  return {
    subject: `[Stellar Ops] 日报 ${yesterday}｜订单 ${orderRows.length} 单 ${cny(orderTotal)}｜锁定曝光 ${lockShown}`,
    text,
  };
}
