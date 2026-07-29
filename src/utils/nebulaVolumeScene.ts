/**
 * 猎户座星云 M42 体积层主场景接入配置（R4-8，IMPROVEMENT_REQUIREMENTS_4 §R4-8）
 *
 * 纯逻辑模块（附录 A §3 纯函数先行）：为 `Scene/OrionVolumeLayer.tsx`
 * 提供细节层规格（detailLayer volume 池）、位姿尺度、色彩默认参数与
 * 交叉淡出权重计算；组件只消费本模块输出。
 *
 * ── 门控与预算 ───────────────────────────────────────────────────────────
 * - 进入/退出阈值与 R2-7 近观 sprite 层同源同值（nearViewEnter/Exit
 *   DistanceUnits('orion-nebula')）：体积层与 PuffCloud 同时机激活，
 *   交叉淡出在两层重叠窗口内完成（无"先关旧层再开新层"的空档）；
 * - GPU 预算：128³ RG 双通道 1 B/通道 = 4 MB（volumeTextureGpuBytes，
 *   ≤64 MB 总预算，volume 池容量 1——后续 R4-14/15/16 其他体积天体
 *   挂接同池时按 LRU 逐出）。
 *
 * ── 位姿对齐（§R4-8 第 2 条）────────────────────────────────────────────
 * 体积包围盒边长 = visualRadiusLy 场景尺寸 × ORION_VOLUME_BOX_FACTOR
 * （2.6，与 R4-7 预览页 ORION_BOX_SIZE/cameraDistance 观感比例一致）：
 * 密度场发射包络（归一化域内 ~0.75 半径）折算世界半径 ≈ 1.0 × 视觉
 * 半径，与现有 billboard（最大层 2.9× 宽含淡出边缘）/ PuffCloud
 * （1.05× 半径）尺度衔接；体积组变换逐帧复制星云组世界矩阵
 * （useGalacticPlacement 银河系组变换），远近景过渡无位置跳变。
 *
 * ── 色彩登记（§R4-8 第 3 条 + 附录 A §4）────────────────────────────────
 * 主场景默认自然色近似：Hα 红棕（#cc5a3c）+ OIII 青灰（#8fb3a8）——
 * 相对 R4-7 预览页默认（#ff5040/#2fd8c4 窄带饱和色）降低饱和度，
 * 接近人眼/真彩合成观感；与"哈勃调色板"（SII/Hα/OIII → RGB 假彩色
 * 映射，OIII 显蓝绿、Hα 显绿）存在刻意差异，已登记入信息面板
 * dataSource（data/specialBodies.ts orion 条目）。亮度 1.15（预览页
 * 1.3 基础上随主场景 Bloom 联调下调：核心不过曝、外缘不糊黑，
 * 无头 Chrome 目验定参）。
 */

import {
  estimateGpuBytes,
  volumeTextureGpuBytes,
  type DetailLayerSpec,
} from '@/utils/detailLayer';
import {
  nearViewEnterDistanceUnits,
  nearViewExitDistanceUnits,
} from '@/utils/nearView';
import {
  HORSEHEAD_TEXTURE_SIZE,
  HORSEHEAD_VOLUME_ID,
  M42_TEXTURE_SIZE,
  M42_VOLUME_ID,
  M57_COLOR_WEIGHT_INNER_R,
  M57_COLOR_WEIGHT_OUTER_R,
  M57_SHELL_RADII,
  M57_TEXTURE_SIZE,
  M57_VOLUME_ID,
  makeHorseheadSampler,
  makeM42Sampler,
  makeM57Sampler,
  trapeziumStarBoxPositions,
  type NebulaDualSampler,
} from '@/utils/nebulaVolume';
import { blackbodyRGB } from '@/utils/starPhysics';

/** 体积包围盒边长系数（× visualRadiusLy 场景尺寸，位姿对齐登记见文件头） */
export const ORION_VOLUME_BOX_FACTOR = 2.6;

/** Trapezium 星点 sprite 边长系数（× 包围盒边长，与 R4-7 预览页一致） */
export const ORION_VOLUME_STAR_SPRITE_FACTOR = 0.12;

