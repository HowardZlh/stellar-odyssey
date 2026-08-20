/**
 * 月食天文实验室：月食几何/丹戎标度纯函数层（LE 迭代 M1，契约 C1）
 *
 * 全部业务几何/光学映射下沉本模块（M2–M5 只消费不改签名）：
 * - 影锥族：本影/半影**真锥半径**（距离参数化，Danjon 放大修正入参）/ 影轴垂距 /
 *   本影锥长；
 * - 食分族：本影/半影食分（<0 半影食 / 0–1 偏食 / >1 全食）/ 食型判定；
 * - 丹戎族：本影内径向颜色亮度曲线（五档参数化）/ 半影微妙变暗（幅度受限）/
 *   浑浊度 → 丹戎 L 连续映射；
 * - 天光族：月光对极限星等的压制量（衔接 labSky.effectiveLimitingMag 链）/
 *   月缘对冲效应因子 / 月球视角地球大气红环色（与浑浊度同源变量）。
 *
 * 与 `utils/earthShadow.ts` 的关系（底稿 §13.1 技术结论，本模块存在的直接依据）：
 * - earthShadow.ts 文件头登记的适用域为**卫星轨道高度 < 3.6 万 km（锥体收缩 < 3%）**，
 *   其固定系数（UMBRA_INNER/OUTER_FACTOR = 0.92/1.12 × R⊕）在月球距离 38.44 万 km 处
 *   偏差达 27%/12%，其 SHADOW_MIN_LIGHT 均匀底光的模型形态对月食也是错的；
 * - 本模块**照搬其轴向投影 + 垂距的代码骨架**（earthShadow.ts:38-45 手法），但半径
 *   一律换为到地心距离的真锥函数、着色换为径向梯度曲线——**常数与曲线零复用**；
 * - earthShadow.ts 本身零改动（卫星域内其近似正确，不为月食改坏它）；两模型在卫星距
 *   （3.6 万 km）处互差 < 3%，由单测互证（双模型各自适用域的机器证据）。
 *
 * 本影放大修正约定（需求 §8 B7，M1 定稿）：
 * - 采用 **Danjon 法**（NASA 5MCLE / Espenak & Meeus / Connaissance des Temps 同口径）：
 *   月球视差项乘 1.01 ≅ 1 + 1/85（大气不透明层 ≈75 km）− 1/594（45° 纬度扁率修正），
 *   本影/半影获得相同的绝对放大量（Rp = 1.01·Pm + Ss + Ps，Ru = 1.01·Pm − Ss + Ps；
 *   NASA eclipse.gsfc.nasa.gov/LEcat5/shadow.html 式 1-5/1-6）；
 * - 与 Chauvenet 1/50（对影半径本身乘 1.02 的相对修正，Astronomical Almanac 口径）
 *   **不同构**，两约定并存是底稿 §一 🔶 的由来——选 Danjon 因为它与本条目权威源
 *   （5MCLE 目录）同式：四事件食分/γ 用 JPL Horizons 星历 + 本模块公式重算，与
 *   Espenak 目录值互差 < 0.003（食分）/ < 0.002（γ），实测对齐（2026-08-19）；
 * - `enlargement` 为视差项的分数放大量，缺省 DANJON_SHADOW_ENLARGEMENT = 0.01。
 *
 * 物理近似登记（需求 §1.6 + §8）：
 * - 影锥半径取赤道半径口径（扁率并入 Danjon 1.01 因子，5MCLE 同式）；
 * - 丹戎五档色值为**目视主观评级的美术映射**（B6，无标准色值；逐档参数译自底稿
 *   §六 逐级描述：L0 几乎不可见 … L4 亮铜红 + 亮边缘）；L4 描述中的「本影呈蓝色」
 *   （臭氧 Chappuis 吸收致青蓝边缘）属 §1.3 🔶 未补证项，**未证实前不入色表**；
 * - 半影变暗幅度上限 PENUMBRA_SHADING_MAX_DIM（红线 ②「不得夸大」的机器防守侧；
 *   物理上半影内缘照度趋零，此处受限是**反向**保守化，登记为艺术化取舍）；
 * - 对冲效应为简化逆反射因子（B5，非完整 Hapke 模型）；
 * - 月光极限星等压制为对数感知拟合（满月压制 ≈4 等、食甚变暗 ~1 万倍 → 压制几乎
 *   消失，底稿 §7.1 锚点），非辐射度真值。
 *
 * 单位红线：函数入参逐一标注 km / 度 / 无量纲归一；混用即 bug。
 * CPU/GLSL 镜像纪律（契约 C4）：M3 血月 shader 逐式镜像 umbraShading/penumbraShading，
 * 不得变形；三视角共用同一镜像，禁止各写一套。
 *
 * 星历插值复用日食契约 C7 的 `interpolateEphemeris`（solarEclipse.ts，签名行形无关），
 * 本模块不重复实现。数据来源：烘焙星历 public/data/lunar_eclipses.json（JPL Horizons
 * DE441 + NASA 5MCLE / Espenak，登记见 scripts/bake-data/lunarEclipses.ts 文件头）。
 *
 * 硬性约束：本模块不 import React/three；函数无状态、可重入。
 */

