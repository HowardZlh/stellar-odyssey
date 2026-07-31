'use client';

import type { JSX } from 'react';
import { useEffect, useRef, useState } from 'react';
import { useSimulationStore } from '@/store';

/** 商业合作联系邮箱（README「商业合作」小节同源） */
export const CONTACT_EMAIL = 'stevenzearo@163.com';
/** GitHub Issues 链接（仓库 HowardZlh/stellar-odyssey） */
export const CONTACT_GITHUB_ISSUES_URL =
  'https://github.com/HowardZlh/stellar-odyssey/issues';

/**
 * 商业合作角标（左下角常驻）：点击展开小卡片（邮箱 + GitHub Issues +
 * 一句话说明），再次点击或点击卡片外任意位置收起。
 *
 * 布局与避让登记：
 * - 左下角冲突处理取「临时隐藏」方案（隐藏/上移二选一）：任一事件通知
 *   可见（耀斑/CME/CME 抵达/超新星）或太阳剖面分层卡片占用左下角
 *   （sunCutawayMode 且已选分层）时整体隐藏，条件解除即恢复；
 * - 不遮挡 3D 交互：根元素为左下角小尺寸 fixed 定位，角标外区域无覆盖层，
 *   点击外部收起经 window pointerdown 被动监听实现（不拦截、不 preventDefault），
 *   canvas 拖拽/滚轮不受影响；
 * - 样式口径与 ControlPanel 一致（bg-space-panel 深色半透明 + backdrop-blur）；
 * - 待 B4 接入：kiosk 模式 store `uiVisible` 字段尚不存在，B4 交付时接入
 *   （uiVisible=false 时角标同隐藏）。
 */
export function ContactBadge(): JSX.Element | null {
  const [expanded, setExpanded] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

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
          aria-label="商业合作联系方式"
          className="mb-2 w-64 rounded-lg border border-space-accent/30 bg-space-panel p-4 backdrop-blur"
        >
          <h3 className="text-sm font-semibold text-space-accent">商业合作</h3>
          <p className="mt-1 leading-5 text-gray-300">
            欢迎教育机构、科技馆与展陈集成商联系：展馆大屏部署、定制开发、课程内容。
          </p>
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
              💬 GitHub Issues
            </a>
          </div>
        </div>
      )}
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
        className="rounded-lg border border-white/10 bg-space-panel px-3 py-2 text-gray-300 backdrop-blur transition-colors hover:text-white"
      >
        💼 商业合作
      </button>
    </div>
  );
}
