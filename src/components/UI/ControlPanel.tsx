'use client';


import type { JSX, ReactNode } from 'react';
import { VIEW_LEVELS } from '@/types';
import { VIEW_LEVEL_NAME_KEYS, pickLocalized } from '@/i18n';
import { useT, useTf } from '@/hooks/useI18n';
import { kioskNowSec } from '@/hooks/useKiosk';
import { useSimulationStore } from '@/store';
import { eventDemoEnabled } from '@/utils/eventScopes';
import { panelOptionVisible, type PanelOptionId } from '@/utils/panelScopes';
import {
  GALAXY_EXPAND_GAIN_MAX,
  GALAXY_EXPAND_GAIN_MIN,
  GALAXY_EXPAND_GAIN_STEP,
} from '@/utils/galacticLatitude';
import {
  GALAXY_CATALOG_DISTORTIONS_EN,
  GALAXY_CATALOG_DISTORTIONS_ZH,
  GALAXY_CATALOG_SOURCE_EN,
  GALAXY_CATALOG_SOURCE_ZH,
} from '@/utils/galaxyCatalog';
import { FERMI_BUBBLES_SOURCE_EN, FERMI_BUBBLES_SOURCE_ZH } from '@/utils/fermiBubbles';
import { SN_DEFAULT_DURATION_SEC } from '@/utils/supernova';
import { rollSupernovaParams } from '@/components/Scene/Supernova';
import { rollCmeParams, rollFlareParams } from '@/components/CelestialBody/SunActivity';

/**
 * 显示开关行（M3-1）：桌面 = 原生 checkbox（原样），紧凑视口（max-md）
 * = toggle switch 样式（checkbox 视觉隐藏保留语义，peer-checked 驱动
 * 轨道/滑钮；行高 ≥44pt 触控目标）。
 */
function PanelToggle({
  checked,
  onChange,
  label,
  noMargin,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  /** 桌面态末行无 mb-1（拆分前逐字符对齐） */
  noMargin?: boolean;
}): JSX.Element {
  return (
    <label
      className={`${noMargin ? '' : 'mb-1 '}flex items-center gap-2 text-xs max-md:py-2 max-md:text-sm`}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="peer max-md:absolute max-md:h-0 max-md:w-0 max-md:opacity-0"
      />
      <span
        aria-hidden
        className="relative hidden h-7 w-12 shrink-0 rounded-full bg-white/20 transition-colors after:absolute after:left-0.5 after:top-0.5 after:h-6 after:w-6 after:rounded-full after:bg-white after:transition-transform peer-checked:bg-space-accent peer-checked:after:translate-x-5 max-md:inline-block"
      />
      {label}
    </label>
  );
}

/**
 * 控制面板（需求 3.5.1）：视角锚点 / 模拟速度 / 音效 / 轨道线与标签开关 /
 * 真实比例模式（P2）/ 超新星手动演示（P2，需求 3.1.5 触发方式）/
 * 太阳耀斑与 CME 手动演示 + 太阳剖面模式开关（S2 §4.1/§4.3/§4.5）
 *
 * R3-8：视角专属选项按 panelScopes 注册表域外隐藏（非置灰，取代 R2-4
 * 置灰方案）；判定源 = viewLevel（跟随期间层级锁定选项不闪变）。
 * 仅整理 UI 显示——域外已开启的开关状态与场景效果全部保留。
 *
 * B3 i18n：壳层文案经字典查找（controlPanel.* 键组）。i18n 全站覆盖：
 * 显示开关下方来源/科学说明段（2MRS 来源与失真、费米气泡来源、垂直展开
 * 说明、真实比例说明、剖面说明）豁免解除——经字典键（catalogNote/
 * expandNote/realScaleNote/cutawayNote）与 `*_EN` 来源常量按 locale 取用。
 * 顶部 zh/EN 语言切换钮（B3-D，§0.5#5 位置微调登记：标题行右侧）。
 *
 * M3-1 移动布局：isCompact 下改为底部上滑抽屉（Bottom Sheet，标签栏
 * ☰ 钮开合，store.mobilePanel 互斥位；默认收起，max-h-[60dvh] 内滚），
 * 视角格/事件钮大触控化 + checkbox → toggle switch（max-md 断点承载，
 * PanelToggle）+ 滑块 thumb 28px（globals.css 媒体查询）。桌面
 * （md: 以上）保持 absolute left-4 top-4 w-64 + 把手收起逻辑不变。
 */
