/**
 * L1 行星差异化音景数据测试（P3-6，需求 §3.4.1）
 *
 * 音景参数须与各行星大气特征相符（科学依据登记于 data/sounds.ts）。
 */

import {
  PLANET_SOUND_PARAMS,
  PROCEDURAL_SOUND_PARAMS,
  planetSoundParams,
} from '@/data/sounds';
import { PLANETS } from '@/data/planets';

describe('行星音景参数覆盖', () => {
  it('八大行星全部有差异化音景参数', () => {
    for (const planet of PLANETS) {
      expect(PLANET_SOUND_PARAMS[planet.id]).toBeDefined();
    }
  });

  it('每颗行星附带大气特征说明（科学性登记）', () => {
    for (const params of Object.values(PLANET_SOUND_PARAMS)) {
      expect(params.noteZh.length).toBeGreaterThan(0);
    }
  });

  it('地球参数与 L1 基准一致（现状基准不变）', () => {
    const earth = PLANET_SOUND_PARAMS.earth;
    expect(earth.filterFrequency).toBe(PROCEDURAL_SOUND_PARAMS.L1.filterFrequency);
    expect(earth.oscillatorFrequency).toBe(PROCEDURAL_SOUND_PARAMS.L1.oscillatorFrequency);
    expect(earth.noiseGain).toBe(PROCEDURAL_SOUND_PARAMS.L1.noiseGain);
    expect(earth.oscGain).toBe(PROCEDURAL_SOUND_PARAMS.L1.oscGain);
  });
});

describe('大气特征与参数相符', () => {
  it('水星近真空：几乎静音（增益远小于地球）', () => {
    const mercury = PLANET_SOUND_PARAMS.mercury;
    expect(mercury.noiseGain).toBeLessThan(0.1);
    expect(mercury.oscGain).toBeLessThan(0.1);
    expect(mercury.noteZh).toContain('真空');
  });

  it('金星浓密大气：低频沉闷（滤波频率低于地球、噪声更强）', () => {
    const venus = PLANET_SOUND_PARAMS.venus;
    const earth = PLANET_SOUND_PARAMS.earth;
    expect(venus.filterFrequency).toBeLessThan(earth.filterFrequency);
    expect(venus.noiseGain).toBeGreaterThan(earth.noiseGain);
  });

  it('火星稀薄大气：高频微弱（滤波频率高于地球、增益更小）', () => {
    const mars = PLANET_SOUND_PARAMS.mars;
    const earth = PLANET_SOUND_PARAMS.earth;
    expect(mars.filterFrequency).toBeGreaterThan(earth.filterFrequency);
    expect(mars.noiseGain).toBeLessThan(earth.noiseGain);
  });

  it('气态/冰巨行星：深沉轰鸣（振荡基频低于地球、振荡增益更大）', () => {
    const earth = PLANET_SOUND_PARAMS.earth;
    for (const id of ['jupiter', 'saturn', 'uranus', 'neptune']) {
      const giant = PLANET_SOUND_PARAMS[id];
      expect(giant.oscillatorFrequency).toBeLessThan(earth.oscillatorFrequency);
      expect(giant.oscGain).toBeGreaterThan(earth.oscGain);
    }
  });
});

describe('planetSoundParams 查询', () => {
  it('已定义行星返回参数', () => {
    expect(planetSoundParams('venus')).toBe(PLANET_SOUND_PARAMS.venus);
  });

  it('null 与未定义天体返回 null（回退地球基准由调用方处理）', () => {
    expect(planetSoundParams(null)).toBeNull();
    expect(planetSoundParams('moon')).toBeNull();
    expect(planetSoundParams('halley')).toBeNull();
  });
});
