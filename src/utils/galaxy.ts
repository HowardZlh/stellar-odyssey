/**
 * 银河系结构与太阳系绕银心运动（需求 3.1.2）
 *
 * 坐标约定：银心系"银河系本地坐标"，银道面为 x-z 平面，y 轴垂直银盘，
 * 单位为光年（ly）。渲染组件负责把该本地坐标系整体倾斜 60.2°
 * （黄道面-银道面夹角）并平移到场景位置，本文件不处理倾斜。
 *
 * 运动规则（防静态化，需求 3.1.2）：
 * - 太阳系绕银心公转（银河年约 2.3 亿年）+ 垂直银盘正弦振荡 → 波浪轨迹；
 * - 银盘粒子按平坦旋转曲线较差自转（线速度恒定 → 内圈角速度大于外圈），
 *   禁止整体刚性旋转。
 *
 * 数据来源：
 * - 银盘直径约 10 万光年、厚约 1 千光年（NASA / ESA 银河系概况）
 * - 太阳距银心约 8 kpc ≈ 2.6 万光年，公转线速度约 220 km/s，
 *   银河年约 2.3 亿年（Reid et al. 2014, ApJ；IAU 推荐值）
 * - 太阳垂直银盘振荡周期约 7000 万年、振幅约 ±70–100 pc
 *   （Bahcall & Bahcall 1985, Nature）
 * - 黄道面与银道面夹角约 60.2°（IAU 银道坐标系定义）
 *
 * ── 数据自洽修正（P6，需求 3.1.2 §3.1.2 / §5）──────────────────────────
 * 三个观测量「银河年 230 Myr、太阳距银心 26000 ly、旋转线速度 220 km/s」
 * 并不能同时严格成立：圆周运动约束 v = ω·R = (2π/T)·R 要求三者联动。
 *   - 由 T=230 Myr、v=220 km/s 反推 R = v·T/(2π) ≈ 26863 ly ≈ 8.24 kpc；
 *   - 原取 R=26000 ly 时，v/R 推出的角速度（0.02823 rad/Myr）比
 *     2π/230（0.02732 rad/Myr）大约 3.3%，导致「银河年进度」与「粒子较差
 *     自转/太阳邻域相对速度」两套演算相互矛盾。
 * 自洽方案（本项目采纳，登记）：**固定 T=230 Myr 与 v=220 km/s**（二者为
 * 最常被引用、且直接呈现在 HUD 的圆整值），令太阳银心距离随之取
 * SUN_GALACTIC_RADIUS_LY = 26863 ly（≈8.24 kpc，落在 IAU R₀≈8.0–8.3 kpc
 * 观测区间内，故科学上完全成立）。修正后：
 *   diskAngularSpeedRadPerMyr(SUN_GALACTIC_RADIUS_LY) === 2π/GALACTIC_YEAR_MYR
 * 精确成立（单测断言），银河年进度与旋转曲线角速度一致，3% 偏差消除。
 * 参考：IAU 推荐 R₀≈8.178 kpc（GRAVITY Collab. 2019）、Θ₀≈220–233 km/s
 * （Reid et al. 2014；McMillan 2017），本组合处于推荐范围内。
 *
 * ── R2-9 L4 银河系真实感重构（艺术化/近似处理登记）──────────────────────
 * 1. 3D 恒星银晕：稀疏粒子按数密度 n(r) ∝ r^-3.5 采样（观测银晕恒星密度
 *    幂律指数约 −3.5，Helmi 2008 A&ARv 综述），可视截断 [10,000, 80,000] ly
 *    （真实银晕延伸 >100 kpc，外围过暗无可视价值，截断为已登记近似）；
 *    轻微垂直压扁 q≈0.9（观测 q≈0.6–0.9 区间内取偏球值以强化立体包裹感）。
 * 2. 球状星团系统：真实银河系约 150+ 个（Harris 1996 目录），本项目呈现
 *    29 个程序化代表 + M13（L3 特殊天体条目，同一对象不重复渲染，程序化
 *    生成时在其 t=0 银心系位置周围留排除区）共 30 个，落在需求 20–40 区间；
 *    分布特征保留"中心聚集 + 高银纬"两条真实统计性质，具体位置为确定性
 *    伪随机（非真实目录坐标，已登记）。
 * 3. 棒结构：银河系为棒旋星系 SBbc，棒半长约 4 kpc≈13,000 ly、图案角速度
 *    Ω_b≈39 km/s/kpc≈0.04 rad/Myr（Bland-Hawthorn & Gerhard 2016 区间
 *    33–45 km/s/kpc）。棒粒子以 Ω_b 刚性旋转（区别于盘粒子较差自转），
 *    时间回卷（GALAXY_SHADER_MYR_WRAP）时棒整体相位一次性跳转——与旋臂
 *    密度波图案回卷行为一致，属已登记统计近似。旋臂对数螺旋起点未与棒端
 *    严格对接（沿用既有旋臂相位公式，艺术化差异登记）。
 * 4. 尘埃带侧视剪影：加性混合无法"画暗"，以「侧视时盘中平面粒子亮度
 *    衰减 + 红化」近似尘埃吸光（真实为视线积分消光，视角依赖调制为
 *    艺术化手法，已登记）；正视时旋臂内侧尘埃暗纹沿用既有 shader。
 *
 * ── R5-6 HI 翘曲盘（Levine, Blitz & Heiles 2006 近似参数登记）────────────
 * 外盘（r > 35,000 ly）叠加 m=1 S 形垂直位移 warpYLy(r, φ) =
 * A(r)·sin(φ − φ₀)：Levine et al. 2006 测得银河系 HI 盘 m=1 翘曲模在
 * R ≳ 10–16 kpc 起振、振幅随半径增长（R≈25 kpc 处达 ~2 kpc 量级）。
 * 近似登记：① 本项目银盘可视截断于 50,000 ly（≈15.3 kpc），真实该半径处
 * 振幅仅 ~0.3 kpc，按"侧视可辨"验收目标将盘缘振幅艺术化放大至
 * 3,000 ly（≈0.9 kpc，量级仍取自 Levine m=1 径向增长趋势）；② 振幅径向
 * 增长取二次方（起点 C¹ 连续，Levine 近似线性增长的平滑化）；③ 交点线
 * （line of nodes）取本地坐标 +x 轴（φ₀=0，太阳–银心方向，方位近似
 * 登记）；④ 位移为 CPU 生成期一次性烘焙（warpsLy 通道），粒子较差自转
 * 后图案随恒星绕转缓慢缠绕（生成期近似登记，t=0 形态与文献相位对应）；
 * ⑤ morph 组合：warp 为基线位移，R2-11 uEll / R3-7 uExpand 的椭球目标
 * 高度仍由未翘曲 aHeightLy 派生 → 终态椭球无翘曲、组合无形变放大
 * （CPU 镜像 diskWarpMorphYLy，单测断言组合顺序）。
 */

