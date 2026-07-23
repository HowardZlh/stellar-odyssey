/**
 * 粒子带测试（需求 3.1.1：每个粒子沿各自开普勒轨道公转，
 * 内圈角速度大于外圈（开普勒剪切），禁止静态环或整体刚性旋转）
 */

import type { BeltConfig } from '@/types';
import {
  BELT_TIME_WRAP_DAYS,
  beltParticlePositionAu,
  beltShaderTimeDays,
  generateBeltParticles,
} from '@/utils/belts';
import { meanMotionRadPerDay } from '@/utils/physics';

const TEST_BELT: BeltConfig = {
  id: 'test-belt',
  nameZh: '测试带',
  innerAu: 2.2,
  outerAu: 3.2,
  count: 500,
  maxEccentricity: 0.15,
  maxInclinationDeg: 8,
  color: '#8a7f6d',
  colorVariation: 0.4,
  particleSize: 0.35,
  seed: 42,
  dataSource: 'test',
};

describe('generateBeltParticles', () => {
  it('确定性：同一 seed 结果逐元素一致（需求 4.5 无闪屏）', () => {
    const a = generateBeltParticles(TEST_BELT);
    const b = generateBeltParticles(TEST_BELT);
    expect(Array.from(a.semiMajorAu)).toEqual(Array.from(b.semiMajorAu));
    expect(Array.from(a.basisP)).toEqual(Array.from(b.basisP));
    expect(Array.from(a.colors)).toEqual(Array.from(b.colors));
  });

  it('不同 seed 结果不同', () => {
    const a = generateBeltParticles(TEST_BELT);
    const b = generateBeltParticles({ ...TEST_BELT, seed: 43 });
    expect(Array.from(a.semiMajorAu)).not.toEqual(Array.from(b.semiMajorAu));
  });

  it('轨道要素在配置范围内', () => {
    const arrays = generateBeltParticles(TEST_BELT);
    for (let i = 0; i < arrays.count; i += 1) {
      expect(arrays.semiMajorAu[i]).toBeGreaterThanOrEqual(TEST_BELT.innerAu);
      expect(arrays.semiMajorAu[i]).toBeLessThanOrEqual(TEST_BELT.outerAu);
      expect(arrays.eccentricity[i]).toBeGreaterThanOrEqual(0);
      expect(arrays.eccentricity[i]).toBeLessThanOrEqual(TEST_BELT.maxEccentricity);
      expect(arrays.meanMotionRadPerDay[i]).toBeGreaterThan(0);
    }
  });

  it('开普勒剪切：内圈平均运动大于外圈（防静态化/防刚性旋转）', () => {
    const arrays = generateBeltParticles(TEST_BELT);
    let innerIdx = 0;
    let outerIdx = 0;
    for (let i = 0; i < arrays.count; i += 1) {
      if (arrays.semiMajorAu[i] < arrays.semiMajorAu[innerIdx]) innerIdx = i;
      if (arrays.semiMajorAu[i] > arrays.semiMajorAu[outerIdx]) outerIdx = i;
    }
    expect(arrays.meanMotionRadPerDay[innerIdx]).toBeGreaterThan(
      arrays.meanMotionRadPerDay[outerIdx],
    );
    // 平均运动符合开普勒第三定律
    expect(arrays.meanMotionRadPerDay[innerIdx]).toBeCloseTo(
      meanMotionRadPerDay(arrays.semiMajorAu[innerIdx]),
      6,
    );
  });

  it('轨道基矢正交且单位化', () => {
    const arrays = generateBeltParticles(TEST_BELT);
    for (const i of [0, 100, 499]) {
      const p = [arrays.basisP[i * 3], arrays.basisP[i * 3 + 1], arrays.basisP[i * 3 + 2]];
      const q = [arrays.basisQ[i * 3], arrays.basisQ[i * 3 + 1], arrays.basisQ[i * 3 + 2]];
      const lenP = Math.hypot(p[0], p[1], p[2]);
      const lenQ = Math.hypot(q[0], q[1], q[2]);
      const dot = p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
      expect(lenP).toBeCloseTo(1, 6);
      expect(lenQ).toBeCloseTo(1, 6);
      expect(dot).toBeCloseTo(0, 6);
    }
  });

  it('非法配置抛错', () => {
    expect(() => generateBeltParticles({ ...TEST_BELT, count: 0 })).toThrow(RangeError);
    expect(() => generateBeltParticles({ ...TEST_BELT, count: 1.5 })).toThrow(RangeError);
    expect(() => generateBeltParticles({ ...TEST_BELT, outerAu: 2.0 })).toThrow(RangeError);
    expect(() => generateBeltParticles({ ...TEST_BELT, color: 'red' })).toThrow(RangeError);
  });
});

