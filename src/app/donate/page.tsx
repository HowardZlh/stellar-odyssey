'use client';

/**
 * 捐赠页（/donate，静态导出为 donate.html）
 *
 * 左下角「☄️ 投喂燃料」入口新标签页打开。内容：多平台捐赠通道卡片
 * （data/donationPlatforms.ts 注册表，预留位显示"即将开通"）+ 捐赠名单
 * （data/donors.ts 人工登记，渲染前按金额降序排列）+ 返回主站链接。
 *
 * 文案口径（AGENTS.md 赞助红线）：零回报承诺——不承诺任何回报或更新
 * 义务；i18n 经 donate.* 键组双语化，页面右上角提供 zh/EN 切换。
 */

import type { JSX } from 'react';
import Link from 'next/link';
import { pickLocalized } from '@/i18n';
import { useLocaleInit, useT, useTf } from '@/hooks/useI18n';
import { useSimulationStore } from '@/store';
import { DONATION_PLATFORMS } from '@/data/donationPlatforms';
import { DONORS } from '@/data/donors';
import type { DonationPlatformId } from '@/utils/donors';
import { sortDonorsByAmountDesc } from '@/utils/donors';

/** 平台图标（emoji 由组件层持有，i18n 约定） */
const PLATFORM_EMOJI: Record<DonationPlatformId, string> = {
  afdian: '⚡',
  wechat: '💚',
  'github-sponsors': '💖',
  kofi: '☕',
  buymeacoffee: '🍪',
};

export default function DonatePage(): JSX.Element {
  // i18n：独立页面同样按 ?lang= > localStorage > zh 初始化
  useLocaleInit();
  const tr = useT();
  const trf = useTf();
  const locale = useSimulationStore((s) => s.locale);
  const setLocale = useSimulationStore((s) => s.setLocale);

  // 名单按金额降序（数据文件无需保序，排序逻辑单测覆盖）
  const donors = sortDonorsByAmountDesc(DONORS);

  return (
    <main className="min-h-screen bg-space-dark px-6 py-10 text-gray-200">
      {/* 深空氛围背景（纯 CSS 渐变，无 3D 负担） */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_50%_35%,rgba(36,58,107,0.45),rgba(10,10,20,0)_65%)]"
      />

      <div className="relative mx-auto max-w-2xl">
        {/* 顶部：返回主站 + 语言切换 */}
        <div className="flex items-center justify-between text-xs">
          <Link href="/" className="text-space-accent hover:underline">
            ← {tr('donate.backToApp')}
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
              className={`px-1.5 py-1 ${
                locale === 'zh'
                  ? 'bg-space-accent text-black'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              zh
            </button>
            <button
              type="button"
              onClick={() => setLocale('en')}
              aria-pressed={locale === 'en'}
              className={`px-1.5 py-1 ${
                locale === 'en'
                  ? 'bg-space-accent text-black'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              EN
            </button>
          </div>
        </div>

        <header className="mt-8 text-center">
          <h1 className="text-3xl font-semibold text-space-accent">
            ☄️ {tr('donate.title')}
          </h1>
          <p className="mt-2 text-sm text-gray-400">{tr('donate.subtitle')}</p>
          <p className="mx-auto mt-4 max-w-xl text-left text-xs leading-5 text-gray-400">
            {tr('donate.intro')}
          </p>
        </header>

        {/* 捐赠通道 */}
        <section className="mt-10">
          <h2 className="mb-3 text-sm font-semibold text-gray-300">
            {tr('donate.platformsSection')}
          </h2>
          <ul className="grid gap-3 sm:grid-cols-2">
            {DONATION_PLATFORMS.map((platform) => (
              <li
                key={platform.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-space-panel p-4 backdrop-blur"
              >
                <span className="text-sm text-gray-200">
                  {PLATFORM_EMOJI[platform.id]}{' '}
                  {pickLocalized(locale, platform.nameZh, platform.nameEn)}
                </span>
                {platform.url ? (
                  <a
                    href={platform.url}
                    target="_blank"
                    rel="noreferrer"
                    className="shrink-0 rounded bg-space-accent/90 px-3 py-1.5 text-xs text-black transition-colors hover:bg-space-accent"
                  >
                    {tr('donate.platformAvailable')}
                  </a>
                ) : (
                  <span className="shrink-0 rounded bg-white/5 px-3 py-1.5 text-xs text-gray-500">
                    {tr('donate.platformComingSoon')}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>

        {/* 捐赠名单（按金额降序） */}
        <section className="mt-10">
          <h2 className="mb-1 text-sm font-semibold text-gray-300">
            {tr('donate.donorsSection')}
          </h2>
          <p className="mb-3 text-[10px] text-gray-500">
            {tr('donate.donorsNote')}
          </p>
          {donors.length === 0 ? (
            <p className="rounded-lg border border-dashed border-white/15 bg-space-panel p-6 text-center text-xs text-gray-400 backdrop-blur">
              ✨ {tr('donate.donorsEmpty')}
            </p>
          ) : (
            <ol className="space-y-2">
              {donors.map((donor, index) => (
                <li
                  key={`${donor.name}-${donor.platform}-${donor.date}`}
                  className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-space-panel px-4 py-3 backdrop-blur"
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <span className="shrink-0 font-mono text-xs text-gray-500">
                      #{index + 1}
                    </span>
                    <span className="truncate text-sm text-gray-200">
                      {donor.name}
                    </span>
                    {donor.message && (
                      <span className="truncate text-xs text-gray-500">
                        「{donor.message}」
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 text-sm font-medium text-amber-200/90">
                    {trf('donate.donorAmount', {
                      amount: donor.amountCny.toLocaleString('en-US'),
                    })}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>

        <footer className="mt-12 pb-6 text-center text-xs text-gray-500">
          <Link href="/" className="text-space-accent hover:underline">
            {tr('donate.backToApp')}
          </Link>
        </footer>
      </div>
    </main>
  );
}
