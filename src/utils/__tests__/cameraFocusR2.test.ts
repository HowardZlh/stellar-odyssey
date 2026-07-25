/**
 * R2-1 外围结构飞往解析测试（IMPROVEMENT_REQUIREMENTS_2 §R2-1 §1.1-B）
 *
 * 覆盖：日球层顶/奥尔特云球壳解析分支、未知 id null 兜底、
 * 聚焦期间可见度权重提升（防层级门控淡出）。
 */

import {
  MAX_VIEW_DISTANCE_UNITS,
  SHELL_VIEW_DISTANCE_RATIO,
  resolveFocusTarget,
  shellFocusTarget,
} from '@/utils/cameraFocus';
import {
  HELIOPAUSE_VISIBLE_LEVEL_MAX,
  HELIOPAUSE_VISIBLE_LEVEL_MIN,
  HELIOPAUSE_VISUAL_RADIUS_UNITS,
  heliopauseVisibilityWeight,
} from '@/utils/heliopause';
import {
  OORT_VISIBLE_LEVEL_MAX,
  OORT_VISIBLE_LEVEL_MIN,
  OORT_VISUAL_RADIUS_UNITS,
  oortVisibilityWeight,
} from '@/utils/oort';
import { continuousLevelForDistance, eclipticToScene } from '@/utils/scale';
import { getPlanetById } from '@/data/planets';
import { equivalentDaysForPhase } from '@/utils/freezeGate';
import {
  DAYS_PER_YEAR,
  heliocentricPosition,
  meanAnomalyAtTime,
  normalizeAngle,
  orbitalPeriodYears,
} from '@/utils/physics';
import {
  clearAllRenderedSatellitePhases,
  setRenderedSatellitePhase,
} from '@/utils/satellitePhase';

