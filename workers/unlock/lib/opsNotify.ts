/**
 * 运营通知编排纯逻辑（自动运营第1步：实时告警 + 每日转化日报，
 * REQ 口径：半自动运营——系统发信号，需拍板事项在邮件中标注，由
 * 运营者人工决策；jest + FakeD1 + mock mailer 直测，scheduled 壳只接线）。
 *
 * 邮件传输 = Cloudflare Email Service `send_email` 绑定（wrangler.toml
 * `[[send_email]]`，域名须先 `wrangler email sending enable guushu.com`
 * 接入）；绑定/vars 未配齐 → not_configured 零副作用降级（既有纪律）。
 *
 * 频控纪律（防刷屏 + 免费额度防御）：
 * - **每轮 cron 至多 1 封邮件**：日报到期时告警并入日报正文，否则单发
 *   告警（Workers Free 子请求预算 ≤49 + 邮件 1 = ≤50 顶格安全）；
 * - 日报每 UTC 日 1 封（kv_state `ops:report` 去重，00:00 UTC 轮次首发，
 *   失败自动顺延到下一轮——自愈语义）；
 * - 告警同日同内容去重（kv_state `ops:alert` 签名比对，上游持续异常
 *   3 小时轮次不重复发，次日重新提醒）；
 * - 状态**发送成功后才写**（失败零写入 → 下一轮重试）；
 * - `runOpsNotify` 永不抛（对账主流程已完成，通知层异常不得连带）。
 */
import {
  getStateJson,
  OPS_ALERT_STATE_KEY,
  OPS_REPORT_STATE_KEY,
  putStateRaw,
  type UnlockDbLike,
} from "./db";
import { buildDailyReport } from "./opsReport";
import type { UnifiedSyncResult } from "./refundSync";

/** 邮件消息（Email Service Workers 绑定 send() 入参最小面） */
export interface OpsMailMessage {
  readonly to: string;
  readonly from: { readonly email: string; readonly name: string };
  readonly subject: string;
  readonly text: string;
}

/** 邮件发送器最小接口（生产 = env 上的 send_email 绑定，测试 = mock） */
export interface OpsMailerLike {
  send(message: OpsMailMessage): Promise<unknown>;
}

/** 发件人显示名（对内运营邮件固定值） */
export const OPS_MAIL_SENDER_NAME = "Stellar Ops";

/** 编排注入依赖（scheduled 壳组装） */
export interface OpsNotifyDeps {
  readonly db: UnlockDbLike | null;
  readonly mailer: OpsMailerLike | null;
  /** 发件地址（vars `OPS_MAIL_FROM`；域名须已接入 Email Sending） */
  readonly fromEmail?: string;
  /** 收件地址（vars `OPS_MAIL_TO`，运营者邮箱） */
  readonly toEmail?: string;
  readonly nowMs: number;
  readonly sync: UnifiedSyncResult;
}

/** 编排结果（测试断言 + scheduled 日志） */
export interface OpsNotifyResult {
  /** 本轮对账结果推导出的全部告警行（含被去重未发送的） */
  readonly alerts: readonly string[];
  /** 实际发出的邮件形态 */
  readonly mailed: "report" | "alert" | "none";
  readonly error?: "not_configured" | "send_failed";
  /** 本次 DB 写行数（发送成功后的状态写；失败/无发送 = 0） */
  readonly dbWrites: number;
}

/**
 * 对账结果 → 告警行（纯函数）。口径登记：
 * - upstream_error / not_configured → 告警（生产 cron 不应出现，出现即
 *   配置或上游问题；同日同内容由编排层去重防刷屏）；
 * - 新增疑似退款 → 「待拍板」告警（模式 A 人工核实语义）；
 * - 支付宝补发/吊销/补登 → 自愈动作告警（低频且值得知晓）；
 * - `closed`（未支付超时关单）**不告警**——用户放弃支付属常规流量。
 */
