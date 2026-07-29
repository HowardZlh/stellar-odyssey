/**
 * 昴星团 Gaia 真实成员星消费纯逻辑（R4-17，IMPROVEMENT_REQUIREMENTS_4 §R4-17）
 *
 * 消费 R4-5 烘焙产物 `public/data/pleiades.json`（Gaia DR3 成员星 600 颗，
 * {x,y,z} pc 簇质心系 ICRS 轴向 + B−V + V 视星等），提供：
 * pc→场景单位换算、B−V→Teff→黑体色（复用 R4-6 blackbodyRGB）、
 * 视星等→粒径/亮度映射、9 颗命名亮星真实相对位置（目录匹配 + 天测合成）、
 * 反射星云分层 sprite 布局、starCatalog 细节层规格（R4-2 挂接）。
 *
 * ── 科学近似与登记（附录 A §4）────────────────────────────────────────────
 * 1. pc→场景单位比例：模型半径 PLEIADES_MODEL_RADIUS_PC=6 pc 映射到天体
 *    视觉半径（成员星 |r| p90≈5.7 pc 落入视觉半径内，最远 8.5 pc 少量外溢，
 *    保留真实分布不截断）。
 * 2. B−V→Teff 取 Ballesteros (2012, EPL 97, 34008) 黑体近似公式
 *    T = 4600·(1/(0.92(B−V)+1.7) + 1/(0.92(B−V)+0.62))；再经 R4-6
 *    blackbodyRGB 查表转色（表域 3,000–50,000 K 自动钳制）。
 * 3. 簇质心 ICRS 常量：以产物中与命名星高置信匹配的 3 颗
 *    （Maia/Celaeno/Asterope，天球位置残差 <0.02′、|ΔV|≤0.02）对
 *    质心位置做最小二乘拟合（bake 质心 = 成员均值，非锥形检索中心），
 *    拟合结果 (56.6866°, +24.1888°, 135.76 pc) 登记为常量，单测断言
 *    实际产物匹配结果防漂移。
 * 4. 命名亮星 9 颗：天球坐标（SIMBAD ICRS J2000）+ V 星等登记；
 *    产物内存在者（Maia/Pleione/Celaeno/Asterope）按 角距 <1′ 且
 *    |ΔV|<0.35 匹配吸附到目录真实 3D 位置；Gaia DR3 缺失的最亮 5 颗
 *    （Alcyone/Atlas/Electra/Merope/Taygeta，G<5 亮星天测缺失/未过选星
 *    判据）径向取簇质心距离合成（Hipparcos 视差系统差 ~10 pc 大于簇深度，
 *    不采用，登记）——天球面构型为真实，径向为近似。
 * 5. 反射星云取"分层 sprite"方案（§R4-17 性能优先二选一登记：volume 池
 *    容量 1 已被 M42/M57/马头/蟹状 L3 巡游站高频占用，昴星团插入将造成
 *    连续巡游反复逐出重烘焙）；围绕 Merope（NGC 1435）/Maia（NGC 1432）/
 *    Alcyone/Electra 四亮星各 3 层嵌套 sprite（共 12 张），蓝色反射色调
 *    （尘埃散射星光）区别于发射星云红（Hα）/青（OIII）。
 * 6. 星名交互取"悬停显示星名"方案（§R4-17 二选一登记：命名星 sprite 配
 *    小热区 + ClampedHtmlLabel 悬停标签，成本可控）。
 *
 * 数据源：Gaia DR3（ESA Archive，选星判据见产物 meta）；命名星天测
 * SIMBAD；中文星名取传统昴宿星官（昴宿一~七），Pleione/Celaeno 无昴宿
 * 定名，用神话译名登记。
 */

import type { PleiadesStar } from '@/utils/bakedData';
import { blackbodyRGB } from '@/utils/starPhysics';
import { createSeededRandom } from '@/utils/random';
import {
  estimateGpuBytes,
  type DetailLayerSpec,
} from '@/utils/detailLayer';
import {
  nearViewEnterDistanceUnits,
  nearViewExitDistanceUnits,
} from '@/utils/nearView';

