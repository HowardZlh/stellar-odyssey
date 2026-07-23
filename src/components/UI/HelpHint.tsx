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
          🖱 拖动旋转 · 滚轮缩放 · 右键平移 &nbsp;|&nbsp; ⌨ 1-4 切换视角 · [ / ]
          行星视角切换天体 · 空格暂停 · M 音效 · O 轨道线 &nbsp;|&nbsp; 点击行星查看信息
          <br />
          <span className="text-gray-500">
            ✦ 恒星闪烁仅行星视角呈现（真空中恒星不闪烁，闪烁源于大气湍流，此为艺术化处理）；
            音效为艺术化设计（真空无声），行星环境音按各行星大气特征区分（水星/矮行星近真空几乎静音）；
            默认模式下矮行星尺寸经放大以保证可辨识，真实比例模式下过小不可见属科学事实
          </span>
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
