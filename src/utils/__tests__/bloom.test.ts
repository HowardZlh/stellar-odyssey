/**
 * Bloom 泛光层级强度插值测试（P3-3，需求 §4.6）
 */

import {
  BLOOM_INTENSITY_BY_LEVEL,
  BLOOM_LUMINANCE_SMOOTHING,
  BLOOM_LUMINANCE_THRESHOLD,
  bloomIntensityForLevel,
  effectiveBloomIntensity,
} from '@/utils/bloom';

describe('bloomIntensityForLevel 层级强度插值', () => {
  it('整数层级恰为锚点值', () => {
    expect(bloomIntensityForLevel(1)).toBe(BLOOM_INTENSITY_BY_LEVEL[0]);
    expect(bloomIntensityForLevel(2)).toBe(BLOOM_INTENSITY_BY_LEVEL[1]);
    expect(bloomIntensityForLevel(3)).toBe(BLOOM_INTENSITY_BY_LEVEL[2]);
    expect(bloomIntensityForLevel(4)).toBe(BLOOM_INTENSITY_BY_LEVEL[3]);
  });

  it('L1/L2 较强突出太阳，L3/L4 收敛防止过曝（需求 4.6）', () => {
    expect(bloomIntensityForLevel(1)).toBeGreaterThan(bloomIntensityForLevel(3));
    expect(bloomIntensityForLevel(2)).toBeGreaterThan(bloomIntensityForLevel(4));
  });

  it('层级中点为线性插值（跨层级缩放平滑变化）', () => {
    const mid = bloomIntensityForLevel(2.5);
    expect(mid).toBeCloseTo(
      (BLOOM_INTENSITY_BY_LEVEL[1] + BLOOM_INTENSITY_BY_LEVEL[2]) / 2,
    );
  });

  it('超界层级钳制到 [1, 4]', () => {
    expect(bloomIntensityForLevel(0)).toBe(BLOOM_INTENSITY_BY_LEVEL[0]);
    expect(bloomIntensityForLevel(9)).toBe(BLOOM_INTENSITY_BY_LEVEL[3]);
  });

  it('强度随层级单调不增（无中途反弹）', () => {
    let prev = Number.POSITIVE_INFINITY;
    for (let f = 1; f <= 4; f += 0.1) {
      const v = bloomIntensityForLevel(f);
      expect(v).toBeLessThanOrEqual(prev + 1e-9);
      prev = v;
    }
  });
});

describe('effectiveBloomIntensity 开关联动', () => {
  it('开关开启时等于层级强度', () => {
    expect(effectiveBloomIntensity(2, true)).toBe(bloomIntensityForLevel(2));
  });

  it('开关关闭时为 0（控制面板"泛光效果"开关）', () => {
    expect(effectiveBloomIntensity(2, false)).toBe(0);
    expect(effectiveBloomIntensity(4, false)).toBe(0);
  });
});

describe('选择性发光参数', () => {
  it('亮度阈值在 (0, 1) 内（仅高亮发光体参与泛光）', () => {
    expect(BLOOM_LUMINANCE_THRESHOLD).toBeGreaterThan(0);
    expect(BLOOM_LUMINANCE_THRESHOLD).toBeLessThan(1);
  });

  it('阈值平滑宽度为正值（发光边缘无硬切）', () => {
    expect(BLOOM_LUMINANCE_SMOOTHING).toBeGreaterThan(0);
  });
});
