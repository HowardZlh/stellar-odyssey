/**
 * L4 星系近观 3D 粒子层单元测试（R2-8，IMPROVEMENT_REQUIREMENTS_2 §R2-8）
 *
 * 覆盖：确定性种子/朝向、逐星系配置完整性与形态一致性、粒子预算（基础层
 * 单星系 ≤8,000；R4-9 起总量上限 12,000 由 galaxyNearViewR49 断言，等价
 * 迁移登记）、Sérsic 径向采样、椭球轴比/盘厚/团块分布统计特征、近观激活
 * 距离与 resolveFocusTarget 同源、LRU 释放语义（容量 1）、持有者注册表、
 * 信息面板结构说明、贴图平面尺寸同源公式。
 */

import { LOCAL_GROUP_GALAXIES, getGalaxyById } from '@/data/galaxies';
import {
  GALAXY_NEAR_VIEW_BASE_MAX_PARTICLES,
  GALAXY_NEAR_VIEW_CONFIGS,
  GALAXY_NEAR_VIEW_LRU_CAPACITY,
  GALAXY_STRUCTURE_NOTE_BY_MORPHOLOGY_ZH,
  GALAXY_STRUCTURE_SOURCE_ZH,
  KIND_BY_MORPHOLOGY,
  SERSIC_MAX_RADIUS_FACTOR,
  claimGalaxyNearView,
  galaxyNearViewEnterDistanceUnits,
  galaxyNearViewHolderIds,
  galaxyNearViewSeed,
  galaxyOrientationFromId,
  generateGalaxyNearViewParticles,
  nearViewLruUpdate,
  nearViewReferenceRadiusLy,
  resetGalaxyNearViewHolders,
  sersicRadiusFactor,
} from '@/utils/galaxyNearView';
import { NEAR_VIEW_ENTER_RATIO } from '@/utils/nearView';
import { resolveFocusTarget } from '@/utils/cameraFocus';
import {
  GALAXY_PLANE_SHRINK_FACTOR,
  MW_VISUAL_RADIUS_UNITS,
  galaxyPlaneSizeUnits,
} from '@/utils/universe';

const CONFIGURED_IDS = Object.keys(GALAXY_NEAR_VIEW_CONFIGS);

describe('galaxyPlaneSizeUnits（贴图平面尺寸同源公式）', () => {
  it('M31：直径 15.2 万光年 → (1.52)×2500×2×0.55 = 4180 场景单位', () => {
    expect(galaxyPlaneSizeUnits(152000)).toBeCloseTo(
      (152000 / 100000) * MW_VISUAL_RADIUS_UNITS * 2 * GALAXY_PLANE_SHRINK_FACTOR,
      10,
    );
    expect(galaxyPlaneSizeUnits(152000)).toBeCloseTo(4180, 6);
  });

  it('非法直径（0/负/NaN/Infinity）抛 RangeError', () => {
    for (const bad of [0, -1, NaN, Infinity]) {
      expect(() => galaxyPlaneSizeUnits(bad)).toThrow(RangeError);
    }
  });
});

describe('确定性种子与朝向', () => {
  it('同一 id 两次求种子结果一致，不同 id 种子不同', () => {
    expect(galaxyNearViewSeed('m31')).toBe(galaxyNearViewSeed('m31'));
    const seeds = CONFIGURED_IDS.map(galaxyNearViewSeed);
    expect(new Set(seeds).size).toBe(seeds.length);
  });

  it('galaxyOrientationFromId 与贴图平面时期 id 哈希公式逐字一致', () => {
    // 独立复算（R2-8 前 Universe.tsx orientationFromId 的公式）
    const expected = (id: string): [number, number, number] => {
      let h = 0;
      for (let i = 0; i < id.length; i += 1) {
        h = (h * 31 + id.charCodeAt(i)) >>> 0;
      }
      return [((h % 100) / 100) * Math.PI * 0.5, ((h % 37) / 37) * Math.PI, 0];
    };
    for (const id of CONFIGURED_IDS) {
      expect(galaxyOrientationFromId(id)).toEqual(expected(id));
    }
  });
});

