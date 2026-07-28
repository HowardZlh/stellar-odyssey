/**
 * 猎户座星云 M42 体积密度场（R4-7，IMPROVEMENT_REQUIREMENTS_4 §R4-7 / §0.3 方案 B）
 *
 * 纯逻辑模块（附录 A §3 纯函数先行）：组合 `utils/volume.ts` 塑形基元
 * （椭球/球/壳层 SDF + 软衰减 + 平滑并）与 `stellarSurface.valueNoise3D`
 * 噪声基元，构建 M42 双通道密度场（发射 + 吸收），供预览页/主场景（R4-8）
 * 烘焙 128³ RG Data3DTexture。
 *
 * 形态登记（附录 A §4，数据源 §0.4：NASA/ESA Hubble 公版图像仅作形态参考，
 * 程序化近似构建，非观测数据反演）：
 * - 坐标约定：归一化域 [-1,1]³，+x=西、+y=北、+z=面向观察者（预览页默认
 *   相机方向）；近似度登记——只复现"扇贝状发射腔开口朝观察侧、西北亮弓、
 *   东南暗湾（前景尘埃）、Trapezium 空腔 + 电离前沿增密壳"四个可辨识特征
 *   的相对方位与量级，云体细节为 fBm 湍流 + 丝状密度脊程序化生成，
 *   与真实 M42（Huygens 区/Bright Bar/Dark Bay 实际天区方位）存在艺术化差异。
 * - 主体：椭球包络 − 前向扇贝腔（球形炮膛开口朝 +z，湍流扰动碗壁成扇贝缘）
 *   − Trapezium 小空腔（乘法软挖孔）；电离前沿 = Trapezium 空腔外侧增密壳
 *   + 扇贝腔壁增密壳（西北象限角向加权 → 西北亮弓）。
 * - 双通道：R = 发射密度（Hα/OIII 混色权重不烘焙，由 `m42ColorWeight01`
 *   随到 Trapezium 距离在 shader 侧计算——内区 OIII 偏青、外区 Hα 偏红，
 *   登记：权重取纯径向近似）；G = 吸收密度（东南前景尘埃湾，两椭球平滑并
 *   + 湍流调制）。
 * - 细节：3 八度 fBm 湍流（乘法侵蚀，外缘阈值升高 → 碎散边缘）+ 丝状密度脊
 *   （ridged 噪声，采样域经湍流值方向场扭曲）。
 *
 * 分帧构建（§R4-7 实现方式登记，二选一取"分帧"而非 Worker）：
 * `createRgVolumeBuild` + `advanceRgVolumeBuild` 以 z 切片为粒度按每帧时间
 * 预算推进（单块超预算即让出主线程，打点 maxChunkMs/computeMs 登记），
 * 数据与一次性构建逐字节一致（单测断言，与分块方式无关）；Worker 路线
 * 因 Jest/Next 集成复杂度高且分帧已满足 <100ms 卡顿约束而不采用。
 *
 * 确定性（附录 A §2）：FNV-1a 种子（`volumeSeed('orion-nebula')`）经
 * `createSeededRandom` 展开为噪声域偏移（fbm3 同款注入方式）；全程无
 * `Math.random`，同种子双次构建逐字节一致（单测断言）。
 */

import * as THREE from 'three';
import { valueNoise3D } from '@/utils/stellarSurface';
import { createSeededRandom } from '@/utils/random';
import {
  assertVolumeTextureSize,
  ellipsoidSdf,
  sdfDensityFalloff,
  shellSdf,
  smoothUnionSdf,
  volumeSeed,
  type EmissionAbsorptionResult,
} from '@/utils/volume';

/** M42 体积层确定性种子 id（与 catalog/specialBodies 的天体 id 一致） */
export const M42_VOLUME_ID = 'orion-nebula';

/** M42 密度纹理边长（§R4-7：128³，附录 A §1 上限） */
export const M42_TEXTURE_SIZE = 128;

/** Trapezium（四边形星团）中心（归一化域坐标） */
export const M42_TRAPEZIUM_CENTER: readonly [number, number, number] = [0.08, 0.04, 0.18];

