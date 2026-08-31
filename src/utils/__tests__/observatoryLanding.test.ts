/**
 * 天体观察站落地页正文数据单测（G 迭代 M3 G6）
 *
 * 核心验收口径的事实源锁定：
 * - 全量 23 个注册 id 均产出正文，可见文本 ≥300 汉字（禁用 JS 可见正文
 *   验收的构建期等价断言）；
 * - 逐页 heading/description 互不相同（title/description 差异化验收）；
 * - 数据来源署名照搬既有 dataSource 字段（不新写科学结论的抽查断言）。
 */

import {
  countChineseChars,
  formatLightYearsZh,
  landingVisibleTextZh,
  observatoryLandingForBody,
  OBSERVATORY_COMMON_ZH,
} from "@/utils/observatoryLanding";
import { previewEntryForBody, registeredPreviewIds } from "@/utils/devPreview";
import { getSpecialBodyById } from "@/data/specialBodies";
import { getGalaxyById } from "@/data/galaxies";

describe("observatoryLandingForBody", () => {
  it("未注册 / 空 id 返回 null", () => {
    expect(observatoryLandingForBody(null)).toBeNull();
    expect(observatoryLandingForBody(undefined)).toBeNull();
    expect(observatoryLandingForBody("")).toBeNull();
    expect(observatoryLandingForBody("no-such-body")).toBeNull();
  });

  it("全量注册 id 均产出正文，且可见文本 ≥300 汉字（G6 验收红线）", () => {
    for (const id of registeredPreviewIds()) {
      const landing = observatoryLandingForBody(id);
      expect(landing).not.toBeNull();
      const chars = countChineseChars(landingVisibleTextZh(landing!));
      expect({ id, chars }).toEqual({ id, chars: expect.any(Number) });
      expect(chars).toBeGreaterThanOrEqual(300);
    }
  });

  it("逐页 heading 与 description 互不相同（差异化 metadata 验收）", () => {
    const ids = registeredPreviewIds();
    const headings = new Set(
      ids.map((id) => observatoryLandingForBody(id)!.headingZh),
    );
    const descriptions = new Set(
      ids.map((id) => observatoryLandingForBody(id)!.description),
    );
    expect(headings.size).toBe(ids.length);
    expect(descriptions.size).toBe(ids.length);
  });

  it("description 不超过 meta 上限 160 字符", () => {
    for (const id of registeredPreviewIds()) {
      expect(
        observatoryLandingForBody(id)!.description.length,
      ).toBeLessThanOrEqual(160);
    }
  });

  it("特殊天体页：事实行/动力学描述/来源均来自 specialBodies 既有字段", () => {
    const landing = observatoryLandingForBody("betelgeuse")!;
    const body = getSpecialBodyById("betelgeuse")!;
    expect(landing.nameLatin).toBe(body.name);
    // 事实行首行为类型行，其后逐条照搬 factsZh
    expect(landing.facts[0]).toEqual({ label: "类型", value: body.typeZh });
    for (const f of body.factsZh) {
      expect(landing.facts).toContainEqual({ label: f.label, value: f.value });
    }
    expect(landing.paragraphs[0]).toContain(body.dynamicsZh);
    expect(landing.sources).toContain(body.dataSource);
    expect(landing.sources).toContain(
      previewEntryForBody("betelgeuse")!.dataSource,
    );
  });

  it("别名映射：m13/horsehead/antennae/grb/sirius-b 命中 specialBodies 条目", () => {
    expect(observatoryLandingForBody("m13")!.nameLatin).toBe(
      getSpecialBodyById("m13-cluster")!.name,
    );
    expect(observatoryLandingForBody("horsehead")!.nameLatin).toBe(
      getSpecialBodyById("horsehead-nebula")!.name,
    );
    expect(observatoryLandingForBody("antennae")!.nameLatin).toBe(
      getSpecialBodyById("antennae-galaxies")!.name,
    );
    expect(observatoryLandingForBody("grb")!.nameLatin).toBe(
      getSpecialBodyById("grb-221009a")!.name,
    );
    expect(observatoryLandingForBody("sirius-b")!.nameLatin).toBe(
      getSpecialBodyById("sirius")!.name,
    );
  });

  it("星系页：距离/直径/视向速度/所属来自 galaxies 既有字段", () => {
    const landing = observatoryLandingForBody("m31")!;
    const galaxy = getGalaxyById("m31")!;
    expect(landing.nameLatin).toBe(galaxy.name);
    expect(landing.facts).toContainEqual({ label: "类型", value: "旋涡星系" });
    expect(landing.facts).toContainEqual({
      label: "距离",
      value: "约 250 万光年",
    });
    expect(landing.facts).toContainEqual({
      label: "直径",
      value: "约 15.2 万光年",
    });
    expect(landing.facts).toContainEqual({
      label: "视向速度",
      value: "110 km/s（接近银河系）",
    });
    expect(landing.facts).toContainEqual({
      label: "所属",
      value: galaxy.groupZh,
    });
    expect(landing.paragraphs[0]).toContain(galaxy.descriptionZh);
    expect(landing.sources).toContain(galaxy.dataSource);
  });

  it("退行星系（m87）视向速度标注为退行，且带运动口径段", () => {
    const landing = observatoryLandingForBody("m87")!;
    expect(landing.facts).toContainEqual({
      label: "视向速度",
      value: "1284 km/s（退行）",
    });
    expect(landing.paragraphs.some((p) => p.startsWith("主场景运动呈现"))).toBe(
      true,
    );
  });

  it("技术演示件（volume-test/blackhole-test）：标注类型且沿用注册表来源登记", () => {
    for (const id of ["volume-test", "blackhole-test"]) {
      const landing = observatoryLandingForBody(id)!;
      expect(landing.nameLatin).toBeNull();
      expect(landing.facts[0].label).toBe("类型");
      expect(landing.facts[0].value).toContain("技术演示");
      expect(landing.sources).toContain(previewEntryForBody(id)!.dataSource);
    }
  });

  it("预设视角条目（m87）presetLabels 非空并计入可见文本", () => {
    const landing = observatoryLandingForBody("m87")!;
    expect(landing.presetLabels.length).toBeGreaterThan(0);
    expect(landingVisibleTextZh(landing)).toContain(landing.presetLabels[0]);
  });

  it("可调参数标签照搬注册表滑杆 label 原文", () => {
    const landing = observatoryLandingForBody("grb")!;
    const entry = previewEntryForBody("grb")!;
    expect(landing.adjustableLabels).toEqual(entry.params.map((p) => p.label));
  });

  it("通用产品说明段收录于每页正文（产品性文案，非科学陈述）", () => {
    for (const id of registeredPreviewIds()) {
      expect(observatoryLandingForBody(id)!.paragraphs).toContain(
        OBSERVATORY_COMMON_ZH,
      );
    }
  });
});

