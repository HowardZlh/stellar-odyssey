'use client';

/**
 * 支持者解锁页（/unlock，U3，静态导出为 unlock.html）
 *
 * 结构（§U3-1~3）：权益状态区 → 档位价格表（消费 UNLOCK_TIERS 单一事实源，
 * 禁止硬编码价格）→ 三通道兑换区（爱发电自动 / 微信人工 / Ko-fi 人工）→
 * token 粘贴区 → 退款/说明区。骨架照 donate 页范式（useLocaleInit +
 * zh/EN 切换 + 返回主站 + 深空渐变背景 + 自身滚动容器）。
 *
 * 文案红线（§0.4 双轨隔离）：本页为明码标价对价口径（"支付 ¥X 解锁 Y 天"）；
 * 禁止"捐赠/赞助即解锁"表述；/donate 页与 ContactBadge 零改动（本页仅
 * import 其同源常量）。
 *
 * 权益链路收敛登记（U2 已交付）：激活/清除/恢复一律走 store actions
 * （applyUnlockToken / clearEntitlement / restoreUnlockState，验签 +
 * persist 由 store 承担）；`?token=` URL 注入与 U2-1 同链路（parseLaunchParams
 * 统一入口 + 同一 store action），差异仅在本页将注入结果可视化（成功/
 * 报错提示），主应用侧为静默 console.warn。本页不跑 entitlementTick
 * interval（短驻页面，剩余天数以挂载时刻快照展示，登记）。
 *
 * 移动适配（§U3-3）：isCompact 经 useViewportKind 既有判据消费（禁止自建
 * 检测）——档位表桌面为对比表格、紧凑视口降级为堆叠卡片；触控目标经
 * max-md:min-h-11 等类保证 ≥44×44pt；二维码展开形态沿用 donate 页先例。
 */

import type { JSX } from 'react';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { MessageKey } from '@/i18n';
import { useLocaleInit, useT, useTf } from '@/hooks/useI18n';
import { useViewportKind } from '@/hooks/useViewportKind';
import { useSimulationStore } from '@/store';
import type { UnlockTier } from '@/data/unlockPricing';
import { UNLOCK_TIERS } from '@/data/unlockPricing';
import { DONATION_PLATFORMS, SPONSOR_KOFI_URL } from '@/data/donationPlatforms';
import { CONTACT_EMAIL, SPONSOR_AFDIAN_URL } from '@/components/UI/ContactBadge';
import { tokenRemainingDays } from '@/utils/unlockToken';
import { readStoredUnlockToken } from '@/utils/unlockStorage';
import { parseLaunchParams } from '@/utils/launchParams';
import {
  formatExpiryDate,
  isValidAfdianOrderId,
  parseRedeemResponse,
  redeemErrorMessageKey,
  resolveRedeemApiUrl,
  tokenErrorMessageKey,
} from '@/utils/unlockRedeem';

/** 档位展示顺序（渲染消费 UNLOCK_TIERS，价格零硬编码） */
const TIER_ORDER: readonly UnlockTier[] = ['week', 'month', 'year'];

/** 档位 → 名称 i18n 键 */
const TIER_NAME_KEYS: Readonly<Record<UnlockTier, MessageKey>> = {
  week: 'unlock.tierWeek',
  month: 'unlock.tierMonth',
  year: 'unlock.tierYear',
};

/**
 * 兑换 API 完整 URL（§0.5 契约）：生产默认 stellar.guushu.com；dev 联调经
 * 构建期 NEXT_PUBLIC_UNLOCK_API_BASE 覆写（如 wrangler dev 本地端口）。
 */
const REDEEM_API_URL = resolveRedeemApiUrl(
  process.env.NEXT_PUBLIC_UNLOCK_API_BASE,
);

/** 微信赞赏码图片路径（donationPlatforms 注册表同源，只读不改） */
const WECHAT_QR_IMAGE =
  DONATION_PLATFORMS.find((p) => p.id === 'wechat')?.qrImage ??
  '/donate/wechat-tip-code.jpg';

/** 当前 epoch 秒 */
function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

