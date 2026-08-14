/**
 * useUnlockInit 吊销名单拉取接入测试（A6-3，REQUIREMENTS_UNLOCK.md §A6-3）
 * 1) refreshRevocationList 拉取矩阵：成功（含 KV 无记录空对象）→ 写缓存 +
 *    store 核对；网络失败/HTTP 非 2xx/垃圾 JSON/not_configured/形状不符
 *    → revocationFetchFailed（fail-closed 与 gate-config 静默保持的差异）
 * 2) 挂载序列：restore（缓存同步比对）→ 异步拉取（挂起补恢复）
 * 3) revocationListClient URL 解析（同基址）
 *
 * fetch mock 沿用 useUnlockInitA3 范式；验签公钥 jest.mock 测试密钥对。
 */
jest.mock('@/data/unlockPublicKey', () => ({
  __esModule: true,
  UNLOCK_PUBLIC_KEY_HEX:
    '79b5562e8fe654f94078b112e8a98ba7901f853ae695bed7e0e3910bad049664',
}));

import { render, waitFor } from '@testing-library/react';
import type { JSX } from 'react';

import { refreshRevocationList, useUnlockInit } from '@/hooks/useUnlockInit';
import { useSimulationStore } from '@/store';
import {
  emptyRevocationList,
  unlockTokenHash,
} from '@/utils/revocationList';
import {
  parseRevocationsResponse,
  resolveRevocationsApiUrl,
} from '@/utils/revocationListClient';
import {
  REVOCATIONS_STORAGE_KEY,
  UNLOCK_TOKEN_STORAGE_KEY,
} from '@/utils/unlockStorage';
import { signToken } from '@/utils/unlockToken';

const TEST_PRIVATE_KEY = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
const NOW_SEC = Math.floor(Date.now() / 1000);

function makeToken(): string {
  return signToken(
    {
      v: 1,
      tier: 'month',
      exp: NOW_SEC + 31 * 86_400,
      iat: NOW_SEC,
      ch: 'afdian',
    },
    TEST_PRIVATE_KEY,
  );
}

/** 挂载探针 */
function Probe(): JSX.Element | null {
  useUnlockInit();
  return null;
}

let warnSpy: jest.SpyInstance;

