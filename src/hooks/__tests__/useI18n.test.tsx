/**
 * i18n hooks 单测（B2）：useT 绑定当前 locale / useLocaleInit 启动
 * 初始化集成（?lang > localStorage > 默认 zh；默认路径零副作用）。
 */

import { act, renderHook } from '@testing-library/react';

import { LOCALE_STORAGE_KEY } from '@/i18n';
import { useLocaleInit, useT } from '@/hooks/useI18n';
import { useSimulationStore } from '@/store';

/** jsdom 下改写当前 URL（useLocaleInit 读 window.location.search） */
function setUrl(search: string): void {
  window.history.replaceState({}, '', `/${search}`);
}

afterEach(() => {
  useSimulationStore.setState({ locale: 'zh' });
  window.localStorage.clear();
  document.documentElement.lang = 'zh-CN';
  setUrl('');
});

describe('useT', () => {
  it('按当前 locale 查找，locale 变更后返回新语言文案', () => {
    const { result } = renderHook(() => useT());
    expect(result.current('contactBadge.title')).toBe('商业合作');
    act(() => {
      useSimulationStore.getState().setLocale('en');
    });
    expect(result.current('contactBadge.title')).toBe('Commercial Partnership');
  });
});

describe('useLocaleInit 启动初始化', () => {
  it('?lang=en 启动切到 en 并持久化', () => {
    setUrl('?lang=en');
    renderHook(() => useLocaleInit());
    expect(useSimulationStore.getState().locale).toBe('en');
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('en');
    expect(document.documentElement.lang).toBe('en');
  });

  it('无参数时取 localStorage 存值（刷新保持）', () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'en');
    renderHook(() => useLocaleInit());
    expect(useSimulationStore.getState().locale).toBe('en');
  });

  it('?lang=en 优先于 localStorage 存值', () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'zh');
    setUrl('?lang=en');
    renderHook(() => useLocaleInit());
    expect(useSimulationStore.getState().locale).toBe('en');
  });

  it('默认启动（无参数无存值）保持 zh 且零副作用（不写 localStorage）', () => {
    renderHook(() => useLocaleInit());
    expect(useSimulationStore.getState().locale).toBe('zh');
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBeNull();
    expect(document.documentElement.lang).toBe('zh-CN');
  });

  it('非法参数与非法存值回默认 zh', () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'fr');
    setUrl('?lang=de');
    renderHook(() => useLocaleInit());
    expect(useSimulationStore.getState().locale).toBe('zh');
  });
});
