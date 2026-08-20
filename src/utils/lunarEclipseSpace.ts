/**
 * 月食实验室太空视角纯逻辑层（LE 迭代 M4，IMPROVEMENT_REQUIREMENTS_LUNAR_ECLIPSE
 * §M4 / §2.2 / 契约 C1（只消费）/ C3 / 复用日食契约 C7 与太空基建）
 *
 * 组件零内联可测逻辑纪律（§7）：LunarEclipseSpaceView.tsx / LunarEclipseLab.tsx
 * （M4 段）只消费本模块——geo 星历驱动的空间帧状态（日月位置 + 地影锥
 * 度量 + 双食分 + 朔态月影锥段）、天体比例双模径向因子、锥形剖面采样、
 * 月球轨迹线、预设机位运镜姿态、HUD 恒真值行。
 *
 * 场景空间（契约 C3，与日食完全同域）：1 场景单位 = 1,000 km，地心原点，
 * J2000 赤道系 (X,Y,Z)→(X,Z,−Y) 轴映射（直接复用 solarEclipseSpace 的
 * j2000ToSceneVec / earthGroupSceneMatrix3 地理配准链）。影锥几何一律
 * **km 域计算后统一缩放**（契约 C1 半径函数逐距离驱动，禁圆柱/禁固定系数）。
 *
 * **轴向真比例（本条目卖点，B3 登记）**：地影锥长 ~140 万 km = 1,400 场景
 * 单位、月球轨道 384 单位均在可渲染域内，轴向无压缩（与日食 A3 影锥仅为
 * 「可见性表达辅助」的差异点）；太阳仍为方向光 + 1,500 单位远景日盘
 * （距离压缩与日食 A3 单一事实源同源）。
 *
 * **天体比例双模 + 径向放大（决策 ⑦⑧⑨，B12/B13 登记）**：
 * - 艺术化档（默认）：地月系统 + 影锥 + 月距处剖面盘**统一径向因子**
 *   LUNAR_ART_RADIAL_FACTOR = 地球艺术化因子（visualBodyRadius 派生
 *   ≈×14.6，勿硬编码）——地球 ~93、月球 ~25 单位。月球有意小于日食 L2
 *   同源值 ~41（B13 取舍：非统一逐天体放大会打碎 2.6 月径比例并使血月
 *   着色时序失真，需求决策 ⑧ 裁决）；行星/太阳照常 visualBodyRadius
 *   （与日食 A18 同源，由共享叶组件承载）。
 * - 真实档：严格真比例 + 「径向放大 ×4」单开关（默认开，B12）——地月 +
 *   影锥 + 剖面盘**横向统一 ×4、轴向距离不动**（各向异性登记：天体球体
 *   自身各向同性放大 ×4，位置仅横向分量放大——保证月球穿影时序与着色
 *   一致）；艺术化档隐藏该开关。
 * - **比例数字恒等红线（§8 新条目）**：本影/月球半径比（≈2.65）与本影/R⊕
 *   比（≈0.72）在 {真实, 真实+×4, 艺术化} × 全开关组合下恒等
 *   （lunarDisplayRadiiUnits 统一倍率的机器保证，单测锁定）。
 *
 * 相机域纪律（日食 M8 补丁 P5 教训，同款结构性回归单测）：
 * **far ≥ 相机最大半径 + 星穹壳半径**（9,000 ≥ 3,800 + 4,500）。
 *
 * 已知近似登记（B11 扩展）：影轴太阳位置不做光行时迟滞（月面着色与地面
 * 视角 lunarFrameState 同口径，跨视角色彩一致优先；日食侧迟滞项服务于
 * 地表足印地理配准，本条目无地表足印）；半影锥渲染段在本影锥长处截断
 * （半影为无限外扩锥，渲染截断属表达取舍）；剖面盘影半径取月心轴向距离
 * 处的值（跨月盘 ~2.5% 变化并入近似）。
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
  type EphemerisSeries,
} from '@/utils/solarEclipse';
import {
  DANJON_SHADOW_ENLARGEMENT,
  EARTH_EQUATORIAL_RADIUS_KM,
  NO_ECLIPSE_MAGNITUDE,
  lunarEclipseKind,
  penumbraRadiusKmAt,
  penumbralMagnitude,
  umbraConeLengthKm,
  umbraRadiusKmAt,
  umbralMagnitude,
  type LunarEclipseKind,
} from '@/utils/lunarEclipse';
import {
  GROUND_INTRO_FOV_END_DEG,
  PENUMBRA_RENDER_OVERSHOOT_KM,
  SPACE_ART_EARTH_SCALE,
  SPACE_CAMERA_FAR_UNITS,
  SPACE_EARTH_RADIUS_UNITS,
  SPACE_UNITS_PER_KM,
  earthGroupSceneMatrix3,
  j2000ToSceneVec,
  type EclipseBodyScaleMode,
  type MutableVec3,
  type ViewIntroPose,
} from '@/utils/solarEclipseSpace';
import type { EclipseTimelineWindow } from '@/utils/solarEclipseLab';

// ---------------------------------------------------------------------------
// 天体比例双模径向因子（决策 ⑦⑧⑨；B12/B13）
// ---------------------------------------------------------------------------

/**
 * 艺术化档统一径向因子（B13）：= 地球艺术化因子 = visualBodyRadius('earth')
 * × SPACE_ART_RADIUS_FACTOR / R⊕(单位) ≈ ×14.6——**派生量勿硬编码**
 * （SPACE_ART_EARTH_SCALE 即该派生式，单测断言锁定同源）。
 */
