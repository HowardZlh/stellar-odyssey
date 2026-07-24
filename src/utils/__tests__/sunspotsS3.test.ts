/**
 * 太阳黑子周期联动单测（S3，IMPROVEMENT_REQUIREMENTS_SOLAR §4.4/§6）：
 * 激活对数随周期包络增减、蝴蝶图纬度迁移（周期初高纬→周期末赤道）。
 * 不破坏 S2 既有行为（成对性/纬度带/较差自转仍由 sunspotsS2.test 覆盖）。
 */

import {
  EARTH_RADIUS_KM,
  FILAMENT_HALF_WIDTH_RAD,
  FILAMENT_MIN_BRIGHTNESS,
  SUNSPOT_MAX_LAT_DEG,
  SUNSPOT_MAX_RENDERED,
  SUNSPOT_MIN_ACTIVE_PAIRS,
  SUNSPOT_PAIR_SLOTS,
  SUNSPOT_SIZE_EXAGGERATION,
  SUN_RADIUS_KM,
  filamentDarkening,
  fillSunspotShaderData,
  sunspotEarthCount,
  sunspotSlotEnabledByCycle,
} from '@/utils/sunspots';
import {
  RISE_PHASE_FRACTION,
  SOLAR_CYCLE_25_MIN_SIMDAYS,
  SOLAR_CYCLE_LENGTH_DAYS,
} from '@/utils/solarCycle';

describe('sunspotSlotEnabledByCycle（周期联动激活门控）', () => {
  it('极小配额内的槽位恒活跃', () => {
    for (let slot = 0; slot < SUNSPOT_MIN_ACTIVE_PAIRS; slot += 1) {
      expect(sunspotSlotEnabledByCycle(slot, 0)).toBe(true);
      expect(sunspotSlotEnabledByCycle(slot, 1)).toBe(true);
    }
  });

  it('极小期（包络 0）仅极小配额活跃', () => {
    let active = 0;
    for (let slot = 0; slot < SUNSPOT_PAIR_SLOTS; slot += 1) {
      if (sunspotSlotEnabledByCycle(slot, 0)) active += 1;
    }
    expect(active).toBe(SUNSPOT_MIN_ACTIVE_PAIRS);
  });

  it('极大期（包络 1）全部槽位活跃', () => {
    let active = 0;
    for (let slot = 0; slot < SUNSPOT_PAIR_SLOTS; slot += 1) {
      if (sunspotSlotEnabledByCycle(slot, 1)) active += 1;
    }
    expect(active).toBe(SUNSPOT_PAIR_SLOTS);
  });

  it('激活对数随包络单调不减', () => {
    const countAt = (e: number): number => {
      let n = 0;
      for (let slot = 0; slot < SUNSPOT_PAIR_SLOTS; slot += 1) {
        if (sunspotSlotEnabledByCycle(slot, e)) n += 1;
      }
      return n;
    };
    let prev = 0;
    for (let e = 0; e <= 1.0001; e += 0.1) {
      const n = countAt(e);
      expect(n).toBeGreaterThanOrEqual(prev);
      prev = n;
    }
  });

  it('非法槽位抛错', () => {
    expect(() => sunspotSlotEnabledByCycle(-1, 0.5)).toThrow(RangeError);
    expect(() => sunspotSlotEnabledByCycle(SUNSPOT_PAIR_SLOTS, 0.5)).toThrow(RangeError);
  });
});

describe('渲染填充随周期变化（fillSunspotShaderData）', () => {
  const scan = (simDaysBase: number): number => {
    // 在一个槽位基础周期窗口内扫描，取观察到的最大活跃黑子数
    const dirs = new Float32Array(SUNSPOT_MAX_RENDERED * 3);
    const params = new Float32Array(SUNSPOT_MAX_RENDERED * 3);
    let maxSpots = 0;
    for (let d = 0; d < 400; d += 3) {
      const n = fillSunspotShaderData(simDaysBase + d, dirs, params);
      if (n > maxSpots) maxSpots = n;
    }
    return maxSpots;
  };

  it('极大期附近观察到的黑子数多于极小期', () => {
    const minDays = SOLAR_CYCLE_25_MIN_SIMDAYS;
    const maxDays = SOLAR_CYCLE_25_MIN_SIMDAYS + SOLAR_CYCLE_LENGTH_DAYS * RISE_PHASE_FRACTION;
    expect(scan(maxDays)).toBeGreaterThan(scan(minDays));
  });
});

