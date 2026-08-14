/**
 * SC5 全域「星系色彩增强」纯函数单测（REQUIREMENTS_STAR_COLORS §SC5-1）
 *
 * 覆盖：S 曲线端点固定/严格单调/center 不动点/拉伸方向与定标数据/非法
 * 参数；boostSaturation 色相保持/亮度不变/钳制/k=1 恒等/非法参数；
 * 数组批量出口逐三元组一致；线性 ↔ sRGB 往返（canvas 色调消费链路）。
 */

import {
  CATALOG_ENHANCE_CENTER,
  CATALOG_ENHANCE_GAIN,
  COLOR_BOOST_SATURATION_K,
  boostSaturation,
  boostSaturationColors,
  enhanceCatalogT01,
  linear01ToSrgb,
} from '../colorBoost';
import { srgbToLinear01 } from '../starPopulation';

describe('SC5 enhanceCatalogT01（2MRS 插值参数 S 曲线对比拉伸）', () => {
  it('常量登记：center = 0.38（实测中位档 37/98）、gain = 8、k = 2.0（二轮调强）', () => {
    expect(CATALOG_ENHANCE_CENTER).toBe(0.38);
    expect(CATALOG_ENHANCE_GAIN).toBe(8);
    expect(COLOR_BOOST_SATURATION_K).toBe(2.0);
  });

  it('端点精确固定：t\'(0) = 0、t\'(1) = 1', () => {
    expect(enhanceCatalogT01(0)).toBe(0);
    expect(enhanceCatalogT01(1)).toBe(1);
  });

  it('center 为精确不动点：t\'(0.38) = 0.38（中位色调不动）', () => {
    expect(enhanceCatalogT01(CATALOG_ENHANCE_CENTER)).toBe(CATALOG_ENHANCE_CENTER);
  });

  it('全域严格单调（J−K 排序语义无损，档域 0–98 网格逐对断言）', () => {
    let prev = enhanceCatalogT01(0);
    for (let jk = 1; jk <= 98; jk += 1) {
      const cur = enhanceCatalogT01(jk / 98);
      expect(cur).toBeGreaterThan(prev);
      prev = cur;
    }
  });

  it('对比拉伸方向：中位以下压低、以上抬高（P10 0.20→≈0.12、P90 0.62→≈0.85）', () => {
    // 实测定标（2MRS 档位分布 P10/P50/P90 = 20/37/61）：分段归一实现下
    // 的实际拉伸值（与需求引用的单段归一估算 0.16/0.87 差异已在实现登记）
    expect(enhanceCatalogT01(0.2)).toBeLessThan(0.2);
    expect(enhanceCatalogT01(0.2)).toBeCloseTo(0.122, 3);
    expect(enhanceCatalogT01(0.62)).toBeGreaterThan(0.62);
    expect(enhanceCatalogT01(0.62)).toBeCloseTo(0.848, 3);
  });

  it('输出恒在 [0,1] 且 C⁰ 连续（center 两侧极限一致）', () => {
    for (let i = 0; i <= 100; i += 1) {
      const v = enhanceCatalogT01(i / 100);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    const eps = 1e-9;
    expect(enhanceCatalogT01(CATALOG_ENHANCE_CENTER - eps)).toBeCloseTo(
      enhanceCatalogT01(CATALOG_ENHANCE_CENTER + eps),
      6,
    );
  });

  it('非法参数抛 RangeError（NaN/Infinity/越界）', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -0.01, 1.01]) {
      expect(() => enhanceCatalogT01(bad)).toThrow(RangeError);
    }
  });
});

