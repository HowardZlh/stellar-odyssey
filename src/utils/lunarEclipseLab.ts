/**
 * 月食实验室场景侧纯逻辑层（LE 迭代 M2，IMPROVEMENT_REQUIREMENTS_LUNAR_ECLIPSE
 * §M2 / 契约 C1（只消费）/ C3 / 复用日食契约 C7）
 *
 * 组件零内联可测逻辑纪律（§7）：LunarEclipseLab.tsx 只消费本模块——
 * - 时间轴窗口/七锚点列表（契约 C7 数据驱动：偏食无 U2/U3、半影食仅 P1/食甚/P4，
 *   按 contacts 缺省自动传子集，scrubber 组件零改动）；
 * - 加速回放倍率（B1 登记：全程压到 ~1.5 分钟，HUD 常显真实时刻与倍速；
 *   月食演变慢，无需日食式的全食段变速曲线——恒定倍率 + ×1 真实档）；
 * - 逐帧月盘/影几何状态（契约 C1 函数族只消费不改签名）：站心 topo 行驱动
 *   月亮高度角/方位角/视半径，地心 geo 行驱动影轴垂距 → 双食分/食型/影盘
 *   相对月心的切平面偏移与影半径视角量（月盘 quad shader 的全部 uniform 源）；
 * - 阶段科普卡选择（七接触点区段，缺省锚点自动跳过）。
 *
 * 影盘方位链（M2-4 目验点「缺口方位随影轴几何变化」的实现层）：
 * 地影是发生在月面上的物理现象（全球观测者看到同一暗缺），故几何在**地心
 * J2000 赤道系**求解：影轴与月距平面交点 − 月心 = 垂距向量 → 投影到月位置
 * 天空切平面（东/北基）→ 经视差角（parallactic angle）旋入地平系（上/东基）
 * ——量纲 km / 月距 = 视角弧度（小角近似，量级 ≤1.3°，误差 ≪ 盘缘软化）。
 * 近似登记（§1.6 / B11）：影几何取地心口径（站心视差使月亮视位置整体平移
 * ~1°，但影缺附着于月面，形态与方位对全球观测者一致到一阶）；视差角忽略
 * 章动/极移；月面纹理静态姿态。
 *
 * 状态流红线（§3.1 同日食）：一切效果由「事件时间轴秒 tSec」单值可重建——
 * 本模块全部函数为 tSec 的纯函数，禁止帧间累积量（scrubber 任意 seek 前提）。
 *
 * M2 灰度占位（契约 C4 的骨架期形态）：本影段先用灰度径向渐进
 * （umbraGrayFactor，M3 换 umbraShading 血月 GLSL 镜像）；半影段**即用**
 * penumbraShading（红线 ②「微妙变暗不得夸大」从骨架期守住）；两段在本影
 * 边界处 C0 连续（单测锁定）。
 *
 * 硬性约束：不 import React/three；函数无状态、可重入；覆盖率 gate ≥90%。
 */

import type { MessageKey } from '@/i18n';
import type { LunarEclipseContacts } from '@/utils/bakedData';
import { interpolateEphemeris, type EphemerisSeries } from '@/utils/solarEclipse';
import {
  TIMELINE_PAD_SEC,
  lstRadFromUnixSec,
  type EclipseTimelineAnchor,
  type EclipseTimelineWindow,
} from '@/utils/solarEclipseLab';
import {
  EARTH_EQUATORIAL_RADIUS_KM,
  NO_ECLIPSE_MAGNITUDE,
  PENUMBRA_SHADING_MAX_DIM,
  UMBRA_SHADING_EDGE_EXPONENT,
  lunarEclipseKind,
  penumbralMagnitude,
  penumbraShading,
  shadowAxisGeometryKm,
  umbraRadiusKmAt,
  penumbraRadiusKmAt,
  umbralMagnitude,
  moonlightLimitingMagDelta,
  type LunarEclipseKind,
} from '@/utils/lunarEclipse';
import { effectiveLimitingMag } from '@/utils/labSky';

