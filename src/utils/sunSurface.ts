/**
 * 太阳表面与日冕 shader 纯逻辑镜像（S1，IMPROVEMENT_REQUIREMENTS_SOLAR §4.2/§5.1）
 *
 * 太阳现状为 meshBasicMaterial 静态贴图球（视觉上全项目最"朴素"的天体），
 * 本模块提供光球/色球/日冕升级用到的核心函数的 CPU 参考实现，供组件内
 * GLSL 保持一致、供单测校验（GLSL 无法直接单测，按项目惯例做"纯函数镜像"，
 * 噪声基元复用 utils/stellarSurface.ts 的 hash3/valueNoise3D/convectionFbm3）：
 *
 * 1. 米粒组织（granulation）：光球对流胞，直径约 1,000–1,500 km、寿命
 *    5–10 分钟，"像沸腾的粥"不断翻滚（来源：NASA/SDO 观测；Nordlund et al.
 *    2009 太阳表面对流综述）。以球面 3D fBm 亮度调制表达，随模拟时间演化。
 * 2. 临边昏暗（limb darkening）：太阳 V 波段线性系数 u≈0.6（Milne 线性
 *    定律，与 stellarSurface.limbDarkening 共用公式）——真实物理，无需登记。
 * 3. 色球层：光球上方薄层（真实厚度约 2,000 km ≈ 0.3% 太阳半径），呈红色
 *    （氢α 发射线 656.3 nm）；日全食/日面边缘可见红色细环。
 * 4. 日冕：最外层大气，温度 1–3×10⁶ K，可延伸数百万公里；赤道方向冕流
 *    （streamers）拉长、极区较短（极小期典型形态）。
 *
 * ── 艺术化/近似登记（需求 §3、AGENTS.md 数据准确性）──────────────────
 * - 米粒尺度：真实对流胞 ~1,000 km，太阳直径方向约 4,000+ 胞，屏幕像素
 *   无法分辨——采用视觉可辨的粗化胞尺度（GRANULE_CELL_SCALE）。
 * - 米粒演化速率：真实寿命 5–10 分钟（模拟时间），L1 默认时间压缩比下
 *   （1 秒≈数小时）真实速率将呈高频闪烁——按 §3.3 速率钳制思路以
 *   GRANULE_TIME_RATE 降速呈现（暂停冻结、加速联动，共享模拟时间轴）；
 *   相位对 GRANULE_PHASE_WRAP 回卷防 float32 精度失效（同 jupiterFlow）。
 * - 色球厚度：真实 ~0.3% 半径不可见，壳层放大至 +1.5%（CHROMOSPHERE_SHELL_SCALE）。
 * - 日冕范围：真实延伸数百万公里（>10 R☉），场景中压缩至数个半径内的
 *   广告牌辉光；冕流形态为静态 fBm 示意（活动周期联动属 S3 范围）。
 * 数据来源：NASA Sun Fact Sheet；limb darkening 系数 Cox (2000) Allen's
 * Astrophysical Quantities；日冕温度 NASA/SDO。
 */

// ---------------------------------------------------------------------------
// 光球（photosphere）
// ---------------------------------------------------------------------------

/** 临边昏暗线性系数（太阳 V 波段 ≈0.6，Cox 2000） */
export const SUN_LIMB_DARKENING_U = 0.6;

/** 边缘色温梯度强度（盘面边缘偏暗红，复用 stellarSurface 色温梯度公式） */
export const SUN_EDGE_REDNESS = 0.4;

/** 米粒组织 fBm 首层频率（视觉粗化胞尺度，登记见文件头） */
export const GRANULE_CELL_SCALE = 26;

/** 米粒组织 fBm 层数（与 SpecialBodies GLSL fbm3 固定 4 层一致） */
export const GRANULE_OCTAVES = 4;

/** 米粒亮度调制幅度：远观（细节强度 0）/ 近观（细节强度 1） */
export const GRANULE_AMP_FAR = 0.05;
export const GRANULE_AMP_NEAR = 0.16;

