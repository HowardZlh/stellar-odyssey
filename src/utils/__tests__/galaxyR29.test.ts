/**
 * R2-9 L4 银河系真实感重构单元测试：
 * 3D 恒星银晕分布 / 球状星团系统 / 棒结构 / 视角因子纯函数
 */

import {
  BAR_PATTERN_SPEED_RAD_PER_MYR,
  DAYS_PER_MYR,
  GALACTIC_BAR_AXIS_RATIO,
  GALACTIC_BAR_HALF_LENGTH_LY,
  GALACTIC_BAR_THICKNESS_LY,
  GALACTIC_BULGE_RADIUS_LY,
  GALACTIC_DISK_RADIUS_LY,
  GALACTIC_DISK_THICKNESS_LY,
  GLOBULAR_CLUSTER_COUNT,
  GLOBULAR_CLUSTER_STARS,
  GLOBULAR_MAX_RADIUS_LY,
  GLOBULAR_MIN_RADIUS_LY,
  GLOBULAR_SPREAD_LY,
  HALO_FLATTENING,
  HALO_MAX_RADIUS_LY,
  HALO_MIN_RADIUS_LY,
  M13_EXCLUSION_RADIUS_LY,
  SUN_GALACTIC_RADIUS_LY,
  barParticleAngle,
  bulgeAxisRatio,
  dustLaneStrength,
  galaxyFaceOnFactor,
  generateGalaxyDiskParticles,
  generateGalaxyHaloParticles,
  generateGlobularClusters,
  haloRadiusFromUniform,
  m13GalactocentricT0Ly,
  type GalaxyDiskParams,
  type GalaxyHaloParams,
  type GlobularClusterParams,
} from '@/utils/galaxy';

const HALO_PARAMS: GalaxyHaloParams = {
  count: 3000,
  seed: 20260726,
  minRadiusLy: HALO_MIN_RADIUS_LY,
  maxRadiusLy: HALO_MAX_RADIUS_LY,
  flattening: HALO_FLATTENING,
};

const CLUSTER_PARAMS: GlobularClusterParams = {
  clusterCount: GLOBULAR_CLUSTER_COUNT,
  starsPerCluster: GLOBULAR_CLUSTER_STARS,
  seed: 20260726,
  minRadiusLy: GLOBULAR_MIN_RADIUS_LY,
  maxRadiusLy: GLOBULAR_MAX_RADIUS_LY,
  spreadLy: GLOBULAR_SPREAD_LY,
  exclusion: { centerLy: m13GalactocentricT0Ly(), radiusLy: M13_EXCLUSION_RADIUS_LY },
};

const DISK_PARAMS: GalaxyDiskParams = {
  count: 8000,
  seed: 42,
  armCount: 4,
  diskRadiusLy: GALACTIC_DISK_RADIUS_LY,
  thicknessLy: GALACTIC_DISK_THICKNESS_LY,
  bulgeRadiusLy: GALACTIC_BULGE_RADIUS_LY,
  bulgeFraction: 0.1,
  spiralTightness: 1.2,
  armSpreadRad: 0.28,
  barFraction: 0.08,
};

describe('R2-9 银晕径向逆变换采样 haloRadiusFromUniform', () => {
  it('u=0 → 内截断半径，u=1 → 外截断半径', () => {
    expect(haloRadiusFromUniform(0, 10000, 80000)).toBeCloseTo(10000, 6);
    expect(haloRadiusFromUniform(1, 10000, 80000)).toBeCloseTo(80000, 6);
  });

  it('对 u 单调递增', () => {
    let prev = 0;
    for (let u = 0; u <= 1.0001; u += 0.05) {
      const r = haloRadiusFromUniform(Math.min(1, u), 10000, 80000);
      expect(r).toBeGreaterThan(prev);
      prev = r;
    }
  });

  it('中位半径小于区间中点（n ∝ r^-3.5 中心聚集）', () => {
    const median = haloRadiusFromUniform(0.5, 10000, 80000);
    expect(median).toBeLessThan((10000 + 80000) / 2);
  });

  it('非法参数抛 RangeError', () => {
    expect(() => haloRadiusFromUniform(-0.1, 10000, 80000)).toThrow(RangeError);
    expect(() => haloRadiusFromUniform(1.1, 10000, 80000)).toThrow(RangeError);
    expect(() => haloRadiusFromUniform(0.5, 0, 80000)).toThrow(RangeError);
    expect(() => haloRadiusFromUniform(0.5, 80000, 10000)).toThrow(RangeError);
  });
});

