/**
 * 日全食实验室太空视角纯逻辑层（E 迭代 M4，IMPROVEMENT_REQUIREMENTS_SOLAR_ECLIPSE
 * §M4 / §2.2 / §4.4 / 契约 C4 / C7）
 *
 * 组件零内联可测逻辑纪律（§7）：EclipseSpaceView.tsx / SolarEclipseLab.tsx（M4 段）
 * 只消费本模块——J2000→场景轴映射、geo 星历驱动的空间帧状态（日月位置 +
 * 真锥双层渲染段 + 地表足印 shader 参数）、本影地面移动速度、食带中心线
 * 地理坐标/扫掠进度、倾角叙事模式轨道基、视角切换运镜姿态。
 *
 * 场景空间（契约 C4）：太空视角 1 场景单位 = 1,000 km，地心原点，地心 J2000
 * 赤道系直接映射场景轴——**映射常量登记**：J2000 (+X 春分点, +Y, +Z 北天极)
 * → 场景 (x, y, z) = (X, Z, −Y)，即 +Z 北天极 → 场景 +Y（three.js Y-up），
 * 绕 X 轴 −90° 的纯旋转（保持右手系与长度/角度）。
 * 影锥几何一律在 km 域计算（契约 C1 umbraCone/penumbraCone/umbraFootprint
 * 只消费不改签名），进场景只做统一缩放 + 上述轴映射。
 *
 * 艺术化登记（§8）：
 * - A3：太阳不置于真实距离（1.496 亿 km = 149,600 场景单位超出场景域），以
 *   方向光 + SPACE_SUN_DISK_DISTANCE_UNITS 处远景日盘表现（视半径按真实
 *   0.267° 折算，方向真实）；影锥渲染为可见半透明实体属表达辅助（真实影锥
 *   不可见）——科普卡 lab.eclipseSpaceCard 注明；
 * - A4：本影放大 ×UMBRA_MAGNIFY_FACTOR 开关（默认关 = 真实比例；开启时锥体
 *   径向与地表足印同倍放大，HUD 注明倍率）；
 * - A5：倾角叙事模式把 5.145° 白道倾角夸张 ×INCLINATION_DISPLAY_FACTOR
 *   至可辨（HUD 标真实值与显示倍率）；轨道/交点回归节奏为叙事时间尺度
 *   （NARRATIVE_* 常量，非真实周期），演示「月影多数月份从地球上下方掠过，
 *   只在交点附近命中」——与 data/moons.ts 月球倾角注释同口径（不得暗示
 *   每月都食）。
 *
 * 契约 C7（朔望参数化）：倾角叙事的轨道基/相位函数均收 syzygyOffsetRad 参
 * （本条目朔 = 0，月食条目望 = π 时月球在反日侧、地影投月球）——影锥方向
 * 由日月位置解析自然随参数翻转，朔态未写死。
 *
 * 地理配准链（M4 一手校准，单测以「食甚足印中心 ≈ 观测点」锚点锁定 <0.1°）：
 * - geo 序列为 J2000(ICRF)，地球自转须经 **IAU1976 岁差**（Meeus ζ/z/θ 角，
 *   J2000→平春分点 of date）再接 GMST——缺岁差项足印经度偏 ~0.35°（~35 km）；
 * - 影锥轴用**迟滞太阳位置**（t − 日光行时 ~499s 处插值——影斑由光子几何
 *   决定；缺此项足印偏 ~0.32°/35 km，与 Espenak 视位置口径一致）；
 * - 地表纬度经**大地 ↔ 地心纬度换算**（WGS84 扁率，差 ≤0.19°/21 km）——
 *   球面网格上折线/足印统一按地心纬度放置，与物理影斑共面一致。
 * 已知近似登记（§1.5 扩展）：忽略章动与均分点方程（≤0.005°/0.5 km）、
 * 极移/UT1−UTC、月光行时（1.3s ≈ 1 km）；本影地面速度用 60s 中心差分
 * ECEF 弦长（曲率误差 ≪1%）；地球网格为球体（扁率不建模，纬度换算已收
 * 配准差，剩余形状差不影响公里级可视化）。
 *
 * 硬性约束：不 import React/three；函数无状态、可重入（out 参数由调用方
 * 持有，渲染循环零 GC）；单测覆盖率 gate ≥90%。
 */

import {
  EARTH_MEAN_RADIUS_KM,
  MOON_MEAN_RADIUS_KM,
  geoSampleFromRow,
  interpolateEphemeris,
  penumbraCone,
  umbraCone,
  umbraFootprint,
  type EphemerisSeries,
} from '@/utils/solarEclipse';
import { ECLIPTIC_OBLIQUITY_DEG, gmstRadFromUnixSec } from '@/utils/solarEclipseLab';
import { SCENE_UNITS_PER_AU, visualBodyRadius } from '@/utils/scale';

/** 度 → 弧度 */
const DEG = Math.PI / 180;

/** 角秒 → 弧度 */
const ARCSEC = DEG / 3600;

/** 光速（km/s；影轴迟滞太阳位置的光行时换算） */
export const SPEED_OF_LIGHT_KM_S = 299792.458;

/** WGS84 第一偏心率平方（大地 ↔ 地心纬度换算） */
export const WGS84_E2 = 0.00669437999014;

/** 可写三元组（out 参数复用） */
export type MutableVec3 = [number, number, number];

// ---------------------------------------------------------------------------
// 契约 C4：太空视角比例 / J2000 → 场景轴映射（登记见文件头）
// ---------------------------------------------------------------------------

/** 太空视角比例：1 场景单位 = 1,000 km（契约 C4；与 solarEclipse 常量同值源） */
export const SPACE_UNITS_PER_KM = 1 / 1000;

/** 地球半径（场景单位；契约 C4 验收锚点 6.371） */
export const SPACE_EARTH_RADIUS_UNITS = EARTH_MEAN_RADIUS_KM * SPACE_UNITS_PER_KM;

/**
 * J2000 赤道系 → 场景轴映射（契约 C4 登记）：(X, Y, Z) → (X, Z, −Y)。
 * +Z 北天极 → 场景 +Y；纯旋转（绕 X 轴 −90°），保右手系与长度。
 */
export function j2000ToSceneVec(
  v: readonly [number, number, number] | readonly number[],
  out: MutableVec3
): MutableVec3 {
  const [x, y, z] = v;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
    throw new RangeError(`向量分量必须为有限数，收到 ${x}, ${y}, ${z}`);
  }
  out[0] = x;
  out[1] = z;
  out[2] = -y;
  return out;
}

// ---------------------------------------------------------------------------
// 岁差 + 地球指向（J2000 ↔ ECEF/网格局部；地理配准链登记见文件头）
// ---------------------------------------------------------------------------

/** IAU1976 岁差角（弧度；Meeus 21.2 式，T = J2000 起儒略世纪数，TT≈UTC 近似） */
export interface PrecessionAngles {
  zetaRad: number;
  zRad: number;
  thetaRad: number;
}

/** IAU1976 岁差角（2027 历元 ζ+z ≈ 0.353°——足印配准的主项） */
export function precessionAnglesRad(
  tSec: number,
  out: PrecessionAngles = { zetaRad: 0, zRad: 0, thetaRad: 0 }
): PrecessionAngles {
  if (!Number.isFinite(tSec)) throw new RangeError(`tSec 必须为有限数：${tSec}`);
  const T = (tSec / 86400 + 2440587.5 - 2451545.0) / 36525;
  out.zetaRad = (2306.2181 * T + 0.30188 * T * T + 0.017998 * T * T * T) * ARCSEC;
  out.zRad = (2306.2181 * T + 1.09468 * T * T + 0.018203 * T * T * T) * ARCSEC;
  out.thetaRad = (2004.3109 * T - 0.42665 * T * T - 0.041833 * T * T * T) * ARCSEC;
  return out;
}

/** 绕 z 轴旋转（右手；内部工具） */
function rotZ(x: number, y: number, angleRad: number, out: MutableVec3, z: number): MutableVec3 {
  const c = Math.cos(angleRad);
  const s = Math.sin(angleRad);
  out[0] = x * c - y * s;
  out[1] = x * s + y * c;
  out[2] = z;
  return out;
}

