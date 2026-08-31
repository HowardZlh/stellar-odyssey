/**
 * 站点元信息与天体落地页 SEO 回归（G 迭代 M3 G6/G7）：
 * - sitemap：收录范围 ≥30 URL、全部绝对 URL、首尾页在列；
 * - `[body]` generateMetadata：23 页 title/description/canonical 差异化；
 * - 服务端正文组件：渲染后可见汉字 ≥300、含来源登记与画廊回链；
 * - `[body]` 页结构：JSON-LD 脚本 + `.obs-scene-layer` 场景层包裹客户端壳；
 * - 四个拆壳页（unlock/donate/lab/contributors）+ 画廊/实验室场景页
 *   metadata 差异化且 canonical 正确。
 */

import { render, screen } from "@testing-library/react";

import sitemap, { sitemapPaths } from "@/app/sitemap";
import {
  generateMetadata as generateBodyMetadata,
  default as ObservatoryBodyPage,
} from "@/app/lab/observatory/[body]/page";
import { metadata as unlockMetadata } from "@/app/unlock/page";
import { metadata as donateMetadata } from "@/app/donate/page";
import { metadata as labMetadata } from "@/app/lab/page";
import { metadata as contributorsMetadata } from "@/app/contributors/page";
import { metadata as galleryMetadata } from "@/app/lab/observatory/page";
import { metadata as meteorMetadata } from "@/app/lab/meteor-shower/page";
import { metadata as solarMetadata } from "@/app/lab/solar-eclipse/page";
import { metadata as lunarMetadata } from "@/app/lab/lunar-eclipse/page";
import { metadata as homeMetadata } from "@/app/page";
import { ObservatoryLandingArticle } from "@/components/Lab/ObservatoryLandingArticle";
import {
  countChineseChars,
  observatoryLandingForBody,
} from "@/utils/observatoryLanding";
import { registeredPreviewIds } from "@/utils/devPreview";
import { SITE_ORIGIN } from "@/utils/siteMeta";

describe("sitemap（G7）", () => {
  it("收录 ≥30 个 URL 且全部为站点绝对 URL", () => {
    const entries = sitemap();
    expect(entries.length).toBeGreaterThanOrEqual(30);
    for (const entry of entries) {
      expect(entry.url.startsWith(SITE_ORIGIN)).toBe(true);
    }
  });

  it("覆盖首页/实验室/23 天体页/unlock/donate/contributors", () => {
    const paths = sitemapPaths();
    expect(paths).toContain("/");
    expect(paths).toContain("/lab");
    expect(paths).toContain("/lab/meteor-shower");
    expect(paths).toContain("/lab/observatory");
    expect(paths).toContain("/lab/solar-eclipse");
    expect(paths).toContain("/lab/lunar-eclipse");
    expect(paths).toContain("/unlock");
    expect(paths).toContain("/donate");
    expect(paths).toContain("/contributors");
    for (const id of registeredPreviewIds()) {
      expect(paths).toContain(`/lab/observatory/${id}`);
    }
    // 收录清单去重（同路径重复收录即配置错误）
    expect(new Set(paths).size).toBe(paths.length);
  });
});

describe("[body] generateMetadata（G6/G7）", () => {
  it("23 页 title/description 互不相同且 canonical 指向自身路径", async () => {
    const titles = new Set<string>();
    const descriptions = new Set<string>();
    for (const id of registeredPreviewIds()) {
      const meta = await generateBodyMetadata({
        params: Promise.resolve({ body: id }),
      });
      titles.add(String(meta.title));
      descriptions.add(String(meta.description));
      expect(meta.alternates).toEqual({ canonical: `/lab/observatory/${id}` });
    }
    expect(titles.size).toBe(registeredPreviewIds().length);
    expect(descriptions.size).toBe(registeredPreviewIds().length);
  });

  it("title 与首页（layout 全站 title）不同且含站点名", async () => {
    const meta = await generateBodyMetadata({
      params: Promise.resolve({ body: "m31" }),
    });
    expect(String(meta.title)).toContain("仙女座星系");
    expect(String(meta.title)).toContain("星海奥德赛");
    expect(String(meta.title)).not.toBe(
      "星海奥德赛 Stellar Odyssey — 从行星表面到宇宙尽头的 3D 遨游",
    );
  });
});

