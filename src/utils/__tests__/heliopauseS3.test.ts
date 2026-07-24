/**
 * 日球层顶示意常量校验（S3，IMPROVEMENT_REQUIREMENTS_SOLAR §4.3-4/§6）：
 * 真实距离量级、压缩示意半径、可见层级窗口、科普文案完整性。
 */

import {
  HELIOPAUSE_MAX_OPACITY,
  HELIOPAUSE_NOTE_ZH,
  HELIOPAUSE_REAL_DISTANCE_AU,
  HELIOPAUSE_VISIBLE_LEVEL_MAX,
  HELIOPAUSE_VISIBLE_LEVEL_MIN,
  HELIOPAUSE_VISUAL_RADIUS_UNITS,
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