/** 度 → 弧度 */
const DEG = Math.PI / 180;

// ---------------------------------------------------------------------------
// 时间轴窗口与七锚点（复用日食契约 C7 的类型与组件，锚点按 contacts 缺省）
// ---------------------------------------------------------------------------

/** 接触时刻 → 时间轴窗口（P1−15min → P4+15min；topo 采样窗 ±30min 全覆盖） */
export function lunarTimelineWindow(contacts: LunarEclipseContacts): EclipseTimelineWindow {
  if (!(contacts.p1 < contacts.p4)) {
    throw new RangeError(`接触时刻非法：p1=${contacts.p1} 应早于 p4=${contacts.p4}`);
  }
  return { startSec: contacts.p1 - TIMELINE_PAD_SEC, endSec: contacts.p4 + TIMELINE_PAD_SEC };
}

/** 七接触点锚点键（阶段科普卡与锚点跳转共用；缺省锚点自动跳过） */
export type LunarPhaseKey = 'p1' | 'u1' | 'u2' | 'max' | 'u3' | 'u4' | 'p4';

/** 七锚点定义序（key → contacts 字段 → i18n 键；数据驱动，契约 C7 口径） */
const LUNAR_ANCHOR_DEFS: ReadonlyArray<{
  key: LunarPhaseKey;
  labelKey: MessageKey;
  pick: (c: LunarEclipseContacts) => number | null;
}> = [
  { key: 'p1', labelKey: 'lab.lunarAnchorP1', pick: (c) => c.p1 },
  { key: 'u1', labelKey: 'lab.lunarAnchorU1', pick: (c) => c.u1 },
  { key: 'u2', labelKey: 'lab.lunarAnchorU2', pick: (c) => c.u2 },
  { key: 'max', labelKey: 'lab.lunarAnchorMax', pick: (c) => c.max },
  { key: 'u3', labelKey: 'lab.lunarAnchorU3', pick: (c) => c.u3 },
  { key: 'u4', labelKey: 'lab.lunarAnchorU4', pick: (c) => c.u4 },
  { key: 'p4', labelKey: 'lab.lunarAnchorP4', pick: (c) => c.p4 },
];

/**
 * 月食锚点构造（契约 C7：全食 7 锚点 / 偏食 5（无 U2/U3）/ 半影食 3
 * （仅 P1/食甚/P4）——按 contacts 缺省自动传子集，scrubber 组件零改动）。
 */
export function lunarEclipseAnchors(contacts: LunarEclipseContacts): EclipseTimelineAnchor[] {
  const out: EclipseTimelineAnchor[] = [];
  for (const def of LUNAR_ANCHOR_DEFS) {
    const tSec = def.pick(contacts);
    if (tSec !== null) out.push({ key: def.key, tSec, labelKey: def.labelKey });
  }
  return out;
}

/**
 * 当前时刻 → 阶段科普卡键（§3.1 锚点科普卡）：取「最后一个已到达的锚点」，
 * P1 前归 P1（预备阶段与半影食始共用卡）。缺省锚点自动跳过（数据驱动）。
 */
export function activeLunarPhaseKey(tSec: number, contacts: LunarEclipseContacts): LunarPhaseKey {
  if (!Number.isFinite(tSec)) throw new RangeError(`tSec 必须为有限数，收到 ${tSec}`);
  let active: LunarPhaseKey = 'p1';
  for (const def of LUNAR_ANCHOR_DEFS) {
    const t = def.pick(contacts);
    if (t !== null && tSec >= t) active = def.key;
  }
  return active;
}

// ---------------------------------------------------------------------------
// 加速回放（B1 登记：全程 4–6h → ~1.5 分钟；HUD 常显真实时刻与倍速）
// ---------------------------------------------------------------------------

