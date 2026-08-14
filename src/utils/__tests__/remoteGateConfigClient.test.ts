/**
 * 远程门控配置前端消费薄模块测试（A3-1，REQUIREMENTS_UNLOCK.md §A3）
 * 1) resolveGateConfigApiUrl：生产默认/覆写/尾斜杠归一（redeem 同范式）
 * 2) parseGateConfigResponse：契约矩阵（ok:true 透传消毒 / not_configured
 *    与形状不符 → null 保持现值 / 空配置与 v≠1 消毒回默认并采用）
 * 3) remotePremiumBodyIdSet：数组身份 memo（帧循环零分配纪律）
 * 4) resolveRemoteObservatoryGateConfig：合法合并/非法兜底回默认
 * 5) unlockStorage gateConfig 缓存读写（防御式）
 * 6) 白名单整表替换接线级模拟（useDetailLayer 组合口径：缩表放行/
 *    扩表拦截/限免旁路）
 */

import {
  GATE_CONFIG_API_PATH,
  parseGateConfigResponse,
  remotePremiumBodyIdSet,
  resolveGateConfigApiUrl,
  resolveRemoteObservatoryGateConfig,
} from '@/utils/remoteGateConfigClient';
import { REDEEM_API_DEFAULT_BASE } from '@/utils/unlockRedeem';
import { OBSERVATORY_GATE_CONFIG } from '@/data/observatoryGate';
import { premiumDetailGateUpdate } from '@/utils/premiumGate';
import { remoteFreeWindowActive } from '@/utils/remoteGateConfig';
import {
  GATE_CONFIG_STORAGE_KEY,
  persistGateConfig,
  readStoredGateConfig,
} from '@/utils/unlockStorage';

const NOW_MS = 1_785_000_000_000;

describe('resolveGateConfigApiUrl（redeem 同范式）', () => {
  it('缺省/空白 → 生产基址', () => {
    expect(resolveGateConfigApiUrl()).toBe(
      `${REDEEM_API_DEFAULT_BASE}${GATE_CONFIG_API_PATH}`,
    );
    expect(resolveGateConfigApiUrl(null)).toBe(
      'https://stellar.guushu.com/api/gate-config',
    );
    expect(resolveGateConfigApiUrl('   ')).toBe(
      'https://stellar.guushu.com/api/gate-config',
    );
  });

  it('覆写基址 + 尾斜杠归一', () => {
    expect(resolveGateConfigApiUrl('http://127.0.0.1:8787')).toBe(
      'http://127.0.0.1:8787/api/gate-config',
    );
    expect(resolveGateConfigApiUrl('http://127.0.0.1:8787//')).toBe(
      'http://127.0.0.1:8787/api/gate-config',
    );
  });
});

describe('parseGateConfigResponse（§0.11 契约矩阵）', () => {
  it('形状不符 → null（保持现值语义）：非对象/数组/缺 ok/ok:false（含 not_configured）', () => {
    expect(parseGateConfigResponse(null)).toBeNull();
    expect(parseGateConfigResponse('junk')).toBeNull();
    expect(parseGateConfigResponse([])).toBeNull();
    expect(parseGateConfigResponse({})).toBeNull();
    expect(parseGateConfigResponse({ ok: false, error: 'not_configured' })).toBeNull();
    expect(parseGateConfigResponse({ ok: 'true', config: {} })).toBeNull();
  });

  it('config 非普通对象 → null：缺失/字符串/数组/null', () => {
    expect(parseGateConfigResponse({ ok: true })).toBeNull();
    expect(parseGateConfigResponse({ ok: true, config: 'junk' })).toBeNull();
    expect(parseGateConfigResponse({ ok: true, config: [] })).toBeNull();
    expect(parseGateConfigResponse({ ok: true, config: null })).toBeNull();
  });

  it('KV 无记录 {} 与 v≠1 → 消毒为空配置并采用（删配置即回滚默认）', () => {
    expect(parseGateConfigResponse({ ok: true, config: {} })).toEqual({ v: 1 });
    expect(parseGateConfigResponse({ ok: true, config: { v: 2, demo: {} } })).toEqual({
      v: 1,
    });
  });

  it('合法配置 → 消毒后透传（非法字段细粒度丢弃）', () => {
    const parsed = parseGateConfigResponse({
      ok: true,
      config: {
        v: 1,
        demo: { dailyLimit: 8 },
        detail: { premiumBodyIds: ['m31'], freeWindow: 'junk' },
        extra: 'ignored',
      },
    });
    expect(parsed).toEqual({
      v: 1,
      demo: { dailyLimit: 8 },
      detail: { premiumBodyIds: ['m31'] },
    });
  });
});

