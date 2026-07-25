/**
 * 卫星系统的视觉尺度策略（需求 3.1.1）
 *
 * 人造卫星与月球轨道高度差异巨大（约 400 km vs 38 万 km），
 * 且真实轨道半径换算成场景单位远小于行星的视觉半径（对数压缩后），
 * 必须采用分层缩放策略——在此登记（需求 4.1 视觉夸大处理原则）：
 *
 * - 自然卫星轨道：r = R_p + 0.6 + 1.2·log10(1 + a_km / 100000)
 *   保持"轨道更远的卫星画得更远"的排序与共振可视化（木卫 1:2:4 间距递增）
 * - 人造卫星轨道（P7 §3.2 调整登记）：分段映射——
 *   近地轨道段（高度 200–600 km）线性放大 r = R_p + 0.15 + (h − 200)·0.0025，
 *   600 km 以上对数压缩 r = R_p + 1.15 + 0.1·log10(1 + (h − 600) / 3000)。
 *   差异登记：原纯对数公式下天宫（390 km）与 ISS（417 km）轨道仅差
 *   ~0.005 场景单位不可分辨，近地段改线性以保证两者分层可辨
 *   （天宫 ≈ R_p+0.63，ISS ≈ R_p+0.69，哈勃 ≈ R_p+1.0，
 *   静止轨道 ≈ R_p+1.26，仍明显低于月球 ≈ R_p+1.42 的外层）
 * - 人造卫星本体（P7 §3.2）：按真实特征尺寸 spanMeters 对数分级映射
 *   r = 0.024 + 0.036·log10(1 + span_m / 8)，保证视觉层次
 *   ISS（109 m）> 天宫（55 m）> TDRS（21 m）> 哈勃（13.2 m）；
 *   真实尺寸（百米级）在场景尺度下不可见，统一放大数千倍为示意尺寸（登记）
 * - 行星环：内外缘均按自然卫星轨道公式映射后绕中心扩展 2 倍宽度，
 *   保证环与卫星轨道（如土卫二在环外）的相对顺序正确
 *
 * 真实比例模式（P7 §3.2 策略登记）：人造卫星与自然卫星同规则按真实尺寸
 * 线性映射——真实尺寸下人造卫星不可见属科学事实（与矮行星原则一致），
 * 帮助信息中说明。
 *
 * 真实轨道参数保留在数据层（MoonData.orbit），仅渲染半径做视觉映射。
 */

import type { SatelliteKind } from '@/types';
import { RADIUS_LOG_REF_KM, kmToSceneUnits, realBodyRadius, visualBodyRadius } from '@/utils/scale';

/** 自然卫星轨道映射参数 */
export const NATURAL_ORBIT_BASE_UNITS = 0.6;
export const NATURAL_ORBIT_LOG_UNITS = 1.2;
export const NATURAL_ORBIT_REF_KM = 100000;

/** 人造卫星轨道映射参数（P7 分段映射，以轨道高度为输入，登记于文件头） */
export const ARTIFICIAL_ORBIT_BASE_UNITS = 0.15;
/** 近地段（200–600 km）线性斜率（场景单位/km）：保证天宫与 ISS 分层可辨 */
export const ARTIFICIAL_ORBIT_LEO_SLOPE_PER_KM = 0.0025;
/** 近地段起点/终点高度（km） */
export const ARTIFICIAL_ORBIT_LEO_MIN_KM = 200;
export const ARTIFICIAL_ORBIT_LEO_MAX_KM = 600;
/** 600 km 以上对数压缩参数 */
export const ARTIFICIAL_ORBIT_LOG_UNITS = 0.1;
export const ARTIFICIAL_ORBIT_LOG_REF_KM = 3000;

