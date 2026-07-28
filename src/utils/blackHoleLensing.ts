/**
 * 黑洞引力透镜纯逻辑（R4-11，IMPROVEMENT_REQUIREMENTS_4 §R4-11 / §0.3 方案 C）
 *
 * 物理近似登记（附录 A §4，**不做全数值测地线积分**）：
 * - 光线弯曲 = "弱场积分核空间分布 + 二阶闭式总量预算"：
 *   a) 总偏转角取 Schwarzschild 二阶 PPN 闭式
 *      α(b) = 2·r_s/b + (15π/16)·(r_s/b)²（一阶项即弱场式 α ≈ 4GM/(c²b)，
 *      因 r_s = 2GM/c²；二阶系数见 Keeton & Petters 2005, PRD 72, 104006；
 *      第二项即"近光子球增强项"——b 减小时弯曲超线性增强）；
 *   b) 沿视线的弯折空间分布用弱场积分核 dα/ds = r_s·b/r³（直线路径
 *      r² = b² + s² 下解析积分 = 2·r_s/b），逐步弯折、以 α(b) 为硬预算——
 *      出射方向与二阶闭式严格一致，且避免沿弯折路径评估增强项的
 *      正反馈过弯（实测登记：含增强项的分布核会把 r 撞击边界推至
 *      b ≈ 3.9 r_s，远超真捕获截面）。
 * - 适用域：b ≳ 2 r_s 定量可靠（二阶展开收敛域）；b → b_crit = 3√3/2·r_s
 *   ≈ 2.598 r_s 处真解发散（对数强场极限，Bozza 2002），本近似有限——
 *   光子环观感由撞击参数选通 × 光子球邻域驻留发光（高斯核沿程积累）
 *   补足，属艺术化增强登记。
 * - 撞击/阴影判定双判据：a) r ≤ 1.05 r_s 撞击终止为黑（§R4-11 指定阈值，
 *   数值步进防护）；b) b < b_crit = 3√3/2·r_s **且起步方向朝向中心**判为
 *   阴影（Schwarzschild 光子捕获截面的精确解析结果，Misner-Thorne-Wheeler
 *   §25.6；捕获判据只适用于须越过光子球势垒的内行光线——外行光线不论 b
 *   均出射，否则近距观察者视野整片误黑，实测登记）。两判据并集渲染为黑
 *   （弯折路径下 r 判据实测边界 ≈ 2.7 r_s，与解析判据基本重合）。
 *   近似残差登记：观察者深入光子球以内（r < 1.5 r_s）时，真解中 b > b_crit
 *   的外行光子会回落，本近似仍按出射处理（预览页相机域基本不可达）。
 *
 * ── 吸积盘物理（R4-12，§R4-12 / §0.3 方案 C）────────────────────────
 * - 几何薄盘：盘平面 r ∈ [内缘≈3 r_s（ISCO）, 外缘~12 r_s]，raymarch 弯折
 *   步进中做平面跨越检测（线性插值求交，非解析求交）——弯曲光线可与盘
 *   多次相交，上下缘翻折像即来源于绕过黑洞上/下方的光线再交盘面。
 * - 温度剖面：T(r) ∝ r^(−3/4) × [1 − √(r_in/r)]^(1/4)（Novikov-Thorne /
 *   Shakura-Sunyaev 薄盘近似，内缘应力零边界截断项登记；剖面峰值在
 *   r = (49/36)·r_in，归一化系数 DISK_TEMP_PROFILE_NORM 闭式求得）。
 *   峰值温度 DISK_TEMP_PEAK_K_DEFAULT 为可视化选择（真实恒星级黑洞盘内区
 *   ~10⁷ K 属 X 射线，光学黑体色板不可表现，压标至数千 K 登记）。
 * - 开普勒速度：β(r) = √[ (r_s/2) / (r − r_s) ]（Schwarzschild 圆轨道的
 *   静止观察者局域速度，ISCO r=3 r_s 处恰 0.5c），上限钳 DISK_BETA_MAX。
 * - 多普勒束流：δ = √(1−β²)/(1−β·cosθ)，亮度 ∝ δ³（§R4-12 指定 δ³ 近似；
 *   频率积分强度真值为 δ⁴，登记）；色温随 δ 蓝移/红移（T_obs = T·δ）。
 * - 引力红移：g = √(1 − r_s/r)（静止发射体→无穷远观察者近似，忽略盘倾角
 *   与观察者位置的次级项，登记）；亮度 ×g³、色温 ×g。
 * - 束流强度滑杆：δ_eff = δ^strength（strength=0 关闭束流、1 物理档、
 *   >1 夸大），引力红移不随滑杆关闭（物理常开）。
 * - 亮度剖面：I ∝ tempFactor²（真值 T⁴ 动态范围过大，压缩为平方档 +
 *   Bloom 联调不过曝，艺术化登记）。
 * - 黑体着色复用 R4-6 `starPhysics.blackbodyRGB`：`buildBlackbodyLutData`
 *   预采样 [1,000, 16,000] K → 64 texel RGBA LUT（shader 1D 查表，
 *   blackbodyRGB 域外自行钳制）。
 *
 * CPU 参考追踪 `traceLensedRay` 与 shader（BlackHoleLensed.tsx）逐步公式
 * 同式，常数单点维护于本文件（shader 经模板插值引用），单测据此断言一致性。
 * 全文件以 r_s = 1 为长度单位（shader 侧经 uniform 换算世界单位）。
 */

