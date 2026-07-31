/**
 * kiosk 状态机纯逻辑单测（B5 §5.1-B）：kioskTick 全转移分支 +
 * planKioskAdvance 全分支（模块覆盖率目标 100%，附录 A#2）。
 */

import type { KioskState, KioskTiming } from '@/utils/kiosk';
import {
  KIOSK_ALL_SCOPES,
  KIOSK_INACTIVE,
  KIOSK_RESUME_DEFAULT_SEC,
  kioskRemainingSec,
  kioskTick,
  planKioskAdvance,
} from '@/utils/kiosk';
import {
  GALAXY_CYCLE_SEQUENCE,
  UNIVERSE_CYCLE_SEQUENCE,
} from '@/utils/cycleScopes';
import { SOLAR_CYCLE_SEQUENCE } from '@/utils/bodyCycle';

const TIMING: KioskTiming = { dwellSec: 10, resumeSec: 30 };

const touring = (nextAtSec: number): KioskState => ({ phase: 'touring', nextAtSec });
const paused = (nextAtSec: number): KioskState => ({ phase: 'paused', nextAtSec });

describe('kioskTick 状态转移（B5 §5.1-B 转移表）', () => {
  it('初始常量为 inactive（冻结）', () => {
    expect(KIOSK_INACTIVE).toEqual({ phase: 'inactive', nextAtSec: 0 });
    expect(Object.isFrozen(KIOSK_INACTIVE)).toBe(true);
    expect(KIOSK_RESUME_DEFAULT_SEC).toBe(90);
  });

  it('inactive + start → touring（nextAt = now + dwell），副作用 hideUi + advance', () => {
    const { state, effects } = kioskTick(KIOSK_INACTIVE, 'start', 100, TIMING);
    expect(state).toEqual(touring(110));
    expect(effects).toEqual(['hideUi', 'advance']);
  });

  it('重复 start 幂等（touring/paused 原状态零副作用，双入口防叠加）', () => {
    for (const s of [touring(110), paused(130)]) {
      const { state, effects } = kioskTick(s, 'start', 105, TIMING);
      expect(state).toBe(s);
      expect(effects).toEqual([]);
    }
  });

  it('touring + input → paused（nextAt = now + resume），副作用 showUi', () => {
    const { state, effects } = kioskTick(touring(110), 'input', 105, TIMING);
    expect(state).toEqual(paused(135));
    expect(effects).toEqual(['showUi']);
  });

  it('paused + input → 重置恢复计时，零副作用（UI 已可见）', () => {
    const { state, effects } = kioskTick(paused(135), 'input', 120, TIMING);
    expect(state).toEqual(paused(150));
    expect(effects).toEqual([]);
  });

  it('inactive + input/tick → 原状态引用零副作用', () => {
    for (const event of ['input', 'tick'] as const) {
      const { state, effects } = kioskTick(KIOSK_INACTIVE, event, 999, TIMING);
      expect(state).toBe(KIOSK_INACTIVE);
      expect(effects).toEqual([]);
    }
  });

  it('touring + tick 未到期 → 原状态引用零副作用（高频路径零分配）', () => {
    const s = touring(110);
    const { state, effects } = kioskTick(s, 'tick', 109.9, TIMING);
    expect(state).toBe(s);
    expect(effects).toEqual([]);
  });

  it('touring + tick 到期 → 重置 dwell 计时，副作用 advance', () => {
    const { state, effects } = kioskTick(touring(110), 'tick', 110, TIMING);
    expect(state).toEqual(touring(120));
    expect(effects).toEqual(['advance']);
  });

  it('paused + tick 未到期 → 原状态引用零副作用', () => {
    const s = paused(135);
    const { state, effects } = kioskTick(s, 'tick', 134, TIMING);
    expect(state).toBe(s);
    expect(effects).toEqual([]);
  });

  it('paused + tick 到期 → 恢复 touring，副作用 hideUi + advance（恢复即推进）', () => {
    const { state, effects } = kioskTick(paused(135), 'tick', 136, TIMING);
    expect(state).toEqual(touring(146));
    expect(effects).toEqual(['hideUi', 'advance']);
  });

  it('touring/paused + exit → inactive，副作用 showUi', () => {
    for (const s of [touring(110), paused(135)]) {
      const { state, effects } = kioskTick(s, 'exit', 105, TIMING);
      expect(state).toBe(KIOSK_INACTIVE);
      expect(effects).toEqual(['showUi']);
    }
  });

  it('inactive + exit → 原状态引用零副作用（幂等）', () => {
    const { state, effects } = kioskTick(KIOSK_INACTIVE, 'exit', 105, TIMING);
    expect(state).toBe(KIOSK_INACTIVE);
    expect(effects).toEqual([]);
  });
});

describe('kioskRemainingSec（暂停角标倒计时）', () => {
  it('向上取整（余 0.1 秒报 1 秒）', () => {
    expect(kioskRemainingSec(paused(135), 134.9)).toBe(1);
    expect(kioskRemainingSec(paused(135), 120)).toBe(15);
  });

  it('已过期/整点非负', () => {
    expect(kioskRemainingSec(paused(135), 135)).toBe(0);
    expect(kioskRemainingSec(paused(135), 140)).toBe(0);
  });
});

