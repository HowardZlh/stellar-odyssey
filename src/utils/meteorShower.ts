/**
 * 盛夏双重流星雨实验室：物理纯函数层（M1，契约 C1）
 *
 * 全部业务逻辑下沉本模块（页面组件 M2/M3/M4 只消费不改签名）：
 * - 坐标族：LST 简化模型 / 赤道→地平 / 地平→场景方向 / 赤道→地平旋转矩阵
 * - 流量族：ZHR→可见小时率（§1.4）/ 小时率→shader 门控分数
 * - 烧蚀族：流星体烧蚀 ODE 的 RK4 求解（§1.1）/ 过原点三次多项式最小二乘拟合
 * - 调度族：槽位元数据生成（契约 C2 三独立随机属性）/ 点燃检查 CPU 镜像（供 M4 音频）
 * - 降级判定：labQualityTier（§4.5）
 *
 * 场景空间与坐标系约定（契约 C5，防东西镜像）：
 * - 1 场景单位 = 1 km（独立比例尺，与主场景 SCENE_UNITS_PER_AU 无关）
 * - +Y = 天顶、−Z = 正北、+X = 正东；方位角 Az 从北起经东量（N=0°，E=90°）
 *
 * 物理近似登记（需求 §1）：
 * - LST 简化模型：观测者经度不作输入（"当地时间"抽象化），
 *   LST(t) = LST₀ + 15.041°×(hourOffset + elapsedHours)，LST₀ 为各历元常量
 *   （由"太阳赤经 + 12h + 当地时刻"近似预算）
 * - 大气密度指数衰减 ρ_a(h) = ρ₀·e^(−h/H)，标高 H≈8.5 km（80–120 km 层近似）
 * - 烘焙轨迹用固定入射天顶角 45°（实际辐射点高度随时变，系数已烘焙）
 * - 忽略天顶吸引与辐射点周日漂移
 *
 * 单位红线（§1.1）：ODE 在 SI（m、s）中求解，拟合前位移换算为场景单位（km）。
 *
 * 数据来源：辐射点/入速/ZHR/r 取自 IAU Meteor Data Center（Perseids #7 PER、
 * kappa-Cygnids #12 KCG）。
 *
 * 硬性约束：本模块不 import React/three；RK4 与拟合只在初始化路径被调用
 * （M3 页签切换时一次性重建，契约 C2.1），函数无状态、可重入。
 */

import { createSeededRandom } from '@/utils/random';

// ---------------------------------------------------------------------------
// 常量：场景空间（契约 C5）
// ---------------------------------------------------------------------------

/** 1 场景单位 = 1 km（契约 C5） */
export const LAB_SCENE_UNITS_PER_KM = 1;

/** 星穹天球半径（场景单位） */
export const STAR_DOME_RADIUS_UNITS = 3000;

/** 燃烧层底部高度（km = 场景单位） */
export const BURN_LAYER_BOTTOM_KM = 80;

/** 燃烧层顶部高度（km = 场景单位，流星入射起点高度） */
export const BURN_LAYER_TOP_KM = 115;

/** 燃烧层水平采样半径（km，需求 §2） */
export const BURN_LAYER_HORIZONTAL_RADIUS_KM = 300;

/** 相机漫游半径下限（场景单位） */
export const CAMERA_RADIUS_MIN_UNITS = 0.1;

/** 相机漫游半径上限（场景单位） */
export const CAMERA_RADIUS_MAX_UNITS = 1.5;

/** 槽位循环周期（秒，契约 C2 默认常量 uCyclePeriod） */
export const METEOR_CYCLE_PERIOD_SEC = 60;

/** 条痕时间跨度（秒，契约 C2 默认常量 uLagSpan） */
export const METEOR_LAG_SPAN_SEC = 0.15;

/** 默认观测纬度（度，§1.3） */
export const DEFAULT_OBSERVER_LAT_DEG = 40;

// ---------------------------------------------------------------------------
// 常量：双流星雨参数（IAU Meteor Data Center；§1.2 / §1.3）
// ---------------------------------------------------------------------------

