/**
 * 星系近观多分量 ① 单元测试（R4-9，IMPROVEMENT_REQUIREMENTS_4 §R4-9）
 *
 * 覆盖：9 星系形态参数表（RC3/S4G/NED 登记值与形态类型逐一一致）、
 * 分量配额纯函数与总量预算（单星系 ≤12,000，自 8,000 上调登记）、
 * 尘埃带/HII 区/年轻星团新分量的分布范围与配额、HII 泊松盘最小间距、
 * 老年盘底色半径梯度单调性、组合入口确定性（双次生成逐字节一致）、
 * 非旋涡星系新分量为零（渲染零改动回归前提）。
 */

import { LOCAL_GROUP_GALAXIES, MILKY_WAY } from '@/data/galaxies';
import {
  DISK_COLOR_GRADIENT_INNER,
  DISK_COLOR_GRADIENT_OUTER,
  DUST_LANE_INNER_OFFSET_FACTOR,
  DUST_LANE_SPREAD_FACTOR,
  DUST_LANE_THICKNESS_FACTOR,
  DUST_PARTICLES_PER_UNIT_STRENGTH,
  GALAXY_MORPHOLOGY_PARAMS,
  GALAXY_NEAR_VIEW_BASE_MAX_PARTICLES,
  GALAXY_NEAR_VIEW_CONFIGS,
  GALAXY_NEAR_VIEW_LRU_CAPACITY,
  GALAXY_NEAR_VIEW_MAX_PARTICLES,
  HII_POISSON_MIN_SEPARATION_FACTOR,
  HII_REGIONS_PER_UNIT_DENSITY,
  OLD_DISK_GRADIENT_BLEND,
  YOUNG_CLUSTER_PARTICLES_PER_UNIT_DENSITY,
  YOUNG_CLUSTER_RIDGE_SPREAD_FACTOR,
  applyOldDiskColorGradient,
  galaxyComponentQuota,
  galaxyNearViewSeed,
  generateDustLaneParticles,
  generateGalaxyNearViewComposite,
  generateGalaxyNearViewParticles,
  generateHiiRegionParticles,
  generateYoungClusterParticles,
  oldDiskColorAtRadius,
  spiralArmRidgePhaseRad,
  type GalaxyComponentParticles,
  type SpiralNearViewConfig,
} from '@/utils/galaxyNearView';

const CONFIGURED_IDS = Object.keys(GALAXY_NEAR_VIEW_CONFIGS);
const PARAM_IDS = Object.keys(GALAXY_MORPHOLOGY_PARAMS);
const SPIRAL_IDS = CONFIGURED_IDS.filter(
  (id) => GALAXY_NEAR_VIEW_CONFIGS[id].kind === 'spiral',
);

/** m31 旋涡配置（类型收窄工具） */
function spiralConfig(id: string): SpiralNearViewConfig {
  const cfg = GALAXY_NEAR_VIEW_CONFIGS[id];
  if (cfg.kind !== 'spiral') throw new Error(`${id} 配置必须为旋涡`);
  return cfg;
}

/** 相位残差 → [−π, π]（脊线对齐断言用） */
function wrapAngle(a: number): number {
  const twoPi = Math.PI * 2;
  let x = a % twoPi;
  if (x > Math.PI) x -= twoPi;
  if (x < -Math.PI) x += twoPi;
  return x;
}

/** 粒子集逐字节相等断言（确定性） */
function expectByteIdentical(
  a: { count: number; positionsLy: Float32Array; colors: Float32Array; sizes: Float32Array },
  b: { count: number; positionsLy: Float32Array; colors: Float32Array; sizes: Float32Array },
): void {
  expect(a.count).toBe(b.count);
  expect(Array.from(a.positionsLy)).toEqual(Array.from(b.positionsLy));
  expect(Array.from(a.colors)).toEqual(Array.from(b.colors));
  expect(Array.from(a.sizes)).toEqual(Array.from(b.sizes));
}

