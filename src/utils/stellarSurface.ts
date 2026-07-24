/**
 * 恒星表面质感 shader 纯逻辑镜像（P6，需求 3.2 恒星类表面质感）
 *
 * L3 特殊天体（红巨星/蓝巨星/造父一/WR 124）现状为纯色球（meshBasicMaterial）。
 * 本模块提供恒星表面 shader 用到的三个核心函数的 CPU 参考实现，供组件内 GLSL
 * 保持一致、供单测校验（GLSL 无法直接单测，按项目惯例做"纯函数镜像"）：
 *
 * 1. 边缘昏暗（limb darkening）：I(μ)/I(1) = 1 − u·(1 − μ)，μ = N·V（视线方向余弦）。
 *    真实恒星盘面边缘因光深方向倾斜而偏暗；线性系数 u ∈ [0,1]（太阳 V 波段 ≈0.6）。
 * 2. 色温梯度：盘面中心（μ→1）呈本征色温，边缘（μ→0）向偏暗红移动
 *    （较冷较深层的辐射），以颜色乘子表达。
 * 3. 对流颗粒 fBm：多层值噪声叠加，随时间缓慢演化（对流胞浮沉）；红巨星对流胞
 *    尺度大而明显（参宿四 2019-20 大变暗事件佐证巨型对流胞存在）。
 *
 * ── 艺术化/近似登记（需求 §5）─────────────────────────────────────────
 * - 对流颗粒演化速率、颗粒尺度为可视化选择（真实对流演化时标以月/年计，此处加速）。
 * - 色温梯度以简化 RGB 乘子近似黑体谱随光深变化，非严格辐射转移解。
 * - limb darkening 采用线性定律（Milne 1921 近似），未用二次/四次高阶定律。
 * 来源：Betelgeuse 巨型对流胞 ESO VLT/SPHERE（Montargès et al. 2021）。
 */

/**
 * 线性边缘昏暗因子 I(μ)/I(1)
 *
 * @param mu 视线方向余弦 μ = N·V ∈ [0,1]（1=盘面中心正对视线，0=边缘）
 * @param u  昏暗线性系数 ∈ [0,1]（越大边缘越暗）
 * @returns 相对强度 ∈ [1−u, 1]
 * @throws RangeError 当 u 不在 [0,1]
 */
export function limbDarkening(mu: number, u: number): number {
  if (u < 0 || u > 1 || !Number.isFinite(u)) {
    throw new RangeError(`边缘昏暗系数必须在 [0,1] 内，收到 ${u}`);
  }
  const m = Math.max(0, Math.min(1, mu));
  return 1 - u * (1 - m);
}

/**
 * 色温梯度混合因子（0=中心本征色，1=边缘偏暗红）
 *
 * edgeShift = (1 − μ)^power，power 越大过渡越集中于边缘。
 *
 * @param mu 视线方向余弦 ∈ [0,1]
 * @param power 边缘集中幂次（>0，默认 1.5）
 */
export function edgeRednessFactor(mu: number, power = 1.5): number {
  if (!(power > 0)) {
    throw new RangeError(`幂次必须为正数，收到 ${power}`);
  }
  const m = Math.max(0, Math.min(1, mu));
  return Math.pow(1 - m, power);
}

/**
 * RGB 三元组（0-1）
 */
export interface Rgb01 {
  r: number;
  g: number;
  b: number;
}

/**
 * 应用色温梯度：将中心本征色向偏暗红端混合
 *
 * @param base 中心本征色（0-1）
 * @param mu 视线方向余弦 ∈ [0,1]
 * @param strength 边缘偏红强度 ∈ [0,1]
 */
export function applyColorTemperatureGradient(
  base: Rgb01,
  mu: number,
  strength = 0.5,
): Rgb01 {
  if (strength < 0 || strength > 1) {
    throw new RangeError(`强度必须在 [0,1] 内，收到 ${strength}`);
  }
  const f = edgeRednessFactor(mu) * strength;
  // 偏暗红：降低 G/B、略降 R（整体变暗且色相右移）
  return {
    r: base.r * (1 - 0.15 * f),
    g: base.g * (1 - 0.55 * f),
    b: base.b * (1 - 0.75 * f),
  };
}

/**
 * 1D 哈希（确定性伪随机，[0,1)）—— 供 fBm 镜像使用，与 GLSL fract(sin) 风格一致
 */
