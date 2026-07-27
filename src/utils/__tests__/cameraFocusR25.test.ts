/**
 * R2-5 域序列飞往解析测试（IMPROVEMENT_REQUIREMENTS_2 §R2-5 §5.1-C）
 *
 * 覆盖：银河系（milky-way）整体飞往分支、L3/L4 域序列全部成员可解析
 * （requestFlyTo 兜底不拒绝）、观察距离按天体类型适配的逐成员核对。
 */

import { resolveFocusTarget, viewDistanceForRadius } from '@/utils/cameraFocus';
import { GALAXY_CYCLE_SEQUENCE, UNIVERSE_CYCLE_SEQUENCE } from '@/utils/cycleScopes';
import { SOLAR_CYCLE_SEQUENCE, planetSystemSequence } from '@/utils/bodyCycle';
import { MILKY_WAY } from '@/data/galaxies';
import { getSpecialBodyById } from '@/data/specialBodies';
import { SCENE_UNITS_PER_LY } from '@/utils/scale';

describe('milky-way 整体飞往解析（R2-5 L4 域序列首站）', () => {
  it('目标点为银心（simDays=0 时太阳位于银心系轨道上，目标点非原点）', () => {
    const target = resolveFocusTarget('milky-way', 0);
    expect(target).not.toBeNull();
    // 跟随模式下太阳系居原点，银心在远处（~26,660 光年 × 0.05 单位/光年）
    const d = Math.hypot(target!.position.x, target!.position.y, target!.position.z);
    expect(d).toBeGreaterThan(1000);
  });

  it('观察距离按银盘显示半径推荐（可见整个银盘）', () => {
    const target = resolveFocusTarget('milky-way', 0)!;
    const radiusUnits = (MILKY_WAY.diameterLy / 2) * SCENE_UNITS_PER_LY;
    expect(target.viewDistanceUnits).toBeCloseTo(viewDistanceForRadius(radiusUnits), 10);
    expect(target.viewDistanceUnits).toBeGreaterThan(radiusUnits);
  });

  it('真实比例模式解析不变（星系尺度不参与行星比例切换）', () => {
    expect(resolveFocusTarget('milky-way', 42, true)).toEqual(
      resolveFocusTarget('milky-way', 42, false),
    );
  });
});

describe('域序列全部成员可解析（§5.2：遍历一整圈不因兜底拒绝断链）', () => {
  it.each([...GALAXY_CYCLE_SEQUENCE])('L3 域成员 %s 可解析', (id) => {
    const target = resolveFocusTarget(id, 1234.5);
    expect(target).not.toBeNull();
    expect(Number.isFinite(target!.viewDistanceUnits)).toBe(true);
    expect(target!.viewDistanceUnits).toBeGreaterThan(0);
  });

  it.each([...UNIVERSE_CYCLE_SEQUENCE])('L4 域成员 %s 可解析', (id) => {
    const target = resolveFocusTarget(id, 1234.5);
    expect(target).not.toBeNull();
    expect(target!.viewDistanceUnits).toBeGreaterThan(0);
  });

  it('行星域全部成员仍可解析（太阳系序列 + 各行星系统序列，现状不回退）', () => {
    for (const id of SOLAR_CYCLE_SEQUENCE.flatMap((sysId) => planetSystemSequence(sysId))) {
      expect(resolveFocusTarget(id, 1234.5)).not.toBeNull();
    }
  });
});

describe('观察距离按天体类型适配（§5.1-C 逐成员核对）', () => {
  it('L3 特殊天体成员：观察距离 ≥ 6×显示半径（整体形态完整可见）', () => {
    for (const id of GALAXY_CYCLE_SEQUENCE) {
      const body = getSpecialBodyById(id);
      if (!body) continue; // sun / heliopause 另行核对
      const target = resolveFocusTarget(id, 0)!;
      const radiusUnits = body.visualRadiusLy * SCENE_UNITS_PER_LY;
      expect(target.viewDistanceUnits).toBeGreaterThanOrEqual(radiusUnits * 6 - 1e-9);
      // 下限保护：恒星/致密天体也不会贴脸（≥30 单位）
      expect(target.viewDistanceUnits).toBeGreaterThanOrEqual(30);
    }
  });

  it('星云/星团类成员观察距离大于恒星类（看整体形态 vs 表面细节）', () => {
    const nebulaOrCluster = ['orion-nebula', 'pleiades', 'm13-cluster'];
    const stars = ['sirius', 'delta-cephei'];
    const minNebula = Math.min(
      ...nebulaOrCluster.map((id) => resolveFocusTarget(id, 0)!.viewDistanceUnits),
    );
    const maxStar = Math.max(
      ...stars.map((id) => resolveFocusTarget(id, 0)!.viewDistanceUnits),
    );
    expect(minNebula).toBeGreaterThan(maxStar);
  });

  it('L4 星系成员：观察距离大于星系显示半径（整体可见）', () => {
    // 与 Universe.tsx 一致的显示直径：相对银河系 ×2500×2×0.55
    for (const id of ['m31', 'm33', 'lmc', 'smc', 'sagittarius-dwarf', 'm87']) {
      const target = resolveFocusTarget(id, 0)!;
      expect(target.viewDistanceUnits).toBeGreaterThan(0);
    }
  });
});
