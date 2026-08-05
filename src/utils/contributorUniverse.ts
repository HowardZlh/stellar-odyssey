/**
 * 贡献者宇宙纯逻辑层（C1，/contributors 页面数据层）
 *
 * 需求：docs/internal/REQUIREMENTS_CONTRIBUTORS.md §C1。
 * 每位捐赠者（src/data/donors.ts 人工登记）映射为一颗贡献者星：
 * - 大小/亮度随金额对数归一（跨度 ¥5~¥10000+，线性映射会使小额星不可见）；
 * - 位置由自身记录（name|platform 哈希种子）确定性派生，与名单顺序/长度无关，
 *   新增贡献者不挪动已有星（碰撞微扰的极端边界见 layoutContributorStars 注释）；
 * - 颜色按种子从恒星温度色板确定性选取（金额不参与颜色）；
 * - 闪烁相位/频率/振幅复用 utils/starTwinkle 纯函数（顶点属性驱动，无每帧随机数）。
 *
 * 全部为纯函数：无 Math.random / Date.now 等非确定性来源。
 */

import type { DeviceTier } from '@/utils/deviceCapability';
import type { DonorRecord } from '@/utils/donors';
import type { DprSpec } from '@/utils/qualityTier';
import { qualityTierSpec } from '@/utils/qualityTier';
import { createSeededRandom } from '@/utils/random';
import { twinkleAmplitude, twinkleFrequencyHz } from '@/utils/starTwinkle';

/**
 * 贡献者宇宙页路径（C4-1，仿 ContactBadge.tsx DONATE_PAGE_PATH 范式）。
 * 定义于本纯模块而非 ContactBadge（避让 M3 弹层化改造，需求文档 §C4-1）；
 * 消费点：/donate 页名单区入口链接（src/app/donate/page.tsx）。
 */
export const CONTRIBUTORS_PAGE_PATH = '/contributors';

/**
 * 恒星温度色板（O/B 蓝 → M 红）。
 * 出处登记（C1-3）：复制自 components/Scene/Starfield.tsx STAR_COLORS（:27），
 * 选择"复制并登记"而非抽共享常量，避免本迭代触碰主场景组件（零回归面）。
 * 若两处需同步调整，以 Starfield 为源手工同步。
 */
export const CONTRIBUTOR_STAR_COLORS: readonly string[] = [
  '#9bb0ff', '#aabfff', '#cad7ff', '#f8f7ff', '#fff4ea', '#ffd2a1', '#ffcc6f',
];

/** refMax 基准下限（¥1000）：避免名单只有一笔小额时出现满档巨星（C1-1） */
export const REF_MAX_CNY_FLOOR = 1000;

/** 粒径倍数区间（相对基准粒径；初始建议值，C4 目验后可调并回写） */
export const STAR_SCALE_MIN = 1.0;
export const STAR_SCALE_MAX = 3.2;

/** 片元亮度系数区间（最低档必须清晰可见——下限 0.4 不为 0） */
export const STAR_BRIGHTNESS_MIN = 0.4;
export const STAR_BRIGHTNESS_MAX = 1.0;

/** 球状星团径向高斯 σ（中心密外围疏；场景尺度，C4 目验后可调） */
export const CLUSTER_RADIUS_SIGMA = 30;

/** 星团最大半径（径向 3σ 截断，防离群星飞出视野） */
export const CLUSTER_RADIUS_MAX = 90;

/** 两星最小间距（低于此距离触发确定性微扰重采样） */
export const MIN_STAR_DISTANCE = 4;

/** 碰撞微扰最大重试次数（种子驱动重采样；耗尽后接受最后一个候选位） */
export const MAX_PERTURB_ATTEMPTS = 16;

/** 金额→视觉属性映射结果 */
export interface ContributorVisual {
  /** 粒径倍数 ∈ [STAR_SCALE_MIN, STAR_SCALE_MAX] */
  scale: number;
  /** 亮度系数 ∈ [STAR_BRIGHTNESS_MIN, STAR_BRIGHTNESS_MAX] */
  brightness: number;
}

