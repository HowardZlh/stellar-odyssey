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

/* ════════════════════════════════════════════════════════════════════════
 * 环状星云 M57 壳层密度场（R4-14，IMPROVEMENT_REQUIREMENTS_4 §R4-14）
 *
 * 形态登记（附录 A §4，数据源 §0.4：O'Dell et al. 2013, ApJ 780, 26 的
 * 三轴椭球壳模型仅作形状参考，程序化近似构建）：
 * - 骨架：三轴椭球壳（半轴 a:b:c ≈ 1:0.82:0.65，极轴 = +z 朝观察者，
 *   登记：真实极轴相对视线倾斜 ~30°，主场景由环面姿态组承担倾斜）；
 *   赤道增密环 + 极向暗瓣（密度随椭球坐标极角余弦平滑衰减至 ~0.22，
 *   正视呈"环"、侧视呈"桶状/椭球壳"——§R4-14 验收核心）；
 * - 内腔近空：壳内侧密度经壳层 SDF 软衰减归零，仅留 ~0.05 弱 OIII
 *   内充盈（真实 M57 腔内有微弱 OIII/HeII 发射）；
 * - 外晕弱壳：壳中面 ×1.35 的宽软壳（幅度 ~0.06，早期质量抛射晕近似，
 *   仅取内晕一层、真实双层晕合并登记）；
 * - 双色：色权重随椭球归一化半径 qLen 上升（`m57ColorWeight01`，
 *   shader 侧以 uWeightInvRadii 椭球归一化镜像）——壳内缘 OIII 青绿、
 *   外缘 Hα/NII 红橙（真实观测：内 OIII 绿/外 NII 红，NII 与 Hα 合并
 *   为单一红橙档登记）；
 * - 吸收通道恒零登记：M57 无显著前景尘埃暗结构，G 通道恒 0（单测断言）；
 * - 细节：壳层为解析式塑形（§R4-14 省 token 约定），噪声仅做扰动——
 *   3 八度 fBm 调制壳半径（±0.1 qLen）与密度束状起伏，无骨架级噪声结构。
 *
 * 纹理 96³ 预算登记（§R4-14 第 2 条：结构较简单）：RG 双通道 1 B/通道
 * = 96³×2 ≈ 1.69 MB（≪128³ 的 4 MB；≤64 MB 总预算）。
 * ════════════════════════════════════════════════════════════════════════ */

/** M57 体积层确定性种子 id（与 catalog/specialBodies 的天体 id 一致） */
export const M57_VOLUME_ID = 'ring-nebula';

/** M57 密度纹理边长（§R4-14：96³ 即可，预算登记见上） */
export const M57_TEXTURE_SIZE = 96;

/** 三轴椭球壳中面半轴（归一化域 [-1,1]³；a:b:c ≈ 1:0.83:0.66） */
export const M57_SHELL_RADII: readonly [number, number, number] = [0.58, 0.48, 0.38];

/** 壳层全厚（椭球归一化半径 qLen 单位；含软衰减后环宽/环径比 ≈ 真实亮环量级） */
export const M57_SHELL_THICKNESS = 0.32;

/** 壳层软衰减宽度（qLen 单位） */
const M57_SHELL_SOFTNESS = 0.08;

/** 壳半径湍流扰动幅度（qLen 单位，±该值；仅扰动不塑形） */
const M57_SHELL_PERTURB = 0.1;

/** 极向暗瓣残余密度（赤道 = 1 基准；O'Dell 2013 极向低密度瓣近似档） */
export const M57_POLAR_FLOOR = 0.22;

/** 内腔弱充盈幅度（腔内微弱 OIII/HeII 发射近似） */
export const M57_CAVITY_FILL = 0.05;

/** 外晕壳中面（qLen 单位）与幅度（早期质量抛射晕，单层近似登记；中面经
 * "晕外缘 ≤ 归一化域边界"约束标定：(1.35 + 半厚 0.18 + 软衰减 0.2)×0.58 ≈ 1.0） */
export const M57_HALO_RADII_FACTOR = 1.35;
export const M57_HALO_STRENGTH = 0.06;

/** 外晕软壳全厚与衰减宽度（qLen 单位；域边界约束的另两项，登记见上） */
const M57_HALO_THICKNESS = 0.36;
const M57_HALO_SOFTNESS = 0.2;

/** 早退门（qLen 单位）：晕外缘软衰减可达范围之外零噪声调用 */
const M57_EARLY_EXIT_QLEN = M57_HALO_RADII_FACTOR + M57_HALO_THICKNESS / 2 + M57_HALO_SOFTNESS;

/** 双色权重内径：椭球归一化半径 ≤ 此值 → OIII 权重 1（青绿） */
export const M57_COLOR_WEIGHT_INNER_R = 0.82;

