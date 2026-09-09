/**
 * 站点元信息纯函数（G 迭代 M3 G7，REQUIREMENTS_GROWTH.md §3 M3；H 迭代 H1/H3 扩展双语）
 *
 * 单一事实源：站点绝对域名 / 站点名（zh·en）/ OG 图路径（zh·en）+ 全站
 * 根 metadata 与分页 metadata 组装（title 模板、canonical、hreflang、
 * Open Graph / Twitter Card）。消费侧：
 * - `src/app/(zh)/layout.tsx` 与 `src/app/(en)/layout.tsx` 两根布局的
 *   全站 metadata（`buildRootMetadata`）；
 * - `src/app/**` 各 server 薄壳页的 `metadata` / `generateMetadata`；
 * - `src/app/sitemap.ts`（绝对 URL 拼装）；
 * - `[body]` 天体落地页 JSON-LD 的 url 字段。
 *
 * hreflang 口径（H3）：只有真实存在语言对的页面才输出——目前仅首页对
 * `/`（zh-CN）↔ `/en`（en），`x-default` 指向 `/`；其余页面无 en 镜像，
 * 不输出（硬凑即错误信号，G7 原豁免理由对其余页面继续成立）。
 *
 * 纯 TS 模块（`Metadata` 为 type-only import，编译期擦除），可单测
 * （覆盖率 gate ≥90%）。
 */

import type { Metadata } from "next";
import type { Locale } from "@/types";

/** 站点绝对域名（两根布局 metadataBase 同源，无尾斜杠） */
export const SITE_ORIGIN = "https://stellar.guushu.com";

/** 站点名（zh 全站 title / OG siteName 同源） */
export const SITE_NAME = "星海奥德赛 Stellar Odyssey";

/** 英文站点名（`/en` 落地页与 en 根布局 title / OG siteName） */
export const SITE_NAME_EN = "Stellar Odyssey";

/** zh 全站 OG 分享图（差异化 OG 图登记为未来项，G 迭代 M3 豁免） */
export const OG_IMAGE_PATH = "/og-image.png";

/** en OG 分享图（H5：矢量源 scripts/og-image/og-image-en.svg 栅格化） */
export const OG_IMAGE_EN_PATH = "/og-image-en.png";

/** 英文落地页路径（H2；sitemap / hreflang / 分享链接同源） */
export const EN_HOME_PATH = "/en";

/**
 * 首页对 hreflang 映射（H3）：`/` 与 `/en` 两页共用同一份，
 * `x-default` 指向 zh 首页（站点默认语言）。
 */
export const HOME_LANGUAGE_ALTERNATES: Readonly<Record<string, string>> = {
  "zh-CN": "/",
  en: EN_HOME_PATH,
  "x-default": "/",
};

/** meta description 建议上限（搜索结果摘要截断口径） */
export const META_DESCRIPTION_MAX_LENGTH = 160;

/** 全站根 metadata 文案（两语言各一份，`buildRootMetadata` 消费） */
const ROOT_COPY: Readonly<
  Record<
    Locale,
    {
      title: string;
      description: string;
      ogTitle: string;
      ogDescription: string;
      siteName: string;
      ogLocale: string;
      ogImage: string;
    }
  >
> = {
  zh: {
    title: "星海奥德赛 Stellar Odyssey — 从行星表面到宇宙尽头的 3D 遨游",
    description:
      "基于 React + Three.js 的多层级天体运动可视化系统：滚轮从行星表面一路拉远到可观测宇宙边界，" +
      "真实开普勒轨道、太阳活动、银河系棒旋结构与星系碰撞演化，配以空间音效的科学教育遨游体验",
    ogTitle: SITE_NAME,
    ogDescription:
      "从行星表面到宇宙尽头的一次滚轮之旅——科学数据驱动的沉浸式 3D 宇宙遨游",
    siteName: SITE_NAME,
    ogLocale: "zh_CN",
    ogImage: OG_IMAGE_PATH,
  },
  en: {
    title:
      "Stellar Odyssey — A 3D journey from a planet's surface to the edge of the observable universe",
    description:
      "An open-source React + Three.js visualization of the cosmos across four scales: scroll from a planet's surface " +
      "to the Solar System, the Milky Way and the observable universe. Real Keplerian orbits, solar activity, " +
      "Gaia DR3 stars and 2MRS galaxies, volumetric nebulae and a gravitationally lensed black hole — in the browser.",
    ogTitle: SITE_NAME_EN,
    ogDescription:
      "One scroll wheel from a planet's surface to the edge of the observable universe — an open-source, data-driven 3D cosmos in your browser.",
    siteName: SITE_NAME_EN,
    ogLocale: "en_US",
    ogImage: OG_IMAGE_EN_PATH,
  },
};

