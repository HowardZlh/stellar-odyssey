/**
 * 彗尾方向/夹角/活动度公式与彗核外形测试（P4，需求 §4.7）
 */

import { COMETS } from '@/data/smallBodies';
import { heliocentricPosition } from '@/utils/physics';
import {
  DUST_BEND_MAX,
  DUST_TAIL_LENGTH_RATIO,
  TAIL_MAX_LENGTH_UNITS,
  cometActivity01,
  dustTailBendDirection,
  dustTailBendMagnitude,
  dustTailBendOffset,
  dustTailLengthUnits,
  ionTailDirection,
  ionTailLengthUnits,
  orbitalVelocityAuPerDay,
  tailSeparationAngleDeg,
} from '@/utils/cometTail';
import {
  ELONGATION_RATIO,
  NOISE_AMPLITUDE,
  WAIST_PINCH,
  cometNucleusRadialScale,
} from '@/utils/cometNucleus';

const HALLEY = COMETS.find((c) => c.id === 'halley')!;

describe('彗尾活动度（原 Comet.tsx 公式抽取）', () => {
  it('近日点附近趋近 1，激活阈值处为 0，阈值外为 0', () => {
    expect(cometActivity01(0, 5)).toBe(1);
    expect(cometActivity01(5, 5)).toBe(0);
    expect(cometActivity01(8, 5)).toBe(0);
    expect(cometActivity01(2.5, 5)).toBeCloseTo(0.5);
  });

  it('非法激活阈值抛错', () => {
    expect(() => cometActivity01(1, 0)).toThrow(RangeError);
  });

  it('彗尾长度随活动度线性（尘埃尾略短）', () => {
    expect(ionTailLengthUnits(1)).toBe(TAIL_MAX_LENGTH_UNITS);
    expect(ionTailLengthUnits(0.5)).toBeCloseTo(TAIL_MAX_LENGTH_UNITS / 2);
    expect(dustTailLengthUnits(1)).toBeCloseTo(TAIL_MAX_LENGTH_UNITS * DUST_TAIL_LENGTH_RATIO);
    expect(ionTailLengthUnits(2)).toBe(TAIL_MAX_LENGTH_UNITS); // 钳制
  });
});

describe('离子尾方向（严格背向太阳）', () => {
  it('方向为彗核位置的单位向量（反日方向）', () => {
    const dir = ionTailDirection({ x: 3, y: 0, z: 4 });
    expect(dir.x).toBeCloseTo(0.6);
    expect(dir.y).toBeCloseTo(0);
    expect(dir.z).toBeCloseTo(0.8);
  });

  it('彗核与太阳重合时抛错', () => {
    expect(() => ionTailDirection({ x: 0, y: 0, z: 0 })).toThrow(RangeError);
  });
});

describe('轨道速度（中心差分）', () => {
  it('哈雷近日点速度显著大于远日点（匀面速度）', () => {
    // 找近日点与远日点附近的模拟时刻（按平近点角扫描）
    let perihelionSpeed = 0;
    let aphelionSpeed = Number.POSITIVE_INFINITY;
    for (let d = 0; d < 75.32 * 365.25; d += 100) {
      const p = heliocentricPosition(HALLEY.orbit, d);
      const r = Math.hypot(p.x, p.y, p.z);
      const v = orbitalVelocityAuPerDay(HALLEY.orbit, d);
      const speed = Math.hypot(v.x, v.y, v.z);
      if (r < 1) perihelionSpeed = Math.max(perihelionSpeed, speed);
      if (r > 30) aphelionSpeed = Math.min(aphelionSpeed, speed);
    }
    expect(perihelionSpeed).toBeGreaterThan(aphelionSpeed * 10);
  });

  it('非法差分步长抛错', () => {
    expect(() => orbitalVelocityAuPerDay(HALLEY.orbit, 0, 0)).toThrow(RangeError);
  });
});

describe('尘埃尾弯曲量（曲率随轨道速度/日心距变化）', () => {
  it('速度越快弯曲越大、离太阳越远弯曲越小', () => {
    expect(dustTailBendMagnitude(0.03, 0.6)).toBeGreaterThan(dustTailBendMagnitude(0.01, 0.6));
    expect(dustTailBendMagnitude(0.02, 0.6)).toBeGreaterThan(dustTailBendMagnitude(0.02, 3));
  });

  it('弯曲量钳制在 DUST_BEND_MAX 内', () => {
    expect(dustTailBendMagnitude(10, 0.01)).toBe(DUST_BEND_MAX);
  });

  it('近日点掠过时两尾夹角显著大于远日点（验收：夹角变化可见）', () => {
    // 哈雷近日点 ~0.59 AU 速度 ~0.032 AU/天；3 AU 处速度 ~0.012 AU/天
    const nearAngle = tailSeparationAngleDeg(dustTailBendMagnitude(0.032, 0.59));
    const farAngle = tailSeparationAngleDeg(dustTailBendMagnitude(0.012, 3));
    expect(nearAngle).toBeGreaterThan(15);
    expect(farAngle).toBeLessThan(5);
  });

  it('非法输入抛错', () => {
    expect(() => dustTailBendMagnitude(-1, 1)).toThrow(RangeError);
    expect(() => dustTailBendMagnitude(1, -1)).toThrow(RangeError);
  });
});

