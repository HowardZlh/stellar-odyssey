/**
 * 恒星表面物理化纯逻辑（R4-6，IMPROVEMENT_REQUIREMENTS_4 §R4-6 / §0.3 方案 A）
 *
 * 为 `StellarSurface`（SpecialBodies.tsx）提供三个物理驱动函数：
 *
 * 1. `blackbodyRGB(teffK)`：有效温度 → 黑体 sRGB 基色。
 *    实现为 Planck 谱 → CIE XYZ → sRGB 的**预计算查表线性插值**（需求登记：
 *    "查表插值实现即可"，不在运行时做完整 CIE 管线）。采样表取自
 *    Mitchell Charity "What color is a blackbody?"（CIE 10° 观察者、
 *    sRGB 显示色，http://www.vendian.org/mncharity/dir3/blackbody/），
 *    域 3,000–50,000 K，域外钳制。返回值为 **sRGB（显示色）**，组件侧经
 *    `THREE.Color.setRGB(..., SRGBColorSpace)` 转线性工作色彩空间。
 *
 * 2. `limbDarkeningU(spectralType)`：光谱型 → 线性临边昏暗系数 u。
 *    近似档位取自 Claret (2000, A&A 363, 1081) V 波段线性定律系数的
 *    光谱型代表值（M/K/G/F/A/B/O 主序-巨星混合近似 + 白矮星 D 档；
 *    Wolf-Rayet W 型归入 O 档高温近似）。太阳 G 档 ≈0.6 与观测一致。
 *
 * 3. `granulationCellScale(radiusRsun)`：恒星半径 → 对流颗粒噪声频率
 *    （shader uCellScale）。物理依据：对流颗粒尺寸 ∝ 压强标高，超巨星
 *    颗粒巨大而少（参宿四全盘仅数个巨对流胞，Montargès et al. 2021）、
 *    矮星颗粒细密（太阳米粒 ~百万个）。近似关系登记：取对数线性映射
 *    cellScale = clamp(12 − 3.4·log10(R/R☉), 2, 12)，锚点参宿四
 *    （764 R☉ → 2.2，与 P6 红巨星档现状一致）；非严格标度律。
 *
 * ── 降级与登记（§R4-6）─────────────────────────────────────────────
 * - `FALLBACK_STAR_PARAMS`：`public/data/star-params.json`（R4-5 烘焙产物）
 *   加载失败时的硬编码降级参数表，数值与烘焙产物逐字段一致（单测断言同步）。
 * - 对流时变视觉周期登记：shader fBm 首层噪声域漂移速率 0.05 域单位/s
 *   （一个对流胞跨度 ≈20 s）、高阶层稍快，视觉节奏落在需求 20–60 s 区间；
 *   真实对流演化时标以月/年计，此处为可视化加速（沿用 P6 登记）。
 */

import type { StarPhysicalParams } from '@/utils/bakedData';
import type { Rgb01 } from '@/utils/stellarSurface';

/** blackbodyRGB 有效域（K）：域外输入钳制到边界 */
export const BLACKBODY_TEFF_MIN_K = 3000;
export const BLACKBODY_TEFF_MAX_K = 50000;

/**
 * 黑体色查表（Teff K → sRGB 0–255，Mitchell Charity CIE 10° / sRGB 表采样点）
 *
 * 25 个采样点覆盖 3,000–50,000 K，低温段密（色彩变化快）、高温段疏
 * （趋近瑞利-金斯极限蓝色渐近值）。
 */
const BLACKBODY_TABLE: ReadonlyArray<readonly [number, number, number, number]> = [
  [3000, 255, 180, 107],
  [3500, 255, 196, 137],
  [4000, 255, 209, 163],
  [4500, 255, 219, 186],
  [5000, 255, 228, 206],
  [5500, 255, 236, 224],
  [6000, 255, 243, 239],
  [6500, 255, 249, 253],
  [7000, 245, 243, 255],
  [7500, 235, 238, 255],
  [8000, 227, 233, 255],
  [8500, 220, 229, 255],
  [9000, 214, 225, 255],
  [9500, 208, 222, 255],
  [10000, 204, 219, 255],
  [11000, 196, 215, 255],
  [12000, 191, 211, 255],
  [14000, 182, 206, 255],
  [16000, 177, 202, 255],
  [18000, 171, 199, 255],
  [20000, 168, 197, 255],
  [25000, 163, 194, 255],
  [30000, 159, 192, 255],
  [40000, 155, 189, 255],
  [50000, 152, 187, 255],
];

