/**
 * 宇宙级运动与大尺度结构（需求 3.1.3）
 *
 * 坐标约定：本星系群质心系 / 银河系中心系。场景方向单位矢量由数据层提供；
 * 本文件输出光年（星系位置）或场景单位（宇宙网直接输出场景单位）。
 *
 * 数据来源：
 * - 银河系-仙女座（M31）当前距离约 250 万光年，视向接近速度约 110 km/s，
 *   预计约 45 亿年后开始合并（van der Marel et al. 2012, ApJ）
 * - 本星系群相对 CMB 本动速度约 620 km/s，朝巨引源方向
 *   （Kogut et al. 1993, ApJ；用于渲染端整体漂移示意）
 * - 大麦哲伦云距离约 16 万光年、小麦哲伦云约 20 万光年（ESA/NASA）
 * - M31 质量占 MW+M31 约 0.556（质量比约 1.25:1 的一阶近似，
 *   双方到质心的距离与质量成反比）
 */

import type { Vec3 } from '@/types';
import { KM_S_TO_LY_PER_MYR, simDaysToMyr } from '@/utils/galaxy';
import { createSeededRandom } from '@/utils/random';

/** MW–M31 当前距离（光年）：约 250 万光年 */
export const MW_M31_INITIAL_SEPARATION_LY = 2.5e6;

/** MW–M31 当前接近速度（km/s）：约 110 km/s */
export const MW_M31_APPROACH_KM_S = 110;

/** MW–M31 合并倒计时（百万年）：约 45 亿年 */
export const MW_M31_MERGE_MYR = 4500;

/** 本星系群相对 CMB 本动速度（km/s）：约 620 km/s 朝巨引源方向 */
export const LG_PECULIAR_VELOCITY_KM_S = 620;

/** M31 质量占比（双方到质心的距离与质量成反比） */
export const M31_MASS_FRACTION = 0.556;

/** 初速度（光年/百万年）：110 km/s × 3.3357 */
const MW_M31_V0_LY_PER_MYR = MW_M31_APPROACH_KM_S * KM_S_TO_LY_PER_MYR;

/**
 * 匀加速接近模型的等效加速度 A（光年/Myr²）：
 * d(t) = d0 − v0·t − ½·A·t²，要求 d(T) = 0（T = 4500 Myr）
 * → A = 2(d0 − v0·T)/T²
 * 这是引力加速下轨道衰减的一阶近似（真实 N 体演化有多次穿越振荡，
 * 此处取首次并合时间的匀加速插值，已登记为示意性近似）。
 */
const MW_M31_ACCEL_LY_PER_MYR2 =
  (2 * (MW_M31_INITIAL_SEPARATION_LY - MW_M31_V0_LY_PER_MYR * MW_M31_MERGE_MYR)) /
  (MW_M31_MERGE_MYR * MW_M31_MERGE_MYR);

/**
 * MW–M31 当前距离（光年）
 *
 * 匀加速接近：d(t) = d0 − v0·t − ½·A·t²，保证 d(0)=2.5e6、d(4500 Myr)=0。
 * 返回值 clamp ≥ 0（合并后视为重合）；t < 0 允许回溯（无上限 clamp）。
 */
export function mwM31SeparationLy(simDays: number): number {
  const t = simDaysToMyr(simDays);
  const d =
    MW_M31_INITIAL_SEPARATION_LY -
    MW_M31_V0_LY_PER_MYR * t -
    0.5 * MW_M31_ACCEL_LY_PER_MYR2 * t * t;
  return Math.max(0, d);
}

/**
 * MW–M31 合并倒计时（百万年）：max(0, 4500 − t)
 */
export function mwM31MergeCountdownMyr(simDays: number): number {
  return Math.max(0, MW_M31_MERGE_MYR - simDaysToMyr(simDays));
}

/**
 * 本星系群质心系下 MW 与 M31 的位置（光年）
 *
 * 双体到质心的距离与质量成反比：
 * mw = −d̂·d·M31_MASS_FRACTION，m31 = +d̂·d·(1 − M31_MASS_FRACTION)
 *
 * @param directionToM31 指向 M31 的方向矢量（内部归一化，零矢量抛 RangeError）
 */
export function localGroupPositionsLy(
  simDays: number,
  directionToM31: Vec3,
): { mw: Vec3; m31: Vec3 } {
  const len = Math.hypot(directionToM31.x, directionToM31.y, directionToM31.z);
  if (len === 0) {
    throw new RangeError('指向 M31 的方向矢量不能为零矢量');
  }
  const ux = directionToM31.x / len;
  const uy = directionToM31.y / len;
  const uz = directionToM31.z / len;
  const d = mwM31SeparationLy(simDays);
  const mwDist = d * M31_MASS_FRACTION;
  const m31Dist = d * (1 - M31_MASS_FRACTION);
  return {
    mw: { x: -ux * mwDist, y: -uy * mwDist, z: -uz * mwDist },
    m31: { x: ux * m31Dist, y: uy * m31Dist, z: uz * m31Dist },
  };
}

