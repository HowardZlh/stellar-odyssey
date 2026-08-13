'use client';

/**
 * 流星雨实验室控件面板（M3-5 + M3.5，需求 §3 / §M3.5）：页签切换双雨 +
 * 科普卡片 + 视角分段（地面｜太空）+ HUD（地方时/辐射点高度角/双倒计时）+
 * 快进/演示按钮（含演示标注文案，时间真实性红线）+ 主控件 + 折叠区 +
 * 辐射点标注/触发时跟随/燃烧层参考开关。
 *
 * DOM 覆盖层组件（订阅 locale 合法）；全部文案入 i18n 字典，单位符号
 * （× / h / ° / m/s / mag）为国际通用记号由组件层持有（emoji 同规约）。
 * 控件变更零场景重建：仅页签切换触发父级 slots 重建（契约 C2.1）；快进/
 * 演示为交互事件路径（写 ref / uniforms，同 C2.1 口径）。
 */

import type { JSX, ReactNode } from 'react';
import { useT } from '@/hooks/useI18n';
import type { MessageKey } from '@/i18n';
import { KAPPA_CYGNIDS, PERSEIDS, type MeteorShowerParams } from '@/utils/meteorShower';
import type { LabControlState, LabViewMode } from '@/components/Lab/labTypes';

export type MeteorShowerId = MeteorShowerParams['id'];

export interface LabHudState {
  /** 地方时 "HH:MM"（formatClockHHMM 产物） */
  clockText: string;
  /** 辐射点高度角（度，四舍五入） */
  radiantAltDeg: number;
  /** 下一颗流星倒计时（真实秒折算，formatDurationClock；无候选/暂停 = "—"） */
  nextMeteorText: string;
  /** 下一颗火流星倒计时（同上，fireballOnly 口径） */
  nextFireballText: string;
}

interface SliderRowProps {
  label: ReactNode;
  /** 当前值展示（含单位记号） */
  display: string;
  value: number;
  min: number;
  max: number;
  step: number;
  ariaLabel: string;
  onChange: (value: number) => void;
}

/** 滑杆行（标签 + 值显示 + range 输入；面板统一行距） */
function SliderRow({
  label,
  display,
  value,
  min,
  max,
  step,
  ariaLabel,
  onChange,
}: SliderRowProps): JSX.Element {
  return (
    <label className="mb-2 block">
      <span className="mb-0.5 flex items-center justify-between">
        <span className="text-gray-300">{label}</span>
        <span className="font-mono text-sky-300">{display}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={ariaLabel}
        onChange={(e) => onChange(Number.parseFloat(e.target.value))}
        className="h-1.5 w-full cursor-pointer accent-sky-400"
      />
    </label>
  );
}

interface LabControlPanelProps {
  showerId: MeteorShowerId;
  onShowerChange: (id: MeteorShowerId) => void;
  settings: LabControlState;
  onSettingsChange: (patch: Partial<LabControlState>) => void;
  hud: LabHudState;
  /** 观测视角档（§M3.5-4：切换只动相机与参考几何，零粒子系统重建） */
  viewMode: LabViewMode;
  onViewModeChange: (mode: LabViewMode) => void;
  /** 快进到下一颗流星/火流星（方案 A 时间真实，§M3.5-2） */
  onFastForward: (fireballOnly: boolean) => void;
  /** 演示触发（方案 B 时间轴外注入，§M3.5-3） */
  onDemo: (fireballOnly: boolean) => void;
  /** 跟随进行中（快进/演示按钮禁用，防状态机重入） */
  followActive: boolean;
  /** 自动运镜进行中（§M3.6-1：aim 期间演示/快进按钮同样禁用） */
  aimActive: boolean;
}

/** 页签定义（emoji/文案键由组件层持有） */
const SHOWER_TABS: ReadonlyArray<{ id: MeteorShowerId; labelKey: MessageKey }> = [
  { id: 'perseids', labelKey: 'lab.showerPerseids' },
  { id: 'kappaCygnids', labelKey: 'lab.showerKappaCygnids' },
];

/** 视角分段定义（§M3.5-4：地面环顾 ｜ 太空俯瞰） */
const VIEW_MODE_TABS: ReadonlyArray<{ id: LabViewMode; labelKey: MessageKey }> = [
  { id: 'ground', labelKey: 'lab.viewGround' },
  { id: 'space', labelKey: 'lab.viewSpace' },
];

