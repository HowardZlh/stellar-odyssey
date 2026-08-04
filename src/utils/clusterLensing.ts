/**
 * 星系团屏幕空间引力透镜（R4-23，IMPROVEMENT_REQUIREMENTS_4 §R4-23）
 *
 * 纯逻辑模块（不 import React/three，覆盖率 gate ≥90%）：为 postprocessing
 * 自定义 Effect（方案 a，登记见 ClusterLensingEffect.tsx 文件头）提供
 * SIS（Singular Isothermal Sphere，奇异等温球）透镜模型的偏转纯函数与
 * 屏幕 UV 换算，以及"场景组件 → 后期 Effect"的帧间源参数持有者。
 *
 * ── 物理模型与近似登记（附录 A §4）───────────────────────────────────────
 * - SIS 透镜方程：β = θ − θ_E·θ̂（Narayan & Bartelmann 1996, §3.1；
 *   Schneider, Ehlers & Falco 1992）。偏转角大小恒为爱因斯坦半径 θ_E、
 *   方向指向团块质心 —— θ < θ_E 的背景光线成对翻转像，θ = θ_E 处切向
 *   放大率发散（爱因斯坦环），θ 略大于 θ_E 处呈切向拉伸弧。
 * - 屏幕空间近似：把"背景光线偏折"实现为帧缓冲 UV 重采样
 *   uv_src = center + β(uv − center)，即每个屏幕像素从其 SIS 源平面
 *   位置取色。这是对真实三维光线追踪的平面近似（仅对视线方向上位于
 *   团块之后的背景严格成立；前景同样被采样偏移，登记为示意差异——
 *   透镜团块自身贴片同被轻微拉伸，观感可接受）。
 * - 有效爱因斯坦半径取场景单位定值（CLUSTER_EINSTEIN_RADIUS_UNITS），
 *   角半径 θ_E = atan(R_E/d) 随相机距离缩放——真实星系团 θ_E 由
 *   透镜/源角径距离比决定（Abell 370 约 30″–40″），此处为可视化档
 *   （近观数十度）压缩量级已登记。
 * - 影响域窗（lensDomainWindow）：θ_E 数倍外沿平滑归零，限制屏幕
 *   扰动范围（真实 SIS 偏转无穷远处仍为 θ_E，屏幕空间全域拉扯会把
 *   视口边缘拖入，属实现性裁剪登记）。
 */

import { createSeededRandom } from '@/utils/random';

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/** 透镜星系团天体 id（域判据与 store followBodyId/flyToBodyId 对齐） */
export const CLUSTER_LENSING_BODY_ID = 'cluster-lensing';

/**
 * 有效爱因斯坦半径（场景单位，艺术化档登记见文件头）：
 * 取近观观察距离（viewDistanceForRadius(300)=1800 单位）下角半径
 * atan(300/1800) ≈ 9.5°，爱因斯坦环落于视口内且不吞没全屏（无头目验
 * 调优登记：初值 420 时同方向 M87 光晕被放大过甚、淹没切向弧细节）
 */
export const CLUSTER_EINSTEIN_RADIUS_UNITS = 300;

/** 影响域外沿 = θ_E（UV）× 本系数（域窗外零扰动，实现性裁剪登记） */
export const CLUSTER_LENSING_DOMAIN_FACTOR = 2.5;

/** 域窗内沿比例（外沿 × 本值处开始衰减，smoothstep 平滑段） */
export const CLUSTER_LENSING_DOMAIN_INNER_RATIO = 0.55;

/**
 * 效果激活淡入淡出时长（秒）：与统一细节层过渡
 * DETAIL_LAYER_TRANSITION_SECONDS 同值同节奏（0.5s）
 */
export const CLUSTER_LENSING_FADE_SECONDS = 0.5;

/** θ_E（UV）安全上限：防近距离推进时角半径超过半屏引发全屏翻转 */
export const CLUSTER_LENSING_THETA_E_UV_MAX = 0.28;

/**
 * 近观静态示意弧减淡比例（效果全强度时静态 ring 弧透明度乘
 * 1 − 本值，让位真折射弧；R4-22 ANTENNAE_STATIC_NEAR_DIM 同范式）
 */
export const CLUSTER_LENSING_STATIC_ARC_DIM = 0.75;

