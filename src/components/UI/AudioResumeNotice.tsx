'use client';

import type { JSX } from 'react';
import { useSimulationStore } from '@/store';
import { useT } from '@/hooks/useI18n';

/**
 * 音频恢复失败提示（M5-1，REQUIREMENTS_MOBILE §M5-1）：
 * AudioContext.resume() 被浏览器自动播放策略拦截时（audioResumeFailed），
 * 顶部居中展示可见提示替代此前的静默失败——引导用户再次点按音效开关
 * （新一次用户手势内 resume 即可解锁）。
 *
 * 挂载位置：SolarSystemApp 常驻悬浮层（uiVisible 包裹外——音效开着却
 * 无声的矛盾态提示不应随 UI 隐藏消失）。✕ 关闭钮清除标记；关闭音效
 * 开关时由 AudioController 自动清除。定位在 LoadingProgress 槽位下方，
 * 两者同屏不重叠；移动端 ✕ 命中区 ≥44pt（max-md:h-11/w-11）。
 */
export function AudioResumeNotice(): JSX.Element | null {
  const tr = useT();
  const failed = useSimulationStore((s) => s.audioResumeFailed);
  const setAudioResumeFailed = useSimulationStore((s) => s.setAudioResumeFailed);

  if (!failed) return null;

  return (
    <div
      role="alert"
      className="absolute left-1/2 top-[calc(env(safe-area-inset-top)+6.75rem)] flex w-[calc(100vw-2rem)] max-w-96 -translate-x-1/2 items-center gap-2 rounded-lg border border-amber-400/40 bg-space-panel px-3 py-2 backdrop-blur md:top-28"
    >
      <span aria-hidden="true" className="shrink-0 text-sm">
        🔇
      </span>
      <p className="flex-1 text-xs leading-relaxed text-amber-100/90 max-md:text-sm">
        {tr('audioNotice.resumeFailed')}
      </p>
      <button
        type="button"
        aria-label={tr('audioNotice.dismissAria')}
        onClick={() => setAudioResumeFailed(false)}
        className="shrink-0 rounded px-1.5 py-1 text-gray-400 transition-colors hover:bg-white/10 hover:text-white max-md:-my-2 max-md:flex max-md:h-11 max-md:w-11 max-md:items-center max-md:justify-center"
      >
        ✕
      </button>
    </div>
  );
}