export default function UnlockPage(): JSX.Element {
  // i18n：独立页面按 ?lang= > localStorage > zh 初始化（donate 页同款）
  useLocaleInit();
  const tr = useT();
  const trf = useTf();
  const locale = useSimulationStore((s) => s.locale);
  const setLocale = useSimulationStore((s) => s.setLocale);
  const { isCompact } = useViewportKind();

  // 权益态：store 单一事实源（U2-1 已交付；mount 时经 URL 注入 / 存值恢复）
  const entitlement = useSimulationStore((s) => s.entitlement);

  // 爱发电兑换表单
  const [orderInput, setOrderInput] = useState('');
  const [orderError, setOrderError] = useState<MessageKey | null>(null);
  const [orderPending, setOrderPending] = useState(false);
  const [orderDone, setOrderDone] = useState(false);

  // token 粘贴表单
  const [tokenInput, setTokenInput] = useState('');
  const [tokenError, setTokenError] = useState<MessageKey | null>(null);
  const [tokenDone, setTokenDone] = useState(false);

  // 复制/清除交互态
  const [copyState, setCopyState] = useState<'idle' | 'done' | 'fail'>('idle');
  const [clearConfirming, setClearConfirming] = useState(false);

  // 微信二维码展开（donate 页先例）
  const [qrOpen, setQrOpen] = useState(false);

  /** 激活收口：store applyUnlockToken（验签 + persist 由 store 承担） */
  function applyToken(
    raw: string,
  ): { ok: true } | { ok: false; reason: 'format' | 'signature' | 'expired' } {
    const result = useSimulationStore.getState().applyUnlockToken(raw.trim());
    if (!result.ok) return result;
    setCopyState('idle');
    setClearConfirming(false);
    return { ok: true };
  }

  // 启动：先恢复存值权益（过期/非法即清除存值），再做 `?token=` URL 注入
  // （B2B/人工发 token 一键激活；与 U2-1 同链路：parseLaunchParams 统一
  // 解析 + 同一 store action，本页额外把结果可视化）。登记：无 `SO1.`
  // 前缀的非法 token 参数被 parseLaunchParams 形态过滤静默回退 null
  // （与主应用口径一致，不展示报错）。
  useEffect(() => {
    const store = useSimulationStore.getState();
    store.restoreUnlockState();
    const urlToken = parseLaunchParams(window.location.search).token;
    if (urlToken !== null) {
      const result = store.applyUnlockToken(urlToken);
      if (result.ok) {
        setTokenDone(true);
      } else {
        setTokenError(tokenErrorMessageKey(result.reason));
      }
    }
    // 依赖登记：仅 mount 一次（URL/存储均为启动时快照）
  }, []);

  /** 爱发电订单号兑换（POST /api/redeem，§0.5 契约；网络失败可重试） */
  async function handleRedeem(): Promise<void> {
    const trimmed = orderInput.trim();
    if (!isValidAfdianOrderId(trimmed)) {
      setOrderError('unlock.orderInvalid');
      return;
    }
    setOrderPending(true);
    setOrderError(null);
    try {
      const response = await fetch(REDEEM_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: trimmed }),
      });
      let parsed: ReturnType<typeof parseRedeemResponse> = null;
      try {
        parsed = parseRedeemResponse((await response.json()) as unknown);
      } catch {
        parsed = null; // 非 JSON 响应体：按未知错误提示
      }
      if (parsed === null) {
        setOrderError('unlock.errUnknown');
        return;
      }
      if (!parsed.ok) {
        setOrderError(redeemErrorMessageKey(parsed.error));
        return;
      }
      const applied = applyToken(parsed.token);
      if (!applied.ok) {
        // 服务端返回的 token 本地验签失败（公钥不符等异常场景）
        setOrderError(tokenErrorMessageKey(applied.reason));
        return;
      }
      setOrderDone(true);
    } catch {
      setOrderError('unlock.errNetwork'); // fetch 拒绝（断网/CORS）：可重试
    } finally {
      setOrderPending(false);
    }
  }

  /** token 粘贴激活（本地验签，格式/签名/过期分开提示） */
  function handleTokenActivate(): void {
    setTokenDone(false);
    const applied = applyToken(tokenInput);
    if (!applied.ok) {
      setTokenError(tokenErrorMessageKey(applied.reason));
      return;
    }
    setTokenError(null);
    setTokenDone(true);
    setTokenInput('');
  }

  /** 复制我的 token（换设备用；clipboard 失败降级为可手动选择的只读文本框）
   * store 权益态不持有原始 token 串——从持久层读（applyUnlockToken 已 persist） */
  async function handleCopyToken(): Promise<void> {
    const token = readStoredUnlockToken();
    if (token === null) {
      setCopyState('fail');
      return;
    }
    try {
      await navigator.clipboard.writeText(token);
      setCopyState('done');
    } catch {
      setCopyState('fail');
    }
  }

  /** 清除权益（二次确认后经 store clearEntitlement 清存值 + 权益态） */
  function handleClearConfirmed(): void {
    useSimulationStore.getState().clearEntitlement();
    setClearConfirming(false);
    setCopyState('idle');
    setOrderDone(false);
    setTokenDone(false);
  }

  const mailtoHref = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(tr('unlock.emailSubject'))}`;

  // 触控命中区（≥44×44pt）：移动端按钮统一 max-md 放大（donate 页口径）
  const touchBtn = 'max-md:min-h-11 max-md:px-4 max-md:py-3';

  return (
    // 滚动容器 + safe-area 避让：donate 页骨架同款（全局 overflow:hidden 下
    // 长内容页自身滚动，主场景零影响）
    <main className="hud-scroll fixed inset-0 overflow-y-auto bg-space-dark pb-[calc(2.5rem+env(safe-area-inset-bottom))] pl-[max(1.5rem,env(safe-area-inset-left))] pr-[max(1.5rem,env(safe-area-inset-right))] pt-[max(2.5rem,env(safe-area-inset-top))] text-gray-200">
      {/* 深空氛围背景（纯 CSS 渐变，无 3D 负担） */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_50%_35%,rgba(36,58,107,0.45),rgba(10,10,20,0)_65%)]"
      />

      <div className="relative mx-auto max-w-2xl">
        {/* 顶部：返回主站 + 语言切换 */}
        <div className="flex items-center justify-between text-xs">
          <Link
            href="/"
            className="text-space-accent hover:underline max-md:-my-3 max-md:inline-flex max-md:min-h-11 max-md:items-center"
          >
            ← {tr('unlock.backToApp')}
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
            🔓 {tr('unlock.title')}
          </h1>
          <p className="mt-2 text-sm text-gray-400">{tr('unlock.subtitle')}</p>
          <p className="mx-auto mt-4 max-w-xl text-left text-xs leading-5 text-gray-400">
            {tr('unlock.intro')}
          </p>
        </header>

        {/* 权益状态区（§U3-3） */}
        <section className="mt-10">
          <h2 className="mb-3 text-sm font-semibold text-gray-300">
            {tr('unlock.statusSection')}
          </h2>
          {entitlement === null ? (
            <p className="rounded-lg border border-white/10 bg-space-panel p-4 text-xs leading-5 text-gray-400 backdrop-blur">
              {tr('unlock.statusFree')}
            </p>
          ) : (
            <div className="rounded-lg border border-space-accent/40 bg-space-panel p-4 backdrop-blur">
              <p className="text-sm font-medium text-space-accent">
                ✅ {tr('unlock.statusActive')}
              </p>
              <dl className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                <div>
                  <dt className="text-gray-500">{tr('unlock.statusTierLabel')}</dt>
                  <dd className="mt-1 text-sm text-gray-200">
                    {tr(TIER_NAME_KEYS[entitlement.tier])}
                  </dd>
                </div>
                <div>
                  <dt className="text-gray-500">{tr('unlock.statusExpiryLabel')}</dt>
                  <dd className="mt-1 text-sm text-gray-200">
                    {formatExpiryDate(entitlement.expSec, locale)}
                  </dd>
                </div>
                <div>
                  <dt className="text-gray-500">
                    {tr('unlock.statusRemainingLabel')}
                  </dt>
                  <dd className="mt-1 text-sm text-gray-200">
                    {trf('unlock.statusRemainingDays', {
                      days: tokenRemainingDays(entitlement.expSec, nowSec()),
                    })}
                  </dd>
                </div>
              </dl>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleCopyToken()}
                  aria-label={tr('unlock.copyTokenAria')}
                  className={`rounded bg-space-accent/90 px-3 py-1.5 text-xs text-black transition-colors hover:bg-space-accent ${touchBtn}`}
                >
                  📋 {tr('unlock.copyToken')}
                </button>
                {!clearConfirming && (
                  <button
                    type="button"
                    onClick={() => setClearConfirming(true)}
                    className={`rounded border border-white/15 px-3 py-1.5 text-xs text-gray-400 transition-colors hover:text-white ${touchBtn}`}
                  >
                    {tr('unlock.clearEntitlement')}
                  </button>
                )}
              </div>
              {copyState === 'done' && (
                <p className="mt-2 text-xs text-emerald-300">
                  {tr('unlock.copyTokenDone')}
                </p>
              )}
              {copyState === 'fail' && (
                <div className="mt-2">
                  <p className="text-xs text-amber-300">
                    {tr('unlock.copyTokenFail')}
                  </p>
                  <input
                    readOnly
                    value={readStoredUnlockToken() ?? ''}
                    aria-label={tr('unlock.tokenInputLabel')}
                    onFocus={(e) => e.currentTarget.select()}
                    className="mt-1 w-full rounded border border-white/15 bg-black/30 px-2 py-1.5 font-mono text-[10px] text-gray-300"
                  />
                </div>
              )}
              {clearConfirming && (
                <div className="mt-3 rounded border border-amber-400/40 bg-amber-950/30 p-3">
                  <p className="text-xs leading-5 text-amber-200">
                    {tr('unlock.clearConfirmHint')}
                  </p>
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={handleClearConfirmed}
                      className={`rounded bg-amber-500/90 px-3 py-1.5 text-xs text-black transition-colors hover:bg-amber-400 ${touchBtn}`}
                    >
                      {tr('unlock.clearConfirmYes')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setClearConfirming(false)}
                      className={`rounded border border-white/15 px-3 py-1.5 text-xs text-gray-300 transition-colors hover:text-white ${touchBtn}`}
                    >
                      {tr('unlock.clearConfirmNo')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </section>

        {/* 档位价格表（消费 UNLOCK_TIERS，价格零硬编码；isCompact 布局分流） */}
        <section className="mt-10">
          <h2 className="mb-3 text-sm font-semibold text-gray-300">
            {tr('unlock.tiersSection')}
          </h2>
          {isCompact ? (
            // 紧凑视口：堆叠卡片（375~430 无溢出）
            <ul className="space-y-2">
              {TIER_ORDER.map((tier) => (
                <li
                  key={tier}
                  className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-space-panel px-4 py-3 backdrop-blur"
                >
                  <span className="text-sm text-gray-200">
                    {tr(TIER_NAME_KEYS[tier])}
                  </span>
                  <span className="text-right text-xs text-gray-400">
                    <span className="block text-sm font-medium text-amber-200/90">
                      {trf('unlock.tierPriceCny', {
                        price: UNLOCK_TIERS[tier].priceCny,
                      })}
                    </span>
                    {trf('unlock.tierPriceUsd', {
                      price: UNLOCK_TIERS[tier].priceUsd,
                    })}{' '}
                    · {trf('unlock.tierDays', { days: UNLOCK_TIERS[tier].days })}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            // 桌面：对比表格
            <table className="w-full rounded-lg border border-white/10 bg-space-panel text-xs backdrop-blur">
              <thead>
                <tr className="text-gray-500">
                  <th className="px-4 py-2 text-left font-normal">
                    {tr('unlock.tierColumnTier')}
                  </th>
                  <th className="px-4 py-2 text-right font-normal">
                    {tr('unlock.tierColumnPriceCny')}
                  </th>
                  <th className="px-4 py-2 text-right font-normal">
                    {tr('unlock.tierColumnPriceUsd')}
                  </th>
                  <th className="px-4 py-2 text-right font-normal">
                    {tr('unlock.tierColumnDays')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {TIER_ORDER.map((tier) => (
                  <tr key={tier} className="border-t border-white/5">
                    <td className="px-4 py-2.5 text-sm text-gray-200">
                      {tr(TIER_NAME_KEYS[tier])}
                    </td>
                    <td className="px-4 py-2.5 text-right text-sm font-medium text-amber-200/90">
                      {trf('unlock.tierPriceCny', {
                        price: UNLOCK_TIERS[tier].priceCny,
                      })}
                    </td>
                    <td className="px-4 py-2.5 text-right text-gray-400">
                      {trf('unlock.tierPriceUsd', {
                        price: UNLOCK_TIERS[tier].priceUsd,
                      })}
                    </td>
                    <td className="px-4 py-2.5 text-right text-gray-400">
                      {trf('unlock.tierDays', { days: UNLOCK_TIERS[tier].days })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* 权益说明：被解锁内容概览 */}
          <div className="mt-3 rounded-lg border border-white/10 bg-space-panel p-4 backdrop-blur">
            <h3 className="text-xs font-semibold text-gray-300">
              {tr('unlock.benefitsTitle')}
            </h3>
            <ul className="mt-2 space-y-1.5 text-xs leading-5 text-gray-400">
              <li>🔭 {tr('unlock.benefitDetail')}</li>
              <li>🧭 {tr('unlock.benefitTour')}</li>
              <li>💥 {tr('unlock.benefitDemo')}</li>
            </ul>
          </div>
        </section>

        {/* 三通道兑换区（§U3-2） */}
        <section className="mt-10">
          <h2 className="mb-3 text-sm font-semibold text-gray-300">
            {tr('unlock.channelsSection')}
          </h2>
          <div className="space-y-3">
            {/* 爱发电（自动兑换） */}
            <div className="rounded-lg border border-white/10 bg-space-panel p-4 backdrop-blur">
              <h3 className="text-sm text-gray-200">⚡ {tr('unlock.afdianTitle')}</h3>
              <p className="mt-2 text-xs leading-5 text-gray-400">
                {tr('unlock.afdianGuide')}
              </p>
              <a
                href={SPONSOR_AFDIAN_URL}
                target="_blank"
                rel="noreferrer"
                className={`mt-3 inline-block rounded bg-space-accent/90 px-3 py-1.5 text-xs text-black transition-colors hover:bg-space-accent ${touchBtn}`}
              >
                {tr('unlock.afdianLink')}
              </a>
              <div className="mt-3">
                <label
                  htmlFor="afdian-order"
                  className="block text-xs text-gray-400"
                >
                  {tr('unlock.orderInputLabel')}
                </label>
                <div className="mt-1 flex gap-2 max-md:flex-col">
                  <input
                    id="afdian-order"
                    value={orderInput}
                    onChange={(e) => setOrderInput(e.target.value)}
                    placeholder={tr('unlock.orderInputPlaceholder')}
                    inputMode="numeric"
                    className="min-w-0 flex-1 rounded border border-white/15 bg-black/30 px-2 py-1.5 font-mono text-xs text-gray-200 placeholder:text-gray-600 max-md:min-h-11"
                  />
                  <button
                    type="button"
                    onClick={() => void handleRedeem()}
                    disabled={orderPending}
                    className={`shrink-0 rounded bg-space-accent/90 px-4 py-1.5 text-xs text-black transition-colors hover:bg-space-accent disabled:cursor-not-allowed disabled:opacity-50 ${touchBtn}`}
                  >
                    {tr(orderPending ? 'unlock.redeemPending' : 'unlock.redeemButton')}
                  </button>
                </div>
                {orderError !== null && (
                  <p role="alert" className="mt-2 text-xs text-amber-300">
                    {tr(orderError)}
                  </p>
                )}
                {orderDone && (
                  <p className="mt-2 text-xs text-emerald-300">
                    🎉 {tr('unlock.redeemSuccess')}
                  </p>
                )}
              </div>
            </div>

            {/* 微信赞赏码（人工兑换）：对价语义明示（按档位金额支付后凭凭证兑换） */}
            <div className="rounded-lg border border-white/10 bg-space-panel p-4 backdrop-blur">
              <h3 className="text-sm text-gray-200">💚 {tr('unlock.wechatTitle')}</h3>
              <p className="mt-2 text-xs leading-5 text-gray-400">
                {trf('unlock.wechatGuide', { email: CONTACT_EMAIL })}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  aria-expanded={qrOpen}
                  onClick={() => setQrOpen((v) => !v)}
                  className={`rounded bg-space-accent/90 px-3 py-1.5 text-xs text-black transition-colors hover:bg-space-accent ${touchBtn}`}
                >
                  {tr(qrOpen ? 'unlock.wechatHideQr' : 'unlock.wechatShowQr')}
                </button>
                <a
                  href={mailtoHref}
                  className={`rounded border border-white/15 px-3 py-1.5 text-xs text-gray-300 transition-colors hover:text-white ${touchBtn} inline-flex items-center`}
                >
                  📮 {tr('unlock.emailCta')}
                </a>
              </div>
              {qrOpen && (
                <div className="mt-3 text-center">
                  {/* 原生 <img>：静态导出无 next/image 优化（donate 页先例） */}
                  <img
                    src={WECHAT_QR_IMAGE}
                    alt={tr('unlock.wechatQrAlt')}
                    onClick={() => setQrOpen(false)}
                    className="mx-auto w-full max-w-64 rounded-lg"
                  />
                  <p className="mt-2 text-[10px] leading-4 text-gray-500 max-md:text-xs">
                    {tr('unlock.wechatQrHint')}
                  </p>
                </div>
              )}
            </div>

            {/* Ko-fi（人工兑换） */}
            <div className="rounded-lg border border-white/10 bg-space-panel p-4 backdrop-blur">
              <h3 className="text-sm text-gray-200">☕ {tr('unlock.kofiTitle')}</h3>
              <p className="mt-2 text-xs leading-5 text-gray-400">
                {trf('unlock.kofiGuide', { email: CONTACT_EMAIL })}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <a
                  href={SPONSOR_KOFI_URL}
                  target="_blank"
                  rel="noreferrer"
                  className={`rounded bg-space-accent/90 px-3 py-1.5 text-xs text-black transition-colors hover:bg-space-accent ${touchBtn} inline-flex items-center`}
                >
                  {tr('unlock.kofiLink')}
                </a>
                <a
                  href={mailtoHref}
                  className={`rounded border border-white/15 px-3 py-1.5 text-xs text-gray-300 transition-colors hover:text-white ${touchBtn} inline-flex items-center`}
                >
                  📮 {tr('unlock.emailCta')}
                </a>
              </div>
            </div>
          </div>
        </section>

        {/* token 粘贴区（人工通道回执/换设备/B2B 交付） */}
        <section className="mt-10">
          <h2 className="mb-1 text-sm font-semibold text-gray-300">
            {tr('unlock.tokenSection')}
          </h2>
          <p className="mb-3 text-[10px] text-gray-500">{tr('unlock.tokenIntro')}</p>
          <div className="rounded-lg border border-white/10 bg-space-panel p-4 backdrop-blur">
            <label htmlFor="unlock-token" className="block text-xs text-gray-400">
              {tr('unlock.tokenInputLabel')}
            </label>
            <div className="mt-1 flex gap-2 max-md:flex-col">
              <input
                id="unlock-token"
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
                placeholder={tr('unlock.tokenInputPlaceholder')}
                className="min-w-0 flex-1 rounded border border-white/15 bg-black/30 px-2 py-1.5 font-mono text-xs text-gray-200 placeholder:text-gray-600 max-md:min-h-11"
              />
              <button
                type="button"
                onClick={handleTokenActivate}
                className={`shrink-0 rounded bg-space-accent/90 px-4 py-1.5 text-xs text-black transition-colors hover:bg-space-accent ${touchBtn}`}
              >
                {tr('unlock.tokenActivate')}
              </button>
            </div>
            {tokenError !== null && (
              <p role="alert" className="mt-2 text-xs text-amber-300">
                {tr(tokenError)}
              </p>
            )}
            {tokenDone && (
              <p className="mt-2 text-xs text-emerald-300">
                🎉 {tr('unlock.tokenActivated')}
              </p>
            )}
          </div>
        </section>

        {/* 退款/说明区 */}
        <section className="mt-10">
          <h2 className="mb-3 text-sm font-semibold text-gray-300">
            {tr('unlock.refundTitle')}
          </h2>
          <p className="rounded-lg border border-white/10 bg-space-panel p-4 text-xs leading-5 text-gray-400 backdrop-blur">
            {tr('unlock.refundPolicy')}
          </p>
        </section>

        <footer className="mt-12 pb-6 text-center text-xs text-gray-500">
          <Link
            href="/"
            className="text-space-accent hover:underline max-md:inline-flex max-md:min-h-11 max-md:items-center max-md:px-4"
          >
            {tr('unlock.backToApp')}
          </Link>
        </footer>
      </div>
    </main>
  );
}
