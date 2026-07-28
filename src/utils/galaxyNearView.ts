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
 * 单星系 ≤ GALAXY_NEAR_VIEW_MAX_PARTICLES（12,000，R4-9 自 8,000 上调登记：
 * 新增尘埃带/HII 区/年轻星团分量，基础层配置仍 ≤8,000；附录 A 单目标
 * ≤12,000 上限内）；LRU 容量 1（同 P4 planetDetail LRU 模式，最多同时
 * 1 个星系持有近观层）→ 近观层同时峰值增量 +12,000（较 R2-8 +4,000）。
 * 与太阳活动粒子预算（15,000/20,000，utils/nearView.ts 登记）分属
 * 不同视角域（R2-4 事件域隔离：L4 下太阳活动特效不可见且跳过演算）；
 * L4 场景粒子基线为银盘 40,000 + 宇宙网点集，近观增量单独登记（单测断言）。
 * 注：R4-10 起 GalaxyNearView.tsx 消费 generateGalaxyNearViewComposite
 * （基础层 + dust/HII/年轻星团全分量）；galaxyDetailLayerSpec 的 GPU
 * 估算同步按分量配额合计计（R4-9 登记项兑现）。
 *
 * ── 薄片修复方案登记（§8.1 二选一）──────────────────────────────────────
 * 取 billboard 方案：远观（非近观）贴图平面每帧面向相机，侧向飞入不再出现
 * "纸片"观感。艺术化差异登记：M31 真实倾角约 77°（观测特征）在远观
 * billboard 下不呈现——盘面三维倾斜姿态改由近观 3D 粒子层承载。
 * R4-10 起近观朝向统一入口 galaxyNearViewOrientation：M31 = 真实倾角
 * 77° + PA 38° 登记值（inclinedOrientationRad，视线 = 原点→M31），其余
 * 星系沿用贴图平面时期 id 哈希公式（galaxyOrientationFromId）。billboard
 * ↔ 粒子层交叉过渡观感登记：billboard 恒面向相机，M31 新姿态差异在
 * 0.5s 淡入过程中呈现（位置零跳变，姿态差属预期观感）。
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

/**
 * 单星系近观粒子总量上限（基础层 + R4-9 新分量合计；§R4-9 自 8,000 上调
 * 登记，附录 A 单目标 ≤12,000 硬性约束内）。
 */
export const GALAXY_NEAR_VIEW_MAX_PARTICLES = 12000;

/** 基础层（核球+盘+旋臂/团块/Sérsic 椭球）单星系粒子上限（R2-8 原预算不变） */
export const GALAXY_NEAR_VIEW_BASE_MAX_PARTICLES = 8000;

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

// ── R4-10：M31 专属姿态（真实倾角 77°，其余星系沿用 id 哈希，差异登记） ──

/** M31 盘面倾角（度，NED/Walterbos & Kennicutt 1988；0=正向 90=侧向） */
export const M31_INCLINATION_DEG = 77;

/** M31 长轴方位角（度，de Vaucouleurs 1958 PA≈38°，姿态登记值） */
export const M31_POSITION_ANGLE_DEG = 38;

/** 三维向量（本文件内纯数学，不引入 three） */
interface Vec3 {
  x: number;
  y: number;
  z: number;
}

function v3normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v.x, v.y, v.z);
  if (!(len > 0) || !Number.isFinite(len)) {
    throw new RangeError('方向向量长度必须为正有限数');
  }
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

function v3cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

/** 罗德里格斯公式：向量 v 绕单位轴 axis 旋转 angleRad */
function v3rotateAboutAxis(v: Vec3, axis: Vec3, angleRad: number): Vec3 {
  const c = Math.cos(angleRad);
  const s = Math.sin(angleRad);
  const dot = axis.x * v.x + axis.y * v.y + axis.z * v.z;
  const cr = v3cross(axis, v);
  return {
    x: v.x * c + cr.x * s + axis.x * dot * (1 - c),
    y: v.y * c + cr.y * s + axis.y * dot * (1 - c),
    z: v.z * c + cr.z * s + axis.z * dot * (1 - c),
  };
}

/**
 * 由视线方向 + 倾角/方位角构造盘面姿态（欧拉角 XYZ，与 three.js
 * 'XYZ' 约定一致：R = Rx·Ry·Rz）。
 *
 * 几何定义（§R4-10 姿态登记）：粒子层局部盘面为 x-z 平面（法线 +y）。
 * 倾角 i = 盘面法线与视线（观察者→星系方向 losDir，银河系原点视角）
 * 的夹角——i=0 正向（face-on）、i=90 侧向（edge-on）；方位角 PA 决定
 * 长轴在垂直视线的"天空平面"内的转角。构造：先将局部 +y 对齐视线
 * （正向姿态），再绕天空平面内按 PA 选定的轴倾转 i。
 */
