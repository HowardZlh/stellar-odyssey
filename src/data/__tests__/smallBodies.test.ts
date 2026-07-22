/**
 * 小天体数据准确性测试（需求 3.1.1 / 需求 6：数据准确性）
 */

import {
  COMETS,
  PLUTO,
  ASTEROID_BELT,
  KUIPER_BELT,
  getCometById,
} from '@/data/smallBodies';
import { getPlanetById } from '@/data/planets';
import { orbitalPeriodYears } from '@/utils/physics';

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

describe('哈雷彗星科学性', () => {
  const halley = getCometById('halley')!;

  it('高离心率 e ≈ 0.967', () => {
    expect(halley.orbit.eccentricity).toBeCloseTo(0.967, 3);
  });

  it('倾角 > 90°：逆行轨道（公转方向与行星相反）', () => {
    expect(halley.orbit.inclinationDeg).toBeGreaterThan(90);
    expect(halley.orbit.inclinationDeg).toBeCloseTo(162.26, 2);
  });

  it('远日点 a(1+e) ≈ 35 AU（30–40 AU 区间，海王星轨道外）', () => {
    const aphelionAu = halley.orbit.semiMajorAxisAu * (1 + halley.orbit.eccentricity);
    expect(aphelionAu).toBeGreaterThan(30);
    expect(aphelionAu).toBeLessThan(40);
  });

  it('周期约 76 年', () => {
    expect(halley.orbitalPeriodYears).toBeGreaterThan(74);
    expect(halley.orbitalPeriodYears).toBeLessThan(77);
  });
});

describe('开普勒第三定律自洽（T ≈ a^1.5，±2%）', () => {
  const bodies = [...COMETS, PLUTO];

  for (const body of bodies) {
    it(`${body.nameZh}：标称周期与推算周期一致`, () => {
      const computed = orbitalPeriodYears(body.orbit.semiMajorAxisAu);
      const deviation = Math.abs(computed - body.orbitalPeriodYears) / body.orbitalPeriodYears;
      expect(deviation).toBeLessThan(0.02);
    });
  }
});

describe('冥王星科学性', () => {
  it('分类为矮行星', () => {
    expect(PLUTO.classificationZh).toBe('矮行星');
  });

  it('轨道倾角约 17°（显著高于八大行星）', () => {
    expect(PLUTO.orbit.inclinationDeg).toBeCloseTo(17.14, 2);
  });

  it('与海王星周期比 ≈ 1.5（2:3 轨道共振）', () => {
    const neptune = getPlanetById('neptune')!;
    const ratio = PLUTO.orbitalPeriodYears / neptune.orbitalPeriodYears;
    expect(ratio).toBeGreaterThan(1.48);
    expect(ratio).toBeLessThan(1.53);
  });

  it('逆向自转（负自转周期），轴倾角 122.53°', () => {
    expect(PLUTO.rotation.siderealPeriodHours).toBeLessThan(0);
    expect(PLUTO.rotation.axialTiltDeg).toBeCloseTo(122.53, 2);
  });
});

describe('小行星带配置', () => {
  it('范围 2.2–3.2 AU，位于火星与木星轨道之间', () => {
    const mars = getPlanetById('mars')!;
    const jupiter = getPlanetById('jupiter')!;
    expect(ASTEROID_BELT.innerAu).toBe(2.2);
    expect(ASTEROID_BELT.outerAu).toBe(3.2);
    expect(ASTEROID_BELT.innerAu).toBeGreaterThan(mars.orbit.semiMajorAxisAu);
    expect(ASTEROID_BELT.outerAu).toBeLessThan(jupiter.orbit.semiMajorAxisAu);
  });
});

describe('柯伊伯带配置', () => {
  it('范围 30–50 AU，位于海王星轨道之外（inner ≥ 30）', () => {
    const neptune = getPlanetById('neptune')!;
    expect(KUIPER_BELT.innerAu).toBe(30);
    expect(KUIPER_BELT.outerAu).toBe(50);
    expect(KUIPER_BELT.innerAu).toBeGreaterThanOrEqual(30);
    expect(KUIPER_BELT.innerAu).toBeGreaterThanOrEqual(
      Math.floor(neptune.orbit.semiMajorAxisAu),
    );
  });

  it('单位体积粒子密度低于小行星带（count / (outer³ − inner³) 对比）', () => {
    const density = (belt: { count: number; innerAu: number; outerAu: number }): number =>
      belt.count / (belt.outerAu ** 3 - belt.innerAu ** 3);
    expect(density(KUIPER_BELT)).toBeLessThan(density(ASTEROID_BELT));
  });
});

describe('粒子带通用配置', () => {
  const belts = [ASTEROID_BELT, KUIPER_BELT];

  it('seed 固定（确定性生成）', () => {
    expect(ASTEROID_BELT.seed).toBe(20260722);
    expect(KUIPER_BELT.seed).toBe(20260723);
  });

  it('颜色为合法 #RRGGBB', () => {
    for (const belt of belts) {
      expect(belt.color).toMatch(HEX_COLOR);
    }
  });

  it('均标注数据来源', () => {
    for (const belt of belts) {
      expect(belt.dataSource.length).toBeGreaterThan(0);
    }
  });
});

describe('彗星数据完整性', () => {
  it('id 唯一且离心率在 [0, 1)', () => {
    const ids = COMETS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of COMETS) {
      expect(c.orbit.eccentricity).toBeGreaterThanOrEqual(0);
      expect(c.orbit.eccentricity).toBeLessThan(1);
      expect(c.nucleusRadiusKm).toBeGreaterThan(0);
      expect(c.tailActivationAu).toBeGreaterThan(0);
      expect(c.color).toMatch(HEX_COLOR);
    }
  });
});

describe('getCometById', () => {
  it('按 id 查找彗星', () => {
    expect(getCometById('encke')?.nameZh).toBe('恩克彗星');
  });

  it('未知 id 返回 undefined', () => {
    expect(getCometById('hale-bopp')).toBeUndefined();
  });
});
