/**
 * LE-M1 月食星历 Hook 三态单测（useSolarEclipses 范式）：
 * loading → ready / failed，模块级共享结果复用。
 */
import { renderHook, waitFor } from '@testing-library/react';
import { readFileSync } from 'fs';
import { join } from 'path';
import { resetBakedDataCache } from '@/utils/bakedData';
import { resetLunarEclipsesForTest, useLunarEclipses } from '@/hooks/useLunarEclipses';

const eclipsesRaw = JSON.parse(
  readFileSync(join(process.cwd(), 'public/data/lunar_eclipses.json'), 'utf8')
) as unknown;

afterEach(() => {
  resetBakedDataCache();
  resetLunarEclipsesForTest();
  jest.restoreAllMocks();
});

describe('useLunarEclipses', () => {
  it('加载成功 → ready 且四事件齐全；共享结果二次挂载即 ready', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(eclipsesRaw),
    }) as unknown as typeof fetch;
    const { result } = renderHook(() => useLunarEclipses());
    expect(result.current.status).toBe('loading');
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.data?.events.map((e) => e.id)).toEqual([
      'l2029',
      'l2026',
      'l2027',
      'l1992',
    ]);
    // 模块级共享：第二个消费者首帧即 ready
    const { result: second } = renderHook(() => useLunarEclipses());
    expect(second.current.status).toBe('ready');
    expect(second.current.data).toBe(result.current.data);
  });

  it('加载失败 → failed（消费方降级提示，不白屏）', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false }) as unknown as typeof fetch;
    const { result } = renderHook(() => useLunarEclipses());
    await waitFor(() => expect(result.current.status).toBe('failed'));
    expect(result.current.data).toBeNull();
  });

  it('校验失败 → failed（结构非法产物不入缓存）', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ bogus: true }),
    }) as unknown as typeof fetch;
    const { result } = renderHook(() => useLunarEclipses());
    await waitFor(() => expect(result.current.status).toBe('failed'));
    expect(result.current.data).toBeNull();
  });
});
