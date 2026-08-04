/**
 * 展馆模式（kiosk）状态机（B5 §5.1-B，方案 K5）
 *
 * 纯逻辑模块（不依赖 DOM/three.js/store，可全分支单测）：三态
 * `inactive`（未激活）/`touring`（自动巡游）/`paused`（用户输入暂停）。
 * 事件 + 时钟驱动（kioskTick(state, event, nowSec, timing)），返回
 * 新状态与副作用指令列表；副作用（UI 显隐 / 巡游推进）由 store
 * `kioskEvent` action 消费，驱动定时器与全局输入监听在
 * hooks/useKiosk.ts（方案 K5：只调既有 store action——
 * `cycleScopeBody`/`requestFlyTo`/`setViewLevel`，不新建运镜逻辑）。
 *
 * ── 状态转移表 ──────────────────────────────────────────────────────────
 * inactive + start          → touring（nextAt = now + dwell）  [hideUi, advance]
 * touring  + input          → paused （nextAt = now + resume） [showUi]
 * touring  + tick（到期）   → touring（nextAt = now + dwell）  [advance]
 * paused   + input          → paused （重置 nextAt = now + resume）
 * paused   + tick（到期）   → touring（nextAt = now + dwell）  [hideUi, advance]
 * 任意激活态 + exit         → inactive                          [showUi]
 * 其余组合（inactive+input/tick、未到期 tick、重复 start）＝ 原状态无副作用
 * （无变化时返回原 state 引用，供调用方零成本跳过写入）。
 *
 * ── 巡游推进语义（planKioskAdvance）────────────────────────────────────
 * dwell 含 2.5s 运镜（CameraController.FLY_TO_SECONDS，§0.5#6：推进即
 * 重置计时，不等运镜完成）。三种推进计划（全部复用既有 store action）：
 * - 'next'：域内下一站 = cycleScopeBody(1)（全语义：飞往 + 跟随 +
 *   层级锁定 + 面板跟随）；
 * - 'anchor'：域全景锚点站 = setViewLevel(SCOPE_HOME_LEVEL[scope])
 *   （cycleScope 由 scopeForLevel 同步、取消跟随；system/L1 特殊语义 =
 *   飞往并跟随会话锚定天体，与手动按 1 一致——system 域起点即当前
 *   锚定行星系统，登记）；
 * - 'enter'：域起点站 = requestFlyTo(SCOPE_DEFAULT_BODY[scope])（层级
 *   已对齐、未跟随时；域起点为域默认天体而非序列首站，与手动巡游
 *   "未跟随时先锚定域记忆/默认天体"语义一致，登记：solar=earth /
 *   galaxy=sgr-a-star / universe=m31）。
 *
 * `tour=all` 四域轮转（§0.5#8）：system → solar → galaxy → universe →
 * system…（由内向外叙事顺序，登记）；域末判定 = 当前跟随体位于域序列
 * 末站（下一步不再域内回绕而是切下一域；system 域为跟随体所在行星系统
 * 动态序列，单成员系统一步即切域）。
 *
 * 域切换两步语义核对登记（store/相机行为，无头目验实测）：域末 →
 * (dwell) 'anchor' 域全景锚点 → (dwell) 'enter' 域默认天体。不可
 * setViewLevel + requestFlyTo 同 tick 连发，两处踩坑：① 同帧下飞往
 * 捕获覆盖锚点过渡，相机从低层级尺度直接解析高层级目标——resolveTarget
 * 的尺度压缩依赖 continuousLevel（相机距离驱动），L3 跟随中（cont≈2.3）
 * 解析 m31 得近处错误位置（288 单位 vs 正确 ~7,655）并因 follow 重解析
 * 死锁在低尺度；② 仅 requestFlyTo 不对齐域也不行——'earth' 仅在
 * cycleScope=solar 时归 solar 域。两步分离后各站均为既有已验证运镜
 * （anchor=手动 1-4 键、enter=手动未跟随巡游起步），域切换多一站
 * 全景过渡（叙事登记：域末 → 域全景 → 域默认天体）。
 */

