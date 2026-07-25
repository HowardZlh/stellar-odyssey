/**
 * 日球层顶（heliopause）示意纯逻辑（S3，IMPROVEMENT_REQUIREMENTS_SOLAR §4.3-4）
 *
 * 日球层顶是太阳风与星际介质压力平衡的边界，太阳风在此减速至亚声速并最终
 * 止于该界面，是太阳影响范围（日球层 Heliosphere）的外缘。
 *
 * 科学背景与数据来源：
 * - 真实日球层顶距太阳约 120 AU（NASA/JPL；Voyager 1 于 2012 年、Voyager 2
 *   于 2018 年先后穿越，实测约 121 AU 与 119 AU）。日球层顶并非正球——
 *   迎星际风一侧较近、背风侧（日球层尾）拉长，此处以球壳示意。
 *
 * ── 艺术化/近似登记（需求 §3、AGENTS.md）────────────────────────────────
 * - 真实 120 AU（1 AU=10 场景单位应为 1,200 单位）在 L2 太阳系视角下过大且
 *   与行星轨道（海王星 ~30 AU=300 单位）尺度悬殊；为在 L2 视角内可辨，
 *   将示意球壳压缩至 HELIOPAUSE_VISUAL_RADIUS_UNITS（登记），真实距离经
 *   信息标注科普（同 Oort 云 utils/oort.ts 压缩登记思路）。
 * - 以理想球壳示意，未建模迎风/背风不对称与日球层尾。
 */

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