describe('逐星系配置完整性与形态一致性（§8.2 验收 2）', () => {
  it('本星系群全部 8 个贴图平面星系均有近观配置', () => {
    for (const g of LOCAL_GROUP_GALAXIES) {
      expect(GALAXY_NEAR_VIEW_CONFIGS[g.id]).toBeDefined();
    }
    expect(CONFIGURED_IDS.length).toBe(LOCAL_GROUP_GALAXIES.length);
  });

  it('近观形态类别与数据层形态分类一致（旋涡/不规则/椭圆）', () => {
    for (const g of LOCAL_GROUP_GALAXIES) {
      const cfg = GALAXY_NEAR_VIEW_CONFIGS[g.id];
      expect(cfg.kind).toBe(
        KIND_BY_MORPHOLOGY[g.morphology as keyof typeof KIND_BY_MORPHOLOGY],
      );
    }
  });

  it('粒子预算：基础层单星系 ≤8,000（R2-8 原预算不变，R4-9 总量迁移登记）；LRU 容量 1', () => {
    for (const id of CONFIGURED_IDS) {
      expect(GALAXY_NEAR_VIEW_CONFIGS[id].particleCount).toBeLessThanOrEqual(
        GALAXY_NEAR_VIEW_BASE_MAX_PARTICLES,
      );
      expect(GALAXY_NEAR_VIEW_CONFIGS[id].particleCount).toBeGreaterThan(0);
    }
    expect(GALAXY_NEAR_VIEW_LRU_CAPACITY).toBe(1);
    const peak = Math.max(
      ...CONFIGURED_IDS.map((id) => GALAXY_NEAR_VIEW_CONFIGS[id].particleCount),
    );
    expect(peak * GALAXY_NEAR_VIEW_LRU_CAPACITY).toBeLessThanOrEqual(
      GALAXY_NEAR_VIEW_BASE_MAX_PARTICLES,
    );
  });
});

describe('generateGalaxyNearViewParticles（确定性生成）', () => {
  it('同一星系两次生成逐字节一致（两次飞往形态一致）', () => {
    for (const id of ['m31', 'lmc', 'm87']) {
      const a = generateGalaxyNearViewParticles(id);
      const b = generateGalaxyNearViewParticles(id);
      expect(a.count).toBe(b.count);
      expect(Array.from(a.positionsLy)).toEqual(Array.from(b.positionsLy));
      expect(Array.from(a.colors)).toEqual(Array.from(b.colors));
      expect(Array.from(a.sizes)).toEqual(Array.from(b.sizes));
    }
  });

  it('全部 8 星系：数组长度一致、位置有限、颜色/大小在合理区间', () => {
    for (const id of CONFIGURED_IDS) {
      const p = generateGalaxyNearViewParticles(id);
      expect(p.count).toBe(GALAXY_NEAR_VIEW_CONFIGS[id].particleCount);
      expect(p.positionsLy.length).toBe(p.count * 3);
      expect(p.colors.length).toBe(p.count * 3);
      expect(p.sizes.length).toBe(p.count);
      for (let i = 0; i < p.count * 3; i += 1) {
        expect(Number.isFinite(p.positionsLy[i])).toBe(true);
        expect(p.colors[i]).toBeGreaterThanOrEqual(0);
        expect(p.colors[i]).toBeLessThanOrEqual(1);
      }
      for (let i = 0; i < p.count; i += 1) {
        expect(p.sizes[i]).toBeGreaterThan(0);
        expect(p.sizes[i]).toBeLessThanOrEqual(2.6);
      }
    }
  });

  it('未配置 id（milky-way / 未知）抛 RangeError', () => {
    expect(() => generateGalaxyNearViewParticles('milky-way')).toThrow(RangeError);
    expect(() => generateGalaxyNearViewParticles('unknown')).toThrow(RangeError);
  });

  it('旋涡 M31：核球占比可辨（中心密）且盘面扁平（|y| 远小于盘半径）', () => {
    const cfg = GALAXY_NEAR_VIEW_CONFIGS.m31;
    if (cfg.kind !== 'spiral') throw new Error('M31 配置必须为旋涡');
    const p = generateGalaxyNearViewParticles('m31');
    let inBulge = 0;
    let maxAbsY = 0;
    for (let i = 0; i < p.count; i += 1) {
      const x = p.positionsLy[i * 3];
      const y = p.positionsLy[i * 3 + 1];
      const z = p.positionsLy[i * 3 + 2];
      if (Math.hypot(x, y, z) < cfg.bulgeRadiusLy) inBulge += 1;
      maxAbsY = Math.max(maxAbsY, Math.abs(y));
    }
    // 核球粒子占比 30% → 中心 1.5 万光年内至少 25% 粒子
    expect(inBulge / p.count).toBeGreaterThan(0.25);
    // 盘内粒子高斯高度（σ=厚度/2=1500）+ 核球半径 → 远小于盘半径 76,000
    expect(maxAbsY).toBeLessThan(cfg.diskRadiusLy * 0.5);
  });

  it('椭圆 M110：y 轴（短轴 0.55）统计上明显扁于 x 轴（Sérsic 椭球）', () => {
    const cfg = GALAXY_NEAR_VIEW_CONFIGS.m110;
    if (cfg.kind !== 'elliptical') throw new Error('M110 配置必须为椭圆');
    const p = generateGalaxyNearViewParticles('m110');
    let sumX2 = 0;
    let sumY2 = 0;
    for (let i = 0; i < p.count; i += 1) {
      sumX2 += p.positionsLy[i * 3] ** 2;
      sumY2 += p.positionsLy[i * 3 + 1] ** 2;
    }
    const ratio = Math.sqrt(sumY2 / sumX2);
    // 理论轴比 0.55×√2（x 仅承担 sinPolar·cos 方位分量），统计上 y/x < 0.9
    expect(ratio).toBeLessThan(0.9);
    // 全部粒子处于截断半径内
    const maxR = cfg.effectiveRadiusLy * SERSIC_MAX_RADIUS_FACTOR;
    for (let i = 0; i < p.count; i += 1) {
      expect(Math.abs(p.positionsLy[i * 3])).toBeLessThanOrEqual(maxR + 1e-3);
    }
  });

  it('不规则 LMC：粒子分布有界（团块 3σ 截断）且呈团块聚集', () => {
    const cfg = GALAXY_NEAR_VIEW_CONFIGS.lmc;
    if (cfg.kind !== 'irregular') throw new Error('LMC 配置必须为不规则');
    const p = generateGalaxyNearViewParticles('lmc');
    // 上界：团块中心 0.75R + 3σ（σ ≤ R×fraction）
    const bound = cfg.radiusLy * (0.75 + 3 * cfg.clumpRadiusFraction) + 1e-3;
    let insideHalf = 0;
    for (let i = 0; i < p.count; i += 1) {
      const r = Math.hypot(
        p.positionsLy[i * 3],
        p.positionsLy[i * 3 + 1],
        p.positionsLy[i * 3 + 2],
      );
      expect(r).toBeLessThanOrEqual(bound);
      if (r < cfg.radiusLy * 0.75) insideHalf += 1;
    }
    // 团块偏内散布 + 弥散偏内分布 → 多数粒子集中于 0.75R 内（聚集性）
    expect(insideHalf / p.count).toBeGreaterThan(0.55);
  });
});

