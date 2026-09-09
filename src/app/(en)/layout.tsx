/**
 * en 根布局（H 迭代 H1：路由组 `(en)` —— 仅承载 `/en` 英文落地页，
 * `<html lang="en">` + 英文全站 metadata / OG）
 *
 * 与 `(zh)/layout.tsx` 并列为第二个 Next root layout：静态导出下这是让
 * 英文页在**无 JS 的原始 HTML** 里就带正确 `lang` 与英文分享卡的唯一方式
 * （HN / Reddit / X 的链接预览不执行 JS）。跨根布局导航为整页加载，对
 * 落地页无影响。html/body/beacon 与 viewport 复用 `../RootDocument.tsx`。
 */

import type { JSX, ReactNode } from 'react';
import type { Metadata, Viewport } from 'next';
import '../globals.css';
import { RootDocument, rootViewport } from '../RootDocument';
import { buildRootMetadata } from '@/utils/siteMeta';

export const viewport: Viewport = rootViewport;

export const metadata: Metadata = buildRootMetadata('en');

export default function EnRootLayout({ children }: { children: ReactNode }): JSX.Element {
  return <RootDocument lang="en">{children}</RootDocument>;
}
