'use client';

/**
 * 支付宝当面付付款 modal（Z 迭代 M2，REQUIREMENTS_ALIPAY_UNLOCK.md §5.1(1)/D-z5）
 *
 * 状态机：input（昵称/留言可选）→ creating（POST /api/alipay/create）→
 * qr（二维码 + 手机直达链接 + 轮询 status）→ paid（applyUnlockToken 自动
 * 激活 + 展示 token 提示保存）/ expired（30 分钟过期，可重新生成）/
 * failed（轮询链路错误，可重新生成）。创建失败（敏感词拒绝/网关失败等）
 * 回落 input 态展示错误后可修改重试。
 *
 * 轮询节奏（D-z5，纯函数 planAlipayPoll 单测）：3s 起步；≥60s 带 deep=1
 * （服务端实时 trade.query 兜底补发，E4 第二层自愈）；≥5min 降频 10s；
 * ≥30min 过期停止并提示重新生成。
 *
 * 移动端 8 条对照（AGENTS.md）：isCompact 经 useViewportKind 由页面注入
 * （禁止自建判据）——紧凑视口转全屏抽屉（safe-area 四向避让 + 自身滚动），
 * 桌面居中弹层；触控目标 ≥44pt（关闭钮 h-11 w-11 / 按钮 max-md:min-h-11）；
 * 无 3D 场景触控面；375px 无溢出（max-w-md + 全屏态 w-full）。
 *
 * 权益激活收口：store applyUnlockToken（验签 + 吊销核对 + persist 由
 * store 承担，U2 链路收敛纪律）。
 */
import type { JSX } from 'react';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { MessageKey } from '@/i18n';
import { useT, useTf } from '@/hooks/useI18n';
import { useSimulationStore } from '@/store';
import { CONTRIBUTORS_PAGE_PATH } from '@/utils/contributorUniverse';
import type { UnlockTier } from '@/data/unlockPricing';
import { UNLOCK_TIERS } from '@/data/unlockPricing';
import {
  ALIPAY_CREATE_API_PATH,
  ALIPAY_MESSAGE_MAX_LEN,
  ALIPAY_NICKNAME_MAX_LEN,
  ALIPAY_STATUS_API_PATH,
  alipayErrorMessageKey,
  alipayFieldTooLong,
  parseAlipayCreateResponse,
  parseAlipayStatusResponse,
  planAlipayPoll,
  resolveAlipayApiUrl,
  type AlipayCreateSuccess,
} from '@/utils/alipayOrder';
import { trackFunnelEvent } from '@/utils/funnel';
import { renderQrToCanvas } from '@/utils/qrEncoder';

/** 档位 → 名称 i18n 键（unlock 页同表——各自持有不跨文件 import 组件常量） */
const TIER_NAME_KEYS: Readonly<Record<UnlockTier, MessageKey>> = {
  week: 'unlock.tierWeek',
  month: 'unlock.tierMonth',
  year: 'unlock.tierYear',
};

/** API 端点（构建期 NEXT_PUBLIC_UNLOCK_API_BASE 覆写，unlockRedeem 同机制） */
const CREATE_API_URL = resolveAlipayApiUrl(
  ALIPAY_CREATE_API_PATH,
  process.env.NEXT_PUBLIC_UNLOCK_API_BASE,
);
const STATUS_API_URL = resolveAlipayApiUrl(
  ALIPAY_STATUS_API_PATH,
  process.env.NEXT_PUBLIC_UNLOCK_API_BASE,
);

type ModalPhase = 'input' | 'creating' | 'qr' | 'paid' | 'expired' | 'failed';

export interface UnlockAlipayModalProps {
  readonly tier: UnlockTier;
  readonly isCompact: boolean;
  readonly onClose: () => void;
}

