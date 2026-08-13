/**
 * O1 天体观察站门控单测（REQUIREMENTS_OBSERVATORY.md §3）：
 * 1) 配置校验与解析（validateObservatoryGateConfig / resolveObservatoryGateConfig）
 * 2) 免费期判定（observatoryFreeWindowActive）
 * 3) 额度消费全分支（observatoryAccessUpdate：权益/免费期豁免、每日总限次、
 *    专属试玩池占用总额度、跨自然日重置、时钟回拨/NaN 防御）
 * 4) 只读剩余查询（observatoryRemaining）
 * 5) localStorage 持久层（observatoryStorage 往返与脏数据防御）
 * 6) 注册表完整性：专属名单 ⊆ PREVIEW_REGISTRY；全部条目 titleKey /
 *    params.labelKey / viewPresets.labelKey 完备（观察站 i18n 渲染前提）
 */
import { OBSERVATORY_GATE_CONFIG, type ObservatoryGateConfig } from '@/data/observatoryGate';
import {
  isPremiumObservatoryBody,
  observatoryAccessUpdate,
  observatoryFreeWindowActive,
  observatoryRemaining,
  resolveObservatoryGateConfig,
  validateObservatoryGateConfig,
  type ObservatoryQuotaState,
} from '../observatoryGate';
import {
  OBSERVATORY_QUOTA_STORAGE_KEY,
  persistObservatoryQuota,
  readStoredObservatoryQuota,
} from '../observatoryStorage';
import { PREVIEW_REGISTRY } from '../devPreview';
import { zh } from '@/i18n/zh';
import { flattenMessages } from '@/i18n';

/** 免费期外的测试配置（判定用例不受默认免费期窗口影响） */
const CONFIG: ObservatoryGateConfig = {
  ...OBSERVATORY_GATE_CONFIG,
  freeWindow: { enabled: false, startUtc: '2026-01-01T00:00:00Z', endUtc: '2026-01-08T00:00:00Z' },
};

/** 免费期内配置（窗口判定用例） */
const FREE_CONFIG: ObservatoryGateConfig = {
  ...CONFIG,
  freeWindow: { enabled: true, startUtc: '2026-01-01T00:00:00Z', endUtc: '2026-01-08T00:00:00Z' },
};

const DAY1_NOON = new Date(2026, 7, 10, 12, 0, 0).getTime();
const DAY2_NOON = new Date(2026, 7, 11, 12, 0, 0).getTime();
const NORMAL_BODY = 'sirius';
const PREMIUM_BODY = 'betelgeuse';

describe('配置校验与解析', () => {
  it('默认配置合法（模块消费前自检）', () => {
    expect(() => validateObservatoryGateConfig(OBSERVATORY_GATE_CONFIG)).not.toThrow();
  });

  it('默认口径登记：每日 10 次 / 专属试玩 3 次 / 专属池 7 个', () => {
    expect(OBSERVATORY_GATE_CONFIG.dailyLimit).toBe(10);
    expect(OBSERVATORY_GATE_CONFIG.premiumTrialDailyLimit).toBe(3);
    expect(OBSERVATORY_GATE_CONFIG.premiumBodyIds).toHaveLength(7);
  });

  it('拒绝非法每日限次（0/负数/小数/NaN）', () => {
    for (const dailyLimit of [0, -1, 2.5, Number.NaN]) {
      expect(() => validateObservatoryGateConfig({ ...CONFIG, dailyLimit })).toThrow(RangeError);
    }
  });

  it('拒绝非法试玩额度（0/负数/小数/大于总限次）', () => {
    for (const premiumTrialDailyLimit of [0, -1, 1.5, CONFIG.dailyLimit + 1]) {
      expect(() =>
        validateObservatoryGateConfig({ ...CONFIG, premiumTrialDailyLimit }),
      ).toThrow(RangeError);
    }
  });

  it('拒绝专属名单空串与重复 id', () => {
    expect(() =>
      validateObservatoryGateConfig({ ...CONFIG, premiumBodyIds: ['a', ''] }),
    ).toThrow(RangeError);
    expect(() =>
      validateObservatoryGateConfig({ ...CONFIG, premiumBodyIds: ['a', 'a'] }),
    ).toThrow(RangeError);
  });

  it('拒绝不可解析/起止倒置的免费期日期', () => {
    expect(() =>
      validateObservatoryGateConfig({
        ...CONFIG,
        freeWindow: { enabled: true, startUtc: 'not-a-date', endUtc: '2026-01-08T00:00:00Z' },
      }),
    ).toThrow(RangeError);
    expect(() =>
      validateObservatoryGateConfig({
        ...CONFIG,
        freeWindow: { enabled: true, startUtc: '2026-01-08T00:00:00Z', endUtc: '2026-01-01T00:00:00Z' },
      }),
    ).toThrow(RangeError);
  });

  it('resolveObservatoryGateConfig：无参 = 默认配置；Partial 覆盖生效（管理后台预留）', () => {
    expect(resolveObservatoryGateConfig()).toEqual(OBSERVATORY_GATE_CONFIG);
    const resolved = resolveObservatoryGateConfig({
      dailyLimit: 20,
      freeWindow: { enabled: false, startUtc: '2026-01-01T00:00:00Z', endUtc: '2026-01-02T00:00:00Z' },
    });
    expect(resolved.dailyLimit).toBe(20);
    expect(resolved.freeWindow.enabled).toBe(false);
    expect(resolved.premiumTrialDailyLimit).toBe(OBSERVATORY_GATE_CONFIG.premiumTrialDailyLimit);
  });

  it('resolveObservatoryGateConfig：非法覆盖即抛错', () => {
    expect(() => resolveObservatoryGateConfig({ dailyLimit: 0 })).toThrow(RangeError);
  });
});