export interface MeteorShowerParams {
  /** 标识（'perseids' | 'kappaCygnids'） */
  id: 'perseids' | 'kappaCygnids';
  /** 辐射点赤经（度，J2000） */
  radiantRaDeg: number;
  /** 辐射点赤纬（度，J2000） */
  radiantDecDeg: number;
  /** 大气入射速度（km/s） */
  entrySpeedKmPerSec: number;
  /** 天顶每时率 ZHR（极大期） */
  zhr: number;
  /** 星族指数 r（population index） */
  populationIndex: number;
  /** 初始历元本地恒星时 LST₀（度，§1.3 简化模型常量） */
  epochLst0Deg: number;
  /** 火流星槽位基础比例（天鹅座κ以慢速火流星著称 → 基数更高，§3 控件 6） */
  fireballSlotFraction: number;
}

/**
 * 英仙座流星雨（Perseids，IAU MDC #7 PER；母体 109P/Swift-Tuttle）
 * 历元 2026-08-13 当地 02:00，LST₀≈353.5°（此时辐射点 Alt≈52°，单测锚点）
 */
export const PERSEIDS: MeteorShowerParams = {
  id: 'perseids',
  radiantRaDeg: 46,
  radiantDecDeg: 58,
  entrySpeedKmPerSec: 59,
  zhr: 100,
  populationIndex: 2.2,
  epochLst0Deg: 353.5,
  fireballSlotFraction: 0.1,
};

/**
 * 天鹅座κ流星雨（kappa-Cygnids，IAU MDC #12 KCG；母体未确定）
 * 历元 2026-08-17 当地 23:00，LST₀≈310°（此时辐射点 Alt≈66°，单测锚点）
 */
export const KAPPA_CYGNIDS: MeteorShowerParams = {
  id: 'kappaCygnids',
  radiantRaDeg: 286,
  radiantDecDeg: 59,
  entrySpeedKmPerSec: 25,
  zhr: 3,
  populationIndex: 3.0,
  epochLst0Deg: 310,
  fireballSlotFraction: 0.25,
};

// ---------------------------------------------------------------------------
// 坐标族（§1.3，契约 C5）
// ---------------------------------------------------------------------------

const DEG = Math.PI / 180;
const TWO_PI = Math.PI * 2;

/** 恒星时速率：每平太阳小时 15.041°（§1.3 简化模型） */
const SIDEREAL_DEG_PER_HOUR = 15.041;

/** 归一化角度到 [0, 2π) */
function normalizeRad(rad: number): number {
  const r = rad % TWO_PI;
  return r < 0 ? r + TWO_PI : r;
}

/**
 * 本地恒星时（简化模型，§1.3）：LST = LST₀ + 15.041°×(hourOffset + elapsedHours)
 *
 * 观测者经度不作输入（"当地时间"抽象化，登记简化）。
 *
 * @param epochLst0Deg 历元起点本地恒星时常量（度，见 PERSEIDS/KAPPA_CYGNIDS）
 * @param hourOffset 地方时偏移控件（小时，[-6, +6]）
 * @param elapsedHours 场景内推进时长（小时，timeScale 放大后的累计值）
 * @returns LST（弧度，[0, 2π)）
 */
export function localSiderealTime(
  epochLst0Deg: number,
  hourOffset: number,
  elapsedHours: number
): number {
  return normalizeRad((epochLst0Deg + SIDEREAL_DEG_PER_HOUR * (hourOffset + elapsedHours)) * DEG);
}

export interface AltAz {
  /** 高度角（弧度，地平以上为正） */
  altRad: number;
  /** 方位角（弧度，[0, 2π)，北起经东：N=0，E=π/2） */
  azRad: number;
}

/**
 * 赤道坐标 → 地平坐标（§1.3）
 *
 * sin(Alt) = sinδ·sinφ + cosδ·cosφ·cos(H)，H = LST − RA；
 * Az 用 atan2 处理象限，惯例北起经东（N=0°，E=90°）。
 */
