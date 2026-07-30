/**
 * eventScopes 单元测试（R5-8 离散视角集合三层门控 + R3-3 §3.1-A 丢弃纯函数）
 *
 * R5-8 语义变迁：判定基准由 R2-4 连续层级窗口改为离散 viewLevel 视角
 * 集合（太阳 {L1, L2} / 超新星 {L3} / 合并 {L4}）——原连续窗口常量与
 * 闭区间边界断言随之删除，重写为四视角 × 五事件类别矩阵。
 */

import type { ViewLevel } from '@/types';
import { VIEW_LEVELS } from '@/types';
import {
  EVENT_DISCARD_GRACE_SEC,
  FLY_TO_DISCARD_EXEMPT_SEC,
  VIEW_TRANSITION_DISCARD_EXEMPT_SEC,
  eventAutoTriggerAllowed,
  eventDemoDisabledHintZh,
  eventDemoEnabled,
  eventDiscardDue,
  eventInScope,
  EVENT_NOTICE_MIN_VISIBLE_REAL_SEC,
  eventNoticeVisibleInScope,
  eventScopeLevels,
  eventScopeNameZh,
  noticeAgeUpdate,
  noticeAutoHideDue,
  outOfScopeElapsedUpdate,
  type ScopedEventKind,
} from '@/utils/eventScopes';

const ALL_KINDS: ScopedEventKind[] = ['flare', 'cme', 'cmeArrival', 'supernova', 'merger'];
const SOLAR_KINDS: ScopedEventKind[] = ['flare', 'cme', 'cmeArrival'];

describe('eventScopeLevels：事件 → 离散视角集合映射（R5-8 §8.2-A）', () => {
  it('太阳活动事件（耀斑/CME/CME 抵达）→ {L1, L2}（太阳系尺度）', () => {
    for (const kind of SOLAR_KINDS) {
      expect(eventScopeLevels(kind)).toEqual(['L1', 'L2']);
    }
  });

  it('超新星 → {L3}（银河系视角专属，R3-5 收窄语义保持）', () => {
    expect(eventScopeLevels('supernova')).toEqual(['L3']);
  });

  it('合并预览 → {L4}（宇宙视角专属）', () => {
    expect(eventScopeLevels('merger')).toEqual(['L4']);
  });

  it('五类事件视角集合两两无重叠歧义：每个视角至多归属一个事件域组', () => {
    // L1/L2 → 太阳域；L3 → 超新星域；L4 → 合并域（互斥覆盖全部四视角）
    for (const level of VIEW_LEVELS) {
      const solar = eventInScope('flare', level);
      const sn = eventInScope('supernova', level);
      const merger = eventInScope('merger', level);
      expect(Number(solar) + Number(sn) + Number(merger)).toBe(1);
    }
  });
});

describe('eventInScope：四视角 × 五事件类别矩阵（R5-8 离散判定）', () => {
  const EXPECT_MATRIX: Record<ScopedEventKind, boolean[]> = {
    // [L1, L2, L3, L4]
    flare: [true, true, false, false],
    cme: [true, true, false, false],
    cmeArrival: [true, true, false, false],
    supernova: [false, false, true, false],
    merger: [false, false, false, true],
  };

  it('矩阵逐格判定与预期一致', () => {
    for (const kind of ALL_KINDS) {
      expect(VIEW_LEVELS.map((level) => eventInScope(kind, level))).toEqual(
        EXPECT_MATRIX[kind],
      );
    }
  });

  it('三层门控（自动触发/通知可见/演示按钮）与基础判定逐格一致', () => {
    for (const kind of ALL_KINDS) {
      for (const level of VIEW_LEVELS) {
        const base = eventInScope(kind, level);
        expect(eventAutoTriggerAllowed(kind, level)).toBe(base);
        expect(eventNoticeVisibleInScope(kind, level)).toBe(base);
        expect(eventDemoEnabled(kind, level)).toBe(base);
      }
    }
  });
});

