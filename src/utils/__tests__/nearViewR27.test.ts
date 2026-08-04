/**
 * R2-7 §7.1-B：L3 近观 LOD 门控 + 激活距离登记 + 粒子预算单测
 */

import { GALAXY_CYCLE_SEQUENCE } from '@/utils/cycleScopes';
import { resolveFocusTarget } from '@/utils/cameraFocus';
import {
  GLOBAL_PARTICLE_BUDGET,
  NEAR_VIEW_ENTER_RATIO,
  NEAR_VIEW_EXIT_RATIO,
  NEAR_VIEW_PARTICLE_INCREMENTS,
  SOLAR_ACTIVITY_PARTICLE_PEAK,
  nearViewEnterDistanceUnits,
  nearViewExitDistanceUnits,
  nearViewGateUpdate,
  nebulaPuffLayout,
} from '@/utils/nearView';

describe('近观激活距离（L3 域序列逐成员定义）', () => {
  it.each([...GALAXY_CYCLE_SEQUENCE])('%s 有正有限的激活距离', (id) => {
    const enter = nearViewEnterDistanceUnits(id);
    expect(Number.isFinite(enter)).toBe(true);
    expect(enter).toBeGreaterThan(0);
  });

  it.each([...GALAXY_CYCLE_SEQUENCE])(
    '%s 激活距离与飞往观察距离同源（观察距离 × 1.5，飞抵后必然处于阈值内）',
    (id) => {
      const target = resolveFocusTarget(id, 0);
      expect(target).not.toBeNull();
      expect(nearViewEnterDistanceUnits(id)).toBeCloseTo(
        target!.viewDistanceUnits * NEAR_VIEW_ENTER_RATIO,
        8,
      );
    },
  );

  it('退出距离 = 进入距离 × 1.4（滞回，与 planetDetail 同比例）', () => {
    expect(NEAR_VIEW_EXIT_RATIO).toBe(1.4);
    expect(nearViewExitDistanceUnits('sirius')).toBeCloseTo(
      nearViewEnterDistanceUnits('sirius') * 1.4,
      10,
    );
  });

  it('sun 已移出 L3 巡游序列但仍可点选/飞往，激活距离公式保留且与观察距离同源', () => {
    expect(GALAXY_CYCLE_SEQUENCE).not.toContain('sun');
    const enter = nearViewEnterDistanceUnits('sun');
    expect(Number.isFinite(enter)).toBe(true);
    expect(enter).toBeGreaterThan(0);
    const target = resolveFocusTarget('sun', 0);
    expect(enter).toBeCloseTo(target!.viewDistanceUnits * NEAR_VIEW_ENTER_RATIO, 8);
  });

  it('未知 id / 河外天体（非 L3 域成员）抛 RangeError', () => {
    expect(() => nearViewEnterDistanceUnits('not-a-body')).toThrow(RangeError);
    expect(() => nearViewEnterDistanceUnits('quasar-3c273')).toThrow(RangeError);
    expect(() => nearViewEnterDistanceUnits('m31')).toThrow(RangeError);
  });
});

describe('近观门控状态机（滞回防抖，仅跟随目标激活）', () => {
  const enter = 100;

  it('未激活 → 激活：需同时满足 focused 与 距离 < 进入阈值', () => {
    expect(nearViewGateUpdate(false, true, 99, enter)).toEqual({
      active: true,
      releaseNow: false,
    });
    expect(nearViewGateUpdate(false, false, 10, enter).active).toBe(false);
    expect(nearViewGateUpdate(false, true, 101, enter).active).toBe(false);
  });

  it('滞回：激活后在进入与退出阈值之间保持激活', () => {
    // 120 ∈ (enter=100, exit=140)：未激活时不进入、已激活时不退出
    expect(nearViewGateUpdate(false, true, 120, enter).active).toBe(false);
    expect(nearViewGateUpdate(true, true, 120, enter)).toEqual({
      active: true,
      releaseNow: false,
    });
  });

  it('激活 → 释放：距离 > 退出阈值 即释放（releaseNow）', () => {
    expect(nearViewGateUpdate(true, true, 141, enter)).toEqual({
      active: false,
      releaseNow: true,
    });
  });

  it('激活 → 释放：离开跟随（focused=false）即释放，与距离无关', () => {
    expect(nearViewGateUpdate(true, false, 10, enter)).toEqual({
      active: false,
      releaseNow: true,
    });
  });

  it('非法输入抛 RangeError', () => {
    expect(() => nearViewGateUpdate(false, true, -1, enter)).toThrow(RangeError);
    expect(() => nearViewGateUpdate(false, true, Number.NaN, enter)).toThrow(RangeError);
    expect(() => nearViewGateUpdate(false, true, 10, 0)).toThrow(RangeError);
    expect(() => nearViewGateUpdate(false, true, 10, Number.POSITIVE_INFINITY)).toThrow(
      RangeError,
    );
  });
});

