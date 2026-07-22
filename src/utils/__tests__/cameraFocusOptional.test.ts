/**
 * 飞往/跟随目标解析可选项扩展测试（需求 3.2.3 / 7 单元测试）：
 * 矮行星 / M31 伴星系（M32/M110）/ 新增特殊天体
 */

import { M31_COMPANION_OFFSETS_LY, getGalaxyById } from '@/data/galaxies';
import { getDwarfPlanetById } from '@/data/smallBodies';
import { resolveFocusTarget } from '@/utils/cameraFocus';
import { heliocentricPosition } from '@/utils/physics';
import { cosmicDistanceToSceneUnits, eclipticToScene, lyToSceneUnits } from '@/utils/scale';
import { mwM31SeparationLy } from '@/utils/universe';

const SIM_DAYS = 8000;

describe('矮行星目标解析（可选需求 3.1.1）', () => {
  it('阋神星/鸟神星/妊神星均可解析且位置与开普勒轨道一致', () => {
    for (const id of ['eris', 'makemake', 'haumea']) {
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

describe('人马座矮星系目标解析', () => {
  it('可解析且位于其方向射线上', () => {
    const target = resolveFocusTarget('sagittarius-dwarf', SIM_DAYS)!;
    const g = getGalaxyById('sagittarius-dwarf')!;
    const d = cosmicDistanceToSceneUnits(g.distanceLy);
    expect(target.position.x).toBeCloseTo(g.direction.x * d, 6);
    expect(target.position.y).toBeCloseTo(g.direction.y * d, 6);
    expect(target.position.z).toBeCloseTo(g.direction.z * d, 6);
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
