/**
 * 通用天体切换序列框架（R2-5，IMPROVEMENT_REQUIREMENTS_2 §R2-5；
 * R3 视角域切换重构：行星域拆分为 行星系统（L1）/ 太阳系（L2）两个子域，
 * 并引入"巡游期间视角层级锁定"语义）
 *
 * 纯逻辑模块（供单元测试）：为四个视角域建立各自的"上一个/下一个"
 * 巡游序列，并提供 域-层级映射 / 域内循环 / 序列外回落 / 位置标签 /
 * 飞往目标的域归类。
 *
 * ── 四个视角域（R3）─────────────────────────────────────────────────────
 * system   行星视角（L1）：当前行星系统内循环（行星本体 + 其自然/人造卫星，
 *          bodyCycle.planetSystemSequence 动态序列；无卫星时 UI 隐藏切换按钮）
 * solar    太阳系视角（L2）：行星 + 矮行星 + 彗星（15 天体，按半长轴升序，
 *          bodyCycle.SOLAR_CYCLE_SEQUENCE；不含卫星）
 * galaxy   银河系视角（L3）：14 站巡游序列（成员登记见下）
 * universe 宇宙视角（L4）：8 站巡游序列（成员登记见下）
 *
 * ── 视角层级锁定（R3 需求 2）───────────────────────────────────────────
 * 跟随/飞往巡游天体期间，离散层级 viewLevel 锁定为所属域的主层级
 * （system=L1 / solar=L2 / galaxy=L3 / universe=L4），不再随
 * 相机-场景原点距离自动漂移（如跟随阋神星 67.9 AU 时层级读数跳 L3、
 * 跟随猎户座星云时读数跌回 L2 的问题）；用户按 1-4/层级按钮显式切换
 * 或 Esc 取消跟随后恢复距离驱动。连续层级 continuousLevel 仍按相机
 * 距离同步（LOD/音景/时间压缩等平滑行为不变）。
 *
 * ── L3 银河系域（14 成员，按"太阳系出发 → 银心 → 恒星类 → 星云类 → 星团类"组织）──
 *   1. heliopause        日球层顶（R2-1 交付的可飞往外边界，太阳系出发/告别站；
 *                        用户反馈：原序列首站 sun 与其语境重复，太阳仅保留
 *                        日球层顶一站，sun 不再入列——仍可经点选/飞往访问）
 *   2. sgr-a-star        银心人马座 A*（超大质量黑洞）
 *   3. betelgeuse        参宿四（红超巨星）
 *   4. rigel             参宿七（蓝超巨星）
 *   5. sirius            天狼星 A/B（双星：主序星 + 白矮星）
 *   6. delta-cephei      造父一（造父变星原型）
 *   7. wr-124            沃尔夫-拉叶星 WR 124
 *   8. cygnus-x1         天鹅座 X-1（黑洞 X 射线双星）
 *   9. crab-pulsar       蟹状星云脉冲星（恒星类 → 星云类的过渡：脉冲星居星云中心）
 *  10. orion-nebula      猎户座星云（发射星云）
 *  11. ring-nebula       环状星云 M57（行星状星云）
 *  12. horsehead-nebula  马头星云（暗星云）
 *  13. pleiades          昴星团（疏散星团）
 *  14. m13-cluster       武仙座 M13（球状星团）
 *
 * ── L4 宇宙域（8 成员，按"银河系 → 卫星星系 → 本星系群 → 河外深空"组织）──
 *   1. milky-way         银河系
 *   2. lmc               大麦哲伦云
 *   3. smc               小麦哲伦云
 *   4. sagittarius-dwarf 人马座矮星系
 *   5. m31               仙女座星系 M31
 *   6. m33               三角座星系 M33
 *   7. m87               室女座 A（M87）
 *   8. quasar-3c273      类星体 3C 273
 *
 * ── 实现差异登记 ─────────────────────────────────────────────────────────
 * - 需求中 M32/M110 为"可选子条目"，未纳入 L4 主序列（保持巡游节奏，
 *   两者仍可经点选/飞往访问，飞往时归入 universe 域并锁定 L4）。
 * - 当前生效域改为显式状态（store.cycleScope），不再按"跟随天体归属 +
 *   连续层级区间"推断——太阳系巡游中跟随行星（近观距离对应 L1 读数）
 *   仍保持 solar 域，序列不混入卫星；银河系/宇宙巡游同理保持各自域。
 * - 太阳的域归类特殊：虽已不在 L3 序列内（出发站语境由 heliopause 承担），
 *   仍可经点选/耀斑通知飞往，飞往太阳保持当前域（银河系巡游中 → galaxy；
 *   行星/太阳系语境 → 保持原域；宇宙域回落 galaxy）。
 */

