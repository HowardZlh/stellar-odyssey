/**
 * SC1 星族颜色采样器测试（REQUIREMENTS_STAR_COLORS §SC1-1/-2/-3）
 *
 * 覆盖：权重归一性、Teff 区间合法性（blackbodyRGB 域内）、三预设色相
 * 区间断言（发光加权口径）、固定种子确定性、rng 消耗数恒定、
 * 银盘 M2 三档粒子数下生成不抛错且颜色分布一致。
 */

import {
  STAR_POPULATION_BUCKETS,
  STAR_BRIGHTNESS_JITTER_MIN,
  BULGE_CENTER_BRIGHTEN,
  BULGE_CENTER_WHITEN,
  BULGE_CENTER_WHITE,
  BULGE_EDGE_WARM_TINT,
  OUTER_DISK_DIM_MAX,
  OUTER_DISK_COOL_TINT,
  OUTER_DISK_GRADIENT_START,
  applyBulgeRadialGradient,
  applyOuterDiskGradient,
  sampleStarColor,
  srgbToLinear01,
  type LinearRgb,
  type StarPopulation,
} from '../starPopulation';
import { srgbToLinear01 as pleiadesSrgbToLinear01 } from '../pleiadesCatalog';
import { BLACKBODY_TEFF_MIN_K, BLACKBODY_TEFF_MAX_K } from '../starPhysics';
import { createSeededRandom } from '../random';
import { ARM_OLD_DISK_BASE_FRACTION, generateGalaxyDiskParticles } from '../galaxy';

const POPULATIONS: readonly StarPopulation[] = ['youngDisk', 'oldDisk', 'bulge', 'halo'];

/** 采样 n 次求线性 RGB 均值（确定性种子） */
function meanColor(
  population: StarPopulation,
  n: number,
  seed: number,
): { r: number; g: number; b: number } {
  const rng = createSeededRandom(seed);
  let r = 0;
  let g = 0;
  let b = 0;
  for (let i = 0; i < n; i += 1) {
    const c = sampleStarColor(population, rng);
    r += c.r;
    g += c.g;
    b += c.b;
  }
  return { r: r / n, g: g / n, b: b / n };
}

describe('SC1 星族权重表（唯一事实源）', () => {
  it('四预设权重之和均为 1（归一性）', () => {
    for (const pop of POPULATIONS) {
      const sum = STAR_POPULATION_BUCKETS[pop].reduce((acc, b) => acc + b.weight, 0);
      expect(sum).toBeCloseTo(1, 9);
    }
  });

  it('所有桶权重为正、Teff 区间合法且落在 blackbodyRGB 有效域内', () => {
    for (const pop of POPULATIONS) {
      for (const bucket of STAR_POPULATION_BUCKETS[pop]) {
        expect(bucket.weight).toBeGreaterThan(0);
        expect(bucket.teffMinK).toBeLessThan(bucket.teffMaxK);
        expect(bucket.teffMinK).toBeGreaterThanOrEqual(BLACKBODY_TEFF_MIN_K);
        expect(bucket.teffMaxK).toBeLessThanOrEqual(BLACKBODY_TEFF_MAX_K);
      }
    }
  });

  it('bulge 预设禁 O/B（老年星族 II，Teff 上界 ≤ 6,000 K 保证逐粒子暖色）', () => {
    for (const bucket of STAR_POPULATION_BUCKETS.bulge) {
      expect(bucket.name).not.toBe('O');
      expect(bucket.name).not.toBe('B');
      expect(bucket.teffMaxK).toBeLessThanOrEqual(6000);
    }
  });
});

