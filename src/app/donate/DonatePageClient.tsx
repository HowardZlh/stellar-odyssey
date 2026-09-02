'use client';

/**
 * 捐赠页（/donate，静态导出为 donate.html；Z 迭代 M3 改版，需求 E2(a)）
 *
 * 左下角「☄️ 投喂燃料」入口新标签页打开。内容（统一"支持即解锁"口径）：
 * 支持通道按 donationPlatforms 注册表顺序渲染——① 支付宝扫码（推荐）
 * 引导面板 + 「前往解锁页扫码支付 →」跳 /unlock（付款 modal 只在解锁页，
 * 对齐 stock render_donate）② 微信赞赏码独立 panel（内嵌图 + 邮件模板 +
 * 预填 mailto，模板与 /unlock 页同源）③ 面包多（备选）④ 爱发电（备选）
 * ⑤ Ko-fi（海外备选）⑥ 预留位卡片 + 燃料补给名单小节
 * （ContributorsRosterSection 共享组件，与 /unlock 页统一：静态+远程合并
 * 名单 + 贡献者宇宙入口，本页全量展示）+ 返回主站链接。
 *
 * 文案边界：解锁承诺仅限"付 ¥X 得 Y 天"的既有对价事实，不承诺更新义务；
 * i18n 经 donate.* 键组双语化，页面右上角提供 zh/EN 切换。
 */

import type { JSX } from 'react';
import { useState } from 'react';
import Link from 'next/link';
import type { MessageKey } from '@/i18n';
import { pickLocalized } from '@/i18n';
import { useLocaleInit, useT, useTf } from '@/hooks/useI18n';
import { useSimulationStore } from '@/store';
import { DONATION_PLATFORMS } from '@/data/donationPlatforms';
import { CONTACT_EMAIL, UNLOCK_PAGE_PATH } from '@/components/UI/ContactBadge';
import { ContributorsRosterSection } from '@/components/UI/ContributorsRosterSection';
import type { DonationPlatformId } from '@/utils/donors';
import {
  buildRedeemMailtoHref,
  formatRedeemMailTemplate,
} from '@/utils/redeemMail';

/** 平台图标（emoji 由组件层持有，i18n 约定） */
const PLATFORM_EMOJI: Record<DonationPlatformId, string> = {
  afdian: '⚡',
  wechat: '💚',
  'github-sponsors': '💖',
  kofi: '☕',
  buymeacoffee: '🍪',
  alipay: '💙',
  mbd: '🍞',
};

/** 备选通道卡片说明行（M3 口径：面包多/爱发电备选 / Ko-fi 海外备选） */
const PLATFORM_NOTE_KEYS: Partial<Record<DonationPlatformId, MessageKey>> = {
  mbd: 'donate.mbdNote',
  afdian: 'donate.afdianNote',
  kofi: 'donate.kofiNote',
};

/** 特殊形态面板的注册表条目（按 id 查找，防注册表顺序调整时错位） */
const ALIPAY_PLATFORM = DONATION_PLATFORMS.find((p) => p.id === 'alipay');
const WECHAT_PLATFORM = DONATION_PLATFORMS.find((p) => p.id === 'wechat');