/**
 * J2000 → 平春分点 of date（Meeus：Rz(z)·Ry(−θ)·Rz(ζ)；单测以 Horizons
 * topo 视位置锚点校准方向——反向应用会使足印经度偏 ~0.7°）。
 */
export function j2000ToMeanOfDate(
  v: readonly number[],
  angles: PrecessionAngles,
  out: MutableVec3
): MutableVec3 {
  rotZ(v[0], v[1], angles.zetaRad, out, v[2]);
  // Ry(−θ)：x' = x·cosθ − z·sinθ，z' = x·sinθ + z·cosθ
  const cT = Math.cos(angles.thetaRad);
  const sT = Math.sin(angles.thetaRad);
  const x1 = out[0] * cT - out[2] * sT;
  const z1 = out[0] * sT + out[2] * cT;
  out[0] = x1;
  out[2] = z1;
  return rotZ(out[0], out[1], angles.zRad, out, out[2]);
}

/** J2000 地心 km 向量 → ECEF km（岁差 + Rz(−GMST)；速度/经纬链共用） */
export function j2000KmToEcef(
  posKm: readonly number[],
  tSec: number,
  out: MutableVec3
): MutableVec3 {
  const angles = precessionAnglesRad(tSec);
  j2000ToMeanOfDate(posKm, angles, out);
  return rotZ(out[0], out[1], -gmstRadFromUnixSec(tSec), out, out[2]);
}

/** 大地纬度 → 地心纬度（度；WGS84 扁率，tanψ = (1−e²)·tanφ） */
export function geodeticToGeocentricLatDeg(latDeg: number): number {
  if (!Number.isFinite(latDeg) || Math.abs(latDeg) > 90) {
    throw new RangeError(`纬度越界 [-90, 90]：${latDeg}`);
  }
  if (Math.abs(latDeg) === 90) return latDeg;
  return Math.atan((1 - WGS84_E2) * Math.tan(latDeg * DEG)) / DEG;
}

/** 地心纬度 → 大地纬度（度；上式逆） */
export function geocentricToGeodeticLatDeg(latDeg: number): number {
  if (!Number.isFinite(latDeg) || Math.abs(latDeg) > 90) {
    throw new RangeError(`纬度越界 [-90, 90]：${latDeg}`);
  }
  if (Math.abs(latDeg) === 90) return latDeg;
  return Math.atan(Math.tan(latDeg * DEG) / (1 - WGS84_E2)) / DEG;
}

/**
 * 大地经纬（度）→ 地球网格局部单位向量（three SphereGeometry 等距圆柱贴图
 * 约定：经度 0° → 局部 +X、90°E → 局部 −Z、北极 → 局部 +Y——与贴图
 * u=(λ+180°)/360° 展开一致；纬度按地心值放置使折线与物理影斑共面，
 * EclipseSpaceView 中心线折线/地表点共用此映射）。
 */
export function geodeticToEarthLocalUnit(
  latDeg: number,
  lonDeg: number,
  out: MutableVec3
): MutableVec3 {
  if (!Number.isFinite(lonDeg)) throw new RangeError(`经度必须为有限数：${lonDeg}`);
  const lat = geodeticToGeocentricLatDeg(latDeg) * DEG;
  const lon = lonDeg * DEG;
  out[0] = Math.cos(lat) * Math.cos(lon);
  out[1] = Math.sin(lat);
  out[2] = -Math.cos(lat) * Math.sin(lon);
  return out;
}

/**
 * 地球网格 → 场景旋转矩阵（行主序 3×3）：M = S·P⁻¹·Rz(GMST)·S⁻¹——
 * 网格局部系与 ECEF 同经 S 轴映射（局部 = S·ECEF），故 M 把局部向量转到
 * 场景（J2000 轴映射）姿态；组件经 Matrix4.set 挂到地球 group（每帧只写
 * 矩阵，零 buffer 更新）。
 */
export function earthGroupSceneMatrix3(
  tSec: number,
  out: number[] | Float64Array
): number[] | Float64Array {
  if (out.length !== 9) throw new RangeError(`需要 9 元输出，收到 ${out.length}`);
  const angles = precessionAnglesRad(tSec);
  const gmst = gmstRadFromUnixSec(tSec);
  // 逐列构造：局部基向量 e_i → ECEF（S⁻¹）→ ECI of date（Rz(gmst)）→
  // J2000（P⁻¹ = Rz(−ζ)·Ry(θ)·Rz(−z)）→ 场景（S）
  const col: MutableVec3 = [0, 0, 0];
  const tmp: MutableVec3 = [0, 0, 0];
  for (let i = 0; i < 3; i += 1) {
    // 局部基 → ECEF：S⁻¹(x,y,z)scene-like = (x, −z, y)
    const lx = i === 0 ? 1 : 0;
    const ly = i === 1 ? 1 : 0;
    const lz = i === 2 ? 1 : 0;
    tmp[0] = lx;
    tmp[1] = -lz;
    tmp[2] = ly;
    // ECEF → mean-of-date ECI
    rotZ(tmp[0], tmp[1], gmst, tmp, tmp[2]);
    // P⁻¹：Rz(−z) → Ry(θ) → Rz(−ζ)
    rotZ(tmp[0], tmp[1], -angles.zRad, tmp, tmp[2]);
    const cT = Math.cos(angles.thetaRad);
    const sT = Math.sin(angles.thetaRad);
    const x1 = tmp[0] * cT + tmp[2] * sT;
    const z1 = -tmp[0] * sT + tmp[2] * cT;
    tmp[0] = x1;
    tmp[2] = z1;
    rotZ(tmp[0], tmp[1], -angles.zetaRad, tmp, tmp[2]);
    // J2000 → 场景
    j2000ToSceneVec(tmp, col);
    out[i] = col[0];
    out[3 + i] = col[1];
    out[6 + i] = col[2];
  }
  return out;
}

/**
 * 大地经纬（度）+ 时刻 → 场景单位方向（网格局部向量经 earthGroupSceneMatrix3
 * 同链旋转；测试/组件共用——「食甚足印中心 ≈ 观测点」自洽性锚点）。
 */
export function geodeticToSceneUnit(
  latDeg: number,
  lonDeg: number,
  tSec: number,
  out: MutableVec3
): MutableVec3 {
  geodeticToEarthLocalUnit(latDeg, lonDeg, out);
  const m = earthGroupSceneMatrix3(tSec, SCENE_MATRIX_SCRATCH);
  const x = out[0];
  const y = out[1];
  const z = out[2];
  out[0] = m[0] * x + m[1] * y + m[2] * z;
  out[1] = m[3] * x + m[4] * y + m[5] * z;
  out[2] = m[6] * x + m[7] * y + m[8] * z;
  return out;
}

/** geodeticToSceneUnit 专用矩阵草稿（模块内复用；函数本身仍可重入——
 * 矩阵在单次调用内即产即用，无跨调用状态） */
const SCENE_MATRIX_SCRATCH = new Float64Array(9);

/** 大地经纬输出（out 复用） */
export interface GeodeticLatLon {
  latDeg: number;
  lonDeg: number;
}

/**
 * J2000 地心位置（km）→ 大地经纬（度）：岁差 + Rz(−GMST) 转 ECEF 再取
 * 地心经纬并换算大地纬度（中心线扫掠进度与单测锚点消费）。
 */
export function j2000KmToGeodetic(
  posKm: readonly number[],
  tSec: number,
  out: GeodeticLatLon
): GeodeticLatLon {
  const r = Math.hypot(posKm[0], posKm[1], posKm[2]);
  if (!(r > 0)) throw new RangeError('零向量无经纬');
  const ecef: MutableVec3 = [0, 0, 0];
  j2000KmToEcef(posKm, tSec, ecef);
  const geocentricLat = Math.asin(Math.min(1, Math.max(-1, ecef[2] / r))) / DEG;
  out.latDeg = geocentricToGeodeticLatDeg(geocentricLat);
  out.lonDeg = Math.atan2(ecef[1], ecef[0]) / DEG;
  return out;
}

// ---------------------------------------------------------------------------
// 空间帧状态（geo 星历 → 日月位置 + 真锥渲染段 + 地表足印 shader 参数）
// ---------------------------------------------------------------------------

/** 半影锥渲染段越出地球的余量（km；锥体穿过地球后再延伸的可视长度） */
export const PENUMBRA_RENDER_OVERSHOOT_KM = 15000;