describe('sersicRadiusFactor（Sérsic 径向采样）', () => {
  it('t=0 → 0；随 t 单调不减；截断于 SERSIC_MAX_RADIUS_FACTOR', () => {
    expect(sersicRadiusFactor(0, 4)).toBe(0);
    for (const n of [1, 1.5, 3, 4]) {
      let prev = 0;
      for (let k = 0; k <= 99; k += 1) {
        const v = sersicRadiusFactor(k / 100, n);
        expect(v).toBeGreaterThanOrEqual(prev);
        expect(v).toBeLessThanOrEqual(SERSIC_MAX_RADIUS_FACTOR);
        prev = v;
      }
    }
    // 尾部趋近截断值
    expect(sersicRadiusFactor(0.999999999, 4)).toBe(SERSIC_MAX_RADIUS_FACTOR);
  });

  it('中位分位数半径 ≈ Rₑ 量级（半光半径语义近似）', () => {
    // t=1−e^{−bₙ} 时 r=Rₑ 精确成立；此处验证公式反解
    for (const n of [1, 4]) {
      const bn = 2 * n - 1 / 3;
      const tAtRe = 1 - Math.exp(-bn);
      expect(sersicRadiusFactor(tAtRe, n)).toBeCloseTo(1, 6);
    }
  });

  it('非法输入抛 RangeError（t 越界 / n 越界）', () => {
    expect(() => sersicRadiusFactor(-0.1, 4)).toThrow(RangeError);
    expect(() => sersicRadiusFactor(1, 4)).toThrow(RangeError);
    expect(() => sersicRadiusFactor(NaN, 4)).toThrow(RangeError);
    expect(() => sersicRadiusFactor(0.5, 0.3)).toThrow(RangeError);
    expect(() => sersicRadiusFactor(0.5, 11)).toThrow(RangeError);
    expect(() => sersicRadiusFactor(0.5, NaN)).toThrow(RangeError);
  });
});