/** Trapezium 空腔半径（归一化域） */
export const M42_CAVITY_RADIUS = 0.14;

/** 电离前沿增密壳中径（Trapezium 空腔外侧） */
export const M42_ION_SHELL_RADIUS = 0.2;

/** 东南前景尘埃湾中心（归一化域坐标，吸收通道；贴近前表面的薄板） */
export const M42_DARK_BAY_CENTER: readonly [number, number, number] = [-0.34, -0.26, 0.5];

/** 双色权重内径：到 Trapezium 距离 ≤ 此值 → OIII 权重 1（偏青） */
export const M42_COLOR_WEIGHT_INNER_R = 0.22;

/** 双色权重外径：到 Trapezium 距离 ≥ 此值 → Hα 权重 1（偏红） */
export const M42_COLOR_WEIGHT_OUTER_R = 0.62;

/** 椭球包络中心/半轴（主体轮廓） */
const ENV_CENTER: readonly [number, number, number] = [-0.05, 0, -0.08];
const ENV_RADII: readonly [number, number, number] = [0.82, 0.72, 0.62];

/** 扇贝腔（前向炮膛）球心 = Trapezium 前上方偏西北，开口穿出 +z 面 */
const BOWL_CENTER: readonly [number, number, number] = [0.18, 0.1, 0.8];
const BOWL_RADIUS = 0.5;

/** 尘埃湾伸向星云中心的舌部（第二椭球，与主湾平滑并；与 Trapezium
 * 空腔/电离壳保持间距——腔内与壳区吸收近零，单测断言）。
 * z 向压薄（前景薄板）：避免高消光柱在云体内投出过长阴影隧道（目验调参） */
const BAY_TONGUE_CENTER: readonly [number, number, number] = [-0.18, -0.16, 0.46];
const BAY_RADII: readonly [number, number, number] = [0.3, 0.22, 0.16];
const BAY_TONGUE_RADII: readonly [number, number, number] = [0.18, 0.11, 0.12];

/**
 * Trapezium 四颗亮星（θ¹ Ori A/B/C/D 示意）相对空腔中心的偏移
 * （归一化域；|偏移| < 空腔半径 0.14——星点全部落在空腔内，单测断言）。
 * 登记：梯形相对构型为示意（真实角距 ~20″ 量级，此处按空腔尺度放置）。
 */
export const TRAPEZIUM_STAR_OFFSETS: readonly (readonly [number, number, number])[] = [
  [-0.045, 0.032, 0.012],
  [0.036, 0.046, -0.01],
  [0.052, -0.028, 0.016],
  [-0.022, -0.05, -0.018],
];

/** Trapezium 星点位置（归一化域 [-1,1]³：空腔中心 + 偏移） */
export function trapeziumStarPositions(): readonly (readonly [number, number, number])[] {
  const [cx, cy, cz] = M42_TRAPEZIUM_CENTER;
  return TRAPEZIUM_STAR_OFFSETS.map(([ox, oy, oz]) => [cx + ox, cy + oy, cz + oz] as const);
}

/**
 * Trapezium 星点的盒局部坐标（[-0.5,0.5]³，VolumeMaterial 单位盒约定：
 * 归一化域 ÷2；预览页 sprite 按 mesh.scale 同步放大）
 */
export function trapeziumStarBoxPositions(): readonly (readonly [number, number, number])[] {
  return trapeziumStarPositions().map(([x, y, z]) => [x / 2, y / 2, z / 2] as const);
}

/** [0,1] 区间 smoothstep（局部工具） */
function sstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Hα/OIII 双色混合权重（0 = 内区 OIII 偏青，1 = 外区 Hα 偏红）
 *
 * 纯径向近似登记：权重仅随"到 Trapezium 中心距离"平滑上升
 * （smoothstep INNER_R → OUTER_R），shader 侧同式镜像（单测锚定关键点）。
 *
 * @param radius 到 Trapezium 中心的距离（归一化域，须为非负有限数）
 */