import type { LaunchTour, ViewLevel } from '@/types';
import type { CycleScope } from '@/utils/cycleScopes';
import { SCOPE_DEFAULT_BODY, SCOPE_HOME_LEVEL, sequenceForScope } from '@/utils/cycleScopes';

/** kiosk 三态（B5 §5.1-B） */
export type KioskPhase = 'inactive' | 'touring' | 'paused';

/** kiosk 状态机状态（纯数据，store `kiosk` 字段持有） */
export interface KioskState {
  phase: KioskPhase;
  /**
   * 下次动作绝对时刻（秒，时钟基准由调用方统一——useKiosk 用
   * performance.now()/1000）：touring=下一站推进时刻；paused=自动
   * 恢复巡游时刻；inactive 无意义（恒 0）
   */
  nextAtSec: number;
}

/** 未激活初始状态（store 初始值，冻结常量） */
export const KIOSK_INACTIVE: Readonly<KioskState> = Object.freeze({
  phase: 'inactive',
  nextAtSec: 0,
});

/** 空闲恢复默认时长（秒，§0.5#7：90 秒无操作回巡游；非 URL 参数） */
export const KIOSK_RESUME_DEFAULT_SEC = 90;

/** kiosk 事件：启动（按钮/?mode=kiosk）/ 用户输入 / 时钟 / 退出 */
export type KioskEvent = 'start' | 'input' | 'tick' | 'exit';

/** 副作用指令（store kioskEvent 消费）：UI 显隐 / 巡游推进一站 */
export type KioskEffect = 'hideUi' | 'showUi' | 'advance';

/** 计时参数（dwell 来自 launch 参数，resume 取默认常量） */
export interface KioskTiming {
  /** 每站停留秒数（含运镜，§0.5#6 默认 30、URL 可覆盖 5–600） */
  dwellSec: number;
  /** 暂停后无操作自动恢复秒数（§0.5#7 默认 90） */
  resumeSec: number;
}

/** kioskTick 返回：新状态（无变化时为原引用）+ 副作用指令列表 */
export interface KioskTickResult {
  state: KioskState;
  effects: readonly KioskEffect[];
}

/** 共享空副作用列表（高频 tick 路径零新对象分配，附录 A#1） */
const NO_EFFECTS: readonly KioskEffect[] = Object.freeze([]);

/** 纯函数状态转移（转移表见文件头） */
export function kioskTick(
  state: KioskState,
  event: KioskEvent,
  nowSec: number,
  timing: KioskTiming,
): KioskTickResult {
  switch (event) {
    case 'start':
      // 重复 start 幂等（已激活时无操作，防按钮/URL 双入口叠加）
      if (state.phase !== 'inactive') return { state, effects: NO_EFFECTS };
      return {
        state: { phase: 'touring', nextAtSec: nowSec + timing.dwellSec },
        effects: ['hideUi', 'advance'],
      };
    case 'exit':
      if (state.phase === 'inactive') return { state, effects: NO_EFFECTS };
      return { state: KIOSK_INACTIVE, effects: ['showUi'] };
    case 'input':
      if (state.phase === 'inactive') return { state, effects: NO_EFFECTS };
      if (state.phase === 'touring') {
        // 任意输入 → 暂停推进 + 显示 UI（§5.1-B）
        return {
          state: { phase: 'paused', nextAtSec: nowSec + timing.resumeSec },
          effects: ['showUi'],
        };
      }
      // 暂停中继续输入：仅重置恢复计时（UI 已可见）
      return { state: { phase: 'paused', nextAtSec: nowSec + timing.resumeSec }, effects: NO_EFFECTS };
    default: {
      // tick
      if (state.phase === 'inactive' || nowSec < state.nextAtSec) {
        return { state, effects: NO_EFFECTS };
      }
      const next: KioskState = { phase: 'touring', nextAtSec: nowSec + timing.dwellSec };
      // 暂停到期恢复：隐 UI + 立即推进一站（恢复即有位移反馈，登记）
      return { state: next, effects: state.phase === 'paused' ? ['hideUi', 'advance'] : ['advance'] };
    }
  }
}

