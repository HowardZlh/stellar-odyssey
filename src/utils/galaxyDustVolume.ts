/**
 * 星系体积尘埃盘纯逻辑（R5-2，IMPROVEMENT_REQUIREMENTS_5 §R5-2 / §0.3 方案 F）
 *
 * 旋涡星系近观叠加薄盘包围盒体积层：密度 = R5-1 尘埃通道 2D 图（双线性
 * 采样）× z 向指数薄层（**伪 3D 登记**：影像只提供盘面 2D 分布，垂直
 * 分布为归一化指数衰减参数模型，与 R5-1 粒子层 z 向参数化口径一致）。
 * **纯吸收模式**：发射为零（VolumeMaterial uIntensity=0），仅按透过率
 * T = exp(-∫ρσds) 衰减后方颜色（星光粒子/核球辉光/背景）。
 *
 * ── 消光实现方案登记（§R5-2 需求二选一，取 a）──────────────────────────
 * a)（本实现）体积层置于星光粒子之后（VOLUME_RENDER_ORDER 合成）按
 *    透过率调制帧缓冲——近似：屏幕上处于包围盒足印内的**全部**已绘
 *    内容（含盘近侧、相机与尘埃层之间的粒子）被同一透过率压暗，
 *    非逐粒子深度精确；
 * b)（未取）粒子 shader 逐粒子采样尘埃图消光——每颗粒子按自身位置到
 *    相机的视线段积分消光，深度精确但需改造全部星光粒子 shader 且
 *    无法作用于粒子以外的辉光/贴图层，改动大。
 *    差异：a 对"尘埃层前方"的粒子有过度压暗（近观语境下体积仅在跟随
 *    本星系时激活、盘薄且相机多处盘外，目验影响有限——与星云体积层
 *    "无深度合成"差异登记同源）；b 无此误差但覆盖面反而更窄。
 *
 * ── 各向异性光程修正（薄盒非均匀缩放）───────────────────────────────────
 * 体积盒世界缩放为（宽, 薄, 宽）非均匀：raymarch 在单位盒局部空间步进，
 * 局部步长不反映世界光程——若不修正，正视（穿薄轴）与侧视（穿盘面）
 * 光学深度相同，斜视/侧视消光增强的物理特征丢失。经 VolumeMaterial
 * uWorldStepScale（本模块 dustWorldStepScale 归一化：最长轴=1）把局部
 * 步长换算为相对世界光程，侧视光程 ≈ 正视的 宽/厚 倍——消光随倾角
 * 增强，M31 斜视近侧尘埃环真实遮挡核球辉光（§R5-2 验收特征）。
 *
 * ── 极侧视（~90°）观感限制登记（M31 打样目验结论）─────────────────────
 * 恰好侧视时暗带屏幕投影宽度为真实尺度（尘埃标高 ~500 ly ≈ 数像素），
 * 且星光粒子加性混合在侧视沿视线堆积为高 HDR 亮度（×Bloom 泛光），
 * 纯吸收透过率乘法后残余亮度仍 >1 → 暗线细弱（放大截图可辨）。这与
 * R4-10 暗粒子"normal 混合画粗暗线"的非物理观感不同，属正确物理呈现；
 * 消光立体效果的主验收姿态为 M31 真实 77° 斜视（近侧暗带遮挡核球）。
 *
 * ── 覆盖清单与强度登记 ─────────────────────────────────────────────────
 * m31/m33（旋涡）+ lmc（不规则但有可辨暗带，**消光强度弱档登记**：
 * LMC 尘埃柱密度低于旋涡盘，σ 取 M31 的 ~1/3）；smc 不套用（尘埃更弱
 * 且 R4-9/R5-1 尘埃粒子配额即为 0，登记）；椭圆星系无尘埃盘不套用。
 *
 * ── 与 R4-10 dust 暗粒子互斥（§0.3 方案 F 登记）─────────────────────────
 * 体积层激活（构建就绪且门控淡入）时，近观层 dust normal 混合暗粒子
 * 按体积淡入权重互补淡出（GalaxyNearView.tsx dustDim 消费），避免
 * "画暗点 + 挡光"双重叠加；体积卸载/降级（产物缺失）时暗粒子恢复
 * R4-10 现状——降级路径零回退。
 *
 * ── 纹理与预算 ────────────────────────────────────────────────────────
 * 3D 密度纹理非立方 128×32×128（R8，512 KB）：盘面 128²（尘埃通道
 * 256² 双线性降采样，登记）、垂直 32 层（指数衰减平滑，线性过滤足够）；
 * 各维 ≤128 遵守附录 A 体积纹理上限。构建为可分离乘积（盘面预采样 ×
 * 垂直衰减查表），单次同步构建 ~0.5M 次乘法 ≪100ms 卡顿约束（登记，
 * 无需分帧烘焙）。volume 池容量 1 与星云体积层同池（LRU 互逐）。
 */

