/**
 * H 迭代（REQUIREMENTS_HOOK_EN）回归：
 * - 双根布局：`(zh)` / `(en)` layout 输出对应 `<html lang>` 与全站 metadata；
 * - `/en` 落地页：英文 metadata（canonical / hreflang 三键 / OG en_US / en OG 图）、
 *   JSON-LD WebSite、英文正文 ≥200 词、场景层 `.home-scene-layer`；
 * - `/` 首页：hreflang 首页对 + zh 正文 ≥300 汉字 + 场景层；
 * - 三个实验室场景页：zh 正文 ≥300 汉字 + `.lab-scene-layer`；
 * - global-not-found：完整文档壳 + 自定义 404 主体；
 * - sitemap 收录 `/en`。
 *
 * 场景层内的客户端壳（HomePageClient → next/dynamic ssr:false）不在本测试
 * 中挂载：页面组件以元素树静态检查（与 observatoryNavigation 同法）。
 */

import { render, screen } from "@testing-library/react";

import EnRootLayout, { metadata as enRootMetadata } from "@/app/(en)/layout";
import ZhRootLayout, { metadata as zhRootMetadata } from "@/app/(zh)/layout";
import EnHomeRoute, { metadata as enHomeMetadata } from "@/app/(en)/en/page";
import HomeRoute, { metadata as homeMetadata } from "@/app/(zh)/page";
import MeteorRoute from "@/app/(zh)/lab/meteor-shower/page";
import SolarRoute from "@/app/(zh)/lab/solar-eclipse/page";
import LunarRoute from "@/app/(zh)/lab/lunar-eclipse/page";
import GlobalNotFound, { metadata as notFoundMetadata } from "@/app/global-not-found";
import { sitemapPaths } from "@/app/sitemap";
import { HomeLandingArticle } from "@/components/Home/HomeLandingArticle";
import NotFoundView from "@/components/UI/NotFoundView";
import { LabSceneLandingArticle } from "@/components/Lab/LabSceneLandingArticle";
import {
  countEnglishWords,
  GITHUB_REPO_URL,
  homeLandingFor,
  homeLandingVisibleText,
} from "@/utils/homeLanding";
import {
  labLandingIds,
  labSceneLandingFor,
  labSceneLandingVisibleText,
} from "@/utils/labLanding";
import { countChineseChars } from "@/utils/observatoryLanding";
import {
  EN_HOME_PATH,
  OG_IMAGE_EN_PATH,
  SITE_NAME_EN,
  SITE_ORIGIN,
} from "@/utils/siteMeta";

jest.mock("next/script", () => ({
  __esModule: true,
  default: () => null,
}));

/** 递归收集元素树中匹配谓词的节点（不挂载客户端壳） */
type El = { type: unknown; props: Record<string, unknown> };
function collect(node: unknown, hit: (el: El) => boolean, out: El[]): void {
  if (Array.isArray(node)) {
    node.forEach((child) => collect(child, hit, out));
    return;
  }
  if (node !== null && typeof node === "object" && "props" in node) {
    const el = node as El;
    if (hit(el)) out.push(el);
    collect(el.props.children, hit, out);
  }
}

const hasClass = (needle: string) => (el: El): boolean =>
  typeof el.props.className === "string" && el.props.className.includes(needle);

/** 元素树中 <noscript> 内联 <style> 文本拼接 */
function noscriptStyles(tree: unknown): string {
  const noscripts: El[] = [];
  collect(tree, (el) => el.type === "noscript", noscripts);
  const styles: El[] = [];
  noscripts.forEach((n) => collect(n.props.children, (el) => el.type === "style", styles));
  return styles.map((st) => String(st.props.children)).join("\n");
}

describe("双根布局（H1）", () => {
  it("(zh) layout metadata 为 zh 全站定义（与拆壳前 layout 同值）", () => {
    expect(String(zhRootMetadata.title)).toBe(
      "星海奥德赛 Stellar Odyssey — 从行星表面到宇宙尽头的 3D 遨游",
    );
    expect(zhRootMetadata.openGraph).toMatchObject({ locale: "zh_CN", url: SITE_ORIGIN });
  });

  it("(en) layout metadata 为英文全站定义（en_US + en OG 图）", () => {
    EnRootLayout({ children: null });
    expect(String(enRootMetadata.title)).toMatch(/^Stellar Odyssey/);
    expect(String(enRootMetadata.title)).not.toMatch(/[\u4e00-\u9fff]/);
    expect(enRootMetadata.openGraph).toMatchObject({
      locale: "en_US",
      url: `${SITE_ORIGIN}${EN_HOME_PATH}`,
      images: [{ url: OG_IMAGE_EN_PATH, width: 1200, height: 630 }],
    });
  });

  it("两根布局向 RootDocument 传入各自 lang", () => {
    const pick = (tree: unknown): string => {
      const hits: El[] = [];
      collect(tree, (el) => "lang" in el.props, hits);
      return String(hits[0]?.props.lang);
    };
    expect(pick(ZhRootLayout({ children: null }))).toBe("zh-CN");
    expect(pick(EnRootLayout({ children: null }))).toBe("en");
  });
});

