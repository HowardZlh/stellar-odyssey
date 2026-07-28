/**
 * L3 飞往/跟随目标近观 LOD 门控（R2-7，IMPROVEMENT_REQUIREMENTS_2 §R2-7-B）
 *
 * 纯逻辑模块（供单元测试）：为 L3 域序列（utils/cycleScopes.GALAXY_CYCLE_SEQUENCE）
 * 每个成员定义"近观激活距离"，并提供滞回门控状态机（复用 P4
 * utils/planetDetail.detailGateUpdate 的滞回模式）——仅当前跟随/飞往目标激活
 * 近观细节层，离开跟随或超出退出距离即释放（组件侧卸载子树，无内存泄漏）。
 *
 * ── 近观激活距离登记（§7.1-B）───────────────────────────────────────────
 * 进入阈值 = 飞往观察距离 × NEAR_VIEW_ENTER_RATIO（1.5，飞抵后必然处于
 * 阈值内）；退出阈值 = 进入阈值 × NEAR_VIEW_EXIT_RATIO（1.4，滞回防抖，
 * 与 planetDetail.detailExitDistance 同比例）。观察距离与
 * utils/cameraFocus.resolveFocusTarget 同源（同一公式，禁止两套参数）：
 * - sun：太阳显示半径 × 6（近观 = 既有 L1 太阳渲染，见差异登记）
 * - heliopause：示意球壳半径 × SHELL_VIEW_DISTANCE_RATIO
 * - L3 特殊天体：max(视觉半径 × 6，银心 40 / 太阳邻域 30 场景单位下限)
 *
 * ── 实现差异登记 ─────────────────────────────────────────────────────────
 * - 序列成员 sun 的"近观细节层" = 既有 L1 太阳渲染（P6 表面 shader/黑子/
 *   日珥，飞抵后相机落入 L1 语境自动呈现），不额外建近观层；
 * - 恒星类成员（参宿四/参宿七/造父一/WR 124）与黑洞类（人马座 A★ 与
 *   天鹅座 X-1）的近观细节已由 P6 恒星表面 shader（3D 噪声对流/临边昏暗）
 *   与吸积盘/引力透镜 shader 交付且常开零边际开销（shader uniform 按可见性
 *   门控），本阶段不重复建设，仅登记激活距离；
 * - 本阶段新增近观层对象：heliopause（三层结构 + 旅行者标记，utils/
 *   heliopause.ts）、星云类 ×4、星团类 ×2、天狼星双星、蟹状脉冲星
 *   （组件 Scene/Heliopause.tsx 与 Scene/SpecialBodies.tsx）。
 *
 * ── 粒子预算登记（§7.1-B / 附录 A）──────────────────────────────────────
 * 近观层同一时刻至多一个目标激活（门控以跟随目标为判据），单目标最大粒子
 * 增量 = M13 近观星场 +1,200（NEAR_VIEW_PARTICLE_INCREMENTS 逐成员登记）。
 * 全局峰值：太阳活动特效 15,000（现状登记）+ 近观增量 ≤1,200 → ≤16,200，
 * 处于 20,000 峰值预算内（单测断言）。
 */

import { getSpecialBodyById } from '@/data/specialBodies';
import { SUN } from '@/data/planets';
import { SCENE_UNITS_PER_LY, bodyDisplayRadius } from '@/utils/scale';
import {
  SHELL_VIEW_DISTANCE_RATIO,
  SPECIAL_VIEW_DISTANCE_FLOOR_GALACTIC_CENTER,
  SPECIAL_VIEW_DISTANCE_FLOOR_SUN_RELATIVE,
  viewDistanceForRadius,
} from '@/utils/cameraFocus';
import { HELIOPAUSE_VISUAL_RADIUS_UNITS } from '@/utils/heliopause';
import { createSeededRandom } from '@/utils/random';
import {
  DETAIL_LAYER_TRANSITION_SECONDS,
  detailGateUpdate,
  type DetailGateResult,
} from '@/utils/detailLayer';