import { createSeededRandom } from '@/utils/random';
import { blackbodyRGB } from '@/utils/starPhysics';

/** 撞击终止半径（r_s 单位；§R4-11：r ≤ 1.05 r_s 终止为黑） */
export const CAPTURE_RADIUS_RS = 1.05;

/** 光子球半径（Schwarzschild：r_ph = 1.5 r_s） */
export const PHOTON_SPHERE_RADIUS_RS = 1.5;

/** 临界撞击参数 b_crit = 3√3/2 · r_s ≈ 2.598（光子环成像半径） */
export const PHOTON_RING_IMPACT_RS = (3 * Math.sqrt(3)) / 2;

/**
 * 二阶增强系数 K = 15/8：闭式偏转角二阶项 (K·π/2)/b² = (15π/16)/b²，
 * 与 Schwarzschild 二阶 PPN 偏转严格同系数
 */
export const DEFLECTION_SECOND_ORDER_COEFF = 15 / 8;

/** 光子球邻域驻留核宽度（r_s 单位；64 步步长 ~0.44 r_s 下的稳定档） */
export const PHOTON_RING_SIGMA_RS = 0.5;

/** 光子环撞击参数选通核宽度（r_s 单位；环的成像锐度） */
export const PHOTON_RING_IMPACT_SIGMA_RS = 0.22;

/** raymarch 包围球半径（r_s 单位；球外弯曲 ≤ α(14) ≈ 0.15 rad，截断登记） */
export const LENSING_DOMAIN_RADIUS_RS = 14;

/** 单步偏转上限（rad；数值稳定：粗步长下防近场旋转过冲） */
export const MAX_BEND_PER_STEP_RAD = 0.35;

/** 步进数下限/默认/上限（shader 循环编译期上界 = 上限） */
export const LENSING_STEPS_MIN = 16;
export const LENSING_STEPS_DEFAULT = 64;
export const LENSING_STEPS_MAX = 128;

/** 将步进数钳制到 [16,128] 并取整（材质工厂与预览滑杆共用） */
export function clampLensingSteps(steps: number): number {
  if (!Number.isFinite(steps)) return LENSING_STEPS_DEFAULT;
  return Math.max(LENSING_STEPS_MIN, Math.min(LENSING_STEPS_MAX, Math.round(steps)));
}

/** 弱场偏转角（rad）：α = 2 r_s/b（即 4GM/(c²b)），b 以 r_s 为单位 */
export function weakFieldDeflectionRad(bOverRs: number): number {
  if (!(bOverRs > 0)) return 0;
  return 2 / bOverRs;
}