/** 双色权重外径：椭球归一化半径 ≥ 此值 → Hα/NII 权重 1（红橙） */
export const M57_COLOR_WEIGHT_OUTER_R = 1.28;

/**
 * M57 Hα(NII)/OIII 混色权重（0 = 内缘 OIII 青绿，1 = 外缘 Hα/NII 红橙）
 *
 * 椭球归一化半径近似登记：权重随 qLen = |(x/a, y/b, z/c)| 平滑上升
 * （smoothstep INNER → OUTER），shader 侧以 uWeightInvRadii = (1/a,1/b,1/c)
 * 同式镜像（单测锚定关键点）。
 *
 * @param qLen 椭球归一化半径（须为非负有限数；壳中面 = 1）
 */
export function m57ColorWeight01(qLen: number): number {
  if (!(qLen >= 0) || !Number.isFinite(qLen)) {
    throw new RangeError(`椭球归一化半径必须为非负有限数，收到 ${qLen}`);
  }
  return sstep(M57_COLOR_WEIGHT_INNER_R, M57_COLOR_WEIGHT_OUTER_R, qLen);
}

/**
 * 生成 M57 双通道密度采样器（确定性：同种子输出逐点一致）
 *
 * 性能登记：每体素 ≤3 次 3D 值噪声调用（fBm 3 八度共用一轮），外晕
 * 之外的体素零噪声调用（早退）；96³ 全量计算实测远低于 M42 128³ 基准。
 *
 * @param seed FNV-1a 种子（默认 `volumeSeed('ring-nebula')`）
 */
export function makeM57Sampler(seed: number = volumeSeed(M57_VOLUME_ID)): NebulaDualSampler {
  // 种子 → 噪声域偏移（fbm3 同款注入方式：不同种子 = 平移采样窗口）
  const rand = createSeededRandom(seed >>> 0);
  const turbOffsets: number[] = [];
  for (let i = 0; i < 9; i += 1) turbOffsets.push(rand() * 96);

  const [ax, ay, az] = M57_SHELL_RADII;

  return (x, y, z, out) => {
    // 吸收通道恒零（M57 无显著前景尘埃，登记见文件头）
    out.absorption = 0;

    // ── 骨架坐标：椭球归一化半径 qLen（壳中面 = 1；所有塑形基于 qLen） ──
    const qx = x / ax;
    const qy = y / ay;
    const qz = z / az;
    const qLen = Math.sqrt(qx * qx + qy * qy + qz * qz);

    // ── 早退门（无噪声）：晕外缘软衰减可达范围之外直接归零 ──
    if (qLen > M57_EARLY_EXIT_QLEN) {
      out.emission = 0;
      return;
    }

    // ── 细节层：3 八度 fBm（壳半径扰动 + 密度束状起伏共用，仅做扰动） ──
    let turb = 0;
    let amp = 1;
    let freq = 3.5;
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

    // ── 骨架：三轴椭球壳（解析式塑形；壳半径经湍流扰动 ±0.1 去正椭球感） ──
    const dShell = qLen - 1 - (turb - 0.5) * (M57_SHELL_PERTURB * 2);
    const shell01 = sdfDensityFalloff(shellSdf(dShell, M57_SHELL_THICKNESS), M57_SHELL_SOFTNESS);

    // 赤道增密环 + 极向暗瓣：椭球坐标极角余弦 |qz|/qLen 平滑压暗
    const cosPolar = qLen > 1e-6 ? Math.abs(qz) / qLen : 0;
    const equator01 = 1 - (1 - M57_POLAR_FLOOR) * sstep(0.35, 0.9, cosPolar);

    // 内腔弱充盈（qLen < 壳内缘时的微弱 OIII 发射；随 qLen 上升并入壳）
    const cavityFill = M57_CAVITY_FILL * sstep(1, 0.25, qLen) * equator01;

    // 外晕弱壳（宽软壳；同样受极向压暗，幅度低）
    const halo01 = sdfDensityFalloff(
      shellSdf(qLen - M57_HALO_RADII_FACTOR, M57_HALO_THICKNESS),
      M57_HALO_SOFTNESS,
    );
    const halo = M57_HALO_STRENGTH * halo01 * (0.4 + 0.6 * equator01);

    // 密度束状起伏（径向丝缕感：0.55–1 调制，不撕裂壳层）
    const mod = 0.55 + 0.45 * turb;

    const em = shell01 * equator01 * mod + cavityFill + halo * mod;
    out.emission = Math.min(1, Math.max(0, em));
  };
}

