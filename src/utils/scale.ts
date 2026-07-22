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

function formatNumber(value: number): string {
  if (value >= 1000) {
    return Math.round(value).toLocaleString('en-US');
  }
  if (value >= 100) return value.toFixed(0);
  if (value >= 1) return value.toFixed(1);
  return value.toPrecision(2);
}
