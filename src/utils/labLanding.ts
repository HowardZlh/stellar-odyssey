/**
 * 实验室场景页落地正文数据（H 迭代 H7，REQUIREMENTS_HOOK_EN.md §3）
 *
 * 纯逻辑模块：为 `/lab/meteor-shower` `/lab/solar-eclipse` `/lab/lunar-eclipse`
 * 三个场景页提供**服务端预渲染**的可索引正文（禁用 JS 可见 ≥300 汉字，
 * 单测锁定）。**不新写任何科学结论**——全部段落取自既有 i18n zh 字典键
 * （场景页 UI 已公开展示的描述 / 观测点说明 / 阶段科普卡 / 操作提示）与
 * `utils/lab` 注册表的 dataSource 署名重组；键存在性由 `MessageKey` 类型
 * 保证。正文为构建期 zh 静态输出（与观察站 G6 同豁免口径，zh.ts 文件头登记）。
 */

import { t, type MessageKey } from "@/i18n";
import { LAB_REGISTRY, type LabEntry } from "@/utils/lab";

export interface LabSceneLanding {
  labId: string;
  /** 页面主标题（i18n 条目标题） */
  heading: string;
  /** 条目描述（与 metadata description 同源） */
  description: string;
  /** 正文段落（观测点 / 场景 / 科普卡片，i18n 原文） */
  paragraphs: readonly string[];
  /** 可切换 / 可调项标签（页签与控件 label 原文） */
  controlLabels: readonly string[];
  /** 操作提示（i18n 原文） */
  hint: string;
  /** 数据与近似来源登记（注册表 dataSource 原文） */
  source: string;
}

/** 各场景页的 i18n 键拼装配方（只列键，不写文案） */
interface LabLandingRecipe {
  paragraphKeys: readonly MessageKey[];
  controlKeys: readonly MessageKey[];
  hintKey: MessageKey;
}

const RECIPES: Readonly<Record<string, LabLandingRecipe>> = {
  "meteor-shower": {
    paragraphKeys: [
      "lab.stormNote1966",
      "lab.vaporizedToast",
      "lab.sonificationNote",
      "lab.demoDisclaimer",
    ],
    controlKeys: [
      "lab.showerPerseids",
      "lab.showerKappaCygnids",
      "lab.showerLeonids1966",
      "lab.viewGround",
      "lab.viewSpace",
      "lab.ctrlTimeScale",
      "lab.ctrlTimeLapse",
      "lab.ctrlHourOffset",
      "lab.ctrlLimitingMag",
      "lab.ctrlObserverLat",
      "lab.ctrlFireballRate",
      "lab.ctrlWindSpeed",
      "lab.ctrlRadiantMarker",
      "lab.audioEnable",
    ],
    hintKey: "lab.helpTips",
  },
  "solar-eclipse": {
    paragraphKeys: [
      "lab.eclipseObserver2027",
      "lab.eclipseObserver2035",
      "lab.eclipseObserver1919",
      "lab.eclipseExposureCard",
    ],
    controlKeys: [
      "lab.eclipseTab2027",
      "lab.eclipseTab2035",
      "lab.eclipseTab1919",
      "lab.eclipseAnchorC1",
      "lab.eclipseAnchorC2",
      "lab.eclipseAnchorMax",
      "lab.eclipseAnchorC3",
      "lab.eclipseAnchorC4",
      "lab.eclipsePlayModeTour",
      "lab.eclipsePlayModeReal",
      "lab.eclipseExposureTitle",
      "lab.eclipseActivityTitle",
      "lab.eclipseHypoTitle",
      "lab.eclipseCompareTitle",
      "lab.eclipseViewGround",
      "lab.eclipseViewSpace",
    ],
    hintKey: "lab.eclipseHintLookAround",
  },
  "lunar-eclipse": {
    paragraphKeys: [
      "lab.lunarObserver2029",
      "lab.lunarObserver2026",
      "lab.lunarObserver2027",
      "lab.lunarObserver1992",
      "lab.lunarCardU2",
      "lab.lunarCardMax",
    ],
    controlKeys: [
      "lab.lunarTab2029",
      "lab.lunarTab2026",
      "lab.lunarTab2027",
      "lab.lunarTab1992",
      "lab.lunarAnchorP1",
      "lab.lunarAnchorU1",
      "lab.lunarAnchorU2",
      "lab.lunarAnchorMax",
      "lab.lunarAnchorU3",
      "lab.lunarAnchorU4",
      "lab.lunarAnchorP4",
      "lab.lunarPlayModeFast",
      "lab.lunarPlayModeReal",
      "lab.lunarFollowLabel",
    ],
    hintKey: "lab.lunarHintLookAround",
  },
};

/** 已配置落地正文的场景页 id（观察站画廊 `observatory` 有独立 G6 正文，不在此） */
export function labLandingIds(): readonly string[] {
  return Object.keys(RECIPES);
}

/**
 * 取场景页落地正文；未配置配方或注册表无此条目时返回 null
 * （调用方据此决定是否渲染正文层）
 */
export function labSceneLandingFor(labId: string): LabSceneLanding | null {
  const recipe = RECIPES[labId];
  const entry: LabEntry | undefined = LAB_REGISTRY.get(labId);
  if (recipe === undefined || entry === undefined) return null;
  return {
    labId,
    heading: t("zh", entry.titleKey),
    description: t("zh", entry.descriptionKey),
    paragraphs: recipe.paragraphKeys.map((key) => t("zh", key)),
    controlLabels: recipe.controlKeys.map((key) => t("zh", key)),
    hint: t("zh", recipe.hintKey),
    source: entry.dataSource,
  };
}

/** 落地正文全部可见文本拼接（单测统计汉字数用） */
export function labSceneLandingVisibleText(landing: LabSceneLanding): string {
  return [
    landing.heading,
    landing.description,
    ...landing.paragraphs,
    ...landing.controlLabels,
    landing.hint,
    landing.source,
  ].join("\n");
}
