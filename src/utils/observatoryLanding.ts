/**
 * 天体观察站落地页正文数据（G 迭代 M3 G6，REQUIREMENTS_GROWTH.md §3 M3）
 *
 * 纯逻辑模块：把 PREVIEW_REGISTRY 注册条目与既有天体数据
 * （data/specialBodies · data/galaxies · i18n 观察站标题键）重组为
 * `/lab/observatory/<id>` 的服务端可索引正文（禁用 JS 可见 ≥300 汉字，
 * 单测锁定）与差异化 metadata 字段。**不新写科学结论**——天体事实全部
 * 来自既有数据字段拼装；仅 `OBSERVATORY_COMMON_ZH` 与技术演示导语为
 * 产品性说明文案（描述页面自身能力，非科学陈述）。
 *
 * i18n 豁免登记（zh.ts 文件头同步）：正文为构建期 Server Component
 * 静态输出——静态导出无独立语言路由，默认 zh；页内 zh/EN 切换仅作用于
 * 客户端场景层（REQUIREMENTS_GROWTH §6 M3 豁免登记）。
 */

import { previewEntryForBody } from "@/utils/devPreview";
import { truncateMetaDescription } from "@/utils/siteMeta";
import { getSpecialBodyById } from "@/data/specialBodies";
import { getGalaxyById, GALAXY_MOTION_NOTE_ZH } from "@/data/galaxies";
import { t } from "@/i18n";

/** 落地页关键参数行（label/value 均为既有数据字段原文） */
export interface ObservatoryLandingFact {
  label: string;
  value: string;
}

/** 单天体落地页正文数据（服务端渲染 + generateMetadata 消费） */
export interface ObservatoryLanding {
  /** 观察对象 id（与 PREVIEW_REGISTRY 一致） */
  bodyId: string;
  /** 页面主标题（i18n zh 观察站标题，如「参宿四 · 红超巨星」） */
  headingZh: string;
  /** 西文名（数据层 name 字段；技术演示件为 null） */
  nameLatin: string | null;
  /** meta description（已按上限截断，逐页差异化） */
  description: string;
  /** 正文段落（导语 → 运动口径（星系）→ 场景说明 → 通用产品说明） */
  paragraphs: readonly string[];
  /** 关键参数表 */
  facts: readonly ObservatoryLandingFact[];
  /** 观察场景可调参数标签（注册表滑杆 label 原文） */
  adjustableLabels: readonly string[];
  /** 预设视角标签（无则空数组） */
  presetLabels: readonly string[];
  /** 数据与近似来源登记（注册表 + 数据层 dataSource 去重） */
  sources: readonly string[];
}

/**
 * 注册表 id → specialBodies 数据 id 的差异映射（其余 id 同名直查；
 * sirius-b 复用双星条目 sirius，页面差异由标题/描述承担）
 */
const SPECIAL_BODY_ALIAS: Readonly<Record<string, string>> = {
  "sirius-b": "sirius",
  horsehead: "horsehead-nebula",
  m13: "m13-cluster",
  antennae: "antennae-galaxies",
  grb: "grb-221009a",
};

/** 星系形态 → 中文名（data/galaxies morphology 字段直译表） */
const MORPHOLOGY_ZH: Readonly<Record<string, string>> = {
  spiral: "旋涡星系",
  "barred-spiral": "棒旋星系",
  elliptical: "椭圆星系",
  irregular: "不规则星系",
};

/**
 * 技术演示件导语（volume-test / blackhole-test 无数据层条目；文案由
 * 各自注册条目的 title / 滑杆标签 / dataSource 既有措辞重组，无新科学结论）
 */