describe('9 星系形态参数表（§R4-9：RC3/S4G/NED 登记，与形态类型逐一一致）', () => {
  it('参数表 = 本星系群 8 星系 + 银河系（近观复用登记），共 9 条', () => {
    expect(PARAM_IDS.length).toBe(9);
    for (const g of LOCAL_GROUP_GALAXIES) {
      expect(GALAXY_MORPHOLOGY_PARAMS[g.id]).toBeDefined();
    }
    expect(GALAXY_MORPHOLOGY_PARAMS['milky-way']).toBeDefined();
  });

  it('椭圆/矮椭圆（m32/m110/sagittarius-dwarf/m87）：dust/HII/臂数/螺距角为 0，B/D 无盘登记 Infinity', () => {
    for (const g of LOCAL_GROUP_GALAXIES) {
      if (g.morphology !== 'elliptical') continue;
      const p = GALAXY_MORPHOLOGY_PARAMS[g.id];
      expect(p.dustStrength).toBe(0);
      expect(p.hiiDensity).toBe(0);
      expect(p.armCount).toBe(0);
      expect(p.pitchAngleDeg).toBe(0);
      expect(p.bulgeToDiskRatio).toBe(Number.POSITIVE_INFINITY);
    }
    // 逐一断言四个椭圆类 id 均被上述循环覆盖
    const ellipticalIds = LOCAL_GROUP_GALAXIES.filter(
      (g) => g.morphology === 'elliptical',
    ).map((g) => g.id);
    expect(ellipticalIds.sort()).toEqual(['m110', 'm32', 'm87', 'sagittarius-dwarf']);
  });

  it('旋涡（m31/m33）：臂数 ≥1、螺距角 >0、B/D 有限、dust/HII >0', () => {
    for (const g of LOCAL_GROUP_GALAXIES) {
      if (g.morphology !== 'spiral') continue;
      const p = GALAXY_MORPHOLOGY_PARAMS[g.id];
      expect(p.armCount).toBeGreaterThanOrEqual(1);
      expect(p.pitchAngleDeg).toBeGreaterThan(0);
      expect(Number.isFinite(p.bulgeToDiskRatio)).toBe(true);
      expect(p.dustStrength).toBeGreaterThan(0);
      expect(p.hiiDensity).toBeGreaterThan(0);
    }
  });

  it('不规则（lmc/smc）：螺距角 0（无对数螺旋臂）、dust/HII 登记非零（30 Dor 等观测特征）', () => {
    for (const g of LOCAL_GROUP_GALAXIES) {
      if (g.morphology !== 'irregular') continue;
      const p = GALAXY_MORPHOLOGY_PARAMS[g.id];
      expect(p.pitchAngleDeg).toBe(0);
      expect(p.dustStrength).toBeGreaterThan(0);
      expect(p.hiiDensity).toBeGreaterThan(0);
      expect(Number.isFinite(p.bulgeToDiskRatio)).toBe(true);
    }
  });

  it('M31 真实倾角 77°（NED 登记，R4-10 姿态消费）', () => {
    expect(GALAXY_MORPHOLOGY_PARAMS.m31.inclinationDeg).toBe(77);
  });

  it('银河系（barred-spiral）：4 臂与 MILKY_WAY 命名表一致；近观复用登记（无配置/配额抛错）', () => {
    const p = GALAXY_MORPHOLOGY_PARAMS['milky-way'];
    expect(MILKY_WAY.morphology).toBe('barred-spiral');
    expect(p.armCount).toBe(MILKY_WAY.armNames.length);
    expect(p.source).toContain('复用');
    expect(GALAXY_NEAR_VIEW_CONFIGS['milky-way']).toBeUndefined();
    expect(() => galaxyComponentQuota('milky-way')).toThrow(RangeError);
  });

  it('全表数值域：倾角 [0,90]、dust/HII [0,1]、来源登记非空（RC3/S4G/NED 出处）', () => {
    for (const id of PARAM_IDS) {
      const p = GALAXY_MORPHOLOGY_PARAMS[id];
      expect(p.inclinationDeg).toBeGreaterThanOrEqual(0);
      expect(p.inclinationDeg).toBeLessThanOrEqual(90);
      expect(p.dustStrength).toBeGreaterThanOrEqual(0);
      expect(p.dustStrength).toBeLessThanOrEqual(1);
      expect(p.hiiDensity).toBeGreaterThanOrEqual(0);
      expect(p.hiiDensity).toBeLessThanOrEqual(1);
      expect(p.source.length).toBeGreaterThan(0);
    }
    const sources = PARAM_IDS.map((id) => GALAXY_MORPHOLOGY_PARAMS[id].source).join(' ');
    expect(sources).toContain('RC3');
    expect(sources).toContain('S4G');
    expect(sources).toContain('NED');
  });
});

