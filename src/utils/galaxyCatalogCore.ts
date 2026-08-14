/**
 * R5-3 真实巡天目录核心纯函数（烘焙脚本与运行时共用，方案 G）
 *
 * 数据源：2MASS Redshift Survey（2MRS，Huchra et al. 2012, ApJS 199, 26；
 * VizieR J/ApJS/199/26/table3，公开科学数据，引用登记见
 * scripts/bake-data/galaxyCatalog.ts 与快照 meta）。
 *
 * 坐标链：赤道 J2000（ra/dec）→ 银道（IAU 1958 / J2000 标准旋转矩阵，
 * Hipparcos 文档数值）→ 超星系（de Vaucouleurs：SG 北极位于银道
 * l=47.37° b=+6.32°，SG 经度零点位于 l=137.37° b=0°）→ 超星系笛卡尔
 * 单位矢量 ×哈勃流距离。
 *
 * 失真登记（§R5-3 三项，附录 A §3——不得默称"完全真实"）：
 * 1. 红移距离 = cz/H₀ 哈勃流近似：本动速度（~数百 km/s）污染视向速度，
 *    星系团内呈"指状效应"（Fingers of God，团沿视线方向被拉长）；
 * 2. 近距误差：cz ≲ 1,000 km/s 时本动速度与哈勃流同量级，距离分数误差
 *    可达数十%（cz < CZ_MIN_KM_S 条目直接剔除）；
 * 3. 银道遮挡带（Zone of Avoidance）：2MRS 排除 |b| < 5°（银心方向 8°）
 *    ——银道面附近的"空带"是尘埃消光的观测限制，并非真实空洞。
 *
 * H₀ = 70 km/s/Mpc（登记：与 utils/universe.HUBBLE_H0_PER_MYR ≈
 * 7.16e-5/Myr（即 70 km/s/Mpc，Planck 2018 / SH0ES 折中）同源取值）。
 */

import type { Vec3 } from '@/types';

/** 哈勃常数（km/s/Mpc；与 utils/universe.HUBBLE_H0_PER_MYR 同源登记） */
export const H0_KM_S_MPC = 70;

/** 1 Mpc 的光年数（PARSEC_LY = 3.26156 ly/pc × 1e6） */
export const LY_PER_MPC = 3.26156e6;

/** 近距剔除阈值（km/s）：cz 低于此值哈勃流距离误差过大（失真登记第 2 项） */
export const CZ_MIN_KM_S = 100;

/** 目录距离上界（Mpc）：2MRS cz ≤ ~52,000 km/s → ≤ ~745 Mpc（校验裕量） */
export const CATALOG_MAX_DISTANCE_MPC = 800;

/** 2MRS K_s 星等域（Huchra et al. 2012：Ks ≤ 11.75 完备极限） */
export const KMAG_BRIGHT = 4.0;
export const KMAG_FAINT = 11.75;

/** 形态档（打包进 w 通道）：0 = 早型（椭圆/透镜，T ≤ 0），1 = 晚型（旋涡/不规则，1 ≤ T ≤ 19），2 = 未知（T ≥ 20 或不可解析） */
export type MorphTier = 0 | 1 | 2;

/**
 * J−K 色指数量化区间（SC3，烘焙与消费同源常量）：
 * 2MRS Jcmag−Kcmag 实际分布 P1–P99（快照 snapshots/2mrs-vizier.csv.gz 全量
 * 有效行实测 P1 = 0.787 / P50 = 0.988 / P99 = 1.307，取整登记；
 * Huchra et al. 2012, ApJS 199, 26——早型星系 J−K ≈ 0.9–1.0 偏红、
 * 晚型偏蓝，§0.3 登记）；区间外线性钳制。
 */
export const JK_QUANT_P01 = 0.79;
export const JK_QUANT_P99 = 1.31;

/** J−K 量化档上界：0–98 为有效量化区（99 档），99 保留为缺失未知档 */
export const JK_QUANT_MAX_TIER = 98;
export const JK_TIER_UNKNOWN = 99;

/**
 * J/K 星等 → J−K 量化档（SC3）：0 = 最蓝（≤ P1）、98 = 最红（≥ P99）、
 * 99 = J 星等缺失未知档（消费侧回退形态档 3 色，旧行为即回退路径）
 */
