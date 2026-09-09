/**
 * 首页落地正文数据（H 迭代 H2/H7，REQUIREMENTS_HOOK_EN.md §3）
 *
 * 纯逻辑模块：为 `/`（zh）与 `/en`（en）两页提供**服务端预渲染**的可索引
 * 正文（禁用 JS 可见：zh ≥300 汉字 / en ≥200 英文词，单测锁定）。正文层
 * 位于客户端场景层之下（层叠约定见 `components/Home/HomeLandingArticle.tsx`），
 * 正常用户看到的仍是 3D 场景；爬虫、链接预览与无 JS 环境读到本文。
 *
 * 文案边界（登记）：
 * - 只做**产品能力陈述 + 既有事实**（开源协议、数据来源署名、页面能力），
 *   全部取自 README 已公开口径，不新写科学结论；
 * - 不写更新义务承诺、不写价格、不写内部策略（根 AGENTS.md 支持文案边界）；
 * - 双语两份结构一致（同节数、同链接集合），en 不是 zh 的逐句直译而是
 *   面向国际技术社区读者的独立表述（P3 锚点）。
 */

import type { Locale } from "@/types";
import { EN_HOME_PATH } from "@/utils/siteMeta";
import { LAB_PAGE_PATH } from "@/utils/lab";

/** 开源仓库地址（README / ContactBadge issues 链接同源仓库） */
export const GITHUB_REPO_URL = "https://github.com/HowardZlh/stellar-odyssey";

/** 仓库内文档绝对链接（main 分支 blob 视图） */
export function repoDocUrl(relativePath: string): string {
  return `${GITHUB_REPO_URL}/blob/main/${relativePath.replace(/^\/+/, "")}`;
}

export interface LandingSection {
  heading: string;
  paragraphs: readonly string[];
  bullets: readonly string[];
}

export interface LandingLink {
  label: string;
  href: string;
  /** 站外链接（渲染 rel=noopener） */
  external: boolean;
}

export interface HomeLanding {
  locale: Locale;
  /** 眉标（小字，如 "Open-source · Runs in your browser"） */
  kicker: string;
  heading: string;
  subheading: string;
  /** 导语段落 */
  intro: readonly string[];
  sections: readonly LandingSection[];
  /** 文末导航 */
  links: readonly LandingLink[];
  /** 链接区标题 */
  linksHeading: string;
  /** 无 JS 提示（noscript 内可见） */
  noscriptNote: string;
}

const HOW_IT_WORKS_EN = repoDocUrl("docs/en/how-it-works.md");
const HOW_IT_WORKS_ZH = repoDocUrl("docs/how-it-works.md");
const SCIENCE_NOTES_EN = repoDocUrl("docs/en/science-notes.md");
const SCIENCE_NOTES_ZH = repoDocUrl("docs/science-notes.md");

