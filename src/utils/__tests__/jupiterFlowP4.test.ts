/**
 * 木星云层差速流动测试（P4，需求 §4.7 气态行星动态细节）
 */

import {
  EQUATORIAL_JET_RATE,
  FLOW_VISUAL_GAIN,
  TEMPERATE_JET_RATE,
  jovianDriftRate,
  jovianFlowUvOffset,
  latitudeFromV,
} from '@/utils/jupiterFlow';

const DEG = Math.PI / 180;

describe('纬向漂移速率剖面（真实大气环流带结构）', () => {
  it('赤道急流最快且为东向（System I 超前）', () => {
    const equator = jovianDriftRate(0);
    expect(equator).toBeCloseTo(EQUATORIAL_JET_RATE, 3);
    // 赤道为全剖面最大值
    for (let lat = -90; lat <= 90; lat += 3) {
      expect(jovianDriftRate(lat * DEG)).toBeLessThanOrEqual(equator + 1e-9);
    }
  });

  it('温带（±24° 附近）出现反向（西向）急流', () => {
    expect(jovianDriftRate(24 * DEG)).toBeLessThan(0);
    expect(jovianDriftRate(-24 * DEG)).toBeLessThan(0);
  });

  it('高纬（±42° 附近）出现较弱东向急流（交替带结构）', () => {
    expect(jovianDriftRate(42 * DEG)).toBeGreaterThan(0);
    expect(jovianDriftRate(42 * DEG)).toBeLessThan(jovianDriftRate(0));
  });

  it('剖面南北对称', () => {
    for (let lat = 0; lat <= 90; lat += 5) {
      expect(jovianDriftRate(lat * DEG)).toBeCloseTo(jovianDriftRate(-lat * DEG), 10);
    }
  });

  it('速率量级与真实一致（|漂移| ≤ 赤道急流 0.8%）', () => {
    for (let lat = -90; lat <= 90; lat += 1) {
      expect(Math.abs(jovianDriftRate(lat * DEG))).toBeLessThanOrEqual(EQUATORIAL_JET_RATE);
    }
    expect(TEMPERATE_JET_RATE).toBeLessThan(EQUATORIAL_JET_RATE);
  });

  it('非法纬度抛错', () => {
    expect(() => jovianDriftRate(Number.NaN)).toThrow(RangeError);
  });
});

describe('UV 漂移量（shader 镜像）', () => {
  it('漂移量 = −速率·相位/2π（东向漂移 U 减小）', () => {
    const phase = Math.PI * 4; // 两圈自转
    expect(jovianFlowUvOffset(0, phase)).toBeCloseTo(-EQUATORIAL_JET_RATE * 2);
  });

  it('相位 0 时无漂移', () => {
    expect(jovianFlowUvOffset(0.3, 0)).toBe(0);
  });

  it('赤道与温带反向漂移（差速剪切可辨识）', () => {
    const phase = Math.PI * 20;
    const eq = jovianFlowUvOffset(0, phase);
    const temperate = jovianFlowUvOffset(24 * DEG, phase);
    expect(eq * temperate).toBeLessThan(0);
  });
});

describe('纬度换算与视觉增益', () => {
  it('UV.y → 纬度：0.5 为赤道，0/1 为南北极', () => {
    expect(latitudeFromV(0.5)).toBe(0);
    expect(latitudeFromV(1)).toBeCloseTo(Math.PI / 2);
    expect(latitudeFromV(0)).toBeCloseTo(-Math.PI / 2);
    expect(latitudeFromV(2)).toBeCloseTo(Math.PI / 2); // 越界钳制
  });

  it('视觉增益为有限正数（艺术化登记：剖面结构真实、相位放大便于观察）', () => {
    expect(FLOW_VISUAL_GAIN).toBeGreaterThan(1);
    expect(FLOW_VISUAL_GAIN).toBeLessThanOrEqual(10);
  });
});
