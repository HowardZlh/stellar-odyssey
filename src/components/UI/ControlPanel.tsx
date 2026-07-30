'use client';


import type { JSX } from 'react';
import { VIEW_LEVELS } from '@/types';
import { CAMERA_VIEWS } from '@/data/cameraViews';
import { useSimulationStore } from '@/store';
import { eventDemoEnabled } from '@/utils/eventScopes';
import { panelOptionVisible, type PanelOptionId } from '@/utils/panelScopes';
import {
  GALAXY_EXPAND_GAIN_MAX,
  GALAXY_EXPAND_GAIN_MIN,
  GALAXY_EXPAND_GAIN_STEP,
} from '@/utils/galacticLatitude';
import {
  GALAXY_CATALOG_DISTORTIONS_ZH,
  GALAXY_CATALOG_SOURCE_ZH,
} from '@/utils/galaxyCatalog';
import { SN_DEFAULT_DURATION_SEC } from '@/utils/supernova';
import { rollSupernovaParams } from '@/components/Scene/Supernova';
import { rollCmeParams, rollFlareParams } from '@/components/CelestialBody/SunActivity';

/**
 * 控制面板（需求 3.5.1）：视角锚点 / 模拟速度 / 音效 / 轨道线与标签开关 /
 * 真实比例模式（P2）/ 超新星手动演示（P2，需求 3.1.5 触发方式）/
 * 太阳耀斑与 CME 手动演示 + 太阳剖面模式开关（S2 §4.1/§4.3/§4.5）
 *
 * R3-8：视角专属选项按 panelScopes 注册表域外隐藏（非置灰，取代 R2-4
 * 置灰方案）；判定源 = viewLevel（跟随期间层级锁定选项不闪变）。
 * 仅整理 UI 显示——域外已开启的开关状态与场景效果全部保留。
 */