/** 本影放大开关倍率（A4 登记：默认关 = 真实比例；HUD 注明 ×N） */
export const UMBRA_MAGNIFY_FACTOR = 8;

/**
 * 地表影斑边缘软化因子（GLSL 模板注入；沿 earthShadow.ts 登记口径的
 * 0.92/1.12 smoothstep 半影软化手法——契约 C1 明确允许沿用的部分）。
 */
export const SHADOW_EDGE_SOFT_INNER = 0.92;
export const SHADOW_EDGE_SOFT_OUTER = 1.12;

/** 本影地表压暗深度（0–1；shader 同式） */
export const UMBRA_DARKEN_DEPTH = 0.88;

/** 伪本影（环食）地表压暗深度（本影分支的减光形态，环食地表不全黑——科学口径） */
export const ANTUMBRA_DARKEN_DEPTH = 0.5;

/** 半影地表最大压暗深度（外缘 0 → 近本影 0.35 渐变，shader 同式） */
export const PENUMBRA_DARKEN_DEPTH = 0.35;

/**
 * 太空视角逐帧状态（spaceFrameState 输出；out 复用零 GC）。
 * 场景量以场景单位（1=1,000 km）表达；shader 锥参数与渲染段同源自
 * 契约 C1 真锥函数（km 域解析后统一缩放，禁止圆柱近似）。
 */
export interface EclipseSpaceFrameState {
  /** 太阳方向（场景，单位向量，指向太阳） */
  sunDirScene: MutableVec3;
  /** 月球位置（场景单位） */
  moonPosScene: MutableVec3;
  /** 月球地心距离（km；假想模式为滑杆改写值） */
  moonDistKm: number;
  /** 地球网格 → 场景旋转矩阵（行主序 3×3；earthGroupSceneMatrix3 输出复用） */
  earthMatrix3: Float64Array;
  /** 影轴（场景，单位向量，背日向——本影/半影共轴） */
  shadowAxisScene: MutableVec3;
  /** 本影锥顶点（场景单位；shader 逐像素锥内判定用） */
  umbraApexScene: MutableVec3;
  /** 本影锥半角正切 */
  umbraTan: number;
  /** 半影锥顶点（场景单位） */
  penApexScene: MutableVec3;
  /** 半影锥半角正切 */
  penTan: number;
  /** 本影锥渲染段：锥尖位置（场景 = 顶点）、锥尖→底方向、长度、底半径 */
  umbraTipScene: MutableVec3;
  umbraDirScene: MutableVec3;
  umbraLenUnits: number;
  umbraBaseRadiusUnits: number;
  /** 半影锥渲染段（锥尖在月球向日侧，向背日向展开越过地球） */
  penTipScene: MutableVec3;
  penDirScene: MutableVec3;
  penLenUnits: number;
  penBaseRadiusUnits: number;
  /** 地表本影足印（契约 C1 umbraFootprint；不存在时 exists=false） */
  footExists: boolean;
  footIsAntumbra: boolean;
  footCenterScene: MutableVec3;
  footCenterKmJ2000: MutableVec3;
  footMinorKm: number;
  footMajorKm: number;
}

/** 空空间帧状态（挂载期分配一次） */
export function emptyEclipseSpaceFrameState(): EclipseSpaceFrameState {
  return {
    sunDirScene: [1, 0, 0],
    moonPosScene: [0, 0, 0],
    moonDistKm: 384400,
    earthMatrix3: new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]),
    shadowAxisScene: [1, 0, 0],
    umbraApexScene: [0, 0, 0],
    umbraTan: 0.0046,
    penApexScene: [0, 0, 0],
    penTan: 0.0046,
    umbraTipScene: [0, 0, 0],
    umbraDirScene: [1, 0, 0],
    umbraLenUnits: 0,
    umbraBaseRadiusUnits: 0,
    penTipScene: [0, 0, 0],
    penDirScene: [1, 0, 0],
    penLenUnits: 0,
    penBaseRadiusUnits: 0,
    footExists: false,
    footIsAntumbra: false,
    footCenterScene: [0, 0, 0],
    footCenterKmJ2000: [0, 0, 0],
    footMinorKm: 0,
    footMajorKm: 0,
  };
}

/**
 * 太空视角逐帧状态（§M4-1/M4-2）：geo 星历插值 → 日月 J2000 位置（假想
 * 模式沿地心方向改写月距——太空视角为真物理路径：影轴随距离改写自然移动，
 * 与地面视角「视对齐保持」思想实验口径的差异已在 M3 登记）→ 契约 C1 真锥
 * 双层 + 地表足印 → 场景量组装。
 *
 * @param geo 事件 geo 序列（契约 C2：8 列单位方向 + 距离 km）
 * @param tSec 事件时间轴秒（越界钳制）
 * @param moonDistOverrideKm 假想月地距离（null = 真实星历值）
 * @param narrativeMoonPosKm 倾角叙事模式月球位置（J2000 km；null = 星历/假想路径）
 * @param out 复用输出（渲染循环零 GC）
 */
export function spaceFrameState(
  geo: EphemerisSeries,
  tSec: number,
  moonDistOverrideKm: number | null,
  narrativeMoonPosKm: readonly [number, number, number] | null,
  out: EclipseSpaceFrameState = emptyEclipseSpaceFrameState()
): EclipseSpaceFrameState {
  if (moonDistOverrideKm !== null && !(moonDistOverrideKm > 0)) {
    throw new RangeError(`月地距离改写必须为正：${moonDistOverrideKm}`);
  }
  const row = interpolateEphemeris(geo, tSec);
  const sample = geoSampleFromRow(row, tSec);

  // 影轴用迟滞太阳位置（光行时 ~499s；地理配准链登记见文件头——月光行时
  // 1.3s ≈ 1 km 忽略；窗端 −499s 由 interpolateEphemeris 钳制，登记近似）
  const tauSunSec = sample.sunDistKm / SPEED_OF_LIGHT_KM_S;
  const rowSun = interpolateEphemeris(geo, tSec - tauSunSec);
  const sampleSun = geoSampleFromRow(rowSun, tSec - tauSunSec);
  const sunPosKm: [number, number, number] = [
    sampleSun.sunDir[0] * sampleSun.sunDistKm,
    sampleSun.sunDir[1] * sampleSun.sunDistKm,
    sampleSun.sunDir[2] * sampleSun.sunDistKm,
  ];
  let moonPosKm: [number, number, number];
  if (narrativeMoonPosKm) {
    moonPosKm = [narrativeMoonPosKm[0], narrativeMoonPosKm[1], narrativeMoonPosKm[2]];
    out.moonDistKm = Math.hypot(moonPosKm[0], moonPosKm[1], moonPosKm[2]);
  } else {
    const dist = moonDistOverrideKm ?? sample.moonDistKm;
    moonPosKm = [
      sample.moonDir[0] * dist,
      sample.moonDir[1] * dist,
      sample.moonDir[2] * dist,
    ];
    out.moonDistKm = dist;
  }

  // 契约 C1 真锥（km 域；禁止圆柱近似）
  const umbra = umbraCone(sunPosKm, moonPosKm);
  const pen = penumbraCone(sunPosKm, moonPosKm);
  const foot = umbraFootprint(umbra, [0, 0, 0], EARTH_MEAN_RADIUS_KM);

  j2000ToSceneVec(sampleSun.sunDir, out.sunDirScene);
  out.moonPosScene[0] = moonPosKm[0] * SPACE_UNITS_PER_KM;
  out.moonPosScene[1] = moonPosKm[2] * SPACE_UNITS_PER_KM;
  out.moonPosScene[2] = -moonPosKm[1] * SPACE_UNITS_PER_KM;
  earthGroupSceneMatrix3(tSec, out.earthMatrix3);

  j2000ToSceneVec(umbra.axis, out.shadowAxisScene);
  j2000ToSceneVec(umbra.apexKm, out.umbraApexScene);
  out.umbraApexScene[0] *= SPACE_UNITS_PER_KM;
  out.umbraApexScene[1] *= SPACE_UNITS_PER_KM;
  out.umbraApexScene[2] *= SPACE_UNITS_PER_KM;
  out.umbraTan = Math.tan(umbra.halfAngleRad);
  j2000ToSceneVec(pen.apexKm, out.penApexScene);
  out.penApexScene[0] *= SPACE_UNITS_PER_KM;
  out.penApexScene[1] *= SPACE_UNITS_PER_KM;
  out.penApexScene[2] *= SPACE_UNITS_PER_KM;
  out.penTan = Math.tan(pen.halfAngleRad);

  // 本影渲染段：锥尖 = 顶点，向月球方向（−axis）延伸 lengthKm 至月球（底半径
  // = lengthKm·tan(half) ≈ 月球半径——外公切锥几何自洽）
  out.umbraTipScene[0] = out.umbraApexScene[0];
  out.umbraTipScene[1] = out.umbraApexScene[1];
  out.umbraTipScene[2] = out.umbraApexScene[2];
  out.umbraDirScene[0] = -out.shadowAxisScene[0];
  out.umbraDirScene[1] = -out.shadowAxisScene[1];
  out.umbraDirScene[2] = -out.shadowAxisScene[2];
  out.umbraLenUnits = umbra.lengthKm * SPACE_UNITS_PER_KM;
  out.umbraBaseRadiusUnits = umbra.lengthKm * out.umbraTan * SPACE_UNITS_PER_KM;

  // 半影渲染段：锥尖在月球向日侧顶点，沿背日向展开，越过地球 + 余量
  const penRenderKm = pen.lengthKm + out.moonDistKm + PENUMBRA_RENDER_OVERSHOOT_KM;
  out.penTipScene[0] = out.penApexScene[0];
  out.penTipScene[1] = out.penApexScene[1];
  out.penTipScene[2] = out.penApexScene[2];
  out.penDirScene[0] = out.shadowAxisScene[0];
  out.penDirScene[1] = out.shadowAxisScene[1];
  out.penDirScene[2] = out.shadowAxisScene[2];
  out.penLenUnits = penRenderKm * SPACE_UNITS_PER_KM;
  out.penBaseRadiusUnits = penRenderKm * out.penTan * SPACE_UNITS_PER_KM;

  out.footExists = foot.exists;
  out.footIsAntumbra = foot.isAntumbra;
  if (foot.exists && foot.centerKm) {
    out.footCenterKmJ2000[0] = foot.centerKm[0];
    out.footCenterKmJ2000[1] = foot.centerKm[1];
    out.footCenterKmJ2000[2] = foot.centerKm[2];
    j2000ToSceneVec(foot.centerKm, out.footCenterScene);
    out.footCenterScene[0] *= SPACE_UNITS_PER_KM;
    out.footCenterScene[1] *= SPACE_UNITS_PER_KM;
    out.footCenterScene[2] *= SPACE_UNITS_PER_KM;
    out.footMinorKm = foot.minorAxisKm;
    out.footMajorKm = foot.majorAxisKm;
  } else {
    out.footMinorKm = 0;
    out.footMajorKm = 0;
  }
  return out;
}

