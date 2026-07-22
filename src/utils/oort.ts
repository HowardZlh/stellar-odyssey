/**
 * 奥尔特云外边界示意（可选需求 3.1.1）
 *
 * 真实奥尔特云：太阳系最外围的球壳状彗星库，内缘约 2,000 AU，
 * 外缘约 100,000 AU（约 1.58 光年），是太阳引力主导范围的边界。
 * 来源：NASA Solar System Exploration – Oort Cloud。
 *
 * 视觉夸大登记（需求 4.1）：
 * 真实外缘 100,000 AU × 10 单位/AU = 10⁶ 场景单位，远超 L4 相机锚点，
 * 无法在"太阳系视角与银河系视角之间的过渡"位置显示。
 * 此处将示意球壳压缩至 OORT_VISUAL_RADIUS_UNITS（约 1,600 场景单位，
 * 位于 L2 锚点 100 与 L3 锚点 2600 之间），作为跨层级缩放的过渡参照物；
 * 真实范围在信息面板中如实标注。
 */

import type { Vec3 } from '@/types';
import { createSeededRandom } from '@/utils/random';

/** 奥尔特云真实内缘（AU） */
export const OORT_INNER_AU = 2000;

/** 奥尔特云真实外缘（AU，约 1.58 光年） */
export const OORT_OUTER_AU = 100000;

/** 示意球壳半径（场景单位，视觉压缩已登记于文件头） */
export const OORT_VISUAL_RADIUS_UNITS = 1600;

/** 示意球壳厚度（占半径比例） */
export const OORT_SHELL_THICKNESS_01 = 0.12;

/** 示意粒子数 */
export const OORT_PARTICLE_COUNT = 2600;

/** 确定性种子 */
export const OORT_SEED = 20260726;

/**
 * 确定性生成球壳粒子（奥尔特云外边界示意）
 *
 * 粒子均匀分布于球面（cos极角均匀采样），半径在
 * [radius·(1 − thickness01), radius] 内抖动形成厚度。
 *
 * @returns 粒子位置（count*3，场景单位，Float32Array 可直接上传 GPU）
 */
export function generateOortShellPoints(
  count: number,
  radiusUnits: number,
  thickness01: number,
  seed: number,
): Float32Array {
  if (count <= 0 || !Number.isInteger(count)) {
    throw new RangeError(`粒子数必须为正整数，收到 ${count}`);
  }
  if (radiusUnits <= 0) {
    throw new RangeError(`球壳半径必须为正数，收到 ${radiusUnits}`);
  }
  if (thickness01 < 0 || thickness01 >= 1) {
    throw new RangeError(`厚度比例必须在 [0, 1) 内，收到 ${thickness01}`);
  }
  const rand = createSeededRandom(seed);
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    const r = radiusUnits * (1 - thickness01 * rand());
    const cosPolar = rand() * 2 - 1;
    const azimuth = Math.PI * 2 * rand();
    const sinPolar = Math.sqrt(1 - cosPolar * cosPolar);
    positions[i * 3] = r * sinPolar * Math.cos(azimuth);
    positions[i * 3 + 1] = r * cosPolar;
    positions[i * 3 + 2] = r * sinPolar * Math.sin(azimuth);
  }
  return positions;
}

/**
 * 奥尔特云球壳上的确定性参考点（标签定位等）
 */
export function oortShellReferencePoint(radiusUnits: number): Vec3 {
  return { x: radiusUnits * 0.7071, y: radiusUnits * 0.5, z: -radiusUnits * 0.5 };
}
