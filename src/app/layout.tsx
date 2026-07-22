import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '星系运动3D可视化',
  description: '基于 React + Three.js 的多层级天体运动可视化系统',
};

export default function RootLayout({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <html lang="zh-CN">
      <body className="bg-space-dark text-gray-100 antialiased">{children}</body>
    </html>
  );
}
