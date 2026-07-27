/**
 * 通用天体切换序列框架测试（R2-5 §5.1-A / §5.2；R3 四域重构：
 * 行星系统（L1）/太阳系（L2）/银河系（L3）/宇宙（L4）+ 域-层级映射 +
 * 飞往目标域归类）
 */

import {
  GALAXY_CYCLE_SEQUENCE,
  SCOPE_DEFAULT_BODY,
  SCOPE_HOME_LEVEL,
  SCOPE_NAME_ZH,
  UNIVERSE_CYCLE_SEQUENCE,
  cycleBodyIdInScope,
  isScopeCycleBody,
  scopeCyclePositionLabel,
  scopeForFocusBody,
  scopeForLevel,
  sequenceForScope,
} from '@/utils/cycleScopes';
import { SOLAR_CYCLE_SEQUENCE, planetSystemSequence } from '@/utils/bodyCycle';
import { SPECIAL_BODIES, getSpecialBodyById } from '@/data/specialBodies';
import { getGalaxyById } from '@/data/galaxies';
import { getBodyInfoById } from '@/data/catalog';

const ALL_SCOPES = ['system', 'solar', 'galaxy', 'universe'] as const;

describe('域序列定义（§5.1-A / R3）', () => {
  it('solar 域为太阳系序列（15 天体：行星+矮行星+彗星，R3 需求 1）', () => {
    expect(sequenceForScope('solar', 'earth')).toBe(SOLAR_CYCLE_SEQUENCE);
    expect(sequenceForScope('solar', 'earth')).toHaveLength(15);
  });

  it('system 域为当前天体所在行星系统的动态序列（R3 需求 1）', () => {
    expect(sequenceForScope('system', 'earth')).toEqual(planetSystemSequence('earth'));
    // 卫星归属其行星系统（跟随月球时序列仍为地球系统）
    expect(sequenceForScope('system', 'moon')).toEqual(planetSystemSequence('earth'));
    expect(sequenceForScope('system', 'io')).toEqual(planetSystemSequence('jupiter'));
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
    const ids = [
      ...SOLAR_CYCLE_SEQUENCE.flatMap((id) => planetSystemSequence(id)),
      ...GALAXY_CYCLE_SEQUENCE,
      ...UNIVERSE_CYCLE_SEQUENCE,
    ];
    for (const id of ids) {
      expect(getBodyInfoById(id)).toBeDefined();
    }
  });

  it('太阳系/银河系/宇宙序列成员互不重叠（域归属唯一）', () => {
    const all = [...SOLAR_CYCLE_SEQUENCE, ...GALAXY_CYCLE_SEQUENCE, ...UNIVERSE_CYCLE_SEQUENCE];
    expect(new Set(all).size).toBe(all.length);
  });

  it('各域默认天体均在本域序列内', () => {
    expect(SCOPE_DEFAULT_BODY.system).toBe('earth');
    expect(SCOPE_DEFAULT_BODY.solar).toBe('earth');
    expect(SCOPE_DEFAULT_BODY.galaxy).toBe('sgr-a-star');
    expect(SCOPE_DEFAULT_BODY.universe).toBe('m31');
    for (const scope of ALL_SCOPES) {
      expect(isScopeCycleBody(scope, SCOPE_DEFAULT_BODY[scope])).toBe(true);
    }
  });

  it('各域中文名非空（HUD/帮助文案）', () => {
    for (const scope of ALL_SCOPES) {
      expect(SCOPE_NAME_ZH[scope].length).toBeGreaterThan(0);
    }
  });
});

describe('域-层级映射（R3 需求 2 层级锁定依据）', () => {
  it('四域主层级：system=L1 / solar=L2 / galaxy=L3 / universe=L4', () => {
    expect(SCOPE_HOME_LEVEL).toEqual({
      system: 'L1',
      solar: 'L2',
      galaxy: 'L3',
      universe: 'L4',
    });
  });

  it('scopeForLevel 与 SCOPE_HOME_LEVEL 互逆', () => {
    for (const scope of ALL_SCOPES) {
      expect(scopeForLevel(SCOPE_HOME_LEVEL[scope])).toBe(scope);
    }
  });
});

describe('isScopeCycleBody 域成员判定', () => {
  it('system 域按所在行星系统判定（卫星与其行星同系统）', () => {
    expect(isScopeCycleBody('system', 'earth')).toBe(true);
    expect(isScopeCycleBody('system', 'moon')).toBe(true);
    expect(isScopeCycleBody('system', 'io')).toBe(true);
    expect(isScopeCycleBody('system', 'sun')).toBe(false);
    expect(isScopeCycleBody('system', 'sgr-a-star')).toBe(false);
  });

  it('solar 域仅行星/矮行星/彗星（不含卫星，R3 需求 1）', () => {
    expect(isScopeCycleBody('solar', 'earth')).toBe(true);
    expect(isScopeCycleBody('solar', 'eris')).toBe(true);
    expect(isScopeCycleBody('solar', 'halley')).toBe(true);
    expect(isScopeCycleBody('solar', 'moon')).toBe(false);
    expect(isScopeCycleBody('solar', 'iss')).toBe(false);
    expect(isScopeCycleBody('solar', 'sun')).toBe(false);
  });
});

