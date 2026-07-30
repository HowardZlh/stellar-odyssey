/**
 * 费米气泡纯逻辑（R5-6，IMPROVEMENT_REQUIREMENTS_5 §R5-6）
 *
 * 纯逻辑模块（附录 A §3 纯函数先行）：为银河系 L4 增补提供银心上下
 * 双极椭球体积的密度采样器与包围盒几何常量；组件
 * （`Scene/FermiBubbles.tsx`）只消费本模块输出。
 *
 * ── 形态参数（Su, Slatyer & Finkbeiner 2010，Fermi-LAT，§0.4 登记）──────
 * 费米气泡为银心上下对称的双极伽马射线泡：银纬延伸至 |b| ≈ 50°
 * （按 R₀≈8.25 kpc 折算单泡高度 ~25,000 ly，需求指定量级同源）、
 * 银经宽度 ~40°（直径 ~20,000 ly 量级）、边缘相对锐利、内部辉光近均匀。
 * 本模块取单泡椭球近似：半轴 (9,500, 12,500, 9,500) ly、中心
 * (0, ±13,000, 0) ly（顶端 ~25,500 ly ≈ 文献高度；底部近银心平面），
 * 两泡经 SDF 平滑并在银心处收腰（沙漏形态）。
 *
 * ── 可见光艺术化（登记）─────────────────────────────────────────────────
 * 伽马射线（1–100 GeV）不可见；本项目按需求以"淡紫/品红极低透明度
 * 弥散辉光"艺术化呈现（组件侧双色档 + 低 intensity），非真实可见光
 * 形态——信息呈现于显示选项区说明文案（FERMI_BUBBLES_SOURCE_ZH）。
 *
 * ── 体积基元复用（§0.3 方案 H，勿新造塑形函数）──────────────────────────
 * 密度 = ellipsoidSdf ×2 → smoothUnionSdf → sdfDensityFalloff 软衰减
 * × fbm3 轻度斑驳调制（utils/volume 既有基元）；64³ R8 单通道纹理
 * （≈262 KB，附录 A ≤128³ 约束内），单纹理双泡（需求指定）。
 * 包围盒非立方（24,000 × 54,000 × 24,000 ly），各向异性光程经
 * `fermiBubblesWorldStepScale`（R5-2 uWorldStepScale 先例）修正。
 *
 * 确定性（附录 A §2）：采样器由确定性种子驱动（volumeSeed 由组件侧
 * 消费），同参数两次构建逐字节一致。
 */

import {
  ellipsoidSdf,
  fbm3,
  sdfDensityFalloff,
  smoothUnionSdf,
  type DensitySampler3,
} from '@/utils/volume';

/** 包围盒半宽（x/z，光年）：泡直径 ~20,000 ly + fBm 斑驳留边 */
export const FERMI_BUBBLE_HALF_EXTENT_XZ_LY = 12000;

/** 包围盒半高（y，光年）：单泡顶端 ~25,500 ly + 留边 */
export const FERMI_BUBBLE_HALF_EXTENT_Y_LY = 27000;

/** 单泡椭球水平半轴（光年，Su et al. 2010 银经宽度 ~40° 折算量级） */
export const FERMI_BUBBLE_LOBE_SEMI_XZ_LY = 9500;

/** 单泡椭球垂直半轴（光年） */
export const FERMI_BUBBLE_LOBE_SEMI_Y_LY = 11000;

/** 单泡椭球中心离银道面高度（光年；顶端 ≈ 25,500 ly ≈ |b|≈50° 折算；
 * 底部离银道面 3,500 ly——经 smoothUnion 收腰形成沙漏颈，目验调参） */
export const FERMI_BUBBLE_LOBE_CENTER_Y_LY = 14500;

/** 体积纹理边长（64³ 单纹理双泡，需求指定；附录 A ≤128 内） */
export const FERMI_BUBBLES_TEXTURE_SIZE = 64;

/** 显示选项区数据来源与艺术化登记文案（§0.4） */
export const FERMI_BUBBLES_SOURCE_ZH =
  '形态参数：Su, Slatyer & Finkbeiner 2010（Fermi-LAT，单泡 ~25,000 光年）；' +
  '伽马射线辉光以淡紫/品红低透明度艺术化呈现（非可见光真实形态）';

