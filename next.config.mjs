/** @type {import('next').NextConfig} */
const nextConfig = {
  // 静态导出：项目为纯前端（无 API 路由/服务端功能），导出到 out/ 供 GitHub Pages 托管
  output: 'export',
  reactStrictMode: true,
  transpilePackages: ['three'],
};

export default nextConfig;