/** 米粒演化速率（噪声时间单位 / 模拟天，速率钳制登记见文件头） */
export const GRANULE_TIME_RATE = 3;

/** 米粒相位回卷周期（防 float32 uniform 精度失效，同 jupiterFlow 思路） */
export const GRANULE_PHASE_WRAP = 2048;

/** 光球中心亮度增益（补偿临边昏暗后的整体能量，保持 Bloom 阈值以上） */
export const PHOTOSPHERE_BRIGHTNESS_GAIN = 1.12;

/**
 * 米粒亮度调制幅度随近观细节强度插值
 *
 * @param detailStrength01 近观细节强度 ∈ [0,1]（planetDetail.detailStrength01）
 */
export function granulationAmplitude(detailStrength01: number): number {
  const s = Math.min(1, Math.max(0, detailStrength01));
  return GRANULE_AMP_FAR + (GRANULE_AMP_NEAR - GRANULE_AMP_FAR) * s;
}

/**
 * 米粒亮度乘数（shader 镜像）：fBm 值 [0,1] 映射为亮度调制，
 * 胞中心（上升热流）亮、胞边界（下沉流）暗；钳制防过曝/过暗。
 *
 * @param fbm01 对流 fBm 值 ∈ [0,1]（stellarSurface.convectionFbm3）
 * @param amplitude 调制幅度（granulationAmplitude 结果）
 * @returns 亮度乘数 ∈ [0.6, 1.4]
 */
export function granulationBrightness(fbm01: number, amplitude: number): number {
  const b = 1 + (fbm01 - 0.5) * 2 * amplitude;
  return Math.min(1.4, Math.max(0.6, b));
}

/**
 * 米粒演化相位（喂给 fBm 的 time 参数）：模拟时间轴驱动（暂停冻结、
 * 加速联动），速率钳制 + 回卷（登记见文件头）。
 *
 * @param simDays 模拟时间（天）
 * @returns 相位 ∈ [0, GRANULE_PHASE_WRAP)
 */
export function granulationPhase(simDays: number): number {
  if (!Number.isFinite(simDays)) {
    throw new RangeError(`模拟时间必须为有限数，收到 ${simDays}`);
  }
  const raw = (simDays * GRANULE_TIME_RATE) % GRANULE_PHASE_WRAP;
  return raw < 0 ? raw + GRANULE_PHASE_WRAP : raw;
}

// ---------------------------------------------------------------------------
// 色球（chromosphere）
// ---------------------------------------------------------------------------

/** 色球壳层半径倍率（真实 ~1.003，视觉放大登记见文件头） */
export const CHROMOSPHERE_SHELL_SCALE = 1.015;

/** 色球颜色（氢α 656.3 nm 发射线红色，0-1 RGB） */
export const CHROMOSPHERE_COLOR = { r: 1.0, g: 0.3, b: 0.22 } as const;

/** 色球边缘环峰值透明度 */
export const CHROMOSPHERE_MAX_ALPHA = 0.85;

/** 色球菲涅尔集中幂次（越大红环越窄、越贴边缘） */
export const CHROMOSPHERE_FRESNEL_POWER = 3.0;

/**
 * 色球边缘环透明度（shader 镜像）：放大壳层上按菲涅尔窗集中于临边——
 * 盘面中心（μ→1）透明不染色，边缘（μ→0）呈红色细环；随近观细节
 * 强度淡入（远观不可见，符合"仅在近观/日面边缘可辨"）。
 *
 * @param mu 视线方向余弦 μ = N·V ∈ [0,1]
 * @param detailStrength01 近观细节强度 ∈ [0,1]
 */
export function chromosphereRimAlpha(mu: number, detailStrength01: number): number {
  const m = Math.min(1, Math.max(0, mu));
  const s = Math.min(1, Math.max(0, detailStrength01));
  return Math.pow(1 - m, CHROMOSPHERE_FRESNEL_POWER) * CHROMOSPHERE_MAX_ALPHA * s;
}

