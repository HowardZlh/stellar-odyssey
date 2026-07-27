/**
 * 动态事件视角域隔离纯逻辑（R2-4 软隔离 + R3-3 硬隔离，
 * IMPROVEMENT_REQUIREMENTS_2 §R2-4 / IMPROVEMENT_REQUIREMENTS_3 §R3-3）
 *
 * 各视角只呈现本视角域的动态事件：太阳耀斑/CME/CME 抵达属太阳系尺度
 * （L1/L2），超新星属银河系尺度（L3，R3-5 起不含 L4），银河系—仙女座
 * 合并预览属宇宙尺度（L4）。本模块建立事件 → 连续层级窗口的映射，并
 * 提供门控判定，供组件按需接入：
 *
 * - 自动触发域：`SunActivity.tsx`（耀斑/CME 泊松触发）与 `Supernova.tsx`
 *   （超新星泊松触发）显式限定触发层级——此前耀斑/CME 在 L3/L4 停摆仅是
 *   `timeJumped`（Δ>50 天）守卫在高时间压缩比下的副作用，非显式设计；
 *   超新星在 L1/L2 不触发也仅是时间压缩比过小（ΔMyr≈0）的概率副作用。
 * - 通知可见域：`HudInfo.tsx` 事件通知列按域过滤——域外隐藏完整通知卡片
 *   （R3-3 硬隔离后域外零事件 UI；R2-4 方案 b"折叠一行小字提醒"已废止）。
 * - 按钮可用域：`ControlPanel.tsx` 演示按钮域外置灰禁用 + tooltip 提示
 *   （方案"置灰 + 提示"，未选"点击自动切视角"，差异登记于需求文档）。
 * - 丢弃层（R3-3 §3.1-A）：离开事件视角域持续超过宽限期（1 真实秒，与
 *   模拟时间压缩比无关、不受暂停影响——丢弃语义随视角而非模拟时间）后，
 *   活跃事件被 store.tick 直接丢弃（清空全部关联状态、超新星不归档遗迹、
 *   合并预览恢复预览前时间）；回到域内不恢复，等待下一次自然触发。
 *   锚点切换/飞往运镜期间计时豁免（运镜路径瞬间穿越域边界不误丢弃，
 *   尤其合并预览启动自动切 L4 的 2 秒运镜途中连续层级 <3.6）。
 *
 * 三层窗口当前取值一致（同一事件同一窗口），但语义独立成函数，便于
 * 未来分层微调与逐层单测（需求 §4.1-D"三层窗口"）。
 *
 * 窗口边界依据（与既有渲染门控对齐，避免"通知可见但特效不可见"）：
 * - 太阳活动事件 ≤2.4：SunActivity levelWeight 梯形平台上缘
 *   trapezoidWeight(level, 0.5, 0.9, 2.4, 3.0) 的满值段终点；
 * - 超新星 [2.5, 3.5]（R3-5 收窄，原 ≥2.5 含 L4）：下缘为 Supernova
 *   snFadeWeight 淡入起点（L2/L3 边界），上缘为其满值平台终点——超新星
 *   为单恒星尺度事件，宇宙视角（L4）下星系间尺度不宜再弹超新星通知，
 *   L4 下活跃超新星按 R3-3 硬隔离丢弃（特效淡出窗口同步收窄至 L4 锚点
 *   4.0 处归零，与太阳事件"域上缘=平台终点、淡出延伸到下一锚点"模式一致）；
 * - 合并预览 ≥3.6：L4 视角段（星系间距/辉光演化仅宇宙视角可辨）；
 *   超新星域上缘 3.5 与合并预览下缘 3.6 互补无重叠。
 */

/** 受视角域门控的动态事件类别 */
export type ScopedEventKind = 'flare' | 'cme' | 'cmeArrival' | 'supernova' | 'merger';

/** 太阳活动事件（耀斑/CME/CME 抵达）视角域上缘（含），对齐 SunActivity 平台段 */
export const SOLAR_EVENT_MAX_LEVEL = 2.4;

/** 超新星事件视角域下缘（含），对齐 Supernova 淡入起点 */
export const SUPERNOVA_EVENT_MIN_LEVEL = 2.5;

/**
 * 超新星事件视角域上缘（含，R3-5）：对齐 Supernova snFadeWeight 满值
 * 平台终点——银河系视角（L3）专属事件，宇宙视角（L4）域外丢弃。
 */
export const SUPERNOVA_EVENT_MAX_LEVEL = 3.5;

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
  supernova: { minLevel: SUPERNOVA_EVENT_MIN_LEVEL, maxLevel: SUPERNOVA_EVENT_MAX_LEVEL },
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
 * 丢弃宽限期（R3-3 §3.1-A，真实秒）：连续层级离开事件视角域窗口并
 * 持续超过该时长才执行丢弃；宽限期内折返域内则计时清零、事件保留
 * （防连续滚轮缩放瞬间穿越域边界误丢弃，用户确认项 3）。
 */
