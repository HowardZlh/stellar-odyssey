/**
 * 根文档壳（H 迭代 H1：路由组双根布局共享件）
 *
 * `(zh)/layout.tsx` 与 `(en)/layout.tsx` 是两个 Next root layout（各自决定
 * `<html lang>` 与全站 metadata），html/body/Cloudflare beacon 的实体只在
 * 本文件一份——**禁止在两个 layout 里各写一份副本**。`global-not-found.tsx`
 * 绕过 layout 渲染，同样复用本组件。
 *
 * Server Component（无 'use client'）：Script 为 next/script 服务端可渲染组件。
 */

import type { JSX, ReactNode } from 'react';
import type { Viewport } from 'next';
import Script from 'next/script';

/** `<html lang>` 合法取值（与 i18n `htmlLangFor` 输出一致） */
export type RootHtmlLang = 'zh-CN' | 'en';

/**
 * 移动端 viewport（M1-2）：锁定页面级缩放（双指捏合完全交给
 * OrbitControls，配合 globals.css touch-action）；viewportFit cover
 * 铺满刘海屏（safe-area inset 由 tailwind safe-* spacing 工具类避让）。
 * 两根布局共用同一份（各自 `export const viewport = rootViewport`）。
 */
export const rootViewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
};

export interface RootDocumentProps {
  lang: RootHtmlLang;
  children: ReactNode;
}

export function RootDocument({ lang, children }: RootDocumentProps): JSX.Element {
  return (
    <html lang={lang}>
      {/* suppressHydrationWarning：浏览器扩展（如 Grammarly）会在 React 水合前向
          <body> 注入自有属性（data-gr-ext-installed 等）造成 SSR/客户端属性不一致的
          水合警告——仅抑制该元素自身的属性差异告警，子树水合校验不受影响 */}
      <body suppressHydrationWarning className="bg-space-dark text-gray-100 antialiased">
        {children}
        {/* Cloudflare Web Analytics（RUM beacon，手动嵌码：仅统计本站，隐私友好无 cookie） */}
        <Script
          src="https://static.cloudflareinsights.com/beacon.min.js"
          strategy="afterInteractive"
          data-cf-beacon='{"token": "57f4fc115f504054a82eddfc2e78c36d"}'
        />
      </body>
    </html>
  );
}
