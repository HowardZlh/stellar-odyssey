/**
 * 日全食天文实验室：日食几何纯函数层（E 迭代 M1，契约 C1）
 *
 * 全部业务几何下沉本模块（M2–M5 只消费不改签名）：
 * - 星历族：烘焙序列线性插值（含角度列最短弧处理）/ 地心 → 站心视位置变换
 * - 圆盘族：双圆相交遮挡率 / 食分 / 食型判定（none|partial|annular|total）
 * - 影锥族：本影/半影真锥（锥顶点+轴向+半角，明确禁止 earthShadow.ts 式圆柱近似）/
 *   锥 × 地球球面 → 地表本影椭圆足印（含环食伪本影分支）
 * - 景观族：贝利珠月缘漏光剖面 / 天光非线性感知曲线（衔接 labSky 极限星等链）/
 *   广义相对论星光偏折角（M5 Eddington 消费）
 *
 * 场景空间与坐标系约定（契约 C4，防东西镜像）：
 * - 地面视角：1 场景单位 = 1 km，+Y 天顶、−Z 正北、+X 正东（沿用流星雨契约，
 *   场景向量经 meteorShower.sceneDirFromAltAz 单一事实源，Az=90° → +X 单测锁定）；
 * - 太空视角：1 场景单位 = 1,000 km，地心原点，地心 J2000 赤道系直接映射场景轴；
 * - 影锥几何一律在 km 域计算，进场景只做统一缩放。
 *
 * 物理近似登记（需求 §1.5 + 契约级差异登记）：
 * - 星历 60s 线性插值（C2±3min / C3±3min 段 1s 细采样兜底贝利珠时刻精度）；
 * - 大气折射不建模（烘焙序列取 Horizons AIRLESS 值，三个选定事件太阳高度较高）；
 * - topocentricSunMoon 忽略岁差/章动（J2000 方向直接当瞬时平位置用，方位/高度
 *   系统偏差 ≤0.4°；日月「相对」几何——角距/位置角/食分——不受帧旋转影响）；
 * - 月缘剖面为静态平均天平动姿态（lunar_limb_profile.json 烘焙口径，§1.5 定稿）；
 * - eclipseSkyDarkening 为感知曲线拟合（90% 无感 / 99% 近白天 / 100% 断崖），
 *   锚点为主观亮度而非辐射度真值，登记艺术化。
 *
 * 单位红线：函数入参逐一标注 km / 度 / 弧度；混用即 bug。
 *
 * 数据来源：烘焙星历 public/data/solar_eclipses.json（JPL Horizons + NASA Eclipse
 * Web Site / Espenak，登记见 scripts/bake-data/solarEclipses.ts 文件头）；月缘剖面
 * public/data/lunar_limb_profile.json（LRO LOLA LDEM_4，见 scripts/bake-data/lunarLimb.ts）。
 *
 * 硬性约束：本模块不 import React/three；函数无状态、可重入；
 * CPU/GLSL 镜像纪律同流星雨契约（shader 侧照抄本模块公式不得变形）。
 */

import { sceneDirFromAltAz, type AltAz } from '@/utils/meteorShower';
import { effectiveLimitingMag } from '@/utils/labSky';

// ---------------------------------------------------------------------------
// 常量（物理量 + 契约 C4 场景比例）
// ---------------------------------------------------------------------------

/** 度 → 弧度 */
const DEG = Math.PI / 180;

/** 太阳半径（km，IAU 标称值） */
export const SUN_RADIUS_KM = 695700;

/** 月球平均半径（km，与 LOLA LDEM 基准半径 1737.4 一致） */
export const MOON_MEAN_RADIUS_KM = 1737.4;

/** 地球平均半径（km；足印函数显式收半径参数，此值仅作默认/测试锚点） */
export const EARTH_MEAN_RADIUS_KM = 6371;

/** 太阳平均视半径（度；starDeflectionArcsec 的日面边缘归一基准） */
export const SUN_MEAN_ANGULAR_RADIUS_DEG = 0.26667;

/** 广义相对论日面边缘光偏折（角秒，1.7520″ × R☉/b） */
export const GR_LIMB_DEFLECTION_ARCSEC = 1.752;

/** 月缘高程剖面采样点数（契约 C3：0.5° 步长 × 720 点） */
export const LIMB_PROFILE_SAMPLE_COUNT = 720;

/** 月缘高程剖面极角步长（度） */
export const LIMB_PROFILE_STEP_DEG = 0.5;

/** 地面视角比例：1 场景单位 = 1 km（契约 C4，同流星雨契约 C5） */
export const GROUND_SCENE_UNITS_PER_KM = 1;

/** 太空视角比例：1 场景单位 = 1,000 km（契约 C4；地球 6.371 单位与月地 ~384 单位同框） */
export const SPACE_SCENE_UNITS_PER_KM = 1 / 1000;

/** 日月 billboard quad 所在天穹壳距离（km = 场景单位，契约 C4） */
export const SKY_SHELL_RADIUS_KM = 10000;

