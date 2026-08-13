/**
 * 天体观察站门控纯逻辑（O1，REQUIREMENTS_OBSERVATORY.md §3）
 *
 * 判定顺序（`observatoryAccessUpdate`）：
 * 1. 有效解锁权益（entitled）或限时免费期内 → 放行且**不计次**；
 * 2. 每日总额度已尽 → 拒绝（`daily-exhausted`）；
 * 3. 专属天体且试玩额度已尽 → 拒绝（`premium-exhausted`）；
 * 4. 放行并计次：任意天体 +1 总额度，专属天体额外 +1 试玩额度
 *    （试玩计次**同时占用**总额度，需求确认口径）。
 *
 * 自然日重置沿用 demoQuota 口径（本地时区 dateKey，跨日即重置；时钟
 * 回拨到前日相当于白捡一天额度——弱门定位可接受，但任何输入下输出的
 * used/remaining 不产生负数/NaN）。
 *
 * 设计约束（devPreview/lab 同范式）：本文件不 import React / three，
 * 保持纯 TS 可单测（覆盖率 gate ≥90%）。
 */

import {
  OBSERVATORY_GATE_CONFIG,
  type ObservatoryGateConfig,
} from '@/data/observatoryGate';
import { localDateKey } from '@/utils/demoQuota';

/** 观察站限次状态（localStorage 持久化形态，见 utils/observatoryStorage.ts） */
export interface ObservatoryQuotaState {
  /** 本地自然日键 `YYYY-MM-DD` */
  readonly dateKey: string;
  /** 当日已用总次数（≥0 整数，任意天体每次进入 +1） */
  readonly used: number;
  /** 当日已用专属天体试玩次数（≥0 整数，专属池共享） */
  readonly premiumUsed: number;
}

/** 拒绝原因（锁定提示文案分流） */
export type ObservatoryDenyReason = 'daily-exhausted' | 'premium-exhausted';

/** observatoryAccessUpdate 判定结果 */
export interface ObservatoryAccessResult {
  /** 本次进入是否放行 */
  readonly allowed: boolean;
  /** 拒绝原因（放行时为 null） */
  readonly denyReason: ObservatoryDenyReason | null;
  /** 本次是否消耗了额度（权益/免费期放行 = false） */
  readonly counted: boolean;
  /** 更新后状态（无论是否放行都应持久化） */
  readonly state: ObservatoryQuotaState;
  /** 当日剩余总次数（≥0） */
  readonly remaining: number;
  /** 专属天体当日剩余试玩次数（≥0；取试玩池与总额度的较小值——试玩占用总额度） */
  readonly premiumRemaining: number;
}

/**
 * 校验门控配置合法性（消费前防错，纯函数）
 *
 * @throws RangeError 限次非正整数 / 试玩额度越界 / 名单空串或重复 /
 *   免费期日期不可解析或起止倒置
 */
export function validateObservatoryGateConfig(config: ObservatoryGateConfig): void {
  if (!Number.isInteger(config.dailyLimit) || config.dailyLimit <= 0) {
    throw new RangeError(
      `观察站每日总限次必须为正整数，收到 ${config.dailyLimit}`,
    );
  }
  if (
    !Number.isInteger(config.premiumTrialDailyLimit) ||
    config.premiumTrialDailyLimit <= 0 ||
    config.premiumTrialDailyLimit > config.dailyLimit
  ) {
    throw new RangeError(
      `观察站专属试玩额度必须为正整数且 ≤ 每日总限次（${config.dailyLimit}），收到 ${config.premiumTrialDailyLimit}`,
    );
  }
  const seen = new Set<string>();
  for (const id of config.premiumBodyIds) {
    if (id.length === 0) {
      throw new RangeError('观察站专属天体名单不得含空串 id');
    }
    if (seen.has(id)) {
      throw new RangeError(`观察站专属天体名单存在重复 id：${id}`);
    }
    seen.add(id);
  }
  const startMs = Date.parse(config.freeWindow.startUtc);
  const endMs = Date.parse(config.freeWindow.endUtc);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    throw new RangeError(
      `观察站免费期起止日期不可解析：${config.freeWindow.startUtc} / ${config.freeWindow.endUtc}`,
    );
  }
  if (startMs >= endMs) {
    throw new RangeError(
      `观察站免费期起点必须早于终点：${config.freeWindow.startUtc} ≥ ${config.freeWindow.endUtc}`,
    );
  }
}

/**
 * 取门控配置（未来管理后台下发覆盖的预留接口）：默认配置合并 Partial
 * 覆盖后做一次合法性校验。当前消费侧一律无参调用（= 默认配置）。
 */
