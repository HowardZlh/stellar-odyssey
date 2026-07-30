/**
 * R5-3 真实巡天目录场景映射（方案 G 渲染侧纯逻辑）
 *
 * 消费 bakedData.GalaxyCatalogData（2MRS 超星系笛卡尔坐标，Mpc），输出
 * Scene/GalaxyCatalog.tsx 可直接上传 GPU 的两级 Points 属性。
 *
 * 场景对齐登记（超星系产物 → 银道 → 场景系旋转；两级锚定）：
 * - **主锚：银道面 ↔ 场景银盘面。** 本项目场景系以银道为基准——y 轴
 *   = 银道北极（特殊天体 y 由真实银纬推算，utils/galacticLatitude），
 *   XZ 平面 = 银盘面（utils/galaxy.sunGalacticPositionLy）。因此目录
 *   经 supergalacticToGalactic 反变换回银道系后，令银道 z → 场景 y：
 *   **银道遮挡带（|b| < 5°）的空带精确落在渲染的银盘平面内**——真实
 *   观测限制与场景银河系自洽（§R5-3 验收"银道空带可辨"的关键）。
 * - **次锚：绕 y 轴方位对齐 M87。** 绕 y 的方位角为自由参数，取使目录
 *   室女座团方向（M87 真实银道 l=283.78° b=+74.49°）的方位角等于
 *   data/galaxies 中 M87 示意 direction 的方位角——室女座超密度出现在
 *   实体 M87 大致方向。残余偏差 = 仰角差 ≈ 15.2°（真实银纬 74.5° vs
 *   示意 direction 仰角 59.3°），登记；各实体星系偏差由
 *   catalogAnchorDeviationDeg 逐一登记（单测 ±5° 漂移带断言）。
 * - 登记：data/galaxies 各实体 direction 为"近似真实天区方位的示意单位
 *   矢量"（该文件头登记），不存在能同时对齐全部实体的刚体旋转；重影风险
 *   与偏差无关——去重在烘焙侧按真实天球坐标完成。
 * - 经度手性登记：本映射取 det = +1 的真旋转（不镜像真实天空），
 *   银道经度增向与场景太阳公转方向（sunGalacticPositionLy 自 +x 向 −z）
 *   相反；银盘渲染绕轴近对称、旋臂手性本身为示意，视觉不可辨，登记不修正。
 * - **拉尼亚凯亚边界对齐（§R5-3）**：R5-3 起示意边界环由"场景 XZ 平面"
 *   改置于**真实超星系平面**（SGZ = 0，法向 = supergalacticToScene 的
 *   SG 北极像）——室女座团 SGB ≈ −2.3° 基本落在该平面内，边界环因此
 *   穿过目录室女座超密度处（对齐核对通过）；环相对银盘面倾角 ≈ 84.5°
 *   （真实超星系平面与银道面夹角）为真实几何，登记。
 *
 * 距离映射：与 L4 实体星系同源——Mpc → 光年 → utils/scale.
 * cosmicDistanceToSceneUnits 对数压缩（禁止两套参数）。
 *
 * 两级 LOD（§R5-3 B）：拉尼亚凯亚近域（≤ 80 Mpc ≈ 2.6 亿光年半径）
 * 软圆点适度增大 + 远景单像素两个 Points（各一次 draw call）。
 * 亮度档 → 顶点尺寸与颜色强度（加性混合下颜色强度等效 alpha）；
 * 形态档 → 色调（椭圆偏黄 / 旋涡偏蓝白 / 未知中性）。
 */

import type { Vec3 } from '@/types';
import type { GalaxyCatalogData } from '@/utils/bakedData';
import { LOCAL_GROUP_GALAXIES } from '@/data/galaxies';
import {
  ENTITY_GALAXY_SKY,
  LY_PER_MPC,
  angularSeparationDeg,
  equatorialToGalacticUnit,
  supergalacticToGalactic,
} from '@/utils/galaxyCatalogCore';
import { cosmicDistanceToSceneUnits } from '@/utils/scale';
import { srgbToLinear01 } from '@/utils/pleiadesCatalog';

