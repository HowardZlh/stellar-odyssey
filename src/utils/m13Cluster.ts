/**
 * R4-19 M13 球状星团 King 分布 + HR 图颜色（纯逻辑）
 *
 * 数据源（§0.4 登记）：Harris (1996, AJ 112, 1487; 2010 版) 银河系球状
 * 星团目录 NGC 6205 行（核半径 0.62′=1.28 pc / 潮汐半径 21.01′=43.4 pc /
 * 浓度 c=1.53），经 R4-5 烘焙产物 `public/data/m13-profile.json` 消费
 * （`bakedData.loadM13Profile`，失败降级现状程序化分布，消费方登记）。
 *
 * ## King profile 逆变换采样（§R4-19 省 token 约定：数值反查表，非解析求逆）
 *
 * 三维密度取 King (1962, AJ 67, 471) 经验轮廓的解析去投影式（King 1966
 * 单质量模型的标准近似，eq. 27）：
 *
 *   ρ(r) ∝ (1/z²)·[arccos(z)/z − √(1−z²)]，
 *   z = √[(1+(r/r_c)²)/(1+(r_t/r_c)²)]，r < r_t（r ≥ r_t 时 ρ=0）
 *
 * 累积质量 M(<r) = ∫ 4πs²ρ(s)ds 以梯形法数值积分（512 步），归一为 CDF
 * 后预计算 64 点逆 CDF 反查表（u=i/63 → r/r_t），采样时线性插值——
 * 每星 O(1)，无逐星数值求逆。M13 参数下半质量半径 ≈ 0.121·r_t ≈ 5.2 pc
 * （≈1.5× 投影半光度半径 3.49 pc，King 模型典型比值；单测锚定）。
 *
 * ## HR 图颜色分布（比例登记）
 *
 * 球状星团老年星族（[Fe/H]=−1.53）HR 图近似两档：
 * - 90%：红巨星支/主序拐点以下红黄星族，Teff ∈ [3,900, 5,800] K，
 *   u² 偏斜取样偏冷端（RGB 亮星偏 K 型，数量权重向低温倾斜的近似登记）
 * - 10%（`M13_BLUE_FRACTION`）：蓝离散星/蓝端水平支，Teff ∈ [7,500,
 *   10,500] K 均匀（HST 测光中 BSS+HB 蓝端占比的量级近似登记）
 * Teff → `blackbodyRGB`（R4-6 复用）→ sRGB→线性（vertexColors 工作空间）。
 *
 * 确定性种子（`createSeededRandom`，每星固定 6 次抽取），两次构建
 * 逐字节一致。R2-9 银晕程序化 29 星团不在本阶段范围（登记）。
 */

import { blackbodyRGB } from '@/utils/starPhysics';
import { srgbToLinear01 } from '@/utils/pleiadesCatalog';
import { createSeededRandom } from '@/utils/random';
import type { M13Profile } from '@/utils/bakedData';

/** 逆 CDF 反查表点数（§R4-19 省 token 约定：64 点预计算插值） */
export const KING_TABLE_POINTS = 64;

/** CDF 数值积分步数（构建期一次性成本，运行时零积分） */
const KING_CDF_INTEGRATION_STEPS = 512;

/** 蓝离散星/水平支蓝端占比（HR 图近似，比例登记 ~10%） */
export const M13_BLUE_FRACTION = 0.1;

/** 老年红黄星族 Teff 域（K；红巨星支/主序拐点以下） */
export const M13_RED_TEFF_MIN_K = 3900;
export const M13_RED_TEFF_MAX_K = 5800;

/** 蓝离散星/水平支蓝端 Teff 域（K） */
export const M13_BLUE_TEFF_MIN_K = 7500;
export const M13_BLUE_TEFF_MAX_K = 10500;

/** 远观基础星场粒子数（现状预算不变，登记） */
export const M13_BASE_STAR_COUNT = 420;

/** R2-7 近观增量粒子数（现状预算不变，登记） */
export const M13_NEAR_STAR_COUNT = 1200;

/**
 * King 三维密度（归一半径；未归一化幅度，仅用于 CDF 构建与单测）
 *
 * @param r01 归一半径 r/r_t ∈ [0, 1)
 * @param rcOverRt 核半径/潮汐半径比（M13 ≈ 0.0295）
 * @returns 未归一化密度；r01 ≥ 1 或 < 0 返回 0
 */
export function kingDensity3D(r01: number, rcOverRt: number): number {
  if (!Number.isFinite(rcOverRt) || rcOverRt <= 0 || rcOverRt >= 1) {
    throw new RangeError(`核/潮汐半径比必须在 (0, 1) 区间，收到 ${rcOverRt}`);
  }
  if (r01 < 0 || r01 >= 1) return 0;
  const zSq =
    (1 + (r01 / rcOverRt) ** 2) / (1 + (1 / rcOverRt) ** 2);
  const z = Math.sqrt(zSq);
  if (z >= 1) return 0;
  return (Math.acos(z) / z - Math.sqrt(1 - z * z)) / zSq;
}

/**
 * 构建 King 逆 CDF 反查表（64 点；radii[i] = r/r_t，u = i/(N−1)）
 *
 * 梯形法积分 4πr²ρ(r) 归一后逐点反查（构建期一次性，采样 O(1) 插值）。
 * 表严格单调递增，radii[0]=0、radii[N−1]=1。
 */
