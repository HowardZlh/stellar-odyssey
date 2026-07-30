/**
 * R5-1 影像驱动星系升级：采样纯逻辑 / 降级路径 / 贴图源选择单元测试
 * （IMPROVEMENT_REQUIREMENTS_5 §R5-1 B/C/D/E）
 */

import {
  IMAGE_DRIVEN_GALAXY_IDS,
  IRREGULAR_MAP_THICKNESS_FACTOR,
  GALAXY_NEAR_VIEW_CONFIGS,
  GALAXY_NEAR_VIEW_MAX_PARTICLES,
  blueRegionWeight,
  buildSamplingCdf,
  galaxyComponentQuota,
  galaxyMapUrls,
  galaxyNearViewSeed,
  galaxySpriteImageUrl,
  generateDustLaneParticlesFromMap,
  generateGalaxyNearViewComposite,
  generateGalaxyNearViewCompositeAuto,
  generateGalaxyNearViewCompositeFromMaps,
  generateHiiRegionParticlesFromMap,
  generateYoungClusterParticlesFromMap,
  imageDrivenThicknessLy,
  isImageDrivenGalaxy,
  sampleCdfIndex,
  sampleParticlesFromMap,
  type GalaxyChannelMap,
  type GalaxyColorMapData,
  type GalaxyImageMaps,
  type SpiralNearViewConfig,
} from '@/utils/galaxyNearView';

// ---------------------------------------------------------------------------
// 合成图组工具（纯数据，替代产物 PNG——像素解码属组件层 hook）
// ---------------------------------------------------------------------------

const SIZE = 16;

function channelMap(fill: (col: number, row: number) => number): GalaxyChannelMap {
  const data = new Uint8Array(SIZE * SIZE);
  for (let row = 0; row < SIZE; row += 1) {
    for (let col = 0; col < SIZE; col += 1) {
      data[row * SIZE + col] = fill(col, row);
    }
  }
  return { size: SIZE, data };
}

function colorMap(
  fill: (col: number, row: number) => [number, number, number],
): GalaxyColorMapData {
  const data = new Uint8Array(SIZE * SIZE * 3);
  for (let row = 0; row < SIZE; row += 1) {
    for (let col = 0; col < SIZE; col += 1) {
      const [r, g, b] = fill(col, row);
      data[(row * SIZE + col) * 3] = r;
      data[(row * SIZE + col) * 3 + 1] = g;
      data[(row * SIZE + col) * 3 + 2] = b;
    }
  }
  return { size: SIZE, data };
}

/** 均匀密度 + 左上象限蓝亮、右下暗红、右上尘埃的合成图组 */
function syntheticMaps(): GalaxyImageMaps {
  return {
    mapRadiusLy: 50000,
    density: channelMap((col, row) => (col < SIZE / 2 && row < SIZE / 2 ? 220 : 60)),
    color: colorMap((col, row) =>
      col < SIZE / 2 && row < SIZE / 2 ? [90, 140, 240] : [200, 120, 80],
    ),
    dust: channelMap((col, row) => (col >= SIZE / 2 && row < SIZE / 2 ? 200 : 0)),
  };
}

const OPTS = { mapRadiusLy: 50000, thicknessLy: 3000 };

// ---------------------------------------------------------------------------
// 覆盖清单与贴图源选择（§R5-1 E）
// ---------------------------------------------------------------------------

