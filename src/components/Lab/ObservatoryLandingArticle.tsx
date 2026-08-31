/**
 * 天体观察站落地页服务端正文（G 迭代 M3 G6，Server Component——
 * 本文件**不得**加 'use client'，正文零客户端 JS）
 *
 * 层叠约定（`[body]/page.tsx` 消费）：本组件为 fixed 全屏可滚层（z-0），
 * 客户端场景层在页面里包 `fixed inset-0 z-10` 覆盖其上；`<noscript>`
 * 内联样式在禁用 JS 时隐藏场景层（`.obs-scene-layer`），使正文可见
 * 可滚动——爬虫与无 JS 环境读正文，正常用户体验不变。
 *
 * 文案来源：utils/observatoryLanding 纯函数拼装（既有数据字段重组，
 * zh 静态输出豁免登记见该模块文件头）。
 */

import type { JSX } from "react";
import Link from "next/link";
import {
  OBSERVATORY_ARTICLE_LABELS_ZH as L,
  type ObservatoryLanding,
} from "@/utils/observatoryLanding";
import { LAB_PAGE_PATH, OBSERVATORY_PAGE_PATH } from "@/utils/lab";

export interface ObservatoryLandingArticleProps {
  landing: ObservatoryLanding;
}

export function ObservatoryLandingArticle({
  landing,
}: ObservatoryLandingArticleProps): JSX.Element {
  return (
    <div className="hud-scroll fixed inset-0 z-0 overflow-y-auto bg-space-dark pb-[calc(2.5rem+env(safe-area-inset-bottom))] pl-[max(1.5rem,env(safe-area-inset-left))] pr-[max(1.5rem,env(safe-area-inset-right))] pt-[max(2.5rem,env(safe-area-inset-top))] text-gray-200">
      {/* 禁用 JS 时隐藏客户端场景层（含其加载占位），露出本正文层 */}
      <noscript>
        <style>{".obs-scene-layer{display:none}"}</style>
      </noscript>
      <article className="mx-auto max-w-3xl">
        <p className="text-xs text-space-accent">{L.kicker}</p>
        <h1 className="mt-2 text-2xl font-semibold text-gray-100">
          {landing.headingZh}
        </h1>
        {landing.nameLatin !== null && (
          <p className="mt-1 text-sm text-gray-400">{landing.nameLatin}</p>
        )}

        <div className="mt-6 space-y-4 text-sm leading-6 text-gray-300">
          {landing.paragraphs.map((paragraph) => (
            <p key={paragraph.slice(0, 24)}>{paragraph}</p>
          ))}
        </div>

        <h2 className="mt-8 text-lg font-medium text-sky-300">{L.facts}</h2>
        <dl className="mt-3 space-y-2 text-sm">
          {landing.facts.map((fact) => (
            <div
              key={`${fact.label}:${fact.value.slice(0, 16)}`}
              className="flex gap-3"
            >
              <dt className="w-24 shrink-0 text-gray-500">{fact.label}</dt>
              <dd className="text-gray-300">{fact.value}</dd>
            </div>
          ))}
        </dl>

        <h2 className="mt-8 text-lg font-medium text-sky-300">
          {L.adjustables}
        </h2>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-gray-300">
          {landing.adjustableLabels.map((label) => (
            <li key={label}>{label}</li>
          ))}
        </ul>
        {landing.presetLabels.length > 0 && (
          <p className="mt-3 text-sm text-gray-300">
            {L.presets}：{landing.presetLabels.join(" / ")}
          </p>
        )}

        <h2 className="mt-8 text-lg font-medium text-sky-300">{L.sources}</h2>
        <ul className="mt-3 space-y-2 text-xs leading-5 text-gray-500">
          {landing.sources.map((source) => (
            <li key={source.slice(0, 24)}>{source}</li>
          ))}
        </ul>

        <nav className="mt-10 flex flex-wrap gap-x-6 gap-y-3 pb-6 text-sm">
          <Link
            href={OBSERVATORY_PAGE_PATH}
            className="text-space-accent hover:underline"
          >
            {L.backGallery}
          </Link>
          <Link
            href={LAB_PAGE_PATH}
            className="text-space-accent hover:underline"
          >
            {L.backLab}
          </Link>
          <Link href="/" className="text-space-accent hover:underline">
            {L.home}
          </Link>
        </nav>
      </article>
    </div>
  );
}
