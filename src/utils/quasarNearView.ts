/**
 * 类星体 3C 273 近观细节层纯逻辑（R4-21，IMPROVEMENT_REQUIREMENTS_4 §R4-21）
 *
 * 纯逻辑模块（附录 A §3 纯函数先行）：为 `Scene/QuasarNearView.tsx` 提供
 * 尺度常量、尘埃环面粒子生成、detailLayer 规格与交叉淡出权重；组件只
 * 消费本模块输出。盘着色物理复用 R4-12（`utils/blackHoleLensing` 温度
 * 剖面/开普勒 β/多普勒 δ/引力红移 g 与黑体 LUT，勿复制公式）。
 *
 * ── 结构（内→外四层，§R4-21 验收）──────────────────────────────────────
 * 1. 吸积盘：R4-12 盘着色逻辑的非透镜简化版——平面环形 mesh，温度剖面
 *    黑体色 + 多普勒束流 δ³ + 引力红移 g³（GLSL 镜像常数单点同源）；
 *    透镜 raymarch 不启用（登记：3C 273 近观取盘远观尺度，弯折翻折像
 *    不可辨，平面盘即达验收观感，成本远低于 raymarch）
 * 2. BLR 弥散辉光过渡层：单张 glow sprite（宽线区连续谱 + 宽发射线的
 *    弥散近似登记），随既有光变闪烁联动
 * 3. 尘埃环面（AGN 统一模型 torus）：粒子环（§R4-21"小型体积或粒子环
 *    二选一"——取粒子环并登记：volume 池容量 1 已被星云类 L3 巡游站
 *    高频占用，插入将致 LRU 反复逐出重烘焙；粒子环成本更低且暗尘埃
 *    无发射结构诉求）
 * 4. 相对论喷流：既有 `RelativisticJet` 保留联动（本模块不管理）
 *
 * ── 科学近似与艺术化登记（附录 A §4，数据源 §0.4）───────────────────────
 * - 3C 273 吸积盘真实为 UV/光学"大蓝包"（有效温度 ~10⁴–10⁵ K），峰值
 *   色温压标至黑体 LUT 域内 12,000 K（亮蓝白观感档，R4-12 压标先例）；
 * - 尘埃环面：AGN 统一模型（Urry & Padovani 1995）的环面尘埃结构，
 *   暗红棕配色为尘埃消光 + 热尘埃红端辐射的艺术化档；
 * - 几何尺度：盘/BLR/环面半径比例取可视化档（真实比例跨 3–5 个量级
 *   不可同框可视化，登记）；盘内缘→外缘映射 ISCO 3 r_s → 12 r_s
 *   （DISK_INNER/OUTER_RADIUS_RS_DEFAULT 同源）。
 *
 * ── 粒子预算登记（附录 A §1）────────────────────────────────────────────
 * particles 池（容量 1，与 R2-8 星系近观共池 LRU、'lru-retain' L4 语义）：
 * 尘埃环面 2,400 粒 + BLR 辉光 sprite 1 = 2,401 ≤ 单目标 12,000；
 * 共池容量 1 且低于星系近观峰值（M31 9,850）→ 全局粒子峰值登记不变。
 *
 * 确定性（附录 A §2）：FNV-1a 种子（`lensingSeed('quasar-3c273:torus')`）
 * 经 mulberry32 展开，两次进入形态一致（单测断言）。
 */

import {
  EXTRAGALACTIC_VIEW_RADIUS_UNITS,
  viewDistanceForRadius,
} from '@/utils/cameraFocus';
import { NEAR_VIEW_ENTER_RATIO, NEAR_VIEW_EXIT_RATIO } from '@/utils/nearView';
import { estimateGpuBytes, type DetailLayerSpec } from '@/utils/detailLayer';
import {
  DISK_INNER_RADIUS_RS_DEFAULT,
  DISK_OUTER_RADIUS_RS_DEFAULT,
  lensingSeed,
} from '@/utils/blackHoleLensing';
import { createSeededRandom } from '@/utils/random';

// ---------------------------------------------------------------------------
// 常量（几何因子均为"基准半径倍数"——主场景基准 = EXTRAGALACTIC_VIEW_RADIUS_UNITS）
// ---------------------------------------------------------------------------

/** 天体 id（store.followBodyId/flyToBodyId 判据对齐） */
export const QUASAR_BODY_ID = 'quasar-3c273';

/** 吸积盘内缘半径（基准半径倍数；对应 3 r_s ISCO） */
export const QUASAR_DISK_INNER_FACTOR = 0.1;