/** 主场景体积层默认参数（色彩/亮度登记见文件头；步数为自适应基准） */
export const ORION_SCENE_VOLUME_PARAMS = {
  /** 基准步进数（自适应质量按档位缩放：high ×1 / mid ×0.75 / low ×0.5） */
  baseSteps: 64,
  /** 发射密度倍率（R4-7 预览页目检确认值） */
  densityScale: 3.2,
  /** 尘埃吸收倍率（R4-7 预览页目检确认值） */
  dustStrength: 1,
  /** 双色权重偏置（默认无偏置） */
  weightBias: 0,
  /** 输出亮度（预览页 1.3 → 主场景 Bloom 联调下调，登记见文件头） */
  intensity: 1.15,
  /** 外区 Hα 自然色近似：红棕 */
  colorHa: '#cc5a3c',
  /** 内区 OIII 自然色近似：青灰 */
  colorOIII: '#8fb3a8',
} as const;

/**
 * 体积层细节规格（useDetailLayer 入参；调用方 useMemo 稳定）
 *
 * 阈值与 R2-7 近观层同源（同时机激活，交叉淡出无空档）；预算 =
 * 128³ RG 双通道纹理 4 MB。
 */
export function orionVolumeDetailLayerSpec(): DetailLayerSpec {
  const volumeTexBytes = volumeTextureGpuBytes(M42_TEXTURE_SIZE, 2, 1);
  return {
    bodyId: M42_VOLUME_ID,
    kind: 'volume',
    enterDistanceUnits: nearViewEnterDistanceUnits(M42_VOLUME_ID),
    exitDistanceUnits: nearViewExitDistanceUnits(M42_VOLUME_ID),
    budget: {
      volumeTexBytes,
      gpuBytesEstimate: estimateGpuBytes({ volumeTexBytes }),
    },
  };
}

/**
 * 体积包围盒世界边长（场景单位）
 *
 * @param sizeUnits 星云视觉半径场景尺寸（visualRadiusLy × SCENE_UNITS_PER_LY）
 */
export function orionVolumeBoxEdgeUnits(sizeUnits: number): number {
  if (!Number.isFinite(sizeUnits) || sizeUnits <= 0) {
    throw new RangeError(`星云视觉尺寸必须为正有限数，收到 ${sizeUnits}`);
  }
  return sizeUnits * ORION_VOLUME_BOX_FACTOR;
}

/** 将权重钳制到 [0,1]（交叉淡出输入防御） */
function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/**
 * billboard 基础平面层交叉淡出系数（§R4-8 第 1 条）
 *
 * R2-7 现状：近观时减淡 35%（1 − 0.35·near01）；R4-8 叠加体积层
 * 交叉淡出（× (1 − vol01)）——体积淡入至满时 billboard 完全隐去
 * （体积接管主体），退出时反向恢复。vol01=0 时与 R2-7 行为逐点一致
 * （行为零回退）。
 */
export function orionBaseLayerFactor(near01: number, vol01: number): number {
  return (1 - 0.35 * clamp01(near01)) * (1 - clamp01(vol01));
}

/**
 * R2-7 PuffCloud 团絮层交叉淡出系数：近观权重 × (1 − 体积权重)
 *
 * 体积激活前保持 R2-7 行为（= near01）；体积淡入时同步淡出。
 */
export function orionPuffFactor(near01: number, vol01: number): number {
  return clamp01(near01) * (1 - clamp01(vol01));
}

/**
 * 体积层视觉淡入目标（分帧烘焙就绪门控；M42/M57 通用）
 *
 * 纹理尚未构建完成时目标为 0（billboard 保持原样，无"先隐旧层后
 * 出新层"空档）；就绪后跟随 detailLayer 门控权重。组件侧经
 * moveToward（0.5s 满程线性速率）平滑逼近本目标（构建晚于门控就绪
 * 时的补偿淡入，实现差异登记：有效过渡时长 0.5–1s）。
 */
export function orionVolumeFadeTarget(gate01: number, buildDone: boolean): number {
  return buildDone ? clamp01(gate01) : 0;
}