export function buildSyncAlerts(sync: UnifiedSyncResult): string[] {
  const lines: string[] = [];
  if (sync.afdian.error === "upstream_error") {
    lines.push("爱发电退款巡检上游异常（本轮部分扫描，下一轮自动重试）");
  }
  if (sync.afdian.error === "not_configured") {
    lines.push("爱发电退款巡检未配置（AFDIAN secrets / D1 绑定缺失）");
  }
  if (sync.afdian.newSuspects > 0) {
    lines.push(
      `【待拍板】爱发电新增疑似退款 ${sync.afdian.newSuspects} 单，请人工核实（管理台 refund:suspects）`,
    );
  }
  if (sync.alipay.error === "not_configured") {
    lines.push("支付宝对账未配置（ALIPAY/ED25519 secrets 缺失）");
  }
  if (sync.alipay.reissued > 0) {
    lines.push(`支付宝对账补发 ${sync.alipay.reissued} 单（notify 缺失自愈）`);
  }
  if (sync.alipay.revoked > 0) {
    lines.push(`支付宝退款兜底吊销 ${sync.alipay.revoked} 单`);
  }
  if (sync.alipay.revocationsRepaired > 0) {
    lines.push(`吊销登记补登 ${sync.alipay.revocationsRepaired} 行`);
  }
  if (sync.alipay.contributorsRepaired > 0) {
    lines.push(`贡献者名单补登 ${sync.alipay.contributorsRepaired} 行`);
  }
  if (sync.mbd.error === "not_configured") {
    lines.push("面包多退款巡检未配置（MBD_DEVELOPER_KEY 缺失）");
  }
  if (sync.mbd.newSuspects > 0) {
    lines.push(
      `【待拍板】面包多新增疑似退款 ${sync.mbd.newSuspects} 单，请人工核实（管理台 refund:suspects）`,
    );
  }
  return lines;
}

/** UTC 日期串 */
function utcDateOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** 普通对象判定 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** kv_state 状态行字符串字段读取（形状不符 → ""） */
async function readStateField(
  db: UnlockDbLike,
  key: string,
  field: string,
): Promise<string> {
  const raw = await getStateJson(db, key);
  if (!isPlainObject(raw)) return "";
  const value = raw[field];
  return typeof value === "string" ? value : "";
}

/**
 * 通知编排主流程（每轮 cron 恰调用一次；**永不抛**——内部异常一律
 * 折算为结果字段，见文件头纪律）。
 */
export async function runOpsNotify(deps: OpsNotifyDeps): Promise<OpsNotifyResult> {
  const alerts = buildSyncAlerts(deps.sync);
  const { db, mailer, fromEmail, toEmail } = deps;
  if (db === null || mailer === null || !fromEmail || !toEmail) {
    return { alerts, mailed: "none", error: "not_configured", dbWrites: 0 };
  }
  try {
    const today = utcDateOf(deps.nowMs);

    // 日报到期判定（每 UTC 日 1 封；失败顺延语义 = 只比对 lastDate）
    const lastReportDate = await readStateField(
      db,
      OPS_REPORT_STATE_KEY,
      "lastDate",
    );
    const reportDue = lastReportDate !== today;

    // 告警去重（同日同内容签名跳过）
    let alertsToSend: readonly string[] = alerts;
    const sig = alerts.join("\n");
    if (alerts.length > 0) {
      const prevRaw = await getStateJson(db, OPS_ALERT_STATE_KEY);
      if (
        isPlainObject(prevRaw) &&
        prevRaw.sig === sig &&
        prevRaw.date === today
      ) {
        alertsToSend = [];
      }
    }

    if (!reportDue && alertsToSend.length === 0) {
      return { alerts, mailed: "none", dbWrites: 0 };
    }

    // 组装邮件（每轮至多 1 封：日报到期时告警并入正文）
    const alertBlock =
      alertsToSend.length > 0
        ? ["== 本轮告警 ==", ...alertsToSend.map((line) => `- ${line}`)].join("\n")
        : "";
    let subject: string;
    let text: string;
    if (reportDue) {
      const report = await buildDailyReport(db, deps.nowMs);
      subject = report.subject;
      text = alertBlock === "" ? report.text : `${report.text}\n\n${alertBlock}`;
    } else {
      subject = `[Stellar Ops] 告警 ${today}`;
      text = alertBlock;
    }

    try {
      await mailer.send({
        to: toEmail,
        from: { email: fromEmail, name: OPS_MAIL_SENDER_NAME },
        subject,
        text,
      });
    } catch {
      // 发送失败零状态写 → 下一轮（3h 后）自动重试
      return { alerts, mailed: "none", error: "send_failed", dbWrites: 0 };
    }

    // 状态写（发送成功后）
    const nowIso = new Date(deps.nowMs).toISOString();
    let dbWrites = 0;
    if (reportDue) {
      await putStateRaw(
        db,
        OPS_REPORT_STATE_KEY,
        JSON.stringify({ lastDate: today }),
        nowIso,
      );
      dbWrites += 1;
    }
    if (alertsToSend.length > 0) {
      await putStateRaw(
        db,
        OPS_ALERT_STATE_KEY,
        JSON.stringify({ sig, date: today }),
        nowIso,
      );
      dbWrites += 1;
    }
    return { alerts, mailed: reportDue ? "report" : "alert", dbWrites };
  } catch (e) {
    // 通知层兜底（D1 异常等）：不连带对账主流程，下一轮重试
    console.warn("opsNotify: 通知编排异常", e);
    return { alerts, mailed: "none", error: "send_failed", dbWrites: 0 };
  }
}
