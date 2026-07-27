/**
 * 开普勒轨道物理计算
 *
 * 科学依据：
 * - 开普勒方程 M = E − e·sinE（数值求解，牛顿迭代法）
 * - 位置由轨道六要素 + 历元后时间推得，天然满足开普勒第二定律（匀面速度）
 * - 历元：J2000.0（2000-01-01 12:00:00 TT，简化按 UTC 处理，误差对可视化可忽略）
 *
 * 坐标系：日心黄道坐标系，x-y 为黄道面，z 垂直黄道面（北黄极方向）。
 * 自北黄极俯视，行星公转为逆时针（真近点角随时间增加）。
 *
 * 数据来源：NASA JPL, https://ssd.jpl.nasa.gov/planets/approx_pos.html
 */

import type { OrbitalElements, Vec3 } from '@/types';

export const DEG_TO_RAD = Math.PI / 180;
export const RAD_TO_DEG = 180 / Math.PI;

/** J2000.0 历元对应的 Unix 毫秒时间戳（2000-01-01T12:00:00Z） */
export const J2000_EPOCH_MS = Date.UTC(2000, 0, 1, 12, 0, 0);

/** 一天的毫秒数 */
export const MS_PER_DAY = 86400000;

/** 儒略年天数 */
export const DAYS_PER_YEAR = 365.25;

/**
 * 计算给定日期相对 J2000 历元的天数（可为负）
 */
export function daysSinceJ2000(date: Date): number {
  return (date.getTime() - J2000_EPOCH_MS) / MS_PER_DAY;
}

/**
 * 将角度规范化到 [0, 2π)
 */
export function normalizeAngle(rad: number): number {
  const twoPi = Math.PI * 2;
  let a = rad % twoPi;
  if (a < 0) a += twoPi;
  return a;
}

/**
 * 求解开普勒方程 M = E − e·sinE，返回偏近点角 E（弧度）
 *
 * 使用牛顿-拉夫森迭代，对高离心率轨道（如哈雷彗星 e≈0.967）依然收敛：
 * 初值采用 Danby 建议 E₀ = M + 0.85·e·sign(sinM)。
 *
 * @param meanAnomaly 平近点角 M（弧度）
 * @param eccentricity 离心率 e，要求 0 ≤ e < 1（椭圆轨道）
 * @param tolerance 收敛容差（弧度）
 */
export function solveKeplerEquation(
  meanAnomaly: number,
  eccentricity: number,
  tolerance = 1e-9,
): number {
  if (eccentricity < 0 || eccentricity >= 1) {
    throw new RangeError(`离心率必须在 [0, 1) 范围内（椭圆轨道），收到 ${eccentricity}`);
  }
  const M = normalizeAngle(meanAnomaly);
  // Danby 初值，对高离心率收敛性好
  let E = M + 0.85 * eccentricity * Math.sign(Math.sin(M) || 1);
  for (let i = 0; i < 50; i += 1) {
    const f = E - eccentricity * Math.sin(E) - M;
    const fPrime = 1 - eccentricity * Math.cos(E);
    const delta = f / fPrime;
    E -= delta;
    if (Math.abs(delta) < tolerance) {
      return E;
    }
  }
  return E;
}

/**
 * 由偏近点角计算真近点角 ν（弧度）
 */
export function trueAnomalyFromEccentric(eccentricAnomaly: number, eccentricity: number): number {
  const halfE = eccentricAnomaly / 2;
  return (
    2 *
    Math.atan2(
      Math.sqrt(1 + eccentricity) * Math.sin(halfE),
      Math.sqrt(1 - eccentricity) * Math.cos(halfE),
    )
  );
}

/**
 * 开普勒第三定律：由半长轴（AU）计算公转周期（儒略年）
 * T² = a³（太阳质量主导，行星质量忽略）
 */
export function orbitalPeriodYears(semiMajorAxisAu: number): number {
  if (semiMajorAxisAu <= 0) {
    throw new RangeError(`半长轴必须为正数，收到 ${semiMajorAxisAu}`);
  }
  return Math.pow(semiMajorAxisAu, 1.5);
}

/**
 * 平均运动 n（弧度/天）
 */
export function meanMotionRadPerDay(semiMajorAxisAu: number): number {
  const periodDays = orbitalPeriodYears(semiMajorAxisAu) * DAYS_PER_YEAR;
  return (Math.PI * 2) / periodDays;
}

/**
 * 给定历元后天数，计算平近点角 M（弧度）
 */
export function meanAnomalyAtTime(elements: OrbitalElements, daysFromEpoch: number): number {
  const M0 = elements.meanAnomalyAtEpochDeg * DEG_TO_RAD;
  const n = meanMotionRadPerDay(elements.semiMajorAxisAu);
  return normalizeAngle(M0 + n * daysFromEpoch);
}

/**
 * 由轨道六要素和真近点角计算日心黄道坐标（AU）
 *
 * 标准变换：轨道面坐标 → 绕 z 轴转 ω → 绕 x 轴转 i → 绕 z 轴转 Ω
 */