describe('R5-8 用户场景回归：银河系巡游跟随 L3 特殊天体（造父一/天狼星）', () => {
  // R3 层级锁定：跟随期间 viewLevel 锁定为域主层级 L3，continuousLevel
  // 随相机距离 ≈2.2（造父一距原点 ~190 单位）——门控只看 viewLevel
  const lockedLevel: ViewLevel = 'L3';

  it('太阳事件（耀斑/CME/抵达）三层门控全域外：不触发、通知隐藏、按钮置灰', () => {
    for (const kind of SOLAR_KINDS) {
      expect(eventAutoTriggerAllowed(kind, lockedLevel)).toBe(false);
      expect(eventNoticeVisibleInScope(kind, lockedLevel)).toBe(false);
      expect(eventDemoEnabled(kind, lockedLevel)).toBe(false);
    }
  });

  it('镜像缺陷修复：超新星三层门控全域内（可触发、通知可见、按钮可用）', () => {
    expect(eventAutoTriggerAllowed('supernova', lockedLevel)).toBe(true);
    expect(eventNoticeVisibleInScope('supernova', lockedLevel)).toBe(true);
    expect(eventDemoEnabled('supernova', lockedLevel)).toBe(true);
  });
});

describe('文案（tooltip / 折叠提醒）', () => {
  it('视角域中文名按事件类别映射', () => {
    expect(eventScopeNameZh('flare')).toBe('太阳系视角');
    expect(eventScopeNameZh('cme')).toBe('太阳系视角');
    expect(eventScopeNameZh('cmeArrival')).toBe('太阳系视角');
    expect(eventScopeNameZh('supernova')).toBe('银河系视角');
    expect(eventScopeNameZh('merger')).toBe('宇宙视角');
  });

  it('演示按钮禁用 tooltip 含目标视角名（§4.1-C"请切换到 XX 视角触发"）', () => {
    expect(eventDemoDisabledHintZh('flare')).toBe('请切换到太阳系视角触发');
    expect(eventDemoDisabledHintZh('supernova')).toBe('请切换到银河系视角触发');
    expect(eventDemoDisabledHintZh('merger')).toBe('请切换到宇宙视角触发');
  });

  // R3-3 行为变更登记：R2-4 方案 b"域外折叠一行小字提醒"已废止
  // （eventOutOfScopeSummaryZh 删除），域外零事件 UI，相关断言移除。
});

