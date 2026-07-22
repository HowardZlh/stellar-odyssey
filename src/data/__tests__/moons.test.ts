/**
 * 卫星数据准确性测试（需求 3.1.1 / 需求 6：数据准确性）
 */

import { MOONS, getMoonsByParent, getMoonById } from '@/data/moons';
import { getPlanetById } from '@/data/planets';

describe('卫星数据完整性', () => {
  it('id 唯一', () => {
    const ids = MOONS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('公转周期均为正', () => {
    for (const m of MOONS) {
      expect(m.orbit.periodDays).toBeGreaterThan(0);
    }
  });

  it('离心率全部在 [0, 1) 椭圆范围', () => {
    for (const m of MOONS) {
      expect(m.orbit.eccentricity).toBeGreaterThanOrEqual(0);
      expect(m.orbit.eccentricity).toBeLessThan(1);
    }
  });

  it('半径均为正', () => {
    for (const m of MOONS) {
      expect(m.radiusKm).toBeGreaterThan(0);
    }
  });

  it('parentId 均指向 PLANETS 中的行星', () => {
    for (const m of MOONS) {
      expect(getPlanetById(m.parentId)).toBeDefined();
    }
  });

  it('所有卫星均标注数据来源', () => {
    for (const m of MOONS) {
      expect(m.dataSource.length).toBeGreaterThan(0);
    }
  });
});

describe('月球科学性', () => {
  const moon = getMoonById('moon')!;

  it('恒星月周期 27.321661 天', () => {
    expect(moon.orbit.periodDays).toBeCloseTo(27.321661, 6);
  });

  it('轨道倾角 5.145°，且参考平面为黄道面（不得与黄道共面，避免暗示每月日食）', () => {
    expect(moon.orbit.inclinationDeg).toBeCloseTo(5.145, 3);
    expect(moon.referencePlane).toBe('ecliptic');
    expect(moon.orbit.inclinationDeg).toBeGreaterThan(0);
  });

  it('潮汐锁定（始终同一面朝向地球）', () => {
    expect(moon.tidallyLocked).toBe(true);
  });
});

describe('人造卫星科学性', () => {
  it('ISS：轨道高度约 400 km 量级（a − 6371 ≈ 417 km）', () => {
    const iss = getMoonById('iss')!;
    const altitudeKm = iss.orbit.semiMajorAxisKm - 6371;
    expect(altitudeKm).toBeGreaterThan(350);
    expect(altitudeKm).toBeLessThan(450);
    expect(altitudeKm).toBeCloseTo(417, 0);
  });

  it('ISS：周期约 92 分钟（0.0645 天 × 1440 ≈ 92.9 分钟）', () => {
    const iss = getMoonById('iss')!;
    const periodMinutes = iss.orbit.periodDays * 1440;
    expect(periodMinutes).toBeGreaterThan(88);
    expect(periodMinutes).toBeLessThan(96);
    expect(periodMinutes).toBeCloseTo(92.9, 1);
  });

  it('ISS：轨道倾角 51.6°，类别为人造卫星', () => {
    const iss = getMoonById('iss')!;
    expect(iss.orbit.inclinationDeg).toBeCloseTo(51.6, 1);
    expect(iss.kind).toBe('artificial');
  });

  it('哈勃：轨道倾角 28.5°', () => {
    const hubble = getMoonById('hubble')!;
    expect(hubble.orbit.inclinationDeg).toBeCloseTo(28.5, 1);
    expect(hubble.kind).toBe('artificial');
  });
});

describe('伽利略卫星轨道共振（io:europa:ganymede = 1:2:4）', () => {
  const io = getMoonById('io')!;
  const europa = getMoonById('europa')!;
  const ganymede = getMoonById('ganymede')!;

  it('europa / io 周期比 ≈ 2（±2%）', () => {
    const ratio = europa.orbit.periodDays / io.orbit.periodDays;
    expect(ratio).toBeGreaterThan(2 * 0.98);
    expect(ratio).toBeLessThan(2 * 1.02);
  });

  it('ganymede / io 周期比 ≈ 4（±2%）', () => {
    const ratio = ganymede.orbit.periodDays / io.orbit.periodDays;
    expect(ratio).toBeGreaterThan(4 * 0.98);
    expect(ratio).toBeLessThan(4 * 1.02);
  });

  it('伽利略四卫星均属木星且潮汐锁定', () => {
    for (const id of ['io', 'europa', 'ganymede', 'callisto']) {
      const m = getMoonById(id)!;
      expect(m.parentId).toBe('jupiter');
      expect(m.tidallyLocked).toBe(true);
    }
  });
});

describe('土星卫星', () => {
  it('土卫六与土卫二均属土星', () => {
    expect(getMoonById('titan')!.parentId).toBe('saturn');
    expect(getMoonById('enceladus')!.parentId).toBe('saturn');
  });

  it('土卫六：半径 2574.7 km、橙色浓厚大气备注', () => {
    const titan = getMoonById('titan')!;
    expect(titan.radiusKm).toBeCloseTo(2574.7, 1);
    expect(titan.noteZh).toContain('大气');
  });

  it('土卫二：高反照率冰面备注', () => {
    expect(getMoonById('enceladus')!.noteZh).toContain('冰面');
  });
});

describe('getMoonsByParent', () => {
  it('地球有 3 颗卫星（月球 + ISS + 哈勃）', () => {
    const earthMoons = getMoonsByParent('earth');
    expect(earthMoons).toHaveLength(3);
    expect(earthMoons.map((m) => m.id).sort()).toEqual(['hubble', 'iss', 'moon']);
  });

  it('未知行星返回空数组', () => {
    expect(getMoonsByParent('vulcan')).toEqual([]);
  });
});

describe('getMoonById', () => {
  it('按 id 查找卫星', () => {
    expect(getMoonById('moon')?.nameZh).toBe('月球');
  });

  it('未知 id 返回 undefined', () => {
    expect(getMoonById('phobos')).toBeUndefined();
  });
});