describe('分量配额纯函数与总量预算（§R4-9：单星系 ≤12,000，上调登记）', () => {
  it('预算常量：总量上限 12,000（自 8,000 上调登记）、基础层上限 8,000 不变、LRU 容量 1', () => {
    expect(GALAXY_NEAR_VIEW_MAX_PARTICLES).toBe(12000);
    expect(GALAXY_NEAR_VIEW_BASE_MAX_PARTICLES).toBe(8000);
    expect(GALAXY_NEAR_VIEW_LRU_CAPACITY).toBe(1);
  });

  it('全部 8 配置星系：total = base+dust+hii+yc ≤ 12,000；LRU 容量 1 → 全局峰值增量 ≤ +12,000', () => {
    let peak = 0;
    for (const id of CONFIGURED_IDS) {
      const q = galaxyComponentQuota(id);
      expect(q.base).toBe(GALAXY_NEAR_VIEW_CONFIGS[id].particleCount);
      expect(q.total).toBe(q.base + q.dust + q.hii + q.youngClusters);
      expect(q.total).toBeLessThanOrEqual(GALAXY_NEAR_VIEW_MAX_PARTICLES);
      peak = Math.max(peak, q.total);
    }
    expect(peak * GALAXY_NEAR_VIEW_LRU_CAPACITY).toBeLessThanOrEqual(
      GALAXY_NEAR_VIEW_MAX_PARTICLES,
    );
  });

  it('旋涡配额随形态参数线性缩放（m31：dust=1600×0.8 等）', () => {
    const q = galaxyComponentQuota('m31');
    const p = GALAXY_MORPHOLOGY_PARAMS.m31;
    expect(q.dust).toBe(Math.round(DUST_PARTICLES_PER_UNIT_STRENGTH * p.dustStrength));
    expect(q.hii).toBe(Math.round(HII_REGIONS_PER_UNIT_DENSITY * p.hiiDensity));
    expect(q.youngClusters).toBe(
      Math.round(YOUNG_CLUSTER_PARTICLES_PER_UNIT_DENSITY * p.hiiDensity),
    );
    expect(q.dust).toBeGreaterThan(0);
    expect(q.hii).toBeGreaterThan(0);
    expect(q.youngClusters).toBeGreaterThan(0);
  });

  it('非旋涡（不规则/椭圆）新分量配额为 0（不规则 HII/年轻星由 R2-8 团块承载，登记）', () => {
    for (const id of CONFIGURED_IDS) {
      if (GALAXY_NEAR_VIEW_CONFIGS[id].kind === 'spiral') continue;
      const q = galaxyComponentQuota(id);
      expect(q.dust).toBe(0);
      expect(q.hii).toBe(0);
      expect(q.youngClusters).toBe(0);
      expect(q.total).toBe(q.base);
    }
  });

  it('未配置 id（milky-way/未知）抛 RangeError', () => {
    expect(() => galaxyComponentQuota('unknown')).toThrow(RangeError);
    expect(() => galaxyComponentQuota('milky-way')).toThrow(RangeError);
  });
});

