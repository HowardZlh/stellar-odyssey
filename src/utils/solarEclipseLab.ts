/**
 * 日全食实验室场景侧纯逻辑层（E 迭代 M2+M3，IMPROVEMENT_REQUIREMENTS_SOLAR_ECLIPSE
 * §M2/§M3 / 契约 C4 / C5 / C7）
 *
 * 组件零内联可测逻辑纪律（§7）：SolarEclipseLab.tsx / EclipseTimelineScrubber.tsx
 * 只消费本模块——时间轴窗口/锚点列表（契约 C7 数据驱动，禁止组件硬编码 5 锚点）、
 * 细采样段选序（fineC2/fineC3 命中判定）、逐帧日月视位置状态（契约 C1 函数族
 * 只消费不改签名）、恒星时（星穹赤道 → 地平旋转矩阵输入）、UTC 时刻格式化。
 *
 * M3 追加（§M3-1…M3-6）：曝光状态机（契约 C5：filtered/naked-eye 双基准 +
 * 连续插值 + C2/C3 自动切换曲线）、导览变速曲线（A1 登记：HUD 常显真实时刻
 * 与倍速）、假想模式月地距离改写（站心视对齐保持、只改月视半径——geo 全量
 * 重算的视差去心化问题与差异登记见 hypotheticalFrameState 注释）、360°
 * 暮光/影带/日珥/树影贴花的驱动参数、行星真实方位
 * （physics.heliocentricPosition 链）、环境数值条（气温降幅感知拟合）。
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
import type { OrbitalElements } from '@/types';
import {
  eclipseKind,
  eclipseMagnitude,
  eclipseObscuration,
  eclipseSkyDarkening,
  interpolateEphemeris,
  starDeflectionArcsec,
  topoAngularSepDeg,
  MOON_MEAN_RADIUS_KM,
  SKY_DARKEN_ONSET_OBSCURATION,
  TOPO_ANGULAR_COLUMNS,
  type EclipseKind,
  type EphemerisSeries,
} from '@/utils/solarEclipse';
import { horizontalFromEquatorial, sceneDirFromAltAz } from '@/utils/meteorShower';
import { heliocentricPosition } from '@/utils/physics';
import { createSeededRandom } from '@/utils/random';

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
  /** 月心相对日心位置角（度，天球北起经东；月缘纹理帧旋转输入，M3） */
  posAngleDeg: number;
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
    posAngleDeg: 0,
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
  const [sunAlt, sunAz, sunSd, moonAlt, moonAz, moonSd, posAngle] = row;
  return fillFrameFromTopo(
    sunAlt,
    sunAz,
    sunSd,
    moonAlt,
    moonAz,
    moonSd,
    posAngle,
    topoAngularSepDeg(row),
    out
  );
}

/**
 * 站心双体标量 → 逐帧状态（eclipseFrameState / hypotheticalFrameState 共用
 * 组装尾段：切平面偏移 + 双圆几何 + 天光曲线；契约 C1 函数族只消费）。
 */