/** 吸积盘外缘半径（基准半径倍数；对应 12 r_s） */
export const QUASAR_DISK_OUTER_FACTOR = 0.85;

/** BLR 弥散辉光 sprite 半边长（基准半径倍数；盘外缘与环面之间的过渡层） */
export const QUASAR_BLR_GLOW_HALF_FACTOR = 1.15;

/** 尘埃环面主半径（基准半径倍数） */
export const QUASAR_TORUS_MAJOR_FACTOR = 1.45;

/** 尘埃环面管半径（基准半径倍数） */
export const QUASAR_TORUS_MINOR_FACTOR = 0.4;

/** 尘埃环面 y 向压扁系数（AGN 环面为厚盘状而非正圆管，示意档登记） */
export const QUASAR_TORUS_FLATTEN_Y = 0.72;

/** 尘埃环面粒子数（附录 A 单目标 ≤12,000 内，预算登记见文件头） */
export const QUASAR_TORUS_PARTICLE_COUNT = 2400;

/** 近观新增 sprite 数（BLR 辉光 ×1；核心辉光/喷流节点为既有常驻，不计增量） */
export const QUASAR_NEAR_SPRITE_COUNT = 1;

/** 盘峰值色温可视化档（K；真实"大蓝包"~10⁴–10⁵ K，压标登记见文件头） */
export const QUASAR_DISK_TEMP_PEAK_K = 12000;

/** 近观时核心辉光 sprite 减淡幅度（让出吸积盘视野；光变闪烁保留不回退） */
export const QUASAR_CORE_NEAR_DIM = 0.55;

/** BLR 辉光基础不透明度（目验调参：过高会盖过盘的蓝白色阶，登记） */
export const QUASAR_BLR_BASE_OPACITY = 0.22;

/** 尘埃环面粒径域（基准半径倍数） */
export const QUASAR_TORUS_SIZE_MIN_FACTOR = 0.05;
export const QUASAR_TORUS_SIZE_MAX_FACTOR = 0.11;

/**
 * 尘埃环面配色（线性空间 RGB，暗红棕档登记）：
 * 内侧（近盘受照面）偏暖棕 → 外侧偏暗冷棕。数值为线性工作空间值
 * （输出经 colorspace_fragment 编码 sRGB：内侧显示 ≈ #7a4526 暗棕、
 * 外侧 ≈ #48291a 深棕；目验调参——线性值直取 sRGB 数值会被编码提亮
 * 成米色，登记）
 */
export const QUASAR_TORUS_COLOR_INNER: Readonly<{ r: number; g: number; b: number }> = {
  r: 0.19,
  g: 0.06,
  b: 0.022,
};
export const QUASAR_TORUS_COLOR_OUTER: Readonly<{ r: number; g: number; b: number }> = {
  r: 0.062,
  g: 0.021,
  b: 0.009,
};

// ---------------------------------------------------------------------------
// detailLayer 规格（R4-2 统一门控；阈值与 resolveFocusTarget 同源）
// ---------------------------------------------------------------------------

/**
 * 类星体近观进入阈值（场景单位）= 河外特殊天体飞往观察距离 ×
 * NEAR_VIEW_ENTER_RATIO（cameraFocus/nearView 同源，禁止两套参数）
 */
export function quasarNearViewEnterDistanceUnits(): number {
  return viewDistanceForRadius(EXTRAGALACTIC_VIEW_RADIUS_UNITS) * NEAR_VIEW_ENTER_RATIO;
}

/**
 * 类星体细节层规格（particles 池，容量 1 与 R2-8 星系近观共池；
 * 组件以 'lru-retain' 语义挂载——L4 巡游快速切回免重建）
 */
export function quasarDetailLayerSpec(): DetailLayerSpec {
  const enter = quasarNearViewEnterDistanceUnits();
  const particles = QUASAR_TORUS_PARTICLE_COUNT + QUASAR_NEAR_SPRITE_COUNT;
  return {
    bodyId: QUASAR_BODY_ID,
    kind: 'particles',
    enterDistanceUnits: enter,
    exitDistanceUnits: enter * NEAR_VIEW_EXIT_RATIO,
    budget: {
      particles,
      gpuBytesEstimate: estimateGpuBytes({ particles }),
    },
  };
}

// ---------------------------------------------------------------------------
// 交叉淡出/联动权重（组件每帧消费，纯函数）
// ---------------------------------------------------------------------------

const clamp01 = (v: number): number =>
  Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0;

/**
 * 核心辉光近观减淡系数：near01=0 → 1（远景行为零回退），near01=1 →
 * 1 − QUASAR_CORE_NEAR_DIM（减淡让出盘视野；光变闪烁另行相乘保留）
 */
