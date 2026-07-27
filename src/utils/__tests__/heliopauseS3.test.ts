/**
 * 日球层顶示意常量校验（S3，IMPROVEMENT_REQUIREMENTS_SOLAR §4.3-4/§6）：
 * 真实距离量级、压缩示意半径、可见层级窗口、科普文案完整性；
 * R3 需求 3：球壳 raycast 门控（L3 银河系视角下不遮挡太阳系外天体点击）。
 */

import {
  HELIOPAUSE_MAX_OPACITY,
  HELIOPAUSE_NOTE_ZH,
  HELIOPAUSE_RAYCAST_LEVEL_MAX,
  HELIOPAUSE_REAL_DISTANCE_AU,
  HELIOPAUSE_VISIBLE_LEVEL_MAX,
  HELIOPAUSE_VISIBLE_LEVEL_MIN,
  HELIOPAUSE_VISUAL_RADIUS_UNITS,
  heliopauseRaycastEnabled,
  heliopauseVisibilityWeight,
} from '@/utils/heliopause';

describe('日球层顶常量', () => {
  it('真实距离为 Voyager 实测量级（~120 AU）', () => {
    expect(HELIOPAUSE_REAL_DISTANCE_AU).toBeGreaterThanOrEqual(110);
    expect(HELIOPAUSE_REAL_DISTANCE_AU).toBeLessThanOrEqual(130);
  });

  it('示意半径为正且远小于真实距离对应场景单位（压缩登记）', () => {
    expect(HELIOPAUSE_VISUAL_RADIUS_UNITS).toBeGreaterThan(0);
    // 真实 120 AU × 10 单位/AU = 1200 单位，示意值应显著压缩
    expect(HELIOPAUSE_VISUAL_RADIUS_UNITS).toBeLessThan(HELIOPAUSE_REAL_DISTANCE_AU * 10);
  });

  it('可见层级窗口位于 L2 段且区间有效', () => {
    expect(HELIOPAUSE_VISIBLE_LEVEL_MIN).toBeLessThan(HELIOPAUSE_VISIBLE_LEVEL_MAX);
    expect(HELIOPAUSE_VISIBLE_LEVEL_MIN).toBeGreaterThanOrEqual(1);
    expect(HELIOPAUSE_VISIBLE_LEVEL_MAX).toBeLessThanOrEqual(4);
  });

  it('透明度微弱（不喧宾夺主）', () => {
    expect(HELIOPAUSE_MAX_OPACITY).toBeGreaterThan(0);
    expect(HELIOPAUSE_MAX_OPACITY).toBeLessThan(0.2);
  });

  it('科普文案含真实距离与探测器信息', () => {
    expect(HELIOPAUSE_NOTE_ZH).toContain('120 AU');
    expect(HELIOPAUSE_NOTE_ZH).toContain('旅行者');
  });
});

describe('heliopauseRaycastEnabled 球壳点选门控（R3 需求 3）', () => {
  it('raycast 层级上限为 L2/L3 分界（2.5）', () => {
    expect(HELIOPAUSE_RAYCAST_LEVEL_MAX).toBe(2.5);
  });

  it('L2 太阳系视角内（可见且层级 < 2.5）可点选（保留科普入口）', () => {
    for (const level of [2.2, 2.4, 2.49]) {
      const weight = heliopauseVisibilityWeight(level, false);
      expect(weight).toBeGreaterThan(0.05);
      expect(heliopauseRaycastEnabled(level, false, weight)).toBe(true);
    }
  });

  it('L3 银河系视角（层级 ≥ 2.5）禁用 raycast——即使可见度权重仍大于阈值', () => {
    for (const level of [2.5, 2.6, 2.7]) {
      const weight = heliopauseVisibilityWeight(level, false);
      expect(weight).toBeGreaterThan(0.05);
      expect(heliopauseRaycastEnabled(level, false, weight)).toBe(false);
    }
    expect(heliopauseRaycastEnabled(3.0, false, heliopauseVisibilityWeight(3.0, false))).toBe(
      false,
    );
  });

  it('近乎隐形（权重 ≤ 0.05）不拦截点击（原有行为保持）', () => {
    expect(heliopauseRaycastEnabled(1.2, false, 0)).toBe(false);
    expect(heliopauseRaycastEnabled(2.0, false, 0.05)).toBe(false);
  });

  it('跟随/飞往日球层顶或旅行者标记期间（focused）任意层级可点选', () => {
    expect(heliopauseRaycastEnabled(3.0, true, 1)).toBe(true);
    expect(heliopauseRaycastEnabled(1.0, true, 0)).toBe(true);
    expect(heliopauseRaycastEnabled(4.0, true, 0)).toBe(true);
  });

  it('非法输入抛 RangeError', () => {
    expect(() => heliopauseRaycastEnabled(Number.NaN, false, 1)).toThrow(RangeError);
    expect(() => heliopauseRaycastEnabled(2, false, Number.NaN)).toThrow(RangeError);
  });
});
