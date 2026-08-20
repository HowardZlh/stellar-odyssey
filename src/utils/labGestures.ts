/**
 * 实验室触控板手势纯函数层（方案 A，用户需求 2026-08-12）
 *
 * 语义双射（天象仪相机只有两个有意义的自由度）：
 * - 双指滚动（`wheel` deltaX/deltaY 双轴）→ 环顾（视线方位/俯仰，2D 连续量）；
 * - 捏合（macOS/Chrome/Firefox：`wheel + ctrlKey`；Safari：`gesture*` 事件）
 *   → FOV 视野缩放（1D 缩放量）。
 * 视距 dolly 物理上无意义（视差 <0.05%，需求 §2 登记），OrbitControls
 * enableZoom 关闭，缩放语义全部由 FOV 承载。
 *
 * 鼠标滚轮与双指滚动同为 `wheel` 事件、浏览器层无法可靠区分——鼠标用户的
 * FOV 缩放入口由 M3 控件面板滑杆/键盘快捷键补位（登记，不劈轴迁就）。
 * 手机端（M4）：单指环顾已生效；双指捏合 → FOV 复用本文件 clamp 函数。
 *
 * 符号约定（与现有拖拽方向一致，"双指推着星空走"）：
 * - 消费侧对相机球坐标执行 theta += dThetaRad、phi = clamp(phi + dPhiRad)；
 * - macOS 自然滚动下与 OrbitControls rotateSpeed>0 的拖拽手感同向
 *   （拖拽右移 ≙ 双指右滑）。若目验方向相反，翻转 WHEEL_LOOK_SIGN 即可。
 *
 * 纯 TS 模块（不 import three/React），单测覆盖率 gate ≥90%。
 *
 * M3.6-2 追加：跟随环绕手势（拖拽 = 绕流星头部环绕、滚轮 = 距离缩放）——
 * followOrbitDelta / clampFollowElevation / clampFollowDistance，钳制域
 * 常量取 utils/meteorShower.ts 的 FOLLOW_* 常量族（同一事实源）。
 */

import {
  FOLLOW_DISTANCE_DEFAULT_KM,
  FOLLOW_DISTANCE_MAX_KM,
  FOLLOW_DISTANCE_MIN_KM,
  FOLLOW_ELEVATION_MAX_RAD,
} from '@/utils/meteorShower';

/** FOV 缩放域下限（度）——过窄会放大指向抖动（缺省档：流星雨/观察站） */
export const LAB_FOV_MIN_DEG = 30;

/**
 * **望远档** FOV 下限（度，LE-M6 补丁 P1）：日月视直径只有 ~0.5°，缺省档
 * 30° 下月盘/日盘仅占视口高 1.8%（1130px 画布上 20px），「捏合放大看清月面
 * 缺口」的操作承诺无法兑现。日月食条目的地面/月球/彩蛋视角改用本档
 * （0.54° / 3° ≈ 视口高 18%，约 ×21 变焦）。
 *
 * 取 3° 而非更低的依据：月面 2K 贴图在 3° 时约 200px 屏幕高度仍锐利；
 * 指向抖动由 `labRotateSpeedForFov` 的速度自适应补偿（见下）。
 * **缺省参数保证流星雨/观察站逐像素零变化**（钳制函数的 minDeg 缺省 = 30）。
 */
export const LAB_FOV_TELESCOPIC_MIN_DEG = 3;

/** FOV 缩放域上限（度）——过宽产生显著透视畸变 */
export const LAB_FOV_MAX_DEG = 85;

/** FOV 默认值（度，M2 相机初始值同源） */
export const LAB_FOV_DEFAULT_DEG = 65;

/**
 * 相机 polar 角下限（弧度）：视线俯角 ≤ ~20°，不看穿地面
 * （M2-5 相机钳制的单一事实源，组件 OrbitControls props 同源消费）
 */
export const LAB_POLAR_MIN_RAD = Math.PI / 2 - 0.35;