describe('覆盖清单与贴图源选择（§R5-1 C/E）', () => {
  it('覆盖清单 = 四星系（椭圆类不套用，登记）', () => {
    expect([...IMAGE_DRIVEN_GALAXY_IDS]).toEqual(['m31', 'm33', 'lmc', 'smc']);
    for (const id of IMAGE_DRIVEN_GALAXY_IDS) {
      expect(isImageDrivenGalaxy(id)).toBe(true);
    }
    for (const id of ['m87', 'm32', 'm110', 'sagittarius-dwarf', 'milky-way', 'unknown']) {
      expect(isImageDrivenGalaxy(id)).toBe(false);
    }
  });

  it('覆盖星系返回影像贴图 URL，未覆盖返回 null（canvas 降级现状）', () => {
    expect(galaxySpriteImageUrl('m31')).toBe('/data/galaxy-maps/m31-sprite.png');
    expect(galaxySpriteImageUrl('smc')).toBe('/data/galaxy-maps/smc-sprite.png');
    expect(galaxySpriteImageUrl('m87')).toBeNull();
    expect(galaxySpriteImageUrl('m110')).toBeNull();
  });

  it('galaxyMapUrls：覆盖星系四件产物 URL；未覆盖 null', () => {
    expect(galaxyMapUrls('m33')).toEqual({
      meta: '/data/galaxy-maps/m33-meta.json',
      density: '/data/galaxy-maps/m33-density.png',
      color: '/data/galaxy-maps/m33-color.png',
      dust: '/data/galaxy-maps/m33-dust.png',
    });
    expect(galaxyMapUrls('m32')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// CDF 逆变换（§R5-1 B）
// ---------------------------------------------------------------------------

describe('采样 CDF（buildSamplingCdf / sampleCdfIndex）', () => {
  it('前缀和单调不减且末项 = 总和', () => {
    const cdf = buildSamplingCdf([1, 0, 2, 3]);
    expect(Array.from(cdf)).toEqual([1, 1, 3, 6]);
  });

  it('非法权重抛 RangeError（空/全零/负值/NaN）', () => {
    expect(() => buildSamplingCdf([])).toThrow(RangeError);
    expect(() => buildSamplingCdf([0, 0])).toThrow(RangeError);
    expect(() => buildSamplingCdf([1, -1])).toThrow(RangeError);
    expect(() => buildSamplingCdf([1, Number.NaN])).toThrow(RangeError);
  });

  it('delta 权重：任意 u 恒采样至该索引', () => {
    const cdf = buildSamplingCdf([0, 0, 5, 0]);
    for (const u of [0, 0.25, 0.5, 0.9999]) {
      expect(sampleCdfIndex(cdf, u)).toBe(2);
    }
  });

  it('均匀权重：u 分位与索引线性对应且不越界', () => {
    const cdf = buildSamplingCdf(new Array(10).fill(1));
    expect(sampleCdfIndex(cdf, 0)).toBe(0);
    expect(sampleCdfIndex(cdf, 0.55)).toBe(5);
    expect(sampleCdfIndex(cdf, 0.9999)).toBe(9);
  });
});

// ---------------------------------------------------------------------------
// 基础层采样（sampleParticlesFromMap）
// ---------------------------------------------------------------------------

describe('sampleParticlesFromMap（§R5-1 B：密度布点 + 颜色查图 + z 参数化）', () => {
  it('确定性：同种子两次采样逐字节一致', () => {
    const maps = syntheticMaps();
    const a = sampleParticlesFromMap(maps.density, maps.color, 500, 42, OPTS);
    const b = sampleParticlesFromMap(maps.density, maps.color, 500, 42, OPTS);
    expect(Buffer.from(a.positionsLy.buffer)).toEqual(Buffer.from(b.positionsLy.buffer));
    expect(Buffer.from(a.colors.buffer)).toEqual(Buffer.from(b.colors.buffer));
    expect(Buffer.from(a.sizes.buffer)).toEqual(Buffer.from(b.sizes.buffer));
  });

  it('不同种子分布不同', () => {
    const maps = syntheticMaps();
    const a = sampleParticlesFromMap(maps.density, maps.color, 100, 1, OPTS);
    const b = sampleParticlesFromMap(maps.density, maps.color, 100, 2, OPTS);
    expect(Buffer.from(a.positionsLy.buffer)).not.toEqual(Buffer.from(b.positionsLy.buffer));
  });

  it('盘面位置界于 ±mapRadiusLy、z 厚度 ≤ 3σ 截断（±1.5×thicknessLy）', () => {
    const maps = syntheticMaps();
    const p = sampleParticlesFromMap(maps.density, maps.color, 800, 7, OPTS);
    for (let i = 0; i < p.count; i += 1) {
      expect(Math.abs(p.positionsLy[i * 3])).toBeLessThanOrEqual(OPTS.mapRadiusLy);
      expect(Math.abs(p.positionsLy[i * 3 + 2])).toBeLessThanOrEqual(OPTS.mapRadiusLy);
      expect(Math.abs(p.positionsLy[i * 3 + 1])).toBeLessThanOrEqual((OPTS.thicknessLy / 2) * 3);
    }
  });

  it('delta 密度：全部粒子落入该像素域（逆变换正确性）', () => {
    const density = channelMap((col, row) => (col === 12 && row === 3 ? 255 : 0));
    const maps = syntheticMaps();
    const p = sampleParticlesFromMap(density, maps.color, 64, 5, OPTS);
    for (let i = 0; i < p.count; i += 1) {
      const u = p.positionsLy[i * 3] / OPTS.mapRadiusLy;
      const v = p.positionsLy[i * 3 + 2] / OPTS.mapRadiusLy;
      // 像素 (12,3) → u ∈ [12/16, 13/16]×2−1, v ∈ [3/16, 4/16]×2−1
      expect(u).toBeGreaterThanOrEqual((12 / 16) * 2 - 1);
      expect(u).toBeLessThanOrEqual((13 / 16) * 2 - 1);
      expect(v).toBeGreaterThanOrEqual((3 / 16) * 2 - 1);
      expect(v).toBeLessThanOrEqual((4 / 16) * 2 - 1);
    }
  });

  it('颜色查图：蓝亮象限粒子 b > r，其余象限 r > b', () => {
    const maps = syntheticMaps();
    const p = sampleParticlesFromMap(maps.density, maps.color, 600, 11, OPTS);
    let blueQuadrant = 0;
    for (let i = 0; i < p.count; i += 1) {
      const u = p.positionsLy[i * 3] / OPTS.mapRadiusLy;
      const v = p.positionsLy[i * 3 + 2] / OPTS.mapRadiusLy;
      const inBlue = u < 0 && v < 0;
      if (inBlue) {
        blueQuadrant += 1;
        expect(p.colors[i * 3 + 2]).toBeGreaterThan(p.colors[i * 3]);
      } else {
        expect(p.colors[i * 3]).toBeGreaterThan(p.colors[i * 3 + 2]);
      }
    }
    // 蓝象限密度 220 vs 其余 60 → 采样显著聚集（1/4 面积 ≈ 55% 概率）
    expect(blueQuadrant / p.count).toBeGreaterThan(0.4);
  });

  it('高密度像素粒径更大（1.0/0.9 基线 + 密度增益）', () => {
    const maps = syntheticMaps();
    const p = sampleParticlesFromMap(maps.density, maps.color, 600, 13, OPTS);
    let denseSum = 0;
    let denseN = 0;
    let sparseSum = 0;
    let sparseN = 0;
    for (let i = 0; i < p.count; i += 1) {
      const u = p.positionsLy[i * 3] / OPTS.mapRadiusLy;
      const v = p.positionsLy[i * 3 + 2] / OPTS.mapRadiusLy;
      if (u < 0 && v < 0) {
        denseSum += p.sizes[i];
        denseN += 1;
      } else {
        sparseSum += p.sizes[i];
        sparseN += 1;
      }
    }
    expect(denseSum / denseN).toBeGreaterThan(sparseSum / sparseN);
  });

  it('入参校验：负数/非整数 count、尺寸不符、非法半径/厚度抛 RangeError', () => {
    const maps = syntheticMaps();
    expect(() => sampleParticlesFromMap(maps.density, maps.color, -1, 1, OPTS)).toThrow(
      RangeError,
    );
    expect(() => sampleParticlesFromMap(maps.density, maps.color, 1.5, 1, OPTS)).toThrow(
      RangeError,
    );
    const badColor = { size: 8, data: new Uint8Array(8 * 8 * 3) };
    expect(() => sampleParticlesFromMap(maps.density, badColor, 10, 1, OPTS)).toThrow(RangeError);
    const badDensity = { size: SIZE, data: new Uint8Array(3) };
    expect(() => sampleParticlesFromMap(badDensity, maps.color, 10, 1, OPTS)).toThrow(RangeError);
    expect(() =>
      sampleParticlesFromMap(maps.density, maps.color, 10, 1, { mapRadiusLy: 0, thicknessLy: 1 }),
    ).toThrow(RangeError);
    expect(() =>
      sampleParticlesFromMap(maps.density, maps.color, 10, 1, {
        mapRadiusLy: 100,
        thicknessLy: -1,
      }),
    ).toThrow(RangeError);
  });

  it('全零密度图抛 RangeError（无有效信号）', () => {
    const maps = syntheticMaps();
    const zero = channelMap(() => 0);
    expect(() => sampleParticlesFromMap(zero, maps.color, 10, 1, OPTS)).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// 分量采样（HII 蓝区加权 / 年轻星团 / 尘埃遮罩）
// ---------------------------------------------------------------------------

describe('影像分量采样（§R5-1 B：高亮蓝区加权 + 尘埃遮罩布点）', () => {
  it('blueRegionWeight：蓝不超红为 0；随密度平方增长', () => {
    expect(blueRegionWeight(1, 0.8, 0.5)).toBe(0);
    expect(blueRegionWeight(1, 0.5, 0.5)).toBe(0);
    const wHalf = blueRegionWeight(0.5, 0.2, 0.8);
    const wFull = blueRegionWeight(1, 0.2, 0.8);
    expect(wFull / wHalf).toBeCloseTo(4, 6);
  });

  it('HII/年轻星团全部落入高亮蓝象限，分量标记正确', () => {
    const maps = syntheticMaps();
    const hii = generateHiiRegionParticlesFromMap(maps, 60, 1, OPTS);
    const young = generateYoungClusterParticlesFromMap(maps, 120, 2, OPTS);
    expect(hii.component).toBe('hii');
    expect(young.component).toBe('youngClusters');
    expect(hii.count).toBe(60);
    expect(young.count).toBe(120);
    for (const set of [hii, young]) {
      for (let i = 0; i < set.count; i += 1) {
        expect(set.positionsLy[i * 3] / OPTS.mapRadiusLy).toBeLessThan(0);
        expect(set.positionsLy[i * 3 + 2] / OPTS.mapRadiusLy).toBeLessThan(0);
      }
    }
  });

  it('无蓝区（权重全零）返回空分量（降级语义，不抛错）', () => {
    const maps = syntheticMaps();
    const redOnly = colorMap(() => [220, 120, 60]);
    const hii = generateHiiRegionParticlesFromMap(
      { ...maps, color: redOnly },
      50,
      1,
      OPTS,
    );
    expect(hii.count).toBe(0);
    expect(hii.positionsLy.length).toBe(0);
  });

  it('尘埃粒子落入尘埃遮罩象限、深棕全通道 < 0.3（normal 混合暗纹前提）', () => {
    const maps = syntheticMaps();
    const dust = generateDustLaneParticlesFromMap(maps, 80, 3, OPTS);
    expect(dust.component).toBe('dust');
    expect(dust.count).toBe(80);
    for (let i = 0; i < dust.count; i += 1) {
      expect(dust.positionsLy[i * 3] / OPTS.mapRadiusLy).toBeGreaterThan(0);
      expect(dust.positionsLy[i * 3 + 2] / OPTS.mapRadiusLy).toBeLessThan(0);
      expect(dust.colors[i * 3]).toBeLessThan(0.3);
      expect(dust.colors[i * 3 + 1]).toBeLessThan(0.3);
      expect(dust.colors[i * 3 + 2]).toBeLessThan(0.3);
    }
  });

  it('尘埃权重含密度约束：无星光背景处（密度 0）不布尘埃粒子', () => {
    const maps = syntheticMaps();
    // 尘埃遮罩覆盖右上象限；密度改为右上象限为 0 → 尘埃权重全零
    const density = channelMap((col, row) => (col >= SIZE / 2 && row < SIZE / 2 ? 0 : 100));
    const dust = generateDustLaneParticlesFromMap({ ...maps, density }, 40, 3, OPTS);
    expect(dust.count).toBe(0);
  });

  it('分量确定性：同种子逐字节一致', () => {
    const maps = syntheticMaps();
    const a = generateHiiRegionParticlesFromMap(maps, 30, 9, OPTS);
    const b = generateHiiRegionParticlesFromMap(maps, 30, 9, OPTS);
    expect(Buffer.from(a.positionsLy.buffer)).toEqual(Buffer.from(b.positionsLy.buffer));
    expect(Buffer.from(a.colors.buffer)).toEqual(Buffer.from(b.colors.buffer));
  });
});

// ---------------------------------------------------------------------------
// 组合入口与降级（§R5-1 B/C/D）
// ---------------------------------------------------------------------------

describe('影像驱动组合与降级（generateGalaxyNearViewCompositeFromMaps / Auto）', () => {
  it('旋涡（m31）：分量配额与参数化路径同源，总量 ≤12,000', () => {
    const maps = syntheticMaps();
    const composite = generateGalaxyNearViewCompositeFromMaps('m31', maps);
    const quota = galaxyComponentQuota('m31');
    expect(composite.base.count).toBe(quota.base);
    const byName = new Map(composite.components.map((c) => [c.component, c.count]));
    expect(byName.get('dust')).toBe(quota.dust);
    expect(byName.get('hii')).toBe(quota.hii);
    expect(byName.get('youngClusters')).toBe(quota.youngClusters);
    expect(composite.totalCount).toBe(quota.total);
    expect(composite.totalCount).toBeLessThanOrEqual(GALAXY_NEAR_VIEW_MAX_PARTICLES);
  });

  it('不规则（lmc/smc）：新分量为空（R4-9 配额 0 登记沿用），基础层 = 配置粒子数', () => {
    const maps = syntheticMaps();
    for (const id of ['lmc', 'smc'] as const) {
      const composite = generateGalaxyNearViewCompositeFromMaps(id, maps);
      expect(composite.components).toEqual([]);
      expect(composite.base.count).toBe(GALAXY_NEAR_VIEW_CONFIGS[id].particleCount);
    }
  });

  it('影像组合确定性：两次生成逐字节一致', () => {
    const maps = syntheticMaps();
    const a = generateGalaxyNearViewCompositeFromMaps('m33', maps);
    const b = generateGalaxyNearViewCompositeFromMaps('m33', maps);
    expect(Buffer.from(a.base.positionsLy.buffer)).toEqual(
      Buffer.from(b.base.positionsLy.buffer),
    );
    expect(Buffer.from(a.base.colors.buffer)).toEqual(Buffer.from(b.base.colors.buffer));
    for (let i = 0; i < a.components.length; i += 1) {
      expect(Buffer.from(a.components[i].positionsLy.buffer)).toEqual(
        Buffer.from(b.components[i].positionsLy.buffer),
      );
    }
  });

  it('覆写透传：dust/HII 覆写按配额缩放影像分量', () => {
    const maps = syntheticMaps();
    const composite = generateGalaxyNearViewCompositeFromMaps('m31', maps, {
      dustStrength: 0.5,
      hiiDensity: 1,
    });
    const quota = galaxyComponentQuota('m31', { dustStrength: 0.5, hiiDensity: 1 });
    const byName = new Map(composite.components.map((c) => [c.component, c.count]));
    expect(byName.get('dust')).toBe(quota.dust);
    expect(byName.get('hii')).toBe(quota.hii);
  });

  it('尘埃图尺寸不符抛 RangeError；未定义 id 抛 RangeError', () => {
    const maps = syntheticMaps();
    const badDust = { size: 8, data: new Uint8Array(64) };
    expect(() =>
      generateGalaxyNearViewCompositeFromMaps('m31', { ...maps, dust: badDust }),
    ).toThrow(RangeError);
    expect(() => generateGalaxyNearViewCompositeFromMaps('unknown', maps)).toThrow(RangeError);
  });

  it('降级路径：maps=null 时逐星系与 R4-9 参数化输出逐字节一致（§R5-1 B 单测）', () => {
    for (const id of IMAGE_DRIVEN_GALAXY_IDS) {
      const auto = generateGalaxyNearViewCompositeAuto(id, null);
      const parametric = generateGalaxyNearViewComposite(id);
      expect(auto.totalCount).toBe(parametric.totalCount);
      expect(Buffer.from(auto.base.positionsLy.buffer)).toEqual(
        Buffer.from(parametric.base.positionsLy.buffer),
      );
      expect(Buffer.from(auto.base.colors.buffer)).toEqual(
        Buffer.from(parametric.base.colors.buffer),
      );
      expect(auto.components.length).toBe(parametric.components.length);
      for (let i = 0; i < auto.components.length; i += 1) {
        expect(Buffer.from(auto.components[i].positionsLy.buffer)).toEqual(
          Buffer.from(parametric.components[i].positionsLy.buffer),
        );
      }
    }
  });

  it('未覆盖星系（m87）即便传入 maps 也走参数化（椭圆不套用登记）', () => {
    const maps = syntheticMaps();
    const auto = generateGalaxyNearViewCompositeAuto('m87', maps);
    const parametric = generateGalaxyNearViewComposite('m87');
    expect(Buffer.from(auto.base.positionsLy.buffer)).toEqual(
      Buffer.from(parametric.base.positionsLy.buffer),
    );
  });

  it('影像路径与参数化路径种子域分离（`:map` 派生），分布不同', () => {
    expect(galaxyNearViewSeed('m31:map')).not.toBe(galaxyNearViewSeed('m31'));
    const maps = syntheticMaps();
    const image = generateGalaxyNearViewCompositeFromMaps('m31', maps);
    const parametric = generateGalaxyNearViewComposite('m31');
    expect(Buffer.from(image.base.positionsLy.buffer)).not.toEqual(
      Buffer.from(parametric.base.positionsLy.buffer),
    );
  });
});

// ---------------------------------------------------------------------------
// z 向厚度口径（盘面真实、垂直参数化登记）
// ---------------------------------------------------------------------------

describe('imageDrivenThicknessLy（z 向参数化口径）', () => {
  it('旋涡 = 配置盘厚；不规则 = 半径×flattenY×系数', () => {
    const m31 = GALAXY_NEAR_VIEW_CONFIGS.m31 as SpiralNearViewConfig;
    expect(imageDrivenThicknessLy('m31')).toBe(m31.thicknessLy);
    const lmc = GALAXY_NEAR_VIEW_CONFIGS.lmc;
    if (lmc.kind !== 'irregular') throw new Error('LMC 应为不规则');
    expect(imageDrivenThicknessLy('lmc')).toBeCloseTo(
      lmc.radiusLy * lmc.flattenY * IRREGULAR_MAP_THICKNESS_FACTOR,
      6,
    );
  });

  it('椭圆/未知 id 抛 RangeError', () => {
    expect(() => imageDrivenThicknessLy('m87')).toThrow(RangeError);
    expect(() => imageDrivenThicknessLy('unknown')).toThrow(RangeError);
  });
});
