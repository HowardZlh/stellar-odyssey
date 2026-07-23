/**
 * 卫星地影判定（P7 §3.1 可选项：卫星进入地球本影时变暗）
 *
 * 纯逻辑模块（供单元测试）。几何近似（登记）：
 * - 地球本影按圆柱近似（真实本影为长约 138 万 km 的锥体，卫星轨道
 *   高度 < 3.6 万 km 处锥体收缩 < 3%，圆柱近似误差可忽略）；
 * - 半影按本影边缘 smoothstep 软化表达（真实半影宽度量级一致）；
 * - 阴影中保留少量环境光（SHADOW_MIN_LIGHT），保证卫星近观不全黑
 *   （可视化需要，登记为艺术化处理——真实本影中航天器仅有地气辉光照）。
 *
 * 适用于任意以行星为中心的卫星（默认用于地球）。
 */

import type { Vec3Like } from '@/utils/satelliteAttitude';

/** 本影内保留的最低光照系数（登记的艺术化处理） */
export const SHADOW_MIN_LIGHT = 0.18;

/** 本影圆柱半径系数（内缘全影）与半影软化外缘系数 */
export const UMBRA_INNER_FACTOR = 0.92;
export const UMBRA_OUTER_FACTOR = 1.12;

/**
 * 地影光照因子 [0,1]：1 = 全光照，0 = 本影核心。
 *
 * @param satPos 卫星相对行星中心的位置（场景单位，任意坐标系）
 * @param planetRadiusUnits 行星显示半径（场景单位，与渲染一致）
 * @param sunDirFromPlanet 行星中心指向太阳的单位向量（与 satPos 同坐标系）
 */
export function earthShadowLight01(
  satPos: Vec3Like,
  planetRadiusUnits: number,
  sunDirFromPlanet: Vec3Like,
): number {
  if (!(planetRadiusUnits > 0) || !Number.isFinite(planetRadiusUnits)) {
    throw new RangeError(`行星半径必须为正有限数，收到 ${planetRadiusUnits}`);
  }
  const axial = satPos.x * sunDirFromPlanet.x + satPos.y * sunDirFromPlanet.y + satPos.z * sunDirFromPlanet.z;
  // 向阳侧：不进入本影
  if (axial >= 0) return 1;
  // 垂直本影轴的距离
  const px = satPos.x - axial * sunDirFromPlanet.x;
  const py = satPos.y - axial * sunDirFromPlanet.y;
  const pz = satPos.z - axial * sunDirFromPlanet.z;
  const perp = Math.hypot(px, py, pz);
  const inner = planetRadiusUnits * UMBRA_INNER_FACTOR;
  const outer = planetRadiusUnits * UMBRA_OUTER_FACTOR;
  if (perp <= inner) return 0;
  if (perp >= outer) return 1;
  const t = (perp - inner) / (outer - inner);
  return t * t * (3 - 2 * t);
}

/**
 * 光照因子 → 材质亮度系数：本影内保留 SHADOW_MIN_LIGHT 环境底光。
 */
export function shadowDimFactor(light01: number): number {
  const l = Math.min(1, Math.max(0, light01));
  return SHADOW_MIN_LIGHT + (1 - SHADOW_MIN_LIGHT) * l;
}
