/**
 * 本星系群程序化星系贴图色调（SC4-2，REQUIREMENTS_STAR_COLORS §SC4-2）
 *
 * `Universe.tsx` GalaxyObject 程序化 canvas 回退贴图的色调唯一出口：
 * 按各星系真实整体 B−V 色指数（`data/galaxies.GALAXY_BV_COLOR_INDEX`
 * 文献值登记）→ `bvToTeffK`（Ballesteros 2012）→ `blackbodyRGB`
 * （Mitchell Charity CIE 黑体色表）转为 canvas 渐变基色（sRGB hex，
 * canvas 为 sRGB 工作空间且贴图已声明 SRGBColorSpace）。
 *
 * 零改动保障（§SC4-2 红线）：
 * - 有 R5-1 真实影像贴图的星系（`galaxyNearView.IMAGE_DRIVEN_GALAXY_IDS`：
 *   m31/m33/lmc/smc）恒返回历史双色——其程序化 canvas 仅作影像加载完成前
 *   的兜底，保持逐字节零变化；
 * - 未登记 B−V 的星系回退历史双色（椭圆 `#ffe2b8` / 其余 `#cfd8ff`），
 *   行为与 SC4 前一致。
 *
 * 范围外登记：ExtragalacticObjects.tsx 远景背景星系群（示意氛围层，
 * 非本星系群实体星系）不经本出口，保持现状。
 */

import { GALAXY_BV_COLOR_INDEX } from '@/data/galaxies';
import type { GalaxyMorphology } from '@/types';
import { isImageDrivenGalaxy } from '@/utils/galaxyNearView';
import { bvToTeffK } from '@/utils/pleiadesCatalog';
import { blackbodyRGB } from '@/utils/starPhysics';

/** SC4 前历史色调：椭圆星系（暖黄白） */
export const LEGACY_ELLIPTICAL_TINT_HEX = '#ffe2b8';

/** SC4 前历史色调：旋涡/棒旋/不规则星系（冷蓝白） */
export const LEGACY_DISK_TINT_HEX = '#cfd8ff';

/** sRGB 0–1 分量 → 两位十六进制 */
function hex2(c01: number): string {
  const v = Math.round(Math.min(1, Math.max(0, c01)) * 255);
  return v.toString(16).padStart(2, '0');
}

/**
 * B−V 色指数 → sRGB hex 色调（B−V 越大色温越低越偏红黄，逐段单调）
 *
 * @param bv B−V 色指数（须为有限数，`bvToTeffK` 域内钳制）
 * @throws RangeError 当 bv 非有限数（由 `bvToTeffK` 抛出）
 */
export function bvTintHex(bv: number): string {
  const c = blackbodyRGB(bvToTeffK(bv));
  return `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`;
}

/** 按形态返回 SC4 前历史双色（程序化 canvas 原口径） */
export function legacyGalaxyTintHex(morphology: GalaxyMorphology): string {
  return morphology === 'elliptical' ? LEGACY_ELLIPTICAL_TINT_HEX : LEGACY_DISK_TINT_HEX;
}

/**
 * GalaxyObject 程序化 canvas 贴图色调（SC4-2 唯一出口）
 *
 * 影像贴图星系（R5-1）与未登记 B−V 的星系返回历史双色（零改动）；
 * 其余按文献 B−V 转黑体色调。
 */
export function galaxySpriteTintHex(id: string, morphology: GalaxyMorphology): string {
  if (isImageDrivenGalaxy(id)) return legacyGalaxyTintHex(morphology);
  const bv = GALAXY_BV_COLOR_INDEX[id];
  if (bv === undefined) return legacyGalaxyTintHex(morphology);
  return bvTintHex(bv);
}
