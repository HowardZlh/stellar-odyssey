/**
 * 太阳黑子系统单测（S2，IMPROVEMENT_REQUIREMENTS_SOLAR §4.3-1/§6）：
 * 生成确定性、纬度带约束（±35°）、成对性、生命周期曲线、较差自转移动
 */

import {
  SUNSPOT_FOLLOWER_RADIUS_RATIO,
  SUNSPOT_MAX_LAT_DEG,
  SUNSPOT_MAX_RENDERED,
  SUNSPOT_MIN_LAT_DEG,
  SUNSPOT_PAIR_SEPARATION_MAX_DEG,
  SUNSPOT_PAIR_SEPARATION_MIN_DEG,
  SUNSPOT_PAIR_SLOTS,
  SUNSPOT_PENUMBRA_BRIGHTNESS,
  SUNSPOT_RADIUS_MAX_RAD,
  SUNSPOT_RADIUS_MIN_RAD,
  SUNSPOT_UMBRA_BRIGHTNESS,
  activeRegionLatLon,
  strongestSunspot,
  fillSunspotShaderData,
  sunspotDarkening,
  sunspotDirection,
  sunspotEnvelope,
  sunspotHash01,
  sunspotPairState,
} from '@/utils/sunspots';
import { solarRotationOmegaDegPerDay } from '@/utils/solarRotation';