/**
 * 全食等效太阳高度角（度）：100% 遮挡的天空 ≈ 深度晨昏蒙影（§1.4——
 * 亮行星与亮星可见；接 labSky.TWILIGHT_LM_ANCHORS 得 lm ≈ 3.5）。
 */
export const TOTALITY_EQUIV_SUN_ALT_DEG = -9;

/**
 * 遮挡率 → 天空感知亮度因子锚点（[遮挡率, 因子]，分段线性；§1.4 口径：
 * 90% 前几乎无感、99% 仍近白天（不暗于民用晨昏）、99%→100% 骤暗断崖）。
 * 主观感知拟合（人眼适应态），登记艺术化——非辐射度线性真值。
 */
export const OBSCURATION_SKY_ANCHORS: readonly (readonly [number, number])[] = [
  [0, 1],
  [0.5, 0.985],
  [0.9, 0.93],
  [0.99, 0.78],
  [0.999, 0.5],
  [1, 0.06],
];

// ---------------------------------------------------------------------------
// 通用小工具（内部）
// ---------------------------------------------------------------------------

type Vec3 = readonly [number, number, number];

function assertFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) throw new RangeError(`${name} 必须为有限数，收到 ${value}`);
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function norm(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}

function scale(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}

function normalize(a: Vec3): Vec3 {
  const n = norm(a);
  if (!(n > 0)) throw new RangeError('零向量无法归一化');
  return scale(a, 1 / n);
}

// ---------------------------------------------------------------------------
// 星历插值（契约 C1 interpolateEphemeris）
// ---------------------------------------------------------------------------

/** 烘焙星历时间序列（契约 C2 的 topo/fineC2/fineC3/geo 块共用结构） */
export interface EphemerisSeries {
  /** 首行时刻（UTC 秒，Unix 纪元；1919 事件为 UT1 视作 UTC，登记近似） */
  t0: number;
  /** 采样间隔（秒，>0） */
  dtSec: number;
  /** 采样行（每行列数一致的数值数组） */
  rows: readonly (readonly number[])[];
}

/** topo 行内的角度列下标（方位角 ×2 + 位置角——插值需走最短弧防 360° 回绕） */
export const TOPO_ANGULAR_COLUMNS: readonly number[] = [1, 4, 6];

/**
 * 星历时间序列线性插值（契约 C1）。
 *
 * @param series 采样序列（60s 粗采样或 1s 细采样段）
 * @param tSec 目标时刻（UTC 秒）；越界钳制到端点（不外推）
 * @param angularColumnIndices 按最短弧插值的角度列（度制，如 TOPO_ANGULAR_COLUMNS）
 * @returns 插值后的行（新数组）
 */