export function horizontalFromEquatorial(
  raDeg: number,
  decDeg: number,
  latDeg: number,
  lstRad: number
): AltAz {
  const dec = decDeg * DEG;
  const lat = latDeg * DEG;
  const hourAngle = lstRad - raDeg * DEG;
  const sinAlt =
    Math.sin(dec) * Math.sin(lat) + Math.cos(dec) * Math.cos(lat) * Math.cos(hourAngle);
  const altRad = Math.asin(Math.min(1, Math.max(-1, sinAlt)));
  // cos(Alt)·sin(Az) = −cosδ·sin(H)；cos(Alt)·cos(Az) = sinδ·cosφ − cosδ·sinφ·cos(H)
  const azRad = normalizeRad(
    Math.atan2(
      -Math.cos(dec) * Math.sin(hourAngle),
      Math.sin(dec) * Math.cos(lat) - Math.cos(dec) * Math.sin(lat) * Math.cos(hourAngle)
    )
  );
  return { altRad, azRad };
}

/**
 * 地平坐标 → 场景方向单位向量（契约 C5 轴向：+Y 天顶、−Z 正北、+X 正东）
 *
 * 锚点：Az=90°/Alt=0° → [1, 0, 0]（正东，单测锁定防东西镜像）。
 */
export function sceneDirFromAltAz(altAz: AltAz): [number, number, number] {
  const cosAlt = Math.cos(altAz.altRad);
  return [
    cosAlt * Math.sin(altAz.azRad),
    Math.sin(altAz.altRad),
    -cosAlt * Math.cos(altAz.azRad),
  ];
}

/**
 * 赤道系 → 场景地平系旋转矩阵（供 M2 星穹 shader，行主序 3×3 展平数组）
 *
 * 输入赤道单位向量约定：xe = cosδ·cosα，ye = cosδ·sinα，ze = sinδ。
 * scene = M · equatorial，与 sceneDirFromAltAz(horizontalFromEquatorial(...)) 等价
 * （单测交叉锁定）。行主序可直接喂 THREE.Matrix3.set(...m)。
 */
export function equatorialToHorizontalMatrix(
  latDeg: number,
  lstRad: number
): [number, number, number, number, number, number, number, number, number] {
  const lat = latDeg * DEG;
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const sinLst = Math.sin(lstRad);
  const cosLst = Math.cos(lstRad);
  // 推导：east = −cosδ·sinH、up = sinAlt、north = cosAlt·cosAz 展开到赤道分量
  // scene.x = east，scene.y = up，scene.z = −north
  return [
    -sinLst,
    cosLst,
    0,
    cosLat * cosLst,
    cosLat * sinLst,
    sinLat,
    sinLat * cosLst,
    sinLat * sinLst,
    -cosLat,
  ];
}

/** 赤道坐标（度）→ 赤道系单位向量（xe = cosδ·cosα 约定，供矩阵消费侧生成 attribute） */
export function equatorialUnitVector(raDeg: number, decDeg: number): [number, number, number] {
  const ra = raDeg * DEG;
  const dec = decDeg * DEG;
  const cosDec = Math.cos(dec);
  return [cosDec * Math.cos(ra), cosDec * Math.sin(ra), Math.sin(dec)];
}

// ---------------------------------------------------------------------------
// 流量族（§1.4）
// ---------------------------------------------------------------------------

/**
 * ZHR → 可见小时率（§1.4）：HR = ZHR·sin(Alt_radiant) / r^(6.5−lm)
 *
 * Alt ≤ 0 时流量为零；是 sin(Alt) 不是线性。
 * lm 同时驱动恒星剔除与流量压低（同一物理参数，自洽联动）；
 * 登记简化：lm 只压低流星数量，不对单颗流星做亮度剔除。
 */
export function visibleHourlyRate(
  zhr: number,
  populationIndex: number,
  radiantAltRad: number,
  limitingMag: number
): number {
  if (radiantAltRad <= 0) return 0;
  return (zhr * Math.sin(radiantAltRad)) / populationIndex ** (6.5 - limitingMag);
}