/** 母体署名键（科普卡片，需求 §3 控件 1） */
const PARENT_KEYS: Record<MeteorShowerId, MessageKey> = {
  perseids: 'lab.parentPerseids',
  kappaCygnids: 'lab.parentKappaCygnids',
};

/** 小型操作按钮（快进/演示两组共用样式） */
function ActionButton({
  label,
  disabled,
  onClick,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex-1 rounded bg-white/10 px-2 py-1 text-[11px] text-gray-200 transition-colors hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {label}
    </button>
  );
}

export function LabControlPanel({
  showerId,
  onShowerChange,
  settings,
  onSettingsChange,
  hud,
  viewMode,
  onViewModeChange,
  onFastForward,
  onDemo,
  followActive,
  aimActive,
}: LabControlPanelProps): JSX.Element {
  const tr = useT();
  const shower = showerId === 'perseids' ? PERSEIDS : KAPPA_CYGNIDS;
  // 跟随/自动运镜期间快进与演示按钮禁用（状态机防重入，§M3.5-6/§M3.6-1）
  const actionsDisabled = followActive || aimActive;

  return (
    <div className="absolute right-3 top-3 max-h-[calc(100vh-4.5rem)] w-72 max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded-lg bg-black/65 p-3 text-xs text-gray-100 backdrop-blur">
      <h2 className="mb-2 font-semibold text-sky-300">🔭 {tr('lab.panelTitle')}</h2>

      {/* 页签：双流星雨切换（切换 = 换常量组 + 历元 + 一次性重建，契约 C2.1） */}
      <div role="tablist" aria-label={tr('lab.showerTabAria')} className="mb-2 flex gap-1">
        {SHOWER_TABS.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={showerId === tab.id}
            onClick={() => onShowerChange(tab.id)}
            className={`flex-1 rounded px-2 py-1.5 transition-colors ${
              showerId === tab.id
                ? 'bg-sky-500/30 font-semibold text-sky-200'
                : 'bg-white/5 text-gray-400 hover:bg-white/10'
            }`}
          >
            {tr(tab.labelKey)}
          </button>
        ))}
      </div>

      {/* 视角分段：地面环顾 ｜ 太空俯瞰（§M3.5-4，交互事件路径） */}
      <div role="tablist" aria-label={tr('lab.viewModeAria')} className="mb-2 flex gap-1">
        {VIEW_MODE_TABS.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={viewMode === tab.id}
            onClick={() => onViewModeChange(tab.id)}
            className={`flex-1 rounded px-2 py-1 transition-colors ${
              viewMode === tab.id
                ? 'bg-indigo-500/30 font-semibold text-indigo-200'
                : 'bg-white/5 text-gray-400 hover:bg-white/10'
            }`}
          >
            {tr(tab.labelKey)}
          </button>
        ))}
      </div>

      {/* 科普卡片（辐射点/入速/ZHR/母体） */}
      <div className="mb-2 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 rounded bg-white/5 p-2 text-[11px]">
        <span className="text-gray-400">{tr('lab.cardRadiant')}</span>
        <span>
          RA {shower.radiantRaDeg}° · Dec +{shower.radiantDecDeg}°
        </span>
        <span className="text-gray-400">{tr('lab.cardSpeed')}</span>
        <span>{shower.entrySpeedKmPerSec} km/s</span>
        <span className="text-gray-400">{tr('lab.cardZhr')}</span>
        <span>{shower.zhr}</span>
        <span className="text-gray-400">{tr('lab.cardParent')}</span>
        <span>{tr(PARENT_KEYS[showerId])}</span>
      </div>

      {/* HUD：地方时 + 辐射点高度角 + 双倒计时（§M3.5-2，真实秒折算常显） */}
      <div className="mb-2 rounded bg-sky-950/60 px-2 py-1 font-mono text-[11px] text-sky-200">
        <p>
          {tr('lab.hudLocalTime')} {hud.clockText} · {tr('lab.hudRadiantAlt')} {hud.radiantAltDeg}°
        </p>
        <p>
          {tr('lab.hudNextMeteor')} {hud.nextMeteorText} · {tr('lab.hudNextFireball')}{' '}
          {hud.nextFireballText}
        </p>
      </div>

      {/* 快进：跳到真实调度的下一次点燃前 ~1.5 真实秒（方案 A，时间真实——
          时钟/星穹/倒计时自洽前移） */}
      <div className="mb-2 flex gap-1">
        <ActionButton
          label={tr('lab.ffMeteor')}
          disabled={actionsDisabled}
          onClick={() => onFastForward(false)}
        />
        <ActionButton
          label={tr('lab.ffFireball')}
          disabled={actionsDisabled}
          onClick={() => onFastForward(true)}
        />
      </div>

      {/* 演示触发（方案 B）+ 常显标注（时间真实性红线：演示为时间轴外注入） */}
      <div className="mb-1 flex gap-1">
        <ActionButton
          label={tr('lab.demoMeteor')}
          disabled={actionsDisabled}
          onClick={() => onDemo(false)}
        />
        <ActionButton
          label={tr('lab.demoFireball')}
          disabled={actionsDisabled}
          onClick={() => onDemo(true)}
        />
      </div>
      <p className="mb-1 text-[10px] leading-snug text-amber-300/80">{tr('lab.demoDisclaimer')}</p>
      <label className="mb-2 flex items-center gap-2">
        <input
          type="checkbox"
          checked={settings.followOnDemo}
          onChange={(e) => onSettingsChange({ followOnDemo: e.target.checked })}
        />
        <span>{tr('lab.ctrlFollowOnDemo')}</span>
      </label>

      {/* 主控件 */}
      <SliderRow
        label={tr('lab.ctrlTimeScale')}
        display={`×${settings.timeScale.toFixed(1)}`}
        value={settings.timeScale}
        min={0}
        max={10}
        step={0.5}
        ariaLabel={tr('lab.ctrlTimeScale')}
        onChange={(v) => onSettingsChange({ timeScale: v })}
      />
      <SliderRow
        label={tr('lab.ctrlHourOffset')}
        display={`${settings.hourOffset >= 0 ? '+' : ''}${settings.hourOffset.toFixed(2)} h`}
        value={settings.hourOffset}
        min={-6}
        max={6}
        step={0.25}
        ariaLabel={tr('lab.ctrlHourOffset')}
        onChange={(v) => onSettingsChange({ hourOffset: v })}
      />
      <SliderRow
        label={tr('lab.ctrlLimitingMag')}
        display={`mag ${settings.limitingMag.toFixed(1)}`}
        value={settings.limitingMag}
        min={1}
        max={6.5}
        step={0.1}
        ariaLabel={tr('lab.ctrlLimitingMag')}
        onChange={(v) => onSettingsChange({ limitingMag: v })}
      />
      <SliderRow
        label={tr('lab.ctrlObserverLat')}
        display={`${settings.observerLat}°`}
        value={settings.observerLat}
        min={-90}
        max={90}
        step={5}
        ariaLabel={tr('lab.ctrlObserverLat')}
        onChange={(v) => onSettingsChange({ observerLat: v })}
      />

      {/* 高级控件（折叠区） */}
      <details className="mb-1 mt-2">
        <summary className="cursor-pointer select-none text-gray-400 hover:text-gray-200">
          {tr('lab.ctrlAdvanced')}
        </summary>
        <div className="mt-2">
          <SliderRow
            label={tr('lab.ctrlFireballRate')}
            display={settings.fireballRate.toFixed(2)}
            value={settings.fireballRate}
            min={0}
            max={1}
            step={0.05}
            ariaLabel={tr('lab.ctrlFireballRate')}
            onChange={(v) => onSettingsChange({ fireballRate: v })}
          />
          <SliderRow
            label={tr('lab.ctrlWindSpeed')}
            display={`${settings.windSpeed} m/s`}
            value={settings.windSpeed}
            min={0}
            max={100}
            step={5}
            ariaLabel={tr('lab.ctrlWindSpeed')}
            onChange={(v) => onSettingsChange({ windSpeed: v })}
          />
        </div>
      </details>

      {/* 辐射点标注开关 */}
      <label className="mt-1 flex items-center gap-2">
        <input
          type="checkbox"
          checked={settings.showRadiant}
          onChange={(e) => onSettingsChange({ showRadiant: e.target.checked })}
        />
        <span>{tr('lab.ctrlRadiantMarker')}</span>
      </label>

      {/* 燃烧层参考盘开关（§M3.5-5：仅太空档渲染，默认开） */}
      <label className="mt-1 flex items-center gap-2">
        <input
          type="checkbox"
          checked={settings.showBurnLayer}
          onChange={(e) => onSettingsChange({ showBurnLayer: e.target.checked })}
        />
        <span>{tr('lab.ctrlBurnLayer')}</span>
      </label>
    </div>
  );
}
