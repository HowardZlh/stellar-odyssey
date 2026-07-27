/**
 * 太阳表面/日冕 S3 增强单测（IMPROVEMENT_REQUIREMENTS_SOLAR §4.2/§4.4/§6）：
 * 日冕冕流各向异性周期联动（极小期赤道集中 → 极大期全纬度铺开）。
 */

import {
  CORONAL_HOLE_MIN_BRIGHTNESS,
  CORONAL_HOLE_RADIUS_RAD,
  FACULAE_OUTER_RADIUS_RATIO,
  SPICULE_AMP,
  SUPERGRANULE_AMP,
  coronaIntensity,
  coronaStreamerFactor,
  coronalHoleDarkening,
  faculaeBoost,
  spiculeRimPerturbation,
  supergranulationModulation,
} from '@/utils/sunSurface';

describe('coronaStreamerFactor（冕流各向异性周期联动）', () => {
  it('向后兼容：默认 isotropy=0 与显式 0 一致', () => {
    expect(coronaStreamerFactor(0.2, 0.5)).toBeCloseTo(coronaStreamerFactor(0.2, 0.5, 0), 10);
  });

  it('极小期（iso=0）赤道亮于极区', () => {
    const equator = coronaStreamerFactor(0.0, 0.5, 0);
    const pole = coronaStreamerFactor(1.0, 0.5, 0);
    expect(equator).toBeGreaterThan(pole);
  });

  it('极大期（iso=1）赤道与极区趋同（各向同性）', () => {
    const equator = coronaStreamerFactor(0.0, 0.5, 1);
    const pole = coronaStreamerFactor(1.0, 0.5, 1);
    expect(equator).toBeCloseTo(pole, 10);
  });

  it('极区亮度随各向同性升高而增强（日冕向全纬度铺开）', () => {
    const poleMin = coronaStreamerFactor(1.0, 0.5, 0);
    const poleMax = coronaStreamerFactor(1.0, 0.5, 1);
    expect(poleMax).toBeGreaterThan(poleMin);
  });

  it('输出为正且随噪声单调', () => {
    expect(coronaStreamerFactor(0.5, 0.2, 0.5)).toBeLessThan(
      coronaStreamerFactor(0.5, 0.9, 0.5),
    );
  });
});

describe('coronaIntensity（含各向异性参数）', () => {
  it('向后兼容：默认 isotropy=0', () => {
    expect(coronaIntensity(1.5, 0.3, 0.5, 1)).toBeCloseTo(
      coronaIntensity(1.5, 0.3, 0.5, 1, 0),
      10,
    );
  });

  it('极区处极大期强度高于极小期', () => {
    const min = coronaIntensity(1.5, 1.0, 0.5, 1, 0);
    const max = coronaIntensity(1.5, 1.0, 0.5, 1, 1);
    expect(max).toBeGreaterThan(min);
  });

  it('远观（detailStrength=0）恒为 0', () => {
    expect(coronaIntensity(1.5, 0.3, 0.5, 0, 1)).toBe(0);
  });
});

describe('faculaeBoost（光斑增亮）', () => {
  const R = 0.1;

  it('黑子内部（本影/半影区）无光斑', () => {
    expect(faculaeBoost(R * 0.5, R, 1, 0.8, 0.5)).toBe(0);
    expect(faculaeBoost(R, R, 1, 0.8, 0.5)).toBe(0);
  });

  it('环带外无光斑', () => {
    expect(faculaeBoost(R * FACULAE_OUTER_RADIUS_RATIO, R, 1, 0.8, 0.5)).toBe(0);
    expect(faculaeBoost(R * (FACULAE_OUTER_RADIUS_RATIO + 1), R, 1, 0.8, 0.5)).toBe(0);
  });

  it('环带内为正增量', () => {
    const mid = R * (1 + FACULAE_OUTER_RADIUS_RATIO) * 0.5;
    expect(faculaeBoost(mid, R, 1, 0.8, 0.5)).toBeGreaterThan(0);
  });

  it('临边（μ 小）光斑强于盘面中心（μ 大）', () => {
    const mid = R * (1 + FACULAE_OUTER_RADIUS_RATIO) * 0.5;
    const limb = faculaeBoost(mid, R, 1, 0.1, 0.5);
    const center = faculaeBoost(mid, R, 1, 0.95, 0.5);
    expect(limb).toBeGreaterThan(center);
  });

  it('强度为 0 时无光斑', () => {
    const mid = R * (1 + FACULAE_OUTER_RADIUS_RATIO) * 0.5;
    expect(faculaeBoost(mid, R, 0, 0.5, 0.5)).toBe(0);
  });

  it('半径非正抛错', () => {
    expect(() => faculaeBoost(0.05, 0, 1, 0.5, 0.5)).toThrow(RangeError);
  });
});