/**
 * 小时率 → shader 流量门控分数（§1.4 显式公式）：
 * uFluxFraction = clamp(HR/3600 × cyclePeriod / slotCount, 0, 1)
 *
 * 每槽位每周期点燃一次，"每秒流星数 × 周期 ÷ 槽位数"即激活比例。
 * timeScale 经放大 uTime 自然放大出现频率，本公式不重复乘。
 */
export function fluxFraction(
  hourlyRate: number,
  slotCount: number,
  cyclePeriodSec: number
): number {
  if (!(slotCount > 0) || !(cyclePeriodSec > 0)) {
    throw new RangeError(`槽位数与周期必须为正，收到 slotCount=${slotCount}, cyclePeriod=${cyclePeriodSec}`);
  }
  return Math.min(1, Math.max(0, ((hourlyRate / 3600) * cyclePeriodSec) / slotCount));
}

// ---------------------------------------------------------------------------
// 烧蚀族（§1.1）：RK4 求解 + 过原点三次拟合
// ---------------------------------------------------------------------------

/** 阻力系数 Γ（§1.1） */
export const ABLATION_GAMMA = 1.0;

/** 热传导系数 Λ（§1.1） */
export const ABLATION_LAMBDA = 0.1;

/** 汽化潜热 Q = 6×10⁶ J/kg（§1.1） */
export const ABLATION_HEAT_OF_VAPORIZATION = 6e6;

/** 海平面大气密度 ρ₀ = 1.225 kg/m³（§1.1） */
export const AIR_DENSITY_SEA_LEVEL = 1.225;

/** 大气标高 H ≈ 8.5 km（80–120 km 层近似，登记） */
export const ATMOSPHERE_SCALE_HEIGHT_KM = 8.5;

/** 流星体密度 1000 kg/m³（彗星质地，球形截面） */
export const METEOROID_DENSITY = 1000;

/** 固定入射天顶角 45°（烘焙近似，登记） */
export const ENTRY_ZENITH_ANGLE_RAD = Math.PI / 4;

/** 普通流星质量对数均匀采样范围（kg） */
export const MASS_RANGE_ORDINARY_KG: [number, number] = [1e-6, 1e-3];

/** 火流星质量对数均匀采样范围（kg） */
export const MASS_RANGE_FIREBALL_KG: [number, number] = [1e-2, 1];

export interface AblationParams {
  /** 流星体初始质量（kg） */
  massKg: number;
  /** 大气入射速度（km/s） */
  entrySpeedKmPerSec: number;
  /** 求解时长（秒，默认 1 s 寿命） */
  durationSec?: number;
  /** RK4 步数（默认 200） */
  steps?: number;
}

export interface AblationCurves {
  /** 采样时刻（秒，含 t=0） */
  ts: number[];
  /** 沿入射方向累计位移（场景单位 km——SI 求解后换算，单位红线） */
  sKm: number[];
  /** 速度采样（km/s，单调递减） */
  vKmPerSec: number[];
  /** 发光强度 I ∝ ρ_a·v⁵，按峰值归一（峰值 = 1；§1.1） */
  intensity: number[];
  /** 强度峰值时刻（秒） */
  peakTimeSec: number;
}

/** 大气密度（kg/m³），h 为海拔 km：ρ_a = ρ₀·e^(−h/H) */
export function airDensityAtKm(heightKm: number): number {
  return AIR_DENSITY_SEA_LEVEL * Math.exp(-heightKm / ATMOSPHERE_SCALE_HEIGHT_KM);
}

/** 球形流星体迎风截面积（m²）：由当前质量与密度导出 */
function crossSectionArea(massKg: number): number {
  const radius = Math.cbrt((3 * massKg) / (4 * Math.PI * METEOROID_DENSITY));
  return Math.PI * radius * radius;
}

/**
 * 流星体烧蚀 ODE 的 RK4 求解（§1.1，初始化路径专用——禁止 useFrame 内调用）
 *
 * dv/dt = −Γ·ρ_a·A/m·v²；dm/dt = −Λ·ρ_a·A/(2Q)·v³；ds/dt = v。
 * 高度换算 h(t) = 115 km − s·cos45°（固定天顶角烘焙近似）。
 * 质量烧尽（< 初始 0.1%）后冻结（v=0、强度=0）。
 *
 * 单位红线：状态量以 SI（m、s、kg）积分，返回值换算为 km（场景单位）。
 */