export function positionFromTrueAnomaly(elements: OrbitalElements, trueAnomaly: number): Vec3 {
  const { semiMajorAxisAu: a, eccentricity: e } = elements;
  const i = elements.inclinationDeg * DEG_TO_RAD;
  const omega = elements.argumentOfPerihelionDeg * DEG_TO_RAD;
  const bigOmega = elements.longitudeOfAscendingNodeDeg * DEG_TO_RAD;

  // 轨道半径（椭圆极坐标方程，焦点在太阳）
  const r = (a * (1 - e * e)) / (1 + e * Math.cos(trueAnomaly));

  // 轨道面内坐标（近日点方向为 x 轴）
  const xOrb = r * Math.cos(trueAnomaly);
  const yOrb = r * Math.sin(trueAnomaly);

  const cosO = Math.cos(bigOmega);
  const sinO = Math.sin(bigOmega);
  const cosI = Math.cos(i);
  const sinI = Math.sin(i);
  const cosW = Math.cos(omega);
  const sinW = Math.sin(omega);

  return {
    x: (cosO * cosW - sinO * sinW * cosI) * xOrb + (-cosO * sinW - sinO * cosW * cosI) * yOrb,
    y: (sinO * cosW + cosO * sinW * cosI) * xOrb + (-sinO * sinW + cosO * cosW * cosI) * yOrb,
    z: sinI * sinW * xOrb + sinI * cosW * yOrb,
  };
}

/**
 * 核心入口：给定 J2000 历元后天数，通过求解开普勒方程得到日心黄道位置（AU）
 *
 * 满足开普勒第二定律：近日点角速度快、远日点慢（禁止匀角速度近似）。
 */
export function heliocentricPosition(elements: OrbitalElements, daysFromEpoch: number): Vec3 {
  const M = meanAnomalyAtTime(elements, daysFromEpoch);
  const E = solveKeplerEquation(M, elements.eccentricity);
  const nu = trueAnomalyFromEccentric(E, elements.eccentricity);
  return positionFromTrueAnomaly(elements, nu);
}

/**
 * 日心距离（AU）
 */
export function heliocentricDistanceAu(elements: OrbitalElements, daysFromEpoch: number): number {
  const p = heliocentricPosition(elements, daysFromEpoch);
  return Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z);
}

/**
 * 采样整条椭圆轨道（用于轨道线渲染，与天体运动解耦）
 *
 * 按偏近点角均匀采样保证近日点附近折线均匀，首尾闭合。
 *
 * @param segments 分段数（附录A 建议 512）
 */
export function sampleOrbitPoints(elements: OrbitalElements, segments = 512): Vec3[] {
  if (segments < 3) {
    throw new RangeError(`轨道采样分段数至少为 3，收到 ${segments}`);
  }
  const points: Vec3[] = [];
  for (let s = 0; s <= segments; s += 1) {
    const E = (s / segments) * Math.PI * 2;
    const nu = trueAnomalyFromEccentric(E, elements.eccentricity);
    points.push(positionFromTrueAnomaly(elements, nu));
  }
  return points;
}

/**
 * 广义开普勒轨道位置：中心天体不限于太阳（卫星绕行星等），
 * 公转周期由数据直接给出（不同中心天体质量下 T²=a³ 的太阳版不适用）。
 *
 * 距离单位与 elements.semiMajorAxisAu 字段的单位一致（可为 km 或场景单位），
 * 角度要素含义不变。周期为负表示逆行（返回角度随时间反向推进）。
 *
 * @param periodDays 公转周期（天），非零
 */
export function orbitPositionWithPeriod(
  elements: OrbitalElements,
  periodDays: number,
  daysFromEpoch: number,
): Vec3 {
  if (periodDays === 0) {
    throw new RangeError('公转周期不能为 0');
  }
  const M0 = elements.meanAnomalyAtEpochDeg * DEG_TO_RAD;
  const n = (Math.PI * 2) / periodDays;
  const M = normalizeAngle(M0 + n * daysFromEpoch);
  const E = solveKeplerEquation(M, elements.eccentricity);
  const nu = trueAnomalyFromEccentric(E, elements.eccentricity);
  return positionFromTrueAnomaly(elements, nu);
}

/**
 * 广义轨道当前相位角（平近点角，弧度）——用于潮汐锁定自转对齐等
 */
export function orbitMeanAnomalyWithPeriod(
  meanAnomalyAtEpochDeg: number,
  periodDays: number,
  daysFromEpoch: number,
): number {
  if (periodDays === 0) {
    throw new RangeError('公转周期不能为 0');
  }
  const M0 = meanAnomalyAtEpochDeg * DEG_TO_RAD;
  return normalizeAngle(M0 + ((Math.PI * 2) / periodDays) * daysFromEpoch);
}

/**
 * 自转角度（弧度）：给定 J2000 历元后天数与自转周期
 *
 * 负周期表示逆向自转（金星 −5832.5h、天王星 −17.24h），
 * 返回值为绕自转轴（北极方向）的累计角度，可为负。
 */
export function rotationAngleAtTime(siderealPeriodHours: number, daysFromEpoch: number): number {
  if (siderealPeriodHours === 0) {
    throw new RangeError('自转周期不能为 0');
  }
  const periodDays = siderealPeriodHours / 24;
  return ((Math.PI * 2) / periodDays) * daysFromEpoch;
}
