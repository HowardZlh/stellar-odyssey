/**
 * 真实比例模式测试（需求 4.1：视觉夸大的真实比例开关，P2）
 */

import {
  AU_KM,
  SCENE_UNITS_PER_AU,
  bodyDisplayRadius,
  kmToSceneUnits,
  realBodyRadius,
  visualBodyRadius,
} from '@/utils/scale';
import {
  ringDisplayRadii,
  satelliteBodyDisplayRadius,
  satelliteOrbitDisplayRadius,
  visualRingRadii,
  visualSatelliteBodyRadius,
  visualSatelliteOrbitRadius,
} from '@/utils/satellites';

const EARTH_RADIUS_KM = 6371;
const JUPITER_RADIUS_KM = 69911;
const SUN_RADIUS_KM = 696340;

describe('kmToSceneUnits / realBodyRadius', () => {
  it('1 AU 的千米数映射为 10 场景单位（与轨道映射一致）', () => {
    expect(kmToSceneUnits(AU_KM)).toBeCloseTo(SCENE_UNITS_PER_AU, 9);
  });

  it('地球真实半径约 4.26e-4 场景单位（线性真实映射）', () => {
    expect(realBodyRadius(EARTH_RADIUS_KM)).toBeCloseTo(
      (EARTH_RADIUS_KM / AU_KM) * SCENE_UNITS_PER_AU,
      12,
    );
  });

  it('真实比例保持精确比值（地球:木星 = 真实半径比）', () => {
    expect(realBodyRadius(JUPITER_RADIUS_KM) / realBodyRadius(EARTH_RADIUS_KM)).toBeCloseTo(
      JUPITER_RADIUS_KM / EARTH_RADIUS_KM,
      9,
    );
  });

  it('相对大小关系保持：太阳 > 木星 > 地球', () => {
    expect(realBodyRadius(SUN_RADIUS_KM)).toBeGreaterThan(realBodyRadius(JUPITER_RADIUS_KM));
    expect(realBodyRadius(JUPITER_RADIUS_KM)).toBeGreaterThan(realBodyRadius(EARTH_RADIUS_KM));
  });

  it('半径非正抛出 RangeError', () => {
    expect(() => realBodyRadius(0)).toThrow(RangeError);
    expect(() => realBodyRadius(-100)).toThrow(RangeError);
  });
});

describe('bodyDisplayRadius 统一入口', () => {
  it('真实模式用线性映射，普通模式用对数压缩', () => {
    expect(bodyDisplayRadius(EARTH_RADIUS_KM, true)).toBe(realBodyRadius(EARTH_RADIUS_KM));
    expect(bodyDisplayRadius(EARTH_RADIUS_KM, false)).toBe(visualBodyRadius(EARTH_RADIUS_KM));
  });

  it('真实模式下地球远小于视觉模式（科学事实：真实比例接近不可见）', () => {
    expect(bodyDisplayRadius(EARTH_RADIUS_KM, true)).toBeLessThan(
      bodyDisplayRadius(EARTH_RADIUS_KM, false) / 100,
    );
  });
});

describe('卫星轨道真实比例（satelliteOrbitDisplayRadius）', () => {
  it('真实模式：月球轨道 38.44 万 km 线性映射', () => {
    expect(satelliteOrbitDisplayRadius('natural', EARTH_RADIUS_KM, 384400, true)).toBeCloseTo(
      kmToSceneUnits(384400),
      12,
    );
  });

  it('真实模式：ISS 轨道（半长轴 6771 km）大于地球真实半径（贴近表面）', () => {
    const orbit = satelliteOrbitDisplayRadius('artificial', EARTH_RADIUS_KM, 6771, true);
    expect(orbit).toBeGreaterThan(realBodyRadius(EARTH_RADIUS_KM));
    // 轨道高度约 400 km ≈ 地球半径的 6%
    expect(orbit / realBodyRadius(EARTH_RADIUS_KM)).toBeCloseTo(6771 / EARTH_RADIUS_KM, 6);
  });

  it('普通模式透传分层缩放策略', () => {
    expect(satelliteOrbitDisplayRadius('natural', EARTH_RADIUS_KM, 384400, false)).toBe(
      visualSatelliteOrbitRadius('natural', EARTH_RADIUS_KM, 384400),
    );
  });

  it('真实模式：半长轴不大于行星半径抛出 RangeError', () => {
    expect(() => satelliteOrbitDisplayRadius('natural', EARTH_RADIUS_KM, 6000, true)).toThrow(
      RangeError,
    );
  });

  it('真实模式保持月球与 ISS 的巨大高度差（分层缩放的真实对照）', () => {
    const moonOrbit = satelliteOrbitDisplayRadius('natural', EARTH_RADIUS_KM, 384400, true);
    const issOrbit = satelliteOrbitDisplayRadius('artificial', EARTH_RADIUS_KM, 6771, true);
    expect(moonOrbit / issOrbit).toBeCloseTo(384400 / 6771, 6);
  });
});

describe('卫星本体真实比例（satelliteBodyDisplayRadius）', () => {
  it('真实模式：自然卫星按真实半径线性映射', () => {
    expect(satelliteBodyDisplayRadius('natural', 1737, true)).toBe(realBodyRadius(1737));
  });

  it('真实模式：人造卫星同样按线性映射（真实尺寸不可见，如实呈现）', () => {
    const radius = satelliteBodyDisplayRadius('artificial', 0.05, true);
    expect(radius).toBeCloseTo(kmToSceneUnits(0.05), 15);
    expect(radius).toBeLessThan(1e-7);
  });

  it('普通模式透传视觉映射', () => {
    expect(satelliteBodyDisplayRadius('natural', 1737, false)).toBe(
      visualSatelliteBodyRadius('natural', 1737),
    );
    expect(satelliteBodyDisplayRadius('artificial', 0.05, false)).toBe(
      visualSatelliteBodyRadius('artificial', 0.05),
    );
  });

  it('真实模式：半径非正抛出 RangeError', () => {
    expect(() => satelliteBodyDisplayRadius('natural', 0, true)).toThrow(RangeError);
  });
});

describe('行星环真实比例（ringDisplayRadii）', () => {
  const SATURN_RADIUS_KM = 58232;
  const RING_INNER_KM = 74500;
  const RING_OUTER_KM = 136780;

  it('真实模式：内外缘按真实半径线性映射', () => {
    const { innerUnits, outerUnits } = ringDisplayRadii(
      SATURN_RADIUS_KM,
      RING_INNER_KM,
      RING_OUTER_KM,
      true,
    );
    expect(innerUnits).toBeCloseTo(kmToSceneUnits(RING_INNER_KM), 12);
    expect(outerUnits).toBeCloseTo(kmToSceneUnits(RING_OUTER_KM), 12);
    expect(outerUnits).toBeGreaterThan(innerUnits);
  });

  it('普通模式透传视觉映射', () => {
    expect(ringDisplayRadii(SATURN_RADIUS_KM, RING_INNER_KM, RING_OUTER_KM, false)).toEqual(
      visualRingRadii(SATURN_RADIUS_KM, RING_INNER_KM, RING_OUTER_KM),
    );
  });

  it('真实模式：外缘不大于内缘抛出 RangeError', () => {
    expect(() => ringDisplayRadii(SATURN_RADIUS_KM, 100000, 90000, true)).toThrow(RangeError);
  });
});
