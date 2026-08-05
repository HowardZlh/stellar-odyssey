'use client';

import type { JSX } from 'react';
import { useEffect, useState } from 'react';
import { pickLocalized } from '@/i18n';
import { useLocale, useT, useTf } from '@/hooks/useI18n';
import {
  CME_GEOMAGNETIC_NOTE_EN,
  CME_GEOMAGNETIC_NOTE_ZH,
  FLARE_ENERGY_NOTE_EN,
  FLARE_ENERGY_NOTE_ZH,
} from '@/data/sunStructure';
import { useSimulationStore } from '@/store';
import { eventNoticeVisibleInScope } from '@/utils/eventScopes';
import {
  MERGER_FATE_NOTE_EN,
  MERGER_FATE_NOTE_ZH,
  MERGER_SOURCE_NOTE_EN,
  MERGER_SOURCE_NOTE_ZH,
} from '@/utils/galaxyMerger';
import { SN_REAL_FREQUENCY_NOTE_EN, SN_REAL_FREQUENCY_NOTE_ZH } from '@/utils/supernova';

export interface EventNoticeColumnProps {
  /** R2-11 合并演化卡片（HudInfo 低频循环计算，L4 且越过合并时刻时非 null） */
  mergerCard: { stageText: string; tauMyr: number } | null;
}

/**
 * 顶部事件通知列（M3-2 自 HudInfo 机械拆分，桌面渲染结果不变）：
 * G 键引导 toast / 合并演化卡片 / 超新星 / 耀斑 / CME / CME 抵达通知。
 *
 * M3 移动布局（isCompact）：整列下移避让顶部状态条（safe-area +
 * 状态条高 2.75rem + 间距）；卡内文案与按钮经 max-md: 断点放大
 * （text-xs→sm、[10px]→xs，操作按钮触控 ≥44pt）。
 */