/* ════════════════════════════════════════════════════════════════════════
 * 马头星云 Barnard 33 吸收密度场（R4-15，IMPROVEMENT_REQUIREMENTS_4 §R4-15）
 *
 * 形态登记（附录 A §4，数据源 §0.4：NASA/ESA Hubble 公版图像仅作轮廓
 * 参考，程序化近似构建）：
 * - 吸收为主：马头轮廓 = 5 个椭球 SDF 平滑并（颈柱/头部/吻部/鬃丘 +
 *   底部暗云堤——B33 从 Lynds 1630 暗云堤伸出的形态近似；§R4-15 省
 *   token 约定"3–4 个椭球布尔组合"，为补底部云堤取 5 个，登记）
 *   + 3 八度 fBm 边缘侵蚀（轮廓半径扰动 ±0.09 + 表层湍流阈值化碎散
 *   云缘）；近似度登记：只复现"垂直颈柱 + 头部朝 +x 突出 + 吻部 +
 *   顶部鬃丘"的剪影相对方位与量级，不逐像素贴合照片；
 * - 马头轮廓内发射通道近零（冷分子云不发光，单测断言 ≤0.02）；
 * - 背景发射幕（§R4-15 第 2 条，二选一登记取"低密度大尺度发射层"）：
 *   IC 434 红色发射幕烘焙进体积后半域（z ≤ 0 侧软窗过渡 + 盒边缘软窗
 *   防切边），剪影 = raymarch 内吸收柱按透射率物理遮挡背景幕——侧向
 *   绕行可见云柱与发射幕的真实纵深（验收核心）；主场景既有背景
 *   billboard 保留并部分减淡作幕布远景延伸（nebulaVolumeScene 登记）；
 * - 单色登记：IC 434 为 Hα 主导发射（红），材质双色权重经 weightBias=1
 *   恒取 colorHa 档（OIII 通道对马头无观测意义）。
 *
 * 纹理 96³ 预算登记：RG 双通道 1 B/通道 = 96³×2 ≈ 1.69 MB（≤64 MB
 * 总预算，volume 池容量 1 与 M42/M57 共池 LRU）。
 * ════════════════════════════════════════════════════════════════════════ */

/** 马头星云体积层确定性种子 id（与 data/specialBodies 的天体 id 一致） */
export const HORSEHEAD_VOLUME_ID = 'horsehead-nebula';

/** 马头密度纹理边长（结构较 M42 简单：96³ 即可，预算登记见上） */
export const HORSEHEAD_TEXTURE_SIZE = 96;

/** 马头轮廓椭球部件（归一化域 [-1,1]³；中心 + 半轴，登记见文件段头） */
export const HORSEHEAD_PILLAR_PARTS: readonly {
  readonly center: readonly [number, number, number];
  readonly radii: readonly [number, number, number];
}[] = [
  /** 颈柱（垂直云柱，向下并入底部云堤） */
  { center: [-0.05, -0.5, 0], radii: [0.3, 0.48, 0.26] },
  /** 头部（顶部主体） */
  { center: [0.04, 0.3, 0], radii: [0.3, 0.32, 0.24] },
  /** 吻部（朝 +x 突出的口鼻） */
  { center: [0.4, 0.26, 0], radii: [0.27, 0.16, 0.18] },
  /** 鬃丘（头顶偏 −x 的鬃毛隆起） */
  { center: [-0.2, 0.5, 0], radii: [0.16, 0.22, 0.15] },
  /** 底部暗云堤（Lynds 1630 边缘近似，马头由此伸出） */
  { center: [0, -0.92, 0], radii: [0.92, 0.38, 0.5] },
] as const;

/** 轮廓平滑并系数（椭球间软融合宽度） */
const HORSEHEAD_UNION_K = 0.15;

/** fBm 轮廓侵蚀幅度（SDF 单位，±该值的半径起伏） */
const HORSEHEAD_ERODE_AMP = 0.09;

/** 吸收软衰减宽度（SDF 单位） */
const HORSEHEAD_ABSORB_SOFTNESS = 0.08;

/** 早退门（SDF 单位）：侵蚀 + 软衰减可达范围之外零噪声调用 */
const HORSEHEAD_EARLY_EXIT_SDF = HORSEHEAD_ERODE_AMP + HORSEHEAD_ABSORB_SOFTNESS + 0.08;

/** IC 434 发射幕基准密度（低密度大尺度层；亮度由材质 uDensityScale 恢复） */
export const HORSEHEAD_SCREEN_LEVEL = 0.16;

/** 发射幕 z 向前缘/满值（z ≤ 前缘起软窗上升，登记：幕布居体积后半域） */
const HORSEHEAD_SCREEN_Z_FRONT = 0.05;
const HORSEHEAD_SCREEN_Z_FULL = -0.35;

/** 马头轮廓内发射上限（"发射通道近零"验收断言值） */
export const HORSEHEAD_PILLAR_EMISSION_MAX = 0.02;

