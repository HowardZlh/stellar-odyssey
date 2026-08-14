/**
 * 渲染质量档位表单测（M2）：high 档与现状逐项一致（桌面回归保险丝）+
 * medium/low 档位表数值 + 纯函数（LRU 容量换算/并发/adaptiveDpr/
 * 目录抽稀步长与构建/单星系 quota 缩放/太阳粒子缩放预算）。
 */

import {
  DETAIL_BODY_NOMINAL_MB,
  QUALITY_TIER_SPECS,
  adaptiveDpr,
  catalogSampleStride,
  detailLruCapacityForBudgetMB,
  qualityTierSpec,
  textureConcurrency,
} from '@/utils/qualityTier';
import { VOLUME_QUALITY_SPECS } from '@/utils/adaptiveQuality';
import { DETAIL_LRU_CAPACITY } from '@/utils/planetDetail';
import {
  GLOBAL_PARTICLE_BUDGET,
  NEAR_VIEW_PARTICLE_INCREMENTS,
  SOLAR_ACTIVITY_PARTICLE_PEAK,
} from '@/utils/nearView';
import {
  GALAXY_NEAR_VIEW_CONFIGS,
  GALAXY_NEAR_VIEW_MAX_PARTICLES,
  galaxyComponentQuota,
} from '@/utils/galaxyNearView';
import { CME_PARTICLE_COUNT, WIND_PARTICLE_COUNT } from '@/utils/solarActivity';
import { buildCatalogLodAttributes } from '@/utils/galaxyCatalog';
import type { GalaxyCatalogData } from '@/utils/bakedData';

describe('档位表：high 档与现状逐项一致（桌面回归保险丝）', () => {
  const high = qualityTierSpec('high');

  it('Canvas/后处理参数 = 现状（dpr [1,2] R3F 默认 / antialias / logDepth / MSAA 4 / Bloom 开）', () => {
    expect(high.dpr).toEqual([1, 2]);
    expect(high.antialias).toBe(true);
    expect(high.logarithmicDepthBuffer).toBe(true);
    expect(high.multisampling).toBe(4);
    expect(high.bloomDefault).toBe(true);
  });

  it('体积档起点 high 且不锁定（= createAdaptiveQuality 现状默认档）', () => {
    expect(high.volumeInitialTier).toBe('high');
    expect(high.volumeTierLocked).toBe(false);
    // 现状 high 档参数（64 步 / RT 全分辨率）
    expect(VOLUME_QUALITY_SPECS[high.volumeInitialTier]).toEqual({
      stepScale: 1,
      resolutionScale: 1,
      steps: 64,
    });
  });

  it('粒子/纹理预算 = 现状常量（跨模块同源断言）', () => {
    expect(high.diskParticleCount).toBe(40000);
    expect(high.catalogKeepFraction).toBe(1);
    expect(high.nearViewParticleBudget).toBe(GLOBAL_PARTICLE_BUDGET);
    expect(high.galaxyNearViewMaxParticles).toBe(GALAXY_NEAR_VIEW_MAX_PARTICLES);
    expect(high.galaxyNearViewParticleScale).toBe(1);
    expect(high.solarParticleScale).toBe(1);
    expect(high.allow4kDetail).toBe(true);
    expect(high.anisotropy).toBe(4);
    // LRU 预算 300MB → 容量 2 = 现状 DETAIL_LRU_CAPACITY
    expect(detailLruCapacityForBudgetMB(high.textureLruBudgetMB)).toBe(DETAIL_LRU_CAPACITY);
  });
});

describe('档位表：medium / low 数值（§M2-1/§M2-3/§M2-4）', () => {
  it('medium 档', () => {
    const m = qualityTierSpec('medium');
    expect(m.dpr).toEqual([1, 1.5]);
    expect(m.antialias).toBe(false);
    expect(m.logarithmicDepthBuffer).toBe(true);
    expect(m.multisampling).toBe(2);
    expect(m.bloomDefault).toBe(true);
    expect(m.volumeInitialTier).toBe('mid');
    expect(m.volumeTierLocked).toBe(false);
    expect(m.diskParticleCount).toBe(24000);
    expect(m.catalogKeepFraction).toBe(1);
    expect(m.textureLruBudgetMB).toBe(128);
    expect(m.allow4kDetail).toBe(false);
    expect(m.anisotropy).toBe(2);
  });

  it('low 档', () => {
    const l = qualityTierSpec('low');
    expect(l.dpr).toBe(1);
    expect(l.antialias).toBe(false);
    expect(l.logarithmicDepthBuffer).toBe(false);
    expect(l.multisampling).toBe(0);
    expect(l.bloomDefault).toBe(false);
    expect(l.volumeInitialTier).toBe('low');
    expect(l.volumeTierLocked).toBe(true);
    // 锁定档 = 32 步 + RT 0.5（§M2-2 第三条）
    expect(VOLUME_QUALITY_SPECS.low.steps).toBe(32);
    expect(VOLUME_QUALITY_SPECS.low.resolutionScale).toBe(0.5);
    expect(l.diskParticleCount).toBe(12000);
    expect(l.catalogKeepFraction).toBe(0.5);
    expect(l.nearViewParticleBudget).toBe(10000);
    expect(l.galaxyNearViewMaxParticles).toBe(6000);
    expect(l.galaxyNearViewParticleScale).toBe(0.5);
    expect(l.solarParticleScale).toBe(0.5);
    expect(l.textureLruBudgetMB).toBe(96);
    expect(l.allow4kDetail).toBe(false);
    expect(l.anisotropy).toBe(2);
  });

  it('qualityTierSpec 与 QUALITY_TIER_SPECS 同引用（唯一事实源）', () => {
    for (const tier of ['high', 'medium', 'low'] as const) {
      expect(qualityTierSpec(tier)).toBe(QUALITY_TIER_SPECS[tier]);
    }
  });
});