export function solveAblationRK4(params: AblationParams): AblationCurves {
  const { massKg, entrySpeedKmPerSec } = params;
  const durationSec = params.durationSec ?? 1;
  const steps = params.steps ?? 200;
  if (!(massKg > 0) || !(entrySpeedKmPerSec > 0)) {
    throw new RangeError(`质量与入速必须为正，收到 m=${massKg}, v=${entrySpeedKmPerSec}`);
  }
  if (!(durationSec > 0) || !Number.isInteger(steps) || steps < 2) {
    throw new RangeError(`时长必须为正且步数为 ≥2 的整数，收到 T=${durationSec}, steps=${steps}`);
  }

  const dt = durationSec / steps;
  const massFloor = massKg * 1e-3; // 烧尽阈值：初始质量 0.1%
  const cosZenith = Math.cos(ENTRY_ZENITH_ANGLE_RAD);

  // 状态 [v(m/s), m(kg), s(m)]；导数在 SI 中计算
  type State = [number, number, number];
  const derivative = (state: State): State => {
    const [v, m] = state;
    if (m <= massFloor || v <= 0) return [0, 0, 0];
    const heightKm = BURN_LAYER_TOP_KM - (state[2] / 1000) * cosZenith;
    const rhoA = airDensityAtKm(heightKm);
    const area = crossSectionArea(m);
    return [
      (-ABLATION_GAMMA * rhoA * area * v * v) / m,
      (-ABLATION_LAMBDA * rhoA * area * v * v * v) / (2 * ABLATION_HEAT_OF_VAPORIZATION),
      v,
    ];
  };

  let state: State = [entrySpeedKmPerSec * 1000, massKg, 0];
  const ts: number[] = [0];
  const sKm: number[] = [0];
  const vKmPerSec: number[] = [state[0] / 1000];
  const rawIntensity: number[] = [airDensityAtKm(BURN_LAYER_TOP_KM) * state[0] ** 5];

  for (let i = 1; i <= steps; i++) {
    const k1 = derivative(state);
    const mid1: State = [
      state[0] + (dt / 2) * k1[0],
      state[1] + (dt / 2) * k1[1],
      state[2] + (dt / 2) * k1[2],
    ];
    const k2 = derivative(mid1);
    const mid2: State = [
      state[0] + (dt / 2) * k2[0],
      state[1] + (dt / 2) * k2[1],
      state[2] + (dt / 2) * k2[2],
    ];
    const k3 = derivative(mid2);
    const end: State = [state[0] + dt * k3[0], state[1] + dt * k3[1], state[2] + dt * k3[2]];
    const k4 = derivative(end);
    state = [
      state[0] + (dt / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]),
      state[1] + (dt / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]),
      state[2] + (dt / 6) * (k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2]),
    ];
    // 数值防御：速度/质量不为负
    if (state[0] < 0) state[0] = 0;
    if (state[1] < massFloor) state[1] = massFloor;

    const t = i * dt;
    const burnedOut = state[1] <= massFloor || state[0] <= 0;
    const heightKm = BURN_LAYER_TOP_KM - (state[2] / 1000) * cosZenith;
    ts.push(t);
    sKm.push(state[2] / 1000); // 单位红线：m → km（场景单位）
    vKmPerSec.push(burnedOut ? 0 : state[0] / 1000);
    rawIntensity.push(burnedOut ? 0 : airDensityAtKm(heightKm) * state[0] ** 5);
  }

  // 强度按峰值归一（每槽位峰值 = 1，槽位间亮度差异由质量映射与 HDR 因子表达）
  let peak = 0;
  let peakIndex = 0;
  for (let i = 0; i < rawIntensity.length; i++) {
    if (rawIntensity[i] > peak) {
      peak = rawIntensity[i];
      peakIndex = i;
    }
  }
  const intensity = rawIntensity.map((raw) => (peak > 0 ? raw / peak : 0));
  return { ts, sKm, vKmPerSec, intensity, peakTimeSec: ts[peakIndex] };
}