export function interpolateEphemeris(
  series: EphemerisSeries,
  tSec: number,
  angularColumnIndices: readonly number[] = []
): number[] {
  assertFinite(tSec, 'tSec');
  const { t0, dtSec, rows } = series;
  if (!(dtSec > 0) || rows.length === 0) {
    throw new RangeError(`星历序列非法：dtSec=${dtSec}, rows=${rows.length}`);
  }
  const maxIndex = rows.length - 1;
  const f = clamp((tSec - t0) / dtSec, 0, maxIndex);
  const i0 = Math.min(Math.floor(f), maxIndex);
  const i1 = Math.min(i0 + 1, maxIndex);
  const w = f - i0;
  const a = rows[i0];
  const b = rows[i1];
  const out = new Array<number>(a.length);
  for (let c = 0; c < a.length; c += 1) {
    if (angularColumnIndices.includes(c)) {
      // 最短弧：把 b−a 折入 (−180°, 180°] 再线性插值
      const delta = ((((b[c] - a[c] + 180) % 360) + 360) % 360) - 180;
      const v = a[c] + delta * w;
      out[c] = ((v % 360) + 360) % 360;
    } else {
      out[c] = a[c] + (b[c] - a[c]) * w;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 地心 → 站心（契约 C1 topocentricSunMoon）
// ---------------------------------------------------------------------------

/** 地心星历样本（geo 序列插值行的语义化解码；方向为 J2000 赤道系单位向量） */
export interface GeoSample {
  /** 样本时刻（UTC 秒，Unix 纪元） */
  tSec: number;
  /** 太阳地心单位方向（J2000 赤道系） */
  sunDir: Vec3;
  /** 太阳地心距离（km） */
  sunDistKm: number;
  /** 月球地心单位方向（J2000 赤道系） */
  moonDir: Vec3;
  /** 月球地心距离（km） */
  moonDistKm: number;
}

/** geo 序列插值行 → GeoSample（行布局：sunX,sunY,sunZ,sunDistKm,moonX,moonY,moonZ,moonDistKm） */
export function geoSampleFromRow(row: readonly number[], tSec: number): GeoSample {
  if (row.length !== 8) throw new RangeError(`geo 行应为 8 列，收到 ${row.length}`);
  return {
    tSec,
    sunDir: normalize([row[0], row[1], row[2]]),
    sunDistKm: row[3],
    moonDir: normalize([row[4], row[5], row[6]]),
    moonDistKm: row[7],
  };
}

/** 固定观测点（契约 C2 observer 块） */
export interface EclipseObserver {
  /** 大地纬度（度，北正，[-90, 90]） */
  latDeg: number;
  /** 大地经度（度，东正） */
  lonDeg: number;
  /** 海拔（米） */
  altM: number;
}

/** 站心视位置结果（契约 C1 topocentricSunMoon 返回值） */
export interface TopoSunMoon {
  /** 太阳高度角（度，无折射） */
  sunAltDeg: number;
  /** 太阳方位角（度，北起经东 N=0/E=90） */
  sunAzDeg: number;
  /** 太阳视半径（度） */
  sunSdDeg: number;
  /** 月球高度角（度） */
  moonAltDeg: number;
  /** 月球方位角（度） */
  moonAzDeg: number;
  /** 月球视半径（度） */
  moonSdDeg: number;
  /** 月心相对日心的位置角（度，天球北起经东） */
  posAngleDeg: number;
  /** 日月角距（度） */
  sepDeg: number;
}

/** WGS84 长半轴（km）/ 扁率 */
const WGS84_A_KM = 6378.137;
const WGS84_F = 1 / 298.257223563;

/** Unix 秒 → 儒略日（UT） */
function julianDay(tSec: number): number {
  return tSec / 86400 + 2440587.5;
}

/** 格林尼治平恒星时（弧度，IAU 1982 多项式；忽略 UT1−UTC，登记近似） */
function gmstRad(jdUt: number): number {
  const d = jdUt - 2451545.0;
  const t = d / 36525;
  const deg = 280.46061837 + 360.98564736629 * d + 0.000387933 * t * t - (t * t * t) / 38710000;
  return (((deg % 360) + 360) % 360) * DEG;
}

/** 观测点地心坐标（km，ECEF；WGS84 椭球） */
function observerEcefKm(observer: EclipseObserver): Vec3 {
  const lat = observer.latDeg * DEG;
  const lon = observer.lonDeg * DEG;
  const hKm = observer.altM / 1000;
  const e2 = WGS84_F * (2 - WGS84_F);
  const sinLat = Math.sin(lat);
  const n = WGS84_A_KM / Math.sqrt(1 - e2 * sinLat * sinLat);
  return [
    (n + hKm) * Math.cos(lat) * Math.cos(lon),
    (n + hKm) * Math.cos(lat) * Math.sin(lon),
    (n * (1 - e2) + hKm) * sinLat,
  ];
}

/** 绕 z 轴旋转（右手，angleRad 正 = x→y 方向） */
function rotZ(v: Vec3, angleRad: number): Vec3 {
  const c = Math.cos(angleRad);
  const s = Math.sin(angleRad);
  return [v[0] * c - v[1] * s, v[0] * s + v[1] * c, v[2]];
}

/** ECEF 向量 → 站心地平（度；北起经东方位角） */
function ecefToAltAz(vEcef: Vec3, observer: EclipseObserver): { altDeg: number; azDeg: number } {
  const lat = observer.latDeg * DEG;
  const lon = observer.lonDeg * DEG;
  const east: Vec3 = [-Math.sin(lon), Math.cos(lon), 0];
  const north: Vec3 = [
    -Math.sin(lat) * Math.cos(lon),
    -Math.sin(lat) * Math.sin(lon),
    Math.cos(lat),
  ];
  const up: Vec3 = [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
  const u = normalize(vEcef);
  const altDeg = Math.asin(clamp(dot(u, up), -1, 1)) / DEG;
  const azDeg = ((Math.atan2(dot(u, east), dot(u, north)) / DEG) % 360 + 360) % 360;
  return { altDeg, azDeg };
}

/**
 * 地心 → 站心视位置（契约 C1）：由 geo 星历样本与观测点求日月地平坐标、
 * 视半径、月相对日的位置角与角距（视差修正含观测点地心偏移）。
 *
 * 近似登记：忽略岁差/章动（J2000 方向当瞬时平位置，方位/高度系统偏差 ≤0.4°），
 * 忽略光行时差分与大气折射；日月「相对」几何不受影响。
 * 主用途：假想模式（月地距离滑杆）重算与太空/地面视角一致性；
 * 真实事件渲染直接消费烘焙 topo 序列（Horizons 视位置，精度更高）。
 */
export function topocentricSunMoon(sample: GeoSample, observer: EclipseObserver): TopoSunMoon {
  assertFinite(sample.tSec, 'sample.tSec');
  assertFinite(observer.latDeg, 'observer.latDeg');
  assertFinite(observer.lonDeg, 'observer.lonDeg');
  assertFinite(observer.altM, 'observer.altM');
  if (Math.abs(observer.latDeg) > 90) {
    throw new RangeError(`纬度越界 [-90, 90]：${observer.latDeg}`);
  }
  if (!(sample.sunDistKm > 0) || !(sample.moonDistKm > 0)) {
    throw new RangeError('日月地心距离必须为正');
  }
  const theta = gmstRad(julianDay(sample.tSec));
  const obsEcef = observerEcefKm(observer);
  // 观测点 ECEF → 惯性系（ECI = Rz(GMST)·ECEF）
  const obsEci = rotZ(obsEcef, theta);

  const topoOf = (
    dir: Vec3,
    distKm: number,
    radiusKm: number
  ): { altDeg: number; azDeg: number; sdDeg: number; unitEci: Vec3 } => {
    const posEci = scale(dir, distKm);
    const topoEci = sub(posEci, obsEci);
    const topoDist = norm(topoEci);
    // 惯性 → ECEF（Rz(−GMST)）再转地平
    const topoEcef = rotZ(topoEci, -theta);
    const { altDeg, azDeg } = ecefToAltAz(topoEcef, observer);
    const sdDeg = Math.asin(clamp(radiusKm / topoDist, 0, 1)) / DEG;
    return { altDeg, azDeg, sdDeg, unitEci: scale(topoEci, 1 / topoDist) };
  };

  const sun = topoOf(sample.sunDir, sample.sunDistKm, SUN_RADIUS_KM);
  const moon = topoOf(sample.moonDir, sample.moonDistKm, MOON_MEAN_RADIUS_KM);

  // 位置角（月相对日，天球北起经东）与角距：由站心赤道方向计算
  const raDec = (u: Vec3): { ra: number; dec: number } => ({
    ra: Math.atan2(u[1], u[0]),
    dec: Math.asin(clamp(u[2], -1, 1)),
  });
  const s = raDec(sun.unitEci);
  const m = raDec(moon.unitEci);
  const dRa = m.ra - s.ra;
  const posAngleDeg =
    ((Math.atan2(
      Math.cos(m.dec) * Math.sin(dRa),
      Math.cos(s.dec) * Math.sin(m.dec) - Math.sin(s.dec) * Math.cos(m.dec) * Math.cos(dRa)
    ) /
      DEG) %
      360 +
      360) %
    360;
  const sepDeg = Math.acos(clamp(dot(sun.unitEci, moon.unitEci), -1, 1)) / DEG;

  return {
    sunAltDeg: sun.altDeg,
    sunAzDeg: sun.azDeg,
    sunSdDeg: sun.sdDeg,
    moonAltDeg: moon.altDeg,
    moonAzDeg: moon.azDeg,
    moonSdDeg: moon.sdDeg,
    posAngleDeg,
    sepDeg,
  };
}

/**
 * 地平坐标（度）→ 场景方向单位向量（契约 C4；meteorShower.sceneDirFromAltAz
 * 单一事实源转发——Az=90°/Alt=0° → [1,0,0] 正东，防东西镜像单测锁定）。
 */
export function altAzToSceneDirection(altDeg: number, azDeg: number): [number, number, number] {
  assertFinite(altDeg, 'altDeg');
  assertFinite(azDeg, 'azDeg');
  const altAz: AltAz = { altRad: altDeg * DEG, azRad: azDeg * DEG };
  return sceneDirFromAltAz(altAz);
}

// ---------------------------------------------------------------------------
// 双圆几何（契约 C1 eclipseObscuration / eclipseMagnitude / eclipseKind）
// ---------------------------------------------------------------------------

function assertDiskArgs(sunR: number, moonR: number, sepRad: number): void {
  assertFinite(sunR, 'sunR');
  assertFinite(moonR, 'moonR');
  assertFinite(sepRad, 'sepRad');
  if (!(sunR > 0) || !(moonR > 0)) throw new RangeError(`视半径必须为正：sunR=${sunR}, moonR=${moonR}`);
  if (sepRad < 0) throw new RangeError(`角距不得为负：${sepRad}`);
}

/**
 * 两圆盘遮挡面积比（契约 C1，解析双圆相交公式，0–1）。
 *
 * @param sunR 太阳视半径（弧度）
 * @param moonR 月球视半径（弧度）
 * @param sepRad 日月圆心角距（弧度）
 * @returns 月盘遮住日盘的面积比：相切/相离=0，全含=1，环食内含=(moonR/sunR)²
 */
export function eclipseObscuration(sunR: number, moonR: number, sepRad: number): number {
  assertDiskArgs(sunR, moonR, sepRad);
  if (sepRad >= sunR + moonR) return 0;
  if (sepRad <= moonR - sunR) return 1;
  if (sepRad <= sunR - moonR) return (moonR / sunR) ** 2;
  // 透镜相交面积（小角度域按平面圆处理——视半径 ~0.005 rad，球面修正可忽略）
  const d = sepRad;
  const alpha = Math.acos(clamp((d * d + sunR * sunR - moonR * moonR) / (2 * d * sunR), -1, 1));
  const beta = Math.acos(clamp((d * d + moonR * moonR - sunR * sunR) / (2 * d * moonR), -1, 1));
  const lens =
    sunR * sunR * (alpha - Math.sin(alpha) * Math.cos(alpha)) +
    moonR * moonR * (beta - Math.sin(beta) * Math.cos(beta));
  return clamp(lens / (Math.PI * sunR * sunR), 0, 1);
}

/**
 * 食分（契约 C1）：偏食段 = 月盘侵入日面直径的比例 (sunR+moonR−sep)/(2·sunR)；
 * 中心食段（全含/内含）= 视直径比 moonR/sunR（Espenak 口径）。无食时 0。
 */
export function eclipseMagnitude(sunR: number, moonR: number, sepRad: number): number {
  assertDiskArgs(sunR, moonR, sepRad);
  if (sepRad >= sunR + moonR) return 0;
  if (sepRad <= Math.abs(moonR - sunR)) return moonR / sunR;
  return (sunR + moonR - sepRad) / (2 * sunR);
}

/** 食型（契约 C1）：按逐时刻视半径判定，不硬编码事件类型（§1.1） */
export type EclipseKind = 'none' | 'partial' | 'annular' | 'total';

/**
 * 食型判定（契约 C1）：sep ≥ sunR+moonR → none；sep ≤ |moonR−sunR| 时
 * moonR ≥ sunR → total、moonR < sunR → annular；其余 partial。
 * 边界（相切）归入外侧档（相切瞬间遮挡率 0 / 中心食刚成立即切换）。
 */
export function eclipseKind(sunR: number, moonR: number, sepRad: number): EclipseKind {
  assertDiskArgs(sunR, moonR, sepRad);
  if (sepRad >= sunR + moonR) return 'none';
  if (sepRad <= Math.abs(moonR - sunR)) return moonR >= sunR ? 'total' : 'annular';
  return 'partial';
}

// ---------------------------------------------------------------------------
// 真锥影几何（契约 C1 umbraCone / penumbraCone / umbraFootprint；禁圆柱）
// ---------------------------------------------------------------------------

/** 影锥（真锥几何；km，J2000 地心系或任意一致坐标系） */
export interface ShadowCone {
  /** 锥顶点（km） */
  apexKm: Vec3;
  /**
   * 影向轴（单位向量，从锥顶点指向影延伸方向，即背日向）。
   * 本影：锥体在顶点「身后」（月球侧），顶点之外沿 axis 为伪本影（环食）；
   * 半影：锥体在顶点之外沿 axis 展开。
   */
  axis: Vec3;
  /** 半角（弧度） */
  halfAngleRad: number;
  /** 月心到锥顶点的距离（km；本影 = 本影锥长，锚点 ∈ [36 万, 38.5 万]） */
  lengthKm: number;
}

/**
 * 本影真锥（契约 C1）：由日月位置与真实半径解外公切锥。
 * 锥顶点在月球背日侧 lengthKm = rm·D/(rs−rm) 处，半角 asin((rs−rm)/D)。
 *
 * @param sunPosKm 太阳中心位置（km，地心系）
 * @param moonPosKm 月球中心位置（km，地心系）
 */
export function umbraCone(sunPosKm: Vec3, moonPosKm: Vec3): ShadowCone {
  const sm = sub(moonPosKm, sunPosKm);
  const d = norm(sm);
  if (!(d > SUN_RADIUS_KM)) throw new RangeError(`日月距离非法：${d} km`);
  const axis = scale(sm, 1 / d); // 背日向
  const lengthKm = (MOON_MEAN_RADIUS_KM * d) / (SUN_RADIUS_KM - MOON_MEAN_RADIUS_KM);
  const halfAngleRad = Math.asin(clamp((SUN_RADIUS_KM - MOON_MEAN_RADIUS_KM) / d, 0, 1));
  const apexKm: Vec3 = [
    moonPosKm[0] + axis[0] * lengthKm,
    moonPosKm[1] + axis[1] * lengthKm,
    moonPosKm[2] + axis[2] * lengthKm,
  ];
  return { apexKm, axis, halfAngleRad, lengthKm };
}

/**
 * 半影真锥（契约 C1）：内公切锥。锥顶点在月球「向日侧」
 * lengthKm = rm·D/(rs+rm) 处，半角 asin((rs+rm)/D)，锥体沿背日向展开
 * （地表半影直径 > 6,400 km 的几何来源）。
 */
export function penumbraCone(sunPosKm: Vec3, moonPosKm: Vec3): ShadowCone {
  const sm = sub(moonPosKm, sunPosKm);
  const d = norm(sm);
  if (!(d > SUN_RADIUS_KM)) throw new RangeError(`日月距离非法：${d} km`);
  const axis = scale(sm, 1 / d); // 背日向
  const lengthKm = (MOON_MEAN_RADIUS_KM * d) / (SUN_RADIUS_KM + MOON_MEAN_RADIUS_KM);
  const halfAngleRad = Math.asin(clamp((SUN_RADIUS_KM + MOON_MEAN_RADIUS_KM) / d, 0, 1));
  const apexKm: Vec3 = [
    moonPosKm[0] - axis[0] * lengthKm,
    moonPosKm[1] - axis[1] * lengthKm,
    moonPosKm[2] - axis[2] * lengthKm,
  ];
  return { apexKm, axis, halfAngleRad, lengthKm };
}

/** 地表本影足印（契约 C1 umbraFootprint 返回值） */
export interface UmbraFootprint {
  /** 影轴是否与地球球面相交（false = 影锥掠过地球外侧，无中心食） */
  exists: boolean;
  /** 伪本影分支（true = 锥尖未及地面 → 环食；false = 真本影 → 全食） */
  isAntumbra: boolean;
  /** 足印中心（km，与锥同坐标系；exists=false 时为 null） */
  centerKm: Vec3 | null;
  /** 椭圆短轴全长（km，垂直影轴的锥截面直径） */
  minorAxisKm: number;
  /** 椭圆长轴全长（km，= 短轴/cos(入射角)；掠射时钳制见 GRAZING_COS_MIN） */
  majorAxisKm: number;
}

/** 足印长轴掠射钳制：入射角余弦下限（登记近似——掠射极限下椭圆退化为无界） */
export const GRAZING_COS_MIN = 0.05;

/**
 * 锥 × 地球球面 → 地表本影椭圆足印（契约 C1）。
 *
 * 影轴参数化 p(t) = apex + t·axis：本影锥体在 t<0（月球侧），t>0 为伪本影延长区。
 * 取影轴与球面「向日侧」交点：t* < 0 → 真本影（全食），t* > 0 → 伪本影（环食分支）。
 * 短轴 = 交点处锥截面直径 2·|t*|·tan(halfAngle)；长轴 = 短轴/cos(入射角)
 * （影轴与地表法线夹角；平面截椭圆近似，登记）。
 *
 * @param cone umbraCone 输出（半影锥同样适用，得半影足印）
 * @param earthCenterKm 地球中心（km，与锥同坐标系；地心系下为原点）
 * @param earthRadiusKm 地球半径（km）
 */
export function umbraFootprint(
  cone: ShadowCone,
  earthCenterKm: Vec3,
  earthRadiusKm: number
): UmbraFootprint {
  if (!(earthRadiusKm > 0)) throw new RangeError(`地球半径必须为正：${earthRadiusKm}`);
  const oc = sub(earthCenterKm, cone.apexKm);
  const tCenter = dot(oc, cone.axis);
  const perp2 = dot(oc, oc) - tCenter * tCenter;
  const disc = earthRadiusKm * earthRadiusKm - perp2;
  if (disc <= 0) {
    return { exists: false, isAntumbra: false, centerKm: null, minorAxisKm: 0, majorAxisKm: 0 };
  }
  const half = Math.sqrt(disc);
  // 两交点 t = tCenter ± half。影自月球（t = −lengthKm 远端）沿 t 递增方向
  // 传播，物理足印 = 首个被击中的「向日面」交点 = tNear（数值锚点：2027 食甚
  // 由 tNear 得短轴 257.8 km，与 topo 角半径法 257.2 km、Espenak 路径宽
  // 258 km 三方吻合；tFar 为背日面赝解）。
  const tHit = tCenter - half;
  const centerKm: Vec3 = [
    cone.apexKm[0] + cone.axis[0] * tHit,
    cone.apexKm[1] + cone.axis[1] * tHit,
    cone.apexKm[2] + cone.axis[2] * tHit,
  ];
  const minorAxisKm = 2 * Math.abs(tHit) * Math.tan(cone.halfAngleRad);
  const normal = normalize(sub(centerKm, earthCenterKm));
  const cosIncidence = Math.max(Math.abs(dot(normal, cone.axis)), GRAZING_COS_MIN);
  return {
    exists: true,
    isAntumbra: tHit > 0,
    centerKm,
    minorAxisKm,
    majorAxisKm: minorAxisKm / cosIncidence,
  };
}

// ---------------------------------------------------------------------------
// 贝利珠漏光剖面（契约 C1 beadsLeakProfile）
// ---------------------------------------------------------------------------

/**
 * 贝利珠漏光剖面（契约 C1）：按月缘极角逐点计算日面外缘超出月缘的角量。
 * 输出数组供 M3 转 1D 纹理，shader 沿月缘极角查表放光点（珠 → 钻石环极限态）。
 *
 * 几何：月心沿极角 ψ 方向到日面边缘的角距
 * d(ψ) = offset·cosφ + √(sunR² − offset²·sin²φ)，φ = ψ − (posAngle+π)
 * （posAngle 为「月相对日」位置角，月→日方向反向）；月缘半径
 * m(ψ) = moonR + dev(ψ)·moonR/1737.4（km 偏差 → 角量按月球角尺度换算，
 * 自洽于 moonR 本身，无需月距入参）；漏光 = max(0, d − m)。
 *
 * @param sunR 太阳视半径（弧度）
 * @param moonR 月球视半径（弧度）
 * @param offset 日月圆心角距（弧度，≥0）
 * @param posAngle 月心相对日心位置角（弧度，天球北起经东）
 * @param limbProfile 月缘高程偏差（km，720 点 @0.5°，正=山峰/负=山谷；契约 C3）
 * @returns 720 点漏光角深数组（弧度，≥0；索引 k ↔ 月心极角 k×0.5°）
 */
export function beadsLeakProfile(
  sunR: number,
  moonR: number,
  offset: number,
  posAngle: number,
  limbProfile: readonly number[]
): number[] {
  assertDiskArgs(sunR, moonR, offset);
  assertFinite(posAngle, 'posAngle');
  if (limbProfile.length !== LIMB_PROFILE_SAMPLE_COUNT) {
    throw new RangeError(`月缘剖面应为 ${LIMB_PROFILE_SAMPLE_COUNT} 点，收到 ${limbProfile.length}`);
  }
  const toSunDir = posAngle + Math.PI; // 月→日方向的极角
  const kmToRad = moonR / MOON_MEAN_RADIUS_KM; // 月缘 1 km ↔ 角量（弧度）
  const out = new Array<number>(LIMB_PROFILE_SAMPLE_COUNT);
  for (let k = 0; k < LIMB_PROFILE_SAMPLE_COUNT; k += 1) {
    const psi = k * LIMB_PROFILE_STEP_DEG * DEG;
    const phi = psi - toSunDir;
    const s = offset * Math.sin(phi);
    const inside = sunR * sunR - s * s;
    if (inside <= 0) {
      // 该方向月心视线不与日盘相交（深偏食大 offset 情形）：无漏光
      out[k] = 0;
      continue;
    }
    const dSunLimb = offset * Math.cos(phi) + Math.sqrt(inside);
    if (dSunLimb <= 0) {
      out[k] = 0;
      continue;
    }
    const moonLimb = moonR + limbProfile[k] * kmToRad;
    out[k] = Math.max(0, dSunLimb - moonLimb);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 天光非线性感知曲线（契约 C1 eclipseSkyDarkening）
// ---------------------------------------------------------------------------

/** eclipseSkyDarkening 返回值 */
export interface EclipseSkyDarkening {
  /** 天空感知亮度因子（0–1，供 LabSkyDome 调制） */
  skyFactor01: number;
  /** 等效太阳高度角（度；接 labSky 晨昏链——全食时压至 TOTALITY_EQUIV_SUN_ALT_DEG） */
  equivalentSunAltDeg: number;
  /** 有效极限星等（labSky.effectiveLimitingMag，用户 lm 取夜间域上限 6.5） */
  limitingMag: number;
}

/** 遮挡率 → 等效太阳高度角混合权重的起始遮挡率（此前天光按无食处理） */
export const SKY_DARKEN_ONSET_OBSCURATION = 0.9;

/**
 * 日食天光（契约 C1）：遮挡率 × 太阳高度角 → 感知亮度因子 + 极限星等。
 * §1.4 非线性感知曲线：90% 前几乎无感、99% 仍近白天、99%→100% 骤暗断崖
 * （OBSCURATION_SKY_ANCHORS 分段线性 + 高度角昼夜系数）；极限星等经
 * 「等效太阳高度角」接 labSky.effectiveLimitingMag 既有链（全食 ≈ −9° 深度
 * 晨昏蒙影，亮行星与亮星可见）。感知拟合登记艺术化（模块头 §1.5 条目）。
 *
 * @param sunAltDeg 太阳高度角（度）
 * @param obscuration01 遮挡率（0–1，越界钳制）
 */
export function eclipseSkyDarkening(sunAltDeg: number, obscuration01: number): EclipseSkyDarkening {
  assertFinite(sunAltDeg, 'sunAltDeg');
  assertFinite(obscuration01, 'obscuration01');
  const obs = clamp(obscuration01, 0, 1);

  // 遮挡率感知因子（分段线性锚点）
  let obsFactor = OBSCURATION_SKY_ANCHORS[OBSCURATION_SKY_ANCHORS.length - 1][1];
  for (let i = 0; i < OBSCURATION_SKY_ANCHORS.length - 1; i += 1) {
    const [x0, y0] = OBSCURATION_SKY_ANCHORS[i];
    const [x1, y1] = OBSCURATION_SKY_ANCHORS[i + 1];
    if (obs <= x1) {
      obsFactor = y0 + ((obs - x0) / (x1 - x0)) * (y1 - y0);
      break;
    }
  }

  // 太阳高度昼夜系数（−12° 全暗 → +10° 全亮的平滑斜坡，日食叠加于当时昼光之上）
  const t = clamp((sunAltDeg + 12) / 22, 0, 1);
  const dayFactor = t * t * (3 - 2 * t);

  // 等效太阳高度角：遮挡 >90% 起向全食等效值（−9°）陡峭混合（quartic 断崖）
  const w =
    obs <= SKY_DARKEN_ONSET_OBSCURATION
      ? 0
      : ((obs - SKY_DARKEN_ONSET_OBSCURATION) / (1 - SKY_DARKEN_ONSET_OBSCURATION)) ** 4;
  const equivalentSunAltDeg = sunAltDeg + (TOTALITY_EQUIV_SUN_ALT_DEG - sunAltDeg) * w;

  return {
    skyFactor01: clamp(obsFactor * dayFactor, 0, 1),
    equivalentSunAltDeg,
    limitingMag: effectiveLimitingMag(6.5, equivalentSunAltDeg * DEG),
  };
}

// ---------------------------------------------------------------------------
// 广义相对论星光偏折（契约 C1 starDeflectionArcsec，M5 Eddington 消费）
// ---------------------------------------------------------------------------

/**
 * 星光引力偏折角（契约 C1）：δ = 1.7520″ × R☉/b（Einstein 1915 一阶近似），
 * b 为光线掠日冲击参数，按视角距归一 b/R☉ = sep/太阳平均视半径。
 * 日面边缘（sep = SUN_MEAN_ANGULAR_RADIUS_DEG）→ 1.7520″ 锚点；
 * 入参钳制到日面边缘（更小角距物理上光线被日面遮挡）。
 *
 * @param angularSepFromSunDeg 恒星与日心视角距（度）
 * @returns 偏折角（角秒）
 */
export function starDeflectionArcsec(angularSepFromSunDeg: number): number {
  assertFinite(angularSepFromSunDeg, 'angularSepFromSunDeg');
  const sep = Math.max(angularSepFromSunDeg, SUN_MEAN_ANGULAR_RADIUS_DEG);
  return (GR_LIMB_DEFLECTION_ARCSEC * SUN_MEAN_ANGULAR_RADIUS_DEG) / sep;
}

// ---------------------------------------------------------------------------
// 接触时刻反解（契约 C1 附属工具：星历自洽性校验，§1.3）
// ---------------------------------------------------------------------------

/** topo 行解码（契约 C2 行布局：sunAlt,sunAz,sunSd,moonAlt,moonAz,moonSd,posAngle 度） */
export function topoAngularSepDeg(row: readonly number[]): number {
  if (row.length !== 7) throw new RangeError(`topo 行应为 7 列，收到 ${row.length}`);
  const [sunAlt, sunAz, , moonAlt, moonAz] = row;
  const a1 = sunAlt * DEG;
  const a2 = moonAlt * DEG;
  const dAz = (moonAz - sunAz) * DEG;
  const cosSep =
    Math.sin(a1) * Math.sin(a2) + Math.cos(a1) * Math.cos(a2) * Math.cos(dAz);
  return Math.acos(clamp(cosSep, -1, 1)) / DEG;
}

/** 接触时刻反解结果（UTC 秒；中心食阶段不存在时 c2/c3 为 null） */
export interface DerivedContacts {
  c1: number;
  c2: number | null;
  max: number;
  c3: number | null;
  c4: number;
}

/**
 * 从 topo 星历序列反解接触时刻（§1.3 自洽性校验；单测拿它与烘焙权威
 * contacts 互差 <30s 断言）。C1/C4 = sep − (sunSd+moonSd) 过零，
 * C2/C3 = sep − |moonSd−sunSd| 过零（eclipseKind 边界），max = sep 最小。
 * 序列内逐样本线性求根；粗采样（60s）下精度 ≪ 30s。
 *
 * @param series topo 序列（60s 粗采样覆盖全程；细采样段可另行传入提精度）
 */
export function deriveContactTimes(series: EphemerisSeries): DerivedContacts | null {
  const { t0, dtSec, rows } = series;
  if (rows.length < 2) return null;
  const outer: number[] = [];
  const inner: number[] = [];
  let minSep = Infinity;
  let maxT = t0;
  const fOuter = (row: readonly number[]): number =>
    topoAngularSepDeg(row) - (row[2] + row[5]);
  const fInner = (row: readonly number[]): number =>
    topoAngularSepDeg(row) - Math.abs(row[5] - row[2]);
  for (let i = 0; i < rows.length; i += 1) {
    const sep = topoAngularSepDeg(rows[i]);
    if (sep < minSep) {
      minSep = sep;
      maxT = t0 + i * dtSec;
    }
    if (i === 0) continue;
    const t1 = t0 + i * dtSec;
    const g0 = fOuter(rows[i - 1]);
    const g1 = fOuter(rows[i]);
    if (g0 === 0 || g0 * g1 < 0) outer.push(t1 - dtSec + (g0 / (g0 - g1)) * dtSec);
    const h0 = fInner(rows[i - 1]);
    const h1 = fInner(rows[i]);
    if (h0 === 0 || h0 * h1 < 0) inner.push(t1 - dtSec + (h0 / (h0 - h1)) * dtSec);
  }
  if (outer.length < 2) return null;
  return {
    c1: outer[0],
    c2: inner.length >= 2 ? inner[0] : null,
    max: maxT,
    c3: inner.length >= 2 ? inner[inner.length - 1] : null,
    c4: outer[outer.length - 1],
  };
}