/**
 * 全站根 metadata（两根布局各调一次；icons 两语言共用）
 *
 * zh 版字段值与 H1 之前的 `src/app/layout.tsx` 逐字一致（拆壳零变更登记）。
 */
export function buildRootMetadata(locale: Locale): Metadata {
  const copy = ROOT_COPY[locale];
  return {
    metadataBase: new URL(SITE_ORIGIN),
    title: copy.title,
    description: copy.description,
    // 站点图标（public/ 下静态资源：SVG 矢量 + ICO 回退 + iOS 主屏）
    icons: {
      icon: [
        { url: "/favicon.ico", sizes: "32x32" },
        { url: "/icon.svg", type: "image/svg+xml" },
      ],
      apple: "/apple-touch-icon.png",
    },
    // 社交分享卡片（Open Graph / Twitter Card）
    openGraph: {
      title: copy.ogTitle,
      description: copy.ogDescription,
      url: locale === "en" ? absoluteUrl(EN_HOME_PATH) : SITE_ORIGIN,
      siteName: copy.siteName,
      locale: copy.ogLocale,
      type: "website",
      images: [{ url: copy.ogImage, width: 1200, height: 630 }],
    },
    twitter: {
      card: "summary_large_image",
      title: copy.ogTitle,
      description: copy.ogDescription,
      images: [copy.ogImage],
    },
  };
}

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
  /** 页面标题（不含站点名；zh 组装为 `标题｜站点名`，en 为 `Title | Stellar Odyssey`） */
  title: string;
  /** 页面描述（超限自动截断） */
  description: string;
  /** 站内路径（canonical / og:url，经 layout metadataBase 解析为绝对 URL） */
  path: string;
  /** 页面语言（默认 zh；决定站点名 / OG locale / OG 图 / 标题分隔符） */
  locale?: Locale;
  /** hreflang 映射（仅有真实语言对的页面传入，见文件头口径） */
  languages?: Readonly<Record<string, string>>;
}

/**
 * 组装分页差异化 metadata（G7：每页 canonical + 差异化 title/description/OG；
 * H3：可选 hreflang）
 *
 * @throws RangeError path 不以 `/` 开头
 */
export function buildPageMetadata(input: PageMetadataInput): Metadata {
  if (!input.path.startsWith("/")) {
    throw new RangeError(
      `buildPageMetadata 需要以 / 开头的站内路径，收到 "${input.path}"`,
    );
  }
  const locale: Locale = input.locale ?? "zh";
  const copy = ROOT_COPY[locale];
  const title =
    locale === "en"
      ? `${input.title} | ${SITE_NAME_EN}`
      : `${input.title}｜${SITE_NAME}`;
  const description = truncateMetaDescription(input.description);
  const alternates: NonNullable<Metadata["alternates"]> = {
    canonical: input.path,
  };
  if (input.languages !== undefined) {
    alternates.languages = { ...input.languages };
  }
  return {
    title,
    description,
    alternates,
    openGraph: {
      title,
      description,
      url: input.path,
      siteName: copy.siteName,
      locale: copy.ogLocale,
      type: "website",
      images: [{ url: copy.ogImage, width: 1200, height: 630 }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [copy.ogImage],
    },
  };
}
