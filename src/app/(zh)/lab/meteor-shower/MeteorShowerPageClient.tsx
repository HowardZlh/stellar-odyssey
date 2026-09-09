'use client';

/**
 * 流星雨实验室场景页 `/lab/meteor-shower`（M2-2，静态导出）
 *
 * 场景组件经 `next/dynamic` 动态 import（`ssr: false` + 加载进度提示）——
 * 实验室场景（three/R3F 场景图 + 后期）打进独立 chunk，仅在进入本页时
 * 加载，主页首屏 bundle 零增大（§4 性能红线）。
 * 亮星 JSON 懒加载在场景组件内（useYaleBrightStars），两级加载提示。
 */

import type { JSX } from 'react';
import dynamic from 'next/dynamic';
import { useLocaleInit, useT } from '@/hooks/useI18n';

/** 场景 chunk 加载提示（DOM 层，可订阅 locale） */
function SceneLoading(): JSX.Element {
  const tr = useT();
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-black">
      <p className="animate-pulse rounded-lg bg-black/60 px-4 py-2 text-sm text-gray-300">
        {tr('lab.loadingScene')}
      </p>
    </div>
  );
}

const MeteorShowerLab = dynamic(
  () => import('@/components/Lab/MeteorShowerLab').then((m) => m.MeteorShowerLab),
  { ssr: false, loading: () => <SceneLoading /> },
);

export default function MeteorShowerLabPage(): JSX.Element {
  // 独立页面同样按 ?lang= > localStorage > zh 初始化（donate/contributors 同范式）
  useLocaleInit();
  return <MeteorShowerLab />;
}
