import type { JSX } from 'react';
import type { Metadata } from 'next';
import Script from 'next/script';
import './globals.css';

export const metadata: Metadata = {
  title: '星海奥德赛 Stellar Odyssey — 从行星表面到宇宙尽头的 3D 遨游',
  description:
    '基于 React + Three.js 的多层级天体运动可视化系统：滚轮从行星表面一路拉远到可观测宇宙边界，' +
    '真实开普勒轨道、太阳活动、银河系棒旋结构与星系碰撞演化，配以空间音效的科学教育遨游体验',
};

export default function RootLayout({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <html lang="zh-CN">
      <body className="bg-space-dark text-gray-100 antialiased">
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