// ---------------------------------------------------------------------------
// 常量（比例/质心/预算登记）
// ---------------------------------------------------------------------------

/** 模型半径（pc）：该半径映射到天体视觉半径（比例登记见文件头 §1） */
export const PLEIADES_MODEL_RADIUS_PC = 6;

/** 基础星场（远景常驻）取最亮成员星数；其余进近观 starCatalog 细节层 */
export const PLEIADES_BASE_STAR_COUNT = 160;

/** 产物成员星总数（bakedData.validatePleiades 上限一致） */
export const PLEIADES_CATALOG_STAR_COUNT = 600;

/** 命名亮星数（七姊妹 + Atlas/Pleione） */
export const PLEIADES_NAMED_STAR_COUNT = 9;

/** 反射星云宿主亮星数 × 每宿主分层数（§R4-17 方案登记见文件头 §5） */
export const PLEIADES_NEBULA_HOST_COUNT = 4;
export const PLEIADES_NEBULA_LAYERS_PER_HOST = 3;

/**
 * 近观细节层粒子增量（points/sprites 合并计数，nearView 登记表同值）：
 * 目录暗星 points (600−160) + 命名星星芒 sprite ×9 + 反射星云 sprite ×12
 */
export const PLEIADES_NEAR_PARTICLE_INCREMENT =
  PLEIADES_CATALOG_STAR_COUNT -
  PLEIADES_BASE_STAR_COUNT +
  PLEIADES_NAMED_STAR_COUNT +
  PLEIADES_NEBULA_HOST_COUNT * PLEIADES_NEBULA_LAYERS_PER_HOST;

/**
 * 簇质心 ICRS 常量（拟合方法登记见文件头 §3；单测以实际产物断言防漂移）
 */
export const PLEIADES_CENTROID_ICRS = {
  raDeg: 56.6866,
  decDeg: 24.1888,
  distancePc: 135.76,
} as const;

/** 命名星目录匹配阈值：角距（角分）与视星等差（登记见文件头 §4） */
export const PLEIADES_NAMED_MATCH_MAX_SEP_ARCMIN = 1.0;
export const PLEIADES_NAMED_MATCH_MAX_DV = 0.35;

/** 视星等→亮度/粒径映射域：亮端（Maia 3.89 档）与暗端钳制 */
export const PLEIADES_V_BRIGHT = 3.8;
export const PLEIADES_V_FAINT = 14;

/** 命名亮星定义（ICRS J2000 天球坐标 + V 星等，SIMBAD 登记） */
export interface PleiadesNamedStarDef {
  /** 西名（拜耳/神话名） */
  name: string;
  /** 中文名（昴宿星官；无定名者用神话译名，登记见文件头） */
  nameZh: string;
  raDeg: number;
  decDeg: number;
  vMag: number;
}

/** 9 颗命名亮星（七姊妹 + Atlas/Pleione），按 V 从亮到暗 */
export const PLEIADES_NAMED_STARS: readonly PleiadesNamedStarDef[] = [
  { name: 'Alcyone', nameZh: '昴宿六', raDeg: 56.87115, decDeg: 24.10514, vMag: 2.87 },
  { name: 'Atlas', nameZh: '昴宿七', raDeg: 57.29059, decDeg: 24.05342, vMag: 3.63 },
  { name: 'Electra', nameZh: '昴宿一', raDeg: 56.21891, decDeg: 24.11334, vMag: 3.7 },
  { name: 'Maia', nameZh: '昴宿四', raDeg: 56.4567, decDeg: 24.36775, vMag: 3.87 },
  { name: 'Merope', nameZh: '昴宿五', raDeg: 56.58156, decDeg: 23.94836, vMag: 4.18 },
  { name: 'Taygeta', nameZh: '昴宿二', raDeg: 56.30204, decDeg: 24.46728, vMag: 4.3 },
  { name: 'Pleione', nameZh: '普勒俄涅', raDeg: 57.29672, decDeg: 24.13672, vMag: 5.09 },
  { name: 'Celaeno', nameZh: '刻莱诺', raDeg: 56.20088, decDeg: 24.28947, vMag: 5.45 },
  { name: 'Asterope', nameZh: '昴宿三', raDeg: 56.47698, decDeg: 24.5545, vMag: 5.76 },
];