describe('cycleBodyIdInScope 域内循环（§5.1-A / R3）', () => {
  it('system 域沿行星系统序列循环（地球系统 6 站，R3 需求 1）', () => {
    expect(cycleBodyIdInScope('system', 'earth', 1)).toBe('tiangong');
    expect(cycleBodyIdInScope('system', 'tiangong', 1)).toBe('iss');
    expect(cycleBodyIdInScope('system', 'moon', 1)).toBe('earth');
    expect(cycleBodyIdInScope('system', 'earth', -1)).toBe('moon');
  });

  it('system 域不跨行星系统（木星系统内循环回到木星）', () => {
    expect(cycleBodyIdInScope('system', 'callisto', 1)).toBe('jupiter');
    expect(cycleBodyIdInScope('system', 'jupiter', -1)).toBe('callisto');
  });

  it('system 域单成员系统（无卫星行星）原地不动', () => {
    expect(cycleBodyIdInScope('system', 'mercury', 1)).toBe('mercury');
    expect(cycleBodyIdInScope('system', 'eris', -1)).toBe('eris');
  });

  it('solar 域沿太阳系序列循环（不出现卫星，R3 需求 1）', () => {
    expect(cycleBodyIdInScope('solar', 'mercury', 1)).toBe('venus');
    expect(cycleBodyIdInScope('solar', 'earth', 1)).toBe('mars');
    expect(cycleBodyIdInScope('solar', 'neptune', 1)).toBe('pluto');
    expect(cycleBodyIdInScope('solar', 'eris', 1)).toBe('mercury');
    expect(cycleBodyIdInScope('solar', 'mercury', -1)).toBe('eris');
  });

  it('solar 域当前为卫星时映射到其所属行星再循环', () => {
    expect(cycleBodyIdInScope('solar', 'moon', 1)).toBe('mars');
    expect(cycleBodyIdInScope('solar', 'iss', -1)).toBe('venus');
    expect(cycleBodyIdInScope('solar', 'io', 1)).toBe('saturn');
  });

  it('L3 域沿序列前进/后退且循环闭合', () => {
    expect(cycleBodyIdInScope('galaxy', 'sun', 1)).toBe('heliopause');
    expect(cycleBodyIdInScope('galaxy', 'heliopause', 1)).toBe('sgr-a-star');
    expect(cycleBodyIdInScope('galaxy', 'm13-cluster', 1)).toBe('sun');
    expect(cycleBodyIdInScope('galaxy', 'sun', -1)).toBe('m13-cluster');
  });

  it('L4 域沿序列前进且循环闭合', () => {
    expect(cycleBodyIdInScope('universe', 'milky-way', 1)).toBe('lmc');
    expect(cycleBodyIdInScope('universe', 'quasar-3c273', 1)).toBe('milky-way');
    expect(cycleBodyIdInScope('universe', 'milky-way', -1)).toBe('quasar-3c273');
  });

  it('遍历一整圈回到起点（solar 15 步 / L3 15 步 / L4 8 步 / 地球系统 6 步）', () => {
    let id = 'earth';
    for (let i = 0; i < SOLAR_CYCLE_SEQUENCE.length; i += 1) {
      id = cycleBodyIdInScope('solar', id, 1);
    }
    expect(id).toBe('earth');

    id = 'sun';
    for (let i = 0; i < GALAXY_CYCLE_SEQUENCE.length; i += 1) {
      id = cycleBodyIdInScope('galaxy', id, 1);
    }
    expect(id).toBe('sun');

    id = 'm31';
    for (let i = 0; i < UNIVERSE_CYCLE_SEQUENCE.length; i += 1) {
      id = cycleBodyIdInScope('universe', id, -1);
    }
    expect(id).toBe('m31');

    id = 'earth';
    for (let i = 0; i < planetSystemSequence('earth').length; i += 1) {
      id = cycleBodyIdInScope('system', id, 1);
    }
    expect(id).toBe('earth');
  });

  it('序列外 id 回落域默认天体', () => {
    expect(cycleBodyIdInScope('galaxy', 'earth', 1)).toBe('sgr-a-star');
    expect(cycleBodyIdInScope('galaxy', 'unknown', -1)).toBe('sgr-a-star');
    expect(cycleBodyIdInScope('universe', 'sun', 1)).toBe('m31');
    expect(cycleBodyIdInScope('system', 'sgr-a-star', 1)).toBe('earth');
    expect(cycleBodyIdInScope('solar', 'sun', 1)).toBe('earth');
  });
});