describe('尘埃带分量（§R4-9：旋臂内缘暗吸收粒子）', () => {
  const cfg = spiralConfig('m31');
  const quota = galaxyComponentQuota('m31');
  const dust = generateDustLaneParticles(cfg, quota.dust, galaxyNearViewSeed('m31:dust'));

  it('分量标记 component=dust；数量 = 配额；数组长度一致', () => {
    expect(dust.component).toBe('dust');
    expect(dust.count).toBe(quota.dust);
    expect(dust.positionsLy.length).toBe(dust.count * 3);
    expect(dust.colors.length).toBe(dust.count * 3);
    expect(dust.sizes.length).toBe(dust.count);
  });

  it('暗吸收颜色：全部通道 < 0.3（深棕低亮度，R4-10 normal 混合前提）', () => {
    for (let i = 0; i < dust.count * 3; i += 1) {
      expect(dust.colors[i]).toBeGreaterThanOrEqual(0);
      expect(dust.colors[i]).toBeLessThan(0.3);
    }
  });

  it('分布范围：盘面半径 ∈ [核球半径, 0.95×盘半径]；薄层 |y| ≤ 3σ 截断上界', () => {
    const maxAbsY = (cfg.thicknessLy / 2) * DUST_LANE_THICKNESS_FACTOR * 3 + 1e-6;
    for (let i = 0; i < dust.count; i += 1) {
      const planarR = Math.hypot(dust.positionsLy[i * 3], dust.positionsLy[i * 3 + 2]);
      expect(planarR).toBeGreaterThanOrEqual(cfg.bulgeRadiusLy - 1e-3);
      expect(planarR).toBeLessThanOrEqual(cfg.diskRadiusLy * 0.95 + 1e-3);
      expect(Math.abs(dust.positionsLy[i * 3 + 1])).toBeLessThanOrEqual(maxAbsY);
    }
  });

  it('旋臂内缘对齐：相位残差中心 ≈ 内缘偏移（0.6×臂宽），散布 ≤ 偏移+3σ×0.35×臂宽', () => {
    const maxResidual =
      cfg.armSpreadRad * (DUST_LANE_INNER_OFFSET_FACTOR + 3 * DUST_LANE_SPREAD_FACTOR) + 1e-6;
    let sumResidual = 0;
    for (let i = 0; i < dust.count; i += 1) {
      const x = dust.positionsLy[i * 3];
      const z = dust.positionsLy[i * 3 + 2];
      const r = Math.hypot(x, z);
      const phi = Math.atan2(-z, x);
      let best = Infinity;
      for (let arm = 0; arm < cfg.armCount; arm += 1) {
        const d = wrapAngle(phi - spiralArmRidgePhaseRad(cfg, arm, r));
        if (Math.abs(d) < Math.abs(best)) best = d;
      }
      expect(Math.abs(best)).toBeLessThanOrEqual(maxResidual);
      sumResidual += best;
    }
    // 平均残差为正（偏向内缘一侧），显著大于 0
    expect(sumResidual / dust.count).toBeGreaterThan(
      cfg.armSpreadRad * DUST_LANE_INNER_OFFSET_FACTOR * 0.5,
    );
  });

  it('尺寸 ∈ [1.6, 2.6]；count=0 → 空数组；负数/非整数抛 RangeError', () => {
    for (let i = 0; i < dust.count; i += 1) {
      expect(dust.sizes[i]).toBeGreaterThanOrEqual(1.6);
      expect(dust.sizes[i]).toBeLessThanOrEqual(2.6);
    }
    const empty = generateDustLaneParticles(cfg, 0, 1);
    expect(empty.count).toBe(0);
    expect(empty.positionsLy.length).toBe(0);
    expect(() => generateDustLaneParticles(cfg, -1, 1)).toThrow(RangeError);
    expect(() => generateDustLaneParticles(cfg, 1.5, 1)).toThrow(RangeError);
  });
});