export function jkTierFromColor(jMag: number, kMag: number): number {
  if (!Number.isFinite(jMag) || !Number.isFinite(kMag)) return JK_TIER_UNKNOWN;
  const t = (jMag - kMag - JK_QUANT_P01) / (JK_QUANT_P99 - JK_QUANT_P01);
  return Math.round(Math.min(1, Math.max(0, t)) * JK_QUANT_MAX_TIER);
}

const DEG = Math.PI / 180;

// ---------------------------------------------------------------------------
// 坐标旋转（赤道 J2000 → 银道 → 超星系）
// ---------------------------------------------------------------------------

/**
 * 赤道 J2000 → 银道旋转矩阵（行主序；Hipparcos 文档标准数值，
 * ESA 1997, SP-1200 Vol.1 §1.5.3）
 */
const EQ_TO_GAL: readonly number[] = [
  -0.0548755604, -0.8734370902, -0.4838350155,
  0.4941094279, -0.4448296300, 0.7469822445,
  -0.8676661490, -0.1980763734, 0.4559837762,
];

/** 超星系北极（银道坐标，de Vaucouleurs） */
const SG_POLE_L_DEG = 47.37;
const SG_POLE_B_DEG = 6.32;
/** 超星系经度零点方向（银道坐标） */
const SG_ORIGIN_L_DEG = 137.37;

/** 银道经纬 → 银道笛卡尔单位矢量 */
function galacticUnit(lDeg: number, bDeg: number): Vec3 {
  const l = lDeg * DEG;
  const b = bDeg * DEG;
  return { x: Math.cos(b) * Math.cos(l), y: Math.cos(b) * Math.sin(l), z: Math.sin(b) };
}

/** 银道 → 超星系旋转矩阵（行 = SG x/y/z 轴在银道系中的方向；模块加载时构建一次） */
const GAL_TO_SG: readonly number[] = (() => {
  const zAxis = galacticUnit(SG_POLE_L_DEG, SG_POLE_B_DEG);
  const xRaw = galacticUnit(SG_ORIGIN_L_DEG, 0);
  // x 轴取零点方向对极轴的正交化（数值上本就近正交，正交化消残差）
  const dot = xRaw.x * zAxis.x + xRaw.y * zAxis.y + xRaw.z * zAxis.z;
  const xv = { x: xRaw.x - dot * zAxis.x, y: xRaw.y - dot * zAxis.y, z: xRaw.z - dot * zAxis.z };
  const xLen = Math.hypot(xv.x, xv.y, xv.z);
  const xAxis = { x: xv.x / xLen, y: xv.y / xLen, z: xv.z / xLen };
  // y = z × x（右手系）
  const yAxis = {
    x: zAxis.y * xAxis.z - zAxis.z * xAxis.y,
    y: zAxis.z * xAxis.x - zAxis.x * xAxis.z,
    z: zAxis.x * xAxis.y - zAxis.y * xAxis.x,
  };
  return [xAxis.x, xAxis.y, xAxis.z, yAxis.x, yAxis.y, yAxis.z, zAxis.x, zAxis.y, zAxis.z];
})();

function applyMat3(m: readonly number[], v: Vec3): Vec3 {
  return {
    x: m[0] * v.x + m[1] * v.y + m[2] * v.z,
    y: m[3] * v.x + m[4] * v.y + m[5] * v.z,
    z: m[6] * v.x + m[7] * v.y + m[8] * v.z,
  };
}

/**
 * 赤道 J2000 ra/dec（度）→ 赤道笛卡尔单位矢量
 * @throws RangeError ra/dec 非有限或 dec 越界
 */
export function equatorialUnit(raDeg: number, decDeg: number): Vec3 {
  if (!Number.isFinite(raDeg) || !Number.isFinite(decDeg) || Math.abs(decDeg) > 90) {
    throw new RangeError(`非法天球坐标 ra=${raDeg} dec=${decDeg}`);
  }
  const ra = raDeg * DEG;
  const dec = decDeg * DEG;
  return { x: Math.cos(dec) * Math.cos(ra), y: Math.cos(dec) * Math.sin(ra), z: Math.sin(dec) };
}

/** 赤道 J2000 → 银道单位矢量 */
export function equatorialToGalacticUnit(raDeg: number, decDeg: number): Vec3 {
  return applyMat3(EQ_TO_GAL, equatorialUnit(raDeg, decDeg));
}

