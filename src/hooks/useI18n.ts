'use client';

/**
 * i18n 消费 hooks（B2）：字典查找绑定 + 启动 locale 初始化
 *
 * 性能口径（附录 A §1）：locale 切换仅触发 DOM 层组件重渲染
 * （订阅 locale 的 UI 组件），不触发 3D 场景重建。
 */
import { useCallback, useEffect } from 'react';
import type { Locale } from '@/types';
import type { MessageKey } from '@/i18n';
import { readStoredLocale, resolveInitialLocale, t, tf } from '@/i18n';
import { useSimulationStore } from '@/store';

/** 组件字典查找 hook：返回绑定当前 locale 的查找函数（locale 变更即重渲染） */
export function useT(): (key: MessageKey) => string {
  const locale = useSimulationStore((s) => s.locale);
  return useCallback((key: MessageKey) => t(locale, key), [locale]);
}

/** 带参数插值的字典查找 hook（B3：`{param}` 占位符经 tf 替换） */
export function useTf(): (key: MessageKey, params: Readonly<Record<string, string | number>>) => string {
  const locale = useSimulationStore((s) => s.locale);
  return useCallback(
    (key: MessageKey, params: Readonly<Record<string, string | number>>) => tf(locale, key, params),
    [locale],
  );
}

/** 当前 locale 订阅 hook（displayBodyName/localizeCatalogText 消费方用） */
export function useLocale(): Locale {
  return useSimulationStore((s) => s.locale);
}

/**
 * 启动 locale 初始化（应用根组件挂载时一次）：
 * 优先级 `?lang=` > localStorage > 默认 zh（`resolveInitialLocale` 纯函数）。
 *
 * - `lang` 经 B4 统一解析入口 `utils/launchParams.ts` 取值（迁移收口登记）；
 * - 解析结果与当前 locale 相同（默认 zh 启动）时不调用 setLocale——
 *   默认启动零副作用（不写 localStorage、`<html lang>` 保持 SSR 初始 zh-CN，
 *   与现状逐像素等价）。登记边界：`?lang=zh` 仅本次会话生效，不覆写既有
 *   localStorage 存值（持久化仅随显式 setLocale 发生）。
 */
export function useLocaleInit(): void {
  const setLocale = useSimulationStore((s) => s.setLocale);
  useEffect(() => {
    const initial = resolveInitialLocale(window.location.search, readStoredLocale());
    if (initial !== useSimulationStore.getState().locale) {
      setLocale(initial);
    }
  }, [setLocale]);
}
