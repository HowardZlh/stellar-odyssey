/**
 * SC5 2MRS 点云「星系色彩增强」单测（REQUIREMENTS_STAR_COLORS §SC5-2）
 *
 * 覆盖：关闭态零回归（缺省参数 = SC3 物理映射逐值相等）、增强色 =
 * S 曲线拉伸后同管线输出、未知档回退两模式同款、buildCatalogLodAttributes
 * 双缓存同源（近域/远景/low 档跨步三路径两模式各自一致）、位置/尺寸
 * 通道与模式无关（单次构建结构性保证 + 逐值断言）。
 */

import type { GalaxyCatalogData } from '../bakedData';
import { enhanceCatalogT01 } from '../colorBoost';
import {
  CATALOG_JK_BLUE_BOOST_SRGB,
  CATALOG_JK_BLUE_SRGB,
  CATALOG_JK_RED_BOOST_SRGB,
  CATALOG_JK_RED_SRGB,
  MORPH_TIER_COLORS_SRGB,
  buildCatalogLodAttributes,
  catalogColorFromJkTier,
  catalogIntensity01,
} from '../galaxyCatalog';
import { JK_QUANT_MAX_TIER, JK_TIER_UNKNOWN } from '../galaxyCatalogCore';
import { srgbToLinear01 } from '../pleiadesCatalog';

describe('SC5 catalogColorFromJkTier 增强模式（S 曲线对比拉伸）', () => {
  it('关闭态零回归：缺省参数与 enhanced=false 与 SC3 线性插值公式逐值相等', () => {
    for (let jk = 0; jk <= JK_QUANT_MAX_TIER; jk += 7) {
      const dflt = catalogColorFromJkTier(jk, 1);
      expect(catalogColorFromJkTier(jk, 1, false)).toEqual(dflt);
      const t = jk / JK_QUANT_MAX_TIER;
      for (let c = 0; c < 3; c += 1) {
        expect(dflt[c]).toBeCloseTo(
          CATALOG_JK_BLUE_SRGB[c] + (CATALOG_JK_RED_SRGB[c] - CATALOG_JK_BLUE_SRGB[c]) * t,
          12,
        );
      }
    }
  });

  it('增强色 = 增强态专属端点在 enhanceCatalogT01(t) 处插值（同管线同源，二轮调参）', () => {
    for (let jk = 0; jk <= JK_QUANT_MAX_TIER; jk += 7) {
      const enhanced = catalogColorFromJkTier(jk, 1, true);
      const t = enhanceCatalogT01(jk / JK_QUANT_MAX_TIER);
      for (let c = 0; c < 3; c += 1) {
        expect(enhanced[c]).toBeCloseTo(
          CATALOG_JK_BLUE_BOOST_SRGB[c] +
            (CATALOG_JK_RED_BOOST_SRGB[c] - CATALOG_JK_BLUE_BOOST_SRGB[c]) * t,
          12,
        );
      }
    }
  });

  it('增强端点色拉开且取向不变：蓝端更蓝、红端更橙（R/B 对比空间扩大）', () => {
    // 蓝端：R 更低、B 保持 1 → 更蓝；红端：G/B 更低 → 更橙
    expect(CATALOG_JK_BLUE_BOOST_SRGB[0]).toBeLessThan(CATALOG_JK_BLUE_SRGB[0]);
    expect(CATALOG_JK_BLUE_BOOST_SRGB[2]).toBeGreaterThanOrEqual(CATALOG_JK_BLUE_SRGB[2]);
    expect(CATALOG_JK_RED_BOOST_SRGB[2]).toBeLessThan(CATALOG_JK_RED_SRGB[2]);
    expect(CATALOG_JK_RED_BOOST_SRGB[0]).toBeGreaterThanOrEqual(CATALOG_JK_RED_SRGB[0]);
  });

  it('增强保持端点与单调性：档 0/98 = 增强端点色、R/B 严格单调、排序无损', () => {
    expect(catalogColorFromJkTier(0, 1, true)).toEqual(CATALOG_JK_BLUE_BOOST_SRGB);
    expect(catalogColorFromJkTier(JK_QUANT_MAX_TIER, 1, true)).toEqual(CATALOG_JK_RED_BOOST_SRGB);
    let prevRatio = 0;
    for (let jk = 0; jk <= JK_QUANT_MAX_TIER; jk += 1) {
      const [r, , b] = catalogColorFromJkTier(jk, 2, true);
      const ratio = r / b;
      expect(ratio).toBeGreaterThan(prevRatio);
      prevRatio = ratio;
    }
  });

  it('对比拉伸生效：中位以下更蓝、以上更红（相对物理色）', () => {
    // 档 20（P10，t≈0.20 < center）：增强后更靠蓝端 → R 降 B 升
    const base20 = catalogColorFromJkTier(20, 1);
    const enh20 = catalogColorFromJkTier(20, 1, true);
    expect(enh20[0]).toBeLessThan(base20[0]);
    expect(enh20[2]).toBeGreaterThan(base20[2]);
    // 档 61（P90，t≈0.62 > center）：增强后更靠红端 → R 升 B 降
    const base61 = catalogColorFromJkTier(61, 1);
    const enh61 = catalogColorFromJkTier(61, 1, true);
    expect(enh61[0]).toBeGreaterThan(base61[0]);
    expect(enh61[2]).toBeLessThan(base61[2]);
  });

  it('未知档（99）回退形态 3 色两模式同款（不参与开关，§SC5-2 登记）', () => {
    for (const tier of [0, 1, 2]) {
      expect(catalogColorFromJkTier(JK_TIER_UNKNOWN, tier, true)).toEqual(
        MORPH_TIER_COLORS_SRGB[tier],
      );
      expect(catalogColorFromJkTier(JK_TIER_UNKNOWN, tier, true)).toEqual(
        catalogColorFromJkTier(JK_TIER_UNKNOWN, tier, false),
      );
    }
  });

  it('增强模式下非法档同样拒绝', () => {
    expect(() => catalogColorFromJkTier(-1, 0, true)).toThrow(RangeError);
    expect(() => catalogColorFromJkTier(100, 0, true)).toThrow(RangeError);
  });
});

