/**
 * R4-17 昴星团 Gaia 真实成员星消费纯逻辑单测（IMPROVEMENT_REQUIREMENTS_4 §R4-17）
 *
 * 覆盖：单位换算/B−V→Teff（Ballesteros 2012）/视星等→粒径与亮度映射/
 * sRGB→线性/星表属性构建确定性/命名亮星目录匹配（实际产物集成断言防漂移）/
 * 反射星云分层布局/starCatalog 细节层规格（阈值与 R2-7 同源、预算登记）。
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import {
  PLEIADES_BASE_STAR_COUNT,
  PLEIADES_CATALOG_STAR_COUNT,
  PLEIADES_CENTROID_ICRS,
  PLEIADES_MODEL_RADIUS_PC,
  PLEIADES_NAMED_STARS,
  PLEIADES_NEAR_PARTICLE_INCREMENT,
  PLEIADES_NEBULA_HOSTS,
  PLEIADES_NEBULA_LAYERS_PER_HOST,
  PLEIADES_V_BRIGHT,
  PLEIADES_V_FAINT,
  buildPleiadesStarAttributes,
  bvToTeffK,
  icrsUnitVector,
  namedStarSpikeScaleFactor,
  pleiadesCatalogDetailLayerSpec,
  pleiadesNamedStarPlacements,
  pleiadesReflectionNebulaLayout,
  pleiadesSkyViewRows,
  pleiadesUnitsPerPc,
  sortPleiadesStarsByV,
  srgbToLinear01,
  vMagBrightness01,
  vMagPointSizeFactor,
} from '@/utils/pleiadesCatalog';
import { validatePleiades, type PleiadesStar } from '@/utils/bakedData';
import {
  NEAR_VIEW_PARTICLE_INCREMENTS,
  nearViewEnterDistanceUnits,
  nearViewExitDistanceUnits,
} from '@/utils/nearView';
import { GPU_BYTES_PER_PARTICLE } from '@/utils/detailLayer';

/** 实际烘焙产物（public/data/ 随仓库提交） */
const PRODUCT = validatePleiades(
  JSON.parse(
    readFileSync(join(process.cwd(), 'public', 'data', 'pleiades.json'), 'utf8'),
  ) as unknown,
)!;

/** 简易合成星表（3 颗，域内合法值） */
const TINY_STARS: PleiadesStar[] = [
  { id: 'b', x: 1, y: -2, z: 0.5, bv: -0.05, v: 4.2 },
  { id: 'a', x: -3, y: 0.4, z: 2, bv: 0.6, v: 8.0 },
  { id: 'c', x: 0.2, y: 1.1, z: -1.4, bv: 1.4, v: 12.5 },
];

// ---------------------------------------------------------------------------
// 基础换算
// ---------------------------------------------------------------------------

