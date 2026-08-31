/**
 * 匿名转化漏斗计数（G 迭代 M4 G8，REQUIREMENTS_GROWTH §4 硬约束）
 *
 * 自建零依赖方案（CF Web Analytics 不支持自定义事件，禁止第三方 SDK）：
 * - 事件键**白名单枚举**（非自由字符串），初版 7 键（`share_click` 为
 *   2026-08-31 追加裁决）；
 * - 计数累积在 `sessionStorage`，**每会话最多成功发送 1 次**——
 *   `visibilitychange: hidden` 触发 `navigator.sendBeacon`，`pagehide`
 *   兜底；发送成功后打标防重发（打标后本会话不再累积/发送）；
 * - 隐私纪律：**不携带任何用户标识**（无 token/订单号/昵称/IP/Cookie），
 *   body 仅 `{d: 'YYYY-MM-DD', e: {<键>: <计数>}}`；
 * - fail-soft：sessionStorage/sendBeacon 任何异常一律静默，不影响功能；
 * - beacon body 用 JSON **字符串**（text/plain 简单请求，零 CORS 预检
 *   子请求——额度测算按每会话 1 请求口径，登记）。
 *
 * 纯函数（sanitize/increment/payload/date）单测覆盖；IO 壳（storage/
 * beacon/监听器）薄层防御式。
 */
import { resolveAlipayApiUrl } from "@/utils/alipayOrder";

/** 漏斗事件键白名单（服务端 workers/unlock/lib/funnel.ts 同表，人工同步登记） */
export const FUNNEL_EVENTS = [
  "lock_shown",
  "lock_cta",
  "unlock_view",
  "tier_cta",
  "pay_open",
  "redeem_submit",
  "share_click",
] as const;

export type FunnelEvent = (typeof FUNNEL_EVENTS)[number];

/** 单键单会话计数上限（防异常膨胀；服务端同数值二次钳制） */
export const FUNNEL_COUNT_CAP = 200;

/** Worker 端点路径（M4 契约） */
export const FUNNEL_API_PATH = "/api/ev";

/** sessionStorage 键：累积计数（JSON）/ 已发送打标 */
export const FUNNEL_COUNTS_STORAGE_KEY = "funnel:counts";
export const FUNNEL_SENT_STORAGE_KEY = "funnel:sent";

/** 漏斗计数表（白名单键 → 正整数） */
export type FunnelCounts = Partial<Record<FunnelEvent, number>>;

/** 事件键白名单判定 */
export function isFunnelEvent(key: unknown): key is FunnelEvent {
  return (
    typeof key === "string" && (FUNNEL_EVENTS as readonly string[]).includes(key)
  );
}

/**
 * 存值消毒：任意 JSON 输入 → 合法计数表（非白名单键丢弃、非正整数丢弃、
 * 超上限钳制）。非法整体输入回退空表。
 */
export function sanitizeFunnelCounts(raw: unknown): FunnelCounts {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const out: FunnelCounts = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!isFunnelEvent(key)) continue;
    if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
      continue;
    }
    out[key] = Math.min(value, FUNNEL_COUNT_CAP);
  }
  return out;
}

/** 计数 +1（纯函数；到上限后不再增长） */
export function incrementFunnelCount(
  counts: FunnelCounts,
  event: FunnelEvent,
): FunnelCounts {
  const current = counts[event] ?? 0;
  return { ...counts, [event]: Math.min(current + 1, FUNNEL_COUNT_CAP) };
}

/** UTC 日期串（服务端按 UTC 日聚合，两端口径一致） */
export function funnelDateOf(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** beacon 载荷（空计数返回 null = 本会话零事件不发请求） */
export function buildFunnelPayload(
  counts: FunnelCounts,
  date: string,
): { d: string; e: FunnelCounts } | null {
  if (Object.keys(counts).length === 0) return null;
  return { d: date, e: counts };
}

// -- IO 壳（以下为浏览器薄层，防御式 fail-soft） ---------------------------

/** 端点完整 URL（unlockRedeem/alipayOrder 同机制：NEXT_PUBLIC 覆写基址） */
const FUNNEL_API_URL = resolveAlipayApiUrl(
  FUNNEL_API_PATH,
  process.env.NEXT_PUBLIC_UNLOCK_API_BASE,
);

/** flush 监听器只注册一次（首个 track 调用时懒注册，零全局初始化侵入） */
let listenersReady = false;

function readStoredCounts(): FunnelCounts {
  try {
    const raw = window.sessionStorage.getItem(FUNNEL_COUNTS_STORAGE_KEY);
    if (raw === null) return {};
    return sanitizeFunnelCounts(JSON.parse(raw) as unknown);
  } catch {
    return {}; // 隐私模式禁 storage / 非法 JSON：静默回退
  }
}

function isSent(): boolean {
  try {
    return window.sessionStorage.getItem(FUNNEL_SENT_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * 发送累积计数（visibilitychange:hidden / pagehide 触发）：
 * sendBeacon 成功 → 打标 + 清计数（每会话最多成功 1 次）；
 * sendBeacon 缺失/返回 false → 保留计数静默返回（下次隐藏重试，
 * 成功前不打标——重试不违反"最多发 1 次成功"口径）。
 */
export function flushFunnelCounts(): void {
  try {
    if (isSent()) return;
    const payload = buildFunnelPayload(readStoredCounts(), funnelDateOf(new Date()));
    if (payload === null) return;
    if (typeof navigator.sendBeacon !== "function") return;
    // 字符串 body = text/plain 简单请求（无预检子请求，额度口径登记）
    const ok = navigator.sendBeacon(FUNNEL_API_URL, JSON.stringify(payload));
    if (!ok) return;
    window.sessionStorage.setItem(FUNNEL_SENT_STORAGE_KEY, "1");
    window.sessionStorage.removeItem(FUNNEL_COUNTS_STORAGE_KEY);
  } catch {
    // fail-soft：埋点失败不得影响任何用户功能
  }
}

function ensureFlushListeners(): void {
  if (listenersReady) return;
  listenersReady = true;
  try {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flushFunnelCounts();
    });
    window.addEventListener("pagehide", flushFunnelCounts);
  } catch {
    // 非浏览器环境：静默
  }
}

/**
 * 记录一次漏斗事件（组件插桩唯一入口）：sessionStorage 累积 + 懒注册
 * flush 监听器。已发送打标后本会话不再累积（不会再发送，避免无效写）。
 */
export function trackFunnelEvent(event: FunnelEvent): void {
  try {
    if (typeof window === "undefined") return;
    ensureFlushListeners();
    if (isSent()) return;
    const next = incrementFunnelCount(readStoredCounts(), event);
    window.sessionStorage.setItem(
      FUNNEL_COUNTS_STORAGE_KEY,
      JSON.stringify(next),
    );
  } catch {
    // fail-soft：storage 不可用等一律静默
  }
}

/** 测试钩子：重置监听器注册标记（仅单测消费） */
export function __resetFunnelListenersForTest(): void {
  listenersReady = false;
}
