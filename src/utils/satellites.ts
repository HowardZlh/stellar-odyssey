/**
 * 卫星系统的视觉尺度策略（需求 3.1.1）
 *
 * 人造卫星与月球轨道高度差异巨大（约 400 km vs 38 万 km），
 * 且真实轨道半径换算成场景单位远小于行星的视觉半径（对数压缩后），
 * 必须采用分层缩放策略——在此登记（需求 4.1 视觉夸大处理原则）：
 *
 * - 自然卫星轨道：r = R_p + 0.6 + 1.2·log10(1 + a_km / 100000)
 *   保持"轨道更远的卫星画得更远"的排序与共振可视化（木卫 1:2:4 间距递增）
 * - 人造卫星轨道：r = R_p + 0.15 + 0.35·log10(1 + h_km / 200)（h 为轨道高度）
 *   保证 ISS（400km）、哈勃（540km）贴近行星表面且相互可分辨，
 *   同时与月球轨道保持明显分层（月球 ≈ R_p + 1.42，ISS ≈ R_p + 0.32）
 * - 行星环：内外缘均按自然卫星轨道公式映射后绕中心扩展 2 倍宽度，
 *   保证环与卫星轨道（如土卫二在环外）的相对顺序正确
 *
 * 真实轨道参数保留在数据层（MoonData.orbit），仅渲染半径做视觉映射。
 */

import type { SatelliteKind } from '@/types';
import { RADIUS_LOG_REF_KM, visualBodyRadius } from '@/utils/scale';

/** 自然卫星轨道映射参数 */
export const NATURAL_ORBIT_BASE_UNITS = 0.6;
export const NATURAL_ORBIT_LOG_UNITS = 1.2;
export const NATURAL_ORBIT_REF_KM = 100000;

/** 人造卫星轨道映射参数（以轨道高度为输入） */
export const ARTIFICIAL_ORBIT_BASE_UNITS = 0.15;
export const ARTIFICIAL_ORBIT_LOG_UNITS = 0.35;
export const ARTIFICIAL_ORBIT_REF_ALTITUDE_KM = 200;

/** 卫星本体最小视觉半径（场景单位） */
export const MIN_MOON_VISUAL_RADIUS = 0.1;
/** 人造卫星固定视觉尺寸（真实尺寸约百米级，不可见，登记为示意尺寸） */
export const ARTIFICIAL_BODY_VISUAL_RADIUS = 0.06;

/** 行星环视觉宽度扩展倍数（登记的视觉夸大） */
export const RING_WIDTH_SPREAD = 2;

/**
 * 卫星轨道的视觉半径（场景单位，相对行星中心）
 *
 * @param kind 自然 / 人造
 * @param parentRadiusKm 行星真实半径（km）
 * @param semiMajorAxisKm 卫星轨道半长轴（km，相对行星中心）
 */
export function visualSatelliteOrbitRadius(
  kind: SatelliteKind,
  parentRadiusKm: number,
  semiMajorAxisKm: number,
): number {
  if (semiMajorAxisKm <= parentRadiusKm) {
    throw new RangeError(
      `卫星轨道半长轴（${semiMajorAxisKm} km）必须大于行星半径（${parentRadiusKm} km）`,
    );
  }
  const parentVisual = visualBodyRadius(parentRadiusKm);
  if (kind === 'artificial') {
    const altitudeKm = semiMajorAxisKm - parentRadiusKm;
    return (
      parentVisual +
      ARTIFICIAL_ORBIT_BASE_UNITS +
      ARTIFICIAL_ORBIT_LOG_UNITS *
        Math.log10(1 + altitudeKm / ARTIFICIAL_ORBIT_REF_ALTITUDE_KM)
    );
  }
  return (
    parentVisual +
    NATURAL_ORBIT_BASE_UNITS +
    NATURAL_ORBIT_LOG_UNITS * Math.log10(1 + semiMajorAxisKm / NATURAL_ORBIT_REF_KM)
  );
}

/**
 * 卫星本体的视觉半径（场景单位）
 */
export function visualSatelliteBodyRadius(kind: SatelliteKind, radiusKm: number): number {
  if (kind === 'artificial') {
    return ARTIFICIAL_BODY_VISUAL_RADIUS;
  }
  if (radiusKm <= 0) {
    throw new RangeError(`卫星半径必须为正数，收到 ${radiusKm}`);
  }
  // 自然卫星复用行星的对数压缩公式（不含行星的最小半径钳制，
  // 否则月球与土卫二会被压到同一下限失去大小区分），下限单独取更小值
  const compressed = 0.9 * Math.log10(1 + radiusKm / RADIUS_LOG_REF_KM);
  return Math.max(MIN_MOON_VISUAL_RADIUS, compressed);
}

/**
 * 行星环内外缘的视觉半径（场景单位）
 *
 * 内外缘先按自然卫星轨道公式映射，再绕中心扩展 RING_WIDTH_SPREAD 倍宽度
 * （否则对数压缩后环过窄），排序关系（环外卫星仍在环外）保持不变。
 */
export function visualRingRadii(
  parentRadiusKm: number,
  innerRadiusKm: number,
  outerRadiusKm: number,
): { innerUnits: number; outerUnits: number } {
  if (outerRadiusKm <= innerRadiusKm) {
    throw new RangeError('环外缘半径必须大于内缘半径');
  }
  const inner = visualSatelliteOrbitRadius('natural', parentRadiusKm, innerRadiusKm);
  const outer = visualSatelliteOrbitRadius('natural', parentRadiusKm, outerRadiusKm);
  const center = (inner + outer) / 2;
  const halfWidth = ((outer - inner) / 2) * RING_WIDTH_SPREAD;
  return { innerUnits: center - halfWidth, outerUnits: center + halfWidth };
}

/**
 * 潮汐锁定自转角（弧度）：自转与公转同步，始终同一面朝向行星（需求 3.1.1 月球）
 *
 * @param orbitAngleRad 卫星当前轨道相位角（弧度）
 */
export function tidalLockedRotationAngle(orbitAngleRad: number): number {
  return orbitAngleRad + Math.PI;
}
