'use client';


import type { JSX } from 'react';
import { useEffect, useState } from 'react';
import type { ViewLevel } from '@/types';
import type { MessageKey } from '@/i18n';
import {
  VIEW_LEVEL_NAME_KEYS,
  displayBodyName,
  localizeCatalogText,
  pickLocalized,
  tf,
} from '@/i18n';
import { useLocale, useT, useTf } from '@/hooks/useI18n';
import { getBodyInfoById } from '@/data/catalog';
import {
  CME_GEOMAGNETIC_NOTE_EN,
  CME_GEOMAGNETIC_NOTE_ZH,
  FLARE_ENERGY_NOTE_EN,
  FLARE_ENERGY_NOTE_ZH,
  SUN_STRUCTURE_DATA_SOURCE,
  SUN_STRUCTURE_DATA_SOURCE_EN,
  getSunLayerById,
} from '@/data/sunStructure';
import { useSimulationStore } from '@/store';
import { scopeCyclePositionLabel } from '@/utils/cycleScopes';
import { eventNoticeVisibleInScope } from '@/utils/eventScopes';
import {
  MERGER_FATE_NOTE_EN,
  MERGER_FATE_NOTE_ZH,
  MERGER_SOURCE_NOTE_EN,
  MERGER_SOURCE_NOTE_ZH,
  mergerNotice,
} from '@/utils/galaxyMerger';
import { galacticYearProgress, sunGalacticPositionLy } from '@/utils/galaxy';
import { formatSceneScaleLabel } from '@/utils/scale';
import { sunActivityStatusLines } from '@/utils/solarActivity';
import { solarCycleState, solarCycleStatusLine } from '@/utils/solarCycle';
import { SN_REAL_FREQUENCY_NOTE_EN, SN_REAL_FREQUENCY_NOTE_ZH } from '@/utils/supernova';
import { formatSimDate } from '@/utils/time';

/** 各层级运动参考系说明键（需求 3.1.3 参考系定义；B3 文案入字典） */
const REFERENCE_FRAME_KEYS: Record<ViewLevel, MessageKey> = {
  L1: 'hud.frameL1',
  L2: 'hud.frameL2',
  L3: 'hud.frameL3',
  L4: 'hud.frameL4',
};

/**
 * HUD 信息（需求 3.5.2）：当前视角/尺度标尺、参考系、模拟时间、
 * 银河年进度（L3）、速率钳制提示、选中天体信息（统一目录）
 *
 * B3 i18n：壳层框架文案与事件通知（耀斑/CME/CME 抵达/超新星）经字典
 * 查找（hud.* 键组）。
 *
 * i18n 全站覆盖：科学注记常量（SN 频率/耀斑能量/地磁暴/合并结局与来源）
 * 经 `*_EN` 常量族 + pickLocalized 按 locale 取用；合并阶段名经
 * mergerNotice(locale)；信息面板值行经 getBodyInfoById(id, locale)
 * 双目录；黑子/日珥卡片与剖面分层经数据层 `*En` 字段；dataSource 署名
 * 同随 locale（含中文的署名补 `dataSourceEn`/`*_SOURCE_EN`，纯英文原样）。
 */
