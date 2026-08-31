/**
 * 匿名漏斗计数前端单测（G8，REQUIREMENTS_GROWTH §4 验收：
 * 累积/上限/单次发送/防重发/键白名单 + fail-soft）。
 */
import {
  FUNNEL_COUNTS_STORAGE_KEY,
  FUNNEL_COUNT_CAP,
  FUNNEL_EVENTS,
  FUNNEL_SENT_STORAGE_KEY,
  __resetFunnelListenersForTest,
  buildFunnelPayload,
  flushFunnelCounts,
  funnelDateOf,
  incrementFunnelCount,
  isFunnelEvent,
  sanitizeFunnelCounts,
  trackFunnelEvent,
} from '@/utils/funnel';

/** sendBeacon mock 注入（jsdom 无原生实现） */
function mockSendBeacon(result: boolean): jest.Mock {
  const fn = jest.fn().mockReturnValue(result);
  Object.defineProperty(navigator, 'sendBeacon', {
    value: fn,
    configurable: true,
    writable: true,
  });
  return fn;
}

function storedCounts(): unknown {
  const raw = window.sessionStorage.getItem(FUNNEL_COUNTS_STORAGE_KEY);
  return raw === null ? null : (JSON.parse(raw) as unknown);
}

beforeEach(() => {
  window.sessionStorage.clear();
  __resetFunnelListenersForTest();
});

afterEach(() => {
  // 清理 sendBeacon 注入（防跨测试污染）
  delete (navigator as unknown as Record<string, unknown>).sendBeacon;
});

describe('纯函数：白名单 / 消毒 / 累积 / 载荷', () => {
  it('7 键白名单与 Worker 侧约定一致（人工同步登记锚点）', () => {
    expect(FUNNEL_EVENTS).toEqual([
      'lock_shown',
      'lock_cta',
      'unlock_view',
      'tier_cta',
      'pay_open',
      'redeem_submit',
      'share_click',
    ]);
    expect(isFunnelEvent('lock_shown')).toBe(true);
    expect(isFunnelEvent('evil')).toBe(false);
    expect(isFunnelEvent(42)).toBe(false);
  });

  it('sanitizeFunnelCounts：白名单外键/非正整数丢弃、超上限钳制、非法整体回退空表', () => {
    expect(
      sanitizeFunnelCounts({
        lock_shown: 3,
        evil: 9,
        lock_cta: 0,
        unlock_view: -1,
        tier_cta: 1.5,
        pay_open: '7',
        share_click: FUNNEL_COUNT_CAP + 100,
      }),
    ).toEqual({ lock_shown: 3, share_click: FUNNEL_COUNT_CAP });
    expect(sanitizeFunnelCounts(null)).toEqual({});
    expect(sanitizeFunnelCounts([1])).toEqual({});
    expect(sanitizeFunnelCounts('x')).toEqual({});
  });

  it('incrementFunnelCount：+1 累积且到上限封顶（纯函数不改入参）', () => {
    const base = { lock_shown: 1 } as const;
    expect(incrementFunnelCount(base, 'lock_shown')).toEqual({ lock_shown: 2 });
    expect(incrementFunnelCount(base, 'share_click')).toEqual({
      lock_shown: 1,
      share_click: 1,
    });
    expect(base).toEqual({ lock_shown: 1 });
    expect(
      incrementFunnelCount({ lock_cta: FUNNEL_COUNT_CAP }, 'lock_cta'),
    ).toEqual({ lock_cta: FUNNEL_COUNT_CAP });
  });

  it('funnelDateOf：UTC YYYY-MM-DD', () => {
    expect(funnelDateOf(new Date('2026-08-31T23:59:59+08:00'))).toBe('2026-08-31');
    expect(funnelDateOf(new Date('2026-08-31T23:59:59Z'))).toBe('2026-08-31');
  });

  it('buildFunnelPayload：空计数 → null（零事件零请求）', () => {
    expect(buildFunnelPayload({}, '2026-08-31')).toBeNull();
    expect(buildFunnelPayload({ pay_open: 2 }, '2026-08-31')).toEqual({
      d: '2026-08-31',
      e: { pay_open: 2 },
    });
  });
});

