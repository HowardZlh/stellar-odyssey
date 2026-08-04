/**
 * 参宿四非对称巨对流胞 + 恒星近观点缀纯逻辑（R4-18，
 * IMPROVEMENT_REQUIREMENTS_4 §R4-18 / §0.3 方案 A）
 *
 * 三组纯函数（附录 A §3 纯函数先行，组件只消费输出）：
 *
 * 1. 参宿四低阶球谐（l ≤ 3）扰动 —— `betelgeuseShPerturbation`：
 *    `StellarSurface` shader 内球谐亮度调制的 CPU 镜像（GLSL 无法直接单测，
 *    项目惯例"纯函数镜像"）。按省 token 约定不做通用球谐库：4 项**峰值归一**
 *    低阶实球谐基（l=1,2,2,3）固定系数展开，系数由缓变余弦驱动
 *    （BETELGEUSE_SH_PERIODS_SEC 视觉周期 46/61/74/88 s，全部落在需求
 *    40–90 s 登记区间；周期互质防拍频锁相）。观感参考 VLTI/SPHERE
 *    （Montargès et al. 2021）：盘面 2–3 个大尺度不对称亮/暗斑缓慢演化。
 *    登记：可选"尘埃抛射暗斑事件"不实现（非硬性，§R4-18 实现时定夺）——
 *    球谐负半周期本身呈现南半球式大暗斑，已覆盖 2019-20 大变暗观感基调。
 *
 * 2. 衍射星芒距离窗口 —— `starSpikeWindow01`：近观激活期内星芒 sprite
 *    的相机距离淡出窗口（§R4-18 第 2 条"近观淡出防遮挡表面"）：
 *    距离 ≥ 4.0×恒星半径全显、≤ 2.2×半径全隐，其间 smoothstep 平滑。
 *    比例登记：飞往观察距离 ≈ 6×半径（cameraFocus.viewDistanceForRadius），
 *    默认驻留视角全显；推近至表面细节视距（<2.2r）时星芒完全让位。
 *
 * 3. 色球边缘辉光环 —— `chromosphereRGB`：色球环颜色与恒星色温联动
 *    （黑体基色向 Hα 发射红端混合，混合权重随 Teff 单调递减——冷星色球
 *    Hα 发射主导偏红、热星趋近光球黑体色）。物理近似登记：真实色球光谱为
 *    发射线叠加（Hα/Ca II 等），此处以"黑体基色 + Hα 红端线性混合"近似，
 *    非辐射转移解。环几何：`chromosphereRingSpriteScale` 使贴图环峰值
 *    半径落在 limb 外 1.04×恒星半径（薄发射环紧贴边缘）。
 *
 * ── 近观增量登记（§R4-18 + 附录 A 粒子预算）────────────────────────────
 * 6 类恒星近观点缀 sprite 计数见 `STAR_NEAR_DRESS_SPRITE_COUNTS`
 * （与 nearView.NEAR_VIEW_PARTICLE_INCREMENTS 单测断言同步防漂移）：
 * 色球环 ×1 + 衍射星芒 ×1 = 2/星；天狼星站 = A 环 + A 芒 + B 环 = 3
 * （B 白矮星已有常驻衍射芒线 sprite，近观不再叠加第二张星芒，登记）。
 */

import { blackbodyRGB } from '@/utils/starPhysics';
import type { Rgb01 } from '@/utils/stellarSurface';

// ---------------------------------------------------------------------------
// 1. 参宿四低阶球谐（l ≤ 3）非对称巨对流胞
// ---------------------------------------------------------------------------

/**
 * 球谐系数缓变余弦周期（秒，视觉周期登记：需求 §R4-18 指定 40–90 s 区间）
 *
 * 4 项周期互不成简单整数比（46/61/74/88），叠加图案不锁相、不整体拍频，
 * 30 s 间隔两帧斑块构型可辨差异（验收标准 1，单测断言）。
 */
export const BETELGEUSE_SH_PERIODS_SEC: readonly number[] = [46, 61, 74, 88];

