/**
 * R2-10 L4 轨迹与运动一致性单元测试
 *
 * 覆盖：direction 自洽轨道基 / 首帧位置 = direction × distance /
 * 轨道线与运动位置同源（快进采样不偏离）/ 人马座矮星系可辨识位移 /
 * 潮汐流前导+尾随双向采样 / M31 接近流动光点相位 /
 * 跟随 LMC/SMC/人马座时相机解析与渲染同源回归。
 */

import {
  LOCAL_GROUP_GALAXIES,
  SAGITTARIUS_STREAM,
  SATELLITE_GALAXY_ORBITS,
} from '@/data/galaxies';
import { DAYS_PER_MYR } from '@/utils/galaxy';
import { resolveFocusTarget } from '@/utils/cameraFocus';
import { lyToSceneUnits } from '@/utils/scale';
import {
  M31_APPROACH_FLOW_COUNT,
  M31_APPROACH_FLOW_PERIOD_SEC,
  m31ApproachFlow01,
  satelliteGalaxyPositionLy,
  satelliteOrbitBasis,
  satelliteOrbitPointsLy,
  tidalStreamPointsLy,
} from '@/utils/universe';
import type { Vec3 } from '@/types';

const myrToDays = (myr: number): number => myr * DAYS_PER_MYR;

const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const norm = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);

const SATELLITE_IDS = ['lmc', 'smc', 'sagittarius-dwarf'] as const;

describe('satelliteOrbitBasis（轨道平面正交基）', () => {
  it('u/v 为正交单位矢量，u = 归一化 direction', () => {
    for (const g of LOCAL_GROUP_GALAXIES) {
      const { u, v } = satelliteOrbitBasis(g.direction, 42);
      expect(norm(u)).toBeCloseTo(1, 9);
      expect(norm(v)).toBeCloseTo(1, 9);
      expect(dot(u, v)).toBeCloseTo(0, 9);
      const len = norm(g.direction);
      expect(u.x).toBeCloseTo(g.direction.x / len, 9);
      expect(u.y).toBeCloseTo(g.direction.y / len, 9);
      expect(u.z).toBeCloseTo(g.direction.z / len, 9);
    }
  });

  it('incl=0 时切向水平（v.y = 0）；incl=90 时切向在 u-ŷ 面内', () => {
    const dir = { x: 0.62, y: -0.55, z: 0.56 };
    const flat = satelliteOrbitBasis(dir, 0);
    expect(flat.v.y).toBeCloseTo(0, 9);
    const polar = satelliteOrbitBasis(dir, 90);
    // 极轨道切向 m = u×h 与水平切向 h 垂直：v·h = 0
    expect(dot(polar.v, flat.v)).toBeCloseTo(0, 9);
  });

  it('direction ∥ ŷ 时退化回退 h = x̂（不抛错、仍正交）', () => {
    const { u, v } = satelliteOrbitBasis({ x: 0, y: 1, z: 0 }, 0);
    expect(dot(u, v)).toBeCloseTo(0, 9);
    expect(norm(v)).toBeCloseTo(1, 9);
  });

  it('零矢量/非有限 direction 抛 RangeError', () => {
    expect(() => satelliteOrbitBasis({ x: 0, y: 0, z: 0 }, 0)).toThrow(RangeError);
    expect(() => satelliteOrbitBasis({ x: Number.NaN, y: 1, z: 0 }, 0)).toThrow(RangeError);
  });
});

describe('direction 一致性修复（首帧位置 = direction × distance）', () => {
  it.each(SATELLITE_IDS)('%s：t=0 动态位置与静态首帧渲染位置一致', (id) => {
    const g = LOCAL_GROUP_GALAXIES.find((x) => x.id === id)!;
    const orbit = SATELLITE_GALAXY_ORBITS[id];
    const p = satelliteGalaxyPositionLy(
      g.distanceLy,
      orbit.periodMyr,
      g.direction,
      orbit.inclinationDeg,
      0,
    );
    // 数据 direction 为近似单位矢量（|v|≈1），归一化后比较（容差覆盖 ≈1 偏差）
    const len = norm(g.direction);
    expect(p.x).toBeCloseTo((g.direction.x / len) * g.distanceLy, 4);
    expect(p.y).toBeCloseTo((g.direction.y / len) * g.distanceLy, 4);
    expect(p.z).toBeCloseTo((g.direction.z / len) * g.distanceLy, 4);
  });
});

