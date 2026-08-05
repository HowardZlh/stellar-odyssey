'use client';

import type { JSX } from 'react';
import { ContactBadge } from '@/components/UI/ContactBadge';
import { ControlPanel } from '@/components/UI/ControlPanel';
import { SunLayerCard } from '@/components/UI/hud/SunLayerCard';
import { useSimulationStore } from '@/store';

/**
 * 左侧列容器（左下角布局收口）：桌面把左侧三组件纳入同一 flex 列，
 * 由布局引擎保证互不重叠——取代原「事件通知/剖面卡出现时 ContactBadge
 * 避让隐藏」的临时方案（补丁式两两避让逻辑全部删除，登记见
 * ContactBadge 文件头）。
 *
 * 列序（自上而下）与收缩优先级：
 * 1. ControlPanel——min-h-0 可收缩，竖向空间不足时最先让步（内容区
 *    overflow-y-auto 内部滚动，见 DesktopControlPanel）；
 * 2. 弹性空隙 flex-1——空间富余时把下方组件推到列底（保持原
 *    bottom-4 left-4 视觉位置），空间不足时收缩至 0；
 * 3. SunLayerCard——shrink-0 + max-h 封顶，超高时内部滚动；
 * 4. ContactBadge——列 footer 常驻，shrink-0 永不压缩。
 *
 * 交互与显隐边界：
 * - 容器 pointer-events-none、子项各自 pointer-events-auto——空隙区
 *   不拦截 3D 场景交互（canvas 拖拽/滚轮/点选照常）；
 * - 「常驻可见」边界保持：uiVisible=false（H 键/展馆模式）经
 *   SolarSystemApp 顶层包裹整体隐藏；模态弹层（帮助/移动弹层
 *   z-30+）正常覆盖本列（本列不抬 z-index，停留基础 HUD 层）。
 *
 * isCompact 移动布局：三组件各自维持既有移动形态（底部抽屉/底部卡/
 * 居中弹层，均为 fixed 定位自管布局），不套列容器——移动端零变化。
 */
export function LeftColumn(): JSX.Element {
  const isCompact = useSimulationStore((s) => s.isCompact);

  if (isCompact) {
    return (
      <>
        <ControlPanel />
        <SunLayerCard />
        <ContactBadge />
      </>
    );
  }

  return (
    <div className="pointer-events-none absolute bottom-4 left-4 top-4 flex flex-col items-start gap-2">
      <ControlPanel />
      {/* 弹性空隙：占位不拦截交互（继承 pointer-events-none） */}
      <div aria-hidden className="min-h-0 flex-1" />
      <SunLayerCard />
      <ContactBadge />
    </div>
  );
}
