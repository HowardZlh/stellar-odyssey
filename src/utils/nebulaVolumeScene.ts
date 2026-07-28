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
import { M42_TEXTURE_SIZE, M42_VOLUME_ID } from '@/utils/nebulaVolume';

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
 * 体积层视觉淡入目标（分帧烘焙就绪门控）
 *
 * 纹理尚未构建完成时目标为 0（billboard 保持原样，无"先隐旧层后
 * 出新层"空档）；就绪后跟随 detailLayer 门控权重。组件侧经
 * moveToward（0.5s 满程线性速率）平滑逼近本目标（构建晚于门控就绪
 * 时的补偿淡入，实现差异登记：有效过渡时长 0.5–1s）。
 */
export function orionVolumeFadeTarget(gate01: number, buildDone: boolean): number {
  return buildDone ? clamp01(gate01) : 0;
}
