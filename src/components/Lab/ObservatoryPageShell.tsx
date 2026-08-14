'use client';

/**
 * 天体观察站页面客户端壳（画廊页 `/lab/observatory` 与单天体页
 * `/lab/observatory/[body]` 共用）：locale 初始化 + 主组件 chunk 动态
 * 加载（`ssr: false`——两个页面同为静态导出，three/R3F 场景 chunk 在
 * ObservatoryLab 内再嵌套 dynamic，画廊访问不拉取 three，§4 性能红线）。
 */

import type { JSX } from 'react';
import dynamic from 'next/dynamic';
import { useLocaleInit, useT } from '@/hooks/useI18n';

/** 页面 chunk 加载提示（meteor-shower 页同范式） */
function PageLoading(): JSX.Element {
  const tr = useT();
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-black">
      <p className="animate-pulse rounded-lg bg-black/60 px-4 py-2 text-sm text-gray-300">
        {tr('lab.loadingScene')}
      </p>
    </div>
  );
}

const ObservatoryLab = dynamic(
  () => import('@/components/Lab/ObservatoryLab').then((m) => m.ObservatoryLab),
  { ssr: false, loading: () => <PageLoading /> },
);

export interface ObservatoryPageShellProps {
  /** 观察对象 id（null = 画廊） */
  bodyId: string | null;
}

export function ObservatoryPageShell({ bodyId }: ObservatoryPageShellProps): JSX.Element {
  // 独立页面同样按 ?lang= > localStorage > zh 初始化（lab 首页同范式）
  useLocaleInit();
  return <ObservatoryLab bodyId={bodyId} />;
}
