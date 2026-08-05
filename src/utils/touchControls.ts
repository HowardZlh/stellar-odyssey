/**
 * M4 触屏交互纯逻辑（REQUIREMENTS_MOBILE §M4-1/M4-2）：
 * - 捏合 dolly 速度按当前相机距离对数放大（M4-1）：OrbitControls 触屏捏合
 *   的 dolly 为乘性（radius ×= ratio^zoomSpeed），近距离精细、远距离跨越
 *   的目标要求 zoomSpeed 随 log10(distance) 线性增长——实测曲线锁定
 *   "太阳近观（~5 units）→ 宇宙全景（42000 units）3–4 次捏合可达"
 *   （单测 simulate 断言，勿随意调参）。
 * - 阻尼系数与拾取放大系数按 isTouch 分档（桌面分支 = 现状值，零变化）。
 *
 * 仅 isTouch 路径消费触屏值；桌面（isTouch=false）各函数返回现状常量。
 */

/** 遨游模式缩放范围（与 CameraController OrbitControls min/maxDistance 同源） */
export const ROAM_MIN_DISTANCE = 1.5;
export const ROAM_MAX_DISTANCE = 42000;

/** OrbitControls 阻尼系数：桌面现状 0.08 / 触屏 0.12（M4-1，惯性略强顺应轻扫） */
const DESKTOP_DAMPING_FACTOR = 0.08;
const TOUCH_DAMPING_FACTOR = 0.12;

/** 触屏捏合 dolly 速度区间（zoomSpeed，OrbitControls 语义）：近距 1.0 → 最远 2.6 */
const TOUCH_ZOOM_SPEED_MIN = 1.0;
const TOUCH_ZOOM_SPEED_MAX = 2.6;

/**
 * 触屏点选命中放大系数（M4-2，二选一登记取"透明拾取球 ×2"）：Points 射线
 * 阈值 ×2 方案已放弃——阈值为世界单位、跨 L1-L4 四个数量级尺度无法单值
 * 安全放大，且全部精细点选目标均为 mesh 热区、Points 阈值无增益
 * （详见 CameraController M4-2 注释）。
 */
const TOUCH_PICK_SCALE = 2;

/** OrbitControls 阻尼系数（isTouch 0.12 / 桌面 0.08 = 现状） */
export function orbitDampingFactor(isTouch: boolean): number {
  return isTouch ? TOUCH_DAMPING_FACTOR : DESKTOP_DAMPING_FACTOR;
}

/**
 * 触屏捏合 dolly 速度（M4-1）：按当前相机距离对数插值。
 *
 * OrbitControls 捏合 dolly 为乘性缩放（每次手势 radius ×= ratio^zoomSpeed，
 * ratio = 手指间距变化比），故 zoomSpeed 随 log10(distance) 线性增长即
 * "越远跨越越快、越近越精细"：
 *   d=1.5 → 1.0（行星表面精细）… d=42000 → 2.6（宇宙全景跨越）。
 * 单次捏合手指间距比取 5（约 60→300px）时，5 → 42000 units 需 4 次捏合
 * （单测锁定 3–4 次达标曲线）。
 *
 * 仅 isTouch 帧循环写入 controls.zoomSpeed；桌面滚轮不消费本函数。
 */
export function touchDollyZoomSpeed(distanceUnits: number): number {
  if (!Number.isFinite(distanceUnits)) return TOUCH_ZOOM_SPEED_MIN;
  const clamped = Math.min(ROAM_MAX_DISTANCE, Math.max(ROAM_MIN_DISTANCE, distanceUnits));
  const lo = Math.log10(ROAM_MIN_DISTANCE);
  const hi = Math.log10(ROAM_MAX_DISTANCE);
  const t = (Math.log10(clamped) - lo) / (hi - lo);
  return TOUCH_ZOOM_SPEED_MIN + (TOUCH_ZOOM_SPEED_MAX - TOUCH_ZOOM_SPEED_MIN) * t;
}

/** 透明拾取球半径放大系数（M4-2）：触屏 ×2 / 桌面 ×1（现状） */
export function pickRadiusScale(isTouch: boolean): number {
  return isTouch ? TOUCH_PICK_SCALE : 1;
}
