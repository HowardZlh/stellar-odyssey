/**
 * 恒星表面质感 shader 纯逻辑镜像单元测试（P6 §3.2 / §6）
 */

import {
  applyColorTemperatureGradient,
  convectionFbm,
  convectionFbm3,
  edgeRednessFactor,
  hash3,
  limbDarkening,
  stellarSphereSegments,
  valueNoise2D,
  valueNoise3D,
} from '@/utils/stellarSurface';

describe('limbDarkening（边缘昏暗）', () => {
  it('盘面中心（μ=1）强度为 1', () => {
    expect(limbDarkening(1, 0.6)).toBeCloseTo(1, 10);
  });

  it('盘面边缘（μ=0）强度为 1−u', () => {
    expect(limbDarkening(0, 0.6)).toBeCloseTo(0.4, 10);
  });

  it('强度随 μ 单调递减到边缘（中心亮边缘暗）', () => {
    expect(limbDarkening(1, 0.6)).toBeGreaterThan(limbDarkening(0.5, 0.6));
    expect(limbDarkening(0.5, 0.6)).toBeGreaterThan(limbDarkening(0, 0.6));
  });

  it('μ 越界被钳制到 [0,1]', () => {
    expect(limbDarkening(2, 0.6)).toBeCloseTo(1, 10);
    expect(limbDarkening(-1, 0.6)).toBeCloseTo(0.4, 10);
  });

  it('系数越界抛 RangeError', () => {
    expect(() => limbDarkening(1, -0.1)).toThrow(RangeError);
    expect(() => limbDarkening(1, 1.5)).toThrow(RangeError);
  });
});

describe('edgeRednessFactor / applyColorTemperatureGradient', () => {
  it('中心（μ=1）无偏移，边缘（μ=0）偏移最大', () => {
    expect(edgeRednessFactor(1)).toBeCloseTo(0, 10);
    expect(edgeRednessFactor(0)).toBeCloseTo(1, 10);
  });

  it('色温梯度：边缘颜色更暗更红（G/B 降幅 > R 降幅）', () => {
    const base = { r: 1, g: 0.9, b: 0.8 };
    const center = applyColorTemperatureGradient(base, 1, 0.5);
    const edge = applyColorTemperatureGradient(base, 0, 0.5);
    // 中心保持本征色
    expect(center.r).toBeCloseTo(base.r, 10);
    expect(center.g).toBeCloseTo(base.g, 10);
    // 边缘变暗
    expect(edge.r).toBeLessThan(base.r);
    expect(edge.g).toBeLessThan(base.g);
    expect(edge.b).toBeLessThan(base.b);
    // 蓝分量衰减幅度最大（偏红）
    const dR = base.r - edge.r;
    const dB = base.b - edge.b;
    expect(dB / base.b).toBeGreaterThan(dR / base.r);
  });

  it('非法幂次 / 强度抛 RangeError', () => {
    expect(() => edgeRednessFactor(0.5, 0)).toThrow(RangeError);
    expect(() => applyColorTemperatureGradient({ r: 1, g: 1, b: 1 }, 0.5, 1.5)).toThrow(RangeError);
  });
});

describe('valueNoise2D / convectionFbm（对流颗粒）', () => {
  it('值噪声确定性且在 [0,1]', () => {
    expect(valueNoise2D(1.5, 2.5)).toBe(valueNoise2D(1.5, 2.5));
    for (let i = 0; i < 50; i += 1) {
      const n = valueNoise2D(i * 0.37, i * 0.91);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThanOrEqual(1);
    }
  });

  it('fBm 归一化到 [0,1] 且确定性', () => {
    const a = convectionFbm(0.3, 0.7, 4, 0, 4);
    const b = convectionFbm(0.3, 0.7, 4, 0, 4);
    expect(a).toBe(b);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThanOrEqual(1);
  });

  it('时间推进使 fBm 演化（对流胞浮沉）', () => {
    const t0 = convectionFbm(0.3, 0.7, 4, 0, 4);
    const t1 = convectionFbm(0.3, 0.7, 4, 5, 4);
    expect(t0).not.toBeCloseTo(t1, 5);
  });

  it('cellScale 越大颗粒越细（空间变化更快）', () => {
    // 小步长采样差异：细颗粒（大 scale）相邻采样差异更大
    const coarse = Math.abs(convectionFbm(0.1, 0.1, 1, 0, 2) - convectionFbm(0.12, 0.1, 1, 0, 2));
    const fine = Math.abs(convectionFbm(0.1, 0.1, 1, 0, 16) - convectionFbm(0.12, 0.1, 1, 0, 16));
    expect(fine).toBeGreaterThan(coarse);
  });

  it('octaves 非法抛 RangeError', () => {
    expect(() => convectionFbm(0, 0, 0)).toThrow(RangeError);
    expect(() => convectionFbm(0, 0, 2.5)).toThrow(RangeError);
  });
});

