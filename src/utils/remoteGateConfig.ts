/**
 * 远程门控配置 schema v1 与消毒纯函数（A1，REQUIREMENTS_UNLOCK.md §A1 / §0.11）
 *
 * **消毒单点纪律**（§0.11）：本文件是 `gate:config` 消毒/合并纯函数的唯一
 * 实现，被前端消费（A3）、管理台写入前校验（A4，Node 直 import）、Worker
 * 测试三端共享；Worker 本体原样透传不消毒（避免两端逻辑漂移）。
 *
 * 消毒语义（永不抛异常，前端路径安全）：
 * - 顶层形状不符 / `v !== 1` → 返回空配置 `{ v: 1 }`（整体回退默认）；
 * - 域内单字段非法（freeWindow 日期不可解析或起止倒置 / dailyLimit 非正整数 /
 *   premiumBodyIds 含空串、重复或非字符串）→ **丢弃该字段保留其余**
 *   （细粒度回退）；域内全部字段被丢弃时省略该域；
 * - observatory 域复用 `resolveObservatoryGateConfig`（内部
 *   `validateObservatoryGateConfig`）口径校验——try/catch 转「丢弃」语义，
 *   不复制校验逻辑副本；先全字段整体合并校验（联合合法组合直接保留），
 *   失败再逐字段（各自与默认值合并）校验剔除非法项，幸存字段合并后仍
 *   跨字段冲突则丢弃整个 observatory 域（登记：不猜测保留哪个）；
 *   observatory.freeWindow 仅接受
 *   三字段齐全且类型正确的完整窗口（部分窗口丢弃，保持类型诚实）。
 *
 * freeWindow 生效判定 = **委托复用** `observatoryFreeWindowActive`
 * （§A1-1 二选一登记：委托形态——构造临时完整配置传入，零第三份判定副本）。
 *
 * 设计约束：环境无关纯 TS（无 React/浏览器/Node 专属 API），覆盖率 gate ≥90%。
 */

import {
  OBSERVATORY_GATE_CONFIG,
  type ObservatoryFreeWindow,
  type ObservatoryGateConfig,
} from '@/data/observatoryGate';
import {
  observatoryFreeWindowActive,
  resolveObservatoryGateConfig,
} from '@/utils/observatoryGate';

/** 限时免费窗口（口径同 ObservatoryFreeWindow：UTC ISO 起止，start 含 end 不含） */
export interface RemoteFreeWindow {
  readonly enabled: boolean;
  readonly startUtc: string;
  readonly endUtc: string;
}

/** 细节层域配置（premiumBodyIds 为整表替换语义，非增删补丁，见 §0.11 登记） */
export interface RemoteDetailGateConfig {
  readonly freeWindow?: RemoteFreeWindow;
  readonly premiumBodyIds?: readonly string[];
}

/** L3/L4 巡游域配置 */
export interface RemoteTourGateConfig {
  readonly freeWindow?: RemoteFreeWindow;
}

/** 手动演示域配置 */
export interface RemoteDemoGateConfig {
  readonly freeWindow?: RemoteFreeWindow;
  readonly dailyLimit?: number;
}

/** 远程门控配置 schema v1（KV 键 `gate:config`，全字段可选 Partial） */
export interface RemoteGateConfigV1 {
  readonly v: 1;
  readonly observatory?: Partial<ObservatoryGateConfig>;
  readonly detail?: RemoteDetailGateConfig;
  readonly tour?: RemoteTourGateConfig;
  readonly demo?: RemoteDemoGateConfig;
}

/** 空配置（全部回退代码默认值） */
const EMPTY_CONFIG: RemoteGateConfigV1 = { v: 1 };

/** 普通对象判定（排除 null / 数组 / 原始值） */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * freeWindow 消毒：三字段齐全且类型正确、起止可解析且 start < end 才保留
 * （校验口径同 `validateObservatoryGateConfig` 的免费期分支：enabled=false
 * 也要求日期合法，防止后续开启时才暴雷）。
 */
function sanitizeFreeWindow(raw: unknown): RemoteFreeWindow | undefined {
  if (!isPlainObject(raw)) return undefined;
  const { enabled, startUtc, endUtc } = raw;
  if (
    typeof enabled !== 'boolean' ||
    typeof startUtc !== 'string' ||
    typeof endUtc !== 'string'
  ) {
    return undefined;
  }
  const startMs = Date.parse(startUtc);
  const endMs = Date.parse(endUtc);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs >= endMs) {
    return undefined;
  }
  return { enabled, startUtc, endUtc };
}

/** dailyLimit 消毒：正整数才保留 */
function sanitizeDailyLimit(raw: unknown): number | undefined {
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw <= 0) {
    return undefined;
  }
  return raw;
}

/** premiumBodyIds 消毒：字符串数组、无空串、无重复才保留（整表替换语义） */
function sanitizePremiumBodyIds(raw: unknown): readonly string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const seen = new Set<string>();
  for (const id of raw) {
    if (typeof id !== 'string' || id.length === 0 || seen.has(id)) {
      return undefined;
    }
    seen.add(id);
  }
  return [...seen];
}

/** observatory 单字段试合并校验（复用 resolveObservatoryGateConfig，抛错 = 非法） */
function observatoryFieldValid(field: Partial<ObservatoryGateConfig>): boolean {
  try {
    resolveObservatoryGateConfig(field);
    return true;
  } catch {
    return false;
  }
}