describe('beltParticlePositionAu', () => {
  it('粒子距离在带范围附近（含离心率带来的偏移）', () => {
    const arrays = generateBeltParticles(TEST_BELT);
    const p = beltParticlePositionAu(arrays, 0, 0);
    const r = Math.hypot(p.x, p.y, p.z);
    expect(r).toBeGreaterThan(TEST_BELT.innerAu * (1 - TEST_BELT.maxEccentricity) - 0.05);
    expect(r).toBeLessThan(TEST_BELT.outerAu * (1 + TEST_BELT.maxEccentricity) + 0.05);
  });

  it('粒子随时间公转（非静态）且一个周期后回到初始位置', () => {
    const arrays = generateBeltParticles(TEST_BELT);
    const idx = 3;
    const periodDays = (Math.PI * 2) / arrays.meanMotionRadPerDay[idx];
    const p0 = beltParticlePositionAu(arrays, idx, 0);
    const pHalf = beltParticlePositionAu(arrays, idx, periodDays / 2);
    const pFull = beltParticlePositionAu(arrays, idx, periodDays);
    // 半周期后位置明显不同（防静态化）
    const moved = Math.hypot(pHalf.x - p0.x, pHalf.y - p0.y, pHalf.z - p0.z);
    expect(moved).toBeGreaterThan(arrays.semiMajorAu[idx]);
    // 整周期后回归
    expect(pFull.x).toBeCloseTo(p0.x, 3);
    expect(pFull.y).toBeCloseTo(p0.y, 3);
    expect(pFull.z).toBeCloseTo(p0.z, 3);
  });

  it('e=0 时轨道为圆（到太阳距离恒定）', () => {
    const arrays = generateBeltParticles({ ...TEST_BELT, maxEccentricity: 0 });
    const r0 = beltParticlePositionAu(arrays, 0, 0);
    const r1 = beltParticlePositionAu(arrays, 0, 200);
    expect(Math.hypot(r0.x, r0.y, r0.z)).toBeCloseTo(Math.hypot(r1.x, r1.y, r1.z), 5);
  });

  it('索引越界抛错', () => {
    const arrays = generateBeltParticles(TEST_BELT);
    expect(() => beltParticlePositionAu(arrays, -1, 0)).toThrow(RangeError);
    expect(() => beltParticlePositionAu(arrays, 500, 0)).toThrow(RangeError);
  });
});

describe('beltShaderTimeDays（shader 时间回卷，float32/GPU 精度保护）', () => {
  it('常规太阳系时间尺度（< 回卷窗口）恒等返回，行为与未回卷一致', () => {
    expect(beltShaderTimeDays(0)).toBe(0);
    expect(beltShaderTimeDays(365.25)).toBe(365.25);
    expect(beltShaderTimeDays(BELT_TIME_WRAP_DAYS - 1)).toBe(BELT_TIME_WRAP_DAYS - 1);
  });

  it('银河系/宇宙视角时间尺度（10⁹⁺ 天）回卷到 [0, 窗口)', () => {
    // 回归背景：从 L3/L4 切回 L2 后 simDays 可达数百万年，float32 下
    // n·t ~ 10⁷ 弧度使 GPU sin/cos 失效，粒子带坍缩成贴日团块
    for (const days of [3.13e9, 3.5e10, BELT_TIME_WRAP_DAYS, BELT_TIME_WRAP_DAYS * 7.3]) {
      const t = beltShaderTimeDays(days);
      expect(t).toBeGreaterThanOrEqual(0);
      expect(t).toBeLessThan(BELT_TIME_WRAP_DAYS);
    }
  });

  it('时间倒退（负值）同样回卷到 [0, 窗口)', () => {
    const t = beltShaderTimeDays(-1000);
    expect(t).toBeGreaterThanOrEqual(0);
    expect(t).toBeLessThan(BELT_TIME_WRAP_DAYS);
    expect(t).toBeCloseTo(BELT_TIME_WRAP_DAYS - 1000, 9);
  });

  it('回卷幅度上界：最快粒子（内缘 2.2 AU）的 |M| 处于 float32 可靠范围', () => {
    const nMax = meanMotionRadPerDay(2.2);
    const mMax = Math.PI * 2 + nMax * BELT_TIME_WRAP_DAYS;
    // float32 在 ~3000 弧度量级的绝对误差约 2⁻²³·2¹² ≈ 5×10⁻⁴ 弧度，视觉不可辨
    expect(mMax).toBeLessThan(3000);
  });

  it('回卷时间下粒子仍在自己的轨道上（径向范围不变）', () => {
    const arrays = generateBeltParticles(TEST_BELT);
    const hugeDays = 3.13e9; // ≈ 857 万年（L3 往返后的实际量级）
    for (const idx of [0, 100, 499]) {
      const p = beltParticlePositionAu(arrays, idx, beltShaderTimeDays(hugeDays));
      const r = Math.hypot(p.x, p.y, p.z);
      const a = arrays.semiMajorAu[idx];
      const e = arrays.eccentricity[idx];
      expect(r).toBeGreaterThanOrEqual(a * (1 - e) - 1e-6);
      expect(r).toBeLessThanOrEqual(a * (1 + e) + 1e-6);
    }
  });

  it('非有限输入抛错', () => {
    expect(() => beltShaderTimeDays(Number.NaN)).toThrow(RangeError);
    expect(() => beltShaderTimeDays(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});