/** SDF 平滑并宽度（归一化坐标；银心处收腰的沙漏过渡带宽，目验调参） */
const LOBE_UNION_K = 0.14;

/** 密度软衰减宽度（归一化坐标；"弥散辉光"边缘羽化档，目验调参） */
const LOBE_FALLOFF_SOFTNESS = 0.14;

/** fBm 斑驳调制：基底 0.72 + 0.56·fBm（轻度不均匀，防均匀塑料感） */
const MOTTLE_BASE = 0.72;
const MOTTLE_SPAN = 0.56;
const MOTTLE_FREQUENCY = 2.2;

/**
 * 构建费米气泡密度采样器（归一化坐标 [-1,1]³ → 密度 [0,1]）
 *
 * 双极椭球（±y 各一泡）SDF 平滑并 → 软衰减 → fBm 轻度斑驳。
 * y=0 银道面附近仅保留收腰过渡（近银心低密度），远离双泡处为 0。
 *
 * @param seed 确定性种子（`volumeSeed(id)`，>>>0 归一）
 * @throws RangeError 当种子非有限数
 */
export function makeFermiBubblesSampler(seed: number): DensitySampler3 {
  if (!Number.isFinite(seed)) {
    throw new RangeError(`种子必须为有限数，收到 ${seed}`);
  }
  const s = seed >>> 0;
  // 归一化半轴/中心（除以各轴半宽——包围盒非立方，各轴独立归一）
  const rx = FERMI_BUBBLE_LOBE_SEMI_XZ_LY / FERMI_BUBBLE_HALF_EXTENT_XZ_LY;
  const ry = FERMI_BUBBLE_LOBE_SEMI_Y_LY / FERMI_BUBBLE_HALF_EXTENT_Y_LY;
  const cy = FERMI_BUBBLE_LOBE_CENTER_Y_LY / FERMI_BUBBLE_HALF_EXTENT_Y_LY;
  return (x, y, z) => {
    const dNorth = ellipsoidSdf(x, y - cy, z, rx, ry, rx);
    const dSouth = ellipsoidSdf(x, y + cy, z, rx, ry, rx);
    const shape = sdfDensityFalloff(smoothUnionSdf(dNorth, dSouth, LOBE_UNION_K), LOBE_FALLOFF_SOFTNESS);
    if (shape <= 0) return 0;
    const n = fbm3(x * MOTTLE_FREQUENCY, y * MOTTLE_FREQUENCY, z * MOTTLE_FREQUENCY, {
      seed: s,
    });
    return Math.min(1, shape * (MOTTLE_BASE + MOTTLE_SPAN * n));
  };
}

/**
 * 包围盒世界尺寸（场景单位；配合 BoxGeometry(1,1,1) 经 mesh.scale 控制）
 *
 * @param unitsPerLy 光年 → 场景单位比例（银河系组内 SCENE_UNITS_PER_LY）
 * @throws RangeError 当比例非正有限数
 */
export function fermiBubblesBoxScaleUnits(
  unitsPerLy: number,
): [number, number, number] {
  if (!Number.isFinite(unitsPerLy) || unitsPerLy <= 0) {
    throw new RangeError(`光年比例必须为正有限数，收到 ${unitsPerLy}`);
  }
  return [
    FERMI_BUBBLE_HALF_EXTENT_XZ_LY * 2 * unitsPerLy,
    FERMI_BUBBLE_HALF_EXTENT_Y_LY * 2 * unitsPerLy,
    FERMI_BUBBLE_HALF_EXTENT_XZ_LY * 2 * unitsPerLy,
  ];
}

/**
 * 各向异性光程缩放（R5-2 uWorldStepScale 口径：各轴世界尺寸按最长轴归一）
 */
export function fermiBubblesWorldStepScale(): [number, number, number] {
  const xz = FERMI_BUBBLE_HALF_EXTENT_XZ_LY / FERMI_BUBBLE_HALF_EXTENT_Y_LY;
  return [xz, 1, xz];
}