/**
 * 烧蚀曲线截断到有效发光窗口（峰值后强度 < threshold 处）
 *
 * 动机（登记设计差异）：小质量流星在 1 s 窗口内提前烧尽，强度曲线带长零尾，
 * 三次式无法兼顾"指数增亮 + 骤灭 + 零尾"；截断后寿命 = 有效发光窗口，
 * 拟合质量显著改善（RMS ≤ 0.2）。骤灭的陡峭尾沿由 shader 首尾
 * smoothstep 抗锯齿因子叠乘表达（§1.1 明示允许）。
 * 大质量火流星在窗口内未烧尽则原样返回（终端爆发在寿命末端，符合物理）。
 */
export function truncateAblationCurves(curves: AblationCurves, threshold = 0.02): AblationCurves {
  if (!(threshold > 0 && threshold < 1)) {
    throw new RangeError(`截断阈值必须在 (0,1)，收到 ${threshold}`);
  }
  const peakIndex = curves.intensity.indexOf(Math.max(...curves.intensity));
  let end = curves.ts.length - 1;
  for (let i = peakIndex; i < curves.intensity.length; i++) {
    if (curves.intensity[i] < threshold) {
      end = i;
      break;
    }
  }
  if (end === curves.ts.length - 1) return curves;
  return {
    ts: curves.ts.slice(0, end + 1),
    sKm: curves.sKm.slice(0, end + 1),
    vKmPerSec: curves.vKmPerSec.slice(0, end + 1),
    intensity: curves.intensity.slice(0, end + 1),
    peakTimeSec: curves.peakTimeSec,
  };
}

/**
 * 过原点三次多项式最小二乘拟合（c₀ = 0）：y ≈ c₁t + c₂t² + c₃t³
 *
 * 正规方程 3×3，高斯消元（部分主元）。供位移曲线 s(t) 与强度曲线 I(t)
 * 烘焙为 shader attribute（aDispCoefs / aIntenCoefs）。
 *
 * @returns [c₁, c₂, c₃]
 */
export function fitCubicThroughOrigin(
  ts: readonly number[],
  ys: readonly number[]
): [number, number, number] {
  if (ts.length !== ys.length || ts.length < 3) {
    throw new RangeError(`样本长度需一致且 ≥3，收到 ts=${ts.length}, ys=${ys.length}`);
  }
  // 正规方程：A·c = b，A[i][j] = Σ t^(i+j+2)，b[i] = Σ y·t^(i+1)
  const a = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const b = [0, 0, 0];
  for (let k = 0; k < ts.length; k++) {
    const t = ts[k];
    const powers = [t, t * t, t * t * t];
    for (let i = 0; i < 3; i++) {
      b[i] += ys[k] * powers[i];
      for (let j = 0; j < 3; j++) {
        a[i][j] += powers[i] * powers[j];
      }
    }
  }
  // 高斯消元（部分主元）
  for (let col = 0; col < 3; col++) {
    let pivot = col;
    for (let row = col + 1; row < 3; row++) {
      if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    }
    if (Math.abs(a[pivot][col]) < 1e-30) {
      throw new RangeError('正规方程奇异（样本 t 取值退化）');
    }
    if (pivot !== col) {
      [a[col], a[pivot]] = [a[pivot], a[col]];
      [b[col], b[pivot]] = [b[pivot], b[col]];
    }
    for (let row = col + 1; row < 3; row++) {
      const factor = a[row][col] / a[col][col];
      for (let j = col; j < 3; j++) a[row][j] -= factor * a[col][j];
      b[row] -= factor * b[col];
    }
  }
  const c3 = b[2] / a[2][2];
  const c2 = (b[1] - a[1][2] * c3) / a[1][1];
  const c1 = (b[0] - a[0][1] * c2 - a[0][2] * c3) / a[0][0];
  return [c1, c2, c3];
}

/** 三次多项式（c₀=0）求值：c₁t + c₂t² + c₃t³（shader O(1) 求值的 CPU 镜像） */
export function evalCubic(coefs: readonly [number, number, number], t: number): number {
  return coefs[0] * t + coefs[1] * t * t + coefs[2] * t * t * t;
}

