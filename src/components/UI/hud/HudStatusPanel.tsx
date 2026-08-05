'use client';

import type { JSX } from 'react';
import { useState } from 'react';
import type { ViewLevel } from '@/types';
import type { MessageKey } from '@/i18n';
import { VIEW_LEVEL_NAME_KEYS, displayBodyName } from '@/i18n';
import { useLocale, useT, useTf } from '@/hooks/useI18n';
import { getBodyInfoById } from '@/data/catalog';
import { useSimulationStore } from '@/store';
import type { SimDateParts } from '@/utils/time';
import { ImmersiveToggle } from '@/components/UI/ImmersiveToggle';
import { HideUiButton } from '@/components/UI/UiVisibilityToggle';

/** 各层级运动参考系说明键（需求 3.1.3 参考系定义；B3 文案入字典） */
const REFERENCE_FRAME_KEYS: Record<ViewLevel, MessageKey> = {
  L1: 'hud.frameL1',
  L2: 'hud.frameL2',
  L3: 'hud.frameL3',
  L4: 'hud.frameL4',
};

export interface HudStatusPanelProps {
  simDate: SimDateParts;
  scaleText: string;
  galacticText: string;
}

/**
 * 右上 HUD 状态区（M3-2 自 HudInfo 机械拆分，桌面渲染结果不变）：
 * 当前视角/尺度标尺、参考系、模拟时间、银河年进度（L3）、速率钳制
 * 提示、跟随模式行、沉浸模式按钮。
 *
 * M3 移动布局（isCompact）：压缩为顶部单行状态条（视角层级 + 模拟
 * 时间 + 暂停按钮，44px 高触控行 + safe-area 顶部避让），tap ▾ 展开
 * 详情（尺度/参考系/银河年/钳制提示/跟随行/沉浸按钮缩入详情区）。
 */
