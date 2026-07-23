/**
 * P7 人造卫星数据测试（§3.3 天宫数据新增 / §3.2 差异化尺寸数据）
 */

import { MOONS, getMoonById } from '@/data/moons';
import { getBodyInfoById } from '@/data/catalog';
import { planetSoundParams } from '@/data/sounds';

describe('天宫空间站数据（P7 §3.3）', () => {
  const tiangong = getMoonById('tiangong')!;

  it('存在且为地球的人造卫星', () => {
    expect(tiangong).toBeDefined();
    expect(tiangong.parentId).toBe('earth');
    expect(tiangong.kind).toBe('artificial');
  });

  it('轨道高度约 390 km（半长轴 6761 km）、倾角 41.5°、周期约 92.2 分钟', () => {
    expect(tiangong.orbit.semiMajorAxisKm).toBe(6761);
    expect(tiangong.orbit.inclinationDeg).toBe(41.5);
    expect(tiangong.orbit.periodDays * 1440).toBeCloseTo(92.2, 0);
    expect(tiangong.orbit.eccentricity).toBeLessThan(0.01); // 近圆
  });

  it('质量约 1.0×10⁵ kg，T 字构型备注，数据来源标注 CMSA', () => {
    expect(tiangong.massKg).toBe(1.0e5);
    expect(tiangong.noteZh).toContain('T 字构型');
    expect(tiangong.dataSource).toContain('CMSA');
  });

  it('轨道高度略低于 ISS（390 vs 417 km）、倾角低于 ISS（41.5° vs 51.6°）', () => {
    const iss = getMoonById('iss')!;
    expect(tiangong.orbit.semiMajorAxisKm).toBeLessThan(iss.orbit.semiMajorAxisKm);
    expect(tiangong.orbit.inclinationDeg).toBeLessThan(iss.orbit.inclinationDeg);
  });
});

describe('人造卫星真实特征尺寸（P7 §3.2 spanMeters）', () => {
  it('4 颗人造卫星均登记 spanMeters，层次 ISS > 天宫 > TDRS > 哈勃', () => {
    const span = (id: string): number => getMoonById(id)!.spanMeters!;
    expect(span('iss')).toBe(109);
    expect(span('tiangong')).toBe(55);
    expect(span('geo-satellite')).toBe(21);
    expect(span('hubble')).toBe(13.2);
    expect(span('iss')).toBeGreaterThan(span('tiangong'));
    expect(span('tiangong')).toBeGreaterThan(span('geo-satellite'));
    expect(span('geo-satellite')).toBeGreaterThan(span('hubble'));
  });

  it('自然卫星不登记 spanMeters', () => {
    for (const m of MOONS) {
      if (m.kind === 'natural') {
        expect(m.spanMeters).toBeUndefined();
      }
    }
  });
});

describe('TDRS 原型附注更新（P7 §3.1）', () => {
  it('静止轨道卫星备注注明以 TDRS 为原型', () => {
    const geo = getMoonById('geo-satellite')!;
    expect(geo.noteZh).toContain('TDRS');
  });
});

describe('catalog 信息面板联动（P7 §3.5）', () => {
  it('天宫条目存在：类型人造卫星，周期/倾角/高度与 ISS 对照可见', () => {
    const info = getBodyInfoById('tiangong')!;
    expect(info).toBeDefined();
    expect(info.typeZh).toBe('人造卫星');
    expect(info.nameZh).toBe('天宫空间站');
    const labels = info.lines.map((l) => l.label);
    expect(labels).toContain('公转周期');
    expect(labels).toContain('轨道倾角');
    expect(labels).toContain('轨道半长轴');
  });

  it('人造卫星信息面板含真实特征尺寸对照（示意尺寸登记）', () => {
    for (const id of ['iss', 'tiangong', 'hubble', 'geo-satellite']) {
      const info = getBodyInfoById(id)!;
      const spanLine = info.lines.find((l) => l.label === '真实特征尺寸');
      expect(spanLine).toBeDefined();
      const radiusLine = info.lines.find((l) => l.label === '半径');
      expect(radiusLine!.value).toContain('示意尺寸');
    }
  });

  it('ISS/哈勃/天宫备注含结构说明（P7 §3.5）', () => {
    expect(getBodyInfoById('iss')!.lines.find((l) => l.label === '备注')!.value).toContain(
      '桁架',
    );
    expect(getBodyInfoById('hubble')!.lines.find((l) => l.label === '备注')!.value).toContain(
      '主镜',
    );
    expect(getBodyInfoById('tiangong')!.lines.find((l) => l.label === '备注')!.value).toContain(
      '核心舱',
    );
  });
});

describe('音景映射（P7 §3.5：人造卫星复用地球近地轨道处理）', () => {
  it('人造卫星无专属音景（返回 null，调用方回退 L1 地球基准）', () => {
    for (const id of ['iss', 'tiangong', 'hubble', 'geo-satellite']) {
      expect(planetSoundParams(id)).toBeNull();
    }
  });
});
