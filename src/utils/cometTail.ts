/**
 * 彗尾方向 / 夹角 / 活动度公式（P4，需求 §4.7 彗星近观与彗尾增强）
 *
 * 从 Comet.tsx 内嵌逻辑抽取的纯函数模块（供单元测试）：
 * - 活动度：日心距 < 激活阈值时随距离线性增强（原有公式保持）
 * - 离子尾：严格背向太阳（太阳风电离气体沿磁场随太阳风径向吹出）
 * - 尘埃尾：尘埃颗粒受辐射压慢于彗核逃逸，滞留在轨道后方——
 *   尾轴偏向"反轨道速度方向"，弯曲曲率随轨道速度增大、随日心距减小
 *   （近日点掠过时两尾夹角变化最明显，需求验收项）
 *
 * 物理近似登记：尘埃尾真实形态为 syndyne/synchrone 曲线族，
 * 此处以"反日方向 + 垂直分量二次弯曲"近似，夹角量级与真实彗星
 * （数度至数十度）一致。
 */

import type { OrbitalElements, Vec3 } from '@/types';
import { heliocentricPosition } from '@/utils/physics';

/** 尘埃尾弯曲系数（速度/日心距 → 弯曲量的换算系数，视觉调校值） */
export const DUST_BEND_COEFF = 10;

/** 尘埃尾最大弯曲量（弯曲量 = 尾长的横向偏移比例上限） */
export const DUST_BEND_MAX = 0.85;

/** 彗尾最大长度（场景单位，活动度 = 1 时） */
export const TAIL_MAX_LENGTH_UNITS = 14;

/** 尘埃尾长度与离子尾长度之比（尘埃尾略短） */
export const DUST_TAIL_LENGTH_RATIO = 0.6;

/**
 * 彗尾活动度 [0,1]：日心距离 < 激活阈值后随接近太阳线性增强
 */
export function cometActivity01(distanceAu: number, activationAu: number): number {
  if (!(activationAu > 0)) {
    throw new RangeError(`激活阈值必须为正数，收到 ${activationAu}`);
  }
  return Math.max(0, Math.min(1, (activationAu - distanceAu) / activationAu));
}

/** 离子尾长度（场景单位） */
export function ionTailLengthUnits(activity01: number): number {
  return Math.max(0, Math.min(1, activity01)) * TAIL_MAX_LENGTH_UNITS;
}

/** 尘埃尾长度（场景单位） */
export function dustTailLengthUnits(activity01: number): number {
  return ionTailLengthUnits(activity01) * DUST_TAIL_LENGTH_RATIO;
}

function norm(v: Vec3): number {
  return Math.hypot(v.x, v.y, v.z);
}

/**
 * 离子尾方向：严格背向太阳（太阳位于场景原点）
 *
 * @param cometScenePos 彗核场景坐标
 */
export function ionTailDirection(cometScenePos: Vec3): Vec3 {
  const len = norm(cometScenePos);
  if (len < 1e-9) {
    throw new RangeError('彗核与太阳重合，无法定义彗尾方向');
  }
  return { x: cometScenePos.x / len, y: cometScenePos.y / len, z: cometScenePos.z / len };
}

/**
 * 轨道速度（AU/天，日心黄道坐标，中心差分）：
 * 用于尘埃尾弯曲方向与曲率（速度越快弯曲越明显）
 */
export function orbitalVelocityAuPerDay(
  orbit: OrbitalElements,
  simDays: number,
  dtDays = 0.05,
): Vec3 {
  if (!(dtDays > 0)) {
    throw new RangeError(`差分步长必须为正数，收到 ${dtDays}`);
  }
  const p0 = heliocentricPosition(orbit, simDays - dtDays);
  const p1 = heliocentricPosition(orbit, simDays + dtDays);
  return {
    x: (p1.x - p0.x) / (2 * dtDays),
    y: (p1.y - p0.y) / (2 * dtDays),
    z: (p1.z - p0.z) / (2 * dtDays),
  };
}

/**
 * 尘埃尾弯曲量 [0, DUST_BEND_MAX]：
 * bend = coeff · |v| / max(r, 0.2)——轨道速度越快、离太阳越近弯曲越大
 * （近日点掠过时两尾夹角变化清晰可见，需求验收项）
 *
 * @param speedAuPerDay 轨道速率（AU/天）
 * @param distanceAu 日心距离（AU）
 */
export function dustTailBendMagnitude(speedAuPerDay: number, distanceAu: number): number {
  if (speedAuPerDay < 0 || distanceAu < 0) {
    throw new RangeError(`速率与距离必须非负，收到 v=${speedAuPerDay}, r=${distanceAu}`);
  }
  return Math.min(DUST_BEND_MAX, (DUST_BEND_COEFF * speedAuPerDay) / Math.max(distanceAu, 0.2));
}

/**
 * 尘埃尾局部坐标系：尾轴 = 反日方向；弯曲方向 = 反轨道速度在
 * 垂直尾轴平面上的投影（尘埃滞留在轨道后方）。
 * 速度与尾轴平行（投影长度 ~0）时返回 null（弯曲退化，直尾）。
 *
 * @param antiSolarDir 反日方向（单位向量）
 * @param velocity 轨道速度（场景系同构坐标即可，仅取方向）
 */
export function dustTailBendDirection(antiSolarDir: Vec3, velocity: Vec3): Vec3 | null {
  const vLen = norm(velocity);
  if (vLen < 1e-12) return null;
  const retro = { x: -velocity.x / vLen, y: -velocity.y / vLen, z: -velocity.z / vLen };
  const dot = retro.x * antiSolarDir.x + retro.y * antiSolarDir.y + retro.z * antiSolarDir.z;
  const perp = {
    x: retro.x - antiSolarDir.x * dot,
    y: retro.y - antiSolarDir.y * dot,
    z: retro.z - antiSolarDir.z * dot,
  };
  const pLen = norm(perp);
  if (pLen < 1e-6) return null;
  return { x: perp.x / pLen, y: perp.y / pLen, z: perp.z / pLen };
}

/**
 * 尘埃尾横向弯曲偏移（shader 顶点位移镜像）：
 * offset(t) = bend · t²（t = 沿尾轴归一化距离 0-1，尾根 0、尾端最大，
 * 二次曲线近似 syndyne 弯曲形态）
 */
export function dustTailBendOffset(t01: number, bendMagnitude: number): number {
  const t = Math.min(1, Math.max(0, t01));
  return bendMagnitude * t * t;
}

/**
 * 两尾夹角（度）：离子尾轴与"尘埃尾尾端弦方向"的夹角
 * （尾端横向偏移 bend·L 相对尾长 L 的张角），供测试与验收核对
 */
export function tailSeparationAngleDeg(bendMagnitude: number): number {
  return (Math.atan(Math.max(0, bendMagnitude)) * 180) / Math.PI;
}
