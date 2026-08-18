/**
 * E-M4 太空视角纯逻辑单测（§M4 / 契约 C4 / C7 / §1.2 / §2.2 / §4.4）：
 * J2000→场景轴映射（+Z 北天极 → +Y、右手系保持）、大地经纬↔地表局部/场景
 * 向量、GMST 自转自洽（足印中心 ↔ 观测点经纬锚点）、空间帧状态（真锥双层
 * 渲染段 + 足印场景量 + 假想模式伪本影分支）、本影地面速度（>1,700 km/h
 * 验收锚点）、食带折线与扫掠进度、倾角叙事轨道基（正交/倾角/交点命中与
 * 掠过——A5 + 契约 C7 朔望参数化）、视角切换运镜姿态端点。
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { validateSolarEclipses, type SolarEclipsesData } from '@/utils/bakedData';
import { LAB_FOV_DEFAULT_DEG, LAB_FOV_MAX_DEG } from '@/utils/labGestures';
import { EARTH_MEAN_RADIUS_KM, MOON_MEAN_RADIUS_KM } from '@/utils/solarEclipse';
import {
  ANTUMBRA_DARKEN_DEPTH,
  GROUND_INTRO_ALT_OFFSET_DEG,
  GROUND_INTRO_FOV_END_DEG,
  GROUND_INTRO_FOV_START_DEG,
  INCLINATION_DISPLAY_FACTOR,
  MOON_ORBIT_INCLINATION_DEG,
  NARRATIVE_NODE_CYCLE_ORBITS,
  NARRATIVE_ORBIT_RADIUS_KM,
  NARRATIVE_PHASE_PERIOD_SEC,
  PENUMBRA_DARKEN_DEPTH,
  SHADOW_EDGE_SOFT_INNER,
  SHADOW_EDGE_SOFT_OUTER,
  SPACE_EARTH_RADIUS_UNITS,
  SPACE_INTRO_END_RADIUS_UNITS,
  SPACE_INTRO_START_RADIUS_UNITS,
  SPACE_SUN_DISK_DISTANCE_UNITS,
  SPACE_SUN_DISK_RADIUS_UNITS,
  SPACE_UNITS_PER_KM,
  UMBRA_DARKEN_DEPTH,
  UMBRA_MAGNIFY_FACTOR,
  buildPathLocalUnits,
  earthGroupSceneMatrix3,
  emptyEclipseSpaceFrameState,
  geocentricToGeodeticLatDeg,
  geodeticToEarthLocalUnit,
  geodeticToGeocentricLatDeg,
  geodeticToSceneUnit,
  groundIntroAim,
  j2000KmToEcef,
  j2000KmToGeodetic,
  j2000ToSceneVec,
  narrativeAngles,
  narrativeMoonPosKm,
  narrativeOrbitBasis,
  pathSweepProgress01,
  precessionAnglesRad,
  spaceFrameState,
  spaceIntroPose,
  umbraGroundSpeedKmh,
  type MutableVec3,
} from '@/utils/solarEclipseSpace';

const DEG = Math.PI / 180;

const eclipses = validateSolarEclipses(
  JSON.parse(readFileSync(join(process.cwd(), 'public/data/solar_eclipses.json'), 'utf8'))
) as SolarEclipsesData;

const e2027 = eclipses.events[0];

// ---------------------------------------------------------------------------
// 契约 C4：J2000 → 场景轴映射
// ---------------------------------------------------------------------------

describe('j2000ToSceneVec（契约 C4：+Z 北天极 → 场景 +Y）', () => {
  it('北天极映射到场景 +Y', () => {
    const out: MutableVec3 = [0, 0, 0];
    j2000ToSceneVec([0, 0, 1], out);
    expect(out[0]).toBe(0);
    expect(out[1]).toBe(1);
    expect(Math.abs(out[2])).toBe(0);
  });

  it('春分点 +X 保持 +X；+Y 映射到 −Z（右手系保持：x̂×ŷ=ẑ 映射后仍成立）', () => {
    const out: MutableVec3 = [0, 0, 0];
    j2000ToSceneVec([1, 0, 0], out);
    expect(out[0]).toBe(1);
    expect(out[1]).toBe(0);
    expect(Math.abs(out[2])).toBe(0);
    j2000ToSceneVec([0, 1, 0], out);
    expect(out[0]).toBe(0);
    expect(out[1]).toBe(0);
    expect(out[2]).toBe(-1);
    // 右手系验证：scene(x̂)=(1,0,0)、scene(ŷ)=(0,0,−1)，叉积 = (0,1,0) = scene(ẑ) ✓
    const sx = [1, 0, 0];
    const sy = [0, 0, -1];
    const cross = [
      sx[1] * sy[2] - sx[2] * sy[1],
      sx[2] * sy[0] - sx[0] * sy[2],
      sx[0] * sy[1] - sx[1] * sy[0],
    ];
    expect(cross[0]).toBeCloseTo(0, 12);
    expect(cross[1]).toBeCloseTo(1, 12);
    expect(cross[2]).toBeCloseTo(0, 12);
  });

  it('保长度（纯旋转）', () => {
    const out: MutableVec3 = [0, 0, 0];
    j2000ToSceneVec([3, 4, 12], out);
    expect(Math.hypot(...out)).toBeCloseTo(13, 12);
  });

  it('非有限分量抛错', () => {
    const out: MutableVec3 = [0, 0, 0];
    expect(() => j2000ToSceneVec([NaN, 0, 0], out)).toThrow(RangeError);
  });
});

describe('geodeticToEarthLocalUnit（贴图经纬网映射）', () => {
  it('北极 → +Y；(0°,0°) → +X；90°E → −Z（等距圆柱贴图展开约定）', () => {
    const out: MutableVec3 = [0, 0, 0];
    geodeticToEarthLocalUnit(90, 0, out);
    expect(out[1]).toBeCloseTo(1, 12);
    geodeticToEarthLocalUnit(0, 0, out);
    expect(out).toEqual([1, 0, -0]);
    geodeticToEarthLocalUnit(0, 90, out);
    expect(out[0]).toBeCloseTo(0, 12);
    expect(out[2]).toBeCloseTo(-1, 12);
  });

  it('纬度越界/非有限经度抛错', () => {
    const out: MutableVec3 = [0, 0, 0];
    expect(() => geodeticToEarthLocalUnit(91, 0, out)).toThrow(RangeError);
    expect(() => geodeticToEarthLocalUnit(0, NaN, out)).toThrow(RangeError);
  });
});

describe('地球指向链（岁差 + GMST + 纬度换算）', () => {
  it('geodeticToSceneUnit ↔ j2000KmToGeodetic 互逆（往返 <1e-6°）', () => {
    const t = e2027.contacts.max;
    const v: MutableVec3 = [0, 0, 0];
    geodeticToSceneUnit(26.8, 31.1, t, v);
    // 场景 → J2000：逆映射 (x, y, z)scene → (x, −z, y)J2000
    const j2000: MutableVec3 = [v[0] * 6371, -v[2] * 6371, v[1] * 6371];
    const ll = { latDeg: 0, lonDeg: 0 };
    j2000KmToGeodetic(j2000, t, ll);
    expect(ll.latDeg).toBeCloseTo(26.8, 6);
    expect(ll.lonDeg).toBeCloseTo(31.1, 6);
  });

  it('IAU1976 岁差角：2027 历元 ζ+z ≈ 0.353°、J2000 历元 ≈ 0', () => {
    const a = precessionAnglesRad(e2027.contacts.max);
    expect(((a.zetaRad + a.zRad) / DEG)).toBeCloseTo(0.353, 2);
    const j2000 = precessionAnglesRad(946727935.816);
    expect(Math.abs(j2000.zetaRad)).toBeLessThan(1e-6);
    expect(() => precessionAnglesRad(NaN)).toThrow(RangeError);
  });

  it('大地 ↔ 地心纬度：45° 处差 ≈ 0.19°、往返互逆、极点/赤道不变', () => {
    const geocentric = geodeticToGeocentricLatDeg(45);
    expect(45 - geocentric).toBeCloseTo(0.1924, 3);
    expect(geocentricToGeodeticLatDeg(geocentric)).toBeCloseTo(45, 10);
    expect(geodeticToGeocentricLatDeg(90)).toBe(90);
    expect(geodeticToGeocentricLatDeg(0)).toBe(0);
    expect(() => geodeticToGeocentricLatDeg(91)).toThrow(RangeError);
    expect(() => geocentricToGeodeticLatDeg(-91)).toThrow(RangeError);
  });

  it('地球姿态矩阵正交（列单位、两两垂直）；恒星日周期回归', () => {
    const t = e2027.contacts.c1;
    const m = earthGroupSceneMatrix3(t, new Array<number>(9).fill(0));
    const col = (i: number): number[] => [m[i], m[3 + i], m[6 + i]];
    for (let i = 0; i < 3; i += 1) {
      expect(Math.hypot(...col(i))).toBeCloseTo(1, 10);
    }
    const dot01 = col(0).reduce((s, v, k) => s + v * col(1)[k], 0);
    expect(dot01).toBeCloseTo(0, 10);
    // 1 恒星日后姿态近似回归（岁差日内漂移 ≪1e-4）
    const m2 = earthGroupSceneMatrix3(t + 86164.0905, new Array<number>(9).fill(0));
    for (let i = 0; i < 9; i += 1) {
      expect(Math.abs(m2[i] - m[i])).toBeLessThan(1e-3);
    }
    expect(() => earthGroupSceneMatrix3(t, new Array<number>(4).fill(0))).toThrow(RangeError);
  });

  it('j2000KmToEcef 保长度（纯旋转链）；零向量经纬抛错', () => {
    const v: MutableVec3 = [0, 0, 0];
    j2000KmToEcef([3000, 4000, 5000], e2027.contacts.max, v);
    expect(Math.hypot(...v)).toBeCloseTo(Math.hypot(3000, 4000, 5000), 6);
    expect(() => j2000KmToGeodetic([0, 0, 0], 0, { latDeg: 0, lonDeg: 0 })).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// 空间帧状态（§M4-1/M4-2；真锥 + 足印 + 假想伪本影分支）
// ---------------------------------------------------------------------------

describe('spaceFrameState（geo 星历驱动）', () => {
  const out = emptyEclipseSpaceFrameState();

  it('契约 C4 比例：地球 6.371 单位；月球场景距离 = 月距 km / 1000', () => {
    expect(SPACE_EARTH_RADIUS_UNITS).toBeCloseTo(6.371, 6);
    spaceFrameState(e2027.geo, e2027.contacts.max, null, null, out);
    const d = Math.hypot(...out.moonPosScene);
    expect(d).toBeCloseTo(out.moonDistKm * SPACE_UNITS_PER_KM, 6);
    expect(out.moonDistKm).toBeGreaterThan(350000);
    expect(out.moonDistKm).toBeLessThan(410000);
  });

  it('2027 食甚：真本影足印存在、短轴 ∈ [240, 275] km（§1.2 收紧锚点）', () => {
    spaceFrameState(e2027.geo, e2027.contacts.max, null, null, out);
    expect(out.footExists).toBe(true);
    expect(out.footIsAntumbra).toBe(false);
    expect(out.footMinorKm).toBeGreaterThanOrEqual(240);
    expect(out.footMinorKm).toBeLessThanOrEqual(275);
    expect(out.footMajorKm).toBeGreaterThanOrEqual(out.footMinorKm);
    // 足印中心落在地球表面（场景半径 ≈ 6.371）
    expect(Math.hypot(...out.footCenterScene)).toBeCloseTo(SPACE_EARTH_RADIUS_UNITS, 3);
  });

  it('足印中心 ≈ 食甚观测点（三事件地理配准；岁差 + 光行时 + 纬度换算全链防守）', () => {
    // 地面距离容差 25 km：2027 实测 ~2.6 km（链路精度基准）；1919 Sobral
    // 本就偏中心线 ~18 km（§0.1 登记）、2035 站点取自路径表整分时刻点
    // （站点食甚与 contacts.max 相差 ~16s 的沿迹偏移）——均为站点选取
    // 事实而非配准链误差
    const ll = { latDeg: 0, lonDeg: 0 };
    for (const ev of eclipses.events) {
      spaceFrameState(ev.geo, ev.contacts.max, null, null, out);
      expect(out.footExists).toBe(true);
      j2000KmToGeodetic(out.footCenterKmJ2000, ev.contacts.max, ll);
      const dLatKm = (ll.latDeg - ev.observer.latDeg) * 111.2;
      const dLonKm =
        (ll.lonDeg - ev.observer.lonDeg) * 111.2 * Math.cos(ev.observer.latDeg * DEG);
      expect(Math.hypot(dLatKm, dLonKm)).toBeLessThan(25);
    }
    // 2027（链路精度基准事件）单独收紧到 5 km
    spaceFrameState(e2027.geo, e2027.contacts.max, null, null, out);
    j2000KmToGeodetic(out.footCenterKmJ2000, e2027.contacts.max, ll);
    expect(
      Math.hypot(
        (ll.latDeg - e2027.observer.latDeg) * 111.2,
        (ll.lonDeg - e2027.observer.lonDeg) * 111.2 * Math.cos(e2027.observer.latDeg * DEG)
      )
    ).toBeLessThan(5);
  });

  it('场景空间自洽：足印中心方向 ≈ geodeticToSceneUnit(观测点)（<0.1°）', () => {
    spaceFrameState(e2027.geo, e2027.contacts.max, null, null, out);
    const v: MutableVec3 = [0, 0, 0];
    geodeticToSceneUnit(e2027.observer.latDeg, e2027.observer.lonDeg, e2027.contacts.max, v);
    const r = Math.hypot(...out.footCenterScene);
    const dot =
      (out.footCenterScene[0] * v[0] +
        out.footCenterScene[1] * v[1] +
        out.footCenterScene[2] * v[2]) /
      r;
    expect(Math.acos(Math.min(1, dot)) / DEG).toBeLessThan(0.1);
  });

  it('本影渲染段：底半径 ≈ 月球半径、底端落在月球位置（外公切锥自洽）', () => {
    spaceFrameState(e2027.geo, e2027.contacts.max, null, null, out);
    expect(out.umbraBaseRadiusUnits / SPACE_UNITS_PER_KM).toBeCloseTo(MOON_MEAN_RADIUS_KM, -1);
    const base: MutableVec3 = [
      out.umbraTipScene[0] + out.umbraDirScene[0] * out.umbraLenUnits,
      out.umbraTipScene[1] + out.umbraDirScene[1] * out.umbraLenUnits,
      out.umbraTipScene[2] + out.umbraDirScene[2] * out.umbraLenUnits,
    ];
    expect(base[0]).toBeCloseTo(out.moonPosScene[0], 3);
    expect(base[1]).toBeCloseTo(out.moonPosScene[1], 3);
    expect(base[2]).toBeCloseTo(out.moonPosScene[2], 3);
    // 本影锥长锚点（§1.2：36 万–38.5 万 km）
    const lenKm = out.umbraLenUnits / SPACE_UNITS_PER_KM;
    expect(lenKm).toBeGreaterThanOrEqual(360000);
    expect(lenKm).toBeLessThanOrEqual(385000);
  });

  it('半影渲染段越过地球（长度 > 月距 + 地球半径）且半角 > 本影半角', () => {
    spaceFrameState(e2027.geo, e2027.contacts.max, null, null, out);
    expect(out.penLenUnits / SPACE_UNITS_PER_KM).toBeGreaterThan(
      out.moonDistKm + EARTH_MEAN_RADIUS_KM
    );
    expect(out.penTan).toBeGreaterThan(out.umbraTan);
    // 影轴为单位向量、背日向（与太阳方向近似反向）
    expect(Math.hypot(...out.shadowAxisScene)).toBeCloseTo(1, 9);
    const dotSun =
      out.shadowAxisScene[0] * out.sunDirScene[0] +
      out.shadowAxisScene[1] * out.sunDirScene[1] +
      out.shadowAxisScene[2] * out.sunDirScene[2];
    expect(dotSun).toBeLessThan(-0.99);
  });

  it('假想远地点（405,696 km）：锥尖不及地面 → 伪本影分支（§3.3 验收）', () => {
    spaceFrameState(e2027.geo, e2027.contacts.max, 405696, null, out);
    expect(out.moonDistKm).toBe(405696);
    expect(out.footExists).toBe(true);
    expect(out.footIsAntumbra).toBe(true);
    // 锥尖高于地面：锥尖场景距离 > 地球半径
    expect(Math.hypot(...out.umbraTipScene)).toBeGreaterThan(SPACE_EARTH_RADIUS_UNITS);
  });

  it('非法月距改写抛错', () => {
    expect(() => spaceFrameState(e2027.geo, e2027.contacts.max, -1, null, out)).toThrow(
      RangeError
    );
  });

  it('shader 影斑常量域合法（0.92/1.12 软化口径 + 压暗深度分层）', () => {
    expect(SHADOW_EDGE_SOFT_INNER).toBeLessThan(1);
    expect(SHADOW_EDGE_SOFT_OUTER).toBeGreaterThan(1);
    expect(UMBRA_DARKEN_DEPTH).toBeGreaterThan(ANTUMBRA_DARKEN_DEPTH);
    expect(ANTUMBRA_DARKEN_DEPTH).toBeGreaterThan(PENUMBRA_DARKEN_DEPTH);
    expect(UMBRA_MAGNIFY_FACTOR).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------
// 本影地面速度（§1.2：>1,700 km/h 自西向东——M4-CP 量化锚点）
// ---------------------------------------------------------------------------

describe('umbraGroundSpeedKmh', () => {
  it('2027 食甚地面速度 ∈ (1700, 5000) km/h', () => {
    const v = umbraGroundSpeedKmh(e2027.geo, e2027.contacts.max);
    expect(v).not.toBeNull();
    expect(v as number).toBeGreaterThan(1700);
    expect(v as number).toBeLessThan(5000);
  });

  it('足印扫掠方向自西向东（经度随时间递增）', () => {
    const scratch = emptyEclipseSpaceFrameState();
    const ll = { latDeg: 0, lonDeg: 0 };
    spaceFrameState(e2027.geo, e2027.contacts.max - 300, null, null, scratch);
    j2000KmToGeodetic(scratch.footCenterKmJ2000, e2027.contacts.max - 300, ll);
    const lonBefore = ll.lonDeg;
    spaceFrameState(e2027.geo, e2027.contacts.max + 300, null, null, scratch);
    j2000KmToGeodetic(scratch.footCenterKmJ2000, e2027.contacts.max + 300, ll);
    expect(ll.lonDeg).toBeGreaterThan(lonBefore);
  });

  it('窗外（影锥掠过地球外）返回 null', () => {
    // 时间窗端点：geo ±6h 覆盖，但 C4+15min 之后影轴已离开地球盘面较远——
    // 取 geo 序列末端（食甚 +6h）必然无足印
    const tEnd = e2027.geo.t0 + (e2027.geo.rows.length - 1) * e2027.geo.dtSec;
    expect(umbraGroundSpeedKmh(e2027.geo, tEnd)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 食带中心线折线 + 扫掠进度（§4.4）
// ---------------------------------------------------------------------------

describe('buildPathLocalUnits / pathSweepProgress01', () => {
  it('折线顶点均为单位向量，数量 = path 长度', () => {
    const units = buildPathLocalUnits(e2027.path);
    expect(units.length).toBe(e2027.path.length * 3);
    for (let i = 0; i < e2027.path.length; i += 1) {
      expect(
        Math.hypot(units[i * 3], units[i * 3 + 1], units[i * 3 + 2])
      ).toBeCloseTo(1, 6);
    }
  });

  it('扫掠进度：首点 0、末点 1、观测点（食甚中心线上）居中段', () => {
    const units = buildPathLocalUnits(e2027.path);
    expect(pathSweepProgress01(units, e2027.path[0][0], e2027.path[0][1])).toBe(0);
    const last = e2027.path[e2027.path.length - 1];
    expect(pathSweepProgress01(units, last[0], last[1])).toBe(1);
    const mid = pathSweepProgress01(units, e2027.observer.latDeg, e2027.observer.lonDeg);
    expect(mid).toBeGreaterThan(0.1);
    expect(mid).toBeLessThan(0.9);
  });

  it('足印中心随时间沿折线单调推进（已扫过段变色的驱动前提）', () => {
    const units = buildPathLocalUnits(e2027.path);
    const scratch = emptyEclipseSpaceFrameState();
    const ll = { latDeg: 0, lonDeg: 0 };
    const progressAt = (t: number): number => {
      spaceFrameState(e2027.geo, t, null, null, scratch);
      j2000KmToGeodetic(scratch.footCenterKmJ2000, t, ll);
      return pathSweepProgress01(units, ll.latDeg, ll.lonDeg);
    };
    const p1 = progressAt(e2027.contacts.max - 1800);
    const p2 = progressAt(e2027.contacts.max);
    const p3 = progressAt(e2027.contacts.max + 1800);
    expect(p1).toBeLessThan(p2);
    expect(p2).toBeLessThan(p3);
  });

  it('非法输入抛错', () => {
    expect(() => buildPathLocalUnits([[0, 0, 0]])).toThrow(RangeError);
    expect(() => pathSweepProgress01(new Float32Array(3), 0, 0)).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// 倾角叙事模式（§M4-4；A5 + 契约 C7 朔望参数化）
// ---------------------------------------------------------------------------

describe('倾角叙事（narrativeAngles / narrativeOrbitBasis / narrativeMoonPosKm）', () => {
  const INC_RAD = MOON_ORBIT_INCLINATION_DEG * INCLINATION_DISPLAY_FACTOR * DEG;

  it('叙事常量：真实倾角 5.145°、显示倍率 4、节奏常量为正', () => {
    expect(MOON_ORBIT_INCLINATION_DEG).toBe(5.145);
    expect(INCLINATION_DISPLAY_FACTOR).toBe(4);
    expect(NARRATIVE_PHASE_PERIOD_SEC).toBeGreaterThan(0);
    expect(NARRATIVE_NODE_CYCLE_ORBITS).toBeGreaterThan(1);
  });

  it('narrativeAngles：t0 处相位 0；一个周期后回绕；tSec 纯函数', () => {
    const out = { phaseRad: 0, nodeRad: 0 };
    narrativeAngles(1000, 1000, out);
    expect(out.phaseRad).toBe(0);
    narrativeAngles(1000 + NARRATIVE_PHASE_PERIOD_SEC, 1000, out);
    expect(out.phaseRad).toBeCloseTo(0, 9);
    narrativeAngles(1000 + NARRATIVE_PHASE_PERIOD_SEC / 4, 1000, out);
    expect(out.phaseRad).toBeCloseTo(Math.PI / 2, 9);
    expect(() => narrativeAngles(NaN, 0, out)).toThrow(RangeError);
  });

  it('轨道基正交、单位；倾角 0 时轨道面 = 黄道面（e2 黄纬分量为 0）', () => {
    const e1: MutableVec3 = [0, 0, 0];
    const e2: MutableVec3 = [0, 0, 0];
    narrativeOrbitBasis(0.7, INC_RAD, e1, e2);
    expect(Math.hypot(...e1)).toBeCloseTo(1, 12);
    expect(Math.hypot(...e2)).toBeCloseTo(1, 12);
    expect(e1[0] * e2[0] + e1[1] * e2[1] + e1[2] * e2[2]).toBeCloseTo(0, 12);
    expect(() => narrativeOrbitBasis(NaN, 0, e1, e2)).toThrow(RangeError);
  });

  it('相位 = 交点处月球在黄道面内；相位 = 交点+90° 处黄纬偏移 = sin(inc)·r', () => {
    const pos: MutableVec3 = [0, 0, 0];
    const eps = 23.43928 * DEG;
    // 黄纬分量：z_ecl = −y_eq·sinε + z_eq·cosε（赤道 → 黄道逆旋转）
    const eclZ = (p: MutableVec3): number => -p[1] * Math.sin(eps) + p[2] * Math.cos(eps);
    narrativeMoonPosKm(0, 0.7, INC_RAD, NARRATIVE_ORBIT_RADIUS_KM, pos);
    expect(Math.abs(eclZ(pos))).toBeLessThan(1);
    narrativeMoonPosKm(Math.PI / 2, 0.7, INC_RAD, NARRATIVE_ORBIT_RADIUS_KM, pos);
    expect(Math.abs(eclZ(pos))).toBeCloseTo(
      Math.sin(INC_RAD) * NARRATIVE_ORBIT_RADIUS_KM,
      0
    );
    expect(() => narrativeMoonPosKm(0, 0, INC_RAD, 0, pos)).toThrow(RangeError);
  });

  it('契约 C7 朔望参数化：望态（offset=π）位置 = 朔态反向', () => {
    const a: MutableVec3 = [0, 0, 0];
    const b: MutableVec3 = [0, 0, 0];
    narrativeMoonPosKm(1.1, 0.7, INC_RAD, NARRATIVE_ORBIT_RADIUS_KM, a, 0);
    narrativeMoonPosKm(1.1, 0.7, INC_RAD, NARRATIVE_ORBIT_RADIUS_KM, b, Math.PI);
    expect(b[0]).toBeCloseTo(-a[0], 6);
    expect(b[1]).toBeCloseTo(-a[1], 6);
    expect(b[2]).toBeCloseTo(-a[2], 6);
  });

  it('叙事几何：远离交点的合相月影掠过地球外（footExists=false）、交点对齐时命中', () => {
    const out = emptyEclipseSpaceFrameState();
    const pos: MutableVec3 = [0, 0, 0];
    // 真实事件食甚的月球方向 ≈ 日月合相方向；以其黄经构造「合相相位」：
    // 直接扫描叙事轨道一圈，取与太阳方向夹角最小的相位为合相
    const row = e2027.geo.rows[Math.round((e2027.contacts.max - e2027.geo.t0) / e2027.geo.dtSec)];
    const sunDir = [row[0], row[1], row[2]];
    const conjPhase = (nodeRad: number): number => {
      let best = 0;
      let bestDot = -Infinity;
      for (let k = 0; k < 720; k += 1) {
        const phi = (k / 720) * Math.PI * 2;
        narrativeMoonPosKm(phi, nodeRad, INC_RAD, NARRATIVE_ORBIT_RADIUS_KM, pos);
        const r = Math.hypot(...pos);
        const d = (pos[0] * sunDir[0] + pos[1] * sunDir[1] + pos[2] * sunDir[2]) / r;
        if (d > bestDot) {
          bestDot = d;
          best = phi;
        }
      }
      return best;
    };
    // 交点线远离日向（交点黄经 ⊥ 合相方向）→ 合相时月球黄纬大 → 影锥掠过
    const sunEclLon = Math.atan2(
      // 赤道 → 黄道：y_ecl = y·cosε + z·sinε
      row[1] * Math.cos(23.43928 * DEG) + row[2] * Math.sin(23.43928 * DEG),
      row[0]
    );
    const nodeMiss = sunEclLon + Math.PI / 2;
    narrativeMoonPosKm(conjPhase(nodeMiss), nodeMiss, INC_RAD, NARRATIVE_ORBIT_RADIUS_KM, pos);
    spaceFrameState(e2027.geo, e2027.contacts.max, null, pos, out);
    expect(out.footExists).toBe(false);
    // 交点线对齐日向 → 合相恰在交点 → 影锥命中地球
    narrativeMoonPosKm(conjPhase(sunEclLon), sunEclLon, INC_RAD, NARRATIVE_ORBIT_RADIUS_KM, pos);
    spaceFrameState(e2027.geo, e2027.contacts.max, null, pos, out);
    expect(out.footExists).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 相机运镜与场景常量（§M4-3 / A3）
// ---------------------------------------------------------------------------

describe('视角切换运镜姿态', () => {
  it('spaceIntroPose：t=0 远端起点、t=1 收敛到 DSCOVR 式日侧机位（沿太阳方向）', () => {
    const pose = { pos: [0, 0, 0] as MutableVec3, fovDeg: 0 };
    const sunDir: [number, number, number] = [0.6, 0.4, Math.sqrt(1 - 0.36 - 0.16)];
    spaceIntroPose(sunDir, 0, pose);
    expect(Math.hypot(...pose.pos)).toBeCloseTo(SPACE_INTRO_START_RADIUS_UNITS, 6);
    spaceIntroPose(sunDir, 1, pose);
    expect(Math.hypot(...pose.pos)).toBeCloseTo(SPACE_INTRO_END_RADIUS_UNITS, 6);
    // 终点在日侧：位置与太阳方向同向
    const dot =
      (pose.pos[0] * sunDir[0] + pose.pos[1] * sunDir[1] + pose.pos[2] * sunDir[2]) /
      Math.hypot(...pose.pos);
    expect(dot).toBeGreaterThan(0.999);
    expect(pose.fovDeg).toBe(GROUND_INTRO_FOV_END_DEG);
  });

  it('groundIntroAim：t=0 广角高机位、t=1 收敛到太阳方向 + 默认 FOV', () => {
    const aim = { altDeg: 0, azDeg: 0, fovDeg: 0 };
    groundIntroAim(40, 120, 0, aim);
    expect(aim.altDeg).toBeCloseTo(40 + GROUND_INTRO_ALT_OFFSET_DEG, 9);
    expect(aim.fovDeg).toBe(GROUND_INTRO_FOV_START_DEG);
    groundIntroAim(40, 120, 1, aim);
    expect(aim.altDeg).toBeCloseTo(40, 9);
    expect(aim.azDeg).toBe(120);
    expect(aim.fovDeg).toBe(GROUND_INTRO_FOV_END_DEG);
    // 高度角钳制（太阳近天顶时不越界）
    groundIntroAim(85, 0, 0, aim);
    expect(aim.altDeg).toBeLessThanOrEqual(88);
    expect(() => groundIntroAim(NaN, 0, 0.5, aim)).toThrow(RangeError);
  });

  it('FOV 常量与 labGestures 同源（END = 默认 65 / START ≤ 上限 85）', () => {
    expect(GROUND_INTRO_FOV_END_DEG).toBe(LAB_FOV_DEFAULT_DEG);
    expect(GROUND_INTRO_FOV_START_DEG).toBeLessThanOrEqual(LAB_FOV_MAX_DEG);
  });

  it('A3 远景日盘：距离压缩但视半径按真实 0.267° 折算', () => {
    expect(
      Math.atan(SPACE_SUN_DISK_RADIUS_UNITS / SPACE_SUN_DISK_DISTANCE_UNITS) / DEG
    ).toBeCloseTo(0.267, 6);
  });

  it('geodeticToSceneUnit 输出单位向量', () => {
    const v: MutableVec3 = [0, 0, 0];
    geodeticToSceneUnit(e2027.observer.latDeg, e2027.observer.lonDeg, e2027.contacts.max, v);
    expect(Math.hypot(...v)).toBeCloseTo(1, 9);
  });
});