export const EVENT_DISCARD_GRACE_SEC = 1;

/**
 * 锚点切换运镜豁免窗口（真实秒）：viewTransitionId 递增后按此时长
 * 豁免离域计时（锚点过渡动画 2 秒，data/cameraViews.ts VIEW_TRANSITION_SECONDS）。
 */
export const VIEW_TRANSITION_DISCARD_EXEMPT_SEC = 2;

/**
 * 飞往运镜豁免窗口（真实秒）：flyToRequestId 递增后按此时长豁免离域
 * 计时（飞往运镜 2.5 秒，utils/cameraFocus.ts FLY_TO_SECONDS）。
 */
export const FLY_TO_DISCARD_EXEMPT_SEC = 2.5;

/**
 * 离域计时推进（R3-3 §3.1-A 纯函数）：域内恒归零（含清除运镜豁免的
 * 剩余负值——域内无待丢弃事件，豁免语义自然失效）；域外按帧时长累加，
 * 上钳到宽限期（到期后保持恒值，避免无界增长引发每帧状态变更）。
 *
 * 运镜豁免通过将计时器置为负豁免窗口实现（store 在 viewTransitionId /
 * flyToRequestId 变更时写入 -EXEMPT_SEC），累加自负值起步，运镜期间
 * 到不了宽限阈值。锚点间过渡路径的连续层级单调，域边界至多穿越一次，
 * "域内归零取消剩余豁免"不会导致运镜中途误丢弃（登记于文件头）。
 */
export function outOfScopeElapsedUpdate(
  prevElapsedSec: number,
  inScope: boolean,
  dtSec: number,
): number {
  if (!Number.isFinite(prevElapsedSec)) {
    throw new RangeError(`离域计时必须为有限数，收到 ${prevElapsedSec}`);
  }
  if (!Number.isFinite(dtSec) || dtSec < 0) {
    throw new RangeError(`帧时长必须为非负有限数，收到 ${dtSec}`);
  }
  if (inScope) return 0;
  return Math.min(prevElapsedSec + dtSec, EVENT_DISCARD_GRACE_SEC);
}

/**
 * 丢弃到期判定（R3-3 §3.1-A）：离域计时达到宽限期即丢弃。
 */
export function eventDiscardDue(elapsedSec: number): boolean {
  if (!Number.isFinite(elapsedSec)) {
    throw new RangeError(`离域计时必须为有限数，收到 ${elapsedSec}`);
  }
  return elapsedSec >= EVENT_DISCARD_GRACE_SEC;
}

/**
 * 事件通知最短展示时长（真实秒）：通知展示与事件生命周期解耦——
 * 耀斑/CME 的事件时长按模拟时间推进，高时间压缩比下真实展示可能
 * 不足两秒，用户来不及点击"飞往观看/查看详情"。事件先于该时长完成时，
 * 通知继续驻留到最短展示时长再自动收起；事件持续更久则随事件收起
 * （原语义保留）。手动关闭与离域丢弃（EVENT_DISCARD_GRACE_SEC）不受
 * 此下限约束，始终立即生效。
 */
export const EVENT_NOTICE_MIN_VISIBLE_REAL_SEC = 15;

/**
 * 通知展示计时推进（真实秒，不受暂停/时间压缩比影响）：按帧时长累加，
 * 上钳到最短展示时长（到顶后保持恒值，避免无界增长引发每帧状态变更，
 * 与 outOfScopeElapsedUpdate 同模式）。
 */
export function noticeAgeUpdate(prevAgeSec: number, dtSec: number): number {
  if (!Number.isFinite(prevAgeSec) || prevAgeSec < 0) {
    throw new RangeError(`通知展示计时必须为非负有限数，收到 ${prevAgeSec}`);
  }
  if (!Number.isFinite(dtSec) || dtSec < 0) {
    throw new RangeError(`帧时长必须为非负有限数，收到 ${dtSec}`);
  }
  return Math.min(prevAgeSec + dtSec, EVENT_NOTICE_MIN_VISIBLE_REAL_SEC);
}

/**
 * 通知自动收起判定：事件已结束且展示计时达到最短展示时长。
 * 事件进行中通知始终保留（原"通知随事件生命周期"语义不变）。
 */
export function noticeAutoHideDue(ageSec: number, eventEnded: boolean): boolean {
  if (!Number.isFinite(ageSec)) {
    throw new RangeError(`通知展示计时必须为有限数，收到 ${ageSec}`);
  }
  return eventEnded && ageSec >= EVENT_NOTICE_MIN_VISIBLE_REAL_SEC;
}
