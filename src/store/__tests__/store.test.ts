/**
 * 全局状态管理单元测试
 */

import { initialSimDays, useSimulationStore } from '@/store';
import { daysSinceJ2000 } from '@/utils/physics';
import { MAX_SPEED_MULTIPLIER } from '@/utils/time';

/** 每个用例前重置到确定状态 */
beforeEach(() => {
  useSimulationStore.setState({
    simDays: 0,
    paused: false,
    speedMultiplier: 1,
    viewLevel: 'L2',
    viewTransitionId: 0,
    showOrbits: true,
    showLabels: true,
    audioEnabled: false,
    audioVolume: 0.6,
    selectedBodyId: null,
  });
});

describe('initialSimDays', () => {
  it('初始模拟时间与真实当前日期一致（J2000 起天数）', () => {
    const now = new Date('2026-07-22T00:00:00Z');
    expect(initialSimDays(now)).toBeCloseTo(daysSinceJ2000(now), 10);
  });

  it('晚于 J2000 的日期返回正值', () => {
    expect(initialSimDays(new Date('2026-01-01T00:00:00Z'))).toBeGreaterThan(0);
  });
});

describe('tick（时间推进）', () => {
  it('L2 视角 1 秒推进 4 个模拟天', () => {
    useSimulationStore.getState().tick(1);
    expect(useSimulationStore.getState().simDays).toBeCloseTo(4, 10);
  });

  it('暂停时不推进', () => {
    useSimulationStore.getState().setPaused(true);
    useSimulationStore.getState().tick(1);
    expect(useSimulationStore.getState().simDays).toBe(0);
  });

  it('速度倍率影响推进量', () => {
    useSimulationStore.getState().setSpeedMultiplier(10);
    useSimulationStore.getState().tick(1);
    expect(useSimulationStore.getState().simDays).toBeCloseTo(40, 10);
  });
});

describe('暂停与速度控制', () => {
  it('togglePaused 切换暂停状态', () => {
    useSimulationStore.getState().togglePaused();
    expect(useSimulationStore.getState().paused).toBe(true);
    useSimulationStore.getState().togglePaused();
    expect(useSimulationStore.getState().paused).toBe(false);
  });

  it('速度倍率越界被钳制', () => {
    useSimulationStore.getState().setSpeedMultiplier(1e9);
    expect(useSimulationStore.getState().speedMultiplier).toBe(MAX_SPEED_MULTIPLIER);
    useSimulationStore.getState().setSpeedMultiplier(-5);
    expect(useSimulationStore.getState().speedMultiplier).toBe(0);
  });
});

describe('视角切换', () => {
  it('切换层级并递增过渡代次', () => {
    useSimulationStore.getState().setViewLevel('L3');
    expect(useSimulationStore.getState().viewLevel).toBe('L3');
    expect(useSimulationStore.getState().viewTransitionId).toBe(1);
  });

  it('重复设置相同层级不触发新过渡', () => {
    useSimulationStore.getState().setViewLevel('L2');
    expect(useSimulationStore.getState().viewTransitionId).toBe(0);
  });

  it('连续切换代次持续递增', () => {
    useSimulationStore.getState().setViewLevel('L1');
    useSimulationStore.getState().setViewLevel('L4');
    expect(useSimulationStore.getState().viewTransitionId).toBe(2);
  });
});

describe('显示与音效开关', () => {
  it('轨道线与标签开关', () => {
    useSimulationStore.getState().setShowOrbits(false);
    expect(useSimulationStore.getState().showOrbits).toBe(false);
    useSimulationStore.getState().setShowLabels(false);
    expect(useSimulationStore.getState().showLabels).toBe(false);
  });

  it('音效开关与 toggleAudio', () => {
    useSimulationStore.getState().setAudioEnabled(true);
    expect(useSimulationStore.getState().audioEnabled).toBe(true);
    useSimulationStore.getState().toggleAudio();
    expect(useSimulationStore.getState().audioEnabled).toBe(false);
  });

  it('音量钳制到 [0, 1]', () => {
    useSimulationStore.getState().setAudioVolume(2);
    expect(useSimulationStore.getState().audioVolume).toBe(1);
    useSimulationStore.getState().setAudioVolume(-1);
    expect(useSimulationStore.getState().audioVolume).toBe(0);
  });
});

describe('天体选择与时间重置', () => {
  it('选择与取消选择天体', () => {
    useSimulationStore.getState().selectBody('earth');
    expect(useSimulationStore.getState().selectedBodyId).toBe('earth');
    useSimulationStore.getState().selectBody(null);
    expect(useSimulationStore.getState().selectedBodyId).toBeNull();
  });

  it('resetToNow 重置为真实当前时间', () => {
    useSimulationStore.getState().tick(100);
    useSimulationStore.getState().resetToNow();
    const expected = daysSinceJ2000(new Date());
    expect(useSimulationStore.getState().simDays).toBeCloseTo(expected, 3);
  });
});
