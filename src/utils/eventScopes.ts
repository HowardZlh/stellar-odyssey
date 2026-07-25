/**
 * 动态事件视角域隔离纯逻辑（R2-4，IMPROVEMENT_REQUIREMENTS_2 §R2-4，用户反馈点 4）
 *
 * 各视角只呈现本视角域的动态事件：太阳耀斑/CME/CME 抵达属太阳系尺度
 * （L1/L2），超新星属银河系尺度（L3/L4），银河系—仙女座合并预览属宇宙
 * 尺度（L4）。本模块建立事件 → 连续层级窗口的映射，并提供三层门控判定
 * （自动触发域 / 通知可见域 / 演示按钮可用域），供组件按需接入：
 *
 * - 自动触发域：`SunActivity.tsx`（耀斑/CME 泊松触发）与 `Supernova.tsx`
 *   （超新星泊松触发）显式限定触发层级——此前耀斑/CME 在 L3/L4 停摆仅是
 *   `timeJumped`（Δ>50 天）守卫在高时间压缩比下的副作用，非显式设计；
 *   超新星在 L1/L2 不触发也仅是时间压缩比过小（ΔMyr≈0）的概率副作用。
 * - 通知可见域：`HudInfo.tsx` 事件通知列按域过滤——域外隐藏完整通知卡片
 *   并折叠为一行小字提醒（方案 b，见 eventOutOfScopeSummaryZh），事件
 *   状态照常推进，回到域内且事件仍活跃（notice 标志未被用户关闭）时恢复。
 * - 按钮可用域：`ControlPanel.tsx` 演示按钮域外置灰禁用 + tooltip 提示
 *   （方案"置灰 + 提示"，未选"点击自动切视角"，差异登记于需求文档）。
 *
 * 三层窗口当前取值一致（同一事件同一窗口），但语义独立成函数，便于
 * 未来分层微调与逐层单测（需求 §4.1-D"三层窗口"）。
 *
 * 窗口边界依据（与既有渲染门控对齐，避免"通知可见但特效不可见"）：
 * - 太阳活动事件 ≤2.4：SunActivity levelWeight 梯形平台上缘
 *   trapezoidWeight(level, 0.5, 0.9, 2.4, 3.0) 的满值段终点；
 * - 超新星 ≥2.5：Supernova snFadeWeight 淡入起点（L2/L3 边界）；
 * - 合并预览 ≥3.6：L4 视角段（星系间距/辉光演化仅宇宙视角可辨）。
 */

/** 受视角域门控的动态事件类别 */
export type ScopedEventKind = 'flare' | 'cme' | 'cmeArrival' | 'supernova' | 'merger';

/** 太阳活动事件（耀斑/CME/CME 抵达）视角域上缘（含），对齐 SunActivity 平台段 */
export const SOLAR_EVENT_MAX_LEVEL = 2.4;

/** 超新星事件视角域下缘（含），对齐 Supernova 淡入起点 */
export const SUPERNOVA_EVENT_MIN_LEVEL = 2.5;

/** 合并预览视角域下缘（含），L4 视角段 */
export const MERGER_EVENT_MIN_LEVEL = 3.6;

/** 连续层级全域边界（store 将 continuousLevel 钳制在 [1, 4]） */
const LEVEL_FLOOR = 1;
const LEVEL_CEIL = 4;

/** 事件视角域窗口（连续层级闭区间） */
export interface EventScopeWindow {
  readonly minLevel: number;
  readonly maxLevel: number;
}

const EVENT_SCOPE_WINDOWS: Record<ScopedEventKind, EventScopeWindow> = {
  flare: { minLevel: LEVEL_FLOOR, maxLevel: SOLAR_EVENT_MAX_LEVEL },
  cme: { minLevel: LEVEL_FLOOR, maxLevel: SOLAR_EVENT_MAX_LEVEL },
  cmeArrival: { minLevel: LEVEL_FLOOR, maxLevel: SOLAR_EVENT_MAX_LEVEL },
  supernova: { minLevel: SUPERNOVA_EVENT_MIN_LEVEL, maxLevel: LEVEL_CEIL },
  merger: { minLevel: MERGER_EVENT_MIN_LEVEL, maxLevel: LEVEL_CEIL },
};

/** 事件 → 视角域窗口映射（§4.1-A 数据层） */
export function eventScopeWindow(kind: ScopedEventKind): EventScopeWindow {
  return EVENT_SCOPE_WINDOWS[kind];
}

/**
 * 事件是否处于视角域窗口内（闭区间判定，边界含）。
 * 三层门控共用的基础判定；非有限层级视为编程错误直接抛出。
 */
export function eventInScope(kind: ScopedEventKind, continuousLevel: number): boolean {
  if (!Number.isFinite(continuousLevel)) {
    throw new RangeError(`连续层级必须为有限数，收到 ${continuousLevel}`);
  }
  const { minLevel, maxLevel } = EVENT_SCOPE_WINDOWS[kind];
  return continuousLevel >= minLevel && continuousLevel <= maxLevel;
}

/**
 * 自动触发域（§4.1-D）：泊松自动触发仅在域内进行。
 * 域外事件状态机照常推进（衰减/归档不受影响），仅新触发被抑制。
 */
export function eventAutoTriggerAllowed(
  kind: ScopedEventKind,
  continuousLevel: number,
): boolean {
  return eventInScope(kind, continuousLevel);
}

/**
 * 通知可见域（§4.1-B）：域外隐藏完整通知卡片（折叠为一行小字提醒），
 * 通知标志位不改动——回到域内且事件仍活跃时通知自动恢复。
 */
export function eventNoticeVisibleInScope(
  kind: ScopedEventKind,
  continuousLevel: number,
): boolean {
  return eventInScope(kind, continuousLevel);
}

/**
 * 演示按钮可用域（§4.1-C）：域外置灰禁用 + tooltip 提示。
 */
export function eventDemoEnabled(kind: ScopedEventKind, continuousLevel: number): boolean {
  return eventInScope(kind, continuousLevel);
}

/** 事件所属视角域的中文名（tooltip / 折叠提醒用） */
export function eventScopeNameZh(kind: ScopedEventKind): string {
  switch (kind) {
    case 'flare':
    case 'cme':
    case 'cmeArrival':
      return '太阳系视角';
    case 'supernova':
      return '银河系视角';
    case 'merger':
      return '宇宙视角';
  }
}

/** 演示按钮域外禁用的 tooltip 文案（§4.1-C） */
export function eventDemoDisabledHintZh(kind: ScopedEventKind): string {
  return `请切换到${eventScopeNameZh(kind)}触发`;
}

/**
 * 域外活跃事件的折叠一行提醒文案（§4.1-B 方案 b，保证用户不错过演示）。
 */
export function eventOutOfScopeSummaryZh(kind: ScopedEventKind): string {
  switch (kind) {
    case 'flare':
      return `☀ 太阳耀斑进行中（切回${eventScopeNameZh(kind)}查看）`;
    case 'cme':
      return `🌊 日冕物质抛射（CME）进行中（切回${eventScopeNameZh(kind)}查看）`;
    case 'cmeArrival':
      return `🌌 CME 抵达地球极光增强进行中（切回${eventScopeNameZh(kind)}查看）`;
    case 'supernova':
      return `💥 超新星爆发进行中（切换到${eventScopeNameZh(kind)}查看）`;
    case 'merger':
      return `⏩ 合并预览进行中（切换到${eventScopeNameZh(kind)}查看）`;
  }
}