// ---------------------------------------------------------------------------
// 调度族（契约 C2）：槽位元数据生成 + 点燃检查 CPU 镜像
// ---------------------------------------------------------------------------

export interface MeteorSlot {
  /** 循环相位随机数（shader：fract(aSeed + uTime/uCyclePeriod)） */
  aSeed: number;
  /** 流量门控随机数（shader：aGateRank < uFluxFraction；与 aSeed 独立，契约 C2 反耦合） */
  aGateRank: number;
  /** 火流星门控随机数（shader：aFireballRank < uFireballFraction；独立随机数） */
  aFireballRank: number;
  /** 火流星身份（烘焙期固定，带火流星质量档拟合系数，§4.2） */
  isFireball: boolean;
  /** 入射起点（场景单位；y = 115 燃烧层顶，水平圆盘内均匀采样） */
  startPos: [number, number, number];
  /** 单次点燃寿命（秒，= 截断后的有效发光窗口，拟合窗与之一致） */
  lifetimeSec: number;
  /** 烘焙质量（kg，对数均匀采样） */
  massKg: number;
  /** 位移曲线拟合系数 [c₁,c₂,c₃]（场景单位 km，aDispCoefs） */
  dispCoefs: [number, number, number];
  /** 强度曲线拟合系数 [c₁,c₂,c₃]（峰值归一，aIntenCoefs） */
  intenCoefs: [number, number, number];
}

/**
 * 一次性生成 N 槽位元数据（初始化/页签切换路径，契约 C2.1）
 *
 * 契约 C2 反耦合红线：aSeed / aGateRank / aFireballRank 是三个独立随机数——
 * 若复用同一随机数，门控分数小时被激活槽位的相位会集中在 [0, frac) 区间，
 * 流星将每周期挤成一团爆发（已识别设计陷阱，单测锁定独立性）。
 *
 * @param seed 确定性种子（createSeededRandom，全项目粒子系统统一）
 * @param count 槽位数（M3 全量 200+，reduced 档减半）
 * @param shower 流星雨参数（入速决定拟合系数——页签切换必须重建）
 */
export function makeMeteorSlots(
  seed: number,
  count: number,
  shower: MeteorShowerParams
): MeteorSlot[] {
  if (!Number.isInteger(count) || count < 1) {
    throw new RangeError(`槽位数必须为正整数，收到 ${count}`);
  }
  const rand = createSeededRandom(seed);
  const slots: MeteorSlot[] = [];
  for (let i = 0; i < count; i++) {
    // 三个独立随机数（契约 C2：禁止复用）
    const aSeed = rand();
    const aGateRank = rand();
    const aFireballRank = rand();
    const isFireball = rand() < shower.fireballSlotFraction;

    // 质量对数均匀采样（§1.1）
    const [massLo, massHi] = isFireball ? MASS_RANGE_FIREBALL_KG : MASS_RANGE_ORDINARY_KG;
    const massKg = 10 ** (Math.log10(massLo) + rand() * (Math.log10(massHi) - Math.log10(massLo)));

    // 入射起点：燃烧层顶 y=115，水平圆盘内均匀采样（√r 保证面积均匀）
    const theta = rand() * TWO_PI;
    const radius = BURN_LAYER_HORIZONTAL_RADIUS_KM * Math.sqrt(rand());
    const startPos: [number, number, number] = [
      radius * Math.cos(theta),
      BURN_LAYER_TOP_KM,
      radius * Math.sin(theta),
    ];

    // 求解窗：1 s 基准 ±20%（视觉多样性）
    const solveWindowSec = 0.8 + rand() * 0.4;

    // RK4 + 截断到有效发光窗口 + 双曲线拟合（初始化路径专用，§1.1 实现降维控制）
    const curves = truncateAblationCurves(
      solveAblationRK4({
        massKg,
        entrySpeedKmPerSec: shower.entrySpeedKmPerSec,
        durationSec: solveWindowSec,
      })
    );
    const lifetimeSec = curves.ts[curves.ts.length - 1];
    const dispCoefs = fitCubicThroughOrigin(curves.ts, curves.sKm);
    const intenCoefs = fitCubicThroughOrigin(curves.ts, curves.intensity);

    slots.push({
      aSeed,
      aGateRank,
      aFireballRank,
      isFireball,
      startPos,
      lifetimeSec,
      massKg,
      dispCoefs,
      intenCoefs,
    });
  }
  return slots;
}

