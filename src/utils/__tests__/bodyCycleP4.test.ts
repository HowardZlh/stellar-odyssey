/**
 * 行星视角天体切换序列测试（P4，需求 §3.2.4；P5 §3.3 扩展至 16 天体；
 * P7 §3.4 纳入人造卫星扩展至 20 天体）
 */

import {
  BODY_CYCLE_SEQUENCE,
  DEFAULT_ANCHOR_BODY_ID,
  bodyCycleIndex,
  bodyCyclePositionLabel,
  cycleBodyId,
  cycleControlVisible,
  isCycleBody,
} from '@/utils/bodyCycle';
import { DWARF_PLANETS } from '@/data/smallBodies';

describe('切换序列定义（需求 3.2.4 / P5 §3.3）', () => {
  it('序列为固定 20 天体：八大行星 + 月球 + 4 人造卫星（P7）+ 5 矮行星 + 两彗星（末尾）', () => {
    expect(BODY_CYCLE_SEQUENCE).toEqual([
      'mercury',
      'venus',
      'earth',
      'moon',
      'iss',
      'tiangong',
      'hubble',
      'geo-satellite',
      'mars',
      'ceres',
      'jupiter',
      'saturn',
      'uranus',
      'neptune',
      'pluto',
      'haumea',
      'makemake',
      'eris',
      'halley',
      'encke',
    ]);
  });

  it('5 颗矮行星全部纳入序列（P5 核心痛点：可直达）', () => {
    for (const d of DWARF_PLANETS) {
      expect(isCycleBody(d.id)).toBe(true);
    }
  });

  it('谷神星插于火星与木星之间（2.77 AU 位于小行星带）', () => {
    expect(bodyCycleIndex('ceres')).toBe(bodyCycleIndex('mars') + 1);
    expect(bodyCycleIndex('jupiter')).toBe(bodyCycleIndex('ceres') + 1);
  });

  it('柯伊伯带四颗按半长轴排于海王星后：冥王星→妊神星→鸟神星→阋神星', () => {
    expect(bodyCycleIndex('pluto')).toBe(bodyCycleIndex('neptune') + 1);
    expect(bodyCycleIndex('haumea')).toBe(bodyCycleIndex('pluto') + 1);
    expect(bodyCycleIndex('makemake')).toBe(bodyCycleIndex('haumea') + 1);
    expect(bodyCycleIndex('eris')).toBe(bodyCycleIndex('makemake') + 1);
    expect(bodyCycleIndex('halley')).toBe(bodyCycleIndex('eris') + 1);
  });

  it('默认锚定天体为地球', () => {
    expect(DEFAULT_ANCHOR_BODY_ID).toBe('earth');
    expect(isCycleBody(DEFAULT_ANCHOR_BODY_ID)).toBe(true);
  });

  it('4 颗人造卫星全部纳入序列（P7 核心痛点：可直达近观）', () => {
    for (const id of ['iss', 'tiangong', 'hubble', 'geo-satellite']) {
      expect(isCycleBody(id)).toBe(true);
    }
  });

  it('isCycleBody 识别序列内外天体', () => {
    expect(isCycleBody('halley')).toBe(true);
    expect(isCycleBody('pluto')).toBe(true);
    expect(isCycleBody('sun')).toBe(false);
    expect(isCycleBody('charon')).toBe(false);
  });
});

