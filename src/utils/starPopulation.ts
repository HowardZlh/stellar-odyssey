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