export const LUNAR_ART_RADIAL_FACTOR = SPACE_ART_EARTH_SCALE;

/** 真实档「径向放大」开关倍率（B12：默认开；横向 ×4、轴向距离不动） */
export const LUNAR_REAL_RADIAL_MAGNIFY_FACTOR = 4;

/**
 * 档位 × 开关 → 统一径向因子（地月球体 + 影锥横向 + 剖面盘 + 月位横向
 * 分量**同一倍率**——比例数字恒等红线的实现层单点；coneRadialScaleForMode
 * 档位×开关先例）。艺术化档忽略开关（整体放大接管，日食 M8-1 同口径）。
 */
export function lunarRadialScaleForMode(
  mode: EclipseBodyScaleMode,
  radialMagnify: boolean
): number {
  if (mode === 'art') return LUNAR_ART_RADIAL_FACTOR;
  return radialMagnify ? LUNAR_REAL_RADIAL_MAGNIFY_FACTOR : 1;
}

// ---------------------------------------------------------------------------
// 空间帧状态（geo 星历 → 日月位置 + 地影锥度量 + 双食分 + 朔态月影锥段）
// ---------------------------------------------------------------------------

/** 朔↔望开关（§M4-5 交点几何演示；契约 C7 朔望参数化的 UI 侧档位） */
export type LunarSyzygyMode = 'full' | 'new';

/** 档位 → syzygyOffsetRad（望 = π 地影投月球 / 朔 = 0 月影投地球，契约 C7） */
export function lunarSyzygyOffsetRad(mode: LunarSyzygyMode): number {
  return mode === 'full' ? Math.PI : 0;
}

/**
 * 月食太空视角逐帧状态（lunarSpaceFrameState 输出；out 复用零 GC）。
 * 场景量以场景单位（1 = 1,000 km）表达，全部为**真值**（未乘径向因子——
 * 显示倍率由 lunarDisplayMoonPos / lunarDisplayRadiiUnits 统一施加）。
 */