describe('轨道线与运动同源（验收 10.2：快进采样不偏离轨道线）', () => {
  it('轨道线点数 = segments+1 且首尾闭合', () => {
    const pts = satelliteOrbitPointsLy(160000, { x: 1, y: 0, z: 0 }, 35, 64);
    expect(pts).toHaveLength(65);
    expect(pts[64].x).toBeCloseTo(pts[0].x, 6);
    expect(pts[64].y).toBeCloseTo(pts[0].y, 6);
    expect(pts[64].z).toBeCloseTo(pts[0].z, 6);
  });

  it.each(SATELLITE_IDS)(
    '%s：60 个快进采样时刻的位置均严格落在轨道圆上（半径恒定 + 共面）',
    (id) => {
      const g = LOCAL_GROUP_GALAXIES.find((x) => x.id === id)!;
      const orbit = SATELLITE_GALAXY_ORBITS[id];
      const { u, v } = satelliteOrbitBasis(g.direction, orbit.inclinationDeg);
      // 平面法向 n = u×v；轨道线上任意点满足 ‖p‖=d 且 p·n=0
      const n: Vec3 = {
        x: u.y * v.z - u.z * v.y,
        y: u.z * v.x - u.x * v.z,
        z: u.x * v.y - u.y * v.x,
      };
      // 覆盖一整圈以上（快进 10× 观察 60 秒的等效采样）
      for (let i = 0; i <= 60; i += 1) {
        const t = myrToDays((orbit.periodMyr * 1.2 * i) / 60);
        const p = satelliteGalaxyPositionLy(
          g.distanceLy,
          orbit.periodMyr,
          g.direction,
          orbit.inclinationDeg,
          t,
        );
        expect(norm(p)).toBeCloseTo(g.distanceLy, 4);
        expect(dot(p, n) / g.distanceLy).toBeCloseTo(0, 6);
      }
    },
  );

  it('轨道线采样点与运动公式同角度值逐点一致（同一公式）', () => {
    const g = LOCAL_GROUP_GALAXIES.find((x) => x.id === 'lmc')!;
    const orbit = SATELLITE_GALAXY_ORBITS.lmc;
    const segments = 12;
    const pts = satelliteOrbitPointsLy(g.distanceLy, g.direction, orbit.inclinationDeg, segments);
    for (let s = 0; s <= segments; s += 1) {
      // 角度 θ = 2πs/segments 对应时刻 t = period·s/segments
      const t = myrToDays((orbit.periodMyr * s) / segments);
      const p = satelliteGalaxyPositionLy(
        g.distanceLy,
        orbit.periodMyr,
        g.direction,
        orbit.inclinationDeg,
        t,
      );
      expect(pts[s].x).toBeCloseTo(p.x, 4);
      expect(pts[s].y).toBeCloseTo(p.y, 4);
      expect(pts[s].z).toBeCloseTo(p.z, 4);
    }
  });

  it('非法参数抛 RangeError（距离 ≤0、段数 <3/非整数）', () => {
    const dir = { x: 1, y: 0, z: 0 };
    expect(() => satelliteOrbitPointsLy(0, dir, 0, 64)).toThrow(RangeError);
    expect(() => satelliteOrbitPointsLy(160000, dir, 0, 2)).toThrow(RangeError);
    expect(() => satelliteOrbitPointsLy(160000, dir, 0, 64.5)).toThrow(RangeError);
  });
});