/** 卫星本体最小视觉半径（场景单位） */
export const MIN_MOON_VISUAL_RADIUS = 0.1;
/** 人造卫星缺省视觉尺寸（无 spanMeters 数据时的兜底示意尺寸，登记） */
export const ARTIFICIAL_BODY_VISUAL_RADIUS = 0.06;
/** 人造卫星差异化尺寸映射参数（P7 §3.2，以真实特征尺寸 spanMeters 为输入） */
export const ARTIFICIAL_BODY_BASE_UNITS = 0.024;
export const ARTIFICIAL_BODY_LOG_UNITS = 0.036;
export const ARTIFICIAL_BODY_REF_SPAN_M = 8;

/** 行星环视觉宽度扩展倍数（登记的视觉夸大） */
export const RING_WIDTH_SPREAD = 2;

/**
 * 卫星轨道的视觉半径（场景单位，相对行星中心）
 *
 * @param kind 自然 / 人造
 * @param parentRadiusKm 行星真实半径（km）
 * @param semiMajorAxisKm 卫星轨道半长轴（km，相对行星中心）
 */
export function visualSatelliteOrbitRadius(
  kind: SatelliteKind,
  parentRadiusKm: number,
  semiMajorAxisKm: number,
): number {
  if (semiMajorAxisKm <= parentRadiusKm) {
    throw new RangeError(
      `卫星轨道半长轴（${semiMajorAxisKm} km）必须大于行星半径（${parentRadiusKm} km）`,
    );
  }
  const parentVisual = visualBodyRadius(parentRadiusKm);
  if (kind === 'artificial') {
    const altitudeKm = semiMajorAxisKm - parentRadiusKm;
    // P7 分段映射（登记于文件头）：近地段线性放大保证天宫/ISS 分层可辨，
    // 600 km 以上对数压缩保证静止轨道仍低于月球轨道层
    const leoKm = Math.min(
      Math.max(altitudeKm, ARTIFICIAL_ORBIT_LEO_MIN_KM),
      ARTIFICIAL_ORBIT_LEO_MAX_KM,
    );
    let r =
      parentVisual +
      ARTIFICIAL_ORBIT_BASE_UNITS +
      (leoKm - ARTIFICIAL_ORBIT_LEO_MIN_KM) * ARTIFICIAL_ORBIT_LEO_SLOPE_PER_KM;
    if (altitudeKm > ARTIFICIAL_ORBIT_LEO_MAX_KM) {
      r +=
        ARTIFICIAL_ORBIT_LOG_UNITS *
        Math.log10(1 + (altitudeKm - ARTIFICIAL_ORBIT_LEO_MAX_KM) / ARTIFICIAL_ORBIT_LOG_REF_KM);
    }
    return r;
  }
  return (
    parentVisual +
    NATURAL_ORBIT_BASE_UNITS +
    NATURAL_ORBIT_LOG_UNITS * Math.log10(1 + semiMajorAxisKm / NATURAL_ORBIT_REF_KM)
  );
}

/**
 * 卫星本体的视觉半径（场景单位）
 *
 * @param spanMeters 人造卫星真实特征尺寸（米，P7 差异化尺寸映射；
 *   缺省时回落固定示意尺寸 ARTIFICIAL_BODY_VISUAL_RADIUS）
 */
export function visualSatelliteBodyRadius(
  kind: SatelliteKind,
  radiusKm: number,
  spanMeters?: number,
): number {
  if (kind === 'artificial') {
    if (spanMeters !== undefined) {
      if (!(spanMeters > 0) || !Number.isFinite(spanMeters)) {
        throw new RangeError(`人造卫星特征尺寸必须为正有限数，收到 ${spanMeters}`);
      }
      return (
        ARTIFICIAL_BODY_BASE_UNITS +
        ARTIFICIAL_BODY_LOG_UNITS * Math.log10(1 + spanMeters / ARTIFICIAL_BODY_REF_SPAN_M)
      );
    }
    return ARTIFICIAL_BODY_VISUAL_RADIUS;
  }
  if (radiusKm <= 0) {
    throw new RangeError(`卫星半径必须为正数，收到 ${radiusKm}`);
  }
  // 自然卫星复用行星的对数压缩公式（不含行星的最小半径钳制，
  // 否则月球与土卫二会被压到同一下限失去大小区分），下限单独取更小值
  const compressed = 0.9 * Math.log10(1 + radiusKm / RADIUS_LOG_REF_KM);
  return Math.max(MIN_MOON_VISUAL_RADIUS, compressed);
}