import type { Vec3 } from '@/types';
import { normalizeAngle } from '@/utils/physics';
import { createSeededRandom } from '@/utils/random';
import { sampleStarColor, srgbToLinear01 } from '@/utils/starPopulation';

/** 银盘半径（光年）：银盘直径约 10 万光年 */
export const GALACTIC_DISK_RADIUS_LY = 50000;

/** 银盘厚度（光年）：薄盘约 1 千光年 */
export const GALACTIC_DISK_THICKNESS_LY = 1000;

/** 核球半径（光年）：中心核球半径约 8 千光年 */
export const GALACTIC_BULGE_RADIUS_LY = 8000;

/** 银河年（百万年）：太阳绕银心一圈约 2.3 亿年（自洽基准量，见文件头） */
export const GALACTIC_YEAR_MYR = 230;

/** 银盘旋转线速度（km/s）：平坦旋转曲线，太阳附近约 220 km/s（自洽基准量，见文件头） */
export const GALACTIC_ROTATION_KM_S = 220;

/**
 * 速度换算：1 km/s ≈ 3.3357 光年/百万年
 * 推导：1 km/s × 3.1557e13 s/Myr ÷ 9.4607e12 km/ly ≈ 3.3357 ly/Myr
 */
export const KM_S_TO_LY_PER_MYR = 3.3357;

/**
 * 太阳距银心距离（光年）：≈ 8.24 kpc ≈ 2.69 万光年
 *
 * 自洽取值（见文件头「数据自洽修正」）：由 v=220 km/s、T=230 Myr 反推
 * R = v·T/(2π)。刻意选取使 diskAngularSpeedRadPerMyr(R) 精确等于 2π/T，
 * 消除银河年进度与旋转曲线角速度间约 3.3% 的历史偏差；数值落在 IAU R₀
 * 观测区间（8.0–8.3 kpc）内，科学成立。
 */
export const SUN_GALACTIC_RADIUS_LY =
  (GALACTIC_ROTATION_KM_S * KM_S_TO_LY_PER_MYR * GALACTIC_YEAR_MYR) / (Math.PI * 2);

/** 太阳垂直银盘振荡周期（百万年）：约 7000 万年 */
export const SUN_VERTICAL_PERIOD_MYR = 70;

/** 太阳垂直振荡振幅（光年）：300 ly ≈ 92 pc，处于观测范围 ±70–100 pc 内 */
export const SUN_VERTICAL_AMPLITUDE_LY = 300;

/** 黄道面与银道面夹角（度），渲染端使用 */
export const ECLIPTIC_GALACTIC_TILT_DEG = 60.2;

/** 1 百万年的天数（儒略年 365.25 天） */
export const DAYS_PER_MYR = 365.25e6;

/**
 * 模拟天数 → 百万年（Myr）
 */
export function simDaysToMyr(simDays: number): number {
  return simDays / DAYS_PER_MYR;
}

/**
 * 太阳系在银心系中的位置（光年）
 *
 * - 公转：θ = 2π·t/230（t 单位 Myr，t=0 时 θ=0，从 +x 轴开始），
 *   x = R·cosθ，z = −R·sinθ（自 +y 俯视为逆时针）
 * - 垂直振荡：y = 300·sin(2π·t/70)，与公转叠加形成波浪轨迹（需求 3.1.2）
 */
export function sunGalacticPositionLy(simDays: number): Vec3 {
  const tMyr = simDaysToMyr(simDays);
  const theta = (Math.PI * 2 * tMyr) / GALACTIC_YEAR_MYR;
  const y =
    SUN_VERTICAL_AMPLITUDE_LY * Math.sin((Math.PI * 2 * tMyr) / SUN_VERTICAL_PERIOD_MYR);
  return {
    x: SUN_GALACTIC_RADIUS_LY * Math.cos(theta),
    y,
    z: -SUN_GALACTIC_RADIUS_LY * Math.sin(theta),
  };
}

/**
 * 银河年进度（用于 UI 展示）
 *
 * @returns angleRad 当前公转角（规范化到 [0, 2π)）；
 *          orbits 已完成整圈数（向下取整，t 为负时给出负圈数）；
 *          progress01 当前圈进度（angleRad / 2π）
 */
export function galacticYearProgress(simDays: number): {
  angleRad: number;
  orbits: number;
  progress01: number;
} {
  const tMyr = simDaysToMyr(simDays);
  const rawAngle = (Math.PI * 2 * tMyr) / GALACTIC_YEAR_MYR;
  const angleRad = normalizeAngle(rawAngle);
  const orbits = Math.floor(rawAngle / (Math.PI * 2));
  return { angleRad, orbits, progress01: angleRad / (Math.PI * 2) };
}

/**
 * 银盘角速度（弧度/百万年）—— 平坦旋转曲线
 *
 * 观测表明银河系旋转曲线在大范围内近似平坦（线速度恒定约 220 km/s，
 * 暗物质晕贡献），因此 ω(r) = v/r = 220·3.3357/r（rad/Myr）。
 * 该函数保证内圈角速度 > 外圈（较差自转，需求 3.1.2 防静态化）。
 */
export function diskAngularSpeedRadPerMyr(radiusLy: number): number {
  if (radiusLy <= 0) {
    throw new RangeError(`银盘半径必须为正数，收到 ${radiusLy}`);
  }
  return (GALACTIC_ROTATION_KM_S * KM_S_TO_LY_PER_MYR) / radiusLy;
}

/**
 * 银盘粒子当前方位角（弧度）：初始相位 + ω(r)·t
 *
 * 与渲染端顶点着色器公式一致的 CPU 参考实现（保证可测试性）。
 */
export function diskParticleAngle(
  initialPhaseRad: number,
  radiusLy: number,
  simDays: number,
): number {
  return initialPhaseRad + diskAngularSpeedRadPerMyr(radiusLy) * simDaysToMyr(simDays);
}

