'use client';

/**
 * 天体观察站画廊页 `/lab/observatory`（O1，静态导出）
 *
 * 单天体观察走路径形态 `/lab/observatory/<id>`（`[body]/page.tsx`，
 * generateStaticParams 预生成）；本页默认渲染画廊。
 *
 * 旧查询串形态 `?body=<id>` 直达链接兼容：挂载时直读
 * `window.location.search`（勿用 useSearchParams——静态导出 + Suspense
 * 边界要求，dev/preview 页同口径登记），已注册 id 照常渲染观察场景并
 * `history.replaceState` 把地址栏改写为路径形态（不重载）；未注册 id
 * 渲染画廊 + 未知 id 提示。挂载后本页无同段软导航来源（画廊 → 观察为
 * 跨路由段跳转），mount-only 读取不再有 URL 变页面不动的缺陷。
 */

import type { JSX } from 'react';
import { useEffect, useState } from 'react';
import { ObservatoryPageShell } from '@/components/Lab/ObservatoryPageShell';
import { previewEntryForBody } from '@/utils/devPreview';
import { observatoryBodyPath } from '@/utils/lab';

export default function ObservatoryPage(): JSX.Element {
  // ?body 解析完成前不挂载主组件（null 会被误判为画廊，闪烁一帧）
  const [bodyId, setBodyId] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const legacyBodyId = params.get('body');
    if (legacyBodyId !== null && previewEntryForBody(legacyBodyId) !== null) {
      // 旧分享链接 URL 显示优化：地址栏规范化为路径形态（渲染不中断）
      window.history.replaceState(null, '', observatoryBodyPath(legacyBodyId));
    }
    setBodyId(legacyBodyId);
  }, []);

  if (bodyId === undefined) {
    return <div className="h-screen w-screen bg-black" />;
  }
  return <ObservatoryPageShell bodyId={bodyId} />;
}