/**
 * 二阶闭式偏转角（rad）：α = 2/b + (15π/16)/b²（b 以 r_s 为单位）
 *
 * 适用域 b ≳ 2 r_s；与 `deflectionRatePerRs` 沿直线路径的积分解析同值
 * （单测据此断言 CPU 参考追踪一致性）。
 */
export function deflectionAngleRad(bOverRs: number): number {
  if (!(bOverRs > 0)) return 0;
  return 2 / bOverRs + ((DEFLECTION_SECOND_ORDER_COEFF * Math.PI) / 2) / (bOverRs * bOverRs);
}

/**
 * 弯折空间分布积分核 dα/ds（rad / r_s；shader 逐步同式）：
 * 弱场式 b/r³（直线路径积分 = 2/b），r/b 均以 r_s 为单位。
 * 总量由 `deflectionAngleRad` 闭式预算控制（文件头登记）。
 */
export function deflectionRatePerRs(rOverRs: number, bOverRs: number): number {
  const r = Math.max(rOverRs, 1e-4);
  const b = Math.max(bOverRs, 0);
  return b / (r * r * r);
}

/** 撞击判定：r ≤ 1.05 r_s 落入视界（渲染为黑，raymarch 终止） */
export function isCaptured(rOverRs: number): boolean {
  return rOverRs <= CAPTURE_RADIUS_RS;
}

/**
 * 阴影判定（解析）：b < b_crit = 3√3/2·r_s 且起步方向朝向中心
 * （radialDot = p̂·dir < 0）的光子被捕获（Schwarzschild 捕获截面精确
 * 结果；黑洞阴影 = 该撞击参数盘）。外行光线（radialDot ≥ 0）不论 b
 * 均出射——近距观察者（r_obs 小）反向追踪的出射光线 b 必然小，
 * 若不加方向判据整片视野误黑（文件头登记）。
 */
export function isShadowed(bOverRs: number, radialDot: number): boolean {
  return bOverRs < PHOTON_RING_IMPACT_RS && radialDot < 0;
}

/**
 * 光子球邻域驻留权重（无量纲）：以 r = 1.5 r_s 为中心的高斯核，
 * 决定环发光沿路径的积累位置（近光子球段贡献大）
 */
export function photonRingWeight(rOverRs: number): number {
  const d = (rOverRs - PHOTON_SPHERE_RADIUS_RS) / PHOTON_RING_SIGMA_RS;
  return Math.exp(-d * d);
}

/**
 * 光子环撞击参数选通权重（无量纲）：以 b_crit ≈ 2.6 r_s 为中心的高斯核
 * （§R4-11："b ≈ 2.6 r_s 附近积累增亮"），决定哪些光线参与环增亮
 */
export function ringImpactWeight(bOverRs: number): number {
  const d = (bOverRs - PHOTON_RING_IMPACT_RS) / PHOTON_RING_IMPACT_SIGMA_RS;
  return Math.exp(-d * d);
}

/** 三分量向量（纯逻辑层不引 three，shader/组件侧自行换算） */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** 撞击参数 b = |ro × rd|（rd 须为单位向量；ro 以 r_s 为单位） */
export function impactParameterRs(ro: Vec3, rdUnit: Vec3): number {
  const cx = ro.y * rdUnit.z - ro.z * rdUnit.y;
  const cy = ro.z * rdUnit.x - ro.x * rdUnit.z;
  const cz = ro.x * rdUnit.y - ro.y * rdUnit.x;
  return Math.sqrt(cx * cx + cy * cy + cz * cz);
}

/** CPU 参考追踪结果 */
export interface LensedRayResult {
  /** captured：撞击 r ≤ 1.05 r_s 终止为黑；escaped：离开包围球（或步数耗尽） */
  status: 'captured' | 'escaped';
  /** 出射方向（单位向量；captured 时为终止时刻方向） */
  direction: Vec3;
  /** 光子环驻留发光积累（∫ photonRingWeight ds，shader 同式） */
  ringGlow: number;
  /** 实际推进步数 */
  stepsUsed: number;
  /** 路径最小 r（r_s 单位；诊断/单测用） */
  minRadiusRs: number;
}

