/**
 * 奥尔特云外边界示意测试（可选需求 3.1.1 / 7 单元测试）
 */

import {
  OORT_INNER_AU,
  OORT_OUTER_AU,
  OORT_PARTICLE_COUNT,
  OORT_SEED,
  OORT_SHELL_THICKNESS_01,
  OORT_VISUAL_RADIUS_UNITS,
  generateOortShellPoints,
  oortShellReferencePoint,
} from '@/utils/oort';

describe('奥尔特云常量', () => {
  it('真实范围：内缘 2,000 AU、外缘 100,000 AU（NASA）', () => {
    expect(OORT_INNER_AU).toBe(2000);
    expect(OORT_OUTER_AU).toBe(100000);
    expect(OORT_INNER_AU).toBeLessThan(OORT_OUTER_AU);
  });

  it('示意球壳半径位于 L2 锚点（100）与 L3 锚点（2600）之间（压缩已登记）', () => {
    expect(OORT_VISUAL_RADIUS_UNITS).toBeGreaterThan(100);
    expect(OORT_VISUAL_RADIUS_UNITS).toBeLessThan(2600);
  });

  it('厚度比例在 [0, 1) 内、粒子数为正整数', () => {
    expect(OORT_SHELL_THICKNESS_01).toBeGreaterThanOrEqual(0);
    expect(OORT_SHELL_THICKNESS_01).toBeLessThan(1);
    expect(Number.isInteger(OORT_PARTICLE_COUNT)).toBe(true);
    expect(OORT_PARTICLE_COUNT).toBeGreaterThan(0);
  });
});

describe('generateOortShellPoints', () => {
  const COUNT = 500;
  const RADIUS = 1600;
  const THICKNESS = 0.12;

  it('输出长度为 count*3', () => {
    const points = generateOortShellPoints(COUNT, RADIUS, THICKNESS, OORT_SEED);
    expect(points).toHaveLength(COUNT * 3);
  });

  it('全部粒子半径落在 [radius·(1−thickness), radius] 球壳内', () => {
    const points = generateOortShellPoints(COUNT, RADIUS, THICKNESS, OORT_SEED);
    for (let i = 0; i < COUNT; i += 1) {
      const r = Math.hypot(points[i * 3], points[i * 3 + 1], points[i * 3 + 2]);
      expect(r).toBeGreaterThanOrEqual(RADIUS * (1 - THICKNESS) - 1e-3);
      expect(r).toBeLessThanOrEqual(RADIUS + 1e-3);
    }
  });

  it('确定性：同一种子输出一致，不同种子输出不同', () => {
    const a = generateOortShellPoints(COUNT, RADIUS, THICKNESS, OORT_SEED);
    const b = generateOortShellPoints(COUNT, RADIUS, THICKNESS, OORT_SEED);
    const c = generateOortShellPoints(COUNT, RADIUS, THICKNESS, OORT_SEED + 1);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it('球面各半球分布大致均衡（cos 极角均匀采样，非两极聚集）', () => {
    const points = generateOortShellPoints(2000, RADIUS, THICKNESS, OORT_SEED);
    let upper = 0;
    for (let i = 0; i < 2000; i += 1) {
      if (points[i * 3 + 1] > 0) upper += 1;
    }
    // 上半球占比应接近 50%（±10% 容差）
    expect(upper / 2000).toBeGreaterThan(0.4);
    expect(upper / 2000).toBeLessThan(0.6);
  });

  it('非法参数抛出 RangeError', () => {
    expect(() => generateOortShellPoints(0, RADIUS, THICKNESS, OORT_SEED)).toThrow(RangeError);
    expect(() => generateOortShellPoints(1.5, RADIUS, THICKNESS, OORT_SEED)).toThrow(RangeError);
    expect(() => generateOortShellPoints(COUNT, 0, THICKNESS, OORT_SEED)).toThrow(RangeError);
    expect(() => generateOortShellPoints(COUNT, -10, THICKNESS, OORT_SEED)).toThrow(RangeError);
    expect(() => generateOortShellPoints(COUNT, RADIUS, -0.1, OORT_SEED)).toThrow(RangeError);
    expect(() => generateOortShellPoints(COUNT, RADIUS, 1, OORT_SEED)).toThrow(RangeError);
  });
});

describe('oortShellReferencePoint', () => {
  it('参考点位于球壳半径附近（模长 ≈ radius）', () => {
    const p = oortShellReferencePoint(1600);
    const r = Math.hypot(p.x, p.y, p.z);
    expect(r).toBeCloseTo(1600, -2);
  });

  it('随半径线性缩放', () => {
    const a = oortShellReferencePoint(100);
    const b = oortShellReferencePoint(200);
    expect(b.x).toBeCloseTo(a.x * 2, 9);
    expect(b.y).toBeCloseTo(a.y * 2, 9);
    expect(b.z).toBeCloseTo(a.z * 2, 9);
  });
});
