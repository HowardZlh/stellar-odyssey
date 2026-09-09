'use client';

import type { JSX } from 'react';
import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';

/**
 * 开发预览工位路由 `/dev/preview?body=<id>`（R4-1，IMPROVEMENT_REQUIREMENTS_4 §R4-1）
 *
 * 生产安全（用户登记方案）：`NODE_ENV === 'production'` 下渲染空页，且预览专用
 * harness 走动态 import 仅在 dev 加载 —— 主应用 bundle 零增大、生产构建路由不可用。
 *
 * 独立于主场景：不引入 SolarSystemApp / store / 音频，黑背景 + 可选参考网格。
 */

const isProduction = process.env.NODE_ENV === 'production';

// 预览 harness 动态 import（仅 dev 触发；生产分支不引用，打包器摇树移除）
const DevPreviewHarness = dynamic(
  () => import('@/components/dev/DevPreviewHarness').then((m) => m.DevPreviewHarness),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-screen w-screen items-center justify-center bg-black text-gray-400">
        正在加载预览工位…
      </div>
    ),
  },
);

export default function DevPreviewPage(): JSX.Element | null {
  const [bodyId, setBodyId] = useState<string | null>(null);

  useEffect(() => {
    if (isProduction) return;
    const params = new URLSearchParams(window.location.search);
    setBodyId(params.get('body'));
  }, []);

  // 生产：空页（路由不可用）
  if (isProduction) {
    return <div className="h-screen w-screen bg-black" />;
  }

  return <DevPreviewHarness bodyId={bodyId} />;
}
