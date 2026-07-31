/**
 * M87 纵深与星系团环境（R5-4，IMPROVEMENT_REQUIREMENTS_5 §R5-4 / §0.3 方案 H）
 *
 * 纯逻辑模块（附录 A 纯函数先行）：为 `Scene/M87Environment.tsx` 与
 * `ExtragalacticObjects.M87Jet`（喷流节点）提供确定性数据与细节层规格；
 * 组件只消费本模块输出。
 *
 * ── 实现选择登记（§R5-4 各"二选一"条目）────────────────────────────────
 * 1. 喷流节点：**sprite 方案**（HST-1 类亮 knot 取辉光 sprite，非小体积
 *    raymarch——节点为点状极亮源，sprite 观感即达标且零额外 raymarch 成本）；
 *    4 个节点沿轴亮度衰减；`uTime` 缓慢外移为**视觉化登记**（真实 HST-1
 *    视超光速运动 ~6c 在场景尺度不可表现，循环外流仅示意"喷流物质外传"）。
 * 2. 球状星团系统：真实 ~12,000 个（Tamura et al. 2006 量级）按预算缩减为
 *    **2,000 稀疏 Points**（登记）；径向取 **Sérsic 外包络的幂律近似档**
 *    n(r) ∝ r^−2.5（McLaughlin 1999：GC 系统数密度外区斜率量级；实现为
 *    N(<r) ∝ r^0.5 逆变换 r = R_max·t²——Sérsic n=4 精确逆变换过度向心
 *    集中不呈"外包络"观感，差异登记）；半数以内半径 = 有效半径登记值
 *    20,000 ly（比恒星 Rₑ 12,000 更延展，截断 4×Rₑ 与椭球云同口径）；
 *    轴比沿用近观椭球（0.86/0.92）；红黄老年色（金属丰度双峰的可见光
 *    合色近似，登记）；点比椭球云更小更锐（组件侧 maxSizePx 3 + 高
 *    alphaBase，与基础云 6px 软点区分）。
 * 3. 室女座团成员：**R5-3 2MRS 目录室女座方向子集**（R5-3 已交付，替代
 *    路径内嵌 VCC 表不启用，登记）——锥角 6°（与 R5-3 自校验同源）+
 *    径向壳 [11,25] Mpc（团本体窗口，登记：全壳 [5,30] 含前后景污染）
 *    按亮度取前 100；相对 M87 位移方向真实（超星系系→场景系与 R5-3
 *    目录同一旋转链），幅度取**线性压缩 1,200 units/Mpc**（对数全域
 *    压缩在团尺度局部线性化的艺术化登记——真实 ~2 Mpc 相当于 M87 贴图
 *    平面 ~1.5 倍，压缩后成员落于近观语境 ≤ ~10,000 units 内）；
 *    成员**不可点选**（raycast 禁用；信息面板 M87 卡片"室女座团"行列名
 *    说明，防干扰 M87 交互热区——二选一登记）。
 * 4. ICM 弥散辉光：**径向渐变 sprite**（非低密度体积——ICM 无结构细节，
 *    sprite 即达弥散观感且不占 volume 池）；X 射线热气体（~10⁷–10⁸ K
 *    韧致辐射）以可见光淡蓝紫辉光呈现，艺术化登记。
 * 5. M87* EHT 联动：跟随 M87 推近至核心阈值（900 units < 飞抵观察距离
 *    9,900 的 1/10，滞回 ×1.4 与 R2-7 同源）激活 R4-13 `BlackHoleLensed`
 *    参数档：**盘更暗**（0.35 < Sgr A* 0.55——M87* 吸积率极低的 ADAF 流，
 *    EHT 2019 环内侧阴影对比强）、**环更大**（r_s 世界长度 9 units ≈
 *    Sgr A* 4.8 的 1.9 倍——真实质量比 ~1,500× 的可视化压缩登记）、
 *    盘倾角 17°（EHT 2019：喷流与视线夹角 ≈ 17°，近正视环形态，
 *    与两黑洞侧视 69.23° 档区分）；与 Sgr A* 与 Cyg X-1 共用 lensing 池
 *    （容量 1，LRU）。
 *
 * ── 预算登记（附录 A §5）────────────────────────────────────────────────
 * 环境层粒子 2,000 + 100 = 2,100（starCatalog 池，与昴星团/触须星系
 * 共池容量 1）；M87 近观全量 = 椭球云 6,000 + 环境 2,100 = 8,100 ≤
 * 单目标 12,000 上限；透镜层 GPU 与 R4-13 同值（cubemap 384 KB + LUT）。
 *
 * 数据来源（§0.4）：喷流节点 HST 观测（Biretta et al. 1999）；球状星团
 * 计数 Tamura et al. (2006)；成员 2MRS（Huchra et al. 2012）子集；
 * M87* 质量 6.5×10⁹ M☉（EHT Collaboration 2019）。
 */

