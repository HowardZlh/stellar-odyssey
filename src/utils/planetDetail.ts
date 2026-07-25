/**
 * 行星近观细节门控与光照细节（P4，需求 §4.7）
 *
 * 纯逻辑模块（渲染 shader 的镜像，供单元测试）：
 * - 近观门控：4K/法线细节层仅在"相机-天体距离进入近观阈值"时加载/渲染，
 *   带滞回（进入/退出阈值不同）防止边界抖动
 * - 细节强度：近观阈值内随距离平滑淡入淡出（4K 与 2K 层切换无突变）
 * - 法线扰动立体光照因子（reliefFactor）与地球海洋高光水面掩码
 *
 * 实现差异登记（§4.7）：需求原文"L1 且进入近观阈值"——连续层级由
 * 相机-原点距离换算，跟随外行星（海王星 30 AU ≈ 300 单位）时层级读数
 * 为 L2 但语义仍是行星近观，故门控以"相机-天体距离"为主判据，
 * 辅以层级上限（DETAIL_LEVEL_CEILING）：离开行星近观语境即释放。
 */

/** 近观层级上限：连续层级高于该值时强制关闭细节（离开 L1 语境） */
export const DETAIL_LEVEL_CEILING = 2.6;

/** 细节层 LRU 容量（天体数）：仅最近 2 个天体保留 4K/法线层（显存 ≤300MB） */
export const DETAIL_LRU_CAPACITY = 2;

/**
 * 近观进入阈值（场景单位）：相机-天体距离低于该值时请求/渲染细节层。
 * 与 cameraFocus.viewDistanceForRadius（半径×6，下限 2.2）衔接：
 * 飞抵后的观察距离必然处于阈值内。
 */
export function detailEnterDistance(radiusUnits: number): number {
  if (!(radiusUnits > 0) || !Number.isFinite(radiusUnits)) {
    throw new RangeError(`显示半径必须为正有限数，收到 ${radiusUnits}`);
  }
  return Math.max(6, radiusUnits * 8);
}

/** 近观退出阈值（滞回：高于进入阈值 40%，防边界抖动） */
export function detailExitDistance(radiusUnits: number): number {
  return detailEnterDistance(radiusUnits) * 1.4;
}

/** 门控更新结果 */
export interface DetailGateUpdate {
  /** 细节层是否激活（加载/渲染 4K 与法线） */
  active: boolean;
  /** 是否应立即释放该天体细节层显存（离开 L1 语境时为 true） */
  releaseNow: boolean;
}

/**
 * 近观门控状态机（每帧调用，滞回防抖）：
 * - 未激活 → 激活：距离 < 进入阈值 且 层级 ≤ 上限
 * - 激活 → 未激活：距离 > 退出阈值 或 层级 > 上限
 * - releaseNow：因层级离开 L1 语境而退出时立即释放显存
 *   （因距离退出时保留在 LRU 中，便于快速切回）
 */
export function detailGateUpdate(
  prevActive: boolean,
  distanceToBodyUnits: number,
  radiusUnits: number,
  continuousLevel: number,
): DetailGateUpdate {
  const levelExit = continuousLevel > DETAIL_LEVEL_CEILING;
  if (prevActive) {
    const distanceExit = distanceToBodyUnits > detailExitDistance(radiusUnits);
    if (levelExit || distanceExit) {
      return { active: false, releaseNow: levelExit };
    }
    return { active: true, releaseNow: false };
  }
  const enter = !levelExit && distanceToBodyUnits < detailEnterDistance(radiusUnits);
  return { active: enter, releaseNow: false };
}

/**
 * 近观门控 + 目标行星系统一致显式判定（R2-2 §2.2-C）：
 * 在 detailGateUpdate 距离/层级判据之上叠加 systemMatch（由
 * utils/bodyCycle.planetDetailScopeAllowed / satelliteDetailScopeAllowed
 * 求得）——焦点目标与本天体不属同一行星系统时禁止激活，
 * 防运镜路径擦过其他天体时误激活；已激活时立即退出并释放显存。
 */