describe('SC5 boostSaturation（线性 RGB 绕 Rec.709 亮度轴饱和提升）', () => {
  const sample = { r: 0.5, g: 0.4, b: 0.3 };
  const luminance = (c: { r: number; g: number; b: number }): number =>
    0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

  it('k=1 恒等（钳制域内逐通道相等）', () => {
    const out = boostSaturation(sample, 1);
    expect(out.r).toBeCloseTo(sample.r, 12);
    expect(out.g).toBeCloseTo(sample.g, 12);
    expect(out.b).toBeCloseTo(sample.b, 12);
  });

  it('亮度不变：未触发钳制时 L(out) = L(in)', () => {
    const out = boostSaturation(sample);
    expect(luminance(out)).toBeCloseTo(luminance(sample), 12);
  });

  it('色相不变：色度矢量 (C−L) 逐通道等比缩放 ×k', () => {
    const lIn = luminance(sample);
    const out = boostSaturation(sample, COLOR_BOOST_SATURATION_K);
    for (const ch of ['r', 'g', 'b'] as const) {
      expect(out[ch] - lIn).toBeCloseTo((sample[ch] - lIn) * COLOR_BOOST_SATURATION_K, 12);
    }
  });

  it('灰色（chroma=0）不动点：任意 k 下原样返回', () => {
    const grey = { r: 0.42, g: 0.42, b: 0.42 };
    const out = boostSaturation(grey, 3);
    expect(out.r).toBeCloseTo(0.42, 12);
    expect(out.g).toBeCloseTo(0.42, 12);
    expect(out.b).toBeCloseTo(0.42, 12);
  });

  it('钳制 [0,1]：饱和色不越界', () => {
    const out = boostSaturation({ r: 1, g: 0.1, b: 0 }, 2);
    for (const v of [out.r, out.g, out.b]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    expect(out.r).toBe(1);
    expect(out.b).toBe(0);
  });

  it('非法参数抛 RangeError（负分量/非有限分量/k ≤ 0/k 非有限）', () => {
    expect(() => boostSaturation({ r: -0.1, g: 0, b: 0 })).toThrow(RangeError);
    expect(() => boostSaturation({ r: Number.NaN, g: 0, b: 0 })).toThrow(RangeError);
    expect(() => boostSaturation(sample, 0)).toThrow(RangeError);
    expect(() => boostSaturation(sample, -1)).toThrow(RangeError);
    expect(() => boostSaturation(sample, Number.NaN)).toThrow(RangeError);
  });
});

describe('SC5 boostSaturationColors（顶点色数组批量出口）', () => {
  it('逐三元组与 boostSaturation 一致；原数组不动（缓存基色语义）', () => {
    const src = new Float32Array([0.5, 0.4, 0.3, 1, 0.1, 0, 0.42, 0.42, 0.42]);
    const backup = src.slice();
    const out = boostSaturationColors(src);
    expect(out).not.toBe(src);
    expect(src).toEqual(backup);
    for (let i = 0; i < src.length; i += 3) {
      const c = boostSaturation({ r: src[i], g: src[i + 1], b: src[i + 2] });
      expect(out[i]).toBeCloseTo(c.r, 6);
      expect(out[i + 1]).toBeCloseTo(c.g, 6);
      expect(out[i + 2]).toBeCloseTo(c.b, 6);
    }
  });

  it('k=1 时逐字节恒等（关闭态旁路语义的函数级镜像）', () => {
    const src = new Float32Array([0.2, 0.5, 0.9, 0.7, 0.7, 0.7]);
    const out = boostSaturationColors(src, 1);
    for (let i = 0; i < src.length; i += 1) {
      expect(out[i]).toBeCloseTo(src[i], 6);
    }
  });

  it('长度非 3 的倍数抛 RangeError', () => {
    expect(() => boostSaturationColors(new Float32Array([0.1, 0.2]))).toThrow(RangeError);
  });
});

describe('SC5 linear01ToSrgb（sRGB 往返，canvas 色调链路）', () => {
  // IEC 标准常量对（0.04045/0.0031308）在阈值点本身有 ~1e-4 级固有失配，
  // 往返采样取阈值以外（登记）
  it('与 srgbToLinear01 互逆（分段两侧）', () => {
    for (const s of [0, 0.003, 0.03, 0.06, 0.2, 0.5, 0.75, 1]) {
      expect(linear01ToSrgb(srgbToLinear01(s))).toBeCloseTo(s, 6);
    }
  });

  it('非法输入抛 RangeError', () => {
    for (const bad of [Number.NaN, -0.01, 1.01, Number.POSITIVE_INFINITY]) {
      expect(() => linear01ToSrgb(bad)).toThrow(RangeError);
    }
  });
});
