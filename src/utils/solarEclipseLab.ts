/**
 * 日全食实验室场景侧纯逻辑层（E 迭代 M2，IMPROVEMENT_REQUIREMENTS_SOLAR_ECLIPSE
 * §M2 / 契约 C4 / C7）
 *
 * 组件零内联可测逻辑纪律（§7）：SolarEclipseLab.tsx / EclipseTimelineScrubber.tsx
 * 只消费本模块——时间轴窗口/锚点列表（契约 C7 数据驱动，禁止组件硬编码 5 锚点）、
 * 细采样段选序（fineC2/fineC3 命中判定）、逐帧日月视位置状态（契约 C1 函数族
 * 只消费不改签名）、恒星时（星穹赤道 → 地平旋转矩阵输入）、UTC 时刻格式化。
 *
 * 状态流红线（§3.1）：一切效果由「事件时间轴秒 tSec」单值可重建——本模块全部
 * 函数为 tSec 的纯函数，禁止帧间累积量（scrubber 任意 seek 的前提）。
 *
 * 场景空间（契约 C4）：地面视角 1 场景单位 = 1 km，+Y 天顶、−Z 正北、+X 正东；
 * 日月画在天穹壳（SKY_SHELL_RADIUS_KM = 10,000 km）的 billboard quad 上，
 * quad 内按真实视半径绘制（不做几何放大，细节靠 FOV 缩放 + HUD 数值）。
 *
 * 近似登记：LST 用 GMST(IAU 1982) + 东经直加（忽略 UT1−UTC 与章动，星穹指向
 * 系统偏差 ≪1°，且偏食段白昼恒星被极限星等剔除，不影响日月几何——日月位置
 * 直接消费烘焙 topo 序列）；1919 事件 UT1 视作 UTC（烘焙同口径，§1.5）。
 *
 * 硬性约束：不 import React/three；函数无状态、可重入；单测覆盖率 gate ≥90%。
 */

import type { MessageKey } from '@/i18n';
import {
  eclipseKind,
  eclipseMagnitude,
  eclipseObscuration,
  eclipseSkyDarkening,
  interpolateEphemeris,
  topoAngularSepDeg,
  TOPO_ANGULAR_COLUMNS,
  type EclipseKind,
  type EphemerisSeries,
} from '@/utils/solarEclipse';

/** 度 → 弧度 */
const DEG = Math.PI / 180;

// ---------------------------------------------------------------------------
// 时间轴窗口与锚点（契约 C7：锚点列表数据驱动，月食条目 7 锚点复用同组件）
// ---------------------------------------------------------------------------

/** 五接触点（契约 C2 contacts 块；UTC 秒） */
export interface EclipseContacts {
  c1: number;
  c2: number;
  max: number;
  c3: number;
  c4: number;
}

/** 时间轴覆盖窗前后余量（秒；§3.1：C1−15min → C4+15min，烘焙采样窗同口径） */
export const TIMELINE_PAD_SEC = 15 * 60;

/** 时间轴窗口（scrubber min/max；契约 C2 topo 采样窗与此同源，插值不越界） */
export interface EclipseTimelineWindow {
  startSec: number;
  endSec: number;
}

/** 接触时刻 → 时间轴窗口（C1−15min → C4+15min） */
export function eclipseTimelineWindow(contacts: EclipseContacts): EclipseTimelineWindow {
  if (!(contacts.c1 < contacts.c4)) {
    throw new RangeError(`接触时刻非法：c1=${contacts.c1} 应早于 c4=${contacts.c4}`);
  }
  return { startSec: contacts.c1 - TIMELINE_PAD_SEC, endSec: contacts.c4 + TIMELINE_PAD_SEC };
}

/**
 * 时间轴锚点（契约 C7）：scrubber 组件只消费 `{ key, tSec, labelKey }[]`，
 * 锚点数量/语义由数据决定——月食条目将传 7 锚点（部分可缺省）复用同组件。
 */
export interface EclipseTimelineAnchor {
  /** 锚点标识（React key + 测试断言） */
  key: string;
  /** 锚点时刻（UTC 秒） */
  tSec: number;
  /** 锚点名 i18n 键（zh 类型源） */
  labelKey: MessageKey;
}

/** 日食五锚点构造（C1 初亏/C2 食既/食甚/C3 生光/C4 复圆，§1.3 时间线骨架） */
export function solarEclipseAnchors(contacts: EclipseContacts): EclipseTimelineAnchor[] {
  return [
    { key: 'c1', tSec: contacts.c1, labelKey: 'lab.eclipseAnchorC1' },
    { key: 'c2', tSec: contacts.c2, labelKey: 'lab.eclipseAnchorC2' },
    { key: 'max', tSec: contacts.max, labelKey: 'lab.eclipseAnchorMax' },
    { key: 'c3', tSec: contacts.c3, labelKey: 'lab.eclipseAnchorC3' },
    { key: 'c4', tSec: contacts.c4, labelKey: 'lab.eclipseAnchorC4' },
  ];
}