describe('R3-3 §3.1-A：离域计时与丢弃判定纯函数（R5-8 语义不变）', () => {
  it('宽限期为 1 真实秒；运镜豁免窗口与锚点/飞往运镜时长一致', () => {
    expect(EVENT_DISCARD_GRACE_SEC).toBe(1);
    expect(VIEW_TRANSITION_DISCARD_EXEMPT_SEC).toBe(2);
    expect(FLY_TO_DISCARD_EXEMPT_SEC).toBe(2.5);
  });

  it('域内恒归零（含清除运镜豁免的剩余负值）', () => {
    expect(outOfScopeElapsedUpdate(0, true, 0.016)).toBe(0);
    expect(outOfScopeElapsedUpdate(0.9, true, 0.016)).toBe(0);
    expect(outOfScopeElapsedUpdate(-2.5, true, 0.016)).toBe(0);
  });

  it('域外按帧时长累加，上钳到宽限期（到期后保持恒值，无界增长防护）', () => {
    expect(outOfScopeElapsedUpdate(0, false, 0.25)).toBeCloseTo(0.25, 10);
    expect(outOfScopeElapsedUpdate(0.9, false, 0.25)).toBe(EVENT_DISCARD_GRACE_SEC);
    expect(outOfScopeElapsedUpdate(EVENT_DISCARD_GRACE_SEC, false, 0.25)).toBe(
      EVENT_DISCARD_GRACE_SEC,
    );
  });

  it('运镜豁免：自负豁免窗口起步累加，运镜时长内到不了宽限阈值', () => {
    // 锚点切换 2 秒运镜逐帧累加（60 FPS）后仍为负
    let elapsed = -VIEW_TRANSITION_DISCARD_EXEMPT_SEC;
    for (let i = 0; i < 120; i += 1) {
      elapsed = outOfScopeElapsedUpdate(elapsed, false, 1 / 60);
    }
    expect(elapsed).toBeLessThan(EVENT_DISCARD_GRACE_SEC);
    expect(eventDiscardDue(elapsed)).toBe(false);
    // 飞往 2.5 秒运镜同理
    expect(
      outOfScopeElapsedUpdate(-FLY_TO_DISCARD_EXEMPT_SEC, false, 2.5),
    ).toBeLessThan(EVENT_DISCARD_GRACE_SEC);
  });

  it('丢弃到期判定：达宽限期（含）为真，负值/宽限内为假', () => {
    expect(eventDiscardDue(0)).toBe(false);
    expect(eventDiscardDue(0.99)).toBe(false);
    expect(eventDiscardDue(EVENT_DISCARD_GRACE_SEC)).toBe(true);
    expect(eventDiscardDue(-2.5)).toBe(false);
  });

  it('<1 秒折返域内：计时清零后重新离域从 0 起算（宽限语义，确认项 3）', () => {
    let elapsed = 0;
    elapsed = outOfScopeElapsedUpdate(elapsed, false, 0.8); // 离域 0.8 秒
    expect(eventDiscardDue(elapsed)).toBe(false);
    elapsed = outOfScopeElapsedUpdate(elapsed, true, 0.016); // 折返域内
    expect(elapsed).toBe(0);
    elapsed = outOfScopeElapsedUpdate(elapsed, false, 0.8); // 再次离域
    expect(eventDiscardDue(elapsed)).toBe(false);
  });

  it('非法输入抛 RangeError（非有限计时/负帧时长/非有限帧时长）', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() => outOfScopeElapsedUpdate(bad, false, 0.016)).toThrow(RangeError);
      expect(() => outOfScopeElapsedUpdate(0, false, bad)).toThrow(RangeError);
      expect(() => eventDiscardDue(bad)).toThrow(RangeError);
    }
    expect(() => outOfScopeElapsedUpdate(0, false, -0.016)).toThrow(RangeError);
  });
});

describe('事件通知最短展示时长纯函数（通知展示与事件生命周期解耦）', () => {
  it('最短展示时长为 15 真实秒', () => {
    expect(EVENT_NOTICE_MIN_VISIBLE_REAL_SEC).toBe(15);
  });

  it('展示计时按帧时长累加，上钳到最短展示时长（到顶恒值防每帧变更）', () => {
    expect(noticeAgeUpdate(0, 0.5)).toBe(0.5);
    expect(noticeAgeUpdate(14.9, 0.5)).toBe(EVENT_NOTICE_MIN_VISIBLE_REAL_SEC);
    expect(noticeAgeUpdate(EVENT_NOTICE_MIN_VISIBLE_REAL_SEC, 1)).toBe(
      EVENT_NOTICE_MIN_VISIBLE_REAL_SEC,
    );
  });

  it('自动收起判定：事件结束且计时满时长才收起', () => {
    // 事件进行中：任何计时都不收起（通知随事件生命周期语义保留）
    expect(noticeAutoHideDue(EVENT_NOTICE_MIN_VISIBLE_REAL_SEC, false)).toBe(false);
    // 事件已结束但未满最短展示时长：驻留（用户来得及点击）
    expect(noticeAutoHideDue(EVENT_NOTICE_MIN_VISIBLE_REAL_SEC - 0.1, true)).toBe(false);
    // 事件已结束且满时长：收起
    expect(noticeAutoHideDue(EVENT_NOTICE_MIN_VISIBLE_REAL_SEC, true)).toBe(true);
  });

  it('非法输入抛 RangeError', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() => noticeAgeUpdate(bad, 0.016)).toThrow(RangeError);
      expect(() => noticeAgeUpdate(0, bad)).toThrow(RangeError);
      expect(() => noticeAutoHideDue(bad, true)).toThrow(RangeError);
    }
    expect(() => noticeAgeUpdate(-1, 0.016)).toThrow(RangeError);
    expect(() => noticeAgeUpdate(0, -0.016)).toThrow(RangeError);
  });
});
