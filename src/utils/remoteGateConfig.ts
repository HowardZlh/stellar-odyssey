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

/**
 * 排期窗口数组上限（自动运营第2步：管理台一次下发未来多期限免；
 * 上限防御误下发超长数组——超出部分静默截断）
 */
export const MAX_FREE_WINDOWS = 32;

/** 细节层域配置（premiumBodyIds 为整表替换语义，非增删补丁，见 §0.11 登记） */
export interface RemoteDetailGateConfig {
  readonly freeWindow?: RemoteFreeWindow;
  /** 限免排期（多窗口预下发，任一窗口生效即限免生效；与 freeWindow 并存取或） */
  readonly freeWindows?: readonly RemoteFreeWindow[];
  readonly premiumBodyIds?: readonly string[];
}

/** L3/L4 巡游域配置 */
export interface RemoteTourGateConfig {
  readonly freeWindow?: RemoteFreeWindow;
  /** 限免排期（语义同 detail.freeWindows） */
  readonly freeWindows?: readonly RemoteFreeWindow[];
}

/** 手动演示域配置 */
export interface RemoteDemoGateConfig {
  readonly freeWindow?: RemoteFreeWindow;
  /** 限免排期（语义同 detail.freeWindows） */
  readonly freeWindows?: readonly RemoteFreeWindow[];
  readonly dailyLimit?: number;
}

/**
 * 观察站域配置：既有 Partial 覆盖（freeWindow/dailyLimit/premiumBodyIds/
 * premiumTrialDailyLimit，经 validateObservatoryGateConfig 口径校验）+
 * freeWindows 排期数组（消毒后由 `resolveScheduledObservatoryGateConfig`
 * 在判定时刻折算为生效 freeWindow，不参与 Partial 合并校验）。
 */
export interface RemoteObservatoryGateConfig
  extends Partial<ObservatoryGateConfig> {
  readonly freeWindows?: readonly RemoteFreeWindow[];
}