export function resolveObservatoryGateConfig(
  override?: Partial<ObservatoryGateConfig>,
): ObservatoryGateConfig {
  const merged: ObservatoryGateConfig = {
    ...OBSERVATORY_GATE_CONFIG,
    ...override,
    freeWindow: {
      ...OBSERVATORY_GATE_CONFIG.freeWindow,
      ...override?.freeWindow,
    },
  };
  validateObservatoryGateConfig(merged);
  return merged;
}

/** 限时免费期是否生效（开关开启且 nowMs ∈ [start, end)；非有限时钟 → false） */
export function observatoryFreeWindowActive(
  config: ObservatoryGateConfig,
  nowMs: number,
): boolean {
  if (!config.freeWindow.enabled || !Number.isFinite(nowMs)) return false;
  const startMs = Date.parse(config.freeWindow.startUtc);
  const endMs = Date.parse(config.freeWindow.endUtc);
  return nowMs >= startMs && nowMs < endMs;
}

/** bodyId 是否属于支持者专属天体池 */
export function isPremiumObservatoryBody(
  config: ObservatoryGateConfig,
  bodyId: string,
): boolean {
  return config.premiumBodyIds.includes(bodyId);
}

/** used 消毒：非有限数/负数 → 0；小数取整（防持久层脏数据传染） */
function sanitizeCount(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.floor(value);
}

/** 状态按当日归一（跨自然日重置；nowMs 非有限沿用现状态 dateKey，demoQuota 同口径） */
function normalizeState(
  state: ObservatoryQuotaState | null,
  nowMs: number,
): ObservatoryQuotaState {
  const today = Number.isFinite(nowMs)
    ? localDateKey(nowMs)
    : (state?.dateKey ?? localDateKey(0));
  if (state !== null && state.dateKey === today) {
    return {
      dateKey: today,
      used: sanitizeCount(state.used),
      premiumUsed: sanitizeCount(state.premiumUsed),
    };
  }
  return { dateKey: today, used: 0, premiumUsed: 0 };
}

/** 剩余次数对（remaining = 总剩余；premiumRemaining 取试玩池与总额度较小值） */
function remainingOf(
  config: ObservatoryGateConfig,
  state: ObservatoryQuotaState,
): { remaining: number; premiumRemaining: number } {
  const remaining = Math.max(0, config.dailyLimit - state.used);
  const premiumPool = Math.max(
    0,
    config.premiumTrialDailyLimit - state.premiumUsed,
  );
  return { remaining, premiumRemaining: Math.min(remaining, premiumPool) };
}

/**
 * 只读查询当日剩余次数（画廊页额度横幅展示用，不消耗额度）
 */
export function observatoryRemaining(
  config: ObservatoryGateConfig,
  state: ObservatoryQuotaState | null,
  nowMs: number,
): { remaining: number; premiumRemaining: number } {
  return remainingOf(config, normalizeState(state, nowMs));
}

/**
 * 消费一次观察进入（纯函数，判定顺序见文件头）
 *
 * @param entitled 是否持有效解锁权益（store entitlement 非空；
 *   时效由 entitlementTick 维护，此处直接信任）
 */
export function observatoryAccessUpdate(
  config: ObservatoryGateConfig,
  state: ObservatoryQuotaState | null,
  bodyId: string,
  entitled: boolean,
  nowMs: number,
): ObservatoryAccessResult {
  const base = normalizeState(state, nowMs);
  // ① 权益 / 免费期：放行不计次
  if (entitled || observatoryFreeWindowActive(config, nowMs)) {
    return {
      allowed: true,
      denyReason: null,
      counted: false,
      state: base,
      ...remainingOf(config, base),
    };
  }
  // ② 每日总额度已尽
  if (base.used >= config.dailyLimit) {
    return {
      allowed: false,
      denyReason: 'daily-exhausted',
      counted: false,
      state: base,
      ...remainingOf(config, base),
    };
  }
  // ③ 专属天体试玩额度已尽
  const premium = isPremiumObservatoryBody(config, bodyId);
  if (premium && base.premiumUsed >= config.premiumTrialDailyLimit) {
    return {
      allowed: false,
      denyReason: 'premium-exhausted',
      counted: false,
      state: base,
      ...remainingOf(config, base),
    };
  }
  // ④ 放行并计次（专属天体同时占用两池）
  const next: ObservatoryQuotaState = {
    dateKey: base.dateKey,
    used: base.used + 1,
    premiumUsed: premium ? base.premiumUsed + 1 : base.premiumUsed,
  };
  return {
    allowed: true,
    denyReason: null,
    counted: true,
    state: next,
    ...remainingOf(config, next),
  };
}
