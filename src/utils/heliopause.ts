/**
 * 日球层顶（heliopause）示意纯逻辑（S3，IMPROVEMENT_REQUIREMENTS_SOLAR §4.3-4；
 * R2-7 近观三层结构 + 旅行者标记，IMPROVEMENT_REQUIREMENTS_2 §R2-7-A）
 *
 * 日球层顶是太阳风与星际介质压力平衡的边界，太阳风在此减速至亚声速并最终
 * 止于该界面，是太阳影响范围（日球层 Heliosphere）的外缘。
 *
 * 科学背景与数据来源：
 * - 真实日球层顶距太阳约 120 AU（NASA/JPL；Voyager 1 于 2012 年、Voyager 2
 *   于 2018 年先后穿越，实测约 121 AU 与 119 AU）。日球层顶并非正球——
 *   迎星际风一侧较近、背风侧（日球层尾）拉长，此处以球壳示意。
 * - 近观结构分层（R2-7）：终端激波（Termination Shock，太阳风减速至亚声速
 *   的内边界，~94 AU 示意，Voyager 1 于 2004 年在 94 AU 处穿越）→ 日鞘
 *   （Heliosheath，激波与层顶之间的湍流渐变区）→ 日球层顶（外边界）。
 * - 旅行者标记（NASA/JPL Voyager Interstellar Mission）：Voyager 1 于
 *   2012-08-25 在约 121.6 AU 穿越日球层顶（朝日球层鼻部方向偏北），
 *   Voyager 2 于 2018-11-05 在约 119 AU 穿越（黄道以南）。
 *
 * ── 艺术化/近似登记（需求 §3、AGENTS.md）────────────────────────────────
 * - 真实 120 AU（1 AU=10 场景单位应为 1,200 单位）在 L2 太阳系视角下过大且
 *   与行星轨道（海王星 ~30 AU=300 单位）尺度悬殊；为在 L2 视角内可辨，
 *   将示意球壳压缩至 HELIOPAUSE_VISUAL_RADIUS_UNITS（登记），真实距离经
 *   信息标注科普（同 Oort 云 utils/oort.ts 压缩登记思路）。
 * - 以理想球壳示意，未建模迎风/背风不对称与日球层尾（R2-7 可选项取舍：
 *   维持球形，"真实为彗尾状不对称"经 HELIOPAUSE_SHAPE_NOTE_ZH 在信息面板
 *   登记科普）；近观三层结构半径按"压缩比例沿用现有登记"换算
 *   （层半径 = 示意球壳半径 × 真实 AU / 120 AU）。
 * - 旅行者标记方向为按穿越时黄纬（V1 约 +35°、V2 约 −33°）取的示意单位
 *   方向（经度示意），标记点半径按各自穿越距离换算。
 */

import type { Vec3 } from '@/types';
import { trapezoidWeight } from '@/utils/scale';

/** 真实日球层顶距离（AU，Voyager 实测量级） */
export const HELIOPAUSE_REAL_DISTANCE_AU = 120;

/**
 * 日球层顶示意球壳半径（场景单位，压缩登记见文件头）：
 * 取略大于行星区（海王星 ~300 单位）但在 L2 视野内可辨的压缩值。
 */
export const HELIOPAUSE_VISUAL_RADIUS_UNITS = 380;

/** 日球层顶示意可见的连续层级窗口（L2 太阳系视角段） */
export const HELIOPAUSE_VISIBLE_LEVEL_MIN = 1.8;
export const HELIOPAUSE_VISIBLE_LEVEL_MAX = 3.0;

/** 日球层顶球壳峰值透明度（微弱示意，不喧宾夺主） */
export const HELIOPAUSE_MAX_OPACITY = 0.06;

/** 日球层顶科普文案（信息标注/面板） */
export const HELIOPAUSE_NOTE_ZH =
  '日球层顶是太阳风与星际介质的边界（太阳影响范围外缘），真实距太阳约 120 AU；旅行者 1/2 号已于 2012/2018 年先后穿越（示意球壳半径为压缩值）';

/**
 * 日球层顶可见度权重（R2-1 §1.1-B）
 *
 * 常态按连续层级窗口梯形淡入淡出（L2 段可见，进入 L1/L3 淡出）；
 * 飞往/跟随日球层顶期间（focused）聚焦权重提升为满值——参照
 * isGalaxyAnchoredFocusId 模式，保证球壳在跟随期间不因层级门控淡出
 * （飞往观察距离对应连续层级 ~2.65，运镜起点 L3 已越过淡出窗口上缘）。
 */
