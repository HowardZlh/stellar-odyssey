/**
 * 体积渲染框架 ①：3D 密度纹理工具 + 塑形基元 + CPU 积分参考实现
 * （R4-3，IMPROVEMENT_REQUIREMENTS_4 §R4-3 / §0.3 方案 B）
 *
 * 纯逻辑模块（附录 A §3 纯函数先行）：
 * - `buildDensityTexture(size, sampler)`：程序化密度场 → `THREE.Data3DTexture`
 *   （R8 单通道，size ≤128 附录 A §1 硬性约束）；确定性——同一 sampler 双次
 *   构建逐字节一致（单测断言）。
 * - 密度场塑形基元：3D 值噪声 fBm（复用 `stellarSurface.ts` 的
 *   `hash3/valueNoise3D`，勿新造）、球/椭球/壳层 SDF + 软衰减、平滑并/差
 *   （Inigo Quilez 多项式 smooth min/max）——组合出任意星云形态。
 * - 发射-吸收积分 CPU 参考实现（与 `VolumeMaterial.ts` shader 循环同式），
 *   恒定密度解析解对比用于单测数值校验（保证 shader 与 CPU 同一积分格式）。
 * - `intersectRayBox`：单位盒光线求交（shader `hitBox` 的 CPU 镜像，相机
 *   盒内/盒外两种入射的参数化在此单测校验）。
 * - 蓝噪声抖动掩码（R4-4）：`buildBlueNoiseData/Texture` 程序化生成
 *   64×64 排序掩码（void-and-cluster 简化，环绕核平铺无缝，零新依赖），
 *   raymarch 步进起点抖动打散条带。
 *
 * 确定性（附录 A §2）：种子采用 FNV-1a 字符串哈希（`galaxyNearView.ts`
 * `galaxyNearViewSeed` 同款先例），噪声域偏移经 `createSeededRandom`
 * （`utils/random.ts`）从种子展开；全程无 `Math.random`。
 */

import * as THREE from 'three';
import { valueNoise3D } from '@/utils/stellarSurface';
import { createSeededRandom } from '@/utils/random';

/** 体积纹理边长上限（附录 A §1：≤128³） */
export const VOLUME_TEXTURE_MAX_SIZE = 128;

/** 体积纹理边长下限（2×2×2 起，§R4-3 需求登记） */
export const VOLUME_TEXTURE_MIN_SIZE = 2;

/** raymarch 步进数下限（uniform 可调区间 16–128，§R4-3） */
export const VOLUME_STEPS_MIN = 16;

/** raymarch 步进数上限（与 shader 循环编译期上界一致） */
export const VOLUME_STEPS_MAX = 128;

/** raymarch 默认步进数（§R4-3：默认 64 步） */
export const VOLUME_STEPS_DEFAULT = 64;

/**
 * 3D 密度采样函数：输入归一化坐标 [-1,1]³（纹理体素中心映射），
 * 返回密度 [0,1]（越界值构建时钳制）。
 */
export type DensitySampler3 = (x: number, y: number, z: number) => number;

/**
 * FNV-1a 字符串哈希 → 32 位无符号种子（确定性，`galaxyNearViewSeed` 同款先例）
 */
export function volumeSeed(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i += 1) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * 将步进数钳制到 [16,128] 并取整（材质工厂与预览滑杆共用）
 */
export function clampVolumeSteps(steps: number): number {
  if (!Number.isFinite(steps)) return VOLUME_STEPS_DEFAULT;
  return Math.max(VOLUME_STEPS_MIN, Math.min(VOLUME_STEPS_MAX, Math.round(steps)));
}

/** fBm 配置（缺省与 shader/星云塑形常用档一致） */
export interface Fbm3Options {
  /** 层数（≥1 整数，默认 4） */
  octaves?: number;
  /** 频率倍增（默认 2） */
  lacunarity?: number;
  /** 振幅衰减（默认 0.5） */
  gain?: number;
  /** 确定性种子（默认 0）：经 mulberry32 展开为噪声域偏移 */
  seed?: number;
}

/**
 * 3D 值噪声 fBm（[0,1]，确定性）
 *
 * 复用 `stellarSurface.valueNoise3D` 基元（勿新造，§R4-3）；种子以域偏移
 * 方式注入——不同种子等价于在无限噪声场中平移采样窗口。
 */