describe('R2-9 3D 恒星银晕 generateGalaxyHaloParticles', () => {
  const halo = generateGalaxyHaloParticles(HALO_PARAMS);

  it('粒子数符合需求区间 2,000–4,000（配置 3,000）', () => {
    expect(halo.count).toBe(3000);
    expect(halo.count).toBeGreaterThanOrEqual(2000);
    expect(halo.count).toBeLessThanOrEqual(4000);
    expect(halo.positionsLy).toHaveLength(3000 * 3);
    expect(halo.colors).toHaveLength(3000 * 3);
    expect(halo.sizes).toHaveLength(3000);
  });

  it('确定性：同种子两次生成逐字节一致', () => {
    const again = generateGalaxyHaloParticles(HALO_PARAMS);
    expect(again.positionsLy).toEqual(halo.positionsLy);
    expect(again.colors).toEqual(halo.colors);
    expect(again.sizes).toEqual(halo.sizes);
  });

  it('半径全部落在截断区间内（还原压扁前半径）', () => {
    for (let i = 0; i < halo.count; i += 1) {
      const x = halo.positionsLy[i * 3];
      const y = halo.positionsLy[i * 3 + 1] / HALO_PARAMS.flattening;
      const z = halo.positionsLy[i * 3 + 2];
      const r = Math.hypot(x, y, z);
      expect(r).toBeGreaterThanOrEqual(HALO_MIN_RADIUS_LY * 0.999);
      expect(r).toBeLessThanOrEqual(HALO_MAX_RADIUS_LY * 1.001);
    }
  });

  it('径向密度内密外疏（r^-3.5 统计特征：内 1/4 区间粒子多于外 1/2 区间）', () => {
    let inner = 0;
    let outer = 0;
    for (let i = 0; i < halo.count; i += 1) {
      const r = Math.hypot(
        halo.positionsLy[i * 3],
        halo.positionsLy[i * 3 + 1] / HALO_PARAMS.flattening,
        halo.positionsLy[i * 3 + 2],
      );
      if (r < 20000) inner += 1;
      if (r > 40000) outer += 1;
    }
    // 理论 CDF：r<20000 约 45%、r>40000 约 23%
    expect(inner).toBeGreaterThan(outer * 1.5);
  });

  it('三维立体分布（非平面）：|y| 与面内半径同量级（立体包裹感）', () => {
    let sumAbsY = 0;
    let sumPlanar = 0;
    for (let i = 0; i < halo.count; i += 1) {
      sumAbsY += Math.abs(halo.positionsLy[i * 3 + 1]);
      sumPlanar += Math.hypot(halo.positionsLy[i * 3], halo.positionsLy[i * 3 + 2]);
    }
    expect(sumAbsY / sumPlanar).toBeGreaterThan(0.3);
  });

  it('粒子大小小于盘粒子上限（暗淡银晕 0.9–1.6）', () => {
    for (let i = 0; i < halo.count; i += 1) {
      expect(halo.sizes[i]).toBeGreaterThanOrEqual(0.9);
      expect(halo.sizes[i]).toBeLessThanOrEqual(1.6);
    }
  });

  it('非法参数抛 RangeError', () => {
    expect(() => generateGalaxyHaloParticles({ ...HALO_PARAMS, count: 0 })).toThrow(RangeError);
    expect(() => generateGalaxyHaloParticles({ ...HALO_PARAMS, count: 1.5 })).toThrow(RangeError);
    expect(() => generateGalaxyHaloParticles({ ...HALO_PARAMS, flattening: 0 })).toThrow(
      RangeError,
    );
    expect(() => generateGalaxyHaloParticles({ ...HALO_PARAMS, flattening: 1.2 })).toThrow(
      RangeError,
    );
  });
});

