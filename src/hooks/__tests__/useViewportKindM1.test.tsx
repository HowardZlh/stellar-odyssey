/**
 * useViewportKind / useDeviceTierInit 单测（M1-1）：matchMedia 订阅同步
 * store、change 动态生效、卸载解绑、旧 API 回退与 SSR/jsdom 降级路径。
 */

import { act, renderHook } from '@testing-library/react';
import { useDeviceTierInit, useViewportKind } from '@/hooks/useViewportKind';
import {
  COMPACT_VIEWPORT_QUERY,
  POINTER_COARSE_QUERY,
  PORTRAIT_QUERY,
} from '@/utils/deviceCapability';
import { useSimulationStore } from '@/store';

interface MockMediaQueryList {
  matches: boolean;
  media: string;
  addEventListener?: (type: string, listener: () => void) => void;
  removeEventListener?: (type: string, listener: () => void) => void;
  addListener?: (listener: () => void) => void;
  removeListener?: (listener: () => void) => void;
}

/** 可控 matchMedia mock：暴露 matches 写入与 change 触发 */
function installMatchMedia(options: { legacyApi?: boolean } = {}): {
  setMatches: (query: string, matches: boolean) => void;
  fireChange: () => void;
  listenerCount: () => number;
} {
  const state = new Map<string, MockMediaQueryList>();
  const listeners = new Set<() => void>();

  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string): MockMediaQueryList => {
      const existing = state.get(query);
      if (existing) return existing;
      const mql: MockMediaQueryList = { matches: false, media: query };
      if (options.legacyApi === true) {
        // iOS ≤13 旧 API：仅 addListener/removeListener
        mql.addListener = (fn) => listeners.add(fn);
        mql.removeListener = (fn) => listeners.delete(fn);
      } else {
        mql.addEventListener = (_type, fn) => listeners.add(fn);
        mql.removeEventListener = (_type, fn) => listeners.delete(fn);
      }
      state.set(query, mql);
      return mql;
    },
  });

  return {
    setMatches: (query, matches) => {
      (window.matchMedia(query) as unknown as MockMediaQueryList).matches = matches;
    },
    fireChange: () => {
      for (const fn of [...listeners]) fn();
    },
    listenerCount: () => listeners.size,
  };
}

afterEach(() => {
  delete (window as { matchMedia?: unknown }).matchMedia;
  useSimulationStore.setState({ deviceTier: 'high', isTouch: false, isCompact: false });
});

describe('useViewportKind（M1-1）', () => {
  it('jsdom 无 matchMedia → 安全降级：返回默认值且 store 不变', () => {
    const { result } = renderHook(() => useViewportKind());
    expect(result.current).toEqual({ isTouch: false, isCompact: false, orientation: 'landscape' });
    expect(useSimulationStore.getState().isTouch).toBe(false);
    expect(useSimulationStore.getState().isCompact).toBe(false);
  });

  it('挂载即同步 matchMedia 初值到 store 与 orientation', () => {
    const mm = installMatchMedia();
    mm.setMatches(POINTER_COARSE_QUERY, true);
    mm.setMatches(COMPACT_VIEWPORT_QUERY, true);
    mm.setMatches(PORTRAIT_QUERY, true);

    const { result } = renderHook(() => useViewportKind());
    expect(result.current).toEqual({ isTouch: true, isCompact: true, orientation: 'portrait' });
    expect(useSimulationStore.getState().isTouch).toBe(true);
    expect(useSimulationStore.getState().isCompact).toBe(true);
  });

  it('matchMedia change 动态生效（横竖屏/分屏）', () => {
    const mm = installMatchMedia();
    const { result } = renderHook(() => useViewportKind());
    expect(result.current.isCompact).toBe(false);
    expect(result.current.orientation).toBe('landscape');

    act(() => {
      mm.setMatches(COMPACT_VIEWPORT_QUERY, true);
      mm.setMatches(PORTRAIT_QUERY, true);
      mm.fireChange();
    });
    expect(result.current.isCompact).toBe(true);
    expect(result.current.orientation).toBe('portrait');
    expect(useSimulationStore.getState().isCompact).toBe(true);
  });

  it('卸载解绑全部 matchMedia 监听', () => {
    const mm = installMatchMedia();
    const { unmount } = renderHook(() => useViewportKind());
    expect(mm.listenerCount()).toBeGreaterThan(0);
    unmount();
    expect(mm.listenerCount()).toBe(0);
  });

  it('iOS ≤13 旧 addListener API 回退可用', () => {
    const mm = installMatchMedia({ legacyApi: true });
    const { result, unmount } = renderHook(() => useViewportKind());
    expect(mm.listenerCount()).toBeGreaterThan(0);

    act(() => {
      mm.setMatches(POINTER_COARSE_QUERY, true);
      mm.fireChange();
    });
    expect(result.current.isTouch).toBe(true);
    unmount();
    expect(mm.listenerCount()).toBe(0);
  });
});

describe('useDeviceTierInit（M1-1）', () => {
  beforeEach(() => {
    // jsdom 无 WebGL：getContext 原生会打印 Not implemented 噪音，mock 为 null
    jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('jsdom（无 matchMedia = 桌面判定）→ 保持默认 high 不写入', () => {
    renderHook(() => useDeviceTierInit());
    expect(useSimulationStore.getState().deviceTier).toBe('high');
  });

  it('触屏且无 WebGL（jsdom getContext 返回 null）→ 保守 medium 写入 store', () => {
    const mm = installMatchMedia();
    mm.setMatches(POINTER_COARSE_QUERY, true);
    renderHook(() => useDeviceTierInit());
    expect(useSimulationStore.getState().deviceTier).toBe('medium');
  });
});