export function hash2(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** smoothstep 平滑插值权重 */
function smoothstep01(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
}

/** 双线性平滑值噪声（[0,1]） */
export function valueNoise2D(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const v00 = hash2(xi, yi);
  const v10 = hash2(xi + 1, yi);
  const v01 = hash2(xi, yi + 1);
  const v11 = hash2(xi + 1, yi + 1);
  const tx = smoothstep01(xf);
  const ty = smoothstep01(yf);
  const a = v00 + (v10 - v00) * tx;
  const b = v01 + (v11 - v01) * tx;
  return a + (b - a) * ty;
}

/**
 * 对流颗粒 fBm（多层值噪声叠加，归一化到 [0,1]）
 *
 * @param x,y 采样坐标（球面参数化后传入）
 * @param octaves 层数（≥1）
 * @param time 时间（缓慢平移噪声域，模拟对流胞演化）
 * @param cellScale 首层频率（越大颗粒越细；红巨星取小值 → 大对流胞）
 */
export function convectionFbm(
  x: number,
  y: number,
  octaves: number,
  time = 0,
  cellScale = 4,
): number {
  if (!Number.isInteger(octaves) || octaves < 1) {
    throw new RangeError(`octaves 必须为 ≥1 的整数，收到 ${octaves}`);
  }
  let sum = 0;
  let amp = 1;
  let freq = cellScale;
  let total = 0;
  for (let o = 0; o < octaves; o += 1) {
    // 各层以不同速率缓慢平移，制造翻滚感
    const drift = time * (0.05 + o * 0.02);
    sum += valueNoise2D(x * freq + drift, y * freq - drift) * amp;
    total += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / total;
}

/**
 * 3D 哈希（确定性伪随机，[0,1)）—— 与 GLSL fract(sin(dot(p, vec3(...)))) 镜像一致
 *
 * P6 自查修复：对流噪声原以 2D 球面参数化（atan 经度展开）采样，在 ±180°
 * 经线处不连续 → 恒星表面出现垂直接缝。改为 3D 噪声直接以单位球面坐标采样
 * （无经度接缝、无极点收缩），本组函数为 shader 的 CPU 参考实现。
 */
export function hash3(x: number, y: number, z: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

/** 三线性平滑 3D 值噪声（[0,1]），与 GLSL valueNoise3 镜像一致 */
export function valueNoise3D(x: number, y: number, z: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const tx = smoothstep01(x - xi);
  const ty = smoothstep01(y - yi);
  const tz = smoothstep01(z - zi);
  const v000 = hash3(xi, yi, zi);
  const v100 = hash3(xi + 1, yi, zi);
  const v010 = hash3(xi, yi + 1, zi);
  const v110 = hash3(xi + 1, yi + 1, zi);
  const v001 = hash3(xi, yi, zi + 1);
  const v101 = hash3(xi + 1, yi, zi + 1);
  const v011 = hash3(xi, yi + 1, zi + 1);
  const v111 = hash3(xi + 1, yi + 1, zi + 1);
  const a = (v000 + (v100 - v000) * tx) + ((v010 + (v110 - v010) * tx) - (v000 + (v100 - v000) * tx)) * ty;
  const b = (v001 + (v101 - v001) * tx) + ((v011 + (v111 - v011) * tx) - (v001 + (v101 - v001) * tx)) * ty;
  return a + (b - a) * tz;
}

/**
 * 对流颗粒 3D fBm（球面无接缝版，与 GLSL fbm3 镜像一致）
 *
 * @param x,y,z 采样坐标（单位球面坐标 × 1.5 后传入，与 shader 一致）
 * @param octaves 层数（≥1）
 * @param time 时间（缓慢平移噪声域，模拟对流胞演化）
 * @param cellScale 首层频率（越大颗粒越细）
 */
export function convectionFbm3(
  x: number,
  y: number,
  z: number,
  octaves: number,
  time = 0,
  cellScale = 4,
): number {
  if (!Number.isInteger(octaves) || octaves < 1) {
    throw new RangeError(`octaves 必须为 ≥1 的整数，收到 ${octaves}`);
  }
  let sum = 0;
  let amp = 1;
  let freq = cellScale;
  let total = 0;
  for (let o = 0; o < octaves; o += 1) {
    const drift = time * (0.05 + o * 0.02);
    sum += valueNoise3D(x * freq + drift, y * freq - drift, z * freq + drift * 0.7) * amp;
    total += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / total;
}

/**
 * 恒星球体推荐分段数（P6：由 12–24 提升至 32–48，近观无棱角）
 *
 * 依恒星视觉半径线性分级，钳制在 [32, 48]。
 */
export function stellarSphereSegments(visualRadiusUnits: number): number {
  if (visualRadiusUnits < 0 || !Number.isFinite(visualRadiusUnits)) {
    throw new RangeError(`视觉半径必须为非负有限数，收到 ${visualRadiusUnits}`);
  }
  const seg = Math.round(32 + Math.min(1, visualRadiusUnits / 60) * 16);
  return Math.max(32, Math.min(48, seg));
}