// ---------------------------------------------------------------------------
// 本影地面移动速度（§1.2 验收锚点：>1,700 km/h 自西向东）
// ---------------------------------------------------------------------------

/** 地面速度中心差分半窗（秒） */
export const GROUND_SPEED_HALF_WINDOW_SEC = 30;

/**
 * 本影足印地面移动速度（km/h；相对旋转地表——ECEF 弦长中心差分）。
 * 足印任一端不存在（影锥掠过地球外/窗外）返回 null。
 *
 * @param geo 事件 geo 序列
 * @param tSec 事件时间轴秒
 * @param moonDistOverrideKm 假想月地距离（null = 真实）
 */
export function umbraGroundSpeedKmh(
  geo: EphemerisSeries,
  tSec: number,
  moonDistOverrideKm: number | null = null
): number | null {
  const scratch = emptyEclipseSpaceFrameState();
  const ecef = (t: number): [number, number, number] | null => {
    spaceFrameState(geo, t, moonDistOverrideKm, null, scratch);
    if (!scratch.footExists) return null;
    const v: MutableVec3 = [0, 0, 0];
    j2000KmToEcef(scratch.footCenterKmJ2000, t, v);
    return v;
  };
  const a = ecef(tSec - GROUND_SPEED_HALF_WINDOW_SEC);
  const b = ecef(tSec + GROUND_SPEED_HALF_WINDOW_SEC);
  if (!a || !b) return null;
  const dKm = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  return (dKm / (2 * GROUND_SPEED_HALF_WINDOW_SEC)) * 3600;
}

// ---------------------------------------------------------------------------
// 食带中心线（path → 地表局部坐标折线 + 已扫过段进度）
// ---------------------------------------------------------------------------

/** 中心线折线离地高度（km；防与地表 z-fighting 的贴地抬升） */
export const PATH_LINE_ALTITUDE_KM = 60;

/**
 * path 数据（[[latDeg, lonDeg, durationSec], …]）→ 地球局部单位向量平铺数组
 * （n×3；组件按 (地球半径+抬升)·SPACE_UNITS_PER_KM 缩放为折线顶点，随地球
 * 网格自转——地理量天然贴地）。
 */
export function buildPathLocalUnits(path: readonly (readonly number[])[]): Float32Array {
  if (path.length < 2) throw new RangeError(`中心线折线至少 2 点，收到 ${path.length}`);
  const out = new Float32Array(path.length * 3);
  const v: MutableVec3 = [0, 0, 0];
  for (let i = 0; i < path.length; i += 1) {
    geodeticToEarthLocalUnit(path[i][0], path[i][1], v);
    out[i * 3] = v[0];
    out[i * 3 + 1] = v[1];
    out[i * 3 + 2] = v[2];
  }
  return out;
}

/**
 * 足印中心（大地经纬）→ 中心线扫掠进度（0–1；最近顶点索引归一）。
 * 「已扫过段变色」的 uniform 输入（§4.4）；O(n) 逐顶点比较，n ~ 100–200。
 */
export function pathSweepProgress01(
  pathLocalUnits: Float32Array,
  latDeg: number,
  lonDeg: number
): number {
  const n = Math.floor(pathLocalUnits.length / 3);
  if (n < 2) throw new RangeError('折线顶点不足');
  const p: MutableVec3 = [0, 0, 0];
  geodeticToEarthLocalUnit(latDeg, lonDeg, p);
  let best = 0;
  let bestDot = -Infinity;
  for (let i = 0; i < n; i += 1) {
    const d =
      pathLocalUnits[i * 3] * p[0] +
      pathLocalUnits[i * 3 + 1] * p[1] +
      pathLocalUnits[i * 3 + 2] * p[2];
    if (d > bestDot) {
      bestDot = d;
      best = i;
    }
  }
  return best / (n - 1);
}

// ---------------------------------------------------------------------------
// 倾角叙事模式（§M4-4；A5 登记 + 契约 C7 朔望参数化）
// ---------------------------------------------------------------------------

/** 白道倾角真实值（度；data/moons.ts 同源口径） */
export const MOON_ORBIT_INCLINATION_DEG = 5.145;

/** 倾角叙事显示倍率（A5 登记：5.145° × 4 ≈ 20.6° 可辨；HUD 标注） */
export const INCLINATION_DISPLAY_FACTOR = 4;

/** 叙事轨道半径（km；月球平均距离） */
export const NARRATIVE_ORBIT_RADIUS_KM = 384400;

/** 叙事轨道周期（事件时间轴秒/圈——叙事时间尺度登记，非真实恒星月） */
export const NARRATIVE_PHASE_PERIOD_SEC = 1800;

/**
 * 叙事交点回归周期（轨道圈数/交点整周）：取 12.37（≈真实一年内朔望月数），
 * 使「命中窗口」以食季节奏出现——约每 6 圈靠近一次交点对齐。
 */
export const NARRATIVE_NODE_CYCLE_ORBITS = 12.37;

/** 叙事相位/交点角（narrativeAngles 输出；out 复用） */
export interface NarrativeAngles {
  phaseRad: number;
  nodeRad: number;
}

/**
 * 事件时间轴秒 → 叙事轨道相位与升交点黄经（tSec 纯函数——seek 一致性红线；
 * t0 取时间窗起点，跨页签确定性）。
 */