describe("/en 落地页（H2/H3）", () => {
  it("metadata：英文 title、canonical /en、hreflang 三键、OG en_US、en OG 图", () => {
    expect(String(enHomeMetadata.title)).toBe(
      `A 3D journey from a planet's surface to the edge of the observable universe | ${SITE_NAME_EN}`,
    );
    expect(String(enHomeMetadata.description)).not.toMatch(/[\u4e00-\u9fff]/);
    expect(enHomeMetadata.alternates).toEqual({
      canonical: EN_HOME_PATH,
      languages: { "zh-CN": "/", en: "/en", "x-default": "/" },
    });
    expect(enHomeMetadata.openGraph).toMatchObject({
      locale: "en_US",
      siteName: SITE_NAME_EN,
      url: EN_HOME_PATH,
      images: [{ url: OG_IMAGE_EN_PATH, width: 1200, height: 630 }],
    });
  });

  it("页面结构：JSON-LD WebSite（inLanguage en）+ en 正文 + .home-scene-layer 场景层", () => {
    const jsx = EnHomeRoute();
    const scripts: El[] = [];
    collect(jsx, (el) => el.type === "script" && el.props.type === "application/ld+json", scripts);
    expect(scripts).toHaveLength(1);
    const jsonLd = JSON.parse(
      (scripts[0].props.dangerouslySetInnerHTML as { __html: string }).__html,
    ) as Record<string, unknown>;
    expect(jsonLd["@type"]).toBe("WebSite");
    expect(jsonLd.url).toBe(`${SITE_ORIGIN}${EN_HOME_PATH}`);
    expect(jsonLd.inLanguage).toBe("en");

    const articles: El[] = [];
    collect(jsx, (el) => el.type === HomeLandingArticle, articles);
    expect(articles).toHaveLength(1);
    expect(articles[0].props.locale).toBe("en");

    const layers: El[] = [];
    collect(jsx, hasClass("home-scene-layer"), layers);
    expect(layers).toHaveLength(1);
  });
});

describe("/ 首页（H7 + H3）", () => {
  it("metadata：canonical / + hreflang 首页对", () => {
    expect(homeMetadata.alternates).toEqual({
      canonical: "/",
      languages: { "zh-CN": "/", en: "/en", "x-default": "/" },
    });
  });

  it("页面结构：zh 正文 + .home-scene-layer 场景层", () => {
    const jsx = HomeRoute();
    const articles: El[] = [];
    collect(jsx, (el) => el.type === HomeLandingArticle, articles);
    expect(articles).toHaveLength(1);
    expect(articles[0].props.locale).toBe("zh");
    const layers: El[] = [];
    collect(jsx, hasClass("home-scene-layer"), layers);
    expect(layers).toHaveLength(1);
  });
});

