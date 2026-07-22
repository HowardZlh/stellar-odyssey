/**
 * 尺度与精度管理（需求 5.1，P0 架构核心）
 *
 * 方案：分层场景 + 尺度归一化
 * - 每个层级使用独立的"场景单位"映射，避免真实尺度（跨 19 个数量级）直接进入
 *   浮点坐标导致抖动；P0 实现 L2 太阳系层（1 AU = 10 场景单位）
 * - 渲染端配合对数深度缓冲（Canvas gl.logarithmicDepthBuffer = true）避免 z-fighting
 * - 相机始终工作在 O(10²) 量级坐标内，无需浮动原点即可保证精度
 *
 * 视觉夸大登记（需求 4.1，非真实处理必须登记）：
 * - 天体半径采用对数压缩（visualBodyRadius），否则按真实比例行星不可见；
 *   压缩函数与参数见下方注释，后续提供"真实比例模式"开关时以此函数为切换点
 * - 轨道距离不压缩（1 AU 线性映射），保证轨道相对比例真实
 */

import type { Vec3, ViewLevel } from '@/types';

/** 1 天文单位（km），来源：IAU 2012 定义 */
export const AU_KM = 149597870.7;

/** 1 光年对应的天文单位数，来源：IAU */
export const LIGHT_YEAR_AU = 63241.077;

/** 1 秒差距（光年） */
export const PARSEC_LY = 3.26156;

/** 场景单位映射：1 AU = 10 场景单位（附录A 太阳系渲染参考） */
export const SCENE_UNITS_PER_AU = 10;

/** 天体半径对数压缩参数：参考半径（km）与基准系数 */
export const RADIUS_LOG_REF_KM = 2000;
export const RADIUS_BASE_UNITS = 1.0;
/** 最小可见半径（场景单位），保证水星等小天体可见 */
export const MIN_VISUAL_RADIUS = 0.3;

/**
 * 天文单位 → 场景单位
 */
export function auToSceneUnits(au: number): number {
  return au * SCENE_UNITS_PER_AU;
}

/**
 * 场景单位 → 天文单位
 */
export function sceneUnitsToAu(units: number): number {
  return units / SCENE_UNITS_PER_AU;
}

/**
 * 天体半径对数压缩（视觉夸大处理，已登记）
 *
 * radius_scene = max(MIN, BASE · log10(1 + r_km / REF))
 * 效果示例：水星≈0.35、地球≈0.62、木星≈1.56、太阳≈2.54 场景单位，
 * 保持"太阳 > 木星 > 地球 > 水星"的相对大小关系且全部可见。
 */
export function visualBodyRadius(radiusKm: number): number {
  if (radiusKm <= 0) {
    throw new RangeError(`天体半径必须为正数，收到 ${radiusKm}`);
  }
  const compressed = RADIUS_BASE_UNITS * Math.log10(1 + radiusKm / RADIUS_LOG_REF_KM);
  return Math.max(MIN_VISUAL_RADIUS, compressed);
}

/**
 * 日心黄道坐标（AU）→ three.js 场景坐标（场景单位，Y 轴向上）
 *
 * 映射：黄道面 x-y → 场景 x-(-z)，北黄极 +z → 场景 +Y。
 * 保证自北黄极（场景上方）俯视时公转方向为逆时针（需求 3.1.1）。
 */
export function eclipticToScene(ecliptic: Vec3): Vec3 {
  return {
    x: ecliptic.x * SCENE_UNITS_PER_AU,
    y: ecliptic.z * SCENE_UNITS_PER_AU,
    z: -ecliptic.y * SCENE_UNITS_PER_AU,
  };
}

/**
 * 尺度标尺文案（需求 3.2.2：UI 实时显示当前所处尺度）
 *
 * 根据距离量级自动选择单位：km → AU → 光年 → Mpc
 */
export function formatScaleLabel(distanceAu: number): string {
  if (!Number.isFinite(distanceAu) || distanceAu < 0) {
    throw new RangeError(`距离必须为非负有限数，收到 ${distanceAu}`);
  }
  if (distanceAu < 0.01) {
    const km = distanceAu * AU_KM;
    return `${formatNumber(km)} km`;
  }
  if (distanceAu < LIGHT_YEAR_AU) {
    return `${formatNumber(distanceAu)} AU`;
  }
  const ly = distanceAu / LIGHT_YEAR_AU;
  if (ly < 1e6 * PARSEC_LY) {
    return `${formatNumber(ly)} 光年`;
  }
  const mpc = ly / (1e6 * PARSEC_LY);
  return `${formatNumber(mpc)} Mpc`;
}

