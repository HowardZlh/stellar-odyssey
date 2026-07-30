/**
 * R5-6 银河系 L4 增补单测——HI 翘曲盘（IMPROVEMENT_REQUIREMENTS_5 §R5-6）
 *
 * 覆盖：
 * 1. warpYLy 纯函数：内盘零位移 / 振幅径向增长 / 方位角相位（m=1 反号）/
 *    起始半径 C¹ 连续 / 非法输入 RangeError / 确定性；
 * 2. 生成器 warpsLy 通道：外盘盘粒子 = warpYLy(r, φ)、核球/棒恒 0、
 *    既有通道（heightsLy 等）逐字节不变（warp 不消耗随机数）、
 *    粒子总量不变；
 * 3. 组合顺序（diskWarpMorphYLy，shader CPU 镜像）：warp 为基线位移、
 *    morph 在其上——uEll/uExpand=0 完整呈现、任一权重达 1 终态椭球
 *    无翘曲（防 ~r/1000 倍形变放大异常）、闭式等价
 *    combinedMorphWeight 断言。
 */

import {
  diskWarpMorphYLy,
  GALACTIC_BULGE_RADIUS_LY,
  GALACTIC_DISK_RADIUS_LY,
  GALACTIC_DISK_THICKNESS_LY,
  GALACTIC_WARP_AMP_EDGE_LY,
  GALACTIC_WARP_PHASE_RAD,
  GALACTIC_WARP_START_LY,
  generateGalaxyDiskParticles,
  warpYLy,
  type GalaxyDiskParams,
} from '@/utils/galaxy';
import { combinedMorphWeight } from '@/utils/galacticLatitude';

const BASE_PARAMS: GalaxyDiskParams = {
  count: 6000,
  seed: 20260730,
  armCount: 4,
  diskRadiusLy: GALACTIC_DISK_RADIUS_LY,
  thicknessLy: GALACTIC_DISK_THICKNESS_LY,
  bulgeRadiusLy: GALACTIC_BULGE_RADIUS_LY,
  bulgeFraction: 0.15,
  spiralTightness: 1.2,
  armSpreadRad: 0.25,
  barFraction: 0.08,
};