/* ════════════════════════════════════════════════════════════════════════
 * 环状星云 M57 主场景接入配置（R4-14，IMPROVEMENT_REQUIREMENTS_4 §R4-14）
 *
 * 接入模式与 R4-8 完全同构（volume 池容量 1——M42↔M57 巡游切换时 LRU
 * 逐出旧体积）；差异仅密度场与配置（§R4-14 省 token 约定）。
 *
 * ── 位姿尺度登记 ─────────────────────────────────────────────────────────
 * 包围盒边长 = 视觉尺寸 × 2.9：密度场赤道壳中面（归一化域 0.58 半径）
 * 折算世界半径 = 0.58 × 2.9/2 ≈ 0.84 × 视觉半径，与 R2-7 环体粒子
 * （环径 0.85×size）/环面纹理尺度衔接；体积组变换逐帧复制环壳缩放组
 * 世界矩阵（倾斜姿态 + 膨胀动画随动）。
 *
 * ── 色彩登记（附录 A §4）──────────────────────────────────────────────────
 * 自然色近似：壳内缘 OIII 青绿（#79d6c2）+ 外缘 Hα/NII 红橙（#d96a4b）
 * ——与 R2-7 环面纹理色层（#7fffcf/#ff5a55）同向、降饱和向主场景 Bloom
 * 联调；NII 与 Hα 合并单档登记（nebulaVolume.ts 文件头）。
 *
 * ── 中心白矮星色档登记（§R4-14 第 2 条，复用 R4-6 色档）──────────────────
 * 中心星 Teff ≈ 125,000 K（O'Dell et al. 2013 量级）经 R4-6
 * `blackbodyRGB` 色表求档——超出表域钳制到 50,000 K 上限档（偏蓝白，
 * 登记：远紫外主导的真实色感以表上限近似）。
 * ════════════════════════════════════════════════════════════════════════ */

/** M57 体积包围盒边长系数（× visualRadiusLy 场景尺寸，登记见上） */
export const M57_VOLUME_BOX_FACTOR = 2.9;

/** M57 中心白矮星 sprite 边长系数（× 包围盒边长） */
export const M57_VOLUME_STAR_SPRITE_FACTOR = 0.06;

/** M57 中心白矮星有效温度（K；O'Dell et al. 2013 量级，色档登记见上） */
export const M57_CENTRAL_STAR_TEFF_K = 125000;

/** 主场景 M57 体积层默认参数（色彩登记见上；步数为自适应基准） */
export const M57_SCENE_VOLUME_PARAMS = {
  /** 基准步进数（结构较 M42 简单：48 步足够壳层无分层伪影） */
  baseSteps: 48,
  /** 发射密度倍率（壳层峰值密度 ~1，无 M42 的 ×0.32 总量标定） */
  densityScale: 1.6,
  /** 尘埃吸收倍率（吸收通道恒零，值无效果——保持 0 登记） */
  dustStrength: 0,
  /** 双色权重偏置（默认无偏置） */
  weightBias: 0,
  /** 输出亮度（预览页目检 + 主场景 Bloom 联调） */
  intensity: 1.2,
  /** 外缘 Hα/NII 自然色近似：红橙 */
  colorHa: '#d96a4b',
  /** 内缘 OIII 自然色近似：青绿 */
  colorOIII: '#79d6c2',
} as const;

/**
 * M57 体积层细节规格（useDetailLayer 入参；调用方 useMemo 稳定）
 *
 * 阈值与 R2-7 近观层同源同值（环体粒子/外晕与体积同时机激活，交叉
 * 淡出无空档）；预算 = 96³ RG 双通道纹理 ≈ 1.69 MB（§R4-14 登记）。
 */
export function m57VolumeDetailLayerSpec(): DetailLayerSpec {
  const volumeTexBytes = volumeTextureGpuBytes(M57_TEXTURE_SIZE, 2, 1);
  return {
    bodyId: M57_VOLUME_ID,
    kind: 'volume',
    enterDistanceUnits: nearViewEnterDistanceUnits(M57_VOLUME_ID),
    exitDistanceUnits: nearViewExitDistanceUnits(M57_VOLUME_ID),
    budget: {
      volumeTexBytes,
      gpuBytesEstimate: estimateGpuBytes({ volumeTexBytes }),
    },
  };
}

