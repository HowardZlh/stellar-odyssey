/**
 * 月食实验室场景侧纯逻辑层（LE 迭代 M2 骨架 + M3 血月核心，
 * IMPROVEMENT_REQUIREMENTS_LUNAR_ECLIPSE §M2/§M3 / 契约 C1（只消费）/ C3/C4 /
 * 复用日食契约 C7）
 *
 * 组件零内联可测逻辑纪律（§7）：LunarEclipseLab.tsx 只消费本模块——
 * - 时间轴窗口/七锚点列表（契约 C7 数据驱动：偏食无 U2/U3、半影食仅 P1/食甚/P4，
 *   按 contacts 缺省自动传子集，scrubber 组件零改动）；
 * - 加速回放倍率（B1 登记：全程压到 ~1.5 分钟，HUD 常显真实时刻与倍速；
 *   月食演变慢，无需日食式的全食段变速曲线——恒定倍率 + ×1 真实档）；
 * - 逐帧月盘/影几何状态（契约 C1 函数族只消费不改签名）：站心 topo 行驱动
 *   月亮高度角/方位角/视半径，地心 geo 行驱动影轴垂距 → 双食分/食型/影盘
 *   相对月心的切平面偏移与影半径视角量（月盘 quad shader 的全部 uniform 源）；
 * - 阶段科普卡选择（七接触点区段，缺省锚点自动跳过）；
 * - （M3）血月逐像素照度 CPU 事实源（bloodMoonIlluminationRgb，契约 C4 GLSL
 *   镜像纪律）/ 月缘增亮因子（B5）/ 月面物理亮度积分（星空显现链）/ 月光
 *   环境项（天光/地面联动）/ 曝光与浑浊度控件映射。
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
 * M3 血月着色（契约 C4，取代 M2 灰度占位）：本影段 = umbraShading 丹戎径向
 * 色表（红线 ①：径向梯度，禁均匀变暗）；半影段仍**直接消费** penumbraShading
 * （红线 ②「微妙变暗不得夸大」的幅度上限不动）；本影缘以窄混合带软化
 * （UMBRA_EDGE_BLEND_FRAC，Danjon 放大修正本就承认影缘为大气渐变带——
 * 登记为几何软化非亮度夸大）。
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
  lunarEclipseKind,
  oppositionSurgeFactor,
  penumbralMagnitude,
  penumbraShading,
  shadowAxisGeometryKm,
  umbraRadiusKmAt,
  umbraShading,
  penumbraRadiusKmAt,
  umbralMagnitude,
  moonlightLimitingMagDelta,
  type LunarEclipseKind,
  type ShadingRgb,
} from '@/utils/lunarEclipse';
import { effectiveLimitingMag, labSkyColors, type LabSkyColors } from '@/utils/labSky';

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
  /** 月面物理亮度（0–1 归一，满月 = 1；星空显现链与月光环境项共用，M3-3） */
  moonBrightness01: number;
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
    moonBrightness01: 1,
    limitingMag: 2.5,
  };
}

/** 星穹基准极限星等（本条目无光害控件；月光压制经 moonlightLimitingMagDelta） */
export const LUNAR_BASE_LIMITING_MAG = 6.5;

/** 丹戎 L 缺省值（浑浊度控件未接线时的中性档；控件接线后由 UI 状态驱动） */
export const LUNAR_DEFAULT_DANJON_L = 2;

/**
 * 时间轴秒 → 逐帧状态（契约 C1 函数族只消费）：
 * topo 插值（moonAz 最短弧）→ 站心行解码；geo 插值 → 日月地心位置 →
 * 影轴几何/双食分/食型/影盘切平面偏移与影半径视角量（方位链见文件头）；
 * （M3）月面物理亮度积分 → 极限星等月光压制（星空显现链）。
 *
 * @param group 事件星历序列组（topo @60s / geo @300s）
 * @param observer 观测点（纬度/经度，度；视差角与 LST 输入）
 * @param tSec 事件时间轴秒（UTC；越界由 interpolateEphemeris 钳制到端点）
 * @param out 复用输出对象（不传则新建）
 * @param danjonL 丹戎 L（0–4 连续；全食段残余亮度的档位输入，M3-3）
 */