/**
 * 卫星星系（大小麦哲伦云）绕银河系的圆轨道位置（光年，银河系中心系）
 *
 * 角度 θ = phase0 + 2π·t/period；先在 x-z 面取 (d·cosθ, 0, −d·sinθ)
 * （自 +y 俯视逆时针），再绕 x 轴倾斜 inclinationDeg。
 * 真实麦哲伦云轨道为高椭圆且周期有争议（约 15–25 亿年），
 * 此处采用圆轨道示意（已登记为近似处理）。
 */
export function satelliteGalaxyPositionLy(
  distanceLy: number,
  periodMyr: number,
  phase0Rad: number,
  inclinationDeg: number,
  simDays: number,
): Vec3 {
  if (distanceLy <= 0) {
    throw new RangeError(`卫星星系距离必须为正数，收到 ${distanceLy}`);
  }
  if (periodMyr <= 0) {
    throw new RangeError(`卫星星系轨道周期必须为正数，收到 ${periodMyr}`);
  }
  const theta = phase0Rad + (Math.PI * 2 * simDaysToMyr(simDays)) / periodMyr;
  const x = distanceLy * Math.cos(theta);
  const z = -distanceLy * Math.sin(theta);
  const incl = (inclinationDeg * Math.PI) / 180;
  // 绕 x 轴旋转：y' = y·cos − z·sin，z' = y·sin + z·cos（此处 y = 0）
  return {
    x,
    y: -z * Math.sin(incl),
    z: z * Math.cos(incl),
  };
}

/** 宇宙网生成配置（场景单位） */
export interface CosmicWebConfig {
  /** 确定性种子 */
  seed: number;
  /** 星系团节点数 */
  nodeCount: number;
  /** 节点分布球壳内半径（场景单位） */
  minRadiusUnits: number;
  /** 节点分布球壳外半径（场景单位） */
  maxRadiusUnits: number;
  /** 每节点连接的近邻数（纤维） */
  linksPerNode: number;
  /** 每条纤维上的星系数 */
  galaxiesPerLink: number;
  /** 每个节点团块星系数 */
  galaxiesPerNode: number;
  /** 纤维横向抖动（高斯 σ，场景单位） */
  filamentJitterUnits: number;
  /** 节点团块半径（高斯 σ，场景单位） */
  clusterRadiusUnits: number;
}

/** 宇宙网数据（Float32Array 可直接上传 GPU） */
export interface CosmicWeb {
  /** 节点位置（nodeCount*3，场景单位） */
  nodePositions: Float32Array;
  /** 星系位置（galaxyCount*3，场景单位） */
  galaxyPositions: Float32Array;
  /** 星系颜色（galaxyCount*3，昏暗的多样色调） */
  galaxyColors: Float32Array;
  galaxyCount: number;
}

/** 宇宙网星系基色（昏暗多样色调：淡紫 / 暖灰 / 冷蓝灰） */
const WEB_PALETTE: readonly { r: number; g: number; b: number }[] = [
  hexToRgb('#c8c2d8'),
  hexToRgb('#d8c8b8'),
  hexToRgb('#b8c8d8'),
];

/**
 * 确定性生成宇宙网（需求 3.1.3：星系团节点—纤维—空洞的非均匀分布，
 * 禁止均匀随机撒点）
 *
 * 实现：
 * 1. 节点在球壳 [minRadius, maxRadius] 内确定性随机分布（星系团）；
 * 2. 每个节点连接 linksPerNode 个最近邻节点，按 (小索引-大索引) 去重（纤维）；
 * 3. 沿每条边线性插值采样 galaxiesPerLink 个点 + 高斯横向抖动；
 * 4. 每个节点周围高斯团块 galaxiesPerNode 个；
 * 5. 未被节点/纤维覆盖的区域自然形成空洞。
 */
