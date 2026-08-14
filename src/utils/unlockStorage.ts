/**
 * 解锁权益 localStorage 持久层薄封装（U1-4，REQUIREMENTS_UNLOCK.md §U1-4）
 *
 * 键名风格沿用 locale 先例（`src/i18n/index.ts` 的 `stellar-odyssey:locale`）；
 * 防御口径同 readStoredLocale/persistLocale：隐私模式/配额异常静默吞掉
 * （读返回 null、写忽略），JSON 解析失败/形状不符返回 null。
 *
 * 本层只做原样存取：token 的验签在 U2 恢复权益时经 verifyToken 完成，
 * 此处不做任何有效性判定。
 */
import type { DemoQuotaState } from "@/utils/demoQuota";
import type { RemoteGateConfigV1 } from "@/utils/remoteGateConfig";
import type { RevocationListV1 } from "@/utils/revocationList";

/** 解锁 token 持久化键（登记） */
export const UNLOCK_TOKEN_STORAGE_KEY = "stellar-odyssey:unlockToken";

/** 演示限次持久化键（登记） */
export const DEMO_QUOTA_STORAGE_KEY = "stellar-odyssey:demoQuota";

/** 远程门控配置缓存键（A3-1 登记，stale-while-revalidate 快照） */
export const GATE_CONFIG_STORAGE_KEY = "stellar-odyssey:gateConfig";

/** 吊销名单缓存键（A6-3 登记，缓存软化 fail-closed 核对快照） */
export const REVOCATIONS_STORAGE_KEY = "stellar-odyssey:revocations";

/** 读取持久化 token 原始串（无存值/存取异常 → null） */
export function readStoredUnlockToken(): string | null {
  try {
    return window.localStorage.getItem(UNLOCK_TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

/** 持久化 token（传 null 清除；存取异常静默忽略——会话内权益不受影响） */
export function persistUnlockToken(token: string | null): void {
  try {
    if (token === null) {
      window.localStorage.removeItem(UNLOCK_TOKEN_STORAGE_KEY);
    } else {
      window.localStorage.setItem(UNLOCK_TOKEN_STORAGE_KEY, token);
    }
  } catch {
    // 隐私模式/配额异常：忽略
  }
}

/** 读取持久化限次状态（JSON 解析失败/形状不符/存取异常 → null） */
export function readStoredDemoQuota(): DemoQuotaState | null {
  try {
    const raw = window.localStorage.getItem(DEMO_QUOTA_STORAGE_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const rec = parsed as Record<string, unknown>;
    if (typeof rec.dateKey !== "string") return null;
    if (typeof rec.used !== "number" || !Number.isFinite(rec.used)) return null;
    return { dateKey: rec.dateKey, used: rec.used };
  } catch {
    return null;
  }
}

/** 持久化限次状态（存取异常静默忽略） */
export function persistDemoQuota(state: DemoQuotaState): void {
  try {
    window.localStorage.setItem(DEMO_QUOTA_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // 隐私模式/配额异常：忽略
  }
}

/**
 * 读取远程门控配置缓存（A3-1）：返回解析后的 unknown 原值——消毒由
 * 调用方经 `sanitizeRemoteGateConfig` 单点完成（§0.11 纪律，本层不做
 * 形状判定）；无存值/JSON 解析失败/存取异常 → null。
 */
export function readStoredGateConfig(): unknown {
  try {
    const raw = window.localStorage.getItem(GATE_CONFIG_STORAGE_KEY);
    if (raw === null) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** 持久化远程门控配置（消毒后形态；存取异常静默忽略） */
export function persistGateConfig(config: RemoteGateConfigV1): void {
  try {
    window.localStorage.setItem(GATE_CONFIG_STORAGE_KEY, JSON.stringify(config));
  } catch {
    // 隐私模式/配额异常：忽略
  }
}

/**
 * 读取吊销名单缓存（A6-3）：返回解析后的 unknown 原值——消毒由调用方
 * 经 `sanitizeRevocationList` 单点完成（§0.15 纪律，本层不做形状判定）；
 * 无存值/JSON 解析失败/存取异常 → null（= 无缓存，缓存软化分支依据）。
 */
export function readStoredRevocations(): unknown {
  try {
    const raw = window.localStorage.getItem(REVOCATIONS_STORAGE_KEY);
    if (raw === null) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** 持久化吊销名单（消毒后形态；存取异常静默忽略） */
export function persistRevocations(list: RevocationListV1): void {
  try {
    window.localStorage.setItem(REVOCATIONS_STORAGE_KEY, JSON.stringify(list));
  } catch {
    // 隐私模式/配额异常：忽略
  }
}