/**
 * 黑体有效温度 → sRGB 基色（0–1）
 *
 * 查表线性插值；域外温度钳制到 [3,000, 50,000] K。
 *
 * @param teffK 有效温度（K），须为正有限数
 * @returns sRGB 显示色（0–1；组件侧再转线性工作空间）
 * @throws RangeError 当 teffK 非正有限数
 */
export function blackbodyRGB(teffK: number): Rgb01 {
  if (!Number.isFinite(teffK) || teffK <= 0) {
    throw new RangeError(`有效温度必须为正有限数（K），收到 ${teffK}`);
  }
  const t = Math.max(BLACKBODY_TEFF_MIN_K, Math.min(BLACKBODY_TEFF_MAX_K, teffK));
  // 查找区间（表短，线性扫描即可；无每帧调用热点——组件仅在参数变化时求值）
  let hi = 1;
  while (hi < BLACKBODY_TABLE.length - 1 && BLACKBODY_TABLE[hi][0] < t) hi += 1;
  const a = BLACKBODY_TABLE[hi - 1];
  const b = BLACKBODY_TABLE[hi];
  const f = (t - a[0]) / (b[0] - a[0]);
  return {
    r: (a[1] + (b[1] - a[1]) * f) / 255,
    g: (a[2] + (b[2] - a[2]) * f) / 255,
    b: (a[3] + (b[3] - a[3]) * f) / 255,
  };
}

/**
 * 光谱型档位 → 线性临边昏暗系数 u（Claret 2000 V 波段近似档）
 *
 * 冷星光球温度梯度陡 → 临边昏暗强（M ≈0.85）；热星辐射层电子散射占优
 * → 昏暗弱（O ≈0.30）；白矮星（D 档）高表面重力高温 → 最弱档 0.25。
 */
const LIMB_DARKENING_BY_CLASS: Readonly<Record<string, number>> = {
  M: 0.85,
  K: 0.75,
  G: 0.65,
  F: 0.58,
  A: 0.5,
  B: 0.38,
  O: 0.3,
  /** Wolf-Rayet（WN/WC/WO）：光学厚星风高温近似归入 O 档 */
  W: 0.3,
  /** 白矮星（DA/DB/…）：独立档（§R4-6：u 小，与 R2-7 调蓝一致化） */
  D: 0.25,
};

/** 未识别光谱型时的默认档（太阳 G 档，登记：宁取中间值不外推） */
export const LIMB_DARKENING_DEFAULT_U = 0.65;

/**
 * 按光谱型字符串返回线性临边昏暗系数 u ∈ [0,1]
 *
 * 取首个非空格字符判档（"M1-M2Ia-Iab"→M、"DA1.9"→D 白矮星、"WN8h"→W）；
 * 未识别类型回落 G 档默认值（登记）。
 *
 * @throws RangeError 当 spectralType 为空串
 */
export function limbDarkeningU(spectralType: string): number {
  const s = spectralType.trim().toUpperCase();
  if (s.length === 0) {
    throw new RangeError('光谱型不能为空串');
  }
  return LIMB_DARKENING_BY_CLASS[s[0]] ?? LIMB_DARKENING_DEFAULT_U;
}

/** granulationCellScale 输出钳制域（shader uCellScale 噪声首层频率） */
export const GRANULATION_CELL_SCALE_MIN = 2;
export const GRANULATION_CELL_SCALE_MAX = 12;

/**
 * 恒星半径 → 对流颗粒噪声频率（巨星颗粒大而少 → 频率低；矮星细密 → 频率高）
 *
 * cellScale = clamp(12 − 3.4·log10(R/R☉), 2, 12)（近似关系登记见文件头）。
 * 单调不增；锚点：参宿四 764 R☉ → 2.2（P6 红巨星档现状一致）。
 *
 * @param radiusRsun 恒星半径（太阳半径），须为正有限数
 * @throws RangeError 当 radiusRsun 非正有限数
 */