export function inclinedOrientationRad(
  losDir: Vec3,
  inclinationDeg: number,
  positionAngleDeg: number,
): [number, number, number] {
  if (!Number.isFinite(inclinationDeg) || inclinationDeg < 0 || inclinationDeg > 90) {
    throw new RangeError(`倾角必须在 [0,90] 度内，收到 ${inclinationDeg}`);
  }
  if (!Number.isFinite(positionAngleDeg)) {
    throw new RangeError(`方位角必须为有限数，收到 ${positionAngleDeg}`);
  }
  const d = v3normalize(losDir);
  // 天空平面正交基（视线近平行世界 +y 时改用 +x 破奇异）
  const up: Vec3 = Math.abs(d.y) > 0.94 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
  const t1 = v3normalize(v3cross(up, d));
  const t2 = v3cross(d, t1);
  // 倾转轴 = t1 在天空平面内旋转 PA
  const paRad = (positionAngleDeg * Math.PI) / 180;
  const cosPa = Math.cos(paRad);
  const sinPa = Math.sin(paRad);
  const tiltAxis: Vec3 = {
    x: t1.x * cosPa + t2.x * sinPa,
    y: t1.y * cosPa + t2.y * sinPa,
    z: t1.z * cosPa + t2.z * sinPa,
  };
  const inclRad = (inclinationDeg * Math.PI) / 180;
  // 正向姿态旋转矩阵 F（列 = 局部 x/y/z 基的世界像；局部 +y → 视线 d，
  // 右手系：col_x × col_y = col_z）
  const fx = t1;
  const fy = d;
  const fz = v3cross(t1, d);
  // R = Rot(tiltAxis, i) · F：三列分别倾转
  const rx = v3rotateAboutAxis(fx, tiltAxis, inclRad);
  const ry = v3rotateAboutAxis(fy, tiltAxis, inclRad);
  const rz = v3rotateAboutAxis(fz, tiltAxis, inclRad);
  // 欧拉角提取（three.js 'XYZ'：R = Rx(x)·Ry(y)·Rz(z)，m13=sin y）
  const m11 = rx.x;
  const m12 = ry.x;
  const m13 = rz.x;
  const m23 = rz.y;
  const m33 = rz.z;
  const y = Math.asin(Math.max(-1, Math.min(1, m13)));
  let x: number;
  let z: number;
  if (Math.abs(m13) < 0.9999999) {
    x = Math.atan2(-m23, m33);
    z = Math.atan2(-m12, m11);
  } else {
    // 万向锁退化（i/PA 组合下不可达，防御分支）
    x = Math.atan2(ry.z, ry.y);
    z = 0;
  }
  return [x, y, z];
}

/**
 * M31 近观粒子层专属姿态（§R4-10 差异登记：由 id 哈希改为真实倾角
 * 77° + PA 38° 登记值构造，视线 = 银河系原点→M31 方向）。
 */
export function m31NearViewOrientationRad(): [number, number, number] {
  const m31 = getGalaxyById('m31');
  if (!m31) {
    throw new RangeError('星系数据缺少 m31');
  }
  return inclinedOrientationRad(m31.direction, M31_INCLINATION_DEG, M31_POSITION_ANGLE_DEG);
}

/**
 * 星系近观粒子层朝向统一入口（R4-10）：M31 = 专属倾角姿态，
 * 其余星系沿用贴图平面时期 id 哈希公式（galaxyOrientationFromId）。
 */