/** 赤道 J2000 → 超星系单位矢量（目录坐标链的唯一出处） */
export function equatorialToSupergalacticUnit(raDeg: number, decDeg: number): Vec3 {
  return applyMat3(GAL_TO_SG, equatorialToGalacticUnit(raDeg, decDeg));
}

/** 银道 → 超星系旋转矩阵（行主序；渲染侧组合矩阵构建用） */
export const GALACTIC_TO_SUPERGALACTIC_MATRIX: readonly number[] = GAL_TO_SG;

/**
 * 超星系 → 银道（GAL_TO_SG 转置；产物为超星系坐标而场景系以银道面
 * 为基准——渲染侧反变换回银道后再映射场景，坐标链单点同源）
 */
export function supergalacticToGalactic(v: Vec3): Vec3 {
  const m = GAL_TO_SG;
  return {
    x: m[0] * v.x + m[3] * v.y + m[6] * v.z,
    y: m[1] * v.x + m[4] * v.y + m[7] * v.z,
    z: m[2] * v.x + m[5] * v.y + m[8] * v.z,
  };
}

/** 银道经纬（度）→ 银道笛卡尔单位矢量（测试/锚定用，内部同源） */
export function galacticUnitFromLB(lDeg: number, bDeg: number): Vec3 {
  if (!Number.isFinite(lDeg) || !Number.isFinite(bDeg) || Math.abs(bDeg) > 90) {
    throw new RangeError(`非法银道坐标 l=${lDeg} b=${bDeg}`);
  }
  return galacticUnit(lDeg, bDeg);
}

/** 银纬（度）：银道遮挡带自校验用（|b| < 5° 条目占比应近零） */
export function galacticLatitudeDeg(raDeg: number, decDeg: number): number {
  const g = equatorialToGalacticUnit(raDeg, decDeg);
  return Math.asin(Math.max(-1, Math.min(1, g.z))) / DEG;
}

/** 两单位矢量夹角（度） */
export function angularSeparationDeg(a: Vec3, b: Vec3): number {
  const dot = a.x * b.x + a.y * b.y + a.z * b.z;
  return Math.acos(Math.max(-1, Math.min(1, dot))) / DEG;
}

// ---------------------------------------------------------------------------
// 红移距离 / 亮度档 / 形态档 / 打包
// ---------------------------------------------------------------------------

/**
 * 红移 → 哈勃流距离（Mpc）：d = cz / H₀（低红移线性近似，失真登记第 1/2 项）
 * @throws RangeError cz 非正或非有限
 */
export function czToDistanceMpc(czKmS: number, h0 = H0_KM_S_MPC): number {
  if (!Number.isFinite(czKmS) || czKmS <= 0) {
    throw new RangeError(`哈勃流距离要求 cz > 0，收到 ${czKmS}`);
  }
  return czKmS / h0;
}

/**
 * K_s 星等 → 亮度档（0–1，星等线性归一；亮端 4.0 → 1，完备极限 11.75 → 0）
 */
export function brightness01FromKmag(kMag: number): number {
  if (!Number.isFinite(kMag)) {
    throw new RangeError(`K 星等必须为有限数，收到 ${kMag}`);
  }
  return Math.min(1, Math.max(0, (KMAG_FAINT - kMag) / (KMAG_FAINT - KMAG_BRIGHT)));
}

/**
 * 2MRS type 列 → 形态档。type 首两字符为修订 Hubble T 型
 * （RC3 数字型：-9..-1 椭圆/透镜、0 = S0/a、1–9 旋涡、10–19 不规则/特殊、
 * 20 未分类、98/99 未知——Huchra et al. 2012 §2.3）。
 * 登记：T ≤ 0 归早型档（含 S0 透镜），1–19 归晚型档，≥20/不可解析归未知档。
 */
export function morphTierFromType(typeStr: string): MorphTier {
  const m = /^\s*(-?\d+)/.exec(typeStr);
  if (!m) return 2;
  const t = Number(m[1]);
  if (t >= 20) return 2;
  if (t <= 0) return 0;
  return 1;
}

/** w 通道上界（V2）：2×100000 + 99×1000 + 999 = 299,999 < 2²⁴（Float32 整数精确域） */
export const CATALOG_W_MAX = 299999;