// ---------------------------------------------------------------------------
// 超星系 → 场景旋转（三轴锚定：M87 精确 + M31 同面）
// ---------------------------------------------------------------------------

function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v.x, v.y, v.z);
  if (!Number.isFinite(len) || len === 0) {
    throw new RangeError('零矢量无法归一化');
  }
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

function entitySky(id: string): { raDeg: number; decDeg: number } {
  const e = ENTITY_GALAXY_SKY.find((g) => g.id === id);
  if (!e) throw new RangeError(`未登记实体星系天球坐标：${id}`);
  return e;
}

function entitySceneDirection(id: string): Vec3 {
  const g = LOCAL_GROUP_GALAXIES.find((x) => x.id === id);
  if (!g) throw new RangeError(`未知实体星系：${id}`);
  return normalize(g.direction);
}

/** 实体星系真实银道方向（目录同一坐标链，禁止两套公式） */
function entityRealGalacticDirection(id: string): Vec3 {
  const { raDeg, decDeg } = entitySky(id);
  return equatorialToGalacticUnit(raDeg, decDeg);
}

/**
 * 银道 → 场景基映射（主锚：银道北极 → 场景 +y，银心方向 l=0 → 场景 −x，
 * l=90° → 场景 +z；det = +1 真旋转，手性登记见文件头）
 */
function galacticToSceneBase(v: Vec3): Vec3 {
  return { x: -v.x, y: v.z, z: v.y };
}

/** 次锚方位角（弧度，绕场景 y 轴）：令 M87 真实方向方位角 = 示意 direction 方位角 */
const AZIMUTH_OFFSET_RAD: number = (() => {
  const real = galacticToSceneBase(entityRealGalacticDirection('m87'));
  const scene = entitySceneDirection('m87');
  return Math.atan2(real.z, real.x) - Math.atan2(scene.z, scene.x);
})();

/** 绕场景 y 轴旋转 −φ（az' = az − φ；y 不变 → 银道面仍映射到场景 XZ 平面） */
function rotateAboutY(v: Vec3, phi: number): Vec3 {
  const c = Math.cos(phi);
  const s = Math.sin(phi);
  return { x: v.x * c + v.z * s, y: v.y, z: -v.x * s + v.z * c };
}

/** 银道矢量 → 场景矢量（长度保持；两级锚定的唯一出处） */
export function galacticToScene(v: Vec3): Vec3 {
  return rotateAboutY(galacticToSceneBase(v), AZIMUTH_OFFSET_RAD);
}

/** 超星系矢量（产物坐标）→ 场景矢量（长度保持） */
export function supergalacticToScene(v: Vec3): Vec3 {
  return galacticToScene(supergalacticToGalactic(v));
}

/**
 * 超星系 → 场景旋转矩阵（行主序 3×3；单测正交性/手性断言用）
 */
export function buildCatalogSceneRotation(): number[] {
  const ex = supergalacticToScene({ x: 1, y: 0, z: 0 });
  const ey = supergalacticToScene({ x: 0, y: 1, z: 0 });
  const ez = supergalacticToScene({ x: 0, y: 0, z: 1 });
  // 列 = 基矢量像 → 行主序矩阵
  return [ex.x, ey.x, ez.x, ex.y, ey.y, ez.y, ex.z, ey.z, ez.z];
}

/**
 * 实体星系锚定偏差（度）：旋转后的真实方向 vs 场景示意方向夹角
 * （偏差登记的单一出处；M87 = 仰角差 ≈ 15.2°，方位已对齐）
 */
export function catalogAnchorDeviationDeg(id: string): number {
  return angularSeparationDeg(
    galacticToScene(entityRealGalacticDirection(id)),
    entitySceneDirection(id),
  );
}

// ---------------------------------------------------------------------------
// 超星系平面（拉尼亚凯亚示意边界对齐，§R5-3 B）
// ---------------------------------------------------------------------------