describe('sunspotHash01（确定性伪随机）', () => {
  it('同输入同输出（可复现，禁止每帧 Math.random）', () => {
    expect(sunspotHash01(2, 7, 3)).toBe(sunspotHash01(2, 7, 3));
  });

  it('不同输入不同输出且落在 [0,1)', () => {
    const a = sunspotHash01(0, 0, 1);
    const b = sunspotHash01(1, 0, 1);
    expect(a).not.toBe(b);
    for (const v of [a, b]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('非有限输入抛错', () => {
    expect(() => sunspotHash01(Number.NaN, 0, 0)).toThrow(RangeError);
  });
});

describe('sunspotEnvelope（生命周期）', () => {
  it('区间外为 0，中段平台期为 1', () => {
    expect(sunspotEnvelope(-0.1)).toBe(0);
    expect(sunspotEnvelope(0)).toBe(0);
    expect(sunspotEnvelope(0.5)).toBe(1);
    expect(sunspotEnvelope(1)).toBe(0);
    expect(sunspotEnvelope(1.2)).toBe(0);
  });

  it('生成段单调上升、消散段单调下降', () => {
    expect(sunspotEnvelope(0.05)).toBeLessThan(sunspotEnvelope(0.15));
    expect(sunspotEnvelope(0.8)).toBeGreaterThan(sunspotEnvelope(0.95));
  });

  it('非有限输入抛错', () => {
    expect(() => sunspotEnvelope(Number.NaN)).toThrow(RangeError);
  });
});

describe('sunspotPairState', () => {
  it('确定性：同一时刻两次调用结果一致', () => {
    const a = sunspotPairState(0, 5000);
    const b = sunspotPairState(0, 5000);
    expect(a).toEqual(b);
  });

  it('无效槽位抛错', () => {
    expect(() => sunspotPairState(-1, 0)).toThrow(RangeError);
    expect(() => sunspotPairState(SUNSPOT_PAIR_SLOTS, 0)).toThrow(RangeError);
    expect(() => sunspotPairState(0, Number.NaN)).toThrow(RangeError);
  });

  it('活跃黑子满足纬度带约束（±5°–35°）与半径/强度范围', () => {
    for (let slot = 0; slot < SUNSPOT_PAIR_SLOTS; slot += 1) {
      for (let day = 0; day < 3000; day += 13) {
        const pair = sunspotPairState(slot, day);
        if (!pair) continue;
        for (const spot of pair) {
          const absLatDeg = (Math.abs(spot.latRad) * 180) / Math.PI;
          expect(absLatDeg).toBeGreaterThanOrEqual(SUNSPOT_MIN_LAT_DEG - 1e-9);
          expect(absLatDeg).toBeLessThanOrEqual(SUNSPOT_MAX_LAT_DEG + 1e-9);
          expect(spot.strength01).toBeGreaterThan(0);
          expect(spot.strength01).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('成对性：前导/后随同纬度、经度间隔在 8°–16°、后随较小', () => {
    let checked = 0;
    for (let slot = 0; slot < SUNSPOT_PAIR_SLOTS; slot += 1) {
      for (let day = 0; day < 3000; day += 17) {
        const pair = sunspotPairState(slot, day);
        if (!pair) continue;
        const [leader, follower] = pair;
        expect(leader.latRad).toBe(follower.latRad);
        const sepDeg = ((leader.lonRad - follower.lonRad) * 180) / Math.PI;
        expect(sepDeg).toBeGreaterThanOrEqual(SUNSPOT_PAIR_SEPARATION_MIN_DEG - 1e-9);
        expect(sepDeg).toBeLessThanOrEqual(SUNSPOT_PAIR_SEPARATION_MAX_DEG + 1e-9);
        expect(follower.radiusRad).toBeCloseTo(leader.radiusRad * SUNSPOT_FOLLOWER_RADIUS_RATIO, 12);
        expect(leader.radiusRad).toBeGreaterThanOrEqual(SUNSPOT_RADIUS_MIN_RAD);
        expect(leader.radiusRad).toBeLessThanOrEqual(SUNSPOT_RADIUS_MAX_RAD);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(10);
  });

  it('黑子随所在纬度较差自转移动（角速度与 solarRotation 一致）', () => {
    // 找一个存续期 ≥ 2 天的活跃黑子，比较经度增量与 ω(lat)·Δt
    for (let slot = 0; slot < SUNSPOT_PAIR_SLOTS; slot += 1) {
      for (let day = 0; day < 3000; day += 7) {
        const a = sunspotPairState(slot, day);
        const b = sunspotPairState(slot, day + 1);
        if (!a || !b || a[0].latRad !== b[0].latRad) continue;
        const deltaDeg = ((b[0].lonRad - a[0].lonRad) * 180) / Math.PI;
        expect(deltaDeg).toBeCloseTo(solarRotationOmegaDegPerDay(a[0].latRad), 8);
        return;
      }
    }
    throw new Error('未找到跨 1 天存续的活跃黑子（测试采样步长需调整）');
  });
});

describe('fillSunspotShaderData', () => {
  it('写入预分配数组并返回活跃数（≤ 上限）', () => {
    const dirs = new Float32Array(SUNSPOT_MAX_RENDERED * 3);
    const params = new Float32Array(SUNSPOT_MAX_RENDERED * 3);
    const count = fillSunspotShaderData(8000, dirs, params);
    expect(count).toBeGreaterThanOrEqual(0);
    expect(count).toBeLessThanOrEqual(SUNSPOT_MAX_RENDERED);
    for (let i = 0; i < count; i += 1) {
      const len = Math.hypot(dirs[i * 3], dirs[i * 3 + 1], dirs[i * 3 + 2]);
      expect(len).toBeCloseTo(1, 5);
      expect(params[i * 3]).toBeGreaterThan(0);
      expect(params[i * 3 + 1]).toBeGreaterThan(0);
    }
  });

  it('数组长度不足抛错', () => {
    expect(() => fillSunspotShaderData(0, new Float32Array(3), new Float32Array(30))).toThrow(
      RangeError,
    );
  });
});

describe('sunspotDirection', () => {
  it('输出单位矢量且约定正确（赤道 lon=0 → +x，北纬 90° → +y）', () => {
    const eq = sunspotDirection(0, 0);
    expect(eq.x).toBeCloseTo(1, 12);
    const pole = sunspotDirection(Math.PI / 2, 0);
    expect(pole.y).toBeCloseTo(1, 12);
    const west = sunspotDirection(0, Math.PI / 2);
    expect(west.z).toBeCloseTo(-1, 12);
  });
});

describe('sunspotDarkening（本影+半影）', () => {
  it('黑子外亮度为 1', () => {
    expect(sunspotDarkening(0.2, 0.1, 1, 0.5)).toBe(1);
  });

  it('本影中心最暗（≈本影亮度），半影过渡回 1', () => {
    expect(sunspotDarkening(0, 0.1, 1, 0.5)).toBeCloseTo(SUNSPOT_UMBRA_BRIGHTNESS, 12);
    const penumbra = sunspotDarkening(0.07, 0.1, 1, 0.5);
    expect(penumbra).toBeGreaterThan(SUNSPOT_UMBRA_BRIGHTNESS);
    expect(penumbra).toBeLessThan(1);
  });

  it('强度 0 时无暗化，强度线性调制', () => {
    expect(sunspotDarkening(0, 0.1, 0, 0.5)).toBe(1);
    const half = sunspotDarkening(0, 0.1, 0.5, 0.5);
    expect(half).toBeCloseTo(1 - (1 - SUNSPOT_UMBRA_BRIGHTNESS) * 0.5, 12);
  });

  it('半影纤维噪声调制围绕基准亮度（±0.075）', () => {
    const dark = sunspotDarkening(0.05, 0.1, 1, 0);
    const bright = sunspotDarkening(0.05, 0.1, 1, 1);
    expect(bright).toBeGreaterThan(dark);
    expect(Math.abs((dark + bright) / 2 - sunspotDarkening(0.05, 0.1, 1, 0.5))).toBeLessThan(1e-9);
    expect(SUNSPOT_PENUMBRA_BRIGHTNESS).toBeGreaterThan(SUNSPOT_UMBRA_BRIGHTNESS);
  });

  it('非法半径抛错', () => {
    expect(() => sunspotDarkening(0, 0, 1, 0.5)).toThrow(RangeError);
  });
});

describe('activeRegionLatLon（耀斑锚定）', () => {
  it('有活跃黑子时返回最强黑子方位（中低纬）', () => {
    // 扫描找到有活跃黑子的时刻
    for (let day = 0; day < 3000; day += 5) {
      const dirs = new Float32Array(SUNSPOT_MAX_RENDERED * 3);
      const params = new Float32Array(SUNSPOT_MAX_RENDERED * 3);
      if (fillSunspotShaderData(day, dirs, params) === 0) continue;
      const region = activeRegionLatLon(day, 0.5);
      const absLatDeg = (Math.abs(region.latRad) * 180) / Math.PI;
      expect(absLatDeg).toBeLessThanOrEqual(SUNSPOT_MAX_LAT_DEG + 1e-9);
      return;
    }
    throw new Error('3000 天内未找到活跃黑子');
  });

  it('确定性：同输入同输出', () => {
    expect(activeRegionLatLon(1234, 0.3)).toEqual(activeRegionLatLon(1234, 0.3));
  });
});

describe('strongestSunspot（活动区锚定/录制诊断共用）', () => {
  it('有活跃黑子时返回强度最大的前导黑子，且与 activeRegionLatLon 方位一致', () => {
    for (let day = 0; day < 3000; day += 5) {
      const best = strongestSunspot(day);
      if (best === null) continue;
      expect(best.strength01).toBeGreaterThan(0);
      const region = activeRegionLatLon(day, 0.5);
      expect(region.latRad).toBe(best.latRad);
      expect(region.lonRad).toBe(best.lonRad);
      return;
    }
    throw new Error('3000 天内未找到活跃黑子');
  });

  it('确定性：同输入同输出', () => {
    expect(strongestSunspot(1234)).toEqual(strongestSunspot(1234));
  });
});