/**
 * 形态档 + J−K 量化档 + 亮度档 → w 通道（bin V2，SC3；整数值浮点 ≤ 299,999
 * < 2²⁴，Float32 精确表示，保证烘焙幂等）：
 * w = tier·100000 + jkTier·1000 + round(b01·999)
 * （编解码唯一出处——烘焙脚本与运行时校验共用，禁止两套公式）
 */
export function packCatalogW(tier: MorphTier, jkTier: number, brightness01: number): number {
  if (!Number.isInteger(jkTier) || jkTier < 0 || jkTier > JK_TIER_UNKNOWN) {
    throw new RangeError(`J−K 量化档必须为 [0,${JK_TIER_UNKNOWN}] 整数，收到 ${jkTier}`);
  }
  if (!Number.isFinite(brightness01) || brightness01 < 0 || brightness01 > 1) {
    throw new RangeError(`亮度档必须在 [0,1]，收到 ${brightness01}`);
  }
  return tier * 100000 + jkTier * 1000 + Math.round(brightness01 * 999);
}

/** w 通道 → {tier, jkTier, brightness01}（packCatalogW 的逆，V2） */
export function unpackCatalogW(w: number): {
  tier: MorphTier;
  jkTier: number;
  brightness01: number;
} {
  if (!Number.isInteger(w) || w < 0 || w > CATALOG_W_MAX) {
    throw new RangeError(`w 通道必须为 [0,${CATALOG_W_MAX}] 整数，收到 ${w}`);
  }
  const tier = Math.floor(w / 100000) as MorphTier;
  const jkTier = Math.floor((w - tier * 100000) / 1000);
  return { tier, jkTier, brightness01: (w % 1000) / 999 };
}

// ---------------------------------------------------------------------------
// 实体星系去重（§R5-3：L4 实体星系目录内剔除，防重影）
// ---------------------------------------------------------------------------

/** L4 实体星系真实天球坐标（J2000，NED）；银河系自身不在目录内（我们身处其中，登记） */
export interface EntityGalaxySky {
  id: string;
  raDeg: number;
  decDeg: number;
  /** 真实距离（光年，NED/数据层同源） */
  distanceLy: number;
}

/**
 * 与 data/galaxies.LOCAL_GROUP_GALAXIES 同名 id 的真实天球坐标登记
 * （NED 检索于 2026-07-30）。M31/M33/M32/M110 视向速度为负（蓝移），
 * 已被 cz > 0 预筛剔除，仍登记在表中防数据源变体。
 */
export const ENTITY_GALAXY_SKY: readonly EntityGalaxySky[] = [
  { id: 'm31', raDeg: 10.6847, decDeg: 41.269, distanceLy: 2.5e6 },
  { id: 'm33', raDeg: 23.4621, decDeg: 30.6599, distanceLy: 2.73e6 },
  { id: 'lmc', raDeg: 80.8942, decDeg: -69.7561, distanceLy: 1.6e5 },
  { id: 'smc', raDeg: 13.1866, decDeg: -72.8286, distanceLy: 2.0e5 },
  { id: 'm32', raDeg: 10.6743, decDeg: 40.8652, distanceLy: 2.49e6 },
  { id: 'm110', raDeg: 10.092, decDeg: 41.6853, distanceLy: 2.69e6 },
  { id: 'sagittarius-dwarf', raDeg: 283.7629, decDeg: -30.4783, distanceLy: 7.0e4 },
  { id: 'm87', raDeg: 187.7059, decDeg: 12.3911, distanceLy: 5.4e7 },
];

/**
 * 去重匹配半径（度，登记）：目录条目与任一实体星系角距 < 0.5° 即剔除。
 * 采用纯角匹配——本星系群成员的哈勃流距离被本动速度支配（LMC cz≈278 km/s
 * → 名义 4 Mpc vs 真实 0.05 Mpc），距离判据不可用；0.5° 内的少量非目标
 * 条目（全天 ~8 条 + 室女座核心数条）一并剔除，防近重影，登记为可接受代价。
 */
export const DEDUP_MATCH_RADIUS_DEG = 0.5;

/** 预计算实体星系赤道单位矢量（模块加载一次） */
const ENTITY_UNITS: readonly { id: string; unit: Vec3 }[] = ENTITY_GALAXY_SKY.map((e) => ({
  id: e.id,
  unit: equatorialUnit(e.raDeg, e.decDeg),
}));