/** 超星系北极在场景系的单位法向（真实超星系平面 SGZ = 0 的法线） */
export const SUPERGALACTIC_POLE_SCENE: Vec3 = supergalacticToScene({ x: 0, y: 0, z: 1 });

/** 超星系平面在场景系的正交基（e1 = SGX 像、e2 = SGY 像） */
const SG_PLANE_E1: Vec3 = supergalacticToScene({ x: 1, y: 0, z: 0 });
const SG_PLANE_E2: Vec3 = supergalacticToScene({ x: 0, y: 1, z: 0 });

/**
 * 真实超星系平面上的圆环采样点（场景坐标）：拉尼亚凯亚示意边界与
 * 目录室女座超密度（SGB ≈ −2.3°）同面（§R5-3 对齐核对）
 */
export function supergalacticPlanePointScene(radiusUnits: number, angleRad: number): Vec3 {
  if (!Number.isFinite(radiusUnits) || radiusUnits <= 0) {
    throw new RangeError(`半径必须为正有限数，收到 ${radiusUnits}`);
  }
  if (!Number.isFinite(angleRad)) {
    throw new RangeError(`角度必须为有限数，收到 ${angleRad}`);
  }
  const c = Math.cos(angleRad) * radiusUnits;
  const s = Math.sin(angleRad) * radiusUnits;
  return {
    x: SG_PLANE_E1.x * c + SG_PLANE_E2.x * s,
    y: SG_PLANE_E1.y * c + SG_PLANE_E2.y * s,
    z: SG_PLANE_E1.z * c + SG_PLANE_E2.z * s,
  };
}

/** 超星系平面与场景银盘面（XZ）夹角（度，真实几何 ≈ 84.5°，登记） */
export function supergalacticPlaneTiltDeg(): number {
  return angularSeparationDeg(SUPERGALACTIC_POLE_SCENE, { x: 0, y: 1, z: 0 });
}

// ---------------------------------------------------------------------------
// 距离映射 + 两级 LOD 属性构建
// ---------------------------------------------------------------------------

/** 拉尼亚凯亚近域上界（Mpc）：直径 5.2 亿光年 → 半径 2.6e8 ly ≈ 80 Mpc */
export const LANIAKEA_NEAR_MAX_MPC = 80;

/**
 * 目录 Mpc 距离 → 场景单位（与 L4 实体星系同源：光年 →
 * cosmicDistanceToSceneUnits 对数压缩，utils/scale 登记）
 */
export function catalogDistanceToSceneUnits(distanceMpc: number): number {
  if (!Number.isFinite(distanceMpc) || distanceMpc <= 0) {
    throw new RangeError(`目录距离必须为正有限数（Mpc），收到 ${distanceMpc}`);
  }
  return cosmicDistanceToSceneUnits(distanceMpc * LY_PER_MPC);
}

/** 形态档基色（sRGB）：0 早型偏黄 / 1 晚型蓝白 / 2 未知中性暖灰 */
export const MORPH_TIER_COLORS_SRGB: readonly [number, number, number][] = [
  [1.0, 0.85, 0.66],
  [0.78, 0.86, 1.0],
  [0.85, 0.83, 0.77],
];

/** 亮度档 → 颜色强度（加性混合下等效 alpha；暗端保底可见） */
export function catalogIntensity01(brightness01: number): number {
  if (!Number.isFinite(brightness01) || brightness01 < 0 || brightness01 > 1) {
    throw new RangeError(`亮度档必须在 [0,1]，收到 ${brightness01}`);
  }
  return 0.3 + 0.7 * brightness01;
}

/**
 * 远景档尺寸（CSS px）：单像素基线（§R5-3 B"远景单像素"），最亮 ~2.6px
 * ——1.4 起步为无头定量目验调参（1.0 起步时远景点在加性混合下大量落到
 * 可辨阈值以下，纤维走向不可辨，登记）
 */
export function catalogFarSizePx(brightness01: number): number {
  return 1.4 + 1.2 * brightness01;
}