describe('remotePremiumBodyIdSet（数组身份 memo）', () => {
  it('undefined → undefined（回退代码默认名单）', () => {
    expect(remotePremiumBodyIdSet(undefined)).toBeUndefined();
  });

  it('同一数组引用逐次返回同一 Set 实例（帧循环零分配）', () => {
    const ids = ['m31', 'betelgeuse'];
    const first = remotePremiumBodyIdSet(ids);
    expect(first).toEqual(new Set(['m31', 'betelgeuse']));
    expect(remotePremiumBodyIdSet(ids)).toBe(first);
  });

  it('数组引用更换（新配置注入）→ 重建 Set', () => {
    const first = remotePremiumBodyIdSet(['m31']);
    const second = remotePremiumBodyIdSet(['m33']);
    expect(second).not.toBe(first);
    expect(second).toEqual(new Set(['m33']));
  });
});

describe('resolveRemoteObservatoryGateConfig（validate 兜底）', () => {
  it('无覆盖 → 代码默认配置', () => {
    expect(resolveRemoteObservatoryGateConfig()).toEqual(OBSERVATORY_GATE_CONFIG);
  });

  it('合法覆盖 → 合并生效', () => {
    const config = resolveRemoteObservatoryGateConfig({ dailyLimit: 20 });
    expect(config.dailyLimit).toBe(20);
    expect(config.premiumTrialDailyLimit).toBe(
      OBSERVATORY_GATE_CONFIG.premiumTrialDailyLimit,
    );
  });

  it('非法覆盖（消毒前置理论不可达）→ try/catch 兜底回默认 + warn', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    expect(resolveRemoteObservatoryGateConfig({ dailyLimit: -1 })).toEqual(
      OBSERVATORY_GATE_CONFIG,
    );
    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });
});

describe('unlockStorage gateConfig 缓存（A3-1 防御式读写）', () => {
  beforeEach(() => window.localStorage.clear());

  it('roundtrip：persist 后 read 返回解析原值（消毒由调用方完成）', () => {
    persistGateConfig({ v: 1, demo: { dailyLimit: 3 } });
    expect(readStoredGateConfig()).toEqual({ v: 1, demo: { dailyLimit: 3 } });
  });

  it('无存值 → null；垃圾 JSON → null', () => {
    expect(readStoredGateConfig()).toBeNull();
    window.localStorage.setItem(GATE_CONFIG_STORAGE_KEY, '{broken');
    expect(readStoredGateConfig()).toBeNull();
  });

  it('存取异常（隐私模式）→ 读 null / 写静默', () => {
    const getSpy = jest
      .spyOn(Storage.prototype, 'getItem')
      .mockImplementation(() => {
        throw new Error('denied');
      });
    expect(readStoredGateConfig()).toBeNull();
    getSpy.mockRestore();
    const setSpy = jest
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('denied');
      });
    expect(() => persistGateConfig({ v: 1 })).not.toThrow();
    setSpy.mockRestore();
  });
});

describe('白名单整表替换接线级模拟（useDetailLayer 组合口径）', () => {
  const NOW_SEC = NOW_MS / 1000;
  const optionsFor = (detail: {
    premiumBodyIds?: readonly string[];
    freeWindow?: { enabled: boolean; startUtc: string; endUtc: string };
  }): { premiumBodyIds?: ReadonlySet<string>; freeWindowActive: boolean } => ({
    premiumBodyIds: remotePremiumBodyIdSet(detail.premiumBodyIds),
    freeWindowActive: remoteFreeWindowActive(detail.freeWindow, NOW_MS),
  });

  it('缩表（仅 m31 付费）：betelgeuse 放行、m31 仍拦截', () => {
    const options = optionsFor({ premiumBodyIds: ['m31'] });
    expect(
      premiumDetailGateUpdate(true, null, 'betelgeuse', NOW_SEC, options),
    ).toEqual({ active: true, lockedHit: false });
    expect(premiumDetailGateUpdate(true, null, 'm31', NOW_SEC, options)).toEqual({
      active: false,
      lockedHit: true,
    });
  });

  it('扩表（heliopause 入表）：免费项变付费拦截', () => {
    const options = optionsFor({ premiumBodyIds: ['heliopause'] });
    expect(
      premiumDetailGateUpdate(true, null, 'heliopause', NOW_SEC, options),
    ).toEqual({ active: false, lockedHit: true });
  });

  it('detail 限免窗口期内：付费天体免费态放行', () => {
    const options = optionsFor({
      freeWindow: {
        enabled: true,
        startUtc: '2000-01-01T00:00:00Z',
        endUtc: '2100-01-01T00:00:00Z',
      },
    });
    expect(options.premiumBodyIds).toBeUndefined();
    expect(premiumDetailGateUpdate(true, null, 'm31', NOW_SEC, options)).toEqual({
      active: true,
      lockedHit: false,
    });
  });
});