/** 反射星云宿主（西名 → 相对强度；Merope 星云 NGC 1435 最亮，登记） */
export const PLEIADES_NEBULA_HOSTS: ReadonlyArray<readonly [string, number]> = [
  ['Merope', 1.0],
  ['Maia', 0.85],
  ['Alcyone', 0.7],
  ['Electra', 0.55],
];

// ---------------------------------------------------------------------------
// 基础换算纯函数
// ---------------------------------------------------------------------------

/** 三维向量（pc 或场景单位，纯数据） */
export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/**
 * ICRS 赤经/赤纬 → 单位方向向量（ICRS 轴向直角系，与烘焙产物同约定：
 * x = cosδ·cosα，y = cosδ·sinα，z = sinδ）
 */
export function icrsUnitVector(raDeg: number, decDeg: number): Vec3Like {
  if (!Number.isFinite(raDeg) || !Number.isFinite(decDeg)) {
    throw new RangeError(`赤经/赤纬必须为有限数，收到 (${raDeg}, ${decDeg})`);
  }
  const ra = (raDeg * Math.PI) / 180;
  const dec = (decDeg * Math.PI) / 180;
  return {
    x: Math.cos(dec) * Math.cos(ra),
    y: Math.cos(dec) * Math.sin(ra),
    z: Math.sin(dec),
  };
}

/**
 * pc → 场景单位比例（比例登记见文件头 §1）
 *
 * @param sizeUnits 天体视觉半径（场景单位，visualRadiusLy × SCENE_UNITS_PER_LY）
 */
export function pleiadesUnitsPerPc(sizeUnits: number): number {
  if (!Number.isFinite(sizeUnits) || sizeUnits <= 0) {
    throw new RangeError(`视觉半径必须为正有限数，收到 ${sizeUnits}`);
  }
  return sizeUnits / PLEIADES_MODEL_RADIUS_PC;
}

/**
 * B−V 色指数 → 有效温度（K）：Ballesteros (2012) 黑体近似
 * T = 4600·(1/(0.92·BV+1.7) + 1/(0.92·BV+0.62))
 *
 * 输入域按产物校验域 [−1, 3] 防御钳制；输出随 B−V 单调递减。
 */
export function bvToTeffK(bv: number): number {
  if (!Number.isFinite(bv)) {
    throw new RangeError(`B−V 色指数必须为有限数，收到 ${bv}`);
  }
  const b = Math.max(-1, Math.min(3, bv));
  return 4600 * (1 / (0.92 * b + 1.7) + 1 / (0.92 * b + 0.62));
}

/**
 * 视星等 → 归一化亮度（0–1）：按星等线性（对数通量）归一，
 * [V_BRIGHT, V_FAINT] 域外钳制。越亮（v 越小）越接近 1。
 */
export function vMagBrightness01(v: number): number {
  if (!Number.isFinite(v)) {
    throw new RangeError(`视星等必须为有限数，收到 ${v}`);
  }
  const t = (PLEIADES_V_FAINT - v) / (PLEIADES_V_FAINT - PLEIADES_V_BRIGHT);
  return Math.max(0, Math.min(1, t));
}

/**
 * 视星等 → 粒径系数（× 天体视觉半径）：亮星大、暗星小且随亮度
 * 超线性衰减（b^1.5），域 [0.022, 0.117]（与 R2-7 现状粒径档相当）。
 */
export function vMagPointSizeFactor(v: number): number {
  const b = vMagBrightness01(v);
  return 0.022 + 0.095 * Math.pow(b, 1.5);
}

/**
 * 命名亮星星芒 sprite 边长系数（× 天体视觉半径）：按相对通量
 * （以 Alcyone V=2.87 为基准）的平方根压缩，最亮 ~0.5、最暗 ~0.23。
 */