describe('SC1 sampleStarColor（发光加权采样 → 线性 RGB）', () => {
  it('输出为 [0, 1] 内有限数（全预设 × 大样本）', () => {
    for (const pop of POPULATIONS) {
      const rng = createSeededRandom(101);
      for (let i = 0; i < 2000; i += 1) {
        const c = sampleStarColor(pop, rng);
        for (const v of [c.r, c.g, c.b]) {
          expect(Number.isFinite(v)).toBe(true);
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('色相区间：youngDisk 均值偏蓝（B > R）、oldDisk/bulge/halo 均值偏红黄（R > B）', () => {
    const young = meanColor('youngDisk', 4000, 7);
    const old = meanColor('oldDisk', 4000, 7);
    const bulge = meanColor('bulge', 4000, 7);
    const halo = meanColor('halo', 4000, 7);
    expect(young.b).toBeGreaterThan(young.r);
    expect(old.r).toBeGreaterThan(old.b);
    expect(bulge.r).toBeGreaterThan(bulge.b);
    expect(halo.r).toBeGreaterThan(halo.b);
    // 分区梯度：核球比臂间更红（R−B 差值更大）、臂间比旋臂更红
    expect(bulge.r - bulge.b).toBeGreaterThan(old.r - old.b);
    expect(old.r - old.b).toBeGreaterThan(young.r - young.b);
  });

  it('bulge 逐样本恒暖色（R > B，禁 O/B 的可视化保证）', () => {
    const rng = createSeededRandom(23);
    for (let i = 0; i < 2000; i += 1) {
      const c = sampleStarColor('bulge', rng);
      expect(c.r).toBeGreaterThan(c.b);
    }
  });

  it('halo 含少量蓝水平支（B > R 样本占比落在 5%–25%）', () => {
    const rng = createSeededRandom(31);
    let blue = 0;
    const n = 4000;
    for (let i = 0; i < n; i += 1) {
      const c = sampleStarColor('halo', rng);
      if (c.b > c.r) blue += 1;
    }
    expect(blue / n).toBeGreaterThan(0.05);
    expect(blue / n).toBeLessThan(0.25);
  });

  it('Teff 边界钳制：极端 rng（恒 0 / 趋 1）输出仍为合法颜色', () => {
    for (const pop of POPULATIONS) {
      const low = sampleStarColor(pop, () => 0);
      const high = sampleStarColor(pop, () => 0.999999);
      for (const c of [low, high]) {
        for (const v of [c.r, c.g, c.b]) {
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(1);
        }
      }
      // rng=0 → 亮度抖动下界
      expect(Math.max(low.r, low.g, low.b)).toBeLessThanOrEqual(STAR_BRIGHTNESS_JITTER_MIN + 1e-9);
    }
  });

  it('确定性：同种子两串采样逐值相等（快照稳定）', () => {
    for (const pop of POPULATIONS) {
      const a = createSeededRandom(42);
      const b = createSeededRandom(42);
      for (let i = 0; i < 200; i += 1) {
        expect(sampleStarColor(pop, a)).toEqual(sampleStarColor(pop, b));
      }
    }
  });

  it('每次调用固定消耗 rng 3 个数（生成器随机流可预算）', () => {
    const base = createSeededRandom(9);
    let calls = 0;
    const counting = (): number => {
      calls += 1;
      return base();
    };
    for (const pop of POPULATIONS) {
      calls = 0;
      sampleStarColor(pop, counting);
      expect(calls).toBe(3);
    }
  });

  it('未知星族预设抛 RangeError', () => {
    expect(() => sampleStarColor('nova' as StarPopulation, createSeededRandom(1))).toThrow(
      RangeError,
    );
  });
});

describe('SC1-2 legacyPalette 降级路径（近观星系层零变化保障）', () => {
  const PARAMS = {
    count: 3000,
    seed: 11,
    armCount: 4,
    diskRadiusLy: 50000,
    thicknessLy: 1000,
    bulgeRadiusLy: 8000,
    bulgeFraction: 0.2,
    spiralTightness: 1.2,
    armSpreadRad: 0.28,
    barFraction: 0.08,
  } as const;

  it('legacy 与默认（starPopulation）颜色不同、位置通道同参数下一致', () => {
    const legacy = generateGalaxyDiskParticles({ ...PARAMS, colorMode: 'legacyPalette' });
    const modern = generateGalaxyDiskParticles({ ...PARAMS, colorMode: 'starPopulation' });
    expect(Array.from(legacy.colors)).not.toEqual(Array.from(modern.colors));
    expect(legacy.count).toBe(modern.count);
  });

  it('legacy 路径确定性且核球/棒为单色暖黄族（R>G>B 恒成立）', () => {
    const a = generateGalaxyDiskParticles({ ...PARAMS, colorMode: 'legacyPalette' });
    const b = generateGalaxyDiskParticles({ ...PARAMS, colorMode: 'legacyPalette' });
    expect(a.colors).toEqual(b.colors);
    const bulgeAndBar = Math.round(PARAMS.count * (PARAMS.bulgeFraction + PARAMS.barFraction));
    for (let i = 0; i < bulgeAndBar; i += 1) {
      expect(a.colors[i * 3]).toBeGreaterThan(a.colors[i * 3 + 1]);
      expect(a.colors[i * 3 + 1]).toBeGreaterThan(a.colors[i * 3 + 2]);
    }
  });
});

describe('SC1 srgbToLinear01（循环 import 规避的本地实现，登记同源性）', () => {
  it('与 pleiadesCatalog.srgbToLinear01 逐值一致（IEC 61966-2-1）', () => {
    for (let i = 0; i <= 100; i += 1) {
      const v = i / 100;
      expect(srgbToLinear01(v)).toBe(pleiadesSrgbToLinear01(v));
    }
  });

  it('域外/非法输入抛 RangeError', () => {
    expect(() => srgbToLinear01(-0.01)).toThrow(RangeError);
    expect(() => srgbToLinear01(1.01)).toThrow(RangeError);
    expect(() => srgbToLinear01(Number.NaN)).toThrow(RangeError);
  });
});

describe('SC2-1 applyBulgeRadialGradient（核球径向渐变）', () => {
  const WARM: LinearRgb = { r: 0.6, g: 0.4, b: 0.2 };

  it('半径 0（中心）：亮度提升 + 向暖白靠拢（解析值断言）', () => {
    const out = applyBulgeRadialGradient(WARM, 0);
    const gain = 1 + BULGE_CENTER_BRIGHTEN;
    const expected = (c: number, w: number): number =>
      Math.min(1, (c * (1 - BULGE_CENTER_WHITEN) + w * BULGE_CENTER_WHITEN) * gain);
    expect(out.r).toBeCloseTo(expected(WARM.r, BULGE_CENTER_WHITE.r), 12);
    expect(out.g).toBeCloseTo(expected(WARM.g, BULGE_CENTER_WHITE.g), 12);
    expect(out.b).toBeCloseTo(expected(WARM.b, BULGE_CENTER_WHITE.b), 12);
    // 中心亮黄白：各通道均不低于原色（提亮），且蓝通道相对占比上升（去饱和向白）
    expect(out.r).toBeGreaterThan(WARM.r);
    expect(out.b / out.r).toBeGreaterThan(WARM.b / WARM.r);
  });

  it('半径 1（边界）：无提亮，仅乘暖橙色调（解析值断言）', () => {
    const out = applyBulgeRadialGradient(WARM, 1);
    expect(out.r).toBeCloseTo(WARM.r * BULGE_EDGE_WARM_TINT.r, 12);
    expect(out.g).toBeCloseTo(WARM.g * BULGE_EDGE_WARM_TINT.g, 12);
    expect(out.b).toBeCloseTo(WARM.b * BULGE_EDGE_WARM_TINT.b, 12);
    // 暖橙：蓝通道相对占比下降
    expect(out.b / out.r).toBeLessThan(WARM.b / WARM.r);
  });

  it('超界半径钳制到 [0,1] 边界值；非有限半径抛 RangeError', () => {
    expect(applyBulgeRadialGradient(WARM, 5)).toEqual(applyBulgeRadialGradient(WARM, 1));
    expect(applyBulgeRadialGradient(WARM, -2)).toEqual(applyBulgeRadialGradient(WARM, 0));
    expect(() => applyBulgeRadialGradient(WARM, Number.NaN)).toThrow(RangeError);
    expect(() => applyBulgeRadialGradient(WARM, Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });

  it('输出恒在 [0,1]（亮色输入提亮后钳制不越界）', () => {
    const bright: LinearRgb = { r: 1, g: 0.95, b: 0.9 };
    for (const rn of [0, 0.25, 0.5, 0.75, 1]) {
      const out = applyBulgeRadialGradient(bright, rn);
      for (const v of [out.r, out.g, out.b]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('SC2-4 applyOuterDiskGradient（外盘渐冷渐暗，de Jong 1996）', () => {
  const DISK: LinearRgb = { r: 0.7, g: 0.6, b: 0.5 };

  it('半径 0 与梯度起始半径内恒等返回（内盘零影响）', () => {
    expect(applyOuterDiskGradient(DISK, 0)).toEqual(DISK);
    expect(applyOuterDiskGradient(DISK, OUTER_DISK_GRADIENT_START)).toEqual(DISK);
  });

  it('半径 1（盘缘）：满额暗化 + 冷色调（解析值断言，渐冷渐暗）', () => {
    const out = applyOuterDiskGradient(DISK, 1);
    const gain = 1 - OUTER_DISK_DIM_MAX;
    expect(out.r).toBeCloseTo(DISK.r * gain * OUTER_DISK_COOL_TINT.r, 12);
    expect(out.g).toBeCloseTo(DISK.g * gain * OUTER_DISK_COOL_TINT.g, 12);
    expect(out.b).toBeCloseTo(DISK.b * gain * OUTER_DISK_COOL_TINT.b, 12);
    // 渐暗 + 渐冷：总亮度下降、蓝通道相对占比上升
    expect(out.r + out.g + out.b).toBeLessThan(DISK.r + DISK.g + DISK.b);
    expect(out.b / out.r).toBeGreaterThan(DISK.b / DISK.r);
  });

  it('smoothstep 过渡无硬边（起始半径附近增量趋零、径向单调渐暗）', () => {
    const nearStart = applyOuterDiskGradient(DISK, OUTER_DISK_GRADIENT_START + 0.01);
    expect(Math.abs(nearStart.r - DISK.r)).toBeLessThan(0.005);
    let prev = Number.POSITIVE_INFINITY;
    for (const rn of [0.5, 0.6, 0.7, 0.8, 0.9, 1]) {
      const out = applyOuterDiskGradient(DISK, rn);
      const lum = out.r + out.g + out.b;
      expect(lum).toBeLessThan(prev);
      prev = lum;
    }
  });

  it('超界半径钳制到 [0,1] 边界值；非有限半径抛 RangeError', () => {
    expect(applyOuterDiskGradient(DISK, 3)).toEqual(applyOuterDiskGradient(DISK, 1));
    expect(applyOuterDiskGradient(DISK, -1)).toEqual(DISK);
    expect(() => applyOuterDiskGradient(DISK, Number.NaN)).toThrow(RangeError);
  });
});

describe('SC2 生成期集成（核球渐变 / 旋臂黄底 / 外盘梯度）', () => {
  const PARAMS = {
    count: 30000,
    seed: 20260813,
    armCount: 4,
    diskRadiusLy: 50000,
    thicknessLy: 1000,
    bulgeRadiusLy: 8000,
    bulgeFraction: 0.2,
    spiralTightness: 1.2,
    armSpreadRad: 0.28,
    barFraction: 0.08,
  } as const;

  it('旋臂 oldDisk 混入比例常量在 (0,1) 内（登记：0.55）', () => {
    expect(ARM_OLD_DISK_BASE_FRACTION).toBeGreaterThan(0);
    expect(ARM_OLD_DISK_BASE_FRACTION).toBeLessThan(1);
  });

  it('核球粒子内圈均亮度 > 外圈（径向渐变生效）', () => {
    const p = generateGalaxyDiskParticles(PARAMS);
    const bulgeCount = Math.round(PARAMS.count * PARAMS.bulgeFraction);
    let innerLum = 0;
    let innerN = 0;
    let outerLum = 0;
    let outerN = 0;
    for (let i = 0; i < bulgeCount; i += 1) {
      const rn = p.radiiLy[i] / PARAMS.bulgeRadiusLy;
      const lum = p.colors[i * 3] + p.colors[i * 3 + 1] + p.colors[i * 3 + 2];
      if (rn < 0.3) {
        innerLum += lum;
        innerN += 1;
      } else if (rn > 0.7) {
        outerLum += lum;
        outerN += 1;
      }
    }
    expect(innerN).toBeGreaterThan(50);
    expect(outerN).toBeGreaterThan(50);
    expect(innerLum / innerN).toBeGreaterThan(outerLum / outerN);
  });

  it('盘粒子外缘均亮度更低且更冷（外盘梯度生效，无硬边由纯函数单测覆盖）', () => {
    const p = generateGalaxyDiskParticles(PARAMS);
    const diskStart = Math.round(PARAMS.count * (PARAMS.bulgeFraction + PARAMS.barFraction));
    const inner = { r: 0, g: 0, b: 0, n: 0 };
    const outer = { r: 0, g: 0, b: 0, n: 0 };
    for (let i = diskStart; i < p.count; i += 1) {
      const rn = p.radiiLy[i] / PARAMS.diskRadiusLy;
      const acc = rn < OUTER_DISK_GRADIENT_START ? inner : rn > 0.9 ? outer : null;
      if (acc) {
        acc.r += p.colors[i * 3];
        acc.g += p.colors[i * 3 + 1];
        acc.b += p.colors[i * 3 + 2];
        acc.n += 1;
      }
    }
    expect(inner.n).toBeGreaterThan(200);
    expect(outer.n).toBeGreaterThan(200);
    const innerLum = (inner.r + inner.g + inner.b) / inner.n;
    const outerLum = (outer.r + outer.g + outer.b) / outer.n;
    expect(outerLum).toBeLessThan(innerLum);
    // 渐冷：外缘 B/R 均值比高于内盘
    expect(outer.b / outer.r).toBeGreaterThan(inner.b / inner.r);
  });

  it('旋臂黄底混入后盘面整体 R−B 高于纯 youngDisk 口径（黄底可辨）', () => {
    const p = generateGalaxyDiskParticles(PARAMS);
    const diskStart = Math.round(PARAMS.count * (PARAMS.bulgeFraction + PARAMS.barFraction));
    let r = 0;
    let b = 0;
    let n = 0;
    for (let i = diskStart; i < p.count; i += 1) {
      if (p.radiiLy[i] / PARAMS.diskRadiusLy < OUTER_DISK_GRADIENT_START) {
        r += p.colors[i * 3];
        b += p.colors[i * 3 + 2];
        n += 1;
      }
    }
    // 纯 youngDisk 大样本均值为 B > R（SC1 断言）；混入 55% oldDisk 黄底
    // + 20% 臂间 oldDisk 后，内盘（无外盘梯度干扰区）整体转向 R ≥ B
    expect(n).toBeGreaterThan(500);
    expect(r / n).toBeGreaterThan(b / n);
  });
});

describe('SC1-2 银盘接入：M2 三档粒子数颜色分布一致性', () => {
  const TIER_COUNTS = [40000, 24000, 12000] as const;

  it('三档粒子数生成不抛错，且各档色相统计一致（均值分量差 < 0.03）', () => {
    const means = TIER_COUNTS.map((count) => {
      const p = generateGalaxyDiskParticles({
        count,
        seed: 20260722,
        armCount: 4,
        diskRadiusLy: 50000,
        thicknessLy: 1000,
        bulgeRadiusLy: 8000,
        bulgeFraction: 0.2,
        spiralTightness: 1.2,
        armSpreadRad: 0.28,
        barFraction: 0.08,
      });
      let r = 0;
      let g = 0;
      let b = 0;
      for (let i = 0; i < p.count; i += 1) {
        r += p.colors[i * 3];
        g += p.colors[i * 3 + 1];
        b += p.colors[i * 3 + 2];
      }
      return { r: r / p.count, g: g / p.count, b: b / p.count };
    });
    for (let t = 1; t < means.length; t += 1) {
      expect(Math.abs(means[t].r - means[0].r)).toBeLessThan(0.03);
      expect(Math.abs(means[t].g - means[0].g)).toBeLessThan(0.03);
      expect(Math.abs(means[t].b - means[0].b)).toBeLessThan(0.03);
    }
  });
});
