'use client';

import type { JSX } from 'react';
import { useRef, useState } from 'react';
import { localizeCatalogText } from '@/i18n';
import { useLocale, useT, useTf } from '@/hooks/useI18n';
import { getBodyInfoById } from '@/data/catalog';
import { useSimulationStore } from '@/store';
import { scopeCyclePositionLabel } from '@/utils/cycleScopes';
import { sunActivityStatusLines } from '@/utils/solarActivity';

/** M3：移动版底部半屏卡下滑关闭的触发位移阈值（px） */
export const INFO_SHEET_SWIPE_CLOSE_PX = 60;

export interface BodyInfoPanelProps {
  /** S3 §4.4：太阳活动周期状态行（HudInfo 低频循环计算） */
  cycleLine: { label: string; value: string } | null;
}

/**
 * 选中天体信息面板（M3-2 自 HudInfo 机械拆分，桌面渲染结果不变）：
 * 统一目录值行 + 太阳活动扩展行 + 飞往/跟随/序列切换操作区。
 *
 * M3 移动布局（isCompact）：右下悬浮卡改为底部半屏卡片
 * （inset-x-0 bottom-0 上方 max-h-[50dvh]，标签栏上方通栏），顶部
 * 拖拽把手支持下滑关闭（位移 > INFO_SHEET_SWIPE_CLOSE_PX 即关闭）；
 * 底部卡区互斥——太阳特征卡/剖面分层卡可见时本面板让位隐藏。
 * 收起态（infoCollapsed）跨天体切换保持：组件常驻，内部提前返回。
 */