import type { BodyInfoLine } from '@/data/catalog';
import type { GalaxyCatalogData } from '@/utils/bakedData';
import {
  BLACK_HOLE_LENSING_GPU_BYTES,
  assertBlackHoleLensedConfigs,
  type BlackHoleLensedSceneConfig,
} from '@/utils/blackHoleScene';
import {
  DETAIL_GPU_BUDGET_BYTES,
  estimateGpuBytes,
  type DetailLayerSpec,
} from '@/utils/detailLayer';
import {
  LENSING_DOMAIN_RADIUS_RS,
} from '@/utils/blackHoleLensing';
import { NEAR_VIEW_EXIT_RATIO } from '@/utils/nearView';
import {
  SERSIC_MAX_RADIUS_FACTOR,
  galaxyNearViewEnterDistanceUnits,
  type GalaxyNearViewParticles,
} from '@/utils/galaxyNearView';
import {
  LY_PER_MPC,
  VIRGO_CONE_RADIUS_DEG,
  VIRGO_DEC_DEG,
  VIRGO_RA_DEG,
  angularSeparationDeg,
  equatorialToSupergalacticUnit,
} from '@/utils/galaxyCatalogCore';
import {
  MORPH_TIER_COLORS_SRGB,
  catalogIntensity01,
  supergalacticToScene,
} from '@/utils/galaxyCatalog';
import { createSeededRandom } from '@/utils/random';

// ---------------------------------------------------------------------------
// 喷流节点（HST-1 类亮 knot，sprite 方案登记见文件头）
// ---------------------------------------------------------------------------

/** 单个喷流节点声明（沿轴归一化基准位置 + 相对亮度 + sprite 尺寸系数） */
export interface M87JetKnot {
  /** 归一化基准轴向位置（∈[0,1)，0 = 核心端） */
  t0: number;
  /** 相对亮度（首节点 HST-1 类最亮 = 1，沿轴递减） */
  brightness: number;
  /** sprite 边长系数（× 喷流长度） */
  sizeFactor: number;
}

/** 喷流节点表（4 个，§R5-4 要求 3–5；首节点 = HST-1 类） */
export const M87_JET_KNOTS: readonly M87JetKnot[] = [
  { t0: 0.06, brightness: 1, sizeFactor: 0.14 },
  { t0: 0.24, brightness: 0.72, sizeFactor: 0.12 },
  { t0: 0.44, brightness: 0.52, sizeFactor: 0.105 },
  { t0: 0.68, brightness: 0.36, sizeFactor: 0.09 },
];

/** 节点外移速率（归一化轴长/秒）：全轴 ≈ 2.8 分钟（视觉化登记见文件头） */
export const M87_JET_KNOT_DRIFT_PER_SEC = 0.006;

/**
 * 节点当前轴向位置（归一化 [0,1) 循环外移）
 *
 * @throws RangeError t0 越界或经过秒数非有限
 */
