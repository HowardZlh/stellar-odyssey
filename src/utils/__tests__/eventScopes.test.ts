/**
 * eventScopes 单元测试（R2-4 §4.1-A/D 三层窗口 + R3-3 §3.1-A 丢弃纯函数）
 */

import {
  EVENT_DISCARD_GRACE_SEC,
  FLY_TO_DISCARD_EXEMPT_SEC,
  MERGER_EVENT_MIN_LEVEL,
  SOLAR_EVENT_MAX_LEVEL,
  SUPERNOVA_EVENT_MIN_LEVEL,
  VIEW_TRANSITION_DISCARD_EXEMPT_SEC,
  eventAutoTriggerAllowed,
  eventDemoDisabledHintZh,
  eventDemoEnabled,
  eventDiscardDue,
  eventInScope,
  eventNoticeVisibleInScope,
  eventScopeNameZh,
  eventScopeWindow,
  outOfScopeElapsedUpdate,
  type ScopedEventKind,
} from '@/utils/eventScopes';

const ALL_KINDS: ScopedEventKind[] = ['flare', 'cme', 'cmeArrival', 'supernova', 'merger'];
const SOLAR_KINDS: ScopedEventKind[] = ['flare', 'cme', 'cmeArrival'];

describe('eventScopeWindow：事件 → 视角域窗口映射（§4.1-A）', () => {
  it('太阳活动事件（耀斑/CME/CME 抵达）窗口为 [1, 2.4]，对齐 SunActivity 平台上缘', () => {
    for (const kind of SOLAR_KINDS) {
      expect(eventScopeWindow(kind)).toEqual({ minLevel: 1, maxLevel: SOLAR_EVENT_MAX_LEVEL });
    }
    expect(SOLAR_EVENT_MAX_LEVEL).toBe(2.4);
  });

  it('超新星窗口为 [2.5, 4]，对齐 Supernova 淡入起点', () => {
    expect(eventScopeWindow('supernova')).toEqual({
      minLevel: SUPERNOVA_EVENT_MIN_LEVEL,
      maxLevel: 4,
    });
    expect(SUPERNOVA_EVENT_MIN_LEVEL).toBe(2.5);
  });

  it('合并预览窗口为 [3.6, 4]（L4 视角段）', () => {
    expect(eventScopeWindow('merger')).toEqual({
      minLevel: MERGER_EVENT_MIN_LEVEL,
      maxLevel: 4,
    });
    expect(MERGER_EVENT_MIN_LEVEL).toBe(3.6);
  });

  it('太阳活动域上缘与超新星域下缘互补无重叠（2.4 / 2.5 之间无双活跃区）', () => {
    expect(SOLAR_EVENT_MAX_LEVEL).toBeLessThan(SUPERNOVA_EVENT_MIN_LEVEL);
  });
});

describe('eventInScope：闭区间边界判定', () => {
  it('太阳活动事件：2.4（含）内为真，2.41 起为假', () => {
    for (const kind of SOLAR_KINDS) {
      expect(eventInScope(kind, 1)).toBe(true);
      expect(eventInScope(kind, 2)).toBe(true);
      expect(eventInScope(kind, 2.4)).toBe(true);
      expect(eventInScope(kind, 2.41)).toBe(false);
      expect(eventInScope(kind, 3)).toBe(false);
      expect(eventInScope(kind, 4)).toBe(false);
    }
  });

  it('超新星：2.5（含）起为真，2.49 及以下为假', () => {
    expect(eventInScope('supernova', 2.49)).toBe(false);
    expect(eventInScope('supernova', 2.5)).toBe(true);
    expect(eventInScope('supernova', 3)).toBe(true);
    expect(eventInScope('supernova', 4)).toBe(true);
    expect(eventInScope('supernova', 1)).toBe(false);
    expect(eventInScope('supernova', 2)).toBe(false);
  });

  it('合并预览：3.6（含）起为真，3.59 及以下为假', () => {
    expect(eventInScope('merger', 3.59)).toBe(false);
    expect(eventInScope('merger', 3.6)).toBe(true);
    expect(eventInScope('merger', 4)).toBe(true);
    expect(eventInScope('merger', 3)).toBe(false);
    expect(eventInScope('merger', 1)).toBe(false);
  });

  it('非有限层级抛 RangeError（编程错误显式暴露）', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() => eventInScope('flare', bad)).toThrow(RangeError);
    }
  });
});

describe('三层门控（§4.1-D）：自动触发域 / 通知可见域 / 按钮可用域', () => {
  const LEVEL_SAMPLES = [1, 1.5, 2, 2.4, 2.41, 2.49, 2.5, 3, 3.59, 3.6, 4];

  it('三层窗口当前取值一致（同事件同窗口，语义独立便于未来分层微调）', () => {
    for (const kind of ALL_KINDS) {
      for (const level of LEVEL_SAMPLES) {
        const base = eventInScope(kind, level);
        expect(eventAutoTriggerAllowed(kind, level)).toBe(base);
        expect(eventNoticeVisibleInScope(kind, level)).toBe(base);
        expect(eventDemoEnabled(kind, level)).toBe(base);
      }
    }
  });

  it('L1-L4 锚点矩阵：耀斑/CME 仅 L1/L2 可触发，超新星仅 L3/L4，合并仅 L4', () => {
    // 锚点连续层级：L1=1, L2=2, L3=3, L4=4（store LEVEL_TO_CONTINUOUS）
    const expectMatrix: Record<ScopedEventKind, boolean[]> = {
      flare: [true, true, false, false],
      cme: [true, true, false, false],
      cmeArrival: [true, true, false, false],
      supernova: [false, false, true, true],
      merger: [false, false, false, true],
    };
    const anchors = [1, 2, 3, 4];
    for (const kind of ALL_KINDS) {
      expect(anchors.map((level) => eventAutoTriggerAllowed(kind, level))).toEqual(
        expectMatrix[kind],
      );
      expect(anchors.map((level) => eventNoticeVisibleInScope(kind, level))).toEqual(
        expectMatrix[kind],
      );
      expect(anchors.map((level) => eventDemoEnabled(kind, level))).toEqual(expectMatrix[kind]);
    }
  });

  it('三层门控对非有限层级同样抛 RangeError', () => {
    expect(() => eventAutoTriggerAllowed('supernova', Number.NaN)).toThrow(RangeError);
    expect(() => eventNoticeVisibleInScope('cme', Number.NaN)).toThrow(RangeError);
    expect(() => eventDemoEnabled('merger', Number.NaN)).toThrow(RangeError);
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

describe('R3-3 §3.1-A：离域计时与丢弃判定纯函数', () => {
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