/** 播放模式（加速回放 / ×1 真实速度） */
export type LunarPlayMode = 'fast' | 'real';

/** 加速档目标回放时长（秒；全程压缩到 ~1.5 分钟，需求 §1.2「1–2 分钟」域内） */
export const LUNAR_FAST_PLAYBACK_TARGET_SEC = 90;

/**
 * 播放倍率（B1）：'real' 恒 ×1；'fast' = 窗口跨度 / 目标时长（恒定倍率——
 * 月食演变慢，无需日食式分段变速），下限钳制 ×1。tSec 无关（seek 一致性天然成立）。
 */
export function lunarPlayRate(mode: LunarPlayMode, window: EclipseTimelineWindow): number {
  if (mode === 'real') return 1;
  const span = window.endSec - window.startSec;
  if (!(span > 0)) throw new RangeError(`时间轴窗口非法：span=${span}`);
  return Math.max(1, span / LUNAR_FAST_PLAYBACK_TARGET_SEC);
}

// ---------------------------------------------------------------------------
// 视差角（影盘方位的赤道 → 地平旋转；近似登记见文件头）
// ---------------------------------------------------------------------------

/**
 * 视差角 q（弧度）：天体处「天球北方向 → 天顶方向」的位置角（北起经东为正）。
 * q = atan2( sin H, tan φ · cos δ − sin δ · cos H )，H = LST − α（时角）。
 * 子午圈上（H = 0）q = 0（天顶方向与天球北同向），西移（H > 0）q > 0。
 *
 * @param hourAngleRad 时角 H（弧度）
 * @param latDeg 观测纬度 φ（度）
 * @param decDeg 天体赤纬 δ（度）
 */
export function parallacticAngleRad(hourAngleRad: number, latDeg: number, decDeg: number): number {
  if (!Number.isFinite(hourAngleRad) || !Number.isFinite(latDeg) || !Number.isFinite(decDeg)) {
    throw new RangeError(`时角/纬度/赤纬必须有限，收到 ${hourAngleRad}, ${latDeg}, ${decDeg}`);
  }
  const phi = latDeg * DEG;
  const dec = decDeg * DEG;
  return Math.atan2(
    Math.sin(hourAngleRad),
    Math.tan(phi) * Math.cos(dec) - Math.sin(dec) * Math.cos(hourAngleRad)
  );
}

// ---------------------------------------------------------------------------
// 逐帧状态（tSec 单值可重建；useFrame 与 HUD interval 共用）
// ---------------------------------------------------------------------------

/** topo 行内的角度列下标（moonAz——插值走最短弧防 360° 回绕；契约 C2 行形） */
export const LUNAR_TOPO_ANGULAR_COLUMNS: readonly number[] = [1];

/** 事件星历序列组（LunarEclipseEventData 的结构子集，解耦 bakedData 类型） */
export interface LunarSeriesGroup {
  topo: EphemerisSeries;
  geo: EphemerisSeries;
}

/**
 * 逐帧月盘/影几何状态（lunarFrameState 输出；out 复用支持渲染循环零 GC）。
 *
 * 影盘偏移在「月心切平面」地平系表达（quad 本地角坐标，弧度）：
 * shadowOffEastRad = 影盘中心在月心东侧的视角偏移（+ = 东）、
 * shadowOffUpRad = 高度向偏移（+ = 上）——mesh lookAt 原点后本地 +X =
 * 方位角减小向，消费侧写 uniform 时取 (−east, up)（日食 quad 同约定）。
 */