import { MOON_MEAN_RADIUS_KM, SUN_RADIUS_KM } from '@/utils/solarEclipse';

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/** 地球赤道半径（km，WGS84；影锥口径——扁率修正并入 Danjon 1.01 因子） */
export const EARTH_EQUATORIAL_RADIUS_KM = 6378.137;

/**
 * Danjon 本影放大修正（视差项分数放大量）：1.01 = 1 + 1/85 − 1/594
 * （NASA 5MCLE shadow.html 式 1-5/1-6，定稿依据见文件头 B7 登记）。
 */
export const DANJON_SHADOW_ENLARGEMENT = 0.01;

/** 无食哨兵食分（月球在向日侧/影轴半线域外时返回，kind 必为 'none'） */
export const NO_ECLIPSE_MAGNITUDE = -99;

/** 半影变暗幅度上限（半影内缘处的最大调光量；红线 ② 机器防守，见文件头登记） */
export const PENUMBRA_SHADING_MAX_DIM = 0.55;

/** 本影径向混合指数（影密度在本影边缘附近变化最快——Kuhl 对比度理论定性口径） */
export const UMBRA_SHADING_EDGE_EXPONENT = 1.7;

/** 满月对极限星等的压制量（等；底稿 §7.1「满月光压制极限星等约 4 等」） */
export const FULL_MOON_LM_SUPPRESSION_MAG = 4;

/** 月光压制对数拟合拐点系数（b=1 → 全压制；b=1e-4（食甚 ~万倍变暗）→ ≈0.2 等） */
export const MOONLIGHT_SUPPRESSION_LOG_KNEE = 999;

/** 对冲效应增亮幅度（满月冲位 ≈ +40%，简化逆反射因子，B5 登记） */
export const OPPOSITION_SURGE_AMPLITUDE = 0.4;

/** 对冲效应相位角衰减宽度（度） */
export const OPPOSITION_SURGE_WIDTH_DEG = 4;

/** 红环取色的本影归一半径（红环 = 本影边缘折射光的「源」，取近边缘处色） */
export const EARTH_RING_SHADING_RNORM = 0.85;

/** 红环亮度增益（环为直射折射光，比月面反照亮得多；渲染侧线性色，钳制到 1） */
export const EARTH_RING_GAIN = 2.2;

// ---------------------------------------------------------------------------
// 通用小工具（内部）
// ---------------------------------------------------------------------------

type Vec3 = readonly [number, number, number];

/** RGB 线性色（0–1） */
export type ShadingRgb = readonly [number, number, number];

function assertFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) throw new RangeError(`${name} 必须为有限数，收到 ${value}`);
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

// ---------------------------------------------------------------------------
// 影锥族（契约 C1：umbraRadiusKmAt / penumbraRadiusKmAt / shadowAxisOffsetKm）
// ---------------------------------------------------------------------------

function assertConeArgs(distFromEarthKm: number, sunDistKm: number, enlargement: number): void {
  assertFinite(distFromEarthKm, 'distFromEarthKm');
  assertFinite(sunDistKm, 'sunDistKm');
  assertFinite(enlargement, 'enlargement');
  if (!(distFromEarthKm > EARTH_EQUATORIAL_RADIUS_KM)) {
    throw new RangeError(`distFromEarthKm 必须 > 地球半径 ${EARTH_EQUATORIAL_RADIUS_KM} km，收到 ${distFromEarthKm}`);
  }
  if (!(sunDistKm > SUN_RADIUS_KM)) {
    throw new RangeError(`sunDistKm 必须 > 太阳半径 ${SUN_RADIUS_KM} km，收到 ${sunDistKm}`);
  }
  if (enlargement < 0) throw new RangeError(`enlargement 不得为负：${enlargement}`);
}