export function m42ColorWeight01(radius: number): number {
  if (!(radius >= 0) || !Number.isFinite(radius)) {
    throw new RangeError(`半径必须为非负有限数，收到 ${radius}`);
  }
  return sstep(M42_COLOR_WEIGHT_INNER_R, M42_COLOR_WEIGHT_OUTER_R, radius);
}

/** 双通道采样输出（复用对象，构建循环零逐体素分配） */
export interface NebulaSample {
  /** 发射密度 [0,1]（R 通道） */
  emission: number;
  /** 吸收密度 [0,1]（G 通道，前景尘埃） */
  absorption: number;
}

/** 双通道密度采样函数：归一化坐标 [-1,1]³ → 写入 out（越界值烘焙时钳制） */
export type NebulaDualSampler = (x: number, y: number, z: number, out: NebulaSample) => void;

/**
 * 生成 M42 双通道密度采样器（确定性：同种子输出逐点一致）
 *
 * 性能登记：每体素 ≤4 次 3D 值噪声调用（湍流 fBm 3 八度 + 丝状脊 1 次），
 * 包络与尘埃湾之外的体素零噪声调用（早退），128³ 全量计算实测 <1s
 * （本机基准 ~57 ns/噪声调用）。
 *
 * @param seed FNV-1a 种子（默认 `volumeSeed('orion-nebula')`）
 */