/** 距下次动作剩余秒数（向上取整非负；暂停角标"N 秒后恢复"倒计时用） */
export function kioskRemainingSec(state: KioskState, nowSec: number): number {
  return Math.max(0, Math.ceil(state.nextAtSec - nowSec));
}

/** `tour=all` 四域轮转顺序（§0.5#8，由内向外叙事顺序登记） */
export const KIOSK_ALL_SCOPES: readonly CycleScope[] = Object.freeze([
  'system',
  'solar',
  'galaxy',
  'universe',
]);

/**
 * 巡游推进计划（消费方 store kioskEvent，一步一 action）：
 * - 'next'   → cycleScopeBody(1)（域内下一站）
 * - 'anchor' → setViewLevel(level)（域全景锚点站，域对齐/尺度到位）
 * - 'enter'  → requestFlyTo(bodyId)（域起点站，层级已对齐时）
 */
export type KioskAdvancePlan =
  | { kind: 'next' }
  | { kind: 'anchor'; scope: CycleScope; level: ViewLevel }
  | { kind: 'enter'; scope: CycleScope; bodyId: string };

/** 域全景锚点站计划（setViewLevel 域主层级，尺度过渡到位） */
function anchorPlan(scope: CycleScope): KioskAdvancePlan {
  return { kind: 'anchor', scope, level: SCOPE_HOME_LEVEL[scope] };
}

/** 域起点站计划（层级已对齐：单一 requestFlyTo 域默认天体） */
function enterPlan(scope: CycleScope): KioskAdvancePlan {
  return { kind: 'enter', scope, bodyId: SCOPE_DEFAULT_BODY[scope] };
}

/** 未跟随时按层级对齐程度二选一：已在域主层级 → enter；否则先 anchor */
function alignPlan(scope: CycleScope, viewLevel: ViewLevel): KioskAdvancePlan {
  return viewLevel === SCOPE_HOME_LEVEL[scope] ? enterPlan(scope) : anchorPlan(scope);
}

/**
 * 计算下一步推进计划（纯函数；语义与踩坑登记见文件头）
 *
 * @param tour 巡游域配置（launch.tour）
 * @param currentScope store 当前巡游域（用户暂停期间可能被改动）
 * @param viewLevel store 当前离散层级（域尺度对齐判定）
 * @param followBodyId store 当前跟随天体（null = 未跟随）
 */
export function planKioskAdvance(
  tour: LaunchTour,
  currentScope: CycleScope,
  viewLevel: ViewLevel,
  followBodyId: string | null,
): KioskAdvancePlan {
  const scopes: readonly CycleScope[] = tour === 'all' ? KIOSK_ALL_SCOPES : [tour];
  // 当前域不属本次 tour（启动时/暂停期间用户切走）：先对齐巡游首域
  if (!scopes.includes(currentScope)) return anchorPlan(scopes[0]);
  // 未跟随 / 跟随体不在当前域序列内：按层级对齐程度回到域起点
  if (followBodyId === null) return alignPlan(currentScope, viewLevel);
  const seq = sequenceForScope(currentScope, followBodyId);
  const idx = seq.indexOf(followBodyId);
  if (idx === -1) return alignPlan(currentScope, viewLevel);
  // tour=all 域末（当前为序列末站）：先切下一域全景锚点（universe 回绕 system）
  if (tour === 'all' && idx === seq.length - 1) {
    const at = KIOSK_ALL_SCOPES.indexOf(currentScope);
    return anchorPlan(KIOSK_ALL_SCOPES[(at + 1) % KIOSK_ALL_SCOPES.length]);
  }
  return { kind: 'next' };
}