/**
 * 马头轮廓组合 SDF（5 椭球平滑并，无噪声——早退门与侵蚀基准共用）
 *
 * @returns 有符号距离（<0 = 轮廓内）
 */
export function horseheadPillarSdf(x: number, y: number, z: number): number {
  let d = Infinity;
  for (const part of HORSEHEAD_PILLAR_PARTS) {
    const [cx, cy, cz] = part.center;
    const [rx, ry, rz] = part.radii;
    const dPart = ellipsoidSdf(x - cx, y - cy, z - cz, rx, ry, rz);
    d = d === Infinity ? dPart : smoothUnionSdf(d, dPart, HORSEHEAD_UNION_K);
  }
  return d;
}

/**
 * 生成马头星云双通道密度采样器（确定性：同种子输出逐点一致）
 *
 * 性能登记：每体素 ≤3 次 3D 值噪声调用（fBm 3 八度，轮廓侵蚀/尘埃调制/
 * 发射幕云絮共用一轮）；轮廓侵蚀可达范围之外且发射幕前方的体素零噪声
 * 调用（早退）；96³ 全量计算实测远低于 M42 128³ 基准。
 *
 * @param seed FNV-1a 种子（默认 `volumeSeed('horsehead-nebula')`）
 */
export function makeHorseheadSampler(
  seed: number = volumeSeed(HORSEHEAD_VOLUME_ID),
): NebulaDualSampler {
  // 种子 → 噪声域偏移（fbm3 同款注入方式：不同种子 = 平移采样窗口）
  const rand = createSeededRandom(seed >>> 0);
  const turbOffsets: number[] = [];
  for (let i = 0; i < 9; i += 1) turbOffsets.push(rand() * 96);

  return (x, y, z, out) => {
    // ── 骨架：马头轮廓组合 SDF（无噪声，早退门与侵蚀基准共用） ──
    const dBase = horseheadPillarSdf(x, y, z);

    // ── 早退门（无噪声）：轮廓侵蚀可达范围之外且发射幕前方 → 双通道归零 ──
    if (dBase > HORSEHEAD_EARLY_EXIT_SDF && z > HORSEHEAD_SCREEN_Z_FRONT) {
      out.emission = 0;
      out.absorption = 0;
      return;
    }

    // ── 细节层：3 八度 fBm（轮廓侵蚀 + 尘埃束状调制 + 幕布云絮共用） ──
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

    // ── 吸收通道：轮廓经 fBm 侵蚀（半径起伏 ±0.09）＋ 表层阈值化碎散
    // 云缘（深处恒 1——轮廓核心不受侵蚀）＋ 尘埃束状调制 ──
    const dEroded = dBase + (0.5 - turb) * (HORSEHEAD_ERODE_AMP * 2);
    const pillar01 = sdfDensityFalloff(dEroded, HORSEHEAD_ABSORB_SOFTNESS);
    // 表层侵蚀混合：dBase ≤ −0.18 恒 1（深处），近表层按湍流阈值碎散
    const surface01 = sstep(-0.18, -0.02, dBase);
    const edgeMask = 1 - surface01 * (1 - sstep(0.32, 0.52, turb));
    // 盒边缘软窗（吸收防切边：底部云堤延伸至域边界处软化）
    const boxWin =
      sstep(1, 0.85, Math.abs(x)) * sstep(1, 0.85, Math.abs(y)) * sstep(1, 0.85, Math.abs(z));
    const absorb = pillar01 * edgeMask * (0.65 + 0.35 * turb) * boxWin;
    out.absorption = Math.min(1, Math.max(0, absorb));

    // ── 发射通道：IC 434 背景发射幕（低密度大尺度层，轮廓内近零） ──
    // z 向剖面：前缘软窗上升 × 靠近盒背面软收（防背面切边）
    const zProfile =
      sstep(HORSEHEAD_SCREEN_Z_FRONT, HORSEHEAD_SCREEN_Z_FULL, z) * sstep(-1, -0.72, z);
    // 横向软窗（防 x/y 盒边切边）
    const xyWin = sstep(1, 0.7, Math.abs(x)) * sstep(1, 0.7, Math.abs(y));
    // 云絮起伏（0.55–1 调制，大尺度幕布不撕裂）
    const cloud = 0.55 + 0.45 * turb;
    // 轮廓内发射近零（×(1 − 轮廓密度)，单测断言 ≤0.02）
    const em = HORSEHEAD_SCREEN_LEVEL * zProfile * xyWin * cloud * (1 - pillar01);
    out.emission = Math.min(1, Math.max(0, em));
  };
}

