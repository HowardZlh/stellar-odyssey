/**
 * 通用天体切换序列框架测试（R2-5 §5.1-A / §5.2：域判定/循环/回落/位置标签）
 */

import {
  GALAXY_CYCLE_SEQUENCE,
  SCOPE_DEFAULT_BODY,
  SCOPE_NAME_ZH,
  SCOPE_SEQUENCES,
  UNIVERSE_CYCLE_SEQUENCE,
  cycleBodyIdInScope,
  isScopeCycleBody,
  scopeBodyIndex,
  scopeCyclePositionLabel,
  scopeForViewLevel,
  scopeOfBody,
} from '@/utils/cycleScopes';
import { BODY_CYCLE_SEQUENCE } from '@/utils/bodyCycle';
import { SPECIAL_BODIES, getSpecialBodyById } from '@/data/specialBodies';
import { getGalaxyById } from '@/data/galaxies';
import { getBodyInfoById } from '@/data/catalog';

describe('域序列定义（§5.1-A）', () => {
  it('行星域复用 P4 的 20 天体序列（现状保持，行为不回退）', () => {
    expect(SCOPE_SEQUENCES.planet).toBe(BODY_CYCLE_SEQUENCE);
    expect(SCOPE_SEQUENCES.planet).toHaveLength(20);
  });

  it('L3 银河系域为 15 成员：太阳系出发 → 银心 → 恒星类 → 星云类 → 星团类', () => {
    expect(GALAXY_CYCLE_SEQUENCE).toEqual([
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
    ]);
  });

  it('L4 宇宙域为 8 成员：银河系 → 卫星星系 → 本星系群 → 河外深空', () => {
    expect(UNIVERSE_CYCLE_SEQUENCE).toEqual([
      'milky-way',
      'lmc',
      'smc',
      'sagittarius-dwarf',
      'm31',
      'm33',
      'm87',
      'quasar-3c273',
    ]);
  });

  it('L3 序列的特殊天体成员均存在于 specialBodies 且为银河系内 L3 天体', () => {
    for (const id of GALAXY_CYCLE_SEQUENCE) {
      if (id === 'sun' || id === 'heliopause') continue;
      const body = getSpecialBodyById(id);
      expect(body).toBeDefined();
      expect(body!.level).toBe('L3');
      expect(body!.positionMode).not.toBe('extragalactic');
    }
  });

  it('L4 序列成员均存在于星系数据/河外特殊天体数据', () => {
    for (const id of UNIVERSE_CYCLE_SEQUENCE) {
      if (id === 'milky-way') continue;
      const galaxy = getGalaxyById(id);
      const special = getSpecialBodyById(id);
      expect(galaxy ?? special).toBeDefined();
      if (special) {
        expect(special.positionMode).toBe('extragalactic');
      }
    }
  });

  it('全部序列成员均有信息目录条目（HUD 名称显示依据）', () => {
    for (const scope of ['planet', 'galaxy', 'universe'] as const) {
      for (const id of SCOPE_SEQUENCES[scope]) {
        expect(getBodyInfoById(id)).toBeDefined();
      }
    }
  });

  it('三域序列成员互不重叠（域归属唯一）', () => {
    const all = [
      ...SCOPE_SEQUENCES.planet,
      ...SCOPE_SEQUENCES.galaxy,
      ...SCOPE_SEQUENCES.universe,
    ];
    expect(new Set(all).size).toBe(all.length);
  });

  it('各域默认天体均在本域序列内（L3=sgr-a-star，L4=m31）', () => {
    expect(SCOPE_DEFAULT_BODY.planet).toBe('earth');
    expect(SCOPE_DEFAULT_BODY.galaxy).toBe('sgr-a-star');
    expect(SCOPE_DEFAULT_BODY.universe).toBe('m31');
    for (const scope of ['planet', 'galaxy', 'universe'] as const) {
      expect(isScopeCycleBody(scope, SCOPE_DEFAULT_BODY[scope])).toBe(true);
    }
  });

  it('各域中文名非空（HUD/帮助文案）', () => {
    for (const scope of ['planet', 'galaxy', 'universe'] as const) {
      expect(SCOPE_NAME_ZH[scope].length).toBeGreaterThan(0);
    }
  });
});