export function EventNoticeColumn({ mergerCard }: EventNoticeColumnProps): JSX.Element {
  const tr = useT();
  const trf = useTf();
  const locale = useLocale();
  const isCompact = useSimulationStore((s) => s.isCompact);
  const viewLevel = useSimulationStore((s) => s.viewLevel);
  const selectBody = useSimulationStore((s) => s.selectBody);
  const requestFlyTo = useSimulationStore((s) => s.requestFlyTo);
  const activeSupernova = useSimulationStore((s) => s.activeSupernova);
  const supernovaNoticeVisible = useSimulationStore((s) => s.supernovaNoticeVisible);
  const dismissSupernovaNotice = useSimulationStore((s) => s.dismissSupernovaNotice);
  const toggleGalacticFrameMode = useSimulationStore((s) => s.toggleGalacticFrameMode);
  // R2-6 §6.1：G 键银心固定模式可发现性——首次切入 L3 一次性 toast 引导
  const galacticFrameTipVisible = useSimulationStore((s) => s.galacticFrameTipVisible);
  const showGalacticFrameTipOnce = useSimulationStore((s) => s.showGalacticFrameTipOnce);
  const dismissGalacticFrameTip = useSimulationStore((s) => s.dismissGalacticFrameTip);
  // S2 太阳活动事件（§4.3 通知 + §4.5 信息面板扩展）
  const solarFlareNoticeVisible = useSimulationStore((s) => s.solarFlareNoticeVisible);
  // 通知卡片渲染用快照（非 activeSolarFlare/activeCme）：事件先于最短
  // 展示时长（EVENT_NOTICE_MIN_VISIBLE_REAL_SEC）完成时通知驻留，
  // 快照保证事件置空后卡片信息仍可渲染
  const solarFlareNoticeInfo = useSimulationStore((s) => s.solarFlareNoticeInfo);
  const dismissSolarFlareNotice = useSimulationStore((s) => s.dismissSolarFlareNotice);
  const cmeNoticeVisible = useSimulationStore((s) => s.cmeNoticeVisible);
  const cmeNoticeInfo = useSimulationStore((s) => s.cmeNoticeInfo);
  const dismissCmeNotice = useSimulationStore((s) => s.dismissCmeNotice);
  const cmeArrivalNoticeVisible = useSimulationStore((s) => s.cmeArrivalNoticeVisible);
  const dismissCmeArrivalNotice = useSimulationStore((s) => s.dismissCmeArrivalNotice);
  // R2-4 §4.1-B：事件通知按视角域过滤（选布尔值，仅域边界跨越时重渲染；
  // 耀斑/CME/CME 抵达同属太阳系域，共用一个判定）。R5-8：判定源改离散
  // viewLevel——跟随巡游天体期间与 HUD 视角标签一致，不随相机距离漂移
  const solarNoticeInScope = useSimulationStore((s) =>
    eventNoticeVisibleInScope('flare', s.viewLevel),
  );
  const supernovaNoticeInScope = useSimulationStore((s) =>
    eventNoticeVisibleInScope('supernova', s.viewLevel),
  );
  // 合并演化卡片手动关闭态（卡片消失即复位——纯模拟时间驱动语义保持）
  const [mergerCardDismissed, setMergerCardDismissed] = useState(false);
  useEffect(() => {
    if (mergerCard === null) setMergerCardDismissed(false);
  }, [mergerCard]);

  // R2-6 §6.1：首次进入 L3（锚点切换或连续缩放均更新 viewLevel）触发
  // 一次性 G 键引导；12 秒未操作自动收起
  useEffect(() => {
    if (viewLevel === 'L3') {
      showGalacticFrameTipOnce();
    }
  }, [viewLevel, showGalacticFrameTipOnce]);
  useEffect(() => {
    if (!galacticFrameTipVisible) return undefined;
    const id = setTimeout(dismissGalacticFrameTip, 12000);
    return () => clearTimeout(id);
  }, [galacticFrameTipVisible, dismissGalacticFrameTip]);

  return (
    /* 事件通知列（超新星/耀斑/CME，需求 3.1.5 与 S2 §4.3）；
       M1-3 溢出热修：小屏收窄为视口宽减 2rem，桌面维持 24rem 上限；
       M3：isCompact 下移避让顶部状态条 */
    <div
      className={`absolute left-1/2 flex w-[calc(100vw-2rem)] max-w-96 -translate-x-1/2 flex-col gap-2 ${
        isCompact ? 'top-[calc(env(safe-area-inset-top)+3.25rem)]' : 'top-4'
      }`}
    >
      {/* R2-6 §6.1：首次切入 L3 的一次性 G 键引导 toast（12 秒自动收起） */}
      {galacticFrameTipVisible && viewLevel === 'L3' && (
        <div className="rounded-lg border border-emerald-400/40 bg-space-panel p-3 text-xs backdrop-blur max-md:text-sm">
          <div className="flex items-center justify-between gap-2">
            <p className="text-gray-200">
              💡 {tr('hud.gTipPrefix')}{' '}
              <span className="font-semibold text-emerald-300">G</span>{' '}
              {tr('hud.gTipMiddle')}
              <span className="text-emerald-300">{tr('hud.gTipHighlight')}</span>
              {tr('hud.gTipSuffix')}
            </p>
            <button
              type="button"
              onClick={dismissGalacticFrameTip}
              className="shrink-0 text-gray-400 hover:text-white max-md:-my-2.5 max-md:-mx-1.5 max-md:flex max-md:h-11 max-md:w-11 max-md:shrink-0 max-md:items-center max-md:justify-center"
              aria-label={tr('hud.gTipCloseAria')}
            >
              ✕
            </button>
          </div>
          <button
            type="button"
            onClick={toggleGalacticFrameMode}
            className="mt-2 rounded bg-emerald-400/90 px-2 py-1 text-black hover:bg-emerald-300 max-md:px-3 max-md:py-3"
          >
            🌀 {tr('hud.gTipNow')}
          </button>
        </div>
      )}
      {/* R2-11：银河系—仙女座合并演化科普卡片（L4 且越过合并时刻；
          阶段标签随模拟时间推进更新，时间回退自动消失） */}
      {mergerCard && !mergerCardDismissed && (
        <div className="rounded-lg border border-sky-400/40 bg-space-panel p-3 text-xs backdrop-blur max-md:text-sm">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-sky-300 max-md:text-base">
              🌌 {tr('hud.mergerTitle')}
            </p>
            <button
              type="button"
              onClick={() => setMergerCardDismissed(true)}
              className="text-gray-400 hover:text-white max-md:-my-2.5 max-md:-mx-1.5 max-md:flex max-md:h-11 max-md:w-11 max-md:shrink-0 max-md:items-center max-md:justify-center"
              aria-label={tr('hud.mergerCloseAria')}
            >
              ✕
            </button>
          </div>
          {/* i18n：合并阶段名与科学注记按 locale 取用（*_EN 常量族） */}
          <p className="mt-1 text-gray-200">
            {mergerCard.stageText}
            {trf('hud.mergerTau', {
              yi: (mergerCard.tauMyr / 100).toFixed(1),
              myr: Math.round(mergerCard.tauMyr),
            })}
          </p>
          <p className="mt-1 leading-4 text-gray-300 max-md:leading-5">
            {pickLocalized(locale, MERGER_FATE_NOTE_ZH, MERGER_FATE_NOTE_EN)}
          </p>
          <p className="mt-1 text-[10px] text-gray-500 max-md:text-xs">
            {pickLocalized(locale, MERGER_SOURCE_NOTE_ZH, MERGER_SOURCE_NOTE_EN)}
          </p>
        </div>
      )}

      {/* 超新星爆发事件通知（需求 3.1.5：UI 提示 + "飞往观看"按钮；
          R2-4 §4.1-B：仅超新星视角域（L3/L4，≥2.5）内显示，域外折叠为
          一行小字提醒——通知标志位不改动，回域内且事件仍活跃时恢复 */}
      {supernovaNoticeInScope && supernovaNoticeVisible && activeSupernova && (
        <div className="rounded-lg border border-amber-400/40 bg-space-panel p-3 text-xs backdrop-blur max-md:text-sm">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-amber-300 max-md:text-base">
              💥 {tr('hud.snTitle')}
            </p>
            <button
              type="button"
              onClick={dismissSupernovaNotice}
              className="text-gray-400 hover:text-white max-md:-my-2.5 max-md:-mx-1.5 max-md:flex max-md:h-11 max-md:w-11 max-md:shrink-0 max-md:items-center max-md:justify-center"
              aria-label={tr('hud.snCloseAria')}
            >
              ✕
            </button>
          </div>
          <p className="mt-1 text-gray-300">
            {trf('hud.snBody', { mass: activeSupernova.progenitorMassSun.toFixed(0) })}
          </p>
          {/* i18n：科学注记按 locale 取用 */}
          <p className="mt-1 text-[10px] text-gray-500 max-md:text-xs">
            {pickLocalized(locale, SN_REAL_FREQUENCY_NOTE_ZH, SN_REAL_FREQUENCY_NOTE_EN)}
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => {
                requestFlyTo(activeSupernova.id);
                dismissSupernovaNotice();
              }}
              className="rounded bg-amber-400/90 px-2 py-1 text-black hover:bg-amber-300 max-md:px-3 max-md:py-3"
            >
              🚀 {tr('hud.flyBtn')}
            </button>
            <button
              type="button"
              onClick={() => {
                selectBody(activeSupernova.id);
              }}
              className="rounded bg-white/10 px-2 py-1 hover:bg-white/20 max-md:px-3 max-md:py-3"
            >
              {tr('hud.detailBtn')}
            </button>
          </div>
        </div>
      )}

      {/* 太阳耀斑事件通知（S2 §4.3-2：级别 + "飞往观看"；
          R2-4 §4.1-B：仅太阳系视角域（L1/L2，≤2.4）内显示；
          渲染用快照——事件先于最短展示时长完成时通知驻留到
          EVENT_NOTICE_MIN_VISIBLE_REAL_SEC 再自动收起 */}
      {solarNoticeInScope && solarFlareNoticeVisible && solarFlareNoticeInfo && (
        <div className="rounded-lg border border-orange-400/40 bg-space-panel p-3 text-xs backdrop-blur max-md:text-sm">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-orange-300 max-md:text-base">
              ☀️{' '}
              {trf('hud.flareTitle', {
                cls: solarFlareNoticeInfo.flareClass,
                mag: solarFlareNoticeInfo.magnitude.toFixed(1),
              })}
            </p>
            <button
              type="button"
              onClick={dismissSolarFlareNotice}
              className="text-gray-400 hover:text-white max-md:-my-2.5 max-md:-mx-1.5 max-md:flex max-md:h-11 max-md:w-11 max-md:shrink-0 max-md:items-center max-md:justify-center"
              aria-label={tr('hud.flareCloseAria')}
            >
              ✕
            </button>
          </div>
          <p className="mt-1 text-gray-300">
            {tr('hud.flareBody')}
            {solarFlareNoticeInfo.cmeLinked && tr('hud.flareCmeLinked')}
          </p>
          {/* i18n：科学注记按 locale 取用 */}
          <p className="mt-1 text-[10px] text-gray-500 max-md:text-xs">
            {pickLocalized(locale, FLARE_ENERGY_NOTE_ZH, FLARE_ENERGY_NOTE_EN)}
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => {
                requestFlyTo('sun');
                dismissSolarFlareNotice();
              }}
              className="rounded bg-orange-400/90 px-2 py-1 text-black hover:bg-orange-300 max-md:px-3 max-md:py-3"
            >
              🚀 {tr('hud.flyBtn')}
            </button>
            <button
              type="button"
              onClick={() => {
                selectBody('sun');
              }}
              className="rounded bg-white/10 px-2 py-1 hover:bg-white/20 max-md:px-3 max-md:py-3"
            >
              {tr('hud.detailBtn')}
            </button>
          </div>
        </div>
      )}

      {/* CME 事件通知（S2 §4.3-3：朝地球时附加地磁暴科普；
          R2-4 §4.1-B：仅太阳系视角域（L1/L2，≤2.4）内显示；
          渲染用快照，语义同耀斑通知 */}
      {solarNoticeInScope && cmeNoticeVisible && cmeNoticeInfo && (
        <div className="rounded-lg border border-rose-400/40 bg-space-panel p-3 text-xs backdrop-blur max-md:text-sm">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-rose-300 max-md:text-base">
              🌊 {trf('hud.cmeTitle', { speed: Math.round(cmeNoticeInfo.speedKmS) })}
            </p>
            <button
              type="button"
              onClick={dismissCmeNotice}
              className="text-gray-400 hover:text-white max-md:-my-2.5 max-md:-mx-1.5 max-md:flex max-md:h-11 max-md:w-11 max-md:shrink-0 max-md:items-center max-md:justify-center"
              aria-label={tr('hud.cmeCloseAria')}
            >
              ✕
            </button>
          </div>
          <p className="mt-1 text-gray-300">
            {tr('hud.cmeBody')}
            {cmeNoticeInfo.earthDirected && tr('hud.cmeEarthDirected')}
          </p>
          {/* i18n：科学注记按 locale 取用 */}
          {cmeNoticeInfo.earthDirected && (
            <p className="mt-1 text-[10px] text-amber-300/90 max-md:text-xs">
              ⚠ {pickLocalized(locale, CME_GEOMAGNETIC_NOTE_ZH, CME_GEOMAGNETIC_NOTE_EN)}
            </p>
          )}
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => {
                requestFlyTo('sun');
                dismissCmeNotice();
              }}
              className="rounded bg-rose-400/90 px-2 py-1 text-black hover:bg-rose-300 max-md:px-3 max-md:py-3"
            >
              🚀 {tr('hud.flyBtn')}
            </button>
          </div>
        </div>
      )}
      {/* S3 §4.3-3：CME 抵达地球通知（极区极光增强示意；
          R2-4 §4.1-B：仅太阳系视角域（L1/L2，≤2.4）内显示 */}
      {solarNoticeInScope && cmeArrivalNoticeVisible && (
        <div className="rounded-lg border border-emerald-400/40 bg-space-panel p-3 text-xs backdrop-blur max-md:text-sm">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-emerald-300 max-md:text-base">
              🌌 {tr('hud.cmeArrivalTitle')}
            </p>
            <button
              type="button"
              onClick={dismissCmeArrivalNotice}
              className="text-gray-400 hover:text-white max-md:-my-2.5 max-md:-mx-1.5 max-md:flex max-md:h-11 max-md:w-11 max-md:shrink-0 max-md:items-center max-md:justify-center"
              aria-label={tr('hud.cmeArrivalCloseAria')}
            >
              ✕
            </button>
          </div>
          <p className="mt-1 text-gray-300">{tr('hud.cmeArrivalBody')}</p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => {
                requestFlyTo('earth');
                dismissCmeArrivalNotice();
              }}
              className="rounded bg-emerald-400/90 px-2 py-1 text-black hover:bg-emerald-300 max-md:px-3 max-md:py-3"
            >
              🚀 {tr('hud.flyEarthBtn')}
            </button>
          </div>
        </div>
      )}

      {/* R3-3 硬隔离：域外零事件 UI——R2-4 方案 b"域外折叠一行小字提醒"
          已废止（域外活跃事件由 store.tick 在 1 秒宽限期后直接丢弃，
          高时间压缩比下不再频繁闪现），登记于 IMPROVEMENT_REQUIREMENTS_3 §3.1-C */}
    </div>
  );
}