export function galaxyNearViewOrientation(id: string): [number, number, number] {
  return id === 'm31' ? m31NearViewOrientationRad() : galaxyOrientationFromId(id);
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
// R4-9 星系近观多分量 ①：形态参数表 + 分量配额 + 新分量生成器（纯逻辑）
//
// 本阶段渲染零改动：GalaxyNearView.tsx 不消费以下任何导出，渲染接入在
// R4-10。全部生成器为确定性纯函数（FNV-1a 派生种子），供单测断言
// 分布范围/配额/泊松最小间距/颜色梯度单调性。
//
// ── 科学性登记（§0.4 数据源表）──────────────────────────────────────────
// 形态参数 {倾角/臂数/螺距角/B/D 比} 取自 RC3（de Vaucouleurs et al. 1991
// 第三参考星表）、S4G（Sheth et al. 2010 Spitzer 巡天形态测量）与
// NASA/IPAC NED 登记值的近似档（逐星系注释）；尘埃带强度/HII 区密度为
// 按观测特征归一化的示意参数（0-1，非物理量纲，登记）。椭圆/矮椭圆
// （M32/M110/人马座矮/M87）无盘尘埃带与 HII 区 → dust/HII 登记为 0
// （M110 已知少量尘埃云，矮椭圆按 §R4-9 需求统一登记为 0，差异登记）。
// 螺距角为登记值：基础层旋臂几何仍由 SpiralNearViewConfig.spiralTightness
// 的对数螺旋（相位 = tightness·ln(1+r/r_bulge)）承载，新分量沿同一公式
// 对齐旋臂（保证 dust/HII/星团与基础层旋臂重合），螺距角供 R4-10 渲染
// 与信息面板登记（差异登记）。
// ---------------------------------------------------------------------------

/** 星系形态参数（RC3/S4G/NED 登记，§R4-9 参数表扩展） */
export interface GalaxyMorphologyParams {
  /** 盘面倾角（度；椭圆类不适用登记 0；银河系观察者位于盘内登记 0） */
  inclinationDeg: number;
  /** 主旋臂数（非旋涡为 0；LMC 麦哲伦单臂登记 1） */
  armCount: number;
  /** 旋臂螺距角（度；非旋涡为 0，登记值不驱动几何，见节头登记） */
  pitchAngleDeg: number;
  /** 核球/盘光度比 B/D（椭圆无盘 → Infinity 登记） */
  bulgeToDiskRatio: number;
  /** 尘埃带强度（0-1 示意归一化；椭圆类为 0） */
  dustStrength: number;
  /** HII 区密度（0-1 示意归一化；椭圆类为 0） */
  hiiDensity: number;
  /** 参数来源登记（附录 A §4） */
  source: string;
}

/**
 * 9 星系形态参数表（§R4-9：M31/M33/LMC/SMC/M32/M110/人马座矮/M87 +
 * 银河系）。银河系近观 = 既有 4 万粒 3D 粒子盘渲染（Galaxy.tsx），
 * 不入 GALAXY_NEAR_VIEW_CONFIGS，参数仅登记复用（复用登记，单测断言）。
 */
export const GALAXY_MORPHOLOGY_PARAMS: Readonly<Record<string, GalaxyMorphologyParams>> = {
  // SA(s)b：高倾角尘埃带显著；倾角 77°（Walterbos & Kennicutt 1988/NED）
  m31: {
    inclinationDeg: 77,
    armCount: 2,
    pitchAngleDeg: 8,
    bulgeToDiskRatio: 0.57,
    dustStrength: 0.8,
    hiiDensity: 0.5,
    source: 'RC3 SA(s)b；倾角 77°（NED）；B/D≈0.57（S4G 分解近似档）',
  },
  // SA(s)cd：弱核球絮结旋涡，HII 区极丰富（NGC 604 等）
  m33: {
    inclinationDeg: 56,
    armCount: 2,
    pitchAngleDeg: 24,
    bulgeToDiskRatio: 0.04,
    dustStrength: 0.35,
    hiiDensity: 0.9,
    source: 'RC3 SA(s)cd；倾角 56°（NED）；螺距角取文献区间中值近似档（登记）',
  },
  // SB(s)m：麦哲伦型单臂 + 棒，30 Doradus 等活跃 HII 区
  lmc: {
    inclinationDeg: 35,
    armCount: 1,
    pitchAngleDeg: 0,
    bulgeToDiskRatio: 0.05,
    dustStrength: 0.3,
    hiiDensity: 0.85,
    source: 'RC3 SB(s)m；倾角 35°（NED）；单臂不参数化对数螺旋（螺距角登记 0）',
  },
  // SB(s)m pec：无规则臂结构
  smc: {
    inclinationDeg: 62,
    armCount: 0,
    pitchAngleDeg: 0,
    bulgeToDiskRatio: 0.02,
    dustStrength: 0.25,
    hiiDensity: 0.6,
    source: 'RC3 SB(s)m pec；倾角为视向深度拉伸近似档（NED，登记）',
  },
  // cE2 致密椭圆：无盘/尘埃/HII
  m32: {
    inclinationDeg: 0,
    armCount: 0,
    pitchAngleDeg: 0,
    bulgeToDiskRatio: Number.POSITIVE_INFINITY,
    dustStrength: 0,
    hiiDensity: 0,
    source: 'RC3 cE2；椭圆无盘 → B/D 登记 Infinity、dust/HII 为 0',
  },
  // dE5 pec 矮椭圆（已知少量尘埃云，按 §R4-9 统一登记 0，差异登记）
  m110: {
    inclinationDeg: 0,
    armCount: 0,
    pitchAngleDeg: 0,
    bulgeToDiskRatio: Number.POSITIVE_INFINITY,
    dustStrength: 0,
    hiiDensity: 0,
    source: 'RC3 dE5 pec；矮椭圆 dust/HII 登记 0（少量尘埃云差异登记）',
  },
  // dSph 矮椭球（潮汐拉伸）
  'sagittarius-dwarf': {
    inclinationDeg: 0,
    armCount: 0,
    pitchAngleDeg: 0,
    bulgeToDiskRatio: Number.POSITIVE_INFINITY,
    dustStrength: 0,
    hiiDensity: 0,
    source: 'NED dSph；矮椭球无盘结构，dust/HII 为 0',
  },
  // E0-1 pec（cD）巨椭圆：无盘尘埃带/HII
  m87: {
    inclinationDeg: 0,
    armCount: 0,
    pitchAngleDeg: 0,
    bulgeToDiskRatio: Number.POSITIVE_INFINITY,
    dustStrength: 0,
    hiiDensity: 0,
    source: 'RC3 E0-1 pec；巨椭圆无盘 → B/D 登记 Infinity、dust/HII 为 0',
  },
  // SBbc 银河系：近观 = 既有 Galaxy.tsx 4 万粒渲染（复用登记，不建近观层）
  'milky-way': {
    inclinationDeg: 0,
    armCount: 4,
    pitchAngleDeg: 12.5,
    bulgeToDiskRatio: 0.3,
    dustStrength: 0.7,
    hiiDensity: 0.7,
    source: 'Gaia DR3/NED SBbc；观察者位于盘内倾角不适用登记 0；近观复用既有渲染（登记）',
  },
};

// ── 分量配额（纯函数，§R4-9 预算） ─────────────────────────────────────

/** 尘埃带粒子数 = 单位尘埃强度 × 本系数（旋涡专属） */
export const DUST_PARTICLES_PER_UNIT_STRENGTH = 1600;

/** HII 区数 = 单位 HII 密度 × 本系数（大颗粒少量） */
export const HII_REGIONS_PER_UNIT_DENSITY = 140;

/** 年轻星团粒子数 = 单位 HII 密度 × 本系数（恒星形成率与 HII 同源近似登记） */
export const YOUNG_CLUSTER_PARTICLES_PER_UNIT_DENSITY = 1000;

/** 星系近观分量配额（§R4-9：纯函数计算，总量 ≤12,000 单测断言） */
export interface GalaxyComponentQuota {
  /** 基础层（R2-8 核球+盘+旋臂/团块/椭球）粒子数 */
  base: number;
  /** 尘埃带暗吸收粒子数（非旋涡为 0） */
  dust: number;
  /** HII 区发射团数（非旋涡为 0） */
  hii: number;
  /** 年轻星团粒子数（非旋涡为 0） */
  youngClusters: number;
  /** 合计（≤ GALAXY_NEAR_VIEW_MAX_PARTICLES） */
  total: number;
}

/**
 * 分量强度覆写（R4-10 预览页滑杆：dust 强度 / HII 密度实时调参；
 * 主场景不传 → 形态参数表登记值）。取值域 [0,1]（与参数表同域），
 * 越界抛 RangeError——域内任意组合下总量必 ≤12,000（单测断言峰值）。
 */
export interface GalaxyCompositeOverrides {
  dustStrength?: number;
  hiiDensity?: number;
}

/** 覆写值校验（[0,1] 域，undefined 透传登记值） */
function resolveOverride01(value: number | undefined, fallback: number, label: string): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`${label}覆写必须在 [0,1] 内，收到 ${value}`);
  }
  return value;
}