import {
  estimateGpuBytes,
  VOLUME_TEXTURE_MAX_SIZE,
  type DetailLayerSpec,
} from '@/utils/detailLayer';
import {
  galaxyNearViewEnterDistanceUnits,
  type GalaxyChannelMap,
} from '@/utils/galaxyNearView';
import { NEAR_VIEW_EXIT_RATIO } from '@/utils/nearView';

// ---------------------------------------------------------------------------
// 覆盖清单与逐星系参数登记
// ---------------------------------------------------------------------------

/** 体积尘埃盘覆盖清单（§R5-2：M31 打样 + M33/LMC 套用；SMC/椭圆不套用登记） */
export const DUST_VOLUME_GALAXY_IDS = ['m31', 'm33', 'lmc'] as const;

/** 是否为体积尘埃盘覆盖星系 */
export function isDustVolumeGalaxy(id: string): boolean {
  return (DUST_VOLUME_GALAXY_IDS as readonly string[]).includes(id);
}

/** 逐星系体积尘埃盘参数（登记值；预览页滑杆可覆写目检调参） */
export interface GalaxyDustVolumeParams {
  /**
   * 消光系数 σ（相对世界光程单位＝盒最长轴；LMC 弱档登记）。
   * 量级依据：旋涡星系尘埃带侧视近乎不透明（τ≫1）、正视暗纹可辨
   * （τ~0.1–0.5）——σ 使侧视全宽光程 τ≈σ×均值密度 达 3–6。
   */
  extinctionSigma: number;
  /**
   * 尘埃层包围盒全厚（光年）：略薄于 R5-1 恒星盘 z 厚度
   * （imageDrivenThicknessLy）——真实尘埃盘标高小于恒星盘，
   * 侧视呈现"暗带切分星光"经典观感。
   */
  boxThicknessLy: number;
  /**
   * 垂直指数标高（归一化半厚单位 ∈(0,1]）：
   * 标高（光年）= h01 × boxThicknessLy / 2。
   */
  h01: number;
}

/**
 * 逐星系登记值（M31 打样目验调参定档，预览页滑杆可继续覆写）。
 * 真实参照（量级近似登记，非精确拟合）：
 * - M31：尘埃盘标高 ~100–200 pc 量级 → 盒厚 3,000 ly（= 恒星盘 z 厚）、
 *   标高 500 ly；σ=30 主档（77° 斜视近侧暗带遮挡核球辉光可辨、
 *   非全域压暗——打样对照截图登记）；
 * - M33：盘更薄弱 → 盒厚 1,600 ly（= 恒星盘）、标高 350 ly；σ=22；
 * - LMC：不规则、尘埃弱（§R5-2 强度参数登记）→ σ=10 弱档（= M31 的
 *   1/3）；盒厚 3,600 ly（恒星层 4,400 ly 的 ~0.82）、标高 800 ly。
 */
export const GALAXY_DUST_VOLUME_PARAMS: Readonly<Record<string, GalaxyDustVolumeParams>> = {
  m31: { extinctionSigma: 30, boxThicknessLy: 3000, h01: 500 / (3000 / 2) },
  m33: { extinctionSigma: 22, boxThicknessLy: 1600, h01: 350 / (1600 / 2) },
  lmc: { extinctionSigma: 10, boxThicknessLy: 3600, h01: 800 / (3600 / 2) },
};

/** 按 id 取登记参数（未覆盖星系抛错，注册期防错） */
export function galaxyDustVolumeParams(galaxyId: string): GalaxyDustVolumeParams {
  const params = GALAXY_DUST_VOLUME_PARAMS[galaxyId];
  if (!params || !isDustVolumeGalaxy(galaxyId)) {
    throw new RangeError(`非体积尘埃盘覆盖星系 id：${galaxyId}`);
  }
  return params;
}

