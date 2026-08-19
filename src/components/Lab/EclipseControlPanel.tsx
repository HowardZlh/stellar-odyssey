"use client";

/**
 * 日全食实验室控件面板（E-M3-6，需求 §3.2/§3.3/§3.4）
 *
 * DOM 覆盖层组件（订阅 locale 合法）；一切数值状态由父级持有（React state
 * → settingsRef → Canvas useFrame 读 ref，流星雨范式），本组件只渲染控件
 * 与回调——零内联可测逻辑（§7）。
 *
 * 分区：视角（M4：地面/太空分段控件 + 太空专属开关）· 播放模式（导览变速
 * /×1，登记 A1）· 曝光（契约 C5：自动/手动 + 滑杆 + A2 科普卡）· 太阳活动周
 * （isotropy01 → 日冕形态）· 假想模式（§3.3 月地距离滑杆，与真实时间轴互斥）
 * · 99%/100% 天光断崖对比 · 环境数值条（§1.4）· 阶段科普卡（§3.1 五接触点
 * + 安全口径）· 太空视角科普卡（A3 距离压缩/影锥可见性登记）。
 *
 * 移动端条款（M6 全量）：可点元素 max-md:min-h-11；<sm 底部抽屉由父级
 * 容器（SolarEclipseLab 右上面板 → 底部抽屉）承载，本组件不做布局分流。
 */

import type { JSX } from "react";
import { useT } from "@/hooks/useI18n";
import { useSimulationStore } from "@/store";
import type { MessageKey } from "@/i18n";
import {
  HYPO_MOON_DIST_MAX_KM,
  HYPO_MOON_DIST_MIN_KM,
  type EclipseExposureMode,
  type EclipsePhaseCardKey,
  type EclipsePlayMode,
} from "@/utils/solarEclipseLab";
import type {
  EclipseBodyScaleMode,
  EclipseViewMode,
} from "@/utils/solarEclipseSpace";

/** M3+M4 控件状态（父级 React state；渲染期同步 settingsRef 供 useFrame 读） */
export interface EclipseM3Settings {
  /** 视角档（M4 §3.2：地面 / 太空；切换触发 1–2s 运镜） */
  viewMode: EclipseViewMode;
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
  /** 本影放大 ×N 开关（M4；A4 登记：默认关 = 真实比例，HUD 注明倍率） */
  umbraMagnify: boolean;
  /** 倾角叙事模式（M4-4；A5 登记：倾角夸张显示，HUD 标真实值与倍率） */
  inclinationDemo: boolean;
  /** 月球放大 ×4 开关（M7-3；A16 登记：**默认开**，徽标常显倍率，锥基随动） */
  moonMagnify: boolean;
  /** 行星轨道远景层（M7-4；A17 登记：**默认开**，距离压缩艺术化科普卡常显） */
  planetOrbits: boolean;
  /** 天体比例档（M8-1；A18 登记：**默认艺术化** = L2 观感；真实档 = M7 形态） */
  bodyScaleMode: EclipseBodyScaleMode;
  /** 星光偏折对照（M5-2；A10 登记：偏折夸张显示，HUD 标真实角秒值与倍率） */
  deflectionDemo: boolean;
}

/** 环境数值条读数（父级 500ms tick 经纯函数计算后的展示文本） */
export interface EclipseEnvReadout {
  tempText: string;
  skyText: string;
  lmText: string;
}

/** 阶段科普卡键 → i18n 文案键 */
const PHASE_CARD_KEYS: Record<EclipsePhaseCardKey, MessageKey> = {
  c1: "lab.eclipseCardC1",
  c2: "lab.eclipseCardC2",
  max: "lab.eclipseCardMax",
  c3: "lab.eclipseCardC3",
  c4: "lab.eclipseCardC4",
};

/** 阶段科普卡键 → 标题键（复用锚点名） */
const PHASE_CARD_TITLE_KEYS: Record<EclipsePhaseCardKey, MessageKey> = {
  c1: "lab.eclipseAnchorC1",
  c2: "lab.eclipseAnchorC2",
  max: "lab.eclipseAnchorMax",
  c3: "lab.eclipseAnchorC3",
  c4: "lab.eclipseAnchorC4",
};

