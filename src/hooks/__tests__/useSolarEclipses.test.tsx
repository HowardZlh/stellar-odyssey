/**
 * E-M1 日食星历/月缘剖面 Hook 三态单测（useYaleBrightStars 范式）：
 * loading → ready / failed，模块级共享结果复用。
 */
import { renderHook, waitFor } from '@testing-library/react';
import { readFileSync } from 'fs';
import { join } from 'path';
import { resetBakedDataCache } from '@/utils/bakedData';
import { resetSolarEclipsesForTest, useSolarEclipses } from '@/hooks/useSolarEclipses';
import {
  resetLunarLimbProfileForTest,
  useLunarLimbProfile,
} from '@/hooks/useLunarLimbProfile';

const eclipsesRaw = JSON.parse(
  readFileSync(join(process.cwd(), 'public/data/solar_eclipses.json'), 'utf8')
) as unknown;
const limbRaw = JSON.parse(
  readFileSync(join(process.cwd(), 'public/data/lunar_limb_profile.json'), 'utf8')
) as unknown;

afterEach(() => {
  resetBakedDataCache();
  resetSolarEclipsesForTest();
  resetLunarLimbProfileForTest();
  jest.restoreAllMocks();
});

describe('useSolarEclipses', () => {
  it('加载成功 → ready 且三事件齐全；共享结果二次挂载即 ready', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(eclipsesRaw),
    }) as unknown as typeof fetch;
    const { result } = renderHook(() => useSolarEclipses());
    expect(result.current.status).toBe('loading');
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.data?.events.map((e) => e.id)).toEqual(['e2027', 'e2035', 'e1919']);
    // 模块级共享：第二个消费者首帧即 ready
    const { result: second } = renderHook(() => useSolarEclipses());
    expect(second.current.status).toBe('ready');
    expect(second.current.data).toBe(result.current.data);
  });

  it('加载失败 → failed（消费方降级提示，不白屏）', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false }) as unknown as typeof fetch;
    const { result } = renderHook(() => useSolarEclipses());
    await waitFor(() => expect(result.current.status).toBe('failed'));
    expect(result.current.data).toBeNull();
  });
});

describe('useLunarLimbProfile', () => {
  it('加载成功 → ready（720 点剖面）', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(limbRaw),
    }) as unknown as typeof fetch;
    const { result } = renderHook(() => useLunarLimbProfile());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.profile?.samples).toHaveLength(720);
  });

  it('校验失败 → failed（贝利珠降级均匀月缘口径由 M3 消费方登记）', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ bogus: true }),
    }) as unknown as typeof fetch;
    const { result } = renderHook(() => useLunarLimbProfile());
    await waitFor(() => expect(result.current.status).toBe('failed'));
    expect(result.current.profile).toBeNull();
  });
});