describe("formatLightYearsZh", () => {
  it("亿/万/原值分档且保留 ≤1 位小数", () => {
    expect(formatLightYearsZh(2.4e9)).toBe("约 24 亿光年");
    expect(formatLightYearsZh(2.5e6)).toBe("约 250 万光年");
    expect(formatLightYearsZh(152000)).toBe("约 15.2 万光年");
    expect(formatLightYearsZh(8.6)).toBe("约 8.6 光年");
    expect(formatLightYearsZh(100)).toBe("约 100 光年");
  });

  it("非正 / 非有限输入抛 RangeError", () => {
    expect(() => formatLightYearsZh(0)).toThrow(RangeError);
    expect(() => formatLightYearsZh(-5)).toThrow(RangeError);
    expect(() => formatLightYearsZh(Number.NaN)).toThrow(RangeError);
    expect(() => formatLightYearsZh(Number.POSITIVE_INFINITY)).toThrow(
      RangeError,
    );
  });
});

describe("countChineseChars", () => {
  it("仅统计汉字（忽略字母/数字/标点）", () => {
    expect(countChineseChars("银河系 Milky Way 100,000 ly。")).toBe(3);
    expect(countChineseChars("abc 123")).toBe(0);
    expect(countChineseChars("")).toBe(0);
  });
});
