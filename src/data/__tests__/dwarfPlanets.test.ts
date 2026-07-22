/**
 * 矮行星数据测试（可选需求 3.1.1：阋神星/鸟神星/妊神星 / 7 单元测试）
 */

import {
  DWARF_PLANETS,
  OTHER_DWARF_PLANETS,
  PLUTO,
  getDwarfPlanetById,
} from '@/data/smallBodies';

describe('矮行星清单', () => {
  it('共 4 员：冥王星 + 阋神星 + 鸟神星 + 妊神星', () => {
    expect(DWARF_PLANETS).toHaveLength(4);
    expect(DWARF_PLANETS.map((d) => d.id).sort()).toEqual([
      'eris',
      'haumea',
      'makemake',
      'pluto',
    ]);
  });

  it('id 唯一且首位为冥王星', () => {
    const ids = DWARF_PLANETS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(DWARF_PLANETS[0]).toBe(PLUTO);
  });

  it('全部标注为矮行星、数据来源完整、质量为正', () => {
    for (const d of DWARF_PLANETS) {
      expect(d.classificationZh).toBe('矮行星');
      expect(d.dataSource.length).toBeGreaterThan(0);
      expect(d.massKg).toBeDefined();
      expect(d.massKg!).toBeGreaterThan(0);
    }
  });

  it('轨道参数有效：离心率 [0,1)、半长轴与周期为正', () => {
    for (const d of OTHER_DWARF_PLANETS) {
      expect(d.orbit.eccentricity).toBeGreaterThanOrEqual(0);
      expect(d.orbit.eccentricity).toBeLessThan(1);
      expect(d.orbit.semiMajorAxisAu).toBeGreaterThan(0);
      expect(d.orbitalPeriodYears).toBeGreaterThan(0);
    }
  });

  it('开普勒第三定律自洽（T ≈ a^1.5，±2%）', () => {
    for (const d of OTHER_DWARF_PLANETS) {
      const expected = d.orbit.semiMajorAxisAu ** 1.5;
      expect(d.orbitalPeriodYears).toBeGreaterThan(expected * 0.98);
      expect(d.orbitalPeriodYears).toBeLessThan(expected * 1.02);
    }
  });
});

describe('阋神星（Eris）科学性', () => {
  const eris = getDwarfPlanetById('eris')!;

  it('高离心率离散盘轨道：a ≈ 67.86 AU、e ≈ 0.436', () => {
    expect(eris.orbit.semiMajorAxisAu).toBeCloseTo(67.86, 2);
    expect(eris.orbit.eccentricity).toBeCloseTo(0.436, 3);
  });

  it('轨道倾角约 44°（远高于冥王星 17°）', () => {
    expect(eris.orbit.inclinationDeg).toBeCloseTo(44.04, 1);
    expect(eris.orbit.inclinationDeg).toBeGreaterThan(PLUTO.orbit.inclinationDeg);
  });

  it('质量大于冥王星（导致 2006 年行星重新定义）', () => {
    expect(eris.massKg!).toBeGreaterThan(PLUTO.massKg!);
  });
});

describe('妊神星（Haumea）科学性', () => {
  it('自转周期 3.9 小时：全体矮行星中最快', () => {
    const haumea = getDwarfPlanetById('haumea')!;
    expect(haumea.rotation.siderealPeriodHours).toBeCloseTo(3.915, 2);
    for (const d of DWARF_PLANETS) {
      expect(Math.abs(haumea.rotation.siderealPeriodHours)).toBeLessThanOrEqual(
        Math.abs(d.rotation.siderealPeriodHours),
      );
    }
  });
});

describe('getDwarfPlanetById', () => {
  it('按 id 查找', () => {
    expect(getDwarfPlanetById('makemake')?.nameZh).toBe('鸟神星');
    expect(getDwarfPlanetById('pluto')?.nameZh).toBe(PLUTO.nameZh);
  });

  it('未知 id / 八大行星 id 返回 undefined', () => {
    expect(getDwarfPlanetById('ceres')).toBeUndefined();
    expect(getDwarfPlanetById('earth')).toBeUndefined();
  });
});