/* ════════════════════════════════════════════════════════════════════════
 * 蟹状星云 M1 丝状密度场 + PWN 环面强度（R4-16，IMPROVEMENT_REQUIREMENTS_4
 * §R4-16）
 *
 * 形态登记（附录 A §4，数据源 §0.4：NASA/ESA Hubble 公版图像仅作丝状
 * 网络形态参考、Chandra（Weisskopf et al. 2000）仅作 PWN 环面/喷流形态
 * 参考，程序化近似构建）：
 * - 外围丝状网络（§R4-16 省 token 约定：少量参数化曲线骨架沿线增密 +
 *   噪声扰动，勿做真流体结构）：12 条确定性随机游走折线骨架
 *   （`crabFilamentPolylines`——起点近内缘、方向随游走缓慢漂移、终点近
 *   包络外缘），体素到最近骨架线段距离经软衰减成密度脊，采样域经湍流
 *   值方向场扭曲（±0.06 扭曲 = "方向场扭曲的密度脊"实现登记）+ 沿线
 *   湍流束状调制（丝上亮结）；
 * - 内部 OIII 青色弥散：椭球归一化半径 qLen 的平滑充盈（中心满值 →
 *   包络外缘归零），幅度 ≪ 丝状脊（验收断言 丝状脊 > 弥散区）；
 * - 整体椭球包络：三轴椭球（蟹状整体略呈椭长形态）+ fBm 轮廓扰动去
 *   正椭球感；
 * - 双色：色权重随椭球归一化半径 qLen 上升（`crabColorWeight01`，
 *   shader 侧以 uWeightInvRadii 椭球归一化镜像）——内部 OIII 青弥散、
 *   外围 Hα 红橙丝（登记：纯径向近似，真实蟹状丝网红/青按电离层位
 *   逐丝交织，此处按内外分区近似；丝主要分布于外区 → 呈红橙）；
 * - 吸收通道恒零登记：蟹状无显著前景尘埃暗结构，G 通道恒 0（单测断言）；
 * - PWN 环面强度剖面 `crabTorusIntensity`：主环 + 内环（Chandra 内环/
 *   torus 双环形态）+ 中心弱辉 × 环面平面高斯增强——CPU 纯函数供
 *   环面 shader GLSL 镜像与"环面平面增强"单测断言（§R4-16 第 4 条
 *   实现登记：环面为独立 shader 发射体网格、不烘焙进体积纹理）。
 *
 * 纹理 128³（§R4-16 指定；RG 双通道 = 4 MB，≤64 MB 总预算，volume 池
 * 容量 1 与 M42/M57/马头共池 LRU）。
 * ════════════════════════════════════════════════════════════════════════ */

/** 蟹状星云体积层确定性种子 id（与 data/specialBodies 的天体 id 一致） */
export const CRAB_VOLUME_ID = 'crab-pulsar';

/** 蟹状密度纹理边长（§R4-16：128³，附录 A §1 上限） */
export const CRAB_TEXTURE_SIZE = 128;

/** 椭球包络半轴（归一化域 [-1,1]³；蟹状整体略呈椭长形态） */
export const CRAB_ENVELOPE_RADII: readonly [number, number, number] = [0.78, 0.64, 0.6];

/** 丝状骨架条数（§R4-16 省 token 约定 8–12 条，取 12） */
export const CRAB_FILAMENT_COUNT = 12;

/** 每条骨架折线段数（点数 = 段数 + 1） */
const CRAB_FILAMENT_SEGMENTS = 14;

/** 骨架游走的椭球归一化半径带（丝网笼壳带：外围壳层，非径向辐条） */
const CRAB_FILAMENT_QLEN_MIN = 0.42;
const CRAB_FILAMENT_QLEN_MAX = 0.95;

/** 每段切向弧步长（rad，单位球上的角步进——长弧丝而非短团块） */
const CRAB_FILAMENT_ARC_STEP = 0.24;

/** 丝半径（SDF 单位）与软衰减宽度 */
export const CRAB_FILAMENT_RADIUS = 0.032;
const CRAB_FILAMENT_SOFTNESS = 0.042;

/** 丝状脊采样域方向场扭曲幅度（±该值，湍流值驱动） */
const CRAB_FILAMENT_WARP = 0.06;

/** 内部 OIII 弥散基准幅度（丝状脊满值 ~0.9 的 ≈1/6，验收对比度来源） */
export const CRAB_DIFFUSE_LEVEL = 0.16;

/** 双色权重内径：椭球归一化半径 ≤ 此值 → OIII 权重 1（青弥散区） */
export const CRAB_COLOR_WEIGHT_INNER_R = 0.35;

/** 双色权重外径：椭球归一化半径 ≥ 此值 → Hα 权重 1（红橙丝区） */
export const CRAB_COLOR_WEIGHT_OUTER_R = 0.78;

