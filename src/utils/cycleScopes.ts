/**
 * 通用天体切换序列框架（R2-5，IMPROVEMENT_REQUIREMENTS_2 §R2-5，用户反馈点 5 + 点 1 后半）
 *
 * 纯逻辑模块（供单元测试）：在 P4 行星序列（utils/bodyCycle.ts，20 天体）
 * 基础上，为 L3（银河系）与 L4（宇宙）视角建立各自的"上一个/下一个"
 * 巡游序列，并提供视角域判定 / 域内循环 / 序列外回落 / 位置标签。
 *
 * ── 序列成员登记（§5.1-A，成员 id 以 data 文件实际定义为准）────────────
 * L1/L2 行星域：复用 BODY_CYCLE_SEQUENCE（20 天体，现状保持，行为不回退）。
 *
 * L3 银河系域（15 成员，按"太阳系出发 → 银心 → 恒星类 → 星云类 → 星团类"组织）：
 *   1. sun               太阳（太阳系出发标记，与 "You are here" 联动语境）
 *   2. heliopause        日球层顶（R2-1 交付的可飞往外边界，太阳系告别站）
 *   3. sgr-a-star        银心人马座 A*（超大质量黑洞）
 *   4. betelgeuse        参宿四（红超巨星）
 *   5. rigel             参宿七（蓝超巨星）
 *   6. sirius            天狼星 A/B（双星：主序星 + 白矮星）
 *   7. delta-cephei      造父一（造父变星原型）
 *   8. wr-124            沃尔夫-拉叶星 WR 124
 *   9. cygnus-x1         天鹅座 X-1（黑洞 X 射线双星）
 *  10. crab-pulsar       蟹状星云脉冲星（恒星类 → 星云类的过渡：脉冲星居星云中心）
 *  11. orion-nebula      猎户座星云（发射星云）
 *  12. ring-nebula       环状星云 M57（行星状星云）
 *  13. horsehead-nebula  马头星云（暗星云）
 *  14. pleiades          昴星团（疏散星团）
 *  15. m13-cluster       武仙座 M13（球状星团）
 *
 * L4 宇宙域（8 成员，按"银河系 → 卫星星系 → 本星系群 → 河外深空"组织）：
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
 *   两者仍可经点选/飞往访问）；触须星系/透镜弧/GRB 亦未纳入（需求未列）。
 * - 域判定以"跟随天体的序列归属"优先（与 cycleControlVisible 的语义补充
 *   一致：跟随海王星时层级读数为 L2 但语义仍是行星域；跟随太阳/日球层顶
 *   时近观层级读数会降至 L1/L2，但语义上属 L3 巡游），无跟随时按连续
 *   层级区间划分（<2.5 行星域 / <3.5 银河系域 / 其余宇宙域）。
 */

import { BODY_CYCLE_SEQUENCE, DEFAULT_ANCHOR_BODY_ID } from '@/utils/bodyCycle';

/** 视角域 id：行星（L1/L2）/ 银河系（L3）/ 宇宙（L4） */
export type CycleScope = 'planet' | 'galaxy' | 'universe';

/** L3 银河系域巡游序列（成员登记见文件头） */
export const GALAXY_CYCLE_SEQUENCE: readonly string[] = [
  'sun',
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

/** 各域序列（行星域复用 P4 序列，现状保持） */
export const SCOPE_SEQUENCES: Readonly<Record<CycleScope, readonly string[]>> = {
  planet: BODY_CYCLE_SEQUENCE,
  galaxy: GALAXY_CYCLE_SEQUENCE,
  universe: UNIVERSE_CYCLE_SEQUENCE,
};

/**
 * 各域回落默认天体（§5.1-A：当前 id 不在序列内时回落；
 * 行星域沿用 DEFAULT_ANCHOR_BODY_ID=earth，L3 默认人马座 A*，L4 默认 M31）
 */
export const SCOPE_DEFAULT_BODY: Readonly<Record<CycleScope, string>> = {
  planet: DEFAULT_ANCHOR_BODY_ID,
  galaxy: 'sgr-a-star',
  universe: 'm31',
};

/** 各域中文名（HUD/帮助文案用） */
export const SCOPE_NAME_ZH: Readonly<Record<CycleScope, string>> = {
  planet: '行星巡游',
  galaxy: '银河系巡游',
  universe: '宇宙巡游',
};

/** 天体在指定域序列内的索引（0 起）；不在序列内返回 -1 */
export function scopeBodyIndex(scope: CycleScope, bodyId: string): number {
  return SCOPE_SEQUENCES[scope].indexOf(bodyId);
}

/** 天体是否属于指定域序列 */
export function isScopeCycleBody(scope: CycleScope, bodyId: string): boolean {
  return scopeBodyIndex(scope, bodyId) !== -1;
}

/**
 * 天体所属的域（按 行星 → 银河系 → 宇宙 优先级；三域序列成员互不重叠，
 * 优先级仅为防御）；不属于任何域序列返回 null
 */
export function scopeOfBody(bodyId: string): CycleScope | null {
  if (isScopeCycleBody('planet', bodyId)) return 'planet';
  if (isScopeCycleBody('galaxy', bodyId)) return 'galaxy';
  if (isScopeCycleBody('universe', bodyId)) return 'universe';
  return null;
}

/**
 * 当前生效的视角域（§5.1-A 接口）：
 * 1) 正在跟随域序列内天体时以该天体归属为准（跟随期间相机贴近目标，
 *    连续层级读数会偏离锚点，语义补充与 cycleControlVisible 一致）；
 * 2) 无跟随（或跟随序列外天体，如卫星/超新星事件）时按连续层级区间：
 *    <2.5 行星域（L1/L2）/ <3.5 银河系域（L3）/ 其余宇宙域（L4）。
 */
export function scopeForViewLevel(
  continuousLevel: number,
  followBodyId: string | null,
): CycleScope {
  if (!Number.isFinite(continuousLevel)) {
    throw new RangeError(`连续层级必须为有限数，收到 ${continuousLevel}`);
  }
  if (followBodyId !== null) {
    const scope = scopeOfBody(followBodyId);
    if (scope !== null) return scope;
  }
  if (continuousLevel < 2.5) return 'planet';
  if (continuousLevel < 3.5) return 'galaxy';
  return 'universe';
}

/**
 * 域内循环切换（§5.1-A 接口，与 cycleBodyId 同构）：返回上一个
 * （direction=-1）/下一个（+1）天体 id；当前 id 不在该域序列内时
 * 回落到域默认天体（不产生位移，先锚定再切换）。
 */
export function cycleBodyIdInScope(
  scope: CycleScope,
  currentId: string,
  direction: 1 | -1,
): string {
  const seq = SCOPE_SEQUENCES[scope];
  const idx = seq.indexOf(currentId);
  if (idx === -1) return SCOPE_DEFAULT_BODY[scope];
  return seq[(idx + direction + seq.length) % seq.length];
}

/**
 * 域内序列位置标签（HUD 显示，如"3/15"）；不在该域序列内返回 null
 */
export function scopeCyclePositionLabel(scope: CycleScope, bodyId: string): string | null {
  const idx = scopeBodyIndex(scope, bodyId);
  if (idx === -1) return null;
  return `${idx + 1}/${SCOPE_SEQUENCES[scope].length}`;
}