export default function DonatePage(): JSX.Element {
  // i18n：独立页面同样按 ?lang= > localStorage > zh 初始化
  useLocaleInit();
  const tr = useT();
  const trf = useTf();
  const locale = useSimulationStore((s) => s.locale);
  const setLocale = useSimulationStore((s) => s.setLocale);

  // M3：邮件模板复制态（微信 panel；clipboard 失败时模板文本可手动选中）
  const [mailCopied, setMailCopied] = useState(false);
  // M4 后续微调「微信轻量化」：赞赏码/邮件模板默认收起（与 /unlock 同口径，
  // 防止人工渠道显眼分流支付宝）
  const [wechatOpen, setWechatOpen] = useState(false);

  // 人工渠道兑换邮件（与 /unlock 页同源拼装：同一 i18n 键组 + 同一纯函数）
  const mailSubject = tr('unlock.emailSubject');
  const mailBody = trf('unlock.mailTplBody', { email: CONTACT_EMAIL });
  const mailtoHref = buildRedeemMailtoHref(CONTACT_EMAIL, mailSubject, mailBody);
  const mailTemplate = formatRedeemMailTemplate({
    toLabel: tr('unlock.mailTplToLabel'),
    subjectLabel: tr('unlock.mailTplSubjectLabel'),
    email: CONTACT_EMAIL,
    subject: mailSubject,
    body: mailBody,
  });

  /** 复制邮件模板（失败静默：模板 pre 文本本身可手动选中复制） */
  async function handleCopyMailTemplate(): Promise<void> {
    try {
      await navigator.clipboard.writeText(mailTemplate);
      setMailCopied(true);
    } catch {
      setMailCopied(false);
    }
  }

  return (
    // 滚动修复：globals.css 对 html/body 全局 overflow:hidden（主 3D 场景
    // 需要），min-h-screen 长内容会被裁切且整页不可滚——donate 页自身改为
    // 滚动容器（fixed inset-0 + overflow-y-auto，触屏 pan-y 天然可用），
    // 不动全局样式、主场景零影响。
    // M5-1 safe-area：viewport-fit=cover 下四向避让刘海/Home Indicator
    // （px/py 与 inset 取 max/求和，safe-area 为 0 时与原 px-6 py-10 逐像素一致）
    <main className="hud-scroll fixed inset-0 overflow-y-auto bg-space-dark pb-[calc(2.5rem+env(safe-area-inset-bottom))] pl-[max(1.5rem,env(safe-area-inset-left))] pr-[max(1.5rem,env(safe-area-inset-right))] pt-[max(2.5rem,env(safe-area-inset-top))] text-gray-200">
      {/* 深空氛围背景（纯 CSS 渐变，无 3D 负担） */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_50%_35%,rgba(36,58,107,0.45),rgba(10,10,20,0)_65%)]"
      />

      <div className="relative mx-auto max-w-2xl">
        {/* 顶部：返回主站 + 语言切换 */}
        <div className="flex items-center justify-between text-xs">
          {/* M5-1 触控目标：移动端（max-md）返回/语言切换命中区 ≥44pt，桌面原样 */}
          <Link
            href="/"
            className="text-space-accent hover:underline max-md:-my-3 max-md:inline-flex max-md:min-h-11 max-md:items-center"
          >
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
              className={`px-1.5 py-1 max-md:px-4 max-md:py-3.5 max-md:text-xs ${
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
              className={`px-1.5 py-1 max-md:px-4 max-md:py-3.5 max-md:text-xs ${
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

        {/* 支持通道（M3 渠道重排 §5.2：注册表顺序即渲染顺序——支付宝引导
            面板 → 微信独立 panel → 备选/预留卡片栅格；顺序断言测试对照
            stock test_pages_recommend_alipay_and_channel_order） */}
        <section className="mt-10">
          <h2 className="mb-3 text-sm font-semibold text-gray-300">
            {tr('donate.platformsSection')}
          </h2>
          <div className="space-y-3">
            {/* ① 支付宝扫码（推荐）：引导面板 + 跳 /unlock（modal 不进本页） */}
            <div className="rounded-lg border border-space-accent/40 bg-space-panel p-4 backdrop-blur">
              <h3 className="text-sm text-gray-200">
                {PLATFORM_EMOJI.alipay}{' '}
                {ALIPAY_PLATFORM !== undefined &&
                  pickLocalized(
                    locale,
                    ALIPAY_PLATFORM.nameZh,
                    ALIPAY_PLATFORM.nameEn,
                  )}
              </h3>
              <p className="mt-2 text-xs leading-5 text-gray-400">
                {tr('donate.alipayGuide')}
              </p>
              <a
                href={UNLOCK_PAGE_PATH}
                className="mt-3 inline-block rounded bg-space-accent/90 px-3 py-1.5 text-xs text-black transition-colors hover:bg-space-accent max-md:min-h-11 max-md:px-4 max-md:py-3"
              >
                {tr('donate.alipayCta')} →
              </a>
            </div>

            {/* ② 微信赞赏码独立 panel：内嵌图 + 邮件模板 + 预填 mailto
                （模板与 /unlock 页同源） */}
            <div className="rounded-lg border border-white/10 bg-space-panel p-4 backdrop-blur">
              <h3 className="text-sm text-gray-200">
                {PLATFORM_EMOJI.wechat}{' '}
                {WECHAT_PLATFORM !== undefined &&
                  pickLocalized(
                    locale,
                    WECHAT_PLATFORM.nameZh,
                    WECHAT_PLATFORM.nameEn,
                  )}
              </h3>
              <p className="mt-2 text-xs leading-5 text-gray-400">
                {tr('donate.wechatGuide')}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  aria-expanded={wechatOpen}
                  onClick={() => setWechatOpen((v) => !v)}
                  className="rounded border border-white/15 px-3 py-1.5 text-xs text-gray-300 transition-colors hover:text-white max-md:min-h-11 max-md:px-4 max-md:py-3"
                >
                  {tr(wechatOpen ? 'unlock.wechatCollapse' : 'unlock.wechatExpand')}{' '}
                  {wechatOpen ? '▴' : '▾'}
                </button>
              </div>
              {wechatOpen && (
                <>
                  <div className="mt-3 text-center">
                    {/* 原生 <img>：静态导出无 next/image 优化（规则已全局关闭） */}
                    <img
                      src={WECHAT_PLATFORM?.qrImage}
                      alt={tr('donate.wechatQrAlt')}
                      className="mx-auto w-full max-w-64 rounded-lg"
                    />
                    <p className="mt-2 text-[10px] leading-4 text-gray-500 max-md:text-xs">
                      {tr('donate.wechatQrHint')}
                    </p>
                  </div>
                  <p className="mt-3 text-xs text-gray-400">{tr('unlock.mailTplHint')}</p>
                  <pre className="mt-1 whitespace-pre-wrap break-words rounded border border-white/10 bg-black/30 p-3 text-[10px] leading-4 text-gray-300 max-md:text-xs">
                    {mailTemplate}
                  </pre>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void handleCopyMailTemplate()}
                      className="rounded border border-white/15 px-3 py-1.5 text-xs text-gray-300 transition-colors hover:text-white max-md:min-h-11 max-md:px-4 max-md:py-3"
                    >
                      📋 {tr(mailCopied ? 'unlock.mailTplCopied' : 'unlock.mailTplCopy')}
                    </button>
                    <a
                      href={mailtoHref}
                      className="inline-flex items-center rounded bg-space-accent/90 px-3 py-1.5 text-xs text-black transition-colors hover:bg-space-accent max-md:min-h-11 max-md:px-4 max-md:py-3"
                    >
                      📮 {tr('unlock.mailTplOpen')} →
                    </a>
                  </div>
                </>
              )}
            </div>

            {/* ③④⑤⑥ 备选与预留卡片（面包多/爱发电备选 / Ko-fi 海外备选 / 预留位） */}
            <ul className="grid items-start gap-3 sm:grid-cols-2">
              {DONATION_PLATFORMS.filter(
                (p) => p.id !== 'alipay' && p.id !== 'wechat',
              ).map((platform) => {
                const noteKey = PLATFORM_NOTE_KEYS[platform.id];
                return (
                  <li
                    key={platform.id}
                    className="rounded-lg border border-white/10 bg-space-panel p-4 backdrop-blur"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm text-gray-200">
                        {PLATFORM_EMOJI[platform.id]}{' '}
                        {pickLocalized(locale, platform.nameZh, platform.nameEn)}
                      </span>
                      {platform.url ? (
                        <a
                          href={platform.url}
                          target="_blank"
                          rel="noreferrer"
                          className="shrink-0 rounded bg-space-accent/90 px-3 py-1.5 text-xs text-black transition-colors hover:bg-space-accent max-md:px-4 max-md:py-3.5"
                        >
                          {tr('donate.platformAvailable')}
                        </a>
                      ) : (
                        <span className="shrink-0 rounded bg-white/5 px-3 py-1.5 text-xs text-gray-500">
                          {tr('donate.platformComingSoon')}
                        </span>
                      )}
                    </div>
                    {noteKey !== undefined && (
                      <p className="mt-2 text-[10px] leading-4 text-gray-500 max-md:text-xs">
                        {tr(noteKey)}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        </section>

        {/* 燃料补给名单（共享小节：名单 + 贡献者宇宙入口，与 /unlock 统一；
            本页全量展示，数据经 useContributorsRoster 与 /contributors 同源） */}
        <ContributorsRosterSection />

        <footer className="mt-12 pb-6 text-center text-xs text-gray-500">
          <Link
            href="/"
            className="text-space-accent hover:underline max-md:inline-flex max-md:min-h-11 max-md:items-center max-md:px-4"
          >
            {tr('donate.backToApp')}
          </Link>
        </footer>
      </div>
    </main>
  );
}