export function m87JetKnotT01(t0: number, elapsedSeconds: number): number {
  if (!Number.isFinite(t0) || t0 < 0 || t0 >= 1) {
    throw new RangeError(`节点基准位置必须在 [0,1) 内，收到 ${t0}`);
  }
  if (!Number.isFinite(elapsedSeconds)) {
    throw new RangeError(`经过秒数必须为有限数，收到 ${elapsedSeconds}`);
  }
  const raw = t0 + elapsedSeconds * M87_JET_KNOT_DRIFT_PER_SEC;
  return raw - Math.floor(raw);
}

/**
 * 节点不透明度（∈[0,1]）：亮度沿轴衰减（1 − 0.8t，与喷流流动节点同式）
 * × 循环端点淡入淡出（t→1 处淡出、t→0 处淡入，防循环回绕位置跳变闪现）
 *
 * @throws RangeError 入参越界
 */
export function m87JetKnotOpacity01(t01: number, brightness: number): number {
  if (!Number.isFinite(t01) || t01 < 0 || t01 >= 1) {
    throw new RangeError(`轴向位置必须在 [0,1) 内，收到 ${t01}`);
  }
  if (!Number.isFinite(brightness) || brightness < 0 || brightness > 1) {
    throw new RangeError(`亮度必须在 [0,1] 内，收到 ${brightness}`);
  }
  const axial = 1 - 0.8 * t01;
  const fadeIn = Math.min(1, t01 / 0.04);
  const fadeOut = Math.min(1, (1 - t01) / 0.12);
  return brightness * axial * fadeIn * fadeOut;
}

// ---------------------------------------------------------------------------
// 球状星团系统（Sérsic 外包络稀疏 Points）
// ---------------------------------------------------------------------------

/** 呈现的球状星团数（真实 ~12,000 按预算缩减登记见文件头） */
export const M87_GC_COUNT = 2000;

/** GC 系统有效半径（光年；半数以内半径 = R_max × 0.5² 的登记值，
 * 比恒星 Rₑ 12,000 更延展） */
export const M87_GC_EFFECTIVE_RADIUS_LY = 20000;

/** GC 幂律外包络指数：N(<r) ∝ r^0.5 ⇔ n(r) ∝ r^−2.5（登记见文件头） */
export const M87_GC_ENVELOPE_CDF_EXPONENT = 2;

/** GC 椭球轴比（与近观椭球配置同值：axisRatioY/axisRatioZ） */
export const M87_GC_AXIS_RATIO_Y = 0.86;
export const M87_GC_AXIS_RATIO_Z = 0.92;

/** GC 采样确定性种子 */
export const M87_GC_SEED = 20260730;

/** GC 系统最大半径（光年；截断 4×Rₑ 与恒星椭球云同口径） */
export const M87_GC_MAX_RADIUS_LY = M87_GC_EFFECTIVE_RADIUS_LY * SERSIC_MAX_RADIUS_FACTOR;

/**
 * 采样 M87 球状星团点集（光年坐标，星系本地系；确定性——同参数
 * 两次调用逐字节一致，附录 A §2）
 *
 * 径向：幂律外包络 r = R_max·t²（n(r) ∝ r^−2.5 近似，登记见文件头；
 * 截断 R_max = 4×Rₑ = 80,000 ly 与恒星椭球同口径，半数落于 20,000 ly
 * 以内）；角向：各向同性 + 轴比压扁；颜色：红黄老年星族（登记见
 * 文件头）；尺寸：0.5–1.4（组件侧 maxSizePx 3 锐利小点）。
 *
 * @throws RangeError count 非正整数
 */
