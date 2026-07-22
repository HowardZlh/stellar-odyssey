/**
 * 行星数据准确性测试（需求 6：数据准确性 / 验收标准）
 */

import { PLANETS, SUN, getPlanetById } from '@/data/planets';
import { orbitalPeriodYears } from '@/utils/physics';

describe('行星数据完整性', () => {
  it('包含八大行星且顺序由内向外', () => {
    expect(PLANETS.map((p) => p.id)).toEqual([
      'mercury',
      'venus',
      'earth',
      'mars',
      'jupiter',
      'saturn',
      'uranus',
      'neptune',
    ]);
  });

  it('id 唯一', () => {
    const ids = PLANETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('半长轴严格递增', () => {
    for (let i = 1; i < PLANETS.length; i += 1) {
      expect(PLANETS[i].orbit.semiMajorAxisAu).toBeGreaterThan(
        PLANETS[i - 1].orbit.semiMajorAxisAu,
      );
    }
  });

  it('所有行星均标注数据来源', () => {
    for (const p of PLANETS) {
      expect(p.dataSource.length).toBeGreaterThan(0);
    }
    expect(SUN.dataSource).toContain('NASA');
  });
});

describe('轨道参数科学性', () => {
  it('离心率全部在 [0, 1) 椭圆范围', () => {
    for (const p of PLANETS) {
      expect(p.orbit.eccentricity).toBeGreaterThanOrEqual(0);
      expect(p.orbit.eccentricity).toBeLessThan(1);
    }
  });

  it('所有行星轨道倾角 < 90°（公转方向一致，逆时针）', () => {
    for (const p of PLANETS) {
      expect(Math.abs(p.orbit.inclinationDeg)).toBeLessThan(90);
    }
  });

  it('水星离心率最大（0.2056）', () => {
    const mercury = getPlanetById('mercury')!;
    for (const p of PLANETS) {
      if (p.id !== 'mercury') {
        expect(p.orbit.eccentricity).toBeLessThan(mercury.orbit.eccentricity);
      }
    }
  });

  it('标称公转周期与开普勒第三定律推算一致（<0.5% 偏差）', () => {
    for (const p of PLANETS) {
      const computed = orbitalPeriodYears(p.orbit.semiMajorAxisAu);
      const deviation = Math.abs(computed - p.orbitalPeriodYears) / p.orbitalPeriodYears;
      expect(deviation).toBeLessThan(0.005);
    }
  });

  it('地球 J2000 轨道参数与 JPL 数据一致', () => {
    const earth = getPlanetById('earth')!;
    expect(earth.orbit.semiMajorAxisAu).toBeCloseTo(1.0, 3);
    expect(earth.orbit.eccentricity).toBeCloseTo(0.0167, 3);
    // M₀ = L − ϖ = 100.46435 − 102.94719 ≈ −2.48°
    expect(earth.orbit.meanAnomalyAtEpochDeg).toBeCloseTo(-2.48284, 4);
  });
});

describe('自转参数科学性（需求 3.1.1）', () => {
  it('金星逆向自转：周期为负且约 243 天，比公转周期（224.7 天）还长', () => {
    const venus = getPlanetById('venus')!;
    expect(venus.rotation.siderealPeriodHours).toBeLessThan(0);
    expect(Math.abs(venus.rotation.siderealPeriodHours) / 24).toBeCloseTo(243, 0);
    expect(Math.abs(venus.rotation.siderealPeriodHours) / 24).toBeGreaterThan(
      venus.orbitalPeriodYears * 365.25 * 0.9,
    );
    // 轴倾角 >90° 表达"翻转轴"（与 NASA Fact Sheet 一致）
    expect(venus.rotation.axialTiltDeg).toBeGreaterThan(90);
  });

  it('金星是唯一自转周期长于公转周期的行星', () => {
    for (const p of PLANETS) {
      const rotationDays = Math.abs(p.rotation.siderealPeriodHours) / 24;
      const orbitDays = p.orbitalPeriodYears * 365.25;
      if (p.id === 'venus') {
        expect(rotationDays).toBeGreaterThan(orbitDays);
      } else {
        expect(rotationDays).toBeLessThan(orbitDays);
      }
    }
  });

  it('天王星侧躺：轴倾角 97.77°', () => {
    expect(getPlanetById('uranus')!.rotation.axialTiltDeg).toBeCloseTo(97.77, 2);
  });

  it('地球轴倾角 23.44°', () => {
    expect(getPlanetById('earth')!.rotation.axialTiltDeg).toBeCloseTo(23.44, 2);
  });

  it('木星自转最快（约 9.9 小时）', () => {
    const jupiter = getPlanetById('jupiter')!;
    expect(Math.abs(jupiter.rotation.siderealPeriodHours)).toBeCloseTo(9.925, 2);
    for (const p of PLANETS) {
      if (p.id !== 'jupiter') {
        expect(Math.abs(p.rotation.siderealPeriodHours)).toBeGreaterThan(
          Math.abs(jupiter.rotation.siderealPeriodHours),
        );
      }
    }
  });
});

describe('getPlanetById', () => {
  it('按 id 查找行星', () => {
    expect(getPlanetById('earth')?.nameZh).toBe('地球');
  });

  it('未知 id 返回 undefined', () => {
    expect(getPlanetById('pluto')).toBeUndefined();
  });
});

describe('太阳数据', () => {
  it('半径约 695,700 km（NASA Sun Fact Sheet）', () => {
    expect(SUN.radiusKm).toBe(695700);
  });
});
