'use client';


import type { JSX } from 'react';
import dynamic from 'next/dynamic';
import { useT, useLocaleInit } from '@/hooks/useI18n';

/**
 * 场景加载占位（i18n）：store 为模块级全局，Canvas 挂载前即可
 * 初始化 locale（?lang= > localStorage > zh）并按语言显示加载文案。
 */
function SceneLoading(): JSX.Element {
  useLocaleInit();
  const tr = useT();
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-space-dark">
      <p className="text-lg text-gray-400">{tr('loading.scene')}</p>
    </div>
  );
}

// 3D 场景仅客户端渲染（Three.js 依赖 WebGL）
const SolarSystemApp = dynamic(() => import('@/components/Scene/SolarSystemApp'), {
  ssr: false,
  loading: () => <SceneLoading />,
});

export default function HomePage(): JSX.Element {
  return <SolarSystemApp />;
}
