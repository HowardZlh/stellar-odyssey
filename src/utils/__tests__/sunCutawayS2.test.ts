/**
 * 太阳剖面模式纯逻辑单测（S2，IMPROVEMENT_REQUIREMENTS_SOLAR §4.1/§6）：
 * 分层半径比例（0.25/0.7 R☉）、开合过渡、楔形判定、核心脉动、互斥淡出
 */

import {
  CUTAWAY_LAYER_COLORS,
  CUTAWAY_OPEN_SECONDS,
  CUTAWAY_WEDGE_RAD,
  SUN_CORE_OUTER_FRAC,
  SUN_RADIATIVE_OUTER_FRAC,
  advanceCutawayProgress,
  corePulseFactor,
  cutawayEase,
  cutawayLayerAtRadius,
  cutawayWedgeAngleRad,
  externalActivityFade,
  isInCutawayWedge,
} from '@/utils/sunCutaway';

describe('分层半径比例（标准太阳模型）', () => {
  it('边界常量 0.25 / 0.7 R☉', () => {
    expect(SUN_CORE_OUTER_FRAC).toBe(0.25);
    expect(SUN_RADIATIVE_OUTER_FRAC).toBe(0.7);
  });

  it('按半径判层：核心/辐射区/对流区', () => {
    expect(cutawayLayerAtRadius(0)).toBe('core');
    expect(cutawayLayerAtRadius(0.25)).toBe('core');
    expect(cutawayLayerAtRadius(0.26)).toBe('radiative');
    expect(cutawayLayerAtRadius(0.7)).toBe('radiative');
    expect(cutawayLayerAtRadius(0.71)).toBe('convective');
    expect(cutawayLayerAtRadius(1)).toBe('convective');
  });

  it('越界半径抛错', () => {
    expect(() => cutawayLayerAtRadius(-0.1)).toThrow(RangeError);
    expect(() => cutawayLayerAtRadius(1.1)).toThrow(RangeError);
    expect(() => cutawayLayerAtRadius(Number.NaN)).toThrow(RangeError);
  });

  it('三层切面色带均已定义', () => {
    for (const layer of ['core', 'radiative', 'convective'] as const) {
      const c = CUTAWAY_LAYER_COLORS[layer];
      expect(c.r).toBeGreaterThan(0);
      expect(c.g).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('开合过渡（≤2 秒平滑）', () => {
  it('过渡时长 ≤ 2 秒', () => {
    expect(CUTAWAY_OPEN_SECONDS).toBeLessThanOrEqual(2);
  });

  it('进度推进：展开累计到 1、闭合回到 0、钳制在 [0,1]', () => {
    let p = 0;
    for (let i = 0; i < 100; i += 1) p = advanceCutawayProgress(p, true, 0.05);
    expect(p).toBe(1);
    for (let i = 0; i < 100; i += 1) p = advanceCutawayProgress(p, false, 0.05);
    expect(p).toBe(0);
    expect(() => advanceCutawayProgress(0, true, -0.1)).toThrow(RangeError);
  });

  it('缓动端点与单调性', () => {
    expect(cutawayEase(0)).toBe(0);
    expect(cutawayEase(1)).toBe(1);
    expect(cutawayEase(0.25)).toBeLessThan(cutawayEase(0.5));
    expect(cutawayEase(0.5)).toBeLessThan(cutawayEase(0.75));
  });

  it('楔形张角：全开为 π/2（1/4 球体切除）', () => {
    expect(cutawayWedgeAngleRad(0)).toBe(0);
    expect(cutawayWedgeAngleRad(1)).toBeCloseTo(CUTAWAY_WEDGE_RAD, 12);
    expect(CUTAWAY_WEDGE_RAD).toBeCloseTo(Math.PI / 2, 12);
  });
});

describe('isInCutawayWedge（shader discard 镜像）', () => {
  it('楔形 φ∈[0, π/2]：+x 在楔形内，−x/−z 在外', () => {
    const wedge = Math.PI / 2;
    expect(isInCutawayWedge(1, -0.5, wedge)).toBe(true);
    expect(isInCutawayWedge(1, 1, wedge)).toBe(false);
    expect(isInCutawayWedge(-1, 0.001, wedge)).toBe(false);
  });

  it('张角为 0 时几乎无切除', () => {
    expect(isInCutawayWedge(1, -1, 0)).toBe(false);
  });
});

describe('核心脉动与互斥淡出', () => {
  it('核心脉动因子在 0.94–1.06 且确定性（暂停冻结语义）', () => {
    for (let d = 0; d < 3; d += 0.1) {
      const f = corePulseFactor(d);
      expect(f).toBeGreaterThanOrEqual(0.94 - 1e-9);
      expect(f).toBeLessThanOrEqual(1.06 + 1e-9);
    }
    expect(corePulseFactor(1.5)).toBe(corePulseFactor(1.5));
    expect(() => corePulseFactor(Number.NaN)).toThrow(RangeError);
  });

  it('外部活动特效随剖面开合互斥淡出（§4.1/§5.3）', () => {
    expect(externalActivityFade(0)).toBe(1);
    expect(externalActivityFade(1)).toBe(0);
    expect(externalActivityFade(0.5)).toBeCloseTo(0.5, 12);
    expect(externalActivityFade(2)).toBe(0);
  });
});
