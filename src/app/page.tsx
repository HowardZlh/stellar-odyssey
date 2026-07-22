'use client';

import dynamic from 'next/dynamic';

// 3D 场景仅客户端渲染（Three.js 依赖 WebGL）
const SolarSystemApp = dynamic(() => import('@/components/Scene/SolarSystemApp'), {
  ssr: false,
  loading: () => (
    <div className="flex h-screen w-screen items-center justify-center bg-space-dark">
      <p className="text-lg text-gray-400">正在加载星系场景…</p>
    </div>
  ),
});

export default function HomePage(): JSX.Element {
  return <SolarSystemApp />;
}
