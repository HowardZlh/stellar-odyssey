'use client';

import type { JSX } from 'react';
import { useEffect, useState } from 'react';
import { useT } from '@/hooks/useI18n';

/** 打开后自动关闭延时（毫秒，UI 布局优化：避免长期遮挡画面中央） */
export const HELP_HINT_AUTO_CLOSE_MS = 5000;

/**
 * 首次进入操作引导（需求 3.5.3）
 *
 * B3 i18n 打样件：全部文案（含科学性说明段）经字典查找双语化；
 * zh 字典条目为原 JSX 空白折叠结果的逐字符搬迁（中文态逐像素等价）；
 * 末行语言切换说明为 B3-D 新增（实现差异登记）。
 *
 * UI 布局优化：
 * - 页面打开 5 秒后自动关闭（鼠标悬停暂停倒计时，移出后重新计满 5 秒）；
 * - 关闭后原位置保留一个「?」小按钮可重新打开；手动重开后不再自动关闭
 *   （用户主动查看时不打断阅读）。
 */
export function HelpHint(): JSX.Element | null {
  const [visible, setVisible] = useState(true);
  const [hovered, setHovered] = useState(false);
  // 自动关闭仅武装一次：手动经「?」重开后解除（不再自动关闭）
  const [autoCloseArmed, setAutoCloseArmed] = useState(true);
  const tr = useT();

  useEffect(() => {
    if (!visible || !autoCloseArmed || hovered) return undefined;
    const id = setTimeout(() => setVisible(false), HELP_HINT_AUTO_CLOSE_MS);
    return () => clearTimeout(id);
  }, [visible, autoCloseArmed, hovered]);

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
      className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-lg bg-space-panel px-5 py-3 text-xs text-gray-300 backdrop-blur"
    >
      <div className="flex items-center gap-4">
        <p>
          {tr('helpHint.controls')}
          <br />
          <span className="text-gray-500">✦ {tr('helpHint.disclaimer')}</span>
          <br />
          <span className="text-gray-500">🌐 {tr('helpHint.langNote')}</span>
          <br />
          {/* B5：H 键与展馆模式说明（附录 A#4 快捷键表同步） */}
          <span className="text-gray-500">🖥 {tr('helpHint.kioskNote')}</span>
        </p>
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