/** CPU 参考追踪选项 */
export interface TraceOptions {
  /** 步进数（默认 64；CPU 侧允许超出 shader 钳制域以做高精度基准） */
  steps?: number;
  /** 包围球半径（r_s 单位，默认 LENSING_DOMAIN_RADIUS_RS） */
  domainRadiusRs?: number;
}

/**
 * CPU 参考光线追踪（shader raymarch 的逐步镜像，常数同源）：
 * 固定步长 ds = 2R/steps；每步累积环发光、按积分核向中心弯折方向、
 * 撞击 r ≤ 1.05 r_s 终止为黑、出包围球即出射（背景 cubemap 由消费方采样）。
 *
 * 数值防护（shader 同式）：方向重归一化、单步偏转钳 MAX_BEND_PER_STEP_RAD、
 * 径向/垂直分量长度下限防除零——任意输入不产生 NaN。
 */
export function traceLensedRay(ro: Vec3, rd: Vec3, options: TraceOptions = {}): LensedRayResult {
  const steps = Math.max(1, Math.round(options.steps ?? LENSING_STEPS_DEFAULT));
  const R = options.domainRadiusRs ?? LENSING_DOMAIN_RADIUS_RS;
  const ds = (2 * R) / steps;

  // 方向归一化（零向量降级 +z，防 NaN）
  let dx = rd.x;
  let dy = rd.y;
  let dz = rd.z;
  const dLen = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (dLen < 1e-12) {
    dx = 0;
    dy = 0;
    dz = 1;
  } else {
    dx /= dLen;
    dy /= dLen;
    dz /= dLen;
  }

  let px = ro.x;
  let py = ro.y;
  let pz = ro.z;

  // 起点在包围球外：先解析推进到球面入口（未命中直接原方向出射）
  const ro2 = px * px + py * py + pz * pz;
  if (ro2 > R * R) {
    const tm = -(px * dx + py * dy + pz * dz); // 最近点参数
    const d2 = ro2 - tm * tm; // 最近距²
    if (tm <= 0 || d2 >= R * R) {
      return {
        status: 'escaped',
        direction: { x: dx, y: dy, z: dz },
        ringGlow: 0,
        stepsUsed: 0,
        minRadiusRs: Math.sqrt(Math.min(ro2, Math.max(d2, 0))),
      };
    }
    const tEntry = tm - Math.sqrt(R * R - d2);
    px += dx * tEntry;
    py += dy * tEntry;
    pz += dz * tEntry;
  }

  let ringGlow = 0;
  let minR = Math.sqrt(px * px + py * py + pz * pz);
  let stepsUsed = 0;

  // 撞击参数 b 于入口一次性求得（测地线守恒量；逐步重算会沿弯折路径
  // 正反馈放大弯曲、显著高估捕获截面，实测登记）
  const b = impactParameterRs({ x: px, y: py, z: pz }, { x: dx, y: dy, z: dz });
  // 环发光撞击参数选通（每条光线常量，循环外求值，shader 同式）
  const ringGate = ringImpactWeight(b);
  // 总偏转硬预算 = 二阶闭式 α(b)（分布式核只决定弯折的空间分布）
  let bendBudget = deflectionAngleRad(b);
  // 阴影解析判据：b < b_crit 且起步朝向中心（外行光线不论 b 均出射）
  const shadowed = isShadowed(b, px * dx + py * dy + pz * dz);

  for (let i = 0; i < steps; i += 1) {
    const r = Math.sqrt(px * px + py * py + pz * pz);
    if (r < minR) minR = r;

    // 撞击终止为黑（§R4-11：r ≤ 1.05 r_s）
    if (isCaptured(r)) {
      return {
        status: 'captured',
        direction: { x: dx, y: dy, z: dz },
        ringGlow,
        stepsUsed,
        minRadiusRs: minR,
      };
    }

    // 光子环发光积累（shader 同式：b 选通 × 光子球邻域驻留）
    ringGlow += ringGate * photonRingWeight(r) * ds;

    // 逐步弯折（b 守恒），dα 钳单步上限与总预算
    const dAlpha = Math.min(deflectionRatePerRs(r, b) * ds, MAX_BEND_PER_STEP_RAD, bendBudget);
    bendBudget -= dAlpha;

    // 向心方向在垂直于 dir 平面内的分量（长度下限防除零：径向光线不弯折）
    const invR = 1 / Math.max(r, 1e-4);
    const inX = -px * invR;
    const inY = -py * invR;
    const inZ = -pz * invR;
    const dot = inX * dx + inY * dy + inZ * dz;
    const perpX = inX - dot * dx;
    const perpY = inY - dot * dy;
    const perpZ = inZ - dot * dz;
    const perpLen = Math.sqrt(perpX * perpX + perpY * perpY + perpZ * perpZ);
    if (perpLen > 1e-6 && dAlpha > 0) {
      const cosA = Math.cos(dAlpha);
      const sinA = Math.sin(dAlpha);
      const inv = 1 / perpLen;
      dx = dx * cosA + perpX * inv * sinA;
      dy = dy * cosA + perpY * inv * sinA;
      dz = dz * cosA + perpZ * inv * sinA;
      // 重归一化（数值漂移防护）
      const n = Math.sqrt(dx * dx + dy * dy + dz * dz);
      dx /= n;
      dy /= n;
      dz /= n;
    }

    px += dx * ds;
    py += dy * ds;
    pz += dz * ds;
    stepsUsed = i + 1;

    // 出包围球且正在远离：提前终止出射
    const r2 = px * px + py * py + pz * pz;
    if (r2 > R * R && px * dx + py * dy + pz * dz > 0) {
      break;
    }
  }

  return {
    // b < b_crit 的光线即使步进未触及 1.05 r_s 亦判为阴影（解析捕获截面）
    status: shadowed ? 'captured' : 'escaped',
    direction: { x: dx, y: dy, z: dz },
    ringGlow,
    stepsUsed,
    minRadiusRs: minR,
  };
}

