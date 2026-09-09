/**
 * 首页落地正文（H 迭代 H2/H7，Server Component——本文件**不得**加
 * 'use client'，正文零客户端 JS，首屏 chunk 不变）
 *
 * 层叠约定（`(zh)/page.tsx` 与 `(en)/en/page.tsx` 消费，与观察站 G6 同款）：
 * 本组件为 fixed 全屏可滚层（z-0），客户端场景层在页面里包
 * `home-scene-layer fixed inset-0 z-10 bg-space-dark` 覆盖其上（自带底色：
 * WebGL 不可用/Canvas 未首帧时仍不透出正文，与拆壳前"深色底 + UI"一致）；
 * `<noscript>` 内联样式在禁用 JS 时隐藏场景层，使正文可见可滚动——爬虫、
 * 链接预览与无 JS 环境读正文，正常用户体验与拆壳前逐像素等价。
 *
 * 文案来源：utils/homeLanding 纯数据（zh/en 两份，产品能力陈述 + 既有
 * 事实，文案边界登记见该模块文件头）。
 */

import type { JSX } from "react";
import Link from "next/link";
import { homeLandingFor } from "@/utils/homeLanding";
import type { Locale } from "@/types";

/** 客户端场景层类名（页面包裹层与 noscript 样式同源） */
export const HOME_SCENE_LAYER_CLASS = "home-scene-layer";

export interface HomeLandingArticleProps {
  locale: Locale;
}

export function HomeLandingArticle({ locale }: HomeLandingArticleProps): JSX.Element {
  const landing = homeLandingFor(locale);
  return (
    <div
      className="hud-scroll fixed inset-0 z-0 overflow-y-auto bg-space-dark pb-[calc(2.5rem+env(safe-area-inset-bottom))] pl-[max(1.5rem,env(safe-area-inset-left))] pr-[max(1.5rem,env(safe-area-inset-right))] pt-[max(2.5rem,env(safe-area-inset-top))] text-gray-200"
      lang={locale === "en" ? "en" : "zh-CN"}
    >
      {/* 禁用 JS 时隐藏客户端场景层（含其加载占位），露出本正文层 */}
      <noscript>
        <style>{`.${HOME_SCENE_LAYER_CLASS}{display:none}`}</style>
      </noscript>
      <article className="mx-auto max-w-3xl">
        <p className="text-xs text-space-accent">{landing.kicker}</p>
        <h1 className="mt-2 text-3xl font-semibold text-gray-100">{landing.heading}</h1>
        <p className="mt-2 text-base text-gray-300">{landing.subheading}</p>

        <noscript>
          <p className="mt-4 rounded border border-space-accent/40 bg-space-panel px-3 py-2 text-sm text-gray-300">
            {landing.noscriptNote}
          </p>
        </noscript>

        <div className="mt-6 space-y-4 text-sm leading-6 text-gray-300">
          {landing.intro.map((paragraph) => (
            <p key={paragraph.slice(0, 32)}>{paragraph}</p>
          ))}
        </div>

        {landing.sections.map((section) => (
          <section key={section.heading} className="mt-8">
            <h2 className="text-lg font-medium text-sky-300">{section.heading}</h2>
            {section.paragraphs.map((paragraph) => (
              <p key={paragraph.slice(0, 32)} className="mt-3 text-sm leading-6 text-gray-300">
                {paragraph}
              </p>
            ))}
            {section.bullets.length > 0 && (
              <ul className="mt-3 list-disc space-y-1 pl-5 text-sm leading-6 text-gray-300">
                {section.bullets.map((bullet) => (
                  <li key={bullet.slice(0, 32)}>{bullet}</li>
                ))}
              </ul>
            )}
          </section>
        ))}

        <h2 className="mt-8 text-lg font-medium text-sky-300">{landing.linksHeading}</h2>
        <nav className="mt-3 flex flex-wrap gap-x-6 gap-y-3 pb-6 text-sm">
          {landing.links.map((link) =>
            link.external ? (
              <a
                key={link.href}
                href={link.href}
                rel="noopener noreferrer"
                target="_blank"
                className="text-space-accent hover:underline"
              >
                {link.label}
              </a>
            ) : (
              <Link key={link.href} href={link.href} className="text-space-accent hover:underline">
                {link.label}
              </Link>
            ),
          )}
        </nav>
      </article>
    </div>
  );
}
