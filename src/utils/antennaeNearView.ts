/**
 * 触须星系近观细节层纯逻辑（R4-22，IMPROVEMENT_REQUIREMENTS_4 §R4-22）
 *
 * 纯逻辑模块（附录 A §3 纯函数先行）：为 `Scene/AntennaeNearView.tsx`
 * 提供 detailLayer 规格（starCatalog 池）、simDays→快照相位映射、
 * 快照位置缩放写入与粒子颜色/粒径属性；组件只消费本模块输出。
 *
 * 数据源：`public/data/antennae.bin`（R4-5 管线烘焙产物，受限三体/测试
 * 粒子模拟，Toomre & Toomre 1972 图景；模拟参数登记见
 * scripts/bake-data/antennae.ts 文件头，§0.4 数据源表）。
 *
 * ── 时间映射登记（§R4-22 需求 2）────────────────────────────────────────
 * 快照全程（S−1 个区间）↔ ANTENNAE_SNAPSHOT_SPAN_MYR = 600 Myr（T&T
 * 潮汐尾发育时标量级）；simDays 经 simDaysToMyr 换算后按三角波
 * （ping-pong）在快照序列上往返——登记：真实交会为单向事件，取往返
 * 循环保证任意 simDays 到达时演化持续可见且**插值连续无跳变**（环绕
 * wrap 会产生末帧→首帧跳变，故弃用）。
 *
 * ── 科学近似与艺术化登记（附录 A §4）──────────────────────────────────
 * - 抛物线交会（需求指定）：T&T 原文 Antennae 用 e≈0.5 椭圆，尾形态
 *   图景一致，两核末段分离偏快（烘焙脚本同步登记）；
 * - 双盘配色：NGC 4038 暖橙 / NGC 4039 冷蓝（区分两条尾的来源盘，
 *   公版 HST 图像中两盘色调差异的艺术化强调档）；
 * - 场景缩放：1 模拟单位（近心距 r_p）= 0.75 × 基准半径，尾端伸展
 *   ≈ 9 r_p ≈ 6.7 × 基准半径（与现状静态尾长同量级）。
 *
 * ── 预算登记（附录 A §1）────────────────────────────────────────────────
 * starCatalog 池（容量 1，与 R4-17 昴星团近观星表共池 LRU）：
 * 测试粒子 ≤6,000 + 两核 sprite 2 ≤ 单目标 12,000；顶点属性
 * pos3+posB3+color3+size1 = 40 B/粒（双快照插值布局，登记高于
 * estimateGpuBytes 默认 28 B/粒，按实际布局计入 gpuBytesEstimate）。
 */

import {
  EXTRAGALACTIC_VIEW_RADIUS_UNITS,
  viewDistanceForRadius,
} from '@/utils/cameraFocus';
import { NEAR_VIEW_ENTER_RATIO, NEAR_VIEW_EXIT_RATIO } from '@/utils/nearView';
import type { DetailLayerSpec } from '@/utils/detailLayer';
import type { AntennaeSnapshotsData } from '@/utils/bakedData';
import { simDaysToMyr } from '@/utils/galaxy';
import { lensingSeed } from '@/utils/blackHoleLensing';
import { createSeededRandom } from '@/utils/random';

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/** 天体 id（store.followBodyId/flyToBodyId 判据对齐） */
export const ANTENNAE_BODY_ID = 'antennae-galaxies';

/** 粒子数上限（校验域同源：validateAntennae ≤6000；预算登记用） */
export const ANTENNAE_MAX_PARTICLES = 6000;

/** 两核辉光 sprite 数 */
export const ANTENNAE_CORE_SPRITE_COUNT = 2;

/** 顶点属性字节/粒（pos3+posB3+color3+size1 双快照插值布局，登记） */
export const ANTENNAE_GPU_BYTES_PER_PARTICLE = 40;

/** 快照全程时间跨度（Myr；时间映射登记见文件头） */
export const ANTENNAE_SNAPSHOT_SPAN_MYR = 600;

/** 场景缩放：1 模拟单位（r_p）对应的基准半径倍数 */
export const ANTENNAE_UNITS_PER_RP_FACTOR = 0.75;