/**
 * 银盘 shader 时间回卷窗口（Myr）：2048 百万年。
 *
 * 背景（与 utils/belts.ts BELT_TIME_WRAP_DAYS 同类的 bug 防护）：
 * 银盘顶点着色器以 float32 计算 angle = phase + ω·t，ω 上限约
 * 220·3.3357/500 ≈ 1.47 rad/Myr（着色器内圈钳制半径 500 光年）。
 * 宇宙视角长时间驻留可使 t 达 10⁵ Myr 量级，ω·t 超出 float32 与
 * GPU sin/cos 距离归约的可靠范围，银盘粒子会坍缩/抖动。
 *
 * 处理（已登记的统计近似）：传给 shader 的时间按本窗口取模，
 * ω·t ≤ 约 3006 弧度。银盘是统计粒子环（不追踪具体恒星），窗口跨越时
 * 粒子沿各自圆轨道相位一次性重排，较差自转（内快外慢）与密度波调制
 * 结构保持，重排前后外观分布一致，无可感知影响。
 */
export const GALAXY_SHADER_MYR_WRAP = 2048;

/**
 * 银盘 shader 时间（Myr）：按 GALAXY_SHADER_MYR_WRAP 回卷到 [0, W)
 *
 * t < W（约 8.9 个银河年内）时恒等返回，行为与未回卷完全一致。
 */
export function galaxyShaderMyr(myr: number): number {
  if (!Number.isFinite(myr)) {
    throw new RangeError(`模拟时间必须为有限数，收到 ${myr}`);
  }
  const wrapped = myr % GALAXY_SHADER_MYR_WRAP;
  return wrapped < 0 ? wrapped + GALAXY_SHADER_MYR_WRAP : wrapped;
}

// ---------------------------------------------------------------------------
// 旋臂密度波（可选需求 3.1.2 高级项）
// ---------------------------------------------------------------------------

/**
 * 旋臂图案角速度（弧度/百万年）
 *
 * 密度波理论：旋臂图案以恒定角速度 Ω_p 刚性旋转，与恒星较差自转不同。
 * 取 Ω_p ≈ 0.020 rad/Myr（对应共转半径约 3.7 万光年，在太阳轨道之外），
 * 太阳附近恒星角速度 ω(R_sun) = 2π/230 ≈ 0.0273 rad/Myr > Ω_p（P6 自洽修正后，
 * 见文件头；修正前误取 R=26000 得 0.0282），
 * 因此太阳系约每 3 亿年相对旋臂图案前移一个旋臂间隔（周期性穿越旋臂）。
 * 来源：Lin & Shu (1964) 密度波理论；共转半径取值为示意近似（已登记）。
 */
export const ARM_PATTERN_SPEED_RAD_PER_MYR = 0.02;

/** 密度波亮度对比度（旋臂内粒子相对臂间的增亮幅度） */
export const DENSITY_WAVE_CONTRAST = 0.55;

/** 密度波参数 */
export interface DensityWaveParams {
  /** 旋臂数（4） */
  armCount: number;
  /** 图案角速度（弧度/百万年） */
  patternSpeedRadPerMyr: number;
  /** 螺旋紧密度（与银盘粒子生成一致） */
  spiralTightness: number;
  /** 核球半径（光年，对数螺旋参考半径） */
  bulgeRadiusLy: number;
  /** 亮度对比度（0-1） */
  contrast: number;
}

/**
 * 旋臂密度波亮度因子（可选需求：旋臂图案转速与恒星公转速度不同）
 *
 * 粒子当前方位角 θ 与"以 Ω_p 刚性旋转的对数螺旋图案"的相位差决定亮度：
 * factor = 1 + contrast·cos(m·(θ − Ω_p·t − tightness·ln(1 + r/r_bulge)))
 * 归一化到 [1 − contrast, 1 + contrast]。
 * 恒星以 ω(r) 公转、图案以 Ω_p 旋转 → 恒星周期性穿越旋臂（太阳系亦然）。
 *
 * 与渲染端顶点着色器公式一致的 CPU 参考实现（保证可测试性）。
 */
export function densityWaveBrightness(
  thetaRad: number,
  radiusLy: number,
  tMyr: number,
  params: DensityWaveParams,
): number {
  if (radiusLy <= 0) {
    throw new RangeError(`半径必须为正数，收到 ${radiusLy}`);
  }
  if (params.contrast < 0 || params.contrast > 1) {
    throw new RangeError(`对比度必须在 [0, 1] 内，收到 ${params.contrast}`);
  }
  const patternPhase =
    params.patternSpeedRadPerMyr * tMyr +
    params.spiralTightness * Math.log(1 + radiusLy / params.bulgeRadiusLy);
  return 1 + params.contrast * Math.cos(params.armCount * (thetaRad - patternPhase));
}

// ---------------------------------------------------------------------------
// 棒结构（R2-9 §9.1：银河系为棒旋星系 SBbc，俯视棒状核心可辨）
// ---------------------------------------------------------------------------

/**
 * 棒图案角速度（弧度/百万年）：Ω_b ≈ 39 km/s/kpc ≈ 0.04 rad/Myr
 * （Bland-Hawthorn & Gerhard 2016, ARA&A：观测区间 33–45 km/s/kpc）。
 * 棒为刚体图案：所有棒粒子共用该角速度（区别于盘粒子较差自转）。
 */
export const BAR_PATTERN_SPEED_RAD_PER_MYR = 0.04;

/** 棒半长（光年）：约 4 kpc ≈ 13,000 ly（Bland-Hawthorn & Gerhard 2016） */
export const GALACTIC_BAR_HALF_LENGTH_LY = 13000;

/** 棒短轴/长轴比（观测约 0.4，取 0.32 强化俯视可辨性，艺术化登记） */
export const GALACTIC_BAR_AXIS_RATIO = 0.32;

/** 棒厚度（光年）：比薄盘厚、比核球扁（示意值） */
export const GALACTIC_BAR_THICKNESS_LY = 3000;

/**
 * 棒粒子当前方位角（弧度）：初始相位 + Ω_b·t（刚性旋转，与半径无关）
 *
 * 与渲染端顶点着色器 mix(ω(r), Ω_b, aBar) 中 aBar=1 分支一致的 CPU 参考实现。
 */
export function barParticleAngle(initialPhaseRad: number, simDays: number): number {
  return initialPhaseRad + BAR_PATTERN_SPEED_RAD_PER_MYR * simDaysToMyr(simDays);
}

// ---------------------------------------------------------------------------
// R5-6 HI 翘曲盘（m=1 S 形垂直位移，Levine, Blitz & Heiles 2006 近似，
// 参数与近似项登记见文件头）
// ---------------------------------------------------------------------------

/** HI 翘曲起始半径（光年）：内盘（r ≤ 本值）零位移 */
export const GALACTIC_WARP_START_LY = 35000;

/** 盘缘（GALACTIC_DISK_RADIUS_LY 处）翘曲振幅（光年，艺术化放大登记） */
export const GALACTIC_WARP_AMP_EDGE_LY = 3000;