describe('尘埃尾弯曲方向（轨道后方）', () => {
  const antiSolar = { x: 1, y: 0, z: 0 };

  it('弯曲方向 = 反速度方向在垂直尾轴平面上的投影（单位向量）', () => {
    const dir = dustTailBendDirection(antiSolar, { x: 0.5, y: 0, z: 2 });
    expect(dir).not.toBeNull();
    expect(dir!.x).toBeCloseTo(0);
    expect(dir!.z).toBeCloseTo(-1); // 反速度方向的垂直分量
    expect(Math.hypot(dir!.x, dir!.y, dir!.z)).toBeCloseTo(1);
  });

  it('与尾轴正交', () => {
    const dir = dustTailBendDirection(antiSolar, { x: 1, y: 2, z: 3 })!;
    expect(dir.x * antiSolar.x + dir.y * antiSolar.y + dir.z * antiSolar.z).toBeCloseTo(0);
  });

  it('速度与尾轴平行或为零时退化返回 null（直尾）', () => {
    expect(dustTailBendDirection(antiSolar, { x: 2, y: 0, z: 0 })).toBeNull();
    expect(dustTailBendDirection(antiSolar, { x: 0, y: 0, z: 0 })).toBeNull();
  });
});

describe('弯曲偏移曲线（shader 顶点位移镜像）', () => {
  it('二次曲线：尾根 0、尾端最大', () => {
    expect(dustTailBendOffset(0, 0.5)).toBe(0);
    expect(dustTailBendOffset(1, 0.5)).toBe(0.5);
    expect(dustTailBendOffset(0.5, 0.5)).toBeCloseTo(0.125);
  });

  it('t 越界钳制到 [0,1]', () => {
    expect(dustTailBendOffset(-1, 0.5)).toBe(0);
    expect(dustTailBendOffset(2, 0.5)).toBe(0.5);
  });
});

describe('彗核不规则外形（ESA Giotto：哈雷 15×8 km 花生形）', () => {
  it('长轴伸长比 ≈ 15/8', () => {
    expect(ELONGATION_RATIO).toBeCloseTo(15 / 8);
  });

  it('径向缩放确定性可复现（同 seed 同结果）', () => {
    const dir = { x: 0.6, y: 0.48, z: 0.64 };
    expect(cometNucleusRadialScale(dir, 42)).toBe(cometNucleusRadialScale(dir, 42));
    expect(cometNucleusRadialScale(dir, 42)).not.toBe(cometNucleusRadialScale(dir, 43));
  });

  it('腰部（x≈0）收缩形成花生形：中腰半径小于瓣端', () => {
    // 对噪声取多方向平均，分离腰部收缩效应
    const sample = (x: number): number => {
      let sum = 0;
      let count = 0;
      for (let a = 0; a < Math.PI * 2; a += 0.3) {
        const r = Math.sqrt(Math.max(0, 1 - x * x));
        sum += cometNucleusRadialScale({ x, y: r * Math.cos(a), z: r * Math.sin(a) }, 7);
        count += 1;
      }
      return sum / count;
    };
    expect(sample(0)).toBeLessThan(sample(0.9));
  });

  it('缩放值在合理范围（1 ± 收缩 ± 噪声幅度）', () => {
    for (let i = 0; i < 200; i += 1) {
      const theta = (i / 200) * Math.PI * 2;
      const s = cometNucleusRadialScale(
        { x: Math.cos(theta), y: Math.sin(theta) * 0.7, z: Math.sin(theta) * 0.71 },
        99,
      );
      expect(s).toBeGreaterThan(1 - WAIST_PINCH - NOISE_AMPLITUDE - 0.01);
      expect(s).toBeLessThan(1 + NOISE_AMPLITUDE + 0.01);
    }
  });

  it('零向量抛错', () => {
    expect(() => cometNucleusRadialScale({ x: 0, y: 0, z: 0 }, 1)).toThrow(RangeError);
  });
});
