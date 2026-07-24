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
 * 超米粒组织 fBm 频率（S3 §4.2）：真实超米粒 ~30,000 km（约米粒 20–30 倍），
 * 频率取米粒尺度的约 1/8，作低频大尺度亮度调制（近观可辨）。
 */
export const SUPERGRANULE_CELL_SCALE = 3.2;

/** 超米粒亮度调制幅度（低对比大尺度，仅近观淡入） */
export const SUPERGRANULE_AMP = 0.04;

/** 超米粒演化速率（远慢于米粒：超米粒寿命 ~1 天，米粒 5–10 分钟） */
export const SUPERGRANULE_TIME_RATE = 0.4;

/**
 * 超米粒亮度调制（shader 镜像，§4.2）：低频大尺度亮度起伏叠加在米粒之上，
 * 仅近观淡入（远观不可辨）。真实超米粒为水平对流环流网格（Leighton 1962），
 * 此处以低频 fBm 亮度示意（登记：非速度场真实模拟）。
 *
 * @param fbm01 低频 fBm 值 ∈ [0,1]
 * @param detailStrength01 近观细节强度 ∈ [0,1]
 * @returns 亮度增量（可正可负，中心为 0）
 */
export function supergranulationModulation(fbm01: number, detailStrength01: number): number {
  const s = Math.min(1, Math.max(0, detailStrength01));
  const f = Math.min(1, Math.max(0, fbm01));
  return (f - 0.5) * 2 * SUPERGRANULE_AMP * s;
}

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
// 光斑（faculae，S3 §4.2）
// ---------------------------------------------------------------------------

/**
 * 光斑增亮峰值（相对亮度增量）：黑子群周边的明亮区域（磁场较弱处对流
 * 增强的高温亮斑），真实对比度低（仅 ~1–2%），临边处更明显——此处
 * 取可辨增量并在临边加权（登记见文件头补充）。
 */
export const FACULAE_BRIGHTNESS_BOOST = 0.18;

/** 光斑环外半径（相对黑子角半径的倍数）：光斑分布于黑子周边环带 */
export const FACULAE_OUTER_RADIUS_RATIO = 2.4;

/**
 * 光斑亮度增量（shader 镜像，§4.2）：黑子周边环带（本影/半影之外到
 * FACULAE_OUTER_RADIUS_RATIO×半径之间）的亮斑，临边（μ 小）处对比更强。
 *
 * 真实光斑与黑子伴生、数量随活动周期同步增减——本函数由 shader 遍历
 * 黑子槽位数据驱动，槽位数已随周期包络门控（sunspots.ts），故数量自动联动。
 *
 * @param angDistRad 片元方向与黑子中心的角距（弧度）
 * @param spotRadiusRad 黑子总角半径（本影+半影）
 * @param strength01 黑子生命周期强度（0-1）
 * @param mu 视线方向余弦 μ = N·V ∈ [0,1]（临边加权）
 * @param noise01 环带纹理噪声 ∈ [0,1]（斑驳感）
 * @returns 亮度增量 ≥ 0
 */
