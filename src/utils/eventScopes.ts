/**
 * 动态事件视角域隔离纯逻辑（R2-4 软隔离 + R3-3 硬隔离 + R5-8 判定基准修订，
 * IMPROVEMENT_REQUIREMENTS_2 §R2-4 / IMPROVEMENT_REQUIREMENTS_3 §R3-3 /
 * IMPROVEMENT_REQUIREMENTS_5 §R5-8）
 *
 * 各视角只呈现本视角域的动态事件：太阳耀斑/CME/CME 抵达属太阳系尺度
 * （L1/L2），超新星属银河系尺度（L3，R3-5 起不含 L4），银河系—仙女座
 * 合并预览属宇宙尺度（L4）。本模块建立事件 → 离散视角集合的映射，并
 * 提供门控判定，供组件按需接入：
 *
 * **语义变迁登记（R5-8，2026-07）**：判定基准由 R2-4 的"连续层级窗口"
 * （`continuousLevel` ∈ 闭区间——太阳 [1, 2.4] / 超新星 [2.5, 3.5] /
 * 合并 [3.6, 4]）修订为"离散 `viewLevel` 视角集合"（太阳 {L1, L2} /
 * 超新星 {L3} / 合并 {L4}），不再判断相机距离。根因：R3 层级锁定使
 * 跟随/飞往巡游天体期间 `viewLevel` 锁定为域主层级而 `continuousLevel`
 * 仍随相机距离同步——银河系巡游跟随造父一（距原点 ~190 单位）时
 * continuousLevel≈2.2 落入原太阳事件窗口，HUD 显示"银河系视角"却弹
 * 太阳事件通知（镜像缺陷：同场景超新星被判域外误丢弃/演示按钮误置灰）。
 * 改判 viewLevel 后门控与用户所见视角标签严格一致；原连续窗口常量
 * （SOLAR_EVENT_MAX_LEVEL / SUPERNOVA_EVENT_MIN_LEVEL /
 * SUPERNOVA_EVENT_MAX_LEVEL / MERGER_EVENT_MIN_LEVEL）随之废弃删除。
 * 自由缩放（无跟随）时 viewLevel 本就随距离同步离散层级
 * （utils/scale.ts discreteLevelFromContinuous，边界 1.5/2.5/3.5），
 * 行为基本不变；等效边界两处微调（用户已确认，§8.2-B）：太阳事件上界
 * 2.4 → 2.5（消除原 2.4–2.5"事件已域外但特效仍满值"空窗）、合并预览
 * 下界 3.6 → 3.5。特效 LOD 淡入淡出仍由连续层级驱动（SunActivity
 * trapezoid(0.5, 0.9, 2.4, 3.0)、Supernova snFadeWeight(2.5, 2.9, 3.5,
 * 4.0) 不动，保持缩放平滑；已知边界差异登记于需求文档 §8.2-A）。
 *
 * - 自动触发域：`SunActivity.tsx`（耀斑/CME 泊松触发）与 `Supernova.tsx`
 *   （超新星泊松触发）显式限定触发视角——此前耀斑/CME 在 L3/L4 停摆仅是
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
 *   锚点切换/飞往运镜期间计时豁免语义不变（R5-8 后按 1-4 显式切换时
 *   viewLevel 即时变更而相机仍在运镜，豁免窗口继续防误丢弃）。
 *
 * 三层门控当前取值一致（同一事件同一视角集合），但语义独立成函数，
 * 便于未来分层微调与逐层单测（R2-4 需求 §4.1-D"三层窗口"结构保留）。
 */

import type { ViewLevel } from '@/types';

/** 受视角域门控的动态事件类别 */
export type ScopedEventKind = 'flare' | 'cme' | 'cmeArrival' | 'supernova' | 'merger';

/**
 * 事件 → 离散视角集合映射（R5-8 §8.2-A 数据层）：
 * - 太阳活动事件（耀斑/CME/CME 抵达）→ {L1, L2}（太阳系尺度）
 * - 超新星 → {L3}（银河系视角专属，R3-5 收窄语义保持）
 * - 合并预览 → {L4}（宇宙视角专属）
 */
const EVENT_SCOPE_LEVELS: Record<ScopedEventKind, readonly ViewLevel[]> = {
  flare: ['L1', 'L2'],
  cme: ['L1', 'L2'],
  cmeArrival: ['L1', 'L2'],
  supernova: ['L3'],
  merger: ['L4'],
};

/** 事件 → 视角域集合映射（§8.2-A 数据层，只读） */
export function eventScopeLevels(kind: ScopedEventKind): readonly ViewLevel[] {
  return EVENT_SCOPE_LEVELS[kind];
}

/**
 * 事件是否处于视角域内（离散视角集合成员判定，R5-8）。
 * 三层门控共用的基础判定；层级来源必须为离散 `viewLevel`
 * （store 单一语义，类型收窄为 ViewLevel 杜绝再传 continuousLevel 分叉）。
 */
export function eventInScope(kind: ScopedEventKind, viewLevel: ViewLevel): boolean {
  return EVENT_SCOPE_LEVELS[kind].includes(viewLevel);
}

/**
 * 自动触发域（R2-4 §4.1-D）：泊松自动触发仅在域内进行。
 * 域外事件状态机照常推进（衰减/归档不受影响），仅新触发被抑制。
 */
export function eventAutoTriggerAllowed(kind: ScopedEventKind, viewLevel: ViewLevel): boolean {
  return eventInScope(kind, viewLevel);
}

/**
 * 通知可见域（R2-4 §4.1-B）：域外隐藏完整通知卡片，通知标志位不改动——
 * 回到域内且事件仍活跃时通知自动恢复。
 */
export function eventNoticeVisibleInScope(
  kind: ScopedEventKind,
  viewLevel: ViewLevel,
): boolean {
  return eventInScope(kind, viewLevel);
}

/**
 * 演示按钮可用域（R2-4 §4.1-C）：域外置灰禁用 + tooltip 提示。
 */
export function eventDemoEnabled(kind: ScopedEventKind, viewLevel: ViewLevel): boolean {
  return eventInScope(kind, viewLevel);
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
 * 丢弃宽限期（R3-3 §3.1-A，真实秒）：离散视角（viewLevel，R5-8）离开
 * 事件视角域并持续超过该时长才执行丢弃；宽限期内折返域内则计时清零、
 * 事件保留（防连续滚轮缩放瞬间穿越域边界误丢弃，用户确认项 3）。
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
 * 到不了宽限阈值。R5-8 后域判定基于离散 viewLevel（显式切换即时生效、
 * 单帧至多翻转一次），"域内归零取消剩余豁免"不会导致运镜中途误丢弃
 * （登记于文件头）。
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
