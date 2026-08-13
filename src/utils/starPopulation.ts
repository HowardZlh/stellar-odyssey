/**
 * 恒星星族颜色采样器（SC1，REQUIREMENTS_STAR_COLORS §SC1-1）
 *
 * 银盘/核球/银晕程序化粒子的颜色**唯一事实源**：按星族预设加权抽样
 * 光谱型桶 → 桶内 Teff 对数均匀抽样 → `blackbodyRGB`（Mitchell Charity
 * CIE 黑体色表，starPhysics.ts 登记）→ `srgbToLinear01`（顶点色线性
 * 工作空间，与昴星团/M13 真实数据转色管线同源）→ 小幅亮度抖动，
 * 输出线性 RGB（0–1）。生成期一次性 CPU 计算，帧循环零开销。
 *
 * ── 发光加权口径（§0.3 / 附录 A 决策登记）───────────────────────────
 * 权重为**发光加权**（可见光视觉分布），非数量分布：
 * - 数量口径（RECONS 近域普查）：M ~76% / K ~12% / G ~7.6% / F ~3% /
 *   A ~0.6% / O+B <0.13%——若按数量抽样，整盘呈暗红，偏离照片观感；
 * - 按光度加权修正后，可见光主导者为 O/B/A 主序 + F/G 亚巨星 +
 *   K/M 巨星（Ledrew 2001, JRASC 95, "The Real Starry Sky"：肉眼可见
 *   星表以 B/A 型主序与 K/M 红巨星为主，真正的红矮星一颗不可见）。
 * 取舍：可视化以"望远镜照片中可见的颜色分布"为真实基准，故采用
 * 发光加权口径（视觉真实优先于数量真实，登记于附录 A）。
 *
 * ── 星族分区依据（Baade 1944 起的经典星族划分）──────────────────────
 * - youngDisk：旋臂 = 年轻星族 I——O/B/A 蓝白为主 + 少量红超巨星点缀
 *   （旋臂为恒星形成区，大质量短寿星集中于此）；
 * - oldDisk：盘间/内盘中老年盘星族——F/G/K 黄橙为主 + 红巨星
 *   （臂间为脱离旋臂图案的中低质量长寿星）；
 * - bulge：核球/棒 = 老年星族 II——K/M 红黄 + 红巨星，**禁 O/B**
 *   （核球恒星形成早已停止，无大质量年轻星）；
 * - halo：银晕贫金属老年星——红黄巨星为主 + 少量蓝水平支星
 *   （BHB：贫金属球状星团/银晕特征星族，HST 银晕测光近似）。
 *
 * 各光谱型桶 Teff 区间取 MK 光谱分类主序代表域（Habets & Heintze 1981
 * 量级；巨星/超巨星桶按其光球温度域单列），域端点在 `blackbodyRGB`
 * 的 [3,000, 50,000] K 有效域内（域外由其钳制兜底）。
 */

import { blackbodyRGB } from '@/utils/starPhysics';

/**
 * sRGB 分量 → 线性工作空间（标准 IEC 61966-2-1 逆变换）
 *
 * 与 `pleiadesCatalog.srgbToLinear01` 同一公式的本地实现（登记）：
 * pleiadesCatalog 经 nearView → cameraFocus → universe 传递依赖回
 * galaxy.ts，跨文件复用会形成循环 import——按 galaxy.ts `hexToRgb`
 * 同款"本文件私有实现"惯例就地登记，单测断言与昴星团版本逐值一致。
 */