/** m=1 翘曲交点线相位 φ₀（弧度；取 +x 轴 = 太阳–银心方向，近似登记） */
export const GALACTIC_WARP_PHASE_RAD = 0;

/**
 * HI 翘曲垂直位移（光年）：m=1 S 形 warp = A(r)·sin(φ − φ₀)
 *
 * A(r)：r ≤ 起始半径为 0；向外二次增长（起点 C¹ 连续），盘缘
 * （GALACTIC_DISK_RADIUS_LY）处达 GALACTIC_WARP_AMP_EDGE_LY。
 * m=1：方位角相对两侧一升一降（sin 反号）→ 侧视 S 形。
 *
 * @param rLy 银盘面内半径（光年，≥0）
 * @param phiRad 方位角（弧度）
 * @throws RangeError 当输入非有限数或 rLy < 0
 */
export function warpYLy(rLy: number, phiRad: number): number {
  if (!Number.isFinite(rLy) || !Number.isFinite(phiRad)) {
    throw new RangeError(`翘曲输入必须为有限数，收到 (${rLy}, ${phiRad})`);
  }
  if (rLy < 0) {
    throw new RangeError(`半径必须 ≥ 0，收到 ${rLy}`);
  }
  if (rLy <= GALACTIC_WARP_START_LY) return 0;
  const t =
    (rLy - GALACTIC_WARP_START_LY) / (GALACTIC_DISK_RADIUS_LY - GALACTIC_WARP_START_LY);
  return GALACTIC_WARP_AMP_EDGE_LY * t * t * Math.sin(phiRad - GALACTIC_WARP_PHASE_RAD);
}

/**
 * 盘粒子最终垂直位置（光年）——渲染端顶点着色器组合链的 CPU 镜像
 * （R5-6 组合顺序单测锚定，`Scene/Galaxy.tsx` 盘 shader 同式）：
 *
 *   y₀ = aHeightLy + aWarpLy（warp 为生成期基线位移）
 *   hT = (aHeightLy / 500)·max(aRadiusLy, 6000)·0.5（椭球目标，
 *        由未翘曲高度派生——防翘曲被 morph 放大 ~r/1000 倍形变异常）
 *   y  = mix(mix(y₀, hT, uEll), hT, uExpand)
 *
 * 性质（单测断言）：uEll=uExpand=0 → y₀（翘曲完整呈现）；任一权重达 1
 * → hT（终态椭球/展开态无翘曲）；等价闭式 y = (1−w)·y₀ + w·hT，
 * w = combinedMorphWeight(uEll, uExpand)。
 *
 * @throws RangeError 当权重不在 [0,1] 或输入非有限数
 */
export function diskWarpMorphYLy(
  heightLy: number,
  warpLy: number,
  radiusLy: number,
  ell: number,
  expand: number,
): number {
  if (
    !Number.isFinite(heightLy) ||
    !Number.isFinite(warpLy) ||
    !Number.isFinite(radiusLy)
  ) {
    throw new RangeError(`输入必须为有限数，收到 (${heightLy}, ${warpLy}, ${radiusLy})`);
  }
  if (!(ell >= 0 && ell <= 1) || !(expand >= 0 && expand <= 1)) {
    throw new RangeError(`morph 权重必须在 [0,1] 内，收到 (${ell}, ${expand})`);
  }
  const hTargetLy = (heightLy / 500) * Math.max(radiusLy, 6000) * 0.5;
  const y0 = heightLy + warpLy;
  const y1 = y0 + (hTargetLy - y0) * ell;
  return y1 + (hTargetLy - y1) * expand;
}

/** 银盘粒子生成参数 */
export interface GalaxyDiskParams {
  /** 粒子数 */
  count: number;
  /** 确定性种子 */
  seed: number;
  /** 主旋臂数：4（英仙臂、人马臂、矩尺臂、盾牌-半人马臂） */
  armCount: number;
  /** 银盘半径（光年） */
  diskRadiusLy: number;
  /** 银盘厚度（光年） */
  thicknessLy: number;
  /** 核球半径（光年） */
  bulgeRadiusLy: number;
  /** 核球粒子占比（0-1） */
  bulgeFraction: number;
  /** 螺旋紧密度（附录A 参考 1.2） */
  spiralTightness: number;
  /** 旋臂宽度（相位抖动标准差，弧度） */
  armSpreadRad: number;
  /** 棒粒子占比（0-1，缺省 0 = 无棒，R2-9 棒旋结构） */
  barFraction?: number;
  /** 棒半长（光年，缺省 GALACTIC_BAR_HALF_LENGTH_LY） */
  barHalfLengthLy?: number;
  /** 棒短轴/长轴比（缺省 GALACTIC_BAR_AXIS_RATIO） */
  barAxisRatio?: number;
  /** 棒厚度（光年，缺省 GALACTIC_BAR_THICKNESS_LY） */
  barThicknessLy?: number;
  /**
   * 颜色模式（SC1）：缺省 `'starPopulation'` = 星族采样器发光加权连续
   * 颜色（线性 RGB，银河系主盘）；`'legacyPalette'` = 7 色硬编码色板
   * 均匀抽样（sRGB，SC1 前历史行为）——仅近观星系层
   * （galaxyNearView.generateSpiralParticles）消费，保证该范围外层
   * 输出逐字节零变化（§0.4 回归红线；随机数消耗序列亦须一致，
   * 故整个颜色分支按历史代码原样保留）。
   */
  colorMode?: 'starPopulation' | 'legacyPalette';
}

/** 银盘粒子数组（结构化数组，供 InstancedMesh / Points 直接上传） */
export interface GalaxyDiskParticles {
  count: number;
  /** 银盘面内半径（光年） */
  radiiLy: Float32Array;
  /** 初始方位角（弧度，含旋臂结构） */
  phases: Float32Array;
  /** 垂直高度（光年，未含翘曲——morph 椭球目标由本通道派生） */
  heightsLy: Float32Array;
  /** R5-6 HI 翘曲垂直位移（光年，生成期一次性烘焙；内盘/核球/棒为 0） */
  warpsLy: Float32Array;
  /** RGB 颜色（count*3，0-1） */
  colors: Float32Array;
  /** 粒子大小，中心大边缘小（1.0–2.5） */
  sizes: Float32Array;
  /** 棒结构标记（1=棒粒子按 Ω_b 刚性旋转；0=较差自转，R2-9） */
  barFlags: Float32Array;
}

/**
 * 恒星色板（SC1 降级登记）：7 色硬编码均匀抽样的历史路径，仅
 * `colorMode: 'legacyPalette'`（近观星系层）消费——银河系主盘已切换
 * 星族采样器（starPopulation.ts）。参考：Mitchell Charity 黑体色近似。
 */
