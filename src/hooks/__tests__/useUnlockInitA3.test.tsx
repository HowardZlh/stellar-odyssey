/**
 * useUnlockInit 远程门控配置接入测试（A3-1，REQUIREMENTS_UNLOCK.md §A3）
 * 1) refreshRemoteGateConfig 拉取降级矩阵：网络失败/HTTP 非 2xx/垃圾
 *    JSON/not_configured → 行为与无配置全等（store 与缓存零变化 +
 *    console.warn 一次）；成功 → 写缓存 + store
 * 2) 挂载序列：缓存同步消毒即用（合法缓存生效 / 垃圾缓存消毒为空配置）
 *
 * fetch mock 沿用 unlock.test.tsx 范式（global.fetch = jest.fn()）。
 */
import { render } from '@testing-library/react';
import type { JSX } from 'react';

import {
  refreshRemoteGateConfig,
  useUnlockInit,
} from '@/hooks/useUnlockInit';
import { useSimulationStore } from '@/store';
import { GATE_CONFIG_STORAGE_KEY } from '@/utils/unlockStorage';

/** 挂载探针（useUnlockInit 为 hook，经组件挂载触发 effect） */
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
    remoteGateConfig: { v: 1 },
    remoteTourFreeActive: false,
    remoteDemoFreeActive: false,
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('A3-1 refreshRemoteGateConfig 拉取与降级', () => {
  it('成功：redeem 同基址 URL 拉取 → 写缓存 + store 应用', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async (): Promise<unknown> => ({
        ok: true,
        config: { v: 1, demo: { dailyLimit: 9 } },
      }),
    });
    await refreshRemoteGateConfig();
    expect(global.fetch).toHaveBeenCalledWith(
      'https://stellar.guushu.com/api/gate-config',
    );
    expect(useSimulationStore.getState().remoteGateConfig).toEqual({
      v: 1,
      demo: { dailyLimit: 9 },
    });
    expect(
      JSON.parse(window.localStorage.getItem(GATE_CONFIG_STORAGE_KEY) ?? 'null'),
    ).toEqual({ v: 1, demo: { dailyLimit: 9 } });
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
      'not_configured 降级',
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
    [
      '响应形状不符（config 非对象）',
      (): void => {
        (global.fetch as jest.Mock).mockResolvedValueOnce({
          ok: true,
          json: async (): Promise<unknown> => ({ ok: true, config: 'junk' }),
        });
      },
    ],
  ])('%s → 静默保持现值（store/缓存零变化）+ warn 一次', async (_name, arm) => {
    // 现值 = 先行注入的会话配置（验证"保持现值"而非"回退默认"）
    useSimulationStore
      .getState()
      .applyRemoteGateConfig({ v: 1, demo: { dailyLimit: 7 } });
    arm();
    await refreshRemoteGateConfig();
    expect(useSimulationStore.getState().remoteGateConfig).toEqual({
      v: 1,
      demo: { dailyLimit: 7 },
    });
    expect(window.localStorage.getItem(GATE_CONFIG_STORAGE_KEY)).toBeNull();
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});

describe('A3-1 挂载序列（缓存同步即用，stale-while-revalidate）', () => {
  it('合法缓存：挂载即同步应用（fetch 失败不影响）', () => {
    window.localStorage.setItem(
      GATE_CONFIG_STORAGE_KEY,
      JSON.stringify({ v: 1, demo: { dailyLimit: 3 } }),
    );
    (global.fetch as jest.Mock).mockRejectedValue(new Error('offline'));
    const { unmount } = render(<Probe />);
    expect(useSimulationStore.getState().remoteGateConfig).toEqual({
      v: 1,
      demo: { dailyLimit: 3 },
    });
    unmount();
  });

  it('垃圾缓存：消毒为空配置（行为与无配置全等）', () => {
    window.localStorage.setItem(
      GATE_CONFIG_STORAGE_KEY,
      JSON.stringify({ v: 99, demo: { dailyLimit: 3 } }),
    );
    (global.fetch as jest.Mock).mockRejectedValue(new Error('offline'));
    const { unmount } = render(<Probe />);
    expect(useSimulationStore.getState().remoteGateConfig).toEqual({ v: 1 });
    unmount();
  });

  it('无缓存：保持内置默认（零差异回归）', () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error('offline'));
    const { unmount } = render(<Probe />);
    expect(useSimulationStore.getState().remoteGateConfig).toEqual({ v: 1 });
    unmount();
  });
});