/**
 * 逐星系分量配额（纯函数）：旋涡 = 基础层 + 尘埃带/HII/年轻星团
 * （配额随形态参数表 dustStrength/hiiDensity 线性缩放）；不规则/椭圆
 * 新分量为 0——不规则星系的 HII 粉色与蓝白年轻星已由 R2-8 团块分量承载
 * （登记），椭圆类按 §R4-9 需求为 0。无配置 id（milky-way/未知）抛
 * RangeError（银河系近观复用既有渲染，登记见参数表）。
 * R4-10：可选 overrides 覆写 dust 强度/HII 密度（预览页滑杆消费）。
 */
export function galaxyComponentQuota(
  galaxyId: string,
  overrides?: GalaxyCompositeOverrides,
): GalaxyComponentQuota {
  const cfg = GALAXY_NEAR_VIEW_CONFIGS[galaxyId];
  if (!cfg) {
    throw new RangeError(`未定义近观粒子层配置的星系 id：${galaxyId}`);
  }
  const morph = GALAXY_MORPHOLOGY_PARAMS[galaxyId];
  if (!morph) {
    throw new RangeError(`未定义形态参数的星系 id：${galaxyId}`);
  }
  const dustStrength = resolveOverride01(overrides?.dustStrength, morph.dustStrength, '尘埃带强度');
  const hiiDensity = resolveOverride01(overrides?.hiiDensity, morph.hiiDensity, 'HII 密度');
  const spiral = cfg.kind === 'spiral';
  const dust = spiral ? Math.round(DUST_PARTICLES_PER_UNIT_STRENGTH * dustStrength) : 0;
  const hii = spiral ? Math.round(HII_REGIONS_PER_UNIT_DENSITY * hiiDensity) : 0;
  const youngClusters = spiral
    ? Math.round(YOUNG_CLUSTER_PARTICLES_PER_UNIT_DENSITY * hiiDensity)
    : 0;
  const total = cfg.particleCount + dust + hii + youngClusters;
  if (total > GALAXY_NEAR_VIEW_MAX_PARTICLES) {
    throw new RangeError(
      `星系 ${galaxyId} 分量配额合计 ${total} 超出单星系上限 ${GALAXY_NEAR_VIEW_MAX_PARTICLES}`,
    );
  }
  return { base: cfg.particleCount, dust, hii, youngClusters, total };
}

// ── 新分量生成器（确定性纯函数，输出光年坐标，坐标约定与基础层一致） ──

/** R4-9 新分量标识（§R4-9：dust 供 R4-10 normal 混合暗色渲染识别） */
export type GalaxyNearViewComponentName = 'dust' | 'hii' | 'youngClusters';

/** 带分量标记的近观粒子集（结构与 GalaxyNearViewParticles 一致 + 标记） */
export interface GalaxyComponentParticles extends GalaxyNearViewParticles {
  component: GalaxyNearViewComponentName;
}

/** 尘埃带相位偏移 = 旋臂宽度 × 本系数（正向 = 旋臂内缘一侧，示意登记） */
export const DUST_LANE_INNER_OFFSET_FACTOR = 0.6;

/** 尘埃带相位散布 = 旋臂宽度 × 本系数（比恒星臂更窄的暗纹） */
export const DUST_LANE_SPREAD_FACTOR = 0.35;

/** 尘埃带厚度 = 盘厚 × 本系数（尘埃沉降薄层近似登记） */
export const DUST_LANE_THICKNESS_FACTOR = 0.35;

/** HII 区泊松盘最小间距 = 盘半径 × 本系数（离散发射团防重叠） */
export const HII_POISSON_MIN_SEPARATION_FACTOR = 0.055;

/** HII 泊松盘采样尝试上限 = 配额 × 本系数（确定性 dart-throwing） */
export const HII_POISSON_MAX_ATTEMPT_FACTOR = 60;

/** 年轻星团脊线相位散布 = 旋臂宽度 × 本系数（紧贴旋臂脊线的颗粒串） */
export const YOUNG_CLUSTER_RIDGE_SPREAD_FACTOR = 0.15;

/** 尘埃暗吸收色板（深棕，R4-10 以 normal 混合渲染为暗纹） */
const DUST_PALETTE = ['#2b1a10', '#33200f', '#241812'] as const;

/** HII 区发射色板（电离氢粉红） */
const HII_PALETTE = ['#ff9bb5', '#ff8fa8', '#ffa8bd'] as const;

/** 年轻星团蓝白色板（O/B 光谱型近似色，YOUNG_STAR_PALETTE 蓝端子集） */
const YOUNG_CLUSTER_PALETTE = ['#9bb0ff', '#aabfff', '#cad7ff'] as const;