// ---------------------------------------------------------------------------
// 吸积盘物理（R4-12：温度黑体色 / 多普勒束流 / 引力红移，文件头登记）
// ---------------------------------------------------------------------------

/** 盘内缘默认半径（r_s 单位；Schwarzschild ISCO = 3 r_s） */
export const DISK_INNER_RADIUS_RS_DEFAULT = 3;

/** 盘外缘默认半径（r_s 单位；§R4-12 "~12 r_s"，须 < 包围球 14 r_s） */
export const DISK_OUTER_RADIUS_RS_DEFAULT = 12;

/** 盘内外缘最小间隔（r_s 单位；滑杆域防交叉） */
export const DISK_RADII_MIN_GAP_RS = 1;

/** 温度剖面峰值位置 u = r/r_in（NT 截断剖面解析极值点 49/36 ≈ 1.361） */
export const DISK_TEMP_PROFILE_PEAK_U = 49 / 36;

/**
 * 温度剖面归一化系数：f(u) = u^(−3/4)·(1−u^(−1/2))^(1/4) 在 u = 49/36
 * 处取峰值 f = (36/49)^(3/4)·7^(−1/4)，NORM = 1/f = (49/36)^(3/4)·7^(1/4)
 */
export const DISK_TEMP_PROFILE_NORM = Math.pow(49 / 36, 0.75) * Math.pow(7, 0.25);

/** 峰值温度可视化档（K；真实内区 ~10⁷ K X 射线，压标登记见文件头） */
export const DISK_TEMP_PEAK_K_DEFAULT = 7200;