describe('scopeOfBody 域归属', () => {
  it('行星域成员归属 planet', () => {
    expect(scopeOfBody('earth')).toBe('planet');
    expect(scopeOfBody('iss')).toBe('planet');
    expect(scopeOfBody('encke')).toBe('planet');
  });

  it('太阳/日球层顶归属 galaxy（L3 巡游的太阳系出发站）', () => {
    expect(scopeOfBody('sun')).toBe('galaxy');
    expect(scopeOfBody('heliopause')).toBe('galaxy');
    expect(scopeOfBody('sgr-a-star')).toBe('galaxy');
    expect(scopeOfBody('m13-cluster')).toBe('galaxy');
  });

  it('星系/类星体归属 universe', () => {
    expect(scopeOfBody('milky-way')).toBe('universe');
    expect(scopeOfBody('m31')).toBe('universe');
    expect(scopeOfBody('quasar-3c273')).toBe('universe');
  });

  it('序列外天体（卫星星系子条目/月卫/超新星事件/未知）返回 null', () => {
    expect(scopeOfBody('m32')).toBeNull();
    expect(scopeOfBody('m110')).toBeNull();
    expect(scopeOfBody('charon')).toBeNull();
    expect(scopeOfBody('sn-1')).toBeNull();
    expect(scopeOfBody('oort-cloud')).toBeNull();
    expect(scopeOfBody('not-a-body')).toBeNull();
  });
});

describe('scopeForViewLevel 域判定（§5.1-A）', () => {
  it('无跟随时按连续层级区间：<2.5 行星域 / <3.5 银河系域 / 其余宇宙域', () => {
    expect(scopeForViewLevel(1, null)).toBe('planet');
    expect(scopeForViewLevel(2.49, null)).toBe('planet');
    expect(scopeForViewLevel(2.5, null)).toBe('galaxy');
    expect(scopeForViewLevel(3.49, null)).toBe('galaxy');
    expect(scopeForViewLevel(3.5, null)).toBe('universe');
    expect(scopeForViewLevel(4, null)).toBe('universe');
  });

  it('跟随域内天体时以天体归属为准（层级读数偏离不影响域语义）', () => {
    // 跟随海王星层级读数为 L2：仍是行星域（现状语义保持）
    expect(scopeForViewLevel(2.2, 'neptune')).toBe('planet');
    // L3 巡游飞抵太阳后层级读数降至 L1：仍是银河系域（遍历一整圈不断链）
    expect(scopeForViewLevel(1.2, 'sun')).toBe('galaxy');
    expect(scopeForViewLevel(2.65, 'heliopause')).toBe('galaxy');
    // 飞抵特殊天体后层级读数为 L2：仍是银河系域
    expect(scopeForViewLevel(2.1, 'betelgeuse')).toBe('galaxy');
    // 飞抵星系后层级读数可能低于 3.5：仍是宇宙域
    expect(scopeForViewLevel(3.2, 'm87')).toBe('universe');
  });

  it('跟随序列外天体（超新星事件等）回落层级区间判定', () => {
    expect(scopeForViewLevel(3, 'sn-1')).toBe('galaxy');
    expect(scopeForViewLevel(4, 'sn-1')).toBe('universe');
    expect(scopeForViewLevel(2, 'charon')).toBe('planet');
  });

  it('非有限层级抛出 RangeError', () => {
    expect(() => scopeForViewLevel(Number.NaN, null)).toThrow(RangeError);
    expect(() => scopeForViewLevel(Number.POSITIVE_INFINITY, null)).toThrow(RangeError);
  });
});

