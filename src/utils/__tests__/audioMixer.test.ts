/**
 * 音效混合逻辑单元测试（需求 3.4.2）
 */

import {
  CROSSFADE_DURATION_SECONDS,
  advanceCrossfade,
  clamp01,
  computeSoundscapeGains,
  startCrossfade,
  type CrossfadeState,
} from '@/utils/audioMixer';
import { VIEW_LEVELS } from '@/types';

const steady = (level: 'L1' | 'L2' | 'L3' | 'L4'): CrossfadeState => ({
  from: level,
  to: level,
  progress: 1,
});

describe('computeSoundscapeGains', () => {
  it('静音时所有增益为 0', () => {
    const gains = computeSoundscapeGains(steady('L2'), 0.8, true);
    for (const level of VIEW_LEVELS) {
      expect(gains[level]).toBe(0);
    }
  });

  it('音量为 0 时所有增益为 0', () => {
    const gains = computeSoundscapeGains(steady('L2'), 0, false);
    for (const level of VIEW_LEVELS) {
      expect(gains[level]).toBe(0);
    }
  });

  it('稳态时仅当前层级有增益且等于主音量', () => {
    const gains = computeSoundscapeGains(steady('L3'), 0.6, false);
    expect(gains.L3).toBeCloseTo(0.6, 10);
    expect(gains.L1).toBe(0);
    expect(gains.L2).toBe(0);
    expect(gains.L4).toBe(0);
  });

  it('过渡中按等功率曲线交叉淡入淡出', () => {
    const state: CrossfadeState = { from: 'L2', to: 'L3', progress: 0.5 };
    const gains = computeSoundscapeGains(state, 1, false);
    expect(gains.L2).toBeCloseTo(Math.sqrt(0.5), 10);
    expect(gains.L3).toBeCloseTo(Math.sqrt(0.5), 10);
    // 等功率：功率和恒等于 1
    expect(gains.L2 ** 2 + gains.L3 ** 2).toBeCloseTo(1, 10);
  });

  it('过渡起点：旧层级满增益、新层级为 0', () => {
    const gains = computeSoundscapeGains({ from: 'L1', to: 'L2', progress: 0 }, 0.5, false);
    expect(gains.L1).toBeCloseTo(0.5, 10);
    expect(gains.L2).toBe(0);
  });

  it('过渡完成后只保留目标层级', () => {
    const gains = computeSoundscapeGains({ from: 'L1', to: 'L2', progress: 1 }, 0.5, false);
    expect(gains.L1).toBe(0);
    expect(gains.L2).toBeCloseTo(0.5, 10);
  });

  it('音量越界被钳制', () => {
    const gains = computeSoundscapeGains(steady('L1'), 5, false);
    expect(gains.L1).toBe(1);
  });
});

describe('startCrossfade', () => {
  it('目标与当前相同时状态不变', () => {
    const state = steady('L2');
    expect(startCrossfade(state, 'L2')).toBe(state);
  });

  it('切换到新层级时从当前淡入目标开始过渡', () => {
    const next = startCrossfade(steady('L2'), 'L3');
    expect(next).toEqual({ from: 'L2', to: 'L3', progress: 0 });
  });

  it('过渡中途再次切换以当前淡入层级为新起点', () => {
    const midway: CrossfadeState = { from: 'L1', to: 'L2', progress: 0.4 };
    const next = startCrossfade(midway, 'L4');
    expect(next).toEqual({ from: 'L2', to: 'L4', progress: 0 });
  });
});

describe('advanceCrossfade', () => {
  it('按默认过渡时长（1–3 秒要求内）推进', () => {
    expect(CROSSFADE_DURATION_SECONDS).toBeGreaterThanOrEqual(1);
    expect(CROSSFADE_DURATION_SECONDS).toBeLessThanOrEqual(3);
    const state: CrossfadeState = { from: 'L1', to: 'L2', progress: 0 };
    const next = advanceCrossfade(state, CROSSFADE_DURATION_SECONDS / 2);
    expect(next.progress).toBeCloseTo(0.5, 10);
  });

  it('进度钳制到 1', () => {
    const next = advanceCrossfade({ from: 'L1', to: 'L2', progress: 0.9 }, 100);
    expect(next.progress).toBe(1);
  });

  it('已完成的过渡直接返回原状态', () => {
    const done: CrossfadeState = { from: 'L1', to: 'L2', progress: 1 };
    expect(advanceCrossfade(done, 1)).toBe(done);
  });

  it('时长非正时立即完成', () => {
    const next = advanceCrossfade({ from: 'L1', to: 'L2', progress: 0 }, 0.1, 0);
    expect(next.progress).toBe(1);
  });
});

describe('clamp01', () => {
  it('钳制到 [0, 1]', () => {
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(0.5)).toBe(0.5);
    expect(clamp01(2)).toBe(1);
  });

  it('NaN 回退为 0', () => {
    expect(clamp01(NaN)).toBe(0);
  });
});
