'use client';

/**
 * 流星雨实验室控件面板（M3-5，需求 §3）：页签切换双雨 + 科普卡片 +
 * 主控件（timeScale / hourOffset / limitingMag / observerLat）+ 折叠区
 * （fireballRate / windSpeed）+ 辐射点标注开关 + HUD（地方时/辐射点高度角）。
 *
 * DOM 覆盖层组件（订阅 locale 合法）；全部文案入 i18n 字典，单位符号
 * （× / h / ° / m/s / mag）为国际通用记号由组件层持有（emoji 同规约）。
 * 控件变更零场景重建：仅页签切换触发父级 slots 重建（契约 C2.1）。
 */

import type { JSX, ReactNode } from 'react';
import { useT } from '@/hooks/useI18n';
import type { MessageKey } from '@/i18n';
import { KAPPA_CYGNIDS, PERSEIDS, type MeteorShowerParams } from '@/utils/meteorShower';
import type { LabControlState } from '@/components/Lab/labTypes';

export type MeteorShowerId = MeteorShowerParams['id'];

export interface LabHudState {
  /** 地方时 "HH:MM"（formatClockHHMM 产物） */
  clockText: string;
  /** 辐射点高度角（度，四舍五入） */
  radiantAltDeg: number;
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
}

/** 页签定义（emoji/文案键由组件层持有） */
const SHOWER_TABS: ReadonlyArray<{ id: MeteorShowerId; labelKey: MessageKey }> = [
  { id: 'perseids', labelKey: 'lab.showerPerseids' },
  { id: 'kappaCygnids', labelKey: 'lab.showerKappaCygnids' },
];

/** 母体署名键（科普卡片，需求 §3 控件 1） */
const PARENT_KEYS: Record<MeteorShowerId, MessageKey> = {
  perseids: 'lab.parentPerseids',
  kappaCygnids: 'lab.parentKappaCygnids',
};

export function LabControlPanel({
  showerId,
  onShowerChange,
  settings,
  onSettingsChange,
  hud,
}: LabControlPanelProps): JSX.Element {
  const tr = useT();
  const shower = showerId === 'perseids' ? PERSEIDS : KAPPA_CYGNIDS;

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

      {/* HUD：地方时 + 辐射点高度角 */}
      <p className="mb-2 rounded bg-sky-950/60 px-2 py-1 font-mono text-[11px] text-sky-200">
        {tr('lab.hudLocalTime')} {hud.clockText} · {tr('lab.hudRadiantAlt')} {hud.radiantAltDeg}°
      </p>

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
    </div>
  );
}