export function makeM42Sampler(seed: number = volumeSeed(M42_VOLUME_ID)): NebulaDualSampler {
  // 种子 → 噪声域偏移（fbm3 同款注入方式：不同种子 = 平移采样窗口）
  const rand = createSeededRandom(seed >>> 0);
  const turbOffsets: number[] = [];
  for (let i = 0; i < 9; i += 1) turbOffsets.push(rand() * 96);
  const ridgeOx = rand() * 96;
  const ridgeOy = rand() * 96;
  const ridgeOz = rand() * 96;

  const [ecx, ecy, ecz] = ENV_CENTER;
  const [erx, ery, erz] = ENV_RADII;
  const [tcx, tcy, tcz] = M42_TRAPEZIUM_CENTER;
  const [bcx, bcy, bcz] = BOWL_CENTER;
  const [dbx, dby, dbz] = M42_DARK_BAY_CENTER;
  const [tox, toy, toz] = BAY_TONGUE_CENTER;
  const [brx, bry, brz] = BAY_RADII;
  const [trx, try_, trz] = BAY_TONGUE_RADII;

  return (x, y, z, out) => {
    // ── 早退门（无噪声）：宽松软衰减包住后续噪声扰动的可达范围 ──
    const dEnv = ellipsoidSdf(x - ecx, y - ecy, z - ecz, erx, ery, erz);
    const envGate = sdfDensityFalloff(dEnv, 0.45);
    const dBayRaw = smoothUnionSdf(
      ellipsoidSdf(x - dbx, y - dby, z - dbz, brx, bry, brz),
      ellipsoidSdf(x - tox, y - toy, z - toz, trx, try_, trz),
      0.1,
    );
    const bayGate = sdfDensityFalloff(dBayRaw, 0.3);

    if (envGate <= 0 && bayGate <= 0) {
      out.emission = 0;
      out.absorption = 0;
      return;
    }

    // ── 细节层：3 八度 fBm 湍流（轮廓扰动 + 边缘侵蚀 + 尘埃调制共用） ──
    let turb = 0;
    let amp = 1;
    let freq = 3;
    let total = 0;
    for (let o = 0; o < 3; o += 1) {
      turb +=
        valueNoise3D(
          x * freq + turbOffsets[o * 3],
          y * freq + turbOffsets[o * 3 + 1],
          z * freq + turbOffsets[o * 3 + 2],
        ) * amp;
      total += amp;
      amp *= 0.5;
      freq *= 2;
    }
    turb /= total;

    // ── 吸收通道：尘埃湾（轮廓经湍流扰动去球感）× 湍流束状调制 ──
    const bay01 = sdfDensityFalloff(dBayRaw - (turb - 0.5) * 0.2, 0.15);
    out.absorption = bay01 <= 0 ? 0 : Math.min(1, bay01 * (0.55 + 0.45 * turb));

    // 包络轮廓扰动（去正椭球感）：半径按湍流值起伏 ±0.125
    const env01 = sdfDensityFalloff(dEnv - (turb - 0.5) * 0.25, 0.3);
    if (env01 <= 0) {
      out.emission = 0;
      return;
    }

    // ── 骨架第 2 层：前向扇贝腔（碗壁经湍流扰动成扇贝缘）＋ Trapezium 空腔 ──
    const bx = x - bcx;
    const by = y - bcy;
    const bz = z - bcz;
    const dBowl = Math.sqrt(bx * bx + by * by + bz * bz) - (BOWL_RADIUS + (turb - 0.5) * 0.16);
    const tx = x - tcx;
    const ty = y - tcy;
    const tz = z - tcz;
    const rTrap = Math.sqrt(tx * tx + ty * ty + tz * tz);
    const dTrap = rTrap - M42_CAVITY_RADIUS;
    // 乘法软挖孔：腔内 → 0，腔壁软过渡（sdfDensityFalloff(-d) 语义）
    const carveBowl = sdfDensityFalloff(-dBowl, 0.1);
    const carveTrap = sdfDensityFalloff(-dTrap, 0.06);
    const body = env01 * carveBowl * carveTrap;

    if (body <= 0) {
      out.emission = 0;
      return;
    }

    // ── 骨架第 3 层：增密壳与西北亮弓 ──
    // 电离前沿：Trapezium 空腔外侧增密壳（中径 0.20、厚 0.12）
    const trapShell = sdfDensityFalloff(shellSdf(rTrap - M42_ION_SHELL_RADIUS, 0.12), 0.07);
    // 扇贝腔壁增密壳 × 西北象限角向加权（西北亮弓：+x 西 +y 北）
    const bowlShell = sdfDensityFalloff(shellSdf(dBowl, 0.16), 0.09);
    // 西北角向权重（宽缓坡：包络中心偏西南导致的侵蚀深度梯度会部分抵消
    // 角向增益，坡度与幅度按"西北柱积分 ≥1.25× 东南镜像柱"标定，单测锚定）
    const nw01 = sstep(-0.3, 0.6, tx + ty);
    const gain =
      (1 + 1.8 * trapShell + 2.6 * bowlShell * (0.25 + 0.75 * nw01)) * (0.65 + 1.0 * nw01);

    // ── 细节层：边缘侵蚀（表层湍流阈值化 → 密度归零的碎散云缘，
    // 深处恒 1——壳层/腔壁结构不受侵蚀）＋ 丝状密度脊 ──
    const interior01 = Math.min(1, Math.max(0, -dEnv / 0.45));
    const edgeMask = sstep(0, 0.5, turb + 1.2 * interior01);
    // 方向场扭曲：采样域按湍流值偏移（丝状脊沿湍流梯度扭曲缠绕）
    const warp = (turb - 0.5) * 0.9;
    const rn = valueNoise3D(
      x * 4.5 + ridgeOx + warp * 1.6,
      y * 4.5 + ridgeOy - warp * 1.2,
      z * 4.5 + ridgeOz + warp * 0.8,
    );
    const ridge = (1 - Math.abs(2 * rn - 1)) ** 4;

    // 总量标定 ×0.32：把增密壳峰值压回 8-bit 动态范围内（避免钳制饱和抹平
    // 西北亮弓的角向梯度），整体亮度由材质 uDensityScale/uIntensity 恢复
    const em =
      (body * gain * (0.45 + 0.55 * turb) + 0.9 * ridge * body) * edgeMask * 0.32;
    out.emission = Math.min(1, Math.max(0, em));
  };
}

