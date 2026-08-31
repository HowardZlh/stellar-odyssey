/**
 * 单天体观察页 `/lab/observatory/<id>`（路径形态，静态导出）
 *
 * `generateStaticParams` 按 PREVIEW_REGISTRY 注册表为每个观察对象预生成
 * 静态页面（`output: 'export'` 要求 + `dynamicParams = false` 拒绝未注册
 * id）——URL 可直接分享直开；画廊「进入观察」为跨路由段导航（软/硬导航
 * 均正确重挂载，修复旧查询串形态同段软导航 URL 变而页面不动的缺陷）。
 *
 * 旧形态 `?body=<id>` 直达链接由画廊页（`../page.tsx`）兼容并改写地址栏。
 *
 * G 迭代 M3（G6 可索引落地页）：
 * - 服务端渲染正文（简介 + 关键参数 + 来源登记，禁用 JS 可见 ≥300 汉字，
 *   utils/observatoryLanding 拼装 + 单测锁定）；
 * - 客户端场景层包 `fixed inset-0 z-10`（.obs-scene-layer）覆盖正文层，
 *   `<noscript>` 样式在禁用 JS 时隐藏场景层（层叠约定见
 *   ObservatoryLandingArticle 文件头）——正文零客户端 JS，首屏 chunk 不变；
 * - `generateMetadata` 逐页差异化 title/description/canonical/OG
 *   （OG 图沿用全站唯一图，差异化 OG 图登记为未来项）；
 * - JSON-LD（CreativeWork）内联登记页面结构化数据。
 */

import type { JSX } from "react";
import type { Metadata } from "next";
import { registeredPreviewIds } from "@/utils/devPreview";
import { observatoryLandingForBody } from "@/utils/observatoryLanding";
import {
  absoluteUrl,
  buildPageMetadata,
  SITE_NAME,
  SITE_ORIGIN,
} from "@/utils/siteMeta";
import { observatoryBodyPath } from "@/utils/lab";
import { ObservatoryPageShell } from "@/components/Lab/ObservatoryPageShell";
import { ObservatoryLandingArticle } from "@/components/Lab/ObservatoryLandingArticle";

/** 仅允许 generateStaticParams 预生成的 id（静态导出无运行时兜底） */
export const dynamicParams = false;

/** 注册表全量观察对象 → 静态页面参数（构建期展开） */
export function generateStaticParams(): { body: string }[] {
  return registeredPreviewIds().map((body) => ({ body }));
}

/** 逐页差异化 metadata（G7：title/description/canonical/OG） */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ body: string }>;
}): Promise<Metadata> {
  const { body } = await params;
  const landing = observatoryLandingForBody(body);
  if (!landing) return {};
  return buildPageMetadata({
    titleZh: `${landing.headingZh} · 天体观察站`,
    description: landing.description,
    path: observatoryBodyPath(body),
  });
}

export default async function ObservatoryBodyPage({
  params,
}: {
  params: Promise<{ body: string }>;
}): Promise<JSX.Element> {
  const { body } = await params;
  const landing = observatoryLandingForBody(body);
  return (
    <>
      {landing !== null && (
        <>
          {/* JSON-LD 结构化数据（脚本内容不计入可见正文口径） */}
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{
              __html: JSON.stringify({
                "@context": "https://schema.org",
                "@type": "CreativeWork",
                name: landing.headingZh,
                description: landing.description,
                url: absoluteUrl(observatoryBodyPath(body)),
                inLanguage: "zh-CN",
                isPartOf: {
                  "@type": "WebSite",
                  name: SITE_NAME,
                  url: `${SITE_ORIGIN}/`,
                },
              }),
            }}
          />
          <ObservatoryLandingArticle landing={landing} />
        </>
      )}
      {/* 客户端场景层：覆盖正文（z-10）；禁用 JS 时经 noscript 样式隐藏 */}
      <div className="obs-scene-layer fixed inset-0 z-10">
        <ObservatoryPageShell bodyId={body} />
      </div>
    </>
  );
}
