/**
 * eventScopes 单元测试（R2-4 §4.1-A/D：事件视角域三层窗口纯函数全覆盖）
 */

import {
  MERGER_EVENT_MIN_LEVEL,
  SOLAR_EVENT_MAX_LEVEL,
  SUPERNOVA_EVENT_MIN_LEVEL,
  eventAutoTriggerAllowed,
  eventDemoDisabledHintZh,
  eventDemoEnabled,
  eventInScope,
  eventNoticeVisibleInScope,
  eventOutOfScopeSummaryZh,
  eventScopeNameZh,
  eventScopeWindow,
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

  it('域外折叠一行提醒（方案 b）逐事件非空且含目标视角名', () => {
    for (const kind of ALL_KINDS) {
      const summary = eventOutOfScopeSummaryZh(kind);
      expect(summary.length).toBeGreaterThan(0);
      expect(summary).toContain(eventScopeNameZh(kind));
      expect(summary).toContain('进行中');
    }
  });

  it('折叠提醒逐类文案可区分（不同事件不混淆）', () => {
    const summaries = ALL_KINDS.map((kind) => eventOutOfScopeSummaryZh(kind));
    expect(new Set(summaries).size).toBe(ALL_KINDS.length);
  });
});