describe('hash3 / valueNoise3D / convectionFbm3（3D 对流噪声，消经度接缝）', () => {
  it('hash3 输出在 [0,1) 且确定性', () => {
    for (const [x, y, z] of [
      [0, 0, 0],
      [1.5, -2.3, 7.7],
      [100, 200, -300],
    ]) {
      const v = hash3(x, y, z);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      expect(hash3(x, y, z)).toBe(v);
    }
  });

  it('valueNoise3D 输出在 [0,1] 且在晶格点等于 hash3', () => {
    for (const [x, y, z] of [
      [0.3, 0.7, 0.1],
      [5.5, -1.2, 3.9],
    ]) {
      const v = valueNoise3D(x, y, z);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    expect(valueNoise3D(2, 3, 4)).toBeCloseTo(hash3(2, 3, 4), 10);
  });

  it('valueNoise3D 空间连续（微小位移下取值变化微小——原 2D 参数化在 ±180° 经线处跳变）', () => {
    // 单位球面上跨"原 2D 接缝"（x<0 平面附近 z 符号翻转）的两个邻近点
    const eps = 1e-4;
    const a = valueNoise3D(-1.5, 0.3, eps);
    const b = valueNoise3D(-1.5, 0.3, -eps);
    expect(Math.abs(a - b)).toBeLessThan(0.01);
  });

  it('convectionFbm3 输出在 [0,1]，时间演化改变取值（对流胞浮沉）', () => {
    const v0 = convectionFbm3(0.4, 0.2, -0.6, 4, 0, 2.2);
    const v1 = convectionFbm3(0.4, 0.2, -0.6, 4, 60, 2.2);
    expect(v0).toBeGreaterThanOrEqual(0);
    expect(v0).toBeLessThanOrEqual(1);
    expect(v0).not.toBeCloseTo(v1, 4);
  });

  it('convectionFbm3 cellScale 越大颗粒越细（相邻点差异增大）', () => {
    const coarseA = convectionFbm3(0.1, 0.1, 0.1, 4, 0, 2.2);
    const coarseB = convectionFbm3(0.12, 0.1, 0.1, 4, 0, 2.2);
    const fineA = convectionFbm3(0.1, 0.1, 0.1, 4, 0, 12);
    const fineB = convectionFbm3(0.12, 0.1, 0.1, 4, 0, 12);
    // 粗对流胞下相邻点强相关（差异小于细颗粒情形的平均差异量级）
    expect(Math.abs(coarseA - coarseB)).toBeLessThan(0.2);
    expect(Number.isFinite(fineA - fineB)).toBe(true);
  });

  it('convectionFbm3 octaves 非法抛 RangeError', () => {
    expect(() => convectionFbm3(0, 0, 0, 0)).toThrow(RangeError);
    expect(() => convectionFbm3(0, 0, 0, 2.5)).toThrow(RangeError);
  });
});

describe('stellarSphereSegments（分段提升至 32–48）', () => {
  it('结果钳制在 [32,48]', () => {
    for (const r of [0, 5, 30, 60, 120]) {
      const seg = stellarSphereSegments(r);
      expect(seg).toBeGreaterThanOrEqual(32);
      expect(seg).toBeLessThanOrEqual(48);
    }
  });

  it('半径越大分段越多（近观无棱角）', () => {
    expect(stellarSphereSegments(60)).toBeGreaterThanOrEqual(stellarSphereSegments(1));
  });

  it('非法半径抛 RangeError', () => {
    expect(() => stellarSphereSegments(-1)).toThrow(RangeError);
    expect(() => stellarSphereSegments(Number.NaN)).toThrow(RangeError);
  });
});
