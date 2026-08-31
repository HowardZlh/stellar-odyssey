'use client';

/**
 * 支持者解锁页（/unlock，U3，静态导出为 unlock.html）
 *
 * 结构（§U3-1~3 + Z 迭代 M3 渠道重排 + 面包多集成，REQUIREMENTS_ALIPAY_UNLOCK
 * §5.1）：权益状态区 → 档位价格表（消费 UNLOCK_TIERS 单一事实源，禁止硬编码
 * 价格；档位卡片 = 支付宝扫码主入口 CTA）→ 五通道购买与兑换区（① 支付宝
 * 扫码推荐 · 自动发码 ② 微信赞赏码独立小节：内嵌图 + 人工核验口径 + 可复制
 * 邮件模板 + 预填 mailto ③ 面包多备选 · 订单号自动兑换（扫码即付无需注册）
 * ④ 爱发电备选 · 订单号兑换框保留 ⑤ Ko-fi 海外备选）→ token 粘贴区 →
 * 退款/说明区。骨架照 donate 页范式（useLocaleInit + zh/EN 切换 + 返回主站 +
 * 深空渐变背景 + 自身滚动容器）。
 *
 * 文案口径（M3 起统一"支持即解锁"，D3 双轨隔离取消）：本页为明码标价
 * 对价口径（"支付 ¥X 解锁 Y 天"承诺允许）；邮件模板与 /donate 页同源
 * （utils/redeemMail 拼装 + 同一 i18n 键组，禁止第二份副本）。
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
import { refreshRevocationList } from '@/hooks/useUnlockInit';
import { useViewportKind } from '@/hooks/useViewportKind';
import { useSimulationStore } from '@/store';
import type { UnlockTier } from '@/data/unlockPricing';
import { UNLOCK_TIERS } from '@/data/unlockPricing';
import {
  DONATION_PLATFORMS,
  SPONSOR_KOFI_URL,
  SPONSOR_MBD_URL,
} from '@/data/donationPlatforms';
import { CONTACT_EMAIL, SPONSOR_AFDIAN_URL } from '@/components/UI/ContactBadge';
import { UnlockAlipayModal } from '@/components/UI/UnlockAlipayModal';
import { trackFunnelEvent } from '@/utils/funnel';
import { tokenRemainingDays } from '@/utils/unlockToken';
import { readStoredUnlockToken } from '@/utils/unlockStorage';
import { parseLaunchParams } from '@/utils/launchParams';
import {
  formatExpiryDate,
  isValidAfdianOrderId,
  isValidMbdOrderId,
  parseRedeemResponse,
  redeemErrorMessageKey,
  resolveRedeemApiUrl,
  tokenErrorMessageKey,
} from '@/utils/unlockRedeem';
import {
  buildRedeemMailtoHref,
  formatRedeemMailTemplate,
} from '@/utils/redeemMail';

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
  // A6-3 吊销链路状态区（命中文案 / 核验失败网络提示，裁决 ⑤⑥）
  const entitlementRevoked = useSimulationStore((s) => s.entitlementRevoked);
  const revocationCheckFailed = useSimulationStore(
    (s) => s.revocationCheckFailed,
  );

  // 爱发电兑换表单
  const [orderInput, setOrderInput] = useState('');
  const [orderError, setOrderError] = useState<MessageKey | null>(null);
  const [orderPending, setOrderPending] = useState(false);
  const [orderDone, setOrderDone] = useState(false);

  // 面包多兑换表单（面包多集成：与爱发电同构的独立状态组）
  const [mbdInput, setMbdInput] = useState('');
  const [mbdError, setMbdError] = useState<MessageKey | null>(null);
  const [mbdPending, setMbdPending] = useState(false);
  const [mbdDone, setMbdDone] = useState(false);

  // token 粘贴表单
  const [tokenInput, setTokenInput] = useState('');
  const [tokenError, setTokenError] = useState<MessageKey | null>(null);
  const [tokenDone, setTokenDone] = useState(false);

  // 复制/清除交互态
  const [copyState, setCopyState] = useState<'idle' | 'done' | 'fail'>('idle');
  const [clearConfirming, setClearConfirming] = useState(false);

  // 微信二维码展开（donate 页先例）
  const [qrOpen, setQrOpen] = useState(false);

  // M3：邮件模板复制态（微信小节；clipboard 失败时模板文本本身可选中复制）
  const [mailCopied, setMailCopied] = useState(false);

  // M2：支付宝付款 modal（档位卡片 CTA 打开；null = 关闭）
  const [alipayTier, setAlipayTier] = useState<UnlockTier | null>(null);

  /** 档位卡 CTA（G8 漏斗计数 + 打开支付宝付款 modal；紧凑/桌面共用） */
  function handleTierCta(tier: UnlockTier): void {
    trackFunnelEvent('tier_cta');
    setAlipayTier(tier);
  }

  /** 激活收口：store applyUnlockToken（验签 + 吊销核对 + persist 由 store 承担） */
  function applyToken(
    raw: string,
  ):
    | { ok: true }
    | {
        ok: false;
        reason: 'format' | 'signature' | 'expired' | 'revoked' | 'unverified';
      } {
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
    trackFunnelEvent('unlock_view'); // G8 漏斗：解锁页曝光（mount 一次）
    const store = useSimulationStore.getState();
    store.restoreUnlockState();
    // A6：吊销名单异步拉取（restore 已同步用缓存比对；无缓存时挂起的
    // 权益恢复由拉取结果补跑——useUnlockInit 同一 IO 壳共享）
    void refreshRevocationList();
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

  /**
   * 订单号兑换共用流程（POST /api/redeem，§0.5 契约 + channel 字段；
   * 爱发电/面包多同构消费，网络失败可重试）。
   */
  async function redeemOrder(
    channel: 'afdian' | 'mbd',
    trimmed: string,
    setError: (key: MessageKey | null) => void,
    setPending: (pending: boolean) => void,
    setDone: (done: boolean) => void,
  ): Promise<void> {
    trackFunnelEvent('redeem_submit'); // G8 漏斗：订单号兑换提交（双渠道共用）
    setPending(true);
    setError(null);
    try {
      const response = await fetch(REDEEM_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: trimmed, channel }),
      });
      let parsed: ReturnType<typeof parseRedeemResponse> = null;
      try {
        parsed = parseRedeemResponse((await response.json()) as unknown);
      } catch {
        parsed = null; // 非 JSON 响应体：按未知错误提示
      }
      if (parsed === null) {
        setError('unlock.errUnknown');
        return;
      }
      if (!parsed.ok) {
        setError(redeemErrorMessageKey(parsed.error));
        return;
      }
      const applied = applyToken(parsed.token);
      if (!applied.ok) {
        // 服务端返回的 token 本地验签失败（公钥不符等异常场景）
        setError(tokenErrorMessageKey(applied.reason));
        return;
      }
      setDone(true);
    } catch {
      setError('unlock.errNetwork'); // fetch 拒绝（断网/CORS）：可重试
    } finally {
      setPending(false);
    }
  }

  /** 爱发电订单号兑换（前端格式预校验不合法零请求） */
  async function handleRedeem(): Promise<void> {
    const trimmed = orderInput.trim();
    if (!isValidAfdianOrderId(trimmed)) {
      setOrderError('unlock.orderInvalid');
      return;
    }
    await redeemOrder(
      'afdian',
      trimmed,
      setOrderError,
      setOrderPending,
      setOrderDone,
    );
  }

  /** 面包多订单号兑换（32 位 hex 预校验，共用兑换流程） */
  async function handleMbdRedeem(): Promise<void> {
    const trimmed = mbdInput.trim();
    if (!isValidMbdOrderId(trimmed)) {
      setMbdError('unlock.mbdOrderInvalid');
      return;
    }
    await redeemOrder('mbd', trimmed, setMbdError, setMbdPending, setMbdDone);
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

  // 人工渠道兑换邮件（M3：主题 + 正文预填，模板与 /donate 页同源拼装）
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
            <div className="rounded-lg border border-white/10 bg-space-panel p-4 backdrop-blur">
              {/* A6-3 吊销命中态（裁决 ⑤ 原文；已在解锁页，无需跳转按钮登记） */}
              {entitlementRevoked && (
                <p
                  role="alert"
                  className="mb-3 rounded border border-violet-400/40 bg-violet-950/30 p-3 text-xs leading-5 text-violet-200"
                >
                  🕯️ {tr('unlock.revokedNotice')}
                </p>
              )}
              {/* A6-3 核验失败态（裁决 ⑥ 网络提示：拉取失败 + 无缓存名单） */}
              {revocationCheckFailed && (
                <p
                  role="alert"
                  className="mb-3 rounded border border-amber-400/40 bg-amber-950/30 p-3 text-xs leading-5 text-amber-200"
                >
                  {tr('unlock.revokeCheckFailed')}
                </p>
              )}
              <p className="text-xs leading-5 text-gray-400">
                {tr('unlock.statusFree')}
              </p>
            </div>
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

        {/* 档位价格表（消费 UNLOCK_TIERS，价格零硬编码；isCompact 布局分流；
            id 供通道区「选择档位扫码支付」锚点回跳（M3） */}
        <section id="unlock-tiers" className="mt-10 scroll-mt-6">
          <h2 className="mb-3 text-sm font-semibold text-gray-300">
            {tr('unlock.tiersSection')}
          </h2>
          {isCompact ? (
            // 紧凑视口：堆叠卡片（375~430 无溢出）；M2：卡片附支付宝扫码 CTA
            <ul className="space-y-2">
              {TIER_ORDER.map((tier) => (
                <li
                  key={tier}
                  className="rounded-lg border border-white/10 bg-space-panel px-4 py-3 backdrop-blur"
                >
                  <div className="flex items-center justify-between gap-3">
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
                  </div>
                  <button
                    type="button"
                    onClick={() => handleTierCta(tier)}
                    aria-label={trf('unlock.alipay.tierCtaAria', {
                      tier: tr(TIER_NAME_KEYS[tier]),
                    })}
                    className="mt-2 min-h-11 w-full rounded bg-space-accent/90 px-4 py-2 text-xs text-black transition-colors hover:bg-space-accent"
                  >
                    💙 {tr('unlock.alipay.tierCta')} →
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            // 桌面：对比表格（M2：行尾支付宝扫码 CTA 列）
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
                  <th className="px-4 py-2" aria-hidden="true" />
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
                    <td className="px-4 py-2.5 text-right">
                      <button
                        type="button"
                        onClick={() => handleTierCta(tier)}
                        aria-label={trf('unlock.alipay.tierCtaAria', {
                          tier: tr(TIER_NAME_KEYS[tier]),
                        })}
                        className="rounded bg-space-accent/90 px-3 py-1.5 text-xs text-black transition-colors hover:bg-space-accent"
                      >
                        💙 {tr('unlock.alipay.tierCta')} →
                      </button>
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

        {/* 五通道购买与兑换区（M3 渠道重排 §5.1 + 面包多集成：支付宝→微信→
            面包多→爱发电→Ko-fi；顺序断言测试对照 stock
            test_pages_recommend_alipay_and_channel_order） */}
        <section className="mt-10">
          <h2 className="mb-3 text-sm font-semibold text-gray-300">
            {tr('unlock.channelsSection')}
          </h2>
          <div className="space-y-3">
            {/* ① 支付宝扫码（推荐 · 自动发码）：档位卡片即 CTA，本面板为
                引导口径 + 锚点回跳档位表 */}
            <div className="rounded-lg border border-space-accent/40 bg-space-panel p-4 backdrop-blur">
              <h3 className="text-sm text-gray-200">
                💙 {tr('unlock.alipayChannelTitle')}
              </h3>
              <p className="mt-2 text-xs leading-5 text-gray-400">
                {tr('unlock.alipayChannelGuide')}
              </p>
              <a
                href="#unlock-tiers"
                className={`mt-3 inline-block rounded bg-space-accent/90 px-3 py-1.5 text-xs text-black transition-colors hover:bg-space-accent ${touchBtn}`}
              >
                {tr('unlock.alipayChannelCta')} ↑
              </a>
            </div>

            {/* ② 微信赞赏码独立小节（人工核验 · token 经 Email 发送）：
                M4 后续微调「轻量化」——默认只留引导短句 + 展开按钮（防止
                人工渠道显眼分流支付宝），赞赏码/支付步骤/邮件模板全部收进
                展开区（模板与 donate 页同源） */}
            <div className="rounded-lg border border-white/10 bg-space-panel p-4 backdrop-blur">
              <h3 className="text-sm text-gray-200">💚 {tr('unlock.wechatTitle')}</h3>
              <p className="mt-2 text-xs leading-5 text-gray-400">
                {tr('unlock.wechatGuide')}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  aria-expanded={qrOpen}
                  onClick={() => setQrOpen((v) => !v)}
                  className={`rounded border border-white/15 px-3 py-1.5 text-xs text-gray-300 transition-colors hover:text-white ${touchBtn}`}
                >
                  {tr(qrOpen ? 'unlock.wechatCollapse' : 'unlock.wechatExpand')}{' '}
                  {qrOpen ? '▴' : '▾'}
                </button>
              </div>
              {qrOpen && (
                <>
                  <p className="mt-3 text-xs leading-5 text-gray-400">
                    {trf('unlock.wechatSteps', { email: CONTACT_EMAIL })}
                  </p>
                  <div className="mt-3 text-center">
                    {/* 原生 <img>：静态导出无 next/image 优化（donate 页先例） */}
                    <img
                      src={WECHAT_QR_IMAGE}
                      alt={tr('unlock.wechatQrAlt')}
                      className="mx-auto w-full max-w-64 rounded-lg"
                    />
                    <p className="mt-2 text-[10px] leading-4 text-gray-500 max-md:text-xs">
                      {tr('unlock.wechatQrHint')}
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
                      className={`rounded border border-white/15 px-3 py-1.5 text-xs text-gray-300 transition-colors hover:text-white ${touchBtn}`}
                    >
                      📋 {tr(mailCopied ? 'unlock.mailTplCopied' : 'unlock.mailTplCopy')}
                    </button>
                    <a
                      href={mailtoHref}
                      className={`rounded bg-space-accent/90 px-3 py-1.5 text-xs text-black transition-colors hover:bg-space-accent ${touchBtn} inline-flex items-center`}
                    >
                      📮 {tr('unlock.mailTplOpen')} →
                    </a>
                  </div>
                </>
              )}
            </div>

            {/* ③ 面包多（备选 · 订单号自动兑换，扫码即付无需注册） */}
            <div className="rounded-lg border border-white/10 bg-space-panel p-4 backdrop-blur">
              <h3 className="text-sm text-gray-200">🍞 {tr('unlock.mbdTitle')}</h3>
              <p className="mt-2 text-xs leading-5 text-gray-400">
                {tr('unlock.mbdGuide')}
              </p>
              <a
                href={SPONSOR_MBD_URL}
                target="_blank"
                rel="noreferrer"
                className={`mt-3 inline-block rounded bg-space-accent/90 px-3 py-1.5 text-xs text-black transition-colors hover:bg-space-accent ${touchBtn}`}
              >
                {tr('unlock.mbdLink')}
              </a>
              <div className="mt-3">
                <label
                  htmlFor="mbd-order"
                  className="block text-xs text-gray-400"
                >
                  {tr('unlock.mbdOrderInputLabel')}
                </label>
                <div className="mt-1 flex gap-2 max-md:flex-col">
                  <input
                    id="mbd-order"
                    value={mbdInput}
                    onChange={(e) => setMbdInput(e.target.value)}
                    placeholder={tr('unlock.mbdOrderInputPlaceholder')}
                    className="min-w-0 flex-1 rounded border border-white/15 bg-black/30 px-2 py-1.5 font-mono text-xs text-gray-200 placeholder:text-gray-600 max-md:min-h-11"
                  />
                  <button
                    type="button"
                    onClick={() => void handleMbdRedeem()}
                    disabled={mbdPending}
                    className={`shrink-0 rounded bg-space-accent/90 px-4 py-1.5 text-xs text-black transition-colors hover:bg-space-accent disabled:cursor-not-allowed disabled:opacity-50 ${touchBtn}`}
                  >
                    {tr(mbdPending ? 'unlock.redeemPending' : 'unlock.redeemButton')}
                  </button>
                </div>
                {mbdError !== null && (
                  <p role="alert" className="mt-2 text-xs text-amber-300">
                    {tr(mbdError)}
                  </p>
                )}
                {mbdDone && (
                  <p className="mt-2 text-xs text-emerald-300">
                    🎉 {tr('unlock.redeemSuccess')}
                  </p>
                )}
              </div>
            </div>

            {/* ④ 爱发电（备选 · 订单号自动兑换，兑换框保留） */}
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

            {/* ⑤ Ko-fi（海外备选 · 人工核验） */}
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

      {/* M2：支付宝付款 modal（档位 CTA 打开；isCompact 转全屏抽屉） */}
      {alipayTier !== null && (
        <UnlockAlipayModal
          tier={alipayTier}
          isCompact={isCompact}
          onClose={() => setAlipayTier(null)}
        />
      )}
    </main>
  );
}