/**
 * 行星环内外缘的视觉半径（场景单位）
 *
 * 内外缘先按自然卫星轨道公式映射，再绕中心扩展 RING_WIDTH_SPREAD 倍宽度
 * （否则对数压缩后环过窄），排序关系（环外卫星仍在环外）保持不变。
 */
export function visualRingRadii(
  parentRadiusKm: number,
  innerRadiusKm: number,
  outerRadiusKm: number,
): { innerUnits: number; outerUnits: number } {
  if (outerRadiusKm <= innerRadiusKm) {
    throw new RangeError('环外缘半径必须大于内缘半径');
  }
  const inner = visualSatelliteOrbitRadius('natural', parentRadiusKm, innerRadiusKm);
  const outer = visualSatelliteOrbitRadius('natural', parentRadiusKm, outerRadiusKm);
  const center = (inner + outer) / 2;
  const halfWidth = ((outer - inner) / 2) * RING_WIDTH_SPREAD;
  return { innerUnits: center - halfWidth, outerUnits: center + halfWidth };
}

/**
 * 潮汐锁定自转角（弧度）：自转与公转同步，始终同一面朝向行星（需求 3.1.1 月球）
 *
 * @param orbitAngleRad 卫星当前轨道相位角（弧度）
 */
export function tidalLockedRotationAngle(orbitAngleRad: number): number {
  return orbitAngleRad + Math.PI;
}

// ---------------------------------------------------------------------------
// P7 §3.1 人造卫星近观放大（登记的视觉夸大）
// ---------------------------------------------------------------------------

/** 近观最大放大倍数：相机贴近时模型平滑放大，保证结构细节充满合理视野 */
export const SATELLITE_NEAR_MAGNIFICATION = 3;
/** 放大全强度距离（≈ 飞抵观察距离）与放大消失距离（≈ 近观门控进入阈值） */
export const SATELLITE_MAG_FULL_DISTANCE = 2.2;
export const SATELLITE_MAG_NONE_DISTANCE = 6;

/**
 * 人造卫星近观放大系数（P7，登记于本文件头）：
 * 远观（≥6 单位）保持 1（与现有轻量表示尺寸连续，无 LOD 突变），
 * 相机贴近（≤2.2 单位）平滑升至 SATELLITE_NEAR_MAGNIFICATION——
 * 示意尺寸本体过小（~0.04–0.07 单位），需近观放大结构细节才可辨识。
 * smoothstep 插值保证缩放连续无跳变。
 */
export function satelliteNearMagnification(distanceUnits: number): number {
  if (!Number.isFinite(distanceUnits) || distanceUnits < 0) {
    throw new RangeError(`相机距离必须为非负有限数，收到 ${distanceUnits}`);
  }
  if (distanceUnits >= SATELLITE_MAG_NONE_DISTANCE) return 1;
  if (distanceUnits <= SATELLITE_MAG_FULL_DISTANCE) return SATELLITE_NEAR_MAGNIFICATION;
  const t =
    (SATELLITE_MAG_NONE_DISTANCE - distanceUnits) /
    (SATELLITE_MAG_NONE_DISTANCE - SATELLITE_MAG_FULL_DISTANCE);
  const s = t * t * (3 - 2 * t);
  return 1 + (SATELLITE_NEAR_MAGNIFICATION - 1) * s;
}

// ---------------------------------------------------------------------------
// R2-2 §2.2-A 人造卫星角尺寸钳制 + 极近淡出（修复"卫星铺满屏幕"）
// ---------------------------------------------------------------------------