/** 开普勒速度上限钳（β = v/c；内缘滑杆下限 2 r_s 处 β ≈ 0.707 的稳定钳） */
export const DISK_BETA_MAX = 0.72;

/** 引力红移因子下限（g → 0 时颜色/亮度归零的数值防护） */
export const GRAV_REDSHIFT_FLOOR = 0.05;

/** 黑体 LUT 温度域（K；覆盖盘温 × 多普勒/引力偏移域，blackbodyRGB 域外钳制） */
export const DISK_LUT_TEMP_MIN_K = 1000;
export const DISK_LUT_TEMP_MAX_K = 16000;

/** 黑体 LUT 宽度（texel；线性插值采样足够平滑） */
export const DISK_LUT_WIDTH = 64;

/** 盘条纹差速角速度系数（rad/s · r_s^1.5；ω = K·r^(−3/2) 开普勒律形状，
 * 速率为可视化节奏登记——真实 ISCO 周期毫秒~小时级不可视化） */
export const DISK_STRIPE_OMEGA = 6;

/**
 * 盘内外缘滑杆钳制（inner < outer，最小间隔 DISK_RADII_MIN_GAP_RS；
 * 外缘上限 = 包围球半径 − 1（弯折光线须在球内完成盘交），内缘下限 1.5 r_s）
 */
export function clampDiskRadii(innerRs: number, outerRs: number): { innerRs: number; outerRs: number } {
  const outerMax = LENSING_DOMAIN_RADIUS_RS - 1;
  const inner0 = Number.isFinite(innerRs) ? innerRs : DISK_INNER_RADIUS_RS_DEFAULT;
  const outer0 = Number.isFinite(outerRs) ? outerRs : DISK_OUTER_RADIUS_RS_DEFAULT;
  const outer = Math.max(1.5 + DISK_RADII_MIN_GAP_RS, Math.min(outerMax, outer0));
  const inner = Math.max(1.5, Math.min(outer - DISK_RADII_MIN_GAP_RS, inner0));
  return { innerRs: inner, outerRs: outer };
}

/**
 * 归一化温度剖面 [0,1]：f(r) = NORM · (r/r_in)^(−3/4)·(1−√(r_in/r))^(1/4)
 *（Novikov-Thorne 近似 + 内缘截断，文件头登记）。r ≤ r_in 返回 0（内缘
 * 以内无稳定圆轨道，盘物质快速坠入不发光）；峰值 1 在 r = (49/36)·r_in。
 *
 * @throws RangeError 当 innerRs 非 >1 有限数
 */
export function diskTemperatureFactor01(rRs: number, innerRs: number): number {
  if (!Number.isFinite(innerRs) || innerRs <= 1) {
    throw new RangeError(`盘内缘半径须为 >1 的有限数（r_s），收到 ${innerRs}`);
  }
  if (!Number.isFinite(rRs) || rRs <= innerRs) return 0;
  const u = rRs / innerRs;
  const trunc = 1 - 1 / Math.sqrt(u);
  const f = Math.pow(u, -0.75) * Math.pow(trunc, 0.25) * DISK_TEMP_PROFILE_NORM;
  return Math.max(0, Math.min(1, f));
}

/** 盘温（K）= 峰值温度 × 归一化剖面 */
export function diskTemperatureK(
  rRs: number,
  innerRs: number,
  peakK: number = DISK_TEMP_PEAK_K_DEFAULT,
): number {
  return peakK * diskTemperatureFactor01(rRs, innerRs);
}

/**
 * 开普勒圆轨道局域速度 β = √[(r_s/2)/(r − r_s)]（静止观察者测得，
 * Schwarzschild 精确式；ISCO r = 3 r_s 处恰 0.5）。上限钳 DISK_BETA_MAX、
 * r ≤ 1 时取上限（数值防护，盘域内不可达）。
 */
export function diskKeplerianBeta(rRs: number): number {
  if (!Number.isFinite(rRs) || rRs <= 1) return DISK_BETA_MAX;
  return Math.min(Math.sqrt(0.5 / (rRs - 1)), DISK_BETA_MAX);
}