export function heliopauseVisibilityWeight(continuousLevel: number, focused: boolean): number {
  if (!Number.isFinite(continuousLevel)) {
    throw new RangeError(`连续层级必须为有限数，收到 ${continuousLevel}`);
  }
  if (focused) return 1;
  return trapezoidWeight(
    continuousLevel,
    HELIOPAUSE_VISIBLE_LEVEL_MIN,
    HELIOPAUSE_VISIBLE_LEVEL_MIN + 0.3,
    HELIOPAUSE_VISIBLE_LEVEL_MAX - 0.3,
    HELIOPAUSE_VISIBLE_LEVEL_MAX,
  );
}

/**
 * 日球层顶球壳点选（raycast）开启的连续层级上限（R3 需求 3）：
 * 进入银河系视角（L3，连续层级 ≥ 2.5）后球壳禁用 raycast——
 * 球壳为 BackSide 大球（半径 380 单位）且点击后 stopPropagation，
 * 可见度淡出窗口（≤3.0）与 L3 区间（2.5–3.5）重叠时会拦截其后方
 * L3 天体（与太阳系外天体同尺度混叠）的点击。
 */
export const HELIOPAUSE_RAYCAST_LEVEL_MAX = 2.5;

/**
 * 日球层顶球壳是否参与 raycast（R3 需求 3）：
 * - 跟随/飞往日球层顶或旅行者标记期间（focused）恒开启（近观可点）；
 * - 常态要求可见度权重 > 0.05（近乎隐形时不拦截点击，原有行为）
 *   且连续层级 < 2.5（L2 太阳系视角内保留点选科普；进入 L3 银河系
 *   视角后禁用，不再遮挡太阳系外天体的点击）。
 */
export function heliopauseRaycastEnabled(
  continuousLevel: number,
  focused: boolean,
  visibilityWeight: number,
): boolean {
  if (!Number.isFinite(continuousLevel)) {
    throw new RangeError(`连续层级必须为有限数，收到 ${continuousLevel}`);
  }
  if (!Number.isFinite(visibilityWeight)) {
    throw new RangeError(`可见度权重必须为有限数，收到 ${visibilityWeight}`);
  }
  if (focused) return true;
  return visibilityWeight > 0.05 && continuousLevel < HELIOPAUSE_RAYCAST_LEVEL_MAX;
}

// ---------------------------------------------------------------------------
// R2-7 §7.1-A：近观三层结构（终端激波 → 日鞘 → 日球层顶）
// ---------------------------------------------------------------------------

/** 终端激波真实距离（AU，示意值；Voyager 1 于 2004 年在 94 AU 处穿越） */
export const TERMINATION_SHOCK_REAL_DISTANCE_AU = 94;

/** 日鞘渐变区示意壳层数（终端激波与日球层顶之间的中间层） */
export const HELIOSHEATH_SHELL_COUNT = 3;

/** 真实为彗尾状不对称的登记文案（可选项取舍：维持球形示意，面板科普） */
export const HELIOPAUSE_SHAPE_NOTE_ZH =
  '真实日球层并非球形：迎星际风一侧（鼻部）被压缩、背风侧拉长为彗尾状不对称形（此处以球壳示意，已登记）';

/**
 * 日球层结构层半径（场景单位）：压缩比例沿用现有登记——
 * 层半径 = 示意球壳半径 × 真实 AU / 120 AU。
 */
export function heliosphereLayerRadiusUnits(realDistanceAu: number): number {
  if (!Number.isFinite(realDistanceAu) || realDistanceAu <= 0) {
    throw new RangeError(`真实距离（AU）必须为正有限数，收到 ${realDistanceAu}`);
  }
  return HELIOPAUSE_VISUAL_RADIUS_UNITS * (realDistanceAu / HELIOPAUSE_REAL_DISTANCE_AU);
}

/** 终端激波示意内壳半径（场景单位） */
export function terminationShockRadiusUnits(): number {
  return heliosphereLayerRadiusUnits(TERMINATION_SHOCK_REAL_DISTANCE_AU);
}

/**
 * 日鞘渐变区第 index 层壳半径（场景单位）：严格位于终端激波与
 * 日球层顶之间（等距插值，t = (index+1)/(count+1)）。
 */
export function heliosheathShellRadiusUnits(
  index: number,
  count = HELIOSHEATH_SHELL_COUNT,
): number {
  if (!Number.isInteger(count) || count < 1) {
    throw new RangeError(`壳层数必须为正整数，收到 ${count}`);
  }
  if (!Number.isInteger(index) || index < 0 || index >= count) {
    throw new RangeError(`壳层序号必须在 [0, ${count}) 内，收到 ${index}`);
  }
  const inner = terminationShockRadiusUnits();
  const outer = HELIOPAUSE_VISUAL_RADIUS_UNITS;
  const t = (index + 1) / (count + 1);
  return inner + (outer - inner) * t;
}

