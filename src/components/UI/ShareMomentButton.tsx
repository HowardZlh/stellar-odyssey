'use client';

/**
 * 「分享此刻」按钮（G5，REQUIREMENTS_GROWTH §3 M2）
 *
 * URL 组装走纯函数 utils/shareLink.ts（只携带 body/lang，严禁 token）。
 * 分享动作口径：
 * - 触屏（store.isTouch）优先 `navigator.share` 系统分享面板；用户取消
 *   （AbortError）静默返回，其余失败降级复制；
 * - share 不可用 / 桌面：`navigator.clipboard.writeText` + 就地气泡反馈
 *   （复制成功/失败双态，2.5s 自动复位；无全局 toast 体系，沿用局部
 *   state 范式——unlock 页 copyState 先例）。
 *
 * 宿主形态（按钮内容由宿主以 children 提供，emoji 组件层持有）：
 * - 主场景桌面：BodyCycleSwitcher 底部胶囊内追加钮；
 * - 主场景移动：BottomTabBar 第五 tab（分享为即时动作、非面板，
 *   不占 mobilePanel 互斥值——单值互斥语义零改动）；
 * - 观察站页：ObservatoryHarness 左上返回链接旁（ShareContext 由页面
 *   传定值 observatory 形态）。
 */

import type { JSX, ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { useLocale, useT } from '@/hooks/useI18n';
import { useSimulationStore } from '@/store';
import { trackFunnelEvent } from '@/utils/funnel';
import { buildShareUrl, type ShareContext } from '@/utils/shareLink';

/** 复制反馈气泡自动复位延时（ms） */
export const SHARE_FEEDBACK_RESET_MS = 2500;

type ShareFeedback = 'idle' | 'copied' | 'failed';

export interface ShareMomentButtonProps {
  /** 分享上下文（主场景经 MainShareMomentButton 订阅 store 派生） */
  context: ShareContext;
  /** 按钮样式（宿主决定形态） */
  className?: string;
  /** 按钮内容（emoji + 文案由宿主持有） */
  children: ReactNode;
  /** 反馈气泡方位（默认 above：向上冒泡不遮宿主行） */
  feedbackPlacement?: 'above' | 'below';
}

export function ShareMomentButton({
  context,
  className,
  children,
  feedbackPlacement = 'above',
}: ShareMomentButtonProps): JSX.Element {
  const tr = useT();
  const locale = useLocale();
  const isTouch = useSimulationStore((s) => s.isTouch);
  const [feedback, setFeedback] = useState<ShareFeedback>('idle');

  // 反馈气泡 2.5s 自动复位（feedback 变更即重置计时器，卸载清理）
  useEffect(() => {
    if (feedback === 'idle') return undefined;
    const timer = setTimeout(() => setFeedback('idle'), SHARE_FEEDBACK_RESET_MS);
    return () => clearTimeout(timer);
  }, [feedback]);

  const handleShare = async (): Promise<void> => {
    trackFunnelEvent('share_click'); // G8 漏斗：分享入口点击（M2 追加裁决键）
    const url = buildShareUrl(window.location.origin, context, locale);
    if (isTouch) {
      const nav = navigator as Navigator & {
        share?: (data: { url: string }) => Promise<void>;
      };
      if (typeof nav.share === 'function') {
        try {
          await nav.share({ url });
          return;
        } catch (error) {
          // 用户取消系统分享面板：静默返回；其余失败降级复制
          if (error instanceof DOMException && error.name === 'AbortError') {
            return;
          }
        }
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setFeedback('copied');
    } catch {
      // clipboard 不可用（权限拒绝/非安全上下文）：失败态提示手动复制
      setFeedback('failed');
    }
  };

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        onClick={() => void handleShare()}
        aria-label={tr('share.buttonAria')}
        className={className}
      >
        {children}
      </button>
      {feedback !== 'idle' && (
        <span
          role="status"
          className={`pointer-events-none absolute left-1/2 z-30 -translate-x-1/2 whitespace-nowrap rounded bg-space-panel px-2 py-1 text-[10px] backdrop-blur ${
            feedbackPlacement === 'above' ? 'bottom-full mb-2' : 'top-full mt-2'
          } ${feedback === 'copied' ? 'text-emerald-300' : 'text-amber-300'}`}
        >
          {tr(feedback === 'copied' ? 'share.copied' : 'share.copyFail')}
        </span>
      )}
    </span>
  );
}

/**
 * 主场景「分享此刻」（BodyCycleSwitcher / BottomTabBar 共用）：
 * 分享天体 = 跟随中天体优先，未跟随时取信息面板选中天体（与深链
 * `?body=` 的 requestFlyTo「飞往并跟随」语义对齐——接收方打开即复现）。
 */
export function MainShareMomentButton(
  props: Omit<ShareMomentButtonProps, 'context'>,
): JSX.Element {
  const bodyId = useSimulationStore((s) => s.followBodyId ?? s.selectedBodyId);
  return <ShareMomentButton context={{ kind: 'main', bodyId }} {...props} />;
}