/**
 * 地球本影真锥半径（km，契约 C1）：到地心距离 d 处的本影截面半径。
 *
 * Danjon 视差式（5MCLE 式 1-6 的距离参数化）：
 * r_u(d) = d · tan( (1+e)·asin(R⊕/d) − asin(R☉/D☉) + asin(R⊕/D☉) )
 * 锥顶点之外（角量 ≤ 0）返回 0。
 *
 * @param distFromEarthKm 到地心距离（km，> R⊕）
 * @param sunDistKm 日地距离（km）
 * @param enlargement 视差项分数放大量（Danjon 法；0 = 纯几何锥）
 */
export function umbraRadiusKmAt(
  distFromEarthKm: number,
  sunDistKm: number,
  enlargement: number = DANJON_SHADOW_ENLARGEMENT
): number {
  assertConeArgs(distFromEarthKm, sunDistKm, enlargement);
  const angleRad =
    (1 + enlargement) * Math.asin(EARTH_EQUATORIAL_RADIUS_KM / distFromEarthKm) -
    Math.asin(SUN_RADIUS_KM / sunDistKm) +
    Math.asin(EARTH_EQUATORIAL_RADIUS_KM / sunDistKm);
  return angleRad <= 0 ? 0 : distFromEarthKm * Math.tan(angleRad);
}

/**
 * 地球半影真锥半径（km，契约 C1）：到地心距离 d 处的半影外缘截面半径。
 * r_p(d) = d · tan( (1+e)·asin(R⊕/d) + asin(R☉/D☉) + asin(R⊕/D☉) )（5MCLE 式 1-5）。
 * 参数同 umbraRadiusKmAt。
 */
export function penumbraRadiusKmAt(
  distFromEarthKm: number,
  sunDistKm: number,
  enlargement: number = DANJON_SHADOW_ENLARGEMENT
): number {
  assertConeArgs(distFromEarthKm, sunDistKm, enlargement);
  const angleRad =
    (1 + enlargement) * Math.asin(EARTH_EQUATORIAL_RADIUS_KM / distFromEarthKm) +
    Math.asin(SUN_RADIUS_KM / sunDistKm) +
    Math.asin(EARTH_EQUATORIAL_RADIUS_KM / sunDistKm);
  return distFromEarthKm * Math.tan(angleRad);
}

/**
 * 本影锥长（km）：umbraRadiusKmAt 的解析零点
 * L = R⊕ / sin( (Ss − Ps) / (1+e) )，Ss/Ps 为太阳视半径/太阳视差。
 * 1 AU 处纯几何锥 ≈ 138.3 万 km，Danjon 放大后 ≈ 139.7 万 km（锚点 ∈ [135, 145] 万）。
 *
 * @param sunDistKm 日地距离（km）
 * @param enlargement 视差项分数放大量
 */
export function umbraConeLengthKm(
  sunDistKm: number,
  enlargement: number = DANJON_SHADOW_ENLARGEMENT
): number {
  assertFinite(sunDistKm, 'sunDistKm');
  assertFinite(enlargement, 'enlargement');
  if (!(sunDistKm > SUN_RADIUS_KM)) {
    throw new RangeError(`sunDistKm 必须 > 太阳半径 ${SUN_RADIUS_KM} km，收到 ${sunDistKm}`);
  }
  if (enlargement < 0) throw new RangeError(`enlargement 不得为负：${enlargement}`);
  const halfAngleRad =
    (Math.asin(SUN_RADIUS_KM / sunDistKm) - Math.asin(EARTH_EQUATORIAL_RADIUS_KM / sunDistKm)) /
    (1 + enlargement);
  return EARTH_EQUATORIAL_RADIUS_KM / Math.sin(halfAngleRad);
}

/** 影轴几何（地心系）：月心沿影轴的投影距离 + 到影轴的垂距 */
export interface ShadowAxisGeometry {
  /** 月心在影轴（背日向半线）上的投影距离（km；≤ 0 = 向日侧，无月食） */
  axialKm: number;
  /** 月心到影轴的垂距（km） */
  perpKm: number;
}

