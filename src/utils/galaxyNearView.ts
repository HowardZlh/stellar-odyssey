/**
 * L4 星系近观 3D 粒子层（R2-8，IMPROVEMENT_REQUIREMENTS_2 §R2-8，用户反馈点 3 的 L4 部分）
 *
 * 纯逻辑模块（供单元测试）：为本星系群 8 个贴图平面星系（M31/M33/LMC/SMC/
 * M32/M110/人马座矮星系/M87）定义"飞往/跟随时激活"的轻量 3D 粒子近观层——
 * 旋涡星系 = 核球 + 盘 + 旋臂粒子（复用 utils/galaxy.generateGalaxyDiskParticles
 * 参数化，禁止重写生成器）；不规则星系 = 团块状粒子云；椭圆/矮椭圆星系 =
 * Sérsic 亮度分布近似的椭球粒子云。
 *
 * ── 确定性登记 ───────────────────────────────────────────────────────────
 * 种子 = 星系 id 的 FNV-1a 哈希（galaxyNearViewSeed），两次飞往形态一致；
 * 渲染循环零随机（附录 A 渲染纪律）。
 *
 * ── 粒子预算登记（附录 A）────────────────────────────────────────────────
 * 单星系 ≤ GALAXY_NEAR_VIEW_MAX_PARTICLES（8,000）；LRU 容量 1（同 P4
 * planetDetail LRU 模式，最多同时 1 个星系持有近观层）→ 近观层同时峰值
 * +8,000。与太阳活动粒子预算（15,000/20,000，utils/nearView.ts 登记）分属
 * 不同视角域（R2-4 事件域隔离：L4 下太阳活动特效不可见且跳过演算）；
 * L4 场景粒子基线为银盘 40,000 + 宇宙网点集，近观增量单独登记（单测断言）。
 *
 * ── 薄片修复方案登记（§8.1 二选一）──────────────────────────────────────
 * 取 billboard 方案：远观（非近观）贴图平面每帧面向相机，侧向飞入不再出现
 * "纸片"观感。艺术化差异登记：M31 真实倾角约 77°（观测特征）在远观
 * billboard 下不呈现——盘面三维倾斜姿态改由近观 3D 粒子层承载
 * （galaxyOrientationFromId 确定性朝向，沿用贴图平面时期的 id 哈希公式）。
 *
 * ── 科学性登记 ───────────────────────────────────────────────────────────
 * - 椭圆星系径向分布：Sérsic (1963) 亮度剖面 I(r) ∝ exp(−bₙ(r/Rₑ)^(1/n))
 *   的近似采样（对 u=(r/Rₑ)^(1/n) 作指数分布逆变换，bₙ ≈ 2n − 1/3，
 *   Ciotti & Bertin 1999 一阶近似），截断于 SERSIC_MAX_RADIUS_FACTOR·Rₑ；
 *   M87 取 n=4（de Vaucouleurs 剖面）、M32 致密椭圆 n=3、M110 矮椭圆
 *   n=1.5、人马座矮星系 n=1（受潮汐拉伸，轴比压扁登记为示意）。
 * - 旋涡星系形态参数（旋臂数/核球占比/紧密度）为按观测特征的示意近似
 *   （M31 大核球双主臂、M33 弱核球松散臂），已登记。
 * - 不规则星系团块 = 活跃恒星形成区示意（LMC/SMC 蓝白年轻星 + 电离氢粉色）。
 * 数据来源：NASA/IPAC NED 形态分类；Sérsic (1963)；Ciotti & Bertin (1999)。
 */

import type { GalaxyMorphology } from '@/types';
import { getGalaxyById } from '@/data/galaxies';
import { generateGalaxyDiskParticles } from '@/utils/galaxy';
import { createSeededRandom } from '@/utils/random';
import { galaxyPlaneSizeUnits } from '@/utils/universe';
import { viewDistanceForRadius } from '@/utils/cameraFocus';
import { NEAR_VIEW_ENTER_RATIO, NEAR_VIEW_EXIT_RATIO } from '@/utils/nearView';
import {
  claimDetailLayer,
  detailLayerHolderIds,
  detailLruUpdate,
  estimateGpuBytes,
  releaseDetailLayer,
  type DetailLayerSpec,
} from '@/utils/detailLayer';

