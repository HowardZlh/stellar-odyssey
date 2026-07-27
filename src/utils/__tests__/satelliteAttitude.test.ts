/**
 * P7 卫星姿态计算测试（§3.1 对地定向 + 帆板对日）
 */

import {
  basisToQuaternion,
  nadirAttitudeBasis,
  nadirAttitudeQuaternion,
  panelSunTrackAngleAboutZRad,
  panelSunTrackAngleRad,
  rotateVectorByQuaternion,
} from '@/utils/satelliteAttitude';
import type { Vec3Like } from '@/utils/satelliteAttitude';

function expectVecClose(a: Vec3Like, b: Vec3Like, digits = 6): void {
  expect(a.x).toBeCloseTo(b.x, digits);
  expect(a.y).toBeCloseTo(b.y, digits);
  expect(a.z).toBeCloseTo(b.z, digits);
}

describe('nadirAttitudeBasis（对地定向姿态基）', () => {
  it('+Y 背离地心、+X 沿飞行方向、+Z 右手系补全', () => {
    // 卫星在 +X 方向，向 +Z 方向飞行
    const basis = nadirAttitudeBasis({ x: 5, y: 0, z: 0 }, { x: 0, y: 0, z: 2 })!;
    expectVecClose(basis.yAxis, { x: 1, y: 0, z: 0 }); // 背离地心
    expectVecClose(basis.xAxis, { x: 0, y: 0, z: 1 }); // 飞行方向
    expectVecClose(basis.zAxis, { x: 0, y: 1, z: 0 }); // cross(x, y)
  });

  it('速度含径向分量时正交化（forward ⊥ up）', () => {
    const basis = nadirAttitudeBasis({ x: 3, y: 0, z: 0 }, { x: 1, y: 0, z: 1 })!;
    const dot = basis.xAxis.x * basis.yAxis.x + basis.xAxis.y * basis.yAxis.y + basis.xAxis.z * basis.yAxis.z;
    expect(dot).toBeCloseTo(0, 10);
    expectVecClose(basis.xAxis, { x: 0, y: 0, z: 1 });
  });

  it('退化输入返回 null（零位置 / 速度与位置共线）', () => {
    expect(nadirAttitudeBasis({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 })).toBeNull();
    expect(nadirAttitudeBasis({ x: 1, y: 0, z: 0 }, { x: 2, y: 0, z: 0 })).toBeNull();
    expect(nadirAttitudeBasis({ x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 0 })).toBeNull();
  });
});

describe('nadirAttitudeQuaternion（模型 −Y 指向地心）', () => {
  it('沿轨道任意相位：模型 −Y 旋转后指向地心（同一面朝地）', () => {
    for (const phase of [0, 0.7, Math.PI / 2, 2.4, Math.PI, 4.9]) {
      const p = { x: 5 * Math.cos(phase), y: 0, z: 5 * Math.sin(phase) };
      // 圆轨道切向速度
      const v = { x: -Math.sin(phase), y: 0, z: Math.cos(phase) };
      const q = nadirAttitudeQuaternion(p, v)!;
      expect(q).not.toBeNull();
      // 模型 -Y 轴旋转后应指向地心（-position 方向）
      const minusY = rotateVectorByQuaternion({ x: 0, y: -1, z: 0 }, q);
      const len = Math.hypot(p.x, p.y, p.z);
      expectVecClose(minusY, { x: -p.x / len, y: -p.y / len, z: -p.z / len });
      // 模型 +X 轴旋转后沿飞行方向
      const plusX = rotateVectorByQuaternion({ x: 1, y: 0, z: 0 }, q);
      expectVecClose(plusX, v);
    }
  });

  it('倾斜轨道（含 Y 分量）姿态仍正交归一', () => {
    const p = { x: 3, y: 2, z: 1 };
    const v = { x: -1, y: 0.5, z: 2 };
    const q = nadirAttitudeQuaternion(p, v)!;
    const norm = Math.hypot(q.x, q.y, q.z, q.w);
    expect(norm).toBeCloseTo(1, 6);
    const minusY = rotateVectorByQuaternion({ x: 0, y: -1, z: 0 }, q);
    const len = Math.hypot(p.x, p.y, p.z);
    expectVecClose(minusY, { x: -p.x / len, y: -p.y / len, z: -p.z / len });
  });

  it('退化输入返回 null', () => {
    expect(nadirAttitudeQuaternion({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 })).toBeNull();
  });
});

