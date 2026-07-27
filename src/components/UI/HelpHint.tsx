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
          巡游上一个/下一个天体（按视角域：行星系统/太阳系/银河系/宇宙序列）· G
          银心固定视角（银河系视角下俯瞰太阳系沿波浪轨道绕银心公转，再按返回跟随太阳系）· V
          垂直展开（银河系视角特殊天体垂直高度按增益展开，含高度指示线）·
          空格暂停 · M 音效 · O 轨道线 &nbsp;|&nbsp; 点击行星查看信息
          <br />
          <span className="text-gray-500">
            ✦ 恒星闪烁仅行星视角呈现（真空中恒星不闪烁，闪烁源于大气湍流，此为艺术化处理）；
            音效为艺术化设计（真空无声），行星环境音按各行星大气特征区分（水星/矮行星近真空几乎静音）；
            默认模式下矮行星与人造卫星尺寸经放大以保证可辨识，真实比例模式下过小不可见属科学事实；
            银河系视角下太阳垂直振荡的波浪起伏经 ×10 视觉放大（真实振幅仅 ±300 光年，真实比例模式不放大）；
            特殊天体高度方向按真实银纬（SIMBAD）推算、水平距离为示意，垂直展开（V）为观察辅助的视觉夸大（指示线标注为未放大的推算高度）；
            太阳观察：飞往太阳近观可见米粒组织/黑子/日珥，选中太阳可开启内部剖面——
            黑子/日珥尺寸与活动频率经演示化放大、耀斑时长减速呈现（均已登记），色球厚度夸大至 +1.5%；
            宇宙视角：卫星星系沿细线轨道运动（轨道线随 O 开关），麦哲伦星流/人马座潮汐流为
            历史路径上剥离的气体与恒星（弥散粒子带，非轨道线），宇宙网除哈勃膨胀缩放外静止属预期
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