// ---------------------------------------------------------------------------
// 星历序列选取（契约 C2：topo 60s 粗采样 + fineC2/fineC3 1s 细采样兄弟键）
// ---------------------------------------------------------------------------

/** 事件星历序列组（SolarEclipseEventData 的结构子集，解耦 bakedData 类型） */
export interface EclipseSeriesGroup {
  topo: EphemerisSeries;
  fineC2: EphemerisSeries;
  fineC3: EphemerisSeries;
}

/** 序列覆盖判定（末行时刻 = t0 + (rows−1)·dt） */
function seriesCovers(series: EphemerisSeries, tSec: number): boolean {
  return tSec >= series.t0 && tSec <= series.t0 + (series.rows.length - 1) * series.dtSec;
}

/**
 * 逐时刻选序（契约 C2）：tSec 落在 C2±3min / C3±3min 细采样窗内时用 1s 序列
 * （贝利珠时刻插值精度，M3 消费同函数），否则用 60s 粗采样 topo。
 */
export function pickEclipseSeries(group: EclipseSeriesGroup, tSec: number): EphemerisSeries {
  if (seriesCovers(group.fineC2, tSec)) return group.fineC2;
  if (seriesCovers(group.fineC3, tSec)) return group.fineC3;
  return group.topo;
}

// ---------------------------------------------------------------------------
// 恒星时（星穹赤道 → 地平旋转矩阵输入；日月位置不经此链）
// ---------------------------------------------------------------------------

/** Unix 秒 → 格林尼治平恒星时（弧度，IAU 1982 多项式；近似登记见文件头） */
export function gmstRadFromUnixSec(tSec: number): number {
  if (!Number.isFinite(tSec)) throw new RangeError(`tSec 必须为有限数，收到 ${tSec}`);
  const d = tSec / 86400 + 2440587.5 - 2451545.0;
  const t = d / 36525;
  const deg = 280.46061837 + 360.98564736629 * d + 0.000387933 * t * t - (t * t * t) / 38710000;
  return (((deg % 360) + 360) % 360) * DEG;
}

/** Unix 秒 + 东经（度）→ 地方恒星时（弧度，[0, 2π)） */
export function lstRadFromUnixSec(tSec: number, lonDeg: number): number {
  if (!Number.isFinite(lonDeg)) throw new RangeError(`lonDeg 必须为有限数，收到 ${lonDeg}`);
  const rad = gmstRadFromUnixSec(tSec) + lonDeg * DEG;
  const twoPi = Math.PI * 2;
  return ((rad % twoPi) + twoPi) % twoPi;
}

// ---------------------------------------------------------------------------
// 逐帧状态（tSec 单值可重建；useFrame 与 HUD interval 共用）
// ---------------------------------------------------------------------------

/**
 * 逐帧日月视位置状态（eclipseFrameState 输出；out 参数复用支持渲染循环零 GC）。
 *
 * 月盘偏移在「日心切平面」坐标系表达（quad 本地角坐标，弧度）：
 * offEastRad = Δ方位 × cos(太阳高度角)（+ = 月在日的东侧方位向）、
 * offUpRad = Δ高度角（+ = 月在日上方）——直接消费烘焙 topo 的双体地平坐标，
 * 位置角信息隐含其中（含视差/周日旋转，缺角方位随时间真实转动，M2-5 目验点）。
 */
export interface EclipseFrameState {
  /** 太阳高度角（度，AIRLESS） */
  sunAltDeg: number;
  /** 太阳方位角（度，北起经东） */
  sunAzDeg: number;
  /** 太阳视半径（度） */
  sunSdDeg: number;
  /** 月球视半径（度） */
  moonSdDeg: number;
  /** 月盘中心相对日盘中心偏移·方位向（弧度，切平面小角近似） */
  offEastRad: number;
  /** 月盘中心相对日盘中心偏移·高度向（弧度） */
  offUpRad: number;
  /** 日月角距（度，球面严格式） */
  sepDeg: number;
  /** 遮挡率（0–1，契约 C1 eclipseObscuration） */
  obscuration01: number;
  /** 食分（契约 C1 eclipseMagnitude） */
  magnitude: number;
  /** 食型（契约 C1 eclipseKind） */
  kind: EclipseKind;
  /** 天空感知亮度因子（契约 C1 eclipseSkyDarkening；M2 只消费偏食段） */
  skyFactor01: number;
  /** 等效太阳高度角（度；星穹极限星等链输入） */
  equivalentSunAltDeg: number;
  /** 有效极限星等（白昼 −4 → 全食 ~3.5，星穹剔除阈值） */
  limitingMag: number;
}