/** 相机 polar 角上限（弧度）：仰角上限 ≈88°，避开天顶极点奇异 */
export const LAB_POLAR_MAX_RAD = Math.PI - 0.02;

/** 双指滚动 → 环顾的符号（+1 = 自然滚动下与拖拽同向；目验相反则取 -1） */
export const WHEEL_LOOK_SIGN = 1;

/** 捏合（ctrl+wheel）→ FOV 的指数灵敏度（每 deltaY 像素） */
export const PINCH_FOV_RATE_PER_PX = 0.01;

/** 环顾角增量（消费侧直接加到相机球坐标 theta/phi 上） */
export interface LookDelta {
  /** 方位角增量（弧度，three.js Spherical.theta 约定） */
  dThetaRad: number;
  /** 俯仰角增量（弧度，three.js Spherical.phi 约定，消费侧再经 clampLabPolar） */
  dPhiRad: number;
}

/**
 * FOV 钳制（度）——触控板捏合 / Safari gesture / M4 触屏捏合共用。
 *
 * @param minDeg 下限（缺省 `LAB_FOV_MIN_DEG` = 30；日月食条目传
 *   `LAB_FOV_TELESCOPIC_MIN_DEG` 望远档）。非有限/越界入参安全钳回
 *   [LAB_FOV_TELESCOPIC_MIN_DEG, LAB_FOV_MAX_DEG] 域内。
 */
export function clampLabFovDeg(
  fovDeg: number,
  minDeg: number = LAB_FOV_MIN_DEG,
): number {
  const lo = Number.isFinite(minDeg)
    ? Math.max(LAB_FOV_TELESCOPIC_MIN_DEG, Math.min(LAB_FOV_MAX_DEG, minDeg))
    : LAB_FOV_MIN_DEG;
  if (!Number.isFinite(fovDeg)) return Math.max(lo, LAB_FOV_DEFAULT_DEG);
  return Math.max(lo, Math.min(LAB_FOV_MAX_DEG, fovDeg));
}

/** polar 角钳制（弧度）——wheel 环顾与 OrbitControls props 同一事实源 */
export function clampLabPolar(polarRad: number): number {
  if (!Number.isFinite(polarRad)) return LAB_POLAR_MIN_RAD;
  return Math.max(LAB_POLAR_MIN_RAD, Math.min(LAB_POLAR_MAX_RAD, polarRad));
}

/**
 * 双指滚动 → 环顾角增量（1 px 滚动 ≈ 1 px 星空位移的角度换算：
 * radPerPx = fov / 视口高——缩放越窄环顾越细，指向手感恒定）
 *
 * @param deltaX wheel 事件 deltaX（像素域；deltaMode 换行/换页的场合由消费侧预乘）
 * @param deltaY wheel 事件 deltaY
 * @param viewportHeightPx 画布 CSS 像素高（≤0 时返回零增量，防御）
 * @param fovDeg 当前视野角（度）
 */
export function wheelLookDelta(
  deltaX: number,
  deltaY: number,
  viewportHeightPx: number,
  fovDeg: number,
  minFovDeg: number = LAB_FOV_MIN_DEG
): LookDelta {
  if (
    !Number.isFinite(deltaX) ||
    !Number.isFinite(deltaY) ||
    !(viewportHeightPx > 0) ||
    !Number.isFinite(fovDeg)
  ) {
    return { dThetaRad: 0, dPhiRad: 0 };
  }
  const radPerPx =
    (clampLabFovDeg(fovDeg, minFovDeg) * Math.PI) / 180 / viewportHeightPx;
  return {
    dThetaRad: WHEEL_LOOK_SIGN * radPerPx * deltaX,
    dPhiRad: WHEEL_LOOK_SIGN * radPerPx * deltaY,
  };
}

/**
 * 捏合（wheel + ctrlKey）→ 新 FOV（度）：指数缩放（捏合张开 deltaY<0 →
 * FOV 变窄 = 放大），乘法叠加保证任意缩放路径可逆、无漂移。
 */