export interface LunarSpaceFrameState {
  /** 太阳方向（场景，单位向量，指向太阳） */
  sunDirScene: MutableVec3;
  /** 影轴方向（场景，单位向量，背日向——本影/半影共轴） */
  shadowAxisScene: MutableVec3;
  /** 月球真位置（场景单位） */
  moonPosScene: MutableVec3;
  /** 月心沿影轴的轴向投影（场景单位；望态 ≈ +384） */
  moonAxialUnits: number;
  /** 月心横向分量（场景单位；moonPosScene − axial·axis） */
  moonPerpScene: MutableVec3;
  /** 月球地心距离（km） */
  moonDistKm: number;
  /** 日地距离（km） */
  sunDistKm: number;
  /** 地球网格 → 场景旋转矩阵（行主序 3×3；地理配准链复用） */
  earthMatrix3: Float64Array;
  /** 本影锥长（场景单位，真值 ≈1,400——轴向真比例卖点） */
  umbraConeLengthUnits: number;
  /** 月心轴向距离处影截面是否存在（背日侧 + 本影锥长内才有本影盘） */
  sectionExists: boolean;
  /** 月心轴向距离处本影半径（场景单位，真值 ≈4.6；锥顶点外为 0） */
  umbraRadiusAtMoonUnits: number;
  /** 月心轴向距离处半影半径（场景单位，真值 ≈8.2） */
  penumbraRadiusAtMoonUnits: number;
  /** 本影食分（契约 C1；向日侧哨兵 NO_ECLIPSE_MAGNITUDE） */
  umbralMag: number;
  /** 半影食分 */
  penumbralMag: number;
  /** 食型（实时判定） */
  kind: LunarEclipseKind;
  /** 朔态月影锥段（§M4-5 影锥方向反转的可视侧；望态/关闭时 active=false） */
  moonShadowActive: boolean;
  msUmbraTipScene: MutableVec3;
  msUmbraDirScene: MutableVec3;
  msUmbraLenUnits: number;
  msUmbraBaseRadiusUnits: number;
  msPenTipScene: MutableVec3;
  msPenDirScene: MutableVec3;
  msPenLenUnits: number;
  msPenBaseRadiusUnits: number;
}

/** 空空间帧状态（挂载期分配一次） */
export function emptyLunarSpaceFrameState(): LunarSpaceFrameState {
  return {
    sunDirScene: [1, 0, 0],
    shadowAxisScene: [-1, 0, 0],
    moonPosScene: [0, 0, 0],
    moonAxialUnits: 0,
    moonPerpScene: [0, 0, 0],
    moonDistKm: 384400,
    sunDistKm: 1.496e8,
    earthMatrix3: new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]),
    umbraConeLengthUnits: 0,
    sectionExists: false,
    umbraRadiusAtMoonUnits: 0,
    penumbraRadiusAtMoonUnits: 0,
    umbralMag: NO_ECLIPSE_MAGNITUDE,
    penumbralMag: NO_ECLIPSE_MAGNITUDE,
    kind: 'none',
    moonShadowActive: false,
    msUmbraTipScene: [0, 0, 0],
    msUmbraDirScene: [1, 0, 0],
    msUmbraLenUnits: 0,
    msUmbraBaseRadiusUnits: 0,
    msPenTipScene: [0, 0, 0],
    msPenDirScene: [1, 0, 0],
    msPenLenUnits: 0,
    msPenBaseRadiusUnits: 0,
  };
}

/**
 * 太空视角逐帧状态（§M4-1/M4-2/M4-5）：geo 星历插值 → 日月 J2000 位置
 * （倾角叙事传 narrativeMoonPosKm 改写月位）→ 契约 C1 影锥度量 + 双食分 +
 * （朔态）月影锥段 → 场景量组装。
 *
 * 近似登记（文件头 B11 扩展）：影轴不做太阳光行时迟滞——与地面视角
 * lunarFrameState 同口径，保证跨视角血月着色一致（切视角对照目验点）。
 *
 * @param geo 事件 geo 序列（契约 C2：8 列单位方向 + 距离 km）
 * @param tSec 事件时间轴秒（越界钳制）
 * @param narrativeMoonPosKm 倾角叙事月球位置（J2000 km；null = 星历路径）
 * @param moonShadowCones 朔态叙事：是否计算月影锥段（影锥方向反转可视侧）
 * @param out 复用输出（渲染循环零 GC）
 */