/** 卫星投影角尺寸上限：屏幕高度的约 10%（R2-2 建议区间 8–12% 取中值） */
export const SATELLITE_MAX_SCREEN_HEIGHT_FRACTION = 0.1;
/** 极近淡出起点/终点（场景单位）：相机距离低于起点开始淡出，到终点全透明 */
export const SATELLITE_PROXIMITY_FADE_START_UNITS = 0.4;
export const SATELLITE_PROXIMITY_FADE_END_UNITS = 0.08;

/**
 * 角尺寸钳制系数（R2-2 §2.2-A）：卫星模型全展跨度 spanUnits 在距离
 * distanceUnits 处的投影屏高占比 = (span/2 ÷ distance) ÷ tan(fov/2)；
 * 超过 SATELLITE_MAX_SCREEN_HEIGHT_FRACTION 时按比例缩小显示尺寸，
 * 保证任意相机距离下卫星屏占比 ≤ 屏幕高度约 10%。
 *
 * 连续性：钳制边界处系数恰为 1（连续函数，非阶跃）；
 * 距离 → 0 时系数 → 0（配合极近淡出，不再出现放大铺屏）。
 */
export function satelliteScreenClampFactor(
  distanceUnits: number,
  spanUnits: number,
  fovRad: number,
): number {
  if (!Number.isFinite(distanceUnits) || distanceUnits < 0) {
    throw new RangeError(`相机距离必须为非负有限数，收到 ${distanceUnits}`);
  }
  if (!Number.isFinite(spanUnits) || spanUnits < 0) {
    throw new RangeError(`模型跨度必须为非负有限数，收到 ${spanUnits}`);
  }
  if (!Number.isFinite(fovRad) || fovRad <= 0 || fovRad >= Math.PI) {
    throw new RangeError(`垂直视场角必须在 (0, π) 内，收到 ${fovRad}`);
  }
  if (spanUnits === 0) return 1;
  const allowedHalfSpan =
    distanceUnits * Math.tan(fovRad / 2) * SATELLITE_MAX_SCREEN_HEIGHT_FRACTION;
  const halfSpan = spanUnits / 2;
  if (halfSpan <= allowedHalfSpan) return 1;
  return allowedHalfSpan / halfSpan;
}

/**
 * 极近淡出不透明度 [0,1]（R2-2 §2.2-A）：相机极近（穿模路径）时卫星
 * 平滑淡出而非继续放大，避免"从卫星内部看到模型内壁"。
 * smoothstep 过渡，距离 ≥ 起点全不透明、≤ 终点全透明。
 */
export function satelliteProximityFade01(distanceUnits: number): number {
  if (!Number.isFinite(distanceUnits) || distanceUnits < 0) {
    throw new RangeError(`相机距离必须为非负有限数，收到 ${distanceUnits}`);
  }
  if (distanceUnits >= SATELLITE_PROXIMITY_FADE_START_UNITS) return 1;
  if (distanceUnits <= SATELLITE_PROXIMITY_FADE_END_UNITS) return 0;
  const t =
    (distanceUnits - SATELLITE_PROXIMITY_FADE_END_UNITS) /
    (SATELLITE_PROXIMITY_FADE_START_UNITS - SATELLITE_PROXIMITY_FADE_END_UNITS);
  return t * t * (3 - 2 * t);
}

// ---------------------------------------------------------------------------
// R2-2 §2.2-B 运镜/视角过渡期间冻结近观放大
// ---------------------------------------------------------------------------

/** 视角锚点过渡冻结窗口（秒，与 cameraViews.VIEW_TRANSITION_SECONDS 一致） */
export const MAG_FREEZE_TRANSITION_WINDOW_SECONDS = 2;
/** 冻结解除后近观放大平滑恢复时长上限（秒，R2-2 要求 ≤1 秒） */
export const MAG_RECOVERY_SECONDS = 1;

/**
 * 近观放大冻结判定（R2-2 §2.2-B）：飞往运镜进行中（flyToBodyId 非空）
 * 或视角锚点过渡 2 秒窗口内，近观放大固定 1×。
 */