export function sampleM87GlobularClusters(
  count: number = M87_GC_COUNT,
  seed: number = M87_GC_SEED,
): GalaxyNearViewParticles {
  if (!Number.isInteger(count) || count <= 0) {
    throw new RangeError(`球状星团数必须为正整数，收到 ${count}`);
  }
  if (!Number.isFinite(seed)) {
    throw new RangeError(`种子必须为有限数，收到 ${seed}`);
  }
  const rand = createSeededRandom(seed);
  const positionsLy = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    const r = M87_GC_MAX_RADIUS_LY * Math.pow(rand(), M87_GC_ENVELOPE_CDF_EXPONENT);
    const cosPolar = rand() * 2 - 1;
    const azimuth = Math.PI * 2 * rand();
    const sinPolar = Math.sqrt(1 - cosPolar * cosPolar);
    positionsLy[i * 3] = r * sinPolar * Math.cos(azimuth);
    positionsLy[i * 3 + 1] = r * cosPolar * M87_GC_AXIS_RATIO_Y;
    positionsLy[i * 3 + 2] = r * sinPolar * Math.sin(azimuth) * M87_GC_AXIS_RATIO_Z;
    // 红黄老年色：R 恒 1，G/B 随机落于暖档（金属丰度双峰合色近似登记）
    colors[i * 3] = 1;
    colors[i * 3 + 1] = 0.78 + 0.14 * rand();
    colors[i * 3 + 2] = 0.52 + 0.18 * rand();
    sizes[i] = 0.5 + 0.9 * rand();
  }
  return { count, positionsLy, colors, sizes };
}

// ---------------------------------------------------------------------------
// 室女座团成员点缀（R5-3 目录子集，选择登记见文件头）
// ---------------------------------------------------------------------------

/** M87 真实距离（Mpc）：5.4×10⁷ ly（NED，与 data/galaxies 同源） */
export const M87_DISTANCE_MPC = 5.4e7 / LY_PER_MPC;

/** 成员筛选径向壳（Mpc；团本体窗口登记见文件头） */
export const VIRGO_MEMBER_SHELL_MIN_MPC = 11;
export const VIRGO_MEMBER_SHELL_MAX_MPC = 25;

/** 成员点缀数量上限（按亮度取前 N） */
export const VIRGO_MEMBER_MAX_COUNT = 100;

/** 相对位移线性压缩（场景单位/Mpc；艺术化登记见文件头） */
export const VIRGO_MEMBER_UNITS_PER_MPC = 1200;

/** 成员点集（场景单位，M87 本地系 = 场景系轴向平移到 M87） */
export interface VirgoMemberPoints {
  count: number;
  /** 相对 M87 的场景位移（count×3，场景单位） */
  positionsUnits: Float32Array;
  /** sRGB 颜色（形态档区分：椭圆偏黄/旋涡蓝白/未知暖灰，R5-3 同源色板） */
  colors: Float32Array;
  /** 点尺寸（亮度档映射） */
  sizes: Float32Array;
}

/**
 * 从 R5-3 目录筛选室女座团成员点缀（纯函数，确定性）
 *
 * 锥角 6°（VIRGO_CONE_RADIUS_DEG 同源）+ 径向壳 [11,25] Mpc，按亮度
 * 降序取前 100（平局按目录索引序，稳定）；位移 =（成员 − M87）超星系
 * 坐标 × 1,200 units/Mpc，经 R5-3 同一旋转链（supergalacticToScene）
 * 转到场景轴向——与目录背景点云方向一致。
 *
 * M87 自身已在 R5-3 烘焙期 0.5° 去重剔除（无重影，单测断言）。
 */