export function ControlPanel(): JSX.Element {
  const isCompact = useSimulationStore((s) => s.isCompact);
  return isCompact ? <MobileControlDrawer /> : <DesktopControlPanel />;
}

/** 桌面布局（拆分前原样）：左上固定面板 + 右缘收起把手 */
function DesktopControlPanel(): JSX.Element {
  const tr = useT();
  // UI 布局优化：面板收起态（把手按钮切换；沉浸模式联动收起/展开）
  const collapsed = useSimulationStore((s) => s.controlPanelCollapsed);
  const toggleCollapsed = useSimulationStore((s) => s.toggleControlPanelCollapsed);

  return (
    // 收起时整体向左平移（面板宽 16rem + left-4 的 1rem = 刚好滑出屏幕），
    // 组件不卸载、内部状态保留；右缘把手随动留在屏幕左缘供展开
    <div
      className={`absolute left-4 top-4 w-64 select-none text-sm transition-transform duration-300 ${
        collapsed ? '-translate-x-[calc(100%+1rem)]' : ''
      }`}
    >
      {/* 收起/展开把手（贴面板右缘外侧） */}
      <button
        type="button"
        onClick={toggleCollapsed}
        aria-expanded={!collapsed}
        aria-label={tr(collapsed ? 'controlPanel.expandAria' : 'controlPanel.collapseAria')}
        title={tr(collapsed ? 'controlPanel.expandAria' : 'controlPanel.collapseAria')}
        className="absolute left-full top-0 ml-1 rounded-lg border border-white/10 bg-space-panel px-1.5 py-2.5 text-xs text-gray-400 backdrop-blur transition-colors hover:text-white"
      >
        {collapsed ? '▶' : '◀'}
      </button>
      <div className="rounded-lg bg-space-panel p-4 backdrop-blur" aria-hidden={collapsed}>
        <ControlPanelSections />
      </div>
    </div>
  );
}

/**
 * 移动布局（M3-1）：底部上滑抽屉——标签栏 ☰ 钮开合（store.mobilePanel
 * 互斥位），默认收起；关闭时平移出屏但不卸载（内部状态保留，与桌面
 * 把手收起语义一致）；内容区 max-h-[60dvh] 独立滚动，底部避让标签栏。
 */
function MobileControlDrawer(): JSX.Element {
  const tr = useT();
  const open = useSimulationStore((s) => s.mobilePanel === 'controls');
  const setMobilePanel = useSimulationStore((s) => s.setMobilePanel);

  return (
    <div
      aria-hidden={!open}
      className={`fixed inset-x-0 bottom-[calc(3rem+env(safe-area-inset-bottom))] z-10 select-none transition-transform duration-300 ${
        open ? '' : 'pointer-events-none translate-y-[110%]'
      }`}
    >
      <div className="relative max-h-[60dvh] overflow-y-auto overscroll-contain rounded-t-lg bg-space-panel p-4 pt-3 text-sm backdrop-blur hud-scroll">
        <button
          type="button"
          onClick={() => setMobilePanel(null)}
          aria-label={tr('controlPanel.collapseAria')}
          className="absolute right-1 top-1 flex h-11 w-11 items-center justify-center rounded text-gray-400"
        >
          ✕
        </button>
        <ControlPanelSections />
      </div>
    </div>
  );
}