describe('蝴蝶图纬度迁移（fillSunspotShaderData 生成纬度）', () => {
  const maxAbsLatDeg = (simDaysBase: number): number => {
    const dirs = new Float32Array(SUNSPOT_MAX_RENDERED * 3);
    const params = new Float32Array(SUNSPOT_MAX_RENDERED * 3);
    let maxLat = 0;
    for (let d = 0; d < 300; d += 2) {
      const n = fillSunspotShaderData(simDaysBase + d, dirs, params);
      for (let i = 0; i < n; i += 1) {
        // 方向 y = sin(lat)
        const y = dirs[i * 3 + 1];
        const latDeg = (Math.abs(Math.asin(Math.min(1, Math.max(-1, y)))) * 180) / Math.PI;
        if (latDeg > maxLat) maxLat = latDeg;
      }
    }
    return maxLat;
  };

  it('周期早期黑子纬度高于周期晚期（向赤道迁移）', () => {
    const early = SOLAR_CYCLE_25_MIN_SIMDAYS + SOLAR_CYCLE_LENGTH_DAYS * 0.1;
    const late = SOLAR_CYCLE_25_MIN_SIMDAYS + SOLAR_CYCLE_LENGTH_DAYS * 0.9;
    expect(maxAbsLatDeg(early)).toBeGreaterThan(maxAbsLatDeg(late));
  });

  it('所有生成纬度不超过纬度带上限', () => {
    const early = SOLAR_CYCLE_25_MIN_SIMDAYS + SOLAR_CYCLE_LENGTH_DAYS * 0.15;
    expect(maxAbsLatDeg(early)).toBeLessThanOrEqual(SUNSPOT_MAX_LAT_DEG + 1e-6);
  });
});

describe('filamentDarkening（暗条日面投影）', () => {
  it('中性线外（沿线位置越界）无暗化', () => {
    expect(filamentDarkening(0, -0.1, 1)).toBe(1);
    expect(filamentDarkening(0, 1.1, 1)).toBe(1);
  });

  it('横向超出半宽无暗化', () => {
    expect(filamentDarkening(FILAMENT_HALF_WIDTH_RAD, 0.5, 1)).toBe(1);
    expect(filamentDarkening(FILAMENT_HALF_WIDTH_RAD * 2, 0.5, 1)).toBe(1);
  });

  it('线心（中点、横距 0）最暗', () => {
    const v = filamentDarkening(0, 0.5, 1);
    expect(v).toBeCloseTo(FILAMENT_MIN_BRIGHTNESS, 6);
  });

  it('横向从线心向外变亮', () => {
    const center = filamentDarkening(0, 0.5, 1);
    const off = filamentDarkening(FILAMENT_HALF_WIDTH_RAD * 0.5, 0.5, 1);
    expect(off).toBeGreaterThan(center);
  });

  it('强度为 0 时无暗化', () => {
    expect(filamentDarkening(0, 0.5, 0)).toBe(1);
  });
});

describe('sunspotEarthCount（可容纳地球数）', () => {
  it('半径越大容纳地球越多（单调）', () => {
    expect(sunspotEarthCount(0.13)).toBeGreaterThan(sunspotEarthCount(0.06));
  });

  it('用放大前真实尺寸换算（除以放大倍数）', () => {
    // N = (R☉·(rendered/exagg) / R⊕)²
    const rendered = 0.1;
    const realRad = rendered / SUNSPOT_SIZE_EXAGGERATION;
    const expected = Math.pow((SUN_RADIUS_KM * realRad) / EARTH_RADIUS_KM, 2);
    expect(sunspotEarthCount(rendered)).toBeCloseTo(expected, 4);
  });

  it('典型大黑子容纳数为数十至上百个地球量级', () => {
    // 渲染 0.13 rad → 真实 ~0.052 rad → 日面线半径 ~36,000 km → ~32 个地球
    const n = sunspotEarthCount(0.13);
    expect(n).toBeGreaterThan(10);
    expect(n).toBeLessThan(1000);
  });

  it('非正半径抛错', () => {
    expect(() => sunspotEarthCount(0)).toThrow(RangeError);
  });
});
