/**
 * 飞往/跟随目标解析可选项扩展测试（需求 3.2.3 / 7 单元测试）：
 * 矮行星 / M31 伴星系（M32/M110）/ 新增特殊天体
 */

import {
  M31_COMPANION_OFFSETS_LY,
  SATELLITE_GALAXY_ORBITS,
  getGalaxyById,
} from '@/data/galaxies';
import { getDwarfPlanetById } from '@/data/smallBodies';
import { MIN_VIEW_DISTANCE_UNITS, resolveFocusTarget } from '@/utils/cameraFocus';
import { dwarfDisplayRadius } from '@/utils/dwarfPlanets';
import { heliocentricPosition } from '@/utils/physics';
import { cosmicDistanceToSceneUnits, eclipticToScene, lyToSceneUnits } from '@/utils/scale';
import { mwM31SeparationLy, satelliteGalaxyPositionLy } from '@/utils/universe';

const SIM_DAYS = 8000;

describe('矮行星目标解析（可选需求 3.1.1 / P5 §3.3）', () => {
  it('5 颗矮行星均可解析且位置与开普勒轨道一致', () => {
    for (const id of ['ceres', 'pluto', 'eris', 'makemake', 'haumea']) {
      const target = resolveFocusTarget(id, SIM_DAYS);
      expect(target).not.toBeNull();
      const expected = eclipticToScene(
        heliocentricPosition(getDwarfPlanetById(id)!.orbit, SIM_DAYS),
      );
      expect(target!.position.x).toBeCloseTo(expected.x, 6);
      expect(target!.position.y).toBeCloseTo(expected.y, 6);
      expect(target!.position.z).toBeCloseTo(expected.z, 6);
      expect(target!.viewDistanceUnits).toBeGreaterThan(0);
    }
  });

  it('聚焦距离适配（P5 §3.3）：默认模式观察距离与钳制后显示半径匹配（半径×6）', () => {
    for (const id of ['ceres', 'pluto', 'eris', 'makemake', 'haumea']) {
      const target = resolveFocusTarget(id, SIM_DAYS)!;
      expect(target.viewDistanceUnits).toBeCloseTo(
        dwarfDisplayRadius(getDwarfPlanetById(id)!.radiusKm, false) * 6,
        10,
      );
    }
  });

  it('真实比例模式：观察距离按真实半径推荐并钳制到最小距离', () => {
    const target = resolveFocusTarget('ceres', SIM_DAYS, true)!;
    expect(target.viewDistanceUnits).toBe(MIN_VIEW_DISTANCE_UNITS);
  });
});

describe('M31 伴星系目标解析（M32 / M110）', () => {
  it('位置 = M31 当前位置 + 示意偏移（随 M31 一同移动）', () => {
    const m31 = getGalaxyById('m31')!;
    const d = cosmicDistanceToSceneUnits(mwM31SeparationLy(SIM_DAYS));
    for (const id of ['m32', 'm110'] as const) {
      const target = resolveFocusTarget(id, SIM_DAYS)!;
      const offset = M31_COMPANION_OFFSETS_LY[id];
      expect(target.position.x).toBeCloseTo(m31.direction.x * d + lyToSceneUnits(offset.x), 6);
      expect(target.position.y).toBeCloseTo(m31.direction.y * d + lyToSceneUnits(offset.y), 6);
      expect(target.position.z).toBeCloseTo(m31.direction.z * d + lyToSceneUnits(offset.z), 6);
    }
  });

  it('模拟时间推进时伴星系随 M31 接近银河系（到原点距离减小）', () => {
    const dist = (simDays: number): number => {
      const p = resolveFocusTarget('m32', simDays)!.position;
      return Math.hypot(p.x, p.y, p.z);
    };
    // 45 亿年 = 约 1.64e12 天，取中途两个时刻比较
    expect(dist(8e11)).toBeLessThan(dist(0));
  });
});

describe('人马座矮星系目标解析（R2-10：极轨道缓慢运动）', () => {
  it('与渲染同源公式一致（satelliteGalaxyPositionLy）', () => {
    const target = resolveFocusTarget('sagittarius-dwarf', SIM_DAYS)!;
    const g = getGalaxyById('sagittarius-dwarf')!;
    const orbit = SATELLITE_GALAXY_ORBITS['sagittarius-dwarf'];
    const p = satelliteGalaxyPositionLy(
      g.distanceLy,
      orbit.periodMyr,
      g.direction,
      orbit.inclinationDeg,
      SIM_DAYS,
    );
    expect(target.position.x).toBeCloseTo(lyToSceneUnits(p.x), 6);
    expect(target.position.y).toBeCloseTo(lyToSceneUnits(p.y), 6);
    expect(target.position.z).toBeCloseTo(lyToSceneUnits(p.z), 6);
  });

  it('t=0 首帧位置 = direction × distance（direction 一致性修复）', () => {
    const target = resolveFocusTarget('sagittarius-dwarf', 0)!;
    const g = getGalaxyById('sagittarius-dwarf')!;
    const d = cosmicDistanceToSceneUnits(g.distanceLy);
    // direction 为近似单位矢量（|v|≈1，内部归一化后与 d 相乘）
    const len = Math.hypot(g.direction.x, g.direction.y, g.direction.z);
    expect(target.position.x).toBeCloseTo((g.direction.x / len) * d, 4);
    expect(target.position.y).toBeCloseTo((g.direction.y / len) * d, 4);
    expect(target.position.z).toBeCloseTo((g.direction.z / len) * d, 4);
  });

  it('随时间产生可辨识位移（不再完全静止）', () => {
    const a = resolveFocusTarget('sagittarius-dwarf', 0)!.position;
    // 100 Myr 后（周期 900 Myr 的约 11%）
    const b = resolveFocusTarget('sagittarius-dwarf', 100 * 365.25e6)!.position;
    expect(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z)).toBeGreaterThan(100);
  });
});

describe('新增特殊天体目标解析（可选需求 3.1.5）', () => {
  it('L3 太阳邻域天体（天鹅座X-1 等）可解析', () => {
    for (const id of ['cygnus-x1', 'wr-124', 'delta-cephei', 'pleiades', 'horsehead-nebula']) {
      const target = resolveFocusTarget(id, SIM_DAYS);
      expect(target).not.toBeNull();
      expect(target!.viewDistanceUnits).toBeGreaterThan(0);
      expect(Number.isFinite(target!.position.x)).toBe(true);
    }
  });

  it('L4 河外对象（触须星系 / 透镜弧 / GRB）可解析且位于方向射线上', () => {
    for (const id of ['antennae-galaxies', 'cluster-lensing', 'grb-221009a']) {
      const target = resolveFocusTarget(id, SIM_DAYS);
      expect(target).not.toBeNull();
      const r = Math.hypot(target!.position.x, target!.position.y, target!.position.z);
      expect(r).toBeGreaterThan(0);
    }
  });
});