/** 高斯截断（±3σ，防离群粒子飞出分布范围断言） */
function clampedGaussian(rand: () => number): number {
  return Math.max(-3, Math.min(3, gaussian(rand)));
}

// ── R4-10：M31 尘埃环（10 kpc 环状增强）与核球偏黄 ──────────────────────

/** 尘埃环规格（dust 分量的环状增强，M31 专属登记） */
export interface DustRingSpec {
  /** 环半径（光年） */
  radiusLy: number;
  /** 环径向高斯散布 σ（光年） */
  sigmaLy: number;
  /** dust 配额中划归环粒子的占比 ∈ [0,1] */
  fraction: number;
}

/**
 * M31 10 kpc 尘埃环（§R4-10：Spitzer/Herschel 观测的恒星形成环，
 * 10 kpc ≈ 32,600 光年；环宽与占比为观感示意档登记）。
 */
export const M31_DUST_RING: Readonly<DustRingSpec> = {
  radiusLy: 32600,
  sigmaLy: 2800,
  fraction: 0.45,
};

/** M31 核球偏黄色调（老年星族 K/M 巨星主导，示意登记） */
export const M31_BULGE_TINT: Readonly<RgbColor> = { r: 1.0, g: 0.82, b: 0.55 };

/** M31 核球偏黄混合权重 */
export const M31_BULGE_TINT_BLEND = 0.5;

/**
 * 对基础层粒子应用核球偏黄色调（纯函数，副本语义与
 * applyOldDiskColorGradient 一致）：三维半径 ≤ 核球半径的粒子向
 * tint 色混合 blend（核球中心权重高、边缘线性衰减到 0，过渡平滑）。
 */
export function applyBulgeTint(
  particles: GalaxyNearViewParticles,
  cfg: SpiralNearViewConfig,
  tint: RgbColor = M31_BULGE_TINT,
  blend: number = M31_BULGE_TINT_BLEND,
): GalaxyNearViewParticles {
  if (!Number.isFinite(blend) || blend < 0 || blend > 1) {
    throw new RangeError(`核球色调混合权重必须在 [0,1] 内，收到 ${blend}`);
  }
  const colors = new Float32Array(particles.colors);
  for (let i = 0; i < particles.count; i += 1) {
    const x = particles.positionsLy[i * 3];
    const y = particles.positionsLy[i * 3 + 1];
    const z = particles.positionsLy[i * 3 + 2];
    const r = Math.hypot(x, y, z);
    if (r > cfg.bulgeRadiusLy) continue;
    const w = blend * (1 - r / cfg.bulgeRadiusLy);
    colors[i * 3] += (tint.r - colors[i * 3]) * w;
    colors[i * 3 + 1] += (tint.g - colors[i * 3 + 1]) * w;
    colors[i * 3 + 2] += (tint.b - colors[i * 3 + 2]) * w;
  }
  return {
    count: particles.count,
    positionsLy: particles.positionsLy,
    colors,
    sizes: particles.sizes,
  };
}

/**
 * 旋臂脊线相位（弧度）：与基础层 generateGalaxyDiskParticles 的对数螺旋
 * 公式逐字一致（armIndex·2π/armCount + tightness·ln(1+r/r_bulge)），
 * 保证新分量与基础层旋臂对齐（单测以此复算脊线残差）。
 */
export function spiralArmRidgePhaseRad(
  cfg: SpiralNearViewConfig,
  armIndex: number,
  radiusLy: number,
): number {
  return (
    armIndex * ((Math.PI * 2) / cfg.armCount) +
    cfg.spiralTightness * Math.log(1 + radiusLy / cfg.bulgeRadiusLy)
  );
}

/** (r, φ, h) → xyz（光年，与基础层 generateSpiralParticles 同一约定） */
function writeCylindricalPosition(
  positionsLy: Float32Array,
  index: number,
  radiusLy: number,
  phaseRad: number,
  heightLy: number,
): void {
  positionsLy[index * 3] = radiusLy * Math.cos(phaseRad);
  positionsLy[index * 3 + 1] = heightLy;
  positionsLy[index * 3 + 2] = -radiusLy * Math.sin(phaseRad);
}

/**
 * 尘埃带分量（§R4-9）：沿旋臂内缘的暗吸收粒子——相位 = 脊线 +
 * 内缘偏移（DUST_LANE_INNER_OFFSET_FACTOR×臂宽）+ 窄散布；径向
 * [r_bulge, 0.95·r_disk] 中心偏密（√rand）；深棕低亮度（全通道 <0.3，
 * 单测断言），渲染混合方案归 R4-10（normal 混合暗纹）。
 *
 * R4-10 环状增强（可选 ring，M31 专属 M31_DUST_RING）：配额中
 * fraction 占比的粒子改为环粒子——方位均匀、径向绕环半径高斯散布
 * （±3σ 截断）；ring 缺省时与 R4-9 行为逐字节一致（随机数消耗不变，
 * 零回退单测锚定）。
 */