export function quasarCoreNearFactor(near01: number): number {
  return 1 - QUASAR_CORE_NEAR_DIM * clamp01(near01);
}

/**
 * BLR 辉光不透明度 = 基础档 × 近观权重 × 光变联动
 * （flicker 为 quasarFlicker 输出，基准 1；±20% 光变映射为 ±5% 辉光呼吸）
 */
export function quasarBlrOpacity(near01: number, flicker: number): number {
  const f = Number.isFinite(flicker) ? Math.max(0, Math.min(2, flicker)) : 1;
  return QUASAR_BLR_BASE_OPACITY * clamp01(near01) * (0.75 + 0.25 * f);
}

/**
 * 盘半径参数化：环带归一化位置 t ∈ [0,1]（内缘→外缘）→ r_s 单位半径
 * （ISCO 3 r_s → 12 r_s 线性映射，R4-12 常数单点同源；shader 同式）
 */
export function quasarDiskRadiusRs(t01: number): number {
  const t = clamp01(t01);
  return (
    DISK_INNER_RADIUS_RS_DEFAULT +
    (DISK_OUTER_RADIUS_RS_DEFAULT - DISK_INNER_RADIUS_RS_DEFAULT) * t
  );
}

// ---------------------------------------------------------------------------
// 尘埃环面粒子生成（确定性）
// ---------------------------------------------------------------------------

/** 尘埃环面粒子属性（float32 布局与 detailLayer 估算一致：pos3+color3+size1） */
export interface QuasarTorusParticles {
  /** 位置（场景单位，环面轴 = +y；count × 3） */
  positions: Float32Array;
  /** 颜色（线性空间 RGB；count × 3） */
  colors: Float32Array;
  /** 粒径（场景单位；count × 1） */
  sizes: Float32Array;
  count: number;
}

/**
 * 生成尘埃环面粒子（确定性纯函数；两次调用逐字节一致）：
 * 环向均匀 × 管截面均匀（ρ = R·√u 面积均匀采样）× y 向压扁；
 * 颜色按管内径向位置从内暖棕向外暗棕过渡 + 确定性亮度抖动。
 *
 * @param baseRadiusUnits 基准半径（场景单位；主场景 =
 *   EXTRAGALACTIC_VIEW_RADIUS_UNITS，预览页 = 1）
 * @throws RangeError 当 baseRadiusUnits 非正有限数
 */
export function generateQuasarTorusParticles(
  baseRadiusUnits: number,
): QuasarTorusParticles {
  if (!Number.isFinite(baseRadiusUnits) || baseRadiusUnits <= 0) {
    throw new RangeError(`基准半径必须为正有限数，收到 ${baseRadiusUnits}`);
  }
  const count = QUASAR_TORUS_PARTICLE_COUNT;
  const rand = createSeededRandom(lensingSeed(`${QUASAR_BODY_ID}:torus`));
  const major = QUASAR_TORUS_MAJOR_FACTOR * baseRadiusUnits;
  const minor = QUASAR_TORUS_MINOR_FACTOR * baseRadiusUnits;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const ci = QUASAR_TORUS_COLOR_INNER;
  const co = QUASAR_TORUS_COLOR_OUTER;
  for (let i = 0; i < count; i += 1) {
    const theta = Math.PI * 2 * rand();
    const rho01 = Math.sqrt(rand()); // 管截面面积均匀
    const phi = Math.PI * 2 * rand();
    const rho = minor * rho01;
    const ring = major + rho * Math.cos(phi);
    positions[i * 3] = ring * Math.cos(theta);
    positions[i * 3 + 1] = rho * Math.sin(phi) * QUASAR_TORUS_FLATTEN_Y;
    positions[i * 3 + 2] = ring * Math.sin(theta);
    // 内暖 → 外暗（管心近盘一侧偏暖），亮度确定性抖动 ±20%
    const mix = 0.35 + 0.65 * rho01;
    const gain = 0.8 + 0.4 * rand();
    colors[i * 3] = Math.min(1, (ci.r + (co.r - ci.r) * mix) * gain);
    colors[i * 3 + 1] = Math.min(1, (ci.g + (co.g - ci.g) * mix) * gain);
    colors[i * 3 + 2] = Math.min(1, (ci.b + (co.b - ci.b) * mix) * gain);
    sizes[i] =
      (QUASAR_TORUS_SIZE_MIN_FACTOR +
        (QUASAR_TORUS_SIZE_MAX_FACTOR - QUASAR_TORUS_SIZE_MIN_FACTOR) * rand()) *
      baseRadiusUnits;
  }
  return { positions, colors, sizes, count };
}
