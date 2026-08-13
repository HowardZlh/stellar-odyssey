/**
 * SC3 2MRS 点云真实颜色单测：J−K 连续色调映射（单调性/端点/未知档回退）/
 * 两级 LOD 与 low 档跨步抽稀三路径颜色一致 / 烘焙侧 ↔ 消费侧常量与编解码
 * 同源断言（防两侧漂移）/ 快照 CSV Jcmag 解析 / 产物 meta 与代码常量同步
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  GALAXY_CATALOG_MAGIC as BAKE_MAGIC,
  GALAXY_CATALOG_VERSION as BAKE_VERSION,
  parse2mrsCsv,
} from '../../../scripts/bake-data/galaxyCatalog.ts';
import {
  GALAXY_CATALOG_MAGIC,
  GALAXY_CATALOG_VERSION,
  validateGalaxyCatalog,
  type GalaxyCatalogData,
} from '../bakedData';
import {
  CATALOG_JK_BLUE_SRGB,
  CATALOG_JK_RED_SRGB,
  MORPH_TIER_COLORS_SRGB,
  buildCatalogLodAttributes,
  catalogColorFromJkTier,
  catalogIntensity01,
} from '../galaxyCatalog';
import {
  JK_QUANT_MAX_TIER,
  JK_QUANT_P01,
  JK_QUANT_P99,
  JK_TIER_UNKNOWN,
  jkTierFromColor,
  packCatalogW,
} from '../galaxyCatalogCore';
import { srgbToLinear01 } from '../pleiadesCatalog';

describe('烘焙侧 ↔ 消费侧同源（防两侧漂移）', () => {
  it('魔数/版本常量一致且为 V2（加载器只认 V2，SC3 决策）', () => {
    expect(BAKE_MAGIC).toBe(GALAXY_CATALOG_MAGIC);
    expect(BAKE_VERSION).toBe(GALAXY_CATALOG_VERSION);
    expect(GALAXY_CATALOG_VERSION).toBe(2);
  });

  it('烘焙侧 packCatalogW 编码 → validateGalaxyCatalog 解码逐字段往返', () => {
    const cases: Array<[0 | 1 | 2, number, number]> = [
      [0, 0, 0],
      [0, JK_QUANT_MAX_TIER, 1],
      [1, 49, 0.5],
      [2, JK_TIER_UNKNOWN, 0.75],
    ];
    const n = 20000;
    const data = new Float32Array(3 + n * 4);
    data[0] = GALAXY_CATALOG_MAGIC;
    data[1] = GALAXY_CATALOG_VERSION;
    data[2] = n;
    for (let i = 0; i < n; i += 1) {
      data[3 + i * 4] = 10 + (i % 100);
      data[3 + i * 4 + 1] = 5;
      data[3 + i * 4 + 2] = 5;
      const [tier, jk, b] = cases[i % cases.length];
      data[3 + i * 4 + 3] = packCatalogW(tier, jk, b);
    }
    const parsed = validateGalaxyCatalog(data.buffer)!;
    expect(parsed).not.toBeNull();
    for (let i = 0; i < cases.length; i += 1) {
      const [tier, jk, b] = cases[i];
      expect(parsed.morphTiers[i]).toBe(tier);
      expect(parsed.jkTiers[i]).toBe(jk);
      expect(parsed.brightness01[i]).toBeCloseTo(b, 2);
    }
  });

  it('产物 meta 的量化区间与核心常量同步（quantP01/quantP99）', () => {
    const meta = JSON.parse(
      readFileSync(join(process.cwd(), 'public', 'data', 'galaxy-catalog-meta.json'), 'utf8'),
    ) as { format: { version: number }; jkColor: { quantP01: number; quantP99: number } };
    expect(meta.format.version).toBe(GALAXY_CATALOG_VERSION);
    expect(meta.jkColor.quantP01).toBe(JK_QUANT_P01);
    expect(meta.jkColor.quantP99).toBe(JK_QUANT_P99);
  });
});

describe('快照 CSV Jcmag 解析（SC3 增补列）', () => {
  it('Jcmag 有值解析为数、空值为 NaN（→ 未知档回退）', () => {
    const csv =
      'RAJ2000,DEJ2000,Jcmag,Kcmag,type,cz\n' +
      '10.5,20.5,12.316,11.343,"3B",13075\n' +
      '11.5,21.5,,10.2," 4X",6900\n';
    const rows = parse2mrsCsv(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0].jMag).toBeCloseTo(12.316, 10);
    expect(rows[0].kMag).toBeCloseTo(11.343, 10);
    expect(Number.isNaN(rows[1].jMag)).toBe(true);
    expect(jkTierFromColor(rows[1].jMag, rows[1].kMag)).toBe(JK_TIER_UNKNOWN);
    expect(jkTierFromColor(rows[0].jMag, rows[0].kMag)).toBeGreaterThanOrEqual(0);
    expect(jkTierFromColor(rows[0].jMag, rows[0].kMag)).toBeLessThanOrEqual(JK_QUANT_MAX_TIER);
  });
});

describe('J−K 连续色调映射（catalogColorFromJkTier 纯函数）', () => {
  it('端点：档 0 = 蓝白端、档 98 = 红黄端（端点常量红蓝取向正确）', () => {
    expect(catalogColorFromJkTier(0, 1)).toEqual(CATALOG_JK_BLUE_SRGB);
    expect(catalogColorFromJkTier(JK_QUANT_MAX_TIER, 0)).toEqual(CATALOG_JK_RED_SRGB);
    expect(CATALOG_JK_BLUE_SRGB[2]).toBeGreaterThan(CATALOG_JK_BLUE_SRGB[0]);
    expect(CATALOG_JK_RED_SRGB[0]).toBeGreaterThan(CATALOG_JK_RED_SRGB[2]);
  });

  it('颜色单调性：J−K 增 → 色温降（R 通道不减、B 通道不增、R/B 严格增）', () => {
    let prevRatio = 0;
    for (let jk = 0; jk <= JK_QUANT_MAX_TIER; jk += 1) {
      const [r, , b] = catalogColorFromJkTier(jk, 2);
      const ratio = r / b;
      expect(ratio).toBeGreaterThan(prevRatio);
      prevRatio = ratio;
      if (jk > 0) {
        const [pr, , pb] = catalogColorFromJkTier(jk - 1, 2);
        expect(r).toBeGreaterThanOrEqual(pr);
        expect(b).toBeLessThanOrEqual(pb);
      }
    }
  });

  it('未知档（99）回退形态档 3 色；形态档越界回退中性档', () => {
    for (const tier of [0, 1, 2]) {
      expect(catalogColorFromJkTier(JK_TIER_UNKNOWN, tier)).toEqual(MORPH_TIER_COLORS_SRGB[tier]);
    }
    expect(catalogColorFromJkTier(JK_TIER_UNKNOWN, 7)).toEqual(MORPH_TIER_COLORS_SRGB[2]);
  });

  it('非法 jk 档拒绝（非整数/越界）', () => {
    expect(() => catalogColorFromJkTier(-1, 0)).toThrow(RangeError);
    expect(() => catalogColorFromJkTier(100, 0)).toThrow(RangeError);
    expect(() => catalogColorFromJkTier(1.5, 0)).toThrow(RangeError);
  });
});

describe('两级 LOD + low 档跨步抽稀三路径颜色一致（SC3）', () => {
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

  it('近域与远景同一 (jk, b) 输入产出同一颜色（色调公式两级同源）', () => {
    const near: GalaxyCatalogData = {
      count: 1,
      positionsMpc: new Float32Array([10, 0, 0]),
      morphTiers: new Uint8Array([1]),
      jkTiers: new Uint8Array([42]),
      brightness01: new Float32Array([0.5]),
    };
    const far: GalaxyCatalogData = { ...near, positionsMpc: new Float32Array([300, 0, 0]) };
    const a = buildCatalogLodAttributes(near);
    const b = buildCatalogLodAttributes(far);
    expect(a.near.count).toBe(1);
    expect(b.far.count).toBe(1);
    for (let c = 0; c < 3; c += 1) {
      expect(a.near.colors[c]).toBe(b.far.colors[c]);
    }
  });

  it('LOD 颜色 = catalogColorFromJkTier（sRGB→线性 × 亮度强度）；未知档条目走形态回退', () => {
    const lod = buildCatalogLodAttributes(data);
    expect(lod.near.count).toBe(3);
    expect(lod.far.count).toBe(3);
    // 近域第 2 条（全局 2：jk 未知、morph 2、b=0.6）
    const fallback = MORPH_TIER_COLORS_SRGB[2];
    const intensity = catalogIntensity01(data.brightness01[2]);
    for (let c = 0; c < 3; c += 1) {
      expect(lod.near.colors[2 * 3 + c]).toBeCloseTo(srgbToLinear01(fallback[c]) * intensity, 6);
    }
    // 远景第 0 条（全局 3：jk 98 红端）红 > 蓝；近域第 0 条（jk 0 蓝端）蓝 > 红
    expect(lod.far.colors[0]).toBeGreaterThan(lod.far.colors[2]);
    expect(lod.near.colors[2]).toBeGreaterThan(lod.near.colors[0]);
  });

  it('M2 low 档跨步抽稀（keepFraction=0.5 → 全局索引 %2）颜色与全量构建逐条一致', () => {
    const full = buildCatalogLodAttributes(data);
    const thin = buildCatalogLodAttributes(data, 0.5);
    // 保留全局索引 0,2,4 → 近域 2 条（0,2）、远景 1 条（4）
    expect(thin.near.count).toBe(2);
    expect(thin.far.count).toBe(1);
    // 近域：thin[0] ↔ full 近域[0]（全局 0）、thin[1] ↔ full 近域[2]（全局 2）
    for (let c = 0; c < 3; c += 1) {
      expect(thin.near.colors[c]).toBe(full.near.colors[c]);
      expect(thin.near.colors[3 + c]).toBe(full.near.colors[2 * 3 + c]);
      // 远景：thin[0] ↔ full 远景[1]（全局 4）
      expect(thin.far.colors[c]).toBe(full.far.colors[1 * 3 + c]);
    }
    expect(thin.near.sizes[0]).toBe(full.near.sizes[0]);
    expect(thin.far.sizes[0]).toBe(full.far.sizes[1]);
  });
});

describe('真实产物（public/data/galaxy-catalog.bin）V2 颜色集成', () => {
  const file = readFileSync(join(process.cwd(), 'public', 'data', 'galaxy-catalog.bin'));
  const data = validateGalaxyCatalog(
    file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength),
  )!;

  it('产物解析成功且近域/远景颜色均为有限正值（早红晚蓝连续分布）', () => {
    expect(data).not.toBeNull();
    const lod = buildCatalogLodAttributes(data);
    expect(lod.near.count).toBeGreaterThan(1000);
    expect(lod.far.count).toBeGreaterThan(1000);
    let redder = 0;
    let bluer = 0;
    for (let k = 0; k < lod.near.count; k += 1) {
      const r = lod.near.colors[k * 3];
      const b = lod.near.colors[k * 3 + 2];
      expect(Number.isFinite(r) && r > 0).toBe(true);
      expect(Number.isFinite(b) && b > 0).toBe(true);
      if (r > b) redder += 1;
      else bluer += 1;
    }
    // 连续色调下红端与蓝端并存（非单色点云）
    expect(redder).toBeGreaterThan(100);
    expect(bluer).toBeGreaterThan(100);
  });
});
