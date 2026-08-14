/**
 * 单天体观察页 `/lab/observatory/<id>`（路径形态，静态导出）
 *
 * `generateStaticParams` 按 PREVIEW_REGISTRY 注册表为每个观察对象预生成
 * 静态页面（`output: 'export'` 要求 + `dynamicParams = false` 拒绝未注册
 * id）——URL 可直接分享直开；画廊「进入观察」为跨路由段导航（软/硬导航
 * 均正确重挂载，修复旧查询串形态同段软导航 URL 变而页面不动的缺陷）。
 *
 * 旧形态 `?body=<id>` 直达链接由画廊页（`../page.tsx`）兼容并改写地址栏。
 */

import type { JSX } from 'react';
import { registeredPreviewIds } from '@/utils/devPreview';
import { ObservatoryPageShell } from '@/components/Lab/ObservatoryPageShell';

/** 仅允许 generateStaticParams 预生成的 id（静态导出无运行时兜底） */
export const dynamicParams = false;

/** 注册表全量观察对象 → 静态页面参数（构建期展开） */
export function generateStaticParams(): { body: string }[] {
  return registeredPreviewIds().map((body) => ({ body }));
}

export default async function ObservatoryBodyPage({
  params,
}: {
  params: Promise<{ body: string }>;
}): Promise<JSX.Element> {
  const { body } = await params;
  return <ObservatoryPageShell bodyId={body} />;
}