/**
 * 影轴几何分解（轴向投影 + 垂距骨架沿 earthShadow.ts:38-45 手法，常数零复用）。
 * 影轴 = 从地心指向背日向的半线（单位向量 −sunPos/|sunPos|）。
 *
 * @param sunPosKm 太阳中心位置（km，地心系，任意一致坐标系）
 * @param moonPosKm 月球中心位置（km，同坐标系）
 */
export function shadowAxisGeometryKm(sunPosKm: Vec3, moonPosKm: Vec3): ShadowAxisGeometry {
  for (const [v, name] of [
    [sunPosKm, 'sunPosKm'],
    [moonPosKm, 'moonPosKm'],
  ] as const) {
    for (let i = 0; i < 3; i += 1) assertFinite(v[i], `${name}[${i}]`);
  }
  const sunDist = Math.hypot(sunPosKm[0], sunPosKm[1], sunPosKm[2]);
  if (!(sunDist > 0)) throw new RangeError('sunPosKm 不得为零向量');
  // 背日向单位轴
  const ax = -sunPosKm[0] / sunDist;
  const ay = -sunPosKm[1] / sunDist;
  const az = -sunPosKm[2] / sunDist;
  const axialKm = moonPosKm[0] * ax + moonPosKm[1] * ay + moonPosKm[2] * az;
  const px = moonPosKm[0] - axialKm * ax;
  const py = moonPosKm[1] - axialKm * ay;
  const pz = moonPosKm[2] - axialKm * az;
  return { axialKm, perpKm: Math.hypot(px, py, pz) };
}

/**
 * 月心到影轴的垂距（km，契约 C1）。
 * 参数同 shadowAxisGeometryKm。
 */
export function shadowAxisOffsetKm(sunPosKm: Vec3, moonPosKm: Vec3): number {
  return shadowAxisGeometryKm(sunPosKm, moonPosKm).perpKm;
}

// ---------------------------------------------------------------------------
// 食分族（契约 C1：umbralMagnitude / penumbralMagnitude / lunarEclipseKind）
// ---------------------------------------------------------------------------

/**
 * 本影食分（契约 C1）：Espenak 口径的 km 形式
 * mag = (r_u(轴向距) + R月 − 垂距) / (2·R月)。
 * <0 = 未触本影；0–1 = 偏食；>1 = 全食（1 = 食既/生光边界）。
 * 月球在向日侧（axial ≤ R⊕）返回 NO_ECLIPSE_MAGNITUDE 哨兵。
 *
 * @param sunPosKm 太阳中心位置（km，地心系）
 * @param moonPosKm 月球中心位置（km，地心系）
 * @param enlargement 视差项分数放大量（缺省 Danjon）
 */
export function umbralMagnitude(
  sunPosKm: Vec3,
  moonPosKm: Vec3,
  enlargement: number = DANJON_SHADOW_ENLARGEMENT
): number {
  const g = shadowAxisGeometryKm(sunPosKm, moonPosKm);
  if (g.axialKm <= EARTH_EQUATORIAL_RADIUS_KM) return NO_ECLIPSE_MAGNITUDE;
  const sunDist = Math.hypot(sunPosKm[0], sunPosKm[1], sunPosKm[2]);
  const rU = umbraRadiusKmAt(g.axialKm, sunDist, enlargement);
  return (rU + MOON_MEAN_RADIUS_KM - g.perpKm) / (2 * MOON_MEAN_RADIUS_KM);
}

/**
 * 半影食分（契约 C1）：mag = (r_p(轴向距) + R月 − 垂距) / (2·R月)。
 * ≤0 = 无食；>0 = 至少半影食。向日侧返回 NO_ECLIPSE_MAGNITUDE。参数同 umbralMagnitude。
 */
export function penumbralMagnitude(
  sunPosKm: Vec3,
  moonPosKm: Vec3,
  enlargement: number = DANJON_SHADOW_ENLARGEMENT
): number {
  const g = shadowAxisGeometryKm(sunPosKm, moonPosKm);
  if (g.axialKm <= EARTH_EQUATORIAL_RADIUS_KM) return NO_ECLIPSE_MAGNITUDE;
  const sunDist = Math.hypot(sunPosKm[0], sunPosKm[1], sunPosKm[2]);
  const rP = penumbraRadiusKmAt(g.axialKm, sunDist, enlargement);
  return (rP + MOON_MEAN_RADIUS_KM - g.perpKm) / (2 * MOON_MEAN_RADIUS_KM);
}