/** M57 体积包围盒世界边长（场景单位） */
export function m57VolumeBoxEdgeUnits(sizeUnits: number): number {
  if (!Number.isFinite(sizeUnits) || sizeUnits <= 0) {
    throw new RangeError(`星云视觉尺寸必须为正有限数，收到 ${sizeUnits}`);
  }
  return sizeUnits * M57_VOLUME_BOX_FACTOR;
}

/**
 * M57 billboard 环面/中心白矮星交叉淡出系数（§R4-14 第 3 条）
 *
 * vol01 = 0 时恒 1（R2-7 行为零回退：环面无近观减淡机制）；体积淡入
 * 至满时环面/白矮星网格完全隐去（体积壳 + 内嵌白矮星 sprite 接管），
 * 退出时反向恢复。
 */
export function m57BillboardFactor(vol01: number): number {
  return 1 - clamp01(vol01);
}

/**
 * R2-7 环体粒子（+200 环向）/外晕壳交叉淡出系数：近观权重 × (1 − 体积权重)
 *
 * 体积激活前保持 R2-7 行为（= near01）；体积淡入时同步淡出（§R4-14
 * 第 3 条登记：+200 环向粒子在体积激活时淡出）。
 */
export function m57NearLayerFactor(near01: number, vol01: number): number {
  return clamp01(near01) * (1 - clamp01(vol01));
}

/* ════════════════════════════════════════════════════════════════════════
 * 马头星云主场景接入配置（R4-15，IMPROVEMENT_REQUIREMENTS_4 §R4-15）
 *
 * 接入模式与 R4-8/R4-14 完全同构（volume 池容量 1——M42/M57/马头巡游
 * 切换时 LRU 逐出旧体积）；差异仅密度场与配置。
 *
 * ── 背景发射幕方案登记（§R4-15 第 2 条，二选一）─────────────────────────
 * 取"低密度大尺度发射层"：IC 434 红色发射幕烘焙进体积后半域（密度场
 * 登记见 nebulaVolume.ts 马头段头），剪影 = raymarch 内吸收柱按透射率
 * 物理遮挡幕布，侧向绕行可见云柱纵深；主场景既有背景 billboard **保留**
 * 并在体积激活时部分减淡（horseheadCurtainFactor：×(1 − 0.35·vol01)）
 * 作幕布远景延伸——体积盒外围（3.0×2.4 视觉尺寸的 billboard > 盒边）
 * 无幕布断边。
 *
 * ── 交叉淡出登记（§R4-15 第 3 条）────────────────────────────────────────
 * R2-7 交付的 2 视差发射层 + 3 前景暗云团在体积激活时交叉淡出
 * （horseheadNearLayerFactor = near01 × (1 − vol01)）；3 块前景暗云柱
 * 剪影 billboard 同步隐去（volDim 标记 ×(1 − vol01)，体积柱接管剪影）。
 *
 * ── 位姿尺度登记 ─────────────────────────────────────────────────────────
 * 包围盒边长 = 视觉尺寸 × 2.0：马头轮廓全高（归一化域 y ∈ [−1, 0.72]）
 * 折算世界高度 ≈ 1.7 × 视觉半径，与现有剪影 billboard 组（~1.2×）近观
 * 放大衔接；发射幕横向经软窗覆盖盒宽 ~2.0×，与背景 billboard（3.0×）
 * 远景延伸衔接。
 *
 * ── 色彩登记（附录 A §4）──────────────────────────────────────────────────
 * IC 434 为 Hα 主导发射：weightBias = 1 恒取 colorHa 红棕（#c9503a，
 * 与既有 billboard 纹理 #ff8898/#a03848 同向降饱和）；colorOIII 无效果
 * （权重恒 1），保留材质默认接口值登记。
 * ════════════════════════════════════════════════════════════════════════ */

/** 马头体积包围盒边长系数（× visualRadiusLy 场景尺寸，登记见上） */
export const HORSEHEAD_VOLUME_BOX_FACTOR = 2.0;