/**
 * 蟹状 Hα/OIII 混色权重（0 = 内部 OIII 青弥散，1 = 外围 Hα 红橙丝）
 *
 * 椭球归一化半径近似登记：权重随 qLen = |(x/a, y/b, z/c)| 平滑上升
 * （smoothstep INNER → OUTER），shader 侧以 uWeightInvRadii 同式镜像。
 *
 * @param qLen 椭球归一化半径（须为非负有限数；包络中面 = 1）
 */
export function crabColorWeight01(qLen: number): number {
  if (!(qLen >= 0) || !Number.isFinite(qLen)) {
    throw new RangeError(`椭球归一化半径必须为非负有限数，收到 ${qLen}`);
  }
  return sstep(CRAB_COLOR_WEIGHT_INNER_R, CRAB_COLOR_WEIGHT_OUTER_R, qLen);
}

/** 丝状骨架折线（点序列，归一化域坐标） */
export type CrabFilamentPolyline = readonly (readonly [number, number, number])[];

/**
 * 生成蟹状丝状骨架折线（确定性：同种子输出逐点一致）
 *
 * 每条骨架 = 单位球面上的切向随机游走长弧（笼壳丝网形态：丝主要沿
 * 外围壳层缠绕、任意视角投影均呈网状长丝，而非径向辐条投影成团块），
 * 椭球归一化半径 qLen 在壳带内缓慢起伏；点坐标按包络半轴缩放回归一
 * 化域（骨架随椭球形态伸展）。
 *
 * @param seed FNV-1a 种子（默认 `volumeSeed('crab-pulsar')`）
 */
export function crabFilamentPolylines(
  seed: number = volumeSeed(CRAB_VOLUME_ID),
): readonly CrabFilamentPolyline[] {
  // 骨架专用子序列（与采样器湍流偏移解耦：任一侧调参不漂移另一侧）
  const rand = createSeededRandom(((seed ^ 0x6a09e667) >>> 0) || 1);
  const [ax, ay, az] = CRAB_ENVELOPE_RADII;
  const polylines: CrabFilamentPolyline[] = [];
  for (let f = 0; f < CRAB_FILAMENT_COUNT; f += 1) {
    // 起点方向：单位球均匀采样
    const cosPolar = rand() * 2 - 1;
    const azimuth = Math.PI * 2 * rand();
    const sinPolar = Math.sqrt(Math.max(0, 1 - cosPolar * cosPolar));
    let ux = sinPolar * Math.cos(azimuth);
    let uy = cosPolar;
    let uz = sinPolar * Math.sin(azimuth);
    // 初始游走矢量（切向分量驱动弧步进；缓慢漂移产生弯曲缠绕）
    let wx = rand() * 2 - 1;
    let wy = rand() * 2 - 1;
    let wz = rand() * 2 - 1;
    let qLen =
      CRAB_FILAMENT_QLEN_MIN + (CRAB_FILAMENT_QLEN_MAX - CRAB_FILAMENT_QLEN_MIN) * rand();
    const points: (readonly [number, number, number])[] = [];
    for (let s = 0; s <= CRAB_FILAMENT_SEGMENTS; s += 1) {
      points.push([ux * qLen * ax, uy * qLen * ay, uz * qLen * az] as const);
      // 切向弧步进：w 去掉径向分量 → 单位切向 → 方向沿弧前进
      wx += (rand() * 2 - 1) * 0.5;
      wy += (rand() * 2 - 1) * 0.5;
      wz += (rand() * 2 - 1) * 0.5;
      const dotWU = wx * ux + wy * uy + wz * uz;
      let tx = wx - dotWU * ux;
      let ty = wy - dotWU * uy;
      let tz = wz - dotWU * uz;
      const tLen = Math.sqrt(tx * tx + ty * ty + tz * tz) || 1;
      tx /= tLen;
      ty /= tLen;
      tz /= tLen;
      ux += tx * CRAB_FILAMENT_ARC_STEP;
      uy += ty * CRAB_FILAMENT_ARC_STEP;
      uz += tz * CRAB_FILAMENT_ARC_STEP;
      const uLen = Math.sqrt(ux * ux + uy * uy + uz * uz) || 1;
      ux /= uLen;
      uy /= uLen;
      uz /= uLen;
      // 壳带内半径缓慢起伏（±0.05/步，钳制在笼壳带内）
      qLen = Math.min(
        CRAB_FILAMENT_QLEN_MAX,
        Math.max(CRAB_FILAMENT_QLEN_MIN, qLen + (rand() * 2 - 1) * 0.05),
      );
    }
    polylines.push(points);
  }
  return polylines;
}

