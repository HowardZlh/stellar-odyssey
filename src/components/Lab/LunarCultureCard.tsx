"use client";

/**
 * 文化史折叠卡（LE 迭代 M6-1 / 需求 §3.3 + B10）
 *
 * **与物理解释明确分区**（§3.3 硬性口径）：卡片顶部常显「历史记载与神话」
 * 标签 + 独立配色（琥珀系，区别于科学科普卡的灰/蓝系），内容只讲人类如何
 * 解释与应对月食，不与科学内容混排。
 *
 * B10 登记（用户可见侧即本卡）：「鸣钟击鼓驱天狗」的一声钟响为**文化演绎**
 * ——仅本卡内按钮触发的一次性单发音，**不进声景包络、不随时间轴自动出声**
 * （与 §5 科学声景分离的实现层保证：钟声走 AudioEngine.playLunarCultureBell
 * 单发，不经 LunarSoundscapeDriver 的逐帧包络链）。
 *
 * 移动端（AGENTS.md 条款 3）：折叠钮与钟声钮 `max-md:min-h-11`（44pt）。
 * 声音开关/音量沿用全局 store（面板声景区同一事实源）；音效关闭时钟声钮
 * 禁用并提示先开启声音（不越过用户静音意图）。
 */

import type { JSX } from "react";
import { useState } from "react";
import { useT } from "@/hooks/useI18n";
import { useSimulationStore } from "@/store";
import { getSharedAudioEngine } from "@/components/Audio/audioEngine";

/** 各文明记载/神话条目（i18n 键；zh 为类型源） */
const CULTURE_ITEM_KEYS = [
  "lab.lunarCultureItemCn",
  "lab.lunarCultureItemIndia",
  "lab.lunarCultureItemInca",
  "lab.lunarCultureItemMeso",
  "lab.lunarCultureItemNorse",
] as const;

/** 文化史折叠卡（默认收起；面板内挂载） */
export function LunarCultureCard(): JSX.Element {
  const tr = useT();
  const [open, setOpen] = useState(false);
  const audioEnabled = useSimulationStore((s) => s.audioEnabled);
  const audioVolume = useSimulationStore((s) => s.audioVolume);

  /** 一次性钟声（B10 文化演绎；点击即用户手势——满足自动播放策略） */
  const strikeBell = (): void => {
    const engine = getSharedAudioEngine();
    engine.init();
    void engine.resume();
    engine.playLunarCultureBell(audioVolume);
  };

  return (
    <div className="mb-2 rounded border border-amber-500/20 bg-amber-950/25 p-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1 rounded text-left text-[10px] font-semibold text-amber-200 transition-colors hover:bg-white/5 max-md:min-h-11"
      >
        <span aria-hidden="true">{open ? "▾" : "▸"}</span>
        <span>📜 {tr("lab.lunarCultureTitle")}</span>
      </button>
      {/* 分区标签常显（§3.3：与科学内容明确分区） */}
      <p className="mt-1 text-[9px] font-semibold uppercase tracking-wide text-amber-300/70">
        {tr("lab.lunarCultureTag")}
      </p>
      {open && (
        <>
          <ul className="mt-1.5 space-y-1">
            {CULTURE_ITEM_KEYS.map((key) => (
              <li
                key={key}
                className="text-[10px] leading-relaxed text-amber-100/85"
              >
                {tr(key)}
              </li>
            ))}
          </ul>
          {/* 钟声（B10）：一次性单发音，与科学声景分离 */}
          <button
            type="button"
            onClick={strikeBell}
            disabled={!audioEnabled}
            aria-label={tr("lab.lunarCultureBellAria")}
            className="mt-2 w-full rounded bg-amber-500/25 px-2 py-1 text-left text-[10px] font-semibold text-amber-200 transition-colors hover:bg-amber-500/40 disabled:cursor-not-allowed disabled:bg-white/5 disabled:text-gray-500 max-md:min-h-11"
          >
            🔔 {tr("lab.lunarCultureBellLabel")}
          </button>
          <p className="mt-1 text-[9px] leading-snug text-amber-300/70">
            {audioEnabled
              ? tr("lab.lunarCultureBellNote")
              : tr("lab.lunarCultureBellMuted")}
          </p>
        </>
      )}
    </div>
  );
}