/** 球谐系数初相位（rad，确定性常量——渲染循环零随机，附录 A §2） */
export const BETELGEUSE_SH_PHASES_RAD: readonly number[] = [0, 1.7, 3.9, 5.1];

/**
 * 球谐基函数权重（固定系数展开，省 token 约定：不做通用球谐库）。
 * 首项（l=1 偶极）最重——盘面呈现"半球亮/半球暗"的最大尺度不对称基调，
 * 高阶项递减叠加 2–3 个大斑块细分。
 */
export const BETELGEUSE_SH_WEIGHTS: readonly number[] = [0.45, 0.35, 0.3, 0.25];

/** 参宿四球谐扰动默认幅度（亮度调制 ±55%，预览页滑杆默认值） */
export const BETELGEUSE_SH_AMPLITUDE_DEFAULT = 0.55;

/** 球谐演化速度默认倍率（预览页滑杆默认值；主场景恒 1） */
export const BETELGEUSE_SH_EVOLVE_SPEED_DEFAULT = 1;

/**
 * 球谐系数（4 项缓变余弦）：c_i(t) = w_i · cos(2π·t·speed / P_i + φ_i)
 *
 * @param timeSec 时间（秒，有限数）
 * @param evolveSpeed 演化速度倍率（≥0）
 * @returns 4 项系数（|c_i| ≤ w_i）
 * @throws RangeError 当 timeSec 非有限数或 evolveSpeed 非法
 */
export function betelgeuseShCoefficients(
  timeSec: number,
  evolveSpeed = BETELGEUSE_SH_EVOLVE_SPEED_DEFAULT,
): [number, number, number, number] {
  if (!Number.isFinite(timeSec)) {
    throw new RangeError(`时间必须为有限数（秒），收到 ${timeSec}`);
  }
  if (!Number.isFinite(evolveSpeed) || evolveSpeed < 0) {
    throw new RangeError(`演化速度倍率必须为非负有限数，收到 ${evolveSpeed}`);
  }
  const t = timeSec * evolveSpeed;
  const c = [0, 0, 0, 0] as [number, number, number, number];
  for (let i = 0; i < 4; i += 1) {
    c[i] =
      BETELGEUSE_SH_WEIGHTS[i] *
      Math.cos((Math.PI * 2 * t) / BETELGEUSE_SH_PERIODS_SEC[i] + BETELGEUSE_SH_PHASES_RAD[i]);
  }
  return c;
}

/**
 * 低阶实球谐扰动（shader `shPerturb` 的 CPU 镜像，逐式一致）
 *
 * 峰值归一基函数（单位球面上 max|b_i| = 1，权重即最大贡献）：
 * - b1 = x                    （l=1, m=1：偶极，半球亮暗）
 * - b2 = x² − y²              （l=2, m=2：四极）
 * - b3 = 2xz                  （l=2, m=1）
 * - b4 = 2.598·z(x² − y²)     （l=3, m=2；2.598 = 3√3/2 峰值归一常数）
 *
 * @param x,y,z 采样方向（内部归一化；零向量抛错）
 * @param timeSec 时间（秒）
 * @param evolveSpeed 演化速度倍率（≥0）
 * @returns 扰动值 ∈ [−1, 1]（亮度调制 = 1 + amplitude × 扰动）
 */
export function betelgeuseShPerturbation(
  x: number,
  y: number,
  z: number,
  timeSec: number,
  evolveSpeed = BETELGEUSE_SH_EVOLVE_SPEED_DEFAULT,
): number {
  const len = Math.hypot(x, y, z);
  if (!Number.isFinite(len) || len <= 0) {
    throw new RangeError(`采样方向必须为非零有限向量，收到 (${x}, ${y}, ${z})`);
  }
  const nx = x / len;
  const ny = y / len;
  const nz = z / len;
  const [c1, c2, c3, c4] = betelgeuseShCoefficients(timeSec, evolveSpeed);
  const xx = nx * nx;
  const yy = ny * ny;
  const s = c1 * nx + c2 * (xx - yy) + c3 * (2 * nx * nz) + c4 * (2.598 * nz * (xx - yy));
  return Math.max(-1, Math.min(1, s));
}