describe('planKioskAdvance 推进计划（B5 §5.1-B 巡游语义，域切换两步登记）', () => {
  it('单域巡游域内跟随序列成员 → next（store cycleScopeBody(1) 域内下一站）', () => {
    expect(planKioskAdvance('solar', 'solar', 'L2', 'earth')).toEqual({ kind: 'next' });
    expect(planKioskAdvance('galaxy', 'galaxy', 'L3', 'sgr-a-star')).toEqual({ kind: 'next' });
    expect(planKioskAdvance('universe', 'universe', 'L4', 'm31')).toEqual({ kind: 'next' });
  });

  it('单域巡游序列末站 → 仍为 next（域内回绕，不切域）', () => {
    const last = SOLAR_CYCLE_SEQUENCE[SOLAR_CYCLE_SEQUENCE.length - 1];
    expect(planKioskAdvance('solar', 'solar', 'L2', last)).toEqual({ kind: 'next' });
  });

  it('当前域不属本次 tour → 先对齐巡游首域全景锚点（anchor，单域=该域）', () => {
    expect(planKioskAdvance('solar', 'universe', 'L4', 'm31')).toEqual({
      kind: 'anchor',
      scope: 'solar',
      level: 'L2',
    });
    expect(planKioskAdvance('galaxy', 'system', 'L1', null)).toEqual({
      kind: 'anchor',
      scope: 'galaxy',
      level: 'L3',
    });
  });

  it('未跟随 + 已在域主层级 → enter 域默认天体（requestFlyTo 单发）', () => {
    expect(planKioskAdvance('all', 'universe', 'L4', null)).toEqual({
      kind: 'enter',
      scope: 'universe',
      bodyId: 'm31',
    });
    expect(planKioskAdvance('solar', 'solar', 'L2', null)).toEqual({
      kind: 'enter',
      scope: 'solar',
      bodyId: 'earth',
    });
  });

  it('未跟随 + 层级未对齐 → 先 anchor 域全景（尺度过渡到位，踩坑登记）', () => {
    expect(planKioskAdvance('all', 'universe', 'L3', null)).toEqual({
      kind: 'anchor',
      scope: 'universe',
      level: 'L4',
    });
  });

  it('跟随体不在当前域序列内（如跟随太阳）→ 按层级对齐程度回域起点', () => {
    expect(planKioskAdvance('solar', 'solar', 'L2', 'sun')).toEqual({
      kind: 'enter',
      scope: 'solar',
      bodyId: 'earth',
    });
    expect(planKioskAdvance('solar', 'solar', 'L1', 'sun')).toEqual({
      kind: 'anchor',
      scope: 'solar',
      level: 'L2',
    });
  });

  it('tour=all 域中段 → next（不提前切域）', () => {
    expect(planKioskAdvance('all', 'galaxy', 'L3', GALAXY_CYCLE_SEQUENCE[0])).toEqual({
      kind: 'next',
    });
    // system 域动态序列：地球系统含卫星，行星本体非末站
    expect(planKioskAdvance('all', 'system', 'L1', 'earth')).toEqual({ kind: 'next' });
  });

  it('tour=all 域末 → 下一域全景锚点（system → solar → galaxy → universe → system 回绕）', () => {
    // system 域末站 = 地球系统按半长轴升序末位天体（月球 384,400 km）
    expect(planKioskAdvance('all', 'system', 'L1', 'moon')).toEqual({
      kind: 'anchor',
      scope: 'solar',
      level: 'L2',
    });
    const solarLast = SOLAR_CYCLE_SEQUENCE[SOLAR_CYCLE_SEQUENCE.length - 1];
    expect(planKioskAdvance('all', 'solar', 'L2', solarLast)).toEqual({
      kind: 'anchor',
      scope: 'galaxy',
      level: 'L3',
    });
    const galaxyLast = GALAXY_CYCLE_SEQUENCE[GALAXY_CYCLE_SEQUENCE.length - 1];
    expect(planKioskAdvance('all', 'galaxy', 'L3', galaxyLast)).toEqual({
      kind: 'anchor',
      scope: 'universe',
      level: 'L4',
    });
    const universeLast = UNIVERSE_CYCLE_SEQUENCE[UNIVERSE_CYCLE_SEQUENCE.length - 1];
    expect(planKioskAdvance('all', 'universe', 'L4', universeLast)).toEqual({
      kind: 'anchor',
      scope: 'system',
      level: 'L1',
    });
  });

  it('tour=all system 域单成员系统（无卫星行星）一步即切域（不卡死）', () => {
    // 水星无卫星：系统序列仅含自身（末站即首站）→ 切 solar 域锚点
    expect(planKioskAdvance('all', 'system', 'L1', 'mercury')).toEqual({
      kind: 'anchor',
      scope: 'solar',
      level: 'L2',
    });
  });

  it('四域轮转顺序常量（由内向外叙事顺序登记）', () => {
    expect(KIOSK_ALL_SCOPES).toEqual(['system', 'solar', 'galaxy', 'universe']);
    expect(Object.isFrozen(KIOSK_ALL_SCOPES)).toBe(true);
  });
});
