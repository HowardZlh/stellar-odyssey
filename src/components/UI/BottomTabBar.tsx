'use client';

import type { JSX } from 'react';
import { useT } from '@/hooks/useI18n';
import { useSimulationStore } from '@/store';
import { useCycleCurrentBody } from '@/components/UI/BodyCycleSwitcher';
import { MainShareMomentButton } from '@/components/UI/ShareMomentButton';

/**
 * 移动布局底部标签栏（M3-3，仅 isCompact 渲染）：
 * `[? 帮助] [← 巡游 →] [☰ 控制] [♥ 投喂]`——HelpHint / BodyCycleSwitcher /
 * ContactBadge / 控制抽屉把手四个入口合并为一条通栏，整栏
 * pb-safe-b（Home Indicator 避让）。
 *
 * - 帮助/控制/投喂三钮切换 store.mobilePanel（单值互斥——同时至多一个
 *   面板打开）；对应弹层分别由 HelpHint（居中弹层）/ ControlPanel
 *   （底部抽屉）/ ContactBadge（居中弹层）自行渲染；
 * - 巡游区与桌面 BodyCycleSwitcher 同源（useCycleCurrentBody +
 *   cycleScopeBody），单成员序列（position 为 null）时箭头隐藏；
 * - 全部按钮高度 h-12（48px ≥ 44pt 触控目标）；
 * - 桌面（isCompact=false）不渲染，桌面布局零变化。
 */
export function BottomTabBar(): JSX.Element | null {
  const tr = useT();
  const isCompact = useSimulationStore((s) => s.isCompact);
  const mobilePanel = useSimulationStore((s) => s.mobilePanel);
  const toggleMobilePanel = useSimulationStore((s) => s.toggleMobilePanel);
  const cycleScopeBody = useSimulationStore((s) => s.cycleScopeBody);
  const { name, position, cycleEnabled } = useCycleCurrentBody();

  if (!isCompact) return null;

  const tabClass = (active: boolean): string =>
    `flex h-12 min-w-11 flex-col items-center justify-center gap-0.5 px-2 text-[10px] leading-none transition-colors ${
      active ? 'text-space-accent' : 'text-gray-400'
    }`;

  return (
    <div className="fixed inset-x-0 bottom-0 z-20 select-none border-t border-white/10 bg-space-panel pb-safe-b backdrop-blur">
      <div className="flex items-stretch">
        <button
          type="button"
          onClick={() => toggleMobilePanel('help')}
          aria-pressed={mobilePanel === 'help'}
          aria-label={tr('tabBar.helpAria')}
          className={tabClass(mobilePanel === 'help')}
        >
          <span className="text-base">?</span>
          {tr('tabBar.help')}
        </button>
        {/* 巡游区：← 当前天体名 →（与桌面 BodyCycleSwitcher 同源序列） */}
        {cycleEnabled && (
          <button
            type="button"
            onClick={() => cycleScopeBody(-1)}
            aria-label={tr('bodyCycle.prevAria')}
            className="flex h-12 w-11 shrink-0 items-center justify-center text-base text-gray-300"
          >
            ←
          </button>
        )}
        <div className="flex h-12 min-w-0 flex-1 flex-col items-center justify-center px-1 text-center">
          <span className="w-full truncate text-sm text-space-accent">{name}</span>
          {position && <span className="text-[10px] leading-none text-gray-400">{position}</span>}
        </div>
        {cycleEnabled && (
          <button
            type="button"
            onClick={() => cycleScopeBody(1)}
            aria-label={tr('bodyCycle.nextAria')}
            className="flex h-12 w-11 shrink-0 items-center justify-center text-base text-gray-300"
          >
            →
          </button>
        )}
        <button
          type="button"
          onClick={() => toggleMobilePanel('controls')}
          aria-pressed={mobilePanel === 'controls'}
          aria-label={tr('tabBar.controlsAria')}
          className={tabClass(mobilePanel === 'controls')}
        >
          <span className="text-base">☰</span>
          {tr('tabBar.controls')}
        </button>
        <button
          type="button"
          onClick={() => toggleMobilePanel('contact')}
          aria-pressed={mobilePanel === 'contact'}
          aria-label={tr('tabBar.contactAria')}
          className={tabClass(mobilePanel === 'contact')}
        >
          <span className="text-base">♥</span>
          {tr('tabBar.contact')}
        </button>
        {/* G5 分享此刻（移动入口）：即时动作而非面板——不占 mobilePanel
            互斥值，单值互斥语义零改动（登记）；h-12 ≥44pt 触控目标 */}
        <MainShareMomentButton className={tabClass(false)}>
          <span className="text-base">🔗</span>
          {tr('share.tabLabel')}
        </MainShareMomentButton>
      </div>
    </div>
  );
}