export function pinchFovDeg(
  currentFovDeg: number,
  ctrlWheelDeltaY: number,
  minFovDeg: number = LAB_FOV_MIN_DEG
): number {
  if (!Number.isFinite(ctrlWheelDeltaY)) {
    return clampLabFovDeg(currentFovDeg, minFovDeg);
  }
  return clampLabFovDeg(
    clampLabFovDeg(currentFovDeg, minFovDeg) *
      Math.exp(PINCH_FOV_RATE_PER_PX * ctrlWheelDeltaY),
    minFovDeg
  );
}

/**
 * Safari `gesturechange` → 新 FOV（度）：scale 为手势起点以来的累计比例
 * （>1 张开 = 放大 = FOV 变窄），以手势起始 FOV 为基准整体缩放。
 */
export function safariGestureFovDeg(
  startFovDeg: number,
  gestureScale: number,
  minFovDeg: number = LAB_FOV_MIN_DEG
): number {
  if (!Number.isFinite(gestureScale) || gestureScale <= 0) {
    return clampLabFovDeg(startFovDeg, minFovDeg);
  }
  return clampLabFovDeg(
    clampLabFovDeg(startFovDeg, minFovDeg) / gestureScale,
    minFovDeg
  );
}

/**
 * 触屏双指捏合 → 累计缩放比例（M4-2 触控：起始双指距为基准，>1 张开 =
 * 放大）；消费侧喂 `safariGestureFovDeg`（同一 FOV 钳制函数，M2 登记的
 * 复用承诺）。起始距非正/输入非有限时返回 1（不缩放）。
 */
export function touchPinchScale(startDistPx: number, currentDistPx: number): number {
  if (
    !Number.isFinite(startDistPx) ||
    !Number.isFinite(currentDistPx) ||
    startDistPx <= 0 ||
    currentDistPx <= 0
  ) {
    return 1;
  }
  return currentDistPx / startDistPx;
}

/**
 * FOV → 星点像素尺度补偿因子（默认 FOV 时恒 1，与 M2 观感逐像素一致；
 * FOV 变窄（放大）时星点按透视投影因子 1/tan(fov/2) 等比变大）
 *
 * **望远档下不再继续放大（LE-M6 补丁 P1 登记）**：本函数内部仍按缺省档
 * 30° 钳制——恒星是不可分辨的点源，望远变焦下只应拉开**间距**而非把星点
 * 撑成大团（物理正确 + 既有观感零回归）。
 */
export function fovPointScaleFactor(fovDeg: number): number {
  const halfDefaultRad = (LAB_FOV_DEFAULT_DEG * Math.PI) / 360;
  const halfRad = (clampLabFovDeg(fovDeg) * Math.PI) / 360;
  return Math.tan(halfDefaultRad) / Math.tan(halfRad);
}

/** 望远档旋转速度自适应的下限比例（防 FOV→0 时速度归零卡死） */
export const LAB_ROTATE_SPEED_MIN_RATIO = 0.04;

/**
 * FOV → 轨道相机旋转速度（LE-M6 补丁 P1）
 *
 * OrbitControls 的拖拽角位移 ∝ rotateSpeed × 拖拽像素/视口宽，与 FOV 无关
 * ——望远档（3°）下沿用默认速度会让一次拖拽扫过数十个屏宽，指向完全失控。
 * 按 `fov / LAB_FOV_DEFAULT_DEG` 线性缩放即可让**屏幕像素位移手感恒定**
 * （角速度 ∝ 视场角 = 每像素对应角度不变）。
 *
 * @param baseSpeed 组件侧配置的基准 rotateSpeed（默认 FOV 下的手感）
 * @param fovDeg 当前视野角（度）
 */