/**
 * 根据相机到目标的距离（场景单位）推断当前所处层级（用于尺度指示与音景混合）
 *
 * P0 阈值基于太阳系场景经验值，后续接入连续缩放时细化。
 */
export function levelForCameraDistance(distanceSceneUnits: number): ViewLevel {
  if (distanceSceneUnits < 30) return 'L1';
  if (distanceSceneUnits < 600) return 'L2';
  if (distanceSceneUnits < 5000) return 'L3';
  return 'L4';
}

// ---------------------------------------------------------------------------
// L3 / L4 尺度扩展（P1）
// ---------------------------------------------------------------------------

/**
 * 银河系层尺度映射：1 光年 = 0.05 场景单位。
 * 银盘半径 5 万光年 → 2500 单位；太阳距银心约 2.6 万光年 → 1300 单位，
 * 与 L3 相机锚点（距离约 2900 单位）匹配。
 */
export const SCENE_UNITS_PER_LY = 0.05;

/** 宇宙距离压缩：线性区上限（光年）。银河系近邻（麦哲伦云等）保持线性 */
export const COSMIC_LINEAR_MAX_LY = 200000;

/** 宇宙距离压缩：对数区系数（场景单位 / 十倍距离） */
export const COSMIC_LOG_UNITS = 2400;

/**
 * 光年 → 场景单位（线性，银河系内使用）
 */
export function lyToSceneUnits(ly: number): number {
  return ly * SCENE_UNITS_PER_LY;
}

/**
 * 宇宙级距离压缩（视觉夸大处理，登记于需求 3.1.3 距离压缩策略）：
 *
 * units(d) = d·0.05                          （d ≤ 20 万光年，线性区）
 *          = 10000 + 2400·log10(d / 2e5)      （d > 20 万光年，对数区）
 *
 * 效果：大麦哲伦云(16万光年)≈8000、M31(250万光年)≈12630、
 * 室女座星系团(5400万光年)≈15830、拉尼亚凯亚边界(约2.6亿光年)≈17470 单位。
 * 本星系群内与星系团间距离跨 3 个数量级被压缩至同屏可见。
 */
export function cosmicDistanceToSceneUnits(distanceLy: number): number {
  if (!Number.isFinite(distanceLy) || distanceLy < 0) {
    throw new RangeError(`距离必须为非负有限数，收到 ${distanceLy}`);
  }
  if (distanceLy <= COSMIC_LINEAR_MAX_LY) {
    return distanceLy * SCENE_UNITS_PER_LY;
  }
  return (
    COSMIC_LINEAR_MAX_LY * SCENE_UNITS_PER_LY +
    COSMIC_LOG_UNITS * Math.log10(distanceLy / COSMIC_LINEAR_MAX_LY)
  );
}

// ---------------------------------------------------------------------------
// 连续维度缩放（需求 3.2.2 遨游模式）
// ---------------------------------------------------------------------------

/**
 * 各层级"标准相机距离"锚点（场景单位）。
 * 连续层级在锚点之间按对数距离插值，边界与 levelForCameraDistance 阈值一致
 * （几何均值：√(10·100)≈31.6 ↔ 30，√(100·2600)≈510 ↔ 600，√(2600·14000)≈6033 ↔ 5000）。
 */
export const LEVEL_DISTANCE_ANCHORS: readonly number[] = [10, 100, 2600, 14000];

/**
 * 相机距离 → 连续层级（1.0–4.0 浮点数，需求 3.2.2）
 *
 * 用于跨层级 LOD 渐变、时间压缩比平滑插值与音景实时混合。
 */