/** 空帧状态（挂载期分配一次，useFrame 复用——契约 C2.1 渲染循环零 GC 口径） */
export function emptyEclipseFrameState(): EclipseFrameState {
  return {
    sunAltDeg: 0,
    sunAzDeg: 0,
    sunSdDeg: 0.267,
    moonSdDeg: 0.267,
    offEastRad: 0,
    offUpRad: 0,
    sepDeg: 0,
    obscuration01: 0,
    magnitude: 0,
    kind: 'none',
    skyFactor01: 1,
    equivalentSunAltDeg: 0,
    limitingMag: -4,
  };
}

/** 度差折入 (−180°, 180°]（方位角跨 0°/360° 时的最短弧差） */
export function wrapDeg180(deg: number): number {
  const w = ((((deg + 180) % 360) + 360) % 360) - 180;
  // 折出 −180 时归 +180（区间约定 (−180, 180]）
  return w === -180 ? 180 : w;
}

/**
 * 时间轴秒 → 逐帧状态（契约 C1 函数族只消费）：
 * 插值（角度列最短弧）→ 站心行解码 → 双圆几何 → 天光曲线。
 *
 * @param group 事件星历序列组（topo/fineC2/fineC3）
 * @param tSec 事件时间轴秒（UTC；越界由 interpolateEphemeris 钳制到端点）
 * @param out 复用输出对象（不传则新建）
 */
export function eclipseFrameState(
  group: EclipseSeriesGroup,
  tSec: number,
  out: EclipseFrameState = emptyEclipseFrameState()
): EclipseFrameState {
  const series = pickEclipseSeries(group, tSec);
  const row = interpolateEphemeris(series, tSec, TOPO_ANGULAR_COLUMNS);
  const [sunAlt, sunAz, sunSd, moonAlt, moonAz, moonSd] = row;
  const sepDeg = topoAngularSepDeg(row);
  const sunR = sunSd * DEG;
  const moonR = moonSd * DEG;
  const sepRad = sepDeg * DEG;
  const obscuration = eclipseObscuration(sunR, moonR, sepRad);
  const sky = eclipseSkyDarkening(sunAlt, obscuration);

  out.sunAltDeg = sunAlt;
  out.sunAzDeg = sunAz;
  out.sunSdDeg = sunSd;
  out.moonSdDeg = moonSd;
  // 切平面小角近似（视半径 ~0.27°、偏移 <1.6°，误差 ≪ 盘缘软化宽度）
  out.offEastRad = wrapDeg180(moonAz - sunAz) * Math.cos(sunAlt * DEG) * DEG;
  out.offUpRad = (moonAlt - sunAlt) * DEG;
  out.sepDeg = sepDeg;
  out.obscuration01 = obscuration;
  out.magnitude = eclipseMagnitude(sunR, moonR, sepRad);
  out.kind = eclipseKind(sunR, moonR, sepRad);
  out.skyFactor01 = sky.skyFactor01;
  out.equivalentSunAltDeg = sky.equivalentSunAltDeg;
  out.limitingMag = sky.limitingMag;
  return out;
}

// ---------------------------------------------------------------------------
// HUD 格式化（500ms interval 消费；DOM 层）
// ---------------------------------------------------------------------------

/** Unix 秒 → "HH:MM:SS"（UTC；负秒/1919 事件同样适用） */
export function formatUtcClock(tSec: number): string {
  if (!Number.isFinite(tSec)) throw new RangeError(`tSec 必须为有限数，收到 ${tSec}`);
  return new Date(Math.round(tSec) * 1000).toISOString().slice(11, 19);
}

/** 视直径显示（度 → "0.528°" 三位小数；HUD 常显真实视直径，契约 C4） */
export function formatAngularDiameterDeg(sdDeg: number): string {
  if (!Number.isFinite(sdDeg) || sdDeg < 0) throw new RangeError(`视半径非法：${sdDeg}`);
  return `${(sdDeg * 2).toFixed(3)}°`;
}

// ---------------------------------------------------------------------------
// 场景常量（契约 C4；quad 尺寸为覆盖窗内最大日月角距的裕量值）
// ---------------------------------------------------------------------------

/**
 * 日月合成 quad 半角（弧度）：quad 中心锚定日心，需覆盖月盘在
 * C1−15min/C4+15min 处的最大偏移（sep ≈ 0.53° + 15min × 相对速度
 * ~0.55°/h ≈ 0.67°）+ 月盘半径 ≈ 0.95°，取 1.6° 留裕量（勿随意收窄——
 * 月盘出界会被 quad 边缘裁剪）。
 */
export const ECLIPSE_QUAD_HALF_ANGLE_RAD = 1.6 * DEG;

/** 光球盘 HDR 亮度（Bloom 拾取域 >1；M3 曝光状态机接管前的固定基准） */
export const PHOTOSPHERE_HDR_BRIGHTNESS = 4;

/** 播放推进倍率（M2 仅 ×1 真实速度档；导览变速随 M3，§3.1） */
export const ECLIPSE_PLAY_RATE = 1;