describe('shellFocusTarget（太阳系外围球壳解析，R2-1）', () => {
  it('日球层顶：目标点为太阳系原点', () => {
    const target = shellFocusTarget('heliopause');
    expect(target).not.toBeNull();
    expect(target!.position).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('日球层顶：观察距离 = 2.2 × 示意半径（能看清整个球壳）', () => {
    const target = shellFocusTarget('heliopause')!;
    expect(target.viewDistanceUnits).toBeCloseTo(
      HELIOPAUSE_VISUAL_RADIUS_UNITS * SHELL_VIEW_DISTANCE_RATIO,
      10,
    );
    // 半径 380 → 观察距离 836，位于球壳外侧且不超过全局上限
    expect(target.viewDistanceUnits).toBeGreaterThan(HELIOPAUSE_VISUAL_RADIUS_UNITS);
    expect(target.viewDistanceUnits).toBeLessThanOrEqual(MAX_VIEW_DISTANCE_UNITS);
  });

  it('奥尔特云：目标点为原点、观察距离 = 2.2 × 示意半径', () => {
    const target = shellFocusTarget('oort-cloud')!;
    expect(target.position).toEqual({ x: 0, y: 0, z: 0 });
    expect(target.viewDistanceUnits).toBeCloseTo(
      OORT_VISUAL_RADIUS_UNITS * SHELL_VIEW_DISTANCE_RATIO,
      10,
    );
  });

  it('非球壳结构 id 返回 null', () => {
    expect(shellFocusTarget('earth')).toBeNull();
    expect(shellFocusTarget('unknown-body')).toBeNull();
    expect(shellFocusTarget('')).toBeNull();
  });
});

describe('resolveFocusTarget 球壳分支与 null 兜底（R2-1）', () => {
  it('heliopause 可解析（消除假跟随死锁）', () => {
    const target = resolveFocusTarget('heliopause', 0);
    expect(target).not.toBeNull();
    expect(target!.position).toEqual({ x: 0, y: 0, z: 0 });
    expect(target!.viewDistanceUnits).toBeCloseTo(
      HELIOPAUSE_VISUAL_RADIUS_UNITS * SHELL_VIEW_DISTANCE_RATIO,
      10,
    );
  });

  it('oort-cloud 可解析', () => {
    const target = resolveFocusTarget('oort-cloud', 0);
    expect(target).not.toBeNull();
    expect(target!.viewDistanceUnits).toBeCloseTo(
      OORT_VISUAL_RADIUS_UNITS * SHELL_VIEW_DISTANCE_RATIO,
      10,
    );
  });

  it('真实比例模式下球壳解析不变（示意结构不参与比例切换）', () => {
    const normal = resolveFocusTarget('heliopause', 123.45, false)!;
    const real = resolveFocusTarget('heliopause', 123.45, true)!;
    expect(real).toEqual(normal);
  });

  it('未知 id 仍返回 null（调用方兜底依据）', () => {
    expect(resolveFocusTarget('no-such-body', 0)).toBeNull();
    expect(resolveFocusTarget('sn-1', 0)).toBeNull();
  });
});

describe('行星/彗星速率钳制期间按渲染相位解析（R2-3，P7 范式扩展）', () => {
  afterEach(() => clearAllRenderedSatellitePhases());

  it('地球注册渲染相位后目标位置随注册相位（与渲染一致），清除后回落精确相位', () => {
    const simDays = 8000;
    const exact = resolveFocusTarget('earth', simDays)!;
    // 注册与精确相位偏差半圈的渲染相位（钳制中累计相位落后场景）
    const earth = getPlanetById('earth')!;
    const periodDays = orbitalPeriodYears(earth.orbit.semiMajorAxisAu) * DAYS_PER_YEAR;
    const exactPhase = meanAnomalyAtTime(earth.orbit, simDays);
    setRenderedSatellitePhase('earth', normalizeAngle(exactPhase + Math.PI));
    const clamped = resolveFocusTarget('earth', simDays)!;
    const dist = Math.hypot(
      clamped.position.x - exact.position.x,
      clamped.position.y - exact.position.y,
      clamped.position.z - exact.position.z,
    );
    expect(dist).toBeGreaterThan(1); // 半圈偏差 → 目标点明显不同（跟随渲染位置）
    // 注册相位对应的等效时间求值与直接按相位求值一致
    const equivDays = equivalentDaysForPhase(
      normalizeAngle(exactPhase + Math.PI),
      earth.orbit.meanAnomalyAtEpochDeg,
      periodDays,
    );
    const expected = eclipticToScene(heliocentricPosition(earth.orbit, equivDays));
    expect(clamped.position.x).toBeCloseTo(expected.x, 8);
    expect(clamped.position.z).toBeCloseTo(expected.z, 8);
    // 清除注册（钳制解除）后回落共享时间轴精确求值
    clearAllRenderedSatellitePhases();
    const restored = resolveFocusTarget('earth', simDays)!;
    expect(restored.position).toEqual(exact.position);
  });

  it('哈雷彗星注册渲染相位后同样按渲染相位解析', () => {
    const simDays = 5000;
    const exact = resolveFocusTarget('halley', simDays)!;
    setRenderedSatellitePhase('halley', 1.0);
    const clamped = resolveFocusTarget('halley', simDays)!;
    expect(
      Math.hypot(
        clamped.position.x - exact.position.x,
        clamped.position.y - exact.position.y,
        clamped.position.z - exact.position.z,
      ),
    ).toBeGreaterThan(0);
  });

  it('钳制行星的卫星按父行星渲染相位解析（月球随地球渲染位置）', () => {
    const simDays = 8000;
    const exactMoon = resolveFocusTarget('moon', simDays)!;
    const earth = getPlanetById('earth')!;
    const exactPhase = meanAnomalyAtTime(earth.orbit, simDays);
    setRenderedSatellitePhase('earth', normalizeAngle(exactPhase + Math.PI));
    const clampedMoon = resolveFocusTarget('moon', simDays)!;
    expect(
      Math.hypot(
        clampedMoon.position.x - exactMoon.position.x,
        clampedMoon.position.y - exactMoon.position.y,
        clampedMoon.position.z - exactMoon.position.z,
      ),
    ).toBeGreaterThan(1);
  });
});

describe('heliopauseVisibilityWeight（聚焦权重提升，R2-1）', () => {
  it('常态：窗口内满值、窗口外为 0、边缘线性过渡', () => {
    expect(heliopauseVisibilityWeight(2.4, false)).toBe(1);
    expect(heliopauseVisibilityWeight(1.0, false)).toBe(0);
    expect(heliopauseVisibilityWeight(HELIOPAUSE_VISIBLE_LEVEL_MAX, false)).toBe(0);
    expect(heliopauseVisibilityWeight(HELIOPAUSE_VISIBLE_LEVEL_MIN, false)).toBe(0);
    // 淡出沿（2.7 → 3.0）中点权重 0.5
    expect(heliopauseVisibilityWeight(2.85, false)).toBeCloseTo(0.5, 10);
  });

  it('聚焦期间任意层级权重恒为 1（防淡出）', () => {
    expect(heliopauseVisibilityWeight(3.0, true)).toBe(1);
    expect(heliopauseVisibilityWeight(4.0, true)).toBe(1);
    expect(heliopauseVisibilityWeight(1.0, true)).toBe(1);
  });

  it('飞往落点层级位于可见窗口内（观察距离与窗口联动自洽）', () => {
    const level = continuousLevelForDistance(
      HELIOPAUSE_VISUAL_RADIUS_UNITS * SHELL_VIEW_DISTANCE_RATIO,
    );
    // 落点 ~836 单位 → 连续层级 ~2.65，常态权重即为满值
    expect(level).toBeGreaterThan(HELIOPAUSE_VISIBLE_LEVEL_MIN);
    expect(level).toBeLessThan(HELIOPAUSE_VISIBLE_LEVEL_MAX);
    expect(heliopauseVisibilityWeight(level, false)).toBe(1);
  });

  it('非有限层级抛错', () => {
    expect(() => heliopauseVisibilityWeight(Number.NaN, false)).toThrow(RangeError);
    expect(() => heliopauseVisibilityWeight(Number.POSITIVE_INFINITY, true)).toThrow(RangeError);
  });
});

describe('oortVisibilityWeight（聚焦权重提升，R2-1）', () => {
  it('常态：与原内联梯形窗口一致（2.1/2.4/2.7/3.1）', () => {
    expect(oortVisibilityWeight(2.5, false)).toBe(1);
    expect(oortVisibilityWeight(OORT_VISIBLE_LEVEL_MIN, false)).toBe(0);
    expect(oortVisibilityWeight(OORT_VISIBLE_LEVEL_MAX, false)).toBe(0);
    expect(oortVisibilityWeight(2.9, false)).toBeCloseTo(0.5, 10);
  });

  it('聚焦期间权重恒为 1：飞往落点层级（~3.18）已越过窗口上缘，不提升则不可见', () => {
    const level = continuousLevelForDistance(
      OORT_VISUAL_RADIUS_UNITS * SHELL_VIEW_DISTANCE_RATIO,
    );
    expect(level).toBeGreaterThan(OORT_VISIBLE_LEVEL_MAX);
    expect(oortVisibilityWeight(level, false)).toBe(0);
    expect(oortVisibilityWeight(level, true)).toBe(1);
  });

  it('非有限层级抛错', () => {
    expect(() => oortVisibilityWeight(Number.NaN, false)).toThrow(RangeError);
  });
});
