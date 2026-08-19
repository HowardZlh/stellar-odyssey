/**
 * LE-M4 太空视角纯逻辑单测（utils/lunarEclipseSpace）：
 * - 径向因子派生断言（B13：艺术化因子 = visualBodyRadius('earth') ×
 *   SPACE_ART_RADIUS_FACTOR / R⊕单位 ≈ ×14.6，勿硬编码；地球 ~93、
 *   月球 ~25 单位且有意 < 日食 L2 同源值 ~41）；
 * - **比例数字恒等（本条目最强机器防守，§8 红线）**：本影/月球半径比
 *   （≈2.65）与本影/R⊕ 比（≈0.72）在 {真实, 真实+×4, 艺术化} × 全开关
 *   组合下恒等且等于 km 域真值比；
 * - far ≥ 相机最大半径 + 星穹壳半径（日食 M8 补丁 P5 同款结构性回归）；
 * - 影锥剖面（C1 半径函数逐距离驱动）：本影收敛至锥长处 0 / 半影外扩 /
 *   两锥顶点异侧 / 月距站 0.72 R⊕ 锚点 / 锥长 ∈ [135, 145] 万 km；
 * - 帧状态（真实 l2029 烘焙星历锚点）：食甚食型 total、影轴 = 反日向、
 *   轴向/横向分解正交、显示位置各向异性（轴向保持、横向 × 因子）；
 * - 望态参数组装（契约 C7）：syzygyOffsetRad π/0 档位映射 + 望↔朔反向、
 *   朔态月影锥段方向指向地球侧；
 * - 轨迹线（端点与帧状态显示位置一致）与 sweep 进度钳制；
 * - 预设机位运镜（全貌侧向垂直影轴 + 特写在月球外侧）；HUD 恒真值行。
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { validateLunarEclipses, type LunarEclipseEventData } from '../bakedData';
import {
  EARTH_MEAN_RADIUS_KM,
  MOON_MEAN_RADIUS_KM,
} from '../solarEclipse';
import { EARTH_EQUATORIAL_RADIUS_KM, umbraConeLengthKm } from '../lunarEclipse';
import {
  SPACE_ART_RADIUS_FACTOR,
  SPACE_EARTH_RADIUS_UNITS,
  SPACE_STAR_DOME_RADIUS_UNITS,
  SPACE_UNITS_PER_KM,
  artBodyRadiusUnits,
  narrativeMoonPosKm,
  type MutableVec3,
  type ViewIntroPose,
} from '../solarEclipseSpace';
import { visualBodyRadius } from '../scale';
import { lunarTimelineWindow } from '../lunarEclipseLab';
import {
  CONE_PROFILE_START_KM,
  LUNAR_ART_RADIAL_FACTOR,
  LUNAR_CLOSEUP_MIN_STANDOFF_UNITS,
  LUNAR_OVERVIEW_END_RADIUS_UNITS,
  LUNAR_OVERVIEW_START_RADIUS_UNITS,
  LUNAR_REAL_RADIAL_MAGNIFY_FACTOR,
  LUNAR_SPACE_CAMERA_FAR_UNITS,
  LUNAR_SPACE_CAMERA_RADIUS_MAX_UNITS,
  LUNAR_SPACE_CAMERA_RADIUS_MIN_ART_UNITS,
  emptyLunarSpaceFrameState,
  lunarDisplayMoonPos,
  lunarDisplayRadiiUnits,
  lunarMoonCloseupPose,
  lunarRadialScaleForMode,
  lunarSpaceFrameState,
  lunarSpaceHudTruth,
  lunarSpaceOverviewPose,
  lunarSyzygyOffsetRad,
  moonTrajectoryPositions,
  shadowConeProfileUnits,
  trajectorySweep01,
} from '../lunarEclipseSpace';

const raw = JSON.parse(
  readFileSync(join(process.cwd(), 'public/data/lunar_eclipses.json'), 'utf8')
) as unknown;
const data = validateLunarEclipses(raw);
if (!data) throw new Error('真实产物未通过 validateLunarEclipses');
const events = new Map(data.events.map((e) => [e.id, e]));
const l2029 = events.get('l2029') as LunarEclipseEventData;
const l2027 = events.get('l2027') as LunarEclipseEventData;

const AU_KM = 1.496e8;

function emptyPose(): ViewIntroPose {
  return { pos: [0, 0, 0], fovDeg: 0 };
}

describe('径向因子（决策 ⑦⑧⑨；B12/B13 派生断言）', () => {
  it('艺术化因子 = visualBodyRadius(R⊕) × 层因子 / R⊕单位（派生勿硬编码）', () => {
    const derived =
      (visualBodyRadius(EARTH_MEAN_RADIUS_KM) * SPACE_ART_RADIUS_FACTOR) /
      SPACE_EARTH_RADIUS_UNITS;
    expect(LUNAR_ART_RADIAL_FACTOR).toBeCloseTo(derived, 12);
    expect(LUNAR_ART_RADIAL_FACTOR).toBeGreaterThan(14);
    expect(LUNAR_ART_RADIAL_FACTOR).toBeLessThan(15.5);
  });

  it('艺术化档地球 ~93、月球 ~25 单位；月球有意小于日食 L2 同源值 ~41（B13）', () => {
    const earth = SPACE_EARTH_RADIUS_UNITS * LUNAR_ART_RADIAL_FACTOR;
    const moon = MOON_MEAN_RADIUS_KM * SPACE_UNITS_PER_KM * LUNAR_ART_RADIAL_FACTOR;
    expect(earth).toBeGreaterThan(88);
    expect(earth).toBeLessThan(98);
    expect(moon).toBeGreaterThan(22);
    expect(moon).toBeLessThan(29);
    // 日食 A18 逐天体口径下的月球 ~41 单位——本条目统一因子有意更小
    expect(moon).toBeLessThan(artBodyRadiusUnits(MOON_MEAN_RADIUS_KM));
  });

  it('档位映射：真实 1 / 真实+开关 4 / 艺术化恒定且忽略开关', () => {
    expect(lunarRadialScaleForMode('real', false)).toBe(1);
    expect(lunarRadialScaleForMode('real', true)).toBe(LUNAR_REAL_RADIAL_MAGNIFY_FACTOR);
    expect(lunarRadialScaleForMode('art', false)).toBe(LUNAR_ART_RADIAL_FACTOR);
    expect(lunarRadialScaleForMode('art', true)).toBe(LUNAR_ART_RADIAL_FACTOR);
  });
});

describe('比例数字恒等（§8 红线新条目——最强机器防守）', () => {
  const state = lunarSpaceFrameState(l2029.geo, l2029.contacts.max, null, false);
  const truthUmbraPerMoon =
    state.umbraRadiusAtMoonUnits / (MOON_MEAN_RADIUS_KM * SPACE_UNITS_PER_KM);
  const truthUmbraPerEarth = state.umbraRadiusAtMoonUnits / SPACE_EARTH_RADIUS_UNITS;

  const combos: Array<['real' | 'art', boolean]> = [
    ['real', false],
    ['real', true],
    ['art', false],
    ['art', true],
  ];

  it.each(combos)('%s 档（开关 %s）：本影/月径与本影/R⊕ 比值恒等于真值', (mode, mag) => {
    const r = lunarDisplayRadiiUnits(state, mode, mag);
    expect(r.umbraUnits / r.moonUnits).toBeCloseTo(truthUmbraPerMoon, 10);
    expect(r.umbraUnits / r.earthUnits).toBeCloseTo(truthUmbraPerEarth, 10);
    // 半影/本影比同样恒等（4.7/2.6 月径口径的机器侧）
    expect(r.penumbraUnits / r.umbraUnits).toBeCloseTo(
      state.penumbraRadiusAtMoonUnits / state.umbraRadiusAtMoonUnits,
      10
    );
  });

  it('教学锚点：本影 ≈ 2.6 月径（半径比 ~2.65）、≈0.72 R⊕（§1.1）', () => {
    expect(truthUmbraPerMoon).toBeGreaterThan(2.4);
    expect(truthUmbraPerMoon).toBeLessThan(2.9);
    expect(truthUmbraPerEarth).toBeGreaterThan(0.66);
    expect(truthUmbraPerEarth).toBeLessThan(0.78);
  });
});

describe('相机域（far ≥ 相机最大半径 + 星穹壳——日食 P5 同款结构性回归）', () => {
  it('far 约束（月食锥全貌机位重算后仍成立）', () => {
    expect(
      LUNAR_SPACE_CAMERA_RADIUS_MAX_UNITS + SPACE_STAR_DOME_RADIUS_UNITS
    ).toBeLessThanOrEqual(LUNAR_SPACE_CAMERA_FAR_UNITS);
  });

  it('全貌机位半径在相机域内且 ≥2,000（锥长 1,400 单位重定口径）', () => {
    expect(LUNAR_OVERVIEW_END_RADIUS_UNITS).toBeGreaterThanOrEqual(2000);
    expect(LUNAR_OVERVIEW_END_RADIUS_UNITS).toBeLessThanOrEqual(
      LUNAR_SPACE_CAMERA_RADIUS_MAX_UNITS
    );
    expect(LUNAR_OVERVIEW_START_RADIUS_UNITS).toBeLessThanOrEqual(
      LUNAR_SPACE_CAMERA_RADIUS_MAX_UNITS
    );
  });

  it('艺术化档最小半径 > 艺术化地球半径（机位不入球）', () => {
    expect(LUNAR_SPACE_CAMERA_RADIUS_MIN_ART_UNITS).toBeGreaterThan(
      SPACE_EARTH_RADIUS_UNITS * LUNAR_ART_RADIAL_FACTOR
    );
  });
});

describe('shadowConeProfileUnits（C1 半径函数逐距离驱动锥形，§M4-2）', () => {
  const sunDistKm = AU_KM;
  const umbra = shadowConeProfileUnits('umbra', sunDistKm);
  const pen = shadowConeProfileUnits('penumbra', sunDistKm);

  it('本影收敛锥：半径严格递减且锥长处闭合为 0；锥长 ∈ [135, 145] 万 km', () => {
    for (let i = 1; i * 2 + 1 < umbra.length; i += 1) {
      expect(umbra[i * 2 + 1]).toBeLessThan(umbra[(i - 1) * 2 + 1]);
    }
    expect(umbra[umbra.length - 1]).toBeCloseTo(0, 6);
    const lenKm = umbra[umbra.length - 2] / SPACE_UNITS_PER_KM;
    expect(lenKm).toBeGreaterThan(1.35e6);
    expect(lenKm).toBeLessThan(1.45e6);
  });

  it('半影外扩锥：半径严格递增（顶点在向日侧——两锥顶点异侧）', () => {
    for (let i = 1; i * 2 + 1 < pen.length; i += 1) {
      expect(pen[i * 2 + 1]).toBeGreaterThan(pen[(i - 1) * 2 + 1]);
    }
    // 首两站线性外推的零点在向日侧（d < 0）：与本影顶点（背日 +锥长处）异侧
    const d0 = pen[0];
    const r0 = pen[1];
    const d1 = pen[2];
    const r1 = pen[3];
    const slope = (r1 - r0) / (d1 - d0);
    const apexD = d0 - r0 / slope;
    expect(apexD).toBeLessThan(0);
  });

  it('月距站锚点：本影 ≈ 0.72 R⊕、半影 ≈ 1.28 R⊕（±5% 容差）', () => {
    const at = (profile: Float64Array, dUnits: number): number => {
      for (let i = 1; i * 2 < profile.length; i += 1) {
        const dA = profile[(i - 1) * 2];
        const dB = profile[i * 2];
        if (dUnits >= dA && dUnits <= dB) {
          const t = (dUnits - dA) / (dB - dA);
          return profile[(i - 1) * 2 + 1] * (1 - t) + profile[i * 2 + 1] * t;
        }
      }
      throw new Error('站外');
    };
    const dMoon = 384400 * SPACE_UNITS_PER_KM;
    const rU = at(umbra, dMoon) / SPACE_UNITS_PER_KM;
    const rP = at(pen, dMoon) / SPACE_UNITS_PER_KM;
    expect(rU / EARTH_EQUATORIAL_RADIUS_KM).toBeGreaterThan(0.685);
    expect(rU / EARTH_EQUATORIAL_RADIUS_KM).toBeLessThan(0.755);
    expect(rP / EARTH_EQUATORIAL_RADIUS_KM).toBeGreaterThan(1.22);
    expect(rP / EARTH_EQUATORIAL_RADIUS_KM).toBeLessThan(1.34);
  });

  it('剖面起点贴地（首站藏于地球内侧近旁）；非法站数/终点抛错', () => {
    expect(umbra[0]).toBeCloseTo(CONE_PROFILE_START_KM * SPACE_UNITS_PER_KM, 9);
    expect(() => shadowConeProfileUnits('umbra', AU_KM, undefined, 1)).toThrow(RangeError);
    expect(() => shadowConeProfileUnits('penumbra', AU_KM, 100)).toThrow(RangeError);
  });
});

describe('lunarSpaceFrameState（l2029 真实星历锚点）', () => {
  const state = lunarSpaceFrameState(l2029.geo, l2029.contacts.max, null, false);

  it('影轴 = 反日向单位向量；食甚食型 total（目录口径）', () => {
    for (let i = 0; i < 3; i += 1) {
      expect(state.shadowAxisScene[i]).toBeCloseTo(-state.sunDirScene[i], 12);
    }
    expect(state.kind).toBe('total');
    expect(state.umbralMag).toBeGreaterThan(1);
    expect(state.sectionExists).toBe(true);
  });

  it('轴向/横向分解正交且复合恢复原位置（望态月球在背日侧 ~384 单位）', () => {
    const ax = state.shadowAxisScene;
    const perpDot =
      state.moonPerpScene[0] * ax[0] +
      state.moonPerpScene[1] * ax[1] +
      state.moonPerpScene[2] * ax[2];
    expect(Math.abs(perpDot)).toBeLessThan(1e-9);
    expect(state.moonAxialUnits).toBeGreaterThan(350);
    expect(state.moonAxialUnits).toBeLessThan(410);
    for (let i = 0; i < 3; i += 1) {
      expect(ax[i] * state.moonAxialUnits + state.moonPerpScene[i]).toBeCloseTo(
        state.moonPosScene[i],
        9
      );
    }
  });

  it('锥长真值 ≈1,400 单位（轴向真比例卖点）；锥长/月距 ≈ 3.6–3.8', () => {
    expect(state.umbraConeLengthUnits).toBeGreaterThan(1350);
    expect(state.umbraConeLengthUnits).toBeLessThan(1450);
    const hud = lunarSpaceHudTruth(state);
    expect(hud.coneLenPerMoonDist).toBeGreaterThan(3.4);
    expect(hud.coneLenPerMoonDist).toBeLessThan(3.9);
    expect(hud.coneLengthKm).toBeCloseTo(umbraConeLengthKm(state.sunDistKm), 6);
    expect(hud.umbraPerMoonDiam).toBeGreaterThan(2.4);
    expect(hud.umbraPerEarthRadius).toBeLessThan(0.78);
  });

  it('显示位置各向异性（B12）：轴向分量保持真值、横向分量 × 因子', () => {
    const pos1: MutableVec3 = [0, 0, 0];
    const pos4: MutableVec3 = [0, 0, 0];
    lunarDisplayMoonPos(state, 1, pos1);
    lunarDisplayMoonPos(state, 4, pos4);
    const ax = state.shadowAxisScene;
    const axial1 = pos1[0] * ax[0] + pos1[1] * ax[1] + pos1[2] * ax[2];
    const axial4 = pos4[0] * ax[0] + pos4[1] * ax[1] + pos4[2] * ax[2];
    expect(axial1).toBeCloseTo(state.moonAxialUnits, 9);
    expect(axial4).toBeCloseTo(state.moonAxialUnits, 9);
    const perpLen = (p: MutableVec3, axial: number): number =>
      Math.hypot(p[0] - ax[0] * axial, p[1] - ax[1] * axial, p[2] - ax[2] * axial);
    expect(perpLen(pos4, axial4)).toBeCloseTo(perpLen(pos1, axial1) * 4, 9);
    expect(() => lunarDisplayMoonPos(state, 0, pos1)).toThrow(RangeError);
  });

  it('半影食事件（l2027）食甚：kind = penumbral、本影食分 < 0', () => {
    const s = lunarSpaceFrameState(l2027.geo, l2027.contacts.max, null, false);
    expect(s.kind).toBe('penumbral');
    expect(s.umbralMag).toBeLessThan(0);
    expect(s.penumbralMag).toBeGreaterThan(0);
  });
});

describe('望态参数组装（§M4-5 契约 C7；B4）', () => {
  it('档位映射：望 = π、朔 = 0', () => {
    expect(lunarSyzygyOffsetRad('full')).toBeCloseTo(Math.PI, 12);
    expect(lunarSyzygyOffsetRad('new')).toBe(0);
  });

  it('望态月位 = 朔态反向（narrativeMoonPosKm 契约 C7 参数化）', () => {
    const full: MutableVec3 = [0, 0, 0];
    const nw: MutableVec3 = [0, 0, 0];
    narrativeMoonPosKm(0.7, 0.3, 0.35, 384400, full, lunarSyzygyOffsetRad('full'));
    narrativeMoonPosKm(0.7, 0.3, 0.35, 384400, nw, lunarSyzygyOffsetRad('new'));
    for (let i = 0; i < 3; i += 1) expect(full[i]).toBeCloseTo(-nw[i], 6);
  });

  it('朔态月影锥段：本影锥自月球指向反日向延伸、锥尖在月球背日侧（方向反转可视侧）', () => {
    // 构造朔态月位：沿太阳方向 38.44 万 km
    const row = l2029.geo.rows[Math.floor(l2029.geo.rows.length / 2)];
    const sunLen = Math.hypot(row[0], row[1], row[2]);
    const moonNew: [number, number, number] = [
      (row[0] / sunLen) * 384400,
      (row[1] / sunLen) * 384400,
      (row[2] / sunLen) * 384400,
    ];
    const t = l2029.geo.t0 + (Math.floor(l2029.geo.rows.length / 2) - 1) * l2029.geo.dtSec;
    const s = lunarSpaceFrameState(l2029.geo, t, moonNew, true);
    expect(s.moonShadowActive).toBe(true);
    // 月影本影锥尖（apex）应在月球的背日侧（比月球更靠近地球的方向）：
    // tip 到地心距离 < 月球到地心距离
    const tipLen = Math.hypot(s.msUmbraTipScene[0], s.msUmbraTipScene[1], s.msUmbraTipScene[2]);
    const moonLen = Math.hypot(s.moonPosScene[0], s.moonPosScene[1], s.moonPosScene[2]);
    expect(tipLen).toBeLessThan(moonLen);
    // 锥体自尖端指回月球方向（dir 与（月球 − 尖端）同向）
    const toMoon = [
      s.moonPosScene[0] - s.msUmbraTipScene[0],
      s.moonPosScene[1] - s.msUmbraTipScene[1],
      s.moonPosScene[2] - s.msUmbraTipScene[2],
    ];
    const dot =
      toMoon[0] * s.msUmbraDirScene[0] +
      toMoon[1] * s.msUmbraDirScene[1] +
      toMoon[2] * s.msUmbraDirScene[2];
    expect(dot).toBeGreaterThan(0);
    expect(s.msUmbraLenUnits).toBeGreaterThan(0);
    expect(s.msPenLenUnits).toBeGreaterThan(s.msUmbraLenUnits * 0);
    // 关闭时段字段不参与（active=false）
    const off = lunarSpaceFrameState(l2029.geo, t, moonNew, false);
    expect(off.moonShadowActive).toBe(false);
  });
});

describe('轨迹线与 sweep（§M4-2）', () => {
  const win = lunarTimelineWindow(l2029.contacts);

  it('端点与帧状态显示位置一致（径向因子 ×4 同口径）', () => {
    const traj = moonTrajectoryPositions(l2029.geo, win, 4, 8);
    expect(traj.length).toBe(8 * 3);
    const s = lunarSpaceFrameState(l2029.geo, win.startSec, null, false);
    const pos: MutableVec3 = [0, 0, 0];
    lunarDisplayMoonPos(s, 4, pos);
    expect(traj[0]).toBeCloseTo(pos[0], 3);
    expect(traj[1]).toBeCloseTo(pos[1], 3);
    expect(traj[2]).toBeCloseTo(pos[2], 3);
  });

  it('sweep 进度钳制端点；非法入参抛错', () => {
    expect(trajectorySweep01(win.startSec - 999, win)).toBe(0);
    expect(trajectorySweep01(win.endSec + 999, win)).toBe(1);
    const mid = (win.startSec + win.endSec) / 2;
    expect(trajectorySweep01(mid, win)).toBeCloseTo(0.5, 9);
    expect(() => trajectorySweep01(Number.NaN, win)).toThrow(RangeError);
    expect(() =>
      moonTrajectoryPositions(l2029.geo, { startSec: 10, endSec: 5 }, 1)
    ).toThrow(RangeError);
    expect(() => moonTrajectoryPositions(l2029.geo, win, 1, 1)).toThrow(RangeError);
  });
});

describe('预设机位运镜（§M4-2 全貌/月球特写）', () => {
  const state = lunarSpaceFrameState(l2029.geo, l2029.contacts.max, null, false);

  it('全貌终点：半径 = 端值、方向垂直影轴（侧看锥全貌）、含抬升分量', () => {
    const pose = lunarSpaceOverviewPose(state.shadowAxisScene, 1, emptyPose());
    const r = Math.hypot(pose.pos[0], pose.pos[1], pose.pos[2]);
    expect(r).toBeCloseTo(LUNAR_OVERVIEW_END_RADIUS_UNITS, 6);
    const ax = state.shadowAxisScene;
    const dot =
      (pose.pos[0] * ax[0] + pose.pos[1] * ax[1] + pose.pos[2] * ax[2]) / r;
    expect(Math.abs(dot)).toBeLessThan(0.3);
    expect(pose.pos[1]).toBeGreaterThan(0);
    // t=0 起点半径
    const start = lunarSpaceOverviewPose(state.shadowAxisScene, 0, emptyPose());
    expect(Math.hypot(start.pos[0], start.pos[1], start.pos[2])).toBeCloseTo(
      LUNAR_OVERVIEW_START_RADIUS_UNITS,
      6
    );
  });

  it('特写终点：在月球外侧回望地心（半径 > 月距）；非法半径抛错', () => {
    const moonPos: MutableVec3 = [0, 0, 0];
    lunarDisplayMoonPos(state, LUNAR_ART_RADIAL_FACTOR, moonPos);
    const moonR = MOON_MEAN_RADIUS_KM * SPACE_UNITS_PER_KM * LUNAR_ART_RADIAL_FACTOR;
    const pose = lunarMoonCloseupPose(moonPos, moonR, 1, emptyPose());
    const moonLen = Math.hypot(moonPos[0], moonPos[1], moonPos[2]);
    const poseLen = Math.hypot(pose.pos[0], pose.pos[1], pose.pos[2]);
    expect(poseLen).toBeGreaterThan(moonLen + LUNAR_CLOSEUP_MIN_STANDOFF_UNITS * 0.5);
    expect(() => lunarMoonCloseupPose(moonPos, 0, 1, emptyPose())).toThrow(RangeError);
    expect(() => lunarMoonCloseupPose([0, 0, 0], moonR, 1, emptyPose())).toThrow(RangeError);
  });
});

describe('emptyLunarSpaceFrameState（挂载期分配）', () => {
  it('初值健全（无食哨兵 + 单位轴）', () => {
    const s = emptyLunarSpaceFrameState();
    expect(s.kind).toBe('none');
    expect(s.moonShadowActive).toBe(false);
    expect(Math.hypot(...s.shadowAxisScene)).toBeCloseTo(1, 12);
  });
});