/**
 * observatory 域消毒：形状挑取已知字段 → 全字段整体合并校验（联合合法直接
 * 保留）→ 失败再逐字段（与默认值合并）复用 `validateObservatoryGateConfig`
 * 口径剔除非法项 → 幸存字段整体再校验一次（跨字段冲突则丢弃整域）。
 */
function sanitizeObservatory(
  raw: unknown,
): Partial<ObservatoryGateConfig> | undefined {
  if (!isPlainObject(raw)) return undefined;
  const candidates: Partial<ObservatoryGateConfig>[] = [];
  const freeWindow = sanitizeObservatoryFreeWindowShape(raw.freeWindow);
  if (freeWindow !== undefined) candidates.push({ freeWindow });
  if (typeof raw.dailyLimit === 'number') {
    candidates.push({ dailyLimit: raw.dailyLimit });
  }
  if (typeof raw.premiumTrialDailyLimit === 'number') {
    candidates.push({ premiumTrialDailyLimit: raw.premiumTrialDailyLimit });
  }
  if (isStringArray(raw.premiumBodyIds)) {
    candidates.push({ premiumBodyIds: raw.premiumBodyIds });
  }
  if (candidates.length === 0) return undefined;
  // 先整体试合并：全部字段联合合法（如 dailyLimit=2 + premiumTrialDailyLimit=1
  // 的成对下调）直接保留，避免逐字段阶段误伤联合合法组合。
  const all = Object.assign({}, ...candidates) as Partial<ObservatoryGateConfig>;
  if (observatoryFieldValid(all)) return all;
  const survivors = candidates.filter(observatoryFieldValid);
  if (survivors.length === 0) return undefined;
  const merged = Object.assign({}, ...survivors) as Partial<ObservatoryGateConfig>;
  return observatoryFieldValid(merged) ? merged : undefined;
}

/**
 * observatory.freeWindow 形状消毒：仅接受三字段齐全且类型正确的完整窗口
 * （日期合法性交由 validateObservatoryGateConfig 统一裁决，此处只查形状）。
 */
function sanitizeObservatoryFreeWindowShape(
  raw: unknown,
): ObservatoryFreeWindow | undefined {
  if (!isPlainObject(raw)) return undefined;
  const { enabled, startUtc, endUtc } = raw;
  if (
    typeof enabled !== 'boolean' ||
    typeof startUtc !== 'string' ||
    typeof endUtc !== 'string'
  ) {
    return undefined;
  }
  return { enabled, startUtc, endUtc };
}

/** 纯字符串数组形状判定（元素级合法性交给 validateObservatoryGateConfig） */
function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/** detail 域消毒 */
function sanitizeDetail(raw: unknown): RemoteDetailGateConfig | undefined {
  if (!isPlainObject(raw)) return undefined;
  const freeWindow = sanitizeFreeWindow(raw.freeWindow);
  const premiumBodyIds = sanitizePremiumBodyIds(raw.premiumBodyIds);
  if (freeWindow === undefined && premiumBodyIds === undefined) return undefined;
  return {
    ...(freeWindow !== undefined ? { freeWindow } : {}),
    ...(premiumBodyIds !== undefined ? { premiumBodyIds } : {}),
  };
}

/** tour 域消毒 */
function sanitizeTour(raw: unknown): RemoteTourGateConfig | undefined {
  if (!isPlainObject(raw)) return undefined;
  const freeWindow = sanitizeFreeWindow(raw.freeWindow);
  if (freeWindow === undefined) return undefined;
  return { freeWindow };
}

/** demo 域消毒 */
function sanitizeDemo(raw: unknown): RemoteDemoGateConfig | undefined {
  if (!isPlainObject(raw)) return undefined;
  const freeWindow = sanitizeFreeWindow(raw.freeWindow);
  const dailyLimit = sanitizeDailyLimit(raw.dailyLimit);
  if (freeWindow === undefined && dailyLimit === undefined) return undefined;
  return {
    ...(freeWindow !== undefined ? { freeWindow } : {}),
    ...(dailyLimit !== undefined ? { dailyLimit } : {}),
  };
}

/**
 * 远程门控配置消毒（唯一实现，永不抛异常）：
 * - 顶层非普通对象 / `v !== 1` → `{ v: 1 }`；
 * - 各域独立消毒，域内非法字段细粒度丢弃，全空域省略。
 */
export function sanitizeRemoteGateConfig(raw: unknown): RemoteGateConfigV1 {
  if (!isPlainObject(raw) || raw.v !== 1) return EMPTY_CONFIG;
  const observatory = sanitizeObservatory(raw.observatory);
  const detail = sanitizeDetail(raw.detail);
  const tour = sanitizeTour(raw.tour);
  const demo = sanitizeDemo(raw.demo);
  return {
    v: 1,
    ...(observatory !== undefined ? { observatory } : {}),
    ...(detail !== undefined ? { detail } : {}),
    ...(tour !== undefined ? { tour } : {}),
    ...(demo !== undefined ? { demo } : {}),
  };
}

/**
 * 通用限免窗口生效判定：undefined → false；否则**委托**
 * `observatoryFreeWindowActive`（enabled && nowMs ∈ [start, end)，
 * 非有限时钟 → false）——构造临时完整配置传入，不复制判定逻辑。
 */
export function remoteFreeWindowActive(
  freeWindow: RemoteFreeWindow | undefined,
  nowMs: number,
): boolean {
  if (freeWindow === undefined) return false;
  return observatoryFreeWindowActive(
    { ...OBSERVATORY_GATE_CONFIG, freeWindow },
    nowMs,
  );
}