export function granulationCellScale(radiusRsun: number): number {
  if (!Number.isFinite(radiusRsun) || radiusRsun <= 0) {
    throw new RangeError(`恒星半径必须为正有限数（R☉），收到 ${radiusRsun}`);
  }
  const raw = 12 - 3.4 * Math.log10(radiusRsun);
  return Math.max(
    GRANULATION_CELL_SCALE_MIN,
    Math.min(GRANULATION_CELL_SCALE_MAX, raw),
  );
}

/**
 * 硬编码降级参数表（`public/data/star-params.json` 加载失败时使用，登记）
 *
 * 数值与 R4-5 烘焙产物逐字段一致（单测断言两者同步，防漂移）；
 * 文献来源见各条 ref 字段。
 */
export const FALLBACK_STAR_PARAMS: Readonly<Record<string, StarPhysicalParams>> = {
  betelgeuse: {
    nameZh: '参宿四',
    simbadId: '* alf Ori',
    spectralType: 'M1-M2Ia-Iab',
    teffK: 3600,
    radiusRsun: 764,
    luminosityLsun: 126000,
    ref: 'Joyce et al. (2020, ApJ 902, 63)：Teff=3600 K、R=764 R☉、L=1.26e5 L☉（变星，取代表值）',
  },
  rigel: {
    nameZh: '参宿七',
    simbadId: '* bet Ori',
    spectralType: 'B8Ia',
    teffK: 12100,
    radiusRsun: 78.9,
    luminosityLsun: 120000,
    ref: 'Przybilla et al. (2010, A&A 517, A38) Teff/R；Moravveji et al. (2012, ApJ 747, 108) L',
  },
  siriusA: {
    nameZh: '天狼星 A',
    simbadId: '* alf CMa',
    spectralType: 'A0mA1Va',
    teffK: 9940,
    radiusRsun: 1.711,
    luminosityLsun: 25.4,
    ref: 'Kervella et al. (2003, A&A 408, 681) R 干涉测量；Adelman (2004) Teff；Liebert et al. (2005, ApJ 630, L69) L',
  },
  siriusB: {
    nameZh: '天狼星 B',
    simbadId: '* alf CMa B',
    spectralType: 'DA1.9',
    teffK: 25200,
    radiusRsun: 0.0084,
    luminosityLsun: 0.056,
    ref: 'Barstow et al. (2005, MNRAS 362, 1134) Teff=25193 K；Holberg et al. (1998, ApJ 497, 935) R/L',
  },
  deltaCephei: {
    nameZh: '造父一',
    simbadId: '* del Cep',
    spectralType: 'F5Iab:+B7-8',
    teffK: 5960,
    radiusRsun: 43.3,
    luminosityLsun: 1955,
    ref: 'Mérand et al. (2005, A&A 438, L9) R=43.3 R☉ 干涉测量；Engle et al. (2014, ApJ 794, 80) <Teff>/L（脉动均值）',
  },
  wr124: {
    nameZh: 'WR 124',
    simbadId: 'Hen 2-427',
    spectralType: 'WN8h',
    teffK: 44700,
    radiusRsun: 11.93,
    luminosityLsun: 562000,
    ref: 'Hamann et al. (2019, A&A 625, A57)：Gaia DR2 距离修订后 T*=44.7 kK、R=11.93 R☉、L=5.62e5 L☉',
  },
};

/**
 * 派生 StellarSurface 物理 uniform 三元组（组件消费入口，纯函数）
 *
 * @param params 恒星物理参数（烘焙数据或降级表条目）
 */
export function stellarSurfacePhysics(params: StarPhysicalParams): {
  color: Rgb01;
  limbU: number;
  cellScale: number;
} {
  return {
    color: blackbodyRGB(params.teffK),
    limbU: limbDarkeningU(params.spectralType),
    cellScale: granulationCellScale(params.radiusRsun),
  };
}
