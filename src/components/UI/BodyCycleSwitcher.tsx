'use client';

import { useSimulationStore } from '@/store';
import { getBodyInfoById } from '@/data/catalog';
import { bodyCyclePositionLabel, cycleControlVisible } from '@/utils/bodyCycle';

/**
 * 行星视角天体切换控件（P4，需求 3.2.4）：
 * 「← 上一个 | 当前天体名 序列位置 | 下一个 →」，仅 L1 行星视角语境显示
 * （快捷键 [ / ]；切换复用飞往运镜 2.5s 并自动跟随）
 */
export function BodyCycleSwitcher(): JSX.Element | null {
  const viewLevel = useSimulationStore((s) => s.viewLevel);
  const followBodyId = useSimulationStore((s) => s.followBodyId);
  const anchorBodyId = useSimulationStore((s) => s.anchorBodyId);
  const cycleAnchorBody = useSimulationStore((s) => s.cycleAnchorBody);

  if (!cycleControlVisible(viewLevel, followBodyId)) return null;

  const name = getBodyInfoById(anchorBodyId)?.nameZh ?? anchorBodyId;
  const position = bodyCyclePositionLabel(anchorBodyId);

  return (
    <div className="absolute bottom-28 left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-lg bg-space-panel px-4 py-2 text-xs backdrop-blur">
      <button
        type="button"
        onClick={() => cycleAnchorBody(-1)}
        className="rounded bg-white/10 px-2 py-1 hover:bg-white/20"
        aria-label="上一个天体（快捷键 [）"
      >
        ← 上一个
      </button>
      <span className="min-w-24 text-center text-sm text-space-accent">
        {name}
        {position && <span className="ml-1.5 text-[10px] text-gray-400">{position}</span>}
      </span>
      <button
        type="button"
        onClick={() => cycleAnchorBody(1)}
        className="rounded bg-white/10 px-2 py-1 hover:bg-white/20"
        aria-label="下一个天体（快捷键 ]）"
      >
        下一个 →
      </button>
    </div>
  );
}
