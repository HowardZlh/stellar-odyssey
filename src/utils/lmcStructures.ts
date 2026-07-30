/**
 * LMC 标志结构纯逻辑（R5-5 A，IMPROVEMENT_REQUIREMENTS_5 §R5-5）
 *
 * 纯逻辑模块（附录 A §3 纯函数先行）：为 LMC 近观提供 30 Doradus
 * （蜘蛛星云 NGC 2070）真实相对位置换算、可视化放大系数与中央棒
 * 色彩分层权重；组件（`Scene/LmcTarantula.tsx`）与
 * `utils/galaxyNearView.applyLmcBarTint` 只消费本模块输出。
 *
 * ── 30 Doradus 位置换算（§R5-5 A 第 1 条登记）─────────────────────────────
 * SIMBAD（NGC 2070）：RA 05h38m42.4s = 84.6767°，Dec −69°06′03″ =
 * −69.1009°（ICRS）。LMC 近观粒子层由 R5-1 影像驱动（DSS2 彩色合成，
 * TAN/gnomonic 投影、北上东左、LMC 居中——`scripts/bake-data/galaxyMaps.ts`
 * LMC 配置：中心 RA 80.8942° / Dec −69.7561°、距离 163,000 ly、裁剪半径
 * 5.5° → mapRadiusLy 15,647），影像 u/v 与盘面光年坐标的对应为
 * x = u·mapRadiusLy（+x = 天球西）、z = v·mapRadiusLy（+z = 天球南）。
 * 故天球坐标 → 盘面坐标取 gnomonic 切平面（ξ=东、η=北，弧度）：
 *   xLy = −ξ·distanceLy；zLy = −η·distanceLy
 * （`skyToLmcDiskLy`，与烘焙侧 `galaxyMapsCore.skyToPixel` 同式镜像；
 * 常量与烘焙配置单点同源由单测跨断言，30 Dor 落点处密度图实测 255
 * 饱和亮区——位置正确性单测锚定产物 PNG）。
 *
 * ── 可视化放大系数（§R5-5 A 第 1 条登记）──────────────────────────────────
 * 30 Dor 真实直径 ~600 ly ≪ LMC 盘 ~30,000 ly（占比 <2%，原比例近观
 * 不可辨）；发射区可视化半径 = 真实半径 300 ly × 放大系数
 * `TARANTULA_SCALE_BOOST_DEFAULT` = 5（视觉直径 ~3,000 ly ≈ 盘直径
 * 10%，可辨且不喧宾夺主——3.5 档无头目验粉红区仅数像素不可辨，上调
 * 登记；预览页滑杆可调 1–8 对照）。
 *
 * ── 中央棒色彩分层（§R5-5 A 第 2 条登记）──────────────────────────────────
 * R5-1 密度图已含棒亮区（几何不动），本模块只提供颜色通道加权：棒区
 * 老年星族（K/M 巨星主导）向偏黄 tint 混合、盘面蓝白年轻星族保持。
 * 棒椭圆几何为对产物密度图高亮区（≥170/255，排除 30 Dor 邻域）的
 * 流量加权二阶矩拟合值登记：中心 (−266, −421) ly、主轴相对 +x 轴
 * −0.503 rad（≈−28.8°）、σ 长/短 ≈ 2,368/1,433 ly → 取半长轴 4,300 /
 * 半短轴 2,000 ly（≈1.8σ/1.4σ 覆盖档）。真实 LMC 棒（光学 PA ≈ 120°，
 * 长 ~3°）与拟合值一致量级；权重沿椭圆归一化半径平滑衰减
 * （`lmcBarWeight01`）。tint 色与混合权重沿用 M31 核球偏黄先例风格
 * （`M31_BULGE_TINT` 同族，示意登记）。
 *
 * ── 体积发射区参数（§R5-5 A 第 1 条，复用星云密度基元登记）────────────────
 * 30 Dor 体积复用 `utils/volume.makeSphericalFbmCloudSampler`（球壳 +
 * fBm，省 token 约定勿新造塑形函数），48³ R8 单通道纹理（≈110 KB，
 * 附录 A ≤128³ 约束内）；Hα 粉红双色档（低密度端粉红 → 高密度端
 * 亮粉白）+ 中心 R136 星团蓝白亮核 glow sprite ×1。GPU/粒子预算并入
 * `galaxyNearView.galaxyDetailLayerSpec('lmc')`（particles 池，登记）。
 *
 * ── 数据来源（§0.4）───────────────────────────────────────────────────────
 * 30 Doradus 位置：SIMBAD（NGC 2070）；影像：NASA/ESA Hubble 公版影像
 * 形态参考 + DSS2 彩色合成烘焙产物（R5-1 同源）；棒分层：van der Marel
 * (2001) LMC 棒结构与老年星族色差图景（近似登记）。
 *
 * 确定性（附录 A §2）：全部为常量与纯函数；体积种子
 * `volumeSeed('lmc-30dor')` 由组件侧消费。
 */