const LEGACY_STAR_PALETTE: readonly string[] = [
  '#9bb0ff',
  '#aabfff',
  '#cad7ff',
  '#f8f7ff',
  '#fff4ea',
  '#ffd2a1',
  '#ffcc6f',
];

/** 核球暖黄色调（legacyPalette 路径专用；主盘核球经 bulge 星族采样） */
const LEGACY_BULGE_COLOR = '#ffd9a0';

/**
 * 旋臂区域星云粉色（电离氢区示意色）
 *
 * SC1 登记：主盘（starPopulation 模式）恒星颜色为线性 RGB，本常量在
 * 生成期同步转线性（srgbToLinear01），保持全盘顶点色同一工作色彩
 * 空间；8% 掺入机制原样保留（§SC1-2）。legacyPalette 路径仍用 sRGB
 * 原值（历史行为逐字节保持）。
 */
const NEBULA_PINK = '#ff9bb5';

/** 核球垂直方向压扁系数（核球比银盘厚、但仍略扁） */
const BULGE_FLATTENING = 0.6;

/** 臂间弥散星占盘粒子比例（约 20%） */
const INTER_ARM_FRACTION = 0.2;

/** 旋臂粒子中星云粉色比例（少量掺入） */
const NEBULA_FRACTION = 0.08;

/**
 * 确定性生成银盘粒子（需求 4.4：粒子大小/密度中心到边缘渐变、≥6 种恒星颜色混合）
 *
 * 颜色（SC1）：星族采样器 `sampleStarColor`（starPopulation.ts，发光加权
 * Teff 采样 → blackbodyRGB 连续颜色，线性 RGB）——核球/棒 → bulge、
 * 旋臂 → youngDisk、臂间 → oldDisk；HII 粉 8% 掺入保留。
 *
 * - 核球（bulgeFraction 占比）：半径 bulgeRadiusLy 内三维近球状分布
 *   （略压扁），老年星族红黄色调，高度分布比薄盘厚；
 * - 盘粒子：半径 r = √rand·diskRadius（中心更密）；
 *   相位 = 臂序号·(2π/armCount) + spiralTightness·ln(1 + r/bulgeRadius)
 *          + 高斯抖动（Box-Muller）·armSpreadRad（对数螺旋臂），
 *   其中约 20% 为臂间弥散星（相位全随机）；
 * - 高度 = 高斯 × thickness/2 × (1 − 0.5·r/diskRadius)（外缘更薄）；
 * - 翘曲（R5-6）= warpYLy(r, φ)（外盘 m=1 S 形，独立 warpsLy 通道，
 *   银河系渲染端叠加；近观星系复用本生成器时不消费该通道，登记）；
 * - 大小从中心 2.5 线性递减到边缘 1.0；
 * - 棒粒子（R2-9，barFraction 占比）：沿 x 轴的三轴椭球高斯分布
 *   （长半轴 barHalfLengthLy、短轴比 barAxisRatio、厚度 barThicknessLy），
 *   barFlags=1 → 渲染端以 Ω_b 刚性旋转保持棒形态不被较差自转剪切。
 */