/** 主场景马头体积层默认参数（色彩/方案登记见上；步数为自适应基准） */
export const HORSEHEAD_SCENE_VOLUME_PARAMS = {
  /** 基准步进数（结构较 M42 简单：48 步足够无分层伪影） */
  baseSteps: 48,
  /** 发射密度倍率（发射幕基准 0.16 低密度 → 亮度由此恢复；目验调参） */
  densityScale: 3.0,
  /** 尘埃吸收倍率（吸收为主：云柱核心透射率 ≪1 → 剪影近全黑；目验调参） */
  dustStrength: 2.2,
  /** 双色权重偏置（+1 恒取 Hα 档：IC 434 红色发射幕，登记见上） */
  weightBias: 1,
  /** 输出亮度（预览页目检 + 主场景 Bloom 联调） */
  intensity: 1.1,
  /** Hα 发射幕自然色近似：红棕 */
  colorHa: '#c9503a',
  /** OIII 档无效果（weightBias=1 恒取 Hα；接口占位登记） */
  colorOIII: '#8fb3a8',
} as const;

/**
 * 马头体积层细节规格（useDetailLayer 入参；调用方 useMemo 稳定）
 *
 * 阈值与 R2-7 近观层同源同值（视差发射层/暗云团与体积同时机激活，
 * 交叉淡出无空档）；预算 = 96³ RG 双通道纹理 ≈ 1.69 MB。
 */
export function horseheadVolumeDetailLayerSpec(): DetailLayerSpec {
  const volumeTexBytes = volumeTextureGpuBytes(HORSEHEAD_TEXTURE_SIZE, 2, 1);
  return {
    bodyId: HORSEHEAD_VOLUME_ID,
    kind: 'volume',
    enterDistanceUnits: nearViewEnterDistanceUnits(HORSEHEAD_VOLUME_ID),
    exitDistanceUnits: nearViewExitDistanceUnits(HORSEHEAD_VOLUME_ID),
    budget: {
      volumeTexBytes,
      gpuBytesEstimate: estimateGpuBytes({ volumeTexBytes }),
    },
  };
}

/** 马头体积包围盒世界边长（场景单位） */
export function horseheadVolumeBoxEdgeUnits(sizeUnits: number): number {
  if (!Number.isFinite(sizeUnits) || sizeUnits <= 0) {
    throw new RangeError(`星云视觉尺寸必须为正有限数，收到 ${sizeUnits}`);
  }
  return sizeUnits * HORSEHEAD_VOLUME_BOX_FACTOR;
}

/**
 * 背景 IC 434 billboard 幕布减淡系数（§R4-15 第 2 条方案登记见上）
 *
 * vol01 = 0 时恒 1（R2-7 行为零回退）；体积淡入至满时减淡 35%——
 * billboard 保留作体积盒外围的幕布远景延伸（非完全隐去），中心区
 * 亮度由体积内发射幕接管补足，避免叠加过曝（目验调参登记）。
 */
export function horseheadCurtainFactor(vol01: number): number {
  return 1 - 0.35 * clamp01(vol01);
}

/**
 * R2-7 近观层（2 视差发射层 + 3 前景暗云团）交叉淡出系数：
 * 近观权重 × (1 − 体积权重)
 *
 * 体积激活前保持 R2-7 行为（= near01）；体积淡入时同步淡出（§R4-15
 * 第 3 条登记）。
 */
export function horseheadNearLayerFactor(near01: number, vol01: number): number {
  return clamp01(near01) * (1 - clamp01(vol01));
}

/* ════════════════════════════════════════════════════════════════════════
 * 星云体积层通用配置（R4-14：OrionVolumeLayer 泛化为 NebulaVolumeLayer，
 * M42/M57 共用同一接线，仅密度场与配置不同）
 * ════════════════════════════════════════════════════════════════════════ */

/** 体积子场景内嵌星点 sprite 规格（盒局部坐标 [-0.5,0.5]³） */
export interface NebulaVolumeStarSpec {
  /** 盒局部坐标（× 包围盒边长 = 世界偏移） */
  readonly position: readonly [number, number, number];
  /** sprite 边长系数（× 包围盒边长） */
  readonly scaleFactor: number;
}

