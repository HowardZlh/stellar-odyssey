'use client';

import type { JSX } from 'react';
import { useEffect, useRef, useState } from 'react';
import { useT } from '@/hooks/useI18n';
import { useSimulationStore } from '@/store';

/** 商业合作联系邮箱（README「商业合作」小节同源） */
export const CONTACT_EMAIL = 'stevenzearo@163.com';
/** GitHub Issues 链接（仓库 HowardZlh/stellar-odyssey） */
export const CONTACT_GITHUB_ISSUES_URL =
  'https://github.com/HowardZlh/stellar-odyssey/issues';
/** 爱发电赞助主页（README 赞助小节与 .github/FUNDING.yml 同源） */
export const SPONSOR_AFDIAN_URL = 'https://afdian.com/a/stellar-odyssey';
/** 站内捐赠页路径（左下角「投喂燃料」入口新标签页打开） */
export const DONATE_PAGE_PATH = '/donate';

/**
 * 商业合作角标（左下角常驻）：点击展开小卡片（邮箱 + GitHub Issues +
 * 爱发电赞助链接 + 一句话说明），再次点击或点击卡片外任意位置收起。
 *
 * 布局与避让登记：
 * - 左下角冲突处理取「临时隐藏」方案（隐藏/上移二选一）：任一事件通知
 *   可见（耀斑/CME/CME 抵达/超新星）或太阳剖面分层卡片占用左下角
 *   （sunCutawayMode 且已选分层）时整体隐藏，条件解除即恢复；
 * - 不遮挡 3D 交互：根元素为左下角小尺寸 fixed 定位，角标外区域无覆盖层，
 *   点击外部收起经 window pointerdown 被动监听实现（不拦截、不 preventDefault），
 *   canvas 拖拽/滚轮不受影响；
 * - 样式口径与 ControlPanel 一致（bg-space-panel 深色半透明 + backdrop-blur）；
 * - kiosk 接入收口（B5 §5.1-A）：store `uiVisible` 已交付，本组件经
 *   SolarSystemApp 顶层包裹统一受控（uiVisible=false 时角标同隐藏，
 *   组件自身零改动）。
 *
 * i18n（B2 打样件）：全部文案经字典查找（`contactBadge.*` 键组），
 * 作为客户端 locale 机制的验证件；六大 UI 组件批量迁移属 B3。
 */
export function ContactBadge(): JSX.Element | null {
  const [expanded, setExpanded] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const tr = useT();

  // 避让判定：事件通知可见标志 + 左下角剖面分层卡片（实际占位者）
  const avoided = useSimulationStore(
    (s) =>
      s.solarFlareNoticeVisible ||
      s.cmeNoticeVisible ||
      s.cmeArrivalNoticeVisible ||
      s.supernovaNoticeVisible ||
      (s.sunCutawayMode && s.sunCutawayLayer !== null),
  );

  // 隐藏期间收起卡片（恢复显示时回到未展开的初始态）
  useEffect(() => {
    if (avoided) setExpanded(false);
  }, [avoided]);

  // 展开时点击卡片外任意位置收起（被动监听，不拦截场景交互）
  useEffect(() => {
    if (!expanded) return undefined;
    const onPointerDown = (event: PointerEvent): void => {
      const root = rootRef.current;
      if (root && event.target instanceof Node && !root.contains(event.target)) {
        setExpanded(false);
      }
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [expanded]);

  if (avoided) return null;

  return (
    <div ref={rootRef} className="fixed bottom-4 left-4 text-xs">
      {expanded && (
        <div
          role="dialog"
          aria-label={tr('contactBadge.dialogAriaLabel')}
          className="mb-2 w-64 rounded-lg border border-space-accent/30 bg-space-panel p-4 backdrop-blur"
        >
          <h3 className="text-sm font-semibold text-space-accent">
            {tr('contactBadge.title')}
          </h3>
          <p className="mt-1 leading-5 text-gray-300">{tr('contactBadge.description')}</p>
          <div className="mt-2 space-y-1">
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              className="block text-space-accent hover:underline"
            >
              📮 {CONTACT_EMAIL}
            </a>
            <a
              href={CONTACT_GITHUB_ISSUES_URL}
              target="_blank"
              rel="noreferrer"
              className="block text-space-accent hover:underline"
            >
              💬 {tr('contactBadge.githubIssues')}
            </a>
            <a
              href={SPONSOR_AFDIAN_URL}
              target="_blank"
              rel="noreferrer"
              className="block text-space-accent hover:underline"
            >
              ⚡ {tr('contactBadge.sponsor')}
            </a>
          </div>
        </div>
      )}
      <div className="flex items-center gap-2">
        {/* 捐赠入口（商业合作左侧）：新标签页打开站内捐赠页 /donate */}
        <a
          href={DONATE_PAGE_PATH}
          target="_blank"
          rel="noreferrer"
          aria-label={tr('contactBadge.donateAria')}
          className="rounded-lg border border-amber-300/30 bg-space-panel px-3 py-2 text-amber-200/90 backdrop-blur transition-colors hover:text-amber-100"
        >
          ☄️ {tr('contactBadge.donateLabel')}
        </a>
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
          className="rounded-lg border border-white/10 bg-space-panel px-3 py-2 text-gray-300 backdrop-blur transition-colors hover:text-white"
        >
          💼 {tr('contactBadge.badgeLabel')}
        </button>
      </div>
    </div>
  );
}