/** 单星系近观粒子数上限（§8.1 需求硬性预算） */
export const GALAXY_NEAR_VIEW_MAX_PARTICLES = 8000;

/** 近观层 LRU 容量（同 P4 模式）：最多同时 1 个星系持有近观层 */
export const GALAXY_NEAR_VIEW_LRU_CAPACITY = 1;

/** Sérsic 采样截断半径（单位 Rₑ）：视觉截断，防个别粒子飞出场景 */
export const SERSIC_MAX_RADIUS_FACTOR = 4;

// ---------------------------------------------------------------------------
// 确定性种子与朝向
// ---------------------------------------------------------------------------

/**
 * 星系近观确定性种子（FNV-1a 哈希）：种子 = 星系 id，
 * 两次飞往形态一致（§8.1 确定性要求）。
 */
export function galaxyNearViewSeed(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i += 1) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * 由星系 id 派生确定性盘面朝向（欧拉角 XYZ，弧度）。
 *
 * 公式与贴图平面时期（Universe.tsx orientationFromId，R2-8 前）逐字一致：
 * 远观平面改 billboard 后，该朝向由近观 3D 粒子层承载（登记见文件头）。
 */
export function galaxyOrientationFromId(id: string): [number, number, number] {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) {
    h = (h * 31 + id.charCodeAt(i)) >>> 0;
  }
  return [((h % 100) / 100) * Math.PI * 0.5, ((h % 37) / 37) * Math.PI, 0];
}

// ---------------------------------------------------------------------------
// 逐星系近观配置
// ---------------------------------------------------------------------------

/** 近观层形态类别（与 GalaxyMorphology 的映射见 KIND_BY_MORPHOLOGY） */
export type GalaxyNearViewKind = 'spiral' | 'irregular' | 'elliptical';

/** 旋涡星系近观参数（generateGalaxyDiskParticles 参数化复用） */
export interface SpiralNearViewConfig {
  kind: 'spiral';
  particleCount: number;
  armCount: number;
  diskRadiusLy: number;
  thicknessLy: number;
  bulgeRadiusLy: number;
  bulgeFraction: number;
  spiralTightness: number;
  armSpreadRad: number;
}

/** 不规则星系近观参数（团块状粒子云） */
export interface IrregularNearViewConfig {
  kind: 'irregular';
  particleCount: number;
  /** 云体半径（光年） */
  radiusLy: number;
  /** 恒星形成团块数 */
  clumpCount: number;
  /** 团块高斯散布半径 = radiusLy × 该系数 */
  clumpRadiusFraction: number;
  /** 弥散背景粒子占比（其余归属团块） */
  diffuseFraction: number;
  /** y 方向压扁系数 ∈ (0,1]（不规则星系仍略呈扁平） */
  flattenY: number;
}

/** 椭圆/矮椭圆星系近观参数（Sérsic 亮度分布椭球云） */
export interface EllipticalNearViewConfig {
  kind: 'elliptical';
  particleCount: number;
  /** 有效半径 Rₑ（光年，Sérsic 半光半径） */
  effectiveRadiusLy: number;
  /** Sérsic 指数 n（椭圆星系 1–4） */
  sersicIndex: number;
  /** y 轴（短轴）轴比 ∈ (0,1] */
  axisRatioY: number;
  /** z 轴轴比 ∈ (0,1] */
  axisRatioZ: number;
}

export type GalaxyNearViewConfig =
  | SpiralNearViewConfig
  | IrregularNearViewConfig
  | EllipticalNearViewConfig;

/** 数据层形态 → 近观层形态类别（银河系 barred-spiral 不在贴图平面近观体系内） */
export const KIND_BY_MORPHOLOGY: Readonly<
  Record<Exclude<GalaxyMorphology, 'barred-spiral'>, GalaxyNearViewKind>
> = {
  spiral: 'spiral',
  irregular: 'irregular',
  elliptical: 'elliptical',
};

