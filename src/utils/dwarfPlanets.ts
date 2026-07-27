/**
 * 矮行星显示策略（P5 §3.2 / §3.4，纯逻辑模块，供单元测试）
 *
 * 视觉夸大登记（需求 4.1，与 utils/scale.ts 登记体系一致）：
 * - 默认（非真实比例）模式下，矮行星显示半径最小钳制值由全局 MIN_VISUAL_RADIUS
 *   （0.3）提升至 DWARF_MIN_VISUAL_RADIUS（0.42）——与水星在 L2 下的视觉尺寸
 *   （visualBodyRadius(2439.7) ≈ 0.35）同量级，且大于柯伊伯带粒子尺寸（0.4），
 *   保证 L2 太阳系视角下 5 颗矮行星为可辨识的独立天体、不湮没于带内粒子
 *   （P5 §3.2 核心痛点：30–68 AU 远处压缩后仅 0.3 单位几乎不可见）。
 * - 真实比例模式不夸大：与八大行星同规则线性映射（realBodyRadius），
 *   矮行星过小不可见属科学事实（帮助/信息面板中说明）。
 *
 * 妊神星三轴椭球（真实形状，非夸大）：
 * - 轴径 2100×1680×1074 km（Ortiz et al. 2017 掩星测量），3.9 h 快速自转甩扁，
 *   为已知矮行星中自转最快；真实比例/默认模式均按该轴比缩放球体网格。
 * - 自转轴为最短轴（c 轴），对应场景网格的 Y 轴（自转绕 Y），
 *   长轴在赤道面内随自转翻滚可见。
 */

import { realBodyRadius, visualBodyRadius } from '@/utils/scale';

/** 矮行星最小可见半径（场景单位，默认模式视觉夸大，登记见文件头） */
export const DWARF_MIN_VISUAL_RADIUS = 0.42;

/**
 * 矮行星显示半径统一入口（P5 §3.2）：
 * 真实比例模式按真实线性映射（不可见为科学事实）；
 * 默认模式对数压缩后钳制到 DWARF_MIN_VISUAL_RADIUS 保证 L2 可辨识。
 */
export function dwarfDisplayRadius(radiusKm: number, realScale: boolean): number {
  if (radiusKm <= 0) {
    throw new RangeError(`天体半径必须为正数，收到 ${radiusKm}`);
  }
  if (realScale) {
    return realBodyRadius(radiusKm);
  }
  return Math.max(DWARF_MIN_VISUAL_RADIUS, visualBodyRadius(radiusKm));
}

/** 妊神星三轴椭球轴径（km，Ortiz et al. 2017 掩星测量） */
export const HAUMEA_ELLIPSOID_AXES_KM = { a: 2100, b: 1680, c: 1074 } as const;

/**
 * 妊神星椭球缩放系数 [x, y, z]（P5 §3.4 形态特殊性）：
 * 以数据层平均半径 meanRadiusKm 为基准球半径，按真实半轴比缩放——
 * x = a/2/R̄（长轴）、z = b/2/R̄（中轴，均在赤道面内）、
 * y = c/2/R̄（短轴 = 自转轴，网格绕 Y 自转 → 长轴翻滚可见）。
 */
export function haumeaEllipsoidScale(meanRadiusKm: number): [number, number, number] {
  if (meanRadiusKm <= 0) {
    throw new RangeError(`平均半径必须为正数，收到 ${meanRadiusKm}`);
  }
  return [
    HAUMEA_ELLIPSOID_AXES_KM.a / 2 / meanRadiusKm,
    HAUMEA_ELLIPSOID_AXES_KM.c / 2 / meanRadiusKm,
    HAUMEA_ELLIPSOID_AXES_KM.b / 2 / meanRadiusKm,
  ];
}

/**
 * 天体是否按矮行星显示策略处理（数据层以 classificationZh 标注）
 */
export function isDwarfPlanetClassification(classificationZh: string | undefined): boolean {
  return classificationZh === '矮行星';
}