/** 进入阈值 = 飞往观察距离 × 该系数（飞抵后必然处于阈值内） */
export const NEAR_VIEW_ENTER_RATIO = 1.5;

/** 退出阈值 = 进入阈值 × 该系数（滞回防抖，与 planetDetail 同比例） */
export const NEAR_VIEW_EXIT_RATIO = 1.4;

/** 近观层淡入淡出过渡时长（秒；R4-2 起与 detailLayer 统一机制同源） */
export const NEAR_VIEW_TRANSITION_SECONDS = DETAIL_LAYER_TRANSITION_SECONDS;

/**
 * 近观激活（进入）距离（场景单位，§7.1-B 逐成员定义）
 *
 * 与 resolveFocusTarget 的观察距离同源（公式登记见文件头）。
 * 非 L3 域序列成员（未知 id / 河外天体）抛 RangeError。
 */
export function nearViewEnterDistanceUnits(bodyId: string): number {
  if (bodyId === SUN.id) {
    return viewDistanceForRadius(bodyDisplayRadius(SUN.radiusKm, false)) * NEAR_VIEW_ENTER_RATIO;
  }
  if (bodyId === 'heliopause') {
    return HELIOPAUSE_VISUAL_RADIUS_UNITS * SHELL_VIEW_DISTANCE_RATIO * NEAR_VIEW_ENTER_RATIO;
  }
  const body = getSpecialBodyById(bodyId);
  if (body && body.level === 'L3' && body.positionMode !== 'extragalactic') {
    const sizeUnits = body.visualRadiusLy * SCENE_UNITS_PER_LY;
    const floor =
      body.positionMode === 'galactic-center'
        ? SPECIAL_VIEW_DISTANCE_FLOOR_GALACTIC_CENTER
        : SPECIAL_VIEW_DISTANCE_FLOOR_SUN_RELATIVE;
    return Math.max(viewDistanceForRadius(sizeUnits), floor) * NEAR_VIEW_ENTER_RATIO;
  }
  throw new RangeError(`未定义近观激活距离的天体 id：${bodyId}`);
}

/** 近观退出距离（滞回：高于进入阈值 40%） */
export function nearViewExitDistanceUnits(bodyId: string): number {
  return nearViewEnterDistanceUnits(bodyId) * NEAR_VIEW_EXIT_RATIO;
}

/** 门控更新结果（与 detailLayer.DetailGateResult 同构，别名保持兼容） */
export type NearViewGateResult = DetailGateResult;

/**
 * 近观门控状态机（每帧调用，滞回防抖）：R4-2 起委托统一机制
 * detailLayer.detailGateUpdate（语义逐项一致，行为零回退）：
 * - 未激活 → 激活：正在跟随/飞往本目标（focused）且 距离 < 进入阈值
 * - 激活 → 未激活：焦点离开本目标 或 距离 > 退出阈值（= 进入 × 1.4）
 * - releaseNow：退出即释放（§7.1-B"离开跟随/超出距离即释放"，无 LRU 保留）
 */
export function nearViewGateUpdate(
  prevActive: boolean,
  focused: boolean,
  distanceToBodyUnits: number,
  enterDistanceUnits: number,
): NearViewGateResult {
  if (!Number.isFinite(enterDistanceUnits) || enterDistanceUnits <= 0) {
    throw new RangeError(`进入阈值必须为正有限数，收到 ${enterDistanceUnits}`);
  }
  return detailGateUpdate(
    prevActive,
    focused,
    distanceToBodyUnits,
    enterDistanceUnits,
    enterDistanceUnits * NEAR_VIEW_EXIT_RATIO,
  );
}

/**
 * 逐成员近观粒子增量登记（§7.1-B 粒子预算；sprites/points 合并计数）：
 * - m13-cluster：近观星场 points +1,200（中心更密的分级星场）
 * - pleiades：近观星场 points +320 + "七姊妹"亮星辉光 sprite ×7
 * - ring-nebula：环体环向软边粒子 +200
 * - orion-nebula：体积感云团 sprite ×18
 * - crab-pulsar：丝状遗迹云团 sprite ×16
 * - horsehead-nebula：视差发射层平面 ×2 + 前景暗云团 sprite ×3
 * - sirius / heliopause：近观层为线条/壳层/标记（非粒子），增量 0
 * - 其余成员近观细节由 P6 shader 交付（差异登记见文件头），增量 0
 */