export function lunarFrameState(
  group: LunarSeriesGroup,
  observer: { latDeg: number; lonDeg: number },
  tSec: number,
  out: LunarFrameState = emptyLunarFrameState(),
  danjonL: number = LUNAR_DEFAULT_DANJON_L
): LunarFrameState {
  const topoRow = interpolateEphemeris(group.topo, tSec, LUNAR_TOPO_ANGULAR_COLUMNS);
  const [moonAlt, moonAz, moonSd, sunAlt] = topoRow;
  out.moonAltDeg = moonAlt;
  out.moonAzDeg = moonAz;
  out.moonSdDeg = moonSd;
  out.sunAltDeg = sunAlt;

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
    out.moonBrightness01 = 1;
    out.limitingMag = effectiveLimitingMag(
      LUNAR_BASE_LIMITING_MAG - moonlightLimitingMagDelta(1),
      sunAlt * DEG
    );
    return out;
  }

  out.umbralMag = umbralMagnitude(sunPos, moonPos);
  out.penumbralMag = penumbralMagnitude(sunPos, moonPos);
  out.kind = lunarEclipseKind(out.umbralMag, out.penumbralMag);
  out.umbraRadRad = umbraRadiusKmAt(axis.axialKm, sunDistKm) / moonDistKm;
  out.penumbraRadRad = penumbraRadiusKmAt(axis.axialKm, sunDistKm) / moonDistKm;

  // M3-3 星空显现链：月面物理亮度积分（垂距视角量直接取 perp/月距，与切平面
  // 分解解耦——防御分支下亮度链仍成立）→ 月光压制 → 晨昏蒙影上限
  out.moonBrightness01 = lunarMoonBrightness01(
    axis.perpKm / moonDistKm,
    moonSd * DEG,
    out.umbraRadRad,
    out.penumbraRadRad,
    danjonL
  );
  out.limitingMag = effectiveLimitingMag(
    LUNAR_BASE_LIMITING_MAG - moonlightLimitingMagDelta(out.moonBrightness01),
    sunAlt * DEG
  );

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
// M3 血月逐像素照度（契约 C4 CPU 事实源；GLSL 照抄勿变形，三视角共用镜像）
// ---------------------------------------------------------------------------

/** 月面贴图平均反照灰度（shader 无贴图降级同值；血月色表 ÷ 本值 = 照度乘子） */
export const LUNAR_ALBEDO_MEAN = 0.32;

/**
 * 本影缘混合带半宽（× 本影半径）：本影/半影边界的窄软化带——Danjon 放大
 * 修正（大气不透明层 75 km）本就承认影缘是大气渐变带而非几何锐边。
 * 登记口径：几何软化非亮度夸大（红线 ② 的幅度上限在带外原样成立）。
 */
export const UMBRA_EDGE_BLEND_FRAC = 0.05;

/** 月缘增亮径向指数（对冲效应盘面分布的最小参数化；B5 简化逆反射登记） */
export const LUNAR_LIMB_SURGE_EXPONENT = 2;