/**
 * 逐星系近观配置（§8.1；形态参数为按观测特征的示意近似，登记见文件头）。
 *
 * 实现差异登记：
 * - milky-way 不在本表：银河系本身即 4 万粒 3D 粒子盘（Galaxy.tsx），
 *   近观 = 既有渲染（与 R2-7 序列成员 sun 同理），不重复建设；
 * - quasar-3c273（L4 序列第 8 站）非星系贴图平面：近观细节为既有
 *   类星体核心光变 + 双向喷流 shader（ExtragalacticObjects.tsx），不建粒子层。
 */
export const GALAXY_NEAR_VIEW_CONFIGS: Readonly<Record<string, GalaxyNearViewConfig>> = {
  // 旋涡：M31 大核球 + 双主旋臂（示意近似）
  m31: {
    kind: 'spiral',
    particleCount: 8000,
    armCount: 2,
    diskRadiusLy: 76000,
    thicknessLy: 3000,
    bulgeRadiusLy: 15000,
    bulgeFraction: 0.3,
    spiralTightness: 2.0,
    armSpreadRad: 0.22,
  },
  // 旋涡：M33 弱核球 + 松散旋臂（絮结旋涡示意）
  m33: {
    kind: 'spiral',
    particleCount: 6000,
    armCount: 2,
    diskRadiusLy: 30000,
    thicknessLy: 1600,
    bulgeRadiusLy: 3200,
    bulgeFraction: 0.08,
    spiralTightness: 1.4,
    armSpreadRad: 0.38,
  },
  // 不规则：LMC 团块状恒星形成区（蜘蛛星云等示意）
  lmc: {
    kind: 'irregular',
    particleCount: 5000,
    radiusLy: 16000,
    clumpCount: 7,
    clumpRadiusFraction: 0.3,
    diffuseFraction: 0.45,
    flattenY: 0.5,
  },
  // 不规则：SMC 更小的团块云
  smc: {
    kind: 'irregular',
    particleCount: 4000,
    radiusLy: 9000,
    clumpCount: 5,
    clumpRadiusFraction: 0.35,
    diffuseFraction: 0.5,
    flattenY: 0.6,
  },
  // 巨椭圆：M87（de Vaucouleurs n=4）
  m87: {
    kind: 'elliptical',
    particleCount: 6000,
    effectiveRadiusLy: 12000,
    sersicIndex: 4,
    axisRatioY: 0.86,
    axisRatioZ: 0.92,
  },
  // 致密椭圆 cE：M32
  m32: {
    kind: 'elliptical',
    particleCount: 3000,
    effectiveRadiusLy: 800,
    sersicIndex: 3,
    axisRatioY: 0.85,
    axisRatioZ: 0.9,
  },
  // 矮椭圆 dE：M110（较扁）
  m110: {
    kind: 'elliptical',
    particleCount: 3500,
    effectiveRadiusLy: 2600,
    sersicIndex: 1.5,
    axisRatioY: 0.55,
    axisRatioZ: 0.85,
  },
  // 矮椭球 dSph：人马座矮星系（潮汐拉伸压扁，示意登记）
  'sagittarius-dwarf': {
    kind: 'elliptical',
    particleCount: 3000,
    effectiveRadiusLy: 2500,
    sersicIndex: 1,
    axisRatioY: 0.5,
    axisRatioZ: 0.65,
  },
};

// ---------------------------------------------------------------------------
// 粒子生成（确定性，输出光年坐标）
// ---------------------------------------------------------------------------

/** 星系近观粒子集（位置单位：光年，盘面为 x-z 平面、y 垂直盘面） */
export interface GalaxyNearViewParticles {
  count: number;
  /** 位置（count×3，光年） */
  positionsLy: Float32Array;
  /** RGB 颜色（count×3，0-1） */
  colors: Float32Array;
  /** 粒子大小（1.0–2.5，中心大边缘小） */
  sizes: Float32Array;
}

/** 年轻恒星蓝白色板（不规则星系团块，恒星光谱型近似色） */
const YOUNG_STAR_PALETTE = ['#9bb0ff', '#aabfff', '#cad7ff', '#f8f7ff'] as const;