/** 终端激波侧着色（太阳风减速受压区，暖琥珀）与日球层顶侧（星际介质蓝） */
const TERMINATION_SHOCK_COLOR = { r: 1.0, g: 0.7, b: 0.42 } as const;
const HELIOPAUSE_COLOR = { r: 0.35, g: 0.61, b: 0.83 } as const;

/**
 * 结构着色渐变（R2-7：半透明多层壳 + 着色渐变）：
 * t=0 为终端激波（暖琥珀）→ t=1 为日球层顶（蓝），线性插值。
 */
export function heliopauseLayerColor01(t01: number): { r: number; g: number; b: number } {
  if (!Number.isFinite(t01) || t01 < 0 || t01 > 1) {
    throw new RangeError(`渐变参数必须在 [0,1] 内，收到 ${t01}`);
  }
  return {
    r: TERMINATION_SHOCK_COLOR.r + (HELIOPAUSE_COLOR.r - TERMINATION_SHOCK_COLOR.r) * t01,
    g: TERMINATION_SHOCK_COLOR.g + (HELIOPAUSE_COLOR.g - TERMINATION_SHOCK_COLOR.g) * t01,
    b: TERMINATION_SHOCK_COLOR.b + (HELIOPAUSE_COLOR.b - TERMINATION_SHOCK_COLOR.b) * t01,
  };
}

// ---------------------------------------------------------------------------
// R2-7 §7.1-A：旅行者 1/2 号位置标记（NASA/JPL Voyager Interstellar Mission）
// ---------------------------------------------------------------------------

/** 旅行者标记数据（方向为示意单位向量，登记见文件头） */
export interface VoyagerMarker {
  id: 'voyager-1' | 'voyager-2';
  name: string;
  nameZh: string;
  /** 发射日期（中文文案） */
  launchDateZh: string;
  /** 穿越日球层顶年份 */
  crossedYear: number;
  /** 穿越时距太阳距离（AU，NASA/JPL 实测） */
  crossedDistanceAu: number;
  /** 单位方向向量（黄纬示意：V1 约 +35°、V2 约 −33°，经度示意） */
  direction: Vec3;
  /** 备注（信息面板） */
  noteZh: string;
}

/** 单位化（模块加载时一次性执行，保证导出方向严格为单位向量） */
function unitVec(v: Vec3): Vec3 {
  const len = Math.hypot(v.x, v.y, v.z);
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

export const VOYAGER_MARKERS: readonly VoyagerMarker[] = [
  {
    id: 'voyager-1',
    name: 'Voyager 1',
    nameZh: '旅行者 1 号',
    launchDateZh: '1977 年 9 月 5 日',
    crossedYear: 2012,
    crossedDistanceAu: 121.6,
    direction: unitVec({ x: 0.55, y: 0.57, z: -0.61 }),
    noteZh: '首个进入星际空间的人造物体（2012-08-25 穿越，朝日球层鼻部方向偏北）',
  },
  {
    id: 'voyager-2',
    name: 'Voyager 2',
    nameZh: '旅行者 2 号',
    launchDateZh: '1977 年 8 月 20 日',
    crossedYear: 2018,
    crossedDistanceAu: 119.0,
    direction: unitVec({ x: 0.73, y: -0.54, z: 0.42 }),
    noteZh: '2018-11-05 穿越（黄道以南）；等离子体仪器直接测得星际等离子体密度跃升',
  },
] as const;

/**
 * 旅行者标记点场景位置（场景单位）：方向 × 按穿越距离换算的示意半径
 * （压缩比例沿用现有登记，V1 略在示意球壳外、V2 略在壳内——与真实
 * 穿越距离相对 120 AU 的关系一致）。
 */
export function voyagerMarkerPositionUnits(id: string): Vec3 {
  const marker = VOYAGER_MARKERS.find((m) => m.id === id);
  if (!marker) {
    throw new RangeError(`未知旅行者标记 id：${id}`);
  }
  const r = heliosphereLayerRadiusUnits(marker.crossedDistanceAu);
  return {
    x: marker.direction.x * r,
    y: marker.direction.y * r,
    z: marker.direction.z * r,
  };
}

/**
 * 是否为"日球层顶近观语境"的聚焦 id（R2-7 近观门控判据）：
 * 跟随/飞往日球层顶本体或旅行者标记期间，近观三层结构保持激活
 * （飞往旅行者标记时结构不消失）。
 */
export function isHeliopauseNearFocusId(id: string | null): boolean {
  return id === 'heliopause' || id === 'voyager-1' || id === 'voyager-2';
}
