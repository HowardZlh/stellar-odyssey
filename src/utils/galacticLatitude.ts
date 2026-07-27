/**
 * 银河系视角天体垂直展开纯逻辑（R3-6，IMPROVEMENT_REQUIREMENTS_3 §6.1）
 *
 * 背景：L3 特殊天体的 offsetLy.y 原为示意值（垂直/水平比中位数 ≈0.12），
 * 天体折算后淹没在银盘粒子云厚度内，观感"挤在一个平面上"（用户反馈）。
 * 两层方案：
 * 1. 数据修正（默认生效）：sun-relative 天体 offsetLy.y 按真实银纬 b 重定
 *    y = round(√(x²+z²) × tan(b))——"从太阳看的方向按真实银纬、水平距离示意"
 *    口径（b 值来源 SIMBAD，逐天体登记于 data/specialBodies.ts）。
 * 2. 展开开关（观察辅助）：开启后 offset.y 乘展开增益（滑块 [1,6]、默认 ×3、
 *    步进 0.5），约 1 秒平滑过渡，并显示每天体高度指示线。
 *
 * 视觉夸大登记（AGENTS.md 数据准确性要求）：
 * - 展开增益为**观察辅助的视觉夸大**，非科学事实；高度指示线标注展示的是
 *   未乘增益的银纬推算真实高度（示意水平距离 × tan(b)）；
 * - 展开范围（R3-7 扩展）：13 个 L3 特殊天体（sgr-a-star 为银心原点无
 *   offset 不参与）+ 银盘 40,000 粒子随同一生效增益 morph 为扁旋转椭球体
 *   （diskMorphWeight 派生权重，×1→0、×6→1.0 完整轴比 0.5）+ 超新星事件
 *   与遗迹随盘 morph（morphGalacticYLy，R3-7 行为变更——推翻 R3-6"超新星
 *   不参与展开"登记）；银晕粒子/球状星团（本已球状分布）与太阳系标记/
 *   尾迹/预测线/银河年刻度不参与 morph；太阳垂直振荡 ×10 增益
 *   （galacticMotionCues.ts）机制不变，与展开增益互不相乘。
 * - morph 权衡登记：morph 只重映射 y、x/z 不动 → 正面/俯视轮廓仍为圆形、
 *   旋臂俯视可辨；侧视旋臂图案被垂直弥散（俯视仍清晰）。
 */

import { easeInOutCubic } from '@/utils/animation';

/** 展开增益滑块最小值（×1 = 不展开） */
export const GALAXY_EXPAND_GAIN_MIN = 1;

/** 展开增益滑块最大值 */
export const GALAXY_EXPAND_GAIN_MAX = 6;

/** 展开增益默认值（用户确认项 2：滑块可调，默认 ×3） */
export const GALAXY_EXPAND_GAIN_DEFAULT = 3;

/** 展开增益滑块步进 */
export const GALAXY_EXPAND_GAIN_STEP = 0.5;

/** 展开开关过渡时长（秒）：生效增益 1 ↔ 滑块值 的平滑过渡 */
export const GALAXY_EXPAND_TRANSITION_SECONDS = 1;

/**
 * 滑块值平滑跟随速率（增益单位/秒）：滑块拖动期间生效增益以该速率
 * 追踪新值（全量程 [1,6] 约 1 秒走完），避免 0.5 步进的位置跳变。
 */
export const GALAXY_EXPAND_GAIN_RATE_PER_SECOND =
  (GALAXY_EXPAND_GAIN_MAX - GALAXY_EXPAND_GAIN_MIN) / GALAXY_EXPAND_TRANSITION_SECONDS;

/**
 * 按真实银纬推算垂直偏移：y = horizontalLy × tan(latitudeDeg)
 *
 * 口径："从太阳看的方向按真实银纬、水平距离示意"——x/z 为既有视觉示意值，
 * y 由示意水平距离与真实银纬联立推出（四舍五入到整数光年）。
 *
 * @param horizontalLy 水平距离 √(x²+z²)（光年，≥0）
 * @param latitudeDeg 银纬 b（度，|b| < 90）
 * @throws RangeError 非有限输入 / horizontalLy < 0 / |b| ≥ 90
 */
export function offsetYFromLatitude(horizontalLy: number, latitudeDeg: number): number {
  if (!Number.isFinite(horizontalLy) || horizontalLy < 0) {
    throw new RangeError(`水平距离必须为非负有限数，收到 ${horizontalLy}`);
  }
  if (!Number.isFinite(latitudeDeg) || Math.abs(latitudeDeg) >= 90) {
    throw new RangeError(`银纬必须为 (−90°, 90°) 内的有限数，收到 ${latitudeDeg}`);
  }
  return Math.round(horizontalLy * Math.tan((latitudeDeg * Math.PI) / 180));
}