/** 星云体积材质场景参数（createNebulaVolumeMaterial 入参子集，纯数据） */
export interface NebulaVolumeSceneParams {
  readonly baseSteps: number;
  readonly densityScale: number;
  readonly dustStrength: number;
  readonly weightBias: number;
  readonly intensity: number;
  readonly colorHa: string;
  readonly colorOIII: string;
  /** 双色权重中心覆写（缺省 = 材质默认 M42 Trapezium 中心） */
  readonly core?: readonly [number, number, number];
  readonly weightInnerR?: number;
  readonly weightOuterR?: number;
  /** 椭球归一化逐轴倒数（缺省 = (1,1,1) 欧氏距离） */
  readonly weightInvRadii?: readonly [number, number, number];
}

/** 星云体积层通用配置（NebulaVolumeLayer / 预览页共用） */
export interface NebulaVolumeLayerConfig {
  /** 天体 id（确定性种子/打点登记用） */
  readonly volumeId: string;
  /** 密度纹理边长（≤128，附录 A §1） */
  readonly textureSize: number;
  /** 双通道密度采样器工厂（确定性种子内置） */
  readonly makeSampler: () => NebulaDualSampler;
  /** 材质场景参数 */
  readonly params: NebulaVolumeSceneParams;
  /** 内嵌星点 sprite（M42 = Trapezium 四星 / M57 = 中心白矮星） */
  readonly stars: readonly NebulaVolumeStarSpec[];
  /** 星点 sprite 色调（sRGB 0–255；M42 蓝白 / M57 白矮星色档） */
  readonly starTint: readonly [number, number, number];
  /** 烘焙打点日志前缀（如 "R4-8 M42"） */
  readonly logTag: string;
}

/** M42 体积层通用配置（R4-8 接线泛化后的等价配置，行为零回退） */
export function orionVolumeLayerConfig(): NebulaVolumeLayerConfig {
  return {
    volumeId: M42_VOLUME_ID,
    textureSize: M42_TEXTURE_SIZE,
    makeSampler: () => makeM42Sampler(),
    params: ORION_SCENE_VOLUME_PARAMS,
    stars: trapeziumStarBoxPositions().map((position) => ({
      position,
      scaleFactor: ORION_VOLUME_STAR_SPRITE_FACTOR,
    })),
    starTint: [210, 225, 255],
    logTag: 'R4-8 M42',
  };
}

/** M57 体积层通用配置（三轴椭球壳 + 中心白矮星 sprite） */
export function m57VolumeLayerConfig(): NebulaVolumeLayerConfig {
  const [ax, ay, az] = M57_SHELL_RADII;
  // blackbodyRGB 内部钳制到表域上限 50,000 K（色档登记见文件头）
  const tint = blackbodyRGB(M57_CENTRAL_STAR_TEFF_K);
  return {
    volumeId: M57_VOLUME_ID,
    textureSize: M57_TEXTURE_SIZE,
    makeSampler: () => makeM57Sampler(),
    params: {
      ...M57_SCENE_VOLUME_PARAMS,
      core: [0, 0, 0],
      weightInnerR: M57_COLOR_WEIGHT_INNER_R,
      weightOuterR: M57_COLOR_WEIGHT_OUTER_R,
      weightInvRadii: [1 / ax, 1 / ay, 1 / az],
    },
    stars: [{ position: [0, 0, 0], scaleFactor: M57_VOLUME_STAR_SPRITE_FACTOR }],
    starTint: [Math.round(tint.r * 255), Math.round(tint.g * 255), Math.round(tint.b * 255)],
    logTag: 'R4-14 M57',
  };
}

/** 马头体积层通用配置（吸收暗云柱 + IC 434 发射幕；无内嵌星点登记：
 * B33 为冷分子云，无 Trapezium/中心星类点源） */
export function horseheadVolumeLayerConfig(): NebulaVolumeLayerConfig {
  return {
    volumeId: HORSEHEAD_VOLUME_ID,
    textureSize: HORSEHEAD_TEXTURE_SIZE,
    makeSampler: () => makeHorseheadSampler(),
    params: HORSEHEAD_SCENE_VOLUME_PARAMS,
    stars: [],
    starTint: [255, 255, 255],
    logTag: 'R4-15 马头',
  };
}