/**
 * 本帧点燃槽位检查（shader 循环公式的 CPU 镜像，契约 C2；供 M4 音频触发）
 *
 * 与 shader 严格同式：相位 fract(aSeed + t/T)、门控 aGateRank < uFluxFraction。
 * 槽位在相位回绕（floor(aSeed + t/T) 递增）瞬间点燃；本函数返回
 * (prevTime, currTime] 内点燃且通过流量门控的槽位下标。
 *
 * @param prevTimeSec 上一帧 uTime（秒，timeScale 放大后）
 * @param currTimeSec 本帧 uTime（秒）
 * @param slots 槽位数组（makeMeteorSlots 产物）
 * @param fluxFrac 流量门控分数（fluxFraction 产物）
 * @param cyclePeriodSec 循环周期（默认 METEOR_CYCLE_PERIOD_SEC）
 */
export function ignitedSlots(
  prevTimeSec: number,
  currTimeSec: number,
  slots: readonly MeteorSlot[],
  fluxFrac: number,
  cyclePeriodSec: number = METEOR_CYCLE_PERIOD_SEC
): number[] {
  if (!(cyclePeriodSec > 0)) {
    throw new RangeError(`循环周期必须为正，收到 ${cyclePeriodSec}`);
  }
  if (currTimeSec < prevTimeSec) {
    throw new RangeError(`时间必须单调，收到 prev=${prevTimeSec} > curr=${currTimeSec}`);
  }
  const ignited: number[] = [];
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    if (slot.aGateRank >= fluxFrac) continue; // 门控用 aGateRank（非 aSeed，契约 C2）
    const prevCycle = Math.floor(slot.aSeed + prevTimeSec / cyclePeriodSec);
    const currCycle = Math.floor(slot.aSeed + currTimeSec / cyclePeriodSec);
    if (currCycle > prevCycle) ignited.push(i);
  }
  return ignited;
}

/** 循环相位（shader fract(aSeed + t/T) 的 CPU 镜像，供测试与 M4 消费） */
export function slotPhase(aSeed: number, timeSec: number, cyclePeriodSec: number): number {
  const x = aSeed + timeSec / cyclePeriodSec;
  return x - Math.floor(x);
}

// ---------------------------------------------------------------------------
// 降级判定（§4.5）
// ---------------------------------------------------------------------------

export interface LabQualityEnv {
  /** window.devicePixelRatio */
  dpr: number;
  /** navigator.userAgent */
  userAgent: string;
  /** screen.width（CSS px） */
  screenWidth: number;
  /** screen.height（CSS px） */
  screenHeight: number;
  /** navigator.deviceMemory（GB，可能缺失） */
  deviceMemoryGb?: number;
}

export type LabQualityTier = 'full' | 'reduced';

/**
 * 实验室画质档判定（§4.5，参数注入便于测试）
 *
 * 启发式（任一命中即 reduced）：
 * - UA 含移动端标识（Android/iPhone/iPad/iPod/Mobile）
 * - 屏幕短边 < 768 CSS px（小屏设备）
 * - deviceMemory ≤ 4 GB（低内存设备，缺失时不参与判定）
 * - DPR ≥ 3 且屏幕短边 < 1024（高密度小屏，像素总量爆炸）
 */
export function labQualityTier(env: LabQualityEnv): LabQualityTier {
  const shortSide = Math.min(env.screenWidth, env.screenHeight);
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(env.userAgent)) return 'reduced';
  if (shortSide < 768) return 'reduced';
  if (env.deviceMemoryGb !== undefined && env.deviceMemoryGb <= 4) return 'reduced';
  if (env.dpr >= 3 && shortSide < 1024) return 'reduced';
  return 'full';
}