const TECH_DEMO_INTRO_ZH: Readonly<Record<string, string>> = {
  "volume-test":
    "「体积云测试体」是天体观察站的技术演示件：不对应单一真实天体，用于展示体积渲染（raymarch）管线的实时观感——程序化 fBm 密度场、Hα/OIII 双色映射、质量档自动降级与蓝噪声抖动开关均可在场景内实时对比。",
  "blackhole-test":
    "「黑洞引力透镜」是天体观察站的技术演示件：不对应单一真实天体，用于展示实时引力透镜渲染管线——光子环、背景星光弯曲与吸积盘上下缘翻折像，可实时调节质量尺度、盘倾角、盘内外缘与束流强度做观感对比。",
};

/** 技术演示件的关键参数「类型」行（产品性说明，非科学陈述） */
const TECH_DEMO_TYPE_ZH = "技术演示（实时渲染管线展示件，不对应单一真实天体）";

/**
 * 通用产品说明段（所有落地页共用；描述页面自身能力与数据口径，
 * 非科学陈述——科学事实一律来自数据字段）
 */
export const OBSERVATORY_COMMON_ZH =
  "天体观察站是「星海奥德赛 Stellar Odyssey」的免费天文实验室页面之一：进入观察后，浏览器将加载基于 WebGL 的实时三维渲染场景，支持拖拽旋转、滚轮或双指捏合缩放，并可通过控制面板实时调节下方登记的参数、对比不同设置下的观感差异，界面提供中英双语切换。页面呈现为科学可视化近似而非观测照片：天体形态与物理参数整理自公开天文数据与文献，全部近似处理与数据来源在下方逐条登记。";

/** 落地页正文小节标题（服务端正文渲染与可见文本统计同源） */
export const OBSERVATORY_ARTICLE_LABELS_ZH = {
  kicker: "星海奥德赛 · 天体观察站",
  facts: "关键参数",
  adjustables: "观察场景可调参数",
  presets: "预设视角",
  sources: "数据与近似来源登记",
  backGallery: "返回天体观察站画廊",
  backLab: "前往天文实验室",
  home: "返回主站 3D 星图",
} as const;

/** 光年数值 → 中文可读文本（亿/万分档，保留 ≤1 位小数） */
export function formatLightYearsZh(ly: number): string {
  if (!Number.isFinite(ly) || ly <= 0) {
    throw new RangeError(`formatLightYearsZh 需要正有限数，收到 ${ly}`);
  }
  if (ly >= 1e8) return `约 ${trimTo1(ly / 1e8)} 亿光年`;
  if (ly >= 1e4) return `约 ${trimTo1(ly / 1e4)} 万光年`;
  return `约 ${trimTo1(ly)} 光年`;
}

