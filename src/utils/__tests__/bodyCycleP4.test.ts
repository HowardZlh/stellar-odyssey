/**
 * 行星域切换序列测试（P4 需求 §3.2.4；R3 视角域切换重构：
 * 太阳系序列（行星+矮行星+彗星，半长轴排序）与行星系统序列（行星+其卫星））
 */

import {
  DEFAULT_ANCHOR_BODY_ID,
  SOLAR_CYCLE_SEQUENCE,
  cycleControlVisible,
  isCycleBody,
  planetSystemIdForBody,
  planetSystemSequence,
} from '@/utils/bodyCycle';
import { PLANETS } from '@/data/planets';
import { COMETS, DWARF_PLANETS } from '@/data/smallBodies';
import { MOONS, getMoonsByParent } from '@/data/moons';

describe('SOLAR_CYCLE_SEQUENCE 太阳系序列（R3 需求 1：仅行星+矮行星+彗星）', () => {
  it('15 天体按半长轴升序混排（恩克 2.22 AU 在火星后、哈雷 17.8 AU 在土星后）', () => {
    expect(SOLAR_CYCLE_SEQUENCE).toEqual([
      'mercury',
      'venus',
      'earth',
      'mars',
      'encke',
      'ceres',
      'jupiter',
      'saturn',
      'halley',
      'uranus',
      'neptune',
      'pluto',
      'haumea',
      'makemake',
      'eris',
    ]);
  });

  it('覆盖全部八大行星、5 颗矮行星与 2 颗彗星（数据层一致）', () => {
    const expected = [...PLANETS, ...DWARF_PLANETS, ...COMETS].map((b) => b.id);
    expect([...SOLAR_CYCLE_SEQUENCE].sort()).toEqual(expected.sort());
  });

  it('不含任何卫星/人造卫星（R3 需求 1）', () => {
    for (const moon of MOONS) {
      expect(SOLAR_CYCLE_SEQUENCE).not.toContain(moon.id);
    }
  });

  it('严格按半长轴升序（与数据层轨道参数一致）', () => {
    const byId = new Map(
      [...PLANETS, ...DWARF_PLANETS, ...COMETS].map((b) => [b.id, b.orbit.semiMajorAxisAu]),
    );
    for (let i = 1; i < SOLAR_CYCLE_SEQUENCE.length; i += 1) {
      expect(byId.get(SOLAR_CYCLE_SEQUENCE[i])!).toBeGreaterThanOrEqual(
        byId.get(SOLAR_CYCLE_SEQUENCE[i - 1])!,
      );
    }
  });
});

describe('planetSystemSequence 行星系统序列（R3 需求 1：行星+其卫星）', () => {
  it('地球系统：地球 + 5 颗卫星按绕行半长轴升序（天宫→ISS→哈勃→静止卫星→月球）', () => {
    expect(planetSystemSequence('earth')).toEqual([
      'earth',
      'tiangong',
      'iss',
      'hubble',
      'geo-satellite',
      'moon',
    ]);
  });

  it('木星系统：伽利略四卫星按半长轴升序', () => {
    expect(planetSystemSequence('jupiter')).toEqual([
      'jupiter',
      'io',
      'europa',
      'ganymede',
      'callisto',
    ]);
  });

  it('土星/火星/海王星/冥王星系统成员与数据层归属一致', () => {
    for (const systemId of ['saturn', 'mars', 'neptune', 'pluto']) {
      const seq = planetSystemSequence(systemId);
      expect(seq[0]).toBe(systemId);
      expect(seq.slice(1).sort()).toEqual(
        getMoonsByParent(systemId)
          .map((m) => m.id)
          .sort(),
      );
    }
  });

  it('无卫星的行星/矮行星/彗星：序列仅含自身（UI 隐藏切换按钮）', () => {
    for (const id of ['mercury', 'venus', 'uranus', 'ceres', 'haumea', 'makemake', 'eris', 'halley', 'encke']) {
      expect(planetSystemSequence(id)).toEqual([id]);
    }
  });

  it('非太阳系序列成员（太阳/星系/未知）返回空序列', () => {
    expect(planetSystemSequence('sun')).toEqual([]);
    expect(planetSystemSequence('m31')).toEqual([]);
    expect(planetSystemSequence('not-a-body')).toEqual([]);
  });
});

describe('planetSystemIdForBody 系统归属', () => {
  it('卫星（自然/人造）归属其行星', () => {
    expect(planetSystemIdForBody('moon')).toBe('earth');
    expect(planetSystemIdForBody('iss')).toBe('earth');
    expect(planetSystemIdForBody('io')).toBe('jupiter');
    expect(planetSystemIdForBody('charon')).toBe('pluto');
  });

  it('行星/其他天体归属自身', () => {
    expect(planetSystemIdForBody('earth')).toBe('earth');
    expect(planetSystemIdForBody('eris')).toBe('eris');
    expect(planetSystemIdForBody('sun')).toBe('sun');
  });
});

describe('isCycleBody 行星域判定（L1 锚定天体范围）', () => {
  it('默认锚定天体为地球且属于行星域', () => {
    expect(DEFAULT_ANCHOR_BODY_ID).toBe('earth');
    expect(isCycleBody(DEFAULT_ANCHOR_BODY_ID)).toBe(true);
  });

  it('行星/矮行星/彗星/卫星均属行星域', () => {
    expect(isCycleBody('halley')).toBe(true);
    expect(isCycleBody('pluto')).toBe(true);
    expect(isCycleBody('moon')).toBe(true);
    expect(isCycleBody('iss')).toBe(true);
    expect(isCycleBody('charon')).toBe(true);
  });

  it('太阳/星系/特殊天体不属行星域', () => {
    expect(isCycleBody('sun')).toBe(false);
    expect(isCycleBody('m31')).toBe(false);
    expect(isCycleBody('sgr-a-star')).toBe(false);
    expect(isCycleBody('not-a-body')).toBe(false);
  });
});

describe('cycleControlVisible 切换控件可见性（需求 §3.2.4）', () => {
  it('L1 恒可见', () => {
    expect(cycleControlVisible('L1', null)).toBe(true);
    expect(cycleControlVisible('L1', 'earth')).toBe(true);
  });

  it('跟随行星域天体时可见（防御分支，R3 层级锁定后读数常驻域主层级）', () => {
    expect(cycleControlVisible('L2', 'neptune')).toBe(true);
    expect(cycleControlVisible('L2', 'iss')).toBe(true);
    expect(cycleControlVisible('L2', 'eris')).toBe(true);
  });

  it('L2-L4 未跟随行星域天体时不可见', () => {
    expect(cycleControlVisible('L2', null)).toBe(false);
    expect(cycleControlVisible('L3', null)).toBe(false);
    expect(cycleControlVisible('L4', 'm31')).toBe(false);
    expect(cycleControlVisible('L2', 'sun')).toBe(false);
  });
});
