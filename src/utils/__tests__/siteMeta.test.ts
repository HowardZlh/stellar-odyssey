/**
 * 站点元信息纯函数单测（G 迭代 M3 G7；H 迭代 H1/H3 双语根 metadata + hreflang）
 */

import {
  absoluteUrl,
  buildPageMetadata,
  buildRootMetadata,
  EN_HOME_PATH,
  HOME_LANGUAGE_ALTERNATES,
  META_DESCRIPTION_MAX_LENGTH,
  OG_IMAGE_EN_PATH,
  OG_IMAGE_PATH,
  SITE_NAME,
  SITE_NAME_EN,
  SITE_ORIGIN,
  truncateMetaDescription,
} from "@/utils/siteMeta";

describe("absoluteUrl", () => {
  it("拼装站点绝对 URL", () => {
    expect(absoluteUrl("/")).toBe(`${SITE_ORIGIN}/`);
    expect(absoluteUrl("/lab/observatory/m31")).toBe(
      `${SITE_ORIGIN}/lab/observatory/m31`,
    );
  });

  it("非 / 开头路径抛 RangeError", () => {
    expect(() => absoluteUrl("lab")).toThrow(RangeError);
    expect(() => absoluteUrl("")).toThrow(RangeError);
  });
});

describe("truncateMetaDescription", () => {
  it("折叠空白并保留短文本原样", () => {
    expect(truncateMetaDescription("a\n b\t c")).toBe("a b c");
    expect(truncateMetaDescription("  短文本  ")).toBe("短文本");
  });

  it("超限截断为 max-1 + 省略号（总长 ≤ max）", () => {
    const long = "汉".repeat(300);
    const out = truncateMetaDescription(long);
    expect(out.length).toBe(META_DESCRIPTION_MAX_LENGTH);
    expect(out.endsWith("…")).toBe(true);
    const custom = truncateMetaDescription(long, 20);
    expect(custom.length).toBe(20);
  });
});

describe("buildPageMetadata", () => {
  it("组装差异化 title/description/canonical/OG/Twitter", () => {
    const meta = buildPageMetadata({
      title: "支持者解锁",
      description: "解锁近观细节层",
      path: "/unlock",
    });
    expect(meta.title).toBe(`支持者解锁｜${SITE_NAME}`);
    expect(meta.description).toBe("解锁近观细节层");
    expect(meta.alternates).toEqual({ canonical: "/unlock" });
    expect(meta.openGraph).toMatchObject({
      title: `支持者解锁｜${SITE_NAME}`,
      url: "/unlock",
      siteName: SITE_NAME,
      locale: "zh_CN",
      images: [{ url: OG_IMAGE_PATH, width: 1200, height: 630 }],
    });
    expect(meta.twitter).toMatchObject({
      card: "summary_large_image",
      images: [OG_IMAGE_PATH],
    });
  });

  it("description 超限自动截断", () => {
    const meta = buildPageMetadata({
      title: "页",
      description: "汉".repeat(500),
      path: "/x",
    });
    expect((meta.description as string).length).toBe(
      META_DESCRIPTION_MAX_LENGTH,
    );
  });

  it("非 / 开头路径抛 RangeError", () => {
    expect(() =>
      buildPageMetadata({ title: "x", description: "y", path: "bad" }),
    ).toThrow(RangeError);
  });
});

describe("buildPageMetadata（H3 双语 + hreflang）", () => {
  it("en 页：英文站点名分隔符、OG en_US、en OG 图", () => {
    const meta = buildPageMetadata({
      title: "Stellar Odyssey in English",
      description: "desc",
      path: EN_HOME_PATH,
      locale: "en",
    });
    expect(meta.title).toBe(`Stellar Odyssey in English | ${SITE_NAME_EN}`);
    expect(meta.openGraph).toMatchObject({
      siteName: SITE_NAME_EN,
      locale: "en_US",
      images: [{ url: OG_IMAGE_EN_PATH, width: 1200, height: 630 }],
    });
    expect(meta.twitter).toMatchObject({ images: [OG_IMAGE_EN_PATH] });
  });

  it("传入 languages 时输出 hreflang 映射（副本，不共享引用）", () => {
    const meta = buildPageMetadata({
      title: "首页",
      description: "d",
      path: "/",
      languages: HOME_LANGUAGE_ALTERNATES,
    });
    expect(meta.alternates).toEqual({
      canonical: "/",
      languages: { "zh-CN": "/", en: "/en", "x-default": "/" },
    });
    expect(meta.alternates?.languages).not.toBe(HOME_LANGUAGE_ALTERNATES);
  });

  it("未传 languages 的页面不输出 hreflang（无语言对不硬凑）", () => {
    const meta = buildPageMetadata({ title: "x", description: "y", path: "/lab" });
    expect(meta.alternates).toEqual({ canonical: "/lab" });
    expect("languages" in (meta.alternates ?? {})).toBe(false);
  });
});

describe("buildRootMetadata（H1 两根布局）", () => {
  it("zh 根 metadata 与拆壳前 layout 逐字一致（回归锚点）", () => {
    const meta = buildRootMetadata("zh");
    expect(meta.title).toBe(
      "星海奥德赛 Stellar Odyssey — 从行星表面到宇宙尽头的 3D 遨游",
    );
    expect(String(meta.metadataBase)).toBe(`${SITE_ORIGIN}/`);
    expect(meta.openGraph).toMatchObject({
      title: SITE_NAME,
      url: SITE_ORIGIN,
      siteName: SITE_NAME,
      locale: "zh_CN",
      images: [{ url: OG_IMAGE_PATH, width: 1200, height: 630 }],
    });
    expect(meta.icons).toMatchObject({ apple: "/apple-touch-icon.png" });
  });

  it("en 根 metadata：英文标题/描述、OG en_US 指向 /en、en OG 图", () => {
    const meta = buildRootMetadata("en");
    expect(String(meta.title)).toMatch(/^Stellar Odyssey — /);
    expect(String(meta.title)).not.toMatch(/[\u4e00-\u9fff]/);
    expect(String(meta.description)).not.toMatch(/[\u4e00-\u9fff]/);
    expect(meta.openGraph).toMatchObject({
      title: SITE_NAME_EN,
      url: `${SITE_ORIGIN}${EN_HOME_PATH}`,
      siteName: SITE_NAME_EN,
      locale: "en_US",
      images: [{ url: OG_IMAGE_EN_PATH, width: 1200, height: 630 }],
    });
    expect(meta.twitter).toMatchObject({ images: [OG_IMAGE_EN_PATH] });
  });
});