/**
 * 展开增益滑块值钳制到 [GALAXY_EXPAND_GAIN_MIN, GALAXY_EXPAND_GAIN_MAX]
 *
 * @throws RangeError 非有限输入
 */
export function clampExpandGain(value: number): number {
  if (!Number.isFinite(value)) {
    throw new RangeError(`展开增益必须为有限数，收到 ${value}`);
  }
  return Math.min(GALAXY_EXPAND_GAIN_MAX, Math.max(GALAXY_EXPAND_GAIN_MIN, value));
}

/**
 * 滑块值平滑跟随（帧推进）：当前值以恒定速率向目标滑块值靠拢
 *
 * @param current 当前平滑值
 * @param target 目标滑块值（内部钳制到合法范围）
 * @param deltaSeconds 帧时长（秒，负值按 0 处理）
 * @param ratePerSecond 跟随速率（默认全量程约 1 秒）
 */
export function advanceExpandGainValue(
  current: number,
  target: number,
  deltaSeconds: number,
  ratePerSecond = GALAXY_EXPAND_GAIN_RATE_PER_SECOND,
): number {
  if (!(ratePerSecond > 0)) {
    throw new RangeError(`跟随速率必须为正数，收到 ${ratePerSecond}`);
  }
  const clampedTarget = clampExpandGain(target);
  const from = clampExpandGain(current);
  const step = Math.max(0, deltaSeconds) * ratePerSecond;
  if (clampedTarget > from) return Math.min(clampedTarget, from + step);
  return Math.max(clampedTarget, from - step);
}

/**
 * 当前帧生效展开增益：开关线性进度经 easeInOutCubic 缓动后在
 * 1（关）与滑块平滑值（开）之间插值——开/关切换约 1 秒完成，
 * 与滑块值大小无关；进度 0 时恒为 1（默认零视觉影响）。
 *
 * @param sliderGain 滑块平滑值（内部钳制）
 * @param progress01 开关线性过渡进度 ∈ [0,1]（advanceFrameTransition 推进）
 */
export function effectiveExpandGain(sliderGain: number, progress01: number): number {
  const gain = clampExpandGain(sliderGain);
  return 1 + (gain - 1) * easeInOutCubic(progress01);
}

/**
 * 高度指示线在天体本地坐标下的下落长度（场景单位）：
 * 天体（本地原点）→ 银盘面（组内 y=0）投影点的 y 向位移，
 * 与 SpecialBodies.useGalacticPlacement 的 y 通道公式镜像同源。
 *
 * @returns 负值 = 天体在盘面上方（指示线向下）；正值 = 盘面下方（向上）
 */
export function heightLineDropUnits(
  sunYLy: number,
  sunVerticalGain: number,
  offsetYLy: number,
  expandGain: number,
  unitsPerLy: number,
): number {
  if (!(unitsPerLy > 0)) {
    throw new RangeError(`unitsPerLy 必须为正数，收到 ${unitsPerLy}`);
  }
  return -(sunYLy * sunVerticalGain + offsetYLy * expandGain) * unitsPerLy;
}

// ---------------------------------------------------------------------------
// R3-7 银河系整体垂直展开（银盘 → 扁旋转椭球体）
// ---------------------------------------------------------------------------

/**
 * 盘粒子椭球 morph 目标公式常量（与 Galaxy.tsx 盘粒子顶点着色器 R2-11
 * `hTargetLy = (aHeightLy / 500.0) * max(aRadiusLy, 6000.0) * 0.5` 逐字同源，
 * 禁止两套参数）：目标轴比 0.5、高度归一参考 500 ly、核球区最小水平半径
 * 下限 6,000 ly（中心比严格椭球略"鼓"，贴近真实核球三维鼓包，登记）。
 */
export const DISK_MORPH_HEIGHT_REF_LY = 500;
export const DISK_MORPH_MIN_RADIUS_LY = 6000;
export const DISK_MORPH_AXIS_RATIO = 0.5;

/** 展开态银晕增亮上限（用户确认项 4：morph 满权重时约 +30%） */
export const HALO_EXPAND_BOOST_MAX = 0.3;

/**
 * 盘 morph 权重（0–1）：由 R3-6 生效展开增益线性映射
 * （×1 → 0 不 morph、×6 → 1.0 完整轴比 0.5 椭球；默认 ×3 → 0.4 中等椭球）。
 * 增益源为 renderedGalacticFrame().expandGain（已含 1 秒开关过渡 + 滑块平滑），
 * 与特殊天体展开严格同源——禁止第二套过渡状态。
 *
 * @throws RangeError 非有限输入
 */
export function diskMorphWeight(expandGain: number): number {
  if (!Number.isFinite(expandGain)) {
    throw new RangeError(`展开增益必须为有限数，收到 ${expandGain}`);
  }
  return Math.min(
    1,
    Math.max(0, (expandGain - 1) / (GALAXY_EXPAND_GAIN_MAX - 1)),
  );
}

