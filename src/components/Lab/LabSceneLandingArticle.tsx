/**
 * 实验室场景页服务端正文（H 迭代 H7，Server Component——本文件**不得**加
 * 'use client'，正文零客户端 JS）
 *
 * 层叠约定（三个场景页 `page.tsx` 消费，与观察站 G6 / 首页 H7 同款）：
 * 本组件为 fixed 全屏可滚层（z-0），客户端场景层在页面里包
 * `lab-scene-layer fixed inset-0 z-10` 覆盖其上；`<noscript>` 内联样式在
 * 禁用 JS 时隐藏场景层，使正文可见可滚动。
 *
 * 文案来源：utils/labLanding 按 i18n 键配方重组（zh 静态输出豁免登记见
 * 该模块文件头）。
 */

import type { JSX } from "react";
import Link from "next/link";
import type { LabSceneLanding } from "@/utils/labLanding";
import { LAB_PAGE_PATH } from "@/utils/lab";
import { t } from "@/i18n";

/** 客户端场景层类名（页面包裹层与 noscript 样式同源） */
export const LAB_SCENE_LAYER_CLASS = "lab-scene-layer";

/** 正文区块标题（产品性说明文案，非科学陈述） */
export const LAB_ARTICLE_LABELS_ZH = {
  kicker: "星海奥德赛 · 天文实验室",
  controls: "可切换事件与可调参数",
  hint: "操作提示",
  source: "数据与近似来源登记",
  home: "返回主站 3D 星图",
} as const;

export interface LabSceneLandingArticleProps {
  landing: LabSceneLanding;
}

export function LabSceneLandingArticle({ landing }: LabSceneLandingArticleProps): JSX.Element {
  const L = LAB_ARTICLE_LABELS_ZH;
  return (
    <div className="hud-scroll fixed inset-0 z-0 overflow-y-auto bg-space-dark pb-[calc(2.5rem+env(safe-area-inset-bottom))] pl-[max(1.5rem,env(safe-area-inset-left))] pr-[max(1.5rem,env(safe-area-inset-right))] pt-[max(2.5rem,env(safe-area-inset-top))] text-gray-200">
      {/* 禁用 JS 时隐藏客户端场景层（含其加载占位），露出本正文层 */}
      <noscript>
        <style>{`.${LAB_SCENE_LAYER_CLASS}{display:none}`}</style>
      </noscript>
      <article className="mx-auto max-w-3xl">
        <p className="text-xs text-space-accent">{L.kicker}</p>
        <h1 className="mt-2 text-2xl font-semibold text-gray-100">{landing.heading}</h1>
        <p className="mt-4 text-sm leading-6 text-gray-300">{landing.description}</p>

        <div className="mt-6 space-y-4 text-sm leading-6 text-gray-300">
          {landing.paragraphs.map((paragraph) => (
            <p key={paragraph.slice(0, 24)}>{paragraph}</p>
          ))}
        </div>

        <h2 className="mt-8 text-lg font-medium text-sky-300">{L.controls}</h2>
        <ul className="mt-3 flex flex-wrap gap-2 text-sm text-gray-300">
          {landing.controlLabels.map((label) => (
            <li key={label} className="rounded border border-gray-700 px-2 py-0.5">
              {label}
            </li>
          ))}
        </ul>

        <h2 className="mt-8 text-lg font-medium text-sky-300">{L.hint}</h2>
        <p className="mt-3 text-sm leading-6 text-gray-300">{landing.hint}</p>

        <h2 className="mt-8 text-lg font-medium text-sky-300">{L.source}</h2>
        <p className="mt-3 text-xs leading-5 text-gray-500">{landing.source}</p>

        <nav className="mt-10 flex flex-wrap gap-x-6 gap-y-3 pb-6 text-sm">
          <Link href={LAB_PAGE_PATH} className="text-space-accent hover:underline">
            {t("zh", "lab.backToLab")}
          </Link>
          <Link href="/" className="text-space-accent hover:underline">
            {L.home}
          </Link>
        </nav>
      </article>
    </div>
  );
}