export function virgoMemberPoints(catalog: GalaxyCatalogData): VirgoMemberPoints {
  const coneDir = equatorialToSupergalacticUnit(VIRGO_RA_DEG, VIRGO_DEC_DEG);
  const m87 = {
    x: coneDir.x * M87_DISTANCE_MPC,
    y: coneDir.y * M87_DISTANCE_MPC,
    z: coneDir.z * M87_DISTANCE_MPC,
  };
  const picked: Array<{ index: number; brightness: number }> = [];
  for (let i = 0; i < catalog.count; i += 1) {
    const x = catalog.positionsMpc[i * 3];
    const y = catalog.positionsMpc[i * 3 + 1];
    const z = catalog.positionsMpc[i * 3 + 2];
    const r = Math.hypot(x, y, z);
    if (r < VIRGO_MEMBER_SHELL_MIN_MPC || r > VIRGO_MEMBER_SHELL_MAX_MPC) continue;
    const sep = angularSeparationDeg({ x: x / r, y: y / r, z: z / r }, coneDir);
    if (sep > VIRGO_CONE_RADIUS_DEG) continue;
    picked.push({ index: i, brightness: catalog.brightness01[i] });
  }
  // 亮度降序；平局按索引升序（ES2019 稳定排序 → 确定性）
  picked.sort((a, b) => b.brightness - a.brightness);
  const count = Math.min(VIRGO_MEMBER_MAX_COUNT, picked.length);
  const positionsUnits = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  for (let k = 0; k < count; k += 1) {
    const i = picked[k].index;
    const rel = supergalacticToScene({
      x: (catalog.positionsMpc[i * 3] - m87.x) * VIRGO_MEMBER_UNITS_PER_MPC,
      y: (catalog.positionsMpc[i * 3 + 1] - m87.y) * VIRGO_MEMBER_UNITS_PER_MPC,
      z: (catalog.positionsMpc[i * 3 + 2] - m87.z) * VIRGO_MEMBER_UNITS_PER_MPC,
    });
    positionsUnits[k * 3] = rel.x;
    positionsUnits[k * 3 + 1] = rel.y;
    positionsUnits[k * 3 + 2] = rel.z;
    const tier = catalog.morphTiers[i];
    const base = MORPH_TIER_COLORS_SRGB[tier] ?? MORPH_TIER_COLORS_SRGB[2];
    const intensity = catalogIntensity01(picked[k].brightness);
    colors[k * 3] = base[0] * intensity;
    colors[k * 3 + 1] = base[1] * intensity;
    colors[k * 3 + 2] = base[2] * intensity;
    sizes[k] = 6 + 6 * picked[k].brightness;
  }
  return { count, positionsUnits, colors, sizes };
}

/** 成员相对位移上界（场景单位；单测/包围球断言用）：径向壳最远端 */
export const VIRGO_MEMBER_MAX_OFFSET_UNITS =
  (VIRGO_MEMBER_SHELL_MAX_MPC - M87_DISTANCE_MPC + 2) * VIRGO_MEMBER_UNITS_PER_MPC;

// ---------------------------------------------------------------------------
// ICM 弥散辉光（径向渐变 sprite，艺术化登记见文件头）
// ---------------------------------------------------------------------------

/** ICM 辉光半径（场景单位；≈ 2 Mpc × 线性压缩） */
export const M87_ICM_RADIUS_UNITS = 2 * VIRGO_MEMBER_UNITS_PER_MPC;

/** ICM 辉光基准不透明度（弥散低亮度档） */
export const M87_ICM_OPACITY = 0.14;

/** ICM 辉光色（X 射线热气体可见光艺术化：淡蓝紫） */
export const M87_ICM_COLOR = '#9fb2e0';

// ---------------------------------------------------------------------------
// M87* EHT 联动（lensing 池参数档 + 推近阈值）
// ---------------------------------------------------------------------------

/**
 * M87* 透镜参数档（BlackHoleLensedLayer 消费；与两黑洞差异登记见文件头：
 * 盘更暗 0.35 / 峰值温标偏橙红 0.6 / 光子环暖橙 / 倾角 17° 近正视）
 */
export const M87_CORE_LENSED_CONFIG: BlackHoleLensedSceneConfig = {
  diskInnerRs: 3,
  diskOuterRs: 7,
  diskBrightness: 0.35,
  diskTempScale: 0.6,
  beamStrength: 1,
  ringStrength: 3,
  ringColor: '#ffb469',
  starIntensity: 1,
  diskInclinationDeg: 17,
  starfieldSeed: 4133,
};

/** M87* 透镜 r_s 世界长度（场景单位；"环更大"压缩登记见文件头） */
export const M87_CORE_RS_WORLD_UNITS = 9;

