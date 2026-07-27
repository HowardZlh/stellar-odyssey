/**
 * 恒星闪烁纯逻辑（P3-5，需求 §4.6 恒星闪烁）
 *
 * ⚠ 科学性登记（强制，需求 §4.6）：
 * 真空中恒星不闪烁——闪烁（scintillation）源于地面观察者头顶的大气湍流
 * （视宁度），太空中观察恒星亮度恒定。本效果为艺术化处理，采用方案A：
 * 仅 L1 行星视角启用（符合"处于行星大气内观察"的物理逻辑），
 * L2 及以外层级闪烁强度淡出为 0（见 twinkleLevelGain）。
 * 帮助信息中另有说明（components/UI/HelpHint.tsx）。
 *
 * 确定性：每星独立相位/频率由星场种子随机流预生成（无每帧随机数），
 * 亮度扰动为双正弦叠加（频率不可通约，观感不规则但完全确定）。
 * 频率 0.5–2 Hz、幅度 ±10–20%（亮星略明显、暗星微弱），符合克制要求。
 *
 * GLSL 实现见 components/Scene/Starfield.tsx（本模块为其纯逻辑镜像）。
 */

/** 闪烁频率下限/上限（Hz，需求 §4.6：低频 0.5–2 Hz） */
export const TWINKLE_FREQ_MIN_HZ = 0.5;
export const TWINKLE_FREQ_MAX_HZ = 2;

/** 闪烁幅度下限/上限（±比例，需求 §4.6：±10–20%） */
export const TWINKLE_AMP_MIN = 0.1;
export const TWINKLE_AMP_MAX = 0.2;

/** 闪烁完全启用的连续层级上限（L1 深处） */
export const TWINKLE_FULL_LEVEL = 1.15;

/** 闪烁完全淡出的连续层级（进入 L2 前归零，方案A） */
export const TWINKLE_ZERO_LEVEL = 1.85;

/**
 * 层级闪烁增益（方案A：仅 L1 行星视角启用）：
 * continuousLevel ≤ 1.15 → 1；≥ 1.85 → 0；之间线性淡出。
 */
export function twinkleLevelGain(continuousLevel: number): number {
  if (continuousLevel <= TWINKLE_FULL_LEVEL) return 1;
  if (continuousLevel >= TWINKLE_ZERO_LEVEL) return 0;
  return (TWINKLE_ZERO_LEVEL - continuousLevel) / (TWINKLE_ZERO_LEVEL - TWINKLE_FULL_LEVEL);
}

/**
 * 由 [0,1) 随机数映射每星闪烁频率（Hz，确定性预生成）
 */
export function twinkleFrequencyHz(rand01: number): number {
  const t = Math.min(1, Math.max(0, rand01));
  return TWINKLE_FREQ_MIN_HZ + (TWINKLE_FREQ_MAX_HZ - TWINKLE_FREQ_MIN_HZ) * t;
}

/**
 * 每星闪烁幅度：亮星略明显、暗星微弱（需求 §4.6）
 *
 * @param brightness01 恒星相对亮度（0-1，星场距离衰减后的亮度系数）
 * @param rand01 随机抖动（0-1）
 */
export function twinkleAmplitude(brightness01: number, rand01: number): number {
  const b = Math.min(1, Math.max(0, brightness01));
  const r = Math.min(1, Math.max(0, rand01));
  // 基础幅度随亮度提升：暗星贴近下限，亮星接近上限
  const base = TWINKLE_AMP_MIN + (TWINKLE_AMP_MAX - TWINKLE_AMP_MIN) * b;
  // 少量随机抖动（±20% 基础幅度）保持个体差异，仍在 [0.1, 0.2] 上下界内钳制
  const jittered = base * (0.9 + 0.2 * r);
  return Math.min(TWINKLE_AMP_MAX, Math.max(TWINKLE_AMP_MIN, jittered));
}

/**
 * 闪烁亮度因子（GLSL 镜像）：双正弦叠加（0.7 主频 + 0.3 高次不可通约频率），
 * 结果在 [1 - amp, 1 + amp] 内。
 *
 * @param timeSec 时间（秒）
 * @param phase01 每星独立相位（0-1）
 * @param freqHz 主频率（Hz）
 * @param amp 幅度（±比例）
 * @param levelGain 层级增益（twinkleLevelGain，0 时无闪烁恒为 1）
 */
export function twinkleFactor(
  timeSec: number,
  phase01: number,
  freqHz: number,
  amp: number,
  levelGain = 1,
): number {
  const tau = Math.PI * 2;
  const wave =
    0.7 * Math.sin(tau * (freqHz * timeSec + phase01)) +
    0.3 * Math.sin(tau * (2.33 * freqHz * timeSec + 2.7 * phase01));
  return 1 + amp * levelGain * wave;
}