describe('HII 区分量（§R4-9：泊松盘采样防重叠）', () => {
  it.each(SPIRAL_IDS)('%s：数量达配额且两两间距 ≥ 最小间距（泊松盘）', (id) => {
    const cfg = spiralConfig(id);
    const quota = galaxyComponentQuota(id);
    const hii = generateHiiRegionParticles(cfg, quota.hii, galaxyNearViewSeed(`${id}:hii`));
    expect(hii.component).toBe('hii');
    expect(hii.count).toBe(quota.hii);
    const minSep = cfg.diskRadiusLy * HII_POISSON_MIN_SEPARATION_FACTOR;
    for (let i = 0; i < hii.count; i += 1) {
      for (let j = i + 1; j < hii.count; j += 1) {
        const d = Math.hypot(
          hii.positionsLy[i * 3] - hii.positionsLy[j * 3],
          hii.positionsLy[i * 3 + 1] - hii.positionsLy[j * 3 + 1],
          hii.positionsLy[i * 3 + 2] - hii.positionsLy[j * 3 + 2],
        );
        expect(d).toBeGreaterThanOrEqual(minSep - 1e-6);
      }
    }
  });

  it('m31：粉红发射色（r > g）、大颗粒尺寸 ∈ [3.0, 4.5]、径向范围 [1.1×核球, 0.92×盘]', () => {
    const cfg = spiralConfig('m31');
    const quota = galaxyComponentQuota('m31');
    const hii = generateHiiRegionParticles(cfg, quota.hii, galaxyNearViewSeed('m31:hii'));
    for (let i = 0; i < hii.count; i += 1) {
      expect(hii.colors[i * 3]).toBeGreaterThan(hii.colors[i * 3 + 1]);
      expect(hii.sizes[i]).toBeGreaterThanOrEqual(3.0);
      expect(hii.sizes[i]).toBeLessThanOrEqual(4.5);
      const planarR = Math.hypot(hii.positionsLy[i * 3], hii.positionsLy[i * 3 + 2]);
      expect(planarR).toBeGreaterThanOrEqual(cfg.bulgeRadiusLy * 1.1 - 1e-3);
      expect(planarR).toBeLessThanOrEqual(cfg.diskRadiusLy * 0.92 + 1e-3);
    }
  });

  it('count=0 → 空数组；负数/非整数抛 RangeError', () => {
    const cfg = spiralConfig('m31');
    expect(generateHiiRegionParticles(cfg, 0, 1).count).toBe(0);
    expect(() => generateHiiRegionParticles(cfg, -1, 1)).toThrow(RangeError);
    expect(() => generateHiiRegionParticles(cfg, 0.5, 1)).toThrow(RangeError);
  });
});

describe('年轻星团分量（§R4-9：旋臂脊线蓝白颗粒串）', () => {
  const cfg = spiralConfig('m33');
  const quota = galaxyComponentQuota('m33');
  const yc = generateYoungClusterParticles(
    cfg,
    quota.youngClusters,
    galaxyNearViewSeed('m33:youngClusters'),
  );

  it('分量标记与配额；蓝白色（b ≥ r 通道）；小颗粒尺寸 ∈ [0.8, 1.4]', () => {
    expect(yc.component).toBe('youngClusters');
    expect(yc.count).toBe(quota.youngClusters);
    for (let i = 0; i < yc.count; i += 1) {
      expect(yc.colors[i * 3 + 2]).toBeGreaterThanOrEqual(yc.colors[i * 3]);
      expect(yc.sizes[i]).toBeGreaterThanOrEqual(0.8);
      expect(yc.sizes[i]).toBeLessThanOrEqual(1.4);
    }
  });

  it('紧贴旋臂脊线：相位残差 ≤ 3σ×0.15×臂宽（±3σ 截断保证）', () => {
    const maxResidual = cfg.armSpreadRad * YOUNG_CLUSTER_RIDGE_SPREAD_FACTOR * 3 + 1e-6;
    for (let i = 0; i < yc.count; i += 1) {
      const x = yc.positionsLy[i * 3];
      const z = yc.positionsLy[i * 3 + 2];
      const r = Math.hypot(x, z);
      const phi = Math.atan2(-z, x);
      let best = Infinity;
      for (let arm = 0; arm < cfg.armCount; arm += 1) {
        const d = Math.abs(wrapAngle(phi - spiralArmRidgePhaseRad(cfg, arm, r)));
        best = Math.min(best, d);
      }
      expect(best).toBeLessThanOrEqual(maxResidual);
    }
  });

  it('薄层与径向范围：|y| ≤ 3σ×0.25×半厚度；盘面半径 ∈ [1.05×核球, 0.9×盘]', () => {
    const maxAbsY = (cfg.thicknessLy / 2) * 0.25 * 3 + 1e-6;
    for (let i = 0; i < yc.count; i += 1) {
      expect(Math.abs(yc.positionsLy[i * 3 + 1])).toBeLessThanOrEqual(maxAbsY);
      const planarR = Math.hypot(yc.positionsLy[i * 3], yc.positionsLy[i * 3 + 2]);
      expect(planarR).toBeGreaterThanOrEqual(cfg.bulgeRadiusLy * 1.05 - 1e-3);
      expect(planarR).toBeLessThanOrEqual(cfg.diskRadiusLy * 0.9 + 1e-3);
    }
  });

  it('count=0 → 空数组；负数/非整数抛 RangeError', () => {
    expect(generateYoungClusterParticles(cfg, 0, 1).count).toBe(0);
    expect(() => generateYoungClusterParticles(cfg, -2, 1)).toThrow(RangeError);
    expect(() => generateYoungClusterParticles(cfg, 3.7, 1)).toThrow(RangeError);
  });
});

