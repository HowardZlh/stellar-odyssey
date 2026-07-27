/**
 * 标签屏幕尺寸统一治理纯逻辑（R3-4，IMPROVEMENT_REQUIREMENTS_3 §R3-4）
 *
 * 根因：全部世界空间标签均为 drei `<Html distanceFactor=N>`，其屏幕缩放
 * ≈ distanceFactor / (2·tan(vFOV/2)·相机距离)——"世界空间固定大小的牌子"
 * 语义在相机距离远小于 distanceFactor 时会把标签放大数十倍铺屏（跟随
 * 小天体放大时说明文字遮挡画面，用户反馈）。
 *
 * 治理方案（用户确认项 1）：近距对标签内层做反向 CSS 缩放
 * `labelCounterScale = min(1, distance/minDistance)`——与外层 drei 缩放
 * 相乘后，距离 < minDistance 段的最终屏幕尺寸恒定为 minDistance 处的
 * 大小（连续函数无跳变、FOV 无关，等效"近距转固定像素"）；距离 ≥
 * minDistance 段恒为 1，远距观感零回退。焦点目标自身标签的隐藏由各
 * 组件既有机制（P7 近距隐藏 / R2-7/R2-8 焦点隐藏）承担，非焦点标签
 * 只钳制不隐藏。
 *
 * 最小生效距离默认取 distanceFactor × LABEL_MIN_DISTANCE_RATIO（0.5）：
 * 钳制上限 ≈ 该标签设计尺寸的 2 倍以内（drei 缩放在 dist = df 处约为
 * 1/(2·tan(vFOV/2))，故上限具体倍数随各层级 FOV 略有差异，登记）。
 */

/** 最小生效距离默认比例（minDistance = distanceFactor × ratio） */
export const LABEL_MIN_DISTANCE_RATIO = 0.5;

/**
 * 反向缩放系数（应用于标签内层 CSS transform: scale）：
 * 距离 ≥ minDistance 恒为 1（不干预）；距离 < minDistance 线性收敛，
 * 与外层 drei distanceFactor 缩放相乘后屏幕尺寸恒定。
 */
export function labelCounterScale(distanceUnits: number, minDistanceUnits: number): number {
  if (!Number.isFinite(distanceUnits) || distanceUnits < 0) {
    throw new RangeError(`相机距离必须为非负有限数，收到 ${distanceUnits}`);
  }
  if (!Number.isFinite(minDistanceUnits) || minDistanceUnits <= 0) {
    throw new RangeError(`最小生效距离必须为正有限数，收到 ${minDistanceUnits}`);
  }
  return Math.min(1, distanceUnits / minDistanceUnits);
}

/**
 * 按 distanceFactor 换算最小生效距离（逐标签可传自定义 ratio 微调）。
 */
export function labelMinDistance(
  distanceFactor: number,
  ratio: number = LABEL_MIN_DISTANCE_RATIO,
): number {
  if (!Number.isFinite(distanceFactor) || distanceFactor <= 0) {
    throw new RangeError(`distanceFactor 必须为正有限数，收到 ${distanceFactor}`);
  }
  if (!Number.isFinite(ratio) || ratio <= 0) {
    throw new RangeError(`ratio 必须为正有限数，收到 ${ratio}`);
  }
  return distanceFactor * ratio;
}

/**
 * 缩放值量化（保留 3 位小数）：供组件缓存比对，未变化不写样式，
 * 防每帧字符串分配与 DOM 样式写入。
 */
export function quantizeScale(scale: number): number {
  if (!Number.isFinite(scale)) {
    throw new RangeError(`缩放值必须为有限数，收到 ${scale}`);
  }
  return Math.round(scale * 1000) / 1000;
}