export function nearMagnificationFrozen(
  flyToActive: boolean,
  secondsSinceViewTransition: number,
): boolean {
  if (flyToActive) return true;
  return secondsSinceViewTransition < MAG_FREEZE_TRANSITION_WINDOW_SECONDS;
}

/**
 * 近观放大平滑逼近（R2-2 §2.2-B）：每帧向目标放大倍数限速逼近，
 * 全程（1× ↔ 最大倍数）恰用 MAG_RECOVERY_SECONDS 秒完成，无尺寸跳变；
 * 冻结方向（→1×）与恢复方向（→目标）同速率，双向均平滑。
 */
export function approachNearMagnification(
  current: number,
  target: number,
  deltaSeconds: number,
): number {
  if (!Number.isFinite(current) || !Number.isFinite(target)) {
    throw new RangeError(`放大倍数必须为有限数，收到 current=${current} target=${target}`);
  }
  if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) {
    throw new RangeError(`帧间隔必须为非负有限数，收到 ${deltaSeconds}`);
  }
  const maxStep =
    ((SATELLITE_NEAR_MAGNIFICATION - 1) / MAG_RECOVERY_SECONDS) * deltaSeconds;
  const diff = target - current;
  if (Math.abs(diff) <= maxStep) return target;
  return current + Math.sign(diff) * maxStep;
}

// ---------------------------------------------------------------------------
// 真实比例模式（P2，需求 4.1）：卫星轨道/本体/行星环按真实线性比例映射
// ---------------------------------------------------------------------------

/**
 * 卫星轨道半径统一入口：真实比例模式下按真实距离线性映射
 * （月球 38.4 万 km ≈ 0.0257 场景单位，ISS 高度 400 km 贴近真实地球表面），
 * 否则用分层缩放策略（视觉夸大已登记于文件头）。
 */
export function satelliteOrbitDisplayRadius(
  kind: SatelliteKind,
  parentRadiusKm: number,
  semiMajorAxisKm: number,
  realScale: boolean,
): number {
  if (realScale) {
    if (semiMajorAxisKm <= parentRadiusKm) {
      throw new RangeError(
        `卫星轨道半长轴（${semiMajorAxisKm} km）必须大于行星半径（${parentRadiusKm} km）`,
      );
    }
    return kmToSceneUnits(semiMajorAxisKm);
  }
  return visualSatelliteOrbitRadius(kind, parentRadiusKm, semiMajorAxisKm);
}

/**
 * 卫星本体半径统一入口：真实比例模式下按真实半径线性映射（人造卫星
 * 真实尺寸约百米级，线性映射后不可见——真实比例模式如实呈现，
 * P7 §3.2 策略登记于文件头）。
 */
export function satelliteBodyDisplayRadius(
  kind: SatelliteKind,
  radiusKm: number,
  realScale: boolean,
  spanMeters?: number,
): number {
  if (realScale) {
    if (radiusKm <= 0) {
      throw new RangeError(`卫星半径必须为正数，收到 ${radiusKm}`);
    }
    return realBodyRadius(radiusKm);
  }
  return visualSatelliteBodyRadius(kind, radiusKm, spanMeters);
}

/**
 * 行星环内外缘半径统一入口：真实比例模式下按真实半径线性映射。
 */
export function ringDisplayRadii(
  parentRadiusKm: number,
  innerRadiusKm: number,
  outerRadiusKm: number,
  realScale: boolean,
): { innerUnits: number; outerUnits: number } {
  if (realScale) {
    if (outerRadiusKm <= innerRadiusKm) {
      throw new RangeError('环外缘半径必须大于内缘半径');
    }
    return {
      innerUnits: kmToSceneUnits(innerRadiusKm),
      outerUnits: kmToSceneUnits(outerRadiusKm),
    };
  }
  return visualRingRadii(parentRadiusKm, innerRadiusKm, outerRadiusKm);
}