/** 电离氢区粉色（不规则星系恒星形成团块掺入） */
const HII_PINK = '#ff9bb5';

/** 老年恒星暖色板（椭圆星系，红黄为主） */
const OLD_STAR_PALETTE = ['#ffd9a0', '#ffe4bb', '#ffd2a1', '#f6e8d4'] as const;

/** #RRGGBB → RGB（0-1，本文件内置色板常量专用，不做格式校验） */
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const v = hex.replace('#', '');
  return {
    r: parseInt(v.slice(0, 2), 16) / 255,
    g: parseInt(v.slice(2, 4), 16) / 255,
    b: parseInt(v.slice(4, 6), 16) / 255,
  };
}

/** 标准正态分布随机数（Box-Muller，与 utils/galaxy 同式） */
function gaussian(rand: () => number): number {
  const u = 1 - rand();
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(Math.PI * 2 * v);
}

/**
 * Sérsic 径向采样因子（单位 Rₑ）：对 u=(r/Rₑ)^(1/n) 作指数分布逆变换
 * （近似采样登记见文件头），r/Rₑ = (−ln(1−t)/bₙ)^n，bₙ ≈ 2n − 1/3，
 * 截断于 SERSIC_MAX_RADIUS_FACTOR。t ∈ [0,1) 单调递增 → 半径单调递增。
 */
export function sersicRadiusFactor(t: number, sersicIndex: number): number {
  if (!Number.isFinite(t) || t < 0 || t >= 1) {
    throw new RangeError(`采样分位数必须在 [0,1) 内，收到 ${t}`);
  }
  if (!Number.isFinite(sersicIndex) || sersicIndex < 0.5 || sersicIndex > 10) {
    throw new RangeError(`Sérsic 指数必须在 [0.5,10] 内，收到 ${sersicIndex}`);
  }
  const bn = 2 * sersicIndex - 1 / 3;
  const factor = Math.pow(-Math.log(1 - t) / bn, sersicIndex);
  return Math.min(SERSIC_MAX_RADIUS_FACTOR, factor);
}

/** 旋涡星系：复用 utils/galaxy 生成器（核球+盘+旋臂），转为 xyz 光年坐标 */
function generateSpiralParticles(
  cfg: SpiralNearViewConfig,
  seed: number,
): GalaxyNearViewParticles {
  const disk = generateGalaxyDiskParticles({
    count: cfg.particleCount,
    seed,
    armCount: cfg.armCount,
    diskRadiusLy: cfg.diskRadiusLy,
    thicknessLy: cfg.thicknessLy,
    bulgeRadiusLy: cfg.bulgeRadiusLy,
    bulgeFraction: cfg.bulgeFraction,
    spiralTightness: cfg.spiralTightness,
    armSpreadRad: cfg.armSpreadRad,
  });
  const positionsLy = new Float32Array(disk.count * 3);
  for (let i = 0; i < disk.count; i += 1) {
    const r = disk.radiiLy[i];
    const phase = disk.phases[i];
    positionsLy[i * 3] = r * Math.cos(phase);
    positionsLy[i * 3 + 1] = disk.heightsLy[i];
    positionsLy[i * 3 + 2] = -r * Math.sin(phase);
  }
  return { count: disk.count, positionsLy, colors: disk.colors, sizes: disk.sizes };
}

