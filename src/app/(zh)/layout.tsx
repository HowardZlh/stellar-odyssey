/**
 * zh 根布局（H 迭代 H1：路由组 `(zh)` —— 站点默认语言，`<html lang="zh-CN">`）
 *
 * 既有全部页面（首页 / lab / unlock / donate / contributors / dev）都在本
 * 路由组下；`(en)/layout.tsx` 是并列的第二个 root layout（仅 `/en`）。
 * html/body/beacon 实体与 viewport 在 `../RootDocument.tsx` 一份共享；全站
 * metadata 由 `utils/siteMeta.buildRootMetadata('zh')` 组装（字段值与拆壳前
 * 逐字一致，单测锁定）。
 */

import type { JSX, ReactNode } from 'react';
import type { Metadata, Viewport } from 'next';
import '../globals.css';
import { RootDocument, rootViewport } from '../RootDocument';
import { buildRootMetadata } from '@/utils/siteMeta';

export const viewport: Viewport = rootViewport;

export const metadata: Metadata = buildRootMetadata('zh');

export default function RootLayout({ children }: { children: ReactNode }): JSX.Element {
  return <RootDocument lang="zh-CN">{children}</RootDocument>;
}