describe('observatoryFreeWindowActive（免费期窗口）', () => {
  const start = Date.parse(FREE_CONFIG.freeWindow.startUtc);
  const end = Date.parse(FREE_CONFIG.freeWindow.endUtc);

  it('窗口内 [start, end) 生效，端点右开', () => {
    expect(observatoryFreeWindowActive(FREE_CONFIG, start)).toBe(true);
    expect(observatoryFreeWindowActive(FREE_CONFIG, end - 1)).toBe(true);
    expect(observatoryFreeWindowActive(FREE_CONFIG, end)).toBe(false);
    expect(observatoryFreeWindowActive(FREE_CONFIG, start - 1)).toBe(false);
  });

  it('开关关闭 / 非有限时钟 → false', () => {
    expect(observatoryFreeWindowActive(CONFIG, start)).toBe(false);
    expect(observatoryFreeWindowActive(FREE_CONFIG, Number.NaN)).toBe(false);
  });
});

describe('observatoryAccessUpdate（额度消费）', () => {
  it('专属名单判定与放行计次：普通天体只占总额度，专属天体双池同扣', () => {
    expect(isPremiumObservatoryBody(CONFIG, PREMIUM_BODY)).toBe(true);
    expect(isPremiumObservatoryBody(CONFIG, NORMAL_BODY)).toBe(false);

    const normal = observatoryAccessUpdate(CONFIG, null, NORMAL_BODY, false, DAY1_NOON);
    expect(normal.allowed).toBe(true);
    expect(normal.counted).toBe(true);
    expect(normal.state).toEqual({
      dateKey: '2026-08-10',
      used: 1,
      premiumUsed: 0,
    });
    expect(normal.remaining).toBe(CONFIG.dailyLimit - 1);

    const premium = observatoryAccessUpdate(CONFIG, normal.state, PREMIUM_BODY, false, DAY1_NOON);
    expect(premium.allowed).toBe(true);
    expect(premium.state).toEqual({ dateKey: '2026-08-10', used: 2, premiumUsed: 1 });
    expect(premium.premiumRemaining).toBe(CONFIG.premiumTrialDailyLimit - 1);
  });

  it('有权益 / 免费期内：放行不计次（counted=false，状态不变）', () => {
    const state: ObservatoryQuotaState = { dateKey: '2026-08-10', used: 4, premiumUsed: 2 };
    const entitled = observatoryAccessUpdate(CONFIG, state, PREMIUM_BODY, true, DAY1_NOON);
    expect(entitled).toMatchObject({ allowed: true, counted: false });
    expect(entitled.state).toEqual(state);

    const freeNow = Date.parse(FREE_CONFIG.freeWindow.startUtc) + 1000;
    const inWindow = observatoryAccessUpdate(FREE_CONFIG, null, PREMIUM_BODY, false, freeNow);
    expect(inWindow).toMatchObject({ allowed: true, counted: false });
    expect(inWindow.state.used).toBe(0);
  });

  it('每日总限次耗尽 → daily-exhausted（普通与专属天体一致，计数不再增长）', () => {
    const exhausted: ObservatoryQuotaState = {
      dateKey: '2026-08-10',
      used: CONFIG.dailyLimit,
      premiumUsed: 0,
    };
    for (const bodyId of [NORMAL_BODY, PREMIUM_BODY]) {
      const denied = observatoryAccessUpdate(CONFIG, exhausted, bodyId, false, DAY1_NOON);
      expect(denied.allowed).toBe(false);
      expect(denied.denyReason).toBe('daily-exhausted');
      expect(denied.state.used).toBe(CONFIG.dailyLimit);
      expect(denied.remaining).toBe(0);
    }
  });

  it('专属试玩池耗尽 → premium-exhausted（总额度仍有剩余时普通天体照常放行）', () => {
    const state: ObservatoryQuotaState = {
      dateKey: '2026-08-10',
      used: 5,
      premiumUsed: CONFIG.premiumTrialDailyLimit,
    };
    const denied = observatoryAccessUpdate(CONFIG, state, PREMIUM_BODY, false, DAY1_NOON);
    expect(denied.allowed).toBe(false);
    expect(denied.denyReason).toBe('premium-exhausted');
    expect(denied.premiumRemaining).toBe(0);

    const normal = observatoryAccessUpdate(CONFIG, state, NORMAL_BODY, false, DAY1_NOON);
    expect(normal.allowed).toBe(true);
  });

  it('试玩计次占用总额度：premiumRemaining 取两池较小值', () => {
    // 总额度只剩 2、试玩池剩 3 → 专属剩余显示 2
    const state: ObservatoryQuotaState = {
      dateKey: '2026-08-10',
      used: CONFIG.dailyLimit - 2,
      premiumUsed: 0,
    };
    const r = observatoryRemaining(CONFIG, state, DAY1_NOON);
    expect(r.remaining).toBe(2);
    expect(r.premiumRemaining).toBe(2);
  });

  it('跨自然日重置两池计数', () => {
    const day1: ObservatoryQuotaState = {
      dateKey: '2026-08-10',
      used: CONFIG.dailyLimit,
      premiumUsed: CONFIG.premiumTrialDailyLimit,
    };
    const result = observatoryAccessUpdate(CONFIG, day1, PREMIUM_BODY, false, DAY2_NOON);
    expect(result.allowed).toBe(true);
    expect(result.state).toEqual({ dateKey: '2026-08-11', used: 1, premiumUsed: 1 });
  });

  it('时钟回拨到前一自然日：dateKey 不匹配触发重置（弱门口径登记）', () => {
    const day2: ObservatoryQuotaState = { dateKey: '2026-08-11', used: 3, premiumUsed: 1 };
    const rolledBack = observatoryAccessUpdate(CONFIG, day2, NORMAL_BODY, false, DAY1_NOON);
    expect(rolledBack.allowed).toBe(true);
    expect(rolledBack.state).toEqual({ dateKey: '2026-08-10', used: 1, premiumUsed: 0 });
  });

  it('脏数据消毒：负数/NaN/小数计数不产生负剩余或 NaN', () => {
    for (const dirty of [-3, Number.NaN, 2.7]) {
      const result = observatoryAccessUpdate(
        CONFIG,
        { dateKey: '2026-08-10', used: dirty, premiumUsed: dirty },
        PREMIUM_BODY,
        false,
        DAY1_NOON,
      );
      expect(Number.isInteger(result.state.used)).toBe(true);
      expect(result.state.used).toBeGreaterThanOrEqual(0);
      expect(result.remaining).toBeGreaterThanOrEqual(0);
      expect(result.premiumRemaining).toBeGreaterThanOrEqual(0);
    }
  });

  it('nowMs 非有限（异常时钟）：沿用现状态 dateKey，不落入 NaN 日键', () => {
    const state: ObservatoryQuotaState = { dateKey: '2026-08-10', used: 2, premiumUsed: 1 };
    const result = observatoryAccessUpdate(CONFIG, state, NORMAL_BODY, false, Number.NaN);
    expect(result.state.dateKey).toBe('2026-08-10');
    expect(result.state.used).toBe(3);

    const fresh = observatoryAccessUpdate(CONFIG, null, NORMAL_BODY, false, Number.NaN);
    expect(fresh.state.dateKey).not.toContain('NaN');
  });
});