describe('SC5 buildCatalogLodAttributes 双缓存（colors / colorsEnhanced）', () => {
  /** 合成目录：近域 3 条 + 远景 3 条，jk 档覆盖蓝端/中段/红端/未知 */
  const data: GalaxyCatalogData = {
    count: 6,
    positionsMpc: new Float32Array([
      10, 0, 0, 0, 20, 0, 0, 0, 30, 100, 0, 0, 0, 200, 0, 0, 0, 300,
    ]),
    morphTiers: new Uint8Array([0, 1, 2, 1, 0, 2]),
    jkTiers: new Uint8Array([0, 49, JK_TIER_UNKNOWN, 98, 20, 70]),
    brightness01: new Float32Array([1, 0.8, 0.6, 0.4, 0.2, 0]),
  };
  /** 全局索引 → 近域/远景内序（近域 0,1,2 → 全局 0,1,2；远景 → 3,4,5） */
  const globalIndex = (level: 'near' | 'far', k: number): number =>
    level === 'near' ? k : k + 3;

  it('colorsEnhanced = 增强色 × 同一亮度强度；colors 保持物理基色（关闭态零回归）', () => {
    const lod = buildCatalogLodAttributes(data);
    for (const level of ['near', 'far'] as const) {
      const attrs = lod[level];
      for (let k = 0; k < attrs.count; k += 1) {
        const i = globalIndex(level, k);
        const intensity = catalogIntensity01(data.brightness01[i]);
        const base = catalogColorFromJkTier(data.jkTiers[i], data.morphTiers[i]);
        const enhanced = catalogColorFromJkTier(data.jkTiers[i], data.morphTiers[i], true);
        for (let c = 0; c < 3; c += 1) {
          expect(attrs.colors[k * 3 + c]).toBeCloseTo(srgbToLinear01(base[c]) * intensity, 6);
          expect(attrs.colorsEnhanced[k * 3 + c]).toBeCloseTo(
            srgbToLinear01(enhanced[c]) * intensity,
            6,
          );
        }
      }
    }
  });

  it('未知档条目两缓存逐字节一致；已知档（非端点）两缓存可分辨', () => {
    const lod = buildCatalogLodAttributes(data);
    // 全局 2 = 近域第 2 条（jk 未知）
    for (let c = 0; c < 3; c += 1) {
      expect(lod.near.colorsEnhanced[2 * 3 + c]).toBe(lod.near.colors[2 * 3 + c]);
    }
    // 全局 1 = 近域第 1 条（jk 49 中段偏上）：增强应改变颜色
    expect(lod.near.colorsEnhanced[1 * 3]).not.toBe(lod.near.colors[1 * 3]);
  });

  it('M2 low 档跨步抽稀路径两模式与全量构建逐条一致（三路径同源）', () => {
    const full = buildCatalogLodAttributes(data);
    const thin = buildCatalogLodAttributes(data, 0.5);
    // 保留全局索引 0,2,4 → 近域 2 条（0,2）、远景 1 条（4）
    for (let c = 0; c < 3; c += 1) {
      expect(thin.near.colorsEnhanced[c]).toBe(full.near.colorsEnhanced[c]);
      expect(thin.near.colorsEnhanced[3 + c]).toBe(full.near.colorsEnhanced[2 * 3 + c]);
      expect(thin.far.colorsEnhanced[c]).toBe(full.far.colorsEnhanced[1 * 3 + c]);
      expect(thin.near.colors[c]).toBe(full.near.colors[c]);
      expect(thin.far.colors[c]).toBe(full.far.colors[1 * 3 + c]);
    }
  });

  it('位置/尺寸通道与颜色模式无关（单次构建双缓存，位置 buffer 不随开关重建）', () => {
    const a = buildCatalogLodAttributes(data);
    const b = buildCatalogLodAttributes(data);
    expect(a.near.positions).toEqual(b.near.positions);
    expect(a.far.positions).toEqual(b.far.positions);
    expect(a.near.sizes).toEqual(b.near.sizes);
    expect(a.far.sizes).toEqual(b.far.sizes);
  });
});