export function lunarSpaceFrameState(
  geo: EphemerisSeries,
  tSec: number,
  narrativeMoonPosKm: readonly [number, number, number] | null,
  moonShadowCones: boolean,
  out: LunarSpaceFrameState = emptyLunarSpaceFrameState()
): LunarSpaceFrameState {
  const row = interpolateEphemeris(geo, tSec);
  const sample = geoSampleFromRow(row, tSec);
  const sunPosKm: [number, number, number] = [
    sample.sunDir[0] * sample.sunDistKm,
    sample.sunDir[1] * sample.sunDistKm,
    sample.sunDir[2] * sample.sunDistKm,
  ];
  let moonPosKm: [number, number, number];
  if (narrativeMoonPosKm) {
    moonPosKm = [narrativeMoonPosKm[0], narrativeMoonPosKm[1], narrativeMoonPosKm[2]];
    out.moonDistKm = Math.hypot(moonPosKm[0], moonPosKm[1], moonPosKm[2]);
  } else {
    moonPosKm = [
      sample.moonDir[0] * sample.moonDistKm,
      sample.moonDir[1] * sample.moonDistKm,
      sample.moonDir[2] * sample.moonDistKm,
    ];
    out.moonDistKm = sample.moonDistKm;
  }
  out.sunDistKm = sample.sunDistKm;

  j2000ToSceneVec(sample.sunDir, out.sunDirScene);
  out.shadowAxisScene[0] = -out.sunDirScene[0];
  out.shadowAxisScene[1] = -out.sunDirScene[1];
  out.shadowAxisScene[2] = -out.sunDirScene[2];
  j2000ToSceneVec(moonPosKm, out.moonPosScene);
  out.moonPosScene[0] *= SPACE_UNITS_PER_KM;
  out.moonPosScene[1] *= SPACE_UNITS_PER_KM;
  out.moonPosScene[2] *= SPACE_UNITS_PER_KM;
  earthGroupSceneMatrix3(tSec, out.earthMatrix3);

  // 轴向/横向分解（场景域；轴过地心原点）
  const ax = out.shadowAxisScene;
  out.moonAxialUnits =
    out.moonPosScene[0] * ax[0] + out.moonPosScene[1] * ax[1] + out.moonPosScene[2] * ax[2];
  out.moonPerpScene[0] = out.moonPosScene[0] - out.moonAxialUnits * ax[0];
  out.moonPerpScene[1] = out.moonPosScene[1] - out.moonAxialUnits * ax[1];
  out.moonPerpScene[2] = out.moonPosScene[2] - out.moonAxialUnits * ax[2];

  // 地影锥度量（契约 C1，km 域后统一缩放——C3 红线）
  const coneLenKm = umbraConeLengthKm(sample.sunDistKm);
  out.umbraConeLengthUnits = coneLenKm * SPACE_UNITS_PER_KM;
  const axialKm = out.moonAxialUnits / SPACE_UNITS_PER_KM;
  if (axialKm > EARTH_EQUATORIAL_RADIUS_KM) {
    out.sectionExists = true;
    out.umbraRadiusAtMoonUnits =
      umbraRadiusKmAt(axialKm, sample.sunDistKm) * SPACE_UNITS_PER_KM;
    out.penumbraRadiusAtMoonUnits =
      penumbraRadiusKmAt(axialKm, sample.sunDistKm) * SPACE_UNITS_PER_KM;
  } else {
    out.sectionExists = false;
    out.umbraRadiusAtMoonUnits = 0;
    out.penumbraRadiusAtMoonUnits = 0;
  }

  // 双食分 + 食型（契约 C1 实时判定；HUD 与月面 shader 共源）
  out.umbralMag = umbralMagnitude(sunPosKm, moonPosKm);
  out.penumbralMag = penumbralMagnitude(sunPosKm, moonPosKm);
  out.kind =
    out.umbralMag === NO_ECLIPSE_MAGNITUDE
      ? 'none'
      : lunarEclipseKind(out.umbralMag, out.penumbralMag);

  // 朔态月影锥段（§M4-5：复用日食契约 C1 umbraCone/penumbraCone——
  // 月影投地球的「影锥方向反转」可视侧；渲染段组装沿日食 spaceFrameState 手法）
  out.moonShadowActive = moonShadowCones;
  if (moonShadowCones) {
    const mu = umbraCone(sunPosKm, moonPosKm);
    const mp = penumbraCone(sunPosKm, moonPosKm);
    j2000ToSceneVec(mu.apexKm, out.msUmbraTipScene);
    out.msUmbraTipScene[0] *= SPACE_UNITS_PER_KM;
    out.msUmbraTipScene[1] *= SPACE_UNITS_PER_KM;
    out.msUmbraTipScene[2] *= SPACE_UNITS_PER_KM;
    const axisScene: MutableVec3 = [0, 0, 0];
    j2000ToSceneVec(mu.axis, axisScene);
    out.msUmbraDirScene[0] = -axisScene[0];
    out.msUmbraDirScene[1] = -axisScene[1];
    out.msUmbraDirScene[2] = -axisScene[2];
    out.msUmbraLenUnits = mu.lengthKm * SPACE_UNITS_PER_KM;
    out.msUmbraBaseRadiusUnits =
      mu.lengthKm * Math.tan(mu.halfAngleRad) * SPACE_UNITS_PER_KM;
    j2000ToSceneVec(mp.apexKm, out.msPenTipScene);
    out.msPenTipScene[0] *= SPACE_UNITS_PER_KM;
    out.msPenTipScene[1] *= SPACE_UNITS_PER_KM;
    out.msPenTipScene[2] *= SPACE_UNITS_PER_KM;
    out.msPenDirScene[0] = axisScene[0];
    out.msPenDirScene[1] = axisScene[1];
    out.msPenDirScene[2] = axisScene[2];
    const penRenderKm = mp.lengthKm + out.moonDistKm + PENUMBRA_RENDER_OVERSHOOT_KM;
    out.msPenLenUnits = penRenderKm * SPACE_UNITS_PER_KM;
    out.msPenBaseRadiusUnits =
      penRenderKm * Math.tan(mp.halfAngleRad) * SPACE_UNITS_PER_KM;
  }
  return out;
}

