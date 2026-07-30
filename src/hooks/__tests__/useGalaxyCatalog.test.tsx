/**
 * R5-3 目录加载 Hook 回归：enabled 抖动竞态（无头目验发现的 P0 缺陷）
 *
 * 场景：L4 飞入途中 continuousLevel 跨越淡入窗口下界抖动，enabled
 * true→false→true——fetch 在 false 窗口内落地时旧实现 alive=false 跳过
 * setData 且模块缓存 resolved 已写入，重新 enabled 后 effect 早退，
 * 目录永远不挂载（降级假象）。修复：enabled 且缓存命中时同步缓存到状态。
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import {
  GALAXY_CATALOG_MAGIC,
  GALAXY_CATALOG_VERSION,
  resetBakedDataCache,
} from '@/utils/bakedData';
import { resetGalaxyCatalogForTest, useGalaxyCatalog } from '@/hooks/useGalaxyCatalog';

/** 最小合法产物缓冲（N=20,000，确定性壳层分布——bakedDataGalaxyCatalog 同式） */
function buildValidBuffer(): ArrayBuffer {
  const n = 20000;
  const data = new Float32Array(3 + n * 4);
  data[0] = GALAXY_CATALOG_MAGIC;
  data[1] = GALAXY_CATALOG_VERSION;
  data[2] = n;
  for (let i = 0; i < n; i += 1) {
    const r = 5 + (i % 500);
    const a = (i / n) * Math.PI * 2;
    const b = ((i % 97) / 97 - 0.5) * Math.PI * 0.9;
    data[3 + i * 4] = Math.fround(r * Math.cos(b) * Math.cos(a));
    data[3 + i * 4 + 1] = Math.fround(r * Math.cos(b) * Math.sin(a));
    data[3 + i * 4 + 2] = Math.fround(r * Math.sin(b));
    data[3 + i * 4 + 3] = (i % 3) * 1000 + (i % 1000);
  }
  return data.buffer;
}

afterEach(() => {
  resetBakedDataCache();
  resetGalaxyCatalogForTest();
  jest.restoreAllMocks();
});

describe('useGalaxyCatalog', () => {
  it('enabled 后加载成功并返回目录数据', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(buildValidBuffer()),
    }) as unknown as typeof fetch;
    const { result } = renderHook(({ enabled }) => useGalaxyCatalog(enabled), {
      initialProps: { enabled: true },
    });
    await waitFor(() => expect(result.current).not.toBeNull());
    expect(result.current?.count).toBe(20000);
  });

  it('未 enabled 时不 fetch，返回 null', async () => {
    const mock = jest.fn();
    global.fetch = mock as unknown as typeof fetch;
    const { result } = renderHook(({ enabled }) => useGalaxyCatalog(enabled), {
      initialProps: { enabled: false },
    });
    await act(async () => Promise.resolve());
    expect(result.current).toBeNull();
    expect(mock).not.toHaveBeenCalled();
  });

  it('竞态回归：fetch 在 enabled=false 窗口内落地后重新 enabled 仍能挂载（P0 修复）', async () => {
    let resolveFetch: ((value: unknown) => void) | undefined;
    global.fetch = jest.fn().mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    ) as unknown as typeof fetch;
    const { result, rerender } = renderHook(({ enabled }) => useGalaxyCatalog(enabled), {
      initialProps: { enabled: true },
    });
    // enabled 抖动：fetch 尚在途中即离开窗口
    rerender({ enabled: false });
    // fetch 在禁用窗口内落地（旧实现此处丢结果）
    await act(async () => {
      resolveFetch?.({ ok: true, arrayBuffer: () => Promise.resolve(buildValidBuffer()) });
      await Promise.resolve();
    });
    expect(result.current).toBeNull();
    // 重新进入窗口：必须能从模块缓存同步（修复点）
    rerender({ enabled: true });
    await waitFor(() => expect(result.current).not.toBeNull());
    expect(result.current?.count).toBe(20000);
  });

  it('加载失败保持 null（消费方降级程序化宇宙网），重新 enabled 可重试', async () => {
    const mock = jest.fn().mockResolvedValue({ ok: false });
    global.fetch = mock as unknown as typeof fetch;
    const { result, rerender } = renderHook(({ enabled }) => useGalaxyCatalog(enabled), {
      initialProps: { enabled: true },
    });
    await act(async () => Promise.resolve());
    expect(result.current).toBeNull();
    rerender({ enabled: false });
    rerender({ enabled: true });
    await act(async () => Promise.resolve());
    expect(mock).toHaveBeenCalledTimes(2);
    expect(result.current).toBeNull();
  });
});
