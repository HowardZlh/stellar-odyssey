/**
 * 行星光影解析计算（P3-4，需求 §4.6 行星光影——物理真实，无需夸大登记）
 *
 * 光照模型近似说明：
 * - 光源为太阳（场景原点），按方向光处理（太阳距行星远大于行星半径，
 *   忽略太阳角直径带来的半影，采用 smoothstep 软化近似半影过渡）
 * - 昼夜明暗界线（terminator）：法线与日照方向点积经 smoothstep 柔和过渡
 * - 土星环投影：环为行星赤道面上的共面圆盘，表面点沿日照方向反向与
 *   环平面求交（几何解析，成本低于 shadow map）；环在行星上的影深由
 *   环纹理 alpha 决定（卡西尼缝处透光）
 * - 行星在环面上的阴影：环上点朝太阳的射线与行星球体求交（球体遮挡判定）
 *
 * 本模块为渲染 shader 的纯逻辑镜像，供单元测试验证几何解析正确性；
 * GLSL 实现见 components/CelestialBody/Planet.tsx。
 */

import type { Vec3 } from '@/types';

/** terminator 柔和过渡半宽（点积域）：受光面→背光面的渐变区间 */
export const TERMINATOR_SOFTNESS = 0.18;

/** 环投影最大遮光比例（环纹理 alpha = 1 时表面变暗到 1 - 该值） */
export const RING_SHADOW_STRENGTH = 0.85;

/** smoothstep（GLSL 语义镜像） */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge0 >= edge1) {
    throw new RangeError(`smoothstep 要求 edge0 < edge1，收到 ${edge0}, ${edge1}`);
  }
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * 昼夜明暗因子（0 = 全夜，1 = 全昼）
 *
 * @param ndl 表面法线与日照方向点积（N·L）
 * @param softness 过渡半宽（默认 TERMINATOR_SOFTNESS）
 */
export function dayFactor(ndl: number, softness = TERMINATOR_SOFTNESS): number {
  return smoothstep(-softness, softness, ndl);
}

/**
 * 明暗界线暖色带权重（气态行星云带在 terminator 处的色温渐变，需求 §4.6）：
 * 在昼夜过渡带（day≈0.1–0.6）出现峰值，全昼/全夜两侧为 0。
 */
export function terminatorWarmBand(day01: number): number {
  const d = Math.min(1, Math.max(0, day01));
  return smoothstep(0.02, 0.3, d) * (1 - smoothstep(0.3, 0.75, d));
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function length(a: Vec3): number {
  return Math.sqrt(dot(a, a));
}

function normalize(a: Vec3): Vec3 {
  const len = length(a);
  if (len === 0) {
    throw new RangeError('零向量无法归一化');
  }
  return { x: a.x / len, y: a.y / len, z: a.z / len };
}

/**
 * 土星环在行星表面的投影采样（太阳位于场景原点）：
 * 从表面点朝太阳方向的射线与环平面求交，命中环环带（inner–outer）时
 * 返回径向位置 radial01（供采样环纹理 alpha），否则返回 null。
 *
 * @param surfacePoint 行星表面点（世界坐标）
 * @param planetCenter 行星中心（世界坐标）
 * @param ringNormal 环平面法线（单位向量，行星赤道面法线）
 * @param ringInner 环内缘半径（场景单位）
 * @param ringOuter 环外缘半径（场景单位）
 */
export function ringShadowRadial01(
  surfacePoint: Vec3,
  planetCenter: Vec3,
  ringNormal: Vec3,
  ringInner: number,
  ringOuter: number,
): number | null {
  if (!(ringInner > 0 && ringOuter > ringInner)) {
    throw new RangeError(`环半径非法：inner=${ringInner}, outer=${ringOuter}`);
  }
  // 日照方向：表面点 → 太阳（原点）
  const sunDir = normalize({ x: -surfacePoint.x, y: -surfacePoint.y, z: -surfacePoint.z });
  const denom = dot(ringNormal, sunDir);
  if (Math.abs(denom) < 1e-6) return null; // 射线与环面平行
  const t = dot(ringNormal, sub(planetCenter, surfacePoint)) / denom;
  if (t <= 0) return null; // 交点在背离太阳一侧（环不在表面点与太阳之间）
  const hit: Vec3 = {
    x: surfacePoint.x + sunDir.x * t,
    y: surfacePoint.y + sunDir.y * t,
    z: surfacePoint.z + sunDir.z * t,
  };
  const r = length(sub(hit, planetCenter));
  if (r < ringInner || r > ringOuter) return null;
  return (r - ringInner) / (ringOuter - ringInner);
}

/**
 * 行星在环面上的阴影因子（0 = 全影，1 = 无遮挡）：
 * 环上点朝太阳（原点）的射线被行星球体遮挡时进入阴影，
 * 距行星轮廓边缘 ±8% 半径内 smoothstep 软化（近似半影）。
 *
 * @param ringPoint 环上点（世界坐标）
 * @param planetCenter 行星中心（世界坐标）
 * @param planetRadius 行星半径（场景单位）
 */
export function planetShadowOnRing(
  ringPoint: Vec3,
  planetCenter: Vec3,
  planetRadius: number,
): number {
  if (planetRadius <= 0) {
    throw new RangeError(`行星半径必须为正数，收到 ${planetRadius}`);
  }
  const sunDist = length(ringPoint);
  if (sunDist === 0) return 1;
  const sunDir = { x: -ringPoint.x / sunDist, y: -ringPoint.y / sunDist, z: -ringPoint.z / sunDist };
  const toCenter = sub(planetCenter, ringPoint);
  const tca = dot(toCenter, sunDir);
  // 行星必须位于环上点与太阳之间才可能遮挡
  if (tca <= 0 || tca >= sunDist) return 1;
  const closest: Vec3 = {
    x: toCenter.x - sunDir.x * tca,
    y: toCenter.y - sunDir.y * tca,
    z: toCenter.z - sunDir.z * tca,
  };
  const d = length(closest);
  // 软化半影：轮廓边缘 ±8% 渐变；核心阴影保留 18% 环境光避免死黑
  return 0.18 + 0.82 * smoothstep(planetRadius * 0.92, planetRadius * 1.08, d);
}

/**
 * 行星轴倾角（绕场景 Z 轴旋转 tiltRad）对应的赤道面法线（世界坐标）：
 * 未倾斜时为 +Y，倾斜后 (−sin t, cos t, 0)。环平面法线由此得到。
 */
export function axialTiltNormal(tiltRad: number): Vec3 {
  return { x: -Math.sin(tiltRad), y: Math.cos(tiltRad), z: 0 };
}