// ---------------------------------------------------------------------------
// 影像帧常量（与 scripts/bake-data/galaxyMaps.ts LMC 配置单点同源，
// 单测跨断言防漂移；不直接 import——烘焙脚本依赖 node 内建模块不进 bundle）
// ---------------------------------------------------------------------------

/** LMC 影像中心 RA（度；hips2fits object=LMC 解析中心，烘焙配置同值） */
export const LMC_IMAGE_CENTER_RA_DEG = 80.8942;

/** LMC 影像中心 Dec（度） */
export const LMC_IMAGE_CENTER_DEC_DEG = -69.7561;

/** LMC 距离（光年；NED 登记值，烘焙配置同值——切平面弧长换算用） */
export const LMC_DISTANCE_LY = 163000;

/** LMC 影像裁剪半径（度；烘焙配置同值——mapRadiusLy = lyPerDeg×本值，
 * 与产物 meta.mapRadiusLy 一致性由单测跨断言防漂移） */
export const LMC_IMAGE_CROP_RADIUS_DEG = 5.5;

/** 30 Doradus（NGC 2070）SIMBAD 位置（ICRS，度） */
export const TARANTULA_RA_DEG = 84.6767;
export const TARANTULA_DEC_DEG = -69.1009;

/** 30 Dor 真实半径（光年；直径 ~600 ly 量级登记） */
export const TARANTULA_REAL_RADIUS_LY = 300;

/** 30 Dor 可视化放大系数默认档（登记见文件头；预览页滑杆可调） */
export const TARANTULA_SCALE_BOOST_DEFAULT = 5;

/** 30 Dor 体积纹理边长（48³，§R5-5 指定小型体积；附录 A ≤128 内） */
export const TARANTULA_VOLUME_TEXTURE_SIZE = 48;

/** 30 Dor 近观新增 sprite 数（R136 蓝白亮核 ×1，预算登记） */
export const TARANTULA_SPRITE_COUNT = 1;

/** 体积包围盒边长 = 可视化半径 × 本系数（球壳基元 radius=0.8 → 发射
 * 包络半径 ≈ 0.4×边长，边长 2.5× 可视化半径时包络 ≈ 可视化半径） */
export const TARANTULA_BOX_EDGE_PER_RADIUS = 2.5;

/** 30 Dor 球壳 + fBm 密度基元参数（makeSphericalFbmCloudSampler 复用，
 * 目验调参登记：频率 3 团块中等、coverage 0.34 保持云体连贯不碎散） */
export const TARANTULA_CLOUD_OPTIONS = {
  frequency: 3,
  octaves: 4,
  radius: 0.8,
  softness: 0.5,
  coverage: 0.34,
} as const;

const DEG_TO_RAD = Math.PI / 180;

/** 盘面坐标（光年；LMC 近观局部系：+x = 天球西、+z = 天球南、y = 厚度） */
export interface LmcDiskPositionLy {
  xLy: number;
  zLy: number;
}

/**
 * 天球坐标 → LMC 近观盘面坐标（光年）：gnomonic 切平面投影
 * （烘焙侧 `galaxyMapsCore.skyToPixel` 同式镜像，东左北上约定 →
 * xLy = −ξ·d、zLy = −η·d；方法登记见文件头）。
 *
 * @throws RangeError 当输入非有限数
 */
export function skyToLmcDiskLy(raDeg: number, decDeg: number): LmcDiskPositionLy {
  if (!Number.isFinite(raDeg) || !Number.isFinite(decDeg)) {
    throw new RangeError(`天球坐标必须为有限数，收到 ${raDeg}, ${decDeg}`);
  }
  const ra = raDeg * DEG_TO_RAD;
  const dec = decDeg * DEG_TO_RAD;
  const ra0 = LMC_IMAGE_CENTER_RA_DEG * DEG_TO_RAD;
  const dec0 = LMC_IMAGE_CENTER_DEC_DEG * DEG_TO_RAD;
  const cosC =
    Math.sin(dec0) * Math.sin(dec) + Math.cos(dec0) * Math.cos(dec) * Math.cos(ra - ra0);
  // gnomonic 标准式（单位：弧度切平面；ξ=东、η=北）
  const xi = (Math.cos(dec) * Math.sin(ra - ra0)) / cosC;
  const eta =
    (Math.cos(dec0) * Math.sin(dec) - Math.sin(dec0) * Math.cos(dec) * Math.cos(ra - ra0)) /
    cosC;
  return { xLy: -xi * LMC_DISTANCE_LY, zLy: -eta * LMC_DISTANCE_LY };
}

/** 30 Doradus 盘面位置（光年；SIMBAD 位置换算，≈ (−3837, −1746)） */
export function tarantulaDiskPositionLy(): LmcDiskPositionLy {
  return skyToLmcDiskLy(TARANTULA_RA_DEG, TARANTULA_DEC_DEG);
}

