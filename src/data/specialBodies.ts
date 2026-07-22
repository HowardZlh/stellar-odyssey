/**
 * 特殊天体数据（需求 3.1.5）：每个条目基于真实原型天体，
 * 含"静态形态"参数与"动态效果"科学解释。
 *
 * 数据来源：
 * - 参宿四/参宿七/天狼星：NASA/ESA Hipparcos-Gaia 视差与光谱数据
 * - 蟹状星云脉冲星：NASA Chandra/HST（自转周期约 33 ms）
 * - 人马座A*：GRAVITY Collaboration (2019)，质量约 430 万太阳质量
 * - 猎户座星云/环状星云 M57/球状星团 M13：NASA HST 公开观测数据
 * - 3C 273：NED（距离约 24 亿光年，首个被确认的类星体）
 *
 * 近似处理登记（需求 4.1 视觉夸大处理原则）：
 * - sun-relative 天体的 offsetLy 为视觉夸大的示意偏移（真实距离仅数光年至
 *   数千光年，在 L3 尺度 0.05 单位/光年下不可分辨），真实距离在
 *   realDistanceLy 与信息面板中如实标注；
 * - visualRadiusLy 为可视化尺寸，非真实半径；
 * - 特殊天体随太阳一起绕银心共转（近似：太阳邻域恒星与太阳共转）。
 */

import type { SpecialBodyData } from '@/types';

/** 天狼星双星可视化轨道周期（秒，真实约 50 年——按 3.3 速率钳制策略降速显示） */
export const SIRIUS_VISUAL_ORBIT_PERIOD_SEC = 24;

/** 天狼星质量比 mA/mB ≈ 2.06/1.02 */
export const SIRIUS_MASS_RATIO = 2.06 / 1.02;

/** 蟹状脉冲星可视化自转周期（秒，真实 33 ms——降频表现，已登记） */
export const PULSAR_VISUAL_SPIN_PERIOD_SEC = 2.4;

