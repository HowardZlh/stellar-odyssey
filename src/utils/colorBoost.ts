/**
 * SC5 全域「星系色彩增强」纯函数（REQUIREMENTS_STAR_COLORS §SC5-1）
 *
 * 艺术化口径登记（附录 A 决策，2026-08-14 用户裁决）：增强为**感知拉伸
 * 而非物理线性**——SC1~SC4 的物理输出经实测属真实（2MRS Ks 选源红序列
 * 主导 + J−K 色散窄 + 加性混合白化 → L4 黄白主导观感），默认态以本文件
 * 两个纯函数做生成期后处理便于分辨天体类型；关闭开关即旁路本文件，
 * 回到 SC1~SC4 物理基色（零回归，架构上增强只是基色的后处理）。
 *
 * 方案登记：放弃 CDF 分位数均衡（颜色将编码相对排名而非 J−K 绝对值，
 * 跨区域可比性与重烘焙稳定性差）；2MRS 取**固定 S 曲线**（绝对映射、
 * 重烘焙观感稳定、可单测）；粒子层取绕亮度轴饱和提升（色相/亮度不变）。
 *
 * 全部为生成期一次性 CPU 计算（shader 零改动、帧循环零开销，附录 B 红线）。
 */

import type { LinearRgb } from '@/utils/starPopulation';

/**
 * 2MRS S 曲线中心（插值参数 t 域）：实测档位分布 P10/P50/P90 = 20/37/61
 * → 中位 t = 37/98 ≈ 0.38 取为**不动点**（中位色调不动，两侧对比拉伸）。
 */
export const CATALOG_ENHANCE_CENTER = 0.38;

/** 2MRS S 曲线增益（logistic 斜率参数，量级经无头定标登记 ≈8） */
export const CATALOG_ENHANCE_GAIN = 8;

/**
 * 粒子层饱和度提升系数 k（≈1.4，绕 Rec.709 亮度轴 chroma ×k；
 * 色相/亮度不变，钳制 [0,1]）
 */
export const COLOR_BOOST_SATURATION_K = 1.4;

/** logistic σ(x) = 1/(1+e^−x) */
function logistic(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/**
 * 2MRS 插值参数 S 曲线对比拉伸（§SC5-1）
 *
 * logistic 分段归一化：σ(gain·(t−center)) 在 [0,center] 与 [center,1]
 * 两段各自仿射归一——端点固定 t'(0)=0、t'(1)=1，**center 为精确不动点**
 * （t'(center)=center），全域严格单调（J−K 排序语义无损）、C⁰ 连续。
 *
 * 实现差异登记：需求引用的估算值（P10: 0.20→≈0.16、P90: 0.62→≈0.87）
 * 按全域单段仿射归一计算——该归一下 center 非不动点（0.38→≈0.48），
 * 与"中位不动"定标目标冲突；本实现取分段归一保证不动点精确成立，
 * 实际拉伸 P10: 0.20→≈0.12、P90: 0.62→≈0.85（拉伸方向与量级一致）。
 * 分段处导数不连续（左≈1.7/右≈2.5）为登记项——色调渐变上无可感知硬边。
 *
 * @param t 2MRS J−K 插值参数（jkTier/98 ∈ [0,1]）
 * @throws RangeError 当 t 非有限数或超出 [0,1]
 */
export function enhanceCatalogT01(t: number): number {
  if (!Number.isFinite(t) || t < 0 || t > 1) {
    throw new RangeError(`插值参数必须在 [0,1] 内，收到 ${t}`);
  }
  // 端点精确固定（浮点归一化残差防护，单测断言 t'(0)=0 / t'(1)=1）
  if (t === 0) return 0;
  if (t === 1) return 1;
  const c = CATALOG_ENHANCE_CENTER;
  const g = CATALOG_ENHANCE_GAIN;
  const s = logistic(g * (t - c));
  if (t <= c) {
    const s0 = logistic(-g * c);
    return (c * (s - s0)) / (0.5 - s0);
  }
  const s1 = logistic(g * (1 - c));
  return c + ((1 - c) * (s - 0.5)) / (s1 - 0.5);
}

/**
 * 线性 RGB 绕亮度轴饱和度提升（§SC5-1）
 *
 * L = 0.2126R + 0.7152G + 0.0722B（Rec.709 亮度系数，线性域）；
 * out = L + (C − L)·k，逐通道钳制 [0,1]。性质（单测断言）：
 * 色相不变（色度矢量 C−L 仅等比缩放）、亮度不变（未触发钳制时
 * L(out) = L(in)）、k=1 恒等。
 *
 * @param color 物理基色（线性 RGB，分量 ≥0 有限数）
 * @param k 饱和系数（>0 有限数，缺省 COLOR_BOOST_SATURATION_K）
 * @throws RangeError 当分量/k 非法
 */
export function boostSaturation(color: LinearRgb, k = COLOR_BOOST_SATURATION_K): LinearRgb {
  if (
    !Number.isFinite(color.r) ||
    !Number.isFinite(color.g) ||
    !Number.isFinite(color.b) ||
    color.r < 0 ||
    color.g < 0 ||
    color.b < 0
  ) {
    throw new RangeError(`颜色分量必须为 ≥0 的有限数，收到 (${color.r}, ${color.g}, ${color.b})`);
  }
  if (!Number.isFinite(k) || k <= 0) {
    throw new RangeError(`饱和系数必须为正有限数，收到 ${k}`);
  }
  const l = 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
  const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
  return {
    r: clamp01(l + (color.r - l) * k),
    g: clamp01(l + (color.g - l) * k),
    b: clamp01(l + (color.b - l) * k),
  };
}

/**
 * 顶点色数组整体饱和提升（count×3 线性 RGB → 新数组，原数组不动）
 *
 * SC5-2 消费点（银河系盘/棒/核球/银晕、背景星场）"缓存物理基色 →
 * 派生显示色"的批量出口：生成期一次调用（<20ms 量级），切换开关时
 * 组件仅在基色/派生色两份缓存间重写 color attribute，不重建位置 buffer。
 *
 * @throws RangeError 当数组长度非 3 的倍数或分量/k 非法
 */
export function boostSaturationColors(
  colors: Float32Array,
  k = COLOR_BOOST_SATURATION_K,
): Float32Array {
  if (colors.length % 3 !== 0) {
    throw new RangeError(`颜色数组长度必须为 3 的倍数，收到 ${colors.length}`);
  }
  const out = new Float32Array(colors.length);
  for (let i = 0; i < colors.length; i += 3) {
    const c = boostSaturation({ r: colors[i], g: colors[i + 1], b: colors[i + 2] }, k);
    out[i] = c.r;
    out[i + 1] = c.g;
    out[i + 2] = c.b;
  }
  return out;
}

/**
 * 线性分量 → sRGB（IEC 61966-2-1 正变换，`srgbToLinear01` 的逆）
 *
 * SC5-2 程序化星系 canvas 色调消费：sRGB hex → 线性 → boostSaturation
 * → 本函数回 sRGB（饱和提升按需求在线性域绕亮度轴进行）。
 *
 * @throws RangeError 当输入非 [0,1] 有限数
 */
export function linear01ToSrgb(c: number): number {
  if (!Number.isFinite(c) || c < 0 || c > 1) {
    throw new RangeError(`线性分量必须在 [0,1] 内，收到 ${c}`);
  }
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}