export function UnlockAlipayModal({
  tier,
  isCompact,
  onClose,
}: UnlockAlipayModalProps): JSX.Element {
  const tr = useT();
  const trf = useTf();

  const [phase, setPhase] = useState<ModalPhase>('input');
  const [errorKey, setErrorKey] = useState<MessageKey | null>(null);
  const [nickname, setNickname] = useState('');
  const [message, setMessage] = useState('');
  const [order, setOrder] = useState<AlipayCreateSuccess | null>(null);
  const [paidToken, setPaidToken] = useState<string | null>(null);
  /** 付款码生成时刻（轮询 elapsed 基准；ref 不触发重渲） */
  const createdAtRef = useRef(0);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // G8 漏斗：支付 modal 打开（组件仅在档位 CTA 打开时挂载，mount 即计数）
  useEffect(() => {
    trackFunnelEvent('pay_open');
  }, []);

  /** 生成付款码（前端长度预检 → create → 进入轮询态） */
  async function handleCreate(): Promise<void> {
    if (alipayFieldTooLong(nickname, ALIPAY_NICKNAME_MAX_LEN)) {
      setErrorKey('unlock.alipay.errNicknameTooLong');
      return;
    }
    if (alipayFieldTooLong(message, ALIPAY_MESSAGE_MAX_LEN)) {
      setErrorKey('unlock.alipay.errMessageTooLong');
      return;
    }
    setErrorKey(null);
    setPhase('creating');
    try {
      const response = await fetch(CREATE_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tier,
          nickname: nickname.trim(),
          message: message.trim(),
        }),
      });
      let parsed: ReturnType<typeof parseAlipayCreateResponse> = null;
      try {
        parsed = parseAlipayCreateResponse((await response.json()) as unknown);
      } catch {
        parsed = null; // 非 JSON 响应体：按未知错误提示
      }
      if (parsed === null) {
        setErrorKey('unlock.alipay.errUnknown');
        setPhase('input');
        return;
      }
      if (!parsed.ok) {
        setErrorKey(alipayErrorMessageKey(parsed.error));
        setPhase('input');
        return;
      }
      createdAtRef.current = Date.now();
      setOrder(parsed);
      setPhase('qr');
    } catch {
      setErrorKey('unlock.alipay.errNetwork'); // fetch 拒绝（断网/CORS）：可重试
      setPhase('input');
    }
  }

  // 二维码渲染（qr_code 码串前端自渲染，D7 内嵌编码器；受限环境静默跳过）
  useEffect(() => {
    if (phase !== 'qr' || order === null || canvasRef.current === null) return;
    try {
      renderQrToCanvas(canvasRef.current, order.qrCode, 220);
    } catch {
      // 码串异常（超容量等）不白屏：直达链接仍可用
    }
  }, [phase, order]);

  // 轮询循环（setTimeout 链；卸载/离开 qr 态即取消）
  useEffect(() => {
    if (phase !== 'qr' || order === null) return undefined;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    function schedule(): void {
      if (cancelled) return;
      const plan = planAlipayPoll(Date.now() - createdAtRef.current);
      if (plan.expired) {
        setPhase('expired');
        return;
      }
      timer = setTimeout(() => {
        void poll(plan.deep);
      }, plan.delayMs);
    }

    async function poll(deep: boolean): Promise<void> {
      if (cancelled || order === null) return;
      try {
        const url = `${STATUS_API_URL}?out_trade_no=${encodeURIComponent(order.outTradeNo)}${deep ? '&deep=1' : ''}`;
        const response = await fetch(url);
        const parsed = parseAlipayStatusResponse(
          (await response.json()) as unknown,
        );
        if (cancelled) return;
        if (parsed !== null && parsed.ok) {
          if (parsed.status === 'paid' && parsed.token !== null) {
            const applied = useSimulationStore
              .getState()
              .applyUnlockToken(parsed.token);
            if (applied.ok) {
              setPaidToken(parsed.token);
              setPhase('paid');
            } else {
              // 本地验签/吊销核对未过（公钥不符等异常场景）：终态提示
              setErrorKey('unlock.alipay.errTokenVerify');
              setPhase('failed');
            }
            return;
          }
          if (parsed.status === 'closed' || parsed.status === 'refunded') {
            setPhase('expired'); // 订单已关/已退：按过期口径提示重新生成
            return;
          }
        } else if (parsed !== null && !parsed.ok) {
          setErrorKey(alipayErrorMessageKey(parsed.error));
          setPhase('failed');
          return;
        }
        // pending / 形状异常：继续下一轮（网络抖动不终止轮询）
      } catch {
        // 网络失败：静默继续下一轮
      }
      schedule();
    }

    schedule();
    return (): void => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [phase, order]);

  /** 过期/失败后重新生成：回 input 态保留昵称留言 */
  function handleRegenerate(): void {
    setOrder(null);
    setPaidToken(null);
    setErrorKey(null);
    setPhase('input');
  }

  const tierName = tr(TIER_NAME_KEYS[tier]);
  const touchBtn = 'max-md:min-h-11 max-md:px-4 max-md:py-3';

  return (
    // 遮罩层：桌面居中弹层；紧凑视口全屏抽屉（safe-area 四向避让）
    <div
      className={
        isCompact
          ? 'fixed inset-0 z-50 bg-space-dark'
          : 'fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4'
      }
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={tr('unlock.alipay.modalTitle')}
        className={
          isCompact
            ? 'hud-scroll h-full w-full overflow-y-auto bg-space-dark pb-[calc(1.5rem+env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pt-[max(1rem,env(safe-area-inset-top))]'
            : 'hud-scroll max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg border border-white/10 bg-space-panel p-5 backdrop-blur'
        }
      >
        {/* 标题栏 + 关闭（≥44×44pt 触控目标） */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-gray-200">
              💙 {tr('unlock.alipay.modalTitle')}
            </h3>
            <p className="mt-1 text-xs text-amber-200/90">
              {trf('unlock.alipay.tierLine', {
                tier: tierName,
                price: UNLOCK_TIERS[tier].priceCny,
                days: UNLOCK_TIERS[tier].days,
              })}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={tr('unlock.alipay.closeAria')}
            className="-mr-2 -mt-2 flex h-11 w-11 shrink-0 items-center justify-center text-gray-400 transition-colors hover:text-white"
          >
            ✕
          </button>
        </div>

        {/* input / creating：昵称留言表单 */}
        {(phase === 'input' || phase === 'creating') && (
          <div className="mt-4">
            <label
              htmlFor="alipay-nickname"
              className="block text-xs text-gray-400"
            >
              {tr('unlock.alipay.nicknameLabel')}
            </label>
            <input
              id="alipay-nickname"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder={tr('unlock.alipay.nicknamePlaceholder')}
              className="mt-1 w-full rounded border border-white/15 bg-black/30 px-2 py-1.5 text-xs text-gray-200 placeholder:text-gray-600 max-md:min-h-11"
            />
            <label
              htmlFor="alipay-message"
              className="mt-3 block text-xs text-gray-400"
            >
              {tr('unlock.alipay.messageLabel')}
            </label>
            <input
              id="alipay-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={tr('unlock.alipay.messagePlaceholder')}
              className="mt-1 w-full rounded border border-white/15 bg-black/30 px-2 py-1.5 text-xs text-gray-200 placeholder:text-gray-600 max-md:min-h-11"
            />
            <p className="mt-2 text-[10px] leading-4 text-gray-500 max-md:text-xs">
              {tr('unlock.alipay.publicNote')}
            </p>
            {errorKey !== null && (
              <p role="alert" className="mt-2 text-xs text-amber-300">
                {tr(errorKey)}
              </p>
            )}
            <button
              type="button"
              onClick={() => void handleCreate()}
              disabled={phase === 'creating'}
              className={`mt-4 w-full rounded bg-space-accent/90 px-4 py-2 text-xs text-black transition-colors hover:bg-space-accent disabled:cursor-not-allowed disabled:opacity-50 ${touchBtn}`}
            >
              {tr(
                phase === 'creating'
                  ? 'unlock.alipay.creating'
                  : 'unlock.alipay.createButton',
              )}
            </button>
          </div>
        )}

        {/* qr：二维码 + 手机直达链接 + 金额/有效期 + 轮询等待 */}
        {phase === 'qr' && order !== null && (
          <div className="mt-4 text-center">
            <p className="text-xs text-gray-300">{tr('unlock.alipay.qrTitle')}</p>
            <canvas
              ref={canvasRef}
              role="img"
              aria-label={tr('unlock.alipay.qrAlt')}
              className="mx-auto mt-3 rounded bg-white p-1"
            />
            <p className="mt-3 text-sm font-medium text-amber-200/90">
              {trf('unlock.alipay.amountLine', { amount: order.amount })}
            </p>
            <p className="mt-1 text-[10px] leading-4 text-gray-500 max-md:text-xs">
              {tr('unlock.alipay.expireHint')}
            </p>
            <a
              href={order.qrCode}
              target="_blank"
              rel="noreferrer"
              className={`mt-3 inline-block rounded border border-white/15 px-3 py-1.5 text-xs text-gray-300 transition-colors hover:text-white ${touchBtn}`}
            >
              📱 {tr('unlock.alipay.openInAlipay')}
            </a>
            <p className="mt-3 text-xs text-gray-400" role="status">
              ⏳ {tr('unlock.alipay.waiting')}
            </p>
          </div>
        )}

        {/* paid：激活成功 + token 妥存提示 */}
        {phase === 'paid' && paidToken !== null && (
          <div className="mt-4">
            <p className="text-sm font-medium text-emerald-300">
              🎉 {tr('unlock.alipay.paidTitle')}
            </p>
            <p className="mt-2 text-xs leading-5 text-gray-400">
              {tr('unlock.alipay.paidTokenHint')}
            </p>
            <input
              readOnly
              value={paidToken}
              aria-label={tr('unlock.tokenInputLabel')}
              onFocus={(e) => e.currentTarget.select()}
              className="mt-2 w-full rounded border border-white/15 bg-black/30 px-2 py-1.5 font-mono text-[10px] text-gray-300"
            />
            {/* 付款成功强引导：支付宝为即时上榜，此刻昵称/留言已写入
                贡献者宇宙——情感回报峰值处一键看自己的星 */}
            <Link
              href={CONTRIBUTORS_PAGE_PATH}
              className={`mt-4 flex w-full items-center justify-center rounded border border-space-accent/40 bg-space-accent/10 px-4 text-xs font-medium text-space-accent transition-colors hover:border-space-accent/70 hover:text-white ${touchBtn}`}
            >
              {tr('unlock.alipay.contributorsCta')}
            </Link>
            <button
              type="button"
              onClick={onClose}
              className={`mt-2 w-full rounded bg-space-accent/90 px-4 py-2 text-xs text-black transition-colors hover:bg-space-accent ${touchBtn}`}
            >
              {tr('unlock.alipay.closeAria')}
            </button>
          </div>
        )}

        {/* expired / failed：错误提示 + 重新生成 */}
        {(phase === 'expired' || phase === 'failed') && (
          <div className="mt-4">
            <p role="alert" className="text-xs leading-5 text-amber-300">
              {phase === 'expired'
                ? tr('unlock.alipay.expiredNotice')
                : tr(errorKey ?? 'unlock.alipay.errUnknown')}
            </p>
            <button
              type="button"
              onClick={handleRegenerate}
              className={`mt-4 w-full rounded bg-space-accent/90 px-4 py-2 text-xs text-black transition-colors hover:bg-space-accent ${touchBtn}`}
            >
              {tr('unlock.alipay.regenerate')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
