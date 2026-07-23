/**
 * 行星视角天体切换序列测试（P4，需求 §3.2.4）
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

describe('切换序列定义（需求 3.2.4）', () => {
  it('序列为固定 11 天体：八大行星 + 月球（地球后）+ 两彗星（末尾）', () => {
    expect(BODY_CYCLE_SEQUENCE).toEqual([
      'mercury',
      'venus',
      'earth',
      'moon',
      'mars',
      'jupiter',
      'saturn',
      'uranus',
      'neptune',
      'halley',
      'encke',
    ]);
  });

  it('默认锚定天体为地球', () => {
    expect(DEFAULT_ANCHOR_BODY_ID).toBe('earth');
    expect(isCycleBody(DEFAULT_ANCHOR_BODY_ID)).toBe(true);
  });

  it('isCycleBody 识别序列内外天体', () => {
    expect(isCycleBody('halley')).toBe(true);
    expect(isCycleBody('sun')).toBe(false);
    expect(isCycleBody('pluto')).toBe(false);
  });
});

describe('循环切换（需求 3.2.4）', () => {
  it('下一颗沿序列前进', () => {
    expect(cycleBodyId('mercury', 1)).toBe('venus');
    expect(cycleBodyId('earth', 1)).toBe('moon');
    expect(cycleBodyId('moon', 1)).toBe('mars');
    expect(cycleBodyId('neptune', 1)).toBe('halley');
  });

  it('上一颗沿序列后退', () => {
    expect(cycleBodyId('venus', -1)).toBe('mercury');
    expect(cycleBodyId('mars', -1)).toBe('moon');
  });

  it('循环边界：恩克彗星下一颗回到水星，水星上一颗为恩克彗星', () => {
    expect(cycleBodyId('encke', 1)).toBe('mercury');
    expect(cycleBodyId('mercury', -1)).toBe('encke');
  });

  it('遍历一整圈回到起点', () => {
    let id = 'earth';
    for (let i = 0; i < BODY_CYCLE_SEQUENCE.length; i += 1) {
      id = cycleBodyId(id, 1);
    }
    expect(id).toBe('earth');
  });

  it('序列外 id 回落到默认天体', () => {
    expect(cycleBodyId('sun', 1)).toBe(DEFAULT_ANCHOR_BODY_ID);
    expect(cycleBodyId('unknown', -1)).toBe(DEFAULT_ANCHOR_BODY_ID);
  });
});

describe('序列位置标签（需求 3.2.4 HUD："地球 3/11"）', () => {
  it('地球为 3/11', () => {
    expect(bodyCyclePositionLabel('earth')).toBe('3/11');
  });

  it('首尾位置正确', () => {
    expect(bodyCyclePositionLabel('mercury')).toBe('1/11');
    expect(bodyCyclePositionLabel('encke')).toBe('11/11');
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

  it('跟随序列内天体时保持可见（外行星跟随层级读数为 L2 的语义补充）', () => {
    expect(cycleControlVisible('L2', 'neptune')).toBe(true);
    expect(cycleControlVisible('L2', 'halley')).toBe(true);
  });

  it('L2-L4 未跟随序列天体时隐藏', () => {
    expect(cycleControlVisible('L2', null)).toBe(false);
    expect(cycleControlVisible('L3', null)).toBe(false);
    expect(cycleControlVisible('L4', 'm31')).toBe(false);
    expect(cycleControlVisible('L2', 'sun')).toBe(false);
  });
});
