/**
 * 矮行星音景映射测试（P5 §3.5：无有效大气，复用水星近真空参数）
 */

import {
  DWARF_PLANET_SOUND_PARAMS,
  PLANET_SOUND_PARAMS,
  planetSoundParams,
} from '@/data/sounds';
import { DWARF_PLANETS } from '@/data/smallBodies';

describe('矮行星音景映射（P5 §3.5）', () => {
  it('5 颗矮行星全部有音景映射（与 DWARF_PLANETS 清单一致）', () => {
    for (const d of DWARF_PLANETS) {
      expect(DWARF_PLANET_SOUND_PARAMS[d.id]).toBeDefined();
      expect(planetSoundParams(d.id)).toBe(DWARF_PLANET_SOUND_PARAMS[d.id]);
    }
    expect(Object.keys(DWARF_PLANET_SOUND_PARAMS).sort()).toEqual(
      DWARF_PLANETS.map((d) => d.id).sort(),
    );
  });

  it('复用水星近真空参数（滤波/振荡/增益逐项一致）', () => {
    const mercury = PLANET_SOUND_PARAMS.mercury;
    for (const d of DWARF_PLANETS) {
      const p = DWARF_PLANET_SOUND_PARAMS[d.id];
      expect(p.filterFrequency).toBe(mercury.filterFrequency);
      expect(p.oscillatorFrequency).toBe(mercury.oscillatorFrequency);
      expect(p.noiseGain).toBe(mercury.noiseGain);
      expect(p.oscGain).toBe(mercury.oscGain);
    }
  });

  it('几乎静音：增益远低于地球基准', () => {
    const earth = PLANET_SOUND_PARAMS.earth;
    for (const d of DWARF_PLANETS) {
      const p = DWARF_PLANET_SOUND_PARAMS[d.id];
      expect(p.noiseGain).toBeLessThan(earth.noiseGain * 0.1);
      expect(p.oscGain).toBeLessThan(earth.oscGain * 0.1);
    }
  });

  it('每条映射登记大气特征说明（科学依据）', () => {
    for (const d of DWARF_PLANETS) {
      expect(DWARF_PLANET_SOUND_PARAMS[d.id].noteZh).toContain('近真空');
    }
  });

  it('八大行星差异化音景优先级不受影响；未定义天体仍返回 null', () => {
    expect(planetSoundParams('venus')).toBe(PLANET_SOUND_PARAMS.venus);
    expect(planetSoundParams('moon')).toBeNull();
    expect(planetSoundParams('charon')).toBeNull();
  });
});
