/**
 * 时间系统单元测试（需求 3.3）
 */

import {
  MAX_SPEED_MULTIPLIER,
  TIME_COMPRESSION,
  advanceSimTime,
  clampSpeedMultiplier,
  formatSimDate,
  formatSimDateParts,
  interpolateTimeCompression,
  simDaysToDate,
} from '@/utils/time';
import { J2000_EPOCH_MS } from '@/utils/physics';

describe('TIME_COMPRESSION（需求第2节压缩比）', () => {
  it('L1 为小时级（1秒 ≈ 4小时）', () => {
    expect(TIME_COMPRESSION.L1).toBe(4 * 3600);
  });

  it('L2 为天级（1秒 ≈ 4天）', () => {
    expect(TIME_COMPRESSION.L2).toBe(4 * 86400);
  });

  it('层级越外压缩比越大：L1 < L2 < L3 < L4', () => {
    expect(TIME_COMPRESSION.L1).toBeLessThan(TIME_COMPRESSION.L2);
    expect(TIME_COMPRESSION.L2).toBeLessThan(TIME_COMPRESSION.L3);
    expect(TIME_COMPRESSION.L3).toBeLessThan(TIME_COMPRESSION.L4);
  });

  it('L3 为百万年级、L4 为千万年级', () => {
    expect(TIME_COMPRESSION.L3 / (365.25 * 86400)).toBeGreaterThanOrEqual(1e6);
    expect(TIME_COMPRESSION.L4 / (365.25 * 86400)).toBeGreaterThanOrEqual(1e7);
  });
});

describe('advanceSimTime', () => {
  it('L2 视角 1 真实秒推进 4 个模拟天', () => {
    expect(advanceSimTime(100, 1, 'L2', 1, false)).toBeCloseTo(104, 10);
  });

  it('L1 视角 1 真实秒推进 4 模拟小时', () => {
    expect(advanceSimTime(0, 1, 'L1', 1, false)).toBeCloseTo(4 / 24, 10);
  });

  it('暂停时时间不变', () => {
    expect(advanceSimTime(100, 1, 'L2', 1, true)).toBe(100);
  });

  it('速度倍率生效', () => {
    expect(advanceSimTime(0, 1, 'L2', 2, false)).toBeCloseTo(8, 10);
  });

  it('倍率为 0 等效暂停', () => {
    expect(advanceSimTime(50, 1, 'L2', 0, false)).toBe(50);
  });

  it('超出范围的倍率被钳制', () => {
    expect(advanceSimTime(0, 1, 'L2', 1e9, false)).toBeCloseTo(4 * MAX_SPEED_MULTIPLIER, 8);
  });

  it('负时间增量抛出异常', () => {
    expect(() => advanceSimTime(0, -1, 'L2', 1, false)).toThrow(RangeError);
  });
});

describe('clampSpeedMultiplier', () => {
  it('范围内保持不变', () => {
    expect(clampSpeedMultiplier(5)).toBe(5);
  });

  it('钳制上下界', () => {
    expect(clampSpeedMultiplier(1e6)).toBe(MAX_SPEED_MULTIPLIER);
    expect(clampSpeedMultiplier(-3)).toBe(0);
  });

  it('NaN 回退为 1', () => {
    expect(clampSpeedMultiplier(NaN)).toBe(1);
  });
});

describe('interpolateTimeCompression（跨层级平滑插值）', () => {
  /** 大数值用相对误差比较（对数空间往返有浮点误差） */
  const expectRelativeClose = (actual: number, expected: number): void => {
    expect(Math.abs(actual - expected) / expected).toBeLessThan(1e-9);
  };

  it('端点值等于各层级压缩比', () => {
    expectRelativeClose(interpolateTimeCompression('L2', 'L3', 0), TIME_COMPRESSION.L2);
    expectRelativeClose(interpolateTimeCompression('L2', 'L3', 1), TIME_COMPRESSION.L3);
  });

  it('中点为对数空间几何平均（避免数量级跳变）', () => {
    const mid = interpolateTimeCompression('L2', 'L3', 0.5);
    expectRelativeClose(mid, Math.sqrt(TIME_COMPRESSION.L2 * TIME_COMPRESSION.L3));
  });

  it('进度越界被钳制', () => {
    expectRelativeClose(interpolateTimeCompression('L1', 'L2', -1), TIME_COMPRESSION.L1);
    expectRelativeClose(interpolateTimeCompression('L1', 'L2', 2), TIME_COMPRESSION.L2);
  });
});

describe('simDaysToDate / formatSimDate(Parts)', () => {
  it('第 0 天为 J2000 历元（2000-01-01 12:00 UTC）', () => {
    expect(simDaysToDate(0).getTime()).toBe(J2000_EPOCH_MS);
    expect(formatSimDate(0)).toBe('2000-01-01 12:00 UTC');
  });

  it('正常范围内输出 UTC 日期，历元副行为 null', () => {
    expect(formatSimDate(366)).toBe('2001-01-01 12:00 UTC');
    expect(formatSimDateParts(366)).toEqual({ primary: '2001-01-01 12:00 UTC', epoch: null });
  });

  it('大时间尺度中文主行为"距今约 N 万年后"（千分组），副行保留 J2000 历元', () => {
    const parts = formatSimDateParts(42.73e6 * 365.25);
    expect(parts.primary).toBe('距今约 4,273 万年后');
    expect(parts.epoch).toBe('J2000 + 42.73 Myr');
  });

  it('中文 ≥1 亿年切换亿年档（<100 亿保留 1 位小数）', () => {
    const parts = formatSimDateParts(1e9 * 365.25);
    expect(parts.primary).toBe('距今约 10.0 亿年后');
    expect(parts.epoch).toBe('J2000 + 1000.00 Myr');
  });

  it('中文 ≥100 亿年取整并千分组', () => {
    expect(formatSimDateParts(2.5e10 * 365.25).primary).toBe('距今约 250 亿年后');
  });

  it('负的超大时间为"距今约 … 前"，历元副行带负号', () => {
    const parts = formatSimDateParts(-1e9 * 365.25);
    expect(parts.primary).toBe('距今约 10.0 亿年前');
    expect(parts.epoch).toBe('J2000 − 1000.00 Myr');
  });

  it('英文主行按 years/million/billion 自适应', () => {
    expect(formatSimDateParts(3e5 * 365.25, 'en').primary).toBe('~300,000 years from now');
    expect(formatSimDateParts(42.73e6 * 365.25, 'en').primary).toBe(
      '~42.7 million years from now',
    );
    expect(formatSimDateParts(5e8 * 365.25, 'en').primary).toBe('~500 million years from now');
    expect(formatSimDateParts(2e9 * 365.25, 'en').primary).toBe('~2.00 billion years from now');
    expect(formatSimDateParts(2e11 * 365.25, 'en').primary).toBe(
      '~200 billion years from now',
    );
  });

  it('英文过去时间为 "~… ago"', () => {
    expect(formatSimDateParts(-42.73e6 * 365.25, 'en').primary).toBe(
      '~42.7 million years ago',
    );
  });

  it('formatSimDate 单行兼容入口 = 两段式主行', () => {
    expect(formatSimDate(1e9 * 365.25)).toBe('距今约 10.0 亿年后');
    expect(formatSimDate(1e9 * 365.25, 'en')).toBe('~1.00 billion years from now');
  });
});
