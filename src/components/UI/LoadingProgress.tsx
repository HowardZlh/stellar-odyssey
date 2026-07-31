'use client';


import type { JSX } from 'react';
import { useEffect, useState } from 'react';
import type { LoadProgress } from '@/utils/loadProgress';
import { useT } from '@/hooks/useI18n';
import { getTextureManager } from '@/components/CelestialBody/textureManager';

/** 完成后进度条保留展示时长（毫秒），随后自动消失 */
const HIDE_DELAY_MS = 800;

/**
 * 资源加载进度 UI（P3-2，需求 §5.3）：
 * 纹理懒加载进行中显示科幻风格进度条 + 百分比，全部完成后自动消失。
 * 进度统计纯逻辑见 utils/loadProgress.ts（加载失败也计入完成——静默降级
 * 到程序化纹理，不阻塞进度）。
 */
export function LoadingProgress(): JSX.Element | null {
  const tr = useT();
  const [progress, setProgress] = useState<LoadProgress>(() => getTextureManager().getProgress());
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const manager = getTextureManager();
    const sync = (): void => {
      setProgress(manager.getProgress());
    };
    const unsubscribe = manager.subscribe(sync);
    sync();
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (progress.active) {
      setVisible(true);
      return undefined;
    }
    if (!visible) return undefined;
    // 完成后短暂停留展示 100% 再消失
    const timer = setTimeout(() => setVisible(false), HIDE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [progress.active, visible]);

  if (!visible || progress.total === 0) return null;

  const percent = Math.round(progress.percent01 * 100);

  return (
    <div className="pointer-events-none absolute left-1/2 top-16 w-56 -translate-x-1/2 rounded-lg bg-space-panel px-4 py-2 backdrop-blur">
      <div className="mb-1 flex items-center justify-between text-[10px] tracking-widest text-space-accent">
        <span>{tr('loading.textures')}</span>
        <span>{percent}%</span>
      </div>
      <div className="h-1 w-full overflow-hidden rounded bg-white/10">
        <div
          className="h-full rounded bg-space-accent transition-[width] duration-300"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
