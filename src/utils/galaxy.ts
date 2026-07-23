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
 */

import type { Vec3 } from '@/types';
import { normalizeAngle } from '@/utils/physics';
import { createSeededRandom } from '@/utils/random';

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
}

/** 银盘粒子数组（结构化数组，供 InstancedMesh / Points 直接上传） */
export interface GalaxyDiskParticles {
  count: number;
  /** 银盘面内半径（光年） */
  radiiLy: Float32Array;
  /** 初始方位角（弧度，含旋臂结构） */
  phases: Float32Array;
  /** 垂直高度（光年） */
  heightsLy: Float32Array;
  /** RGB 颜色（count*3，0-1） */
  colors: Float32Array;
  /** 粒子大小，中心大边缘小（1.0–2.5） */
  sizes: Float32Array;
}

/**
 * 恒星色板（≥7 色，按恒星光谱型近似色，需求 4.4 颜色混合）
 * 参考：Mitchell Charity, "What color are the stars?"（黑体色近似）
 * O/B 蓝 → A/F 白 → G 黄白 → K 橙 → M 红橙
 */
const STAR_PALETTE: readonly string[] = [
  '#9bb0ff',
  '#aabfff',
  '#cad7ff',
  '#f8f7ff',
  '#fff4ea',
  '#ffd2a1',
  '#ffcc6f',
];

/** 旋臂区域星云粉色（电离氢区示意色） */
const NEBULA_PINK = '#ff9bb5';

/** 核球暖黄色调（老年恒星为主） */
const BULGE_COLOR = '#ffd9a0';

/** 核球垂直方向压扁系数（核球比银盘厚、但仍略扁） */
const BULGE_FLATTENING = 0.6;

/** 臂间弥散星占盘粒子比例（约 20%） */
const INTER_ARM_FRACTION = 0.2;

/** 旋臂粒子中星云粉色比例（少量掺入） */
const NEBULA_FRACTION = 0.08;

/**
 * 确定性生成银盘粒子（需求 4.4：粒子大小/密度中心到边缘渐变、≥6 种恒星颜色混合）
 *
 * - 核球（bulgeFraction 占比）：半径 bulgeRadiusLy 内三维近球状分布
 *   （略压扁），暖黄色调，高度分布比薄盘厚；
 * - 盘粒子：半径 r = √rand·diskRadius（中心更密）；
 *   相位 = 臂序号·(2π/armCount) + spiralTightness·ln(1 + r/bulgeRadius)
 *          + 高斯抖动（Box-Muller）·armSpreadRad（对数螺旋臂），
 *   其中约 20% 为臂间弥散星（相位全随机）；
 * - 高度 = 高斯 × thickness/2 × (1 − 0.5·r/diskRadius)（外缘更薄）；
 * - 大小从中心 2.5 线性递减到边缘 1.0。
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

  const rand = createSeededRandom(params.seed);
  const n = params.count;
  const result: GalaxyDiskParticles = {
    count: n,
    radiiLy: new Float32Array(n),
    phases: new Float32Array(n),
    heightsLy: new Float32Array(n),
    colors: new Float32Array(n * 3),
    sizes: new Float32Array(n),
  };

  const palette = STAR_PALETTE.map(hexToRgb);
  const pink = hexToRgb(NEBULA_PINK);
  const bulgeBase = hexToRgb(BULGE_COLOR);
  const bulgeCount = Math.round(n * params.bulgeFraction);

  for (let i = 0; i < n; i += 1) {
    if (i < bulgeCount) {
      // ---- 核球粒子：三维近球状分布（体积均匀 → 半径取立方根） ----
      const rr = params.bulgeRadiusLy * Math.cbrt(rand());
      const cosPolar = rand() * 2 - 1;
      const azimuth = Math.PI * 2 * rand();
      const sinPolar = Math.sqrt(1 - cosPolar * cosPolar);
      result.radiiLy[i] = rr * sinPolar;
      result.phases[i] = azimuth;
      result.heightsLy[i] = rr * cosPolar * BULGE_FLATTENING;

      // 暖黄色调 + 亮度抖动
      const brightness = 0.85 + 0.15 * rand();
      result.colors[i * 3] = bulgeBase.r * brightness;
      result.colors[i * 3 + 1] = bulgeBase.g * brightness;
      result.colors[i * 3 + 2] = bulgeBase.b * brightness;
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

      // 颜色：恒星色板采样；旋臂区域掺入少量星云粉色
      const color =
        !isInterArm && rand() < NEBULA_FRACTION
          ? pink
          : palette[Math.floor(rand() * palette.length)];
      result.colors[i * 3] = color.r;
      result.colors[i * 3 + 1] = color.g;
      result.colors[i * 3 + 2] = color.b;
    }

    // 大小：中心 2.5 → 边缘 1.0 线性递减（需求 4.4 中心到边缘渐变）
    result.sizes[i] = 2.5 - 1.5 * (result.radiiLy[i] / params.diskRadiusLy);
  }

  return result;
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