/** 预处理后的骨架（扁平段数组 + 包围球，采样循环零分配零开方早退） */
interface CrabFilamentBaked {
  /** 段端点扁平数组 [x0,y0,z0, x1,y1,z1, ...]（相邻点即一段） */
  readonly points: Float64Array;
  /** 包围球中心 */
  readonly cx: number;
  readonly cy: number;
  readonly cz: number;
  /** （包围球半径 + 影响截断距离）² —— 平方比较免开方 */
  readonly cullR2: number;
}

/** 丝影响截断距离（SDF 单位：半径 + 软衰减 + 扭曲可达范围） */
const CRAB_FILAMENT_CUTOFF =
  CRAB_FILAMENT_RADIUS + CRAB_FILAMENT_SOFTNESS + CRAB_FILAMENT_WARP + 0.02;

/** 烘焙骨架为扁平段数组 + 包围球（makeCrabSampler 内部/单测辅助共用） */
function bakeCrabFilaments(polylines: readonly CrabFilamentPolyline[]): CrabFilamentBaked[] {
  return polylines.map((poly) => {
    const points = new Float64Array(poly.length * 3);
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (let i = 0; i < poly.length; i += 1) {
      const [x, y, z] = poly[i];
      points[i * 3] = x;
      points[i * 3 + 1] = y;
      points[i * 3 + 2] = z;
      cx += x;
      cy += y;
      cz += z;
    }
    cx /= poly.length;
    cy /= poly.length;
    cz /= poly.length;
    let maxR2 = 0;
    for (let i = 0; i < poly.length; i += 1) {
      const dx = points[i * 3] - cx;
      const dy = points[i * 3 + 1] - cy;
      const dz = points[i * 3 + 2] - cz;
      const r2 = dx * dx + dy * dy + dz * dz;
      if (r2 > maxR2) maxR2 = r2;
    }
    const cullR = Math.sqrt(maxR2) + CRAB_FILAMENT_CUTOFF;
    return { points, cx, cy, cz, cullR2: cullR * cullR };
  });
}

/** 点到骨架段集合的最小距离平方（包围球早退；返回值 ≥ cutoff² 时可视为无丝） */
function filamentMinDist2(
  baked: readonly CrabFilamentBaked[],
  x: number,
  y: number,
  z: number,
): number {
  let best = Infinity;
  for (const fil of baked) {
    const bx = x - fil.cx;
    const by = y - fil.cy;
    const bz = z - fil.cz;
    if (bx * bx + by * by + bz * bz > fil.cullR2) continue;
    const pts = fil.points;
    const segCount = pts.length / 3 - 1;
    for (let s = 0; s < segCount; s += 1) {
      const ax0 = pts[s * 3];
      const ay0 = pts[s * 3 + 1];
      const az0 = pts[s * 3 + 2];
      const ex = pts[s * 3 + 3] - ax0;
      const ey = pts[s * 3 + 4] - ay0;
      const ez = pts[s * 3 + 5] - az0;
      const px = x - ax0;
      const py = y - ay0;
      const pz = z - az0;
      const ee = ex * ex + ey * ey + ez * ez;
      let t = ee > 0 ? (px * ex + py * ey + pz * ez) / ee : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const qx = px - ex * t;
      const qy = py - ey * t;
      const qz = pz - ez * t;
      const d2 = qx * qx + qy * qy + qz * qz;
      if (d2 < best) best = d2;
    }
  }
  return best;
}

/**
 * 点到默认种子骨架集合的最小距离（单测辅助：定位"远离所有丝"的弥散
 * 参考点；渲染路径不消费——采样器内部走平方距离 + 包围球早退）
 */
export function crabFilamentDistance(x: number, y: number, z: number): number {
  return Math.sqrt(filamentMinDist2(bakeCrabFilaments(crabFilamentPolylines()), x, y, z));
}

/** 早退门（qLen 单位）：包络扰动 + 软衰减可达范围之外零噪声/零骨架计算 */
const CRAB_EARLY_EXIT_QLEN = 1.3;

/**
 * 生成蟹状双通道密度采样器（确定性：同种子输出逐点一致）
 *
 * 性能登记：每体素 ≤3 次 3D 值噪声调用（fBm 3 八度，轮廓扰动/丝状束状
 * 调制/弥散起伏共用一轮）；包络外体素零噪声零骨架计算（早退）；骨架
 * 距离经包围球平方距离早退 + 扁平段数组零分配，128³ 全量计算实测
 * 与 M42 同量级（<1s 基准）。
 *
 * @param seed FNV-1a 种子（默认 `volumeSeed('crab-pulsar')`）
 */
