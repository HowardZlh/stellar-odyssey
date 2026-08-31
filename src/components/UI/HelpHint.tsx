'use client';

import type { JSX } from 'react';
import { useEffect, useState } from 'react';
import { useT } from '@/hooks/useI18n';
import { useSimulationStore } from '@/store';

/** 打开后自动关闭延时（毫秒；G3：3s → 12s，首屏只留一行操作提示后放宽） */
export const HELP_HINT_AUTO_CLOSE_MS = 12000;

/**
 * 首次进入操作引导（需求 3.5.3）
 *
 * B3 i18n 打样件：全部文案（含科学性说明段）经字典查找双语化；
 * zh 字典条目为原 JSX 空白折叠结果的逐字符搬迁（中文态逐像素等价）；
 * 末行语言切换说明为 B3-D 新增（实现差异登记）。
 *
 * G3 拆分（REQUIREMENTS_GROWTH.md §3 M1）：
 * - **首屏卡只留一行操作提示**（controls/controlsTouch 口径），12 秒后
 *   自动关闭（原 3 秒 + 约 900 汉字免责长文的组合既遮挡又读不完）；
 * - **完整帮助面板**（桌面经「?」重开 / 移动端经 [? 帮助] 标签）才展示
 *   语言说明、kiosk 说明与**科学性说明独立分节**（disclaimerTitle +
 *   disclaimer，内容零删改——只改呈现位置与时机，硬性约束）；
 * - 完整面板加 max-h + 内滚（长文不再溢出视口）。
 *
 * UI 布局优化（沿革）：
 * - 页面打开 12 秒后自动关闭（鼠标悬停暂停倒计时，移出后重新计满）；
 * - 关闭后原位置保留一个「?」小按钮可重新打开；手动重开后不再自动关闭
 *   （用户主动查看时不打断阅读）。
 *
 * M3-3 移动布局（isCompact）：底部悬浮卡与「?」重开钮不渲染——引导
 * 入口并入底部标签栏（[? 帮助] 钮，store.mobilePanel 互斥位），打开时
 * 呈居中弹层（内滚，关闭钮 + 点按遮罩关闭）；默认不自动弹出（实现
 * 差异登记：避免首屏遮挡，引导经标签栏常驻入口可达）。桌面分支原样。
 *
 * M4-5 触屏分流（isTouch）：首段操作引导换触屏口径（单指/双指/点按），
 * 键鼠快捷键段落（kioskNote 行，H 键说明）隐藏；M4-4：触摸提示卡任意处
 * 暂停倒计时（实现登记：触摸即解除自动关闭武装——触屏无可靠"移出"事件
 * 恢复倒计时，改为一触即停、经 ✕ 手动关闭，与 hover 暂停语义等强）。
 */
export function HelpHint(): JSX.Element | null {
  const [visible, setVisible] = useState(true);
  const [hovered, setHovered] = useState(false);
  // 自动关闭仅武装一次：手动经「?」重开后解除（不再自动关闭）
  const [autoCloseArmed, setAutoCloseArmed] = useState(true);
  const tr = useT();
  const isTouch = useSimulationStore((s) => s.isTouch);
  const isCompact = useSimulationStore((s) => s.isCompact);
  const mobileOpen = useSimulationStore((s) => s.mobilePanel === 'help');
  const setMobilePanel = useSimulationStore((s) => s.setMobilePanel);

  useEffect(() => {
    if (isCompact || !visible || !autoCloseArmed || hovered) return undefined;
    const id = setTimeout(() => setVisible(false), HELP_HINT_AUTO_CLOSE_MS);
    return () => clearTimeout(id);
  }, [isCompact, visible, autoCloseArmed, hovered]);

  // 首屏一行操作提示（M4-5：isTouch 换触屏口径，emoji 组件层持有）
  const controlsLine = isTouch ? (
    <>👆 {tr('helpHint.controlsTouch')}</>
  ) : (
    <>{tr('helpHint.controls')}</>
  );

  // 完整帮助正文（桌面「?」重开 / 移动弹层）：操作提示 + 语言/kiosk
  // 说明 + 科学性说明独立分节（G3：免责长文只在此处展示）
  const fullBody = (
    <div className="space-y-2">
      <p>{controlsLine}</p>
      <p className="text-gray-500">🌐 {tr('helpHint.langNote')}</p>
      {!isTouch && (
        <>
          {/* B5：H 键与展馆模式说明（附录 A#4 快捷键表同步） */}
          <p className="text-gray-500">🖥 {tr('helpHint.kioskNote')}</p>
        </>
      )}
      <div className="border-t border-white/10 pt-2">
        <p className="mb-1 font-medium text-gray-400">✦ {tr('helpHint.disclaimerTitle')}</p>
        <p className="text-gray-500">{tr('helpHint.disclaimer')}</p>
      </div>
    </div>
  );

  if (isCompact) {
    if (!mobileOpen) return null;
    return (
      <div className="fixed inset-0 z-30 flex items-center justify-center p-4">
        {/* 遮罩：点按任意空白关闭 */}
        <div
          className="absolute inset-0 bg-black/50"
          onClick={() => setMobilePanel(null)}
          aria-hidden
        />
        <div className="relative max-h-[70dvh] w-full max-w-96 overflow-y-auto overscroll-contain rounded-lg bg-space-panel p-4 pr-2 text-sm leading-6 text-gray-300 backdrop-blur hud-scroll">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">{fullBody}</div>
            <button
              type="button"
              onClick={() => setMobilePanel(null)}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded text-gray-400"
              aria-label={tr('helpHint.closeAria')}
            >
              ✕
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!visible) {
    return (
      <button
        type="button"
        onClick={() => {
          setAutoCloseArmed(false);
          setVisible(true);
        }}
        aria-label={tr('helpHint.reopenAria')}
        title={tr('helpHint.reopenAria')}
        className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full border border-white/10 bg-space-panel px-3 py-1.5 text-sm text-gray-400 backdrop-blur transition-colors hover:text-white"
      >
        ?
      </button>
    );
  }

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      // M4-4：触摸提示卡任意处暂停倒计时（触屏无移出事件，一触即解除
      // 自动关闭武装；桌面 isTouch=false 不挂手势零变化）
      onPointerDown={isTouch ? () => setAutoCloseArmed(false) : undefined}
      className="absolute bottom-4 left-1/2 max-h-[60vh] w-max max-w-[min(56rem,calc(100vw-2rem))] -translate-x-1/2 overflow-y-auto rounded-lg bg-space-panel px-5 py-3 text-xs text-gray-300 backdrop-blur hud-scroll"
    >
      <div className="flex items-center gap-4">
        {/* G3：首屏自动展示态只留一行操作提示；「?」重开后展示完整帮助
            （autoCloseArmed 复用为两态判别——重开即解除武装） */}
        {autoCloseArmed ? <p>{controlsLine}</p> : fullBody}
        <button
          type="button"
          onClick={() => setVisible(false)}
          className="shrink-0 text-gray-500 hover:text-white"
          aria-label={tr('helpHint.closeAria')}
        >
          ✕
        </button>
      </div>
    </div>
  );
}