/** 贡献者星（C1 产物，C2 直灌 BufferAttribute） */
export interface ContributorStar {
  /** 源捐赠记录（引用不复制） */
  donor: DonorRecord;
  /** 星团内位置（场景单位） */
  position: [number, number, number];
  /** 粒径倍数（金额对数映射） */
  scale: number;
  /** 亮度系数（金额对数映射） */
  brightness: number;
  /** 恒星色板颜色（种子确定性选取，金额不参与） */
  color: string;
  /** 闪烁相位（0-1） */
  twinklePhase: number;
  /** 闪烁主频率（Hz） */
  twinkleFreq: number;
  /** 闪烁幅度（±比例） */
  twinkleAmp: number;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * FNV-1a 32 位字符串哈希（C1-2 种子；确定性、无依赖）。
 * 按 UTF-16 码元逐位混合，同串恒定同值。
 */
export function hashStringFnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** 捐赠记录的种子键：name + '|' + platform（同名同平台恒定） */
export function donorSeedKey(donor: Pick<DonorRecord, 'name' | 'platform'>): string {
  return `${donor.name}|${donor.platform}`;
}

/**
 * 解析映射参考最大金额：max(名单最大金额, ¥1000 基准)。
 * 空名单取基准值（C1-1 边界）。
 */
export function resolveRefMaxCny(donors: readonly DonorRecord[]): number {
  let max = REF_MAX_CNY_FLOOR;
  for (const donor of donors) {
    if (donor.amountCny > max) max = donor.amountCny;
  }
  return max;
}

/**
 * 金额→大小/亮度映射（C1-1）：对数归一
 * t = log10(1 + amount) / log10(1 + refMax)，clamp [0, 1]。
 * 防御：负金额按 0 处理；refMax 下限 1 防除零。纯函数，同额同输出。
 */
export function amountToVisual(amountCny: number, refMaxCny: number): ContributorVisual {
  const safeAmount = Math.max(0, amountCny);
  const safeRefMax = Math.max(1, refMaxCny);
  const t = clamp01(Math.log10(1 + safeAmount) / Math.log10(1 + safeRefMax));
  return {
    scale: STAR_SCALE_MIN + (STAR_SCALE_MAX - STAR_SCALE_MIN) * t,
    brightness: STAR_BRIGHTNESS_MIN + (STAR_BRIGHTNESS_MAX - STAR_BRIGHTNESS_MIN) * t,
  };
}

/**
 * 从种子随机流采样一个星团位置：|高斯| 径向（中心密外围疏，3σ 截断）
 * + 均匀球面角。每次调用消费固定 4 个随机数。
 */
function samplePosition(rand: () => number): [number, number, number] {
  // Box-Muller：|N(0, σ)| 径向分布
  const u1 = Math.max(rand(), Number.EPSILON);
  const u2 = rand();
  const gaussian = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  const radius = Math.min(Math.abs(gaussian) * CLUSTER_RADIUS_SIGMA, CLUSTER_RADIUS_MAX);
  // 均匀球面方向：cosθ ∈ [-1, 1]、φ ∈ [0, 2π)
  const cosTheta = rand() * 2 - 1;
  const sinTheta = Math.sqrt(Math.max(0, 1 - cosTheta * cosTheta));
  const phi = rand() * 2 * Math.PI;
  return [
    radius * sinTheta * Math.cos(phi),
    radius * cosTheta,
    radius * sinTheta * Math.sin(phi),
  ];
}

function isTooClose(
  position: readonly [number, number, number],
  placed: readonly ContributorStar[],
): boolean {
  for (const star of placed) {
    const dx = position[0] - star.position[0];
    const dy = position[1] - star.position[1];
    const dz = position[2] - star.position[2];
    if (dx * dx + dy * dy + dz * dz < MIN_STAR_DISTANCE * MIN_STAR_DISTANCE) return true;
  }
  return false;
}

/**
 * 确定性布点（C1-2）：每颗星的种子 = hash(name|platform)，位置/颜色/闪烁
 * 全部由自身种子流派生，与名单顺序/长度无关；返回数组保持入参顺序。
 *
 * 碰撞规避：按种子哈希升序（与输入顺序无关的规范序）逐星放置，
 * 与已放置星过近时从该星自身随机流继续重采样（种子驱动、确定性），
 * 至多 MAX_PERTURB_ATTEMPTS 次后接受最后候选位。
 *
 * 边界登记：若新增记录在规范序中早于某既有星且与其基准位碰撞，
 * 该既有星可能被微扰挪位（任何碰撞规避方案下不可避免；概率极低，
 * 典型追加场景既有星坐标逐位不变——单测断言）。
 */
export function layoutContributorStars(donors: readonly DonorRecord[]): ContributorStar[] {
  const refMaxCny = resolveRefMaxCny(donors);

  // 规范放置序：种子哈希升序 → 种子键字典序 → 原始下标（仅重复记录兜底）
  const entries = donors
    .map((donor, index) => ({ donor, index, key: donorSeedKey(donor) }))
    .map((e) => ({ ...e, seed: hashStringFnv1a(e.key) }));
  entries.sort(
    (a, b) => a.seed - b.seed || a.key.localeCompare(b.key) || a.index - b.index,
  );

  const placed: ContributorStar[] = [];
  const result: ContributorStar[] = new Array<ContributorStar>(donors.length);

  for (const entry of entries) {
    const rand = createSeededRandom(entry.seed);
    const { scale, brightness } = amountToVisual(entry.donor.amountCny, refMaxCny);

    // 固定消费顺序（先属性后位置），保证碰撞重试不影响颜色/闪烁参数
    const color =
      CONTRIBUTOR_STAR_COLORS[Math.floor(rand() * CONTRIBUTOR_STAR_COLORS.length)];
    const twinklePhase = rand();
    const twinkleFreq = twinkleFrequencyHz(rand());
    const twinkleAmp = twinkleAmplitude(brightness, rand());

    let position = samplePosition(rand);
    for (
      let attempt = 0;
      attempt < MAX_PERTURB_ATTEMPTS && isTooClose(position, placed);
      attempt++
    ) {
      position = samplePosition(rand);
    }

    const star: ContributorStar = {
      donor: entry.donor,
      position,
      scale,
      brightness,
      color,
      twinklePhase,
      twinkleFreq,
      twinkleAmp,
    };
    placed.push(star);
    result[entry.index] = star;
  }

  return result;
}

// ---------------------------------------------------------------------------
// C3：移动端渲染档位与触屏命中阈值（REQUIREMENTS_CONTRIBUTORS §C3-1/§C3-2）
// ---------------------------------------------------------------------------

/** Points raycast 基准阈值（世界单位；星最小间距 4 的一半） */
export const RAYCAST_POINTS_THRESHOLD_BASE = 2;

/** 触屏命中阈值放大倍数（手指命中精度低于鼠标，§C3-1） */
export const RAYCAST_TOUCH_MULTIPLIER = 2;

/**
 * Points raycast 命中阈值（isTouch 分流）：桌面 2 / 触屏 ×2 = 4。
 * 触屏阈值恰为星最小间距（MIN_STAR_DISTANCE=4），tap 就近命中不串星。
 */
export function raycastPointsThreshold(isTouch: boolean): number {
  return isTouch
    ? RAYCAST_POINTS_THRESHOLD_BASE * RAYCAST_TOUCH_MULTIPLIER
    : RAYCAST_POINTS_THRESHOLD_BASE;
}

/** 背景氛围星场点数按档位（§C3-2 表：high/medium 3000，low 1500） */
export const BACKGROUND_STAR_COUNT_BY_TIER: Readonly<Record<DeviceTier, number>> = {
  high: 3000,
  medium: 3000,
  low: 1500,
};

// ---------------------------------------------------------------------------
// C5-1：网格球体宇宙边界（REQUIREMENTS_CONTRIBUTORS §C5）
// ---------------------------------------------------------------------------

/**
 * 边界球半径：> 星团 3σ 截断（CLUSTER_RADIUS_MAX=90），全部贡献者星
 * 必然落在球内部（布点算法零改动即满足"球面上或内部"，用户确认口径②）。
 */
export const BOUNDARY_SPHERE_RADIUS = 110;

/** 边界球自转周期（秒/圈；prefers-reduced-motion 时组件层静止） */
export const BOUNDARY_ROTATION_SEC_PER_TURN = 75;

/** 边界球网格线颜色/透明度（科幻蓝低透明度，加性混合发光观感） */
export const BOUNDARY_SPHERE_COLOR = '#3d6fb8';
export const BOUNDARY_SPHERE_OPACITY = 0.28;

/** 边界球几何规格（经纬网格线密度 + 单线圆弧分段数） */
export interface BoundarySphereSpec {
  /** 球半径（场景单位） */
  radius: number;
  /** 纬线条数（不含两极退化点；含赤道，均匀分布于 (-90°, 90°)） */
  latitudeLines: number;
  /** 经线条数（完整大圆的一半为一条，均匀分布方位角） */
  longitudeLines: number;
  /** 每条线的圆弧分段数（LineSegments 顶点对数） */
  arcSegments: number;
}

/** 边界球规格按档位（§C5-1：low 档经纬线密度减半，圆弧分段同步降） */
export function boundarySphereSpec(tier: DeviceTier): BoundarySphereSpec {
  const low = tier === 'low';
  return {
    radius: BOUNDARY_SPHERE_RADIUS,
    latitudeLines: low ? 5 : 11,
    longitudeLines: low ? 6 : 12,
    arcSegments: low ? 48 : 96,
  };
}

/** 贡献者宇宙 Canvas 垂直视场角（度；组件 Canvas camera 与取景计算同源） */
export const CONTRIBUTOR_CANVAS_FOV_DEG = 55;

/** 默认观察距离下限（桌面横幅画布下边界球垂直恰入框的基准距离） */
export const BOUNDARY_HOME_DISTANCE_MIN = 255;

/** 边界球取景余量系数（球面网格线不贴画布边缘） */
const BOUNDARY_FIT_MARGIN = 1.06;

/**
 * 默认观察距离按画布宽高比补偿（C5-1）：竖屏画布（aspect < 1）水平
 * 视场角更窄，按 min(垂直, 水平) 半视场角求边界球完整入框的最小距离，
 * 下钳 BOUNDARY_HOME_DISTANCE_MIN（桌面横幅画布 = 现状距离）。
 * 非法 aspect（≤0/NaN）按 1 处理。
 */
export function boundaryHomeDistance(aspectRatio: number): number {
  const aspect = Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 1;
  const halfVertical = (CONTRIBUTOR_CANVAS_FOV_DEG / 2) * (Math.PI / 180);
  const halfHorizontal = Math.atan(Math.tan(halfVertical) * aspect);
  const halfMin = Math.min(halfVertical, halfHorizontal);
  const fit = (BOUNDARY_SPHERE_RADIUS * BOUNDARY_FIT_MARGIN) / Math.sin(halfMin);
  return Math.max(BOUNDARY_HOME_DISTANCE_MIN, fit);
}

/** 贡献者宇宙 Canvas 档位参数（§C3-2 表格三档） */
export interface ContributorCanvasQuality {
  /** R3F Canvas dpr（high [1,2] / medium [1,1.5] / low 1） */
  dpr: DprSpec;
  /** WebGL antialias（high true / medium·low false） */
  antialias: boolean;
  /** 背景氛围星场点数（high·medium 3000 / low 1500） */
  backgroundStarCount: number;
  /** 边界球几何规格（C5-1：low 档经纬线密度减半） */
  boundarySphere: BoundarySphereSpec;
}

/**
 * 贡献者宇宙渲染档位取值（§C3-2）：dpr/antialias 消费 M2 统一档位表
 * `utils/qualityTier.ts`（唯一事实源，M2 已落地——需求文档登记的对齐项
 * 已闭环）；背景星场点数为本页专属项，按上表取值。
 * 闪烁 shader 三档恒开（顶点属性驱动、开销恒定，不降）。
 */
export function contributorCanvasQuality(tier: DeviceTier): ContributorCanvasQuality {
  const spec = qualityTierSpec(tier);
  return {
    dpr: spec.dpr,
    antialias: spec.antialias,
    backgroundStarCount: BACKGROUND_STAR_COUNT_BY_TIER[tier],
    boundarySphere: boundarySphereSpec(tier),
  };
}