// ---------------------------------------------------------------------------
// 显示量组装（真值 × 统一径向因子——比例数字恒等红线的单点实现）
// ---------------------------------------------------------------------------

/**
 * 月球显示位置（各向异性，B12/B13）：轴向分量保持真值、横向分量 × 径向
 * 因子——保证放大后的月球与放大后的影盘保持真实的穿影包含关系与时序。
 */
export function lunarDisplayMoonPos(
  state: LunarSpaceFrameState,
  radialFactor: number,
  out: MutableVec3
): MutableVec3 {
  if (!(radialFactor > 0)) throw new RangeError(`径向因子必须为正：${radialFactor}`);
  const ax = state.shadowAxisScene;
  out[0] = ax[0] * state.moonAxialUnits + state.moonPerpScene[0] * radialFactor;
  out[1] = ax[1] * state.moonAxialUnits + state.moonPerpScene[1] * radialFactor;
  out[2] = ax[2] * state.moonAxialUnits + state.moonPerpScene[2] * radialFactor;
  return out;
}

/** 显示半径集（场景单位；全部 = 真值 × 同一径向因子） */
export interface LunarDisplayRadii {
  earthUnits: number;
  moonUnits: number;
  umbraUnits: number;
  penumbraUnits: number;
}

/**
 * 档位/开关 → 显示半径集（比例恒等的机器保证：四量乘**同一**因子，任何
 * 比值与 km 域真值恒等——§8 红线「禁止打破径向教学比例的非统一放大」）。
 */
export function lunarDisplayRadiiUnits(
  state: LunarSpaceFrameState,
  mode: EclipseBodyScaleMode,
  radialMagnify: boolean,
  out: LunarDisplayRadii = { earthUnits: 0, moonUnits: 0, umbraUnits: 0, penumbraUnits: 0 }
): LunarDisplayRadii {
  const f = lunarRadialScaleForMode(mode, radialMagnify);
  out.earthUnits = SPACE_EARTH_RADIUS_UNITS * f;
  out.moonUnits = MOON_MEAN_RADIUS_KM * SPACE_UNITS_PER_KM * f;
  out.umbraUnits = state.umbraRadiusAtMoonUnits * f;
  out.penumbraUnits = state.penumbraRadiusAtMoonUnits * f;
  return out;
}

// ---------------------------------------------------------------------------
// 影锥剖面采样（C1 半径函数逐距离驱动锥形——非简单圆锥拉伸；§M4-2）
// ---------------------------------------------------------------------------

/** 锥形剖面轴向站数（一次性构建；档位切换只变径向缩放不重建） */
export const CONE_PROFILE_STATIONS = 48;

/**
 * 剖面起始轴向距离（km）：Danjon 视差式在 d → R⊕ 时发散（asin(R⊕/d) → 90°，
 * 非其适用域），起点取 30,000 km（earthShadow.ts 卫星域上界内，与线性锥
 * 互差 <3.5%——两模型互证域）；地球侧 30 单位内不绘锥（真实档地球半径
 * 6.4 单位、全貌机位 2,300 单位下不可辨；艺术化档该段藏于放大地球内），
 * 登记为渲染取舍。
 */
export const CONE_PROFILE_START_KM = 30000;