export function namedStarSpikeScaleFactor(vMag: number): number {
  if (!Number.isFinite(vMag)) {
    throw new RangeError(`视星等必须为有限数，收到 ${vMag}`);
  }
  const relFlux = Math.pow(10, -0.4 * (vMag - PLEIADES_NAMED_STARS[0].vMag));
  return 0.14 + 0.36 * Math.sqrt(Math.min(1, relFlux));
}

/** sRGB 分量 → 线性工作空间（顶点色属性用，标准 IEC 61966-2-1 逆变换） */
export function srgbToLinear01(c: number): number {
  if (!Number.isFinite(c) || c < 0 || c > 1) {
    throw new RangeError(`sRGB 分量必须在 [0,1] 内，收到 ${c}`);
  }
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

// ---------------------------------------------------------------------------
// 星表属性构建（组件仅消费输出，附录 A §3）
// ---------------------------------------------------------------------------

/** 按 V 星等升序（亮→暗）的稳定排序（非原地，确定性） */
export function sortPleiadesStarsByV(
  stars: readonly PleiadesStar[],
): PleiadesStar[] {
  return [...stars].sort((a, b) => a.v - b.v || a.id.localeCompare(b.id));
}

/** 星表顶点属性（positions/colors 每星 3 分量，sizes 每星 1 分量） */
export interface PleiadesStarAttributes {
  /** 场景单位坐标（簇质心为原点） */
  positions: Float32Array;
  /** 线性空间顶点色（黑体色 × 亮度调制） */
  colors: Float32Array;
  /** 粒径（场景单位，shader 距离衰减用） */
  sizes: Float32Array;
}

/**
 * 构建成员星顶点属性：真实 3D 位置（pc→场景单位）+ B−V→黑体色 +
 * 视星等→粒径/亮度（§R4-17 需求 1）。确定性纯函数（顺序保持输入顺序）。
 */
export function buildPleiadesStarAttributes(
  stars: readonly PleiadesStar[],
  sizeUnits: number,
): PleiadesStarAttributes {
  if (stars.length === 0) {
    throw new RangeError('成员星列表不得为空');
  }
  const unitsPerPc = pleiadesUnitsPerPc(sizeUnits);
  const positions = new Float32Array(stars.length * 3);
  const colors = new Float32Array(stars.length * 3);
  const sizes = new Float32Array(stars.length);
  for (let i = 0; i < stars.length; i += 1) {
    const s = stars[i];
    positions[i * 3] = s.x * unitsPerPc;
    positions[i * 3 + 1] = s.y * unitsPerPc;
    positions[i * 3 + 2] = s.z * unitsPerPc;
    const rgb = blackbodyRGB(bvToTeffK(s.bv));
    const gain = 0.35 + 0.65 * vMagBrightness01(s.v);
    colors[i * 3] = srgbToLinear01(rgb.r) * gain;
    colors[i * 3 + 1] = srgbToLinear01(rgb.g) * gain;
    colors[i * 3 + 2] = srgbToLinear01(rgb.b) * gain;
    sizes[i] = sizeUnits * vMagPointSizeFactor(s.v);
  }
  return { positions, colors, sizes };
}

// ---------------------------------------------------------------------------
// 命名亮星布局（目录匹配 + 天测合成，方案登记见文件头 §4）
// ---------------------------------------------------------------------------

/** 命名亮星布局（场景单位） */
export interface PleiadesNamedPlacement {
  name: string;
  nameZh: string;
  vMag: number;
  x: number;
  y: number;
  z: number;
  /** 星芒 sprite 边长（场景单位） */
  spikeScaleUnits: number;
  /** 匹配到的目录星下标（输入顺序；未匹配（合成位置）为 null） */
  matchedIndex: number | null;
}

/** 质心位置向量（pc，ICRS 轴向） */
function centroidVectorPc(): Vec3Like {
  const u = icrsUnitVector(
    PLEIADES_CENTROID_ICRS.raDeg,
    PLEIADES_CENTROID_ICRS.decDeg,
  );
  const d = PLEIADES_CENTROID_ICRS.distancePc;
  return { x: u.x * d, y: u.y * d, z: u.z * d };
}

/**
 * 9 颗命名亮星布局：产物内存在者按（角距 <1′ 且 |ΔV|<0.35）吸附目录
 * 真实位置；缺失者按天球坐标 + 簇质心距离合成（登记见文件头 §4）。
 *
 * @param stars 成员星列表（质心系 pc 坐标）
 * @param sizeUnits 天体视觉半径（场景单位）
 */
export function pleiadesNamedStarPlacements(
  stars: readonly PleiadesStar[],
  sizeUnits: number,
): PleiadesNamedPlacement[] {
  const unitsPerPc = pleiadesUnitsPerPc(sizeUnits);
  const c = centroidVectorPc();
  const maxSepRad = (PLEIADES_NAMED_MATCH_MAX_SEP_ARCMIN / 60) * (Math.PI / 180);
  return PLEIADES_NAMED_STARS.map((def) => {
    const u = icrsUnitVector(def.raDeg, def.decDeg);
    let matchedIndex: number | null = null;
    let bestSep = Number.POSITIVE_INFINITY;
    for (let i = 0; i < stars.length; i += 1) {
      const s = stars[i];
      if (Math.abs(s.v - def.vMag) > PLEIADES_NAMED_MATCH_MAX_DV) continue;
      // 目录星绝对方向 = 质心 + 相对坐标（归一后与命名星方向夹角）
      const ax = c.x + s.x;
      const ay = c.y + s.y;
      const az = c.z + s.z;
      const norm = Math.sqrt(ax * ax + ay * ay + az * az);
      const dot = (ax * u.x + ay * u.y + az * u.z) / norm;
      const sep = Math.acos(Math.min(1, Math.max(-1, dot)));
      if (sep < maxSepRad && sep < bestSep) {
        bestSep = sep;
        matchedIndex = i;
      }
    }
    let px: number;
    let py: number;
    let pz: number;
    if (matchedIndex !== null) {
      const s = stars[matchedIndex];
      px = s.x;
      py = s.y;
      pz = s.z;
    } else {
      // 合成：命名星方向 × 质心距离 − 质心（径向近似登记见文件头 §4）
      const d = PLEIADES_CENTROID_ICRS.distancePc;
      px = u.x * d - c.x;
      py = u.y * d - c.y;
      pz = u.z * d - c.z;
    }
    return {
      name: def.name,
      nameZh: def.nameZh,
      vMag: def.vMag,
      x: px * unitsPerPc,
      y: py * unitsPerPc,
      z: pz * unitsPerPc,
      spikeScaleUnits: sizeUnits * namedStarSpikeScaleFactor(def.vMag),
      matchedIndex,
    };
  });
}

// ---------------------------------------------------------------------------
// 反射星云分层 sprite 布局（方案登记见文件头 §5）
// ---------------------------------------------------------------------------

/** 反射星云单层 sprite 布局（场景单位） */
export interface PleiadesNebulaPlacement {
  hostName: string;
  x: number;
  y: number;
  z: number;
  /** sprite 边长（场景单位） */
  scaleUnits: number;
  /** 基础不透明度（近观权重另行相乘） */
  opacity: number;
  /** sprite 面内旋转（弧度） */
  rotationRad: number;
  /** 纹理序号（0..textureCount-1，蓝色反射变体） */
  textureIndex: number;
}

/**
 * 反射星云布局：围绕 Merope/Maia/Alcyone/Electra 四亮星各 3 层嵌套
 * sprite（内层小而亮、外层大而淡），层间确定性抖动偏移打散重复感。
 * 蓝色反射色调由组件侧纹理承担（本函数只产布局）。
 */
export function pleiadesReflectionNebulaLayout(
  named: readonly PleiadesNamedPlacement[],
  sizeUnits: number,
  seed = 20260736,
  textureCount = 3,
): PleiadesNebulaPlacement[] {
  if (!Number.isFinite(sizeUnits) || sizeUnits <= 0) {
    throw new RangeError(`视觉半径必须为正有限数，收到 ${sizeUnits}`);
  }
  if (!Number.isInteger(textureCount) || textureCount <= 0) {
    throw new RangeError(`纹理数必须为正整数，收到 ${textureCount}`);
  }
  const byName = new Map(named.map((n) => [n.name, n]));
  const rand = createSeededRandom(seed);
  const placements: PleiadesNebulaPlacement[] = [];
  for (const [hostName, strength] of PLEIADES_NEBULA_HOSTS) {
    const host = byName.get(hostName);
    if (!host) {
      throw new RangeError(`反射星云宿主 ${hostName} 不在命名星布局内`);
    }
    const baseScale = sizeUnits * 0.55 * strength;
    for (let layer = 0; layer < PLEIADES_NEBULA_LAYERS_PER_HOST; layer += 1) {
      const jitter = baseScale * 0.18;
      placements.push({
        hostName,
        x: host.x + (rand() - 0.5) * jitter,
        y: host.y + (rand() - 0.5) * jitter,
        z: host.z + (rand() - 0.5) * jitter,
        scaleUnits: baseScale * (1 + 0.45 * layer),
        opacity: (0.3 - 0.08 * layer) * (0.55 + 0.45 * strength),
        rotationRad: Math.PI * 2 * rand(),
        textureIndex: Math.floor(rand() * textureCount),
      });
    }
  }
  return placements;
}

// ---------------------------------------------------------------------------
// 从地球视向的天球面姿态（构型对照公版图像用）
// ---------------------------------------------------------------------------

/**
 * 昴星团"地球天空视图"旋转矩阵行向量（纯数据，组件侧转 THREE 矩阵）：
 * 把 ICRS 轴向质心系坐标旋转到"沿质心视向观察"的姿态——+y = 天球北
 * （北在上）、−x = 天球东（东在左，与地面观测/公版图像一致）、
 * +z = 指向地球（相机自 +z 看向原点即地球视向）。行向量组成的矩阵为
 * 纯旋转（det=+1，正交归一，单测断言）。主场景与预览页共用（登记：
 * 主场景近观相机方向任意，本姿态保证"自地球方向看"构型与图像一致）。
 */
export function pleiadesSkyViewRows(): {
  rowX: Vec3Like;
  rowY: Vec3Like;
  rowZ: Vec3Like;
} {
  const ra = (PLEIADES_CENTROID_ICRS.raDeg * Math.PI) / 180;
  const dec = (PLEIADES_CENTROID_ICRS.decDeg * Math.PI) / 180;
  // 天球正交基：东 e = ∂u/∂α（归一）、北 n = ∂u/∂δ、径向 u（e×n=u 右手系）
  const east: Vec3Like = { x: -Math.sin(ra), y: Math.cos(ra), z: 0 };
  const north: Vec3Like = {
    x: -Math.sin(dec) * Math.cos(ra),
    y: -Math.sin(dec) * Math.sin(ra),
    z: Math.cos(dec),
  };
  const radial = icrsUnitVector(PLEIADES_CENTROID_ICRS.raDeg, PLEIADES_CENTROID_ICRS.decDeg);
  return {
    rowX: { x: -east.x, y: -east.y, z: -east.z },
    rowY: north,
    rowZ: { x: -radial.x, y: -radial.y, z: -radial.z },
  };
}

// ---------------------------------------------------------------------------
// starCatalog 细节层规格（R4-2 挂接，勿另造门控）
// ---------------------------------------------------------------------------

/**
 * 昴星团真实星表近观细节层规格（useDetailLayer 入参；调用方 useMemo 稳定）
 *
 * 阈值与 R2-7 近观层同源（nearViewEnter/ExitDistanceUnits('pleiades')，
 * 同时机激活）；预算按粒子增量 461（28 B/粒）估算。
 */
export function pleiadesCatalogDetailLayerSpec(): DetailLayerSpec {
  const particles = PLEIADES_NEAR_PARTICLE_INCREMENT;
  return {
    bodyId: 'pleiades',
    kind: 'starCatalog',
    enterDistanceUnits: nearViewEnterDistanceUnits('pleiades'),
    exitDistanceUnits: nearViewExitDistanceUnits('pleiades'),
    budget: { particles, gpuBytesEstimate: estimateGpuBytes({ particles }) },
  };
}