export function continuousLevelForDistance(distanceSceneUnits: number): number {
  const anchors = LEVEL_DISTANCE_ANCHORS;
  const d = Math.max(distanceSceneUnits, 1e-6);
  if (d <= anchors[0]) return 1;
  if (d >= anchors[anchors.length - 1]) return 4;
  for (let i = 0; i < anchors.length - 1; i += 1) {
    if (d <= anchors[i + 1]) {
      const logLo = Math.log10(anchors[i]);
      const logHi = Math.log10(anchors[i + 1]);
      const t = (Math.log10(d) - logLo) / (logHi - logLo);
      return i + 1 + t;
    }
  }
  return 4;
}

/**
 * 连续层级 → 离散层级（就近取整，用于视角标签与离散逻辑兜底）
 */
export function discreteLevelFromContinuous(continuousLevel: number): ViewLevel {
  if (continuousLevel < 1.5) return 'L1';
  if (continuousLevel < 2.5) return 'L2';
  if (continuousLevel < 3.5) return 'L3';
  return 'L4';
}

/**
 * 连续层级 → 各层级混合权重（三角窗，相邻两层权重和为 1）
 *
 * 用于跨层级内容淡入淡出（LOD 渐变）与音景实时混合（需求 3.2.2 / 3.4.2）。
 */
export function levelBlendWeights(continuousLevel: number): Record<ViewLevel, number> {
  const f = Math.min(4, Math.max(1, continuousLevel));
  const weights: Record<ViewLevel, number> = { L1: 0, L2: 0, L3: 0, L4: 0 };
  const levels: ViewLevel[] = ['L1', 'L2', 'L3', 'L4'];
  for (let i = 0; i < levels.length; i += 1) {
    weights[levels[i]] = Math.max(0, 1 - Math.abs(f - (i + 1)));
  }
  return weights;
}

/**
 * 宇宙距离压缩的反函数：场景单位 → 光年
 */
export function inverseCosmicDistanceToLy(units: number): number {
  if (!Number.isFinite(units) || units < 0) {
    throw new RangeError(`场景距离必须为非负有限数，收到 ${units}`);
  }
  const linearMaxUnits = COSMIC_LINEAR_MAX_LY * SCENE_UNITS_PER_LY;
  if (units <= linearMaxUnits) {
    return units / SCENE_UNITS_PER_LY;
  }
  return COSMIC_LINEAR_MAX_LY * Math.pow(10, (units - linearMaxUnits) / COSMIC_LOG_UNITS);
}

/**
 * 尺度标尺（分层场景版）：按当前连续层级选择对应的尺度映射解释相机距离
 *
 * - L1/L2（f < 2.5）：1 AU = 10 单位（线性）
 * - L3（f < 3.5）：1 光年 = 0.05 单位（线性）
 * - L4：宇宙距离压缩的反函数
 *
 * 分层场景中同一场景距离在不同层级代表不同真实尺度（尺度归一化方案，
 * 需求 5.1），标尺按当前层级语义显示。
 */
export function formatSceneScaleLabel(distanceUnits: number, continuousLevel: number): string {
  if (continuousLevel < 2.5) {
    return formatScaleLabel(sceneUnitsToAu(distanceUnits));
  }
  if (continuousLevel < 3.5) {
    return formatScaleLabel((distanceUnits / SCENE_UNITS_PER_LY) * LIGHT_YEAR_AU);
  }
  return formatScaleLabel(inverseCosmicDistanceToLy(distanceUnits) * LIGHT_YEAR_AU);
}

/**
 * 梯形淡入淡出权重（跨层级 LOD 渐变，需求 3.2.2）
 *
 * x < x0 或 x > x3 时为 0；[x1, x2] 内为 1；两侧线性渐变。
 */
export function trapezoidWeight(
  x: number,
  x0: number,
  x1: number,
  x2: number,
  x3: number,
): number {
  if (!(x0 <= x1 && x1 <= x2 && x2 <= x3)) {
    throw new RangeError(`梯形节点必须非递减：${x0}, ${x1}, ${x2}, ${x3}`);
  }
  if (x <= x0 || x >= x3) return 0;
  if (x < x1) return (x - x0) / (x1 - x0);
  if (x <= x2) return 1;
  return (x3 - x) / (x3 - x2);
}

function formatNumber(value: number): string {
  if (value >= 1000) {
    return Math.round(value).toLocaleString('en-US');
  }
  if (value >= 100) return value.toFixed(0);
  if (value >= 1) return value.toFixed(1);
  return value.toPrecision(2);
}