export interface LunarFrameState {
  /** 月亮高度角（度，站心 AIRLESS） */
  moonAltDeg: number;
  /** 月亮方位角（度，北起经东） */
  moonAzDeg: number;
  /** 月亮视半径（度，站心） */
  moonSdDeg: number;
  /** 太阳高度角（度；夜天光/晨昏蒙影链输入） */
  sunAltDeg: number;
  /** 本影食分（契约 C1 umbralMagnitude；<0 未触本影） */
  umbralMag: number;
  /** 半影食分（契约 C1 penumbralMagnitude） */
  penumbralMag: number;
  /** 食型（契约 C1 lunarEclipseKind 实时判定） */
  kind: LunarEclipseKind;
  /** 影盘中心相对月心偏移·东向（弧度，切平面小角） */
  shadowOffEastRad: number;
  /** 影盘中心相对月心偏移·高度向（弧度） */
  shadowOffUpRad: number;
  /** 月距处本影半径的视角量（弧度） */
  umbraRadRad: number;
  /** 月距处半影半径的视角量（弧度） */
  penumbraRadRad: number;
  /** 有效极限星等（晨昏蒙影 × 月光压制；星穹剔除阈值） */
  limitingMag: number;
}

/** 空帧状态（挂载期分配一次，useFrame 复用零 GC） */
export function emptyLunarFrameState(): LunarFrameState {
  return {
    moonAltDeg: 0,
    moonAzDeg: 0,
    moonSdDeg: 0.259,
    sunAltDeg: -30,
    umbralMag: NO_ECLIPSE_MAGNITUDE,
    penumbralMag: NO_ECLIPSE_MAGNITUDE,
    kind: 'none',
    shadowOffEastRad: 0,
    shadowOffUpRad: 0,
    umbraRadRad: 0,
    penumbraRadRad: 0,
    limitingMag: 2.5,
  };
}

/** 星穹基准极限星等（本条目无光害控件；月光压制经 moonlightLimitingMagDelta） */
export const LUNAR_BASE_LIMITING_MAG = 6.5;

/**
 * M2 月面亮度占位（0–1，满月 = 1）：星空显现链随 M3（moonBrightness 由血月
 * 着色积分驱动）；骨架期取常量满月——月光压制 ≈4 等的真实月夜星空基线。
 */
export const LUNAR_M2_MOON_BRIGHTNESS = 1;

/**
 * 时间轴秒 → 逐帧状态（契约 C1 函数族只消费）：
 * topo 插值（moonAz 最短弧）→ 站心行解码；geo 插值 → 日月地心位置 →
 * 影轴几何/双食分/食型/影盘切平面偏移与影半径视角量（方位链见文件头）。
 *
 * @param group 事件星历序列组（topo @60s / geo @300s）
 * @param observer 观测点（纬度/经度，度；视差角与 LST 输入）
 * @param tSec 事件时间轴秒（UTC；越界由 interpolateEphemeris 钳制到端点）
 * @param out 复用输出对象（不传则新建）
 */