describe('cycleBodyIdInScope 域内循环（§5.1-A）', () => {
  it('L3 域沿序列前进/后退', () => {
    expect(cycleBodyIdInScope('galaxy', 'sun', 1)).toBe('heliopause');
    expect(cycleBodyIdInScope('galaxy', 'heliopause', 1)).toBe('sgr-a-star');
    expect(cycleBodyIdInScope('galaxy', 'crab-pulsar', 1)).toBe('orion-nebula');
    expect(cycleBodyIdInScope('galaxy', 'sgr-a-star', -1)).toBe('heliopause');
  });

  it('L3 域循环边界：末尾 M13 下一个回到太阳，太阳上一个为 M13', () => {
    expect(cycleBodyIdInScope('galaxy', 'm13-cluster', 1)).toBe('sun');
    expect(cycleBodyIdInScope('galaxy', 'sun', -1)).toBe('m13-cluster');
  });

  it('L4 域沿序列前进且循环闭合', () => {
    expect(cycleBodyIdInScope('universe', 'milky-way', 1)).toBe('lmc');
    expect(cycleBodyIdInScope('universe', 'quasar-3c273', 1)).toBe('milky-way');
    expect(cycleBodyIdInScope('universe', 'milky-way', -1)).toBe('quasar-3c273');
  });

  it('遍历一整圈回到起点（L3 15 步 / L4 8 步）', () => {
    let id = 'sun';
    for (let i = 0; i < GALAXY_CYCLE_SEQUENCE.length; i += 1) {
      id = cycleBodyIdInScope('galaxy', id, 1);
    }
    expect(id).toBe('sun');

    id = 'm31';
    for (let i = 0; i < UNIVERSE_CYCLE_SEQUENCE.length; i += 1) {
      id = cycleBodyIdInScope('universe', id, -1);
    }
    expect(id).toBe('m31');
  });

  it('序列外 id 回落域默认天体（L3=sgr-a-star / L4=m31 / 行星域=earth）', () => {
    expect(cycleBodyIdInScope('galaxy', 'earth', 1)).toBe('sgr-a-star');
    expect(cycleBodyIdInScope('galaxy', 'unknown', -1)).toBe('sgr-a-star');
    expect(cycleBodyIdInScope('universe', 'sun', 1)).toBe('m31');
    expect(cycleBodyIdInScope('planet', 'sgr-a-star', 1)).toBe('earth');
  });

  it('行星域与现有 cycleBodyId 行为一致（不回退）', () => {
    expect(cycleBodyIdInScope('planet', 'mercury', 1)).toBe('venus');
    expect(cycleBodyIdInScope('planet', 'encke', 1)).toBe('mercury');
    expect(cycleBodyIdInScope('planet', 'mercury', -1)).toBe('encke');
  });
});

describe('scopeCyclePositionLabel 序列位置标签（HUD）', () => {
  it('L3 域位置标签', () => {
    expect(scopeCyclePositionLabel('galaxy', 'sun')).toBe('1/15');
    expect(scopeCyclePositionLabel('galaxy', 'sgr-a-star')).toBe('3/15');
    expect(scopeCyclePositionLabel('galaxy', 'm13-cluster')).toBe('15/15');
  });

  it('L4 域位置标签', () => {
    expect(scopeCyclePositionLabel('universe', 'milky-way')).toBe('1/8');
    expect(scopeCyclePositionLabel('universe', 'm31')).toBe('5/8');
    expect(scopeCyclePositionLabel('universe', 'quasar-3c273')).toBe('8/8');
  });

  it('行星域标签与现有一致（地球 3/20）', () => {
    expect(scopeCyclePositionLabel('planet', 'earth')).toBe('3/20');
  });

  it('不在该域序列内返回 null', () => {
    expect(scopeCyclePositionLabel('galaxy', 'earth')).toBeNull();
    expect(scopeCyclePositionLabel('universe', 'sgr-a-star')).toBeNull();
    expect(scopeBodyIndex('galaxy', 'earth')).toBe(-1);
  });

  it('SPECIAL_BODIES 中全部 L3 银河系内天体均已纳入 L3 序列（无遗漏）', () => {
    const l3Ids = SPECIAL_BODIES.filter(
      (b) => b.level === 'L3' && b.positionMode !== 'extragalactic',
    ).map((b) => b.id);
    for (const id of l3Ids) {
      expect(isScopeCycleBody('galaxy', id)).toBe(true);
    }
  });
});
