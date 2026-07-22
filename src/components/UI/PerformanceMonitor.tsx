'use client';

import { useEffect, useState } from 'react';
import { useSimulationStore } from '@/store';
import {
  createFpsCounter,
  formatFpsLabel,
  formatMemoryMB,
  readUsedHeapBytes,
  recordFrame,
} from '@/utils/performance';

/**
 * 性能监控面板（可选需求 3.5.2）：FPS + 内存占用，可在控制面板开关
 *
 * rAF 驱动帧率统计（纯逻辑在 utils/performance.ts）；
 * 内存读取依赖 Chrome 专有 performance.memory，其他浏览器显示"不可用"。
 */
export function PerformanceMonitor(): JSX.Element | null {
  const showPerformance = useSimulationStore((s) => s.showPerformance);
  const [fpsLabel, setFpsLabel] = useState<string>('统计中…');
  const [memoryLabel, setMemoryLabel] = useState<string>('不可用');

  useEffect(() => {
    if (!showPerformance) return undefined;
    let frameId = 0;
    let counter = createFpsCounter(performance.now());

    const loop = (nowMs: number): void => {
      const next = recordFrame(counter, nowMs);
      if (next.fps !== counter.fps) {
        setFpsLabel(formatFpsLabel(next.fps));
        setMemoryLabel(
          formatMemoryMB(
            readUsedHeapBytes(performance as { memory?: { usedJSHeapSize?: number } }),
          ),
        );
      }
      counter = next;
      frameId = requestAnimationFrame(loop);
    };
    frameId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frameId);
  }, [showPerformance]);

  if (!showPerformance) return null;

  return (
    // top-36 避开右上角 HUD 信息面板
    <div className="absolute right-4 top-36 select-none rounded-lg bg-space-panel px-3 py-2 text-xs backdrop-blur">
      <div className="mb-1 text-gray-400">性能监控</div>
      <div className="text-gray-100">帧率：{fpsLabel}</div>
      <div className="text-gray-100">内存：{memoryLabel}</div>
    </div>
  );
}