export interface EclipseControlPanelProps {
  settings: EclipseM3Settings;
  onChange: (patch: Partial<EclipseM3Settings>) => void;
  env: EclipseEnvReadout;
  /** 当前阶段科普卡（activePhaseCardKey 纯函数判定） */
  phaseCardKey: EclipsePhaseCardKey;
  /** 99%/100% 一键对比（父级 seek 到对应时刻并暂停） */
  onCompare: (which: "99" | "100") => void;
  /** M5：当前为 1919 Eddington 历史页签（显示偏折对照控件 + 科学史科普卡） */
  eddington: boolean;
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
              ? "bg-sky-500/30 font-semibold text-sky-200"
              : "bg-white/5 text-gray-400 hover:bg-white/10"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

/** 日全食控件面板（右侧覆盖层；<sm 抽屉化由父级容器承载，M6） */
export function EclipseControlPanel({
  settings,
  onChange,
  env,
  phaseCardKey,
  onCompare,
  eddington,
}: EclipseControlPanelProps): JSX.Element {
  const tr = useT();
  // 声景开关/音量（M6-1 §5：全局 store 与主场景/流星雨同一事实源，
  // masterGain 链天然承接静音；LabControlPanel 音效区同范式）
  const audioEnabled = useSimulationStore((s) => s.audioEnabled);
  const audioVolume = useSimulationStore((s) => s.audioVolume);
  const setAudioEnabled = useSimulationStore((s) => s.setAudioEnabled);
  const setAudioVolume = useSimulationStore((s) => s.setAudioVolume);

  return (
    <div className="text-xs text-gray-100">
      {/* 视角分段控件（M4 §3.2：地面 / 太空） */}
      <SectionTitle text={tr("lab.eclipseViewTitle")} />
      <Segmented
        ariaLabel={tr("lab.eclipseViewAria")}
        options={[
          { id: "ground", label: tr("lab.eclipseViewGround") },
          { id: "space", label: tr("lab.eclipseViewSpace") },
        ]}
        value={settings.viewMode}
        onSelect={(id) => onChange({ viewMode: id as EclipseViewMode })}
      />
      {settings.viewMode === "space" && (
        <>
          {/* M8-1 天体比例分段（A18：默认艺术化 = L2 观感；真实 = M7 形态） */}
          <div className="mt-1">
            <Segmented
              ariaLabel={tr("lab.eclipseBodyScaleAria")}
              options={[
                { id: "art", label: tr("lab.eclipseBodyScaleArt") },
                { id: "real", label: tr("lab.eclipseBodyScaleReal") },
              ]}
              value={settings.bodyScaleMode}
              onSelect={(id) =>
                onChange({ bodyScaleMode: id as EclipseBodyScaleMode })
              }
            />
          </div>
          {settings.bodyScaleMode === "art" && (
            <p className="mt-1 rounded bg-white/5 px-2 py-1 text-[10px] leading-snug text-gray-400">
              {tr("lab.eclipseBodyScaleCard")}
            </p>
          )}
          {/* M7-3 月球放大（A16：默认开；徽标常显倍率）+ 本影放大（A4：
              默认关 = 真实比例；标签含倍率）——仅真实档显示（艺术化档整体
              放大接管，两开关隐藏防叠加混淆，A18 差异登记） */}
          {settings.bodyScaleMode === "real" && (
          <div className="mt-1 flex gap-1">
            <button
              aria-label={tr("lab.eclipseMoonMagnifyAria")}
              aria-pressed={settings.moonMagnify}
              onClick={() => onChange({ moonMagnify: !settings.moonMagnify })}
              className={`flex-1 rounded px-1 py-1 text-[10px] leading-tight transition-colors max-md:min-h-11 ${
                settings.moonMagnify
                  ? "bg-amber-500/30 font-semibold text-amber-200"
                  : "bg-white/5 text-gray-400 hover:bg-white/10"
              }`}
            >
              {tr("lab.eclipseMoonMagnifyLabel")}：
              {settings.moonMagnify ? "ON" : "OFF"}
            </button>
            <button
              aria-label={tr("lab.eclipseUmbraMagnifyAria")}
              aria-pressed={settings.umbraMagnify}
              onClick={() => onChange({ umbraMagnify: !settings.umbraMagnify })}
              className={`flex-1 rounded px-1 py-1 text-[10px] leading-tight transition-colors max-md:min-h-11 ${
                settings.umbraMagnify
                  ? "bg-amber-500/30 font-semibold text-amber-200"
                  : "bg-white/5 text-gray-400 hover:bg-white/10"
              }`}
            >
              {tr("lab.eclipseUmbraMagnifyLabel")}：
              {settings.umbraMagnify ? "ON" : "OFF"}
            </button>
          </div>
          )}
          {/* M7-4 行星轨道远景层（A17：默认开）+ 倾角叙事模式（A5） */}
          <div className="mt-1 flex gap-1">
            <button
              aria-label={tr("lab.eclipsePlanetOrbitsAria")}
              aria-pressed={settings.planetOrbits}
              onClick={() => onChange({ planetOrbits: !settings.planetOrbits })}
              className={`flex-1 rounded px-1 py-1 text-[10px] leading-tight transition-colors max-md:min-h-11 ${
                settings.planetOrbits
                  ? "bg-sky-500/30 font-semibold text-sky-200"
                  : "bg-white/5 text-gray-400 hover:bg-white/10"
              }`}
            >
              {tr("lab.eclipsePlanetOrbitsLabel")}：
              {settings.planetOrbits ? "ON" : "OFF"}
            </button>
            <button
              aria-label={tr("lab.eclipseInclinationAria")}
              aria-pressed={settings.inclinationDemo}
              onClick={() =>
                onChange({ inclinationDemo: !settings.inclinationDemo })
              }
              className={`flex-1 rounded px-1 py-1 text-[10px] leading-tight transition-colors max-md:min-h-11 ${
                settings.inclinationDemo
                  ? "bg-amber-500/30 font-semibold text-amber-200"
                  : "bg-white/5 text-gray-400 hover:bg-white/10"
              }`}
            >
              {tr("lab.eclipseInclinationLabel")}：
              {settings.inclinationDemo ? "ON" : "OFF"}
            </button>
          </div>
          {settings.bodyScaleMode === "real" && settings.moonMagnify && (
            <p className="mt-1 rounded bg-amber-950/40 px-2 py-1 text-[10px] leading-snug text-amber-200/90">
              {tr("lab.eclipseMoonMagnifyBadge")}
            </p>
          )}
          {settings.bodyScaleMode === "real" && settings.umbraMagnify && (
            <p className="mt-1 rounded bg-amber-950/40 px-2 py-1 text-[10px] leading-snug text-amber-200/90">
              {tr("lab.eclipseUmbraMagnifyBadge")}
            </p>
          )}
          {settings.planetOrbits && (
            <p className="mt-1 rounded bg-white/5 px-2 py-1 text-[10px] leading-snug text-gray-400">
              {tr("lab.eclipsePlanetOrbitsCard")}
            </p>
          )}
          {settings.inclinationDemo && (
            <p className="mt-1 rounded bg-amber-950/40 px-2 py-1 text-[10px] leading-snug text-amber-200/90">
              {tr("lab.eclipseInclinationBadge")}
            </p>
          )}
          {settings.inclinationDemo && (
            <p className="mt-1 rounded bg-white/5 px-2 py-1 text-[10px] leading-snug text-gray-400">
              {tr("lab.eclipseInclinationCard")}
            </p>
          )}
          {/* 太空视角科普卡（A3：太阳距离压缩 + 影锥可见实体登记） */}
          <p className="mt-1 rounded bg-white/5 px-2 py-1 text-[10px] leading-snug text-gray-400">
            {tr("lab.eclipseSpaceCard")}
          </p>
        </>
      )}

      {/* M5 星光引力偏折对照（1919 Eddington 页签专属；A10 登记） */}
      {eddington && (
        <>
          <SectionTitle text={tr("lab.eclipseDeflectionTitle")} />
          {settings.viewMode === "ground" && (
            <>
              <button
                aria-label={tr("lab.eclipseDeflectionAria")}
                aria-pressed={settings.deflectionDemo}
                onClick={() =>
                  onChange({ deflectionDemo: !settings.deflectionDemo })
                }
                className={`w-full rounded px-2 py-1 text-[10px] transition-colors max-md:min-h-11 ${
                  settings.deflectionDemo
                    ? "bg-amber-500/30 font-semibold text-amber-200"
                    : "bg-white/5 text-gray-400 hover:bg-white/10"
                }`}
              >
                {tr("lab.eclipseDeflectionToggle")}：
                {settings.deflectionDemo ? "ON" : "OFF"}
              </button>
              {settings.deflectionDemo && (
                <>
                  {/* A10 徽标：夸张倍率 + 真实值 1.75″（文案数值与
                      EDDINGTON_DEFLECTION_EXAGGERATION 常量同步维护） */}
                  <p className="mt-1 rounded bg-amber-950/40 px-2 py-1 text-[10px] leading-snug text-amber-200/90">
                    {tr("lab.eclipseDeflectionBadge")}
                  </p>
                  <p className="mt-1 rounded bg-white/5 px-2 py-1 text-[10px] leading-snug text-gray-400">
                    {tr("lab.eclipseDeflectionLegend")}
                  </p>
                </>
              )}
            </>
          )}
          {/* 科学史科普卡（M5-3：诚实口径——当年精度接近极限、后世确认） */}
          <p className="mt-1 rounded bg-sky-950/50 px-2 py-1.5 text-[10px] leading-relaxed text-gray-300">
            {tr("lab.eclipse1919Card")}
          </p>
        </>
      )}

      {/* 播放模式（A1 登记：HUD 常显真实时刻与倍速） */}
      <SectionTitle text={tr("lab.eclipsePlayModeAria")} />
      <Segmented
        ariaLabel={tr("lab.eclipsePlayModeAria")}
        options={[
          { id: "tour", label: tr("lab.eclipsePlayModeTour") },
          { id: "real", label: tr("lab.eclipsePlayModeReal") },
        ]}
        value={settings.playMode}
        onSelect={(id) => onChange({ playMode: id as EclipsePlayMode })}
      />

      {/* 曝光状态机（契约 C5） */}
      <SectionTitle text={tr("lab.eclipseExposureTitle")} />
      <Segmented
        ariaLabel={tr("lab.eclipseExposureTitle")}
        options={[
          { id: "auto", label: tr("lab.eclipseExposureAuto") },
          { id: "manual", label: tr("lab.eclipseExposureManual") },
        ]}
        value={settings.exposureMode}
        onSelect={(id) => onChange({ exposureMode: id as EclipseExposureMode })}
      />
      {settings.exposureMode === "manual" && (
        <div className="mt-1 flex items-center gap-1.5">
          <span className="text-[10px] text-gray-400">
            {tr("lab.eclipseExposureFiltered")}
          </span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={settings.exposureManual01}
            aria-label={tr("lab.eclipseExposureSliderAria")}
            onChange={(e) =>
              onChange({ exposureManual01: Number.parseFloat(e.target.value) })
            }
            className="h-1.5 flex-1 cursor-pointer accent-sky-400"
          />
          <span className="text-[10px] text-gray-400">
            {tr("lab.eclipseExposureNaked")}
          </span>
        </div>
      )}
      {/* 曝光科普卡（A2 登记：色调映射非线性，6 个数量级） */}
      <p className="mt-1 rounded bg-white/5 px-2 py-1 text-[10px] leading-snug text-gray-400">
        {tr("lab.eclipseExposureCard")}
      </p>

      {/* 太阳活动周滑杆（isotropy01 → 日冕形态连续变形） */}
      <SectionTitle text={tr("lab.eclipseActivityTitle")} />
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] text-gray-400">
          {tr("lab.eclipseActivityMin")}
        </span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={settings.isotropy01}
          aria-label={tr("lab.eclipseActivityAria")}
          onChange={(e) =>
            onChange({ isotropy01: Number.parseFloat(e.target.value) })
          }
          className="h-1.5 flex-1 cursor-pointer accent-sky-400"
        />
        <span className="text-[10px] text-gray-400">
          {tr("lab.eclipseActivityMax")}
        </span>
      </div>

      {/* 假想模式（月地距离滑杆全食 ↔ 环食连续退化；与真实时间轴互斥） */}
      <SectionTitle text={tr("lab.eclipseHypoTitle")} />
      <button
        aria-label={tr("lab.eclipseHypoToggleAria")}
        aria-pressed={settings.hypoActive}
        onClick={() => onChange({ hypoActive: !settings.hypoActive })}
        className={`w-full rounded px-2 py-1 text-[10px] transition-colors max-md:min-h-11 ${
          settings.hypoActive
            ? "bg-amber-500/30 font-semibold text-amber-200"
            : "bg-white/5 text-gray-400 hover:bg-white/10"
        }`}
      >
        {tr("lab.eclipseHypoTitle")}：{settings.hypoActive ? "ON" : "OFF"}
      </button>
      {settings.hypoActive && (
        <div className="mt-1">
          <div className="flex items-center justify-between text-[10px] text-gray-400">
            <span>{tr("lab.eclipseHypoMoonDist")}</span>
            <span className="font-mono text-amber-200">
              {Math.round(settings.hypoMoonDistKm).toLocaleString("en-US")} km
            </span>
          </div>
          <input
            type="range"
            min={HYPO_MOON_DIST_MIN_KM}
            max={HYPO_MOON_DIST_MAX_KM}
            step={100}
            value={settings.hypoMoonDistKm}
            aria-label={tr("lab.eclipseHypoMoonDistAria")}
            onChange={(e) =>
              onChange({ hypoMoonDistKm: Number.parseFloat(e.target.value) })
            }
            className="h-1.5 w-full cursor-pointer accent-amber-400"
          />
        </div>
      )}

      {/* 99%/100% 天光断崖对比 */}
      <SectionTitle text={tr("lab.eclipseCompareTitle")} />
      <div className="flex gap-1">
        <button
          onClick={() => onCompare("99")}
          className="flex-1 rounded bg-white/5 px-1 py-1 text-[10px] text-gray-300 transition-colors hover:bg-white/15 max-md:min-h-11"
        >
          {tr("lab.eclipseCompare99")}
        </button>
        <button
          onClick={() => onCompare("100")}
          className="flex-1 rounded bg-white/5 px-1 py-1 text-[10px] text-gray-300 transition-colors hover:bg-white/15 max-md:min-h-11"
        >
          {tr("lab.eclipseCompare100")}
        </button>
      </div>

      {/* 环境数值条（§1.4） */}
      <SectionTitle text={tr("lab.eclipseEnvTitle")} />
      <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 rounded bg-white/5 px-2 py-1 font-mono text-[10px] text-gray-300">
        <span className="text-gray-500">{tr("lab.eclipseEnvTemp")}</span>
        <span>{env.tempText}</span>
        <span className="text-gray-500">{tr("lab.eclipseEnvSky")}</span>
        <span>{env.skyText}</span>
        <span className="text-gray-500">{tr("lab.eclipseEnvLm")}</span>
        <span>{env.lmText}</span>
      </div>

      {/* 阶段科普卡（§3.1；C2/C3 含安全口径） */}
      <SectionTitle text={tr(PHASE_CARD_TITLE_KEYS[phaseCardKey])} />
      <p className="rounded bg-sky-950/50 px-2 py-1.5 text-[10px] leading-relaxed text-gray-300">
        {tr(PHASE_CARD_KEYS[phaseCardKey])}
      </p>

      {/* 声景区（M6-1 §5）：开关/音量 + 可听化说明（科学口径红线：真实
          日食无声；全食「寂静」为艺术表达——A8 用户可见登记，双语常显） */}
      <div className="mt-3 border-t border-white/10 pt-2">
        <label className="flex items-center gap-2 max-md:min-h-11">
          <input
            type="checkbox"
            checked={audioEnabled}
            onChange={(e) => setAudioEnabled(e.target.checked)}
          />
          <span>🔊 {tr("lab.eclipseAudioEnable")}</span>
        </label>
        {audioEnabled && (
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={audioVolume}
            aria-label={tr("lab.audioVolumeAria")}
            onChange={(e) => setAudioVolume(Number.parseFloat(e.target.value))}
            className="mt-1 h-1.5 w-full cursor-pointer accent-sky-400"
          />
        )}
        <p className="mt-1 text-[10px] leading-snug text-gray-400">
          {tr("lab.eclipseAudioNote")}
        </p>
      </div>
    </div>
  );
}