export const SPECIAL_BODIES: readonly SpecialBodyData[] = [
  {
    id: 'betelgeuse',
    name: 'Betelgeuse',
    nameZh: '参宿四',
    kind: 'red-giant',
    typeZh: '红巨星（红超巨星）',
    level: 'L3',
    positionMode: 'sun-relative',
    offsetLy: { x: 2600, y: 450, z: -1900 },
    realDistanceLy: 640,
    visualRadiusLy: 260,
    color: '#ff6a3c',
    factsZh: [
      { label: '表面温度', value: '约 3,500 K（橙红色）' },
      { label: '半径', value: '约太阳 900 倍' },
      { label: '尺度对比', value: '置于太阳位置将吞没火星轨道' },
      { label: '真实距离', value: '约 640 光年' },
    ],
    dynamicsZh:
      '半规则变星：表面亮度缓慢不规则脉动（多个脉动周期叠加），外层有弥散气体壳',
    dataSource: 'NASA/ESA Hipparcos-Gaia；ESO VLT 干涉测量',
  },
  {
    id: 'rigel',
    name: 'Rigel',
    nameZh: '参宿七',
    kind: 'blue-giant',
    typeZh: '蓝超巨星',
    level: 'L3',
    positionMode: 'sun-relative',
    offsetLy: { x: -3200, y: -350, z: 2500 },
    realDistanceLy: 860,
    visualRadiusLy: 190,
    color: '#a9c8ff',
    factsZh: [
      { label: '表面温度', value: '约 12,000 K（蓝白色）' },
      { label: '光度', value: '约太阳 12 万倍' },
      { label: '真实距离', value: '约 860 光年' },
    ],
    dynamicsZh: '高频微闪烁（大气湍动与星风），强光晕与星风粒子外流',
    dataSource: 'NASA/ESA Hipparcos-Gaia 光谱与视差数据',
  },
  {
    id: 'sirius',
    name: 'Sirius A/B',
    nameZh: '天狼星A/B',
    kind: 'binary-white-dwarf',
    typeZh: '双星系统（主序星 + 白矮星）',
    level: 'L3',
    positionMode: 'sun-relative',
    offsetLy: { x: 1300, y: 250, z: 2900 },
    realDistanceLy: 8.6,
    visualRadiusLy: 110,
    color: '#eef4ff',
    factsZh: [
      { label: '天狼星A', value: 'A1V 主序星，约 2.06 太阳质量' },
      { label: '天狼星B', value: '白矮星，约地球大小但质量近太阳（高密度）' },
      { label: '轨道周期', value: '约 50 年（互绕，按时间压缩比降速呈现）' },
      { label: '真实距离', value: '约 8.6 光年（最亮恒星）' },
    ],
    dynamicsZh:
      '白矮星天狼星B与主星天狼星A组成双星系统，绕共同质心互绕运动（质量比约 2:1，白矮星轨道半径更大）',
    dataSource: 'NASA HST 双星轨道测量；Bond et al. (2017)',
  },
  {
    id: 'crab-pulsar',
    name: 'Crab Pulsar / Crab Nebula (M1)',
    nameZh: '蟹状星云脉冲星',
    kind: 'pulsar-remnant',
    typeZh: '中子星/脉冲星（超新星遗迹中心）',
    level: 'L3',
    positionMode: 'sun-relative',
    offsetLy: { x: -4300, y: 550, z: -3100 },
    realDistanceLy: 6500,
    visualRadiusLy: 210,
    color: '#9fd8ff',
    factsZh: [
      { label: '自转周期', value: '约 33 ms（可视化降频表现，已登记）' },
      { label: '前身星', value: '1054 年超新星（SN 1054，宋代天关客星）' },
      { label: '遗迹', value: '蟹状星云：丝状扩张结构' },
      { label: '真实距离', value: '约 6,500 光年' },
    ],
    dynamicsZh:
      '双极射束随中子星自转扫描（灯塔效应），射束扫过视线方向时产生周期性脉冲闪烁；外围为超新星遗迹丝状膨胀星云',
    dataSource: 'NASA Chandra/HST 蟹状星云观测；Lyne & Graham-Smith, Pulsar Astronomy',
  },
  {
    id: 'sgr-a-star',
    name: 'Sagittarius A*',
    nameZh: '人马座A*',
    kind: 'black-hole',
    typeZh: '超大质量黑洞（银心）',
    level: 'L3',
    positionMode: 'galactic-center',
    realDistanceLy: 26000,
    visualRadiusLy: 300,
    color: '#ffb36b',
    factsZh: [
      { label: '质量', value: '约 430 万太阳质量' },
      { label: '位置', value: '银河系中心（距太阳约 2.6 万光年）' },
      { label: '事件视界', value: '纯黑球体（光无法逃逸）' },
      { label: '吸积盘', value: '发光气体环，内圈快外圈慢（较差旋转）' },
    ],
    dynamicsZh:
      '吸积盘按开普勒较差旋转（角速度 ∝ r^-3/2，内圈快外圈慢），接近侧因多普勒集束增亮；背景星光绕事件视界弯曲形成引力透镜环状扭曲（shader 实现）',
    dataSource: 'GRAVITY Collaboration (2019)；EHT 2022 人马座A* 成像',
  },
  {
    id: 'orion-nebula',
    name: 'Orion Nebula (M42)',
    nameZh: '猎户座星云',
    kind: 'emission-nebula',
    typeZh: '发射星云',
    level: 'L3',
    positionMode: 'sun-relative',
    offsetLy: { x: 3700, y: -250, z: 1600 },
    realDistanceLy: 1350,
    visualRadiusLy: 240,
    color: '#ff9bb5',
    factsZh: [
      { label: '颜色', value: '粉红/红色（氢α发射线）' },
      { label: '直径', value: '约 24 光年' },
      { label: '真实距离', value: '约 1,350 光年' },
      { label: '内部', value: '猎户四边形星团等年轻恒星点亮局部' },
    ],
    dynamicsZh: '内部年轻大质量恒星的紫外辐射电离氢气发出氢α红光，雾状气体缓慢流动',
    dataSource: 'NASA HST 猎户座星云观测（M42）',
  },
  {
    id: 'ring-nebula',
    name: 'Ring Nebula (M57)',
    nameZh: '环状星云',
    kind: 'planetary-nebula',
    typeZh: '行星状星云',
    level: 'L3',
    positionMode: 'sun-relative',
    offsetLy: { x: -1600, y: 850, z: 3700 },
    realDistanceLy: 2300,
    visualRadiusLy: 150,
    color: '#7fe8d8',
    factsZh: [
      { label: '结构', value: '环壳状抛射气体 + 中心白矮星' },
      { label: '膨胀速度', value: '约 20–30 km/s（缓慢膨胀）' },
      { label: '真实距离', value: '约 2,300 光年' },
    ],
    dynamicsZh:
      '类太阳恒星晚年抛出外层气体形成环壳，中心残留白矮星；壳层持续缓慢膨胀（动画为艺术化加速）',
    dataSource: 'NASA HST 环状星云观测（M57）',
  },
  {
    id: 'm13-cluster',
    name: 'Great Hercules Cluster (M13)',
    nameZh: '武仙座球状星团',
    kind: 'globular-cluster',
    typeZh: '球状星团（银晕）',
    level: 'L3',
    positionMode: 'sun-relative',
    offsetLy: { x: -2100, y: 6200, z: -5200 },
    realDistanceLy: 22200,
    visualRadiusLy: 320,
    color: '#ffd9a0',
    factsZh: [
      { label: '成员', value: '数十万颗老年恒星（偏红黄色调）' },
      { label: '位置', value: '银晕中（银盘面外）' },
      { label: '真实距离', value: '约 22,200 光年' },
    ],
    dynamicsZh: '致密球状的老年恒星集团，绕银河系中心长周期运行',
    dataSource: 'NASA HST 球状星团 M13 观测',
  },
  {
    id: 'quasar-3c273',
    name: '3C 273',
    nameZh: '类星体 3C 273',
    kind: 'quasar',
    typeZh: '类星体（活动星系核）',
    level: 'L4',
    positionMode: 'extragalactic',
    // 已归一化：0.3² + 0.75² + 0.59² ≈ 1.00
    direction: { x: 0.3, y: 0.75, z: 0.59 },
    realDistanceLy: 2.4e9,
    visualRadiusLy: 0,
    color: '#cfe8ff',
    factsZh: [
      { label: '距离', value: '约 24 亿光年（首个被确认的类星体）' },
      { label: '光度', value: '约银河系的 100 倍以上' },
      { label: '喷流', value: '相对论喷流长数十万光年' },
    ],
    dynamicsZh:
      '中心超大质量黑洞吸积产生极亮核心与双向相对论喷流（含流动动画），亮度不规则光变闪烁',
    dataSource: 'NASA/IPAC Extragalactic Database (NED)；Schmidt (1963)',
  },
] as const;

/**
 * 按 id 查找特殊天体
 */
export function getSpecialBodyById(id: string): SpecialBodyData | undefined {
  return SPECIAL_BODIES.find((b) => b.id === id);
}