describe("服务端正文组件（G6 禁用 JS 可见正文）", () => {
  it.each(["m31", "betelgeuse", "volume-test"])(
    "%s：渲染可见汉字 ≥300",
    (id) => {
      const landing = observatoryLandingForBody(id)!;
      const { container, unmount } = render(
        <ObservatoryLandingArticle landing={landing} />,
      );
      expect(
        countChineseChars(container.textContent ?? ""),
      ).toBeGreaterThanOrEqual(300);
      unmount();
    },
  );

  it("含小节标题、来源登记与画廊/实验室/主站回链", () => {
    const landing = observatoryLandingForBody("m31")!;
    render(<ObservatoryLandingArticle landing={landing} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      landing.headingZh,
    );
    expect(screen.getByText("数据与近似来源登记")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "返回天体观察站画廊" }),
    ).toHaveAttribute("href", "/lab/observatory");
    expect(
      screen.getByRole("link", { name: "前往天文实验室" }),
    ).toHaveAttribute("href", "/lab");
    expect(
      screen.getByRole("link", { name: "返回主站 3D 星图" }),
    ).toHaveAttribute("href", "/");
  });
});

describe("[body] 页面结构（JSON-LD + 场景层）", () => {
  /** 递归收集元素树中匹配谓词的节点 */
  const collect = (
    node: unknown,
    hit: (el: { type: unknown; props: Record<string, unknown> }) => boolean,
    out: unknown[],
  ): void => {
    if (Array.isArray(node)) {
      node.forEach((child) => collect(child, hit, out));
      return;
    }
    if (node !== null && typeof node === "object" && "props" in node) {
      const el = node as { type: unknown; props: Record<string, unknown> };
      if (hit(el)) out.push(el);
      collect(el.props.children, hit, out);
    }
  };

  it("输出 application/ld+json 脚本与 .obs-scene-layer 场景层", async () => {
    const jsx = await ObservatoryBodyPage({
      params: Promise.resolve({ body: "m31" }),
    });
    const scripts: unknown[] = [];
    collect(
      jsx,
      (el) => el.type === "script" && el.props.type === "application/ld+json",
      scripts,
    );
    expect(scripts).toHaveLength(1);
    const html = (
      scripts[0] as { props: { dangerouslySetInnerHTML: { __html: string } } }
    ).props.dangerouslySetInnerHTML.__html;
    const jsonLd = JSON.parse(html) as Record<string, unknown>;
    expect(jsonLd["@type"]).toBe("CreativeWork");
    expect(jsonLd.url).toBe(`${SITE_ORIGIN}/lab/observatory/m31`);
    expect(jsonLd.inLanguage).toBe("zh-CN");

    const layers: unknown[] = [];
    collect(
      jsx,
      (el) =>
        typeof el.props.className === "string" &&
        el.props.className.includes("obs-scene-layer"),
      layers,
    );
    expect(layers).toHaveLength(1);
  });
});

describe("拆壳页 metadata 差异化（G7）", () => {
  it("unlock/donate/lab/contributors/画廊/三实验室 title 互不相同且含站点名", () => {
    const titles = [
      unlockMetadata.title,
      donateMetadata.title,
      labMetadata.title,
      contributorsMetadata.title,
      galleryMetadata.title,
      meteorMetadata.title,
      solarMetadata.title,
      lunarMetadata.title,
    ].map(String);
    expect(new Set(titles).size).toBe(titles.length);
    for (const title of titles) {
      expect(title).toContain("星海奥德赛");
      expect(title).not.toBe(
        "星海奥德赛 Stellar Odyssey — 从行星表面到宇宙尽头的 3D 遨游",
      );
    }
  });

  it("canonical 指向各自路径；首页薄壳补 canonical /", () => {
    expect(unlockMetadata.alternates).toEqual({ canonical: "/unlock" });
    expect(donateMetadata.alternates).toEqual({ canonical: "/donate" });
    expect(labMetadata.alternates).toEqual({ canonical: "/lab" });
    expect(contributorsMetadata.alternates).toEqual({
      canonical: "/contributors",
    });
    expect(galleryMetadata.alternates).toEqual({
      canonical: "/lab/observatory",
    });
    expect(meteorMetadata.alternates).toEqual({
      canonical: "/lab/meteor-shower",
    });
    expect(solarMetadata.alternates).toEqual({
      canonical: "/lab/solar-eclipse",
    });
    expect(lunarMetadata.alternates).toEqual({
      canonical: "/lab/lunar-eclipse",
    });
    expect(homeMetadata.alternates).toEqual({ canonical: "/" });
  });

  it("description 差异化（unlock ≠ donate ≠ lab）", () => {
    const descs = [
      unlockMetadata.description,
      donateMetadata.description,
      labMetadata.description,
    ];
    expect(new Set(descs.map(String)).size).toBe(descs.length);
  });
});