export function ControlPanel(): JSX.Element {
  const viewLevel = useSimulationStore((s) => s.viewLevel);
  const setViewLevel = useSimulationStore((s) => s.setViewLevel);
  const paused = useSimulationStore((s) => s.paused);
  const togglePaused = useSimulationStore((s) => s.togglePaused);
  const speedMultiplier = useSimulationStore((s) => s.speedMultiplier);
  const setSpeedMultiplier = useSimulationStore((s) => s.setSpeedMultiplier);
  const audioEnabled = useSimulationStore((s) => s.audioEnabled);
  const toggleAudio = useSimulationStore((s) => s.toggleAudio);
  const audioVolume = useSimulationStore((s) => s.audioVolume);
  const setAudioVolume = useSimulationStore((s) => s.setAudioVolume);
  const showOrbits = useSimulationStore((s) => s.showOrbits);
  const setShowOrbits = useSimulationStore((s) => s.setShowOrbits);
  const showLabels = useSimulationStore((s) => s.showLabels);
  const setShowLabels = useSimulationStore((s) => s.setShowLabels);
  const showSatelliteOrbits = useSimulationStore((s) => s.showSatelliteOrbits);
  const setShowSatelliteOrbits = useSimulationStore((s) => s.setShowSatelliteOrbits);
  const showYouAreHere = useSimulationStore((s) => s.showYouAreHere);
  const setShowYouAreHere = useSimulationStore((s) => s.setShowYouAreHere);
  const showVelocityVectors = useSimulationStore((s) => s.showVelocityVectors);
  const setShowVelocityVectors = useSimulationStore((s) => s.setShowVelocityVectors);
  // R5-3：真实巡天背景（2MRS 目录点云）开关
  const showGalaxyCatalog = useSimulationStore((s) => s.showGalaxyCatalog);
  const setShowGalaxyCatalog = useSimulationStore((s) => s.setShowGalaxyCatalog);
  const realScaleMode = useSimulationStore((s) => s.realScaleMode);
  const setRealScaleMode = useSimulationStore((s) => s.setRealScaleMode);
  // R3-6：银河系视角天体垂直展开（V 键）+ 增益滑块
  const galaxyVerticalExpand = useSimulationStore((s) => s.galaxyVerticalExpand);
  const setGalaxyVerticalExpand = useSimulationStore((s) => s.setGalaxyVerticalExpand);
  const galaxyExpandGain = useSimulationStore((s) => s.galaxyExpandGain);
  const setGalaxyExpandGain = useSimulationStore((s) => s.setGalaxyExpandGain);
  const activeSupernova = useSimulationStore((s) => s.activeSupernova);
  const triggerSupernova = useSimulationStore((s) => s.triggerSupernova);
  const showPerformance = useSimulationStore((s) => s.showPerformance);
  const setShowPerformance = useSimulationStore((s) => s.setShowPerformance);
  const bloomEnabled = useSimulationStore((s) => s.bloomEnabled);
  const setBloomEnabled = useSimulationStore((s) => s.setBloomEnabled);
  const mergePreviewActive = useSimulationStore((s) => s.mergePreviewActive);
  const mergePreviewReturnSimDays = useSimulationStore((s) => s.mergePreviewReturnSimDays);
  const startMergePreview = useSimulationStore((s) => s.startMergePreview);
  const restoreFromMergePreview = useSimulationStore((s) => s.restoreFromMergePreview);

  const activeSolarFlare = useSimulationStore((s) => s.activeSolarFlare);
  const triggerSolarFlare = useSimulationStore((s) => s.triggerSolarFlare);
  const activeCme = useSimulationStore((s) => s.activeCme);
  const triggerCme = useSimulationStore((s) => s.triggerCme);
  const sunCutawayMode = useSimulationStore((s) => s.sunCutawayMode);
  const setSunCutawayMode = useSimulationStore((s) => s.setSunCutawayMode);
  // R2-6 §6.1：G 键银心固定模式显式入口（此前仅快捷键，可发现性差）
  const galacticFrameMode = useSimulationStore((s) => s.galacticFrameMode);
  const toggleGalacticFrameMode = useSimulationStore((s) => s.toggleGalacticFrameMode);
  // 演示按钮可见性/可用性双层（R3-8）：可见性按 viewLevel 域外隐藏（panelScopes），
  // 可用性保留 R2-4 既有 eventDemoEnabled 域校验（R5-8：判定源同改离散
  // viewLevel——与可见性层同源，跟随巡游天体期间不随相机距离误置灰；
  // 选布尔值，仅域边界跨越时重渲染；耀斑/CME 同属太阳系域共用一个判定）
  const solarDemoInScope = useSimulationStore((s) => eventDemoEnabled('flare', s.viewLevel));
  const supernovaDemoInScope = useSimulationStore((s) =>
    eventDemoEnabled('supernova', s.viewLevel),
  );
  const mergerDemoInScope = useSimulationStore((s) => eventDemoEnabled('merger', s.viewLevel));

  // R3-8：视角专属选项可见性判定（单一事实来源 panelScopes 注册表）
  const visible = (id: PanelOptionId): boolean => panelOptionVisible(id, viewLevel);
  // 无可用演示按钮时"动态事件演示"分区标题一并隐藏（当前四视角各有
  // 至少一钮恒真，规则登记备防作用域表调整）
  const anyDemoVisible =
    visible('supernovaDemo') || visible('flareDemo') || visible('cmeDemo') || visible('mergerDemo');

  const handleSupernovaDemo = (): void => {
    const params = rollSupernovaParams();
    triggerSupernova(params.positionLy, params.massSun, SN_DEFAULT_DURATION_SEC);
  };

  const handleFlareDemo = (): void => {
    triggerSolarFlare(rollFlareParams(useSimulationStore.getState().simDays));
  };

  const handleCmeDemo = (): void => {
    triggerCme(rollCmeParams(useSimulationStore.getState().simDays));
  };

  return (
    <div className="absolute left-4 top-4 w-64 select-none rounded-lg bg-space-panel p-4 text-sm backdrop-blur">
      <h1 className="mb-3 text-base font-semibold text-space-accent">
        星海奥德赛
        <span className="ml-1.5 align-middle text-[10px] font-normal tracking-wide text-gray-400">
          Stellar Odyssey
        </span>
      </h1>

      {/* 视角锚点 */}
      <section className="mb-4">
        <h2 className="mb-2 text-xs text-gray-400">视角（快捷键 1-4）</h2>
        <div className="grid grid-cols-2 gap-2">
          {VIEW_LEVELS.map((level) => (
            <button
              key={level}
              type="button"
              onClick={() => setViewLevel(level)}
              className={`rounded px-2 py-1.5 text-xs transition-colors ${
                viewLevel === level
                  ? 'bg-space-accent text-black'
                  : 'bg-white/10 text-gray-200 hover:bg-white/20'
              }`}
            >
              {CAMERA_VIEWS[level].nameZh}
            </button>
          ))}
        </div>
      </section>

      {/* 银河系视角参考系（R2-6 §6.1：G 键银心固定模式显式入口 + 说明；
          R3-8：整个 section 仅 L3 渲染，域外隐藏） */}
      {visible('galacticFrame') && (
        <section className="mb-4">
          <h2 className="mb-2 text-xs text-gray-400">银河系视角参考系（G 切换）</h2>
          <button
            type="button"
            onClick={toggleGalacticFrameMode}
            title="银心固定：银心居中不动，俯瞰太阳系沿波浪轨道绕银心公转"
            className={`w-full rounded px-2 py-1.5 text-xs ${
              galacticFrameMode === 'galactic-center'
                ? 'bg-emerald-400/90 text-black hover:bg-emerald-300'
                : 'bg-white/10 text-gray-200 hover:bg-white/20'
            }`}
          >
            {galacticFrameMode === 'galactic-center'
              ? '🌀 银心固定中（点按回到跟随太阳系）'
              : '🌀 切换银心固定视角（观察太阳系公转）'}
          </button>
        </section>
      )}

      {/* 时间控制 */}
      <section className="mb-4">
        <h2 className="mb-2 text-xs text-gray-400">模拟速度（空格暂停）</h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={togglePaused}
            className="rounded bg-white/10 px-2 py-1 text-xs hover:bg-white/20"
            aria-label={paused ? '继续' : '暂停'}
          >
            {paused ? '▶ 继续' : '⏸ 暂停'}
          </button>
          <span className="text-xs text-gray-300">×{speedMultiplier.toFixed(1)}</span>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          step={0.5}
          value={speedMultiplier}
          onChange={(e) => setSpeedMultiplier(Number(e.target.value))}
          className="mt-2 w-full"
          aria-label="模拟速度倍率"
        />
      </section>

      {/* 音效控制 */}
      <section className="mb-4">
        <h2 className="mb-2 text-xs text-gray-400">音效（M 静音；真空无声，音效为艺术化设计）</h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={toggleAudio}
            className={`rounded px-2 py-1 text-xs ${
              audioEnabled ? 'bg-space-accent text-black' : 'bg-white/10 hover:bg-white/20'
            }`}
          >
            {audioEnabled ? '🔊 开' : '🔇 关'}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={audioVolume}
            onChange={(e) => setAudioVolume(Number(e.target.value))}
            className="w-full"
            aria-label="音量"
          />
        </div>
      </section>

      {/* 显示开关 */}
      <section>
        <h2 className="mb-2 text-xs text-gray-400">显示</h2>
        <label className="mb-1 flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={showOrbits}
            onChange={(e) => setShowOrbits(e.target.checked)}
          />
          轨道线（O）
        </label>
        <label className="mb-1 flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={showLabels}
            onChange={(e) => setShowLabels(e.target.checked)}
          />
          天体标签（L）
        </label>
        {visible('satelliteOrbits') && (
          <label className="mb-1 flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={showSatelliteOrbits}
              onChange={(e) => setShowSatelliteOrbits(e.target.checked)}
            />
            卫星轨道线
          </label>
        )}
        {visible('youAreHere') && (
          <label className="mb-1 flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={showYouAreHere}
              onChange={(e) => setShowYouAreHere(e.target.checked)}
            />
            You are here 标记
          </label>
        )}
        {visible('velocityVectors') && (
          <label className="mb-1 flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={showVelocityVectors}
              onChange={(e) => setShowVelocityVectors(e.target.checked)}
            />
            速度矢量箭头
          </label>
        )}
        {visible('galaxyCatalog') && (
          <>
            <label className="mb-1 flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={showGalaxyCatalog}
                onChange={(e) => setShowGalaxyCatalog(e.target.checked)}
              />
              真实巡天背景（2MRS）
            </label>
            <p className="mb-1 pl-5 text-[10px] leading-4 text-gray-500">
              {GALAXY_CATALOG_SOURCE_ZH}；失真登记：{GALAXY_CATALOG_DISTORTIONS_ZH}。
              关闭或数据缺失时回落程序化宇宙网示意
            </p>
          </>
        )}
        {visible('verticalExpand') && (
          <>
            <label className="mb-1 flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={galaxyVerticalExpand}
                onChange={(e) => setGalaxyVerticalExpand(e.target.checked)}
              />
              垂直展开（V）
            </label>
            {galaxyVerticalExpand && (
              <div className="mb-1 pl-5">
                <label className="flex items-center gap-2 text-[10px] text-gray-400">
                  增益 ×{galaxyExpandGain.toFixed(1)}
                  <input
                    type="range"
                    min={GALAXY_EXPAND_GAIN_MIN}
                    max={GALAXY_EXPAND_GAIN_MAX}
                    step={GALAXY_EXPAND_GAIN_STEP}
                    value={galaxyExpandGain}
                    onChange={(e) => setGalaxyExpandGain(Number(e.target.value))}
                    className="flex-1"
                    aria-label="垂直展开增益（1–6）"
                  />
                </label>
                <p className="text-[10px] leading-4 text-gray-500">
                  银河系整体随增益 morph 为扁旋转椭球体（银盘粒子/超新星随盘
                  抬升、特殊天体垂直高度按增益展开；观察辅助的视觉夸大，
                  指示线标注为未放大的银纬推算高度）
                </p>
              </div>
            )}
          </>
        )}
        <label className="mb-1 flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={realScaleMode}
            onChange={(e) => setRealScaleMode(e.target.checked)}
          />
          真实比例模式（天体按真实大小）
        </label>
        {realScaleMode && (
          <p className="mb-1 pl-5 text-[10px] leading-4 text-gray-500">
            真实比例下行星/矮行星极小（矮行星过小不可见属科学事实），
            可飞往/跟随后近距离观察
          </p>
        )}
        {visible('sunCutaway') && (
          <>
            <label className="mb-1 flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={sunCutawayMode}
                onChange={(e) => setSunCutawayMode(e.target.checked)}
              />
              太阳内部剖面（1/4 切除视图）
            </label>
            {sunCutawayMode && (
              <p className="mb-1 pl-5 text-[10px] leading-4 text-gray-500">
                剖面下核心/辐射区/对流区可点选查看科普；外部活动特效已暂时淡出
              </p>
            )}
          </>
        )}
        <label className="mb-1 flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={bloomEnabled}
            onChange={(e) => setBloomEnabled(e.target.checked)}
          />
          泛光效果（Bloom，低性能设备可关闭）
        </label>
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={showPerformance}
            onChange={(e) => setShowPerformance(e.target.checked)}
          />
          性能监控（FPS/内存）
        </label>
      </section>

      {/* 特殊天体演示（需求 3.1.5：支持用户在设置中手动触发超新星）
          R3-8：按钮按视角域外隐藏（取代 R2-4 置灰 + tooltip）；按钮内部
          既有 disabled 逻辑（活跃事件/剖面模式/eventDemoEnabled 域校验，
          R5-8 判定源为离散 viewLevel）保留——可见性与可用性双层 */}
      {anyDemoVisible && (
        <section className="mt-4">
          <h2 className="mb-2 text-xs text-gray-400">动态事件演示</h2>
          {visible('supernovaDemo') && (
            <button
              type="button"
              onClick={handleSupernovaDemo}
              disabled={activeSupernova !== null || !supernovaDemoInScope}
              className={`w-full rounded px-2 py-1.5 text-xs ${
                activeSupernova || !supernovaDemoInScope
                  ? 'cursor-not-allowed bg-white/5 text-gray-500'
                  : 'bg-amber-400/20 text-amber-200 hover:bg-amber-400/30'
              }`}
            >
              {activeSupernova ? '💥 超新星爆发进行中…' : '💥 触发超新星演示（旋臂内随机）'}
            </button>
          )}
          {/* 太阳耀斑/CME 手动演示（S2 §4.3-2/3 触发方式） */}
          {visible('flareDemo') && (
            <button
              type="button"
              onClick={handleFlareDemo}
              disabled={activeSolarFlare !== null || sunCutawayMode || !solarDemoInScope}
              className={`w-full rounded px-2 py-1.5 text-xs ${
                activeSolarFlare || sunCutawayMode || !solarDemoInScope
                  ? 'cursor-not-allowed bg-white/5 text-gray-500'
                  : 'bg-orange-400/20 text-orange-200 hover:bg-orange-400/30'
              }`}
            >
              {activeSolarFlare
                ? `☀️ 耀斑进行中（${activeSolarFlare.flareClass}${activeSolarFlare.magnitude.toFixed(1)} 级）…`
                : sunCutawayMode
                  ? '☀️ 触发太阳耀斑演示（剖面模式下不可用）'
                  : '☀️ 触发太阳耀斑演示（活动区随机）'}
            </button>
          )}
          {visible('cmeDemo') && (
            <button
              type="button"
              onClick={handleCmeDemo}
              disabled={activeCme !== null || sunCutawayMode || !solarDemoInScope}
              className={`mt-2 w-full rounded px-2 py-1.5 text-xs ${
                activeCme || sunCutawayMode || !solarDemoInScope
                  ? 'cursor-not-allowed bg-white/5 text-gray-500'
                  : 'bg-rose-400/20 text-rose-200 hover:bg-rose-400/30'
              }`}
            >
              {activeCme
                ? `🌊 CME 进行中（${Math.round(activeCme.speedKmS)} km/s）…`
                : sunCutawayMode
                  ? '🌊 触发 CME 演示（剖面模式下不可用）'
                  : '🌊 触发日冕物质抛射（CME）演示'}
            </button>
          )}
          {/* 银河系—仙女座碰撞合并快进预览（可选需求 3.1.3） */}
          {visible('mergerDemo') && (
            <>
              <button
                type="button"
                onClick={startMergePreview}
                disabled={mergePreviewActive || !mergerDemoInScope}
                className={`w-full rounded px-2 py-1.5 text-xs ${
                  mergePreviewActive || !mergerDemoInScope
                    ? 'cursor-not-allowed bg-white/5 text-gray-500'
                    : 'bg-sky-400/20 text-sky-200 hover:bg-sky-400/30'
                }`}
              >
                {mergePreviewActive ? '⏩ 合并预览进行中…' : '⏩ 预览银河系—仙女座碰撞合并'}
              </button>
              {mergePreviewReturnSimDays !== null && !mergePreviewActive && (
                <button
                  type="button"
                  onClick={restoreFromMergePreview}
                  className="mt-2 w-full rounded bg-white/10 px-2 py-1.5 text-xs text-gray-200 hover:bg-white/20"
                >
                  ⏪ 恢复预览前时间
                </button>
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
}
