'use client';

/**
 * 食事件时间轴 scrubber（E-M2-6 骨架，契约 C7 跨条目共建组件）：
 * 播放/暂停 + 拖动 seek + 接触点锚点跳转。
 *
 * 契约 C7 纪律：锚点列表与高亮区段均**数据驱动**——组件只消费
 * `EclipseTimelineAnchor[]`（`{ key, tSec, labelKey }`）与
 * `EclipseTimelineHighlight[]`，禁止硬编码 5 个锚点；月食条目将以 7 锚点
 * （P1/U1/U2/食甚/U3/U4/P4，部分事件锚点缺省）复用本组件。
 * 播放倍率由父级播放模式决定（M3 导览变速/×1 真实，A1 登记于 HUD）。
 *
 * DOM 覆盖层组件（订阅 locale 合法）；seek 语义：星历插值是纯查表，任意
 * seek 无状态累积（§3.1 红线——效果由 tSec 单值可重建，父级保证）。
 * 移动端条款：按钮 ≥44pt 由 max-md:min-h-11 追加（M6 全量适配前的基线）。
 */

import type { JSX } from 'react';
import { useT } from '@/hooks/useI18n';
import type {
  EclipseTimelineAnchor,
  EclipseTimelineHighlight,
  EclipseTimelineWindow,
} from '@/utils/solarEclipseLab';

export interface EclipseTimelineScrubberProps {
  /** 时间轴窗口（C1−15min → C4+15min） */
  window: EclipseTimelineWindow;
  /** 当前时间轴秒（UTC；父级 500ms HUD tick 同步 + 拖动即时更新） */
  valueSec: number;
  /** 播放中（倍率由父级播放模式决定，M3） */
  playing: boolean;
  /** 锚点列表（数据驱动，契约 C7；本条目 5 锚点由 solarEclipseAnchors 构造） */
  anchors: readonly EclipseTimelineAnchor[];
  /** 高亮区段（数据驱动；本条目为贝利珠/钻石环 C2±60s、C3±60s，§3.1） */
  highlights?: readonly EclipseTimelineHighlight[];
  /** 拖动/锚点跳转 seek（写父级 tSecRef + scrub state） */
  onSeek: (tSec: number) => void;
  /** 播放/暂停切换 */
  onTogglePlay: () => void;
}

/** 时间轴 scrubber（底部中央覆盖层；锚点刻度按窗口比例定位） */
export function EclipseTimelineScrubber({
  window: win,
  valueSec,
  playing,
  anchors,
  highlights = [],
  onSeek,
  onTogglePlay,
}: EclipseTimelineScrubberProps): JSX.Element {
  const tr = useT();
  const span = win.endSec - win.startSec;

  return (
    <div className="absolute bottom-10 left-1/2 w-[min(40rem,calc(100vw-1.5rem))] -translate-x-1/2 rounded-lg bg-black/65 px-3 py-2 text-xs text-gray-100 backdrop-blur">
      <div className="flex items-center gap-2">
        <button
          onClick={onTogglePlay}
          aria-label={tr(playing ? 'lab.eclipsePause' : 'lab.eclipsePlay')}
          aria-pressed={playing}
          className="rounded bg-white/10 px-2 py-1 text-sky-200 transition-colors hover:bg-white/20 max-md:min-h-11 max-md:px-4"
        >
          {playing ? '⏸' : '▶'}
        </button>
        <div className="relative flex-1">
          {/* 高亮区段（贝利珠/钻石环时段，§3.1；指针事件穿透给滑杆） */}
          <div className="pointer-events-none absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2">
            {highlights.map((h) => (
              <span
                key={h.key}
                className="absolute top-0 h-1.5 rounded-sm bg-amber-400/45"
                style={{
                  left: `${((h.startSec - win.startSec) / span) * 100}%`,
                  width: `${((h.endSec - h.startSec) / span) * 100}%`,
                }}
              />
            ))}
          </div>
          {/* 锚点刻度（视觉标尺，按窗口比例定位；指针事件穿透给滑杆） */}
          <div className="pointer-events-none absolute inset-x-0 top-1/2 h-2 -translate-y-1/2">
            {anchors.map((a) => (
              <span
                key={a.key}
                className="absolute top-0 h-2 w-px bg-sky-300/70"
                style={{ left: `${((a.tSec - win.startSec) / span) * 100}%` }}
              />
            ))}
          </div>
          <input
            type="range"
            min={win.startSec}
            max={win.endSec}
            step={1}
            value={valueSec}
            aria-label={tr('lab.eclipseTimelineAria')}
            onChange={(e) => onSeek(Number.parseFloat(e.target.value))}
            className="h-1.5 w-full cursor-pointer accent-sky-400"
          />
        </div>
      </div>
      {/* 锚点跳转按钮（数据驱动数量，契约 C7） */}
      <div className="mt-1 flex gap-1">
        {anchors.map((a) => (
          <button
            key={a.key}
            onClick={() => onSeek(a.tSec)}
            className="flex-1 rounded bg-white/5 px-1 py-0.5 text-[10px] text-gray-300 transition-colors hover:bg-white/15 max-md:min-h-11"
          >
            {tr(a.labelKey)}
          </button>
        ))}
      </div>
    </div>
  );
}
