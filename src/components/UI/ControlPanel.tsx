'use client';

import { VIEW_LEVELS } from '@/types';
import { CAMERA_VIEWS } from '@/data/cameraViews';
import { useSimulationStore } from '@/store';
import { eventDemoDisabledHintZh, eventDemoEnabled } from '@/utils/eventScopes';
import {
  GALAXY_EXPAND_GAIN_MAX,
  GALAXY_EXPAND_GAIN_MIN,
  GALAXY_EXPAND_GAIN_STEP,
} from '@/utils/galacticLatitude';
import { SN_DEFAULT_DURATION_SEC } from '@/utils/supernova';
import { rollSupernovaParams } from '@/components/Scene/Supernova';
import { rollCmeParams, rollFlareParams } from '@/components/CelestialBody/SunActivity';

/**
 * 控制面板（需求 3.5.1）：视角锚点 / 模拟速度 / 音效 / 轨道线与标签开关 /
 * 真实比例模式（P2）/ 超新星手动演示（P2，需求 3.1.5 触发方式）/
 * 太阳耀斑与 CME 手动演示 + 太阳剖面模式开关（S2 §4.1/§4.3/§4.5）
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
  // R2-4 §4.1-C：演示按钮按视角域门控（选布尔值，仅域边界跨越时重渲染；
  // 耀斑/CME 同属太阳系域窗口共用一个判定；方案取"置灰 + tooltip 提示"）
  const solarDemoInScope = useSimulationStore((s) =>
    eventDemoEnabled('flare', s.continuousLevel),
  );
  const supernovaDemoInScope = useSimulationStore((s) =>
    eventDemoEnabled('supernova', s.continuousLevel),
  );
  const mergerDemoInScope = useSimulationStore((s) =>
    eventDemoEnabled('merger', s.continuousLevel),
  );

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
      <h1 className="mb-3 text-base font-semibold text-space-accent">星系运动可视化</h1>

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

      {/* 银河系视角参考系（R2-6 §6.1：G 键银心固定模式显式入口 + 说明） */}
      <section className="mb-4">
        <h2 className="mb-2 text-xs text-gray-400">银河系视角参考系（G 切换）</h2>
        <button
          type="button"
          onClick={toggleGalacticFrameMode}
          disabled={viewLevel !== 'L3'}
          title={
            viewLevel === 'L3'
              ? '银心固定：银心居中不动，俯瞰太阳系沿波浪轨道绕银心公转'
              : '请切换到银河系视角使用（快捷键 3）'
          }
          className={`w-full rounded px-2 py-1.5 text-xs ${
            viewLevel !== 'L3'
              ? 'cursor-not-allowed bg-white/5 text-gray-500'
              : galacticFrameMode === 'galactic-center'
                ? 'bg-emerald-400/90 text-black hover:bg-emerald-300'
                : 'bg-white/10 text-gray-200 hover:bg-white/20'
          }`}
        >
          {viewLevel !== 'L3'
            ? '🌀 银心固定视角（银河系视角下可用）'
            : galacticFrameMode === 'galactic-center'
              ? '🌀 银心固定中（点按回到跟随太阳系）'
              : '🌀 切换银心固定视角（观察太阳系公转）'}
        </button>
      </section>

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
        <label className="mb-1 flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={showSatelliteOrbits}
            onChange={(e) => setShowSatelliteOrbits(e.target.checked)}
          />
          卫星轨道线
        </label>
        <label className="mb-1 flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={showYouAreHere}
            onChange={(e) => setShowYouAreHere(e.target.checked)}
          />
          You are here 标记
        </label>
        <label className="mb-1 flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={showVelocityVectors}
            onChange={(e) => setShowVelocityVectors(e.target.checked)}
          />
          速度矢量箭头
        </label>
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

      {/* 特殊天体演示（需求 3.1.5：支持用户在设置中手动触发超新星） */}
      <section className="mt-4">
        <h2 className="mb-2 text-xs text-gray-400">动态事件演示</h2>
        {/* R2-4 §4.1-C：视角域外置灰禁用 + tooltip"请切换到 XX 视角触发" */}
        <button
          type="button"
          onClick={handleSupernovaDemo}
          disabled={activeSupernova !== null || !supernovaDemoInScope}
          title={supernovaDemoInScope ? undefined : eventDemoDisabledHintZh('supernova')}
          className={`w-full rounded px-2 py-1.5 text-xs ${
            activeSupernova || !supernovaDemoInScope
              ? 'cursor-not-allowed bg-white/5 text-gray-500'
              : 'bg-amber-400/20 text-amber-200 hover:bg-amber-400/30'
          }`}
        >
          {activeSupernova
            ? '💥 超新星爆发进行中…'
            : supernovaDemoInScope
              ? '💥 触发超新星演示（旋臂内随机）'
              : `💥 超新星演示（${eventDemoDisabledHintZh('supernova')}）`}
        </button>
        {/* 太阳耀斑/CME 手动演示（S2 §4.3-2/3 触发方式） */}
        <button
          type="button"
          onClick={handleFlareDemo}
          disabled={activeSolarFlare !== null || sunCutawayMode || !solarDemoInScope}
          title={solarDemoInScope ? undefined : eventDemoDisabledHintZh('flare')}
          className={`mt-2 w-full rounded px-2 py-1.5 text-xs ${
            activeSolarFlare || sunCutawayMode || !solarDemoInScope
              ? 'cursor-not-allowed bg-white/5 text-gray-500'
              : 'bg-orange-400/20 text-orange-200 hover:bg-orange-400/30'
          }`}
        >
          {activeSolarFlare
            ? `☀️ 耀斑进行中（${activeSolarFlare.flareClass}${activeSolarFlare.magnitude.toFixed(1)} 级）…`
            : sunCutawayMode
              ? '☀️ 触发太阳耀斑演示（剖面模式下不可用）'
              : solarDemoInScope
                ? '☀️ 触发太阳耀斑演示（活动区随机）'
                : `☀️ 耀斑演示（${eventDemoDisabledHintZh('flare')}）`}
        </button>
        <button
          type="button"
          onClick={handleCmeDemo}
          disabled={activeCme !== null || sunCutawayMode || !solarDemoInScope}
          title={solarDemoInScope ? undefined : eventDemoDisabledHintZh('cme')}
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
              : solarDemoInScope
                ? '🌊 触发日冕物质抛射（CME）演示'
                : `🌊 CME 演示（${eventDemoDisabledHintZh('cme')}）`}
        </button>
        {/* 银河系—仙女座碰撞合并快进预览（可选需求 3.1.3；
            R2-4 §4.1-C：按默认方案改为域外置灰——此前点击会由
            startMergePreview 自动切到 L4，行为变更已登记需求文档 */}
        <button
          type="button"
          onClick={startMergePreview}
          disabled={mergePreviewActive || !mergerDemoInScope}
          title={mergerDemoInScope ? undefined : eventDemoDisabledHintZh('merger')}
          className={`mt-2 w-full rounded px-2 py-1.5 text-xs ${
            mergePreviewActive || !mergerDemoInScope
              ? 'cursor-not-allowed bg-white/5 text-gray-500'
              : 'bg-sky-400/20 text-sky-200 hover:bg-sky-400/30'
          }`}
        >
          {mergePreviewActive
            ? '⏩ 合并预览进行中…'
            : mergerDemoInScope
              ? '⏩ 预览银河系—仙女座碰撞合并'
              : `⏩ 合并预览（${eventDemoDisabledHintZh('merger')}）`}
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
      </section>
    </div>
  );
}