const EN: HomeLanding = {
  locale: "en",
  kicker: "Open source · Runs in your browser · No download, no account",
  heading: "Stellar Odyssey",
  subheading:
    "A scroll-wheel journey from a planet's surface to the edge of the observable universe",
  intro: [
    "Stellar Odyssey is an open-source, data-driven 3D visualization of the cosmos built with React, Three.js (React Three Fiber) and Next.js. One scroll wheel carries you from the surface of a planet, through the Solar System and the Milky Way, out to the observable-universe boundary about 46.5 billion light-years away — four zoom levels joined without a single mode switch.",
    "Everything runs on the client. The interactive scene is loading on top of this page; if it does not appear, your browser needs WebGL and JavaScript enabled. The interface, 3D body labels and science notes are bilingual (English / Chinese) and switch instantly with the zh/EN toggle in the control panel.",
  ],
  sections: [
    {
      heading: "Four zoom levels, one continuous scroll",
      paragraphs: [
        "Press 1–4 or just keep scrolling. Content level-of-detail cross-fades, the time-compression ratio is interpolated logarithmically, and the background colour and soundscape blend as you move; a HUD ruler switches between AU, light-years and megaparsecs automatically.",
      ],
      bullets: [
        "Planet: surface close-ups, satellites and detailed glTF models of the ISS, Hubble and Tiangong.",
        "Solar System: all eight planets on full Keplerian orbital elements from NASA JPL, with positions matching the real current date on launch; Halley's Comet, asteroid and Kuiper belts.",
        "Milky Way: a 3D barred spiral with 43,000 disk particles, density-wave arms, dust lanes, halo and HI warp, plus 20+ special objects modelled on real prototypes.",
        "Universe: the Local Group, the Virgo Cluster, Laniakea and large-scale structure, with a Milky Way–Andromeda merger preview compressing 4.5 billion years into 12 seconds.",
      ],
    },
    {
      heading: "Driven by real astronomical data",
      paragraphs: [
        "The project favours public survey data over artistic invention, and documents every artistic liberty it does take.",
      ],
      bullets: [
        "43,488 real galaxies from the 2MASS Redshift Survey (Huchra et al. 2012) rendered as a 3D point cloud — the Virgo cluster, the zone of avoidance and cosmic-web filaments are actual data, drawn in two draw calls.",
        "M31, M33 and the Magellanic Clouds baked offline from DSS2 colour survey imagery into density, colour and dust maps; the Pleiades uses 600 Gaia DR3 members.",
        "Solar activity: granulation, sunspots following the 11-year butterfly diagram, prominences, differential rotation, and a flare–CME event chain that brightens Earth's aurorae.",
        "Raymarched volumetric nebulae (emission–absorption integration, 3D density textures, blue-noise dithering) for the Orion, Ring, Horsehead and Crab nebulae and WR 124.",
        "Gravitationally lensed black holes with photon rings, background star bending, blackbody accretion-disk colour, Doppler beaming and gravitational redshift at Sagittarius A*, Cygnus X-1 and M87.",
      ],
    },
    {
      heading: "Astronomy Lab",
      paragraphs: [
        "Beyond the main scene, the Lab hosts standalone, adjustable experiments: a twin meteor-shower night, a total solar eclipse, a lunar eclipse, and an Observatory with single-object close-ups you can link to directly.",
      ],
      bullets: [],
    },
    {
      heading: "Under the hood (for developers)",
      paragraphs: [
        "If you build with WebGL, the interesting parts are the cross-scale rendering (logarithmic depth and scale management across ten-plus orders of magnitude), the raymarch volumetric material with adaptive quality tiers, the GLSL gravitational-lensing pass, and the offline data-baking pipeline that turns Gaia, SIMBAD, 2MRS and DSS2 into static assets. The codebase is TypeScript in strict mode with a test-coverage gate of 90% or higher.",
      ],
      bullets: [],
    },
    {
      heading: "Open source and attribution",
      paragraphs: [
        "The source code is released under the GNU AGPL-3.0 and developed in the open on GitHub. Textures and imagery come from public-domain or openly licensed sources (NASA, ESA, DSS2 and others) and are credited in the repository; the science notes list every place where the visualization deliberately departs from true scale or true silence.",
      ],
      bullets: [],
    },
  ],
  linksHeading: "Links",
  links: [
    { label: "Source code on GitHub", href: GITHUB_REPO_URL, external: true },
    { label: "How it was built", href: HOW_IT_WORKS_EN, external: true },
    { label: "Scientific accuracy notes", href: SCIENCE_NOTES_EN, external: true },
    { label: "Astronomy Lab", href: `${LAB_PAGE_PATH}?lang=en`, external: false },
    { label: "中文版 (Chinese)", href: "/", external: false },
  ],
  noscriptNote:
    "The 3D scene needs JavaScript and WebGL. This page is the static description of what you would see.",
};

