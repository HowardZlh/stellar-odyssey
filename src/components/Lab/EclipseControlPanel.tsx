'use client';

/**
 * 日全食实验室控件面板（E-M3-6，需求 §3.2/§3.3/§3.4）
 *
 * DOM 覆盖层组件（订阅 locale 合法）；一切数值状态由父级持有（React state
 * → settingsRef → Canvas useFrame 读 ref，流星雨范式），本组件只渲染控件
 * 与回调——零内联可测逻辑（§7）。
 *
 * 分区：播放模式（导览变速/×1，登记 A1）· 曝光（契约 C5：自动/手动 + 滑杆
 * + A2 科普卡）· 太阳活动周（isotropy01 → 日冕形态）· 假想模式（§3.3 月地
 * 距离滑杆，与真实时间轴互斥）· 99%/100% 天光断崖对比 · 环境数值条（§1.4）
 * · 阶段科普卡（§3.1 五接触点 + 安全口径）。
 *
 * 移动端条款基线：可点元素 max-md:min-h-11（全量适配随 M6）。
 */

import type { JSX } from 'react';
import { useT } from '@/hooks/useI18n';
import type { MessageKey } from '@/i18n';
import {
  HYPO_MOON_DIST_MAX_KM,
  HYPO_MOON_DIST_MIN_KM,
  type EclipseExposureMode,
  type EclipsePhaseCardKey,
  type EclipsePlayMode,
} from '@/utils/solarEclipseLab';

/** M3 控件状态（父级 React state；渲染期同步 settingsRef 供 useFrame 读） */
export interface EclipseM3Settings {
  /** 播放模式（§3.1：导览变速 / ×1 真实速度） */
  playMode: EclipsePlayMode;
  /** 曝光档（契约 C5：自动 = C2/C3 跨越切换基准） */
  exposureMode: EclipseExposureMode;
  /** 手动曝光插值（0 = filtered ↔ 1 = naked-eye） */
  exposureManual01: number;
  /** 太阳活动周（0 极小年赤道长冕流 ↔ 1 极大年圆胖，§3.3） */
  isotropy01: number;
  /** 假想模式开关（§3.3：与真实时间轴互斥，HUD 明示） */
  hypoActive: boolean;
  /** 假想月地距离（km，363,104–405,696） */
  hypoMoonDistKm: number;
}

/** 环境数值条读数（父级 500ms tick 经纯函数计算后的展示文本） */
export interface EclipseEnvReadout {
  tempText: string;
  skyText: string;
  lmText: string;
}

/** 阶段科普卡键 → i18n 文案键 */
const PHASE_CARD_KEYS: Record<EclipsePhaseCardKey, MessageKey> = {
  c1: 'lab.eclipseCardC1',
  c2: 'lab.eclipseCardC2',
  max: 'lab.eclipseCardMax',
  c3: 'lab.eclipseCardC3',
  c4: 'lab.eclipseCardC4',
};

/** 阶段科普卡键 → 标题键（复用锚点名） */
const PHASE_CARD_TITLE_KEYS: Record<EclipsePhaseCardKey, MessageKey> = {
  c1: 'lab.eclipseAnchorC1',
  c2: 'lab.eclipseAnchorC2',
  max: 'lab.eclipseAnchorMax',
  c3: 'lab.eclipseAnchorC3',
  c4: 'lab.eclipseAnchorC4',
};

export interface EclipseControlPanelProps {
  settings: EclipseM3Settings;
  onChange: (patch: Partial<EclipseM3Settings>) => void;
  env: EclipseEnvReadout;
  /** 当前阶段科普卡（activePhaseCardKey 纯函数判定） */
  phaseCardKey: EclipsePhaseCardKey;
  /** 99%/100% 一键对比（父级 seek 到对应时刻并暂停） */
  onCompare: (which: '99' | '100') => void;
}

/** 分区标题（统一样式） */
function SectionTitle({ text }: { text: string }): JSX.Element {
  return (
    <div className="mb-1 mt-2 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
      {text}
    </div>
  );
}