export function lunarFrameState(
  group: LunarSeriesGroup,
  observer: { latDeg: number; lonDeg: number },
  tSec: number,
  out: LunarFrameState = emptyLunarFrameState()
): LunarFrameState {
  const topoRow = interpolateEphemeris(group.topo, tSec, LUNAR_TOPO_ANGULAR_COLUMNS);
  const [moonAlt, moonAz, moonSd, sunAlt] = topoRow;
  out.moonAltDeg = moonAlt;
  out.moonAzDeg = moonAz;
  out.moonSdDeg = moonSd;
  out.sunAltDeg = sunAlt;

  // 有效极限星等：晨昏蒙影上限 ∩ 月光压制（M2 常量满月，M3 接血月亮度链）
  out.limitingMag = effectiveLimitingMag(
    LUNAR_BASE_LIMITING_MAG - moonlightLimitingMagDelta(LUNAR_M2_MOON_BRIGHTNESS),
    sunAlt * DEG
  );

  // geo 行 → 地心位置（行布局同日食 C2：sunX,sunY,sunZ,sunDistKm,moonX..moonDistKm；
  // 方向分量插值后重归一 × 距离列——对行存单位向量或 km 位置两种口径均稳健）
  const g = interpolateEphemeris(group.geo, tSec);
  const sunLen = Math.hypot(g[0], g[1], g[2]);
  const moonLen = Math.hypot(g[4], g[5], g[6]);
  const sunDistKm = g[3];
  const moonDistKm = g[7];
  const sunPos: [number, number, number] = [
    (g[0] / sunLen) * sunDistKm,
    (g[1] / sunLen) * sunDistKm,
    (g[2] / sunLen) * sunDistKm,
  ];
  const moonPos: [number, number, number] = [
    (g[4] / moonLen) * moonDistKm,
    (g[5] / moonLen) * moonDistKm,
    (g[6] / moonLen) * moonDistKm,
  ];

  const axis = shadowAxisGeometryKm(sunPos, moonPos);
  if (axis.axialKm <= EARTH_EQUATORIAL_RADIUS_KM) {
    // 向日侧哨兵（真实窗口内不可达；防御分支与 C1 哨兵口径一致）
    out.umbralMag = NO_ECLIPSE_MAGNITUDE;
    out.penumbralMag = NO_ECLIPSE_MAGNITUDE;
    out.kind = 'none';
    out.shadowOffEastRad = 0;
    out.shadowOffUpRad = 0;
    out.umbraRadRad = 0;
    out.penumbraRadRad = 0;
    return out;
  }

  out.umbralMag = umbralMagnitude(sunPos, moonPos);
  out.penumbralMag = penumbralMagnitude(sunPos, moonPos);
  out.kind = lunarEclipseKind(out.umbralMag, out.penumbralMag);
  out.umbraRadRad = umbraRadiusKmAt(axis.axialKm, sunDistKm) / moonDistKm;
  out.penumbraRadRad = penumbraRadiusKmAt(axis.axialKm, sunDistKm) / moonDistKm;

  // 影轴中心（月距平面）− 月心 = 垂距向量（地心 J2000 赤道系）
  const invSun = 1 / Math.hypot(sunPos[0], sunPos[1], sunPos[2]);
  const dxKm = -sunPos[0] * invSun * axis.axialKm - moonPos[0];
  const dyKm = -sunPos[1] * invSun * axis.axialKm - moonPos[1];
  const dzKm = -sunPos[2] * invSun * axis.axialKm - moonPos[2];

  // 月位置天空切平面基（东 = ẑ×l̂ / |ẑ×l̂|、北 = l̂×东）
  const lx = moonPos[0] / moonDistKm;
  const ly = moonPos[1] / moonDistKm;
  const lz = moonPos[2] / moonDistKm;
  const eLen = Math.hypot(lx, ly);
  if (eLen < 1e-9) {
    // 月亮恰在天极方向（真实数据不可达；防御分支）
    out.shadowOffEastRad = 0;
    out.shadowOffUpRad = 0;
    return out;
  }
  const ex = -ly / eLen;
  const ey = lx / eLen;
  // 北 = l̂ × ê（ê_z = 0）
  const nx = ly * 0 - lz * ey;
  const ny = lz * ex - lx * 0;
  const nz = lx * ey - ly * ex;
  const dE = dxKm * ex + dyKm * ey;
  const dN = dxKm * nx + dyKm * ny + dzKm * nz;

  // 视差角旋转（赤道东/北 → 地平东/上）：月 RA/Dec + LST → 时角 → q
  const raRad = Math.atan2(ly, lx);
  const decDeg = Math.asin(Math.min(1, Math.max(-1, lz))) / DEG;
  const hourAngleRad = lstRadFromUnixSec(tSec, observer.lonDeg) - raRad;
  const q = parallacticAngleRad(hourAngleRad, observer.latDeg, decDeg);
  const cosQ = Math.cos(q);
  const sinQ = Math.sin(q);
  out.shadowOffUpRad = (dE * sinQ + dN * cosQ) / moonDistKm;
  out.shadowOffEastRad = (dE * cosQ - dN * sinQ) / moonDistKm;
  return out;
}