const ZH: HomeLanding = {
  locale: "zh",
  kicker: "开源 · 浏览器直接运行 · 无需下载、无需注册",
  heading: "星海奥德赛 Stellar Odyssey",
  subheading: "从行星表面到宇宙尽头的一次滚轮之旅",
  intro: [
    "星海奥德赛是一个开源的、由真实天文数据驱动的 3D 宇宙可视化项目，基于 React、Three.js（React Three Fiber）与 Next.js 构建。一只滚轮就能从行星表面出发，穿过太阳系与银河系，一路拉远到半径约 465 亿光年的可观测宇宙边界——四个层级连续衔接，不需要任何模式切换。",
    "一切都在浏览器里运行。交互式场景正在本页之上加载；如果没有出现，请确认浏览器已启用 JavaScript 与 WebGL。界面、3D 天体标签与科普说明支持中英双语，控制面板顶部的 zh/EN 开关即时切换。",
  ],
  sections: [
    {
      heading: "四个层级，一次连续缩放",
      paragraphs: [
        "按 1–4 一键切换，或者只管滚动。缩放过程中内容按细节层级淡入淡出，时间压缩比按对数插值，背景色与音景实时混合；HUD 标尺在天文单位、光年与百万秒差距之间自动切换。",
      ],
      bullets: [
        "行星视角：表面近观、卫星系统，以及 ISS、哈勃望远镜与天宫空间站的 glTF 精细模型。",
        "太阳系视角：八大行星采用 NASA JPL 的完整开普勒轨道六要素，打开时的位置与真实当前日期一致；还有哈雷彗星、小行星带与柯伊伯带。",
        "银河系视角：4.3 万粒子的 3D 棒旋结构（密度波旋臂、尘埃带、银晕与 HI 翘曲盘），以及 20 余个按真实原型建模的特殊天体。",
        "宇宙视角：本星系群、室女座星系团、拉尼亚凯亚超星系团与宇宙大尺度结构；银河系—仙女座碰撞合并预览把 45 亿年压进 12 秒。",
      ],
    },
    {
      heading: "由真实天文数据驱动",
      paragraphs: [
        "项目优先采用公开巡天数据而非艺术想象，并把每一处有意为之的艺术化处理登记在科学性说明里。",
      ],
      bullets: [
        "2MASS 红移巡天（Huchra 等，2012）的 43,488 个真实星系渲染为三维点云——室女座团的聚集、银道遮挡带与宇宙网纤维都是真实数据，全目录只用 2 次绘制调用。",
        "M31、M33 与大小麦哲伦云由 DSS2 彩色巡天影像离线烘焙为密度、颜色与尘埃图组；昴星团使用 600 颗 Gaia DR3 真实成员星。",
        "太阳活动：米粒组织、遵循 11 年蝴蝶图的黑子迁移、日珥、较差自转，以及会增强地球极光的耀斑—日冕物质抛射事件链。",
        "raymarch 体积渲染的星云（发射—吸收积分、3D 密度纹理、蓝噪声抖动）：猎户座星云、环状星云、马头星云、蟹状星云与 WR 124。",
        "引力透镜黑洞：人马座 A*、天鹅座 X-1 与 M87 的光子环、背景星场弯曲、吸积盘黑体色、多普勒束流增亮与引力红移。",
      ],
    },
    {
      heading: "天文实验室",
      paragraphs: [
        "主场景之外，实验室提供可独立调参的观测实验：盛夏双重流星雨之夜、日全食、月食，以及可直接分享单天体链接的天体观察站。",
      ],
      bullets: [],
    },
    {
      heading: "技术揭秘（给开发者）",
      paragraphs: [
        "如果你也做 WebGL，值得看的部分是跨尺度渲染（跨十余个数量级的对数深度与尺度管理）、带自适应质量档的 raymarch 体积材质、GLSL 引力透镜通道，以及把 Gaia、SIMBAD、2MRS 与 DSS2 变成静态资源的离线数据烘焙管线。代码为 TypeScript 严格模式，测试覆盖率门槛不低于 90%。",
      ],
      bullets: [],
    },
    {
      heading: "开源与素材来源",
      paragraphs: [
        "源代码以 GNU AGPL-3.0 协议开源，在 GitHub 公开开发。纹理与影像来自公版或开放许可来源（NASA、ESA、DSS2 等）并在仓库中逐项署名；科学性说明列出了可视化有意偏离真实比例或真实静默的每一处。",
      ],
      bullets: [],
    },
  ],
  linksHeading: "链接",
  links: [
    { label: "GitHub 源码仓库", href: GITHUB_REPO_URL, external: true },
    { label: "技术揭秘：它是怎么做出来的", href: HOW_IT_WORKS_ZH, external: true },
    { label: "科学性说明", href: SCIENCE_NOTES_ZH, external: true },
    { label: "天文实验室", href: LAB_PAGE_PATH, external: false },
    { label: "English version", href: EN_HOME_PATH, external: false },
  ],
  noscriptNote:
    "3D 场景需要 JavaScript 与 WebGL。本页是对场景内容的静态说明。",
};

/** 取指定语言的首页落地正文（两语言结构一致，见文件头登记） */
export function homeLandingFor(locale: Locale): HomeLanding {
  return locale === "en" ? EN : ZH;
}

/** 落地页全部可见文本拼接（单测统计字数用；不含链接 href） */
export function homeLandingVisibleText(landing: HomeLanding): string {
  const parts: string[] = [
    landing.kicker,
    landing.heading,
    landing.subheading,
    ...landing.intro,
  ];
  for (const section of landing.sections) {
    parts.push(section.heading, ...section.paragraphs, ...section.bullets);
  }
  parts.push(landing.linksHeading, ...landing.links.map((link) => link.label));
  return parts.join("\n");
}

/** 英文词数（以空白切分的非空 token 数） */
export function countEnglishWords(text: string): number {
  return text.split(/\s+/).filter((token) => /[A-Za-z0-9]/.test(token)).length;
}