/** 食型（契约 C1） */
export type LunarEclipseKind = 'none' | 'penumbral' | 'partial' | 'total';

/**
 * 食型判定（契约 C1）：penumbralMag ≤ 0 → none；umbralMag ≤ 0 → penumbral；
 * umbralMag < 1 → partial；≥ 1 → total。
 * 边界约定：相切（=0）归外侧档、食既（=1）归 total（食分定义的自然边界）。
 *
 * @param umbralMag 本影食分（umbralMagnitude 输出）
 * @param penumbralMag 半影食分（penumbralMagnitude 输出）
 */
export function lunarEclipseKind(umbralMag: number, penumbralMag: number): LunarEclipseKind {
  assertFinite(umbralMag, 'umbralMag');
  assertFinite(penumbralMag, 'penumbralMag');
  if (penumbralMag <= 0) return 'none';
  if (umbralMag <= 0) return 'penumbral';
  if (umbralMag < 1) return 'partial';
  return 'total';
}

// ---------------------------------------------------------------------------
// 丹戎族（契约 C1：umbraShading / penumbraShading / turbidityToDanjonL）
// ---------------------------------------------------------------------------

/**
 * 丹戎五档本影色表（线性 RGB 0–1；美术映射登记 B6，参数逐档译自底稿 §六）：
 * L0 极暗几乎不可见 / L1 暗灰褐 / L2 深红铁锈（中心极暗、外缘相对明亮）/
 * L3 砖红（亮黄边缘）/ L4 亮铜红橙（边缘极亮）。
 * 感知亮度（Rec.709 luma）在档间与径向均严格递增（单测锁定）。
 */
export const DANJON_UMBRA_PRESETS: readonly { center: ShadingRgb; edge: ShadingRgb }[] = [
  { center: [0.004, 0.002, 0.001], edge: [0.02, 0.012, 0.008] },
  { center: [0.012, 0.007, 0.004], edge: [0.05, 0.035, 0.022] },
  { center: [0.02, 0.006, 0.003], edge: [0.13, 0.05, 0.02] },
  { center: [0.06, 0.02, 0.008], edge: [0.28, 0.16, 0.05] },
  { center: [0.14, 0.05, 0.015], edge: [0.5, 0.35, 0.12] },
];

/**
 * 本影内径向颜色亮度曲线（契约 C1，月食渲染核心；GLSL 逐式镜像纪律见文件头）。
 * color(r) = center + (edge − center) · r^UMBRA_SHADING_EDGE_EXPONENT，
 * 档间线性内插；中心极暗、外缘偏亮偏黄（红线 ①：必须径向梯度，禁均匀变暗）。
 *
 * @param rNorm01 归一化本影半径（0 = 影心，1 = 本影边缘；越界钳制）
 * @param danjonL 丹戎 L 值（0–4 连续；越界钳制）
 * @returns 线性 RGB（0–1）
 */
export function umbraShading(rNorm01: number, danjonL: number): ShadingRgb {
  assertFinite(rNorm01, 'rNorm01');
  assertFinite(danjonL, 'danjonL');
  const r = clamp01(rNorm01);
  const l = clamp(danjonL, 0, 4);
  const i0 = Math.min(Math.floor(l), 3);
  const w = l - i0;
  const lo = DANJON_UMBRA_PRESETS[i0];
  const hi = DANJON_UMBRA_PRESETS[i0 + 1];
  const t = r ** UMBRA_SHADING_EDGE_EXPONENT;
  const channel = (c: 0 | 1 | 2): number => {
    const center = lo.center[c] + (hi.center[c] - lo.center[c]) * w;
    const edge = lo.edge[c] + (hi.edge[c] - lo.edge[c]) * w;
    return center + (edge - center) * t;
  };
  return [channel(0), channel(1), channel(2)];
}