describe('星云近观体积云团布局（确定性）', () => {
  it('同一种子两次生成完全一致（两次飞往形态一致）', () => {
    const a = nebulaPuffLayout(42, 18, 12, 0.55, 3);
    const b = nebulaPuffLayout(42, 18, 12, 0.55, 3);
    expect(a).toEqual(b);
  });

  it('不同种子形态不同', () => {
    const a = nebulaPuffLayout(42, 18, 12, 0.55, 3);
    const b = nebulaPuffLayout(43, 18, 12, 0.55, 3);
    expect(a).not.toEqual(b);
  });

  it('数量/边界/参数范围符合约定', () => {
    const radius = 12;
    const flatten = 0.55;
    const list = nebulaPuffLayout(7, 24, radius, flatten, 3);
    expect(list).toHaveLength(24);
    for (const p of list) {
      expect(Math.hypot(p.x, p.z)).toBeLessThanOrEqual(radius + 1e-9);
      expect(Math.abs(p.y)).toBeLessThanOrEqual(radius * flatten + 1e-9);
      expect(p.scale).toBeGreaterThanOrEqual(radius * 0.5 - 1e-9);
      expect(p.scale).toBeLessThanOrEqual(radius * 1.1 + 1e-9);
      expect(p.opacity).toBeGreaterThan(0);
      expect(p.opacity).toBeLessThan(1);
      expect(Number.isInteger(p.textureIndex)).toBe(true);
      expect(p.textureIndex).toBeGreaterThanOrEqual(0);
      expect(p.textureIndex).toBeLessThan(3);
      expect(p.rotationRad).toBeGreaterThanOrEqual(0);
      expect(p.rotationRad).toBeLessThan(Math.PI * 2);
    }
  });

  it('非法输入抛 RangeError', () => {
    expect(() => nebulaPuffLayout(1, 0, 10, 0.5, 3)).toThrow(RangeError);
    expect(() => nebulaPuffLayout(1, 2.5, 10, 0.5, 3)).toThrow(RangeError);
    expect(() => nebulaPuffLayout(1, 10, 0, 0.5, 3)).toThrow(RangeError);
    expect(() => nebulaPuffLayout(1, 10, 10, 0, 3)).toThrow(RangeError);
    expect(() => nebulaPuffLayout(1, 10, 10, 1.5, 3)).toThrow(RangeError);
    expect(() => nebulaPuffLayout(1, 10, 10, 0.5, 0)).toThrow(RangeError);
  });
});

describe('粒子预算登记（附录 A：全局峰值 ≤20,000）', () => {
  it('逐成员登记覆盖 L3 域序列全部 14 站（sun 已移出序列，登记表同步移除）', () => {
    expect(Object.keys(NEAR_VIEW_PARTICLE_INCREMENTS).sort()).toEqual(
      [...GALAXY_CYCLE_SEQUENCE].sort(),
    );
  });

  it('单目标最大增量 + 太阳活动峰值 ≤ 全局预算（近观同一时刻至多一个目标激活）', () => {
    const increments = Object.values(NEAR_VIEW_PARTICLE_INCREMENTS);
    for (const v of increments) {
      expect(v).toBeGreaterThanOrEqual(0);
    }
    const maxIncrement = Math.max(...increments);
    expect(maxIncrement).toBe(1200); // M13 近观星场
    expect(SOLAR_ACTIVITY_PARTICLE_PEAK + maxIncrement).toBeLessThanOrEqual(
      GLOBAL_PARTICLE_BUDGET,
    );
  });
});