/** 核心推近激活距离（场景单位；飞抵观察距离 9,900 内继续推近触发） */
export const M87_CORE_LENSING_ENTER_UNITS = 900;

/** 透镜包围球世界半径（场景单位；须 < 激活距离，相机激活时恒在球外） */
export const M87_CORE_LENSING_DOMAIN_UNITS =
  M87_CORE_RS_WORLD_UNITS * LENSING_DOMAIN_RADIUS_RS;

/**
 * M87* 透镜细节层规格（lensing 池容量 1，与 Sgr A* 与 Cyg X-1 共池 LRU；
 * 调用方 useMemo 稳定）
 */
export function m87CoreLensingDetailLayerSpec(): DetailLayerSpec {
  return {
    bodyId: 'm87',
    kind: 'lensing',
    enterDistanceUnits: M87_CORE_LENSING_ENTER_UNITS,
    exitDistanceUnits: M87_CORE_LENSING_ENTER_UNITS * NEAR_VIEW_EXIT_RATIO,
    budget: { gpuBytesEstimate: BLACK_HOLE_LENSING_GPU_BYTES },
  };
}

// ---------------------------------------------------------------------------
// 环境细节层规格（starCatalog 池：GC + 成员 + ICM）
// ---------------------------------------------------------------------------

/** 环境层粒子预算（GC 2,000 + 成员 ≤100） */
export const M87_ENVIRONMENT_PARTICLES = M87_GC_COUNT + VIRGO_MEMBER_MAX_COUNT;

/**
 * M87 环境细节层规格（starCatalog 池，与昴星团/触须星系共池容量 1；
 * 阈值与星系近观层同源——飞抵即同步激活完整语境）
 */
export function m87EnvironmentDetailLayerSpec(): DetailLayerSpec {
  const enterDistanceUnits = galaxyNearViewEnterDistanceUnits('m87');
  return {
    bodyId: 'm87',
    kind: 'starCatalog',
    enterDistanceUnits,
    exitDistanceUnits: enterDistanceUnits * NEAR_VIEW_EXIT_RATIO,
    budget: {
      particles: M87_ENVIRONMENT_PARTICLES,
      gpuBytesEstimate: estimateGpuBytes({ particles: M87_ENVIRONMENT_PARTICLES }),
    },
  };
}

// ---------------------------------------------------------------------------
// 信息面板 M87 卡片补行（§R5-4 第 5 条；data/catalog.ts 消费）
// ---------------------------------------------------------------------------

/** M87 卡片增补行（M87* / 球状星团 / 室女座团） */
export const M87_EXTRA_INFO_LINES_ZH: readonly BodyInfoLine[] = [
  {
    label: 'M87*',
    value:
      '中心超大质量黑洞，约 65 亿倍太阳质量（EHT 2019 首张黑洞照片）；跟随 M87 推近核心可见引力透镜光子环（盘更暗、环更大参数档，尺度压缩登记）',
  },
  {
    label: '球状星团',
    value:
      '约 12,000 个（Tamura et al. 2006 量级），银河系的 ~80 倍；近观呈现 2,000 个锐利小点（预算缩减登记），Sérsic 外包络分布、红黄老年色',
  },
  {
    label: '室女座团',
    value:
      '约 2,000 个成员星系的星系团中心；近观点缀 2MRS 目录亮成员约 100 个（不可点选，登记）与 ICM 热气体弥散辉光（X 射线波段的可见光艺术化）',
  },
];