export function detailGateUpdateScoped(
  prevActive: boolean,
  distanceToBodyUnits: number,
  radiusUnits: number,
  continuousLevel: number,
  systemMatch: boolean,
): DetailGateUpdate {
  if (!systemMatch) {
    return { active: false, releaseNow: prevActive };
  }
  return detailGateUpdate(prevActive, distanceToBodyUnits, radiusUnits, continuousLevel);
}

/**
 * 近观细节强度 [0,1]（shader uDetailStrength）：
 * 进入阈值 60% 以内为全强度，退出阈值处衰减为 0（平滑无突变）。
 */
export function detailStrength01(distanceToBodyUnits: number, radiusUnits: number): number {
  const full = detailEnterDistance(radiusUnits) * 0.6;
  const zero = detailExitDistance(radiusUnits);
  if (distanceToBodyUnits <= full) return 1;
  if (distanceToBodyUnits >= zero) return 0;
  const t = (distanceToBodyUnits - full) / (zero - full);
  return 1 - t * t * (3 - 2 * t);
}

/**
 * 法线扰动立体光照因子（shader 镜像）：
 * 昼侧按"扰动法线兰伯特 / 几何法线兰伯特"比率调制表面亮度——
 * 山脉受光面变亮、背光面变暗，整体亮度基准不变（不破坏现有 terminator）。
 *
 * @param geoNdl 几何法线与日照方向点积
 * @param perturbedNdl 法线贴图扰动后的点积
 * @param strength 细节强度 [0,1]（0 = 完全退化为现有光照）
 * @returns 亮度乘数（钳制 [0, 1.5] 防过曝）
 */
export function reliefFactor(geoNdl: number, perturbedNdl: number, strength: number): number {
  const s = Math.min(1, Math.max(0, strength));
  if (s === 0 || geoNdl <= 0) return 1;
  const ratio = Math.min(1.5, Math.max(0, perturbedNdl) / Math.max(geoNdl, 0.05));
  return 1 + (ratio - 1) * s;
}

/**
 * 地球海洋水面掩码（shader 镜像）：海洋像素偏蓝（b 显著高于 r/g），
 * 掩码 = smoothstep(0.05, 0.25, b − max(r, g))。海面反光、陆地不反光。
 */
export function waterMask(r: number, g: number, b: number): number {
  const d = b - Math.max(r, g);
  const t = Math.min(1, Math.max(0, (d - 0.05) / 0.2));
  return t * t * (3 - 2 * t);
}

/**
 * 球面 UV 切线（shader 镜像，THREE.SphereGeometry UV 约定）：
 * dPos/du ∝ (n.z, 0, −n.x)（对象空间，u 沿经度东向）。
 * 极点退化（长度 ~0）时返回 null（shader 中跳过扰动）。
 */
export function sphereTangent(normal: {
  x: number;
  y: number;
  z: number;
}): { x: number; y: number; z: number } | null {
  const tx = normal.z;
  const tz = -normal.x;
  const len = Math.hypot(tx, tz);
  if (len < 1e-4) return null;
  return { x: tx / len, y: 0, z: tz / len };
}

/**
 * 2K 源图程序化细节增强系数（§4.7 差异登记：SSS 对天王星/海王星仅有
 * 2K 源图且无合规高清替代源）——近观时叠加细微纬向条带亮度扰动，
 * 缓解 2K 像素感。幅度 ≤ ±1.5%（不违背"避免过度艺术化"）。
 */
export function bandDetailBoost(v01: number, strength: number): number {
  const s = Math.min(1, Math.max(0, strength));
  const band = Math.sin(v01 * 900) * Math.sin(v01 * 173);
  return 1 + band * 0.015 * s;
}
