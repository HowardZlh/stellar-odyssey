'use client';

/**
 * 贡献者宇宙页（/contributors，静态导出为 contributors.html，C2）
 *
 * 每位登记捐赠者（data/donors.ts）呈现为星团中的一颗星：大小/亮度随
 * 累计捐赠金额对数映射（C1 纯函数），位置由昵称+平台确定性派生。
 * 页面骨架复用 donate 页范式（useLocaleInit + zh/EN 切换 + 返回主站）。
 *
 * 兜底三态（C2-5）：
 * - 空名单：3D 区保留背景星场氛围，中央叠加占位文案 + 前往 /donate 入口；
 * - WebGL 不可用/Canvas 失败：3D 区显示降级提示，文字名单可用（不白屏）；
 * - 可访问性：画布容器 aria-hidden，语义化文字名单常驻画布下方
 *   （屏幕阅读器/SEO 同受益；形态裁决登记于需求文档 §C2-5）。
 *
 * 移动端适配（C3）：判据全部消费 M1 产物（useViewportKind / store
 * deviceTier，禁止自建检测）——isTouch 分流操作提示与 tap 命中阈值；
 * isCompact 下详情卡改底部卡片（max-h-[50dvh] + safe-b）；渲染档位经
 * contributorCanvasQuality（dpr/antialias 消费 M2 qualityTier 事实源）；
 * 画布容器 touch-none / UI 层 touch-manipulation（M1-2 口径）。
 *
 * 文案红线（REQUIREMENTS_CONTRIBUTORS §0.5）：全部陈述口径，无回报承诺。
 */

import type { JSX } from 'react';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { Locale } from '@/types';
import { pickLocalized, t } from '@/i18n';
import { useLocaleInit, useT, useTf } from '@/hooks/useI18n';
import { useDeviceTierInit, useViewportKind } from '@/hooks/useViewportKind';
import { useSimulationStore } from '@/store';
import { DONATION_PLATFORMS } from '@/data/donationPlatforms';
import { DONORS } from '@/data/donors';
import type { DonationPlatformId, DonorRecord } from '@/utils/donors';
import {
  mergeDonorLists,
  parseContributorsResponse,
  remoteContributorsToDonors,
  resolveContributorsApiUrl,
  type RemoteContributor,
} from '@/utils/contributorsFeed';
import {
  contributorCanvasQuality,
  layoutContributorStars,
} from '@/utils/contributorUniverse';
import {
  ContributorUniverseCanvas,
  detectWebglSupport,
} from '@/components/Scene/ContributorUniverse';

/** 平台图标（emoji 由组件层持有，i18n 约定；与 donate 页同表——各自持有不跨页 import） */
const PLATFORM_EMOJI: Record<DonationPlatformId, string> = {
  afdian: '⚡',
  wechat: '💚',
  'github-sponsors': '💖',
  kofi: '☕',
  buymeacoffee: '🍪',
  alipay: '💙',
};

/** 贡献者名单 API（M2 动态名单，D-z4；base 覆写机制与 unlockRedeem 同源） */
const CONTRIBUTORS_API_URL = resolveContributorsApiUrl(
  process.env.NEXT_PUBLIC_UNLOCK_API_BASE,
);

/**
 * 平台注册表查找（详情卡双语名；未注册 id 兜底显示原始 id）。
 * M2 登记：alipay 为解锁支付渠道、不进 donationPlatforms 捐赠注册表
 * （渠道重排 M3 处理），展示名走 i18n 键。
 */
function platformDisplayName(
  locale: Locale,
  platformId: DonationPlatformId,
): string {
  if (platformId === 'alipay') return t(locale, 'contributors.platformAlipay');
  const platform = DONATION_PLATFORMS.find((p) => p.id === platformId);
  if (!platform) return platformId;
  return pickLocalized(locale, platform.nameZh, platform.nameEn);
}