/** 拉尼亚凯亚近域档尺寸（CSS px）：适度增大（§R5-3 B 登记） */
export function catalogNearSizePx(brightness01: number): number {
  return 2.2 + 2.6 * brightness01;
}

/** 两级 Points 单档属性（Scene/GalaxyCatalog.tsx 直接上传 GPU） */
export interface CatalogPointsAttributes {
  count: number;
  /** 场景坐标（count×3） */
  positions: Float32Array;
  /** 线性空间颜色（count×3，含亮度强度） */
  colors: Float32Array;
  /** 顶点尺寸（count，CSS px） */
  sizes: Float32Array;
}

export interface CatalogLodAttributes {
  /** 拉尼亚凯亚近域（≤ 80 Mpc，软圆点适度增大） */
  near: CatalogPointsAttributes;
  /** 远景（> 80 Mpc，单像素） */
  far: CatalogPointsAttributes;
}

/**
 * 目录 → 两级 Points 属性（纯函数：旋转 + 对数距离压缩 + 亮度/形态映射；
 * 单次构建，渲染循环零遍历）
 */
export function buildCatalogLodAttributes(data: GalaxyCatalogData): CatalogLodAttributes {
  const nearIdx: number[] = [];
  const farIdx: number[] = [];
  const distances = new Float32Array(data.count);
  for (let i = 0; i < data.count; i += 1) {
    const x = data.positionsMpc[i * 3];
    const y = data.positionsMpc[i * 3 + 1];
    const z = data.positionsMpc[i * 3 + 2];
    const d = Math.hypot(x, y, z);
    distances[i] = d;
    (d <= LANIAKEA_NEAR_MAX_MPC ? nearIdx : farIdx).push(i);
  }
  const build = (indices: number[], near: boolean): CatalogPointsAttributes => {
    const positions = new Float32Array(indices.length * 3);
    const colors = new Float32Array(indices.length * 3);
    const sizes = new Float32Array(indices.length);
    for (let k = 0; k < indices.length; k += 1) {
      const i = indices[k];
      const d = distances[i];
      const units = catalogDistanceToSceneUnits(d);
      const p = supergalacticToScene({
        x: data.positionsMpc[i * 3] / d,
        y: data.positionsMpc[i * 3 + 1] / d,
        z: data.positionsMpc[i * 3 + 2] / d,
      });
      positions[k * 3] = p.x * units;
      positions[k * 3 + 1] = p.y * units;
      positions[k * 3 + 2] = p.z * units;
      const b = data.brightness01[i];
      const base = MORPH_TIER_COLORS_SRGB[data.morphTiers[i]] ?? MORPH_TIER_COLORS_SRGB[2];
      const intensity = catalogIntensity01(b);
      colors[k * 3] = srgbToLinear01(base[0]) * intensity;
      colors[k * 3 + 1] = srgbToLinear01(base[1]) * intensity;
      colors[k * 3 + 2] = srgbToLinear01(base[2]) * intensity;
      sizes[k] = near ? catalogNearSizePx(b) : catalogFarSizePx(b);
    }
    return { count: indices.length, positions, colors, sizes };
  };
  return { near: build(nearIdx, true), far: build(farIdx, false) };
}

// ---------------------------------------------------------------------------
// 信息面板/HelpHint 文案常量（§R5-3：来源 + 三项失真登记）
// ---------------------------------------------------------------------------

/** 真实巡天背景来源（ControlPanel/信息面板展示） */
export const GALAXY_CATALOG_SOURCE_ZH =
  '2MASS 红移巡天（2MRS，Huchra et al. 2012）约 4.3 万个真实星系的三维位置';

/** 三项失真登记（附录 A §3：不得默称"完全真实"） */
export const GALAXY_CATALOG_DISTORTIONS_ZH =
  '红移距离为哈勃流近似（本动速度致星系团沿视线拉长的"指状效应"）；' +
  '近距（cz ≲ 1,000 km/s）距离误差可达数十%；' +
  '银道面附近空带为尘埃遮挡的观测限制（Zone of Avoidance），非真实空洞';
