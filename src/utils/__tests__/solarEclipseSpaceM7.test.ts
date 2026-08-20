/**
 * E-M7 太空视角观感增强纯逻辑（IMPROVEMENT_REQUIREMENTS_SOLAR_ECLIPSE §M7）：
 * 行星层距离压缩函数（1 AU 锚点/单调性/海王星域锚点，A17）、
 * 行星层对齐矩阵（正交性 + 地球方向精确对齐 + 地球落原点残差 <1 单位）、
 * 月球放大锥基倍率（×1 真实比例回归防守，A16）、
 * 星穹/银河带方位常量（北银极正交锚点，A15）。
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { validateSolarEclipses, type SolarEclipsesData } from '@/utils/bakedData';
import { PLANETS } from '@/data/planets';
import { heliocentricPosition } from '@/utils/physics';
import { J2000_UNIX_SEC } from '@/utils/solarEclipseLab';
import {
  GALACTIC_CENTER_DEC_DEG,
  GALACTIC_CENTER_RA_DEG,
  GALACTIC_POLE_DEC_DEG,
  GALACTIC_POLE_RA_DEG,
  J2000_SCENE_MATRIX3,
  MOON_MAGNIFY_FACTOR,
  SPACE_AU_LINEAR_UNITS,
  SPACE_CAMERA_FAR_UNITS,
  SPACE_MILKY_WAY_RADIUS_UNITS,
  SPACE_STAR_DOME_RADIUS_UNITS,
  SPACE_SUN_DISK_DISTANCE_UNITS,
  UMBRA_MAGNIFY_FACTOR,
  compressAuToUnits,
  coneRadialScale,
  emptyEclipseSpaceFrameState,
  equatorialSceneDir,
  j2000ToSceneVec,
  planetLayerSceneMatrix3,
  spaceFrameState,
  type MutableVec3,
} from '@/utils/solarEclipseSpace';

const eclipses = validateSolarEclipses(
  JSON.parse(readFileSync(join(process.cwd(), 'public/data/solar_eclipses.json'), 'utf8'))
) as SolarEclipsesData;

/** 行主序 3×3 矩阵 × 向量 */
function mulM3(m: readonly number[] | Float64Array, v: readonly number[]): MutableVec3 {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

describe('compressAuToUnits（A17 距离压缩：契约 C4 增补比例域）', () => {
  it('1 AU 锚点 = 1,500 场景单位（与日盘距离同值源）', () => {
    expect(compressAuToUnits(1)).toBe(SPACE_AU_LINEAR_UNITS);
    expect(SPACE_AU_LINEAR_UNITS).toBe(SPACE_SUN_DISK_DISTANCE_UNITS);
    expect(SPACE_AU_LINEAR_UNITS).toBe(1500);
  });

  it('线性区按比例、原点为零', () => {
    expect(compressAuToUnits(0)).toBe(0);
    expect(compressAuToUnits(0.5)).toBeCloseTo(750, 9);
  });

  it('1 AU 处连续（对数区自 1,500 起算）', () => {
    expect(compressAuToUnits(1 + 1e-9)).toBeCloseTo(1500, 4);
  });

  it('全域严格单调递增', () => {
    let prev = -1;
    for (let r = 0; r <= 31; r += 0.1) {
      const u = compressAuToUnits(r);
      expect(u).toBeGreaterThan(prev);
      prev = u;
    }
  });

  it('海王星 30.07 AU 收敛于星穹与相机 far 之内（八大行星全量同框锚点）', () => {
    const neptune = compressAuToUnits(30.06896348);
    expect(neptune).toBeGreaterThan(4000);
    expect(neptune).toBeLessThan(4300);
    expect(neptune).toBeLessThan(SPACE_MILKY_WAY_RADIUS_UNITS);
    expect(SPACE_MILKY_WAY_RADIUS_UNITS).toBeLessThan(SPACE_STAR_DOME_RADIUS_UNITS);
    expect(SPACE_STAR_DOME_RADIUS_UNITS).toBeLessThan(SPACE_CAMERA_FAR_UNITS);
  });

  it('非法输入抛错', () => {
    expect(() => compressAuToUnits(-0.1)).toThrow(RangeError);
    expect(() => compressAuToUnits(Number.NaN)).toThrow(RangeError);
    expect(() => compressAuToUnits(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe('coneRadialScale（A16 月球放大锥基随动；A4 正交叠乘）', () => {
  it('双开关全关严格 = 1（真实比例回归防守）', () => {
    expect(coneRadialScale('umbra', false, false)).toBe(1);
    expect(coneRadialScale('penumbra', false, false)).toBe(1);
  });

  it('月球放大 = 双锥基部同倍 ×4', () => {
    expect(coneRadialScale('umbra', false, true)).toBe(MOON_MAGNIFY_FACTOR);
    expect(coneRadialScale('penumbra', false, true)).toBe(MOON_MAGNIFY_FACTOR);
    expect(MOON_MAGNIFY_FACTOR).toBe(4);
  });

  it('A4 本影放大只作用本影且与月球放大叠乘', () => {
    expect(coneRadialScale('umbra', true, false)).toBe(UMBRA_MAGNIFY_FACTOR);
    expect(coneRadialScale('umbra', true, true)).toBe(UMBRA_MAGNIFY_FACTOR * MOON_MAGNIFY_FACTOR);
    expect(coneRadialScale('penumbra', true, false)).toBe(1);
    expect(coneRadialScale('penumbra', true, true)).toBe(MOON_MAGNIFY_FACTOR);
  });
});

describe('equatorialSceneDir / J2000_SCENE_MATRIX3（M7-1 星穹固定朝向）', () => {
  it('北天极 → 场景 +Y、春分点 → 场景 +X（契约 C4 轴映射）', () => {
    const out: MutableVec3 = [0, 0, 0];
    equatorialSceneDir(123, 90, out);
    expect(out[0]).toBeCloseTo(0, 9);
    expect(out[1]).toBeCloseTo(1, 9);
    expect(out[2]).toBeCloseTo(0, 9);
    equatorialSceneDir(0, 0, out);
    expect(out[0]).toBeCloseTo(1, 9);
    expect(out[1]).toBeCloseTo(0, 9);
    expect(out[2]).toBeCloseTo(0, 9);
  });

  it('矩阵形与 j2000ToSceneVec 在基向量上逐元一致', () => {
    const out: MutableVec3 = [0, 0, 0];
    const basis: ReadonlyArray<readonly [number, number, number]> = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ];
    basis.forEach((v, col) => {
      j2000ToSceneVec(v, out);
      // ±0 语义等价（toBeCloseTo 规避 Object.is 对 −0 的区分）
      expect(J2000_SCENE_MATRIX3[col]).toBeCloseTo(out[0], 12);
      expect(J2000_SCENE_MATRIX3[3 + col]).toBeCloseTo(out[1], 12);
      expect(J2000_SCENE_MATRIX3[6 + col]).toBeCloseTo(out[2], 12);
    });
  });

  it('北银极与银心方向近正交（银道面方位真实性锚点，A15）', () => {
    const pole: MutableVec3 = [0, 0, 0];
    const center: MutableVec3 = [0, 0, 0];
    equatorialSceneDir(GALACTIC_POLE_RA_DEG, GALACTIC_POLE_DEC_DEG, pole);
    equatorialSceneDir(GALACTIC_CENTER_RA_DEG, GALACTIC_CENTER_DEC_DEG, center);
    expect(Math.hypot(...pole)).toBeCloseTo(1, 9);
    expect(Math.hypot(...center)).toBeCloseTo(1, 9);
    const dot = pole[0] * center[0] + pole[1] * center[1] + pole[2] * center[2];
    expect(Math.abs(dot)).toBeLessThan(0.01);
  });

  it('非法输入抛错', () => {
    const out: MutableVec3 = [0, 0, 0];
    expect(() => equatorialSceneDir(Number.NaN, 0, out)).toThrow(RangeError);
    expect(() => equatorialSceneDir(0, Number.NaN, out)).toThrow(RangeError);
  });
});

describe('planetLayerSceneMatrix3（M7-4 对齐矩阵）', () => {
  const earthOrbit = PLANETS.find((p) => p.id === 'earth')!.orbit;

  it('输出为纯旋转（行正交归一、行列式 +1）', () => {
    const out = new Float64Array(9);
    planetLayerSceneMatrix3([0.3, -0.9, 0.01], [0.5, 0.5, Math.SQRT1_2], out);
    for (let r = 0; r < 3; r += 1) {
      const len = Math.hypot(out[r * 3], out[r * 3 + 1], out[r * 3 + 2]);
      expect(len).toBeCloseTo(1, 9);
      for (let r2 = r + 1; r2 < 3; r2 += 1) {
        const dot =
          out[r * 3] * out[r2 * 3] +
          out[r * 3 + 1] * out[r2 * 3 + 1] +
          out[r * 3 + 2] * out[r2 * 3 + 2];
        expect(Math.abs(dot)).toBeLessThan(1e-9);
      }
    }
    const det =
      out[0] * (out[4] * out[8] - out[5] * out[7]) -
      out[1] * (out[3] * out[8] - out[5] * out[6]) +
      out[2] * (out[3] * out[7] - out[4] * out[6]);
    expect(det).toBeCloseTo(1, 9);
  });

  it('地球日心方向被精确对齐到 −sunDirScene', () => {
    const out = new Float64Array(9);
    const earth = [0.42, 0.88, -0.002];
    const sunDir = [-0.31, 0.12, 0.94];
    const sLen = Math.hypot(...sunDir);
    const sunUnit = sunDir.map((v) => v / sLen);
    planetLayerSceneMatrix3(earth, sunUnit, out);
    const eLen = Math.hypot(...earth);
    const v = mulM3(out, [earth[0] / eLen, earth[1] / eLen, earth[2] / eLen]);
    expect(v[0]).toBeCloseTo(-sunUnit[0], 9);
    expect(v[1]).toBeCloseTo(-sunUnit[1], 9);
    expect(v[2]).toBeCloseTo(-sunUnit[2], 9);
  });

  it('三事件食甚：地球落原点残差 <1 单位、平要素修正角 <1°（一手集成锚点）', () => {
    const out = new Float64Array(9);
    const scratch = emptyEclipseSpaceFrameState();
    for (const ev of eclipses.events) {
      const tSec = ev.contacts.max;
      spaceFrameState(ev.geo, tSec, null, null, scratch);
      const d = (tSec - J2000_UNIX_SEC) / 86400;
      const pe = heliocentricPosition(earthOrbit, d);
      const earth = [pe.x, pe.y, pe.z];
      const rE = Math.hypot(pe.x, pe.y, pe.z);
      planetLayerSceneMatrix3(earth, scratch.sunDirScene, out);
      // 地球轨道层场景位置 = sunDir·compress(rE) + M·(ê_e·compress(rE)) → 原点
      const anchor = compressAuToUnits(rE);
      const v = mulM3(out, [earth[0] / rE, earth[1] / rE, earth[2] / rE]);
      const px = scratch.sunDirScene[0] * anchor + v[0] * anchor;
      const py = scratch.sunDirScene[1] * anchor + v[1] * anchor;
      const pz = scratch.sunDirScene[2] * anchor + v[2] * anchor;
      expect(Math.hypot(px, py, pz)).toBeLessThan(1);
      // 修正角 = 基础旋转（无对齐）地球方向 vs 星历 −sunDir 的夹角 ≪1°
      const v0 = mulM3(J2000_SCENE_MATRIX3 as number[], [
        earth[0] / rE,
        (earth[1] / rE) * Math.cos(23.43928 * (Math.PI / 180)) -
          (earth[2] / rE) * Math.sin(23.43928 * (Math.PI / 180)),
        (earth[1] / rE) * Math.sin(23.43928 * (Math.PI / 180)) +
          (earth[2] / rE) * Math.cos(23.43928 * (Math.PI / 180)),
      ]);
      const cosAng =
        -v0[0] * scratch.sunDirScene[0] -
        v0[1] * scratch.sunDirScene[1] -
        v0[2] * scratch.sunDirScene[2];
      expect(Math.acos(Math.min(1, Math.max(-1, cosAng))) * (180 / Math.PI)).toBeLessThan(1);
    }
  });

  it('已对齐退化情形返回基础旋转（恒等修正）', () => {
    const out = new Float64Array(9);
    const earth = [1, 0, 0];
    // 基础旋转下 ê_e=(1,0,0) → 场景 (1,0,0)；取 sunDir = (−1,0,0) 使 t = v0
    planetLayerSceneMatrix3(earth, [-1, 0, 0], out);
    const eps = 23.43928 * (Math.PI / 180);
    expect(out[0]).toBeCloseTo(1, 12);
    expect(out[4]).toBeCloseTo(Math.sin(eps), 12);
    expect(out[5]).toBeCloseTo(Math.cos(eps), 12);
  });

  it('非法输入抛错', () => {
    const out = new Float64Array(9);
    expect(() => planetLayerSceneMatrix3([0, 0, 0], [1, 0, 0], out)).toThrow(RangeError);
    expect(() => planetLayerSceneMatrix3([Number.NaN, 1, 0], [1, 0, 0], out)).toThrow(RangeError);
    expect(() =>
      planetLayerSceneMatrix3([1, 0, 0], [1, 0, 0], new Float64Array(4))
    ).toThrow(RangeError);
  });
});
