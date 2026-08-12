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

/**
 * 消费一次演示额度（纯函数）：
 * - 状态为 null / dateKey 与当日不符 → 计数重置后再判定（自然日切换重置）；
 * - 当日已用 < 限次 → 放行并计数 +1；否则拒绝（计数不再增长）；
 * - `nowMs` 非有限数（异常时钟）→ 沿用现状态的 dateKey 判定，不落入
 *   `NaN-NaN-NaN` 日键。
 */
export function demoQuotaUpdate(
  state: DemoQuotaState | null,
  nowMs: number,
): DemoQuotaUpdateResult {
  const today = Number.isFinite(nowMs)
    ? localDateKey(nowMs)
    : (state?.dateKey ?? localDateKey(0));
  const carried =
    state !== null && state.dateKey === today ? sanitizeUsed(state.used) : 0;
  if (carried >= FREE_DEMO_DAILY_LIMIT) {
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
    remaining: FREE_DEMO_DAILY_LIMIT - used,
  };
}