import type { ViewLevel } from '@/types';
import {
  DEFAULT_ANCHOR_BODY_ID,
  SOLAR_CYCLE_SEQUENCE,
  planetSystemIdForBody,
  planetSystemSequence,
} from '@/utils/bodyCycle';
import { getMoonById } from '@/data/moons';
import { getGalaxyById, MILKY_WAY } from '@/data/galaxies';
import { getSpecialBodyById } from '@/data/specialBodies';

/** 视角域 id：行星系统（L1）/ 太阳系（L2）/ 银河系（L3）/ 宇宙（L4） */
export type CycleScope = 'system' | 'solar' | 'galaxy' | 'universe';

/** L3 银河系域巡游序列（成员登记见文件头） */
export const GALAXY_CYCLE_SEQUENCE: readonly string[] = [
  'heliopause',
  'sgr-a-star',
  'betelgeuse',
  'rigel',
  'sirius',
  'delta-cephei',
  'wr-124',
  'cygnus-x1',
  'crab-pulsar',
  'orion-nebula',
  'ring-nebula',
  'horsehead-nebula',
  'pleiades',
  'm13-cluster',
];

/** L4 宇宙域巡游序列（成员登记见文件头） */
export const UNIVERSE_CYCLE_SEQUENCE: readonly string[] = [
  'milky-way',
  'lmc',
  'smc',
  'sagittarius-dwarf',
  'm31',
  'm33',
  'm87',
  'quasar-3c273',
];

/** 各域主层级（R3 需求 2：巡游期间离散层级锁定为所属域主层级） */
export const SCOPE_HOME_LEVEL: Readonly<Record<CycleScope, ViewLevel>> = {
  system: 'L1',
  solar: 'L2',
  galaxy: 'L3',
  universe: 'L4',
};

/** 离散层级 → 视角域（锚点切换/自由缩放跨级时同步当前域） */
export function scopeForLevel(level: ViewLevel): CycleScope {
  switch (level) {
    case 'L1':
      return 'system';
    case 'L2':
      return 'solar';
    case 'L3':
      return 'galaxy';
    default:
      return 'universe';
  }
}

/**
 * 各域回落默认天体（当前 id 不在序列内时回落；
 * 行星域沿用 DEFAULT_ANCHOR_BODY_ID=earth，L3 默认人马座 A*，L4 默认 M31）
 */
export const SCOPE_DEFAULT_BODY: Readonly<Record<CycleScope, string>> = {
  system: DEFAULT_ANCHOR_BODY_ID,
  solar: DEFAULT_ANCHOR_BODY_ID,
  galaxy: 'sgr-a-star',
  universe: 'm31',
};

/** 各域中文名（HUD/帮助文案用） */
export const SCOPE_NAME_ZH: Readonly<Record<CycleScope, string>> = {
  system: '行星巡游',
  solar: '太阳系巡游',
  galaxy: '银河系巡游',
  universe: '宇宙巡游',
};

/**
 * 域内序列（system 域为当前天体所在行星系统的动态序列，
 * 其余域为固定序列）
 */