export function generateDustLaneParticles(
  cfg: SpiralNearViewConfig,
  count: number,
  seed: number,
  ring?: Readonly<DustRingSpec>,
): GalaxyComponentParticles {
  if (count < 0 || !Number.isInteger(count)) {
    throw new RangeError(`尘埃带粒子数必须为非负整数，收到 ${count}`);
  }
  if (ring && (!Number.isFinite(ring.fraction) || ring.fraction < 0 || ring.fraction > 1)) {
    throw new RangeError(`尘埃环占比必须在 [0,1] 内，收到 ${ring?.fraction}`);
  }
  const rand = createSeededRandom(seed);
  const positionsLy = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const palette = DUST_PALETTE.map(hexToRgb);
  const rMin = cfg.bulgeRadiusLy;
  const rMax = cfg.diskRadiusLy * 0.95;
  for (let i = 0; i < count; i += 1) {
    // 短路求值：ring 缺省时不额外消耗随机数（R4-9 行为零回退）
    if (ring !== undefined && rand() < ring.fraction) {
      // 环粒子：方位均匀 + 径向高斯（±3σ 截断，钳制在盘内）
      const r = Math.max(
        rMin,
        Math.min(rMax, ring.radiusLy + clampedGaussian(rand) * ring.sigmaLy),
      );
      const phase = Math.PI * 2 * rand();
      const height =
        clampedGaussian(rand) * (cfg.thicknessLy / 2) * DUST_LANE_THICKNESS_FACTOR;
      writeCylindricalPosition(positionsLy, i, r, phase, height);
    } else {
      const r = rMin + (rMax - rMin) * Math.sqrt(rand());
      const armIndex = Math.floor(rand() * cfg.armCount);
      const phase =
        spiralArmRidgePhaseRad(cfg, armIndex, r) +
        cfg.armSpreadRad * DUST_LANE_INNER_OFFSET_FACTOR +
        clampedGaussian(rand) * cfg.armSpreadRad * DUST_LANE_SPREAD_FACTOR;
      const height =
        clampedGaussian(rand) * (cfg.thicknessLy / 2) * DUST_LANE_THICKNESS_FACTOR;
      writeCylindricalPosition(positionsLy, i, r, phase, height);
    }
    const color = palette[Math.floor(rand() * palette.length)];
    const brightness = 0.6 + 0.4 * rand();
    colors[i * 3] = color.r * brightness;
    colors[i * 3 + 1] = color.g * brightness;
    colors[i * 3 + 2] = color.b * brightness;
    sizes[i] = 1.6 + 1.0 * rand();
  }
  return { component: 'dust', count, positionsLy, colors, sizes };
}

/**
 * HII 区分量（§R4-9）：沿旋臂离散分布的发射团（粉红大颗粒少量）——
 * 泊松盘采样（确定性 dart-throwing：候选点 = 臂上抖动位置，与已接受点
 * 盘面距离 < 最小间距则拒绝；尝试上限 count×HII_POISSON_MAX_ATTEMPT_FACTOR，
 * 达上限提前返回实际接受数，单测断言最小间距与配额）。
 */
export function generateHiiRegionParticles(
  cfg: SpiralNearViewConfig,
  count: number,
  seed: number,
): GalaxyComponentParticles {
  if (count < 0 || !Number.isInteger(count)) {
    throw new RangeError(`HII 区数必须为非负整数，收到 ${count}`);
  }
  const rand = createSeededRandom(seed);
  const minSeparationLy = cfg.diskRadiusLy * HII_POISSON_MIN_SEPARATION_FACTOR;
  const positionsLy = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const palette = HII_PALETTE.map(hexToRgb);
  const rMin = cfg.bulgeRadiusLy * 1.1;
  const rMax = cfg.diskRadiusLy * 0.92;
  let accepted = 0;
  const maxAttempts = count * HII_POISSON_MAX_ATTEMPT_FACTOR;
  for (let attempt = 0; attempt < maxAttempts && accepted < count; attempt += 1) {
    // 每次尝试消耗固定随机数（候选参数先行求全，拒绝亦确定性）
    const r = rMin + (rMax - rMin) * rand();
    const armIndex = Math.floor(rand() * cfg.armCount);
    const phase =
      spiralArmRidgePhaseRad(cfg, armIndex, r) +
      clampedGaussian(rand) * cfg.armSpreadRad * 0.5;
    const height = clampedGaussian(rand) * (cfg.thicknessLy / 2) * 0.3;
    const colorPick = Math.floor(rand() * palette.length);
    const brightness = 0.85 + 0.15 * rand();
    const size = 3.0 + 1.5 * rand();
    const x = r * Math.cos(phase);
    const z = -r * Math.sin(phase);
    // 泊松盘拒绝：盘面（x-z）距离 < 最小间距（3D 距离 ≥ 盘面距离，同样达标）
    let tooClose = false;
    for (let j = 0; j < accepted; j += 1) {
      const dx = x - positionsLy[j * 3];
      const dz = z - positionsLy[j * 3 + 2];
      if (dx * dx + dz * dz < minSeparationLy * minSeparationLy) {
        tooClose = true;
        break;
      }
    }
    if (tooClose) continue;
    positionsLy[accepted * 3] = x;
    positionsLy[accepted * 3 + 1] = height;
    positionsLy[accepted * 3 + 2] = z;
    const color = palette[colorPick];
    colors[accepted * 3] = color.r * brightness;
    colors[accepted * 3 + 1] = color.g * brightness;
    colors[accepted * 3 + 2] = color.b * brightness;
    sizes[accepted] = size;
    accepted += 1;
  }
  return {
    component: 'hii',
    count: accepted,
    positionsLy: positionsLy.subarray(0, accepted * 3),
    colors: colors.subarray(0, accepted * 3),
    sizes: sizes.subarray(0, accepted),
  };
}

