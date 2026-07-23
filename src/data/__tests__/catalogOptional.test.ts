/**
 * 天体信息目录可选项扩展测试（需求 3.5.2 / 7 单元测试）：
 * 质量字段（formatMassKg）/ 矮行星条目 / 奥尔特云条目 / 卫星逆行标注
 */

import { formatMassKg, getBodyInfoById } from '@/data/catalog';
import type { BodyInfo } from '@/data/catalog';
import { DWARF_PLANETS } from '@/data/smallBodies';

/** 取某标签行的值（断言其存在） */
function lineValue(info: BodyInfo, label: string): string {
  const line = info.lines.find((l) => l.label === label);
  expect(line).toBeDefined();
  return line!.value;
}

describe('formatMassKg（科学计数法质量格式化）', () => {
  it('地球质量 5.97e24 → 5.97×10²⁴ kg', () => {
    expect(formatMassKg(5.97e24)).toBe('5.97×10²⁴ kg');
  });

  it('太阳质量 1.989e30 → 1.99×10³⁰ kg（保留两位小数）', () => {
    expect(formatMassKg(1.989e30)).toBe('1.99×10³⁰ kg');
  });

  it('小质量（ISS 4.5e5 kg）与非 10 的幂正常格式化', () => {
    expect(formatMassKg(4.5e5)).toBe('4.50×10⁵ kg');
    expect(formatMassKg(1)).toBe('1.00×10⁰ kg');
  });

  it('非法质量抛出 RangeError', () => {
    expect(() => formatMassKg(0)).toThrow(RangeError);
    expect(() => formatMassKg(-1e24)).toThrow(RangeError);
    expect(() => formatMassKg(Number.NaN)).toThrow(RangeError);
    expect(() => formatMassKg(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe('质量行（需求 3.5.2 信息面板补充质量字段）', () => {
  it('太阳 / 地球 / 月球均含质量行', () => {
    expect(lineValue(getBodyInfoById('sun')!, '质量')).toContain('×10³⁰ kg');
    expect(lineValue(getBodyInfoById('earth')!, '质量')).toContain('×10²⁴ kg');
    expect(lineValue(getBodyInfoById('moon')!, '质量')).toContain('×10²² kg');
  });

  it('哈雷彗星含质量行', () => {
    expect(lineValue(getBodyInfoById('halley')!, '质量')).toContain('×10¹⁴ kg');
  });
});

describe('矮行星条目（需求 3.1.1 / P5 §3.1）', () => {
  it('五颗矮行星均可查到且类型为矮行星、含轨道倾角行', () => {
    expect(DWARF_PLANETS).toHaveLength(5);
    for (const d of DWARF_PLANETS) {
      const info = getBodyInfoById(d.id)!;
      expect(info.typeZh).toBe('矮行星');
      lineValue(info, '轨道倾角');
      lineValue(info, '质量');
    }
  });

  it('冥王星保留海王星共振行，其他矮行星无共振行', () => {
    expect(lineValue(getBodyInfoById('pluto')!, '共振')).toContain('海王星 2:3');
    for (const id of ['ceres', 'eris', 'makemake', 'haumea']) {
      const info = getBodyInfoById(id)!;
      expect(info.lines.find((l) => l.label === '共振')).toBeUndefined();
    }
  });

  it('阋神星轨道倾角行标注 44.0°', () => {
    expect(lineValue(getBodyInfoById('eris')!, '轨道倾角')).toBe('44.0°');
  });

  it('谷神星附注小行星带与 Dawn 探测（P5 §3.1）', () => {
    const note = lineValue(getBodyInfoById('ceres')!, '备注');
    expect(note).toContain('小行星带中最大天体');
    expect(note).toContain('Dawn');
  });

  it('无实拍图的三颗注明表面为艺术化呈现（P5 §3.4 登记）', () => {
    for (const id of ['eris', 'makemake', 'haumea']) {
      expect(lineValue(getBodyInfoById(id)!, '备注')).toContain('艺术化呈现');
    }
  });

  it('妊神星含三轴椭球形状行（P5 §3.4）', () => {
    expect(lineValue(getBodyInfoById('haumea')!, '形状')).toContain('2100×1680×1074');
  });
});

describe('冥卫一卡戎条目（P5 §3.4 可选项）', () => {
  it('类型为卫星、潮汐锁定、附注共同质心位于冥王星体外', () => {
    const info = getBodyInfoById('charon')!;
    expect(info.typeZh).toBe('卫星');
    expect(lineValue(info, '潮汐锁定')).toBe('是');
    expect(lineValue(info, '备注')).toContain('共同质心位于冥王星体外');
    expect(lineValue(info, '公转周期')).toBe('6.39 天');
  });
});

describe('奥尔特云条目（可选需求 3.1.1）', () => {
  it('含内外缘与示意说明行', () => {
    const info = getBodyInfoById('oort-cloud')!;
    expect(info.typeZh).toContain('太阳系外围');
    expect(lineValue(info, '内缘')).toContain('2,000 AU');
    expect(lineValue(info, '外缘')).toContain('100,000 AU');
    expect(lineValue(info, '示意说明')).toContain('已登记');
    expect(info.dataSource).toContain('NASA');
  });
});

describe('卫星逆行标注（海卫一，可选需求 3.1.1）', () => {
  it('海卫一轨道倾角行标注（逆行）', () => {
    expect(lineValue(getBodyInfoById('triton')!, '轨道倾角')).toContain('（逆行）');
  });

  it('顺行卫星（月球）不标注逆行', () => {
    expect(lineValue(getBodyInfoById('moon')!, '轨道倾角')).not.toContain('逆行');
  });
});
