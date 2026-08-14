/**
 * 免费演示每日限次纯逻辑（U1-4，REQUIREMENTS_UNLOCK.md §U1-4）
 *
 * 自然日（本地时区）重置：dateKey 取本地日期 `YYYY-MM-DD`，跨日即重置。
 * 时钟回拨防御口径（登记）：回拨到前一自然日会因 dateKey 不匹配触发重置
 * （相当于白捡一天额度）——与 token 弱门同定位，接受；但任何输入下
 * 输出的 used/remaining 不产生负数/NaN。
 */

/** 免费演示每日限次（四类手动演示合计；U2 目验后可调回写） */
export const FREE_DEMO_DAILY_LIMIT = 5;

/** 限次状态（localStorage 持久化形态，见 utils/unlockStorage.ts） */
export interface DemoQuotaState {
  /** 本地自然日键 `YYYY-MM-DD` */
  readonly dateKey: string;
  /** 当日已用次数（≥0 整数） */
  readonly used: number;
}

/** demoQuotaUpdate 判定结果 */
export interface DemoQuotaUpdateResult {
  /** 更新后状态（无论是否放行都应持久化） */
  readonly state: DemoQuotaState;
  /** 本次演示是否放行 */
  readonly allowed: boolean;
  /** 放行后当日剩余次数（≥0） */
  readonly remaining: number;
}

/** epoch 毫秒 → 本地自然日键 `YYYY-MM-DD`（本地时区） */
export function localDateKey(nowMs: number): string {
  const d = new Date(nowMs);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** used 消毒：非有限数/负数 → 0；小数取整（防持久层脏数据传染） */
function sanitizeUsed(used: number): number {
  if (!Number.isFinite(used) || used < 0) return 0;
  return Math.floor(used);
}

/** limit 消毒（A1-2 参数化）：非正整数（远程配置脏值）回退代码默认 */
function sanitizeLimit(limit: number): number {
  if (!Number.isInteger(limit) || limit <= 0) return FREE_DEMO_DAILY_LIMIT;
  return limit;
}

/**
 * 只读查询当日剩余次数（U2 UI 展示/按钮置灰用，不消耗额度）：
 * dateKey 与当日不符（含 null 状态）视为满额；`nowMs` 非有限数沿用
 * 现状态 dateKey（与 demoQuotaUpdate 同口径）。
 *
 * @param limit 每日限次（A1-2 远程配置注入点；缺省 = 代码默认，
 *   非正整数消毒回退默认）
 */
export function demoQuotaRemaining(
  state: DemoQuotaState | null,
  nowMs: number,
  limit: number = FREE_DEMO_DAILY_LIMIT,
): number {
  const cap = sanitizeLimit(limit);
  const today = Number.isFinite(nowMs)
    ? localDateKey(nowMs)
    : (state?.dateKey ?? localDateKey(0));
  const carried = state !== null && state.dateKey === today ? sanitizeUsed(state.used) : 0;
  return Math.max(0, cap - carried);
}

/**
 * 消费一次演示额度（纯函数）：
 * - 状态为 null / dateKey 与当日不符 → 计数重置后再判定（自然日切换重置）；
 * - 当日已用 < 限次 → 放行并计数 +1；否则拒绝（计数不再增长）；
 * - `nowMs` 非有限数（异常时钟）→ 沿用现状态的 dateKey 判定，不落入
 *   `NaN-NaN-NaN` 日键。
 *
 * @param limit 每日限次（A1-2 远程配置注入点；缺省 = 代码默认，
 *   非正整数消毒回退默认）
 */
export function demoQuotaUpdate(
  state: DemoQuotaState | null,
  nowMs: number,
  limit: number = FREE_DEMO_DAILY_LIMIT,
): DemoQuotaUpdateResult {
  const cap = sanitizeLimit(limit);
  const today = Number.isFinite(nowMs)
    ? localDateKey(nowMs)
    : (state?.dateKey ?? localDateKey(0));
  const carried =
    state !== null && state.dateKey === today ? sanitizeUsed(state.used) : 0;
  if (carried >= cap) {
    return {
      state: { dateKey: today, used: carried },
      allowed: false,
      remaining: 0,
    };
  }
  const used = carried + 1;
  return {
    state: { dateKey: today, used },
    allowed: true,
    remaining: cap - used,
  };
}