describe('R2-9 球状星团系统 generateGlobularClusters', () => {
  const set = generateGlobularClusters(CLUSTER_PARAMS);

  it('程序化 29 簇 + M13（L3 条目）= 30，落在需求 20–40 区间', () => {
    expect(set.clusterCount).toBe(29);
    expect(set.clusterCount + 1).toBeGreaterThanOrEqual(20);
    expect(set.clusterCount + 1).toBeLessThanOrEqual(40);
    expect(set.count).toBe(29 * GLOBULAR_CLUSTER_STARS);
    expect(set.centersLy).toHaveLength(29 * 3);
  });

  it('确定性：同种子两次生成逐字节一致', () => {
    const again = generateGlobularClusters(CLUSTER_PARAMS);
    expect(again.positionsLy).toEqual(set.positionsLy);
    expect(again.centersLy).toEqual(set.centersLy);
    expect(again.colors).toEqual(set.colors);
  });

  it('联动不重复：所有程序化簇中心距 M13（t=0 银心系）≥ 排除半径', () => {
    const m13 = m13GalactocentricT0Ly();
    for (let c = 0; c < set.clusterCount; c += 1) {
      const d = Math.hypot(
        set.centersLy[c * 3] - m13.x,
        set.centersLy[c * 3 + 1] - m13.y,
        set.centersLy[c * 3 + 2] - m13.z,
      );
      expect(d).toBeGreaterThanOrEqual(M13_EXCLUSION_RADIUS_LY);
    }
  });

  it('高银纬分布：平均 |cosθ| 显著大于各向同性的 0.5', () => {
    let sum = 0;
    for (let c = 0; c < set.clusterCount; c += 1) {
      const r = Math.hypot(
        set.centersLy[c * 3],
        set.centersLy[c * 3 + 1],
        set.centersLy[c * 3 + 2],
      );
      sum += Math.abs(set.centersLy[c * 3 + 1]) / r;
    }
    expect(sum / set.clusterCount).toBeGreaterThan(0.55);
  });

  it('中心聚集：簇中心距中位数小于区间中点', () => {
    const radii: number[] = [];
    for (let c = 0; c < set.clusterCount; c += 1) {
      radii.push(
        Math.hypot(set.centersLy[c * 3], set.centersLy[c * 3 + 1], set.centersLy[c * 3 + 2]),
      );
    }
    radii.sort((a, b) => a - b);
    const median = radii[Math.floor(radii.length / 2)];
    expect(median).toBeLessThan((GLOBULAR_MIN_RADIUS_LY + GLOBULAR_MAX_RADIUS_LY) / 2);
    // 且全部在截断区间内
    expect(radii[0]).toBeGreaterThanOrEqual(GLOBULAR_MIN_RADIUS_LY * 0.999);
    expect(radii[radii.length - 1]).toBeLessThanOrEqual(GLOBULAR_MAX_RADIUS_LY * 1.001);
  });

  it('点簇形态：成员星围绕簇中心紧致散布（≤ 6σ），首粒子为亮核', () => {
    for (let c = 0; c < set.clusterCount; c += 1) {
      const cx = set.centersLy[c * 3];
      const cy = set.centersLy[c * 3 + 1];
      const cz = set.centersLy[c * 3 + 2];
      for (let s = 0; s < CLUSTER_PARAMS.starsPerCluster; s += 1) {
        const i = c * CLUSTER_PARAMS.starsPerCluster + s;
        const d = Math.hypot(
          set.positionsLy[i * 3] - cx,
          set.positionsLy[i * 3 + 1] - cy,
          set.positionsLy[i * 3 + 2] - cz,
        );
        if (s === 0) {
          expect(d).toBe(0);
          expect(set.sizes[i]).toBeCloseTo(4.5, 6);
        } else {
          expect(d).toBeLessThanOrEqual(GLOBULAR_SPREAD_LY * 6 * Math.sqrt(3));
          expect(set.sizes[i]).toBeLessThan(4.5);
        }
      }
    }
  });

  it('m13GalactocentricT0Ly 与 data/specialBodies m13-cluster 偏移同源', () => {
    const m13 = m13GalactocentricT0Ly();
    expect(m13.x).toBeCloseTo(SUN_GALACTIC_RADIUS_LY - 2100, 6);
    expect(m13.y).toBe(6200);
    expect(m13.z).toBe(-5200);
  });

  it('非法参数抛 RangeError', () => {
    expect(() => generateGlobularClusters({ ...CLUSTER_PARAMS, clusterCount: 0 })).toThrow(
      RangeError,
    );
    expect(() => generateGlobularClusters({ ...CLUSTER_PARAMS, starsPerCluster: 1 })).toThrow(
      RangeError,
    );
  });
});

