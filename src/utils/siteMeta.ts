/**
 * 站点元信息纯函数（G 迭代 M3 G7，REQUIREMENTS_GROWTH.md §3 M3）
 *
 * 单一事实源：站点绝对域名 / 站点名 / OG 图路径 + 分页 metadata 组装
 * （title 模板、canonical、Open Graph / Twitter Card）。消费侧：
 * - `src/app/**` 各 server 薄壳页的 `metadata` / `generateMetadata`；
 * - `src/app/sitemap.ts`（绝对 URL 拼装）；
 * - `[body]` 天体落地页 JSON-LD 的 url 字段。
 *
 * 纯 TS 模块（`Metadata` 为 type-only import，编译期擦除），可单测
 * （覆盖率 gate ≥90%）。域名与 `src/app/layout.tsx` 的 metadataBase
 * 同源（改动须两处同步）。
 */

import type { Metadata } from "next";

/** 站点绝对域名（与 layout.tsx metadataBase 同源，无尾斜杠） */
export const SITE_ORIGIN = "https://stellar.guushu.com";

/** 站点名（layout 全站 title / OG siteName 同源） */
export const SITE_NAME = "星海奥德赛 Stellar Odyssey";

/** 全站唯一 OG 分享图（差异化 OG 图登记为未来项，G 迭代 M3 豁免） */
export const OG_IMAGE_PATH = "/og-image.png";

/** meta description 建议上限（搜索结果摘要截断口径） */
export const META_DESCRIPTION_MAX_LENGTH = 160;

/**
 * 拼装站内绝对 URL（sitemap / JSON-LD 消费）
 *
 * @throws RangeError path 不以 `/` 开头（相对路径拼装会产出坏 URL）
 */
export function absoluteUrl(path: string): string {
  if (!path.startsWith("/")) {
    throw new RangeError(`absoluteUrl 需要以 / 开头的站内路径，收到 "${path}"`);
  }
  return `${SITE_ORIGIN}${path}`;
}

/**
 * meta description 归一化：折叠空白（换行/连续空格 → 单空格）后按
 * 上限截断（超限截为 max-1 + 省略号，保证总长 ≤ max）
 */
export function truncateMetaDescription(
  text: string,
  max: number = META_DESCRIPTION_MAX_LENGTH,
): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= max) return collapsed;
  return `${collapsed.slice(0, max - 1)}…`;
}

/** 分页 metadata 组装输入 */
export interface PageMetadataInput {
  /** 页面中文标题（不含站点名，组装为 `标题｜站点名`） */
  titleZh: string;
  /** 页面描述（超限自动截断） */
  description: string;
  /** 站内路径（canonical / og:url，经 layout metadataBase 解析为绝对 URL） */
  path: string;
}

/**
 * 组装分页差异化 metadata（G7：每页 canonical + 差异化 title/description/OG）
 *
 * OG 图沿用全站唯一图（差异化 OG 图为登记未来项）；hreflang 不输出
 * （静态导出无独立语言路由，豁免理由登记于 REQUIREMENTS_GROWTH §6 M3）。
 *
 * @throws RangeError path 不以 `/` 开头
 */
export function buildPageMetadata(input: PageMetadataInput): Metadata {
  if (!input.path.startsWith("/")) {
    throw new RangeError(
      `buildPageMetadata 需要以 / 开头的站内路径，收到 "${input.path}"`,
    );
  }
  const title = `${input.titleZh}｜${SITE_NAME}`;
  const description = truncateMetaDescription(input.description);
  return {
    title,
    description,
    alternates: { canonical: input.path },
    openGraph: {
      title,
      description,
      url: input.path,
      siteName: SITE_NAME,
      locale: "zh_CN",
      type: "website",
      images: [{ url: OG_IMAGE_PATH, width: 1200, height: 630 }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [OG_IMAGE_PATH],
    },
  };
}