describe('observatoryRemaining（只读查询）', () => {
  it('null 状态 / 跨日：满额；同日按已用扣减', () => {
    expect(observatoryRemaining(CONFIG, null, DAY1_NOON)).toEqual({
      remaining: CONFIG.dailyLimit,
      premiumRemaining: CONFIG.premiumTrialDailyLimit,
    });
    const state: ObservatoryQuotaState = { dateKey: '2026-08-10', used: 4, premiumUsed: 1 };
    expect(observatoryRemaining(CONFIG, state, DAY1_NOON)).toEqual({
      remaining: 6,
      premiumRemaining: 2,
    });
    expect(observatoryRemaining(CONFIG, state, DAY2_NOON)).toEqual({
      remaining: CONFIG.dailyLimit,
      premiumRemaining: CONFIG.premiumTrialDailyLimit,
    });
  });
});

describe('observatoryStorage（持久层）', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('键名登记', () => {
    expect(OBSERVATORY_QUOTA_STORAGE_KEY).toBe('stellar-odyssey:observatoryQuota');
  });

  it('写入→读回（JSON 往返）', () => {
    expect(readStoredObservatoryQuota()).toBeNull();
    persistObservatoryQuota({ dateKey: '2026-08-12', used: 3, premiumUsed: 1 });
    expect(readStoredObservatoryQuota()).toEqual({
      dateKey: '2026-08-12',
      used: 3,
      premiumUsed: 1,
    });
  });

  it('脏数据防御：非 JSON/非对象/形状不符一律 null', () => {
    for (const raw of [
      'not-json',
      '42',
      'null',
      '{"dateKey":1,"used":0,"premiumUsed":0}',
      '{"dateKey":"2026-08-12","used":"3","premiumUsed":0}',
      '{"dateKey":"2026-08-12","used":3}',
      '{"dateKey":"2026-08-12","used":3,"premiumUsed":null}',
      // 1e999 经 JSON.parse 得 Infinity（非有限数防御分支）
      '{"dateKey":"2026-08-12","used":1e999,"premiumUsed":0}',
      '{"dateKey":"2026-08-12","used":0,"premiumUsed":1e999}',
    ]) {
      window.localStorage.setItem(OBSERVATORY_QUOTA_STORAGE_KEY, raw);
      expect(readStoredObservatoryQuota()).toBeNull();
    }
  });

  it('存取异常静默（隐私模式/配额异常）', () => {
    const original = window.localStorage;
    const throwing = {
      getItem: (): string => {
        throw new Error('SecurityError');
      },
      setItem: (): void => {
        throw new Error('QuotaExceededError');
      },
    };
    Object.defineProperty(window, 'localStorage', { value: throwing, configurable: true });
    try {
      expect(readStoredObservatoryQuota()).toBeNull();
      expect(() =>
        persistObservatoryQuota({ dateKey: '2026-08-12', used: 1, premiumUsed: 0 }),
      ).not.toThrow();
    } finally {
      Object.defineProperty(window, 'localStorage', { value: original, configurable: true });
    }
  });
});