/** 近观背景源 sprite 数量（被 SIS 效果拉伸成切向弧的"背景星系"） */
export const LENSED_BACKGROUND_SOURCE_COUNT = 6;

/** 背景源确定性种子（FNV-1a/mulberry32 先例，附录 A §2） */
export const LENSED_BACKGROUND_SOURCE_SEED = 0x42337001;

// ---------------------------------------------------------------------------
// SIS 偏转纯函数
// ---------------------------------------------------------------------------

/**
 * SIS 偏转角大小：|α| ≡ θ_E（与像面半径无关，θ=0 处定义为 0）
 *
 * @param r 像面到透镜中心角距（与 θ_E 同单位，须非负）
 * @param thetaE 爱因斯坦半径（≥0）
 */
export function sisDeflectionMagnitude(r: number, thetaE: number): number {
  if (!Number.isFinite(r) || r < 0) {
    throw new RangeError(`像面角距必须为非负有限数，收到 ${r}`);
  }
  if (!Number.isFinite(thetaE) || thetaE < 0) {
    throw new RangeError(`爱因斯坦半径必须为非负有限数，收到 ${thetaE}`);
  }
  return r === 0 ? 0 : thetaE;
}

/**
 * SIS 透镜方程（源平面映射）：β = θ − θ_E·θ̂
 *
 * 屏幕空间效果按 uv_src = center + β 重采样帧缓冲。θ=0（正对质心）
 * 时偏转方向未定义，按连续性取 β=0。
 *
 * @returns 源平面坐标 β（与输入同单位）
 */
export function sisSourceOffset(
  thetaX: number,
  thetaY: number,
  thetaE: number,
): { x: number; y: number } {
  const r = Math.hypot(thetaX, thetaY);
  const pull = sisDeflectionMagnitude(r, thetaE);
  if (r === 0 || pull === 0) return { x: thetaX, y: thetaY };
  const k = pull / r;
  return { x: thetaX - thetaX * k, y: thetaY - thetaY * k };
}

/**
 * SIS 切向放大率 μ_t = (1 − θ_E/r)⁻¹（单测锚定：r→θ_E 发散 →
 * 爱因斯坦环；r≫θ_E → 1 无畸变）
 *
 * @param r 像面角距（>0 且 ≠ θ_E，环上发散由调用方自行处理）
 */
export function sisTangentialMagnification(r: number, thetaE: number): number {
  if (!Number.isFinite(r) || r <= 0) {
    throw new RangeError(`像面角距必须为正有限数，收到 ${r}`);
  }
  if (!Number.isFinite(thetaE) || thetaE < 0) {
    throw new RangeError(`爱因斯坦半径必须为非负有限数，收到 ${thetaE}`);
  }
  return 1 / (1 - thetaE / r);
}

// ---------------------------------------------------------------------------
// 屏幕 UV 换算
// ---------------------------------------------------------------------------

/**
 * 爱因斯坦角半径：θ_E = atan(R_E / d)（场景单位定值 R_E 的角尺寸随
 * 相机距离缩放，远观自然消隐——量级压缩登记见文件头）
 */
export function einsteinAngleRad(
  einsteinRadiusUnits: number,
  distanceUnits: number,
): number {
  if (!Number.isFinite(einsteinRadiusUnits) || einsteinRadiusUnits < 0) {
    throw new RangeError(`爱因斯坦半径必须为非负有限数，收到 ${einsteinRadiusUnits}`);
  }
  if (!Number.isFinite(distanceUnits) || distanceUnits <= 0) {
    throw new RangeError(`相机距离必须为正有限数，收到 ${distanceUnits}`);
  }
  return Math.atan(einsteinRadiusUnits / distanceUnits);
}

/**
 * 视角 → 方形 UV 半径：uvR = tan(angle) / (2·tan(fovY/2))
 *
 * "方形 UV"指 y 半高 = 0.5、x 已乘 aspect 归一的空间（shader 内
 * d.x *= uAspect 同式），fovY 半高对应 tan(fovY/2)。
 */
export function angleToUvRadius(angleRad: number, fovYRad: number): number {
  if (!Number.isFinite(angleRad) || angleRad < 0 || angleRad >= Math.PI / 2) {
    throw new RangeError(`视角必须落在 [0, π/2)，收到 ${angleRad}`);
  }
  if (!Number.isFinite(fovYRad) || fovYRad <= 0 || fovYRad >= Math.PI) {
    throw new RangeError(`fovY 必须落在 (0, π)，收到 ${fovYRad}`);
  }
  return Math.tan(angleRad) / (2 * Math.tan(fovYRad / 2));
}

