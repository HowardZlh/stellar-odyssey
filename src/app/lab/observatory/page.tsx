'use client';

/**
 * 天体观察站页 `/lab/observatory?body=<id>`（O1，静态导出）
 *
 * 单页两形态：无 `?body`（或未注册 id）为画廊，已注册 id 为单天体观察
 * 场景（门控判定在 ObservatoryLab 内完成）。`?body` 直读
 * `window.location.search`（勿用 useSearchParams——静态导出 + Suspense
 * 边界要求，dev/preview 页同口径登记）。
 *
 * 主组件经 `next/dynamic` 动态 import（`ssr: false`）：画廊 DOM 层 +
 * 观察场景（three/R3F）分层打进独立 chunk（场景 chunk 在 ObservatoryLab
 * 内再嵌套 dynamic，画廊访问不拉取 three），主页首屏 bundle 零增大
 * （§4 性能红线）。
 */

import type { JSX } from 'react';
import { useEffect, useState } from 'react';
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

export default function ObservatoryPage(): JSX.Element {
  // 独立页面同样按 ?lang= > localStorage > zh 初始化（lab 首页同范式）
  useLocaleInit();
  // ?body 解析完成前不挂载主组件（null 会被误判为画廊，闪烁一帧）
  const [bodyId, setBodyId] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setBodyId(params.get('body'));
  }, []);

  if (bodyId === undefined) {
    return <div className="h-screen w-screen bg-black" />;
  }
  return <ObservatoryLab bodyId={bodyId} />;
}