/** M87 卡片增补行（英文 value；label 与 ZH 版一致，由 UI 层映射） */
export const M87_EXTRA_INFO_LINES_EN: readonly BodyInfoLine[] = [
  {
    label: 'M87*',
    value:
      'The central supermassive black hole, about 6.5 billion solar masses (EHT 2019, the first image of a black hole); following M87 in close to the core reveals the gravitationally lensed photon ring (dimmer-disk, larger-ring parameter preset; scale compression registered)',
  },
  {
    label: '球状星团',
    value:
      'About 12,000 (order of Tamura et al. 2006), roughly 80 times the Milky Way\u2019s count; the close-up view renders 2,000 sharp points (budget reduction registered), distributed within a Sérsic outer envelope in reddish-yellow old-population colors',
  },
  {
    label: '室女座团',
    value:
      'The center of a galaxy cluster with about 2,000 member galaxies; the close-up view is dotted with about 100 bright 2MRS-catalog members (not selectable, registered) and the diffuse glow of hot ICM gas (an artistic visible-light rendering of the X-ray band)',
  },
];

/** M87 环境数据来源登记（catalog dataSource 拼接） */
export const M87_ENVIRONMENT_SOURCE_ZH =
  'M87* 参数 EHT Collaboration (2019)；喷流节点 HST（Biretta et al. 1999，外移为视觉化示意）；球状星团 Tamura et al. (2006) 计数（呈现 2,000 缩减登记）；室女座成员 2MRS（Huchra et al. 2012）子集（相对位置线性压缩登记）；ICM 辉光为 X 射线热气体艺术化';

/** M87 环境数据来源（英文，i18n 全站覆盖；内容与 ZH 版一一对应） */
export const M87_ENVIRONMENT_SOURCE_EN =
  'M87* parameters: EHT Collaboration (2019); jet knots: HST (Biretta et al. 1999, outward drift is a visual cue); globular clusters: Tamura et al. (2006) counts (rendered as 2,000, reduction registered); Virgo members: 2MRS (Huchra et al. 2012) subset (relative positions linearly compressed, registered); ICM glow is an artistic rendering of X-ray hot gas';

// ---------------------------------------------------------------------------
// 配置自洽校验（模块加载即执行；导出供单测覆盖异常分支）
// ---------------------------------------------------------------------------

/**
 * 校验 R5-4 配置自洽：节点数 3–5 且沿轴亮度递减、透镜参数不被 clamp
 * 改写、推近阈值 > 包围球半径且 < 近观激活距离、粒子预算在总预算内。
 *
 * @throws RangeError 任一约束不满足
 */
export function assertM87EnvironmentConfig(
  knots: readonly M87JetKnot[] = M87_JET_KNOTS,
  enterUnits: number = M87_CORE_LENSING_ENTER_UNITS,
  domainUnits: number = M87_CORE_LENSING_DOMAIN_UNITS,
): void {
  if (knots.length < 3 || knots.length > 5) {
    throw new RangeError(`喷流节点数须为 3–5，收到 ${knots.length}`);
  }
  for (let i = 0; i < knots.length; i += 1) {
    const k = knots[i];
    if (!(k.t0 >= 0 && k.t0 < 1) || !(k.brightness > 0 && k.brightness <= 1)) {
      throw new RangeError(`喷流节点 ${i} 参数越界（t0=${k.t0} brightness=${k.brightness}）`);
    }
    if (i > 0 && !(k.t0 > knots[i - 1].t0 && k.brightness < knots[i - 1].brightness)) {
      throw new RangeError(`喷流节点须沿轴位置递增且亮度递减（节点 ${i} 违例）`);
    }
  }
  assertBlackHoleLensedConfigs({ 'm87-core': M87_CORE_LENSED_CONFIG });
  if (!(domainUnits < enterUnits)) {
    throw new RangeError('透镜包围球半径必须小于核心推近激活距离');
  }
  if (!(enterUnits < galaxyNearViewEnterDistanceUnits('m87'))) {
    throw new RangeError('核心推近激活距离必须小于星系近观激活距离');
  }
  if (estimateGpuBytes({ particles: M87_ENVIRONMENT_PARTICLES }) > DETAIL_GPU_BUDGET_BYTES) {
    throw new RangeError('M87 环境层粒子预算超出细节层总预算');
  }
}

assertM87EnvironmentConfig();