export function HudInfo(): JSX.Element {
  const tr = useT();
  const trf = useTf();
  const locale = useLocale();
  const viewLevel = useSimulationStore((s) => s.viewLevel);
  const selectedBodyId = useSimulationStore((s) => s.selectedBodyId);
  const selectBody = useSimulationStore((s) => s.selectBody);
  const rateClampNotice = useSimulationStore((s) => s.rateClampNotice);
  // R2-3：行星淡出区间速率钳制提示（文案与卫星区分）
  const planetRateClampNotice = useSimulationStore((s) => s.planetRateClampNotice);
  const followBodyId = useSimulationStore((s) => s.followBodyId);
  const setFollowBody = useSimulationStore((s) => s.setFollowBody);
  const requestFlyTo = useSimulationStore((s) => s.requestFlyTo);
  const activeSupernova = useSimulationStore((s) => s.activeSupernova);
  const supernovaNoticeVisible = useSimulationStore((s) => s.supernovaNoticeVisible);
  const dismissSupernovaNotice = useSimulationStore((s) => s.dismissSupernovaNotice);
  const galacticFrameMode = useSimulationStore((s) => s.galacticFrameMode);
  const toggleGalacticFrameMode = useSimulationStore((s) => s.toggleGalacticFrameMode);
  // R2-6 §6.1：G 键银心固定模式可发现性——首次切入 L3 一次性 toast 引导
  const galacticFrameTipVisible = useSimulationStore((s) => s.galacticFrameTipVisible);
  const showGalacticFrameTipOnce = useSimulationStore((s) => s.showGalacticFrameTipOnce);
  const dismissGalacticFrameTip = useSimulationStore((s) => s.dismissGalacticFrameTip);
  // S2 太阳活动事件（§4.3 通知 + §4.5 信息面板扩展）
  const activeSolarFlare = useSimulationStore((s) => s.activeSolarFlare);
  const solarFlareNoticeVisible = useSimulationStore((s) => s.solarFlareNoticeVisible);
  // 通知卡片渲染用快照（非 activeSolarFlare/activeCme）：事件先于最短
  // 展示时长（EVENT_NOTICE_MIN_VISIBLE_REAL_SEC）完成时通知驻留，
  // 快照保证事件置空后卡片信息仍可渲染
  const solarFlareNoticeInfo = useSimulationStore((s) => s.solarFlareNoticeInfo);
  const dismissSolarFlareNotice = useSimulationStore((s) => s.dismissSolarFlareNotice);
  const activeCme = useSimulationStore((s) => s.activeCme);
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
  const sunCutawayMode = useSimulationStore((s) => s.sunCutawayMode);
  const setSunCutawayMode = useSimulationStore((s) => s.setSunCutawayMode);
  // S3 §4.5：点选的太阳表面特征（黑子群/日珥科普卡片）
  const selectedSolarFeature = useSimulationStore((s) => s.selectedSolarFeature);
  const setSelectedSolarFeature = useSimulationStore((s) => s.setSelectedSolarFeature);
  const sunCutawayLayer = useSimulationStore((s) => s.sunCutawayLayer);
  const setSunCutawayLayer = useSimulationStore((s) => s.setSunCutawayLayer);
  // R2-5 §5.1-B：选中天体属于当前视角域序列时补"上一个/下一个"快捷入口
  // （与底部 BodyCycleSwitcher 行为一致，按域路由；R3 改为显式巡游域状态）
  const cycleScope = useSimulationStore((s) => s.cycleScope);
  const cycleScopeBody = useSimulationStore((s) => s.cycleScopeBody);

  // 模拟时间/标尺以低频率刷新（0.25s），避免每帧渲染 React 组件
  const [simDateText, setSimDateText] = useState('');
  const [scaleText, setScaleText] = useState('');
  const [galacticText, setGalacticText] = useState('');
  // S3 §4.4：太阳活动周期状态行（低频刷新，随快进演变）
  const [cycleLine, setCycleLine] = useState<{ label: string; value: string } | null>(null);
  // R2-11：银河系—仙女座合并演化科普卡片（L4 且模拟时间越过合并时刻时显示；
  // 时间回退（恢复预览前时间）后卡片随之消失——纯模拟时间驱动）
  const [mergerCard, setMergerCard] = useState<{ stageText: string; tauMyr: number } | null>(
    null,
  );
  const [mergerCardDismissed, setMergerCardDismissed] = useState(false);
  useEffect(() => {
    const update = (): void => {
      const state = useSimulationStore.getState();
      setSimDateText(formatSimDate(state.simDays, locale));
      // R2-11 合并演化卡片（仅宇宙视角；合并前为 null）
      const notice = state.viewLevel === 'L4' ? mergerNotice(locale, state.simDays) : null;
      setMergerCard(notice);
      if (notice === null) setMergerCardDismissed(false);
      // 尺度标尺：相机距离按当前层级的尺度映射解释（AU / 光年 / Mpc）
      setScaleText(
        formatSceneScaleLabel(state.cameraDistanceUnits, state.continuousLevel, locale),
      );
      // 银河年进度 + 太阳当前银盘面高度（L3 显示，P6 §3.1.2 垂直振荡指示）
      if (state.viewLevel === 'L3') {
        const progress = galacticYearProgress(state.simDays);
        const heightLy = sunGalacticPositionLy(state.simDays).y;
        const heightSign = heightLy >= 0 ? '+' : '−';
        setGalacticText(
          tf(locale, 'hud.galacticYear', {
            orbit: progress.orbits + 1,
            percent: (progress.progress01 * 100).toFixed(1),
            deg: ((progress.orbits + progress.progress01) * 360).toFixed(0),
            sign: heightSign,
            height: Math.abs(heightLy).toFixed(0),
          }),
        );
      } else {
        setGalacticText('');
      }
      // 太阳活动周期状态行（第 N 周期 · 相位名 · 黑子相对数示意）
      setCycleLine(solarCycleStatusLine(solarCycleState(state.simDays), locale));
    };
    update();
    const id = setInterval(update, 250);
    return () => clearInterval(id);
  }, [locale]);

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

  // i18n：信息面板值行按 locale 取目录（zh/en 各一份懒加载缓存）
  const selected = selectedBodyId ? getBodyInfoById(selectedBodyId, locale) : undefined;

  return (
    <>
      <div className="absolute right-4 top-4 rounded-lg bg-space-panel px-4 py-3 text-right text-xs backdrop-blur">
        <p className="text-sm font-medium text-space-accent">{tr(VIEW_LEVEL_NAME_KEYS[viewLevel])}</p>
        <p className="mt-1 text-gray-300">{trf('hud.simTime', { value: simDateText })}</p>
        <p className="mt-1 text-gray-300">{trf('hud.scale', { value: scaleText })}</p>
        <p className="mt-1 text-gray-500">
          {viewLevel === 'L3'
            ? tr(
                galacticFrameMode === 'galactic-center'
                  ? 'hud.frameHudCenter'
                  : 'hud.frameHudFollow',
              )
            : tr(REFERENCE_FRAME_KEYS[viewLevel])}
        </p>
        {galacticText && <p className="mt-1 text-emerald-300/80">{galacticText}</p>}
        {viewLevel === 'L3' && (
          <p className="mt-1">
            <button
              type="button"
              onClick={toggleGalacticFrameMode}
              className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] hover:bg-white/20"
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
        )}
        {rateClampNotice && (
          <p className="mt-1 text-amber-300/90">⚠ {tr('hud.rateClampSatellite')}</p>
        )}
        {planetRateClampNotice && (
          <p className="mt-1 text-amber-300/90">⚠ {tr('hud.rateClampPlanet')}</p>
        )}
        {followBodyId && (
          <p className="mt-1 text-cyan-300/90">
            🔒{' '}
            {trf('hud.followMode', {
              name: displayBodyName(locale, getBodyInfoById(followBodyId), followBodyId),
            })}
            <button
              type="button"
              onClick={() => setFollowBody(null)}
              className="ml-2 rounded bg-white/10 px-1.5 py-0.5 text-[10px] hover:bg-white/20"
            >
              {tr('hud.followCancel')}
            </button>
          </p>
        )}
      </div>

      {/* 事件通知列（超新星/耀斑/CME，需求 3.1.5 与 S2 §4.3） */}
      <div className="absolute left-1/2 top-4 flex w-96 -translate-x-1/2 flex-col gap-2">
        {/* R2-6 §6.1：首次切入 L3 的一次性 G 键引导 toast（12 秒自动收起） */}
        {galacticFrameTipVisible && viewLevel === 'L3' && (
          <div className="rounded-lg border border-emerald-400/40 bg-space-panel p-3 text-xs backdrop-blur">
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
                className="shrink-0 text-gray-400 hover:text-white"
                aria-label={tr('hud.gTipCloseAria')}
              >
                ✕
              </button>
            </div>
            <button
              type="button"
              onClick={toggleGalacticFrameMode}
              className="mt-2 rounded bg-emerald-400/90 px-2 py-1 text-black hover:bg-emerald-300"
            >
              🌀 {tr('hud.gTipNow')}
            </button>
          </div>
        )}
        {/* R2-11：银河系—仙女座合并演化科普卡片（L4 且越过合并时刻；
            阶段标签随模拟时间推进更新，时间回退自动消失） */}
        {mergerCard && !mergerCardDismissed && (
          <div className="rounded-lg border border-sky-400/40 bg-space-panel p-3 text-xs backdrop-blur">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-sky-300">
                🌌 {tr('hud.mergerTitle')}
              </p>
              <button
                type="button"
                onClick={() => setMergerCardDismissed(true)}
                className="text-gray-400 hover:text-white"
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
            <p className="mt-1 leading-4 text-gray-300">
              {pickLocalized(locale, MERGER_FATE_NOTE_ZH, MERGER_FATE_NOTE_EN)}
            </p>
            <p className="mt-1 text-[10px] text-gray-500">
              {pickLocalized(locale, MERGER_SOURCE_NOTE_ZH, MERGER_SOURCE_NOTE_EN)}
            </p>
          </div>
        )}

        {/* 超新星爆发事件通知（需求 3.1.5：UI 提示 + "飞往观看"按钮；
            R2-4 §4.1-B：仅超新星视角域（L3/L4，≥2.5）内显示，域外折叠为
            一行小字提醒——通知标志位不改动，回域内且事件仍活跃时恢复 */}
        {supernovaNoticeInScope && supernovaNoticeVisible && activeSupernova && (
          <div className="rounded-lg border border-amber-400/40 bg-space-panel p-3 text-xs backdrop-blur">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-amber-300">💥 {tr('hud.snTitle')}</p>
              <button
                type="button"
                onClick={dismissSupernovaNotice}
                className="text-gray-400 hover:text-white"
                aria-label={tr('hud.snCloseAria')}
              >
                ✕
              </button>
            </div>
            <p className="mt-1 text-gray-300">
              {trf('hud.snBody', { mass: activeSupernova.progenitorMassSun.toFixed(0) })}
            </p>
            {/* i18n：科学注记按 locale 取用 */}
            <p className="mt-1 text-[10px] text-gray-500">
              {pickLocalized(locale, SN_REAL_FREQUENCY_NOTE_ZH, SN_REAL_FREQUENCY_NOTE_EN)}
            </p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  requestFlyTo(activeSupernova.id);
                  dismissSupernovaNotice();
                }}
                className="rounded bg-amber-400/90 px-2 py-1 text-black hover:bg-amber-300"
              >
                🚀 {tr('hud.flyBtn')}
              </button>
              <button
                type="button"
                onClick={() => {
                  selectBody(activeSupernova.id);
                }}
                className="rounded bg-white/10 px-2 py-1 hover:bg-white/20"
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
          <div className="rounded-lg border border-orange-400/40 bg-space-panel p-3 text-xs backdrop-blur">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-orange-300">
                ☀️{' '}
                {trf('hud.flareTitle', {
                  cls: solarFlareNoticeInfo.flareClass,
                  mag: solarFlareNoticeInfo.magnitude.toFixed(1),
                })}
              </p>
              <button
                type="button"
                onClick={dismissSolarFlareNotice}
                className="text-gray-400 hover:text-white"
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
            <p className="mt-1 text-[10px] text-gray-500">
              {pickLocalized(locale, FLARE_ENERGY_NOTE_ZH, FLARE_ENERGY_NOTE_EN)}
            </p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  requestFlyTo('sun');
                  dismissSolarFlareNotice();
                }}
                className="rounded bg-orange-400/90 px-2 py-1 text-black hover:bg-orange-300"
              >
                🚀 {tr('hud.flyBtn')}
              </button>
              <button
                type="button"
                onClick={() => {
                  selectBody('sun');
                }}
                className="rounded bg-white/10 px-2 py-1 hover:bg-white/20"
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
          <div className="rounded-lg border border-rose-400/40 bg-space-panel p-3 text-xs backdrop-blur">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-rose-300">
                🌊 {trf('hud.cmeTitle', { speed: Math.round(cmeNoticeInfo.speedKmS) })}
              </p>
              <button
                type="button"
                onClick={dismissCmeNotice}
                className="text-gray-400 hover:text-white"
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
              <p className="mt-1 text-[10px] text-amber-300/90">
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
                className="rounded bg-rose-400/90 px-2 py-1 text-black hover:bg-rose-300"
              >
                🚀 {tr('hud.flyBtn')}
              </button>
            </div>
          </div>
        )}
        {/* S3 §4.3-3：CME 抵达地球通知（极区极光增强示意；
            R2-4 §4.1-B：仅太阳系视角域（L1/L2，≤2.4）内显示 */}
        {solarNoticeInScope && cmeArrivalNoticeVisible && (
          <div className="rounded-lg border border-emerald-400/40 bg-space-panel p-3 text-xs backdrop-blur">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-emerald-300">
                🌌 {tr('hud.cmeArrivalTitle')}
              </p>
              <button
                type="button"
                onClick={dismissCmeArrivalNotice}
                className="text-gray-400 hover:text-white"
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
                className="rounded bg-emerald-400/90 px-2 py-1 text-black hover:bg-emerald-300"
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

      {/* S3 §4.5：黑子群/日珥点选科普卡片（含"可容纳 N 个地球"动态换算） */}
      {selectedSolarFeature && (
        <div className="absolute bottom-4 left-1/2 w-80 -translate-x-1/2 rounded-lg border border-orange-300/30 bg-space-panel p-4 text-xs backdrop-blur">
          {/* i18n：titleEn/descEn 数据驱动，按 locale 取用（缺失回退中文） */}
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-orange-300">
              {pickLocalized(locale, selectedSolarFeature.titleZh, selectedSolarFeature.titleEn)}
            </h3>
            <button
              type="button"
              onClick={() => setSelectedSolarFeature(null)}
              className="text-gray-400 hover:text-white"
              aria-label={tr('hud.featureCloseAria')}
            >
              ✕
            </button>
          </div>
          <p className="leading-5 text-gray-300">
            {pickLocalized(locale, selectedSolarFeature.descZh, selectedSolarFeature.descEn)}
          </p>
          {selectedSolarFeature.earthCount !== null && (
            <p className="mt-2 rounded bg-orange-400/10 px-2 py-1 text-orange-200">
              🌍 {tr('hud.sunspotEarthsPre')}{' '}
              <span className="font-semibold">
                {selectedSolarFeature.earthCount.toLocaleString('zh-CN')}
              </span>{' '}
              {tr('hud.sunspotEarthsPost')}
            </p>
          )}
        </div>
      )}

      {/* 剖面分层科普卡片（S2 §4.1：各层可点选高亮并显示说明） */}
      {sunCutawayMode && sunCutawayLayer && (
        <div className="absolute bottom-4 left-4 w-72 rounded-lg border border-orange-300/30 bg-space-panel p-4 text-xs backdrop-blur">
          {(() => {
            const layer = getSunLayerById(sunCutawayLayer);
            if (!layer) return null;
            return (
              <>
                <div className="mb-2 flex items-center justify-between">
                  {/* 标题：zh 中英并列、en 仅英文（hud.bodyTitle，实现差异登记） */}
                  <h3 className="text-sm font-semibold text-orange-300">
                    {trf('hud.bodyTitle', { nameZh: layer.nameZh, nameEn: layer.name })}
                  </h3>
                  <button
                    type="button"
                    onClick={() => setSunCutawayLayer(null)}
                    className="text-gray-400 hover:text-white"
                    aria-label={tr('hud.layerCloseAria')}
                  >
                    ✕
                  </button>
                </div>
                {/* i18n：分层范围/温度/说明按 locale 取用（缺失回退中文） */}
                <dl className="space-y-1 text-gray-300">
                  <div className="flex justify-between gap-2">
                    <dt className="shrink-0">{tr('hud.layerRange')}</dt>
                    <dd className="text-right">
                      {pickLocalized(locale, layer.rangeZh, layer.rangeEn)}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="shrink-0">{tr('hud.layerTemp')}</dt>
                    <dd className="text-right">
                      {pickLocalized(locale, layer.temperatureZh, layer.temperatureEn)}
                    </dd>
                  </div>
                </dl>
                <p className="mt-2 leading-5 text-gray-300">
                  {pickLocalized(locale, layer.descriptionZh, layer.descriptionEn)}
                </p>
                {/* i18n：结构数据来源按 locale 取用 */}
                <p className="mt-2 border-t border-white/10 pt-2 text-[10px] text-gray-500">
                  {trf('hud.dataSource', {
                    value: pickLocalized(
                      locale,
                      SUN_STRUCTURE_DATA_SOURCE,
                      SUN_STRUCTURE_DATA_SOURCE_EN,
                    ),
                  })}
                </p>
              </>
            );
          })()}
        </div>
      )}

      {selected && (
        <div className="absolute bottom-4 right-4 w-72 rounded-lg bg-space-panel p-4 text-xs backdrop-blur">
          <div className="mb-2 flex items-center justify-between">
            {/* 标题：zh 中英并列、en 仅英文（hud.bodyTitle + displayBodyName 口径） */}
            <h3 className="text-sm font-semibold text-space-accent">
              {trf('hud.bodyTitle', { nameZh: selected.nameZh, nameEn: selected.name })}
            </h3>
            <button
              type="button"
              onClick={() => selectBody(null)}
              className="text-gray-400 hover:text-white"
              aria-label={tr('hud.infoCloseAria')}
            >
              ✕
            </button>
          </div>
          {/* 类型行/标签列经 catalogText 直映射；值行留中文（B3 豁免登记） */}
          <p className="mb-2 text-[11px] text-gray-400">
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
              className={`mt-2 w-full rounded px-2 py-1 text-[11px] ${
                sunCutawayMode
                  ? 'bg-orange-400/90 text-black hover:bg-orange-300'
                  : 'bg-white/10 hover:bg-white/20'
              }`}
            >
              🔬 {sunCutawayMode ? tr('hud.cutawayOn') : tr('hud.cutawayOff')}
            </button>
          )}
          {/* 飞往 / 跟随（需求 3.2.3：点选后可飞往，可锁定任意天体跟随） */}
          <div className="mt-2 flex gap-2 border-t border-white/10 pt-2">
            <button
              type="button"
              onClick={() => requestFlyTo(selected.id)}
              className="rounded bg-space-accent/90 px-2 py-1 text-[11px] text-black hover:bg-space-accent"
            >
              🚀 {tr('hud.flyShort')}
            </button>
            <button
              type="button"
              onClick={() =>
                setFollowBody(followBodyId === selected.id ? null : selected.id)
              }
              className={`rounded px-2 py-1 text-[11px] ${
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
                  className="rounded bg-white/10 px-2 py-1 text-[11px] hover:bg-white/20"
                  aria-label={tr('hud.prevAria')}
                  title={tr('hud.prevTitle')}
                >
                  ←
                </button>
                <span className="text-[10px] text-gray-400">
                  {scopeCyclePositionLabel(cycleScope, selected.id)}
                </span>
                <button
                  type="button"
                  onClick={() => cycleScopeBody(1)}
                  className="rounded bg-white/10 px-2 py-1 text-[11px] hover:bg-white/20"
                  aria-label={tr('hud.nextAria')}
                  title={tr('hud.nextTitle')}
                >
                  →
                </button>
              </span>
            )}
          </div>
          {/* i18n：dataSource 随 en 目录本地化（含中文的署名已补英文版） */}
          <p className="mt-2 border-t border-white/10 pt-2 text-[10px] text-gray-500">
            {trf('hud.dataSource', { value: selected.dataSource })}
          </p>
        </div>
      )}
    </>
  );
}