function fillFrameFromTopo(
  sunAlt: number,
  sunAz: number,
  sunSd: number,
  moonAlt: number,
  moonAz: number,
  moonSd: number,
  posAngleDeg: number,
  sepDeg: number,
  out: EclipseFrameState
): EclipseFrameState {
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
  out.posAngleDeg = posAngleDeg;
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

/** 光球盘 HDR 亮度（M2 固定基准；M3 起由曝光状态机 exposureUniforms 接管） */
export const PHOTOSPHERE_HDR_BRIGHTNESS = 4;

/** 播放推进倍率（M2 仅 ×1 真实速度档；M3 起由 eclipsePlayRate 接管） */
export const ECLIPSE_PLAY_RATE = 1;

// ---------------------------------------------------------------------------
// M3-1 曝光状态机（契约 C5：filtered/naked-eye 双基准 + 连续插值 + 自动切换）
// ---------------------------------------------------------------------------

/** 曝光档（自动 = C2/C3 跨越时切换基准，模拟「摘/戴滤镜」；手动 = 滑杆连续） */
export type EclipseExposureMode = 'auto' | 'manual';

/** 自动曝光基准切换过渡时长（秒；契约 C5「1–2s 平滑过渡」取 2s） */
export const EXPOSURE_TRANSITION_SEC = 2;

/**
 * 自动曝光提前量（秒）：naked-eye 基准在 C2 前 EXPOSURE_NAKED_LEAD_SEC 秒
 * 已就位（真实观测惯例：贝利珠/钻石环阶段即摘滤镜裸眼观看——注意此阶段
 * 光球仍在、现实中不安全，科普卡口径见 §3.4）；C3 后同量对称回切。
 */
export const EXPOSURE_NAKED_LEAD_SEC = 12;

/** smoothstep（GLSL 同式标量版；t 越界钳制） */
function smooth01(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

/**
 * 自动曝光插值（契约 C5）：0 = filtered（滤镜基准）→ 1 = naked-eye（裸眼
 * 基准）。C2 − LEAD − TRANS 起 2s 平滑升至 1，C3 + LEAD 起 2s 平滑回 0；
 * tSec 单值可重建（§3.1 红线）。
 */
export function autoExposure01(tSec: number, contacts: EclipseContacts): number {
  if (!Number.isFinite(tSec)) throw new RangeError(`tSec 必须为有限数，收到 ${tSec}`);
  const riseStart = contacts.c2 - EXPOSURE_NAKED_LEAD_SEC - EXPOSURE_TRANSITION_SEC;
  const fallStart = contacts.c3 + EXPOSURE_NAKED_LEAD_SEC;
  const rise = smooth01((tSec - riseStart) / EXPOSURE_TRANSITION_SEC);
  const fall = 1 - smooth01((tSec - fallStart) / EXPOSURE_TRANSITION_SEC);
  return Math.min(rise, fall);
}

/** filtered 基准光球增益（ACES 前色值 < Bloom 阈值 0.6——「光球不过曝」验收基准） */
export const EXPOSURE_FILTERED_PHOTO_GAIN = 0.55;

/** naked-eye 基准光球 HDR 增益（×15 级，Bloom 拾取溢出泛光——验收基准） */
export const EXPOSURE_NAKED_PHOTO_GAIN = 15;

/** filtered 基准暗弱天体增益（星穹/行星标记——「星空完全不可见」验收基准） */
export const EXPOSURE_FILTERED_STAR_GAIN = 0.02;

/**
 * 曝光驱动的渲染增益组（useFrame out 复用零 GC）。
 *
 * 语义边界（契约 C5 的实现定稿）：曝光基准只作用于**天体亮度层**——光球
 * （photoGain）与暗弱层（coronaGain/starGain）；环境天空/地景亮度由
 * `eclipseSkyDarkening` 感知链独立承载（否则 filtered 档会把偏食段白昼
 * 天空压黑，杀死 §1.4「90% 前几乎无感、99% 仍近白天」的验收曲线）。
 */
export interface EclipseExposureUniforms {
  /** 光球盘增益（HDR；filtered 0.55 → naked-eye 15，对数插值） */
  photoGain: number;
  /** 日冕/色球/日珥增益（filtered 恰 0——暗弱层完全不可见） */
  coronaGain: number;
  /** 星穹/行星标记增益（对数插值 0.02 → 1；filtered 档星空不可见基准） */
  starGain: number;
}

/** 空曝光增益组（filtered 基准初值） */
export function emptyEclipseExposureUniforms(): EclipseExposureUniforms {
  return {
    photoGain: EXPOSURE_FILTERED_PHOTO_GAIN,
    coronaGain: 0,
    starGain: EXPOSURE_FILTERED_STAR_GAIN,
  };
}

/**
 * 曝光插值 → 渲染增益组（契约 C5）：光球/星穹走对数插值（亮度感知均匀），
 * 日冕族走平方（暗端更快归零，filtered 档严格不可见）。
 *
 * 登记 A2（§8）：日冕亮度经此增益 + ACES 色调映射后**不是线性真值**——
 * 光球:日冕 ≈ 10⁶:1，任何直渲都不可能同屏，曝光科普卡向用户说明。
 */
export function exposureUniforms(
  exposure01: number,
  out: EclipseExposureUniforms = emptyEclipseExposureUniforms()
): EclipseExposureUniforms {
  if (!Number.isFinite(exposure01)) {
    throw new RangeError(`exposure01 必须为有限数，收到 ${exposure01}`);
  }
  const e = Math.min(1, Math.max(0, exposure01));
  const lnPhoto0 = Math.log(EXPOSURE_FILTERED_PHOTO_GAIN);
  const lnPhoto1 = Math.log(EXPOSURE_NAKED_PHOTO_GAIN);
  out.photoGain = Math.exp(lnPhoto0 + (lnPhoto1 - lnPhoto0) * e);
  out.coronaGain = e * e;
  out.starGain = Math.exp(Math.log(EXPOSURE_FILTERED_STAR_GAIN) * (1 - e));
  return out;
}

// ---------------------------------------------------------------------------
// M3-6 导览变速（§3.1；登记 A1：HUD 常显真实 UTC 时刻与当前倍速）
// ---------------------------------------------------------------------------

/** 播放模式（导览变速 / ×1 真实速度） */
export type EclipsePlayMode = 'tour' | 'real';

/** 导览档偏食段倍率（§3.1：偏食段压缩约 ×60） */
export const TOUR_RATE_FAST = 60;

/** 导览档降速提前量（秒；§3.1：C2−90s 起自动降速，全食段 ×1 实时） */
export const TOUR_SLOWDOWN_LEAD_SEC = 90;

/**
 * 导览变速曲线（登记 A1）：偏食段 ×60 → C2−90s 起对数域平滑降至 ×1 →
 * C2→C3 全食段 ×1 实时（视觉信息量最大段不压缩）→ C3 后对称回升 ×60。
 * tSec 纯函数（seek 一致性）。
 */
export function tourPlayRate(tSec: number, contacts: EclipseContacts): number {
  if (!Number.isFinite(tSec)) throw new RangeError(`tSec 必须为有限数，收到 ${tSec}`);
  const lnFast = Math.log(TOUR_RATE_FAST);
  if (tSec < contacts.c2 - TOUR_SLOWDOWN_LEAD_SEC) return TOUR_RATE_FAST;
  if (tSec < contacts.c2) {
    const s = smooth01((tSec - (contacts.c2 - TOUR_SLOWDOWN_LEAD_SEC)) / TOUR_SLOWDOWN_LEAD_SEC);
    return Math.exp(lnFast * (1 - s));
  }
  if (tSec <= contacts.c3) return 1;
  if (tSec <= contacts.c3 + TOUR_SLOWDOWN_LEAD_SEC) {
    const s = smooth01((tSec - contacts.c3) / TOUR_SLOWDOWN_LEAD_SEC);
    return Math.exp(lnFast * s);
  }
  return TOUR_RATE_FAST;
}

/** 播放模式 → 当前倍率（'real' 恒 ×1；'tour' 走导览曲线） */
export function eclipsePlayRate(
  mode: EclipsePlayMode,
  tSec: number,
  contacts: EclipseContacts
): number {
  return mode === 'real' ? 1 : tourPlayRate(tSec, contacts);
}

// ---------------------------------------------------------------------------
// M3-6 假想模式（§3.3：月地距离滑杆全食 ↔ 环食连续退化；与真实时间轴互斥）
// ---------------------------------------------------------------------------

/** 月地距离滑杆下限（km；近地点，§3.3） */
export const HYPO_MOON_DIST_MIN_KM = 363104;

/** 月地距离滑杆上限（km；远地点，§3.3） */
export const HYPO_MOON_DIST_MAX_KM = 405696;

/**
 * 假想模式逐帧状态（§3.3）：站心 topo 序列照常插值（视对齐/位置角/来向
 * 保持真实事件几何），仅按滑杆月地距离重算**月视半径**——`eclipseKind`
 * 实时判定使全食 → 环食连续退化自然成立（§1.1：不硬编码事件类型），
 * 远地点端 moonR < sunR 呈伪本影金环（光球环走既有几何剪影路径）。
 *
 * 差异登记（回写需求文档 §M3）：原锚点设想 geo 序列 + topocentricSunMoon
 * 全量重算，但只改地心距离会引入视差去心化（观测点不再落在影轴上，远地点
 * 端呈深偏食而非环食，破坏 §3.3 滑杆退化演示）。故定稿为「站心视对齐保持、
 * 只改视半径」的思想实验口径：月距改写不回馈视差偏移（量级 ≤0.05°）与
 * 站心距离修正（视半径偏差 ≤1.8%），登记为已知简化。
 *
 * @param moonDistKm 假想月地距离（km，滑杆值；视半径 = asin(R_moon/d)）
 */
export function hypotheticalFrameState(
  group: EclipseSeriesGroup,
  tSec: number,
  moonDistKm: number,
  out: EclipseFrameState = emptyEclipseFrameState()
): EclipseFrameState {
  if (!(moonDistKm > 0) || !Number.isFinite(moonDistKm)) {
    throw new RangeError(`月地距离必须为正有限数，收到 ${moonDistKm}`);
  }
  const series = pickEclipseSeries(group, tSec);
  const row = interpolateEphemeris(series, tSec, TOPO_ANGULAR_COLUMNS);
  const [sunAlt, sunAz, sunSd, moonAlt, moonAz, , posAngle] = row;
  const moonSd = Math.asin(Math.min(1, MOON_MEAN_RADIUS_KM / moonDistKm)) / DEG;
  return fillFrameFromTopo(
    sunAlt,
    sunAz,
    sunSd,
    moonAlt,
    moonAz,
    moonSd,
    posAngle,
    topoAngularSepDeg(row),
    out
  );
}

/**
 * 遮挡率过阈时刻反解（§3.3「99%/100% 一键对比」）：在 [c1, max] 内二分
 * 求遮挡率首次达到 target01 的时刻（该区间遮挡率单调上升）。
 *
 * @param target01 目标遮挡率 ∈ (0, 1)
 */
export function obscurationCrossingTimeSec(
  group: EclipseSeriesGroup,
  contacts: EclipseContacts,
  target01: number
): number {
  if (!(target01 > 0 && target01 < 1)) {
    throw new RangeError(`目标遮挡率应 ∈ (0,1)，收到 ${target01}`);
  }
  const scratch = emptyEclipseFrameState();
  let lo = contacts.c1;
  let hi = contacts.max;
  for (let i = 0; i < 48; i += 1) {
    const mid = (lo + hi) / 2;
    if (eclipseFrameState(group, mid, scratch).obscuration01 < target01) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return (lo + hi) / 2;
}

// ---------------------------------------------------------------------------
// M3-4 360° 暮光与暗天（§1.4：环地平线橙带 + 天顶深蓝，非均匀夜空）
// ---------------------------------------------------------------------------

/**
 * 全食沉浸因子（0–1）：遮挡率 >90% 起 quartic 陡升（与 eclipseSkyDarkening
 * 的等效太阳高度角混合权重严格同式——CPU/GLSL 镜像纪律的 CPU 侧事实源）。
 * 驱动 360° 暮光带浮现 / 影带与钻石环之外的全食气氛层。
 */
export function totalityImmersion01(obscuration01: number): number {
  if (!Number.isFinite(obscuration01)) {
    throw new RangeError(`遮挡率必须为有限数，收到 ${obscuration01}`);
  }
  const obs = Math.min(1, Math.max(0, obscuration01));
  if (obs <= SKY_DARKEN_ONSET_OBSCURATION) return 0;
  return ((obs - SKY_DARKEN_ONSET_OBSCURATION) / (1 - SKY_DARKEN_ONSET_OBSCURATION)) ** 4;
}

/**
 * 全食暮光带地平色（线性 RGB）：本影仅百余公里宽，地平线一圈之外仍是白天
 * ——环地平线 360° 橙色暮光带（「全食 ≠ 夜晚」第一视觉特征，M3-CP 专项）。
 */
export const TWILIGHT_RING_HORIZON_RGB: readonly [number, number, number] = [0.5, 0.24, 0.09];

/** 全食天顶色（线性 RGB；深度晨昏蒙影的深蓝，亮星与行星可见量级） */
export const TWILIGHT_RING_ZENITH_RGB: readonly [number, number, number] = [0.012, 0.024, 0.08];

/** 暮光带向地平集中幂次（越大橙带越贴地平；GLSL 镜像注入） */
export const TWILIGHT_RING_BAND_POW = 5;

// ---------------------------------------------------------------------------
// M3-5 影带（§4.3；登记 A7：机制真实、形态程序化风格再现）
// ---------------------------------------------------------------------------

/** 影带出现窗口（秒；C2 前 / C3 后数十秒——§4.3） */
export const SHADOW_BANDS_WINDOW_SEC = 40;

/** 影带包络渐入时长（秒） */
export const SHADOW_BANDS_EDGE_SEC = 8;

/**
 * 影带强度包络（0–1；登记 A7）：仅 [C2−40s, C2) 与 (C3, C3+40s] 两窗内
 * 非零——窗外由组件卸载 pass 实现零开销（ClusterLensingEffect 先例）。
 * 越贴近全食越强（细月牙准直光下大气湍流折射对比最大），全食段为 0。
 */
export function shadowBandsStrength01(tSec: number, contacts: EclipseContacts): number {
  if (!Number.isFinite(tSec)) throw new RangeError(`tSec 必须为有限数，收到 ${tSec}`);
  const pre =
    smooth01((tSec - (contacts.c2 - SHADOW_BANDS_WINDOW_SEC)) / SHADOW_BANDS_EDGE_SEC) *
    (1 - smooth01((tSec - (contacts.c2 - 2)) / 2));
  const post =
    smooth01((tSec - (contacts.c3 + 1)) / 2) *
    (1 - smooth01((tSec - (contacts.c3 + SHADOW_BANDS_WINDOW_SEC - SHADOW_BANDS_EDGE_SEC)) / SHADOW_BANDS_EDGE_SEC));
  return Math.max(pre, post);
}

// ---------------------------------------------------------------------------
// M3-2 日珥剪影布点（§4.2 合成序 3；登记 A6：典型形态艺术化再现）
// ---------------------------------------------------------------------------

/** 单处日珥剪影（月缘外侧粉红拱状） */
export interface EclipseProminence {
  /** 方位极角（弧度，quad 本地系上起经东向） */
  angleRad: number;
  /** 拱顶高度（× 太阳视半径；真实宁静日珥 ~0.05–0.1 R☉ 量级） */
  heightFrac: number;
  /** 角向跨度（弧度） */
  spanRad: number;
}

/** 日珥拱顶高度域（× R☉；真实量级，无几何放大） */
export const ECLIPSE_PROMINENCE_HEIGHT_MIN_FRAC = 0.05;
export const ECLIPSE_PROMINENCE_HEIGHT_MAX_FRAC = 0.12;

/** 日珥角向跨度域（弧度） */
export const ECLIPSE_PROMINENCE_SPAN_MIN_RAD = 0.14;
export const ECLIPSE_PROMINENCE_SPAN_MAX_RAD = 0.3;

/** 日珥数量域（§4.2：2–4 处） */
export const ECLIPSE_PROMINENCE_COUNT_MIN = 2;
export const ECLIPSE_PROMINENCE_COUNT_MAX = 4;

/** 事件 id → 确定性种子（日珥方位按事件固定，跨会话/任意 seek 一致） */
export function eclipseEventSeed(eventId: string): number {
  let h = 0;
  for (let i = 0; i < eventId.length; i += 1) {
    h = (h * 31 + eventId.charCodeAt(i)) >>> 0;
  }
  return h;
}

/**
 * 日珥剪影布点（登记 A6：真实某次食的日珥分布不可考，此为基于典型形态的
 * 艺术化再现，科普卡注明）：2–4 处，方位按事件种子固定（均布 + 抖动），
 * 高度/跨度落真实量级域。
 */
export function eclipseProminences(seed: number): EclipseProminence[] {
  if (!Number.isFinite(seed)) throw new RangeError(`种子必须为有限数，收到 ${seed}`);
  const rand = createSeededRandom(seed);
  const count =
    ECLIPSE_PROMINENCE_COUNT_MIN +
    Math.floor(rand() * (ECLIPSE_PROMINENCE_COUNT_MAX - ECLIPSE_PROMINENCE_COUNT_MIN + 1));
  const base = rand() * Math.PI * 2;
  const step = (Math.PI * 2) / count;
  const out: EclipseProminence[] = [];
  for (let k = 0; k < count; k += 1) {
    out.push({
      angleRad: base + k * step + (rand() - 0.5) * step * 0.5,
      heightFrac:
        ECLIPSE_PROMINENCE_HEIGHT_MIN_FRAC +
        rand() * (ECLIPSE_PROMINENCE_HEIGHT_MAX_FRAC - ECLIPSE_PROMINENCE_HEIGHT_MIN_FRAC),
      spanRad:
        ECLIPSE_PROMINENCE_SPAN_MIN_RAD +
        rand() * (ECLIPSE_PROMINENCE_SPAN_MAX_RAD - ECLIPSE_PROMINENCE_SPAN_MIN_RAD),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// M3-3 月缘纹理帧旋转（贝利珠 1D 查表的坐标系桥接）
// ---------------------------------------------------------------------------

/**
 * 月缘剖面纹理帧旋转（弧度）：剖面索引 k ↔ 月心极角 k×0.5°（天球北起经东，
 * beadsLeakProfile 同约定）；quad 本地系极角 ψ_local = atan2(east, up)。
 * ψ_equatorial = ψ_local + Δ，Δ = 位置角(天球系) − 偏移方向角(本地系)——
 * 视差角周日旋转隐含其中（月缘特征随天球姿态真实转动）。
 *
 * @param offEastRad 月相对日偏移·东向（弧度，切平面）
 * @param offUpRad 月相对日偏移·高度向（弧度）
 * @param posAngleDeg 月相对日位置角（度，天球北起经东）
 * @returns Δ ∈ (−π, π]
 */
export function limbTexRotationRad(
  offEastRad: number,
  offUpRad: number,
  posAngleDeg: number
): number {
  if (!Number.isFinite(offEastRad) || !Number.isFinite(offUpRad) || !Number.isFinite(posAngleDeg)) {
    throw new RangeError(
      `偏移/位置角必须为有限数，收到 ${offEastRad}, ${offUpRad}, ${posAngleDeg}`
    );
  }
  const local = Math.atan2(offEastRad, offUpRad);
  const raw = posAngleDeg * DEG - local;
  const twoPi = Math.PI * 2;
  const wrapped = ((raw % twoPi) + twoPi) % twoPi;
  return wrapped > Math.PI ? wrapped - twoPi : wrapped;
}

// ---------------------------------------------------------------------------
// M3-6 时间轴高亮与阶段科普卡选择（§3.1 / §3.4）
// ---------------------------------------------------------------------------

/** 贝利珠/钻石环高亮半窗（秒；§3.1：C2±60s、C3±60s 在轴上高亮刻度） */
export const BEADS_HIGHLIGHT_HALF_SEC = 60;

/** 时间轴高亮区段（scrubber 数据驱动渲染，契约 C7 口径） */
export interface EclipseTimelineHighlight {
  key: string;
  startSec: number;
  endSec: number;
}

/** 贝利珠/钻石环高亮窗构造（C2±60s / C3±60s） */
export function beadsHighlightWindows(contacts: EclipseContacts): EclipseTimelineHighlight[] {
  return [
    {
      key: 'beads-c2',
      startSec: contacts.c2 - BEADS_HIGHLIGHT_HALF_SEC,
      endSec: contacts.c2 + BEADS_HIGHLIGHT_HALF_SEC,
    },
    {
      key: 'beads-c3',
      startSec: contacts.c3 - BEADS_HIGHLIGHT_HALF_SEC,
      endSec: contacts.c3 + BEADS_HIGHLIGHT_HALF_SEC,
    },
  ];
}

/** 阶段科普卡键（五接触点区段；§3.1 锚点科普卡） */
export type EclipsePhaseCardKey = 'c1' | 'c2' | 'max' | 'c3' | 'c4';

/** 科普卡切换提前量（秒；C2/C3 卡片覆盖贝利珠时段 + 前导数分钟） */
export const PHASE_CARD_CONTACT_LEAD_SEC = 300;

/** 科普卡贴合尾量（秒；食既/生光卡在接触点后保留的时长） */
export const PHASE_CARD_CONTACT_TAIL_SEC = 30;

/** 当前时刻 → 阶段科普卡（纯区段判定；组件按键查 i18n 文案） */
export function activePhaseCardKey(tSec: number, contacts: EclipseContacts): EclipsePhaseCardKey {
  if (!Number.isFinite(tSec)) throw new RangeError(`tSec 必须为有限数，收到 ${tSec}`);
  if (tSec < contacts.c2 - PHASE_CARD_CONTACT_LEAD_SEC) return 'c1';
  if (tSec <= contacts.c2 + PHASE_CARD_CONTACT_TAIL_SEC) return 'c2';
  if (tSec < contacts.c3 - PHASE_CARD_CONTACT_TAIL_SEC) return 'max';
  if (tSec <= contacts.c3 + PHASE_CARD_CONTACT_LEAD_SEC) return 'c3';
  return 'c4';
}

// ---------------------------------------------------------------------------
// M3-4 亮行星真实方位（§2.1：physics.heliocentricPosition 链）
// ---------------------------------------------------------------------------

/** 黄赤交角（度，J2000 平均值；黄道 → 赤道坐标旋转） */
export const ECLIPTIC_OBLIQUITY_DEG = 23.43928;

/** J2000.0 历元 Unix 秒（2000-01-01 12:00 TT ≈ 11:58:55.816 UTC） */
export const J2000_UNIX_SEC = 946727935.816;

/** 赤道视位置（度） */
export interface EquatorialPos {
  raDeg: number;
  decDeg: number;
}

/**
 * 行星地心赤道视位置（§2.1）：日心黄道位置差 → 黄赤旋转 → RA/Dec。
 * 近似登记：平黄赤交角、忽略光行时与视差（行星标记仅为方位标注，
 * 系统偏差 ≪1°）；平均轨道要素精度对亮行星方位标注足够（非日月几何）。
 *
 * @param planet 行星轨道要素（data/planets）
 * @param earth 地球轨道要素
 * @param tSec UTC 秒（Unix 纪元）
 */
export function planetGeocentricEquatorial(
  planet: OrbitalElements,
  earth: OrbitalElements,
  tSec: number,
  out: EquatorialPos = { raDeg: 0, decDeg: 0 }
): EquatorialPos {
  if (!Number.isFinite(tSec)) throw new RangeError(`tSec 必须为有限数，收到 ${tSec}`);
  const d = (tSec - J2000_UNIX_SEC) / 86400;
  const p = heliocentricPosition(planet, d);
  const e = heliocentricPosition(earth, d);
  const x = p.x - e.x;
  const y = p.y - e.y;
  const z = p.z - e.z;
  const eps = ECLIPTIC_OBLIQUITY_DEG * DEG;
  const ce = Math.cos(eps);
  const se = Math.sin(eps);
  const xeq = x;
  const yeq = y * ce - z * se;
  const zeq = y * se + z * ce;
  const r = Math.hypot(xeq, yeq, zeq);
  out.raDeg = ((Math.atan2(yeq, xeq) / DEG) % 360 + 360) % 360;
  out.decDeg = Math.asin(Math.min(1, Math.max(-1, zeq / r))) / DEG;
  return out;
}

/** 全食暗天下标注的亮行星（§2.1：金/木/水/火；典型目视星等登记为近似） */
export const ECLIPSE_PLANETS: ReadonlyArray<{
  id: 'venus' | 'jupiter' | 'mercury' | 'mars';
  labelKey: MessageKey;
  /** 典型目视星等（近似登记：逐事件真实星等随距离/相位波动 ±1 等量级） */
  typicalMag: number;
}> = [
  { id: 'venus', labelKey: 'lab.eclipsePlanetVenus', typicalMag: -4.1 },
  { id: 'jupiter', labelKey: 'lab.eclipsePlanetJupiter', typicalMag: -1.9 },
  { id: 'mercury', labelKey: 'lab.eclipsePlanetMercury', typicalMag: -0.3 },
  { id: 'mars', labelKey: 'lab.eclipsePlanetMars', typicalMag: 1.0 },
];

// ---------------------------------------------------------------------------
// M3-6 环境数值条（§1.4：气温降幅感知拟合，不做粒子级模拟）
// ---------------------------------------------------------------------------

/** 全食气温降幅（°C；§1.4 实测统计量级） */
export const TOTALITY_TEMP_DROP_C = 3;

/**
 * 气温降幅（°C，≥0）：随遮挡率 ^1.5 渐进至 −3°C（登记近似：真实气温
 * 响应滞后 10–20 分钟，此处取无滞后单调拟合，信息面板量级示意）。
 */
export function eclipseTempDropC(obscuration01: number): number {
  if (!Number.isFinite(obscuration01)) {
    throw new RangeError(`遮挡率必须为有限数，收到 ${obscuration01}`);
  }
  const obs = Math.min(1, Math.max(0, obscuration01));
  return TOTALITY_TEMP_DROP_C * Math.pow(obs, 1.5);
}

// ---------------------------------------------------------------------------
// M5 Eddington 星光引力偏折（§M5-2；契约 C1 starDeflectionArcsec 唯一消费口，
// 组件不得内联公式；登记 A10：偏折量夸张显示 + HUD 标注真实角秒值）
// ---------------------------------------------------------------------------

/** 角秒 → 弧度 */
export const ARCSEC_TO_RAD = Math.PI / (180 * 3600);

/**
 * 偏折显示夸张倍率（登记 A10）：真实日面边缘偏折仅 1.7520″ ≈ 0.00049°，
 * 屏幕上不可辨；×2500 后日面边缘偏移 ≈ 1.22°（约 2.3 个日面直径），近日
 * 恒星位移直观可辨且 δ ∝ 1/b 递减关系可目验。HUD/科普卡明示倍率与真实值
 * （i18n `lab.eclipseDeflectionBadge` 文案数值与此常量同步维护）。
 */
export const EDDINGTON_DEFLECTION_EXAGGERATION = 2500;

/** 偏折双态切换动画时长（秒；0↔1 线性缓动，UI 过渡非物理量） */
export const DEFLECTION_EASE_SEC = 0.8;

/**
 * 星点方向施加引力偏折（CPU 侧事实源，StarDome/标记层 GLSL 照抄勿变形）：
 * 偏折角 δ = starDeflectionArcsec(sep)（契约 C1）× 夸张倍率（A10）×
 * strength01，方向沿**背离日心**的大圆切向（光线掠日弯向太阳 → 视位置
 * 外移，1919 底片的观测形态）。小角近似：dir' = normalize(dir + away·δ)。
 *
 * @param starDir 恒星单位方向（场景地平系）
 * @param sunDir 日心单位方向（同系）
 * @param strength01 偏折态插值（0 = 无太阳假想位 ↔ 1 = 偏折后实位）
 * @param out 复用输出（渲染循环零 GC）
 */
export function deflectedStarDirection(
  starDir: readonly number[],
  sunDir: readonly number[],
  strength01: number,
  out: [number, number, number] = [0, 0, 0]
): [number, number, number] {
  if (!Number.isFinite(strength01)) {
    throw new RangeError(`strength01 必须为有限数，收到 ${strength01}`);
  }
  const cosSep = Math.min(
    1,
    Math.max(-1, starDir[0] * sunDir[0] + starDir[1] * sunDir[1] + starDir[2] * sunDir[2])
  );
  // 背离日心切向：dir 在垂直于 sunDir 方向上的分量
  const ax = starDir[0] - sunDir[0] * cosSep;
  const ay = starDir[1] - sunDir[1] * cosSep;
  const az = starDir[2] - sunDir[2] * cosSep;
  const awayLen = Math.hypot(ax, ay, az);
  if (awayLen < 1e-9 || strength01 <= 0) {
    out[0] = starDir[0];
    out[1] = starDir[1];
    out[2] = starDir[2];
    return out;
  }
  const sepDeg = Math.acos(cosSep) / DEG;
  const deflRad =
    starDeflectionArcsec(sepDeg) * ARCSEC_TO_RAD * EDDINGTON_DEFLECTION_EXAGGERATION * strength01;
  const k = deflRad / awayLen;
  const x = starDir[0] + ax * k;
  const y = starDir[1] + ay * k;
  const z = starDir[2] + az * k;
  const n = Math.hypot(x, y, z);
  out[0] = x / n;
  out[1] = y / n;
  out[2] = z / n;
  return out;
}

/** 对照标记选星上限（§M5-2：双位置标记 + 角秒标注，控制标注密度与 draw call） */
export const EDDINGTON_MARKER_MAX_COUNT = 6;

/** 对照标记选星角距窗（度；食甚时刻与日心视角距上限——毕宿星团覆盖域） */
export const EDDINGTON_MARKER_MAX_SEP_DEG = 8;

/** 对照标记选星星等上限（毕宿星团亮星 + 毕宿五量级；更暗恒星标注价值低） */
export const EDDINGTON_MARKER_MAG_MAX = 4.0;

/** 偏折对照标记星（食甚时刻选定，事件级一次计算） */
export interface EddingtonMarkerStar {
  /** 星表索引（星穹 attribute 对位） */
  index: number;
  /** 赤经（度，J2000） */
  raDeg: number;
  /** 赤纬（度，J2000） */
  decDeg: number;
  /** 视星等 */
  mag: number;
  /** 食甚时刻与日心视角距（度） */
  sepDeg: number;
  /** 真实偏折角（角秒，契约 C1 starDeflectionArcsec——HUD 标注真实值，A10） */
  deflectionArcsec: number;
}

/**
 * 偏折对照标记选星（§M5-2）：食甚时刻地平系内，取日心角距 ≤ 8° 且亮于
 * 4.0 等、位于地平上的恒星，按角距升序取前 6 颗——1919-05-29 食甚太阳
 * 恰在毕宿星团中（历史上选中这次食的原因），选出即毕宿亮星 + 毕宿五。
 *
 * 近似登记：星表为 J2000 历元、恒星时链忽略岁差（M2 星穹同口径）——
 * 1919 历元下恒星相对日面位置含 ~1° 量级系统偏差，对 8° 选星窗与偏折
 * 叙事无实质影响。
 *
 * @param stars 耶鲁亮星目录（结构子集，解耦 bakedData 类型）
 * @param group 事件星历序列组（食甚时刻太阳视位置）
 * @param contacts 接触时刻（取 max）
 * @param observer 观测点（纬度/经度，度）
 */
export function eddingtonMarkerStars(
  stars: ReadonlyArray<{ ra: number; dec: number; mag: number }>,
  group: EclipseSeriesGroup,
  contacts: EclipseContacts,
  observer: { latDeg: number; lonDeg: number }
): EddingtonMarkerStar[] {
  const frame = eclipseFrameState(group, contacts.max);
  const sunDir = sceneDirFromAltAz({
    altRad: frame.sunAltDeg * DEG,
    azRad: frame.sunAzDeg * DEG,
  });
  const lst = lstRadFromUnixSec(contacts.max, observer.lonDeg);
  const out: EddingtonMarkerStar[] = [];
  for (let i = 0; i < stars.length; i += 1) {
    const s = stars[i];
    if (s.mag > EDDINGTON_MARKER_MAG_MAX) continue;
    const altAz = horizontalFromEquatorial(s.ra, s.dec, observer.latDeg, lst);
    if (altAz.altRad <= 0) continue;
    const dir = sceneDirFromAltAz(altAz);
    const cosSep = Math.min(
      1,
      Math.max(-1, dir[0] * sunDir[0] + dir[1] * sunDir[1] + dir[2] * sunDir[2])
    );
    const sepDeg = Math.acos(cosSep) / DEG;
    if (sepDeg > EDDINGTON_MARKER_MAX_SEP_DEG) continue;
    out.push({
      index: i,
      raDeg: s.ra,
      decDeg: s.dec,
      mag: s.mag,
      sepDeg,
      deflectionArcsec: starDeflectionArcsec(sepDeg),
    });
  }
  out.sort((a, b) => a.sepDeg - b.sepDeg);
  return out.slice(0, EDDINGTON_MARKER_MAX_COUNT);
}
