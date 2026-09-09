/**
 * 英文落地页 `/en`（H 迭代 H2，REQUIREMENTS_HOOK_EN.md §3）
 *
 * 国际投放（Show HN / r/threejs / X）的统一落点：位于 `(en)` 根布局下，
 * 原始 HTML 即 `<html lang="en">` + 英文 title/description/OG（en_US，
 * en OG 图）+ hreflang 首页对 + JSON-LD WebSite；服务端预渲染英文正文
 * （≥200 词，禁用 JS 可见，单测锁定）在 z-0，客户端主场景层 z-10 铺满
 * 其上。场景层 UI 语言由 `useLocaleInit` 的路由默认（`/en` → en）决定，
 * `?lang=` 与用户存值仍优先（i18n/index.ts 登记）。
 *
 * 与 `/` 的差别只有语言与 metadata：3D 场景组件同一份（HomePageClient）。
 */

import type { JSX } from "react";
import type { Metadata } from "next";
import HomePageClient from "../../HomePageClient";
import {
  HomeLandingArticle,
  HOME_SCENE_LAYER_CLASS,
} from "@/components/Home/HomeLandingArticle";
import {
  absoluteUrl,
  buildPageMetadata,
  EN_HOME_PATH,
  HOME_LANGUAGE_ALTERNATES,
  SITE_NAME_EN,
  SITE_ORIGIN,
} from "@/utils/siteMeta";

export const metadata: Metadata = buildPageMetadata({
  title: "A 3D journey from a planet's surface to the edge of the observable universe",
  description:
    "Open-source React + Three.js visualization of the cosmos across four scales: real Keplerian orbits, " +
    "solar activity, Gaia DR3 stars, 43,488 real galaxies from 2MRS, raymarched nebulae and lensed black holes.",
  path: EN_HOME_PATH,
  locale: "en",
  languages: HOME_LANGUAGE_ALTERNATES,
});

export default function EnHomeRoute(): JSX.Element {
  return (
    <>
      {/* JSON-LD 结构化数据（脚本内容不计入可见正文口径） */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "WebSite",
            name: SITE_NAME_EN,
            url: absoluteUrl(EN_HOME_PATH),
            inLanguage: "en",
            description: String(metadata.description),
            isPartOf: { "@type": "WebSite", name: SITE_NAME_EN, url: `${SITE_ORIGIN}/` },
          }),
        }}
      />
      <HomeLandingArticle locale="en" />
      <div className={`${HOME_SCENE_LAYER_CLASS} fixed inset-0 z-10 bg-space-dark`}>
        <HomePageClient />
      </div>
    </>
  );
}