export function fbm3(x: number, y: number, z: number, options: Fbm3Options = {}): number {
  const octaves = options.octaves ?? 4;
  const lacunarity = options.lacunarity ?? 2;
  const gain = options.gain ?? 0.5;
  const seed = options.seed ?? 0;
  if (!Number.isInteger(octaves) || octaves < 1) {
    throw new RangeError(`fBm octaves 必须为 ≥1 的整数，收到 ${octaves}`);
  }
  const rand = createSeededRandom(seed >>> 0);
  const ox = rand() * 96;
  const oy = rand() * 96;
  const oz = rand() * 96;
  let sum = 0;
  let amp = 1;
  let freq = 1;
  let total = 0;
  for (let o = 0; o < octaves; o += 1) {
    sum += valueNoise3D(x * freq + ox, y * freq + oy, z * freq + oz) * amp;
    total += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / total;
}

/**
 * 球 SDF：点到球面的有符号距离（内负外正）
 */
export function sphereSdf(x: number, y: number, z: number, radius: number): number {
  return Math.sqrt(x * x + y * y + z * z) - radius;
}

/**
 * 椭球 SDF（IQ 一阶近似 sdEllipsoid：k0*(k0-1)/k1）：内负外正
 *
 * 近似登记：非精确欧氏距离（椭球精确 SDF 无闭式解），远离表面时距离被
 * 低估/高估 ≤ 轴比因子；用于密度衰减塑形足够（衰减带宽由 softness 控制）。
 */
export function ellipsoidSdf(
  x: number,
  y: number,
  z: number,
  rx: number,
  ry: number,
  rz: number,
): number {
  if (!(rx > 0) || !(ry > 0) || !(rz > 0)) {
    throw new RangeError(`椭球半轴必须为正数，收到 (${rx}, ${ry}, ${rz})`);
  }
  const k0 = Math.sqrt((x / rx) ** 2 + (y / ry) ** 2 + (z / rz) ** 2);
  const k1 = Math.sqrt((x / (rx * rx)) ** 2 + (y / (ry * ry)) ** 2 + (z / (rz * rz)) ** 2);
  if (k1 === 0) {
    // 原点：到表面最近距离 = 最短半轴
    return -Math.min(rx, ry, rz);
  }
  return (k0 * (k0 - 1)) / k1;
}

/**
 * 壳层 SDF：由任意基础 SDF 抽壳（|d| - 厚度/2），壳带内为负
 */
export function shellSdf(baseSdf: number, thickness: number): number {
  if (!(thickness > 0)) {
    throw new RangeError(`壳层厚度必须为正数，收到 ${thickness}`);
  }
  return Math.abs(baseSdf) - thickness * 0.5;
}

/**
 * SDF → 密度软衰减：表面内侧 1、外侧经 softness 宽度平滑降到 0
 *
 * smoothstep(softness, 0, sd)：sd ≤ 0（内部）→ 1；sd ≥ softness → 0。
 */
export function sdfDensityFalloff(sd: number, softness: number): number {
  if (!(softness > 0)) {
    throw new RangeError(`衰减宽度必须为正数，收到 ${softness}`);
  }
  const t = Math.min(1, Math.max(0, 1 - sd / softness));
  return t * t * (3 - 2 * t);
}

/**
 * SDF 平滑并（IQ 多项式 smooth min）：k=0 退化为 min（硬并）
 */
export function smoothUnionSdf(d1: number, d2: number, k: number): number {
  if (k <= 0) return Math.min(d1, d2);
  const h = Math.min(1, Math.max(0, 0.5 + (0.5 * (d2 - d1)) / k));
  return d2 + (d1 - d2) * h - k * h * (1 - h);
}

/**
 * SDF 平滑差（从 d1 中挖去 d2）：k=0 退化为 max(d1, -d2)（硬差）
 */
export function smoothSubtractSdf(d1: number, d2: number, k: number): number {
  if (k <= 0) return Math.max(d1, -d2);
  const h = Math.min(1, Math.max(0, 0.5 - (0.5 * (d2 + d1)) / k));
  return d1 + (-d2 - d1) * h + k * h * (1 - h);
}

/** 发射-吸收积分结果（单通道参考实现，颜色映射在 shader 侧另行处理） */
export interface EmissionAbsorptionResult {
  /** 累计发射量（未乘颜色/亮度系数） */
  emission: number;
  /** 剩余透射率 [0,1]（合成时背景乘此系数） */
  transmittance: number;
}

/**
 * 发射-吸收积分 CPU 参考实现（前向 front-to-back，与 shader 循环同式）
 *
 * 离散格式（shader `VolumeMaterial.ts` 镜像，单测据此校验一致性）：
 *   emission += T_i · ρ_i · Δt
 *   T_{i+1}   = T_i · exp(−ρ_i · σ · Δt)
 *
 * @param densities 步进采样密度序列（≥0）
 * @param stepLen 步长 Δt（>0）
 * @param absorption 吸收系数 σ（≥0）
 */
export function integrateEmissionAbsorption(
  densities: ArrayLike<number>,
  stepLen: number,
  absorption: number,
): EmissionAbsorptionResult {
  if (!(stepLen > 0) || !Number.isFinite(stepLen)) {
    throw new RangeError(`步长必须为正有限数，收到 ${stepLen}`);
  }
  if (!(absorption >= 0) || !Number.isFinite(absorption)) {
    throw new RangeError(`吸收系数必须为非负有限数，收到 ${absorption}`);
  }
  let transmittance = 1;
  let emission = 0;
  for (let i = 0; i < densities.length; i += 1) {
    const d = Math.max(0, densities[i]);
    emission += transmittance * d * stepLen;
    transmittance *= Math.exp(-d * absorption * stepLen);
  }
  return { emission, transmittance };
}

/**
 * 恒定密度发射-吸收解析解（单测对照基准）
 *
 * 透射率 T = exp(−ρσL)；发射 E = ∫₀ᴸ ρ·exp(−ρσt) dt = (1 − T)/σ
 * （σ=0 时退化为 E = ρL、T = 1）。
 */
export function constantDensityEmissionAnalytic(
  density: number,
  absorption: number,
  pathLen: number,
): EmissionAbsorptionResult {
  if (!(density >= 0) || !(pathLen >= 0)) {
    throw new RangeError(`密度与路径长度必须非负，收到 ρ=${density} L=${pathLen}`);
  }
  if (absorption === 0) {
    return { emission: density * pathLen, transmittance: 1 };
  }
  const transmittance = Math.exp(-density * absorption * pathLen);
  return { emission: (1 - transmittance) / absorption, transmittance };
}

/** 光线-盒求交区间（t0 ≤ t1，均为沿方向的参数距离） */
export interface RayBoxHit {
  /** 入点参数（相机在盒内时为负，shader 侧钳到 0 后从相机处起步） */
  t0: number;
  /** 出点参数 */
  t1: number;
}

/**
 * 光线-轴对齐盒求交（slab 法，shader `hitBox` 的 CPU 镜像）
 *
 * 默认单位盒 [-0.5, 0.5]³（VolumeMaterial 的 box 局部空间约定）。
 * 方向零分量按 shader 同式加 1e-5 下限防除零（NaN 防护同源）。
 *
 * @returns 相交返回 {t0, t1}；不相交（或盒整体在射线反向）返回 null
 */
export function intersectRayBox(
  origin: readonly [number, number, number],
  direction: readonly [number, number, number],
  boxMin = -0.5,
  boxMax = 0.5,
): RayBoxHit | null {
  let t0 = -Infinity;
  let t1 = Infinity;
  for (let axis = 0; axis < 3; axis += 1) {
    const o = origin[axis];
    let d = direction[axis];
    // 与 shader 同式：|d| 下限 1e-5（保号），防 0 分量除零产生 NaN
    const sign = d < 0 ? -1 : 1;
    d = sign * Math.max(Math.abs(d), 1e-5);
    const inv = 1 / d;
    const tA = (boxMin - o) * inv;
    const tB = (boxMax - o) * inv;
    t0 = Math.max(t0, Math.min(tA, tB));
    t1 = Math.min(t1, Math.max(tA, tB));
  }
  if (t0 > t1 || t1 < 0) return null;
  return { t0, t1 };
}

/**
 * 校验体积纹理边长（附录 A §1：整数且 2 ≤ size ≤ 128）
 *
 * @throws RangeError 越界/非整数
 */
export function assertVolumeTextureSize(size: number): void {
  if (
    !Number.isInteger(size) ||
    size < VOLUME_TEXTURE_MIN_SIZE ||
    size > VOLUME_TEXTURE_MAX_SIZE
  ) {
    throw new RangeError(
      `体积纹理边长必须为 [${VOLUME_TEXTURE_MIN_SIZE}, ${VOLUME_TEXTURE_MAX_SIZE}] 的整数，收到 ${size}`,
    );
  }
}

/**
 * 构建 R8 密度体素数据（纯函数，确定性：同一 sampler 双次调用逐字节一致）
 *
 * 体素中心映射：索引 i → 归一化坐标 ((i + 0.5)/size)·2 − 1 ∈ (-1, 1)，
 * 与 shader 侧 box 局部 [-0.5,0.5]³ → uv [0,1]³ 的采样约定对齐
 * （sampler 坐标 = 局部坐标 × 2）。
 */
export function buildDensityData(
  size: number,
  sampler: DensitySampler3,
): Uint8Array<ArrayBuffer> {
  assertVolumeTextureSize(size);
  const data = new Uint8Array(size * size * size);
  let ptr = 0;
  for (let zi = 0; zi < size; zi += 1) {
    const z = ((zi + 0.5) / size) * 2 - 1;
    for (let yi = 0; yi < size; yi += 1) {
      const y = ((yi + 0.5) / size) * 2 - 1;
      for (let xi = 0; xi < size; xi += 1) {
        const x = ((xi + 0.5) / size) * 2 - 1;
        const raw = sampler(x, y, z);
        const clamped = Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : 0;
        data[ptr] = Math.round(clamped * 255);
        ptr += 1;
      }
    }
  }
  return data;
}

/**
 * 构建 3D 密度纹理（R8 单通道，THREE.Data3DTexture）
 *
 * 纹理参数：RedFormat/UnsignedByte、三线性过滤、ClampToEdge、
 * unpackAlignment=1（行宽非 4 倍数时避免上传错位）。
 * 消费方（细节层）卸载时须调用 `texture.dispose()`（附录 A §6）。
 */
export function buildDensityTexture(
  size: number,
  sampler: DensitySampler3,
): THREE.Data3DTexture {
  const data = buildDensityData(size, sampler);
  const texture = new THREE.Data3DTexture(data, size, size, size);
  texture.format = THREE.RedFormat;
  texture.type = THREE.UnsignedByteType;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.wrapR = THREE.ClampToEdgeWrapping;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  return texture;
}

/** 球形 fBm 密度云配置（R4-3 预览测试体；后续星云塑形可复用） */
export interface SphericalFbmCloudOptions {
  /** 确定性种子（FNV-1a，`volumeSeed(id)`） */
  seed: number;
  /** 噪声频率（默认 2.5，越大团块越细） */
  frequency?: number;
  /** fBm 层数（默认 4） */
  octaves?: number;
  /** 云球半径（归一化坐标系，默认 0.85——留边防贴纹理边界） */
  radius?: number;
  /** 边缘软衰减宽度（默认 0.45） */
  softness?: number;
  /** 噪声覆盖阈值（默认 0.42，越高云越稀疏） */
  coverage?: number;
}

/**
 * 生成球形 fBm 密度云采样器（预览测试体 `?body=volume-test` 的密度场）
 *
 * 密度 = 球 SDF 软衰减 × fBm 阈值重映射：中心浓、边缘碎散消融，
 * 绕行观察有内部结构视差（验收：真实体积感、无 billboard 感）。
 */
export function makeSphericalFbmCloudSampler(
  options: SphericalFbmCloudOptions,
): DensitySampler3 {
  const frequency = options.frequency ?? 2.5;
  const octaves = options.octaves ?? 4;
  const radius = options.radius ?? 0.85;
  const softness = options.softness ?? 0.45;
  const coverage = options.coverage ?? 0.42;
  const seed = options.seed >>> 0;
  return (x, y, z) => {
    const shell = sdfDensityFalloff(sphereSdf(x, y, z, radius), softness);
    if (shell <= 0) return 0;
    const n = fbm3(x * frequency, y * frequency, z * frequency, { octaves, seed });
    // 阈值重映射：n ≤ coverage → 0，向 1 平滑上升（碎散团块感）
    const t = Math.min(1, Math.max(0, (n - coverage) / (1 - coverage)));
    return shell * t * t * (3 - 2 * t);
  };
}

/** 蓝噪声纹理默认边长（§R4-4：64×64 程序化生成，勿引入新依赖） */
export const BLUE_NOISE_SIZE = 64;

/** 蓝噪声生成边长上限（防误用超大尺寸拖慢构建：O(n²) 复杂度） */
export const BLUE_NOISE_MAX_SIZE = 128;

/** 蓝噪声斥力核高斯 σ（Ulichney void-and-cluster 经验值 1.5–1.9 档） */
const BLUE_NOISE_SIGMA = 1.9;

/**
 * 程序化生成蓝噪声排序掩码（void-and-cluster 简化：最小能量填充，纯函数）
 *
 * 算法（Ulichney 1993 void-and-cluster 的秩填充相位，环绕域）：
 * 逐秩挑选当前"最空"（能量最低）像素，赋值 rank/n×256，并在其周围
 * 溅射环绕（toroidal）高斯斥力能量——后续挑选被推离已选点，得到
 * 高频为主（蓝色频谱）的抖动掩码；纹理 Repeat 平铺无缝（环绕核保证）。
 *
 * 确定性（附录 A §2）：平局以种子展开的微扰打破（`createSeededRandom`），
 * 同一 (size, seed) 双次生成逐字节一致；输出直方图严格均匀
 * （每个 8-bit 级出现 n/256 次，size=64 时恰为 16 次）。
 *
 * 复杂度 O(n²)（64² ≈ 1.7×10⁷ 次比较，构建一次 <20ms），仅在材质创建期
 * 调用（渲染循环零构建）。
 *
 * @param size 边长（整数 8–128）
 * @param seed 确定性种子（FNV-1a，`volumeSeed(id)`）
 */
export function buildBlueNoiseData(size: number, seed: number): Uint8Array<ArrayBuffer> {
  if (!Number.isInteger(size) || size < 8 || size > BLUE_NOISE_MAX_SIZE) {
    throw new RangeError(`蓝噪声边长必须为 [8, ${BLUE_NOISE_MAX_SIZE}] 的整数，收到 ${size}`);
  }
  const n = size * size;
  const rand = createSeededRandom(seed >>> 0);
  // 能量场：种子微扰打破平局（幅度 ≪ 单次高斯溅射，不影响蓝噪声结构）
  const energy = new Float64Array(n);
  for (let i = 0; i < n; i += 1) energy[i] = rand() * 1e-4;

  // 预计算环绕高斯核（半径 3σ 截断）
  const kernelRadius = Math.min(Math.ceil(BLUE_NOISE_SIGMA * 3), size >> 1);
  const kernelSide = kernelRadius * 2 + 1;
  const kernel = new Float64Array(kernelSide * kernelSide);
  const inv2Sigma2 = 1 / (2 * BLUE_NOISE_SIGMA * BLUE_NOISE_SIGMA);
  for (let dy = -kernelRadius; dy <= kernelRadius; dy += 1) {
    for (let dx = -kernelRadius; dx <= kernelRadius; dx += 1) {
      kernel[(dy + kernelRadius) * kernelSide + (dx + kernelRadius)] = Math.exp(
        -(dx * dx + dy * dy) * inv2Sigma2,
      );
    }
  }

  const out = new Uint8Array(n);
  const assigned = new Uint8Array(n);
  for (let rank = 0; rank < n; rank += 1) {
    // 找未分配像素中能量最低者（"最大空洞"）
    let best = -1;
    let bestEnergy = Infinity;
    for (let i = 0; i < n; i += 1) {
      if (assigned[i] === 0 && energy[i] < bestEnergy) {
        bestEnergy = energy[i];
        best = i;
      }
    }
    assigned[best] = 1;
    out[best] = Math.floor((rank * 256) / n);
    // 环绕高斯斥力溅射
    const bx = best % size;
    const by = (best / size) | 0;
    for (let dy = -kernelRadius; dy <= kernelRadius; dy += 1) {
      const yy = (by + dy + size) % size;
      const rowK = (dy + kernelRadius) * kernelSide;
      const rowE = yy * size;
      for (let dx = -kernelRadius; dx <= kernelRadius; dx += 1) {
        const xx = (bx + dx + size) % size;
        energy[rowE + xx] += kernel[rowK + (dx + kernelRadius)];
      }
    }
  }
  return out;
}

/**
 * 构建蓝噪声 DataTexture（R8/UnsignedByte、NearestFilter、Repeat 平铺）
 *
 * shader 侧以 `texelFetch(uBlueNoise, gl_FragCoord mod size)` 逐像素取
 * 抖动值（步进起点偏移，打散条带，§R4-4）。消费方卸载时须调用
 * `texture.dispose()`（附录 A §6；`disposeVolumeMaterial` 已托管工厂
 * 自建的实例）。
 */
export function buildBlueNoiseTexture(
  size: number = BLUE_NOISE_SIZE,
  seed: number = volumeSeed('volume-blue-noise'),
): THREE.DataTexture {
  const data = buildBlueNoiseData(size, seed);
  const texture = new THREE.DataTexture(data, size, size);
  texture.format = THREE.RedFormat;
  texture.type = THREE.UnsignedByteType;
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  return texture;
}