describe('近观激活距离（与 resolveFocusTarget 同源，禁止两套参数）', () => {
  it('全部 8 星系：进入阈值 = 飞往观察距离 × NEAR_VIEW_ENTER_RATIO', () => {
    for (const id of CONFIGURED_IDS) {
      const target = resolveFocusTarget(id, 0);
      expect(target).not.toBeNull();
      expect(galaxyNearViewEnterDistanceUnits(id)).toBeCloseTo(
        target!.viewDistanceUnits * NEAR_VIEW_ENTER_RATIO,
        8,
      );
    }
  });

  it('未配置 id 抛 RangeError（milky-way 近观 = 既有粒子渲染，差异登记）', () => {
    expect(() => galaxyNearViewEnterDistanceUnits('milky-way')).toThrow(RangeError);
    expect(() => galaxyNearViewEnterDistanceUnits('quasar-3c273')).toThrow(RangeError);
  });

  it('nearViewReferenceRadiusLy：旋涡=盘半径 / 不规则=云体半径 / 椭圆=截断半径', () => {
    expect(nearViewReferenceRadiusLy('m31')).toBe(76000);
    expect(nearViewReferenceRadiusLy('lmc')).toBe(16000);
    expect(nearViewReferenceRadiusLy('m87')).toBe(12000 * SERSIC_MAX_RADIUS_FACTOR);
    expect(() => nearViewReferenceRadiusLy('unknown')).toThrow(RangeError);
  });

  it('参考半径与数据层直径同数量级（粒子层与贴图平面尺寸对齐的前提）', () => {
    for (const id of CONFIGURED_IDS) {
      const g = getGalaxyById(id)!;
      const ratio = nearViewReferenceRadiusLy(id) / (g.diameterLy / 2);
      expect(ratio).toBeGreaterThan(0.2);
      expect(ratio).toBeLessThan(2.5);
    }
  });
});

describe('nearViewLruUpdate（LRU 释放语义，容量 1）', () => {
  it('空表激活 m31 → 持有 [m31]、无释放', () => {
    expect(nearViewLruUpdate([], 'm31')).toEqual({ holders: ['m31'], releasedIds: [] });
  });

  it('持有 m31 时激活 m33 → 持有 [m33]、释放 [m31]（挤出即释放）', () => {
    expect(nearViewLruUpdate(['m31'], 'm33')).toEqual({
      holders: ['m33'],
      releasedIds: ['m31'],
    });
  });

  it('重复激活同一持有者 → 无释放（快速切回免重建）', () => {
    expect(nearViewLruUpdate(['m31'], 'm31')).toEqual({
      holders: ['m31'],
      releasedIds: [],
    });
  });

  it('activeId=null（离开跟随）→ 保持现状不释放（LRU 保留语义）', () => {
    expect(nearViewLruUpdate(['m31'], null)).toEqual({
      holders: ['m31'],
      releasedIds: [],
    });
  });

  it('容量 2 时保留最近 2 个、第三个激活挤出最旧', () => {
    const step1 = nearViewLruUpdate([], 'm31', 2);
    const step2 = nearViewLruUpdate(step1.holders, 'm33', 2);
    expect(step2).toEqual({ holders: ['m33', 'm31'], releasedIds: [] });
    const step3 = nearViewLruUpdate(step2.holders, 'lmc', 2);
    expect(step3).toEqual({ holders: ['lmc', 'm33'], releasedIds: ['m31'] });
  });

  it('非法容量抛 RangeError', () => {
    expect(() => nearViewLruUpdate([], 'm31', 0)).toThrow(RangeError);
    expect(() => nearViewLruUpdate([], 'm31', 1.5)).toThrow(RangeError);
  });
});

describe('持有者注册表（渲染端单例）', () => {
  beforeEach(() => resetGalaxyNearViewHolders());
  afterAll(() => resetGalaxyNearViewHolders());

  it('claim → 持有者更新；换目标 claim → 返回被挤出 id', () => {
    expect(galaxyNearViewHolderIds()).toEqual([]);
    expect(claimGalaxyNearView('m31')).toEqual([]);
    expect(galaxyNearViewHolderIds()).toEqual(['m31']);
    expect(claimGalaxyNearView('smc')).toEqual(['m31']);
    expect(galaxyNearViewHolderIds()).toEqual(['smc']);
  });

  it('reset 清空注册表', () => {
    claimGalaxyNearView('m31');
    resetGalaxyNearViewHolders();
    expect(galaxyNearViewHolderIds()).toEqual([]);
  });
});

describe('信息面板结构说明（§8.1 近观联动）', () => {
  it('四种形态均有非空结构说明；来源标注含 Sérsic 登记', () => {
    for (const morphology of ['spiral', 'barred-spiral', 'elliptical', 'irregular'] as const) {
      expect(
        GALAXY_STRUCTURE_NOTE_BY_MORPHOLOGY_ZH[morphology].length,
      ).toBeGreaterThan(10);
    }
    expect(GALAXY_STRUCTURE_NOTE_BY_MORPHOLOGY_ZH.spiral).toContain('核球');
    expect(GALAXY_STRUCTURE_NOTE_BY_MORPHOLOGY_ZH.spiral).toContain('晕');
    expect(GALAXY_STRUCTURE_NOTE_BY_MORPHOLOGY_ZH.elliptical).toContain('Sérsic');
    expect(GALAXY_STRUCTURE_SOURCE_ZH).toContain('Sérsic');
  });
});