describe('supergranulationModulation（超米粒亮度调制）', () => {
  it('中心值（fbm=0.5）无调制', () => {
    expect(supergranulationModulation(0.5, 1)).toBeCloseTo(0, 10);
  });

  it('远观（detailStrength=0）无调制', () => {
    expect(supergranulationModulation(1, 0)).toBeCloseTo(0, 10);
    expect(supergranulationModulation(0, 0)).toBeCloseTo(0, 10);
  });

  it('近观峰值不超过幅度上限', () => {
    expect(supergranulationModulation(1, 1)).toBeCloseTo(SUPERGRANULE_AMP, 10);
    expect(supergranulationModulation(0, 1)).toBeCloseTo(-SUPERGRANULE_AMP, 10);
  });

  it('低对比：幅度远小于米粒（不喧宾夺主）', () => {
    expect(SUPERGRANULE_AMP).toBeLessThan(0.16);
  });
});

describe('spiculeRimPerturbation（针状体边缘扰动）', () => {
  it('噪声中值（0.5）不改变 alpha', () => {
    expect(spiculeRimPerturbation(0.4, 0.5)).toBeCloseTo(0.4, 10);
  });

  it('噪声极值产生锯齿扰动', () => {
    expect(spiculeRimPerturbation(0.4, 1)).toBeCloseTo(0.4 * (1 + SPICULE_AMP), 10);
    expect(spiculeRimPerturbation(0.4, 0)).toBeCloseTo(0.4 * (1 - SPICULE_AMP), 10);
  });

  it('结果不为负', () => {
    expect(spiculeRimPerturbation(0, 0)).toBe(0);
    expect(spiculeRimPerturbation(0.1, 0)).toBeGreaterThanOrEqual(0);
  });
});

describe('coronalHoleDarkening（日冕洞暗化）', () => {
  it('洞外（角距 ≥ 半径）无暗化', () => {
    const cosOutside = Math.cos(CORONAL_HOLE_RADIUS_RAD + 0.1);
    expect(coronalHoleDarkening(cosOutside)).toBe(1);
  });

  it('洞中心（cos=1）最暗', () => {
    expect(coronalHoleDarkening(1)).toBeCloseTo(CORONAL_HOLE_MIN_BRIGHTNESS, 6);
  });

  it('从中心到边缘单调变亮', () => {
    const center = coronalHoleDarkening(Math.cos(0));
    const mid = coronalHoleDarkening(Math.cos(CORONAL_HOLE_RADIUS_RAD * 0.5));
    const edge = coronalHoleDarkening(Math.cos(CORONAL_HOLE_RADIUS_RAD * 0.95));
    expect(center).toBeLessThan(mid);
    expect(mid).toBeLessThan(edge);
  });

  it('输出恒在 [min, 1]', () => {
    for (let a = 0; a < Math.PI; a += 0.1) {
      const v = coronalHoleDarkening(Math.cos(a));
      expect(v).toBeGreaterThanOrEqual(CORONAL_HOLE_MIN_BRIGHTNESS - 1e-9);
      expect(v).toBeLessThanOrEqual(1 + 1e-9);
    }
  });
});
