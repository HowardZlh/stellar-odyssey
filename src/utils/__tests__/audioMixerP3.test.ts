/**
 * L1 行星差异化音景混合测试（P3-6，需求 §3.4.1）
 */

import type { PlanetAmbienceTransition, SoundParams } from '@/utils/audioMixer';
import {
  PLANET_AMBIENCE_FADE_SECONDS,
  advancePlanetAmbienceTransition,
  mixSoundParams,
  startPlanetAmbienceTransition,
} from '@/utils/audioMixer';

const EARTH: SoundParams = { filterFrequency: 500, oscillatorFrequency: 55, noiseGain: 2.4, oscGain: 0.5 };
const VENUS: SoundParams = { filterFrequency: 170, oscillatorFrequency: 36, noiseGain: 3.0, oscGain: 1.3 };

describe('mixSoundParams 参数混合', () => {
  it('t=0 返回起点参数、t=1 返回终点参数', () => {
    expect(mixSoundParams(EARTH, VENUS, 0)).toEqual(EARTH);
    const end = mixSoundParams(EARTH, VENUS, 1);
    expect(end.filterFrequency).toBeCloseTo(VENUS.filterFrequency);
    expect(end.oscillatorFrequency).toBeCloseTo(VENUS.oscillatorFrequency);
    expect(end.noiseGain).toBeCloseTo(VENUS.noiseGain);
    expect(end.oscGain).toBeCloseTo(VENUS.oscGain);
  });

  it('频率按对数插值（听感线性）：中点为几何平均', () => {
    const mid = mixSoundParams(EARTH, VENUS, 0.5);
    expect(mid.filterFrequency).toBeCloseTo(Math.sqrt(500 * 170));
    expect(mid.oscillatorFrequency).toBeCloseTo(Math.sqrt(55 * 36));
  });

  it('增益线性插值：中点为算术平均', () => {
    const mid = mixSoundParams(EARTH, VENUS, 0.5);
    expect(mid.noiseGain).toBeCloseTo((2.4 + 3.0) / 2);
    expect(mid.oscGain).toBeCloseTo((0.5 + 1.3) / 2);
  });

  it('进度超界钳制到 [0, 1]', () => {
    expect(mixSoundParams(EARTH, VENUS, -1)).toEqual(EARTH);
    expect(mixSoundParams(EARTH, VENUS, 2).filterFrequency).toBeCloseTo(170);
  });

  it('非法频率（非正数）抛错', () => {
    const bad = { ...EARTH, filterFrequency: 0 };
    expect(() => mixSoundParams(bad, VENUS, 0.5)).toThrow(RangeError);
  });
});

describe('startPlanetAmbienceTransition 过渡启动', () => {
  const idle: PlanetAmbienceTransition = { fromId: null, toId: 'earth', progress: 1 };

  it('目标不变时维持原状态（幂等）', () => {
    expect(startPlanetAmbienceTransition(idle, 'earth')).toBe(idle);
  });

  it('新目标以当前淡入目标为新起点、进度归零', () => {
    const next = startPlanetAmbienceTransition(idle, 'venus');
    expect(next).toEqual({ fromId: 'earth', toId: 'venus', progress: 0 });
  });

  it('过渡中途切换目标：起点为原淡入目标（无跳变）', () => {
    const inFlight: PlanetAmbienceTransition = { fromId: 'earth', toId: 'venus', progress: 0.4 };
    const next = startPlanetAmbienceTransition(inFlight, 'mars');
    expect(next).toEqual({ fromId: 'venus', toId: 'mars', progress: 0 });
  });

  it('回到基准（null）也是一次正常过渡', () => {
    const next = startPlanetAmbienceTransition(idle, null);
    expect(next).toEqual({ fromId: 'earth', toId: null, progress: 0 });
  });
});

describe('advancePlanetAmbienceTransition 过渡推进', () => {
  it('按时长比例推进（默认 2 秒，符合需求 1–3 秒）', () => {
    expect(PLANET_AMBIENCE_FADE_SECONDS).toBeGreaterThanOrEqual(1);
    expect(PLANET_AMBIENCE_FADE_SECONDS).toBeLessThanOrEqual(3);
    const state: PlanetAmbienceTransition = { fromId: null, toId: 'venus', progress: 0 };
    const next = advancePlanetAmbienceTransition(state, 1);
    expect(next.progress).toBeCloseTo(1 / PLANET_AMBIENCE_FADE_SECONDS);
  });

  it('进度钳制到 1', () => {
    const state: PlanetAmbienceTransition = { fromId: null, toId: 'venus', progress: 0.9 };
    expect(advancePlanetAmbienceTransition(state, 10).progress).toBe(1);
  });

  it('已完成的过渡不再变化（返回原对象）', () => {
    const done: PlanetAmbienceTransition = { fromId: null, toId: 'venus', progress: 1 };
    expect(advancePlanetAmbienceTransition(done, 1)).toBe(done);
  });

  it('时长非正时立即完成（防御性）', () => {
    const state: PlanetAmbienceTransition = { fromId: null, toId: 'venus', progress: 0 };
    expect(advancePlanetAmbienceTransition(state, 0.1, 0).progress).toBe(1);
  });
});