/**
 * 球谐亮度调制（shader `bright *= 1.0 + uShAmp * sh` 的 CPU 镜像）
 *
 * @param brightness 基础亮度（≥0）
 * @param perturbation 球谐扰动 ∈ [−1, 1]
 * @param amplitude 幅度 ∈ [0, 1]（0 = 关闭，其余恒星档）
 * @returns 调制后亮度（钳制 ≥0）
 * @throws RangeError 当 amplitude 不在 [0,1]
 */
export function applyShBrightness(
  brightness: number,
  perturbation: number,
  amplitude: number,
): number {
  if (!Number.isFinite(amplitude) || amplitude < 0 || amplitude > 1) {
    throw new RangeError(`球谐幅度必须在 [0,1] 内，收到 ${amplitude}`);
  }
  const p = Math.max(-1, Math.min(1, perturbation));
  return Math.max(0, brightness * (1 + amplitude * p));
}

// ---------------------------------------------------------------------------
// 2. 衍射星芒距离窗口（近观淡出防遮挡）
// ---------------------------------------------------------------------------

/** 星芒完全淡出距离比（相机距离 ≤ 该比 × 恒星半径时星芒不可见） */
export const STAR_SPIKE_FADE_INNER_RATIO = 2.2;

/** 星芒全显距离比（相机距离 ≥ 该比 × 恒星半径时星芒完全可见） */
export const STAR_SPIKE_FULL_RATIO = 4.0;

/**
 * 衍射星芒距离窗口权重（§R4-18：近观内中距全显、推近表面平滑淡出）
 *
 * smoothstep(2.2r, 4.0r, d)：单调不减、边界外恒 0/1。
 *
 * @param distanceUnits 相机到恒星中心距离（场景单位，≥0）
 * @param radiusUnits 恒星视觉半径（场景单位，>0）
 * @returns 权重 ∈ [0, 1]
 * @throws RangeError 当输入非法
 */