/**
 * 影响域窗：r ≤ 内沿全强度 1；内沿→外沿 smoothstep 平滑降至 0；
 * 域外 0（与 Effect fragment 内同式，单测锚定一致性）
 */
export function lensDomainWindow(r: number, radiusMax: number): number {
  if (!Number.isFinite(r) || r < 0) {
    throw new RangeError(`像面半径必须为非负有限数，收到 ${r}`);
  }
  if (!Number.isFinite(radiusMax) || radiusMax <= 0) {
    throw new RangeError(`域窗外沿必须为正有限数，收到 ${radiusMax}`);
  }
  const inner = radiusMax * CLUSTER_LENSING_DOMAIN_INNER_RATIO;
  if (r <= inner) return 1;
  if (r >= radiusMax) return 0;
  const t = (r - inner) / (radiusMax - inner);
  return 1 - t * t * (3 - 2 * t);
}

/** Effect uniform 组（每帧由 ClusterLensingPass 计算并直写） */
export interface ClusterLensingUniforms {
  /** 团块质心屏幕 UV（[0,1]，越界表示中心在画外但域窗仍可入画） */
  centerU: number;
  centerV: number;
  /** 爱因斯坦半径（方形 UV 空间，含安全上限钳制） */
  thetaEUv: number;
  /** 影响域外沿（方形 UV 空间） */
  radiusMaxUv: number;
}

/**
 * 组合换算：团块质心 NDC + 相机距离 + fovY → Effect uniform 组
 *
 * @param ndcX/ndcY 质心投影 NDC（[-1,1]，由调用方 project 计算）
 * @param distanceUnits 相机到质心距离（场景单位，>0）
 * @param fovYRad 相机垂直视场角（弧度）
 * @param einsteinRadiusUnits 有效爱因斯坦半径（场景单位）
 */
export function clusterLensingUniforms(
  ndcX: number,
  ndcY: number,
  distanceUnits: number,
  fovYRad: number,
  einsteinRadiusUnits: number = CLUSTER_EINSTEIN_RADIUS_UNITS,
  out?: ClusterLensingUniforms,
): ClusterLensingUniforms {
  if (!Number.isFinite(ndcX) || !Number.isFinite(ndcY)) {
    throw new RangeError(`NDC 坐标必须为有限数，收到 (${ndcX}, ${ndcY})`);
  }
  const angle = einsteinAngleRad(einsteinRadiusUnits, distanceUnits);
  const thetaEUv = Math.min(
    CLUSTER_LENSING_THETA_E_UV_MAX,
    angleToUvRadius(angle, fovYRad),
  );
  const target = out ?? { centerU: 0, centerV: 0, thetaEUv: 0, radiusMaxUv: 0 };
  target.centerU = ndcX * 0.5 + 0.5;
  target.centerV = ndcY * 0.5 + 0.5;
  target.thetaEUv = thetaEUv;
  target.radiusMaxUv = thetaEUv * CLUSTER_LENSING_DOMAIN_FACTOR;
  return target;
}

// ---------------------------------------------------------------------------
// 帧间源持有者（场景组件 → 后期 Effect；镜像 galacticFrame 注册表范式）
// ---------------------------------------------------------------------------

/**
 * 透镜源参数持有者：LensingArcs（场景组件，持有团块世界位姿与层级
 * 淡入权重）每帧写入，ClusterLensingPass（后期 Effect 组件）读取并
 * 结合相机投影换算 uniform。纯 TS 普通对象（无 three 依赖可单测）。
 */
export interface ClusterLensingSourceHolder {
  /** 团块质心世界坐标（场景单位） */
  worldX: number;
  worldY: number;
  worldZ: number;
  /** 场景组件可见权重（河外层级淡入 fadeWeight，∈[0,1]） */
  visible01: number;
  /** 有效爱因斯坦半径（场景单位；预览页滑杆可覆写） */
  einsteinRadiusUnits: number;
  /** 本帧是否已由场景组件写入（组件卸载后 Effect 读到 false 即归零） */
  present: boolean;
  /** 后期 Effect 实际生效强度（PostEffects 回写，场景层近观减淡消费） */
  effectStrength01: number;
}