export function HudStatusPanel({
  simDate,
  scaleText,
  galacticText,
}: HudStatusPanelProps): JSX.Element {
  const tr = useT();
  const trf = useTf();
  const locale = useLocale();
  const isCompact = useSimulationStore((s) => s.isCompact);
  const viewLevel = useSimulationStore((s) => s.viewLevel);
  const rateClampNotice = useSimulationStore((s) => s.rateClampNotice);
  // R2-3：行星淡出区间速率钳制提示（文案与卫星区分）
  const planetRateClampNotice = useSimulationStore((s) => s.planetRateClampNotice);
  const followBodyId = useSimulationStore((s) => s.followBodyId);
  const setFollowBody = useSimulationStore((s) => s.setFollowBody);
  const galacticFrameMode = useSimulationStore((s) => s.galacticFrameMode);
  const toggleGalacticFrameMode = useSimulationStore((s) => s.toggleGalacticFrameMode);
  const paused = useSimulationStore((s) => s.paused);
  const togglePaused = useSimulationStore((s) => s.togglePaused);
  // M3 移动版状态条详情展开态（桌面分支不消费）
  const [statusExpanded, setStatusExpanded] = useState(false);

  // 共用详情行（桌面常显；移动版收入展开详情区）——机械搬移自 HudInfo
  const frameLine = (
    <p className="mt-1 text-gray-500">
      {viewLevel === 'L3'
        ? tr(
            galacticFrameMode === 'galactic-center'
              ? 'hud.frameHudCenter'
              : 'hud.frameHudFollow',
          )
        : tr(REFERENCE_FRAME_KEYS[viewLevel])}
    </p>
  );
  const frameToggleLine = viewLevel === 'L3' && (
    <p className="mt-1">
      <button
        type="button"
        onClick={toggleGalacticFrameMode}
        className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] hover:bg-white/20 max-md:px-3 max-md:py-3 max-md:text-xs"
      >
        🌀{' '}
        {trf('hud.frameToggle', {
          mode: tr(
            galacticFrameMode === 'galactic-center'
              ? 'hud.frameModeCenter'
              : 'hud.frameModeFollow',
          ),
        })}
      </button>
    </p>
  );
  const clampLines = (
    <>
      {rateClampNotice && (
        <p className="mt-1 text-amber-300/90">⚠ {tr('hud.rateClampSatellite')}</p>
      )}
      {planetRateClampNotice && (
        <p className="mt-1 text-amber-300/90">⚠ {tr('hud.rateClampPlanet')}</p>
      )}
    </>
  );
  const followLine = followBodyId && (
    <p className="mt-1 text-cyan-300/90">
      🔒{' '}
      {trf('hud.followMode', {
        name: displayBodyName(locale, getBodyInfoById(followBodyId), followBodyId),
      })}
      <button
        type="button"
        onClick={() => setFollowBody(null)}
        className="ml-2 rounded bg-white/10 px-1.5 py-0.5 text-[10px] hover:bg-white/20 max-md:px-3 max-md:py-3 max-md:text-xs"
      >
        {tr('hud.followCancel')}
      </button>
    </p>
  );

  if (isCompact) {
    // M3-2 顶部单行状态条：层级 + 模拟时间 + 暂停，tap 展开详情
    return (
      <div className="absolute inset-x-0 top-0 bg-space-panel pt-safe-t text-sm backdrop-blur">
        <div className="flex h-11 items-center gap-2 px-1">
          <button
            type="button"
            onClick={togglePaused}
            aria-label={paused ? tr('controlPanel.resume') : tr('controlPanel.pause')}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded text-base text-gray-200"
          >
            {paused ? '▶' : '⏸'}
          </button>
          <p className="shrink-0 font-medium text-space-accent">
            {tr(VIEW_LEVEL_NAME_KEYS[viewLevel])}
          </p>
          <p className="min-w-0 flex-1 truncate text-right text-gray-300">{simDate.primary}</p>
          <button
            type="button"
            onClick={() => setStatusExpanded((v) => !v)}
            aria-expanded={statusExpanded}
            aria-label={tr(statusExpanded ? 'hud.statusCollapseAria' : 'hud.statusExpandAria')}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded text-gray-400"
          >
            {statusExpanded ? '▴' : '▾'}
          </button>
        </div>
        {statusExpanded && (
          <div className="border-t border-white/10 px-3 py-2 text-right text-xs">
            <p className="flex items-center justify-end gap-2">
              {/* M4-3：H 键触屏等价入口（仅 isTouch 渲染，组件内自持门控） */}
              <HideUiButton />
              <ImmersiveToggle />
            </p>
            {simDate.epoch && (
              <p className="mt-1 text-gray-500">{trf('hud.simEpoch', { value: simDate.epoch })}</p>
            )}
            <p className="mt-1 text-gray-300">{trf('hud.scale', { value: scaleText })}</p>
            {frameLine}
            {galacticText && <p className="mt-1 text-emerald-300/80">{galacticText}</p>}
            {frameToggleLine}
            {clampLines}
            {followLine}
          </div>
        )}
      </div>
    );
  }

  // 桌面分支：与拆分前 HudInfo 右上区逐字符一致
  return (
    <div className="absolute right-4 top-4 rounded-lg bg-space-panel px-4 py-3 text-right text-xs backdrop-blur">
      <div className="flex items-center justify-end gap-2">
        {/* M4-3：H 键触屏等价入口（仅 isTouch 渲染——触屏宽视口如 iPad
            桌面布局可达；桌面键鼠 isTouch=false 不渲染零变化） */}
        <HideUiButton />
        {/* 页面最大化（沉浸模式）按钮：收起/展开左侧面板与天体说明 */}
        <ImmersiveToggle />
        <p className="text-sm font-medium text-space-accent">
          {tr(VIEW_LEVEL_NAME_KEYS[viewLevel])}
        </p>
      </div>
      <p className="mt-1 text-gray-300">{trf('hud.simTime', { value: simDate.primary })}</p>
      {/* 大时间尺度专业历元副行（正常日期范围为 null 不渲染） */}
      {simDate.epoch && (
        <p className="mt-0.5 text-[10px] text-gray-500">
          {trf('hud.simEpoch', { value: simDate.epoch })}
        </p>
      )}
      <p className="mt-1 text-gray-300">{trf('hud.scale', { value: scaleText })}</p>
      {frameLine}
      {galacticText && <p className="mt-1 text-emerald-300/80">{galacticText}</p>}
      {frameToggleLine}
      {clampLines}
      {followLine}
    </div>
  );
}
