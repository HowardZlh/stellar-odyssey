/**
 * 行星近观细节门控与光照细节测试（P4，需求 §4.7）
 */

import {
  DETAIL_LEVEL_CEILING,
  DETAIL_LRU_CAPACITY,
  bandDetailBoost,
  detailEnterDistance,
  detailExitDistance,
  detailGateUpdate,
  detailStrength01,
  reliefFactor,
  sphereTangent,
  waterMask,
} from '@/utils/planetDetail';

describe('近观阈值（需求 4.7 分级门控）', () => {
  it('进入阈值 = max(6, 半径×8)，与飞抵观察距离（半径×6）衔接', () => {
    expect(detailEnterDistance(0.62)).toBe(6); // 地球：飞抵距离 3.7 < 6 ✓
    expect(detailEnterDistance(1.56)).toBeCloseTo(12.48); // 木星：飞抵 9.4 < 12.5 ✓
  });

  it('退出阈值高于进入阈值 40%（滞回防抖）', () => {
    expect(detailExitDistance(1)).toBeCloseTo(detailEnterDistance(1) * 1.4);
  });

  it('非法半径抛错', () => {
    expect(() => detailEnterDistance(0)).toThrow(RangeError);
    expect(() => detailEnterDistance(Number.NaN)).toThrow(RangeError);
  });

  it('LRU 容量为 2（显存 ≤300MB 预算的依据）', () => {
    expect(DETAIL_LRU_CAPACITY).toBe(2);
  });
});

describe('门控状态机（滞回 + 层级上限）', () => {
  it('距离进入阈值内且层级在 L1 语境 → 激活', () => {
    expect(detailGateUpdate(false, 4, 1, 1.1)).toEqual({ active: true, releaseNow: false });
  });

  it('距离在进入阈值外 → 保持未激活', () => {
    expect(detailGateUpdate(false, 20, 1, 1.1).active).toBe(false);
  });

  it('滞回：激活后在进入/退出阈值之间保持激活', () => {
    const between = (detailEnterDistance(1) + detailExitDistance(1)) / 2;
    expect(detailGateUpdate(true, between, 1, 1.1).active).toBe(true);
    expect(detailGateUpdate(false, between, 1, 1.1).active).toBe(false);
  });

  it('距离超过退出阈值 → 退出但不立即释放（保留在 LRU）', () => {
    expect(detailGateUpdate(true, 100, 1, 1.1)).toEqual({ active: false, releaseNow: false });
  });

  it('层级离开 L1 语境 → 退出并立即释放显存', () => {
    expect(detailGateUpdate(true, 4, 1, DETAIL_LEVEL_CEILING + 0.1)).toEqual({
      active: false,
      releaseNow: true,
    });
  });

  it('层级超上限时不激活（外层视角不请求 4K）', () => {
    expect(detailGateUpdate(false, 4, 1, 3.5).active).toBe(false);
  });

  it('跟随外行星语境（层级读数 ~2.35）仍可激活', () => {
    expect(detailGateUpdate(false, 4, 1, 2.35).active).toBe(true);
  });
});

describe('细节强度（4K/2K 切换无突变）', () => {
  it('近距全强度、退出阈值处为 0，中间平滑单调递减', () => {
    expect(detailStrength01(1, 1)).toBe(1);
    expect(detailStrength01(detailExitDistance(1), 1)).toBe(0);
    const mid1 = detailStrength01(7, 1);
    const mid2 = detailStrength01(9, 1);
    expect(mid1).toBeGreaterThan(mid2);
    expect(mid1).toBeLessThan(1);
    expect(mid2).toBeGreaterThan(0);
  });
});

describe('法线扰动立体光照因子（reliefFactor）', () => {
  it('强度 0 时退化为 1（不改变现有光照）', () => {
    expect(reliefFactor(0.8, 0.2, 0)).toBe(1);
  });

  it('夜侧（geoNdl ≤ 0）不调制', () => {
    expect(reliefFactor(-0.5, 0.5, 1)).toBe(1);
  });

  it('受光坡面变亮、背光坡面变暗', () => {
    expect(reliefFactor(0.5, 0.75, 1)).toBeGreaterThan(1);
    expect(reliefFactor(0.5, 0.25, 1)).toBeLessThan(1);
  });

  it('比率钳制防过曝（≤1.5 倍）', () => {
    expect(reliefFactor(0.05, 1, 1)).toBeLessThanOrEqual(1.5);
    expect(reliefFactor(0.5, -1, 1)).toBeGreaterThanOrEqual(0);
  });

  it('强度插值：半强度调制幅度减半', () => {
    const full = reliefFactor(0.5, 0.75, 1);
    const half = reliefFactor(0.5, 0.75, 0.5);
    expect(half - 1).toBeCloseTo((full - 1) / 2);
  });
});

describe('海洋水面掩码（地球海洋高光）', () => {
  it('深蓝海洋像素掩码接近 1', () => {
    expect(waterMask(0.05, 0.15, 0.45)).toBeGreaterThan(0.9);
  });

  it('陆地（绿/棕色）掩码为 0', () => {
    expect(waterMask(0.4, 0.5, 0.3)).toBe(0);
    expect(waterMask(0.5, 0.4, 0.35)).toBe(0);
  });

  it('掩码单调且在 [0,1]', () => {
    const low = waterMask(0.2, 0.2, 0.3);
    const high = waterMask(0.2, 0.2, 0.5);
    expect(high).toBeGreaterThanOrEqual(low);
    expect(low).toBeGreaterThanOrEqual(0);
    expect(high).toBeLessThanOrEqual(1);
  });
});

describe('球面 UV 切线（法线贴图 TBN 基）', () => {
  it('赤道点切线沿东向且为单位向量', () => {
    const t = sphereTangent({ x: 1, y: 0, z: 0 });
    expect(t).not.toBeNull();
    expect(t!.x).toBeCloseTo(0);
    expect(t!.y).toBe(0);
    expect(t!.z).toBeCloseTo(-1);
  });

  it('切线与法线正交', () => {
    const n = { x: 0.6, y: 0.5, z: 0.62 };
    const t = sphereTangent(n)!;
    expect(n.x * t.x + n.y * t.y + n.z * t.z).toBeCloseTo(0);
  });

  it('极点退化返回 null', () => {
    expect(sphereTangent({ x: 0, y: 1, z: 0 })).toBeNull();
  });
});

describe('2K 源图程序化细节增强（天王星/海王星差异登记）', () => {
  it('强度 0 时为 1（不改变颜色）', () => {
    expect(bandDetailBoost(0.5, 0)).toBe(1);
  });

  it('幅度不超过 ±1.5%（避免过度艺术化）', () => {
    for (let v = 0; v <= 1; v += 0.01) {
      const boost = bandDetailBoost(v, 1);
      expect(boost).toBeGreaterThanOrEqual(1 - 0.015);
      expect(boost).toBeLessThanOrEqual(1 + 0.015);
    }
  });
});
