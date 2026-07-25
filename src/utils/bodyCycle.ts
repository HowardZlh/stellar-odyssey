/**
 * 行星视角天体切换序列（P4，需求 §3.2.4；P5 §3.3 扩展至 16 天体；
 * P7 §3.4 纳入人造卫星扩展至 20 天体）
 *
 * 纯逻辑模块（供单元测试）：
 * - 固定循环序列：八大行星（水星→海王星）+ 月球（插于地球之后）+
 *   4 颗人造卫星（P7：插于月球之后——国际空间站 → 天宫 → 哈勃 → 静止轨道卫星）+
 *   5 颗矮行星（按半长轴排序插入：谷神星 2.77 AU 位于火星与木星之间；
 *   冥王星 39.5 / 妊神星 43.1 / 鸟神星 45.8 / 阋神星 67.9 AU 排于海王星后）+
 *   两颗彗星（置于序列末尾，便于观察彗尾角度变化）
 * - 上一颗/下一颗循环切换、序列位置标签（"3/20"）
 * - L1 锚点行为（需求变更）：进入 L1 = 飞往并跟随序列当前天体
 *   （默认地球，会话内记忆上次锚定天体）
 */

import type { ViewLevel } from '@/types';

/** 切换序列（固定循环，需求 §3.2.4 / P5 §3.3 / P7 §3.4：20 天体） */
export const BODY_CYCLE_SEQUENCE: readonly string[] = [
  'mercury',
  'venus',
  'earth',
  'moon',
  'iss',
  'tiangong',
  'hubble',
  'geo-satellite',
  'mars',
  'ceres',
  'jupiter',
  'saturn',
  'uranus',
  'neptune',
  'pluto',
  'haumea',
  'makemake',
  'eris',
  'halley',
  'encke',
];

/** L1 锚点默认天体（需求 §3.2.4：默认地球） */
export const DEFAULT_ANCHOR_BODY_ID = 'earth';

/** 天体是否在切换序列内 */
export function isCycleBody(bodyId: string): boolean {
  return BODY_CYCLE_SEQUENCE.includes(bodyId);
}

/** 序列索引（0 起）；不在序列内返回 -1 */
export function bodyCycleIndex(bodyId: string): number {
  return BODY_CYCLE_SEQUENCE.indexOf(bodyId);
}

/**
 * 循环切换：返回上一颗（direction=-1）/下一颗（+1）天体 id。
 * 当前 id 不在序列内时回落到默认天体（不产生位移，先锚定再切换）。
 */
export function cycleBodyId(currentId: string, direction: 1 | -1): string {
  const idx = bodyCycleIndex(currentId);
  if (idx === -1) return DEFAULT_ANCHOR_BODY_ID;
  const n = BODY_CYCLE_SEQUENCE.length;
  return BODY_CYCLE_SEQUENCE[(idx + direction + n) % n];
}

/**
 * 序列位置标签（HUD 显示，如"11/20"）；不在序列内返回 null
 */
export function bodyCyclePositionLabel(bodyId: string): string | null {
  const idx = bodyCycleIndex(bodyId);
  if (idx === -1) return null;
  return `${idx + 1}/${BODY_CYCLE_SEQUENCE.length}`;
}

/**
 * 切换控件可见性（需求 §3.2.4：控件仅 L1 层级显示）
 *
 * 说明（实现差异登记）：连续层级由"相机-场景原点距离"换算，跟随外行星
 * （如海王星，30 AU ≈ 300 场景单位）时层级读数为 L2 但语义上仍是
 * "行星近观"。因此当正在跟随序列内天体时控件保持可见；
 * 切换到 L2-L4 锚点会按现有逻辑取消跟随，控件随之隐藏。
 */
export function cycleControlVisible(viewLevel: ViewLevel, followBodyId: string | null): boolean {
  if (viewLevel === 'L1') return true;
  return followBodyId !== null && isCycleBody(followBodyId);
}

// ---------------------------------------------------------------------------
// R2-2 §2.2-C 目标行星系统一致判定（近观细节视角域门控）
// ---------------------------------------------------------------------------

/**
 * 当前跟随/锚定焦点天体 id（R2-2）：飞往目标优先（运镜中细节域随目标切换），
 * 其次跟随目标；均为空时 L1 语境回落到锚定天体，L2-L4 无焦点。
 */
export function focusBodyIdForDetail(
  viewLevel: ViewLevel,
  flyToBodyId: string | null,
  followBodyId: string | null,
  anchorBodyId: string,
): string | null {
  if (flyToBodyId) return flyToBodyId;
  if (followBodyId) return followBodyId;
  return viewLevel === 'L1' ? anchorBodyId : null;
}

/**
 * 焦点天体所属行星系统 id（R2-2 §2.2-C）：卫星（自然/人造）归属其行星
 * （focusParentId 非空即取之），行星/矮行星等归属自身；无焦点返回 null。
 *
 * @param focusParentId 焦点天体的所属行星 id（非卫星时传 null，
 *   调用方经 data/moons.getMoonById 解析）
 */
export function focusPlanetSystemId(
  focusBodyId: string | null,
  focusParentId: string | null,
): string | null {
  if (!focusBodyId) return null;
  return focusParentId ?? focusBodyId;
}

/**
 * 人造卫星近观细节域门控（R2-2 §2.2-C）：glTF 精细模型/近观放大仅在
 * "L1 语境（cycleControlVisible 同款判定）且焦点目标与该卫星属于同一
 * 行星系统"时允许激活——跟随地球/月球/该卫星本身 → 地球系统卫星可激活；
 * 跟随火星/木星、L2 及以上视角 → 保持远观小点/盒体形态。
 */
export function satelliteDetailScopeAllowed(
  viewLevel: ViewLevel,
  focusBodyId: string | null,
  focusParentId: string | null,
  satelliteParentId: string,
): boolean {
  const l1Context =
    viewLevel === 'L1' || (focusBodyId !== null && isCycleBody(focusBodyId));
  if (!l1Context) return false;
  return focusPlanetSystemId(focusBodyId, focusParentId) === satelliteParentId;
}

/**
 * 行星 4K/法线近观细节域门控（R2-2 §2.2-C）：焦点目标系统须与该行星一致；
 * 无焦点（L2-L4 自由镜头）时回落距离判据（保持现有行为，防误杀），
 * 有焦点但系统不一致（如运镜路径擦过其他行星）时禁止激活。
 */
export function planetDetailScopeAllowed(
  focusBodyId: string | null,
  focusParentId: string | null,
  planetId: string,
): boolean {
  const systemId = focusPlanetSystemId(focusBodyId, focusParentId);
  if (systemId === null) return true;
  return systemId === planetId;
}