/**
 * 年轻星团分量（§R4-9）：旋臂脊线上的蓝白小颗粒串——相位紧贴脊线
 * （散布 = 臂宽×YOUNG_CLUSTER_RIDGE_SPREAD_FACTOR，±3σ 截断 → 残差
 * ≤0.45×臂宽，单测断言）；薄层（0.25×半厚度）；蓝白小颗粒
 * （b ≥ r 通道，单测断言）。
 */
export function generateYoungClusterParticles(
  cfg: SpiralNearViewConfig,
  count: number,
  seed: number,
): GalaxyComponentParticles {
  if (count < 0 || !Number.isInteger(count)) {
    throw new RangeError(`年轻星团粒子数必须为非负整数，收到 ${count}`);
  }
  const rand = createSeededRandom(seed);
  const positionsLy = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const palette = YOUNG_CLUSTER_PALETTE.map(hexToRgb);
  const rMin = cfg.bulgeRadiusLy * 1.05;
  const rMax = cfg.diskRadiusLy * 0.9;
  for (let i = 0; i < count; i += 1) {
    const r = rMin + (rMax - rMin) * rand();
    const armIndex = Math.floor(rand() * cfg.armCount);
    const phase =
      spiralArmRidgePhaseRad(cfg, armIndex, r) +
      clampedGaussian(rand) * cfg.armSpreadRad * YOUNG_CLUSTER_RIDGE_SPREAD_FACTOR;
    const height = clampedGaussian(rand) * (cfg.thicknessLy / 2) * 0.25;
    writeCylindricalPosition(positionsLy, i, r, phase, height);
    const color = palette[Math.floor(rand() * palette.length)];
    const brightness = 0.85 + 0.15 * rand();
    colors[i * 3] = color.r * brightness;
    colors[i * 3 + 1] = color.g * brightness;
    colors[i * 3 + 2] = color.b * brightness;
    sizes[i] = 0.8 + 0.6 * rand();
  }
  return { component: 'youngClusters', count, positionsLy, colors, sizes };
}

// ── 老年盘底色半径梯度（§R4-9：内红黄外偏蓝，参数化） ──────────────────

/** RGB 颜色（0-1） */
export interface RgbColor {
  r: number;
  g: number;
  b: number;
}

/** 盘底色梯度内端（红黄，老年星族内盘色调近似登记） */
export const DISK_COLOR_GRADIENT_INNER: Readonly<RgbColor> = hexToRgb('#ffce8a');

/** 盘底色梯度外端（偏蓝，外盘年轻星族占比升高近似登记） */
export const DISK_COLOR_GRADIENT_OUTER: Readonly<RgbColor> = hexToRgb('#aabfff');

/** 老年盘底色梯度向基础层盘粒子的混合权重（R4-10 渲染观感调参基准） */
export const OLD_DISK_GRADIENT_BLEND = 0.35;

/**
 * 老年盘底色（半径梯度参数化）：r01 ∈ [0,1]（盘心→盘缘，域外钳制），
 * 内红黄 → 外偏蓝线性插值。红通道单调不增、蓝通道单调不减（单测断言）。
 * NaN 抛 RangeError。
 */
export function oldDiskColorAtRadius(r01: number): RgbColor {
  if (Number.isNaN(r01)) {
    throw new RangeError('盘半径分位必须为数值，收到 NaN');
  }
  const t = Math.max(0, Math.min(1, r01));
  return {
    r: DISK_COLOR_GRADIENT_INNER.r + (DISK_COLOR_GRADIENT_OUTER.r - DISK_COLOR_GRADIENT_INNER.r) * t,
    g: DISK_COLOR_GRADIENT_INNER.g + (DISK_COLOR_GRADIENT_OUTER.g - DISK_COLOR_GRADIENT_INNER.g) * t,
    b: DISK_COLOR_GRADIENT_INNER.b + (DISK_COLOR_GRADIENT_OUTER.b - DISK_COLOR_GRADIENT_INNER.b) * t,
  };
}

/**
 * 对旋涡基础层粒子应用老年盘底色梯度（纯函数：返回新 colors 数组的
 * 副本对象，positions/sizes 共享引用、入参不变）：仅盘面半径 >
 * 核球半径的粒子按 r01 = 盘面半径/盘半径 向梯度色混合
 * OLD_DISK_GRADIENT_BLEND；核球区粒子保持原色（核球暖黄由基础层承载）。
 */
export function applyOldDiskColorGradient(
  particles: GalaxyNearViewParticles,
  cfg: SpiralNearViewConfig,
): GalaxyNearViewParticles {
  const colors = new Float32Array(particles.colors);
  for (let i = 0; i < particles.count; i += 1) {
    const x = particles.positionsLy[i * 3];
    const z = particles.positionsLy[i * 3 + 2];
    const planarR = Math.hypot(x, z);
    if (planarR <= cfg.bulgeRadiusLy) continue;
    const grad = oldDiskColorAtRadius(planarR / cfg.diskRadiusLy);
    colors[i * 3] += (grad.r - colors[i * 3]) * OLD_DISK_GRADIENT_BLEND;
    colors[i * 3 + 1] += (grad.g - colors[i * 3 + 1]) * OLD_DISK_GRADIENT_BLEND;
    colors[i * 3 + 2] += (grad.b - colors[i * 3 + 2]) * OLD_DISK_GRADIENT_BLEND;
  }
  return {
    count: particles.count,
    positionsLy: particles.positionsLy,
    colors,
    sizes: particles.sizes,
  };
}

// ── 组合入口（§R4-9：基础层 + 新分量，总量断言） ────────────────────────