beforeEach(() => {
  global.fetch = jest.fn() as unknown as typeof fetch;
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  window.localStorage.clear();
  useSimulationStore.setState({
    entitlement: null,
    demoQuota: null,
    entitlementRemainingDays: null,
    entitlementTokenHash: null,
    entitlementRevoked: false,
    revocationCheckPending: false,
    revocationListReady: false,
    revocationCheckFailed: false,
    revocationList: emptyRevocationList(),
    remoteGateConfig: { v: 1 },
    lockedHint: null,
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('A6-3 revocationListClient（URL 与响应解析）', () => {
  it('URL 解析：默认生产基址 + 覆写基址尾斜杠归一', () => {
    expect(resolveRevocationsApiUrl()).toBe(
      'https://stellar.guushu.com/api/revocations',
    );
    expect(resolveRevocationsApiUrl('http://127.0.0.1:8787/')).toBe(
      'http://127.0.0.1:8787/api/revocations',
    );
    expect(resolveRevocationsApiUrl('  ')).toBe(
      'https://stellar.guushu.com/api/revocations',
    );
  });

  it('响应解析：合法名单消毒采用；KV 无记录 {} → 空名单', () => {
    const entry = { h: 'a'.repeat(64), exp: 1, at: 'x' };
    expect(
      parseRevocationsResponse({ ok: true, list: { v: 1, entries: [entry] } }),
    ).toEqual({ v: 1, entries: [entry] });
    expect(parseRevocationsResponse({ ok: true, list: {} })).toEqual(
      emptyRevocationList(),
    );
  });

  it.each([
    ['not_configured', { ok: false, error: 'not_configured' }],
    ['list 非对象', { ok: true, list: 'junk' }],
    ['list 为数组', { ok: true, list: [] }],
    ['非对象响应', 'junk'],
    ['null', null],
  ])('形状不符（%s）→ null（按拉取失败处理）', (_name, raw) => {
    expect(parseRevocationsResponse(raw)).toBeNull();
  });
});

describe('A6-3 refreshRevocationList 拉取矩阵', () => {
  it('成功：同基址 URL 拉取 → 写缓存 + store 核对（空名单采用）', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async (): Promise<unknown> => ({ ok: true, list: {} }),
    });
    await refreshRevocationList();
    expect(global.fetch).toHaveBeenCalledWith(
      'https://stellar.guushu.com/api/revocations',
    );
    expect(useSimulationStore.getState().revocationListReady).toBe(true);
    expect(
      JSON.parse(
        window.localStorage.getItem(REVOCATIONS_STORAGE_KEY) ?? 'null',
      ),
    ).toEqual({ v: 1, entries: [] });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it.each([
    [
      '网络失败（fetch reject）',
      (): void => {
        (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('offline'));
      },
    ],
    [
      'HTTP 非 2xx',
      (): void => {
        (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false });
      },
    ],
    [
      '响应体垃圾 JSON（json() 抛异常）',
      (): void => {
        (global.fetch as jest.Mock).mockResolvedValueOnce({
          ok: true,
          json: async (): Promise<unknown> => {
            throw new SyntaxError('bad json');
          },
        });
      },
    ],
    [
      'not_configured（无法核验 → 按失败处理，gate-config 静默口径的差异登记）',
      (): void => {
        (global.fetch as jest.Mock).mockResolvedValueOnce({
          ok: true,
          json: async (): Promise<unknown> => ({
            ok: false,
            error: 'not_configured',
          }),
        });
      },
    ],
  ])('%s → revocationFetchFailed（无缓存 → 核验失败态）+ warn 一次', async (_name, arm) => {
    arm();
    await refreshRevocationList();
    expect(useSimulationStore.getState().revocationCheckFailed).toBe(true);
    expect(window.localStorage.getItem(REVOCATIONS_STORAGE_KEY)).toBeNull();
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('失败但已有缓存名单（restore 已放行）→ 静默（缓存软化）', async () => {
    window.localStorage.setItem(
      REVOCATIONS_STORAGE_KEY,
      JSON.stringify(emptyRevocationList()),
    );
    useSimulationStore.getState().restoreUnlockState();
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('offline'));
    await refreshRevocationList();
    expect(useSimulationStore.getState().revocationCheckFailed).toBe(false);
  });
});

describe('A6-3 挂载序列（restore 缓存比对 → 异步拉取补恢复）', () => {
  it('无缓存 + 拉取成功：挂起权益经拉取补恢复', async () => {
    window.localStorage.setItem(UNLOCK_TOKEN_STORAGE_KEY, makeToken());
    (global.fetch as jest.Mock).mockImplementation(async (url: unknown) => {
      if (String(url).includes('/api/revocations')) {
        return {
          ok: true,
          json: async (): Promise<unknown> => ({ ok: true, list: {} }),
        };
      }
      // gate-config 等其余拉取：失败降级（本用例不关心）
      throw new Error('offline');
    });
    const { unmount } = render(<Probe />);
    // restore 同步阶段：无缓存 → 挂起
    expect(useSimulationStore.getState().entitlement).toBeNull();
    await waitFor(() => {
      expect(useSimulationStore.getState().entitlement).not.toBeNull();
    });
    unmount();
  });

  it('缓存命中吊销：挂载同步即吊销（fetch 全失败不影响）', () => {
    const token = makeToken();
    window.localStorage.setItem(UNLOCK_TOKEN_STORAGE_KEY, token);
    window.localStorage.setItem(
      REVOCATIONS_STORAGE_KEY,
      JSON.stringify({
        v: 1,
        entries: [
          { h: unlockTokenHash(token), exp: NOW_SEC + 86_400, at: 'x' },
        ],
      }),
    );
    (global.fetch as jest.Mock).mockRejectedValue(new Error('offline'));
    const { unmount } = render(<Probe />);
    const state = useSimulationStore.getState();
    expect(state.entitlement).toBeNull();
    expect(state.entitlementRevoked).toBe(true);
    expect(window.localStorage.getItem(UNLOCK_TOKEN_STORAGE_KEY)).toBeNull();
    unmount();
  });
});