export function srgbToLinear01(c: number): number {
  if (!Number.isFinite(c) || c < 0 || c > 1) {
    throw new RangeError(`sRGB 分量必须在 [0,1] 内，收到 ${c}`);
  }
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** 星族预设标识（SC1 三预设 + 银晕） */
export type StarPopulation = 'youngDisk' | 'oldDisk' | 'bulge' | 'halo';

/** 光谱型桶：采样权重 + 桶内 Teff 抽样区间（K） */
export interface SpectralBucket {
  /** 桶名（光谱型或演化分支，注释/调试用） */
  readonly name: string;
  /** 发光加权采样概率（每预设权重之和 = 1，单测断言归一性） */
  readonly weight: number;
  /** 桶内 Teff 下界（K） */
  readonly teffMinK: number;
  /** 桶内 Teff 上界（K） */
  readonly teffMaxK: number;
}

/** 线性 RGB（0–1） */
export interface LinearRgb {
  r: number;
  g: number;
  b: number;
}

/** 亮度抖动区间（小幅，保持星族色相主导；gain ∈ [0.8, 1.0]） */
export const STAR_BRIGHTNESS_JITTER_MIN = 0.8;
export const STAR_BRIGHTNESS_JITTER_SPAN = 0.2;

// ---------------------------------------------------------------------------
// 星族权重表（唯一事实源；数值口径见文件头「发光加权」段）
// ---------------------------------------------------------------------------

/** 主序光谱型桶 Teff 域（K，MK 分类代表区间；M 桶下界取 blackbodyRGB 域下限） */
const O = { teffMinK: 30000, teffMaxK: 45000 };
const B = { teffMinK: 10000, teffMaxK: 30000 };
const A = { teffMinK: 7500, teffMaxK: 10000 };
const F = { teffMinK: 6000, teffMaxK: 7500 };
const G = { teffMinK: 5300, teffMaxK: 6000 };
const K = { teffMinK: 3900, teffMaxK: 5300 };
const M = { teffMinK: 3000, teffMaxK: 3900 };
/** 红巨星分支（K/M III 光球温度域） */
const RED_GIANT = { teffMinK: 3500, teffMaxK: 4800 };
/** 红超巨星（M I，旋臂年轻星族点缀，如参宿四） */
const RED_SUPERGIANT = { teffMinK: 3000, teffMaxK: 4000 };
/** 蓝水平支星（BHB，贫金属银晕/球状星团特征星族） */
const BLUE_HORIZONTAL_BRANCH = { teffMinK: 7500, teffMaxK: 11000 };

/**
 * 星族 → 光谱型桶权重表（每预设权重之和 = 1）
 *
 * 权重为发光加权后的可见光占比近似（依据见文件头；初值按需求文档
 * 口径定标，观感微调归 SC2）。
 */
export const STAR_POPULATION_BUCKETS: Readonly<
  Record<StarPopulation, readonly SpectralBucket[]>
> = {
  // 旋臂/年轻星族 I：O/B/A 蓝白权重显著 + 少量红超巨星点缀
  youngDisk: [
    { name: 'O', weight: 0.05, ...O },
    { name: 'B', weight: 0.3, ...B },
    { name: 'A', weight: 0.24, ...A },
    { name: 'F', weight: 0.12, ...F },
    { name: 'G', weight: 0.07, ...G },
    { name: 'K', weight: 0.05, ...K },
    { name: 'M', weight: 0.02, ...M },
    { name: 'redGiant', weight: 0.08, ...RED_GIANT },
    { name: 'redSupergiant', weight: 0.07, ...RED_SUPERGIANT },
  ],
  // 盘间/内盘中老年：F/G/K 黄橙为主 + 少量 A 与红巨星
  oldDisk: [
    { name: 'A', weight: 0.08, ...A },
    { name: 'F', weight: 0.24, ...F },
    { name: 'G', weight: 0.27, ...G },
    { name: 'K', weight: 0.22, ...K },
    { name: 'M', weight: 0.04, ...M },
    { name: 'redGiant', weight: 0.15, ...RED_GIANT },
  ],
  // 核球/棒老年星族 II：K/M 红黄 + 红巨星，禁 O/B/A/F（Teff ≤ 6,000 K
  // → 黑体色恒 R > B，核球逐粒子暖色保证，单测断言）
  bulge: [
    { name: 'G', weight: 0.2, ...G },
    { name: 'K', weight: 0.35, ...K },
    { name: 'M', weight: 0.15, ...M },
    { name: 'redGiant', weight: 0.3, ...RED_GIANT },
  ],
  // 银晕贫金属老年星 + 蓝水平支混入（现状 HALO_BLUE ~10% 口径延续为 12%）
  halo: [
    { name: 'G', weight: 0.1, ...G },
    { name: 'K', weight: 0.3, ...K },
    { name: 'M', weight: 0.1, ...M },
    { name: 'redGiant', weight: 0.38, ...RED_GIANT },
    { name: 'blueHorizontalBranch', weight: 0.12, ...BLUE_HORIZONTAL_BRANCH },
  ],
};

// ---------------------------------------------------------------------------
// SC2 径向颜色调制（REQUIREMENTS_STAR_COLORS §SC2-1/-4，生成期纯函数）
// ---------------------------------------------------------------------------

/**
 * 核球中心亮度提升幅度（半径 0 处 gain = 1 + 该值，向外二次衰减）
 *
 * 依据：旋涡星系核球面亮度向心陡增（Sérsic 轮廓），参考图（NGC 4414）
 * 核心呈亮黄白、外缘暖橙——中心以"亮度提升 + 向暖白靠拢"近似高
 * 恒星密度的视觉叠加（§SC2-1）。
 */
export const BULGE_CENTER_BRIGHTEN = 0.35;

/** 核球中心向暖白靠拢的最大混合比（半径 0 处，向外二次衰减） */
export const BULGE_CENTER_WHITEN = 0.5;

/** 核球中心暖白参考色（线性 RGB，约 #fff3dc 的线性域值——亮黄白） */
export const BULGE_CENTER_WHITE: Readonly<LinearRgb> = { r: 1.0, g: 0.9, b: 0.72 };

/** 核球外缘暖橙乘性色调（线性 RGB 乘子；r=1 处满额，向心线性减弱） */
export const BULGE_EDGE_WARM_TINT: Readonly<LinearRgb> = { r: 1.0, g: 0.78, b: 0.5 };

/**
 * 外盘"渐冷渐暗"最大暗化比例（盘缘 rNorm=1 处亮度 ×(1−该值)）
 *
 * 依据：盘星系面亮度径向指数衰减、B−V 由内向外变蓝（de Jong 1996,
 * A&A 313）；低面亮度外盘视觉上呈"渐暗渐冷"（§0.3/§SC2-4 登记）。
 */
export const OUTER_DISK_DIM_MAX = 0.42;

/** 外盘冷色乘性色调（压 R/G 留 B → 变冷同时不越界，线性 RGB 乘子） */
export const OUTER_DISK_COOL_TINT: Readonly<LinearRgb> = { r: 0.8, g: 0.9, b: 1.0 };

/** 外盘梯度起始半径（rNorm，smoothstep 下沿——内盘不受影响、无硬边） */
export const OUTER_DISK_GRADIENT_START = 0.4;

/** rNorm 参数校验 + [0,1] 钳制（超界半径按边界值处理，非法值抛错） */
function clampRadiusNorm(rNorm: number): number {
  if (!Number.isFinite(rNorm)) {
    throw new RangeError(`归一化半径必须为有限数，收到 ${rNorm}`);
  }
  return Math.min(1, Math.max(0, rNorm));
}

/** Hermite smoothstep（与 GLSL smoothstep 同式，纯 CPU 生成期使用） */
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * 核球/棒粒子径向颜色渐变（SC2-1，生成期一次性调用）
 *
 * 中心（rNorm→0）：亮度提升 `BULGE_CENTER_BRIGHTEN` + 向暖白
 * `BULGE_CENTER_WHITE` 靠拢（亮黄白核心）；外缘（rNorm→1）：乘
 * `BULGE_EDGE_WARM_TINT` 暖橙色调。两端权重均连续（中心二次、
 * 外缘线性），无硬边；输出钳制在 [0,1]。
 *
 * @param color 星族采样输出（线性 RGB）
 * @param rNorm 粒子半径 / 核球半径（超界钳制到 [0,1]）
 */
export function applyBulgeRadialGradient(color: LinearRgb, rNorm: number): LinearRgb {
  const r = clampRadiusNorm(rNorm);
  const centerW = (1 - r) * (1 - r);
  const whiten = BULGE_CENTER_WHITEN * centerW;
  const gain = 1 + BULGE_CENTER_BRIGHTEN * centerW;
  const mixTint = (base: number, white: number, tint: number): number =>
    Math.min(1, (base * (1 - whiten) + white * whiten) * gain * (1 + (tint - 1) * r));
  return {
    r: mixTint(color.r, BULGE_CENTER_WHITE.r, BULGE_EDGE_WARM_TINT.r),
    g: mixTint(color.g, BULGE_CENTER_WHITE.g, BULGE_EDGE_WARM_TINT.g),
    b: mixTint(color.b, BULGE_CENTER_WHITE.b, BULGE_EDGE_WARM_TINT.b),
  };
}

/**
 * 盘粒子外盘"渐冷渐暗"径向梯度（SC2-4，生成期一次性调用）
 *
 * `OUTER_DISK_GRADIENT_START` 内恒等返回；向外按 smoothstep 平滑
 * 叠加暗化（至 ×(1−OUTER_DISK_DIM_MAX)）与冷色调（乘
 * `OUTER_DISK_COOL_TINT`），边缘与星空背景过渡无硬边（§SC2-4，
 * de Jong 1996 依据见常量注释）。
 *
 * @param color 星族采样/HII 粉输出（线性 RGB）
 * @param rNorm 粒子半径 / 盘半径（超界钳制到 [0,1]）
 */
export function applyOuterDiskGradient(color: LinearRgb, rNorm: number): LinearRgb {
  const r = clampRadiusNorm(rNorm);
  const w = smoothstep(OUTER_DISK_GRADIENT_START, 1, r);
  if (w === 0) return { r: color.r, g: color.g, b: color.b };
  const gain = 1 - OUTER_DISK_DIM_MAX * w;
  return {
    r: color.r * gain * (1 + (OUTER_DISK_COOL_TINT.r - 1) * w),
    g: color.g * gain * (1 + (OUTER_DISK_COOL_TINT.g - 1) * w),
    b: color.b * gain * (1 + (OUTER_DISK_COOL_TINT.b - 1) * w),
  };
}

// ---------------------------------------------------------------------------
// 采样
// ---------------------------------------------------------------------------

/**
 * 按星族预设采样一颗恒星的线性 RGB 颜色
 *
 * 流程：光谱型桶加权抽样 → 桶内 Teff **对数均匀**抽样（同桶内低温星
 * 数量更多的幂律近似）→ `blackbodyRGB`（sRGB）→ `srgbToLinear01`
 * （顶点色线性工作空间）→ 亮度抖动 gain ∈ [0.8, 1.0]。
 *
 * 每次调用固定消耗 rng 3 个数（桶/Teff/抖动），确定性 rng 下结果确定。
 *
 * @param population 星族预设
 * @param rng [0, 1) 随机数源（确定性种子生成器）
 * @returns 线性 RGB（0–1，已含亮度抖动）
 */
export function sampleStarColor(population: StarPopulation, rng: () => number): LinearRgb {
  const buckets = STAR_POPULATION_BUCKETS[population];
  if (!buckets) {
    throw new RangeError(`未知星族预设：${String(population)}`);
  }
  // 桶加权抽样（权重和为 1，浮点残差由末桶兜底）
  let pick = rng();
  let bucket = buckets[buckets.length - 1];
  for (const b of buckets) {
    pick -= b.weight;
    if (pick < 0) {
      bucket = b;
      break;
    }
  }
  // 桶内 Teff 对数均匀抽样（低温端稍密，同桶内质量函数幂律的粗近似）
  const lnMin = Math.log(bucket.teffMinK);
  const lnMax = Math.log(bucket.teffMaxK);
  const teffK = Math.exp(lnMin + (lnMax - lnMin) * rng());
  const srgb = blackbodyRGB(teffK);
  const gain = STAR_BRIGHTNESS_JITTER_MIN + STAR_BRIGHTNESS_JITTER_SPAN * rng();
  return {
    r: srgbToLinear01(srgb.r) * gain,
    g: srgbToLinear01(srgb.g) * gain,
    b: srgbToLinear01(srgb.b) * gain,
  };
}