export function generateGalaxyDiskParticles(params: GalaxyDiskParams): GalaxyDiskParticles {
  if (params.count <= 0 || !Number.isInteger(params.count)) {
    throw new RangeError(`粒子数必须为正整数，收到 ${params.count}`);
  }
  if (params.armCount < 1) {
    throw new RangeError(`旋臂数必须 ≥ 1，收到 ${params.armCount}`);
  }
  if (params.bulgeFraction < 0 || params.bulgeFraction > 1) {
    throw new RangeError(`核球粒子占比必须在 [0, 1] 内，收到 ${params.bulgeFraction}`);
  }
  const barFraction = params.barFraction ?? 0;
  if (barFraction < 0 || barFraction > 1 || params.bulgeFraction + barFraction > 1) {
    throw new RangeError(`棒粒子占比非法（核球+棒必须 ≤ 1），收到 ${barFraction}`);
  }
  const barHalfLengthLy = params.barHalfLengthLy ?? GALACTIC_BAR_HALF_LENGTH_LY;
  const barAxisRatio = params.barAxisRatio ?? GALACTIC_BAR_AXIS_RATIO;
  const barThicknessLy = params.barThicknessLy ?? GALACTIC_BAR_THICKNESS_LY;

  const rand = createSeededRandom(params.seed);
  const n = params.count;
  const result: GalaxyDiskParticles = {
    count: n,
    radiiLy: new Float32Array(n),
    phases: new Float32Array(n),
    heightsLy: new Float32Array(n),
    warpsLy: new Float32Array(n),
    colors: new Float32Array(n * 3),
    sizes: new Float32Array(n),
    barFlags: new Float32Array(n),
  };

  // SC1：legacy 路径（近观星系层专用）保持 sRGB 历史行为；主盘
  // starPopulation 模式 HII 粉转线性工作空间（与采样器输出同一色彩空间）
  const legacy = params.colorMode === 'legacyPalette';
  const legacyPalette = legacy ? LEGACY_STAR_PALETTE.map(hexToRgb) : [];
  const legacyBulge = hexToRgb(LEGACY_BULGE_COLOR);
  const pinkSrgb = hexToRgb(NEBULA_PINK);
  const pink = legacy
    ? pinkSrgb
    : {
        r: srgbToLinear01(pinkSrgb.r),
        g: srgbToLinear01(pinkSrgb.g),
        b: srgbToLinear01(pinkSrgb.b),
      };
  const bulgeCount = Math.round(n * params.bulgeFraction);
  const barCount = Math.round(n * barFraction);

  for (let i = 0; i < n; i += 1) {
    if (i >= bulgeCount && i < bulgeCount + barCount) {
      // ---- 棒粒子（R2-9）：t=0 沿 x 轴的三轴椭球高斯分布，刚性旋转 ----
      const along = clampAbs(gaussian(rand) * barHalfLengthLy * 0.45, barHalfLengthLy);
      const cross = clampAbs(
        gaussian(rand) * barHalfLengthLy * barAxisRatio * 0.45,
        barHalfLengthLy * barAxisRatio,
      );
      result.radiiLy[i] = Math.hypot(along, cross);
      result.phases[i] = normalizeAngle(Math.atan2(cross, along));
      result.heightsLy[i] = gaussian(rand) * (barThicknessLy / 2) * 0.5;
      result.barFlags[i] = 1;

      // SC1：棒与核球同为老年星族 II（bulge 预设，K/M 红黄 + 红巨星，
      // 禁 O/B）；legacy 路径保持单色 + 亮度抖动（随机数消耗序列一致性）
      if (legacy) {
        const brightness = 0.8 + 0.2 * rand();
        result.colors[i * 3] = legacyBulge.r * brightness;
        result.colors[i * 3 + 1] = legacyBulge.g * brightness;
        result.colors[i * 3 + 2] = legacyBulge.b * brightness;
      } else {
        const color = sampleStarColor('bulge', rand);
        result.colors[i * 3] = color.r;
        result.colors[i * 3 + 1] = color.g;
        result.colors[i * 3 + 2] = color.b;
      }
    } else if (i < bulgeCount) {
      // ---- 核球粒子：三维近球状分布（体积均匀 → 半径取立方根） ----
      const rr = params.bulgeRadiusLy * Math.cbrt(rand());
      const cosPolar = rand() * 2 - 1;
      const azimuth = Math.PI * 2 * rand();
      const sinPolar = Math.sqrt(1 - cosPolar * cosPolar);
      result.radiiLy[i] = rr * sinPolar;
      result.phases[i] = azimuth;
      result.heightsLy[i] = rr * cosPolar * BULGE_FLATTENING;

      // SC1：核球老年星族 II 采样（径向渐变归 SC2）；legacy 同上
      if (legacy) {
        const brightness = 0.85 + 0.15 * rand();
        result.colors[i * 3] = legacyBulge.r * brightness;
        result.colors[i * 3 + 1] = legacyBulge.g * brightness;
        result.colors[i * 3 + 2] = legacyBulge.b * brightness;
      } else {
        const color = sampleStarColor('bulge', rand);
        result.colors[i * 3] = color.r;
        result.colors[i * 3 + 1] = color.g;
        result.colors[i * 3 + 2] = color.b;
      }
    } else {
      // ---- 盘粒子：中心更密（√rand），对数螺旋旋臂 ----
      const r = Math.sqrt(rand()) * params.diskRadiusLy;
      result.radiiLy[i] = r;

      const isInterArm = rand() < INTER_ARM_FRACTION;
      if (isInterArm) {
        // 臂间弥散星：相位全随机
        result.phases[i] = Math.PI * 2 * rand();
      } else {
        const armIndex = Math.floor(rand() * params.armCount);
        const armPhase =
          armIndex * ((Math.PI * 2) / params.armCount) +
          params.spiralTightness * Math.log(1 + r / params.bulgeRadiusLy) +
          gaussian(rand) * params.armSpreadRad;
        result.phases[i] = normalizeAngle(armPhase);
      }

      // 高度：高斯 × 半厚度 × 外缘变薄因子
      result.heightsLy[i] =
        gaussian(rand) * (params.thicknessLy / 2) * (1 - 0.5 * (r / params.diskRadiusLy));
      // R5-6 HI 翘曲：外盘 m=1 S 形垂直位移（确定性派生自 r/φ，
      // 不消耗随机数——heightsLy 等既有通道逐字节不变；核球/棒半径
      // 恒在起始半径内位移为 0，仅盘粒子写入）
      result.warpsLy[i] = warpYLy(r, result.phases[i]);

      // SC1 颜色：星族采样器（发光加权，starPopulation.ts 唯一事实源）——
      // 旋臂 → youngDisk（年轻星族 I，蓝白为主）；臂间/弥散 → oldDisk
      // （中老年 F/G/K 黄橙）；旋臂 HII 粉红团块 8% 机制原样保留
      // （旋臂混入 oldDisk 底色的配比归 SC2，本阶段旋臂纯 youngDisk）。
      // legacy 路径 = 历史色板均匀抽样（近观星系层零变化）
      if (legacy) {
        const color =
          !isInterArm && rand() < NEBULA_FRACTION
            ? pink
            : legacyPalette[Math.floor(rand() * legacyPalette.length)];
        result.colors[i * 3] = color.r;
        result.colors[i * 3 + 1] = color.g;
        result.colors[i * 3 + 2] = color.b;
      } else if (!isInterArm && rand() < NEBULA_FRACTION) {
        result.colors[i * 3] = pink.r;
        result.colors[i * 3 + 1] = pink.g;
        result.colors[i * 3 + 2] = pink.b;
      } else {
        const color = sampleStarColor(isInterArm ? 'oldDisk' : 'youngDisk', rand);
        result.colors[i * 3] = color.r;
        result.colors[i * 3 + 1] = color.g;
        result.colors[i * 3 + 2] = color.b;
      }
    }

    // 大小：中心 2.5 → 边缘 1.0 线性递减（需求 4.4 中心到边缘渐变）；
    // R2-9 棒粒子 +0.4（俯视时棒状核心在核球辉光之外可辨）
    result.sizes[i] =
      2.5 - 1.5 * (result.radiiLy[i] / params.diskRadiusLy) + 0.4 * result.barFlags[i];
  }

  return result;
}

// ---------------------------------------------------------------------------
// 3D 恒星银晕（R2-9 §9.1：稀疏粒子球壳，径向数密度 ∝ r^-3.5）
// ---------------------------------------------------------------------------

/** 银晕粒子内截断半径（光年）：核球外起晕（可视近似，见文件头登记） */
export const HALO_MIN_RADIUS_LY = 10000;

/** 银晕粒子外截断半径（光年）：约 1.6× 银盘半径，包裹感截断（登记） */
export const HALO_MAX_RADIUS_LY = 80000;

/** 银晕垂直压扁系数 q（观测 0.6–0.9 区间取偏球值，登记） */
export const HALO_FLATTENING = 0.9;

/** 静态粒子集（银心系本地坐标，光年；渲染端一次性上传，零逐帧更新） */
export interface StaticParticleSet {
  count: number;
  /** 位置（光年，count*3，x-z 为银道面、y 垂直银盘） */
  positionsLy: Float32Array;
  /** RGB 颜色（count*3，0-1，已含亮度抖动） */
  colors: Float32Array;
  /** 粒子大小因子（与银盘粒子 aSize 同一像素换算管线） */
  sizes: Float32Array;
}

/**
 * 银晕径向逆变换采样：数密度 n(r) ∝ r^-3.5 → 壳层计数 dN ∝ r²·n ∝ r^-1.5，
 * CDF(r) = (rMin^-½ − r^-½)/(rMin^-½ − rMax^-½)，逆函数为本式。
 *
 * @param u 均匀随机数 [0,1]；u=0 → rMin，u=1 → rMax
 */
export function haloRadiusFromUniform(u: number, rMinLy: number, rMaxLy: number): number {
  if (u < 0 || u > 1) {
    throw new RangeError(`u 必须在 [0, 1] 内，收到 ${u}`);
  }
  if (rMinLy <= 0 || rMaxLy <= rMinLy) {
    throw new RangeError(`半径区间非法：[${rMinLy}, ${rMaxLy}]`);
  }
  const a = 1 / Math.sqrt(rMinLy);
  const b = 1 / Math.sqrt(rMaxLy);
  const inv = a - u * (a - b);
  return 1 / (inv * inv);
}