export default function ContributorsPage(): JSX.Element {
  // i18n：独立页面同样按 ?lang= > localStorage > zh 初始化
  useLocaleInit();
  const tr = useT();
  const trf = useTf();
  const locale = useSimulationStore((s) => s.locale);
  const setLocale = useSimulationStore((s) => s.setLocale);

  // C3：设备判据全部消费 M1 产物（触屏/紧凑视口 matchMedia 订阅 + 档位
  // 一次性探测写 store；横竖屏切换经 matchMedia change 自动生效）
  useDeviceTierInit();
  const { isTouch, isCompact } = useViewportKind();
  const deviceTier = useSimulationStore((s) => s.deviceTier);
  const quality = useMemo(() => contributorCanvasQuality(deviceTier), [deviceTier]);

  // M2 动态名单（D-z4）：启动拉取 /api/contributors 与静态 DONORS 合并；
  // 拉取失败/形状异常静默降级为仅静态名单（fetch 缺失环境同样静默）
  const [remoteEntries, setRemoteEntries] = useState<RemoteContributor[]>([]);
  useEffect(() => {
    let cancelled = false;
    void (async (): Promise<void> => {
      try {
        const response = await fetch(CONTRIBUTORS_API_URL);
        const parsed = parseContributorsResponse(
          (await response.json()) as unknown,
        );
        if (!cancelled && parsed !== null) setRemoteEntries(parsed);
      } catch {
        // 静默降级：仅静态名单
      }
    })();
    return (): void => {
      cancelled = true;
    };
  }, []);

  // 名单排序 + C1 布点全部一次完成（渲染循环零重算）。
  // 登记：匿名展示名随 locale 切换（i18n 键），匿名星布点随之重派生——
  // 页面级画布数据流更新，非主场景重建，可接受。
  const donors = useMemo(
    () =>
      mergeDonorLists(
        DONORS,
        remoteContributorsToDonors(
          remoteEntries,
          t(locale, 'contributors.anonymous'),
        ),
      ),
    [remoteEntries, locale],
  );
  const stars = useMemo(() => layoutContributorStars(donors), [donors]);

  // WebGL 三态：null = 检测中（SSR/首帧占位），true = 3D，false = 文字名单降级
  const [webglSupported, setWebglSupported] = useState<boolean | null>(null);
  useEffect(() => {
    setWebglSupported(detectWebglSupport());
  }, []);

  // 选中星（详情卡）：纯页面内状态，不接主应用 store 视角体系
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const selected: DonorRecord | undefined =
    selectedIndex !== null ? donors[selectedIndex] : undefined;

  return (
    // 滚动修复（与 donate 页同根因同方案）：html/body 全局 overflow:hidden
    // 下长内容页自身做滚动容器（fixed inset-0 + overflow-y-auto）；
    // isCompact 详情卡 fixed 定位不受本容器影响（无 transform 祖先），行为不变
    <main className="hud-scroll fixed inset-0 overflow-y-auto bg-space-dark pb-[calc(2.5rem+env(safe-area-inset-bottom))] pl-[max(1.5rem,env(safe-area-inset-left))] pr-[max(1.5rem,env(safe-area-inset-right))] pt-[max(2.5rem,env(safe-area-inset-top))] text-gray-200">
      {/* 深空氛围背景（纯 CSS 渐变） */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_50%_35%,rgba(36,58,107,0.45),rgba(10,10,20,0)_65%)]"
      />

      {/* UI 层 touch-manipulation：消除触屏 300ms 点按延迟（M1-2 口径） */}
      <div className="relative mx-auto max-w-4xl touch-manipulation">
        {/* 顶部：返回主站 + 语言切换（donate 页同款布局） */}
        <div className="flex items-center justify-between text-xs">
          <Link
            href="/"
            className="text-space-accent hover:underline max-md:-my-3 max-md:inline-flex max-md:min-h-11 max-md:items-center"
          >
            ← {tr('contributors.backToApp')}
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
            ✨ {tr('contributors.title')}
          </h1>
          <p className="mt-2 text-sm text-gray-400">{tr('contributors.subtitle')}</p>
          <p className="mx-auto mt-4 max-w-xl text-xs leading-5 text-gray-500">
            {tr('contributors.intro')}
          </p>
        </header>

        {/* 3D 画布区（画布 aria-hidden；详情卡/占位层为可达兄弟节点）；
            移动端高度用 dvh（C3-3，规避 iOS Safari 地址栏塌缩） */}
        <section className="relative mt-8 h-[70vh] min-h-[420px] overflow-hidden rounded-xl border border-white/10 bg-black/40 max-md:h-[70dvh]">
          {webglSupported === true ? (
            <>
              {/* 画布容器 touch-none：手势全交 OrbitControls（M1-2 口径） */}
              <div aria-hidden="true" className="absolute inset-0 touch-none">
                <ContributorUniverseCanvas
                  stars={stars}
                  selectedIndex={selectedIndex}
                  onSelectStar={setSelectedIndex}
                  onWebglFail={() => setWebglSupported(false)}
                  isTouch={isTouch}
                  quality={quality}
                />
              </div>

              {/* C5-2 径向星云辉光叠加（画布 alpha:false 遮蔽页面级渐变，
                  在画布上方叠加提升中央可见度；pointer-events-none 零交互
                  影响；drei Html tooltip z 序更高不被覆盖） */}
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_45%,rgba(56,88,160,0.16),rgba(10,14,30,0)_65%)]"
              />

              {/* 操作提示（isTouch 分流触屏文案，C3-1） */}
              <p className="pointer-events-none absolute bottom-3 left-1/2 max-w-[calc(100%-1.5rem)] -translate-x-1/2 truncate whitespace-nowrap rounded bg-black/40 px-3 py-1 text-[10px] text-gray-400 backdrop-blur">
                {tr(isTouch ? 'contributors.hintTouch' : 'contributors.hintDesktop')}
              </p>

              {/* 空名单态：背景星场保留氛围 + 中央占位 + 捐赠入口 */}
              {donors.length === 0 && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
                  <div className="pointer-events-auto max-w-sm rounded-lg border border-dashed border-white/15 bg-space-panel p-6 text-center text-xs text-gray-300 backdrop-blur">
                    <p>✨ {tr('contributors.empty')}</p>
                    <Link
                      href="/donate"
                      className="mt-4 inline-flex min-h-11 items-center justify-center rounded bg-space-accent/90 px-4 text-xs text-black transition-colors hover:bg-space-accent"
                    >
                      ☄️ {tr('contributors.goDonate')}
                    </Link>
                  </div>
                </div>
              )}

              {/* 详情卡（点击星聚焦后展示；关闭按钮 ≥44×44pt）——isCompact
                  改底部卡片（fixed inset-x-0 bottom-0 + 50dvh 限高 + safe-b，
                  与 M3-2 信息面板同口径；点画布空白同样可关闭，C3-3） */}
              {selected && (
                <aside
                  className={
                    isCompact
                      ? 'fixed inset-x-0 bottom-0 z-20 max-h-[50dvh] overflow-y-auto overscroll-contain rounded-t-lg border-t border-white/10 bg-space-panel p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] backdrop-blur'
                      : 'absolute right-4 top-4 w-72 max-w-[calc(100%-2rem)] rounded-lg border border-white/10 bg-space-panel p-4 backdrop-blur'
                  }
                >
                  <button
                    type="button"
                    onClick={() => setSelectedIndex(null)}
                    aria-label={tr('contributors.detailCloseAria')}
                    className="absolute right-0 top-0 flex h-11 w-11 items-center justify-center text-gray-400 transition-colors hover:text-white"
                  >
                    ✕
                  </button>
                  <h3 className="pr-10 text-sm font-medium text-gray-100">
                    {selected.name}
                  </h3>
                  <dl className="mt-3 space-y-2 text-xs">
                    <div className="flex items-baseline justify-between gap-3">
                      <dt className="shrink-0 text-gray-500">
                        {tr('contributors.detailAmount')}
                      </dt>
                      <dd className="font-medium text-amber-200/90">
                        {trf('donate.donorAmount', {
                          amount: selected.amountCny.toLocaleString('en-US'),
                        })}
                      </dd>
                    </div>
                    <div className="flex items-baseline justify-between gap-3">
                      <dt className="shrink-0 text-gray-500">
                        {tr('contributors.detailDate')}
                      </dt>
                      <dd className="text-gray-300">{selected.date}</dd>
                    </div>
                    <div className="flex items-baseline justify-between gap-3">
                      <dt className="shrink-0 text-gray-500">
                        {tr('contributors.detailPlatform')}
                      </dt>
                      <dd className="text-gray-300">
                        {PLATFORM_EMOJI[selected.platform]}{' '}
                        {platformDisplayName(locale, selected.platform)}
                      </dd>
                    </div>
                    {selected.message && (
                      <div>
                        <dt className="text-gray-500">
                          {tr('contributors.detailMessage')}
                        </dt>
                        <dd className="mt-1 leading-5 text-gray-300">
                          「{selected.message}」
                        </dd>
                      </div>
                    )}
                  </dl>
                </aside>
              )}
            </>
          ) : webglSupported === false ? (
            // WebGL 不可用降级：不白屏，提示 + 下方文字名单可用
            <div className="flex h-full items-center justify-center p-6">
              <p className="max-w-sm rounded-lg border border-white/10 bg-space-panel p-6 text-center text-xs text-gray-400 backdrop-blur">
                {tr('contributors.webglFallback')}
              </p>
            </div>
          ) : (
            // 检测中占位（SSR/首帧）
            <div className="flex h-full items-center justify-center">
              <p className="text-xs text-gray-600">{tr('contributors.preparing')}</p>
            </div>
          )}
        </section>

        {/* 文字名单（常驻：屏幕阅读器/SEO/降级共用形态） */}
        <section className="mt-10">
          <h2 className="mb-1 text-sm font-semibold text-gray-300">
            {tr('contributors.listSection')}
          </h2>
          <p className="mb-3 text-[10px] text-gray-500">
            {tr('contributors.sortNote')}
          </p>
          {donors.length === 0 ? (
            <p className="rounded-lg border border-dashed border-white/15 bg-space-panel p-6 text-center text-xs text-gray-400 backdrop-blur">
              ✨ {tr('contributors.empty')}
            </p>
          ) : (
            <ol className="space-y-2">
              {donors.map((donor, index) => (
                <li
                  key={`${donor.id}`}
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

        <footer className="mt-12 flex items-center justify-center gap-6 pb-6 text-center text-xs text-gray-500">
          <Link
            href="/"
            className="text-space-accent hover:underline max-md:inline-flex max-md:min-h-11 max-md:items-center max-md:px-2"
          >
            {tr('contributors.backToApp')}
          </Link>
          <Link
            href="/donate"
            className="text-space-accent hover:underline max-md:inline-flex max-md:min-h-11 max-md:items-center max-md:px-2"
          >
            ☄️ {tr('contributors.goDonate')}
          </Link>
        </footer>
      </div>
    </main>
  );
}
