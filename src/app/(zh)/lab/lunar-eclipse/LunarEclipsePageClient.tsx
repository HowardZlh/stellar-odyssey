'use client';

/**
 * 月食实验室场景页 `/lab/lunar-eclipse`（LE-M2，静态导出）
 *
 * 场景组件经 `next/dynamic` 动态 import（`ssr: false` + 加载进度提示）——
 * 实验室场景（three/R3F 场景图 + 后期）打进独立 chunk，仅在进入本页时
 * 加载，主页首屏 bundle 零增大（流星雨/日食范式，§0.1）。
 * 星历 JSON 懒加载在场景组件内（useLunarEclipses），两级加载提示。
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

const LunarEclipseLab = dynamic(
  () => import('@/components/Lab/LunarEclipseLab').then((m) => m.LunarEclipseLab),
  { ssr: false, loading: () => <SceneLoading /> },
);

export default function LunarEclipseLabPage(): JSX.Element {
  // 独立页面同样按 ?lang= > localStorage > zh 初始化（donate/contributors 同范式）
  useLocaleInit();
  return <LunarEclipseLab />;
}