describe('人马座矮星系运动与潮汐流（验收 10.2）', () => {
  const g = LOCAL_GROUP_GALAXIES.find((x) => x.id === 'sagittarius-dwarf')!;
  const orbit = SATELLITE_GALAXY_ORBITS['sagittarius-dwarf'];

  it('100 Myr 产生可辨识位移（不再完全静止）', () => {
    const a = satelliteGalaxyPositionLy(
      g.distanceLy,
      orbit.periodMyr,
      g.direction,
      orbit.inclinationDeg,
      0,
    );
    const b = satelliteGalaxyPositionLy(
      g.distanceLy,
      orbit.periodMyr,
      g.direction,
      orbit.inclinationDeg,
      myrToDays(100),
    );
    // 周期 900 Myr 的 1/9 ≈ 40° 弧长 ≈ 0.68×distance
    expect(norm({ x: b.x - a.x, y: b.y - a.y, z: b.z - a.z })).toBeGreaterThan(
      g.distanceLy * 0.5,
    );
  });

  it('潮汐流前导端接近未来轨道位置、尾随端接近历史轨道位置', () => {
    const simDays = myrToDays(500);
    const cfg = {
      backMyr: SAGITTARIUS_STREAM.backMyr,
      forwardMyr: SAGITTARIUS_STREAM.forwardMyr,
      jitterFrac: SAGITTARIUS_STREAM.jitterFrac,
      seed: SAGITTARIUS_STREAM.seed,
    };
    const pts = tidalStreamPointsLy(
      g.distanceLy,
      orbit.periodMyr,
      g.direction,
      orbit.inclinationDeg,
      simDays,
      SAGITTARIUS_STREAM.pointCount,
      cfg,
    );
    expect(pts).toHaveLength(SAGITTARIUS_STREAM.pointCount);
    const at = (offsetMyr: number): Vec3 =>
      satelliteGalaxyPositionLy(
        g.distanceLy,
        orbit.periodMyr,
        g.direction,
        orbit.inclinationDeg,
        simDays + myrToDays(offsetMyr),
      );
    const lead = at(cfg.forwardMyr);
    const trail = at(-cfg.backMyr);
    const maxJitter = g.distanceLy * cfg.jitterFrac * 1.3 * Math.sqrt(3) + 1e-6;
    const first = pts[0];
    const last = pts[pts.length - 1];
    expect(norm({ x: first.x - lead.x, y: first.y - lead.y, z: first.z - lead.z })).toBeLessThan(
      maxJitter,
    );
    expect(norm({ x: last.x - trail.x, y: last.y - trail.y, z: last.z - trail.z })).toBeLessThan(
      maxJitter,
    );
  });

  it('确定性：同参数两次输出一致', () => {
    const args = [
      g.distanceLy,
      orbit.periodMyr,
      g.direction,
      orbit.inclinationDeg,
      0,
      12,
      { backMyr: 100, forwardMyr: 50, jitterFrac: 0.05, seed: 7 },
    ] as const;
    expect(tidalStreamPointsLy(...args)).toEqual(tidalStreamPointsLy(...args));
  });

  it('非法参数抛 RangeError（count/时长/抖动比例）', () => {
    const dir = { x: 1, y: 0, z: 0 };
    const cfg = { backMyr: 100, forwardMyr: 0, jitterFrac: 0.04, seed: 1 };
    expect(() => tidalStreamPointsLy(1000, 100, dir, 0, 0, 1, cfg)).toThrow(RangeError);
    expect(() =>
      tidalStreamPointsLy(1000, 100, dir, 0, 0, 10, { ...cfg, backMyr: 0, forwardMyr: 0 }),
    ).toThrow(RangeError);
    expect(() =>
      tidalStreamPointsLy(1000, 100, dir, 0, 0, 10, { ...cfg, backMyr: -1 }),
    ).toThrow(RangeError);
    expect(() =>
      tidalStreamPointsLy(1000, 100, dir, 0, 0, 10, { ...cfg, jitterFrac: -0.1 }),
    ).toThrow(RangeError);
  });
});

describe('M31 接近流动光点相位（R2-10 进度感）', () => {
  it('相位在 [0,1) 内且随时间推进、周期循环', () => {
    const a = m31ApproachFlow01(0, 0);
    const b = m31ApproachFlow01(M31_APPROACH_FLOW_PERIOD_SEC * 0.25, 0);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(1);
    expect(b).toBeCloseTo(a + 0.25, 9);
    // 整周期回绕
    expect(m31ApproachFlow01(M31_APPROACH_FLOW_PERIOD_SEC, 0)).toBeCloseTo(a, 9);
  });

  it('count 个光点等相位间隔（1/count）', () => {
    const t = 3.21;
    for (let i = 1; i < M31_APPROACH_FLOW_COUNT; i += 1) {
      const prev = m31ApproachFlow01(t, i - 1);
      const cur = m31ApproachFlow01(t, i);
      const gap = (cur - prev + 1) % 1;
      expect(gap).toBeCloseTo(1 / M31_APPROACH_FLOW_COUNT, 9);
    }
  });

  it('非法参数抛 RangeError（非有限时间/越界索引/非法周期与数量）', () => {
    expect(() => m31ApproachFlow01(Number.NaN, 0)).toThrow(RangeError);
    expect(() => m31ApproachFlow01(0, -1)).toThrow(RangeError);
    expect(() => m31ApproachFlow01(0, M31_APPROACH_FLOW_COUNT)).toThrow(RangeError);
    expect(() => m31ApproachFlow01(0, 0.5)).toThrow(RangeError);
    expect(() => m31ApproachFlow01(0, 0, 0)).toThrow(RangeError);
    expect(() => m31ApproachFlow01(0, 0, 6, 0)).toThrow(RangeError);
  });
});

describe('跟随 LMC/SMC/人马座相机解析与渲染同源回归（验收 10.2）', () => {
  it.each(SATELLITE_IDS)('%s：resolveFocusTarget 与渲染公式逐分量一致', (id) => {
    const g = LOCAL_GROUP_GALAXIES.find((x) => x.id === id)!;
    const orbit = SATELLITE_GALAXY_ORBITS[id];
    for (const simDays of [0, myrToDays(123), myrToDays(987)]) {
      const target = resolveFocusTarget(id, simDays)!;
      const p = satelliteGalaxyPositionLy(
        g.distanceLy,
        orbit.periodMyr,
        g.direction,
        orbit.inclinationDeg,
        simDays,
      );
      expect(target.position.x).toBeCloseTo(lyToSceneUnits(p.x), 6);
      expect(target.position.y).toBeCloseTo(lyToSceneUnits(p.y), 6);
      expect(target.position.z).toBeCloseTo(lyToSceneUnits(p.z), 6);
    }
  });
});