export function narrativeAngles(
  tSec: number,
  t0: number,
  out: NarrativeAngles = { phaseRad: 0, nodeRad: 0 }
): NarrativeAngles {
  if (!Number.isFinite(tSec) || !Number.isFinite(t0)) {
    throw new RangeError(`时刻必须为有限数：tSec=${tSec}, t0=${t0}`);
  }
  const twoPi = Math.PI * 2;
  const phase = ((tSec - t0) / NARRATIVE_PHASE_PERIOD_SEC) * twoPi;
  const node = phase / NARRATIVE_NODE_CYCLE_ORBITS;
  out.phaseRad = ((phase % twoPi) + twoPi) % twoPi;
  out.nodeRad = ((node % twoPi) + twoPi) % twoPi;
  return out;
}

/**
 * 叙事轨道基向量（J2000 赤道系，单位、正交）：轨道面 = 黄道面绕交点线
 * 倾斜 incRad——e1 指向升交点、e2 = 轨道面内与 e1 垂直方向；黄道 → 赤道
 * 经平黄赤交角旋转（solarEclipseLab.ECLIPTIC_OBLIQUITY_DEG 同源）。
 * 轨道点(φ) = (e1·cosφ + e2·sinφ)·r。
 */
export function narrativeOrbitBasis(
  nodeRad: number,
  incRad: number,
  e1Out: MutableVec3,
  e2Out: MutableVec3
): void {
  if (!Number.isFinite(nodeRad) || !Number.isFinite(incRad)) {
    throw new RangeError(`角度必须为有限数：node=${nodeRad}, inc=${incRad}`);
  }
  // 黄道系内：e1 = (cosΩ, sinΩ, 0)，e2 = (−sinΩ·cos i, cosΩ·cos i, sin i)
  const cO = Math.cos(nodeRad);
  const sO = Math.sin(nodeRad);
  const cI = Math.cos(incRad);
  const sI = Math.sin(incRad);
  const e1Ecl: MutableVec3 = [cO, sO, 0];
  const e2Ecl: MutableVec3 = [-sO * cI, cO * cI, sI];
  // 黄道 → 赤道：绕 X 轴 +ε 旋转
  const eps = ECLIPTIC_OBLIQUITY_DEG * DEG;
  const cE = Math.cos(eps);
  const sE = Math.sin(eps);
  const rot = (v: MutableVec3, o: MutableVec3): void => {
    o[0] = v[0];
    o[1] = v[1] * cE - v[2] * sE;
    o[2] = v[1] * sE + v[2] * cE;
  };
  rot(e1Ecl, e1Out);
  rot(e2Ecl, e2Out);
}

/**
 * 叙事月球位置（J2000 km）：夸张倾角圆轨道上按相位取点。
 *
 * 契约 C7 朔望参数化：syzygyOffsetRad = 0 为本条目朔态用法（月球扫全轨道，
 * 朔位附近演示月影投地球）；月食条目复用时传 π 使演示锚定望位（地影投月球）
 * ——本函数只做几何取点，朔/望语义由调用方相位约定承载，未写死朔态。
 *
 * @param phaseRad 轨道相位（弧度，自升交点起算）
 * @param nodeRad 升交点黄经（弧度）
 * @param incRad 轨道倾角（弧度；叙事模式传夸张值，A5 登记）
 * @param distKm 轨道半径（km）
 * @param syzygyOffsetRad 朔望参数化偏移（弧度；朔 0 / 望 π，契约 C7）
 */
export function narrativeMoonPosKm(
  phaseRad: number,
  nodeRad: number,
  incRad: number,
  distKm: number,
  out: MutableVec3,
  syzygyOffsetRad = 0
): MutableVec3 {
  if (!(distKm > 0)) throw new RangeError(`轨道半径必须为正：${distKm}`);
  const e1: MutableVec3 = [0, 0, 0];
  const e2: MutableVec3 = [0, 0, 0];
  narrativeOrbitBasis(nodeRad, incRad, e1, e2);
  const phi = phaseRad + syzygyOffsetRad;
  const c = Math.cos(phi);
  const s = Math.sin(phi);
  out[0] = (e1[0] * c + e2[0] * s) * distKm;
  out[1] = (e1[1] * c + e2[1] * s) * distKm;
  out[2] = (e1[2] * c + e2[2] * s) * distKm;
  return out;
}

// ---------------------------------------------------------------------------
// 相机与视角切换（§M4-3；C4 太空档相机域 + 1–2s 插值运镜姿态）
// ---------------------------------------------------------------------------

/** 太空档相机近/远平面（场景单位；近 0.5 = 500 km——深度分辨率登记见组件） */
export const SPACE_CAMERA_NEAR_UNITS = 0.5;
export const SPACE_CAMERA_FAR_UNITS = 5000;

/** 太空档轨道相机半径域（场景单位；§2.2 原 8–600，§M8-4 上限放宽至 3,800——
 * 两档通用，可退到看全八行星轨道全景；星穹 4,500/far 5,000 仍在外） */
export const SPACE_CAMERA_RADIUS_MIN_UNITS = 8;
export const SPACE_CAMERA_RADIUS_MAX_UNITS = 3800;

/** 远景日盘距离/半径（场景单位；A3 距离压缩登记——真实 149,600 单位超域；
 * 半径按真实视半径 0.267° 折算，从地球看去日盘角尺度真实） */
export const SPACE_SUN_DISK_DISTANCE_UNITS = 1500;
export const SPACE_SUN_DISK_RADIUS_UNITS =
  Math.tan(0.267 * DEG) * SPACE_SUN_DISK_DISTANCE_UNITS;

/** 视角切换运镜时长（秒；§2.2「1–2s 插值运镜」取 1.6s） */
export const VIEW_TRANSITION_SEC = 1.6;

/** 太空档进场终点半径（场景单位；DSCOVR/EPIC 式日侧机位） */
export const SPACE_INTRO_END_RADIUS_UNITS = 42;

/** 太空档进场起点半径（远处滑入） */
export const SPACE_INTRO_START_RADIUS_UNITS = 320;

/** 进场横摆角（弧度；起点相对终点绕场景 Y 偏转，产生弧线运镜） */
export const SPACE_INTRO_SWING_RAD = 0.45;

