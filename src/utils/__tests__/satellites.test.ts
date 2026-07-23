/**
 * 卫星视觉尺度策略测试（需求 3.1.1 分层缩放）
 */

import {
  ARTIFICIAL_BODY_VISUAL_RADIUS,
  ARTIFICIAL_ORBIT_BASE_UNITS,
  ARTIFICIAL_ORBIT_LEO_MIN_KM,
  ARTIFICIAL_ORBIT_LEO_SLOPE_PER_KM,
  ARTIFICIAL_ORBIT_LOG_UNITS,
  MIN_MOON_VISUAL_RADIUS,
  NATURAL_ORBIT_BASE_UNITS,
  NATURAL_ORBIT_LOG_UNITS,
  NATURAL_ORBIT_REF_KM,
  RING_WIDTH_SPREAD,
  tidalLockedRotationAngle,
  visualRingRadii,
  visualSatelliteBodyRadius,
  visualSatelliteOrbitRadius,
} from '@/utils/satellites';
import { visualBodyRadius } from '@/utils/scale';

const EARTH_RADIUS_KM = 6371;
const JUPITER_RADIUS_KM = 69911;
const SATURN_RADIUS_KM = 58232;

describe('分层缩放参数（登记的视觉夸大）', () => {
  it('公式参数与登记值一致，且自然/人造分层明显', () => {
    expect(NATURAL_ORBIT_BASE_UNITS).toBe(0.6);
    expect(NATURAL_ORBIT_LOG_UNITS).toBe(1.2);
    expect(NATURAL_ORBIT_REF_KM).toBe(100000);
    expect(ARTIFICIAL_ORBIT_BASE_UNITS).toBe(0.15);
    // P7 分段映射：近地段线性斜率 + 600 km 以上对数压缩（登记于文件头）
    expect(ARTIFICIAL_ORBIT_LEO_SLOPE_PER_KM).toBe(0.0025);
    expect(ARTIFICIAL_ORBIT_LEO_MIN_KM).toBe(200);
    expect(ARTIFICIAL_ORBIT_LOG_UNITS).toBe(0.1);
    expect(RING_WIDTH_SPREAD).toBe(2);
    // 自然卫星基础偏移大于人造卫星（分层策略）
    expect(NATURAL_ORBIT_BASE_UNITS).toBeGreaterThan(ARTIFICIAL_ORBIT_BASE_UNITS);
  });
});

describe('visualSatelliteOrbitRadius', () => {
  it('轨道半径必须大于行星半径，否则抛错', () => {
    expect(() => visualSatelliteOrbitRadius('natural', 6371, 6000)).toThrow(RangeError);
    expect(() => visualSatelliteOrbitRadius('artificial', 6371, 6371)).toThrow(RangeError);
  });

  it('人造卫星贴近行星表面，且与月球轨道明显分层（400km vs 38万km）', () => {
    const earthVisual = visualBodyRadius(EARTH_RADIUS_KM);
    const iss = visualSatelliteOrbitRadius('artificial', EARTH_RADIUS_KM, 6788);
    const hubble = visualSatelliteOrbitRadius('artificial', EARTH_RADIUS_KM, 6911);
    const moon = visualSatelliteOrbitRadius('natural', EARTH_RADIUS_KM, 384400);

    // 人造卫星在行星表面外、但明显低于月球轨道
    expect(iss).toBeGreaterThan(earthVisual);
    expect(hubble).toBeGreaterThan(iss); // 哈勃 540km > ISS 400km
    expect(moon).toBeGreaterThan(iss + 0.5); // 分层策略
  });

  it('自然卫星轨道排序与真实半长轴一致（伽利略卫星）', () => {
    const io = visualSatelliteOrbitRadius('natural', JUPITER_RADIUS_KM, 421800);
    const europa = visualSatelliteOrbitRadius('natural', JUPITER_RADIUS_KM, 671100);
    const ganymede = visualSatelliteOrbitRadius('natural', JUPITER_RADIUS_KM, 1070400);
    const callisto = visualSatelliteOrbitRadius('natural', JUPITER_RADIUS_KM, 1882700);
    expect(europa).toBeGreaterThan(io);
    expect(ganymede).toBeGreaterThan(europa);
    expect(callisto).toBeGreaterThan(ganymede);
    // 全部在木星视觉半径之外
    expect(io).toBeGreaterThan(visualBodyRadius(JUPITER_RADIUS_KM));
  });
});

describe('visualSatelliteBodyRadius', () => {
  it('人造卫星缺省 spanMeters 时使用固定示意尺寸（兜底）', () => {
    expect(visualSatelliteBodyRadius('artificial', 0.055)).toBe(ARTIFICIAL_BODY_VISUAL_RADIUS);
  });

  it('自然卫星按对数压缩且有下限', () => {
    const moon = visualSatelliteBodyRadius('natural', 1737.4);
    const enceladus = visualSatelliteBodyRadius('natural', 252.1);
    expect(moon).toBeGreaterThan(enceladus);
    expect(enceladus).toBeGreaterThanOrEqual(MIN_MOON_VISUAL_RADIUS);
    // 卫星应小于其行星
    expect(moon).toBeLessThan(visualBodyRadius(EARTH_RADIUS_KM));
  });

  it('非法半径抛错', () => {
    expect(() => visualSatelliteBodyRadius('natural', 0)).toThrow(RangeError);
    expect(() => visualSatelliteBodyRadius('natural', -1)).toThrow(RangeError);
  });
});

describe('visualRingRadii（土星环）', () => {
  it('内缘小于外缘，且环外卫星（土卫二 238,040 km）仍在环外', () => {
    const { innerUnits, outerUnits } = visualRingRadii(SATURN_RADIUS_KM, 74500, 140220);
    expect(innerUnits).toBeLessThan(outerUnits);
    expect(innerUnits).toBeGreaterThan(visualBodyRadius(SATURN_RADIUS_KM));
    const enceladus = visualSatelliteOrbitRadius('natural', SATURN_RADIUS_KM, 238040);
    expect(enceladus).toBeGreaterThan(outerUnits);
  });

  it('非法半径抛错', () => {
    expect(() => visualRingRadii(SATURN_RADIUS_KM, 140220, 74500)).toThrow(RangeError);
  });
});

describe('tidalLockedRotationAngle（潮汐锁定）', () => {
  it('自转角随轨道相位同步（始终同一面朝向行星）', () => {
    expect(tidalLockedRotationAngle(0)).toBeCloseTo(Math.PI, 10);
    expect(tidalLockedRotationAngle(Math.PI / 2) - tidalLockedRotationAngle(0)).toBeCloseTo(
      Math.PI / 2,
      10,
    );
  });
});