describe('basisToQuaternion（Shepperd 分支覆盖）', () => {
  it('单位基 → 单位四元数', () => {
    const q = basisToQuaternion({ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 });
    expect(q.w).toBeCloseTo(1, 10);
    expect(Math.hypot(q.x, q.y, q.z)).toBeCloseTo(0, 10);
  });

  it('trace ≤ 0 的三个分支（绕轴 180° 旋转）恢复原向量', () => {
    const cases: [Vec3Like, Vec3Like, Vec3Like][] = [
      // 绕 X 轴 180°：m00 最大
      [{ x: 1, y: 0, z: 0 }, { x: 0, y: -1, z: 0 }, { x: 0, y: 0, z: -1 }],
      // 绕 Y 轴 180°：m11 最大
      [{ x: -1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: -1 }],
      // 绕 Z 轴 180°：m22 最大
      [{ x: -1, y: 0, z: 0 }, { x: 0, y: -1, z: 0 }, { x: 0, y: 0, z: 1 }],
    ];
    for (const [xa, ya, za] of cases) {
      const q = basisToQuaternion(xa, ya, za);
      expect(Math.hypot(q.x, q.y, q.z, q.w)).toBeCloseTo(1, 6);
      expectVecClose(rotateVectorByQuaternion({ x: 1, y: 0, z: 0 }, q), xa);
      expectVecClose(rotateVectorByQuaternion({ x: 0, y: 1, z: 0 }, q), ya);
      expectVecClose(rotateVectorByQuaternion({ x: 0, y: 0, z: 1 }, q), za);
    }
  });
});

describe('帆板对日跟踪角（P7 §3.1，绕单轴简化登记）', () => {
  it('绕 X 轴：帆板法线 (0, cosθ, sinθ) 对准太阳投影', () => {
    // 太阳在 +Y：θ = 0
    expect(panelSunTrackAngleRad({ x: 0, y: 1, z: 0 })).toBeCloseTo(0, 10);
    // 太阳在 +Z：θ = π/2
    expect(panelSunTrackAngleRad({ x: 0, y: 0, z: 1 })).toBeCloseTo(Math.PI / 2, 10);
    // 太阳在 -Y：θ = ±π
    expect(Math.abs(panelSunTrackAngleRad({ x: 0, y: -1, z: 0 }))).toBeCloseTo(Math.PI, 10);
    // 对准后法线与太阳投影点积最大（任意方向验证）
    const s = { x: 0.3, y: 0.5, z: -0.8 };
    const theta = panelSunTrackAngleRad(s);
    const n = { x: 0, y: Math.cos(theta), z: Math.sin(theta) };
    const alignment = n.y * s.y + n.z * s.z;
    expect(alignment).toBeCloseTo(Math.hypot(s.y, s.z), 10);
  });

  it('绕 Z 轴：帆板法线 (−sinθ, cosθ, 0) 对准太阳投影', () => {
    expect(panelSunTrackAngleAboutZRad({ x: 0, y: 1, z: 0 })).toBeCloseTo(0, 10);
    expect(panelSunTrackAngleAboutZRad({ x: -1, y: 0, z: 0 })).toBeCloseTo(Math.PI / 2, 10);
    const s = { x: 0.6, y: -0.4, z: 0.2 };
    const theta = panelSunTrackAngleAboutZRad(s);
    const n = { x: -Math.sin(theta), y: Math.cos(theta), z: 0 };
    expect(n.x * s.x + n.y * s.y).toBeCloseTo(Math.hypot(s.x, s.y), 10);
  });

  it('太阳方向与旋转轴平行时返回 0（投影过小）', () => {
    expect(panelSunTrackAngleRad({ x: 1, y: 0, z: 0 })).toBe(0);
    expect(panelSunTrackAngleAboutZRad({ x: 0, y: 0, z: 1 })).toBe(0);
  });
});