// ---------------------------------------------------------------------------
// M2 月盘遮挡灰度渐进（契约 C4 骨架期形态；CPU 事实源，GLSL 照抄勿变形）
// ---------------------------------------------------------------------------

/** M2 本影灰度占位·影心亮度因子（M3 换 umbraShading 血月镜像后本组常量废弃） */
export const UMBRA_GRAY_CENTER_FACTOR = 0.02;

/** 本影外缘亮度因子 = 半影内缘（1 − PENUMBRA_SHADING_MAX_DIM；两段 C0 连续） */
export const UMBRA_GRAY_EDGE_FACTOR = 1 - PENUMBRA_SHADING_MAX_DIM;

/**
 * M2 本影段灰度亮度因子（CPU/GLSL 镜像事实源）：
 * factor(r) = center + (edge − center) · r^UMBRA_SHADING_EDGE_EXPONENT——
 * 与 umbraShading 同径向指数（M3 换色表时径向形态零跳变），r=1 处与
 * penumbraShading(0) 相等（本影/半影边界 C0 连续，单测锁定）。
 *
 * @param rNorm01 归一化本影半径（0 = 影心，1 = 本影边缘；越界钳制）
 */
export function umbraGrayFactor(rNorm01: number): number {
  if (!Number.isFinite(rNorm01)) throw new RangeError(`rNorm01 必须为有限数，收到 ${rNorm01}`);
  const r = Math.min(1, Math.max(0, rNorm01));
  return (
    UMBRA_GRAY_CENTER_FACTOR +
    (UMBRA_GRAY_EDGE_FACTOR - UMBRA_GRAY_CENTER_FACTOR) * r ** UMBRA_SHADING_EDGE_EXPONENT
  );
}

/**
 * 月盘遮挡总亮度因子（CPU 事实源；shader 内逐像素同式镜像）：
 * 像素到影轴视角距 ρ → ρ < 本影半径走灰度渐进；本影—半影带走
 * penumbraShading（半影径向 0 = 本影缘 → 1 = 半影缘）；半影外全亮。
 *
 * @param rhoRad 像素点到影盘中心的视角距（弧度）
 * @param umbraRadRad 本影半径视角量（弧度）
 * @param penumbraRadRad 半影半径视角量（弧度，> umbraRadRad）
 */
export function moonDiskShadeFactor(
  rhoRad: number,
  umbraRadRad: number,
  penumbraRadRad: number
): number {
  if (!Number.isFinite(rhoRad) || rhoRad < 0) throw new RangeError(`rhoRad 非法：${rhoRad}`);
  if (!(penumbraRadRad > umbraRadRad) || !(umbraRadRad >= 0)) {
    throw new RangeError(`影半径非法：umbra=${umbraRadRad}, penumbra=${penumbraRadRad}`);
  }
  if (umbraRadRad > 0 && rhoRad < umbraRadRad) return umbraGrayFactor(rhoRad / umbraRadRad);
  const rPen = (rhoRad - umbraRadRad) / (penumbraRadRad - umbraRadRad);
  return rPen >= 1 ? 1 : penumbraShading(rPen);
}

// ---------------------------------------------------------------------------
// 场景常量（契约 C3：真实视半径渲染；quad 只承载月盘，影几何在 shader 内）
// ---------------------------------------------------------------------------

/**
 * 月盘 quad 半角（弧度）：月视半径 ≤0.28°，取 0.5° 留盘缘软化与插值裕量
 * （影盘不占 quad 面积——遮挡是月面上的着色，超出月盘部分透明）。
 */
export const LUNAR_QUAD_HALF_ANGLE_RAD = 0.5 * DEG;

/** 月面基准亮度增益（满月盘面观感基准；HDR 前线性域，M3 曝光滑杆接管） */
export const LUNAR_MOON_BASE_GAIN = 1.15;