/**
 * 引力红移因子 g = √(1 − r_s/r) ∈ (0,1]（静止发射体 → 无穷远近似，
 * 文件头登记）；下限钳 GRAV_REDSHIFT_FLOOR 防归零除法
 */
export function gravitationalRedshiftFactor(rRs: number): number {
  if (!Number.isFinite(rRs) || rRs <= 1) return GRAV_REDSHIFT_FLOOR;
  return Math.max(Math.sqrt(1 - 1 / rRs), GRAV_REDSHIFT_FLOOR);
}

/**
 * 相对论多普勒因子 δ = √(1−β²) / (1 − β·cosθ)
 *
 * @param beta 源速度 v/c（钳 [0, 0.999]）
 * @param cosTheta 源速度与"指向观察者的光子方向"夹角余弦（钳 [−1,1]）
 * @returns δ > 1 接近（蓝移增亮）、δ < 1 远离（红移减暗）
 */
export function dopplerFactor(beta: number, cosTheta: number): number {
  const b = Math.max(0, Math.min(0.999, Number.isFinite(beta) ? beta : 0));
  const c = Math.max(-1, Math.min(1, Number.isFinite(cosTheta) ? cosTheta : 0));
  return Math.sqrt(1 - b * b) / Math.max(1 - b * c, 1e-3);
}

/**
 * 束流亮度因子 = δ_eff³ × g³（δ_eff = δ^strength，§R4-12 δ³ 近似 +
 * 引力红移减暗，文件头登记；strength=0 时只剩引力项 g³）
 */
export function diskBeamedBrightness(delta: number, grav: number, beamStrength: number): number {
  const dEff = Math.pow(Math.max(delta, 1e-3), Math.max(0, beamStrength));
  const g = Math.max(grav, GRAV_REDSHIFT_FLOOR);
  return dEff * dEff * dEff * g * g * g;
}

/** 观测色温（K）= 盘温 × δ_eff × g（多普勒蓝/红移 + 引力红移，shader 同式） */
export function diskObservedTemperatureK(
  baseK: number,
  delta: number,
  grav: number,
  beamStrength: number,
): number {
  const dEff = Math.pow(Math.max(delta, 1e-3), Math.max(0, beamStrength));
  return baseK * dEff * Math.max(grav, GRAV_REDSHIFT_FLOOR);
}

/**
 * 盘平面跨越线性插值参数 t ∈ [0,1]：步进前后两点盘面高度 y0/y1 异号时
 * 交点 = p0 + t·(p1−p0)（shader 同式；y0 = y1 时返回 0.5 防除零）
 */
export function planeCrossingLerp(y0: number, y1: number): number {
  const d = y0 - y1;
  if (!Number.isFinite(d) || Math.abs(d) < 1e-12) return 0.5;
  return Math.max(0, Math.min(1, y0 / d));
}

/**
 * 黑体色 LUT 数据（RGBA Uint8Array，宽 × 1）：温度域
 * [DISK_LUT_TEMP_MIN_K, DISK_LUT_TEMP_MAX_K] 线性采样
 * `starPhysics.blackbodyRGB`（R4-6 复用，§R4-12）。确定性纯函数——
 * 双次调用逐字节一致（单测断言）；alpha 恒 255。
 *
 * @throws RangeError 当 width 非 ≥2 整数
 */
export function buildBlackbodyLutData(width: number = DISK_LUT_WIDTH): Uint8Array<ArrayBuffer> {
  if (!Number.isInteger(width) || width < 2) {
    throw new RangeError(`LUT 宽度须为 ≥2 整数，收到 ${width}`);
  }
  const data = new Uint8Array(width * 4);
  for (let i = 0; i < width; i += 1) {
    const t =
      DISK_LUT_TEMP_MIN_K + ((DISK_LUT_TEMP_MAX_K - DISK_LUT_TEMP_MIN_K) * i) / (width - 1);
    const rgb = blackbodyRGB(t);
    data[i * 4] = Math.round(rgb.r * 255);
    data[i * 4 + 1] = Math.round(rgb.g * 255);
    data[i * 4 + 2] = Math.round(rgb.b * 255);
    data[i * 4 + 3] = 255;
  }
  return data;
}

