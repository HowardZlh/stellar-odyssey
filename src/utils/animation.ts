/**
 * 动画工具：缓动函数与相机状态插值（需求 3.2.1 视角平滑过渡）
 */

import type { CameraState, Vec3 } from '@/types';

/**
 * 线性插值
 */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * 三维向量线性插值
 */
export function lerpVec3(a: Vec3, b: Vec3, t: number): Vec3 {
  return {
    x: lerp(a.x, b.x, t),
    y: lerp(a.y, b.y, t),
    z: lerp(a.z, b.z, t),
  };
}

/**
 * 缓入缓出（cubic），视角切换的标准缓动
 */
export function easeInOutCubic(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return clamped < 0.5 ? 4 * clamped * clamped * clamped : 1 - Math.pow(-2 * clamped + 2, 3) / 2;
}

/**
 * 相机状态插值：位置、目标、FOV 同步缓动（需求 3.2.1）
 *
 * @param t 原始进度 [0, 1]，内部应用缓动
 */
export function interpolateCameraState(from: CameraState, to: CameraState, t: number): CameraState {
  const eased = easeInOutCubic(t);
  return {
    position: lerpVec3(from.position, to.position, eased),
    target: lerpVec3(from.target, to.target, eased),
    fov: lerp(from.fov, to.fov, eased),
  };
}

/**
 * 过渡进度推进（纯函数）：返回新进度，超过 1 则钳制为 1
 *
 * @param progress 当前进度
 * @param deltaSeconds 帧间隔
 * @param durationSeconds 过渡总时长（秒）
 */
export function advanceTransitionProgress(
  progress: number,
  deltaSeconds: number,
  durationSeconds: number,
): number {
  if (durationSeconds <= 0) return 1;
  return Math.min(1, progress + deltaSeconds / durationSeconds);
}