/** smoothstep（GLSL 同式；镜像纪律内部工具） */
function smoothstep01(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * 月缘增亮因子（M3-4，B5 登记：简化逆反射非完整 Hapke）：
 * gain(r) = 1 + (oppositionSurgeFactor(0) − 1) · r^LUNAR_LIMB_SURGE_EXPONENT
 * ——盘心 1、月缘 = 对冲峰值 1.4（「天鹅绒蒙凸面：中心最暗、边缘最亮」，
 * 底稿 §7.1）；振幅派生自契约 C1 对冲因子（勿硬编码，单测锁定）。
 * 只乘直射照度分量（本影内由丹戎色表接管，不双计）。
 *
 * @param diskRNorm01 月盘径向位置（0 = 盘心，1 = 月缘；越界钳制）
 */
export function moonLimbSurgeGain(diskRNorm01: number): number {
  if (!Number.isFinite(diskRNorm01)) {
    throw new RangeError(`diskRNorm01 必须为有限数，收到 ${diskRNorm01}`);
  }
  const r = Math.min(1, Math.max(0, diskRNorm01));
  return 1 + (oppositionSurgeFactor(0) - 1) * r ** LUNAR_LIMB_SURGE_EXPONENT;
}

/**
 * 血月逐像素照度乘子（契约 C4 核心，CPU/GLSL 镜像事实源；相对月面反照的
 * RGB 乘子——渲染侧 色 = 反照 × 本乘子 × 增益 × 曝光）：
 * - 本影段：umbraShading(ρ/本影半径, 丹戎L) ÷ LUNAR_ALBEDO_MEAN（径向梯度：
 *   靠影心极暗、靠影缘偏亮偏黄——红线 ①，禁均匀变暗）；
 * - 半影段：penumbraShading 标量 × 月缘增亮（红线 ② 幅度上限原样，直接消费）；
 * - 本影缘：±UMBRA_EDGE_BLEND_FRAC·本影半径 窄带 smoothstep 混合两段。
 *
 * @param rhoRad 像素点到影盘中心的视角距（弧度）
 * @param umbraRadRad 本影半径视角量（弧度）
 * @param penumbraRadRad 半影半径视角量（弧度，> umbraRadRad）
 * @param danjonL 丹戎 L（0–4 连续）
 * @param limbGain 月缘增亮因子（moonLimbSurgeGain 输出；缺省 1）
 * @param out 复用输出（渲染外 CPU 消费可零 GC；不传则新建）
 */
export function bloodMoonIlluminationRgb(
  rhoRad: number,
  umbraRadRad: number,
  penumbraRadRad: number,
  danjonL: number,
  limbGain: number = 1,
  out: [number, number, number] = [0, 0, 0]
): [number, number, number] {
  if (!Number.isFinite(rhoRad) || rhoRad < 0) throw new RangeError(`rhoRad 非法：${rhoRad}`);
  if (!(penumbraRadRad > umbraRadRad) || !(umbraRadRad >= 0)) {
    throw new RangeError(`影半径非法：umbra=${umbraRadRad}, penumbra=${penumbraRadRad}`);
  }
  if (!Number.isFinite(limbGain) || limbGain < 0) throw new RangeError(`limbGain 非法：${limbGain}`);
  const rPen = Math.min(1, Math.max(0, (rhoRad - umbraRadRad) / (penumbraRadRad - umbraRadRad)));
  const direct = penumbraShading(rPen) * limbGain;
  out[0] = direct;
  out[1] = direct;
  out[2] = direct;
  if (umbraRadRad > 0) {
    const blood: ShadingRgb = umbraShading(Math.min(1, rhoRad / umbraRadRad), danjonL);
    const w = umbraRadRad * UMBRA_EDGE_BLEND_FRAC;
    const s = smoothstep01(umbraRadRad - w, umbraRadRad + w, rhoRad);
    for (let c = 0; c < 3; c += 1) {
      out[c] = (blood[c] / LUNAR_ALBEDO_MEAN) * (1 - s) + out[c] * s;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// M3 月面物理亮度积分（星空显现链；与美术色表解耦的物理口径）
// ---------------------------------------------------------------------------

/**
 * 全食段月面残余亮度（0–1，相对满月）的丹戎档位锚定：
 * log10(residual) = −5 + L/2 —— L2 → 1e-4（底稿 §7.1「食甚变暗 ~万倍」锚点）、
 * L0 → 1e-5（皮纳图博级几乎不可见）、L4 → 1e-3（亮铜红）。
 * 与 DANJON_UMBRA_PRESETS 美术色表**有意解耦**：色表是显示端美术映射（B6），
 * 本函数是星空显现链的物理近似口径（对数感知域的档位内插）。
 */
export function danjonResidualBrightness01(danjonL: number): number {
  if (!Number.isFinite(danjonL)) throw new RangeError(`danjonL 必须为有限数，收到 ${danjonL}`);
  const l = Math.min(4, Math.max(0, danjonL));
  return 10 ** (-5 + l / 2);
}

/** 月面亮度积分采样密度（径向环 × 环向；~192 采样/次，帧内 CPU 开销可忽略） */
export const MOON_BRIGHTNESS_RADIAL_SAMPLES = 12;
export const MOON_BRIGHTNESS_AZIMUTH_SAMPLES = 16;

/**
 * 月面物理亮度（0–1 归一，满月 = 1；M3-3 星空显现链的驱动量）：
 * 对月盘做面积加权采样积分——每采样点直射照度 = 太阳可见比例的线性代理
 * （本影内 0、半影内 (ρ−Ru)/(Rp−Ru)、半影外 1；物理口径，独立于红线 ②
 * 的保守化美术半影曲线），本影覆盖部分叠加丹戎残余亮度。
 * 无影（penumbraRadRad ≤ 0，向日侧哨兵）→ 1。
 *
 * @param shadowSepRad 影盘中心到月心的视角距（弧度）
 * @param moonRadRad 月盘视半径（弧度，> 0）
 * @param umbraRadRad 本影半径视角量（弧度）
 * @param penumbraRadRad 半影半径视角量（弧度）
 * @param danjonL 丹戎 L（0–4 连续；残余亮度档位）
 */
export function lunarMoonBrightness01(
  shadowSepRad: number,
  moonRadRad: number,
  umbraRadRad: number,
  penumbraRadRad: number,
  danjonL: number
): number {
  if (!Number.isFinite(shadowSepRad) || shadowSepRad < 0) {
    throw new RangeError(`shadowSepRad 非法：${shadowSepRad}`);
  }
  if (!(moonRadRad > 0)) throw new RangeError(`moonRadRad 必须 > 0，收到 ${moonRadRad}`);
  if (penumbraRadRad <= 0) return 1;
  if (!(penumbraRadRad > umbraRadRad) || !(umbraRadRad >= 0)) {
    throw new RangeError(`影半径非法：umbra=${umbraRadRad}, penumbra=${penumbraRadRad}`);
  }
  const residual = danjonResidualBrightness01(danjonL);
  let sum = 0;
  let weightSum = 0;
  for (let i = 0; i < MOON_BRIGHTNESS_RADIAL_SAMPLES; i += 1) {
    const r = ((i + 0.5) / MOON_BRIGHTNESS_RADIAL_SAMPLES) * moonRadRad;
    const weight = r; // 面积加权（环周长 ∝ r）
    for (let j = 0; j < MOON_BRIGHTNESS_AZIMUTH_SAMPLES; j += 1) {
      const a = ((j + 0.5) / MOON_BRIGHTNESS_AZIMUTH_SAMPLES) * Math.PI * 2;
      const rho = Math.hypot(r * Math.cos(a) - shadowSepRad, r * Math.sin(a));
      let direct: number;
      if (rho < umbraRadRad) {
        direct = residual;
      } else if (rho >= penumbraRadRad) {
        direct = 1;
      } else {
        direct = (rho - umbraRadRad) / (penumbraRadRad - umbraRadRad);
      }
      sum += direct * weight;
      weightSum += weight;
    }
  }
  return Math.min(1, sum / weightSum);
}

// ---------------------------------------------------------------------------
// M3 月光环境项（天光/地面反照联动——全食段环境变暗的低成本高说服力链）
// ---------------------------------------------------------------------------

/** 月光天顶增量（满月 · 月高满效时；线性 RGB，偏冷蓝的月夜散射色） */
export const MOONLIGHT_ZENITH_GAIN: readonly [number, number, number] = [0.01, 0.013, 0.02];

/** 月光地平增量（低空视线路径更长，恒亮于天顶——与夜天光同分布规律） */
export const MOONLIGHT_HORIZON_GAIN: readonly [number, number, number] = [0.016, 0.021, 0.032];

/** 月光满效的月亮高度正弦阈（sin 30°；低月高时月光随大气路径衰减的线性代理） */
export const MOONLIGHT_ALT_SIN_REF = 0.5;

/**
 * 夜天光 + 月光环境项（M3-3 环境联动）：labSkyColors 基色上叠加
 * 月光增量 × 月面亮度 × 月高因子——GroundDisk/HorizonRidge 经
 * labGroundColor(本输出) 自动继承（单一事实源，全食段地面同步变暗）。
 *
 * @param userLm 用户极限星等（本条目固定 LUNAR_BASE_LIMITING_MAG）
 * @param sunAltRad 太阳高度角（弧度）
 * @param moonBrightness01 月面亮度（0–1；lunarFrameState 输出）
 * @param moonAltDeg 月亮高度角（度；地平下无月光）
 * @param out 可选复用对象（useFrame 消费零 GC）
 */
export function lunarSkyColorsWithMoonlight(
  userLm: number,
  sunAltRad: number,
  moonBrightness01: number,
  moonAltDeg: number,
  out?: LabSkyColors
): LabSkyColors {
  if (!Number.isFinite(moonBrightness01) || !Number.isFinite(moonAltDeg)) {
    throw new RangeError(`月亮亮度/高度必须有限，收到 ${moonBrightness01}, ${moonAltDeg}`);
  }
  const sky = labSkyColors(userLm, sunAltRad, out);
  const b = Math.min(1, Math.max(0, moonBrightness01));
  const altFactor = Math.min(1, Math.max(0, Math.sin(moonAltDeg * DEG) / MOONLIGHT_ALT_SIN_REF));
  const gain = b * altFactor;
  for (let c = 0; c < 3; c += 1) {
    sky.zenith[c] = Math.min(1, sky.zenith[c] + MOONLIGHT_ZENITH_GAIN[c] * gain);
    sky.horizon[c] = Math.min(1, sky.horizon[c] + MOONLIGHT_HORIZON_GAIN[c] * gain);
  }
  return sky;
}

// ---------------------------------------------------------------------------
// M3 控件映射（丹戎五档预设 / 浑浊度 / 曝光；契约 C1 映射的 UI 侧逆元与增益）
// ---------------------------------------------------------------------------

/**
 * 丹戎 L → 浑浊度（turbidityToDanjonL 的逆映射；五档预设按钮与页签默认值共用）：
 * turbidity = 1 − L/4（往返恒等，单测锁定）。
 *
 * @param danjonL 丹戎 L（0–4；越界钳制）
 */
export function defaultTurbidityForDanjonL(danjonL: number): number {
  if (!Number.isFinite(danjonL)) throw new RangeError(`danjonL 必须为有限数，收到 ${danjonL}`);
  return Math.min(1, Math.max(0, 1 - Math.min(4, Math.max(0, danjonL)) / 4));
}

/** 曝光增益域（×0.25 暗 → ×4 长曝光；0.5 → ×1 中性，B2 登记的用户可见侧） */
export const LUNAR_EXPOSURE_GAIN_MIN = 0.25;
export const LUNAR_EXPOSURE_GAIN_MAX = 4;

/**
 * 曝光滑杆 01 → 线性增益（对数内插：0 → ×0.25、0.5 → ×1、1 → ×4）。
 * 简单曝光乘子（契约 C4：无日食式双基准曝光状态机）。
 *
 * @param exposure01 滑杆位置（0–1；越界钳制）
 */
export function lunarExposureGain(exposure01: number): number {
  if (!Number.isFinite(exposure01)) throw new RangeError(`exposure01 必须为有限数，收到 ${exposure01}`);
  const x = Math.min(1, Math.max(0, exposure01));
  return (
    LUNAR_EXPOSURE_GAIN_MIN * (LUNAR_EXPOSURE_GAIN_MAX / LUNAR_EXPOSURE_GAIN_MIN) ** x
  );
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