const sourceHolder: ClusterLensingSourceHolder = {
  worldX: 0,
  worldY: 0,
  worldZ: 0,
  visible01: 0,
  einsteinRadiusUnits: CLUSTER_EINSTEIN_RADIUS_UNITS,
  present: false,
  effectStrength01: 0,
};

/** 读取持有者（渲染循环直读单例，零分配） */
export function clusterLensingSource(): ClusterLensingSourceHolder {
  return sourceHolder;
}

/** 场景组件每帧写入（LensingArcs useFrame 内调用） */
export function writeClusterLensingSource(
  worldX: number,
  worldY: number,
  worldZ: number,
  visible01: number,
  einsteinRadiusUnits: number = CLUSTER_EINSTEIN_RADIUS_UNITS,
): void {
  if (!Number.isFinite(einsteinRadiusUnits) || einsteinRadiusUnits < 0) {
    throw new RangeError(`爱因斯坦半径必须为非负有限数，收到 ${einsteinRadiusUnits}`);
  }
  sourceHolder.worldX = worldX;
  sourceHolder.worldY = worldY;
  sourceHolder.worldZ = worldZ;
  sourceHolder.visible01 = Math.max(0, Math.min(1, visible01));
  sourceHolder.einsteinRadiusUnits = einsteinRadiusUnits;
  sourceHolder.present = true;
}

/** 后期 Effect 实际强度回写（PostEffects 每帧；场景层近观减淡消费） */
export function writeClusterLensingEffectStrength(strength01: number): void {
  sourceHolder.effectStrength01 = Math.max(0, Math.min(1, strength01));
}

/** 重置持有者（组件卸载清理 / 单测隔离） */
export function resetClusterLensingSource(): void {
  sourceHolder.worldX = 0;
  sourceHolder.worldY = 0;
  sourceHolder.worldZ = 0;
  sourceHolder.visible01 = 0;
  sourceHolder.einsteinRadiusUnits = CLUSTER_EINSTEIN_RADIUS_UNITS;
  sourceHolder.present = false;
  sourceHolder.effectStrength01 = 0;
}

// ---------------------------------------------------------------------------
// 近观背景源布局（确定性）
// ---------------------------------------------------------------------------

/** 近观背景源（相对团块质心的场景单位偏移 + 尺寸/色温档） */
export interface LensedBackgroundSource {
  /** 相对质心偏移（场景单位；z 沿团块视向"更远"方向为正） */
  x: number;
  y: number;
  z: number;
  /** sprite 边长（场景单位） */
  scale: number;
  /** 色温档 ∈[0,1]（0 暖 → 1 冷，组件映射为贴图色调） */
  warmth01: number;
}

/**
 * 近观背景源确定性布局：横向散布在 θ_E 附近（投影后落于强透镜域）、
 * 纵深压在团块之后（背景语义），被 SIS 效果拉伸成切向弧/部分环。
 *
 * mulberry32 定种（附录 A §2）：两次进入布局一致。
 */
export function lensedBackgroundSources(
  count: number = LENSED_BACKGROUND_SOURCE_COUNT,
  seed: number = LENSED_BACKGROUND_SOURCE_SEED,
): readonly LensedBackgroundSource[] {
  if (!Number.isInteger(count) || count < 0 || count > 64) {
    throw new RangeError(`背景源数量必须为 0–64 整数，收到 ${count}`);
  }
  const rand = createSeededRandom(seed);
  const out: LensedBackgroundSource[] = [];
  for (let i = 0; i < count; i++) {
    // 方位均布 + 抖动；横向半径覆盖 0.35–1.1 × R_E（环内成对像 + 环外弧）
    const azimuth = ((i + 0.5) / Math.max(count, 1)) * Math.PI * 2 + (rand() - 0.5) * 0.9;
    const radial = CLUSTER_EINSTEIN_RADIUS_UNITS * (0.35 + 0.75 * rand());
    out.push({
      x: Math.cos(azimuth) * radial,
      y: Math.sin(azimuth) * radial,
      z: 900 + 1600 * rand(),
      scale: 60 + 70 * rand(),
      warmth01: rand(),
    });
  }
  return out;
}
