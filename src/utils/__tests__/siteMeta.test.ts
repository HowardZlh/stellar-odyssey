/**
 * 站点元信息纯函数单测（G 迭代 M3 G7）
 */

import {
  absoluteUrl,
  buildPageMetadata,
  META_DESCRIPTION_MAX_LENGTH,
  OG_IMAGE_PATH,
  SITE_NAME,
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
      titleZh: "支持者解锁",
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
      titleZh: "页",
      description: "汉".repeat(500),
      path: "/x",
    });
    expect((meta.description as string).length).toBe(
      META_DESCRIPTION_MAX_LENGTH,
    );
  });

  it("非 / 开头路径抛 RangeError", () => {
    expect(() =>
      buildPageMetadata({ titleZh: "x", description: "y", path: "bad" }),
    ).toThrow(RangeError);
  });
});
