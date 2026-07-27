'use client';

/**
 * 自定义 404 页（静态导出为 404.html，替代 GitHub Pages 默认 404 页）
 *
 * 项目风格：深空星野背景（确定性星场，utils/random）+ 科幻文案。
 * 10 秒倒计时自动返回首页（location.replace 不留浏览历史），
 * 并提供「立即返回星图」按钮。
 */

import type { JSX } from 'react';
import { useEffect, useState } from 'react';

import { NOT_FOUND_REDIRECT_DELAY_SEC, countdownNext, redirectHome } from '@/utils/notFound';
import { createSeededRandom } from '@/utils/random';

interface Star {
  /** 水平位置（viewBox 百分比 0-100） */
  x: number;
  /** 垂直位置（viewBox 百分比 0-100） */
  y: number;
  /** 半径（viewBox 单位） */
  r: number;
  /** 透明度（暗星多、亮星少，模拟星等分布） */
  opacity: number;
}

/** 星野星数（纯装饰 DOM 节点，控制数量避免渲染负担） */
const STAR_COUNT = 140;

/** 确定性星场（种子固定 404：位置稳定，SSR/CSR 渲染一致无水合差异） */
const STARS: readonly Star[] = ((): readonly Star[] => {
  const rand = createSeededRandom(404);
  const stars: Star[] = [];
  for (let i = 0; i < STAR_COUNT; i += 1) {
    stars.push({
      x: rand() * 100,
      y: rand() * 100,
      r: 0.08 + rand() * 0.22,
      opacity: 0.25 + rand() * 0.75,
    });
  }
  return stars;
})();

export default function NotFound(): JSX.Element {
  const [remainingSec, setRemainingSec] = useState(NOT_FOUND_REDIRECT_DELAY_SEC);

  // 每真实秒推进倒计时（下钳 0）
  useEffect(() => {
    const timer = window.setInterval(() => {
      setRemainingSec((prev) => countdownNext(prev));
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  // 倒计时归零自动返回首页（replace 不留浏览历史）
  useEffect(() => {
    if (remainingSec === 0) redirectHome();
  }, [remainingSec]);

  return (
    <main className="fixed inset-0 flex items-center justify-center overflow-hidden bg-space-dark text-gray-200">
      {/* 深空星野（确定性星场 + 中心微弱星云辉光） */}
      <svg
        className="pointer-events-none absolute inset-0 h-full w-full"
        viewBox="0 0 100 100"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden="true"
      >
        <defs>
          <radialGradient id="nf-nebula" cx="50%" cy="42%" r="60%">
            <stop offset="0%" stopColor="#243a6b" stopOpacity="0.55" />
            <stop offset="45%" stopColor="#141d3d" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#0a0a14" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect x="0" y="0" width="100" height="100" fill="url(#nf-nebula)" />
        {STARS.map((star, i) => (
          <circle
            // 星场为静态列表（模块级常量，顺序恒定），索引 key 安全
            key={i}
            cx={star.x}
            cy={star.y}
            r={star.r}
            fill="#dbe7ff"
            opacity={star.opacity}
          />
        ))}
      </svg>

      <div className="relative z-10 max-w-md px-6 text-center">
        <p className="bg-gradient-to-b from-space-accent to-indigo-300 bg-clip-text text-8xl font-bold tracking-widest text-transparent">
          404
        </p>
        <h1 className="mt-4 text-xl font-semibold text-gray-100">你已漂流到已知宇宙之外</h1>
        <p className="mt-3 text-sm leading-relaxed text-gray-400">
          这片坐标上观测不到任何天体——页面不存在，或已被引力弹弓抛向了别处。
        </p>
        <p className="mt-6 text-xs text-gray-500" role="status">
          <span className="font-mono text-space-accent">{remainingSec}</span> 秒后自动返回星图
        </p>
        <button
          type="button"
          onClick={() => redirectHome()}
          className="mt-4 rounded-lg border border-space-accent/60 bg-space-panel px-6 py-2 text-sm text-space-accent backdrop-blur transition-colors hover:bg-space-accent/20"
        >
          立即返回星图
        </button>
      </div>
    </main>
  );
}