describe('老年盘底色半径梯度（§R4-9：内红黄外偏蓝，参数化）', () => {
  it('端点 = 梯度常量；红通道单调不增、蓝通道单调不减（颜色梯度单调性）', () => {
    expect(oldDiskColorAtRadius(0)).toEqual(DISK_COLOR_GRADIENT_INNER);
    expect(oldDiskColorAtRadius(1)).toEqual(DISK_COLOR_GRADIENT_OUTER);
    let prev = oldDiskColorAtRadius(0);
    for (let k = 1; k <= 100; k += 1) {
      const c = oldDiskColorAtRadius(k / 100);
      expect(c.r).toBeLessThanOrEqual(prev.r + 1e-9);
      expect(c.b).toBeGreaterThanOrEqual(prev.b - 1e-9);
      prev = c;
    }
    // 内端偏红黄（r>b）、外端偏蓝（b>r）
    expect(DISK_COLOR_GRADIENT_INNER.r).toBeGreaterThan(DISK_COLOR_GRADIENT_INNER.b);
    expect(DISK_COLOR_GRADIENT_OUTER.b).toBeGreaterThan(DISK_COLOR_GRADIENT_OUTER.r);
  });

  it('域外钳制（[0,1] 外取端点值）；NaN 抛 RangeError', () => {
    expect(oldDiskColorAtRadius(-0.5)).toEqual(oldDiskColorAtRadius(0));
    expect(oldDiskColorAtRadius(1.5)).toEqual(oldDiskColorAtRadius(1));
    expect(() => oldDiskColorAtRadius(NaN)).toThrow(RangeError);
  });

  it('applyOldDiskColorGradient：入参不变、positions/sizes 共享；核球区原色、盘区向梯度混合', () => {
    const cfg = spiralConfig('m31');
    const raw = generateGalaxyNearViewParticles('m31');
    const rawColors = Array.from(raw.colors);
    const applied = applyOldDiskColorGradient(raw, cfg);
    // 纯函数：入参 colors 不变；positions/sizes 引用共享
    expect(Array.from(raw.colors)).toEqual(rawColors);
    expect(applied.positionsLy).toBe(raw.positionsLy);
    expect(applied.sizes).toBe(raw.sizes);
    let changedOutside = 0;
    for (let i = 0; i < raw.count; i += 1) {
      const planarR = Math.hypot(raw.positionsLy[i * 3], raw.positionsLy[i * 3 + 2]);
      const changed =
        applied.colors[i * 3] !== raw.colors[i * 3] ||
        applied.colors[i * 3 + 1] !== raw.colors[i * 3 + 1] ||
        applied.colors[i * 3 + 2] !== raw.colors[i * 3 + 2];
      if (planarR <= cfg.bulgeRadiusLy) {
        expect(changed).toBe(false);
      } else if (changed) {
        changedOutside += 1;
        // 混合后仍在 [0,1]
        expect(applied.colors[i * 3]).toBeGreaterThanOrEqual(0);
        expect(applied.colors[i * 3]).toBeLessThanOrEqual(1);
      }
    }
    expect(changedOutside).toBeGreaterThan(0);
    expect(OLD_DISK_GRADIENT_BLEND).toBeGreaterThan(0);
    expect(OLD_DISK_GRADIENT_BLEND).toBeLessThan(1);
  });

  it('梯度应用后外盘平均蓝/红比高于原始（内红黄外偏蓝观感前提）', () => {
    const cfg = spiralConfig('m31');
    const raw = generateGalaxyNearViewParticles('m31');
    const applied = applyOldDiskColorGradient(raw, cfg);
    let rawBlueOverRed = 0;
    let appliedBlueOverRed = 0;
    let outer = 0;
    for (let i = 0; i < raw.count; i += 1) {
      const planarR = Math.hypot(raw.positionsLy[i * 3], raw.positionsLy[i * 3 + 2]);
      if (planarR < cfg.diskRadiusLy * 0.7) continue;
      outer += 1;
      rawBlueOverRed += raw.colors[i * 3 + 2] / Math.max(raw.colors[i * 3], 1e-6);
      appliedBlueOverRed += applied.colors[i * 3 + 2] / Math.max(applied.colors[i * 3], 1e-6);
    }
    expect(outer).toBeGreaterThan(0);
    expect(appliedBlueOverRed / outer).toBeGreaterThan(rawBlueOverRed / outer);
  });
});

