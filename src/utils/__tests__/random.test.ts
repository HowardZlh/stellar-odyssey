/**
 * 确定性伪随机单元测试（需求 4.5：位置稳定、无闪屏）
 */

import { createSeededRandom } from '@/utils/random';

describe('createSeededRandom', () => {
  it('相同种子产生完全相同的序列（确定性）', () => {
    const a = createSeededRandom(42);
    const b = createSeededRandom(42);
    for (let i = 0; i < 100; i += 1) {
      expect(a()).toBe(b());
    }
  });

  it('不同种子产生不同序列', () => {
    const a = createSeededRandom(1);
    const b = createSeededRandom(2);
    const seqA = Array.from({ length: 10 }, () => a());
    const seqB = Array.from({ length: 10 }, () => b());
    expect(seqA).not.toEqual(seqB);
  });

  it('所有值在 [0, 1) 区间', () => {
    const rand = createSeededRandom(7);
    for (let i = 0; i < 1000; i += 1) {
      const v = rand();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('分布大致均匀（均值接近 0.5）', () => {
    const rand = createSeededRandom(123);
    let sum = 0;
    const n = 10000;
    for (let i = 0; i < n; i += 1) sum += rand();
    expect(sum / n).toBeGreaterThan(0.45);
    expect(sum / n).toBeLessThan(0.55);
  });
});