/**
 * 影锥剖面采样（场景单位；km 域经契约 C1 真锥半径函数逐站求值后统一缩放）：
 * 返回平铺 [d0, r0, d1, r1, …]（d = 轴向距离、r = 截面半径，均为场景单位，
 * 轴向真比例）。本影 = 收敛锥（半径递减至锥长处为 0，顶点在背日侧远端）；
 * 半影 = 外扩锥（半径递增，几何顶点在向日侧——两锥顶点异侧由单测锁定）。
 * 半影渲染段在 maxDistKm 处截断（缺省 = 本影锥长，渲染取舍登记见文件头）。
 *
 * @param kind 'umbra' | 'penumbra'
 * @param sunDistKm 日地距离（km）
 * @param maxDistKm 采样终点（km；缺省 = umbraConeLengthKm(sunDistKm)）
 * @param stations 轴向站数（≥ 2）
 */
export function shadowConeProfileUnits(
  kind: 'umbra' | 'penumbra',
  sunDistKm: number,
  maxDistKm?: number,
  stations: number = CONE_PROFILE_STATIONS
): Float64Array {
  if (!Number.isInteger(stations) || stations < 2) {
    throw new RangeError(`站数必须为 ≥2 的整数：${stations}`);
  }
  const coneLenKm = umbraConeLengthKm(sunDistKm);
  const endKm = maxDistKm ?? coneLenKm;
  if (!(endKm > CONE_PROFILE_START_KM)) {
    throw new RangeError(`采样终点必须 > 起点 ${CONE_PROFILE_START_KM} km：${endKm}`);
  }
  const out = new Float64Array(stations * 2);
  for (let i = 0; i < stations; i += 1) {
    const t = i / (stations - 1);
    const dKm = CONE_PROFILE_START_KM + (endKm - CONE_PROFILE_START_KM) * t;
    let rKm: number;
    if (kind === 'umbra') {
      // 锥长处角量恰为 0（umbraRadiusKmAt 顶点外返回 0——收敛锥自然闭合）
      rKm = dKm >= coneLenKm ? 0 : umbraRadiusKmAt(dKm, sunDistKm, DANJON_SHADOW_ENLARGEMENT);
    } else {
      rKm = penumbraRadiusKmAt(dKm, sunDistKm, DANJON_SHADOW_ENLARGEMENT);
    }
    out[i * 2] = dKm * SPACE_UNITS_PER_KM;
    out[i * 2 + 1] = rKm * SPACE_UNITS_PER_KM;
  }
  return out;
}

// ---------------------------------------------------------------------------
// 月球轨迹线（§M4-2：时间窗均匀采样 + 已走过段变色的 uSwept01 参数）
// ---------------------------------------------------------------------------

/** 轨迹线采样数（时间窗均匀；一次性构建，径向因子变化允许一次性重建） */
export const LUNAR_TRAJECTORY_SAMPLES = 96;

/**
 * 月球轨迹线顶点（显示域 Float32Array n×3）：时间窗均匀采样，逐样本按当时
 * 影轴做轴向/横向分解并施加径向因子（与月球显示位置同一各向异性口径——
 * 轨迹线与月球球体在任意档位下严格共线）。
 *
 * @param geo 事件 geo 序列
 * @param window 时间轴窗口
 * @param radialFactor 统一径向因子（lunarRadialScaleForMode 输出）
 * @param samples 采样数（≥ 2）
 */
export function moonTrajectoryPositions(
  geo: EphemerisSeries,
  window: EclipseTimelineWindow,
  radialFactor: number,
  samples: number = LUNAR_TRAJECTORY_SAMPLES
): Float32Array {
  if (!Number.isInteger(samples) || samples < 2) {
    throw new RangeError(`采样数必须为 ≥2 的整数：${samples}`);
  }
  if (!(window.endSec > window.startSec)) {
    throw new RangeError(`时间窗非法：${window.startSec} → ${window.endSec}`);
  }
  const out = new Float32Array(samples * 3);
  const scratch = emptyLunarSpaceFrameState();
  const pos: MutableVec3 = [0, 0, 0];
  for (let i = 0; i < samples; i += 1) {
    const t = window.startSec + ((window.endSec - window.startSec) * i) / (samples - 1);
    lunarSpaceFrameState(geo, t, null, false, scratch);
    lunarDisplayMoonPos(scratch, radialFactor, pos);
    out[i * 3] = pos[0];
    out[i * 3 + 1] = pos[1];
    out[i * 3 + 2] = pos[2];
  }
  return out;
}