export function makeCrabSampler(seed: number = volumeSeed(CRAB_VOLUME_ID)): NebulaDualSampler {
  // 种子 → 噪声域偏移（fbm3 同款注入方式：不同种子 = 平移采样窗口）
  const rand = createSeededRandom(seed >>> 0);
  const turbOffsets: number[] = [];
  for (let i = 0; i < 9; i += 1) turbOffsets.push(rand() * 96);
  const filaments = bakeCrabFilaments(crabFilamentPolylines(seed));

  const [ax, ay, az] = CRAB_ENVELOPE_RADII;
  const cutoff2 = CRAB_FILAMENT_CUTOFF * CRAB_FILAMENT_CUTOFF;

  return (x, y, z, out) => {
    // 吸收通道恒零（蟹状无显著前景尘埃，登记见文件段头）
    out.absorption = 0;

    // ── 骨架坐标：椭球归一化半径 qLen（包络中面 = 1） ──
    const qx = x / ax;
    const qy = y / ay;
    const qz = z / az;
    const qLen = Math.sqrt(qx * qx + qy * qy + qz * qz);

    // ── 早退门（无噪声）：包络可达范围之外直接归零 ──
    if (qLen > CRAB_EARLY_EXIT_QLEN) {
      out.emission = 0;
      return;
    }

    // ── 细节层：3 八度 fBm（轮廓扰动 + 丝束状调制 + 弥散起伏共用） ──
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

    // ── 骨架第 1 层：椭球包络（轮廓经湍流扰动 ±0.1 去正椭球感） ──
    const env01 = sdfDensityFalloff(qLen - 1 - (turb - 0.5) * 0.2, 0.12);
    if (env01 <= 0) {
      out.emission = 0;
      return;
    }

    // ── 骨架第 2 层：内部 OIII 青色弥散（中心满值 → 外缘归零） ──
    const diffuse = CRAB_DIFFUSE_LEVEL * sstep(1.05, 0.3, qLen) * (0.6 + 0.4 * turb);

    // ── 骨架第 3 层：丝状网络（采样域经湍流方向场扭曲 → 密度脊缠绕） ──
    const warp = (turb - 0.5) * (CRAB_FILAMENT_WARP * 2);
    const d2 = filamentMinDist2(filaments, x + warp, y - warp * 0.7, z + warp * 0.5);
    let fil = 0;
    if (d2 < cutoff2) {
      const fil01 = sdfDensityFalloff(Math.sqrt(d2) - CRAB_FILAMENT_RADIUS, CRAB_FILAMENT_SOFTNESS);
      // 沿线束状调制（丝上亮结，0.55–1 不撕裂丝）
      fil = 0.9 * fil01 * (0.55 + 0.45 * turb);
    }

    out.emission = Math.min(1, Math.max(0, (diffuse + fil) * env01));
  };
}

/* ── PWN 环面强度剖面（Chandra 形态参考；shader GLSL 镜像的 CPU 纯函数） ── */

/** 主环中径（环面网格半宽归一化 rho01 单位） */
export const CRAB_TORUS_RING_RHO01 = 0.62;

/** 主环高斯半宽 */
export const CRAB_TORUS_RING_SIGMA = 0.14;

/** 内环中径（Chandra 内环，X 射线激波环近似） */
export const CRAB_TORUS_INNER_RHO01 = 0.28;

/** 内环高斯半宽 */
export const CRAB_TORUS_INNER_SIGMA = 0.07;

/** 环面平面高斯增强半宽（height01 = 离环面平面归一化高度） */
export const CRAB_TORUS_HEIGHT_SIGMA = 0.18;

/**
 * PWN 赤道环面强度剖面（主环 + 内环 + 中心弱辉 × 平面高斯增强）
 *
 * 环面 shader 消费径向部分（平面几何承载 height01 = 0 的平面增强项，
 * 实现登记：CPU 纯函数含高度衰减供"环面平面增强"验收断言——同径向
 * 半径下环面平面内强度 > 离面强度）。
 *
 * @param rho01 环面平面内归一化半径（≥0；主环中径 = CRAB_TORUS_RING_RHO01）
 * @param height01 离环面平面归一化高度（有限数；平面内 = 0）
 */
export function crabTorusIntensity(rho01: number, height01: number): number {
  if (!(rho01 >= 0) || !Number.isFinite(rho01) || !Number.isFinite(height01)) {
    throw new RangeError(`环面坐标必须有限且半径非负，收到 rho01=${rho01} height01=${height01}`);
  }
  const ring = Math.exp(-(((rho01 - CRAB_TORUS_RING_RHO01) / CRAB_TORUS_RING_SIGMA) ** 2));
  const inner =
    0.75 * Math.exp(-(((rho01 - CRAB_TORUS_INNER_RHO01) / CRAB_TORUS_INNER_SIGMA) ** 2));
  const glow = 0.22 * Math.exp(-((rho01 / 0.5) ** 2));
  const plane = Math.exp(-((height01 / CRAB_TORUS_HEIGHT_SIGMA) ** 2));
  return (ring + inner + glow) * plane;
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