describe('R2-9 棒结构（generateGalaxyDiskParticles barFraction + 刚性旋转）', () => {
  const particles = generateGalaxyDiskParticles(DISK_PARAMS);

  it('棒粒子占比正确且 barFlags 仅 0/1', () => {
    let bar = 0;
    for (let i = 0; i < particles.count; i += 1) {
      const flag = particles.barFlags[i];
      expect(flag === 0 || flag === 1).toBe(true);
      if (flag === 1) bar += 1;
    }
    expect(bar).toBe(Math.round(DISK_PARAMS.count * 0.08));
  });

  it('棒粒子几何：|r·cosφ| ≤ 半长、|r·sinφ| ≤ 半长×轴比（沿 x 轴细长）', () => {
    for (let i = 0; i < particles.count; i += 1) {
      if (particles.barFlags[i] !== 1) continue;
      const r = particles.radiiLy[i];
      const phi = particles.phases[i];
      expect(Math.abs(r * Math.cos(phi))).toBeLessThanOrEqual(GALACTIC_BAR_HALF_LENGTH_LY * 1.001);
      expect(Math.abs(r * Math.sin(phi))).toBeLessThanOrEqual(
        GALACTIC_BAR_HALF_LENGTH_LY * GALACTIC_BAR_AXIS_RATIO * 1.001,
      );
      // 厚度截断（高斯 σ = thickness/4，6σ 内）
      expect(Math.abs(particles.heightsLy[i])).toBeLessThan(GALACTIC_BAR_THICKNESS_LY * 1.5);
    }
  });

  it('棒俯视可辨：长轴方向粒子广延显著大于短轴（轴比 < 0.6）', () => {
    let sumX2 = 0;
    let sumZ2 = 0;
    let n = 0;
    for (let i = 0; i < particles.count; i += 1) {
      if (particles.barFlags[i] !== 1) continue;
      const x = particles.radiiLy[i] * Math.cos(particles.phases[i]);
      const z = particles.radiiLy[i] * Math.sin(particles.phases[i]);
      sumX2 += x * x;
      sumZ2 += z * z;
      n += 1;
    }
    expect(n).toBeGreaterThan(0);
    expect(Math.sqrt(sumZ2 / n) / Math.sqrt(sumX2 / n)).toBeLessThan(0.6);
  });

  it('刚性旋转：barParticleAngle 与半径无关，角速度 = Ω_b', () => {
    const days = 100 * DAYS_PER_MYR;
    expect(barParticleAngle(0, days) - 0).toBeCloseTo(BAR_PATTERN_SPEED_RAD_PER_MYR * 100, 9);
    expect(barParticleAngle(1.5, days) - 1.5).toBeCloseTo(BAR_PATTERN_SPEED_RAD_PER_MYR * 100, 9);
    expect(barParticleAngle(0.7, 0)).toBe(0.7);
  });

  it('缺省 barFraction=0 向后兼容：全部 barFlags 为 0', () => {
    const legacy = generateGalaxyDiskParticles({ ...DISK_PARAMS, barFraction: undefined });
    for (let i = 0; i < legacy.count; i += 1) {
      expect(legacy.barFlags[i]).toBe(0);
    }
  });

  it('核球 + 棒占比之和 > 1 抛 RangeError', () => {
    expect(() =>
      generateGalaxyDiskParticles({ ...DISK_PARAMS, bulgeFraction: 0.6, barFraction: 0.5 }),
    ).toThrow(RangeError);
    expect(() => generateGalaxyDiskParticles({ ...DISK_PARAMS, barFraction: -0.1 })).toThrow(
      RangeError,
    );
  });
});

describe('R2-9 视角因子（尘埃带侧视剪影 + 核球椭球感）', () => {
  const tilt = (60.2 * Math.PI) / 180;

  it('galaxyFaceOnFactor：沿银盘法线观察 = 1，银盘面内观察 = 0', () => {
    // 银盘法线（本地 +y）经 Rx(tilt) 得世界方向 (0, cos, sin)
    expect(galaxyFaceOnFactor(0, Math.cos(tilt), Math.sin(tilt), tilt)).toBeCloseTo(1, 9);
    // 本地 x 轴（世界 x 轴）在银盘面内
    expect(galaxyFaceOnFactor(1, 0, 0, tilt)).toBeCloseTo(0, 9);
    // 本地 z 轴经 Rx(tilt) → (0, −sin, cos)
    expect(galaxyFaceOnFactor(0, -Math.sin(tilt), Math.cos(tilt), tilt)).toBeCloseTo(0, 9);
  });

  it('galaxyFaceOnFactor：零向量按正视处理，结果钳制 ≤ 1', () => {
    expect(galaxyFaceOnFactor(0, 0, 0, tilt)).toBe(1);
    expect(galaxyFaceOnFactor(0, 1, 0, 0)).toBe(1);
  });

  it('dustLaneStrength：侧视全强度、正视为 0、单调不增', () => {
    expect(dustLaneStrength(0)).toBe(1);
    expect(dustLaneStrength(0.05)).toBe(1);
    expect(dustLaneStrength(0.5)).toBe(0);
    expect(dustLaneStrength(1)).toBe(0);
    let prev = 1;
    for (let f = 0; f <= 1.0001; f += 0.05) {
      const s = dustLaneStrength(Math.min(1, f));
      expect(s).toBeLessThanOrEqual(prev + 1e-9);
      prev = s;
    }
  });

  it('bulgeAxisRatio：侧视 0.5 → 正视 1.0，越界钳制', () => {
    expect(bulgeAxisRatio(0)).toBe(0.5);
    expect(bulgeAxisRatio(1)).toBe(1);
    expect(bulgeAxisRatio(0.5)).toBeCloseTo(0.75, 9);
    expect(bulgeAxisRatio(-1)).toBe(0.5);
    expect(bulgeAxisRatio(2)).toBe(1);
  });
});
