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
 * 卫星星系（LMC/SMC）绕银河系的轨道可视化参数
 * 注意：轨道周期为示意近似（真实轨道周期尚有较大不确定性，量级约十亿年）
 */
export const SATELLITE_GALAXY_ORBITS = {
  lmc: { periodMyr: 1500, phase0Rad: 0.5, inclinationDeg: 35 },
  smc: { periodMyr: 2100, phase0Rad: 2.4, inclinationDeg: 50 },
} as const;

/**
 * 按 id 查找星系
 */
export function getGalaxyById(id: string): GalaxyData | undefined {
  return LOCAL_GROUP_GALAXIES.find((g) => g.id === id);
}