// ---------------------------------------------------------------------------
// 日冕（corona）
// ---------------------------------------------------------------------------

/** 结构化日冕广告牌边长（× 太阳半径） */
export const CORONA_QUAD_SCALE = 9;

/** 日冕径向衰减系数（半径外 exp(-k·(r−1)) 衰减） */
export const CORONA_FALLOFF_K = 2.2;

/** 冕流角向噪声频率（单位方向向量域） */
export const CORONA_STREAMER_FREQ = 3.0;

/** 冕流演化速率（噪声时间 / 米粒相位，日冕结构演化远慢于米粒） */
export const CORONA_TIME_RATE = 0.15;

/** 日冕基础色（百万度电离等离子体的珍珠白，微偏暖） */
export const CORONA_COLOR = { r: 1.0, g: 0.88, b: 0.72 } as const;

/**
 * 日冕径向衰减（shader 镜像）：日面内为 1（被光球遮挡），
 * 日面外随距离指数衰减。
 *
 * @param rNorm 距太阳中心距离（单位：太阳半径，1 = 光球边缘）
 */
export function coronaRadialFalloff(rNorm: number): number {
  if (!(rNorm >= 0) || !Number.isFinite(rNorm)) {
    throw new RangeError(`径向距离必须为非负有限数，收到 ${rNorm}`);
  }
  if (rNorm <= 1) return 1;
  return Math.exp(-CORONA_FALLOFF_K * (rNorm - 1));
}

/**
 * 冕流因子（shader 镜像）：赤道方向冕流拉长明亮、极区收敛
 * （极小期典型形态，S3 活动周期联动前的基础形态）+ 角向噪声条纹。
 *
 * @param absDirY 视线上该点方向的 |y| 分量 ∈ [0,1]（场景 Y ≈ 黄道北极）
 * @param noise01 角向 fBm 噪声 ∈ [0,1]
 */
export function coronaStreamerFactor(absDirY: number, noise01: number): number {
  const y = Math.min(1, Math.max(0, absDirY));
  const n = Math.min(1, Math.max(0, noise01));
  const equatorWeight = Math.pow(1 - y, 2);
  const streak = 0.45 + 0.55 * n;
  return streak * (0.35 + 0.65 * equatorWeight);
}

/**
 * 结构化日冕综合亮度（shader 镜像）：径向衰减 × 冕流因子 × 近观强度。
 * 远观（强度 0）时结构化日冕完全隐藏，由低成本 sprite 光晕承担观感
 * （分级呈现，需求 §4.2）。
 */
export function coronaIntensity(
  rNorm: number,
  absDirY: number,
  noise01: number,
  detailStrength01: number,
): number {
  const s = Math.min(1, Math.max(0, detailStrength01));
  return coronaRadialFalloff(rNorm) * coronaStreamerFactor(absDirY, noise01) * s;
}

// ---------------------------------------------------------------------------
// 远观光晕与结构化日冕的分级混合（需求 §4.2 分级呈现）
// ---------------------------------------------------------------------------

/** 近观时 sprite 光晕的透明度收敛比例（避免与结构化日冕叠加过曝） */
export const GLOW_NEAR_FADE = 0.45;

/**
 * sprite 光晕透明度：远观全强度（与现状观感一致），近观让位给
 * 结构化日冕（收敛至 55%，平滑无突变）。
 *
 * @param detailStrength01 近观细节强度 ∈ [0,1]
 */
export function spriteGlowOpacity(detailStrength01: number): number {
  const s = Math.min(1, Math.max(0, detailStrength01));
  return 1 - GLOW_NEAR_FADE * s;
}

/** 光球球体分段数（近观弧线平滑；单太阳网格，多边形预算内） */
export const SUN_SPHERE_SEGMENTS = 96;