// ---------------------------------------------------------------------------
// 密度场（尘埃通道 2D 图 × 垂直指数薄层，伪 3D）
// ---------------------------------------------------------------------------

/** 3D 密度纹理盘面单边分辨率（≤128 附录 A 约束；256² 尘埃图降采样登记） */
export const DUST_VOLUME_TEX_SIZE_XZ = 128;

/** 3D 密度纹理垂直层数（指数衰减平滑，线性过滤下 32 层足够） */
export const DUST_VOLUME_TEX_SIZE_Y = 32;

/** 体积层基准步进数（薄盒光程短，48 步；自适应质量按档位缩放） */
export const DUST_VOLUME_BASE_STEPS = 48;

/**
 * 尘埃图对比度指数（密度 = dust01^γ；γ=2 与 R4-10 尘埃粒子权重
 * dust01² 同口径）：抑制弥散暗缺损地板、突出主暗带——斜视长光程下
 * 若不整形，弥散分量沿弦积累为全域压暗，暗带图案反被淹没
 * （M31 打样目验修正登记）。
 */
export const DUST_VOLUME_MAP_GAMMA = 2;

/**
 * 尘埃通道双线性采样（纯函数）：
 * u01/v01 ∈ [0,1] 为图归一化坐标（u→列/局部 x、v→行/局部 z，与
 * R5-1 sampleParticlesFromMap 的 UV→盘面坐标口径一致），越界钳制到
 * 边缘（ClampToEdge 语义）。返回 [0,1]。
 */
export function sampleDustBilinear(dust: GalaxyChannelMap, u01: number, v01: number): number {
  const { size, data } = dust;
  if (!Number.isInteger(size) || size < 2 || data.length !== size * size) {
    throw new RangeError(`尘埃图尺寸非法：size=${size}, data.length=${data.length}`);
  }
  if (!Number.isFinite(u01) || !Number.isFinite(v01)) {
    throw new RangeError(`采样坐标必须为有限数，收到 (${u01}, ${v01})`);
  }
  // 像素中心对齐：u01=0 → 像素 0 中心，u01=1 → 像素 size-1 中心
  const x = Math.min(Math.max(u01, 0), 1) * (size - 1);
  const z = Math.min(Math.max(v01, 0), 1) * (size - 1);
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const x1 = Math.min(x0 + 1, size - 1);
  const z1 = Math.min(z0 + 1, size - 1);
  const fx = x - x0;
  const fz = z - z0;
  const a = data[z0 * size + x0] * (1 - fx) + data[z0 * size + x1] * fx;
  const b = data[z1 * size + x0] * (1 - fx) + data[z1 * size + x1] * fx;
  return (a * (1 - fz) + b * fz) / 255;
}

/**
 * 垂直指数薄层衰减（纯函数，归一化）：y01 ∈ [-1,1]（盒半厚归一化），
 * h01 为归一化标高。返回归一化指数衰减
 * f = (exp(-|y|/h) - exp(-1/h)) / (1 - exp(-1/h))：
 * 中心 f(0)=1、盒边缘 f(±1)=0（包围盒边界无硬截断缝，登记）。
 */
export function dustVerticalFalloff(y01: number, h01: number): number {
  if (!Number.isFinite(h01) || h01 <= 0 || h01 > 1) {
    throw new RangeError(`垂直标高 h01 必须 ∈(0,1]，收到 ${h01}`);
  }
  if (!Number.isFinite(y01)) {
    throw new RangeError(`y01 必须为有限数，收到 ${y01}`);
  }
  const a = Math.abs(y01);
  if (a >= 1) return 0;
  const edge = Math.exp(-1 / h01);
  return (Math.exp(-a / h01) - edge) / (1 - edge);
}

/**
 * 尘埃盘 3D 密度参考采样（纯函数，CPU 参考实现——纹理构建与单测同式）：
 * 坐标 ∈ [-1,1]³（盒归一化，x/z 盘面、y 垂直），返回 [0,1]。
 * 盘面值经对比度整形 dust01^γ（DUST_VOLUME_MAP_GAMMA 登记）。
 */
export function dustDiskDensityAt(
  dust: GalaxyChannelMap,
  x01: number,
  y01: number,
  z01: number,
  h01: number,
): number {
  return (
    Math.pow(sampleDustBilinear(dust, (x01 + 1) / 2, (z01 + 1) / 2), DUST_VOLUME_MAP_GAMMA) *
    dustVerticalFalloff(y01, h01)
  );
}

