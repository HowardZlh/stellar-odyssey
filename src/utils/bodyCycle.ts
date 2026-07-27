/**
 * 行星域天体切换序列（P4，需求 §3.2.4；R3 视角域切换重构）
 *
 * 纯逻辑模块（供单元测试）：
 * - 太阳系视角（L2）序列 SOLAR_CYCLE_SEQUENCE：八大行星 + 5 颗矮行星 +
 *   2 颗彗星，统一按轨道半长轴升序排列（不含卫星/人造卫星——
 *   R3 需求：太阳系视角的上一个/下一个只在行星、矮行星、彗星之间切换）。
 * - 行星视角（L1）序列 planetSystemSequence：当前行星系统内循环——
 *   行星本体 + 其自然卫星与人造卫星（按绕行半长轴升序；
 *   R3 需求：行星视角的上一个/下一个只切换当前行星内相关天体）。
 *   无卫星的行星系统序列仅含自身（UI 隐藏切换按钮）。
 * - L1 锚点行为（需求变更）：进入 L1 = 飞往并跟随锚定天体
 *   （默认地球，会话内记忆上次锚定天体）
 */

import type { ViewLevel } from '@/types';
import { PLANETS } from '@/data/planets';
import { COMETS, DWARF_PLANETS } from '@/data/smallBodies';
import { getMoonById, getMoonsByParent } from '@/data/moons';

/**
 * 太阳系视角（L2）切换序列：行星 + 矮行星 + 彗星，按半长轴升序混排
 * （由真实轨道数据计算，恩克彗星 2.22 AU 位于火星与谷神星之间、
 * 哈雷彗星 17.8 AU 位于土星与天王星之间）
 */
export const SOLAR_CYCLE_SEQUENCE: readonly string[] = [
  ...PLANETS,
  ...DWARF_PLANETS,
  ...COMETS,
]
  .slice()
  .sort((a, b) => a.orbit.semiMajorAxisAu - b.orbit.semiMajorAxisAu)
  .map((body) => body.id);

/** L1 锚点默认天体（需求 §3.2.4：默认地球） */
export const DEFAULT_ANCHOR_BODY_ID = 'earth';

/**
 * 天体是否属于行星域（可作为 L1 锚定天体）：
 * 行星/矮行星/彗星（太阳系序列成员）或任意卫星（自然/人造）
 */
export function isCycleBody(bodyId: string): boolean {
  return SOLAR_CYCLE_SEQUENCE.includes(bodyId) || getMoonById(bodyId) !== undefined;
}

/**
 * 天体所属行星系统 id：卫星（自然/人造）归属其行星，其余归属自身
 */
export function planetSystemIdForBody(bodyId: string): string {
  return getMoonById(bodyId)?.parentId ?? bodyId;
}

/**
 * 行星视角（L1）系统内切换序列：行星本体 + 其卫星（自然/人造，
 * 按绕行半长轴升序）。systemId 不是太阳系序列成员（行星/矮行星/彗星）
 * 时返回空序列（如太阳/星系等无行星系统语义的天体）。
 */
export function planetSystemSequence(systemId: string): readonly string[] {
  if (!SOLAR_CYCLE_SEQUENCE.includes(systemId)) return [];
  const companions = getMoonsByParent(systemId)
    .slice()
    .sort((a, b) => a.orbit.semiMajorAxisKm - b.orbit.semiMajorAxisKm)
    .map((m) => m.id);
  return [systemId, ...companions];
}

/**
 * 切换控件可见性（需求 §3.2.4）：L1 层级或正在跟随行星域天体时可见
 *
 * 说明（R3 语义变更登记）：跟随行星域天体期间离散层级已锁定为进入
 * 巡游时的层级（不再随相机-原点距离漂移），本判定保留跟随分支作为防御。
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
