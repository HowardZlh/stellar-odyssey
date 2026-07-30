'use client';


import type { JSX } from 'react';
import { useEffect, useState } from 'react';
import type { ViewLevel } from '@/types';
import { CAMERA_VIEWS } from '@/data/cameraViews';
import { getBodyInfoById } from '@/data/catalog';
import {
  CME_GEOMAGNETIC_NOTE_ZH,
  FLARE_ENERGY_NOTE_ZH,
  SUN_STRUCTURE_DATA_SOURCE,
  getSunLayerById,
} from '@/data/sunStructure';
import { useSimulationStore } from '@/store';
import { scopeCyclePositionLabel } from '@/utils/cycleScopes';
import { eventNoticeVisibleInScope } from '@/utils/eventScopes';
import { galacticFrameHudLabel } from '@/utils/galacticFrame';
import {
  MERGER_FATE_NOTE_ZH,
  MERGER_SOURCE_NOTE_ZH,
  mergerNoticeZh,
} from '@/utils/galaxyMerger';
import { galacticYearProgress, sunGalacticPositionLy } from '@/utils/galaxy';
import { formatSceneScaleLabel } from '@/utils/scale';
import { sunActivityStatusLines } from '@/utils/solarActivity';
import { solarCycleState, solarCycleStatusLine } from '@/utils/solarCycle';
import { SN_REAL_FREQUENCY_NOTE_ZH } from '@/utils/supernova';
import { formatSimDate } from '@/utils/time';

/** 各层级运动参考系说明（需求 3.1.3 参考系定义） */
const REFERENCE_FRAMES: Record<ViewLevel, string> = {
  L1: '参考系：日心系（行星/卫星运动）',
  L2: '参考系：日心系（黄道坐标）',
  L3: '参考系：银心系（太阳系绕银心）',
  L4: '参考系：本星系群质心系（本动以矢量指示）',
};

/**
 * HUD 信息（需求 3.5.2）：当前视角/尺度标尺、参考系、模拟时间、
 * 银河年进度（L3）、速率钳制提示、选中天体信息（统一目录）
 */