describe('detailLruCapacityForBudgetMB（预算 MB → LRU 天体容量）', () => {
  it('300 → 2（现状）/ 128 → 1 / 96 → 1（下限 1）', () => {
    expect(detailLruCapacityForBudgetMB(300)).toBe(2);
    expect(detailLruCapacityForBudgetMB(128)).toBe(1);
    expect(detailLruCapacityForBudgetMB(96)).toBe(1);
    expect(detailLruCapacityForBudgetMB(DETAIL_BODY_NOMINAL_MB - 1)).toBe(1);
  });

  it('非法预算抛 RangeError', () => {
    expect(() => detailLruCapacityForBudgetMB(0)).toThrow(RangeError);
    expect(() => detailLruCapacityForBudgetMB(-1)).toThrow(RangeError);
    expect(() => detailLruCapacityForBudgetMB(Number.NaN)).toThrow(RangeError);
    expect(() => detailLruCapacityForBudgetMB(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe('textureConcurrency（§M2-4：桌面 3 / 触屏 2）', () => {
  it('取值', () => {
    expect(textureConcurrency(false)).toBe(3);
    expect(textureConcurrency(true)).toBe(2);
  });
});

describe('adaptiveDpr（自适应档 dpr 钳制，设备档为上界）', () => {
  it('区间基（high 设备 [1,2]）：high 原样 / mid 钳 1.5 / low 收敛为定值 1', () => {
    expect(adaptiveDpr([1, 2], 'high')).toEqual([1, 2]);
    expect(adaptiveDpr([1, 2], 'mid')).toEqual([1, 1.5]);
    expect(adaptiveDpr([1, 2], 'low')).toBe(1);
  });

  it('medium 设备 [1,1.5]：high/mid 不越设备档 / low 降 1', () => {
    expect(adaptiveDpr([1, 1.5], 'high')).toEqual([1, 1.5]);
    expect(adaptiveDpr([1, 1.5], 'mid')).toEqual([1, 1.5]);
    expect(adaptiveDpr([1, 1.5], 'low')).toBe(1);
  });

  it('定值基（low 设备 1）恒 1（永不越出设备档）', () => {
    expect(adaptiveDpr(1, 'high')).toBe(1);
    expect(adaptiveDpr(1, 'mid')).toBe(1);
    expect(adaptiveDpr(1, 'low')).toBe(1);
  });
});

describe('catalogSampleStride（2MRS 均匀跨步）', () => {
  it('1 → 步长 1（全量）/ 0.5 → 步长 2（抽稀 50%）', () => {
    expect(catalogSampleStride(1)).toBe(1);
    expect(catalogSampleStride(0.5)).toBe(2);
    expect(catalogSampleStride(0.25)).toBe(4);
  });

  it('非法比例抛 RangeError', () => {
    expect(() => catalogSampleStride(0)).toThrow(RangeError);
    expect(() => catalogSampleStride(-0.5)).toThrow(RangeError);
    expect(() => catalogSampleStride(1.5)).toThrow(RangeError);
    expect(() => catalogSampleStride(Number.NaN)).toThrow(RangeError);
  });
});

describe('buildCatalogLodAttributes 抽稀（M2-3）', () => {
  /** 最小目录 mock：沿 +x 距离 10..100 Mpc 的 10 条（近域阈值 80 分档） */
  function mockCatalog(): GalaxyCatalogData {
    const count = 10;
    const positionsMpc = new Float32Array(count * 3);
    const morphTiers = new Uint8Array(count);
    const jkTiers = new Uint8Array(count);
    const brightness01 = new Float32Array(count);
    for (let i = 0; i < count; i += 1) {
      positionsMpc[i * 3] = 10 * (i + 1); // 10,20,...,100 Mpc
      morphTiers[i] = i % 3;
      jkTiers[i] = (i * 11) % 100; // 覆盖 0–99（含未知档 99——i=9）
      brightness01[i] = i / count;
    }
    return { count, positionsMpc, morphTiers, jkTiers, brightness01 };
  }

  it('缺省 keepFraction=1 与显式 1 逐字节一致（现状零回退）', () => {
    const data = mockCatalog();
    const a = buildCatalogLodAttributes(data);
    const b = buildCatalogLodAttributes(data, 1);
    expect(a.near.count + a.far.count).toBe(10);
    expect(b.near.positions).toEqual(a.near.positions);
    expect(b.far.positions).toEqual(a.far.positions);
    expect(b.near.sizes).toEqual(a.near.sizes);
  });

  it('keepFraction=0.5 保留偶数全局索引（近域/远景合计恰半）', () => {
    const data = mockCatalog();
    const thin = buildCatalogLodAttributes(data, 0.5);
    // 偶数索引距离 10,30,50,70（≤80 近域 4 条）与 90（远景 1 条）
    expect(thin.near.count).toBe(4);
    expect(thin.far.count).toBe(1);
    // 保留条目的属性与全量构建对应条目一致（首条 near = 索引 0，x=10 Mpc）
    const full = buildCatalogLodAttributes(data, 1);
    expect(thin.near.positions[0]).toBeCloseTo(full.near.positions[0], 6);
    expect(thin.near.sizes[0]).toBe(full.near.sizes[0]);
  });
});

describe('galaxyComponentQuota particleScale（M2-3 单星系降档）', () => {
  const spiralId = Object.keys(GALAXY_NEAR_VIEW_CONFIGS).find(
    (id) => GALAXY_NEAR_VIEW_CONFIGS[id].kind === 'spiral',
  ) as string;

  it('scale 缺省/显式 1 与现状逐项一致（零回退）', () => {
    const base = galaxyComponentQuota(spiralId);
    const explicit = galaxyComponentQuota(spiralId, { particleScale: 1 });
    expect(explicit).toEqual(base);
  });

  it('scale=0.5 各分量 floor 减半，全部配置星系总量 ≤ low 档上限 6,000', () => {
    const lowMax = qualityTierSpec('low').galaxyNearViewMaxParticles;
    for (const id of Object.keys(GALAXY_NEAR_VIEW_CONFIGS)) {
      const full = galaxyComponentQuota(id);
      const half = galaxyComponentQuota(id, { particleScale: 0.5 });
      expect(half.base).toBe(Math.floor(full.base * 0.5));
      expect(half.dust).toBe(Math.floor(full.dust * 0.5));
      expect(half.hii).toBe(Math.floor(full.hii * 0.5));
      expect(half.youngClusters).toBe(Math.floor(full.youngClusters * 0.5));
      expect(half.total).toBeLessThanOrEqual(full.total / 2);
      expect(half.total).toBeLessThanOrEqual(lowMax);
    }
  });

  it('非法 scale 抛 RangeError', () => {
    expect(() => galaxyComponentQuota(spiralId, { particleScale: 0 })).toThrow(RangeError);
    expect(() => galaxyComponentQuota(spiralId, { particleScale: 1.2 })).toThrow(RangeError);
    expect(() => galaxyComponentQuota(spiralId, { particleScale: Number.NaN })).toThrow(
      RangeError,
    );
  });
});

describe('近观粒子预算（M2-3：low 档 10,000 可满足性）', () => {
  it('low 档太阳活动粒子（floor 减半）+ 最大近观增量 ≤ 10,000', () => {
    const scale = qualityTierSpec('low').solarParticleScale;
    const solarLow =
      Math.floor(WIND_PARTICLE_COUNT * scale) + Math.floor(CME_PARTICLE_COUNT * scale);
    const maxIncrement = Math.max(...Object.values(NEAR_VIEW_PARTICLE_INCREMENTS));
    expect(solarLow).toBe(7500); // 3,000 + 4,500
    expect(solarLow + maxIncrement).toBeLessThanOrEqual(
      qualityTierSpec('low').nearViewParticleBudget,
    );
  });

  it('high 档预算与现状断言同式（回归保险丝）', () => {
    const maxIncrement = Math.max(...Object.values(NEAR_VIEW_PARTICLE_INCREMENTS));
    expect(SOLAR_ACTIVITY_PARTICLE_PEAK + maxIncrement).toBeLessThanOrEqual(
      qualityTierSpec('high').nearViewParticleBudget,
    );
  });
});
