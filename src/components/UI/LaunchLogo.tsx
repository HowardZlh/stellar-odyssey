'use client';

import type { JSX } from 'react';
import { useState } from 'react';
import { useSimulationStore } from '@/store';

/**
 * 启动参数客户 logo（B4 §4.1-B，`?logo=<https URL>`，演示"定制感"）
 *
 * - URL 合法性（仅 https、长度 ≤2048）已由 launchParams 解析层保证；
 *   加载失败 onerror 即整体隐藏（静默降级，控制台零错误，§0.5#9 登记）；
 * - 占位避让登记（偏离建议位"右下信息面板上方"）：信息面板（bottom-4
 *   right-4，高度随条目数可变）无法可靠"上方"避让，改锚定右侧
 *   `right-4 top-64`——右上 HUD 状态（top-4）与性能监控（top-36）之下、
 *   右下信息面板可达高度之上，全 UI 状态无碰撞；
 * - B5 预留语义登记：kiosk 隐藏 UI 时 logo **保持显示**（展馆冠名场景），
 *   故不纳入 uiVisible 受控清单（§5.1 登记呼应）。
 */
export function LaunchLogo(): JSX.Element | null {
  const logo = useSimulationStore((s) => s.launch.logo);
  const [failed, setFailed] = useState(false);

  if (logo === null || failed) return null;

  return (
    // 原生 <img>（外部任意 https URL，无法走 next/image 静态优化；规则已全局关闭）
    <img
      src={logo}
      alt=""
      onError={() => setFailed(true)}
      className="pointer-events-none absolute right-4 top-64 h-10 max-w-[10rem] select-none object-contain opacity-90"
    />
  );
}