export function HudInfo(): JSX.Element {
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
  const [mergerCard, setMergerCard] = useState<{ stageZh: string; tauMyr: number } | null>(
    null,
  );
  const [mergerCardDismissed, setMergerCardDismissed] = useState(false);
  useEffect(() => {
    const update = (): void => {
      const state = useSimulationStore.getState();
      setSimDateText(formatSimDate(state.simDays));
      // R2-11 合并演化卡片（仅宇宙视角；合并前为 null）
      const notice = state.viewLevel === 'L4' ? mergerNoticeZh(state.simDays) : null;
      setMergerCard(notice);
      if (notice === null) setMergerCardDismissed(false);
      // 尺度标尺：相机距离按当前层级的尺度映射解释（AU / 光年 / Mpc）
      setScaleText(formatSceneScaleLabel(state.cameraDistanceUnits, state.continuousLevel));
      // 银河年进度 + 太阳当前银盘面高度（L3 显示，P6 §3.1.2 垂直振荡指示）
      if (state.viewLevel === 'L3') {
        const progress = galacticYearProgress(state.simDays);
        const heightLy = sunGalacticPositionLy(state.simDays).y;
        const heightSign = heightLy >= 0 ? '+' : '−';
        setGalacticText(
          `银河年进度：第 ${progress.orbits + 1} 圈 ${(progress.progress01 * 100).toFixed(1)}%（绕行 ${((progress.orbits + progress.progress01) * 360).toFixed(0)}°）｜银盘面高度 ${heightSign}${Math.abs(heightLy).toFixed(0)} ly`,
        );
      } else {
        setGalacticText('');
      }
      // 太阳活动周期状态行（第 N 周期 · 相位名 · 黑子相对数示意）
      setCycleLine(solarCycleStatusLine(solarCycleState(state.simDays)));
    };
    update();
    const id = setInterval(update, 250);
    return () => clearInterval(id);
  }, []);

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

  const selected = selectedBodyId ? getBodyInfoById(selectedBodyId) : undefined;

  return (
    <>
      <div className="absolute right-4 top-4 rounded-lg bg-space-panel px-4 py-3 text-right text-xs backdrop-blur">
        <p className="text-sm font-medium text-space-accent">{CAMERA_VIEWS[viewLevel].nameZh}</p>
        <p className="mt-1 text-gray-300">模拟时间：{simDateText}</p>
        <p className="mt-1 text-gray-300">当前尺度：{scaleText}</p>
        <p className="mt-1 text-gray-500">
          {viewLevel === 'L3' ? galacticFrameHudLabel(galacticFrameMode) : REFERENCE_FRAMES[viewLevel]}
        </p>
        {galacticText && <p className="mt-1 text-emerald-300/80">{galacticText}</p>}
        {viewLevel === 'L3' && (
          <p className="mt-1">
            <button
              type="button"
              onClick={toggleGalacticFrameMode}
              className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] hover:bg-white/20"
            >
              🌀 参考系：{galacticFrameMode === 'galactic-center' ? '银心固定' : '跟随太阳系'}（G 切换）
            </button>
          </p>
        )}
        {rateClampNotice && (
          <p className="mt-1 text-amber-300/90">⚠ 快周期卫星运动已减速显示（防闪烁）</p>
        )}
        {planetRateClampNotice && (
          <p className="mt-1 text-amber-300/90">⚠ 行星运动已减速显示（防闪烁）</p>
        )}
        {followBodyId && (
          <p className="mt-1 text-cyan-300/90">
            🔒 跟随模式：{getBodyInfoById(followBodyId)?.nameZh ?? followBodyId}
            <button
              type="button"
              onClick={() => setFollowBody(null)}
              className="ml-2 rounded bg-white/10 px-1.5 py-0.5 text-[10px] hover:bg-white/20"
            >
              取消（Esc）
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
                💡 按 <span className="font-semibold text-emerald-300">G</span>{' '}
                切换<span className="text-emerald-300">银心固定视角</span>
                ，俯瞰太阳系沿波浪轨道绕银心公转
              </p>
              <button
                type="button"
                onClick={dismissGalacticFrameTip}
                className="shrink-0 text-gray-400 hover:text-white"
                aria-label="关闭银心固定视角引导"
              >
                ✕
              </button>
            </div>
            <button
              type="button"
              onClick={toggleGalacticFrameMode}
              className="mt-2 rounded bg-emerald-400/90 px-2 py-1 text-black hover:bg-emerald-300"
            >
              🌀 立即切换（G）
            </button>
          </div>
        )}
        {/* R2-11：银河系—仙女座合并演化科普卡片（L4 且越过合并时刻；
            阶段标签随模拟时间推进更新，时间回退自动消失） */}
        {mergerCard && !mergerCardDismissed && (
          <div className="rounded-lg border border-sky-400/40 bg-space-panel p-3 text-xs backdrop-blur">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-sky-300">
                🌌 银河系—仙女座合并演化
              </p>
              <button
                type="button"
                onClick={() => setMergerCardDismissed(true)}
                className="text-gray-400 hover:text-white"
                aria-label="关闭合并演化卡片"
              >
                ✕
              </button>
            </div>
            <p className="mt-1 text-gray-200">
              {mergerCard.stageZh}（合并时刻后约 {(mergerCard.tauMyr / 100).toFixed(1)}{' '}
              亿年）
            </p>
            <p className="mt-1 leading-4 text-gray-300">{MERGER_FATE_NOTE_ZH}</p>
            <p className="mt-1 text-[10px] text-gray-500">{MERGER_SOURCE_NOTE_ZH}</p>
          </div>
        )}

        {/* 超新星爆发事件通知（需求 3.1.5：UI 提示 + "飞往观看"按钮；
            R2-4 §4.1-B：仅超新星视角域（L3/L4，≥2.5）内显示，域外折叠为
            一行小字提醒——通知标志位不改动，回域内且事件仍活跃时恢复 */}
        {supernovaNoticeInScope && supernovaNoticeVisible && activeSupernova && (
          <div className="rounded-lg border border-amber-400/40 bg-space-panel p-3 text-xs backdrop-blur">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-amber-300">💥 超新星爆发！</p>
              <button
                type="button"
                onClick={dismissSupernovaNotice}
                className="text-gray-400 hover:text-white"
                aria-label="关闭超新星通知"
              >
                ✕
              </button>
            </div>
            <p className="mt-1 text-gray-300">
              银河系旋臂内探测到核坍缩超新星（前身星约{' '}
              {activeSupernova.progenitorMassSun.toFixed(0)} 倍太阳质量）
            </p>
            <p className="mt-1 text-[10px] text-gray-500">{SN_REAL_FREQUENCY_NOTE_ZH}</p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  requestFlyTo(activeSupernova.id);
                  dismissSupernovaNotice();
                }}
                className="rounded bg-amber-400/90 px-2 py-1 text-black hover:bg-amber-300"
              >
                🚀 飞往观看
              </button>
              <button
                type="button"
                onClick={() => {
                  selectBody(activeSupernova.id);
                }}
                className="rounded bg-white/10 px-2 py-1 hover:bg-white/20"
              >
                查看详情
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
                ☀️ 太阳耀斑爆发（{solarFlareNoticeInfo.flareClass}
                {solarFlareNoticeInfo.magnitude.toFixed(1)} 级）！
              </p>
              <button
                type="button"
                onClick={dismissSolarFlareNotice}
                className="text-gray-400 hover:text-white"
                aria-label="关闭耀斑通知"
              >
                ✕
              </button>
            </div>
            <p className="mt-1 text-gray-300">
              活动区（黑子群附近）发生磁重联能量释放
              {solarFlareNoticeInfo.cmeLinked && '，预计伴随日冕物质抛射（CME）'}
            </p>
            <p className="mt-1 text-[10px] text-gray-500">{FLARE_ENERGY_NOTE_ZH}</p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  requestFlyTo('sun');
                  dismissSolarFlareNotice();
                }}
                className="rounded bg-orange-400/90 px-2 py-1 text-black hover:bg-orange-300"
              >
                🚀 飞往观看
              </button>
              <button
                type="button"
                onClick={() => {
                  selectBody('sun');
                }}
                className="rounded bg-white/10 px-2 py-1 hover:bg-white/20"
              >
                查看详情
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
                🌊 日冕物质抛射（CME）！约 {Math.round(cmeNoticeInfo.speedKmS)} km/s
              </p>
              <button
                type="button"
                onClick={dismissCmeNotice}
                className="text-gray-400 hover:text-white"
                aria-label="关闭 CME 通知"
              >
                ✕
              </button>
            </div>
            <p className="mt-1 text-gray-300">
              大团等离子体从日冕喷出，呈扩张壳层飞离太阳
              {cmeNoticeInfo.earthDirected && '——本次抛射朝向地球！'}
            </p>
            {cmeNoticeInfo.earthDirected && (
              <p className="mt-1 text-[10px] text-amber-300/90">⚠ {CME_GEOMAGNETIC_NOTE_ZH}</p>
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
                🚀 飞往观看
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
                🌌 CME 已抵达地球！
              </p>
              <button
                type="button"
                onClick={dismissCmeArrivalNotice}
                className="text-gray-400 hover:text-white"
                aria-label="关闭 CME 抵达通知"
              >
                ✕
              </button>
            </div>
            <p className="mt-1 text-gray-300">
              等离子体云抵达地球磁层，扰动引发地磁暴——极区高层大气激发出增强极光
              （示意）。
            </p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  requestFlyTo('earth');
                  dismissCmeArrivalNotice();
                }}
                className="rounded bg-emerald-400/90 px-2 py-1 text-black hover:bg-emerald-300"
              >
                🚀 飞往地球观看
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
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-orange-300">
              {selectedSolarFeature.titleZh}
            </h3>
            <button
              type="button"
              onClick={() => setSelectedSolarFeature(null)}
              className="text-gray-400 hover:text-white"
              aria-label="关闭特征卡片"
            >
              ✕
            </button>
          </div>
          <p className="leading-5 text-gray-300">{selectedSolarFeature.descZh}</p>
          {selectedSolarFeature.earthCount !== null && (
            <p className="mt-2 rounded bg-orange-400/10 px-2 py-1 text-orange-200">
              🌍 该黑子约可容纳{' '}
              <span className="font-semibold">
                {selectedSolarFeature.earthCount.toLocaleString('zh-CN')}
              </span>{' '}
              个地球（按放大前真实尺寸换算）
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
                  <h3 className="text-sm font-semibold text-orange-300">
                    {layer.nameZh}（{layer.name}）
                  </h3>
                  <button
                    type="button"
                    onClick={() => setSunCutawayLayer(null)}
                    className="text-gray-400 hover:text-white"
                    aria-label="关闭分层卡片"
                  >
                    ✕
                  </button>
                </div>
                <dl className="space-y-1 text-gray-300">
                  <div className="flex justify-between gap-2">
                    <dt className="shrink-0">范围</dt>
                    <dd className="text-right">{layer.rangeZh}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="shrink-0">温度</dt>
                    <dd className="text-right">{layer.temperatureZh}</dd>
                  </div>
                </dl>
                <p className="mt-2 leading-5 text-gray-300">{layer.descriptionZh}</p>
                <p className="mt-2 border-t border-white/10 pt-2 text-[10px] text-gray-500">
                  数据来源：{SUN_STRUCTURE_DATA_SOURCE}
                </p>
              </>
            );
          })()}
        </div>
      )}

      {selected && (
        <div className="absolute bottom-4 right-4 w-72 rounded-lg bg-space-panel p-4 text-xs backdrop-blur">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-space-accent">
              {selected.nameZh}（{selected.name}）
            </h3>
            <button
              type="button"
              onClick={() => selectBody(null)}
              className="text-gray-400 hover:text-white"
              aria-label="关闭信息面板"
            >
              ✕
            </button>
          </div>
          <p className="mb-2 text-[11px] text-gray-400">{selected.typeZh}</p>
          <dl className="space-y-1 text-gray-300">
            {selected.lines.map((line, index) => (
              // key 含序号：不同来源行可能同 label（防 React 同 key 复用串卡）
              <div key={`${index}-${line.label}`} className="flex justify-between gap-2">
                <dt className="shrink-0">{line.label}</dt>
                <dd className="text-right">{line.value}</dd>
              </div>
            ))}
            {/* S3 §4.4：太阳活动周期状态行（第 N 周期 · 相位名 · 黑子相对数） */}
            {selected.id === 'sun' && cycleLine && (
              <div key={cycleLine.label} className="flex justify-between gap-2">
                <dt className="shrink-0 text-amber-300/90">{cycleLine.label}</dt>
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
              ).map((line) => (
                <div key={line.label} className="flex justify-between gap-2">
                  <dt className="shrink-0 text-orange-300/90">{line.label}</dt>
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
              {sunCutawayMode ? '🔬 关闭内部结构剖面' : '🔬 查看内部结构（1/4 剖面）'}
            </button>
          )}
          {/* 飞往 / 跟随（需求 3.2.3：点选后可飞往，可锁定任意天体跟随） */}
          <div className="mt-2 flex gap-2 border-t border-white/10 pt-2">
            <button
              type="button"
              onClick={() => requestFlyTo(selected.id)}
              className="rounded bg-space-accent/90 px-2 py-1 text-[11px] text-black hover:bg-space-accent"
            >
              🚀 飞往（F）
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
              {followBodyId === selected.id ? '🔓 取消跟随' : '🔒 跟随'}
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
                  aria-label="序列上一个天体（快捷键 [）"
                  title="上一个（[）"
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
                  aria-label="序列下一个天体（快捷键 ]）"
                  title="下一个（]）"
                >
                  →
                </button>
              </span>
            )}
          </div>
          <p className="mt-2 border-t border-white/10 pt-2 text-[10px] text-gray-500">
            数据来源：{selected.dataSource}
          </p>
        </div>
      )}
    </>
  );
}