export function starSpikeWindow01(distanceUnits: number, radiusUnits: number): number {
  if (!Number.isFinite(distanceUnits) || distanceUnits < 0) {
    throw new RangeError(`相机距离必须为非负有限数，收到 ${distanceUnits}`);
  }
  if (!Number.isFinite(radiusUnits) || radiusUnits <= 0) {
    throw new RangeError(`恒星半径必须为正有限数，收到 ${radiusUnits}`);
  }
  const lo = radiusUnits * STAR_SPIKE_FADE_INNER_RATIO;
  const hi = radiusUnits * STAR_SPIKE_FULL_RATIO;
  const t = Math.max(0, Math.min(1, (distanceUnits - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
}

/**
 * 星芒 sprite 边长比（恒星半径倍数）：芒线长约至 3.1 倍半径——
 * 长于蓝巨星/WR 常驻辉光 sprite（5× 半径边长）半程，避免被辉光淹没（目验登记）
 */
export const STAR_SPIKE_SCALE_RATIO = 6.5;

/** 星芒 sprite 边长（场景单位）：恒星半径 × STAR_SPIKE_SCALE_RATIO */
export function starSpikeSpriteScale(radiusUnits: number): number {
  if (!Number.isFinite(radiusUnits) || radiusUnits <= 0) {
    throw new RangeError(`恒星半径必须为正有限数，收到 ${radiusUnits}`);
  }
  return radiusUnits * STAR_SPIKE_SCALE_RATIO;
}

// ---------------------------------------------------------------------------
// 3. 色球边缘辉光环（色温联动）
// ---------------------------------------------------------------------------

/** Hα 发射红端参考色（sRGB 0–1；656.3 nm 单色近似的显示色登记） */
export const H_ALPHA_RGB: Readonly<Rgb01> = { r: 1, g: 0.36, b: 0.3 };

/** Hα 混合权重上限（冷星端；热星权重线性降至 0） */
export const CHROMOSPHERE_HALPHA_MIX_MAX = 0.55;

/** Hα 混合权重归零温度（K）：Teff ≥ 该值时色球环 = 纯黑体基色 */
export const CHROMOSPHERE_HALPHA_ZERO_TEFF_K = 8000;

/**
 * 色球环颜色（色温联动，§R4-18 第 2 条）
 *
 * mix(blackbodyRGB(Teff), Hα红, w)，w = min(0.55, max(0, (8000−Teff)/8000))：
 * 参宿四 3,600 K → w=0.55 显著偏红；天狼星 A 9,940 K 及更热 → w=0 纯黑体色。
 * w 随 Teff 单调不增（单测断言）。
 *
 * @param teffK 有效温度（K，正有限数；域外经 blackbodyRGB 钳制）
 * @returns sRGB 显示色（0–1）
 */
export function chromosphereRGB(teffK: number): Rgb01 {
  const base = blackbodyRGB(teffK);
  const w = Math.min(
    CHROMOSPHERE_HALPHA_MIX_MAX,
    Math.max(0, (CHROMOSPHERE_HALPHA_ZERO_TEFF_K - teffK) / CHROMOSPHERE_HALPHA_ZERO_TEFF_K),
  );
  return {
    r: base.r + (H_ALPHA_RGB.r - base.r) * w,
    g: base.g + (H_ALPHA_RGB.g - base.g) * w,
    b: base.b + (H_ALPHA_RGB.b - base.b) * w,
  };
}

/** sRGB 0–1 → `#rrggbb` 十六进制颜色串（canvas 贴图生成用；分量钳制 [0,1]） */
export function rgb01ToCss(rgb: Rgb01): string {
  const to2 = (v: number): string =>
    Math.round(Math.max(0, Math.min(1, v)) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${to2(rgb.r)}${to2(rgb.g)}${to2(rgb.b)}`;
}

/** 环贴图峰值半径（占贴图半边长比例，与 createChromosphereRingCanvas 同源） */
export const CHROMOSPHERE_RING_PEAK_RADIUS01 = 0.62;

/** 环峰值落点（恒星半径倍数）：limb 外薄发射环紧贴边缘 */
export const CHROMOSPHERE_RING_OUTSET_RATIO = 1.04;

/**
 * 色球环 sprite 边长（场景单位）：使贴图环峰值半径 = 1.04 × 恒星半径
 *
 * scale = 2 × 1.04r / 0.62 ≈ 3.355r（环内侧透明区覆盖恒星盘面不遮挡）。
 */
export function chromosphereRingSpriteScale(radiusUnits: number): number {
  if (!Number.isFinite(radiusUnits) || radiusUnits <= 0) {
    throw new RangeError(`恒星半径必须为正有限数，收到 ${radiusUnits}`);
  }
  return (2 * CHROMOSPHERE_RING_OUTSET_RATIO * radiusUnits) / CHROMOSPHERE_RING_PEAK_RADIUS01;
}

/** 色球环最大不透明度（近观全激活时；额外乘层级权重与近观权重） */
export const CHROMOSPHERE_RING_OPACITY_MAX = 0.5;

/** 衍射星芒最大不透明度（近观全激活 × 距离窗口全显时） */
export const STAR_SPIKE_OPACITY_MAX = 0.85;

// ---------------------------------------------------------------------------
// 近观增量登记（与 nearView.NEAR_VIEW_PARTICLE_INCREMENTS 单测同步）
// ---------------------------------------------------------------------------

/**
 * 6 类恒星近观点缀 sprite 计数（§R4-18 登记）：
 * 色球环 ×1 + 衍射星芒 ×1 = 2/站；天狼星站 A 环 + A 芒 + B 环 = 3
 * （B 星常驻衍射芒线已有，近观不叠加第二张，登记见文件头）。
 */
export const STAR_NEAR_DRESS_SPRITE_COUNTS: Readonly<Record<string, number>> = {
  betelgeuse: 2,
  rigel: 2,
  sirius: 3,
  'delta-cephei': 2,
  'wr-124': 2,
};