/** 轨迹已走过段进度（0–1；采样在时间上均匀 → 进度 = 时间归一，钳制端点） */
export function trajectorySweep01(tSec: number, window: EclipseTimelineWindow): number {
  if (!Number.isFinite(tSec)) throw new RangeError(`tSec 必须为有限数：${tSec}`);
  const span = window.endSec - window.startSec;
  if (!(span > 0)) throw new RangeError(`时间窗非法：span=${span}`);
  return Math.min(1, Math.max(0, (tSec - window.startSec) / span));
}

// ---------------------------------------------------------------------------
// 相机域与预设机位（§M4-2 全貌/月球特写；far 约束 P5 同款结构性防守）
// ---------------------------------------------------------------------------

/** 太空档近/远平面（场景单位；far 与日食单一事实源同值——结构性单测锁定
 * far ≥ 相机最大半径 + 星穹壳半径，锥全貌机位比日食更远的本条目重算结论：
 * 3,800 + 4,500 = 8,300 ≤ 9,000 仍成立） */
export const LUNAR_SPACE_CAMERA_NEAR_UNITS = 0.5;
export const LUNAR_SPACE_CAMERA_FAR_UNITS = SPACE_CAMERA_FAR_UNITS;

/** 轨道相机半径域（场景单位；上限按 1,400 单位锥长重定 ≥2,000——取 3,800
 * 与日食同值：全貌机位 2,300 + 行星轨道全景余量） */
export const LUNAR_SPACE_CAMERA_RADIUS_MIN_REAL_UNITS = 8;
export const LUNAR_SPACE_CAMERA_RADIUS_MIN_ART_UNITS = 110;
export const LUNAR_SPACE_CAMERA_RADIUS_MAX_UNITS = 3800;

/** 全貌机位（锥长 1,400 单位全框：radius·tan(fov/2) ≥ 锥长 + 余量） */
export const LUNAR_OVERVIEW_END_RADIUS_UNITS = 2300;
export const LUNAR_OVERVIEW_START_RADIUS_UNITS = 3400;
export const LUNAR_OVERVIEW_ALT_RAD = (14 * Math.PI) / 180;

/** 月球特写机位：相机置月球外侧、距月心 = 月显示半径 × 本倍数（回望地球） */
export const LUNAR_CLOSEUP_STANDOFF_RADII = 6;
export const LUNAR_CLOSEUP_MIN_STANDOFF_UNITS = 30;

/** 预设机位档（§M4-2 一键切换 + 运镜插值） */
export type LunarSpacePreset = 'overview' | 'closeup';