/** 不规则星系：团块状粒子云（团块 = 恒星形成区示意 + 弥散背景） */
function generateIrregularParticles(
  cfg: IrregularNearViewConfig,
  seed: number,
): GalaxyNearViewParticles {
  const rand = createSeededRandom(seed);
  const n = cfg.particleCount;
  const positionsLy = new Float32Array(n * 3);
  const colors = new Float32Array(n * 3);
  const sizes = new Float32Array(n);
  const palette = YOUNG_STAR_PALETTE.map(hexToRgb);
  const pink = hexToRgb(HII_PINK);

  // 团块中心：半径 0.75R 内确定性散布（先于粒子采样，顺序固定）
  const clumpCenters: { x: number; y: number; z: number; sigmaLy: number }[] = [];
  for (let c = 0; c < cfg.clumpCount; c += 1) {
    const r = cfg.radiusLy * 0.75 * Math.pow(rand(), 0.6);
    const cosPolar = rand() * 2 - 1;
    const azimuth = Math.PI * 2 * rand();
    const sinPolar = Math.sqrt(1 - cosPolar * cosPolar);
    clumpCenters.push({
      x: r * sinPolar * Math.cos(azimuth),
      y: r * cosPolar * cfg.flattenY,
      z: r * sinPolar * Math.sin(azimuth),
      sigmaLy: cfg.radiusLy * cfg.clumpRadiusFraction * (0.5 + 0.5 * rand()),
    });
  }

  for (let i = 0; i < n; i += 1) {
    const diffuse = rand() < cfg.diffuseFraction;
    if (diffuse) {
      // 弥散背景：偏内分布（r = R·rand^0.7），y 压扁
      const r = cfg.radiusLy * Math.pow(rand(), 0.7);
      const cosPolar = rand() * 2 - 1;
      const azimuth = Math.PI * 2 * rand();
      const sinPolar = Math.sqrt(1 - cosPolar * cosPolar);
      positionsLy[i * 3] = r * sinPolar * Math.cos(azimuth);
      positionsLy[i * 3 + 1] = r * cosPolar * cfg.flattenY;
      positionsLy[i * 3 + 2] = r * sinPolar * Math.sin(azimuth);
      const color = palette[Math.floor(rand() * palette.length)];
      const brightness = 0.7 + 0.3 * rand();
      colors[i * 3] = color.r * brightness;
      colors[i * 3 + 1] = color.g * brightness;
      colors[i * 3 + 2] = color.b * brightness;
      sizes[i] = 1.0 + 0.8 * rand();
    } else {
      // 团块粒子：围绕团块中心高斯散布（截断 3σ 防离群）
      const clump = clumpCenters[Math.floor(rand() * clumpCenters.length)];
      const clampG = (): number => Math.max(-3, Math.min(3, gaussian(rand)));
      positionsLy[i * 3] = clump.x + clampG() * clump.sigmaLy;
      positionsLy[i * 3 + 1] = clump.y + clampG() * clump.sigmaLy * cfg.flattenY;
      positionsLy[i * 3 + 2] = clump.z + clampG() * clump.sigmaLy;
      // 团块 = 活跃恒星形成区：蓝白年轻星 + ~12% 电离氢粉
      const color = rand() < 0.12 ? pink : palette[Math.floor(rand() * palette.length)];
      const brightness = 0.8 + 0.2 * rand();
      colors[i * 3] = color.r * brightness;
      colors[i * 3 + 1] = color.g * brightness;
      colors[i * 3 + 2] = color.b * brightness;
      sizes[i] = 1.4 + 1.1 * rand();
    }
  }
  return { count: n, positionsLy, colors, sizes };
}

/** 椭圆/矮椭圆星系：Sérsic 亮度分布近似的椭球粒子云（老年恒星色调） */
function generateEllipticalParticles(
  cfg: EllipticalNearViewConfig,
  seed: number,
): GalaxyNearViewParticles {
  const rand = createSeededRandom(seed);
  const n = cfg.particleCount;
  const positionsLy = new Float32Array(n * 3);
  const colors = new Float32Array(n * 3);
  const sizes = new Float32Array(n);
  const palette = OLD_STAR_PALETTE.map(hexToRgb);
  const maxRadiusLy = cfg.effectiveRadiusLy * SERSIC_MAX_RADIUS_FACTOR;

  for (let i = 0; i < n; i += 1) {
    const r = cfg.effectiveRadiusLy * sersicRadiusFactor(rand(), cfg.sersicIndex);
    const cosPolar = rand() * 2 - 1;
    const azimuth = Math.PI * 2 * rand();
    const sinPolar = Math.sqrt(1 - cosPolar * cosPolar);
    positionsLy[i * 3] = r * sinPolar * Math.cos(azimuth);
    positionsLy[i * 3 + 1] = r * cosPolar * cfg.axisRatioY;
    positionsLy[i * 3 + 2] = r * sinPolar * Math.sin(azimuth) * cfg.axisRatioZ;
    // 老年恒星暖色 + 中心更亮（亮度随半径衰减）
    const color = palette[Math.floor(rand() * palette.length)];
    const brightness = (0.65 + 0.35 * rand()) * (1 - 0.4 * (r / maxRadiusLy));
    colors[i * 3] = color.r * brightness;
    colors[i * 3 + 1] = color.g * brightness;
    colors[i * 3 + 2] = color.b * brightness;
    // 中心 2.4 → 外缘 1.0（近似替代亮度剖面的粒径梯度）
    sizes[i] = 2.4 - 1.4 * Math.min(1, r / maxRadiusLy);
  }
  return { count: n, positionsLy, colors, sizes };
}

