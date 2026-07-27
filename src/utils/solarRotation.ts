/**
 * 太阳较差自转（S2，IMPROVEMENT_REQUIREMENTS_SOLAR §4.2/§4.3-1）
 *
 * 太阳不是刚体：赤道自转周期约 25.4 天，纬度 60° 约 30.9 天，极区约 34 天
 * （Carrington 自转观测；NASA Sun Fact Sheet）。角速度剖面按经典经验式
 * ω(φ) = A + B·sin²φ + C·sin⁴φ 拟合（Snodgrass & Ulrich 1990 形式），
 * 系数由上述三个周期锚点解线性方程组唯一确定，保证三个纬度的周期精确复现。
 *
 * 用途：
 * - 光球 shader 按纬度对纹理 U 坐标附加差速相位（镜像 utils/jupiterFlow.ts 模式）
 * - 黑子/日珥/日冕环随所在纬度以正确角速度移动（CPU 端 float64 直接累计）
 *
 * ── 艺术化/近似登记（需求 §3、AGENTS.md 数据准确性）──────────────────
 * - 纹理差速呈现为"相对赤道的剪切"且按 SOLAR_SHEAR_WRAP_DAYS（32 天）
 *   回卷：真实光球特征寿命仅数天至数周，静态贴图若从 J2000 起无界累计
 *   剪切（数千天 → 各纬度带被拉成数十圈错位条纹）反而失真；有界窗口内
 *   剪切方向与速率量级真实（中高纬相对赤道西退），窗口跨越时非赤道纬度
 *   纹理统计性重排（赤道相对相位为 0 恒连续；贴图为统计性表面外观，
 *   重排幅度极区最大 ~0.3 圈、中低纬 <0.1 圈，已登记）。
 * - CPU 端黑子经度用 float64 按绝对角速度累计（赤道快于高纬可观察），
 *   不受纹理剪切窗口影响。
 * 数据来源：NASA Sun Fact Sheet（赤道 25.4 天）；Snodgrass & Ulrich (1990)
 * 较差自转剖面形式；极区 ~34 天（SDO/HMI 观测综述）。
 */

/** 赤道自转周期（天，Carrington/NASA Sun Fact Sheet） */
export const SOLAR_ROTATION_EQUATOR_DAYS = 25.4;

/** 纬度 60° 自转周期（天） */
export const SOLAR_ROTATION_LAT60_DAYS = 30.9;

/** 极区自转周期（天） */
export const SOLAR_ROTATION_POLE_DAYS = 34;

// ω(φ) = A + B·sin²φ + C·sin⁴φ（度/天），由三个周期锚点解出：
//   φ=0:  A                     = 360 / 25.4
//   φ=60: A + 0.75B + 0.5625C   = 360 / 30.9
//   φ=90: A + B + C             = 360 / 34
const OMEGA_A = 360 / SOLAR_ROTATION_EQUATOR_DAYS;
const OMEGA_B =
  ((360 / SOLAR_ROTATION_LAT60_DAYS - OMEGA_A) - 0.5625 * (360 / SOLAR_ROTATION_POLE_DAYS - OMEGA_A)) /
  (0.75 - 0.5625);
const OMEGA_C = 360 / SOLAR_ROTATION_POLE_DAYS - OMEGA_A - OMEGA_B;

/** shader 镜像用系数（度/天）：ω(φ) = A + B·sin²φ + C·sin⁴φ */
export const SOLAR_OMEGA_COEFFS = { a: OMEGA_A, b: OMEGA_B, c: OMEGA_C } as const;

/**
 * 较差自转角速度（度/天）
 *
 * @param latRad 日面纬度（弧度，赤道 0）
 */
export function solarRotationOmegaDegPerDay(latRad: number): number {
  if (!Number.isFinite(latRad)) {
    throw new RangeError(`纬度必须为有限数，收到 ${latRad}`);
  }
  const s2 = Math.sin(latRad) ** 2;
  return OMEGA_A + OMEGA_B * s2 + OMEGA_C * s2 * s2;
}

/**
 * 较差自转周期（天）：赤道 25.4 → 极区 34，随 |纬度| 单调增
 */
export function solarRotationPeriodDays(latRad: number): number {
  return 360 / solarRotationOmegaDegPerDay(latRad);
}

/**
 * 某纬度自模拟起点累计的自转角（弧度，float64，CPU 端黑子/日珥用）
 */
export function solarRotationAngleRad(latRad: number, simDays: number): number {
  if (!Number.isFinite(simDays)) {
    throw new RangeError(`模拟时间必须为有限数，收到 ${simDays}`);
  }
  return (solarRotationOmegaDegPerDay(latRad) * simDays * Math.PI) / 180;
}

/**
 * 纹理 U 坐标差速偏移（shader 镜像，相对赤道剪切呈现——登记见文件头）：
 * ΔU = −(ω(φ) − ω_eq)·t / 360
 * 赤道恒为 0（纹理不整体平移），中高纬相对赤道西退（真实剪切方向）。
 */
export function solarRotationUvOffset(latRad: number, days: number): number {
  return -((solarRotationOmegaDegPerDay(latRad) - OMEGA_A) * days) / 360;
}

/**
 * 纹理剪切回卷窗口（天）：极区最大相对剪切 |ω_pole−ω_eq|·W/360 ≈ 0.32 圈，
 * 剪切幅度有界防静态贴图被拉成错位条纹（登记见文件头）。
 */
export const SOLAR_SHEAR_WRAP_DAYS = 32;

/**
 * shader 用剪切天数：按 SOLAR_SHEAR_WRAP_DAYS 回卷到 [0, W)
 */
export function solarShearShaderDays(simDays: number): number {
  if (!Number.isFinite(simDays)) {
    throw new RangeError(`模拟时间必须为有限数，收到 ${simDays}`);
  }
  const wrapped = simDays % SOLAR_SHEAR_WRAP_DAYS;
  return wrapped < 0 ? wrapped + SOLAR_SHEAR_WRAP_DAYS : wrapped;
}