describe('组合入口 generateGalaxyNearViewComposite（§R4-9：确定性 + 总量断言）', () => {
  it('确定性：m31/m87 两次生成逐字节一致（FNV-1a 分量派生种子）', () => {
    for (const id of ['m31', 'm87']) {
      const a = generateGalaxyNearViewComposite(id);
      const b = generateGalaxyNearViewComposite(id);
      expectByteIdentical(a.base, b.base);
      expect(a.components.length).toBe(b.components.length);
      for (let k = 0; k < a.components.length; k += 1) {
        expect(a.components[k].component).toBe(b.components[k].component);
        expectByteIdentical(a.components[k], b.components[k]);
      }
      expect(a.totalCount).toBe(b.totalCount);
    }
  });

  it('旋涡：分量为 dust/hii/youngClusters 三件；totalCount = 配额合计 ≤ 12,000', () => {
    for (const id of SPIRAL_IDS) {
      const c = generateGalaxyNearViewComposite(id);
      const names = c.components.map((p: GalaxyComponentParticles) => p.component);
      expect(names).toEqual(['dust', 'hii', 'youngClusters']);
      expect(c.totalCount).toBe(galaxyComponentQuota(id).total);
      expect(c.totalCount).toBeLessThanOrEqual(GALAXY_NEAR_VIEW_MAX_PARTICLES);
    }
  });

  it('非旋涡（不规则/椭圆）：分量为空、base 与 R2-8 基础层逐字节一致（渲染零变化前提）', () => {
    for (const id of CONFIGURED_IDS) {
      if (GALAXY_NEAR_VIEW_CONFIGS[id].kind === 'spiral') continue;
      const c = generateGalaxyNearViewComposite(id);
      expect(c.components).toEqual([]);
      expectByteIdentical(c.base, generateGalaxyNearViewParticles(id));
      expect(c.totalCount).toBe(c.base.count);
    }
  });

  it('旋涡 base = 基础层 + 老年盘色梯度（positions/sizes 与 R2-8 输出一致，颜色再着色）', () => {
    const c = generateGalaxyNearViewComposite('m31');
    const raw = generateGalaxyNearViewParticles('m31');
    expect(Array.from(c.base.positionsLy)).toEqual(Array.from(raw.positionsLy));
    expect(Array.from(c.base.sizes)).toEqual(Array.from(raw.sizes));
    expect(Array.from(c.base.colors)).not.toEqual(Array.from(raw.colors));
  });

  it('未配置 id 抛 RangeError；全部配置星系组合可生成且位置有限', () => {
    expect(() => generateGalaxyNearViewComposite('milky-way')).toThrow(RangeError);
    expect(() => generateGalaxyNearViewComposite('unknown')).toThrow(RangeError);
    for (const id of CONFIGURED_IDS) {
      const c = generateGalaxyNearViewComposite(id);
      for (const comp of c.components) {
        for (let i = 0; i < comp.count * 3; i += 1) {
          expect(Number.isFinite(comp.positionsLy[i])).toBe(true);
          expect(comp.colors[i]).toBeGreaterThanOrEqual(0);
          expect(comp.colors[i]).toBeLessThanOrEqual(1);
        }
      }
    }
  });
});
