/**
 * 全局 404（H 迭代 H1：`experimental.globalNotFound`，静态导出为 404.html）
 *
 * 路由组双根布局下 `/_not-found` 不再有唯一根布局可组合——若无本文件，
 * `out/404.html` 会退化为 Next 默认页（2026-09-09 实测）。本文件绕过
 * layout 直接渲染完整文档：须自行 import 全局样式；html/body 复用
 * `RootDocument`（lang 取站点默认 zh-CN，页内文案随 locale 客户端切换）。
 * 404 主体为客户端组件 `components/UI/NotFoundView`（原 `app/not-found.tsx`
 * 逻辑零改动迁移：星野 + 倒计时 + 返回按钮）。
 *
 * experimental 依赖登记：该 flag 只影响 404 页；若未来 Next 移除，退路是
 * `(zh)/not-found.tsx` + 接受 `/_not-found` 默认页（REQUIREMENTS_HOOK_EN §1）。
 */

import type { JSX } from 'react';
import type { Metadata, Viewport } from 'next';
import './globals.css';
import { RootDocument, rootViewport } from './RootDocument';
import NotFoundView from '@/components/UI/NotFoundView';
import { SITE_NAME } from '@/utils/siteMeta';

export const viewport: Viewport = rootViewport;

export const metadata: Metadata = {
  title: `404｜${SITE_NAME}`,
  robots: { index: false },
};

export default function GlobalNotFound(): JSX.Element {
  return (
    <RootDocument lang="zh-CN">
      <NotFoundView />
    </RootDocument>
  );
}