/**
 * 生成指定星系的近观 3D 粒子层（§8.1 入口）：
 * 形态按 GALAXY_NEAR_VIEW_CONFIGS，种子 = galaxyNearViewSeed(galaxyId)
 * （确定性：两次飞往形态一致）。无配置的 id 抛 RangeError。
 */
export function generateGalaxyNearViewParticles(galaxyId: string): GalaxyNearViewParticles {
  const cfg = GALAXY_NEAR_VIEW_CONFIGS[galaxyId];
  if (!cfg) {
    throw new RangeError(`未定义近观粒子层配置的星系 id：${galaxyId}`);
  }
  const seed = galaxyNearViewSeed(galaxyId);
  if (cfg.kind === 'spiral') return generateSpiralParticles(cfg, seed);
  if (cfg.kind === 'irregular') return generateIrregularParticles(cfg, seed);
  return generateEllipticalParticles(cfg, seed);
}

/**
 * 近观粒子层生成尺度参考半径（光年）：粒子坐标（光年）→ 场景单位的
 * 换算基准，与贴图平面半径（galaxyPlaneSizeUnits/2）对齐——
 * 旋涡取盘半径、不规则取云体半径、椭圆取 Sérsic 截断半径。
 */
export function nearViewReferenceRadiusLy(galaxyId: string): number {
  const cfg = GALAXY_NEAR_VIEW_CONFIGS[galaxyId];
  if (!cfg) {
    throw new RangeError(`未定义近观粒子层配置的星系 id：${galaxyId}`);
  }
  if (cfg.kind === 'spiral') return cfg.diskRadiusLy;
  if (cfg.kind === 'irregular') return cfg.radiusLy;
  return cfg.effectiveRadiusLy * SERSIC_MAX_RADIUS_FACTOR;
}

// ---------------------------------------------------------------------------
// 近观激活距离（与 resolveFocusTarget 同源）与 LRU 门控
// ---------------------------------------------------------------------------

/**
 * 星系近观激活（进入）距离（场景单位）：
 * 飞往观察距离（viewDistanceForRadius(贴图平面半边长)，与
 * cameraFocus.resolveFocusTarget 星系分支同源公式）× NEAR_VIEW_ENTER_RATIO
 * （1.5，与 R2-7 L3 近观同系数；飞抵后必然处于阈值内）。
 * 退出滞回沿用 utils/nearView.nearViewGateUpdate（×1.4）。
 */
export function galaxyNearViewEnterDistanceUnits(galaxyId: string): number {
  if (!GALAXY_NEAR_VIEW_CONFIGS[galaxyId]) {
    throw new RangeError(`未定义近观激活距离的星系 id：${galaxyId}`);
  }
  const galaxy = getGalaxyById(galaxyId);
  if (!galaxy) {
    throw new RangeError(`未知星系 id：${galaxyId}`);
  }
  return (
    viewDistanceForRadius(galaxyPlaneSizeUnits(galaxy.diameterLy) / 2) * NEAR_VIEW_ENTER_RATIO
  );
}

/** LRU 更新结果 */
export interface NearViewLruResult {
  /** 更新后的持有者列表（最新在前） */
  holders: readonly string[];
  /** 因超出容量被挤出、应立即释放近观层资源的星系 id */
  releasedIds: readonly string[];
}

