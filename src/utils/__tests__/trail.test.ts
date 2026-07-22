/**
 * 历史尾迹环形缓冲测试（需求 4.3：尾迹长度有限、内存不增长、无坐标残留）
 */

import {
  clearTrail,
  createTrailBuffer,
  pushTrailPoint,
  trailToOrderedArray,
} from '@/utils/trail';

describe('createTrailBuffer', () => {
  it('创建固定容量缓冲', () => {
    const buf = createTrailBuffer(8);
    expect(buf.capacity).toBe(8);
    expect(buf.count).toBe(0);
    expect(buf.data).toHaveLength(24);
  });

  it('非法容量抛错', () => {
    expect(() => createTrailBuffer(1)).toThrow(RangeError);
    expect(() => createTrailBuffer(2.5)).toThrow(RangeError);
    expect(() => createTrailBuffer(-3)).toThrow(RangeError);
  });
});

describe('pushTrailPoint / trailToOrderedArray', () => {
  it('未满时按时间顺序导出', () => {
    const buf = createTrailBuffer(4);
    pushTrailPoint(buf, 1, 2, 3);
    pushTrailPoint(buf, 4, 5, 6);
    expect(buf.count).toBe(2);
    expect(Array.from(trailToOrderedArray(buf))).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('写满后覆盖最旧点（环形，内存不增长）', () => {
    const buf = createTrailBuffer(3);
    for (let i = 1; i <= 5; i += 1) {
      pushTrailPoint(buf, i, i * 10, i * 100);
    }
    expect(buf.count).toBe(3);
    expect(buf.data).toHaveLength(9); // 容量固定
    // 应保留最新的 3、4、5 号点，顺序为最旧 → 最新
    expect(Array.from(trailToOrderedArray(buf))).toEqual([
      3, 30, 300, 4, 40, 400, 5, 50, 500,
    ]);
  });

  it('恰好写满一圈时顺序正确', () => {
    const buf = createTrailBuffer(2);
    pushTrailPoint(buf, 1, 1, 1);
    pushTrailPoint(buf, 2, 2, 2);
    expect(Array.from(trailToOrderedArray(buf))).toEqual([1, 1, 1, 2, 2, 2]);
  });
});

describe('clearTrail', () => {
  it('清空后无坐标残留（跨层级切换场景）', () => {
    const buf = createTrailBuffer(4);
    pushTrailPoint(buf, 9, 9, 9);
    pushTrailPoint(buf, 8, 8, 8);
    clearTrail(buf);
    expect(buf.count).toBe(0);
    expect(trailToOrderedArray(buf)).toHaveLength(0);
    // 清空后重新写入从头开始
    pushTrailPoint(buf, 1, 2, 3);
    expect(Array.from(trailToOrderedArray(buf))).toEqual([1, 2, 3]);
  });
});