describe('icrsUnitVector / pleiadesUnitsPerPc', () => {
  it('ICRS 方向向量为单位长度且符合约定（x=cosδcosα）', () => {
    const u = icrsUnitVector(0, 0);
    expect(u.x).toBeCloseTo(1, 12);
    expect(u.y).toBeCloseTo(0, 12);
    expect(u.z).toBeCloseTo(0, 12);
    const v = icrsUnitVector(56.75, 24.1167);
    expect(Math.hypot(v.x, v.y, v.z)).toBeCloseTo(1, 12);
    expect(v.z).toBeCloseTo(Math.sin((24.1167 * Math.PI) / 180), 12);
  });

  it('比例登记：unitsPerPc = 视觉半径 / 模型半径 6 pc', () => {
    expect(pleiadesUnitsPerPc(6)).toBeCloseTo(1, 12);
    expect(pleiadesUnitsPerPc(12)).toBeCloseTo(12 / PLEIADES_MODEL_RADIUS_PC, 12);
  });

  it('非法输入抛 RangeError', () => {
    expect(() => icrsUnitVector(Number.NaN, 0)).toThrow(RangeError);
    expect(() => icrsUnitVector(0, Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => pleiadesUnitsPerPc(0)).toThrow(RangeError);
    expect(() => pleiadesUnitsPerPc(-1)).toThrow(RangeError);
    expect(() => pleiadesUnitsPerPc(Number.NaN)).toThrow(RangeError);
  });
});

describe('bvToTeffK（Ballesteros 2012 黑体近似）', () => {
  it('B−V=0 → ≈10,125 K（公式关键点）', () => {
    expect(bvToTeffK(0)).toBeCloseTo(4600 * (1 / 1.7 + 1 / 0.62), 6);
  });

  it('太阳档 B−V≈0.65 → 5,600–5,900 K', () => {
    const t = bvToTeffK(0.65);
    expect(t).toBeGreaterThan(5600);
    expect(t).toBeLessThan(5900);
  });

  it('随 B−V 单调递减（产物 B−V 域 −0.088–2.699 内抽样）', () => {
    let prev = Number.POSITIVE_INFINITY;
    for (let bv = -0.1; bv <= 2.7; bv += 0.2) {
      const t = bvToTeffK(bv);
      expect(t).toBeLessThan(prev);
      expect(t).toBeGreaterThan(0);
      prev = t;
    }
  });

  it('输入域按产物校验域 [−1,3] 钳制；NaN 抛 RangeError', () => {
    expect(bvToTeffK(-5)).toBeCloseTo(bvToTeffK(-1), 12);
    expect(bvToTeffK(9)).toBeCloseTo(bvToTeffK(3), 12);
    expect(() => bvToTeffK(Number.NaN)).toThrow(RangeError);
  });
});

describe('视星等映射（亮度/粒径/星芒）', () => {
  it('亮度归一：亮端/暗端钳制到 [0,1]，随 v 单调递减', () => {
    expect(vMagBrightness01(PLEIADES_V_BRIGHT - 1)).toBe(1);
    expect(vMagBrightness01(PLEIADES_V_FAINT + 4)).toBe(0);
    expect(vMagBrightness01(3.891)).toBeGreaterThan(vMagBrightness01(10));
    expect(vMagBrightness01(10)).toBeGreaterThan(vMagBrightness01(18.33));
  });

  it('粒径系数域 [0.022, 0.117]、随 v 单调不增', () => {
    expect(vMagPointSizeFactor(2)).toBeCloseTo(0.117, 3);
    expect(vMagPointSizeFactor(18)).toBeCloseTo(0.022, 3);
    let prev = Number.POSITIVE_INFINITY;
    for (let v = 3; v <= 18; v += 1) {
      const f = vMagPointSizeFactor(v);
      expect(f).toBeLessThanOrEqual(prev);
      prev = f;
    }
  });

  it('星芒尺寸系数：Alcyone 基准最大 0.5、随 v 递减、下限 >0.14', () => {
    expect(namedStarSpikeScaleFactor(2.87)).toBeCloseTo(0.5, 6);
    const sorted = [...PLEIADES_NAMED_STARS].sort((a, b) => a.vMag - b.vMag);
    let prev = Number.POSITIVE_INFINITY;
    for (const s of sorted) {
      const f = namedStarSpikeScaleFactor(s.vMag);
      expect(f).toBeLessThanOrEqual(prev);
      expect(f).toBeGreaterThan(0.14);
      prev = f;
    }
  });

  it('非法输入抛 RangeError', () => {
    expect(() => vMagBrightness01(Number.NaN)).toThrow(RangeError);
    expect(() => namedStarSpikeScaleFactor(Number.NaN)).toThrow(RangeError);
  });
});

describe('srgbToLinear01', () => {
  it('IEC 61966-2-1 分段逆变换关键点', () => {
    expect(srgbToLinear01(0)).toBe(0);
    expect(srgbToLinear01(1)).toBeCloseTo(1, 12);
    expect(srgbToLinear01(0.04045)).toBeCloseTo(0.04045 / 12.92, 12);
    expect(srgbToLinear01(0.5)).toBeCloseTo(0.2140411, 5);
  });

  it('域外/NaN 抛 RangeError', () => {
    expect(() => srgbToLinear01(-0.1)).toThrow(RangeError);
    expect(() => srgbToLinear01(1.1)).toThrow(RangeError);
    expect(() => srgbToLinear01(Number.NaN)).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// 星表属性构建
// ---------------------------------------------------------------------------

describe('sortPleiadesStarsByV / buildPleiadesStarAttributes', () => {
  it('按 V 升序稳定排序（非原地，v 相同按 id 定序）', () => {
    const stars = [...TINY_STARS, { id: 'd', x: 0, y: 0, z: 0, bv: 0, v: 4.2 }];
    const sorted = sortPleiadesStarsByV(stars);
    expect(sorted.map((s) => s.id)).toEqual(['b', 'd', 'a', 'c']);
    expect(stars.map((s) => s.id)).toEqual(['b', 'a', 'c', 'd']); // 输入不变
  });

  it('属性长度/位置换算/粒径与亮度随星等分级', () => {
    const sizeUnits = 6; // unitsPerPc = 1，位置数值即 pc
    const attrs = buildPleiadesStarAttributes(TINY_STARS, sizeUnits);
    expect(attrs.positions).toHaveLength(9);
    expect(attrs.colors).toHaveLength(9);
    expect(attrs.sizes).toHaveLength(3);
    expect(attrs.positions[0]).toBeCloseTo(1, 6);
    expect(attrs.positions[4]).toBeCloseTo(0.4, 6);
    // 亮星（v=4.2）粒径/颜色强于暗星（v=12.5）
    expect(attrs.sizes[0]).toBeGreaterThan(attrs.sizes[2]);
    expect(attrs.colors[0]).toBeGreaterThan(attrs.colors[6]);
    // 颜色线性空间 0–1
    for (let i = 0; i < attrs.colors.length; i += 1) {
      expect(attrs.colors[i]).toBeGreaterThanOrEqual(0);
      expect(attrs.colors[i]).toBeLessThanOrEqual(1);
    }
  });

  it('B−V 转色：蓝星（bv<0）蓝分量占优，红星（bv>1.4）红分量占优', () => {
    const attrs = buildPleiadesStarAttributes(TINY_STARS, 6);
    expect(attrs.colors[2]).toBeGreaterThan(attrs.colors[0]); // 蓝星 b>r
    expect(attrs.colors[6]).toBeGreaterThan(attrs.colors[8]); // 红星 r>b
  });

  it('确定性：两次构建逐字节一致', () => {
    const a = buildPleiadesStarAttributes(TINY_STARS, 4.2);
    const b = buildPleiadesStarAttributes(TINY_STARS, 4.2);
    expect(Array.from(a.positions)).toEqual(Array.from(b.positions));
    expect(Array.from(a.colors)).toEqual(Array.from(b.colors));
    expect(Array.from(a.sizes)).toEqual(Array.from(b.sizes));
  });

  it('空列表抛 RangeError', () => {
    expect(() => buildPleiadesStarAttributes([], 6)).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// 命名亮星布局（实际产物集成断言防漂移）
// ---------------------------------------------------------------------------

describe('pleiadesNamedStarPlacements（实际产物匹配）', () => {
  const sorted = sortPleiadesStarsByV(PRODUCT.stars);
  const placements = pleiadesNamedStarPlacements(sorted, 6);

  it('9 颗命名亮星齐全且顺序与登记表一致', () => {
    expect(placements).toHaveLength(9);
    expect(placements.map((p) => p.name)).toEqual(
      PLEIADES_NAMED_STARS.map((d) => d.name),
    );
  });

  it('产物内存在的 4 颗（Maia/Pleione/Celaeno/Asterope）吸附目录位置', () => {
    const matched = placements.filter((p) => p.matchedIndex !== null);
    expect(matched.map((p) => p.name).sort()).toEqual(
      ['Asterope', 'Celaeno', 'Maia', 'Pleione'].sort(),
    );
    // Maia = 目录最亮星（V=3.891，bake 抽检登记），位置逐分量一致（unitsPerPc=1）
    const maia = placements.find((p) => p.name === 'Maia')!;
    expect(maia.matchedIndex).toBe(0);
    expect(maia.x).toBeCloseTo(sorted[0].x, 6);
    expect(maia.y).toBeCloseTo(sorted[0].y, 6);
    expect(maia.z).toBeCloseTo(sorted[0].z, 6);
    // 匹配星不重复
    const idx = matched.map((p) => p.matchedIndex);
    expect(new Set(idx).size).toBe(idx.length);
  });

  it('Gaia 缺失的最亮 5 颗合成位置：径向 = 簇质心距离（登记近似）', () => {
    const synth = placements.filter((p) => p.matchedIndex === null);
    expect(synth.map((p) => p.name).sort()).toEqual(
      ['Alcyone', 'Atlas', 'Electra', 'Maia', 'Merope', 'Taygeta']
        .filter((n) => n !== 'Maia')
        .sort(),
    );
    const u0 = icrsUnitVector(
      PLEIADES_CENTROID_ICRS.raDeg,
      PLEIADES_CENTROID_ICRS.decDeg,
    );
    const d0 = PLEIADES_CENTROID_ICRS.distancePc;
    for (const p of synth) {
      // |质心 + 位置| = 质心距离（合成星与质心等距；unitsPerPc=1）
      const ax = u0.x * d0 + p.x;
      const ay = u0.y * d0 + p.y;
      const az = u0.z * d0 + p.z;
      expect(Math.hypot(ax, ay, az)).toBeCloseTo(d0, 6);
      // 天球面构型真实：合成方向与登记天测方向一致
      const def = PLEIADES_NAMED_STARS.find((d) => d.name === p.name)!;
      const u = icrsUnitVector(def.raDeg, def.decDeg);
      const dot = (ax * u.x + ay * u.y + az * u.z) / Math.hypot(ax, ay, az);
      expect(dot).toBeGreaterThan(1 - 1e-9);
    }
  });

  it('布局落在模型域内（|r| ≤ 视觉半径 ×1.5，比例登记域）', () => {
    for (const p of placements) {
      expect(Math.hypot(p.x, p.y, p.z)).toBeLessThan(6 * 1.5);
      expect(p.spikeScaleUnits).toBeGreaterThan(0);
    }
  });

  it('确定性：两次求值结果一致', () => {
    const again = pleiadesNamedStarPlacements(sorted, 6);
    expect(again).toEqual(placements);
  });
});

// ---------------------------------------------------------------------------
// 反射星云分层布局
// ---------------------------------------------------------------------------

describe('pleiadesReflectionNebulaLayout', () => {
  const sorted = sortPleiadesStarsByV(PRODUCT.stars);
  const named = pleiadesNamedStarPlacements(sorted, 6);

  it('宿主 ×4 每宿主 3 层 = 12 张 sprite，包裹对应亮星', () => {
    const layout = pleiadesReflectionNebulaLayout(named, 6);
    expect(layout).toHaveLength(
      PLEIADES_NEBULA_HOSTS.length * PLEIADES_NEBULA_LAYERS_PER_HOST,
    );
    const byName = new Map(named.map((n) => [n.name, n]));
    for (const p of layout) {
      const host = byName.get(p.hostName)!;
      // 抖动偏移不超过基准尺度的 10%（包裹观感成立）
      expect(Math.hypot(p.x - host.x, p.y - host.y, p.z - host.z)).toBeLessThan(
        p.scaleUnits * 0.5,
      );
      expect(p.scaleUnits).toBeGreaterThan(0);
      expect(p.opacity).toBeGreaterThan(0);
      expect(p.opacity).toBeLessThan(0.4);
      expect(p.rotationRad).toBeGreaterThanOrEqual(0);
      expect(p.rotationRad).toBeLessThan(Math.PI * 2);
      expect(Number.isInteger(p.textureIndex)).toBe(true);
      expect(p.textureIndex).toBeGreaterThanOrEqual(0);
      expect(p.textureIndex).toBeLessThan(3);
    }
    // Merope 星云（NGC 1435）最强：首层不透明度最大
    const merope = layout.filter((p) => p.hostName === 'Merope');
    const electra = layout.filter((p) => p.hostName === 'Electra');
    expect(merope[0].opacity).toBeGreaterThan(electra[0].opacity);
  });

  it('同种子确定性；层间外层更大更淡', () => {
    const a = pleiadesReflectionNebulaLayout(named, 6);
    const b = pleiadesReflectionNebulaLayout(named, 6);
    expect(a).toEqual(b);
    for (let host = 0; host < PLEIADES_NEBULA_HOSTS.length; host += 1) {
      const base = host * PLEIADES_NEBULA_LAYERS_PER_HOST;
      for (let l = 1; l < PLEIADES_NEBULA_LAYERS_PER_HOST; l += 1) {
        expect(a[base + l].scaleUnits).toBeGreaterThan(a[base + l - 1].scaleUnits);
        expect(a[base + l].opacity).toBeLessThan(a[base + l - 1].opacity);
      }
    }
  });

  it('非法输入抛 RangeError（尺寸/纹理数/宿主缺失）', () => {
    expect(() => pleiadesReflectionNebulaLayout(named, 0)).toThrow(RangeError);
    expect(() => pleiadesReflectionNebulaLayout(named, 6, 1, 0)).toThrow(RangeError);
    const missing = named.filter((n) => n.name !== 'Merope');
    expect(() => pleiadesReflectionNebulaLayout(missing, 6)).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// 地球天空视图姿态（构型对照公版图像）
// ---------------------------------------------------------------------------

describe('pleiadesSkyViewRows', () => {
  const { rowX, rowY, rowZ } = pleiadesSkyViewRows();
  const dot = (a: { x: number; y: number; z: number }, b: typeof a): number =>
    a.x * b.x + a.y * b.y + a.z * b.z;

  it('行向量正交归一且 det=+1（纯旋转，无镜像）', () => {
    expect(Math.hypot(rowX.x, rowX.y, rowX.z)).toBeCloseTo(1, 12);
    expect(Math.hypot(rowY.x, rowY.y, rowY.z)).toBeCloseTo(1, 12);
    expect(Math.hypot(rowZ.x, rowZ.y, rowZ.z)).toBeCloseTo(1, 12);
    expect(dot(rowX, rowY)).toBeCloseTo(0, 12);
    expect(dot(rowX, rowZ)).toBeCloseTo(0, 12);
    expect(dot(rowY, rowZ)).toBeCloseTo(0, 12);
    // det = rowX · (rowY × rowZ)
    const cx = rowY.y * rowZ.z - rowY.z * rowZ.y;
    const cy = rowY.z * rowZ.x - rowY.x * rowZ.z;
    const cz = rowY.x * rowZ.y - rowY.y * rowZ.x;
    expect(rowX.x * cx + rowX.y * cy + rowX.z * cz).toBeCloseTo(1, 12);
  });

  it('姿态语义：质心视向 → −z（相机 +z 即地球方向）；北在上、东在左', () => {
    const u0 = icrsUnitVector(
      PLEIADES_CENTROID_ICRS.raDeg,
      PLEIADES_CENTROID_ICRS.decDeg,
    );
    expect(dot(rowZ, u0)).toBeCloseTo(-1, 12);
    // 东在左：Atlas（赤经大于质心 → 东侧）合成位置旋转后 x' < 0
    const sorted = sortPleiadesStarsByV(PRODUCT.stars);
    const atlas = pleiadesNamedStarPlacements(sorted, 6).find(
      (p) => p.name === 'Atlas',
    )!;
    expect(dot(rowX, atlas)).toBeLessThan(0);
    // 北在上：Asterope（赤纬高于质心 → 北侧）旋转后 y' > 0
    const asterope = pleiadesNamedStarPlacements(sorted, 6).find(
      (p) => p.name === 'Asterope',
    )!;
    expect(dot(rowY, asterope)).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// starCatalog 细节层规格与预算登记
// ---------------------------------------------------------------------------

describe('pleiadesCatalogDetailLayerSpec（R4-2 挂接）', () => {
  it('阈值与 R2-7 近观门控同源（enter ×1.5 / exit ×1.4）', () => {
    const spec = pleiadesCatalogDetailLayerSpec();
    expect(spec.bodyId).toBe('pleiades');
    expect(spec.kind).toBe('starCatalog');
    expect(spec.enterDistanceUnits).toBe(nearViewEnterDistanceUnits('pleiades'));
    expect(spec.exitDistanceUnits).toBe(nearViewExitDistanceUnits('pleiades'));
  });

  it('粒子增量登记：440 目录暗星 + 9 星芒 + 12 星云 sprite = 461，与 nearView 登记表同值', () => {
    expect(PLEIADES_NEAR_PARTICLE_INCREMENT).toBe(
      PLEIADES_CATALOG_STAR_COUNT - PLEIADES_BASE_STAR_COUNT + 9 + 12,
    );
    expect(PLEIADES_NEAR_PARTICLE_INCREMENT).toBe(461);
    expect(NEAR_VIEW_PARTICLE_INCREMENTS.pleiades).toBe(
      PLEIADES_NEAR_PARTICLE_INCREMENT,
    );
    const spec = pleiadesCatalogDetailLayerSpec();
    expect(spec.budget.particles).toBe(PLEIADES_NEAR_PARTICLE_INCREMENT);
    expect(spec.budget.gpuBytesEstimate).toBe(
      PLEIADES_NEAR_PARTICLE_INCREMENT * GPU_BYTES_PER_PARTICLE,
    );
  });
});

// ---------------------------------------------------------------------------
// 实际产物端到端（近观形态数据基础）
// ---------------------------------------------------------------------------

describe('实际产物端到端（§R4-17 验收数据基础）', () => {
  it('600 颗成员星全量构建：位置模长 ≤ 视觉半径 ×1.5（比例登记）', () => {
    const sorted = sortPleiadesStarsByV(PRODUCT.stars);
    const attrs = buildPleiadesStarAttributes(sorted, 6);
    expect(attrs.sizes).toHaveLength(600);
    for (let i = 0; i < 600; i += 1) {
      const r = Math.hypot(
        attrs.positions[i * 3],
        attrs.positions[i * 3 + 1],
        attrs.positions[i * 3 + 2],
      );
      expect(r).toBeLessThanOrEqual(6 * 1.5);
    }
    // 亮暗分级：最亮星粒径 > 最暗星粒径 3 倍以上
    expect(attrs.sizes[0]).toBeGreaterThan(attrs.sizes[599] * 3);
  });

  it('基础/近观切分：基础 160 + 近观 440', () => {
    expect(PLEIADES_BASE_STAR_COUNT).toBe(160);
    expect(PRODUCT.stars.length).toBe(PLEIADES_CATALOG_STAR_COUNT);
  });
});