/**
 * 目录条目是否命中实体星系去重（命中返回实体 id，否则 null）
 */
export function matchEntityGalaxy(
  raDeg: number,
  decDeg: number,
  matchRadiusDeg = DEDUP_MATCH_RADIUS_DEG,
): string | null {
  const u = equatorialUnit(raDeg, decDeg);
  for (const e of ENTITY_UNITS) {
    if (angularSeparationDeg(u, e.unit) < matchRadiusDeg) return e.id;
  }
  return null;
}

// ---------------------------------------------------------------------------
// 室女座团方向锥计数（烘焙自校验 + 单测共用）
// ---------------------------------------------------------------------------

/** 室女座团中心方向 = M87 天球坐标（团中心星系，NED） */
export const VIRGO_RA_DEG = 187.7059;
export const VIRGO_DEC_DEG = 12.3911;

/** 室女座超密度自校验锥半径（度）与最低超密度比（登记判据） */
export const VIRGO_CONE_RADIUS_DEG = 6;
export const VIRGO_OVERDENSITY_MIN_RATIO = 3;

/**
 * 室女座超密度自校验距离壳（Mpc）：团心 ~16.5 Mpc，取 [5, 30] 壳层——
 * 全距离积分会被锥内前/背景稀释（实测 6° 全距离比仅 ~2.4×），
 * 壳内对比才反映真实三维聚集（登记判据）。
 */
export const VIRGO_SHELL_MIN_MPC = 5;
export const VIRGO_SHELL_MAX_MPC = 30;

/**
 * 超星系笛卡尔位置数组（N×3）中，方向落入给定单位矢量 radiusDeg 锥内的计数。
 * 可选距离壳 [minR, maxR]（同位置数组的长度单位）限定径向范围。
 */
export function countInCone(
  positions: Float32Array | number[],
  coneDir: Vec3,
  radiusDeg: number,
  minR = 0,
  maxR = Number.POSITIVE_INFINITY,
): number {
  if (!(radiusDeg > 0) || radiusDeg >= 180) {
    throw new RangeError(`锥半径必须在 (0,180) 度，收到 ${radiusDeg}`);
  }
  if (!(minR >= 0) || !(maxR > minR)) {
    throw new RangeError(`距离壳必须满足 0 ≤ minR < maxR，收到 [${minR}, ${maxR}]`);
  }
  const len = Math.hypot(coneDir.x, coneDir.y, coneDir.z);
  if (!Number.isFinite(len) || len === 0) {
    throw new RangeError('锥方向不能为零矢量');
  }
  const cx = coneDir.x / len;
  const cy = coneDir.y / len;
  const cz = coneDir.z / len;
  const cosMin = Math.cos(radiusDeg * DEG);
  let count = 0;
  for (let i = 0; i + 2 < positions.length; i += 3) {
    const x = positions[i];
    const y = positions[i + 1];
    const z = positions[i + 2];
    const r = Math.hypot(x, y, z);
    if (r === 0 || r < minR || r > maxR) continue;
    if ((x * cx + y * cy + z * cz) / r >= cosMin) count += 1;
  }
  return count;
}

/** 位置数组中距离壳 [minR, maxR] 内的总计数（超密度比分母） */
export function countInShell(
  positions: Float32Array | number[],
  minR: number,
  maxR: number,
): number {
  if (!(minR >= 0) || !(maxR > minR)) {
    throw new RangeError(`距离壳必须满足 0 ≤ minR < maxR，收到 [${minR}, ${maxR}]`);
  }
  let count = 0;
  for (let i = 0; i + 2 < positions.length; i += 3) {
    const r = Math.hypot(positions[i], positions[i + 1], positions[i + 2]);
    if (r >= minR && r <= maxR) count += 1;
  }
  return count;
}

/**
 * 锥立体角占全天比例：Ω/4π = (1 − cos θ)/2（超密度比 = 锥内计数占比 ÷ 此值）
 */
export function coneSolidAngleFraction(radiusDeg: number): number {
  if (!(radiusDeg > 0) || radiusDeg >= 180) {
    throw new RangeError(`锥半径必须在 (0,180) 度，收到 ${radiusDeg}`);
  }
  return (1 - Math.cos(radiusDeg * DEG)) / 2;
}