/** 粒径域（基准半径倍数） */
export const ANTENNAE_SIZE_MIN_FACTOR = 0.018;
export const ANTENNAE_SIZE_MAX_FACTOR = 0.05;

/** 近观时既有静态层（盘贴图/星暴/示意尾线）减淡幅度（让位粒子结构，登记） */
export const ANTENNAE_STATIC_NEAR_DIM = 0.85;

/**
 * 双盘配色（线性空间 RGB；sRGB 编码后 ≈ 暖橙 #ffb27a / 冷蓝 #9fb8ff 档，
 * 线性值直取 sRGB 数值会被编码提亮，目验调参登记——quasarNearView 先例）
 */
export const ANTENNAE_COLOR_DISK_A: Readonly<{ r: number; g: number; b: number }> = {
  r: 1.0,
  g: 0.44,
  b: 0.2,
};
export const ANTENNAE_COLOR_DISK_B: Readonly<{ r: number; g: number; b: number }> = {
  r: 0.35,
  g: 0.5,
  b: 1.0,
};

// ---------------------------------------------------------------------------
// detailLayer 规格（R4-2 统一门控；阈值与 resolveFocusTarget 同源）
// ---------------------------------------------------------------------------

/**
 * 近观进入阈值（场景单位）= 河外特殊天体飞往观察距离 ×
 * NEAR_VIEW_ENTER_RATIO（cameraFocus/nearView 同源，禁止两套参数）
 */
export function antennaeNearViewEnterDistanceUnits(): number {
  return viewDistanceForRadius(EXTRAGALACTIC_VIEW_RADIUS_UNITS) * NEAR_VIEW_ENTER_RATIO;
}

/**
 * 触须星系细节层规格（starCatalog 池，容量 1 与 R4-17 昴星团共池；
 * 组件以 'lru-retain' 语义挂载——L4 巡游快速切回免重建）
 */
export function antennaeDetailLayerSpec(): DetailLayerSpec {
  const enter = antennaeNearViewEnterDistanceUnits();
  const particles = ANTENNAE_MAX_PARTICLES + ANTENNAE_CORE_SPRITE_COUNT;
  return {
    bodyId: ANTENNAE_BODY_ID,
    kind: 'starCatalog',
    enterDistanceUnits: enter,
    exitDistanceUnits: enter * NEAR_VIEW_EXIT_RATIO,
    budget: {
      particles,
      // 双快照插值布局按实际 40 B/粒登记（文件头预算登记）
      gpuBytesEstimate: ANTENNAE_MAX_PARTICLES * ANTENNAE_GPU_BYTES_PER_PARTICLE,
    },
  };
}

// ---------------------------------------------------------------------------
// simDays → 快照相位（三角波 ping-pong，连续无跳变）
// ---------------------------------------------------------------------------

/** 快照插值相位：区间索引 seg ∈ [0, S−2] + 区间内混合 mix ∈ [0,1] */
export interface AntennaeSnapshotPhase {
  seg: number;
  mix: number;
}

/**
 * simDays → 快照相位（纯函数；文件头时间映射登记）。
 * 三角波保证相位对 simDays 连续（含往返折点处），快照插值无跳变；
 * 非法输入（非有限 simDays / snapshotCount < 2）回落相位 0。
 */
export function antennaeSnapshotPhase(
  simDays: number,
  snapshotCount: number,
): AntennaeSnapshotPhase {
  if (!Number.isFinite(simDays) || !Number.isFinite(snapshotCount) || snapshotCount < 2) {
    return { seg: 0, mix: 0 };
  }
  const cycles = Math.abs(simDaysToMyr(simDays)) / ANTENNAE_SNAPSHOT_SPAN_MYR;
  const saw = cycles % 2;
  const tri = saw <= 1 ? saw : 2 - saw; // 三角波 [0,1]
  const phase = tri * (snapshotCount - 1);
  const seg = Math.min(snapshotCount - 2, Math.floor(phase));
  return { seg, mix: phase - seg };
}

// ---------------------------------------------------------------------------
// 快照位置/属性构建（组件消费；分配仅在构建/换段时发生）
// ---------------------------------------------------------------------------

/**
 * 把快照 snapIndex 的粒子位置按场景缩放写入 out（长度 ≥ N×3）。
 * 返回 out（便于链式使用）；越界 snapIndex 抛 RangeError。
 */
