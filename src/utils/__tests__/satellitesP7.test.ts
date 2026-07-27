/**
 * P7 卫星差异化尺寸/轨道分层/近观放大测试（§3.2）
 */

import { getMoonById } from '@/data/moons';
import {
  ARTIFICIAL_BODY_BASE_UNITS,
  ARTIFICIAL_BODY_LOG_UNITS,
  ARTIFICIAL_BODY_REF_SPAN_M,
  SATELLITE_MAG_FULL_DISTANCE,
  SATELLITE_MAG_NONE_DISTANCE,
  SATELLITE_NEAR_MAGNIFICATION,
  satelliteBodyDisplayRadius,
  satelliteNearMagnification,
  visualSatelliteBodyRadius,
  visualSatelliteOrbitRadius,
} from '@/utils/satellites';
import { realBodyRadius } from '@/utils/scale';

const EARTH_RADIUS_KM = 6371;

function bodyRadiusOf(id: string): number {
  const m = getMoonById(id)!;
  return visualSatelliteBodyRadius(m.kind, m.radiusKm, m.spanMeters);
}

function orbitRadiusOf(id: string): number {
  const m = getMoonById(id)!;
  return visualSatelliteOrbitRadius(m.kind, EARTH_RADIUS_KM, m.orbit.semiMajorAxisKm);
}

describe('差异化尺寸映射（P7 §3.2：按 spanMeters 对数分级）', () => {
  it('视觉大小层次：ISS > 天宫 > TDRS > 哈勃', () => {
    const iss = bodyRadiusOf('iss');
    const tiangong = bodyRadiusOf('tiangong');
    const tdrs = bodyRadiusOf('geo-satellite');
    const hubble = bodyRadiusOf('hubble');
    expect(iss).toBeGreaterThan(tiangong);
    expect(tiangong).toBeGreaterThan(tdrs);
    expect(tdrs).toBeGreaterThan(hubble);
    // 层次可辨：最大与最小差异明显（>50%）
    expect(iss / hubble).toBeGreaterThan(1.5);
  });

  it('映射公式与登记参数一致', () => {
    const expected =
      ARTIFICIAL_BODY_BASE_UNITS +
      ARTIFICIAL_BODY_LOG_UNITS * Math.log10(1 + 109 / ARTIFICIAL_BODY_REF_SPAN_M);
    expect(bodyRadiusOf('iss')).toBeCloseTo(expected, 10);
  });

  it('非法 spanMeters 抛错', () => {
    expect(() => visualSatelliteBodyRadius('artificial', 0.055, 0)).toThrow(RangeError);
    expect(() => visualSatelliteBodyRadius('artificial', 0.055, NaN)).toThrow(RangeError);
  });

  it('真实比例模式：按真实尺寸线性映射（不可见属科学事实，P7 策略登记）', () => {
    const m = getMoonById('iss')!;
    const real = satelliteBodyDisplayRadius(m.kind, m.radiusKm, true, m.spanMeters);
    expect(real).toBeCloseTo(realBodyRadius(m.radiusKm), 12);
    expect(real).toBeLessThan(1e-6); // 远小于可见尺寸
    // 默认模式恢复差异化示意尺寸
    expect(satelliteBodyDisplayRadius(m.kind, m.radiusKm, false, m.spanMeters)).toBeCloseTo(
      bodyRadiusOf('iss'),
      12,
    );
  });
});

describe('轨道分层（P7 §3.2：天宫与 ISS 不重叠可辨）', () => {
  it('分层顺序：天宫(390) < ISS(417) < 哈勃(540) < 静止轨道(35786) < 月球', () => {
    const tiangong = orbitRadiusOf('tiangong');
    const iss = orbitRadiusOf('iss');
    const hubble = orbitRadiusOf('hubble');
    const geo = orbitRadiusOf('geo-satellite');
    const moon = orbitRadiusOf('moon');
    expect(tiangong).toBeLessThan(iss);
    expect(iss).toBeLessThan(hubble);
    expect(hubble).toBeLessThan(geo);
    expect(geo).toBeLessThan(moon);
  });

  it('天宫与 ISS 轨道径向间隔 ≥ 0.05 场景单位（可辨不重叠）', () => {
    const gap = orbitRadiusOf('iss') - orbitRadiusOf('tiangong');
    expect(gap).toBeGreaterThanOrEqual(0.05);
  });

  it('静止轨道明显低于月球轨道层（分层保持）', () => {
    expect(orbitRadiusOf('moon') - orbitRadiusOf('geo-satellite')).toBeGreaterThan(0.1);
  });
});

describe('近观放大系数（P7 §3.1，登记的视觉夸大）', () => {
  it('远观（≥6 单位）不放大，贴近（≤2.2 单位）达最大倍数', () => {
    expect(satelliteNearMagnification(SATELLITE_MAG_NONE_DISTANCE)).toBe(1);
    expect(satelliteNearMagnification(100)).toBe(1);
    expect(satelliteNearMagnification(SATELLITE_MAG_FULL_DISTANCE)).toBe(
      SATELLITE_NEAR_MAGNIFICATION,
    );
    expect(satelliteNearMagnification(0)).toBe(SATELLITE_NEAR_MAGNIFICATION);
  });

  it('中间距离平滑单调递减（无跳变）', () => {
    let prev = satelliteNearMagnification(2.2);
    for (let d = 2.4; d < 6; d += 0.2) {
      const cur = satelliteNearMagnification(d);
      expect(cur).toBeLessThan(prev);
      expect(cur).toBeGreaterThanOrEqual(1);
      prev = cur;
    }
  });

  it('非法距离抛错', () => {
    expect(() => satelliteNearMagnification(-1)).toThrow(RangeError);
    expect(() => satelliteNearMagnification(NaN)).toThrow(RangeError);
  });
});
