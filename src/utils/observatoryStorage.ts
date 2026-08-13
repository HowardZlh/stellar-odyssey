/**
 * 天体观察站限次 localStorage 持久层薄封装（O1，REQUIREMENTS_OBSERVATORY.md §3）
 *
 * 键名风格与防御口径沿用 unlockStorage 先例：隐私模式/配额异常静默吞掉
 * （读返回 null、写忽略），JSON 解析失败/形状不符返回 null。
 * 本层只做原样存取，额度判定在 utils/observatoryGate.ts 纯函数完成。
 */
import type { ObservatoryQuotaState } from '@/utils/observatoryGate';

/** 观察站限次持久化键（登记） */
export const OBSERVATORY_QUOTA_STORAGE_KEY = 'stellar-odyssey:observatoryQuota';

/** 读取持久化限次状态（JSON 解析失败/形状不符/存取异常 → null） */
export function readStoredObservatoryQuota(): ObservatoryQuotaState | null {
  try {
    const raw = window.localStorage.getItem(OBSERVATORY_QUOTA_STORAGE_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const rec = parsed as Record<string, unknown>;
    if (typeof rec.dateKey !== 'string') return null;
    if (typeof rec.used !== 'number' || !Number.isFinite(rec.used)) return null;
    if (
      typeof rec.premiumUsed !== 'number' ||
      !Number.isFinite(rec.premiumUsed)
    ) {
      return null;
    }
    return { dateKey: rec.dateKey, used: rec.used, premiumUsed: rec.premiumUsed };
  } catch {
    return null;
  }
}

/** 持久化限次状态（存取异常静默忽略） */
export function persistObservatoryQuota(state: ObservatoryQuotaState): void {
  try {
    window.localStorage.setItem(
      OBSERVATORY_QUOTA_STORAGE_KEY,
      JSON.stringify(state),
    );
  } catch {
    // 隐私模式/配额异常：忽略
  }
}