/** 远程门控配置 schema v1（KV 键 `gate:config`，全字段可选 Partial） */
export interface RemoteGateConfigV1 {
  readonly v: 1;
  readonly observatory?: RemoteObservatoryGateConfig;
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

/**
 * freeWindows 排期数组消毒：非数组 → 丢弃整字段；数组则**逐条**消毒
 * （坏条目丢弃、好条目保留），超出 MAX_FREE_WINDOWS 截断，全灭 → 丢弃。
 *
 * 语义登记（与 premiumBodyIds 的"任一非法即整表丢弃"不同）：排期窗口
 * 彼此独立（一条日期写错不改变其余窗口含义），细粒度保留不构成"猜测
 * 运营意图"；premiumBodyIds 是整表替换名单，缺一项即语义漂移故整丢。
 */
function sanitizeFreeWindows(
  raw: unknown,
): readonly RemoteFreeWindow[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: RemoteFreeWindow[] = [];
  for (const item of raw.slice(0, MAX_FREE_WINDOWS)) {
    const w = sanitizeFreeWindow(item);
    if (w !== undefined) out.push(w);
  }
  return out.length > 0 ? out : undefined;
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
 * freeWindows 排期数组独立消毒（不参与 Partial 合并校验——它不是
 * ObservatoryGateConfig 字段，仅供判定时刻折算生效窗口）。
 */
function sanitizeObservatory(
  raw: unknown,
): RemoteObservatoryGateConfig | undefined {
  if (!isPlainObject(raw)) return undefined;
  const freeWindows = sanitizeFreeWindows(raw.freeWindows);
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
  const withWindows = (
    fields: Partial<ObservatoryGateConfig> | undefined,
  ): RemoteObservatoryGateConfig | undefined => {
    if (fields === undefined && freeWindows === undefined) return undefined;
    return {
      ...(fields ?? {}),
      ...(freeWindows !== undefined ? { freeWindows } : {}),
    };
  };
  if (candidates.length === 0) return withWindows(undefined);
  // 先整体试合并：全部字段联合合法（如 dailyLimit=2 + premiumTrialDailyLimit=1
  // 的成对下调）直接保留，避免逐字段阶段误伤联合合法组合。
  const all = Object.assign({}, ...candidates) as Partial<ObservatoryGateConfig>;
  if (observatoryFieldValid(all)) return withWindows(all);
  const survivors = candidates.filter(observatoryFieldValid);
  if (survivors.length === 0) return withWindows(undefined);
  const merged = Object.assign({}, ...survivors) as Partial<ObservatoryGateConfig>;
  return withWindows(observatoryFieldValid(merged) ? merged : undefined);
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
  const freeWindows = sanitizeFreeWindows(raw.freeWindows);
  const premiumBodyIds = sanitizePremiumBodyIds(raw.premiumBodyIds);
  if (
    freeWindow === undefined &&
    freeWindows === undefined &&
    premiumBodyIds === undefined
  ) {
    return undefined;
  }
  return {
    ...(freeWindow !== undefined ? { freeWindow } : {}),
    ...(freeWindows !== undefined ? { freeWindows } : {}),
    ...(premiumBodyIds !== undefined ? { premiumBodyIds } : {}),
  };
}

/** tour 域消毒 */
function sanitizeTour(raw: unknown): RemoteTourGateConfig | undefined {
  if (!isPlainObject(raw)) return undefined;
  const freeWindow = sanitizeFreeWindow(raw.freeWindow);
  const freeWindows = sanitizeFreeWindows(raw.freeWindows);
  if (freeWindow === undefined && freeWindows === undefined) return undefined;
  return {
    ...(freeWindow !== undefined ? { freeWindow } : {}),
    ...(freeWindows !== undefined ? { freeWindows } : {}),
  };
}

/** demo 域消毒 */
function sanitizeDemo(raw: unknown): RemoteDemoGateConfig | undefined {
  if (!isPlainObject(raw)) return undefined;
  const freeWindow = sanitizeFreeWindow(raw.freeWindow);
  const freeWindows = sanitizeFreeWindows(raw.freeWindows);
  const dailyLimit = sanitizeDailyLimit(raw.dailyLimit);
  if (
    freeWindow === undefined &&
    freeWindows === undefined &&
    dailyLimit === undefined
  ) {
    return undefined;
  }
  return {
    ...(freeWindow !== undefined ? { freeWindow } : {}),
    ...(freeWindows !== undefined ? { freeWindows } : {}),
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

/** 单窗口 + 排期数组的域形状（detail/tour/demo/observatory 共形） */
export interface RemoteFreeSchedule {
  readonly freeWindow?: RemoteFreeWindow;
  readonly freeWindows?: readonly RemoteFreeWindow[];
}

/**
 * 取当前时刻生效的限免窗口（单窗口优先，其次按排期数组顺序首个命中）：
 * 无域配置/无命中 → undefined。for 循环无闭包分配——useDetailLayer 帧循环
 * 消费，渲染循环零分配纪律。
 */
export function activeRemoteFreeWindow(
  domain: RemoteFreeSchedule | undefined,
  nowMs: number,
): RemoteFreeWindow | undefined {
  if (domain === undefined) return undefined;
  if (remoteFreeWindowActive(domain.freeWindow, nowMs)) return domain.freeWindow;
  const windows = domain.freeWindows;
  if (windows === undefined) return undefined;
  for (let i = 0; i < windows.length; i++) {
    if (remoteFreeWindowActive(windows[i], nowMs)) return windows[i];
  }
  return undefined;
}

/**
 * 域级限免生效判定（自动运营第2步排期化）：单窗口 `freeWindow` 与排期
 * 数组 `freeWindows` 任一命中即生效——替代旧调用形态
 * `remoteFreeWindowActive(domain?.freeWindow, nowMs)`（消费端统一换用本函数，
 * 未配置排期时行为与旧形态全等）。
 */
export function remoteFreeScheduleActive(
  domain: RemoteFreeSchedule | undefined,
  nowMs: number,
): boolean {
  return activeRemoteFreeWindow(domain, nowMs) !== undefined;
}
