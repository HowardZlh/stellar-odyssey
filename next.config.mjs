import { PHASE_DEVELOPMENT_SERVER } from 'next/constants.js';

/** @type {import('next').NextConfig} */
const baseConfig = {
  // 静态导出：项目为纯前端（无 API 路由/服务端功能），导出到 out/ 供 GitHub Pages 托管
  output: 'export',
  reactStrictMode: true,
  transpilePackages: ['three'],
  // 关闭开发模式左下角的 Next.js "N" 指示器：与站内左下角「商业合作」角标位置冲突
  devIndicators: false,
};

/**
 * 多端口并行开发支持。
 *
 * Next.js 会在 `<distDir>/dev/lock` 放一把互斥锁，同一个 distDir 同时只允许一个
 * dev server 运行——仅靠 `next dev -p <port>` 换端口无效，第二个实例会直接报
 * "Another next dev server is already running." 退出。为每个实例指定独立的
 * distDir 即可绕开该锁，实现同一份代码并行跑多个端口（见 npm scripts
 * `dev:3100` / `dev:3200`）。
 *
 * 该覆盖**只在 dev 阶段生效**，原因是 `output: 'export'` 下自定义 distDir 会被
 * Next 特殊处理（见 next/dist/build/index.js 中的 `hasCustomExportOutput`）：
 * 静态导出产物会改落到 distDir 而不是 `out/`，同时内部构建目录被强制改回
 * `.next`。若让它影响 `next build`，GitHub Pages 部署（deploy.yml 上传 `out/`）
 * 会拿不到产物。
 *
 * @type {import('next').NextConfig | ((phase: string) => import('next').NextConfig)}
 */
export default function nextConfig(phase) {
  if (phase === PHASE_DEVELOPMENT_SERVER && process.env.NEXT_DIST_DIR) {
    return { ...baseConfig, distDir: process.env.NEXT_DIST_DIR };
  }
  return baseConfig;
}