/** 银晕粒子生成参数 */
export interface GalaxyHaloParams {
  /** 粒子数（需求建议 2,000–4,000） */
  count: number;
  /** 确定性种子 */
  seed: number;
  /** 内截断半径（光年） */
  minRadiusLy: number;
  /** 外截断半径（光年） */
  maxRadiusLy: number;
  /** 垂直压扁系数 (0, 1] */
  flattening: number;
}

/**
 * 银晕远景暗淡增益区间（SC1 登记）：采样器输出（自带 [0.8, 1.0] 抖动）
 * 之上再乘 [0.4, 0.85] 暗淡因子，组合亮度 ≈ [0.32, 0.85]，与 R2-9 现状
 * （色板 × [0.35, 0.75]）观感接近——SC1-3 以颜色出口架构统一为目的。
 */
const HALO_DIM_GAIN_MIN = 0.4;
const HALO_DIM_GAIN_SPAN = 0.45;

/**
 * 确定性生成 3D 恒星银晕粒子（R2-9）：
 * - 半径按 n(r) ∝ r^-3.5 逆变换采样（内密外疏，中心聚集）；
 * - 方向球面均匀（cosθ 均匀），y 按 flattening 压扁；
 * - 颜色经星族采样器 `halo` 预设（SC1-3：贫金属老年星红黄 + 12% 蓝
 *   水平支，starPopulation.ts 唯一事实源）再乘远景暗淡增益，
 *   大小 0.9–1.6（小于盘粒子）。
 */
export function generateGalaxyHaloParticles(params: GalaxyHaloParams): StaticParticleSet {
  if (params.count <= 0 || !Number.isInteger(params.count)) {
    throw new RangeError(`粒子数必须为正整数，收到 ${params.count}`);
  }
  if (params.flattening <= 0 || params.flattening > 1) {
    throw new RangeError(`压扁系数必须在 (0, 1] 内，收到 ${params.flattening}`);
  }
  const rand = createSeededRandom(params.seed);
  const n = params.count;
  const positionsLy = new Float32Array(n * 3);
  const colors = new Float32Array(n * 3);
  const sizes = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const r = haloRadiusFromUniform(rand(), params.minRadiusLy, params.maxRadiusLy);
    const cosPolar = rand() * 2 - 1;
    const sinPolar = Math.sqrt(1 - cosPolar * cosPolar);
    const azimuth = Math.PI * 2 * rand();
    positionsLy[i * 3] = r * sinPolar * Math.cos(azimuth);
    positionsLy[i * 3 + 1] = r * cosPolar * params.flattening;
    positionsLy[i * 3 + 2] = r * sinPolar * Math.sin(azimuth);
    const c = sampleStarColor('halo', rand);
    const dim = HALO_DIM_GAIN_MIN + HALO_DIM_GAIN_SPAN * rand();
    colors[i * 3] = c.r * dim;
    colors[i * 3 + 1] = c.g * dim;
    colors[i * 3 + 2] = c.b * dim;
    sizes[i] = 0.9 + 0.7 * rand();
  }
  return { count: n, positionsLy, colors, sizes };
}

// ---------------------------------------------------------------------------
// 球状星团系统（R2-9 §9.1：银晕内 20–40 个确定性小点簇，中心聚集 + 高银纬）
// ---------------------------------------------------------------------------

/**
 * 程序化球状星团数：29 个 + M13（L3 特殊天体条目单独渲染，联动不重复）
 * 共 30 个，落在需求 20–40 区间（真实约 150+，Harris 1996 目录，见文件头）。
 */
export const GLOBULAR_CLUSTER_COUNT = 29;

/** 每簇粒子数（1 个亮核 + 20 个成员星） */
export const GLOBULAR_CLUSTER_STARS = 21;

/** 星团系统内截断半径（光年） */
export const GLOBULAR_MIN_RADIUS_LY = 6000;

/** 星团系统外截断半径（光年） */
export const GLOBULAR_MAX_RADIUS_LY = 55000;

/** 簇内成员星高斯散布标准差（光年，视觉尺度大于真实 ~50 ly，登记） */
export const GLOBULAR_SPREAD_LY = 650;

/** M13 排除区半径（光年）：程序化星团不落入 L3 M13 条目周围 */
export const M13_EXCLUSION_RADIUS_LY = 4000;

/**
 * M13（L3 特殊天体条目 m13-cluster）t=0 银心系位置（光年）：
 * 太阳 t=0 位于 (R☉, 0, 0)，M13 为太阳系相对偏移 (−2100, +4858, −5200)
 * （data/specialBodies.ts 同源数值，单测断言一致；R3-6 §6.1-A：y 按真实
 * 银纬 b ≈ +40.9° 重定，仍在银晕中）。M13 随太阳共转（近似已在
 * SpecialBodies 登记），排除区按 t=0 位置留白（登记近似）。
 */
export function m13GalactocentricT0Ly(): Vec3 {
  return {
    x: SUN_GALACTIC_RADIUS_LY - 2100,
    y: 4858,
    z: -5200,
  };
}

/** 球状星团生成参数 */
export interface GlobularClusterParams {
  /** 程序化星团数 */
  clusterCount: number;
  /** 每簇粒子数（首个为亮核） */
  starsPerCluster: number;
  /** 确定性种子 */
  seed: number;
  /** 中心距内截断（光年） */
  minRadiusLy: number;
  /** 中心距外截断（光年） */
  maxRadiusLy: number;
  /** 簇内高斯散布（光年） */
  spreadLy: number;
  /** 排除区（联动对象留白，可选） */
  exclusion?: { centerLy: Vec3; radiusLy: number };
}

/** 球状星团粒子集：附每簇中心位置（光年，clusterCount*3） */
export interface GlobularClusterSet extends StaticParticleSet {
  clusterCount: number;
  centersLy: Float32Array;
}

/**
 * 确定性生成球状星团系统（R2-9）：
 * - 簇中心距银心 r = rMin + (rMax − rMin)·u^1.7（中心聚集）；
 * - 银纬偏置：cosθ = sign(v)·|v|^0.55（v 均匀 [−1,1]，偏向两极 → 高银纬，
 *   平均 |cosθ| ≈ 0.65 > 各向同性的 0.5，单测断言）；
 * - 排除区内（如 M13 的 L3 条目位置）确定性重采样（最多 32 次尝试）；
 * - 每簇：首粒子为亮核（size 3.2、满亮度），其余成员星高斯散布
 *   （σ = spreadLy），老年红黄星族 + ~8% 蓝离散星（与 M13 色板一致）。
 */