describe("首页落地正文（utils/homeLanding + HomeLandingArticle）", () => {
  it("en：可见英文 ≥200 词、无汉字；zh：可见汉字 ≥300", () => {
    const en = homeLandingFor("en");
    expect(countEnglishWords(homeLandingVisibleText(en))).toBeGreaterThanOrEqual(200);
    // 正文（不含文末导航——中文版回链标签本身含汉字）不得混入中文
    const enBody = [en.kicker, en.heading, en.subheading, ...en.intro, ...en.sections.flatMap((s) => [s.heading, ...s.paragraphs, ...s.bullets])].join("\n");
    expect(enBody).not.toMatch(/[\u4e00-\u9fff]/);
    const zh = homeLandingFor("zh");
    expect(countChineseChars(homeLandingVisibleText(zh))).toBeGreaterThanOrEqual(300);
  });

  it("两语言结构一致：同节数、同链接数、均含 GitHub 仓库与互链", () => {
    const en = homeLandingFor("en");
    const zh = homeLandingFor("zh");
    expect(en.sections.length).toBe(zh.sections.length);
    expect(en.links.length).toBe(zh.links.length);
    expect(en.links.map((l) => l.href)).toContain(GITHUB_REPO_URL);
    expect(zh.links.map((l) => l.href)).toContain(GITHUB_REPO_URL);
    expect(en.links.map((l) => l.href)).toContain("/");
    expect(zh.links.map((l) => l.href)).toContain(EN_HOME_PATH);
  });

  it("文案边界：不含价格、不含更新义务承诺", () => {
    for (const locale of ["zh", "en"] as const) {
      const text = homeLandingVisibleText(homeLandingFor(locale));
      expect(text).not.toMatch(/[¥$]\s?\d/);
      expect(text).not.toMatch(/将持续更新|weekly updates|will keep updating/i);
    }
  });

  it("组件渲染（en）：h1、noscript 隐场景层样式、站外链接 rel=noopener、中文版回链", () => {
    const { container } = render(<HomeLandingArticle locale="en" />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Stellar Odyssey");
    // jsdom 客户端渲染不展开 <noscript> 子节点：改查元素树中的内联样式
    expect(noscriptStyles(HomeLandingArticle({ locale: "en" }))).toContain(
      ".home-scene-layer{display:none}",
    );
    const github = screen.getByRole("link", { name: "Source code on GitHub" });
    expect(github).toHaveAttribute("href", GITHUB_REPO_URL);
    expect(github).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getByRole("link", { name: "中文版 (Chinese)" })).toHaveAttribute("href", "/");
    expect(countEnglishWords(container.textContent ?? "")).toBeGreaterThanOrEqual(200);
  });

  it("组件渲染（zh）：可见汉字 ≥300，English 回链指向 /en", () => {
    const { container } = render(<HomeLandingArticle locale="zh" />);
    expect(countChineseChars(container.textContent ?? "")).toBeGreaterThanOrEqual(300);
    expect(screen.getByRole("link", { name: "English version" })).toHaveAttribute("href", EN_HOME_PATH);
  });
});

describe("实验室场景页正文（H7）", () => {
  it.each(labLandingIds())("%s：正文数据可见汉字 ≥300，标题/描述取自注册表 i18n", (id) => {
    const landing = labSceneLandingFor(id)!;
    expect(landing).not.toBeNull();
    expect(countChineseChars(labSceneLandingVisibleText(landing))).toBeGreaterThanOrEqual(300);
    expect(landing.heading.length).toBeGreaterThan(0);
    expect(landing.source.length).toBeGreaterThan(0);
  });

  it("未配置 / 未注册 id 返回 null（观察站画廊有独立 G6 正文）", () => {
    expect(labSceneLandingFor("observatory")).toBeNull();
    expect(labSceneLandingFor("nope")).toBeNull();
  });

  it("组件渲染：h1、noscript 隐场景层、来源登记、回链", () => {
    const landing = labSceneLandingFor("solar-eclipse")!;
    const { container } = render(<LabSceneLandingArticle landing={landing} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("日全食");
    expect(noscriptStyles(LabSceneLandingArticle({ landing }))).toContain(
      ".lab-scene-layer{display:none}",
    );
    expect(screen.getByText("数据与近似来源登记")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "返回实验室" })).toHaveAttribute("href", "/lab");
    expect(screen.getByRole("link", { name: "返回主站 3D 星图" })).toHaveAttribute("href", "/");
    expect(countChineseChars(container.textContent ?? "")).toBeGreaterThanOrEqual(300);
  });

  it.each([
    ["meteor-shower", MeteorRoute],
    ["solar-eclipse", SolarRoute],
    ["lunar-eclipse", LunarRoute],
  ] as const)("%s 页面结构：正文层 + .lab-scene-layer 场景层", (id, Route) => {
    const jsx = Route();
    const articles: El[] = [];
    collect(jsx, (el) => el.type === LabSceneLandingArticle, articles);
    expect(articles).toHaveLength(1);
    expect((articles[0].props.landing as { labId: string }).labId).toBe(id);
    const layers: El[] = [];
    collect(jsx, hasClass("lab-scene-layer"), layers);
    expect(layers).toHaveLength(1);
  });
});

describe("global-not-found（H1）", () => {
  it("metadata noindex；文档壳 lang zh-CN；渲染自定义 404 主体", () => {
    expect(notFoundMetadata.robots).toEqual({ index: false });
    const tree = GlobalNotFound();
    const hits: El[] = [];
    collect(tree, (el) => "lang" in el.props, hits);
    expect(hits[0]?.props.lang).toBe("zh-CN");
    // 主体为 NotFoundView（完整 html 树不在 jsdom 挂载：<html> 不能作为 div 子节点）
    const bodies: El[] = [];
    collect(tree, (el) => el.type === NotFoundView, bodies);
    expect(bodies).toHaveLength(1);
  });
});

describe("sitemap（H4）", () => {
  it("收录 /en 且紧随首页", () => {
    const paths = sitemapPaths();
    expect(paths[0]).toBe("/");
    expect(paths[1]).toBe(EN_HOME_PATH);
    expect(new Set(paths).size).toBe(paths.length);
  });
});
