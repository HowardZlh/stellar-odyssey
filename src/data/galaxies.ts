/**
 * 星系数据：银河系结构、本星系群、更大尺度结构（需求 3.1.3 / 3.1.4）
 *
 * 数据来源：
 * - 银河系结构：NASA/JPL-Caltech 银河系年度巡礼图与 Gaia 巡天成果
 *   （直径约 10 万光年，盘厚约 1000 光年，棒旋结构，4 条主旋臂）
 * - 河外星系距离/大小/视向速度：NASA/IPAC Extragalactic Database (NED),
 *   https://ned.ipac.caltech.edu/
 * - 拉尼亚凯亚超星系团：R.B. Tully et al., "The Laniakea supercluster of
 *   galaxies", Nature 513 (2014)
 *
 * 近似处理登记：
 * - 各星系 direction 为近似真实天区方位的示意单位矢量（场景坐标），
 *   精确三维位置重建超出可视化需要。
 * - 卫星星系轨道周期为示意近似（真实 LMC/SMC 轨道尚有较大不确定性）。
 */

import type { GalaxyData, Vec3 } from '@/types';

const NED_SOURCE = 'NASA/IPAC Extragalactic Database (NED), https://ned.ipac.caltech.edu/';

/** 银河系结构常量（棒旋星系，4 条主旋臂——全文档统一使用此命名） */
export const MILKY_WAY = {
  id: 'milky-way',
  name: 'Milky Way',
  nameZh: '银河系',
  morphology: 'barred-spiral' as const,
  diameterLy: 100000,
  diskThicknessLy: 1000,
  // 4 条主旋臂，全文档统一命名
  armNames: ['英仙臂', '人马臂', '矩尺臂', '盾牌-半人马臂'] as const,
  sagittariusAStarZh: '人马座A*（银心超大质量黑洞，约430万太阳质量）',
  dataSource:
    'NASA/JPL-Caltech 银河系结构图 / Gaia DR3；黑洞质量来源：GRAVITY Collaboration (2019)',
} as const;

/**
 * 本星系群及邻近代表性星系（本星系群直径约 1000 万光年）
 *
 * direction 均为已归一化的单位矢量（|v|≈1，测试校验），
 * 为近似真实天区方位的示意方向（近似处理，见文件头登记）。
 */