/** 星系近观多分量组合结果（R4-10 渲染消费；本阶段仅单测消费） */
export interface GalaxyNearViewComposite {
  /** 基础层（旋涡已应用老年盘底色梯度；不规则/椭圆与 R2-8 输出一致） */
  base: GalaxyNearViewParticles;
  /** 新分量（旋涡：dust/hii/youngClusters；不规则/椭圆为空数组，登记） */
  components: readonly GalaxyComponentParticles[];
  /** 全分量粒子合计（≤ GALAXY_NEAR_VIEW_MAX_PARTICLES） */
  totalCount: number;
}

/**
 * 生成星系近观多分量组合（§R4-9 组合入口，R4-10 扩展）：种子按分量派生
 * （galaxyNearViewSeed(`${id}:${component}`)，FNV-1a 沿用），两次生成
 * 逐字节一致（单测断言）。总量超上限抛 RangeError（配额纯函数已保证，
 * 防御性断言）。
 *
 * R4-10 M31 专属（§R4-10 差异登记）：dust 分量叠加 10 kpc 尘埃环增强
 * （M31_DUST_RING）；基础层核球偏黄（applyBulgeTint）。可选 overrides
 * 覆写 dust 强度/HII 密度（预览页滑杆；主场景不传，登记值驱动）。
 */
export function generateGalaxyNearViewComposite(
  galaxyId: string,
  overrides?: GalaxyCompositeOverrides,
): GalaxyNearViewComposite {
  const cfg = GALAXY_NEAR_VIEW_CONFIGS[galaxyId];
  if (!cfg) {
    throw new RangeError(`未定义近观粒子层配置的星系 id：${galaxyId}`);
  }
  const quota = galaxyComponentQuota(galaxyId, overrides);
  const raw = generateGalaxyNearViewParticles(galaxyId);
  if (cfg.kind !== 'spiral') {
    return { base: raw, components: [], totalCount: raw.count };
  }
  const graded = applyOldDiskColorGradient(raw, cfg);
  // M31 专属：核球偏黄 + 10 kpc 尘埃环（其余旋涡星系不套用，登记）
  const isM31 = galaxyId === 'm31';
  const base = isM31 ? applyBulgeTint(graded, cfg) : graded;
  const components: GalaxyComponentParticles[] = [
    generateDustLaneParticles(
      cfg,
      quota.dust,
      galaxyNearViewSeed(`${galaxyId}:dust`),
      isM31 ? M31_DUST_RING : undefined,
    ),
    generateHiiRegionParticles(cfg, quota.hii, galaxyNearViewSeed(`${galaxyId}:hii`)),
    generateYoungClusterParticles(
      cfg,
      quota.youngClusters,
      galaxyNearViewSeed(`${galaxyId}:youngClusters`),
    ),
  ];
  let totalCount = base.count;
  for (const c of components) totalCount += c.count;
  if (totalCount > GALAXY_NEAR_VIEW_MAX_PARTICLES) {
    throw new RangeError(
      `星系 ${galaxyId} 多分量合计 ${totalCount} 超出单星系上限 ${GALAXY_NEAR_VIEW_MAX_PARTICLES}`,
    );
  }
  return { base, components, totalCount };
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
 *
 * R4-10 起 GPU 估算按多分量配额合计（基础层 + dust/HII/年轻星团，
 * R4-9 登记的"随渲染接入一并更新"；HII 泊松盘实际接受数 ≤ 配额，
 * 估算取配额上界，登记）。
 */
export function galaxyDetailLayerSpec(galaxyId: string): DetailLayerSpec {
  const cfg = GALAXY_NEAR_VIEW_CONFIGS[galaxyId];
  if (!cfg) {
    throw new RangeError(`未定义近观粒子层配置的星系 id：${galaxyId}`);
  }
  const enterDistanceUnits = galaxyNearViewEnterDistanceUnits(galaxyId);
  const totalParticles = galaxyComponentQuota(galaxyId).total;
  return {
    bodyId: galaxyId,
    kind: 'particles',
    enterDistanceUnits,
    exitDistanceUnits: enterDistanceUnits * NEAR_VIEW_EXIT_RATIO,
    budget: {
      particles: totalParticles,
      gpuBytesEstimate: estimateGpuBytes({ particles: totalParticles }),
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
  spiral:
    '核球（老年恒星聚集）+ 恒星盘与旋臂（蓝白年轻星团串/粉色电离氢 HII 区点缀）+ 旋臂内缘尘埃带暗纹 + 稀疏恒星晕包裹',
  'barred-spiral':
    '核球与中心棒 + 恒星盘与旋臂（自棒两端延伸，年轻星团/电离氢区点缀）+ 旋臂尘埃带暗纹 + 稀疏恒星晕包裹',
  elliptical: '无盘/旋臂结构：恒星呈椭球状聚集，亮度自中心按 Sérsic 分布向外衰减，外围为延展恒星晕（无尘埃带/HII 区）',
  irregular: '无对称核球与盘结构：恒星与气体呈团块状分布（活跃恒星形成区），受邻近星系潮汐扰动塑形',
};

/** 结构说明数据来源（catalog 拼接展示；R4-10 追加 RC3/S4G 形态参数来源） */
export const GALAXY_STRUCTURE_SOURCE_ZH =
  '结构分类：Hubble 形态序列（NED）；形态参数（倾角/臂数/尘埃带/HII 区）：RC3（de Vaucouleurs et al. 1991）、S4G（Sheth et al. 2010）近似档；近观粒子层为按形态类型的示意重构（椭圆星系按 Sérsic 1963 亮度分布近似），已登记';
