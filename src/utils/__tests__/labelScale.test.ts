/**
 * labelScale 单元测试（R3-4 §4.1-A：标签近距反向缩放钳制纯函数）
 */

import {
  LABEL_MIN_DISTANCE_RATIO,
  labelCounterScale,
  labelMinDistance,
  quantizeScale,
} from '@/utils/labelScale';

describe('labelCounterScale：近距反向缩放系数', () => {
  it('距离 ≥ 最小生效距离恒为 1（远距观感零回退）', () => {
    expect(labelCounterScale(30, 30)).toBe(1);
    expect(labelCounterScale(100, 30)).toBe(1);
    expect(labelCounterScale(1e6, 30)).toBe(1);
  });

  it('距离 < 最小生效距离线性收敛（与外层 1/dist 缩放相乘后屏幕尺寸恒定）', () => {
    expect(labelCounterScale(15, 30)).toBeCloseTo(0.5, 10);
    expect(labelCounterScale(3, 30)).toBeCloseTo(0.1, 10);
    expect(labelCounterScale(0, 30)).toBe(0);
  });

  it('边界连续无阶跃（minDistance 处恰为 1）', () => {
    const atBoundary = labelCounterScale(30, 30);
    const justInside = labelCounterScale(30 - 1e-9, 30);
    expect(atBoundary).toBe(1);
    expect(justInside).toBeLessThanOrEqual(1);
    expect(1 - justInside).toBeLessThan(1e-9);
  });

  it('非法输入抛 RangeError（负距离/非有限/非正 minDistance）', () => {
    expect(() => labelCounterScale(-1, 30)).toThrow(RangeError);
    expect(() => labelCounterScale(Number.NaN, 30)).toThrow(RangeError);
    expect(() => labelCounterScale(10, 0)).toThrow(RangeError);
    expect(() => labelCounterScale(10, -5)).toThrow(RangeError);
    expect(() => labelCounterScale(10, Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe('labelMinDistance：distanceFactor → 最小生效距离', () => {
  it('默认比例 0.5（钳制上限 ≈ 设计尺寸 2 倍以内，登记）', () => {
    expect(LABEL_MIN_DISTANCE_RATIO).toBe(0.5);
    expect(labelMinDistance(60)).toBe(30);
    expect(labelMinDistance(2600)).toBe(1300);
    expect(labelMinDistance(12000)).toBe(6000);
  });

  it('自定义比例逐标签可调', () => {
    expect(labelMinDistance(900, 0.2)).toBeCloseTo(180, 10);
    expect(labelMinDistance(16, 1)).toBe(16);
  });

  it('非法输入抛 RangeError', () => {
    expect(() => labelMinDistance(0)).toThrow(RangeError);
    expect(() => labelMinDistance(-60)).toThrow(RangeError);
    expect(() => labelMinDistance(Number.NaN)).toThrow(RangeError);
    expect(() => labelMinDistance(60, 0)).toThrow(RangeError);
    expect(() => labelMinDistance(60, Number.NaN)).toThrow(RangeError);
  });
});

describe('quantizeScale：缩放值量化（3 位小数，样式写入缓存比对用）', () => {
  it('量化到 3 位小数', () => {
    expect(quantizeScale(0.123456)).toBe(0.123);
    expect(quantizeScale(0.9996)).toBe(1);
    expect(quantizeScale(1)).toBe(1);
    expect(quantizeScale(0)).toBe(0);
  });

  it('非有限输入抛 RangeError', () => {
    expect(() => quantizeScale(Number.NaN)).toThrow(RangeError);
    expect(() => quantizeScale(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});