export const LOCAL_GROUP_GALAXIES: readonly GalaxyData[] = [
  {
    id: 'm31',
    name: 'Andromeda Galaxy (M31)',
    nameZh: '仙女座星系',
    morphology: 'spiral',
    distanceLy: 2.5e6,
    diameterLy: 152000, // 约为银河系（10 万光年）的 1.5 倍
    // 已归一化：0.48² + 0.42² + (−0.77)² ≈ 1.000
    direction: { x: 0.48, y: 0.42, z: -0.77 },
    radialVelocityKmS: -110, // 负值：正在接近银河系
    groupZh: '本星系群',
    descriptionZh:
      '本星系群最大的星系，正以约 110 km/s 接近银河系，预计约 45 亿年后与银河系碰撞合并',
    dataSource: NED_SOURCE,
  },
  {
    id: 'm33',
    name: 'Triangulum Galaxy (M33)',
    nameZh: '三角座星系',
    morphology: 'spiral',
    distanceLy: 2.73e6,
    diameterLy: 60000, // 约为银河系的 60%
    // 与 M31 方向相近（真实上 M33 距 M31 仅约 75 万光年）；已归一化
    direction: { x: 0.52, y: 0.37, z: -0.77 },
    radialVelocityKmS: -179,
    groupZh: '本星系群',
    descriptionZh: '本星系群第三大星系，正面朝向地球的旋涡星系，与仙女座星系相距仅约 75 万光年',
    dataSource: NED_SOURCE,
  },
  {
    id: 'lmc',
    name: 'Large Magellanic Cloud',
    nameZh: '大麦哲伦云',
    morphology: 'irregular',
    distanceLy: 160000,
    diameterLy: 32000,
    // 南天方向；已归一化
    direction: { x: -0.2049, y: -0.9222, z: 0.3279 },
    radialVelocityKmS: 262,
    groupZh: '本星系群（银河系卫星）',
    descriptionZh: '银河系最大的卫星星系，南半球肉眼可见，拥有活跃恒星形成区蜘蛛星云',
    dataSource: NED_SOURCE,
  },
  {
    id: 'smc',
    name: 'Small Magellanic Cloud',
    nameZh: '小麦哲伦云',
    morphology: 'irregular',
    distanceLy: 200000,
    diameterLy: 18000,
    // 南天方向，与 LMC 相近但不同；已归一化
    direction: { x: -0.3201, y: -0.8803, z: 0.3501 },
    radialVelocityKmS: 146,
    groupZh: '本星系群（银河系卫星）',
    descriptionZh: '银河系的矮不规则卫星星系，与大麦哲伦云之间由麦哲伦桥的气体流相连',
    dataSource: NED_SOURCE,
  },
  {
    id: 'm32',
    name: 'Le Gentil (M32)',
    nameZh: 'M32',
    morphology: 'elliptical',
    distanceLy: 2.49e6,
    diameterLy: 6500,
    // 紧邻 M31（真实上是 M31 的致密椭圆伴星系）；已归一化：0.46²+0.44²+(−0.77)²≈0.998
    direction: { x: 0.46, y: 0.44, z: -0.77 },
    radialVelocityKmS: -200,
    groupZh: '本星系群（仙女座卫星）',
    descriptionZh:
      '仙女座星系的致密椭圆（cE）伴星系，可能是被 M31 潮汐剥离的星系核残骸；渲染位置随 M31 一同移动（示意偏移已登记）',
    dataSource: NED_SOURCE,
  },
  {
    id: 'm110',
    name: 'Edward Young Galaxy (M110)',
    nameZh: 'M110',
    morphology: 'elliptical',
    distanceLy: 2.69e6,
    diameterLy: 17000,
    // 紧邻 M31 的另一侧；已归一化：0.50²+0.40²+(−0.768)²≈0.9998
    direction: { x: 0.5, y: 0.4, z: -0.768 },
    radialVelocityKmS: -241,
    groupZh: '本星系群（仙女座卫星）',
    descriptionZh:
      '仙女座星系的矮椭圆伴星系，与 M32 分列 M31 两侧；渲染位置随 M31 一同移动（示意偏移已登记）',
    dataSource: NED_SOURCE,
  },
  {
    id: 'sagittarius-dwarf',
    name: 'Sagittarius Dwarf Spheroidal Galaxy',
    nameZh: '人马座矮星系',
    morphology: 'elliptical',
    distanceLy: 70000,
    diameterLy: 10000,
    // 银心另一侧的近距卫星星系；已归一化：0.62²+(−0.55)²+0.56²≈1.0005
    direction: { x: 0.62, y: -0.55, z: 0.56 },
    radialVelocityKmS: 140,
    groupZh: '本星系群（银河系卫星）',
    descriptionZh:
      '最靠近银河系的卫星星系之一（距银心约 5 万光年），正被银河系潮汐撕裂，其恒星流（人马座星流）环绕整个银河系',
    dataSource: NED_SOURCE,
  },
  {
    id: 'm87',
    name: 'Virgo A (M87)',
    nameZh: '室女座A（M87）',
    morphology: 'elliptical',
    distanceLy: 5.4e7,
    diameterLy: 120000,
    // 室女座方向；已归一化：0.1² + 0.86² + 0.5² ≈ 1.000
    direction: { x: 0.1, y: 0.86, z: 0.5 },
    radialVelocityKmS: 1284, // 正值：退行
    groupZh: '室女座星系团',
    descriptionZh:
      '室女座星系团中心的巨椭圆星系，中心超大质量黑洞 M87* 是首张黑洞照片的主角，并喷出数千光年长的相对论喷流',
    dataSource: NED_SOURCE,
  },
] as const;

/** 室女座星系团（本星系群所在的最近大型星系团） */
export const VIRGO_CLUSTER = {
  nameZh: '室女座星系团',
  distanceLy: 5.4e7,
  memberCountNote: '约2000个成员星系',
} as const;

/** 拉尼亚凯亚超星系团（本星系群所属的超星系团，Tully et al. 2014） */
export const LANIAKEA = {
  nameZh: '拉尼亚凯亚超星系团',
  diameterLy: 5.2e8,
  greatAttractorZh: '巨引源',
} as const;

/**
 * 巨引源方向（朝长蛇-半人马座方向的示意单位矢量，近似处理）
 * 已归一化：(−0.72)² + (−0.35)² + 0.60² ≈ 1.001
 */
export const GREAT_ATTRACTOR_DIRECTION: Vec3 = { x: -0.72, y: -0.35, z: 0.6 };

/**
 * 本星系群相对宇宙微波背景（CMB）的运动速度（km/s）
 * 来源：Planck Collaboration CMB 偶极子测量
 */
export const LG_CMB_VELOCITY_KM_S = 620;