/**
 * 近观层 LRU 更新（纯函数，容量 GALAXY_NEAR_VIEW_LRU_CAPACITY=1）：
 * R4-2 起委托统一机制 detailLayer.detailLruUpdate（语义逐项一致）：
 * activeId 为 null 时保持现状（离开跟随后近观层淡出但保留在 LRU 内，
 * 便于快速切回）；非 null 时提升为最新持有者，超容量的旧持有者进入
 * releasedIds（组件侧卸载 dispose）。
 */
export function nearViewLruUpdate(
  holders: readonly string[],
  activeId: string | null,
  capacity: number = GALAXY_NEAR_VIEW_LRU_CAPACITY,
): NearViewLruResult {
  return detailLruUpdate(holders, activeId, capacity);
}

/**
 * 星系近观粒子层的统一细节层规格（R4-2：kind='particles' 池，
 * 阈值与 GPU 估算逐星系登记；供 claim 与组件侧 useDetailLayer 消费）。
 */
export function galaxyDetailLayerSpec(galaxyId: string): DetailLayerSpec {
  const cfg = GALAXY_NEAR_VIEW_CONFIGS[galaxyId];
  if (!cfg) {
    throw new RangeError(`未定义近观粒子层配置的星系 id：${galaxyId}`);
  }
  const enterDistanceUnits = galaxyNearViewEnterDistanceUnits(galaxyId);
  return {
    bodyId: galaxyId,
    kind: 'particles',
    enterDistanceUnits,
    exitDistanceUnits: enterDistanceUnits * NEAR_VIEW_EXIT_RATIO,
    budget: {
      particles: cfg.particleCount,
      gpuBytesEstimate: estimateGpuBytes({ particles: cfg.particleCount }),
    },
  };
}

// ---------------------------------------------------------------------------
// 持有者注册表（R4-2 起委托 detailLayer 统一注册表 'particles' 池，
// 兼容包装保持调用方/单测 API 不变；行为零回退）
// ---------------------------------------------------------------------------

/**
 * 声明某星系为当前近观层持有者（激活门控命中时调用）。
 * @returns 被挤出、应立即释放的星系 id 列表
 */
export function claimGalaxyNearView(galaxyId: string): readonly string[] {
  return claimDetailLayer(galaxyDetailLayerSpec(galaxyId))
    .filter((h) => h.kind === 'particles')
    .map((h) => h.bodyId);
}

/** 当前近观层持有者列表（最新在前） */
export function galaxyNearViewHolderIds(): readonly string[] {
  return detailLayerHolderIds('particles');
}

/** 重置持有者注册表（测试/场景卸载用；仅清空 particles 池） */
export function resetGalaxyNearViewHolders(): void {
  for (const id of detailLayerHolderIds('particles')) {
    releaseDetailLayer(id, 'particles');
  }
}

// ---------------------------------------------------------------------------
// 信息面板结构说明（§8.1 近观联动）
// ---------------------------------------------------------------------------

/**
 * 星系结构说明（信息面板"结构"行，§8.1：核球/盘/晕说明）。
 * 数据来源见 GALAXY_STRUCTURE_SOURCE_ZH（catalog 拼接到 dataSource）。
 */
export const GALAXY_STRUCTURE_NOTE_BY_MORPHOLOGY_ZH: Readonly<
  Record<GalaxyMorphology, string>
> = {
  spiral: '核球（老年恒星聚集）+ 恒星盘与旋臂（年轻恒星/电离氢区）+ 稀疏恒星晕包裹',
  'barred-spiral': '核球与中心棒 + 恒星盘与旋臂（自棒两端延伸）+ 稀疏恒星晕包裹',
  elliptical: '无盘/旋臂结构：恒星呈椭球状聚集，亮度自中心按 Sérsic 分布向外衰减，外围为延展恒星晕',
  irregular: '无对称核球与盘结构：恒星与气体呈团块状分布（活跃恒星形成区），受邻近星系潮汐扰动塑形',
};

/** 结构说明数据来源（catalog 拼接展示） */
export const GALAXY_STRUCTURE_SOURCE_ZH =
  '结构分类：Hubble 形态序列（NED）；近观粒子层为按形态类型的示意重构（椭圆星系按 Sérsic 1963 亮度分布近似），已登记';