export function generateCosmicWeb(config: CosmicWebConfig): CosmicWeb {
  if (config.nodeCount < 2 || !Number.isInteger(config.nodeCount)) {
    throw new RangeError(`节点数必须为 ≥ 2 的整数，收到 ${config.nodeCount}`);
  }
  if (config.minRadiusUnits <= 0) {
    throw new RangeError(`球壳内半径必须为正数，收到 ${config.minRadiusUnits}`);
  }
  if (config.maxRadiusUnits <= config.minRadiusUnits) {
    throw new RangeError('球壳外半径必须大于内半径');
  }
  if (config.linksPerNode < 0) {
    throw new RangeError(`每节点连接数不能为负，收到 ${config.linksPerNode}`);
  }
  if (config.galaxiesPerLink < 0) {
    throw new RangeError(`每条纤维星系数不能为负，收到 ${config.galaxiesPerLink}`);
  }
  if (config.galaxiesPerNode < 0) {
    throw new RangeError(`每节点团块星系数不能为负，收到 ${config.galaxiesPerNode}`);
  }

  const rand = createSeededRandom(config.seed);
  const nodeCount = config.nodeCount;

  // ---- 1. 节点：球壳内确定性随机分布 ----
  const nodePositions = new Float32Array(nodeCount * 3);
  for (let i = 0; i < nodeCount; i += 1) {
    const r = config.minRadiusUnits + (config.maxRadiusUnits - config.minRadiusUnits) * rand();
    const cosPolar = rand() * 2 - 1;
    const azimuth = Math.PI * 2 * rand();
    const sinPolar = Math.sqrt(1 - cosPolar * cosPolar);
    nodePositions[i * 3] = r * sinPolar * Math.cos(azimuth);
    nodePositions[i * 3 + 1] = r * cosPolar;
    nodePositions[i * 3 + 2] = r * sinPolar * Math.sin(azimuth);
  }

  // ---- 2. 纤维：每节点连接最近邻，去重 ----
  const edges: Array<[number, number]> = [];
  const edgeSet = new Set<string>();
  const maxLinks = Math.min(config.linksPerNode, nodeCount - 1);
  for (let i = 0; i < nodeCount; i += 1) {
    const neighbors: Array<{ index: number; distSq: number }> = [];
    for (let j = 0; j < nodeCount; j += 1) {
      if (j === i) continue;
      const dx = nodePositions[j * 3] - nodePositions[i * 3];
      const dy = nodePositions[j * 3 + 1] - nodePositions[i * 3 + 1];
      const dz = nodePositions[j * 3 + 2] - nodePositions[i * 3 + 2];
      neighbors.push({ index: j, distSq: dx * dx + dy * dy + dz * dz });
    }
    // 距离升序；ES2019 稳定排序保证等距时保持索引序 → 结果确定
    neighbors.sort((a, b) => a.distSq - b.distSq);
    for (let k = 0; k < maxLinks; k += 1) {
      const j = neighbors[k].index;
      const lo = Math.min(i, j);
      const hi = Math.max(i, j);
      const key = `${lo}-${hi}`;
      if (!edgeSet.has(key)) {
        edgeSet.add(key);
        edges.push([lo, hi]);
      }
    }
  }

  // ---- 3+4. 星系：纤维采样 + 节点团块 ----
  const galaxyCount = edges.length * config.galaxiesPerLink + nodeCount * config.galaxiesPerNode;
  const galaxyPositions = new Float32Array(galaxyCount * 3);
  const galaxyColors = new Float32Array(galaxyCount * 3);
  let cursor = 0;

  const writeGalaxy = (x: number, y: number, z: number): void => {
    galaxyPositions[cursor * 3] = x;
    galaxyPositions[cursor * 3 + 1] = y;
    galaxyPositions[cursor * 3 + 2] = z;
    const base = WEB_PALETTE[Math.floor(rand() * WEB_PALETTE.length)];
    const brightness = 0.3 + 0.5 * rand();
    galaxyColors[cursor * 3] = base.r * brightness;
    galaxyColors[cursor * 3 + 1] = base.g * brightness;
    galaxyColors[cursor * 3 + 2] = base.b * brightness;
    cursor += 1;
  };

  for (const [a, b] of edges) {
    for (let k = 0; k < config.galaxiesPerLink; k += 1) {
      const t = (k + 1) / (config.galaxiesPerLink + 1);
      writeGalaxy(
        nodePositions[a * 3] * (1 - t) +
          nodePositions[b * 3] * t +
          gaussian(rand) * config.filamentJitterUnits,
        nodePositions[a * 3 + 1] * (1 - t) +
          nodePositions[b * 3 + 1] * t +
          gaussian(rand) * config.filamentJitterUnits,
        nodePositions[a * 3 + 2] * (1 - t) +
          nodePositions[b * 3 + 2] * t +
          gaussian(rand) * config.filamentJitterUnits,
      );
    }
  }

  for (let i = 0; i < nodeCount; i += 1) {
    for (let k = 0; k < config.galaxiesPerNode; k += 1) {
      writeGalaxy(
        nodePositions[i * 3] + gaussian(rand) * config.clusterRadiusUnits,
        nodePositions[i * 3 + 1] + gaussian(rand) * config.clusterRadiusUnits,
        nodePositions[i * 3 + 2] + gaussian(rand) * config.clusterRadiusUnits,
      );
    }
  }

  return { nodePositions, galaxyPositions, galaxyColors, galaxyCount };
}

/**
 * 标准正态分布随机数（Box-Muller 变换）
 */
function gaussian(rand: () => number): number {
  const u = 1 - rand(); // (0, 1]，避免 log(0)
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(Math.PI * 2 * v);
}

/**
 * #RRGGBB → RGB（0-1）。仅用于本文件内置色板常量，不做格式校验。
 */
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const v = hex.replace('#', '');
  return {
    r: parseInt(v.slice(0, 2), 16) / 255,
    g: parseInt(v.slice(2, 4), 16) / 255,
    b: parseInt(v.slice(4, 6), 16) / 255,
  };
}
