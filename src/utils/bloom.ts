/**
 * Bloom 泛光强度层级适配（P3-3，需求 §4.6）
 *
 * 选择性发光方案：Bloom 采用亮度阈值（luminanceThreshold），仅太阳、
 * 恒星类特殊天体、超新星峰值、黑洞吸积盘、类星体、银心辉光等高亮度
 * 发光体超过阈值参与泛光；行星表面/轨道线等低亮度内容不受影响。
 *
 * 层级适配（需求 §4.6）：L1/L2 较强突出太阳辉光质感；L3/L4 收敛，
 * 避免银盘粒子/宇宙网整体过曝（§4.2 背景验收不回退）。
 * 纯逻辑模块，供单元测试。
 */

/** 亮度阈值：高于该亮度的像素参与泛光（选择性发光） */
export const BLOOM_LUMINANCE_THRESHOLD = 0.55;

/** 亮度阈值平滑过渡宽度 */
export const BLOOM_LUMINANCE_SMOOTHING = 0.35;

/** 各离散层级的 Bloom 强度锚点（L1–L4） */
export const BLOOM_INTENSITY_BY_LEVEL: readonly number[] = [1.25, 1.1, 0.55, 0.35];

/**
 * 连续层级 → Bloom 强度（锚点间线性插值，跨层级缩放时平滑变化）
 *
 * @param continuousLevel 连续层级（1.0–4.0，超界钳制）
 */
export function bloomIntensityForLevel(continuousLevel: number): number {
  const anchors = BLOOM_INTENSITY_BY_LEVEL;
  const f = Math.min(anchors.length, Math.max(1, continuousLevel));
  const i = Math.min(anchors.length - 2, Math.floor(f - 1));
  const t = f - 1 - i;
  return anchors[i] + (anchors[i + 1] - anchors[i]) * t;
}

/**
 * Bloom 有效强度：开关关闭时为 0（控制面板"泛光效果"开关，需求 §4.6）
 */
export function effectiveBloomIntensity(continuousLevel: number, enabled: boolean): number {
  return enabled ? bloomIntensityForLevel(continuousLevel) : 0;
}