describe('循环切换（需求 3.2.4）', () => {
  it('下一颗沿序列前进', () => {
    expect(cycleBodyId('mercury', 1)).toBe('venus');
    expect(cycleBodyId('earth', 1)).toBe('moon');
    // P7 §3.4：月球之后插入人造卫星段
    expect(cycleBodyId('moon', 1)).toBe('iss');
    expect(cycleBodyId('iss', 1)).toBe('tiangong');
    expect(cycleBodyId('tiangong', 1)).toBe('hubble');
    expect(cycleBodyId('hubble', 1)).toBe('geo-satellite');
    expect(cycleBodyId('geo-satellite', 1)).toBe('mars');
    expect(cycleBodyId('mars', 1)).toBe('ceres');
    expect(cycleBodyId('neptune', 1)).toBe('pluto');
    expect(cycleBodyId('eris', 1)).toBe('halley');
  });

  it('上一颗沿序列后退', () => {
    expect(cycleBodyId('venus', -1)).toBe('mercury');
    expect(cycleBodyId('jupiter', -1)).toBe('ceres');
    expect(cycleBodyId('pluto', -1)).toBe('neptune');
  });

  it('循环边界：恩克彗星下一颗回到水星，水星上一颗为恩克彗星', () => {
    expect(cycleBodyId('encke', 1)).toBe('mercury');
    expect(cycleBodyId('mercury', -1)).toBe('encke');
  });

  it('遍历一整圈（20 步）回到起点', () => {
    let id = 'earth';
    for (let i = 0; i < BODY_CYCLE_SEQUENCE.length; i += 1) {
      id = cycleBodyId(id, 1);
    }
    expect(id).toBe('earth');
    expect(BODY_CYCLE_SEQUENCE).toHaveLength(20);
  });

  it('序列外 id 回落到默认天体', () => {
    expect(cycleBodyId('sun', 1)).toBe(DEFAULT_ANCHOR_BODY_ID);
    expect(cycleBodyId('unknown', -1)).toBe(DEFAULT_ANCHOR_BODY_ID);
  });
});

describe('序列位置标签（需求 3.2.4 HUD；P7："冥王星 15/20"）', () => {
  it('地球为 3/20', () => {
    expect(bodyCyclePositionLabel('earth')).toBe('3/20');
  });

  it('冥王星为 15/20（P7 §3.4 HUD 计数更新）', () => {
    expect(bodyCyclePositionLabel('pluto')).toBe('15/20');
  });

  it('人造卫星位置正确（P7：月球之后 5-8 位）', () => {
    expect(bodyCyclePositionLabel('iss')).toBe('5/20');
    expect(bodyCyclePositionLabel('tiangong')).toBe('6/20');
    expect(bodyCyclePositionLabel('hubble')).toBe('7/20');
    expect(bodyCyclePositionLabel('geo-satellite')).toBe('8/20');
  });

  it('首尾位置正确', () => {
    expect(bodyCyclePositionLabel('mercury')).toBe('1/20');
    expect(bodyCyclePositionLabel('encke')).toBe('20/20');
  });

  it('序列外返回 null', () => {
    expect(bodyCyclePositionLabel('sun')).toBeNull();
  });

  it('bodyCycleIndex 与标签一致', () => {
    expect(bodyCycleIndex('earth')).toBe(2);
    expect(bodyCycleIndex('sun')).toBe(-1);
  });
});

describe('切换控件可见性（需求 3.2.4：仅 L1 显示）', () => {
  it('L1 层级始终可见', () => {
    expect(cycleControlVisible('L1', null)).toBe(true);
    expect(cycleControlVisible('L1', 'earth')).toBe(true);
  });

  it('跟随序列内天体时保持可见（外行星/矮行星跟随层级读数为 L2 的语义补充）', () => {
    expect(cycleControlVisible('L2', 'neptune')).toBe(true);
    expect(cycleControlVisible('L2', 'iss')).toBe(true);
    expect(cycleControlVisible('L2', 'halley')).toBe(true);
    expect(cycleControlVisible('L2', 'eris')).toBe(true);
  });

  it('L2-L4 未跟随序列天体时隐藏', () => {
    expect(cycleControlVisible('L2', null)).toBe(false);
    expect(cycleControlVisible('L3', null)).toBe(false);
    expect(cycleControlVisible('L4', 'm31')).toBe(false);
    expect(cycleControlVisible('L2', 'sun')).toBe(false);
  });
});