/** 数值保留 ≤1 位小数（整数不带小数点） */
function trimTo1(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/** 句尾补全：无句号则追加（数据字段多数不带句尾标点） */
function ensureSentence(text: string): string {
  const trimmed = text.trim();
  return trimmed.endsWith("。") ? trimmed : `${trimmed}。`;
}

/**
 * 按观察对象 id 组装落地页正文数据
 *
 * @returns 已注册 id 返回正文数据；未注册 / 空 id 返回 null
 *   （`[body]` 路由 dynamicParams=false，构建期即拒绝未注册 id，
 *   null 分支为纯函数防御口径）
 */
export function observatoryLandingForBody(
  id: string | null | undefined,
): ObservatoryLanding | null {
  const entry = previewEntryForBody(id);
  if (!entry) return null;

  const headingZh = entry.titleKey ? t("zh", entry.titleKey) : entry.title;
  const special = getSpecialBodyById(
    SPECIAL_BODY_ALIAS[entry.bodyId] ?? entry.bodyId,
  );
  const galaxy = getGalaxyById(entry.bodyId);

  const paragraphs: string[] = [];
  const facts: ObservatoryLandingFact[] = [];
  let nameLatin: string | null = null;
  let detailForDescription: string;

  if (special) {
    nameLatin = special.name;
    paragraphs.push(
      `${special.nameZh}（${special.name}）：${special.typeZh}。${ensureSentence(special.dynamicsZh)}`,
    );
    facts.push({ label: "类型", value: special.typeZh });
    for (const f of special.factsZh) {
      facts.push({ label: f.label, value: f.value });
    }
    detailForDescription = `${special.typeZh}。${special.dynamicsZh}`;
  } else if (galaxy) {
    nameLatin = galaxy.name;
    const morphologyZh = MORPHOLOGY_ZH[galaxy.morphology] ?? "星系";
    paragraphs.push(
      `${galaxy.nameZh}（${galaxy.name}）：${morphologyZh}，属${galaxy.groupZh}。${ensureSentence(galaxy.descriptionZh)}`,
    );
    const motionNote = GALAXY_MOTION_NOTE_ZH[entry.bodyId];
    if (motionNote) {
      paragraphs.push(
        `主场景运动呈现（模拟口径）：${ensureSentence(motionNote)}`,
      );
    }
    facts.push({ label: "类型", value: morphologyZh });
    facts.push({ label: "距离", value: formatLightYearsZh(galaxy.distanceLy) });
    facts.push({ label: "直径", value: formatLightYearsZh(galaxy.diameterLy) });
    facts.push({
      label: "视向速度",
      value: `${Math.abs(galaxy.radialVelocityKmS)} km/s（${galaxy.radialVelocityKmS < 0 ? "接近银河系" : "退行"}）`,
    });
    facts.push({ label: "所属", value: galaxy.groupZh });
    detailForDescription = galaxy.descriptionZh;
  } else {
    paragraphs.push(
      TECH_DEMO_INTRO_ZH[entry.bodyId] ??
        `「${entry.title}」是天体观察站的技术演示件：不对应单一真实天体，用于展示项目的实时渲染管线。`,
    );
    facts.push({ label: "类型", value: TECH_DEMO_TYPE_ZH });
    detailForDescription =
      "星海奥德赛天体观察站技术演示场景：实时 WebGL 渲染、参数可实时调节。";
  }

  const presetLabels = (entry.viewPresets ?? []).map((v) => v.label);
  paragraphs.push(
    `本页对应的实时观察场景为「${entry.title}」，提供 ${entry.params.length} 个可实时调节的参数` +
      `${presetLabels.length > 0 ? `与 ${presetLabels.length} 个预设视角` : ""}，完整清单见下文登记。`,
  );
  paragraphs.push(OBSERVATORY_COMMON_ZH);

  const sources: string[] = [];
  for (const s of [entry.dataSource, special?.dataSource, galaxy?.dataSource]) {
    if (s && !sources.includes(s)) sources.push(s);
  }

  return {
    bodyId: entry.bodyId,
    headingZh,
    nameLatin,
    description: truncateMetaDescription(
      `${headingZh}在线 3D 观察——${detailForDescription}`,
    ),
    paragraphs,
    facts,
    adjustableLabels: entry.params.map((p) => p.label),
    presetLabels,
    sources,
  };
}

/**
 * 落地页可见文本全量拼接（与 ObservatoryLandingArticle 渲染内容同构；
 * 「禁用 JS 可见正文 ≥300 汉字」验收口径的单测事实源）
 */
export function landingVisibleTextZh(landing: ObservatoryLanding): string {
  const L = OBSERVATORY_ARTICLE_LABELS_ZH;
  return [
    L.kicker,
    landing.headingZh,
    landing.nameLatin ?? "",
    ...landing.paragraphs,
    L.facts,
    ...landing.facts.flatMap((f) => [f.label, f.value]),
    L.adjustables,
    ...landing.adjustableLabels,
    ...(landing.presetLabels.length > 0
      ? [L.presets, ...landing.presetLabels]
      : []),
    L.sources,
    ...landing.sources,
    L.backGallery,
    L.backLab,
    L.home,
  ].join("\n");
}

/** 统计文本中的汉字数（CJK 统一表意文字基本区） */
export function countChineseChars(text: string): number {
  const matches = text.match(/[\u4e00-\u9fff]/g);
  return matches ? matches.length : 0;
}