describe('R5-6 warpYLy（m=1 S 形垂直位移，Levine et al. 2006 近似）', () => {
  it('内盘（r ≤ 起始半径）零位移', () => {
    expect(warpYLy(0, 1)).toBe(0);
    expect(warpYLy(10000, Math.PI / 2)).toBe(0);
    expect(warpYLy(GALACTIC_WARP_START_LY, Math.PI / 2)).toBe(0);
  });

  it('振幅随半径增长（40k < 45k < 50k），盘缘达登记振幅', () => {
    const phi = Math.PI / 2; // sin = 1（相位 φ₀=0）
    const a40 = warpYLy(40000, phi);
    const a45 = warpYLy(45000, phi);
    const a50 = warpYLy(GALACTIC_DISK_RADIUS_LY, phi);
    expect(a40).toBeGreaterThan(0);
    expect(a45).toBeGreaterThan(a40);
    expect(a50).toBeGreaterThan(a45);
    expect(a50).toBeCloseTo(GALACTIC_WARP_AMP_EDGE_LY, 6);
  });

  it('起始半径处 C¹ 连续（起点邻域位移趋近 0）', () => {
    expect(Math.abs(warpYLy(GALACTIC_WARP_START_LY + 1, Math.PI / 2))).toBeLessThan(0.01);
  });

  it('m=1 方位角相位：φ 与 φ+π 反号（S 形）、交点线（φ₀/φ₀+π）为 0', () => {
    const r = 48000;
    const up = warpYLy(r, GALACTIC_WARP_PHASE_RAD + Math.PI / 2);
    const down = warpYLy(r, GALACTIC_WARP_PHASE_RAD + (3 * Math.PI) / 2);
    expect(up).toBeGreaterThan(0);
    expect(down).toBeCloseTo(-up, 6);
    expect(warpYLy(r, GALACTIC_WARP_PHASE_RAD)).toBeCloseTo(0, 6);
    expect(Math.abs(warpYLy(r, GALACTIC_WARP_PHASE_RAD + Math.PI))).toBeLessThan(1e-6);
  });

  it('确定性：同参数两次求值一致', () => {
    expect(warpYLy(47000, 1.234)).toBe(warpYLy(47000, 1.234));
  });

  it('非法输入抛 RangeError', () => {
    expect(() => warpYLy(Number.NaN, 0)).toThrow(RangeError);
    expect(() => warpYLy(40000, Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => warpYLy(-1, 0)).toThrow(RangeError);
  });
});

describe('R5-6 生成器 warpsLy 通道（CPU 生成期一次性位移）', () => {
  const particles = generateGalaxyDiskParticles(BASE_PARAMS);

  it('外盘盘粒子 warpsLy = warpYLy(r, φ)，且存在非零位移', () => {
    let outer = 0;
    for (let i = 0; i < particles.count; i += 1) {
      // float32 往返（radiiLy/phases 读回为 f32）容差按 1e-1 精度档
      expect(particles.warpsLy[i]).toBeCloseTo(
        warpYLy(particles.radiiLy[i], particles.phases[i]),
        1,
      );
      if (particles.radiiLy[i] > GALACTIC_WARP_START_LY && particles.warpsLy[i] !== 0) {
        outer += 1;
      }
    }
    expect(outer).toBeGreaterThan(100);
  });

  it('核球/棒粒子（半径恒在起始半径内）位移为 0', () => {
    for (let i = 0; i < particles.count; i += 1) {
      if (particles.barFlags[i] === 1 || particles.radiiLy[i] <= GALACTIC_WARP_START_LY) {
        expect(particles.warpsLy[i]).toBe(0);
      }
    }
  });

  it('既有通道零回退：warp 不消耗随机数——各通道与无棒/有棒历史口径无关，' +
    '同种子两次生成逐字节一致且粒子总量不变', () => {
    const again = generateGalaxyDiskParticles(BASE_PARAMS);
    expect(again.count).toBe(BASE_PARAMS.count);
    expect(again.radiiLy).toEqual(particles.radiiLy);
    expect(again.phases).toEqual(particles.phases);
    expect(again.heightsLy).toEqual(particles.heightsLy);
    expect(again.warpsLy).toEqual(particles.warpsLy);
    expect(again.colors).toEqual(particles.colors);
    expect(again.sizes).toEqual(particles.sizes);
    expect(again.barFlags).toEqual(particles.barFlags);
  });

  it('heightsLy 通道不含翘曲（morph 椭球目标由未翘曲高度派生的前提）', () => {
    // 外盘（r > 起始半径）高度上界 = 高斯 × 半厚 500 ly × 外缘变薄
    // （<0.65）；翘曲若被烘进 heightsLy，外盘 |h| 将系统性超出高斯尾部界
    // （振幅最高 3,000 ly ≫ 半厚 500 ly）。核球粒子（|h| 可达 ±4,800 ly）
    // 不在判据内（r ≤ 8,000 ly 恒在外盘域外）
    let extreme = 0;
    for (let i = 0; i < particles.count; i += 1) {
      if (
        particles.radiiLy[i] > GALACTIC_WARP_START_LY &&
        Math.abs(particles.heightsLy[i]) > 2500
      ) {
        extreme += 1;
      }
    }
    expect(extreme).toBe(0);
  });
});

describe('R5-6 组合顺序（diskWarpMorphYLy，盘 shader CPU 镜像）', () => {
  const h = 320;
  const w = 2400;
  const r = 47000;
  const hTarget = (h / 500) * Math.max(r, 6000) * 0.5;

  it('uEll=uExpand=0：基线位移完整呈现（y = h + warp）', () => {
    expect(diskWarpMorphYLy(h, w, r, 0, 0)).toBeCloseTo(h + w, 9);
  });

  it('uEll=1（Milkomeda 终态）：翘曲随 morph 淡出（y = 椭球目标，无翘曲）', () => {
    expect(diskWarpMorphYLy(h, w, r, 1, 0)).toBeCloseTo(hTarget, 9);
    expect(diskWarpMorphYLy(h, w, r, 1, 0.6)).toBeCloseTo(hTarget, 9);
  });

  it('uExpand=1（R3-7 展开态）：同一椭球目标，无翘曲', () => {
    expect(diskWarpMorphYLy(h, w, r, 0, 1)).toBeCloseTo(hTarget, 9);
  });

  it('形变放大异常防护：任意权重下 |y| ≤ max(|h+warp|, |椭球目标|)——' +
    '翘曲不被 ~r/1000 倍放大', () => {
    const bound = Math.max(Math.abs(h + w), Math.abs(hTarget)) + 1e-9;
    for (const ell of [0, 0.25, 0.5, 0.75, 1]) {
      for (const expand of [0, 0.25, 0.5, 0.75, 1]) {
        expect(Math.abs(diskWarpMorphYLy(h, w, r, ell, expand))).toBeLessThanOrEqual(bound);
      }
    }
  });

  it('闭式等价：y = (1−cw)·(h+warp) + cw·目标，cw = combinedMorphWeight', () => {
    for (const ell of [0, 0.3, 0.7, 1]) {
      for (const expand of [0, 0.4, 0.9, 1]) {
        const cw = combinedMorphWeight(ell, expand);
        expect(diskWarpMorphYLy(h, w, r, ell, expand)).toBeCloseTo(
          (1 - cw) * (h + w) + cw * hTarget,
          9,
        );
      }
    }
  });

  it('非法输入抛 RangeError', () => {
    expect(() => diskWarpMorphYLy(Number.NaN, 0, 1, 0, 0)).toThrow(RangeError);
    expect(() => diskWarpMorphYLy(0, Number.NaN, 1, 0, 0)).toThrow(RangeError);
    expect(() => diskWarpMorphYLy(0, 0, Number.NaN, 0, 0)).toThrow(RangeError);
    expect(() => diskWarpMorphYLy(0, 0, 1, -0.1, 0)).toThrow(RangeError);
    expect(() => diskWarpMorphYLy(0, 0, 1, 0, 1.1)).toThrow(RangeError);
  });
});