export function generateGlobularClusters(params: GlobularClusterParams): GlobularClusterSet {
  if (params.clusterCount <= 0 || !Number.isInteger(params.clusterCount)) {
    throw new RangeError(`星团数必须为正整数，收到 ${params.clusterCount}`);
  }
  if (params.starsPerCluster < 2 || !Number.isInteger(params.starsPerCluster)) {
    throw new RangeError(`每簇粒子数必须为 ≥2 的整数，收到 ${params.starsPerCluster}`);
  }
  const rand = createSeededRandom(params.seed);
  const total = params.clusterCount * params.starsPerCluster;
  const positionsLy = new Float32Array(total * 3);
  const colors = new Float32Array(total * 3);
  const sizes = new Float32Array(total);
  const centersLy = new Float32Array(params.clusterCount * 3);

  // 与 M13 一致的老年星族色板（SpecialBodies GlobularCluster 同源）
  const old: readonly (readonly [number, number, number])[] = [
    [1.0, 0.82, 0.55],
    [1.0, 0.7, 0.42],
    [1.0, 0.9, 0.72],
  ];
  const blueStraggler: readonly [number, number, number] = [0.72, 0.82, 1.0];

  for (let c = 0; c < params.clusterCount; c += 1) {
    // 簇中心（排除区确定性重采样）
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (let attempt = 0; attempt < 32; attempt += 1) {
      const r =
        params.minRadiusLy +
        (params.maxRadiusLy - params.minRadiusLy) * Math.pow(rand(), 1.7);
      const v = rand() * 2 - 1;
      const cosPolar = Math.sign(v) * Math.pow(Math.abs(v), 0.55);
      const sinPolar = Math.sqrt(Math.max(0, 1 - cosPolar * cosPolar));
      const azimuth = Math.PI * 2 * rand();
      cx = r * sinPolar * Math.cos(azimuth);
      cy = r * cosPolar;
      cz = r * sinPolar * Math.sin(azimuth);
      const ex = params.exclusion;
      if (
        !ex ||
        Math.hypot(cx - ex.centerLy.x, cy - ex.centerLy.y, cz - ex.centerLy.z) >= ex.radiusLy
      ) {
        break;
      }
    }
    centersLy[c * 3] = cx;
    centersLy[c * 3 + 1] = cy;
    centersLy[c * 3 + 2] = cz;

    for (let s = 0; s < params.starsPerCluster; s += 1) {
      const i = c * params.starsPerCluster + s;
      if (s === 0) {
        // 亮核：中心大粒子（点簇远观可辨的锚点）
        positionsLy[i * 3] = cx;
        positionsLy[i * 3 + 1] = cy;
        positionsLy[i * 3 + 2] = cz;
        colors[i * 3] = 1.0;
        colors[i * 3 + 1] = 0.88;
        colors[i * 3 + 2] = 0.66;
        sizes[i] = 4.5;
      } else {
        positionsLy[i * 3] = cx + gaussian(rand) * params.spreadLy;
        positionsLy[i * 3 + 1] = cy + gaussian(rand) * params.spreadLy;
        positionsLy[i * 3 + 2] = cz + gaussian(rand) * params.spreadLy;
        const col = rand() < 0.08 ? blueStraggler : old[Math.floor(rand() * old.length)];
        const brightness = 0.55 + 0.45 * rand();
        colors[i * 3] = col[0] * brightness;
        colors[i * 3 + 1] = col[1] * brightness;
        colors[i * 3 + 2] = col[2] * brightness;
        sizes[i] = 1.8 + 1.0 * rand();
      }
    }
  }
  return { count: total, clusterCount: params.clusterCount, positionsLy, colors, sizes, centersLy };
}

// ---------------------------------------------------------------------------
// 视角因子（R2-9 §9.1：尘埃带侧视剪影 + 核球辉光椭球感）
// ---------------------------------------------------------------------------

/**
 * 正视程度因子（0=侧视银盘、1=正对银盘面）：
 * 相机相对银心方向（世界坐标差）经银河系倾斜逆旋转（Rx(−tilt)）后，
 * 取本地 y 分量占比。零向量（相机在银心）按正视处理。
 */
export function galaxyFaceOnFactor(
  dx: number,
  dy: number,
  dz: number,
  tiltRad: number,
): number {
  const len = Math.hypot(dx, dy, dz);
  if (len === 0) return 1;
  // Rx(θ) 逆变换：localY = dy·cosθ + dz·sinθ
  const localY = dy * Math.cos(tiltRad) + dz * Math.sin(tiltRad);
  return Math.min(1, Math.abs(localY) / len);
}

/**
 * 尘埃带侧视强度（0-1）：仅在接近侧视（faceOn ≤ 0.5）时渐入，
 * faceOn ≤ 0.15 全强度。smoothstep 保证旋转视角过程无跳变。
 */
export function dustLaneStrength(faceOn01: number): number {
  const edgeOn = 1 - Math.min(1, Math.max(0, faceOn01));
  const t = Math.min(1, Math.max(0, (edgeOn - 0.5) / (0.85 - 0.5)));
  return t * t * (3 - 2 * t);
}

/**
 * 核球辉光 sprite 纵横比（R2-9 椭球感）：正视圆形（1.0）、侧视压扁（0.5），
 * 随视角连续变化——billboard 辉光呈现"扁椭球从不同角度观察"的轴比。
 */
export function bulgeAxisRatio(faceOn01: number): number {
  return 0.5 + 0.5 * Math.min(1, Math.max(0, faceOn01));
}

/** 绝对值钳制（棒粒子高斯截断用） */
function clampAbs(value: number, maxAbs: number): number {
  return Math.max(-maxAbs, Math.min(maxAbs, value));
}

/**
 * 标准正态分布随机数（Box-Muller 变换，消耗 rand 的两个数）
 */
function gaussian(rand: () => number): number {
  const u = 1 - rand(); // 映射到 (0, 1]，避免 log(0)
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(Math.PI * 2 * v);
}

/**
 * #RRGGBB → RGB（0-1）。仅用于本文件内置色板常量（编译期合法值），
 * 不做格式校验（belts.ts 有带校验版本，此处按约定不跨文件复用其私有函数）。
 */
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const v = hex.replace('#', '');
  return {
    r: parseInt(v.slice(0, 2), 16) / 255,
    g: parseInt(v.slice(2, 4), 16) / 255,
    b: parseInt(v.slice(4, 6), 16) / 255,
  };
}
