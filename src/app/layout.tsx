import type { JSX } from 'react';
import type { Metadata } from 'next';
import Script from 'next/script';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL('https://stellar.guushu.com'),
  title: '星海奥德赛 Stellar Odyssey — 从行星表面到宇宙尽头的 3D 遨游',
  description:
    '基于 React + Three.js 的多层级天体运动可视化系统：滚轮从行星表面一路拉远到可观测宇宙边界，' +
    '真实开普勒轨道、太阳活动、银河系棒旋结构与星系碰撞演化，配以空间音效的科学教育遨游体验',
  // 站点图标（public/ 下静态资源：SVG 矢量 + ICO 回退 + iOS 主屏）
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: '32x32' },
      { url: '/icon.svg', type: 'image/svg+xml' },
    ],
    apple: '/apple-touch-icon.png',
  },
  // 社交分享卡片（Open Graph / Twitter Card）
  openGraph: {
    title: '星海奥德赛 Stellar Odyssey',
    description: '从行星表面到宇宙尽头的一次滚轮之旅——科学数据驱动的沉浸式 3D 宇宙遨游',
    url: 'https://stellar.guushu.com',
    siteName: '星海奥德赛 Stellar Odyssey',
    locale: 'zh_CN',
    type: 'website',
    images: [{ url: '/og-image.png', width: 1200, height: 630 }],
  },
  twitter: {
    card: 'summary_large_image',
    title: '星海奥德赛 Stellar Odyssey',
    description: '从行星表面到宇宙尽头的一次滚轮之旅——科学数据驱动的沉浸式 3D 宇宙遨游',
    images: ['/og-image.png'],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <html lang="zh-CN">
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
