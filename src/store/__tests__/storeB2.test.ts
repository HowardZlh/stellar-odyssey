/**
 * store locale 状态单测（B2 i18n 基建）：默认 zh（既有中文测试断言
 * 零改动的前提）/ setLocale 状态更新 + localStorage 持久化 +
 * `<html lang>` 同步副作用。
 */

import { LOCALE_STORAGE_KEY } from '@/i18n';
import { useSimulationStore } from '@/store';

afterEach(() => {
  useSimulationStore.setState({ locale: 'zh' });
  window.localStorage.clear();
  document.documentElement.lang = 'zh-CN';
});

describe('locale 状态（B2）', () => {
  it('默认 locale 为 zh（勿改：既有测试零改动的前提）', () => {
    expect(useSimulationStore.getState().locale).toBe('zh');
  });

  it('setLocale 更新状态并持久化 + 同步 <html lang>', () => {
    useSimulationStore.getState().setLocale('en');
    expect(useSimulationStore.getState().locale).toBe('en');
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('en');
    expect(document.documentElement.lang).toBe('en');
  });

  it('切回 zh：<html lang> 恢复 zh-CN、存值覆写为 zh', () => {
    useSimulationStore.getState().setLocale('en');
    useSimulationStore.getState().setLocale('zh');
    expect(useSimulationStore.getState().locale).toBe('zh');
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('zh');
    expect(document.documentElement.lang).toBe('zh-CN');
  });
});