/** RG 双通道体素数据的分帧构建状态（z 切片粒度推进 + 打点登记字段） */
export interface RgVolumeBuildState {
  /** 纹理边长 */
  readonly size: number;
  /** RG 交错体素数据（size³ × 2 字节） */
  readonly data: Uint8Array<ArrayBuffer>;
  /** 双通道采样器（确定性） */
  readonly sampler: NebulaDualSampler;
  /** 下一个待填充的 z 切片索引（== size 即完成） */
  nextZ: number;
  /** 已执行的分帧块数（打点登记） */
  chunkCount: number;
  /** 单块最大耗时 ms（打点登记：主线程无 >100ms 卡顿的证据） */
  maxChunkMs: number;
  /** 累计计算耗时 ms（打点登记：构建 <1s 的证据，不含帧间等待） */
  computeMs: number;
}

/** 创建分帧构建状态（size 经附录 A §1 校验；数据初始为 0） */
export function createRgVolumeBuild(
  size: number,
  sampler: NebulaDualSampler,
): RgVolumeBuildState {
  assertVolumeTextureSize(size);
  return {
    size,
    data: new Uint8Array(size * size * size * 2),
    sampler,
    nextZ: 0,
    chunkCount: 0,
    maxChunkMs: 0,
    computeMs: 0,
  };
}

/** 构建是否完成 */
export function rgVolumeBuildDone(state: RgVolumeBuildState): boolean {
  return state.nextZ >= state.size;
}

/** 构建进度 [0,1]（预览页 HUD 显示） */
export function rgVolumeBuildProgress01(state: RgVolumeBuildState): number {
  return Math.min(1, state.nextZ / state.size);
}

/** 填充单个 z 切片（体素中心映射与 volume.buildDensityData 同式） */
function fillRgSlice(state: RgVolumeBuildState, zi: number, scratch: NebulaSample): void {
  const { size, data, sampler } = state;
  const z = ((zi + 0.5) / size) * 2 - 1;
  let ptr = zi * size * size * 2;
  for (let yi = 0; yi < size; yi += 1) {
    const y = ((yi + 0.5) / size) * 2 - 1;
    for (let xi = 0; xi < size; xi += 1) {
      const x = ((xi + 0.5) / size) * 2 - 1;
      sampler(x, y, z, scratch);
      const e = Number.isFinite(scratch.emission)
        ? Math.min(1, Math.max(0, scratch.emission))
        : 0;
      const a = Number.isFinite(scratch.absorption)
        ? Math.min(1, Math.max(0, scratch.absorption))
        : 0;
      data[ptr] = Math.round(e * 255);
      data[ptr + 1] = Math.round(a * 255);
      ptr += 2;
    }
  }
}

/**
 * 推进分帧构建：在时间预算内逐 z 切片填充（至少推进 1 片保证收敛），
 * 超预算即返回让出主线程（下一帧继续）。数据与分块方式无关
 * （同种子任意预算下逐字节一致，单测断言）。
 *
 * @param budgetMs 本次调用的时间预算（>0，可为 Infinity 一次性完成）
 * @param now 时钟注入（默认 performance.now，单测可用假时钟）
 * @returns 是否已全部完成
 */
export function advanceRgVolumeBuild(
  state: RgVolumeBuildState,
  budgetMs: number,
  now: () => number = () => performance.now(),
): boolean {
  if (!(budgetMs > 0)) {
    throw new RangeError(`时间预算必须为正数，收到 ${budgetMs}`);
  }
  if (rgVolumeBuildDone(state)) return true;
  const scratch: NebulaSample = { emission: 0, absorption: 0 };
  const start = now();
  do {
    fillRgSlice(state, state.nextZ, scratch);
    state.nextZ += 1;
  } while (state.nextZ < state.size && now() - start < budgetMs);
  const elapsed = now() - start;
  state.chunkCount += 1;
  state.computeMs += elapsed;
  if (elapsed > state.maxChunkMs) state.maxChunkMs = elapsed;
  return rgVolumeBuildDone(state);
}