/**
 * 卫星星系（LMC/SMC/人马座矮星系）绕银河系的轨道可视化参数
 *
 * R2-10：轨道自 direction × distance 起步（首帧位置与天区方位一致，
 * phase0 移除）；inclinationDeg 为轨道平面姿态参数（0=贴近银道面，
 * 90=极轨道，见 utils/universe.satelliteOrbitBasis）。
 *
 * 近似登记：
 * - LMC/SMC 轨道周期为示意近似（真实轨道为高椭圆且周期尚有较大
 *   不确定性，量级约 15–25 亿年）；
 * - 人马座矮星系取极轨道（真实轨道接近极向，Ibata et al. 1994），
 *   周期约 9 亿年示意（真实估计约 8.5–10 亿年，Law & Majewski 2010）。
 */
export const SATELLITE_GALAXY_ORBITS = {
  lmc: { periodMyr: 1500, inclinationDeg: 35 },
  smc: { periodMyr: 2100, inclinationDeg: 50 },
  'sagittarius-dwarf': { periodMyr: 900, inclinationDeg: 90 },
} as const;

/**
 * M31 伴星系（M32 / M110）相对 M31 中心的示意偏移（光年）
 *
 * 真实投影间距约 1.6–2.6 万光年；此处放大到可在压缩距离下分辨的
 * 示意值（视觉夸大已登记），渲染时随 M31 一同接近银河系。
 */
export const M31_COMPANION_OFFSETS_LY: Record<'m32' | 'm110', Vec3> = {
  m32: { x: 30000, y: -18000, z: 12000 },
  m110: { x: -36000, y: 26000, z: -10000 },
};

/**
 * 麦哲伦星流可视化参数（可选需求 3.1.3）
 *
 * 真实麦哲伦星流为 LMC/SMC 被银河系潮汐剥离的中性氢气体流，
 * 横跨南天约 100°（Nidever et al. 2010）。
 */
export const MAGELLANIC_STREAM = {
  nameZh: '麦哲伦星流',
  /** 采样点数 */
  pointCount: 90,
  /** 确定性种子 */
  seed: 20260725,
  color: '#7fa8c8',
  dataSource: 'Nidever et al. (2010), ApJ；GASS 中性氢巡天',
} as const;

/**
 * 人马座潮汐流可视化参数（R2-10：人马座矮星系"正被潮汐撕裂"的
 * 视觉呼应——沿轨道前后延伸的稀疏星流）
 *
 * 真实人马座星流为被银河系潮汐剥离的恒星流，前导臂+尾随臂环绕
 * 整个银河系（Ibata et al. 2001；Law & Majewski 2010 轨道模型）。
 * 此处沿示意轨道前后各数亿年路径采样（近似登记）；粒子预算 360
 * （需求上限 ≤1,500）。
 */
export const SAGITTARIUS_STREAM = {
  nameZh: '人马座星流',
  /** 采样点数（粒子预算登记：≤1,500） */
  pointCount: 360,
  /** 确定性种子 */
  seed: 20260726,
  /** 老年恒星流暖色调（与麦哲伦星流冷蓝气体区分） */
  color: '#d8bd9a',
  /** 尾随臂回溯时长（百万年） */
  backMyr: 420,
  /** 前导臂前伸时长（百万年） */
  forwardMyr: 260,
  /** 横向弥散比例（潮汐撕裂中，弥散大于麦哲伦星流） */
  jitterFrac: 0.09,
  dataSource: 'Ibata et al. (2001), ApJ；Law & Majewski (2010) 轨道模型',
} as const;

/**
 * L4 星系运动一致性登记（R2-10 通用原则：轨迹线 ↔ 运动同源；
 * 信息面板"运动（模拟）"行逐一说明，宇宙网静止登记见 HelpHint）
 */
export const GALAXY_MOTION_NOTE_ZH: Readonly<Record<string, string>> = {
  m31: '沿接近虚线以约 110 km/s 靠近银河系（虚线上流动光点为进度示意，流速非物理量）',
  m33: '位置静态（其空间运动未建模，属预期）',
  lmc: '沿细线轨道绕银河系运动（圆轨道周期约 15 亿年，示意近似）；麦哲伦星流为历史路径上被潮汐剥离的气体（弥散粒子带，非轨道线）',
  smc: '沿细线轨道绕银河系运动（圆轨道周期约 21 亿年，示意近似）',
  m32: '随 M31 一同接近银河系（示意偏移，属预期）',
  m110: '随 M31 一同接近银河系（示意偏移，属预期）',
  'sagittarius-dwarf':
    '沿极轨道缓慢绕银河系运动（周期约 9 亿年，示意近似）；潮汐流粒子沿轨道前后延伸，呼应"正被潮汐撕裂"',
  m87: '位置静态（星系团尺度运动未建模，属预期）',
};

/**
 * 按 id 查找星系
 */
export function getGalaxyById(id: string): GalaxyData | undefined {
  return LOCAL_GROUP_GALAXIES.find((g) => g.id === id);
}
