/**
 * 主场景页 server 薄壳（G 迭代 M3 G7 拆壳：metadata 由 server 层导出；
 * H 迭代 H7：服务端预渲染 zh 落地正文 + hreflang 首页对）
 *
 * title/description/OG 沿用 `(zh)/layout.tsx` 全站定义（首页即站点门面），
 * 此处补 canonical 与 hreflang（`/` ↔ `/en`）。层叠：正文层 z-0
 * （HomeLandingArticle，零客户端 JS）在下，客户端场景层 z-10 在上并铺满
 * ——正常用户体验与拆壳前逐像素等价；禁用 JS 时 noscript 样式隐藏场景层，
 * 爬虫读到 ≥300 汉字正文（单测锁定）。主场景首屏 JS 不变。
 */

import type { JSX } from "react";
import type { Metadata } from "next";
import HomePageClient from "../HomePageClient";
import {
  HomeLandingArticle,
  HOME_SCENE_LAYER_CLASS,
} from "@/components/Home/HomeLandingArticle";
import { HOME_LANGUAGE_ALTERNATES } from "@/utils/siteMeta";

export const metadata: Metadata = {
  alternates: { canonical: "/", languages: { ...HOME_LANGUAGE_ALTERNATES } },
};

export default function HomeRoute(): JSX.Element {
  return (
    <>
      <HomeLandingArticle locale="zh" />
      <div className={`${HOME_SCENE_LAYER_CLASS} fixed inset-0 z-10 bg-space-dark`}>
        <HomePageClient />
      </div>
    </>
  );
}