export function labRotateSpeedForFov(
  baseSpeed: number,
  fovDeg: number
): number {
  if (!Number.isFinite(baseSpeed) || baseSpeed <= 0) return 0;
  const fov = Number.isFinite(fovDeg)
    ? Math.max(
        LAB_FOV_TELESCOPIC_MIN_DEG,
        Math.min(LAB_FOV_MAX_DEG, fovDeg)
      )
    : LAB_FOV_DEFAULT_DEG;
  const ratio = Math.max(
    LAB_ROTATE_SPEED_MIN_RATIO,
    fov / LAB_FOV_DEFAULT_DEG
  );
  return baseSpeed * ratio;
}

// ---------------------------------------------------------------------------
// M3.6-2 跟随环绕手势（像素 → 角度/距离换算与钳制；钳制域常量
// 与 utils/meteorShower.ts 的 FOLLOW_* 常量族同一事实源）
// ---------------------------------------------------------------------------

/** 拖满视口高 = 环绕 180°（wheelLookDelta 同源的"像素→弧度"口径） */
export const FOLLOW_ORBIT_RAD_PER_VIEWPORT = Math.PI;

/** 滚轮 → 跟随距离的指数灵敏度（每 deltaY 像素；pinchFovDeg 同风格） */
export const FOLLOW_DISTANCE_RATE_PER_PX = 0.002;

/** 跟随环绕角增量（消费侧加到 followRef.azimuthRad/elevationRad 上） */
export interface FollowOrbitDelta {
  /** 方位角增量（弧度，绕流星飞行方向轴，360° 无限制） */
  dAzimuthRad: number;
  /** 仰角增量（弧度；拖拽上移 = 相机升高——dy 取负；消费侧再经 clampFollowElevation） */
  dElevationRad: number;
}

/**
 * 拖拽 → 环绕角增量（1 视口高 ≈ 180° 的线性换算，wheelLookDelta 同源风格）
 *
 * @param dxPx pointermove 水平位移（像素）
 * @param dyPx pointermove 垂直位移（像素，屏幕坐标向下为正）
 * @param viewportHeightPx 画布 CSS 像素高（≤0 时返回零增量，防御）
 */
export function followOrbitDelta(
  dxPx: number,
  dyPx: number,
  viewportHeightPx: number
): FollowOrbitDelta {
  if (!Number.isFinite(dxPx) || !Number.isFinite(dyPx) || !(viewportHeightPx > 0)) {
    return { dAzimuthRad: 0, dElevationRad: 0 };
  }
  const radPerPx = FOLLOW_ORBIT_RAD_PER_VIEWPORT / viewportHeightPx;
  return {
    dAzimuthRad: radPerPx * dxPx,
    dElevationRad: -radPerPx * dyPx,
  };
}

/** 跟随环绕仰角钳制（±FOLLOW_ELEVATION_MAX_RAD = ±75°，防头/尾奇异） */
export function clampFollowElevation(elevationRad: number): number {
  if (!Number.isFinite(elevationRad)) return 0;
  return Math.max(-FOLLOW_ELEVATION_MAX_RAD, Math.min(FOLLOW_ELEVATION_MAX_RAD, elevationRad));
}

/**
 * 滚轮 → 新跟随距离（km）：指数缩放（滚轮向前 deltaY<0 → 拉近），
 * 乘法叠加保证任意缩放路径可逆、无漂移（pinchFovDeg 同风格）；
 * 域 [FOLLOW_DISTANCE_MIN_KM, FOLLOW_DISTANCE_MAX_KM] = [0.6, 6] km。
 */
export function clampFollowDistance(currentKm: number, wheelDeltaY: number): number {
  const clamp = (km: number): number =>
    Math.max(FOLLOW_DISTANCE_MIN_KM, Math.min(FOLLOW_DISTANCE_MAX_KM, km));
  const base = Number.isFinite(currentKm) ? clamp(currentKm) : FOLLOW_DISTANCE_DEFAULT_KM;
  if (!Number.isFinite(wheelDeltaY)) return base;
  return clamp(base * Math.exp(FOLLOW_DISTANCE_RATE_PER_PX * wheelDeltaY));
}