/**
 * 盘椭球 morph 的 CPU 镜像纯函数（与 Galaxy.tsx 盘粒子顶点着色器
 * `pos.y = mix(pos.y, hTargetLy * uUnitsPerLy, uExpand)` 逐字镜像，光年域）：
 * `mix(y, (y / 500) · max(r, 6000) · 0.5, morph01)`。
 * 供超新星事件/遗迹渲染定位（Supernova.tsx）与解析
 * （cameraFocus.supernovaFocusTarget）同源消费。
 *
 * 性质：morph01=0 恒等；y=0 恒等（银心/盘中平面不动）；符号保留；
 * 水平半径 ≥ 1,000 ly 时 |y| 单调放大（r·0.5/500 ≥ 1）。
 *
 * @param yLy 银心系垂直高度（光年）
 * @param horizontalRadiusLy 银心系水平半径 √(x²+z²)（光年，≥0）
 * @param morph01 morph 权重 ∈ [0,1]
 * @throws RangeError 非有限输入 / horizontalRadiusLy < 0 / morph01 越界
 */
export function morphGalacticYLy(
  yLy: number,
  horizontalRadiusLy: number,
  morph01: number,
): number {
  if (!Number.isFinite(yLy)) {
    throw new RangeError(`垂直高度必须为有限数，收到 ${yLy}`);
  }
  if (!Number.isFinite(horizontalRadiusLy) || horizontalRadiusLy < 0) {
    throw new RangeError(`水平半径必须为非负有限数，收到 ${horizontalRadiusLy}`);
  }
  if (!Number.isFinite(morph01) || morph01 < 0 || morph01 > 1) {
    throw new RangeError(`morph 权重必须在 [0,1] 内，收到 ${morph01}`);
  }
  const targetLy =
    (yLy / DISK_MORPH_HEIGHT_REF_LY) *
    Math.max(horizontalRadiusLy, DISK_MORPH_MIN_RADIUS_LY) *
    DISK_MORPH_AXIS_RATIO;
  return yLy + (targetLy - yLy) * morph01;
}

/**
 * 展开态银晕不透明度增亮因子：1 + 0.3 × morph01（强化椭球轮廓，
 * 用户确认项 4；银晕粒子本身球状分布不参与 morph）。
 *
 * @throws RangeError morph01 越界
 */
export function haloExpandBoost(morph01: number): number {
  if (!Number.isFinite(morph01) || morph01 < 0 || morph01 > 1) {
    throw new RangeError(`morph 权重必须在 [0,1] 内，收到 ${morph01}`);
  }
  return 1 + HALO_EXPAND_BOOST_MAX * morph01;
}

/**
 * 展开态尘埃带渐隐因子：1 − morph01（morph 后"盘中平面"语义消失，
 * 用户确认项 5；单一应用点驱动 shader vDust/暗带 mesh/核球辉光压低链路）。
 *
 * @throws RangeError morph01 越界
 */
export function dustLaneExpandFade(morph01: number): number {
  if (!Number.isFinite(morph01) || morph01 < 0 || morph01 > 1) {
    throw new RangeError(`morph 权重必须在 [0,1] 内，收到 ${morph01}`);
  }
  return 1 - morph01;
}

/**
 * uEll（R2-11 合并终态椭球）与 uExpand（R3-7 展开）同目标顺序 mix 的
 * 组合等效权重：`mix(mix(y, T, a), T, b) = mix(y, T, 1 − (1−a)(1−b))`
 * （两次 mix 目标 T 相同 → 无视觉冲突；终态 Milkomeda（uEll=1）下组合
 * 权重恒为 1，不受 V 开关破坏，登记）。
 *
 * @throws RangeError 任一权重越界
 */
export function combinedMorphWeight(ell01: number, expand01: number): number {
  for (const v of [ell01, expand01]) {
    if (!Number.isFinite(v) || v < 0 || v > 1) {
      throw new RangeError(`morph 权重必须在 [0,1] 内，收到 ${v}`);
    }
  }
  return 1 - (1 - ell01) * (1 - expand01);
}

/**
 * 高度标注文案：银纬推算的真实高度（未乘展开增益，登记），
 * 正负区分盘上/盘下，千分位分隔（如 "+4,858 ly" / "−1,616 ly"）。
 */
export function heightLabelText(offsetYLy: number): string {
  if (!Number.isFinite(offsetYLy)) {
    throw new RangeError(`高度必须为有限数，收到 ${offsetYLy}`);
  }
  const sign = offsetYLy < 0 ? '−' : '+';
  return `${sign}${Math.abs(Math.round(offsetYLy)).toLocaleString('en-US')} ly`;
}