/** smoothstep（GLSL 同式标量版） */
function smooth01(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

/** 运镜姿态（相机位置 + FOV；out 复用） */
export interface ViewIntroPose {
  pos: MutableVec3;
  fovDeg: number;
}

/** 地面档默认 FOV（labGestures.LAB_FOV_DEFAULT_DEG 同值；单测锁定同源） */
export const GROUND_INTRO_FOV_END_DEG = 65;

/** 地面档进场起始 FOV（广角收束；≤ labGestures.LAB_FOV_MAX_DEG=85 域内） */
export const GROUND_INTRO_FOV_START_DEG = 85;

/** 地面档进场高度角附加偏移（度；自上向下压向太阳） */
export const GROUND_INTRO_ALT_OFFSET_DEG = 18;

/**
 * 太空档进场运镜（captureViewTransition 手法参考——from/to 姿态捕获 +
 * smoothstep 插值，实现独立于主场景 CameraController）：日侧机位沿太阳
 * 方向自远滑入 + 绕 Y 横摆弧线；FOV 收束到默认值。
 *
 * @param sunDirScene 太阳方向（场景，单位向量）
 * @param t01 运镜进度（0–1）
 */
export function spaceIntroPose(
  sunDirScene: readonly [number, number, number] | readonly number[],
  t01: number,
  out: ViewIntroPose,
  endRadiusUnits: number = SPACE_INTRO_END_RADIUS_UNITS,
  startRadiusUnits: number = SPACE_INTRO_START_RADIUS_UNITS
): ViewIntroPose {
  const s = smooth01(t01);
  const radius = startRadiusUnits + (endRadiusUnits - startRadiusUnits) * s;
  const swing = SPACE_INTRO_SWING_RAD * (1 - s);
  const c = Math.cos(swing);
  const sn = Math.sin(swing);
  const [x, y, z] = sunDirScene;
  // 绕场景 +Y 偏转 swing 后按半径取位（日侧：相机位于太阳方向一侧回望地球）
  out.pos[0] = (x * c + z * sn) * radius;
  out.pos[1] = y * radius;
  out.pos[2] = (-x * sn + z * c) * radius;
  out.fovDeg = GROUND_INTRO_FOV_END_DEG;
  return out;
}

/**
 * 地面档进场运镜：视线自太阳上方 GROUND_INTRO_ALT_OFFSET_DEG 压回太阳，
 * FOV 自广角收束（反转轨道范式——相机在视线反方向）。返回视线高度/方位
 * 角与 FOV，组件经 sceneDirFromAltAz 求位（复用契约 C4 单一事实源）。
 */
export interface GroundIntroAim {
  altDeg: number;
  azDeg: number;
  fovDeg: number;
}

export function groundIntroAim(
  sunAltDeg: number,
  sunAzDeg: number,
  t01: number,
  out: GroundIntroAim
): GroundIntroAim {
  if (!Number.isFinite(sunAltDeg) || !Number.isFinite(sunAzDeg)) {
    throw new RangeError(`太阳方位必须为有限数：alt=${sunAltDeg}, az=${sunAzDeg}`);
  }
  const s = smooth01(t01);
  out.altDeg = Math.min(88, sunAltDeg + GROUND_INTRO_ALT_OFFSET_DEG * (1 - s));
  out.azDeg = sunAzDeg;
  out.fovDeg =
    GROUND_INTRO_FOV_START_DEG + (GROUND_INTRO_FOV_END_DEG - GROUND_INTRO_FOV_START_DEG) * s;
  return out;
}

/** 视角档（§3.2 地面/太空分段控件） */
export type EclipseViewMode = 'ground' | 'space';

// ---------------------------------------------------------------------------
// M7：太空视角观感增强（版本 1.1；A15/A16/A17 登记）
// ---------------------------------------------------------------------------

/**
 * 太空档星穹壳半径（场景单位）：> 行星层最远压缩半径（海王星 <4,300）、
 * < 相机 far（5,000）——星空永远在行星轨道层之外（M7-1）。
 */
export const SPACE_STAR_DOME_RADIUS_UNITS = 4500;

/** 银河带壳半径（星穹内侧一线；additive 无深度写，与星点无遮挡语义） */
export const SPACE_MILKY_WAY_RADIUS_UNITS = 4400;

/**
 * J2000 赤道系 → 场景轴映射矩阵（行主序 3×3；j2000ToSceneVec 的矩阵形，
 * 太空档星穹 shader 以常量 uEqToScene 消费——J2000 固定朝向，无周日旋转）。
 */
export const J2000_SCENE_MATRIX3: readonly number[] = [1, 0, 0, 0, 0, 1, 0, -1, 0];

/** 北银极 J2000（度；A15 登记：银道面方位按真实常量取向，带形态为艺术再现） */
export const GALACTIC_POLE_RA_DEG = 192.85948;
export const GALACTIC_POLE_DEC_DEG = 27.12825;

/** 银心方向 J2000（度；人马座 A* 方位——银河带核球增亮的真实取向锚点） */
export const GALACTIC_CENTER_RA_DEG = 266.405;
export const GALACTIC_CENTER_DEC_DEG = -28.93617;

/** RA/Dec（度，J2000）→ 场景单位方向（xe = cosδ·cosα 约定 + 契约 C4 轴映射） */
export function equatorialSceneDir(raDeg: number, decDeg: number, out: MutableVec3): MutableVec3 {
  if (!Number.isFinite(raDeg) || !Number.isFinite(decDeg)) {
    throw new RangeError(`RA/Dec 必须为有限数：${raDeg}, ${decDeg}`);
  }
  const ra = raDeg * DEG;
  const dec = decDeg * DEG;
  const cosDec = Math.cos(dec);
  return j2000ToSceneVec([cosDec * Math.cos(ra), cosDec * Math.sin(ra), Math.sin(dec)], out);
}

/**
 * 月球放大倍率（M7-3；A16 登记：**默认开**——真实比例下月球直径仅地球的
 * 27%、默认机位视直径 ~0.5° 近似亮点；×4 后视觉半径 ~7 单位与地球同量级。
 * HUD/面板徽标常显倍率，关闭即回真实比例；i18n 文案数值与本常量同步维护）。
 */
export const MOON_MAGNIFY_FACTOR = 4;

/**
 * 影锥径向显示倍率（A16 衔接口径）：月球放大时本影/半影锥**基部随月球同倍
 * 径向放大**保持「锥从月缘收敛」视觉连贯（锥角失真登记艺术化）；A4 本影
 * 放大 ×UMBRA_MAGNIFY_FACTOR 正交叠乘（只作用本影）。地表影斑 shader
 * **不消费本函数**——影斑仍由真锥几何/A4 开关独立控制（物理真值不随动）。
 * 双开关全关时严格 = 1（真实比例回归防守，单测锁定）。
 */
export function coneRadialScale(
  kind: 'umbra' | 'penumbra',
  umbraMagnify: boolean,
  moonMagnify: boolean
): number {
  const moonScale = moonMagnify ? MOON_MAGNIFY_FACTOR : 1;
  if (kind === 'penumbra') return moonScale;
  return moonScale * (umbraMagnify ? UMBRA_MAGNIFY_FACTOR : 1);
}

/**
 * 行星轨道远景层线性比例（M7-4；契约 C4 增补比例域）：日心距 ≤1 AU 按
 * 1 AU = 1,500 场景单位线性——与 SPACE_SUN_DISK_DISTANCE_UNITS 同值源，
 * 太阳日盘即艺术化轨道层的日心锚（A3/A17 几何自洽）。
 */
export const SPACE_AU_LINEAR_UNITS = SPACE_SUN_DISK_DISTANCE_UNITS;

/** 行星层对数压缩系数（场景单位/十倍日心距；>1 AU 外行星收进相机域） */
export const SPACE_PLANET_LOG_UNITS = 1800;

/**
 * 日心距（AU）→ 行星层场景半径（A17 登记：距离压缩艺术化）：
 * r ≤ 1 AU 线性 1,500 单位/AU；r > 1 AU 对数压缩（主场景 L4
 * cosmicDistanceToSceneUnits 同手法）——海王星 30.07 AU → ~4,160 单位
 * < 星穹 4,500 < far 5,000（八大行星全量同框，单测域锚点）。
 * 1 AU 处连续（log10(1)=0），斜率不连续登记为已知形变。
 */
export function compressAuToUnits(rAu: number): number {
  if (!Number.isFinite(rAu) || rAu < 0) {
    throw new RangeError(`日心距必须为非负有限数：${rAu}`);
  }
  if (rAu <= 1) return rAu * SPACE_AU_LINEAR_UNITS;
  return SPACE_AU_LINEAR_UNITS + SPACE_PLANET_LOG_UNITS * Math.log10(rAu);
}

/**
 * 行星层对齐矩阵（行主序 3×3；黄道日心系 → 场景）：基础旋转 = 平黄赤交角
 * Rx(ε) 接契约 C4 轴映射，再叠加**小旋转对齐**——把平轨道要素地球日心方向
 * 精确转到星历 −sunDirScene（平要素 vs 真星历日地连线偏差 ≪1°，A14 同口径；
 * 对齐后地球轨道层位置与场景原点重合，残差单测锁定 <1 单位）。
 *
 * @param earthHelioEcl 地球日心黄道位置（AU，任意模长非零；physics 链输出）
 * @param sunDirScene 星历太阳方向（场景，单位向量；spaceFrameState 输出）
 * @param out 9 元行主序输出（复用零 GC）
 */
export function planetLayerSceneMatrix3(
  earthHelioEcl: readonly number[],
  sunDirScene: readonly number[],
  out: number[] | Float64Array
): number[] | Float64Array {
  if (out.length !== 9) throw new RangeError(`需要 9 元输出，收到 ${out.length}`);
  const [ex, ey, ez] = earthHelioEcl;
  if (!Number.isFinite(ex) || !Number.isFinite(ey) || !Number.isFinite(ez)) {
    throw new RangeError(`地球位置分量必须为有限数：${ex}, ${ey}, ${ez}`);
  }
  const eLen = Math.hypot(ex, ey, ez);
  if (!(eLen > 0)) throw new RangeError('地球位置不能为零向量');
  // 基础旋转 B（行主序）：scene = (eq.x, eq.z, −eq.y)，eq = Rx(ε)·ecl
  const eps = ECLIPTIC_OBLIQUITY_DEG * DEG;
  const cE = Math.cos(eps);
  const sE = Math.sin(eps);
  // B 行 0/1/2：scene.x = ecl.x；scene.y = eq.z = y·sε + z·cε；scene.z = −eq.y = −y·cε + z·sε
  const b = [1, 0, 0, 0, sE, cE, 0, -cE, sE];
  // v0 = normalize(B·ê_e)；t = −sunDirScene（单位）
  const v0x = (b[0] * ex + b[1] * ey + b[2] * ez) / eLen;
  const v0y = (b[3] * ex + b[4] * ey + b[5] * ez) / eLen;
  const v0z = (b[6] * ex + b[7] * ey + b[8] * ez) / eLen;
  const tx = -sunDirScene[0];
  const ty = -sunDirScene[1];
  const tz = -sunDirScene[2];
  // Rodrigues：R 把 v0 转到 t（轴 = v0×t）
  const ax = v0y * tz - v0z * ty;
  const ay = v0z * tx - v0x * tz;
  const az = v0x * ty - v0y * tx;
  const s2 = ax * ax + ay * ay + az * az;
  const c = v0x * tx + v0y * ty + v0z * tz;
  if (s2 < 1e-24) {
    // 已对齐（平要素与星历完全一致的退化情形）：修正为恒等
    for (let i = 0; i < 9; i += 1) out[i] = b[i];
    return out;
  }
  const k = (1 - c) / s2;
  // R = I + [a]× + k·[a]×²（行主序）
  const r = [
    1 + k * (-ay * ay - az * az),
    -az + k * ax * ay,
    ay + k * ax * az,
    az + k * ax * ay,
    1 + k * (-ax * ax - az * az),
    -ax + k * ay * az,
    -ay + k * ax * az,
    ax + k * ay * az,
    1 + k * (-ax * ax - ay * ay),
  ];
  // out = R·B
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      out[row * 3 + col] =
        r[row * 3] * b[col] + r[row * 3 + 1] * b[3 + col] + r[row * 3 + 2] * b[6 + col];
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// M8：「天体比例」双模（真实 / 艺术化放大，L2 观感对齐；A18 登记）
// ---------------------------------------------------------------------------

/** 天体比例档（§M8-1：真实 = M7 形态；艺术化 = L2 观感对齐，**默认档**） */
export type EclipseBodyScaleMode = 'real' | 'art';

/**
 * 艺术化半径层比例因子（A18）：本层 1 AU = 1,500 单位 ÷ 主场景 L2 的
 * SCENE_UNITS_PER_AU(10) = 150——半径映射与 L2 观感**严格等比**
 * （派生断言单测锁定）。
 */
export const SPACE_ART_RADIUS_FACTOR = SPACE_AU_LINEAR_UNITS / SCENE_UNITS_PER_AU;

/**
 * 天体半径（艺术化档，场景单位）：主场景 `visualBodyRadius` 对数压缩公式
 * **单一事实源**（import 不复制）× 层因子。地球 ~93、月球 ~41、木星 ~233、
 * 太阳 ~381 单位——非真实比例，A18 登记（分段控件档名 + 科普卡明示）。
 */
export function artBodyRadiusUnits(radiusKm: number): number {
  return visualBodyRadius(radiusKm) * SPACE_ART_RADIUS_FACTOR;
}

/** 艺术化地球半径与相对真实档的缩放倍率（组件按档写 group scale） */
export const SPACE_ART_EARTH_RADIUS_UNITS = artBodyRadiusUnits(EARTH_MEAN_RADIUS_KM);
export const SPACE_ART_EARTH_SCALE = SPACE_ART_EARTH_RADIUS_UNITS / SPACE_EARTH_RADIUS_UNITS;

/** 艺术化月球缩放倍率（相对真实半径 1.7374 单位） */
export const SPACE_ART_MOON_SCALE =
  artBodyRadiusUnits(MOON_MEAN_RADIUS_KM) / (MOON_MEAN_RADIUS_KM * SPACE_UNITS_PER_KM);

/**
 * 影锥径向显示倍率（按档）：真实档转发 coneRadialScale（A4/A16 语义不变）；
 * 艺术化档 = SPACE_ART_MOON_SCALE（锥基随艺术化月球同倍收敛，锥角失真
 * 沿 A18 登记）——**艺术化档忽略 A4/A16 开关**（差异登记：影斑角距投影
 * 在放大地球上已可辨，×8 叠加会破坏锥-月衔接；两开关在艺术化档隐藏）。
 */
export function coneRadialScaleForMode(
  kind: 'umbra' | 'penumbra',
  mode: EclipseBodyScaleMode,
  umbraMagnify: boolean,
  moonMagnify: boolean
): number {
  if (mode === 'art') return SPACE_ART_MOON_SCALE;
  return coneRadialScale(kind, umbraMagnify, moonMagnify);
}

/** 艺术化档相机域（地球半径 ~93 单位：机位须在球外） */
export const SPACE_ART_CAMERA_RADIUS_MIN_UNITS = 110;

/**
 * 艺术化档默认全景机位（M8 补丁 P1，用户目验裁决 2026-08-19）：相机置
 * **反日侧**、抬升 SPACE_ART_OVERVIEW_ALT_RAD、半径 620 单位，look at 地球
 * （原点）——太阳居中偏上、地月前景、内行星轨道同框（L2 截图同款构图）；
 * 为默认机位（进入/切档/切页签运镜至此），用户仍可自由旋转缩放。
 */
export const SPACE_ART_INTRO_END_RADIUS_UNITS = 620;
export const SPACE_ART_INTRO_START_RADIUS_UNITS = 1800;
export const SPACE_ART_OVERVIEW_ALT_RAD = (18 * Math.PI) / 180;

/**
 * 艺术化档全景运镜姿态（P1）：终点方向 = −sunDir 的水平分量抬升
 * SPACE_ART_OVERVIEW_ALT_RAD；自远端滑入（spaceIntroPose 同款 smoothstep，
 * 无横摆——全景构图以太阳-地球连线为轴保持稳定）。
 */
export function spaceArtOverviewPose(
  sunDirScene: readonly [number, number, number] | readonly number[],
  t01: number,
  out: ViewIntroPose
): ViewIntroPose {
  const s = smooth01(t01);
  const radius =
    SPACE_ART_INTRO_START_RADIUS_UNITS +
    (SPACE_ART_INTRO_END_RADIUS_UNITS - SPACE_ART_INTRO_START_RADIUS_UNITS) * s;
  // 反日向水平分量（sunDir 近黄道面，y 分量小；退化时兜底 +X）
  let hx = -sunDirScene[0];
  let hz = -sunDirScene[2];
  const hLen = Math.hypot(hx, hz);
  if (hLen > 1e-9) {
    hx /= hLen;
    hz /= hLen;
  } else {
    hx = 1;
    hz = 0;
  }
  const cA = Math.cos(SPACE_ART_OVERVIEW_ALT_RAD);
  const sA = Math.sin(SPACE_ART_OVERVIEW_ALT_RAD);
  out.pos[0] = hx * cA * radius;
  out.pos[1] = sA * radius;
  out.pos[2] = hz * cA * radius;
  out.fovDeg = GROUND_INTRO_FOV_END_DEG;
  return out;
}

/**
 * 艺术化档地表影斑帽状态（§M8-3 角距投影；out 复用零 GC）：
 * shader 按「表面方向与帽心方向的角距」绘制影斑——**半径无关映射**，
 * 放大球面上位置与相对大小仍真实；椭圆取圆形近似（A18 登记）。
 */
export interface ArtShadowCapState {
  /** 本影帽心方向（场景，单位向量 = 真实足印中心方向；无足印时置零） */
  umbraDir: MutableVec3;
  /** 本影帽角半径（弧度 = asin(足印短半轴/R⊕)；无足印为 0） */
  umbraAngRad: number;
  /** 本影压暗深度（真本影 0.88 / 伪本影 0.5，同真实档常量） */
  umbraDepth01: number;
  /** 半影帽心方向（影轴对地心最近点方向；轴过地心时退化取月球方向） */
  penDir: MutableVec3;
  /** 半影帽角半径（弧度 = asin(该处锥截面半径/R⊕)） */
  penAngRad: number;
}

/** 空影斑帽状态（挂载期分配一次） */
export function emptyArtShadowCapState(): ArtShadowCapState {
  return {
    umbraDir: [0, 0, 0],
    umbraAngRad: 0,
    umbraDepth01: UMBRA_DARKEN_DEPTH,
    penDir: [1, 0, 0],
    penAngRad: 0,
  };
}

/** 艺术化档影斑帽（从 spaceFrameState 输出派生；每帧 CPU 侧计算写 uniform） */
export function artShadowCap(
  space: EclipseSpaceFrameState,
  out: ArtShadowCapState = emptyArtShadowCapState()
): ArtShadowCapState {
  // 本影帽：真实足印中心方向 + 角半径（footMinorKm 为全短轴 → 半轴/R⊕）
  if (space.footExists && space.footMinorKm > 0) {
    const fLen = Math.hypot(
      space.footCenterScene[0],
      space.footCenterScene[1],
      space.footCenterScene[2]
    );
    if (fLen > 1e-9) {
      out.umbraDir[0] = space.footCenterScene[0] / fLen;
      out.umbraDir[1] = space.footCenterScene[1] / fLen;
      out.umbraDir[2] = space.footCenterScene[2] / fLen;
      out.umbraAngRad = Math.asin(
        Math.min(1, space.footMinorKm / 2 / EARTH_MEAN_RADIUS_KM)
      );
      out.umbraDepth01 = space.footIsAntumbra ? ANTUMBRA_DARKEN_DEPTH : UMBRA_DARKEN_DEPTH;
    } else {
      out.umbraAngRad = 0;
    }
  } else {
    out.umbraDir[0] = 0;
    out.umbraDir[1] = 0;
    out.umbraDir[2] = 0;
    out.umbraAngRad = 0;
    out.umbraDepth01 = UMBRA_DARKEN_DEPTH;
  }
  // 半影帽：帽心取影轴与地球面**前交点**（月侧穿入点——与本影足印近同向）；
  // 轴不穿球时退化取对地心最近点方向。角半径 = 该处锥截面半径 / R⊕。
  const ax = space.penDirScene;
  const tip = space.penTipScene;
  const b = tip[0] * ax[0] + tip[1] * ax[1] + tip[2] * ax[2];
  const c = tip[0] * tip[0] + tip[1] * tip[1] + tip[2] * tip[2] - SPACE_EARTH_RADIUS_UNITS ** 2;
  const disc = b * b - c;
  const sPen = Math.max(0, disc >= 0 ? -b - Math.sqrt(disc) : -b);
  const cx = tip[0] + ax[0] * sPen;
  const cy = tip[1] + ax[1] * sPen;
  const cz = tip[2] + ax[2] * sPen;
  const rPen = sPen * space.penTan;
  out.penAngRad = rPen <= 0 ? 0 : Math.asin(Math.min(1, rPen / SPACE_EARTH_RADIUS_UNITS));
  const cLen = Math.hypot(cx, cy, cz);
  if (cLen > 1e-9) {
    out.penDir[0] = cx / cLen;
    out.penDir[1] = cy / cLen;
    out.penDir[2] = cz / cLen;
  } else {
    // 影轴恰过地心：帽心退化取月球方向（−背日向）
    out.penDir[0] = -ax[0];
    out.penDir[1] = -ax[1];
    out.penDir[2] = -ax[2];
  }
  return out;
}

// ---------------------------------------------------------------------------
// M8-5：小行星带弥散点云（艺术化档专属；A18 登记：分布示意非真实星表）
// ---------------------------------------------------------------------------

/** 主带径向域（AU；2.1–3.3 主小行星带惯用口径）与厚度 */
export const ASTEROID_BELT_INNER_AU = 2.1;
export const ASTEROID_BELT_OUTER_AU = 3.3;
export const ASTEROID_BELT_THICKNESS_AU = 0.25;

/** 点数与确定性种子（挂载期构建一次，1 draw call） */
export const ASTEROID_BELT_POINT_COUNT = 3000;
export const ASTEROID_BELT_SEED = 0xa57e11d;

/** mulberry32 确定性伪随机（内部工具；种子同 → 序列同） */
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 小行星带点云（行星层局部黄道坐标，n×3 平铺）：径向均匀 [2.1, 3.3] AU、
 * 方位均匀、厚度 ±0.125 AU，逐点经 compressAuToUnits 压缩（与行星轨道
 * 同一比例域）。确定性种子——两次构建逐元一致（单测锁定）。
 */
export function asteroidBeltLocalPoints(
  count: number = ASTEROID_BELT_POINT_COUNT,
  seed: number = ASTEROID_BELT_SEED
): Float32Array {
  if (!Number.isInteger(count) || count <= 0) {
    throw new RangeError(`点数必须为正整数：${count}`);
  }
  const rand = mulberry32(seed);
  const out = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    const rAu = ASTEROID_BELT_INNER_AU + rand() * (ASTEROID_BELT_OUTER_AU - ASTEROID_BELT_INNER_AU);
    const theta = rand() * Math.PI * 2;
    const z = (rand() - 0.5) * ASTEROID_BELT_THICKNESS_AU;
    const x = rAu * Math.cos(theta);
    const y = rAu * Math.sin(theta);
    const r3 = Math.hypot(x, y, z);
    const scale = compressAuToUnits(r3) / r3;
    out[i * 3] = x * scale;
    out[i * 3 + 1] = y * scale;
    out[i * 3 + 2] = z * scale;
  }
  return out;
}

// ---------------------------------------------------------------------------
// M8 补丁 P4：月球绕地轨道环（星历轨道面；「月球像绕太阳」观感修正）
// ---------------------------------------------------------------------------

/** 月轨基向量差分采样偏移（秒；600s 月球移动 ~0.09°，数值稳定且贴瞬时轨道面） */
export const MOON_RING_SAMPLE_OFFSET_SEC = 600;

/**
 * 月球瞬时轨道面基向量（场景系，单位正交）：e1 = 当前月球方向（环过当前
 * 月球位置的锚定保证），e2 = 轨道面内与 e1 垂直方向（沿运动向）；轨道面由
 * geo 星历 t 与 t+Δ 两时刻月球方向叉积确定（窗端 Δ 采样被钳制退化时改用
 * t−Δ 兜底）。环半径由调用方按当前月距（含假想改写）缩放。
 * 环点(φ) = (e1·cosφ + e2·sinφ)·r。
 */
export function moonOrbitRingBasis(
  geo: EphemerisSeries,
  tSec: number,
  e1Out: MutableVec3,
  e2Out: MutableVec3
): void {
  if (!Number.isFinite(tSec)) throw new RangeError(`tSec 必须为有限数：${tSec}`);
  const rowA = interpolateEphemeris(geo, tSec);
  const a = geoSampleFromRow(rowA, tSec);
  const cross = (bDir: readonly number[], n: MutableVec3): number => {
    n[0] = a.moonDir[1] * bDir[2] - a.moonDir[2] * bDir[1];
    n[1] = a.moonDir[2] * bDir[0] - a.moonDir[0] * bDir[2];
    n[2] = a.moonDir[0] * bDir[1] - a.moonDir[1] * bDir[0];
    return Math.hypot(n[0], n[1], n[2]);
  };
  const n: MutableVec3 = [0, 0, 0];
  const rowB = interpolateEphemeris(geo, tSec + MOON_RING_SAMPLE_OFFSET_SEC);
  const b = geoSampleFromRow(rowB, tSec + MOON_RING_SAMPLE_OFFSET_SEC);
  let nLen = cross(b.moonDir, n);
  if (nLen < 1e-9) {
    // 窗末钳制退化：向后差分（法向取反保持 e2 沿运动向）
    const rowC = interpolateEphemeris(geo, tSec - MOON_RING_SAMPLE_OFFSET_SEC);
    const c = geoSampleFromRow(rowC, tSec - MOON_RING_SAMPLE_OFFSET_SEC);
    nLen = cross(c.moonDir, n);
    n[0] = -n[0];
    n[1] = -n[1];
    n[2] = -n[2];
  }
  if (nLen < 1e-12) throw new RangeError('月轨法向退化：星历采样窗过窄');
  n[0] /= nLen;
  n[1] /= nLen;
  n[2] /= nLen;
  // e2 = n × e1（轨道面内、垂直 e1、沿运动向）
  const e2J: MutableVec3 = [
    n[1] * a.moonDir[2] - n[2] * a.moonDir[1],
    n[2] * a.moonDir[0] - n[0] * a.moonDir[2],
    n[0] * a.moonDir[1] - n[1] * a.moonDir[0],
  ];
  j2000ToSceneVec(a.moonDir, e1Out);
  j2000ToSceneVec(e2J, e2Out);
}