/** smoothstep（GLSL 同式标量版；spaceIntroPose 同手法） */
function smooth01(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

/**
 * 全貌机位运镜（spaceArtOverviewPose 手法）：相机置**影轴侧向**（垂直于
 * 影轴的水平向 + 抬升 LUNAR_OVERVIEW_ALT_RAD），侧看「地球 → 影锥 → 月球」
 * 全序列——锥长 3.7× 月距一眼可读；自远端滑入。
 *
 * @param shadowAxisScene 影轴方向（场景，单位向量，背日向）
 * @param t01 运镜进度（0–1）
 */
export function lunarSpaceOverviewPose(
  shadowAxisScene: readonly [number, number, number] | readonly number[],
  t01: number,
  out: ViewIntroPose
): ViewIntroPose {
  const s = smooth01(t01);
  const radius =
    LUNAR_OVERVIEW_START_RADIUS_UNITS +
    (LUNAR_OVERVIEW_END_RADIUS_UNITS - LUNAR_OVERVIEW_START_RADIUS_UNITS) * s;
  // 影轴的水平垂向（axis 近黄道面，y 分量小；退化时兜底 +Z）
  const [axl, , azl] = [shadowAxisScene[0], shadowAxisScene[1], shadowAxisScene[2]];
  let px = -azl;
  let pz = axl;
  const pLen = Math.hypot(px, pz);
  if (pLen > 1e-9) {
    px /= pLen;
    pz /= pLen;
  } else {
    px = 0;
    pz = 1;
  }
  const cA = Math.cos(LUNAR_OVERVIEW_ALT_RAD);
  const sA = Math.sin(LUNAR_OVERVIEW_ALT_RAD);
  out.pos[0] = px * cA * radius;
  out.pos[1] = sA * radius;
  out.pos[2] = pz * cA * radius;
  out.fovDeg = GROUND_INTRO_FOV_END_DEG;
  return out;
}

/**
 * 月球特写机位运镜：终点在月球显示位置外侧（沿月心方向延伸 standoff），
 * 回望地心——月球居前景、地球与影锥为背景；自全貌半径滑入。
 *
 * @param moonDisplayPos 月球显示位置（lunarDisplayMoonPos 输出）
 * @param moonDisplayRadiusUnits 月球显示半径（lunarDisplayRadiiUnits.moonUnits）
 * @param t01 运镜进度（0–1）
 */
export function lunarMoonCloseupPose(
  moonDisplayPos: readonly [number, number, number] | readonly number[],
  moonDisplayRadiusUnits: number,
  t01: number,
  out: ViewIntroPose
): ViewIntroPose {
  if (!(moonDisplayRadiusUnits > 0)) {
    throw new RangeError(`月球显示半径必须为正：${moonDisplayRadiusUnits}`);
  }
  const [mx, my, mz] = [moonDisplayPos[0], moonDisplayPos[1], moonDisplayPos[2]];
  const mLen = Math.hypot(mx, my, mz);
  if (!(mLen > 1e-6)) throw new RangeError('月球显示位置退化（零向量）');
  const standoff = Math.max(
    LUNAR_CLOSEUP_MIN_STANDOFF_UNITS,
    moonDisplayRadiusUnits * LUNAR_CLOSEUP_STANDOFF_RADII
  );
  const endRadius = mLen + standoff;
  const s = smooth01(t01);
  const radius = LUNAR_OVERVIEW_END_RADIUS_UNITS + (endRadius - LUNAR_OVERVIEW_END_RADIUS_UNITS) * s;
  out.pos[0] = (mx / mLen) * radius;
  out.pos[1] = (my / mLen) * radius + moonDisplayRadiusUnits * 0.8 * s;
  out.pos[2] = (mz / mLen) * radius;
  out.fovDeg = GROUND_INTRO_FOV_END_DEG;
  return out;
}

// ---------------------------------------------------------------------------
// HUD 恒真值行（§M4-2：不随档位/开关变化的量化验收锚点）
// ---------------------------------------------------------------------------

/** HUD 恒真值（§1.1 锚点：锥长 ~140 万 km / 月距 38.4 万 km / 本影 2.6 月径 / 0.72 R⊕） */
export interface LunarSpaceHudTruth {
  /** 本影锥长（km，真值） */
  coneLengthKm: number;
  /** 月球地心距离（km，真值） */
  moonDistKm: number;
  /** 月距处本影半径（km，真值） */
  umbraRadiusKm: number;
  /** 本影直径 / 月球直径（≈2.65；剖面不存在时 0） */
  umbraPerMoonDiam: number;
  /** 本影半径 / 地球赤道半径（≈0.72） */
  umbraPerEarthRadius: number;
  /** 锥长 / 月距（≈3.7——「月球只走到锥长 27%」的倒数表达） */
  coneLenPerMoonDist: number;
}

/** 帧状态 → HUD 恒真值行（全部 km 域真值，径向因子不入——恒真红线） */
export function lunarSpaceHudTruth(
  state: LunarSpaceFrameState,
  out: LunarSpaceHudTruth = {
    coneLengthKm: 0,
    moonDistKm: 0,
    umbraRadiusKm: 0,
    umbraPerMoonDiam: 0,
    umbraPerEarthRadius: 0,
    coneLenPerMoonDist: 0,
  }
): LunarSpaceHudTruth {
  out.coneLengthKm = state.umbraConeLengthUnits / SPACE_UNITS_PER_KM;
  out.moonDistKm = state.moonDistKm;
  out.umbraRadiusKm = state.umbraRadiusAtMoonUnits / SPACE_UNITS_PER_KM;
  out.umbraPerMoonDiam = out.umbraRadiusKm / MOON_MEAN_RADIUS_KM;
  out.umbraPerEarthRadius = out.umbraRadiusKm / EARTH_MEAN_RADIUS_KM;
  out.coneLenPerMoonDist = state.moonDistKm > 0 ? out.coneLengthKm / state.moonDistKm : 0;
  return out;
}