export function faculaeBoost(
  angDistRad: number,
  spotRadiusRad: number,
  strength01: number,
  mu: number,
  noise01: number,
): number {
  if (!(spotRadiusRad > 0)) {
    throw new RangeError(`黑子半径必须为正数，收到 ${spotRadiusRad}`);
  }
  const d = Math.max(0, angDistRad);
  const outer = spotRadiusRad * FACULAE_OUTER_RADIUS_RATIO;
  if (d <= spotRadiusRad || d >= outer) return 0;
  // 环带内三角窗（黑子边缘外渐强、外缘渐弱）
  const t = (d - spotRadiusRad) / (outer - spotRadiusRad);
  const band = Math.sin(Math.PI * t);
  const s = Math.min(1, Math.max(0, strength01));
  const m = Math.min(1, Math.max(0, mu));
  const n = Math.min(1, Math.max(0, noise01));
  // 临边加权：μ 越小（越靠边缘）光斑越亮（真实临边增亮）
  const limbWeight = 0.4 + 0.6 * (1 - m);
  return FACULAE_BRIGHTNESS_BOOST * band * s * limbWeight * (0.6 + 0.4 * n);
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

/** 针状体噪声频率（色球边缘细密锯齿，S3 §4.2） */
export const SPICULE_NOISE_FREQ = 90;

/** 针状体扰动幅度（对色球红环 alpha 的锯齿状调制强度） */
export const SPICULE_AMP = 0.5;

/** 针状体演化速率（喷流生灭较快，噪声时间单位 / 米粒相位） */
export const SPICULE_TIME_RATE = 2.5;

/**
 * 针状体（spicules）边缘扰动（shader 镜像，§4.2）：色球边缘细小针状喷流，
 * 以高频噪声对红环 alpha 作锯齿状调制（勿加几何——需求约束）。
 * 真实针状体为等离子体细喷流（Beckers 1968），此处仅以 alpha 锯齿示意。
 *
 * @param baseAlpha 色球红环基础 alpha（chromosphereRimAlpha 结果）
 * @param noise01 高频边缘噪声 ∈ [0,1]
 * @returns 扰动后的 alpha ≥ 0
 */
export function spiculeRimPerturbation(baseAlpha: number, noise01: number): number {
  const a = Math.max(0, baseAlpha);
  const n = Math.min(1, Math.max(0, noise01));
  // 锯齿调制：噪声在 [1-amp, 1+amp] 间乘性扰动
  return a * (1 + SPICULE_AMP * (n - 0.5) * 2);
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
 * 冕流因子（shader 镜像）：赤道方向冕流拉长明亮、极区收敛 + 角向噪声条纹。
 *
 * S3 活动周期联动（§4.4）：`isotropy01` 控制冕流各向异性——
 * - 极小期（isotropy01≈0）：强赤道加权（冕流集中于赤道，极区收敛），
 *   对应真实极小期"盔状冕流 + 极羽"典型形态；
 * - 极大期（isotropy01≈1）：赤道加权减弱、趋近各向同性（日冕向全纬度
 *   铺开），对应真实极大期日冕近乎圆形铺满。
 *
 * @param absDirY 视线上该点方向的 |y| 分量 ∈ [0,1]（场景 Y ≈ 黄道北极）
 * @param noise01 角向 fBm 噪声 ∈ [0,1]
 * @param isotropy01 日冕形态各向同性因子 ∈ [0,1]（solarCycle.coronaIsotropy01）
 */
export function coronaStreamerFactor(
  absDirY: number,
  noise01: number,
  isotropy01: number = 0,
): number {
  const y = Math.min(1, Math.max(0, absDirY));
  const n = Math.min(1, Math.max(0, noise01));
  const iso = Math.min(1, Math.max(0, isotropy01));
  const equatorWeight = Math.pow(1 - y, 2);
  const streak = 0.45 + 0.55 * n;
  // 各向异性权重随 isotropy01 从"强赤道加权"过渡到"各向同性(=1)"
  const angular = (0.35 + 0.65 * equatorWeight) * (1 - iso) + iso;
  return streak * angular;
}

/** 日冕洞角半径（弧度，S3 §4.2）：开放磁力线暗区的角尺寸 */
export const CORONAL_HOLE_RADIUS_RAD = 0.6;

/** 日冕洞暗化下限（洞中心相对亮度，0=全黑；真实冕洞在 EUV 下显著偏暗） */
export const CORONAL_HOLE_MIN_BRIGHTNESS = 0.25;

/**
 * 日冕洞方向（单位矢量）：真实冕洞常驻于极区（开放磁力线，高速太阳风源），
 * 此处固定取南极偏斜方向作示意（登记：真实冕洞形态随周期变化且可现于低纬，
 * 本示意取常驻极区冕洞）。数据来源：NASA/SDO EUV 冕洞观测；McComas 2008
 * Ulysses 高速风极区来源。
 */
export const CORONAL_HOLE_DIR = (() => {
  const y = -0.82;
  const x = 0.45;
  const z = 0.35;
  const len = Math.hypot(x, y, z);
  return { x: x / len, y: y / len, z: z / len } as const;
})();

/**
 * 日冕洞暗化因子（shader 镜像，§4.2）：视线方向落在冕洞角半径内时日冕
 * 变暗（开放磁力线区域等离子体稀薄）。
 *
 * @param cosAngle 该点方向与冕洞方向的余弦（点积）
 * @returns 亮度乘数 ∈ [CORONAL_HOLE_MIN_BRIGHTNESS, 1]
 */
export function coronalHoleDarkening(cosAngle: number): number {
  const c = Math.min(1, Math.max(-1, cosAngle));
  const ang = Math.acos(c);
  if (ang >= CORONAL_HOLE_RADIUS_RAD) return 1;
  const t = ang / CORONAL_HOLE_RADIUS_RAD;
  // 洞中心最暗、边缘平滑过渡到 1
  const smooth = t * t * (3 - 2 * t);
  return CORONAL_HOLE_MIN_BRIGHTNESS + (1 - CORONAL_HOLE_MIN_BRIGHTNESS) * smooth;
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
  isotropy01: number = 0,
): number {
  const s = Math.min(1, Math.max(0, detailStrength01));
  return coronaRadialFalloff(rNorm) * coronaStreamerFactor(absDirY, noise01, isotropy01) * s;
}

// ---------------------------------------------------------------------------
// 远观光晕与结构化日冕的分级混合（需求 §4.2 分级呈现）
// ---------------------------------------------------------------------------

/**
 * 近观时 sprite 光晕的透明度收敛比例（避免与结构化日冕叠加过曝）。
 * S2 调整 0.45 → 0.85：三层加色 sprite 在近观日面上叠加约 +0.9 亮度，
 * 会把黑子本影（0.28×）冲刷到白场不可辨——近观收敛至 15% 让位给
 * 光球 shader 细节（黑子/米粒）与结构化日冕；远观仍全强度（观感不变）。
 */
export const GLOW_NEAR_FADE = 0.85;

/**
 * sprite 光晕透明度：远观全强度（与现状观感一致），近观让位给
 * 光球细节与结构化日冕（收敛至 15%，平滑无突变）。
 *
 * @param detailStrength01 近观细节强度 ∈ [0,1]
 */
export function spriteGlowOpacity(detailStrength01: number): number {
  const s = Math.min(1, Math.max(0, detailStrength01));
  return 1 - GLOW_NEAR_FADE * s;
}

/** 光球球体分段数（近观弧线平滑；单太阳网格，多边形预算内） */
export const SUN_SPHERE_SEGMENTS = 96;