describe('scopeCyclePositionLabel 序列位置标签（HUD）', () => {
  it('system 域位置标签（地球系统 6 站）', () => {
    expect(scopeCyclePositionLabel('system', 'earth')).toBe('1/6');
    expect(scopeCyclePositionLabel('system', 'moon')).toBe('6/6');
    expect(scopeCyclePositionLabel('system', 'io')).toBe('2/5');
  });

  it('system 域单成员系统返回 null（R3 需求 1：UI 隐藏切换按钮）', () => {
    expect(scopeCyclePositionLabel('system', 'mercury')).toBeNull();
    expect(scopeCyclePositionLabel('system', 'venus')).toBeNull();
    expect(scopeCyclePositionLabel('system', 'eris')).toBeNull();
  });

  it('solar 域位置标签（15 天体）', () => {
    expect(scopeCyclePositionLabel('solar', 'mercury')).toBe('1/15');
    expect(scopeCyclePositionLabel('solar', 'earth')).toBe('3/15');
    expect(scopeCyclePositionLabel('solar', 'eris')).toBe('15/15');
  });

  it('L3/L4 域位置标签', () => {
    expect(scopeCyclePositionLabel('galaxy', 'sun')).toBe('1/15');
    expect(scopeCyclePositionLabel('galaxy', 'm13-cluster')).toBe('15/15');
    expect(scopeCyclePositionLabel('universe', 'milky-way')).toBe('1/8');
    expect(scopeCyclePositionLabel('universe', 'quasar-3c273')).toBe('8/8');
  });

  it('不在该域序列内返回 null（solar 域卫星亦为 null）', () => {
    expect(scopeCyclePositionLabel('galaxy', 'earth')).toBeNull();
    expect(scopeCyclePositionLabel('universe', 'sgr-a-star')).toBeNull();
    expect(scopeCyclePositionLabel('solar', 'moon')).toBeNull();
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

describe('scopeForFocusBody 飞往目标域归类（R3：requestFlyTo 域切换 + 层级锁定依据）', () => {
  it('卫星（自然/人造）→ system（显示行星系统语境）', () => {
    expect(scopeForFocusBody('moon', 'solar')).toBe('system');
    expect(scopeForFocusBody('iss', 'galaxy')).toBe('system');
    expect(scopeForFocusBody('charon', 'universe')).toBe('system');
  });

  it('行星/矮行星/彗星：太阳系巡游中保持 solar，其余语境归 system', () => {
    expect(scopeForFocusBody('mars', 'solar')).toBe('solar');
    expect(scopeForFocusBody('eris', 'solar')).toBe('solar');
    expect(scopeForFocusBody('mars', 'system')).toBe('system');
    expect(scopeForFocusBody('eris', 'galaxy')).toBe('system');
    expect(scopeForFocusBody('halley', 'universe')).toBe('system');
  });

  it('太阳保持当前域（宇宙域例外回落 galaxy）', () => {
    expect(scopeForFocusBody('sun', 'system')).toBe('system');
    expect(scopeForFocusBody('sun', 'solar')).toBe('solar');
    expect(scopeForFocusBody('sun', 'galaxy')).toBe('galaxy');
    expect(scopeForFocusBody('sun', 'universe')).toBe('galaxy');
  });

  it('L3 序列成员/旅行者标记/超新星事件 → galaxy', () => {
    expect(scopeForFocusBody('heliopause', 'solar')).toBe('galaxy');
    expect(scopeForFocusBody('betelgeuse', 'solar')).toBe('galaxy');
    expect(scopeForFocusBody('voyager-1', 'solar')).toBe('galaxy');
    expect(scopeForFocusBody('voyager-2', 'universe')).toBe('galaxy');
    expect(scopeForFocusBody('sn-1', 'solar')).toBe('galaxy');
  });

  it('L4 序列成员/序列外星系（M32/M110）→ universe', () => {
    expect(scopeForFocusBody('milky-way', 'galaxy')).toBe('universe');
    expect(scopeForFocusBody('m31', 'solar')).toBe('universe');
    expect(scopeForFocusBody('quasar-3c273', 'galaxy')).toBe('universe');
    expect(scopeForFocusBody('m32', 'galaxy')).toBe('universe');
    expect(scopeForFocusBody('m110', 'solar')).toBe('universe');
  });

  it('序列外 L4 特殊天体（触须星系/引力透镜/GRB）→ universe', () => {
    expect(scopeForFocusBody('antennae-galaxies', 'galaxy')).toBe('universe');
    expect(scopeForFocusBody('cluster-lensing', 'solar')).toBe('universe');
    expect(scopeForFocusBody('grb-221009a', 'universe')).toBe('universe');
  });

  it('未知 id 保持当前域', () => {
    expect(scopeForFocusBody('not-a-body', 'solar')).toBe('solar');
    expect(scopeForFocusBody('oort-cloud', 'galaxy')).toBe('galaxy');
  });
});