/**
 * 构建薄盘 3D 密度体素数据（R8 字节，布局 x + sx·(y + sy·z)，与
 * THREE.Data3DTexture(data, width=sx, height=sy, depth=sz) 一致）。
 *
 * 可分离乘积优化：盘面 sx×sz 预采样 × 垂直 sy 衰减查表（~sx·sy·sz 次
 * 乘法，128×32×128 ≈ 0.5M 同步 ≪100ms，登记免分帧）。体素中心映射
 * (i+0.5)/n → [0,1]（与 utils/volume.buildDensityData 同口径）。
 * 两次调用逐字节一致（确定性，单测断言）。
 */
export function buildDustDiskDensityData(
  dust: GalaxyChannelMap,
  sizeXZ: number,
  sizeY: number,
  h01: number,
): Uint8Array<ArrayBuffer> {
  for (const [label, n] of [
    ['盘面', sizeXZ],
    ['垂直', sizeY],
  ] as const) {
    if (!Number.isInteger(n) || n < 2 || n > VOLUME_TEXTURE_MAX_SIZE) {
      throw new RangeError(
        `${label}分辨率必须为 2–${VOLUME_TEXTURE_MAX_SIZE} 整数，收到 ${n}`,
      );
    }
  }
  // 盘面预采样（双线性降采样 256²→sizeXZ²，体素中心）+ 对比度整形 ^γ
  const plane = new Float32Array(sizeXZ * sizeXZ);
  for (let z = 0; z < sizeXZ; z += 1) {
    const v01 = (z + 0.5) / sizeXZ;
    for (let x = 0; x < sizeXZ; x += 1) {
      plane[z * sizeXZ + x] = Math.pow(
        sampleDustBilinear(dust, (x + 0.5) / sizeXZ, v01),
        DUST_VOLUME_MAP_GAMMA,
      );
    }
  }
  // 垂直衰减查表（体素中心 y01 ∈ (-1,1)）
  const falloff = new Float32Array(sizeY);
  for (let y = 0; y < sizeY; y += 1) {
    falloff[y] = dustVerticalFalloff(((y + 0.5) / sizeY) * 2 - 1, h01);
  }
  const out = new Uint8Array(sizeXZ * sizeY * sizeXZ);
  let i = 0;
  for (let z = 0; z < sizeXZ; z += 1) {
    for (let y = 0; y < sizeY; y += 1) {
      const f = falloff[y];
      const row = z * sizeXZ;
      for (let x = 0; x < sizeXZ; x += 1) {
        out[i] = Math.round(plane[row + x] * f * 255);
        i += 1;
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 透过率（纯吸收参考实现，与 shader 同式）与各向异性光程
// ---------------------------------------------------------------------------

/**
 * 纯吸收透过率（CPU 参考实现，供单测校验 shader 离散格式）：
 * T = Π exp(-ρᵢ·σ·Δt) —— 与 utils/volume.integrateEmissionAbsorption
 * 的 transmittance 分支同式（发射为零时该函数 emission 恒 0，
 * 单测交叉断言）。
 */
export function dustTransmittance(
  densities: readonly number[],
  stepLen: number,
  sigma: number,
): number {
  if (!Number.isFinite(stepLen) || stepLen <= 0) {
    throw new RangeError(`步长必须为正有限数，收到 ${stepLen}`);
  }
  if (!Number.isFinite(sigma) || sigma < 0) {
    throw new RangeError(`消光系数必须为非负有限数，收到 ${sigma}`);
  }
  let opticalDepth = 0;
  for (const d of densities) {
    if (!Number.isFinite(d) || d < 0) {
      throw new RangeError(`密度必须为非负有限数，收到 ${d}`);
    }
    opticalDepth += d * sigma * stepLen;
  }
  return Math.exp(-opticalDepth);
}

/**
 * 各向异性光程缩放（uWorldStepScale uniform 值）：非均匀盒世界缩放
 * (sx, sy, sz) 按最长轴归一化——局部单位步长沿方向 d 的相对世界光程
 * = |d ⊙ scale01|。归一化使 σ 与盒绝对尺寸解耦（σ 以"最长轴光程"
 * 为单位，逐星系可比，登记）。
 */
export function dustWorldStepScale(
  sx: number,
  sy: number,
  sz: number,
): [number, number, number] {
  for (const s of [sx, sy, sz]) {
    if (!Number.isFinite(s) || s <= 0) {
      throw new RangeError(`盒缩放分量必须为正有限数，收到 (${sx}, ${sy}, ${sz})`);
    }
  }
  const max = Math.max(sx, sy, sz);
  return [sx / max, sy / max, sz / max];
}

// ---------------------------------------------------------------------------
// 包围盒与细节层规格（volume 池，与星云体积层同池容量 1）
// ---------------------------------------------------------------------------

/** 体积尘埃盒世界尺寸（场景单位） */
export interface DustVolumeBoxUnits {
  x: number;
  y: number;
  z: number;
}

/**
 * 尘埃盒世界尺寸：盘面 x/z = 贴图平面全宽（sizeUnits，覆盖尘埃图全域
 * ——与近观粒子层 unitsPerLy = sizeUnits/2/mapRadiusLy 同口径对齐，
 * 交叉淡出无尺度跳变）；y = boxThicknessLy 等比换算。
 */
export function galaxyDustVolumeBoxUnits(
  galaxyId: string,
  sizeUnits: number,
  mapRadiusLy: number,
  boxThicknessLyOverride?: number,
): DustVolumeBoxUnits {
  if (!Number.isFinite(sizeUnits) || sizeUnits <= 0) {
    throw new RangeError(`贴图平面尺寸必须为正有限数，收到 ${sizeUnits}`);
  }
  if (!Number.isFinite(mapRadiusLy) || mapRadiusLy <= 0) {
    throw new RangeError(`图半径必须为正有限数，收到 ${mapRadiusLy}`);
  }
  const params = galaxyDustVolumeParams(galaxyId);
  const thicknessLy = boxThicknessLyOverride ?? params.boxThicknessLy;
  if (!Number.isFinite(thicknessLy) || thicknessLy <= 0) {
    throw new RangeError(`盘厚必须为正有限数，收到 ${thicknessLy}`);
  }
  const unitsPerLy = sizeUnits / 2 / mapRadiusLy;
  return { x: sizeUnits, y: thicknessLy * unitsPerLy, z: sizeUnits };
}

/** 体积尘埃盘纹理 GPU 字节（128×32×128 R8 = 512 KB，非立方登记） */
export const DUST_VOLUME_TEX_BYTES =
  DUST_VOLUME_TEX_SIZE_XZ * DUST_VOLUME_TEX_SIZE_Y * DUST_VOLUME_TEX_SIZE_XZ;

/**
 * 体积尘埃盘细节层规格（useDetailLayer 入参；调用方 useMemo 稳定）：
 * kind='volume' 与星云体积层同池（容量 1，星系↔星云巡游 LRU 互逐）；
 * 进入/退出阈值与星系近观粒子层同源（galaxyNearViewEnterDistanceUnits
 * ×1.4 滞回）——体积随近观层同时机激活，交叉淡出无空档。
 */
export function galaxyDustVolumeDetailLayerSpec(galaxyId: string): DetailLayerSpec {
  galaxyDustVolumeParams(galaxyId); // 覆盖校验（未覆盖抛错）
  const enterDistanceUnits = galaxyNearViewEnterDistanceUnits(galaxyId);
  return {
    bodyId: galaxyId,
    kind: 'volume',
    enterDistanceUnits,
    exitDistanceUnits: enterDistanceUnits * NEAR_VIEW_EXIT_RATIO,
    budget: {
      volumeTexBytes: DUST_VOLUME_TEX_BYTES,
      gpuBytesEstimate: estimateGpuBytes({ volumeTexBytes: DUST_VOLUME_TEX_BYTES }),
    },
  };
}

/**
 * 体积视觉淡入目标（与 nebulaVolumeScene.orionVolumeFadeTarget 同语义）：
 * 纹理就绪前目标 0（R4-10 dust 暗粒子保持，互斥切换无空档），就绪后
 * 跟随门控权重。
 */
export function dustVolumeFadeTarget(gate01: number, ready: boolean): number {
  if (!Number.isFinite(gate01) || gate01 < 0 || gate01 > 1) {
    throw new RangeError(`门控权重必须 ∈[0,1]，收到 ${gate01}`);
  }
  return ready ? gate01 : 0;
}
