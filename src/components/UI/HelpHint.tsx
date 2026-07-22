'use client';

import { useState } from 'react';

/**
 * 首次进入操作引导（需求 3.5.3）
 */
export function HelpHint(): JSX.Element | null {
  const [visible, setVisible] = useState(true);

  if (!visible) return null;

  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-lg bg-space-panel px-5 py-3 text-xs text-gray-300 backdrop-blur">
      <div className="flex items-center gap-4">
        <p>
          🖱 拖动旋转 · 滚轮缩放 · 右键平移 &nbsp;|&nbsp; ⌨ 1-4 切换视角 · 空格暂停 · M 音效 · O
          轨道线 &nbsp;|&nbsp; 点击行星查看信息
        </p>
        <button
          type="button"
          onClick={() => setVisible(false)}
          className="shrink-0 text-gray-500 hover:text-white"
          aria-label="关闭引导"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