/** 一次性构建 RG 体素数据（单测/离线路径；与分帧结果逐字节一致） */
export function buildRgDensityData(
  size: number,
  sampler: NebulaDualSampler,
): Uint8Array<ArrayBuffer> {
  const state = createRgVolumeBuild(size, sampler);
  advanceRgVolumeBuild(state, Number.POSITIVE_INFINITY);
  return state.data;
}

/**
 * RG 双通道 3D 纹理（RGFormat/UnsignedByte，参数约定与
 * `volume.buildDensityTexture` 一致；消费方卸载时须 dispose，附录 A §6）
 */
export function createRgDensityTexture(
  size: number,
  data: Uint8Array<ArrayBuffer>,
): THREE.Data3DTexture {
  assertVolumeTextureSize(size);
  if (data.length !== size * size * size * 2) {
    throw new RangeError(
      `RG 体素数据长度须为 ${size ** 3 * 2}（size³×2），收到 ${data.length}`,
    );
  }
  const texture = new THREE.Data3DTexture(data, size, size, size);
  texture.format = THREE.RGFormat;
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

/**
 * 双通道发射-吸收积分 CPU 参考实现（与 NebulaVolumeMaterial shader 循环同式）
 *
 * 离散格式（shader 镜像，单测据此校验一致性）：
 *   E    += T_i · e_i · Δt
 *   T_{i+1} = T_i · exp(−(e_i·σe + a_i·σd) · Δt)
 * a_i（尘埃）只消光不发射——前景尘埃湾在视线上表现为暗区。
 *
 * @param emission 发射密度序列（≥0）
 * @param absorption 吸收密度序列（与 emission 等长，≥0）
 * @param stepLen 步长 Δt（>0）
 * @param sigmaEmission 发射介质自吸收系数 σe（≥0）
 * @param sigmaDust 尘埃消光系数 σd（≥0）
 */
export function integrateEmissionAbsorptionDual(
  emission: ArrayLike<number>,
  absorption: ArrayLike<number>,
  stepLen: number,
  sigmaEmission: number,
  sigmaDust: number,
): EmissionAbsorptionResult {
  if (emission.length !== absorption.length) {
    throw new RangeError(
      `发射/吸收序列长度须一致，收到 ${emission.length} / ${absorption.length}`,
    );
  }
  if (!(stepLen > 0) || !Number.isFinite(stepLen)) {
    throw new RangeError(`步长必须为正有限数，收到 ${stepLen}`);
  }
  if (!(sigmaEmission >= 0) || !(sigmaDust >= 0)) {
    throw new RangeError(`吸收系数必须非负，收到 σe=${sigmaEmission} σd=${sigmaDust}`);
  }
  let transmittance = 1;
  let sum = 0;
  for (let i = 0; i < emission.length; i += 1) {
    const e = Math.max(0, emission[i]);
    const a = Math.max(0, absorption[i]);
    sum += transmittance * e * stepLen;
    transmittance *= Math.exp(-(e * sigmaEmission + a * sigmaDust) * stepLen);
  }
  return { emission: sum, transmittance };
}

/**
 * 恒定双通道密度的发射-吸收解析解（单测对照基准）
 *
 * σ_t = e·σe + a·σd；T = exp(−σ_t·L)；E = e·(1 − T)/σ_t（σ_t=0 退化 E = e·L）。
 */
export function constantDualEmissionAnalytic(
  emissionDensity: number,
  absorptionDensity: number,
  sigmaEmission: number,
  sigmaDust: number,
  pathLen: number,
): EmissionAbsorptionResult {
  if (!(emissionDensity >= 0) || !(absorptionDensity >= 0) || !(pathLen >= 0)) {
    throw new RangeError(
      `密度与路径长度必须非负，收到 e=${emissionDensity} a=${absorptionDensity} L=${pathLen}`,
    );
  }
  const sigmaT = emissionDensity * sigmaEmission + absorptionDensity * sigmaDust;
  if (sigmaT === 0) {
    return { emission: emissionDensity * pathLen, transmittance: 1 };
  }
  const transmittance = Math.exp(-sigmaT * pathLen);
  return { emission: (emissionDensity * (1 - transmittance)) / sigmaT, transmittance };
}
