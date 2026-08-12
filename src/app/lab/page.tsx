'use client';

/**
 * 天文实验室首页 `/lab`（M2-2，静态导出为 lab.html）
 *
 * 条目卡片列表由 `utils/lab.ts` 注册表驱动（契约 C4；本期仅流星雨一项，
 * 后续日全食等条目注册即出现）。页面骨架复用 contributors/donate 页范式
 * （useLocaleInit + zh/EN 切换 + 返回主站，科幻风深色）。
 * 不挂载任何 3D 依赖——实验室场景 chunk 只在进入场景页时动态加载。
 */

import type { JSX } from 'react';
import Link from 'next/link';
import { useLocaleInit, useT } from '@/hooks/useI18n';
import { useSimulationStore } from '@/store';
import { labScenePath, registeredLabEntries } from '@/utils/lab';

export default function LabPage(): JSX.Element {
  useLocaleInit();
  const tr = useT();
  const locale = useSimulationStore((s) => s.locale);
  const setLocale = useSimulationStore((s) => s.setLocale);
  const entries = registeredLabEntries();

  return (
    <main className="hud-scroll fixed inset-0 overflow-y-auto bg-space-dark pb-[calc(2.5rem+env(safe-area-inset-bottom))] pl-[max(1.5rem,env(safe-area-inset-left))] pr-[max(1.5rem,env(safe-area-inset-right))] pt-[max(2.5rem,env(safe-area-inset-top))] text-gray-200">
      {/* 深空氛围背景（纯 CSS 渐变） */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_50%_30%,rgba(30,52,96,0.4),rgba(10,10,20,0)_65%)]"
      />

      <div className="relative mx-auto max-w-4xl touch-manipulation">
        {/* 顶部：返回主站 + 语言切换（contributors 页同款布局） */}
        <div className="flex items-center justify-between text-xs">
          <Link
            href="/"
            className="text-space-accent hover:underline max-md:-my-3 max-md:inline-flex max-md:min-h-11 max-md:items-center"
          >
            ← {tr('lab.backToApp')}
          </Link>
          <div
            role="group"
            aria-label="Language"
            className="flex overflow-hidden rounded border border-white/15 text-[10px] leading-none"
          >
            <button
              type="button"
              onClick={() => setLocale('zh')}
              aria-pressed={locale === 'zh'}
              className={`px-1.5 py-1 max-md:px-4 max-md:py-3.5 max-md:text-xs ${
                locale === 'zh' ? 'bg-space-accent text-black' : 'text-gray-400 hover:text-white'
              }`}
            >
              zh
            </button>
            <button
              type="button"
              onClick={() => setLocale('en')}
              aria-pressed={locale === 'en'}
              className={`px-1.5 py-1 max-md:px-4 max-md:py-3.5 max-md:text-xs ${
                locale === 'en' ? 'bg-space-accent text-black' : 'text-gray-400 hover:text-white'
              }`}
            >
              EN
            </button>
          </div>
        </div>

        <header className="mt-8 text-center">
          <h1 className="text-3xl font-semibold text-space-accent">🔭 {tr('lab.title')}</h1>
          <p className="mt-2 text-sm text-gray-400">{tr('lab.subtitle')}</p>
        </header>

        {/* 条目卡片列表（注册表驱动，本期仅流星雨一项） */}
        <section className="mt-10 space-y-4">
          {entries.map((entry) => (
            <article
              key={entry.labId}
              className="rounded-xl border border-white/10 bg-space-panel p-5 backdrop-blur"
            >
              <h2 className="text-lg font-medium text-sky-300">☄️ {tr(entry.titleKey)}</h2>
              <p className="mt-2 text-xs leading-5 text-gray-400">{tr(entry.descriptionKey)}</p>
              {/* 数据来源署名（豁免惯例：保持原文，不入 i18n 字典） */}
              <p className="mt-3 text-[10px] leading-4 text-gray-600">
                {tr('lab.dataSourceLabel')}：{entry.dataSource}
              </p>
              <Link
                href={labScenePath(entry)}
                className="mt-4 inline-flex min-h-11 items-center justify-center rounded bg-space-accent/90 px-5 text-xs text-black transition-colors hover:bg-space-accent"
              >
                {tr('lab.open')} →
              </Link>
            </article>
          ))}
        </section>

        <footer className="mt-12 pb-6 text-center text-xs text-gray-500">
          <Link
            href="/"
            className="text-space-accent hover:underline max-md:inline-flex max-md:min-h-11 max-md:items-center max-md:px-2"
          >
            {tr('lab.backToApp')}
          </Link>
        </footer>
      </div>
    </main>
  );
}