export const NEAR_VIEW_PARTICLE_INCREMENTS: Readonly<Record<string, number>> = {
  sun: 0,
  heliopause: 0,
  'sgr-a-star': 0,
  betelgeuse: 0,
  rigel: 0,
  sirius: 0,
  'delta-cephei': 0,
  'wr-124': 0,
  'cygnus-x1': 0,
  'crab-pulsar': 16,
  'orion-nebula': 18,
  'ring-nebula': 200,
  'horsehead-nebula': 5,
  pleiades: 327,
  'm13-cluster': 1200,
};

/** 太阳活动特效粒子峰值（现状登记，utils/solarActivity 体系） */
export const SOLAR_ACTIVITY_PARTICLE_PEAK = 15000;

/** 全局粒子峰值预算（附录 A 硬性约束） */
export const GLOBAL_PARTICLE_BUDGET = 20000;

// ---------------------------------------------------------------------------
// 近观体积感云团布局（星云类共用，确定性伪随机）
// ---------------------------------------------------------------------------

/** 单个云团 sprite 的确定性布局 */
export interface NebulaPuffPlacement {
  x: number;
  y: number;
  z: number;
  /** sprite 边长（场景单位） */
  scale: number;
  /** 基础不透明度（0–1，近观权重另行相乘） */
  opacity: number;
  /** 纹理序号（0..textureCount-1，复用既有 nebulaTextures 缓存） */
  textureIndex: number;
  /** sprite 面内旋转（弧度，打散重复感） */
  rotationRad: number;
}

/**
 * 星云近观体积感云团布局（§7.1-B 星云类增量）：
 * 云团中心在半径 radiusUnits 的（可压扁）球体内按偏内分布采样
 * （r = R·rand^0.8，中心略密），尺寸/透明度/纹理/旋转均确定性生成——
 * 同一种子两次飞往形态一致（渲染循环零随机）。
 *
 * @param flattenY y 方向压扁系数 ∈ (0,1]（1 = 球形，星云多为扁平云）
 */
export function nebulaPuffLayout(
  seed: number,
  count: number,
  radiusUnits: number,
  flattenY: number,
  textureCount: number,
): NebulaPuffPlacement[] {
  if (!Number.isInteger(count) || count <= 0) {
    throw new RangeError(`云团数必须为正整数，收到 ${count}`);
  }
  if (!Number.isFinite(radiusUnits) || radiusUnits <= 0) {
    throw new RangeError(`分布半径必须为正有限数，收到 ${radiusUnits}`);
  }
  if (!Number.isFinite(flattenY) || flattenY <= 0 || flattenY > 1) {
    throw new RangeError(`压扁系数必须在 (0,1] 内，收到 ${flattenY}`);
  }
  if (!Number.isInteger(textureCount) || textureCount <= 0) {
    throw new RangeError(`纹理数必须为正整数，收到 ${textureCount}`);
  }
  const rand = createSeededRandom(seed);
  const placements: NebulaPuffPlacement[] = [];
  for (let i = 0; i < count; i += 1) {
    const r = radiusUnits * Math.pow(rand(), 0.8);
    const cosPolar = rand() * 2 - 1;
    const azimuth = Math.PI * 2 * rand();
    const sinPolar = Math.sqrt(1 - cosPolar * cosPolar);
    placements.push({
      x: r * sinPolar * Math.cos(azimuth),
      y: r * cosPolar * flattenY,
      z: r * sinPolar * Math.sin(azimuth),
      scale: radiusUnits * (0.5 + 0.6 * rand()),
      opacity: 0.14 + 0.22 * rand(),
      textureIndex: Math.floor(rand() * textureCount),
      rotationRad: Math.PI * 2 * rand(),
    });
  }
  return placements;
}