/**
 * 半影段微妙线性变暗因子（契约 C1；红线 ②：禁止为可见性夸大）。
 * factor(r) = 1 − PENUMBRA_SHADING_MAX_DIM · (1 − r)²——外缘（r=1）无变暗，
 * 内缘（r=0，贴本影）最多调暗 PENUMBRA_SHADING_MAX_DIM；r ≥ 0.6 段变暗 < 0.09
 * （纯半影食「几乎无感」的量化承诺，单测锁定）。
 *
 * @param rNorm01 归一化半影径向位置（0 = 本影外缘，1 = 半影外缘；越界钳制）
 * @returns 亮度因子（0–1，乘性）
 */
export function penumbraShading(rNorm01: number): number {
  assertFinite(rNorm01, 'rNorm01');
  const r = clamp01(rNorm01);
  return 1 - PENUMBRA_SHADING_MAX_DIM * (1 - r) * (1 - r);
}

/**
 * 大气浑浊度/火山尘埃 → 丹戎 L 连续映射（契约 C1）。
 * 线性：L = 4 · (1 − turbidity)；t=0（洁净平流层）→ L4 亮铜红，
 * t=1（皮纳图博级火山尘埃，1992-12-09 实测 L=0 依据）→ L0。
 *
 * @param turbidity01 浑浊度（0–1，越界钳制）
 */
export function turbidityToDanjonL(turbidity01: number): number {
  assertFinite(turbidity01, 'turbidity01');
  return 4 * (1 - clamp01(turbidity01));
}

// ---------------------------------------------------------------------------
// 天光/月面光学族（契约 C1：moonlightLimitingMagDelta / oppositionSurgeFactor /
// earthRingColor）
// ---------------------------------------------------------------------------

/**
 * 月光对极限星等的压制量（等，契约 C1；衔接 labSky.effectiveLimitingMag：
 * 消费侧用 userLm − delta）。对数感知拟合（登记见文件头）：
 * delta = 4 · ln(1 + 999·b) / ln(1000)——满月（b=1）压制 4 等；食甚
 * （b ≈ 1e-4，变暗 ~万倍）压制 ≈ 0.2 等 → 恒星显现（底稿 §7.1 锚点）。
 *
 * @param moonBrightness01 月面亮度（0–1 归一，满月 = 1；越界钳制）
 */
export function moonlightLimitingMagDelta(moonBrightness01: number): number {
  assertFinite(moonBrightness01, 'moonBrightness01');
  const b = clamp01(moonBrightness01);
  return (
    (FULL_MOON_LM_SUPPRESSION_MAG * Math.log(1 + MOONLIGHT_SUPPRESSION_LOG_KNEE * b)) /
    Math.log(1 + MOONLIGHT_SUPPRESSION_LOG_KNEE)
  );
}

/**
 * 月缘增亮/对冲效应简化逆反射因子（契约 C1，B5 登记非完整 Hapke）。
 * factor = 1 + A · exp(−|phase| / w)——相位角 0°（冲位）处峰值 1.4，
 * 随相位角对称衰减（天鹅绒蒙凸面类比的最小参数化）。
 *
 * @param phaseAngleDeg 相位角（度，太阳-月面点-观测者夹角；可为负，取绝对值）
 */
export function oppositionSurgeFactor(phaseAngleDeg: number): number {
  assertFinite(phaseAngleDeg, 'phaseAngleDeg');
  return (
    1 +
    OPPOSITION_SURGE_AMPLITUDE * Math.exp(-Math.abs(phaseAngleDeg) / OPPOSITION_SURGE_WIDTH_DEG)
  );
}

/**
 * 月球视角地球大气红环色（契约 C1，线性 RGB 0–1）。
 * 与血月着色**同源变量**（因果闭环的实现层保证）：
 * earthRingColor(t) = clamp( umbraShading(0.85, turbidityToDanjonL(t)) × 增益 )
 * ——红环就是照亮本影近边缘区的那圈折射光，浑浊度经同一条 L 链驱动两侧。
 *
 * @param turbidity01 浑浊度（0–1，与 turbidityToDanjonL 同口径；越界钳制）
 */
export function earthRingColor(turbidity01: number): ShadingRgb {
  const rgb = umbraShading(EARTH_RING_SHADING_RNORM, turbidityToDanjonL(turbidity01));
  return [
    clamp01(rgb[0] * EARTH_RING_GAIN),
    clamp01(rgb[1] * EARTH_RING_GAIN),
    clamp01(rgb[2] * EARTH_RING_GAIN),
  ];
}