export function writeAntennaeSnapshotPositions(
  data: AntennaeSnapshotsData,
  snapIndex: number,
  baseRadiusUnits: number,
  out: Float32Array,
): Float32Array {
  if (!Number.isInteger(snapIndex) || snapIndex < 0 || snapIndex >= data.snapshotCount) {
    throw new RangeError(`快照索引 ${snapIndex} 越界（S=${data.snapshotCount}）`);
  }
  if (!Number.isFinite(baseRadiusUnits) || baseRadiusUnits <= 0) {
    throw new RangeError(`基准半径必须为正有限数，收到 ${baseRadiusUnits}`);
  }
  const n3 = data.particleCount * 3;
  if (out.length < n3) {
    throw new RangeError(`输出缓冲长度 ${out.length} 不足 ${n3}`);
  }
  const scale = ANTENNAE_UNITS_PER_RP_FACTOR * baseRadiusUnits;
  const src = data.positions;
  const offset = snapIndex * n3;
  for (let i = 0; i < n3; i += 1) {
    out[i] = src[offset + i] * scale;
  }
  return out;
}

/**
 * 两核插值位置（场景单位；coreIndex 0=A/1=B）。写入 out 并返回。
 * mix 越界钳制到 [0,1]（相位函数输出域内，防御性钳制）。
 */
export function antennaeCorePosition(
  data: AntennaeSnapshotsData,
  phase: AntennaeSnapshotPhase,
  coreIndex: 0 | 1,
  baseRadiusUnits: number,
  out: { x: number; y: number; z: number },
): { x: number; y: number; z: number } {
  const scale = ANTENNAE_UNITS_PER_RP_FACTOR * baseRadiusUnits;
  const seg = Math.min(Math.max(phase.seg, 0), data.snapshotCount - 2);
  const mix = Math.min(Math.max(phase.mix, 0), 1);
  const a = seg * 6 + coreIndex * 3;
  const b = (seg + 1) * 6 + coreIndex * 3;
  const c = data.cores;
  out.x = (c[a] + (c[b] - c[a]) * mix) * scale;
  out.y = (c[a + 1] + (c[b + 1] - c[a + 1]) * mix) * scale;
  out.z = (c[a + 2] + (c[b + 2] - c[a + 2]) * mix) * scale;
  return out;
}

/** 粒子静态属性（颜色/粒径；快照间不变，构建一次） */
export interface AntennaeParticleAttributes {
  /** 线性空间 RGB（count × 3） */
  colors: Float32Array;
  /** 粒径（场景单位；count × 1） */
  sizes: Float32Array;
  count: number;
}

/**
 * 构建粒子颜色/粒径属性（确定性纯函数；FNV-1a 种子 + mulberry32，
 * 两次进入形态一致——附录 A §2）：盘 A 暖橙 / 盘 B 冷蓝 + 亮度抖动。
 */
export function buildAntennaeParticleAttributes(
  data: AntennaeSnapshotsData,
  baseRadiusUnits: number,
): AntennaeParticleAttributes {
  if (!Number.isFinite(baseRadiusUnits) || baseRadiusUnits <= 0) {
    throw new RangeError(`基准半径必须为正有限数，收到 ${baseRadiusUnits}`);
  }
  const count = data.particleCount;
  const rand = createSeededRandom(lensingSeed(`${ANTENNAE_BODY_ID}:particles`));
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    const c = i < data.diskACount ? ANTENNAE_COLOR_DISK_A : ANTENNAE_COLOR_DISK_B;
    // 亮度抖动 ±35% + 少量白化（避免纯色块观感）
    const gain = 0.65 + 0.7 * rand();
    const white = 0.12 * rand();
    colors[i * 3] = Math.min(1, c.r * gain + white);
    colors[i * 3 + 1] = Math.min(1, c.g * gain + white);
    colors[i * 3 + 2] = Math.min(1, c.b * gain + white);
    sizes[i] =
      (ANTENNAE_SIZE_MIN_FACTOR +
        (ANTENNAE_SIZE_MAX_FACTOR - ANTENNAE_SIZE_MIN_FACTOR) * rand()) *
      baseRadiusUnits;
  }
  return { colors, sizes, count };
}