/** 双选分段按钮（播放模式/曝光档共用） */
function Segmented({
  ariaLabel,
  options,
  value,
  onSelect,
}: {
  ariaLabel: string;
  options: ReadonlyArray<{ id: string; label: string }>;
  value: string;
  onSelect: (id: string) => void;
}): JSX.Element {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="flex gap-1">
      {options.map((opt) => (
        <button
          key={opt.id}
          role="radio"
          aria-checked={value === opt.id}
          onClick={() => onSelect(opt.id)}
          className={`flex-1 rounded px-1 py-1 text-[10px] leading-tight transition-colors max-md:min-h-11 ${
            value === opt.id
              ? 'bg-sky-500/30 font-semibold text-sky-200'
              : 'bg-white/5 text-gray-400 hover:bg-white/10'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

/** 日全食控件面板（右侧覆盖层；桌面全量，移动端抽屉随 M6） */
export function EclipseControlPanel({
  settings,
  onChange,
  env,
  phaseCardKey,
  onCompare,
}: EclipseControlPanelProps): JSX.Element {
  const tr = useT();

  return (
    <div className="text-xs text-gray-100">
      {/* 播放模式（A1 登记：HUD 常显真实时刻与倍速） */}
      <SectionTitle text={tr('lab.eclipsePlayModeAria')} />
      <Segmented
        ariaLabel={tr('lab.eclipsePlayModeAria')}
        options={[
          { id: 'tour', label: tr('lab.eclipsePlayModeTour') },
          { id: 'real', label: tr('lab.eclipsePlayModeReal') },
        ]}
        value={settings.playMode}
        onSelect={(id) => onChange({ playMode: id as EclipsePlayMode })}
      />

      {/* 曝光状态机（契约 C5） */}
      <SectionTitle text={tr('lab.eclipseExposureTitle')} />
      <Segmented
        ariaLabel={tr('lab.eclipseExposureTitle')}
        options={[
          { id: 'auto', label: tr('lab.eclipseExposureAuto') },
          { id: 'manual', label: tr('lab.eclipseExposureManual') },
        ]}
        value={settings.exposureMode}
        onSelect={(id) => onChange({ exposureMode: id as EclipseExposureMode })}
      />
      {settings.exposureMode === 'manual' && (
        <div className="mt-1 flex items-center gap-1.5">
          <span className="text-[10px] text-gray-400">{tr('lab.eclipseExposureFiltered')}</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={settings.exposureManual01}
            aria-label={tr('lab.eclipseExposureSliderAria')}
            onChange={(e) => onChange({ exposureManual01: Number.parseFloat(e.target.value) })}
            className="h-1.5 flex-1 cursor-pointer accent-sky-400"
          />
          <span className="text-[10px] text-gray-400">{tr('lab.eclipseExposureNaked')}</span>
        </div>
      )}
      {/* 曝光科普卡（A2 登记：色调映射非线性，6 个数量级） */}
      <p className="mt-1 rounded bg-white/5 px-2 py-1 text-[10px] leading-snug text-gray-400">
        {tr('lab.eclipseExposureCard')}
      </p>

      {/* 太阳活动周滑杆（isotropy01 → 日冕形态连续变形） */}
      <SectionTitle text={tr('lab.eclipseActivityTitle')} />
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] text-gray-400">{tr('lab.eclipseActivityMin')}</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={settings.isotropy01}
          aria-label={tr('lab.eclipseActivityAria')}
          onChange={(e) => onChange({ isotropy01: Number.parseFloat(e.target.value) })}
          className="h-1.5 flex-1 cursor-pointer accent-sky-400"
        />
        <span className="text-[10px] text-gray-400">{tr('lab.eclipseActivityMax')}</span>
      </div>

      {/* 假想模式（月地距离滑杆全食 ↔ 环食连续退化；与真实时间轴互斥） */}
      <SectionTitle text={tr('lab.eclipseHypoTitle')} />
      <button
        aria-label={tr('lab.eclipseHypoToggleAria')}
        aria-pressed={settings.hypoActive}
        onClick={() => onChange({ hypoActive: !settings.hypoActive })}
        className={`w-full rounded px-2 py-1 text-[10px] transition-colors max-md:min-h-11 ${
          settings.hypoActive
            ? 'bg-amber-500/30 font-semibold text-amber-200'
            : 'bg-white/5 text-gray-400 hover:bg-white/10'
        }`}
      >
        {tr('lab.eclipseHypoTitle')}：{settings.hypoActive ? 'ON' : 'OFF'}
      </button>
      {settings.hypoActive && (
        <div className="mt-1">
          <div className="flex items-center justify-between text-[10px] text-gray-400">
            <span>{tr('lab.eclipseHypoMoonDist')}</span>
            <span className="font-mono text-amber-200">
              {Math.round(settings.hypoMoonDistKm).toLocaleString('en-US')} km
            </span>
          </div>
          <input
            type="range"
            min={HYPO_MOON_DIST_MIN_KM}
            max={HYPO_MOON_DIST_MAX_KM}
            step={100}
            value={settings.hypoMoonDistKm}
            aria-label={tr('lab.eclipseHypoMoonDistAria')}
            onChange={(e) => onChange({ hypoMoonDistKm: Number.parseFloat(e.target.value) })}
            className="h-1.5 w-full cursor-pointer accent-amber-400"
          />
        </div>
      )}

      {/* 99%/100% 天光断崖对比 */}
      <SectionTitle text={tr('lab.eclipseCompareTitle')} />
      <div className="flex gap-1">
        <button
          onClick={() => onCompare('99')}
          className="flex-1 rounded bg-white/5 px-1 py-1 text-[10px] text-gray-300 transition-colors hover:bg-white/15 max-md:min-h-11"
        >
          {tr('lab.eclipseCompare99')}
        </button>
        <button
          onClick={() => onCompare('100')}
          className="flex-1 rounded bg-white/5 px-1 py-1 text-[10px] text-gray-300 transition-colors hover:bg-white/15 max-md:min-h-11"
        >
          {tr('lab.eclipseCompare100')}
        </button>
      </div>

      {/* 环境数值条（§1.4） */}
      <SectionTitle text={tr('lab.eclipseEnvTitle')} />
      <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 rounded bg-white/5 px-2 py-1 font-mono text-[10px] text-gray-300">
        <span className="text-gray-500">{tr('lab.eclipseEnvTemp')}</span>
        <span>{env.tempText}</span>
        <span className="text-gray-500">{tr('lab.eclipseEnvSky')}</span>
        <span>{env.skyText}</span>
        <span className="text-gray-500">{tr('lab.eclipseEnvLm')}</span>
        <span>{env.lmText}</span>
      </div>

      {/* 阶段科普卡（§3.1；C2/C3 含安全口径） */}
      <SectionTitle text={tr(PHASE_CARD_TITLE_KEYS[phaseCardKey])} />
      <p className="rounded bg-sky-950/50 px-2 py-1.5 text-[10px] leading-relaxed text-gray-300">
        {tr(PHASE_CARD_KEYS[phaseCardKey])}
      </p>
    </div>
  );
}