describe('trackFunnelEvent：sessionStorage 累积', () => {
  it('多次记录累积计数（含多键）', () => {
    trackFunnelEvent('lock_shown');
    trackFunnelEvent('lock_shown');
    trackFunnelEvent('lock_cta');
    expect(storedCounts()).toEqual({ lock_shown: 2, lock_cta: 1 });
  });

  it('已发送打标后不再累积（本会话不会再发送，避免无效写）', () => {
    window.sessionStorage.setItem(FUNNEL_SENT_STORAGE_KEY, '1');
    trackFunnelEvent('unlock_view');
    expect(storedCounts()).toBeNull();
  });

  it('存值被污染（非法 JSON）→ 静默重置累积，不抛异常', () => {
    window.sessionStorage.setItem(FUNNEL_COUNTS_STORAGE_KEY, '{broken');
    expect(() => trackFunnelEvent('tier_cta')).not.toThrow();
    expect(storedCounts()).toEqual({ tier_cta: 1 });
  });

  it('fail-soft：sessionStorage 抛异常（隐私模式）不影响调用方', () => {
    const spy = jest
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('QuotaExceededError');
      });
    expect(() => trackFunnelEvent('pay_open')).not.toThrow();
    spy.mockRestore();
  });
});

describe('flushFunnelCounts：单次发送 + 防重发', () => {
  it('sendBeacon 成功 → 打标 + 清计数；载荷为 {d, e} 紧凑摘要', () => {
    const beacon = mockSendBeacon(true);
    trackFunnelEvent('lock_shown');
    trackFunnelEvent('share_click');
    flushFunnelCounts();
    expect(beacon).toHaveBeenCalledTimes(1);
    const [url, body] = beacon.mock.calls[0] as [string, string];
    expect(url).toBe('https://stellar.guushu.com/api/ev');
    expect(JSON.parse(body)).toEqual({
      d: funnelDateOf(new Date()),
      e: { lock_shown: 1, share_click: 1 },
    });
    expect(window.sessionStorage.getItem(FUNNEL_SENT_STORAGE_KEY)).toBe('1');
    expect(storedCounts()).toBeNull();
  });

  it('已打标 → 再 flush 零请求（每会话最多成功发送 1 次）', () => {
    const beacon = mockSendBeacon(true);
    trackFunnelEvent('lock_shown');
    flushFunnelCounts();
    flushFunnelCounts();
    expect(beacon).toHaveBeenCalledTimes(1);
  });

  it('零事件 → 零请求', () => {
    const beacon = mockSendBeacon(true);
    flushFunnelCounts();
    expect(beacon).not.toHaveBeenCalled();
  });

  it('sendBeacon 返回 false → 不打标、计数保留（下次隐藏重试）', () => {
    const beacon = mockSendBeacon(false);
    trackFunnelEvent('redeem_submit');
    flushFunnelCounts();
    expect(beacon).toHaveBeenCalledTimes(1);
    expect(window.sessionStorage.getItem(FUNNEL_SENT_STORAGE_KEY)).toBeNull();
    expect(storedCounts()).toEqual({ redeem_submit: 1 });
  });

  it('sendBeacon 缺失（老浏览器）→ 静默不抛', () => {
    trackFunnelEvent('lock_shown');
    expect(() => flushFunnelCounts()).not.toThrow();
    expect(storedCounts()).toEqual({ lock_shown: 1 });
  });

  it('sendBeacon 抛异常 → fail-soft 静默', () => {
    Object.defineProperty(navigator, 'sendBeacon', {
      value: () => {
        throw new Error('boom');
      },
      configurable: true,
      writable: true,
    });
    trackFunnelEvent('lock_shown');
    expect(() => flushFunnelCounts()).not.toThrow();
  });
});

describe('flush 触发器（visibilitychange:hidden + pagehide 兜底）', () => {
  it('页面隐藏 → 自动发送；pagehide → 兜底发送', () => {
    const beacon = mockSendBeacon(true);
    trackFunnelEvent('lock_shown'); // 首个 track 懒注册监听器
    Object.defineProperty(document, 'visibilityState', {
      value: 'hidden',
      configurable: true,
    });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(beacon).toHaveBeenCalledTimes(1);
    // pagehide 兜底：已打标 → 不重发
    window.dispatchEvent(new Event('pagehide'));
    expect(beacon).toHaveBeenCalledTimes(1);
    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      configurable: true,
    });
  });

  it('visible 态的 visibilitychange 不触发发送', () => {
    const beacon = mockSendBeacon(true);
    trackFunnelEvent('lock_cta');
    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      configurable: true,
    });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(beacon).not.toHaveBeenCalled();
  });
});