/**
 * 30 Dor 可视化半径（光年）= 真实半径 × 放大系数（登记见文件头）
 *
 * @throws RangeError 当放大系数非正有限数
 */
export function tarantulaVisualRadiusLy(
  scaleBoost: number = TARANTULA_SCALE_BOOST_DEFAULT,
): number {
  if (!Number.isFinite(scaleBoost) || scaleBoost <= 0) {
    throw new RangeError(`放大系数必须为正有限数，收到 ${scaleBoost}`);
  }
  return TARANTULA_REAL_RADIUS_LY * scaleBoost;
}

/** 30 Dor 体积包围盒边长（场景单位）；unitsPerLy 与近观粒子层同源 */
export function tarantulaBoxEdgeUnits(
  unitsPerLy: number,
  scaleBoost: number = TARANTULA_SCALE_BOOST_DEFAULT,
): number {
  if (!Number.isFinite(unitsPerLy) || unitsPerLy <= 0) {
    throw new RangeError(`unitsPerLy 必须为正有限数，收到 ${unitsPerLy}`);
  }
  return tarantulaVisualRadiusLy(scaleBoost) * TARANTULA_BOX_EDGE_PER_RADIUS * unitsPerLy;
}

// ---------------------------------------------------------------------------
// 中央棒色彩分层（§R5-5 A 第 2 条）
// ---------------------------------------------------------------------------

/** 棒椭圆中心（盘面光年；密度图流量加权拟合登记见文件头） */
export const LMC_BAR_CENTER_LY: Readonly<LmcDiskPositionLy> = { xLy: -266, zLy: -421 };

/** 棒主轴相对 +x 轴转角（弧度，向 +z 方向为正；拟合登记） */
export const LMC_BAR_ANGLE_RAD = -0.503;

/** 棒椭圆半长轴/半短轴（光年；≈1.8σ/1.4σ 覆盖档登记） */
export const LMC_BAR_SEMI_MAJOR_LY = 4300;
export const LMC_BAR_SEMI_MINOR_LY = 2000;

/** 棒区老年星族偏黄 tint（M31_BULGE_TINT 同族示意档登记） */
export const LMC_BAR_TINT: Readonly<{ r: number; g: number; b: number }> = {
  r: 1.0,
  g: 0.84,
  b: 0.58,
};

/** 棒区 tint 最大混合权重（椭圆中心处；向外沿权重平滑衰减） */
export const LMC_BAR_TINT_BLEND = 0.45;

/** smoothstep（GLSL 同式） */
function smoothstep01(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * 中央棒权重（∈[0,1]）：盘面坐标 → 棒椭圆归一化半径 q（主轴旋转系），
 * q ≤ 0.55 → 1（棒核心满权重），q ≥ 1 → 0（椭圆外零），中间平滑过渡。
 * 非有限输入返回 0（防御性，粒子坐标域内恒有限）。
 */
export function lmcBarWeight01(xLy: number, zLy: number): number {
  if (!Number.isFinite(xLy) || !Number.isFinite(zLy)) return 0;
  const dx = xLy - LMC_BAR_CENTER_LY.xLy;
  const dz = zLy - LMC_BAR_CENTER_LY.zLy;
  const cosA = Math.cos(LMC_BAR_ANGLE_RAD);
  const sinA = Math.sin(LMC_BAR_ANGLE_RAD);
  // 旋转到棒主轴坐标系（u 沿主轴、v 沿短轴）
  const u = dx * cosA + dz * sinA;
  const v = -dx * sinA + dz * cosA;
  const q = Math.hypot(u / LMC_BAR_SEMI_MAJOR_LY, v / LMC_BAR_SEMI_MINOR_LY);
  return 1 - smoothstep01(0.55, 1, q);
}

// ---------------------------------------------------------------------------
// 信息面板文案（§R5-5 A 第 3 条；catalog.ts 消费）
// ---------------------------------------------------------------------------

/** LMC 卡片"标志结构"行（近观联动：30 Dor + 中央棒色彩分层） */
export const LMC_LANDMARK_NOTE_ZH =
  '30 Doradus（蜘蛛星云/NGC 2070，本星系群最亮恒星形成区——Hα 粉红发射区 + 中心 R136 超星团蓝白亮核，近观按真实相对位置呈现、尺度放大 5× 可辨已登记）+ 中央棒（老年星族偏黄 vs 盘面蓝白年轻星族的色彩分层）';

/** LMC 标志结构数据来源（catalog dataSource 追加段） */
export const LMC_LANDMARK_SOURCE_ZH =
  '30 Doradus 位置：SIMBAD（NGC 2070）经 gnomonic 切平面换算至影像盘面（方法登记 utils/lmcStructures）；发射区为球壳+fBm 程序化体积近似（NASA/ESA Hubble 公版影像形态参考）；棒椭圆为密度图流量加权二阶矩拟合档、老年星族偏黄分层为示意色调（van der Marel 2001 图景近似登记）';