/** 面板内容分区（桌面/移动抽屉共用；M3 机械搬移，桌面渲染结果不变） */
function ControlPanelSections(): JSX.Element {
  const tr = useT();
  const trf = useTf();
  const locale = useSimulationStore((s) => s.locale);
  const setLocale = useSimulationStore((s) => s.setLocale);
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
  // R5-6：费米气泡（银心双极体积辉光）开关
  const showFermiBubbles = useSimulationStore((s) => s.showFermiBubbles);
  const setShowFermiBubbles = useSimulationStore((s) => s.setShowFermiBubbles);
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

  // B5 §5.1-D 入口 1：展馆模式按钮——用户手势内请求全屏（被拒/不支持
  // 静默降级为不全屏照常巡游，登记）+ 派发状态机 start 事件
  const handleKioskStart = (): void => {
    document.documentElement.requestFullscreen?.()?.catch(() => undefined);
    useSimulationStore.getState().kioskEvent('start', kioskNowSec());
  };

  return (
    <>
      <div className="mb-3 flex items-start justify-between gap-2">
        <h1 className="text-base font-semibold leading-tight text-space-accent">
          {tr('controlPanel.title')}
          <span className="ml-1.5 whitespace-nowrap align-middle text-[10px] font-normal tracking-wide text-gray-400 max-md:text-xs">
            {tr('controlPanel.subtitle')}
          </span>
        </h1>
        {/* B3-D：zh/EN 语言切换（即时生效，仅 DOM 层重渲染） */}
        <div
          role="group"
          aria-label={tr('controlPanel.langAria')}
          className="flex shrink-0 overflow-hidden rounded border border-white/15 text-[10px] leading-none max-md:mr-10 max-md:text-xs"
        >
          <button
            type="button"
            onClick={() => setLocale('zh')}
            aria-pressed={locale === 'zh'}
            className={`px-1.5 py-1 max-md:px-4 max-md:py-3.5 ${
              locale === 'zh' ? 'bg-space-accent text-black' : 'text-gray-400 hover:text-white'
            }`}
          >
            zh
          </button>
          <button
            type="button"
            onClick={() => setLocale('en')}
            aria-pressed={locale === 'en'}
            className={`px-1.5 py-1 max-md:px-4 max-md:py-3.5 ${
              locale === 'en' ? 'bg-space-accent text-black' : 'text-gray-400 hover:text-white'
            }`}
          >
            EN
          </button>
        </div>
      </div>

      {/* 视角锚点 */}
      <section className="mb-4">
        <h2 className="mb-2 text-xs text-gray-400 max-md:text-sm">
          {tr('controlPanel.viewSection')}
        </h2>
        <div className="grid grid-cols-2 gap-2">
          {VIEW_LEVELS.map((level) => (
            <button
              key={level}
              type="button"
              onClick={() => setViewLevel(level)}
              className={`rounded px-2 py-1.5 text-xs transition-colors max-md:py-3 max-md:text-sm ${
                viewLevel === level
                  ? 'bg-space-accent text-black'
                  : 'bg-white/10 text-gray-200 hover:bg-white/20'
              }`}
            >
              {tr(VIEW_LEVEL_NAME_KEYS[level])}
            </button>
          ))}
        </div>
      </section>

      {/* 银河系视角参考系（R2-6 §6.1：G 键银心固定模式显式入口 + 说明；
          R3-8：整个 section 仅 L3 渲染，域外隐藏） */}
      {visible('galacticFrame') && (
        <section className="mb-4">
          <h2 className="mb-2 text-xs text-gray-400 max-md:text-sm">
            {tr('controlPanel.galacticFrameSection')}
          </h2>
          <button
            type="button"
            onClick={toggleGalacticFrameMode}
            title={tr('controlPanel.galacticFrameTitle')}
            className={`w-full rounded px-2 py-1.5 text-xs max-md:py-3 max-md:text-sm ${
              galacticFrameMode === 'galactic-center'
                ? 'bg-emerald-400/90 text-black hover:bg-emerald-300'
                : 'bg-white/10 text-gray-200 hover:bg-white/20'
            }`}
          >
            🌀{' '}
            {galacticFrameMode === 'galactic-center'
              ? tr('controlPanel.galacticFrameOn')
              : tr('controlPanel.galacticFrameOff')}
          </button>
        </section>
      )}

      {/* 时间控制 */}
      <section className="mb-4">
        <h2 className="mb-2 text-xs text-gray-400 max-md:text-sm">
          {tr('controlPanel.speedSection')}
        </h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={togglePaused}
            className="rounded bg-white/10 px-2 py-1 text-xs hover:bg-white/20 max-md:px-3 max-md:py-3 max-md:text-sm"
            aria-label={paused ? tr('controlPanel.resume') : tr('controlPanel.pause')}
          >
            {paused ? `▶ ${tr('controlPanel.resume')}` : `⏸ ${tr('controlPanel.pause')}`}
          </button>
          <span className="text-xs text-gray-300 max-md:text-sm">
            ×{speedMultiplier.toFixed(1)}
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          step={0.5}
          value={speedMultiplier}
          onChange={(e) => setSpeedMultiplier(Number(e.target.value))}
          className="mt-2 w-full"
          aria-label={tr('controlPanel.speedAria')}
        />
      </section>

      {/* 音效控制 */}
      <section className="mb-4">
        <h2 className="mb-2 text-xs text-gray-400 max-md:text-sm">
          {tr('controlPanel.audioSection')}
        </h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={toggleAudio}
            className={`rounded px-2 py-1 text-xs max-md:px-3 max-md:py-3 max-md:text-sm ${
              audioEnabled ? 'bg-space-accent text-black' : 'bg-white/10 hover:bg-white/20'
            }`}
          >
            {audioEnabled ? `🔊 ${tr('controlPanel.audioOn')}` : `🔇 ${tr('controlPanel.audioOff')}`}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={audioVolume}
            onChange={(e) => setAudioVolume(Number(e.target.value))}
            className="w-full"
            aria-label={tr('controlPanel.volumeAria')}
          />
        </div>
      </section>

      {/* 显示开关（M3-1：checkbox 行经 PanelToggle——桌面原生 checkbox
          原样，紧凑视口 toggle switch） */}
      <section>
        <h2 className="mb-2 text-xs text-gray-400 max-md:text-sm">
          {tr('controlPanel.displaySection')}
        </h2>
        <PanelToggle checked={showOrbits} onChange={setShowOrbits} label={tr('controlPanel.orbits')} />
        <PanelToggle
          checked={showLabels}
          onChange={setShowLabels}
          label={tr('controlPanel.bodyLabels')}
        />
        {visible('satelliteOrbits') && (
          <PanelToggle
            checked={showSatelliteOrbits}
            onChange={setShowSatelliteOrbits}
            label={tr('controlPanel.satelliteOrbits')}
          />
        )}
        {visible('youAreHere') && (
          <PanelToggle
            checked={showYouAreHere}
            onChange={setShowYouAreHere}
            label={tr('controlPanel.youAreHere')}
          />
        )}
        {visible('velocityVectors') && (
          <PanelToggle
            checked={showVelocityVectors}
            onChange={setShowVelocityVectors}
            label={tr('controlPanel.velocityVectors')}
          />
        )}
        {visible('galaxyCatalog') && (
          <>
            <PanelToggle
              checked={showGalaxyCatalog}
              onChange={setShowGalaxyCatalog}
              label={tr('controlPanel.galaxyCatalog')}
            />
            {/* i18n：来源说明段按 locale 取用（字典键 + *_EN 常量） */}
            <p className="mb-1 pl-5 text-[10px] leading-4 text-gray-500 max-md:text-xs max-md:leading-5">
              {trf('controlPanel.catalogNote', {
                source: pickLocalized(
                  locale,
                  GALAXY_CATALOG_SOURCE_ZH,
                  GALAXY_CATALOG_SOURCE_EN,
                ),
                distortions: pickLocalized(
                  locale,
                  GALAXY_CATALOG_DISTORTIONS_ZH,
                  GALAXY_CATALOG_DISTORTIONS_EN,
                ),
              })}
            </p>
          </>
        )}
        {visible('fermiBubbles') && (
          <>
            <PanelToggle
              checked={showFermiBubbles}
              onChange={setShowFermiBubbles}
              label={tr('controlPanel.fermiBubbles')}
            />
            {/* i18n：来源说明段按 locale 取用 */}
            <p className="mb-1 pl-5 text-[10px] leading-4 text-gray-500 max-md:text-xs max-md:leading-5">
              {pickLocalized(locale, FERMI_BUBBLES_SOURCE_ZH, FERMI_BUBBLES_SOURCE_EN)}
            </p>
          </>
        )}
        {visible('verticalExpand') && (
          <>
            <PanelToggle
              checked={galaxyVerticalExpand}
              onChange={setGalaxyVerticalExpand}
              label={tr('controlPanel.verticalExpand')}
            />
            {galaxyVerticalExpand && (
              <div className="mb-1 pl-5">
                <label className="flex items-center gap-2 text-[10px] text-gray-400 max-md:text-xs">
                  {tr('controlPanel.expandGain')} ×{galaxyExpandGain.toFixed(1)}
                  <input
                    type="range"
                    min={GALAXY_EXPAND_GAIN_MIN}
                    max={GALAXY_EXPAND_GAIN_MAX}
                    step={GALAXY_EXPAND_GAIN_STEP}
                    value={galaxyExpandGain}
                    onChange={(e) => setGalaxyExpandGain(Number(e.target.value))}
                    className="flex-1"
                    aria-label={tr('controlPanel.expandGainAria')}
                  />
                </label>
                {/* i18n：开关下方科学说明段按 locale 取用 */}
                <p className="text-[10px] leading-4 text-gray-500 max-md:text-xs max-md:leading-5">
                  {tr('controlPanel.expandNote')}
                </p>
              </div>
            )}
          </>
        )}
        <PanelToggle
          checked={realScaleMode}
          onChange={setRealScaleMode}
          label={tr('controlPanel.realScale')}
        />
        {realScaleMode && (
          /* i18n：开关下方科学说明段按 locale 取用 */
          <p className="mb-1 pl-5 text-[10px] leading-4 text-gray-500 max-md:text-xs max-md:leading-5">
            {tr('controlPanel.realScaleNote')}
          </p>
        )}
        {visible('sunCutaway') && (
          <>
            <PanelToggle
              checked={sunCutawayMode}
              onChange={setSunCutawayMode}
              label={tr('controlPanel.sunCutaway')}
            />
            {sunCutawayMode && (
              /* i18n：开关下方科学说明段按 locale 取用 */
              <p className="mb-1 pl-5 text-[10px] leading-4 text-gray-500 max-md:text-xs max-md:leading-5">
                {tr('controlPanel.cutawayNote')}
              </p>
            )}
          </>
        )}
        <PanelToggle
          checked={bloomEnabled}
          onChange={setBloomEnabled}
          label={tr('controlPanel.bloom')}
        />
        <PanelToggle
          checked={showPerformance}
          onChange={setShowPerformance}
          label={tr('controlPanel.performance')}
          noMargin
        />
      </section>

      {/* 展馆模式（B5 §5.1-D：启动即隐 UI 自动巡游，任意输入暂停；
          暂停角标 KioskBadge 提供退出入口） */}
      <section className="mt-4">
        <h2 className="mb-2 text-xs text-gray-400 max-md:text-sm">
          {tr('controlPanel.kioskSection')}
        </h2>
        <button
          type="button"
          onClick={handleKioskStart}
          className="w-full rounded bg-space-accent/20 px-2 py-1.5 text-xs text-space-accent hover:bg-space-accent/30 max-md:py-3 max-md:text-sm"
        >
          🎪 {tr('controlPanel.kioskStart')}
        </button>
        <p className="mt-1 text-[10px] leading-4 text-gray-500 max-md:text-xs max-md:leading-5">
          {tr('controlPanel.kioskNote')}
        </p>
      </section>

      {/* 特殊天体演示（需求 3.1.5：支持用户在设置中手动触发超新星）
          R3-8：按钮按视角域外隐藏（取代 R2-4 置灰 + tooltip）；按钮内部
          既有 disabled 逻辑（活跃事件/剖面模式/eventDemoEnabled 域校验，
          R5-8 判定源为离散 viewLevel）保留——可见性与可用性双层 */}
      {anyDemoVisible && (
        <section className="mt-4">
          <h2 className="mb-2 text-xs text-gray-400 max-md:text-sm">
            {tr('controlPanel.demoSection')}
          </h2>
          {visible('supernovaDemo') && (
            <button
              type="button"
              onClick={handleSupernovaDemo}
              disabled={activeSupernova !== null || !supernovaDemoInScope}
              className={`w-full rounded px-2 py-1.5 text-xs max-md:py-3 max-md:text-sm ${
                activeSupernova || !supernovaDemoInScope
                  ? 'cursor-not-allowed bg-white/5 text-gray-500'
                  : 'bg-amber-400/20 text-amber-200 hover:bg-amber-400/30'
              }`}
            >
              💥{' '}
              {activeSupernova
                ? tr('controlPanel.supernovaActive')
                : tr('controlPanel.supernovaTrigger')}
            </button>
          )}
          {/* 太阳耀斑/CME 手动演示（S2 §4.3-2/3 触发方式） */}
          {visible('flareDemo') && (
            <button
              type="button"
              onClick={handleFlareDemo}
              disabled={activeSolarFlare !== null || sunCutawayMode || !solarDemoInScope}
              className={`w-full rounded px-2 py-1.5 text-xs max-md:py-3 max-md:text-sm ${
                activeSolarFlare || sunCutawayMode || !solarDemoInScope
                  ? 'cursor-not-allowed bg-white/5 text-gray-500'
                  : 'bg-orange-400/20 text-orange-200 hover:bg-orange-400/30'
              }`}
            >
              ☀️{' '}
              {activeSolarFlare
                ? trf('controlPanel.flareActive', {
                    cls: activeSolarFlare.flareClass,
                    mag: activeSolarFlare.magnitude.toFixed(1),
                  })
                : sunCutawayMode
                  ? tr('controlPanel.flareCutawayDisabled')
                  : tr('controlPanel.flareTrigger')}
            </button>
          )}
          {visible('cmeDemo') && (
            <button
              type="button"
              onClick={handleCmeDemo}
              disabled={activeCme !== null || sunCutawayMode || !solarDemoInScope}
              className={`mt-2 w-full rounded px-2 py-1.5 text-xs max-md:py-3 max-md:text-sm ${
                activeCme || sunCutawayMode || !solarDemoInScope
                  ? 'cursor-not-allowed bg-white/5 text-gray-500'
                  : 'bg-rose-400/20 text-rose-200 hover:bg-rose-400/30'
              }`}
            >
              🌊{' '}
              {activeCme
                ? trf('controlPanel.cmeActive', { speed: Math.round(activeCme.speedKmS) })
                : sunCutawayMode
                  ? tr('controlPanel.cmeCutawayDisabled')
                  : tr('controlPanel.cmeTrigger')}
            </button>
          )}
          {/* 银河系—仙女座碰撞合并快进预览（可选需求 3.1.3） */}
          {visible('mergerDemo') && (
            <>
              <button
                type="button"
                onClick={startMergePreview}
                disabled={mergePreviewActive || !mergerDemoInScope}
                className={`w-full rounded px-2 py-1.5 text-xs max-md:py-3 max-md:text-sm ${
                  mergePreviewActive || !mergerDemoInScope
                    ? 'cursor-not-allowed bg-white/5 text-gray-500'
                    : 'bg-sky-400/20 text-sky-200 hover:bg-sky-400/30'
                }`}
              >
                ⏩{' '}
                {mergePreviewActive
                  ? tr('controlPanel.mergerActive')
                  : tr('controlPanel.mergerTrigger')}
              </button>
              {mergePreviewReturnSimDays !== null && !mergePreviewActive && (
                <button
                  type="button"
                  onClick={restoreFromMergePreview}
                  className="mt-2 w-full rounded bg-white/10 px-2 py-1.5 text-xs text-gray-200 hover:bg-white/20 max-md:py-3 max-md:text-sm"
                >
                  ⏪ {tr('controlPanel.mergerRestore')}
                </button>
              )}
            </>
          )}
        </section>
      )}
    </>
  );
}