export function sequenceForScope(scope: CycleScope, currentBodyId: string): readonly string[] {
  switch (scope) {
    case 'system':
      return planetSystemSequence(planetSystemIdForBody(currentBodyId));
    case 'solar':
      return SOLAR_CYCLE_SEQUENCE;
    case 'galaxy':
      return GALAXY_CYCLE_SEQUENCE;
    default:
      return UNIVERSE_CYCLE_SEQUENCE;
  }
}

/** 天体是否属于指定域序列（system 域按其所在行星系统序列判定） */
export function isScopeCycleBody(scope: CycleScope, bodyId: string): boolean {
  return sequenceForScope(scope, bodyId).includes(bodyId);
}

/**
 * 域内循环切换：返回上一个（direction=-1）/下一个（+1）天体 id。
 * - solar 域：当前为卫星时先映射到其所属行星再循环（如锚定 ISS 时
 *   按太阳系序列从地球继续）；
 * - 当前 id 不在该域序列内时回落到域默认天体（不产生位移，先锚定再切换）；
 * - system 域单成员系统（无卫星行星）原地不动（UI 已隐藏切换按钮）。
 */
export function cycleBodyIdInScope(
  scope: CycleScope,
  currentId: string,
  direction: 1 | -1,
): string {
  const mapped = scope === 'solar' ? planetSystemIdForBody(currentId) : currentId;
  const seq = sequenceForScope(scope, mapped);
  const idx = seq.indexOf(mapped);
  if (idx === -1) return SCOPE_DEFAULT_BODY[scope];
  return seq[(idx + direction + seq.length) % seq.length];
}

/**
 * 域内序列位置标签（HUD 显示，如"3/15"）；不在该域序列内、
 * 或序列不足 2 个成员（无卫星行星的 system 域，UI 隐藏切换按钮）返回 null
 */
export function scopeCyclePositionLabel(scope: CycleScope, bodyId: string): string | null {
  const seq = sequenceForScope(scope, bodyId);
  const idx = seq.indexOf(bodyId);
  if (idx === -1 || seq.length < 2) return null;
  return `${idx + 1}/${seq.length}`;
}

/**
 * 飞往目标的域归类（R3：requestFlyTo 据此切换当前域并锁定对应层级）：
 * - 超新星事件（sn-*）→ galaxy（事件位于银河系尺度坐标）
 * - 卫星（自然/人造）→ system（显示行星系统语境）
 * - 行星/矮行星/彗星 → 太阳系巡游中保持 solar，否则 system
 *   （R3 需求 2：显示行星时固定在行星视角）
 * - 太阳 → 保持当前域（宇宙域例外回落 galaxy，太阳在 L4 无近观语义）
 * - L3 序列成员 / 旅行者标记 → galaxy
 * - L4 序列成员 / 星系（含 M32/M110 等序列外星系）→ universe
 * - 其余特殊天体按其数据层级归域；未知 id 保持当前域
 */
export function scopeForFocusBody(bodyId: string, currentScope: CycleScope): CycleScope {
  if (bodyId.startsWith('sn-')) return 'galaxy';
  if (getMoonById(bodyId)) return 'system';
  if (SOLAR_CYCLE_SEQUENCE.includes(bodyId)) {
    return currentScope === 'solar' ? 'solar' : 'system';
  }
  if (bodyId === 'sun') {
    return currentScope === 'universe' ? 'galaxy' : currentScope;
  }
  if (
    GALAXY_CYCLE_SEQUENCE.includes(bodyId) ||
    bodyId === 'voyager-1' ||
    bodyId === 'voyager-2'
  ) {
    return 'galaxy';
  }
  if (
    UNIVERSE_CYCLE_SEQUENCE.includes(bodyId) ||
    bodyId === MILKY_WAY.id ||
    getGalaxyById(bodyId) !== undefined
  ) {
    return 'universe';
  }
  const special = getSpecialBodyById(bodyId);
  if (special) return special.level === 'L4' ? 'universe' : 'galaxy';
  return currentScope;
}