export function BodyInfoPanel({ cycleLine }: BodyInfoPanelProps): JSX.Element | null {
  const tr = useT();
  const trf = useTf();
  const locale = useLocale();
  const isCompact = useSimulationStore((s) => s.isCompact);
  const selectedBodyId = useSimulationStore((s) => s.selectedBodyId);
  const selectBody = useSimulationStore((s) => s.selectBody);
  const followBodyId = useSimulationStore((s) => s.followBodyId);
  const setFollowBody = useSimulationStore((s) => s.setFollowBody);
  const requestFlyTo = useSimulationStore((s) => s.requestFlyTo);
  const activeSolarFlare = useSimulationStore((s) => s.activeSolarFlare);
  const activeCme = useSimulationStore((s) => s.activeCme);
  const sunCutawayMode = useSimulationStore((s) => s.sunCutawayMode);
  const setSunCutawayMode = useSimulationStore((s) => s.setSunCutawayMode);
  const sunCutawayLayer = useSimulationStore((s) => s.sunCutawayLayer);
  const selectedSolarFeature = useSimulationStore((s) => s.selectedSolarFeature);
  // R2-5 §5.1-B：选中天体属于当前视角域序列时补"上一个/下一个"快捷入口
  // （与底部 BodyCycleSwitcher 行为一致，按域路由；R3 改为显式巡游域状态）
  const cycleScope = useSimulationStore((s) => s.cycleScope);
  const cycleScopeBody = useSimulationStore((s) => s.cycleScopeBody);
  // 信息面板收起态：收起后仅保留标题栏与底部操作按钮区；
  // 状态跨天体切换保持（组件常驻，选中变化不重置）
  const [infoCollapsed, setInfoCollapsed] = useState(false);
  // M3：下滑关闭手势起点（仅移动版把手/标题区响应）
  const touchStartYRef = useRef<number | null>(null);

  // i18n：信息面板值行按 locale 取目录（zh/en 各一份懒加载缓存）
  const selected = selectedBodyId ? getBodyInfoById(selectedBodyId, locale) : undefined;
  if (!selected) return null;
  // M3 底部卡区互斥：compact 下特征卡/剖面卡占用底部插槽时本面板让位
  if (isCompact && (selectedSolarFeature || (sunCutawayMode && sunCutawayLayer !== null))) {
    return null;
  }

  const handleTouchStart = (e: React.TouchEvent): void => {
    touchStartYRef.current = e.touches[0]?.clientY ?? null;
  };
  const handleTouchEnd = (e: React.TouchEvent): void => {
    const startY = touchStartYRef.current;
    touchStartYRef.current = null;
    const endY = e.changedTouches[0]?.clientY;
    if (startY !== null && endY !== undefined && endY - startY > INFO_SHEET_SWIPE_CLOSE_PX) {
      selectBody(null);
    }
  };

  return (
    <div
      className={
        isCompact
          ? 'fixed inset-x-0 bottom-[calc(3rem+env(safe-area-inset-bottom))] z-10 flex max-h-[50dvh] select-text flex-col rounded-t-lg bg-space-panel p-4 pt-1 text-sm backdrop-blur'
          : 'absolute bottom-4 right-4 flex max-h-[70vh] w-72 select-text flex-col rounded-lg bg-space-panel p-4 text-xs backdrop-blur'
      }
    >
      {/* M3：移动版顶部拖拽把手（下滑关闭；py-5 + 把手条 = 44px 触控区） */}
      {isCompact && (
        <div
          className="-mx-4 flex justify-center py-5"
          role="button"
          aria-label={tr('hud.sheetDragAria')}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          <div className="h-1 w-10 rounded-full bg-white/30" />
        </div>
      )}
      <div
        className="mb-2 flex items-center justify-between"
        onTouchStart={isCompact ? handleTouchStart : undefined}
        onTouchEnd={isCompact ? handleTouchEnd : undefined}
      >
        {/* 标题：zh 中英并列、en 仅英文（hud.bodyTitle + displayBodyName 口径） */}
        <h3 className="text-sm font-semibold text-space-accent max-md:text-base">
          {trf('hud.bodyTitle', { nameZh: selected.nameZh, nameEn: selected.name })}
        </h3>
        <span className="flex shrink-0 items-center gap-2 max-md:gap-4">
          {/* 收起/展开：仅折叠中间信息列表，标题栏与操作按钮区常驻 */}
          <button
            type="button"
            onClick={() => setInfoCollapsed(!infoCollapsed)}
            className="text-gray-400 hover:text-white max-md:-my-2.5 max-md:-mx-1.5 max-md:flex max-md:h-11 max-md:w-11 max-md:shrink-0 max-md:items-center max-md:justify-center"
            aria-expanded={!infoCollapsed}
            aria-label={tr(infoCollapsed ? 'hud.infoExpandAria' : 'hud.infoCollapseAria')}
          >
            {infoCollapsed ? '▸' : '▾'}
          </button>
          <button
            type="button"
            onClick={() => selectBody(null)}
            className="text-gray-400 hover:text-white max-md:-my-2.5 max-md:-mx-1.5 max-md:flex max-md:h-11 max-md:w-11 max-md:shrink-0 max-md:items-center max-md:justify-center"
            aria-label={tr('hud.infoCloseAria')}
          >
            ✕
          </button>
        </span>
      </div>
      {/* 中间信息区：grid-rows 过渡实现平滑收起；展开时超高（>70vh
          扣除固定区）出现细窄滚动条（hud-scroll，globals.css） */}
      <div
        className={`grid min-h-0 transition-[grid-template-rows] duration-300 ${
          infoCollapsed ? 'grid-rows-[0fr]' : 'grid-rows-[1fr]'
        }`}
      >
        <div
          className={`hud-scroll min-h-0 ${
            infoCollapsed ? 'overflow-hidden' : 'overflow-y-auto overscroll-contain pr-1'
          }`}
        >
          {/* 类型行/标签列经 catalogText 直映射；值行留中文（B3 豁免登记） */}
          <p className="mb-2 text-[11px] text-gray-400 max-md:text-sm">
            {localizeCatalogText(locale, selected.typeZh)}
          </p>
          <dl className="space-y-1 text-gray-300">
            {selected.lines.map((line, index) => (
              // key 含序号：不同来源行可能同 label（防 React 同 key 复用串卡）
              <div key={`${index}-${line.label}`} className="flex justify-between gap-2">
                <dt className="shrink-0">{localizeCatalogText(locale, line.label)}</dt>
                <dd className="text-right">{line.value}</dd>
              </div>
            ))}
            {/* S3 §4.4：太阳活动周期状态行（第 N 周期 · 相位名 · 黑子相对数） */}
            {selected.id === 'sun' && cycleLine && (
              <div key={cycleLine.label} className="flex justify-between gap-2">
                <dt className="shrink-0 text-amber-300/90">
                  {localizeCatalogText(locale, cycleLine.label)}
                </dt>
                <dd className="text-right text-amber-200/90">{cycleLine.value}</dd>
              </div>
            )}
            {/* S2 §4.5：太阳当前活动事件行（耀斑级别/CME 速度/平静） */}
            {selected.id === 'sun' &&
              sunActivityStatusLines(
                activeSolarFlare
                  ? { class: activeSolarFlare.flareClass, magnitude: activeSolarFlare.magnitude }
                  : null,
                activeCme
                  ? { speedKmS: activeCme.speedKmS, earthDirected: activeCme.earthDirected }
                  : null,
                locale,
              ).map((line) => (
                <div key={line.label} className="flex justify-between gap-2">
                  <dt className="shrink-0 text-orange-300/90">
                    {localizeCatalogText(locale, line.label)}
                  </dt>
                  <dd className="text-right text-orange-200/90">{line.value}</dd>
                </div>
              ))}
          </dl>
          {/* S2 §4.1：剖面模式入口（信息面板侧） */}
          {selected.id === 'sun' && (
            <button
              type="button"
              onClick={() => setSunCutawayMode(!sunCutawayMode)}
              className={`mt-2 w-full rounded px-2 py-1 text-[11px] max-md:py-3 max-md:text-sm ${
                sunCutawayMode
                  ? 'bg-orange-400/90 text-black hover:bg-orange-300'
                  : 'bg-white/10 hover:bg-white/20'
              }`}
            >
              🔬 {sunCutawayMode ? tr('hud.cutawayOn') : tr('hud.cutawayOff')}
            </button>
          )}
        </div>
      </div>
      {/* 飞往 / 跟随（需求 3.2.3：点选后可飞往，可锁定任意天体跟随） */}
      <div className="mt-2 flex gap-2 border-t border-white/10 pt-2">
        <button
          type="button"
          onClick={() => requestFlyTo(selected.id)}
          className="rounded bg-space-accent/90 px-2 py-1 text-[11px] text-black hover:bg-space-accent max-md:px-3 max-md:py-3 max-md:text-sm"
        >
          🚀 {tr('hud.flyShort')}
        </button>
        <button
          type="button"
          onClick={() => setFollowBody(followBodyId === selected.id ? null : selected.id)}
          className={`rounded px-2 py-1 text-[11px] max-md:px-3 max-md:py-3 max-md:text-sm ${
            followBodyId === selected.id
              ? 'bg-cyan-400/90 text-black hover:bg-cyan-300'
              : 'bg-white/10 hover:bg-white/20'
          }`}
        >
          {followBodyId === selected.id
            ? `🔓 ${tr('hud.unfollow')}`
            : `🔒 ${tr('hud.follow')}`}
        </button>
        {/* R2-5 §5.1-B：域序列内天体补"上一个/下一个"快捷入口
            （与底部切换控件行为一致，按域路由，快捷键 [ / ]；
            R3：单成员系统（无卫星行星）position 为 null 时隐藏） */}
        {scopeCyclePositionLabel(cycleScope, selected.id) !== null && (
          <span className="ml-auto flex items-center gap-1">
            <button
              type="button"
              onClick={() => cycleScopeBody(-1)}
              className="rounded bg-white/10 px-2 py-1 text-[11px] hover:bg-white/20 max-md:px-4 max-md:py-3 max-md:text-sm"
              aria-label={tr('hud.prevAria')}
              title={tr('hud.prevTitle')}
            >
              ←
            </button>
            <span className="text-[10px] text-gray-400 max-md:text-xs">
              {scopeCyclePositionLabel(cycleScope, selected.id)}
            </span>
            <button
              type="button"
              onClick={() => cycleScopeBody(1)}
              className="rounded bg-white/10 px-2 py-1 text-[11px] hover:bg-white/20 max-md:px-4 max-md:py-3 max-md:text-sm"
              aria-label={tr('hud.nextAria')}
              title={tr('hud.nextTitle')}
            >
              →
            </button>
          </span>
        )}
      </div>
      {/* i18n：dataSource 随 en 目录本地化（含中文的署名已补英文版）；
          收起态随信息列表一并隐藏，仅保留标题栏与操作按钮区 */}
      {!infoCollapsed && (
        <p className="mt-2 border-t border-white/10 pt-2 text-[10px] text-gray-500 max-md:text-xs">
          {trf('hud.dataSource', { value: selected.dataSource })}
        </p>
      )}
    </div>
  );
}
