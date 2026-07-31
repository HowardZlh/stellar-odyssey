'use client';


import type { JSX } from 'react';
import { useState } from 'react';
import { useT } from '@/hooks/useI18n';

/**
 * 首次进入操作引导（需求 3.5.3）
 *
 * B3 i18n 打样件：全部文案（含科学性说明段）经字典查找双语化；
 * zh 字典条目为原 JSX 空白折叠结果的逐字符搬迁（中文态逐像素等价）；
 * 末行语言切换说明为 B3-D 新增（实现差异登记）。
 */
export function HelpHint(): JSX.Element | null {
  const [visible, setVisible] = useState(true);
  const tr = useT();

  if (!visible) return null;

  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-lg bg-space-panel px-5 py-3 text-xs text-gray-300 backdrop-blur">
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