describe('注册表完整性（观察站 i18n 渲染前提）', () => {
  const zhFlat = flattenMessages(zh);

  it('专属天体名单全部为 PREVIEW_REGISTRY 已注册 id', () => {
    for (const id of OBSERVATORY_GATE_CONFIG.premiumBodyIds) {
      expect(PREVIEW_REGISTRY.has(id)).toBe(true);
    }
  });

  it('全部预览条目声明 titleKey 且键存在于 zh 字典', () => {
    for (const entry of PREVIEW_REGISTRY.values()) {
      expect(entry.titleKey).toBeDefined();
      expect(zhFlat[entry.titleKey!]).toBeDefined();
    }
  });

  it('全部滑杆声明 labelKey 且键存在于 zh 字典', () => {
    for (const entry of PREVIEW_REGISTRY.values()) {
      for (const p of entry.params) {
        expect(p.labelKey).toBeDefined();
        expect(zhFlat[p.labelKey!]).toBeDefined();
      }
    }
  });

  it('全部预设视角声明 labelKey 且键存在于 zh 字典', () => {
    for (const entry of PREVIEW_REGISTRY.values()) {
      for (const v of entry.viewPresets ?? []) {
        expect(v.labelKey).toBeDefined();
        expect(zhFlat[v.labelKey!]).toBeDefined();
      }
    }
  });
});
