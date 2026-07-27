/**
 * 太阳结构科普数据校验（S2，IMPROVEMENT_REQUIREMENTS_SOLAR §4.1/§4.5/§6）：
 * 六层结构完整性、分层边界与标准太阳模型一致、来源字段完整
 */

import {
  CME_GEOMAGNETIC_NOTE_ZH,
  CORONAL_HEATING_NOTE_ZH,
  FLARE_ENERGY_NOTE_ZH,
  HALE_POLARITY_NOTE_ZH,
  SOLAR_WIND_NOTE_ZH,
  SUN_LAYERS,
  SUN_STRUCTURE_DATA_SOURCE,
  getSunLayerById,
} from '@/data/sunStructure';
import { SUN_CORE_OUTER_FRAC, SUN_RADIATIVE_OUTER_FRAC } from '@/utils/sunCutaway';

describe('SUN_LAYERS（六层结构）', () => {
  it('从内到外恰好六层且顺序正确', () => {
    expect(SUN_LAYERS.map((l) => l.id)).toEqual([
      'core',
      'radiative',
      'convective',
      'photosphere',
      'chromosphere',
      'corona',
    ]);
  });

  it('每层字段完整（名称/范围/温度/科普）', () => {
    for (const layer of SUN_LAYERS) {
      expect(layer.nameZh.length).toBeGreaterThan(0);
      expect(layer.name.length).toBeGreaterThan(0);
      expect(layer.rangeZh.length).toBeGreaterThan(0);
      expect(layer.temperatureZh.length).toBeGreaterThan(0);
      expect(layer.descriptionZh.length).toBeGreaterThan(10);
    }
  });

  it('分层边界与标准太阳模型一致（0.25/0.7 R☉）', () => {
    expect(getSunLayerById('core')!.rangeZh).toContain(`${SUN_CORE_OUTER_FRAC}`);
    expect(getSunLayerById('radiative')!.rangeZh).toContain(`${SUN_RADIATIVE_OUTER_FRAC}`);
  });

  it('辐射区科普含光子随机游走与差旋层（§4.1）', () => {
    const radiative = getSunLayerById('radiative')!;
    expect(radiative.descriptionZh).toContain('随机游走');
    expect(radiative.descriptionZh).toContain('差旋层');
  });

  it('日冕层解释加热问题（反直觉现象，§4.2）', () => {
    expect(getSunLayerById('corona')!.descriptionZh).toContain('日冕加热问题');
  });

  it('未知 id 返回 undefined', () => {
    expect(getSunLayerById('mantle')).toBeUndefined();
  });
});

describe('科普文案与数据来源', () => {
  it('日冕加热/Hale 极性/耀斑能量/地磁暴/太阳风文案完整', () => {
    expect(CORONAL_HEATING_NOTE_ZH).toContain('未解之谜');
    expect(HALE_POLARITY_NOTE_ZH).toContain('成对');
    expect(FLARE_ENERGY_NOTE_ZH).toContain('氢弹');
    expect(CME_GEOMAGNETIC_NOTE_ZH).toContain('地磁暴');
    expect(SOLAR_WIND_NOTE_ZH).toContain('太阳圈');
  });

  it('数据来源标注 NASA 与标准太阳模型文献', () => {
    expect(SUN_STRUCTURE_DATA_SOURCE).toContain('NASA');
    expect(SUN_STRUCTURE_DATA_SOURCE).toContain('Christensen-Dalsgaard');
  });
});