// ---------------------------------------------------------------------------
// 程序化星场 cubemap 面数据（§R4-11：128px/面程序化生成，勿引入贴图资产）
// ---------------------------------------------------------------------------

/** 星场 cubemap 面边长（px） */
export const STARFIELD_FACE_SIZE = 128;

/** 每面恒星数 */
export const STARFIELD_STARS_PER_FACE = 180;

/**
 * 恒星温度色板（O/B 蓝 → M 红，`Starfield.tsx` STAR_COLORS 同源观感），
 * sRGB 0–255 分量
 */
export const STARFIELD_PALETTE: ReadonlyArray<readonly [number, number, number]> = [
  [155, 176, 255],
  [170, 191, 255],
  [202, 215, 255],
  [248, 247, 255],
  [255, 244, 234],
  [255, 210, 161],
  [255, 204, 111],
];

/** FNV-1a 字符串哈希 → 32 位无符号种子（volumeSeed 同式，单点复用语义） */
export function lensingSeed(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i += 1) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * 生成单面星场 RGBA 数据（确定性：seed + faceIndex 展开；附录 A §2）
 *
 * 黑底 + 高斯点扩散小星点（σ ~ 0.5–1.1 px），亮度/色温经种子随机流预生成。
 * 面间无缝拼接未做（各面独立随机流），128px 随机星点下接缝不可辨，登记为近似。
 *
 * @param faceIndex cubemap 面序（0–5，+x/-x/+y/-y/+z/-z）
 * @param size 面边长（默认 128）
 * @param seed 确定性种子（默认 lensingSeed('blackhole-starfield')）
 * @returns RGBA Uint8Array（size×size×4）
 */
export function buildStarfieldFaceData(
  faceIndex: number,
  size: number = STARFIELD_FACE_SIZE,
  seed: number = lensingSeed('blackhole-starfield'),
): Uint8Array {
  const rand = createSeededRandom(((seed >>> 0) + Math.imul(faceIndex + 1, 0x9e3779b1)) >>> 0);
  const data = new Uint8Array(size * size * 4);
  // alpha 全 255（不透明黑底）
  for (let i = 3; i < data.length; i += 4) {
    data[i] = 255;
  }
  const starCount = Math.round(STARFIELD_STARS_PER_FACE * (size / STARFIELD_FACE_SIZE) ** 2);
  for (let s = 0; s < starCount; s += 1) {
    const cx = rand() * size;
    const cy = rand() * size;
    // 亮度幂分布（暗星多亮星少）
    const brightness = 0.25 + 0.75 * rand() ** 2.2;
    const sigma = 0.5 + 0.6 * rand();
    const color = STARFIELD_PALETTE[Math.floor(rand() * STARFIELD_PALETTE.length)];
    const radius = Math.ceil(sigma * 2.5);
    const x0 = Math.max(0, Math.floor(cx - radius));
    const x1 = Math.min(size - 1, Math.ceil(cx + radius));
    const y0 = Math.max(0, Math.floor(cy - radius));
    const y1 = Math.min(size - 1, Math.ceil(cy + radius));
    const inv2s2 = 1 / (2 * sigma * sigma);
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        const ddx = x + 0.5 - cx;
        const ddy = y + 0.5 - cy;
        const w = brightness * Math.exp(-(ddx * ddx + ddy * ddy) * inv2s2);
        if (w < 0.004) continue;
        const idx = (y * size + x) * 4;
        data[idx] = Math.min(255, data[idx] + Math.round(color[0] * w));
        data[idx + 1] = Math.min(255, data[idx + 1] + Math.round(color[1] * w));
        data[idx + 2] = Math.min(255, data[idx + 2] + Math.round(color[2] * w));
      }
    }
  }
  return data;
}
