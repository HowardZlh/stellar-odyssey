'use client';


import type { JSX } from 'react';
import { useEffect, useState } from 'react';
import { useT, useTf } from '@/hooks/useI18n';
import { useSimulationStore } from '@/store';
import {
  createFpsCounter,
  fpsHealth,
  readUsedHeapBytes,
  recordFrame,
  usedMemoryMB,
} from '@/utils/performance';

/**
 * 性能监控面板（可选需求 3.5.2）：FPS + 内存占用，可在控制面板开关
 *
 * rAF 驱动帧率统计（纯逻辑在 utils/performance.ts）；
 * 内存读取依赖 Chrome 专有 performance.memory，其他浏览器显示"不可用"。
 *
 * B3 i18n：状态持有原始数值（fps/内存 MB），渲染时按 locale 经字典
 * 格式化（perfMonitor.* 键组；健康度阈值与 utils fpsHealth 同源）。
 */
export function PerformanceMonitor(): JSX.Element | null {
  const showPerformance = useSimulationStore((s) => s.showPerformance);
  const tr = useT();
  const trf = useTf();
  const [fps, setFps] = useState<number | null>(null);
  const [memoryMb, setMemoryMb] = useState<number | null>(null);

  useEffect(() => {
    if (!showPerformance) return undefined;
    let frameId = 0;
    let counter = createFpsCounter(performance.now());

    const loop = (nowMs: number): void => {
      const next = recordFrame(counter, nowMs);
      if (next.fps !== counter.fps) {
        setFps(next.fps);
        setMemoryMb(
          usedMemoryMB(
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

  const health = fpsHealth(fps);
  const fpsText =
    health === 'measuring'
      ? tr('perfMonitor.measuring')
      : health === 'good'
        ? `${fps} FPS`
        : trf(health === 'fair' ? 'perfMonitor.fpsFair' : 'perfMonitor.fpsLow', {
            fps: fps ?? 0,
          });
  const memoryText = memoryMb === null ? tr('perfMonitor.unavailable') : `${memoryMb} MB`;

  return (
    // top-36 避开右上角 HUD 信息面板；M3-5：紧凑视口改挂左上（右上为
    // 状态条展开详情区，左上因 ControlPanel 抽屉化空出），桌面原样
    <div className="absolute right-4 top-36 select-none rounded-lg bg-space-panel px-3 py-2 text-xs backdrop-blur max-md:left-2 max-md:right-auto max-md:top-[calc(env(safe-area-inset-top)+3.25rem)]">
      <div className="mb-1 text-gray-400">{tr('perfMonitor.title')}</div>
      <div className="text-gray-100">{trf('perfMonitor.fpsLabel', { value: fpsText })}</div>
      <div className="text-gray-100">{trf('perfMonitor.memoryLabel', { value: memoryText })}</div>
    </div>
  );
}
