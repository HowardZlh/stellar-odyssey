/**
 * 可选项新增卫星数据测试（可选需求 3.1.1 / 7 单元测试）：
 * 静止轨道卫星 / 火星卫星 / 土星卫星补充 / 海卫一逆行轨道
 */

import { getMoonById, getMoonsByParent } from '@/data/moons';

describe('地球静止轨道卫星（示意）', () => {
  const geo = getMoonById('geo-satellite')!;

  it('轨道半径 42,164 km、位于赤道面（倾角 0）', () => {
    expect(geo.orbit.semiMajorAxisKm).toBe(42164);
    expect(geo.orbit.inclinationDeg).toBe(0);
    expect(geo.referencePlane).toBe('planetEquator');
  });

  it('周期 ≈ 恒星日 0.99727 天（与地球自转同步）', () => {
    expect(geo.orbit.periodDays).toBeCloseTo(0.99727, 5);
  });

  it('类别为人造卫星且名称标注示意', () => {
    expect(geo.kind).toBe('artificial');
    expect(geo.nameZh).toContain('示意');
  });
});

describe('火星卫星（火卫一 / 火卫二）', () => {
  it('均属火星且潮汐锁定', () => {
    for (const id of ['phobos', 'deimos']) {
      const m = getMoonById(id)!;
      expect(m.parentId).toBe('mars');
      expect(m.tidallyLocked).toBe(true);
      expect(m.kind).toBe('natural');
    }
  });

  it('火卫一公转周期（7.65 小时）比火星自转（24.6 小时）还快', () => {
    const phobos = getMoonById('phobos')!;
    expect(phobos.orbit.periodDays * 24).toBeCloseTo(7.65, 1);
    expect(phobos.orbit.periodDays * 24).toBeLessThan(24.6);
  });

  it('火卫二轨道在火卫一之外、周期更长（开普勒第三定律）', () => {
    const phobos = getMoonById('phobos')!;
    const deimos = getMoonById('deimos')!;
    expect(deimos.orbit.semiMajorAxisKm).toBeGreaterThan(phobos.orbit.semiMajorAxisKm);
    expect(deimos.orbit.periodDays).toBeGreaterThan(phobos.orbit.periodDays);
  });
});

describe('土星卫星补充（土卫一 / 土卫五）', () => {
  it('均属土星', () => {
    expect(getMoonById('mimas')!.parentId).toBe('saturn');
    expect(getMoonById('rhea')!.parentId).toBe('saturn');
  });

  it('土星现有 4 颗卫星条目（土卫六/土卫二/土卫一/土卫五）', () => {
    const ids = getMoonsByParent('saturn')
      .map((m) => m.id)
      .sort();
    expect(ids).toEqual(['enceladus', 'mimas', 'rhea', 'titan']);
  });
});

describe('海卫一（逆行轨道，可选需求 3.1.1）', () => {
  const triton = getMoonById('triton')!;

  it('轨道倾角 156.9° > 90°（太阳系唯一逆行的大型卫星）', () => {
    expect(triton.orbit.inclinationDeg).toBeCloseTo(156.9, 1);
    expect(triton.orbit.inclinationDeg).toBeGreaterThan(90);
  });

  it('属海王星、潮汐锁定、备注说明俘获起源', () => {
    expect(triton.parentId).toBe('neptune');
    expect(triton.tidallyLocked).toBe(true);
    expect(triton.noteZh).toContain('逆行');
  });
});

describe('冥卫一卡戎（P5 §3.4 可选项，New Horizons）', () => {
  const charon = getMoonById('charon')!;

  it('属冥王星（矮行星卫星）、半径 606 km、公转 6.39 天', () => {
    expect(charon.parentId).toBe('pluto');
    expect(charon.kind).toBe('natural');
    expect(charon.radiusKm).toBe(606);
    expect(charon.orbit.periodDays).toBeCloseTo(6.387, 2);
  });

  it('双向潮汐锁定：公转周期 = 冥王星自转周期（153.3 小时）', () => {
    expect(charon.tidallyLocked).toBe(true);
    expect(charon.orbit.periodDays * 24).toBeCloseTo(153.3, 0);
    expect(charon.noteZh).toContain('双向潮汐锁定');
  });

  it('getMoonsByParent 可按冥王星查到卡戎', () => {
    expect(getMoonsByParent('pluto').map((m) => m.id)).toEqual(['charon']);
  });
});

describe('新增卫星质量字段（需求 3.5.2 信息面板）', () => {
  it('全部新增卫星 massKg 为正', () => {
    for (const id of ['geo-satellite', 'phobos', 'deimos', 'mimas', 'rhea', 'triton']) {
      const m = getMoonById(id)!;
      expect(m.massKg).toBeDefined();
      expect(m.massKg!).toBeGreaterThan(0);
    }
  });

  it('质量排序合理：海卫一 > 土卫五 > 土卫一 > 火卫一 > 火卫二', () => {
    const mass = (id: string): number => getMoonById(id)!.massKg!;
    expect(mass('triton')).toBeGreaterThan(mass('rhea'));
    expect(mass('rhea')).toBeGreaterThan(mass('mimas'));
    expect(mass('mimas')).toBeGreaterThan(mass('phobos'));
    expect(mass('phobos')).toBeGreaterThan(mass('deimos'));
  });
});
