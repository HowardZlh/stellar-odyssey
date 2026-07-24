/**
 * 统一天体信息目录测试（需求 3.5.2：信息面板）
 */

import { getBodyInfoById } from '@/data/catalog';
import type { BodyInfo } from '@/data/catalog';
import { PLANETS, SUN } from '@/data/planets';
import { MOONS } from '@/data/moons';
import { COMETS } from '@/data/smallBodies';
import { LOCAL_GROUP_GALAXIES, MILKY_WAY } from '@/data/galaxies';

/** 取某标签行的值（断言其存在） */
function lineValue(info: BodyInfo, label: string): string {
  const line = info.lines.find((l) => l.label === label);
  expect(line).toBeDefined();
  return line!.value;
}

describe('行星与太阳', () => {
  it('八大行星均可查到且类型为行星', () => {
    for (const p of PLANETS) {
      const info = getBodyInfoById(p.id)!;
      expect(info.typeZh).toBe('行星');
      expect(info.nameZh).toBe(p.nameZh);
      lineValue(info, '半径');
      lineValue(info, '轨道半长轴');
      lineValue(info, '公转周期');
    }
  });

  it('金星自转周期标注"（逆向）"', () => {
    const venus = getBodyInfoById('venus')!;
    expect(lineValue(venus, '自转周期')).toContain('（逆向）');
  });

  it('太阳类型为恒星，含半径行；S2 扩展结构分层/温度对比行与补充来源', () => {
    const sun = getBodyInfoById('sun')!;
    expect(sun.typeZh).toBe('恒星');
    expect(lineValue(sun, '半径')).toContain('695,700');
    // S2 §4.5：dataSource 在原 NASA 来源上补充较差自转/日冕加热文献
    expect(sun.dataSource).toContain(SUN.dataSource);
    expect(lineValue(sun, '结构分层')).toContain('辐射区');
    expect(lineValue(sun, '日冕温度')).toContain('未解之谜');
    expect(lineValue(sun, '较差自转')).toContain('25.4');
  });
});

describe('冥王星（矮行星）', () => {
  it('类型为矮行星，含轨道倾角与海王星共振行', () => {
    const pluto = getBodyInfoById('pluto')!;
    expect(pluto.typeZh).toBe('矮行星');
    expect(lineValue(pluto, '轨道倾角')).toBe('17.1°');
    expect(lineValue(pluto, '共振')).toContain('海王星 2:3');
    expect(lineValue(pluto, '自转周期')).toContain('（逆向）');
  });
});

describe('卫星', () => {
  it('月球类型为卫星，含潮汐锁定与备注行', () => {
    const moon = getBodyInfoById('moon')!;
    expect(moon.typeZh).toBe('卫星');
    expect(lineValue(moon, '潮汐锁定')).toBe('是');
    expect(lineValue(moon, '备注')).toContain('潮汐锁定');
    expect(lineValue(moon, '公转周期')).toContain('天');
  });

  it('ISS 类型为人造卫星，半径标注示意、周期转分钟', () => {
    const iss = getBodyInfoById('iss')!;
    expect(iss.typeZh).toBe('人造卫星');
    expect(lineValue(iss, '半径')).toContain('示意');
    expect(lineValue(iss, '公转周期')).toContain('分钟');
    expect(lineValue(iss, '公转周期')).toContain('92.9');
  });

  it('所有卫星均可查到', () => {
    for (const m of MOONS) {
      expect(getBodyInfoById(m.id)).toBeDefined();
    }
  });
});

describe('彗星', () => {
  it('哈雷含"逆行"标注与近日点/远日点行', () => {
    const halley = getBodyInfoById('halley')!;
    expect(halley.typeZh).toBe('彗星');
    expect(lineValue(halley, '轨道倾角')).toContain('（逆行）');
    expect(lineValue(halley, '近日点距离')).toBe('0.6 AU');
    expect(lineValue(halley, '远日点距离')).toBe('35.1 AU');
  });

  it('恩克彗星倾角 < 90°，不含逆行标注', () => {
    const encke = getBodyInfoById('encke')!;
    expect(lineValue(encke, '轨道倾角')).not.toContain('逆行');
  });

  it('所有彗星均可查到', () => {
    for (const c of COMETS) {
      expect(getBodyInfoById(c.id)).toBeDefined();
    }
  });
});

describe('星系', () => {
  it('M31 为旋涡星系，视向速度显示"接近"', () => {
    const m31 = getBodyInfoById('m31')!;
    expect(m31.typeZh).toBe('旋涡星系');
    expect(lineValue(m31, '视向速度')).toContain('接近');
    expect(lineValue(m31, '距离')).toContain('250万光年');
  });

  it('M87 为椭圆星系，视向速度显示"退行"', () => {
    const m87 = getBodyInfoById('m87')!;
    expect(m87.typeZh).toBe('椭圆星系');
    expect(lineValue(m87, '视向速度')).toContain('退行');
  });

  it('LMC 为不规则星系', () => {
    expect(getBodyInfoById('lmc')!.typeZh).toBe('不规则星系');
  });

  it('银河系为棒旋星系，含直径与主旋臂行', () => {
    const mw = getBodyInfoById('milky-way')!;
    expect(mw.typeZh).toBe('棒旋星系');
    expect(lineValue(mw, '直径')).toContain('10万光年');
    expect(lineValue(mw, '主旋臂')).toContain('英仙臂');
  });

  it('所有星系均可查到', () => {
    for (const g of LOCAL_GROUP_GALAXIES) {
      expect(getBodyInfoById(g.id)).toBeDefined();
    }
  });
});

describe('通用约束', () => {
  it('未知 id 返回 undefined', () => {
    expect(getBodyInfoById('death-star')).toBeUndefined();
  });

  it('每个 BodyInfo 均有非空 dataSource', () => {
    const allIds = [
      SUN.id,
      ...PLANETS.map((p) => p.id),
      'pluto',
      ...MOONS.map((m) => m.id),
      ...COMETS.map((c) => c.id),
      ...LOCAL_GROUP_GALAXIES.map((g) => g.id),
      MILKY_WAY.id,
    ];
    for (const id of allIds) {
      const info = getBodyInfoById(id)!;
      expect(info).toBeDefined();
      expect(info.dataSource.length).toBeGreaterThan(0);
    }
  });
});