export function buildKingRadiusTable01(
  rcOverRt: number,
  points: number = KING_TABLE_POINTS,
): Float64Array {
  if (!Number.isInteger(points) || points < 2) {
    throw new RangeError(`反查表点数必须为 ≥2 的整数，收到 ${points}`);
  }
  const n = KING_CDF_INTEGRATION_STEPS;
  const cdf = new Float64Array(n + 1);
  let acc = 0;
  let prev = 0;
  for (let i = 1; i <= n; i += 1) {
    const r = i / n;
    const f = r * r * kingDensity3D(r, rcOverRt);
    acc += ((prev + f) / 2) * (1 / n);
    prev = f;
    cdf[i] = acc;
  }
  for (let i = 0; i <= n; i += 1) cdf[i] /= acc;
  const radii = new Float64Array(points);
  let hi = 1;
  for (let k = 0; k < points; k += 1) {
    const u = k / (points - 1);
    while (hi < n && cdf[hi] < u) hi += 1;
    const span = cdf[hi] - cdf[hi - 1];
    const f = span > 0 ? (u - cdf[hi - 1]) / span : 0;
    radii[k] = (hi - 1 + f) / n;
  }
  radii[0] = 0;
  radii[points - 1] = 1;
  return radii;
}

/**
 * 按逆 CDF 反查表采样归一半径（线性插值，纯函数 O(1)）
 *
 * @param table `buildKingRadiusTable01` 产物
 * @param u 均匀随机数 ∈ [0, 1]（域外钳制）
 * @returns 归一半径 r/r_t ∈ [0, 1]
 */
export function sampleKingRadius01(table: Float64Array, u: number): number {
  const clamped = Math.max(0, Math.min(1, u));
  const pos = clamped * (table.length - 1);
  const lo = Math.floor(pos);
  if (lo >= table.length - 1) return table[table.length - 1];
  const f = pos - lo;
  return table[lo] + (table[lo + 1] - table[lo]) * f;
}

/** 半质量半径（归一 r/r_t；反查表 u=0.5 处，单测锚定 M13 ≈ 0.121） */
export function kingHalfMassRadius01(table: Float64Array): number {
  return sampleKingRadius01(table, 0.5);
}

/** 从烘焙 profile 提取核/潮汐半径比（pc 值同源；M13 ≈ 0.0295） */
export function kingShapeFromProfile(profile: M13Profile): number {
  return profile.coreRadiusPc / profile.tidalRadiusPc;
}

/**
 * HR 图两档 Teff 采样（纯函数；比例/域登记见文件头）
 *
 * @param uKind 星族档抽取 ∈ [0,1)（< M13_BLUE_FRACTION 为蓝星档）
 * @param uSpread 档内温度位置 ∈ [0,1)
 */
export function m13StarTeffK(uKind: number, uSpread: number): number {
  if (uKind < M13_BLUE_FRACTION) {
    return (
      M13_BLUE_TEFF_MIN_K + (M13_BLUE_TEFF_MAX_K - M13_BLUE_TEFF_MIN_K) * uSpread
    );
  }
  // u² 偏斜：数量权重向红巨星支冷端倾斜（近似登记）
  return (
    M13_RED_TEFF_MIN_K +
    (M13_RED_TEFF_MAX_K - M13_RED_TEFF_MIN_K) * uSpread * uSpread
  );
}

export interface M13ClusterAttributes {
  /** xyz 交错（场景单位） */
  positions: Float32Array;
  /** 线性空间 RGB 交错（vertexColors） */
  colors: Float32Array;
  /** 蓝星档实际计数（比例单测/登记） */
  blueCount: number;
}

export interface M13ClusterBuildOptions {
  /** 确定性种子（两次构建逐字节一致） */
  seed: number;
  /** 粒子数 */
  count: number;
  /** 潮汐半径映射到的场景半径（视觉半径 = r_t，登记） */
  radiusUnits: number;
  /** King 逆 CDF 反查表（`buildKingRadiusTable01`） */
  table: Float64Array;
  /** 亮度抖动下限（乘于黑体色） */
  brightnessMin: number;
  /** 亮度抖动上限 */
  brightnessMax: number;
}

/**
 * 构建 M13 星场属性（King 位置 + HR 黑体色；确定性、每星 6 次抽取）
 *
 * 潮汐半径映射满视觉半径：核半径仅占 ~3% —— 中心致密核 + 外围稀疏晕
 * 的真实密度梯度（§R4-19 验收 1）。方向均匀球面（cos 极角均匀）。
 */
export function buildM13ClusterAttributes(
  options: M13ClusterBuildOptions,
): M13ClusterAttributes {
  const { seed, count, radiusUnits, table, brightnessMin, brightnessMax } =
    options;
  if (!Number.isInteger(count) || count <= 0) {
    throw new RangeError(`粒子数必须为正整数，收到 ${count}`);
  }
  const rand = createSeededRandom(seed);
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  let blueCount = 0;
  for (let i = 0; i < count; i += 1) {
    const r = sampleKingRadius01(table, rand()) * radiusUnits;
    const cosPolar = rand() * 2 - 1;
    const azimuth = Math.PI * 2 * rand();
    const sinPolar = Math.sqrt(1 - cosPolar * cosPolar);
    positions[i * 3] = r * sinPolar * Math.cos(azimuth);
    positions[i * 3 + 1] = r * cosPolar;
    positions[i * 3 + 2] = r * sinPolar * Math.sin(azimuth);
    const uKind = rand();
    if (uKind < M13_BLUE_FRACTION) blueCount += 1;
    const teff = m13StarTeffK(uKind, rand());
    const rgb = blackbodyRGB(teff);
    const brightness =
      brightnessMin + (brightnessMax - brightnessMin) * rand();
    colors[i * 3] = srgbToLinear01(rgb.r) * brightness;
    colors[i * 3 + 1] = srgbToLinear01(rgb.g) * brightness;
    colors[i * 3 + 2] = srgbToLinear01(rgb.b) * brightness;
  }
  return { positions, colors, blueCount };
}
