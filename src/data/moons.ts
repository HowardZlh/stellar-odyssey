/**
 * 卫星数据（自然卫星 + 人造卫星，需求 3.1.1）
 *
 * 数据来源：
 * - 自然卫星轨道/半径/周期：NASA Planetary Satellite Fact Sheet,
 *   https://nssdc.gsfc.nasa.gov/planetary/factsheet/（各行星卫星分表）
 * - ISS / 哈勃轨道参数：NASA Spot the Station / STScI 公开轨道数据
 * - 天宫空间站轨道参数：中国载人航天工程办公室（CMSA）公开数据 / CelesTrak TLE
 *   （轨道高度约 390 km、倾角 41.5°、周期约 92.2 分钟，三舱组合体约 100 t）
 *
 * 约定：
 * - meanAnomalyAtEpochDeg / 升交点经度 / 近点幅角为近似值，
 *   仅用于可视化的初始相位分布（历元相位为近似值，用于可视化）。
 * - 参考平面统一为行星赤道面（planetEquator）；月球例外（见下）。
 * - 人造卫星 spanMeters 为真实特征尺寸（米），用于 P7 差异化视觉尺寸映射
 *   （ISS 109 m > 天宫约 55 m > TDRS 帆板翼展约 21 m > 哈勃 13.2 m）。
 *
 * 关键事实校验点：
 * - 月球轨道相对黄道面倾角约 5.145°（不是相对地球赤道！）
 * - ISS 轨道高度约 400 km，周期约 92 分钟，倾角 51.6°
 * - 天宫轨道高度约 390 km（略低于 ISS），倾角 41.5°（低于 ISS 的 51.6°）
 * - 伽利略卫星 io:europa:ganymede 轨道共振 1:2:4
 */

import type { MoonData } from '@/types';

const NASA_SATELLITE_SOURCE =
  'NASA Planetary Satellite Fact Sheet, https://nssdc.gsfc.nasa.gov/planetary/factsheet/';

export const MOONS: readonly MoonData[] = [
  {
    id: 'moon',
    name: 'Moon',
    nameZh: '月球',
    parentId: 'earth',
    kind: 'natural',
    radiusKm: 1737.4,
    color: '#b8b4a9',
    orbit: {
      semiMajorAxisKm: 384400,
      eccentricity: 0.0549,
      // 相对黄道面约 5.145°——月球是参考平面的例外：
      // 不得画成与黄道共面，否则会错误暗示每个月都发生日食/月食
      inclinationDeg: 5.145,
      // 以下三项为 J2000 附近的近似平均值（月球节点/近地点进动很快），
      // 历元相位为近似值，用于可视化
      longitudeOfAscendingNodeDeg: 125.08,
      argumentOfPeriapsisDeg: 318.15,
      meanAnomalyAtEpochDeg: 135.27,
      periodDays: 27.321661,
    },
    referencePlane: 'ecliptic',
    massKg: 7.342e22,
    tidallyLocked: true,
    noteZh: '潮汐锁定，始终以同一面朝向地球；表面布满撞击环形山',
    dataSource: NASA_SATELLITE_SOURCE,
  },
  {
    id: 'iss',
    name: 'ISS',
    nameZh: '国际空间站',
    parentId: 'earth',
    kind: 'artificial',
    // 实际尺寸约 109 m（桁架跨度），此处为可视化示意尺寸
    radiusKm: 0.055,
    color: '#cdd3dd',
    orbit: {
      // 地球半径 6371 km + 轨道高度约 417 km
      semiMajorAxisKm: 6371 + 417,
      eccentricity: 0.0004,
      inclinationDeg: 51.6,
      // 历元相位为近似值，用于可视化（ISS 轨道面进动快，精确星历无必要）
      longitudeOfAscendingNodeDeg: 0,
      argumentOfPeriapsisDeg: 0,
      meanAnomalyAtEpochDeg: 0,
      periodDays: 0.0645, // 约 92.9 分钟
    },
    referencePlane: 'planetEquator',
    massKg: 4.5e5,
    spanMeters: 109,
    noteZh: '轨道高度约 400 km，绕地球一圈约 92 分钟；主桁架长 109 m，装有 8 组太阳能帆板',
    dataSource: 'NASA Spot the Station（轨道高度约 400 km，倾角 51.6°）',
  },
  {
    id: 'tiangong',
    name: 'Tiangong Space Station',
    nameZh: '天宫空间站',
    parentId: 'earth',
    kind: 'artificial',
    // 实际最大跨度约 55 m（三舱 T 字构型 + 柔性太阳翼），此处为可视化示意尺寸
    radiusKm: 0.0275,
    color: '#d9d4c8',
    orbit: {
      // 地球半径 6371 km + 轨道高度约 390 km（略低于 ISS 的 417 km）
      semiMajorAxisKm: 6371 + 390,
      eccentricity: 0.0003,
      inclinationDeg: 41.5,
      // 历元相位为近似值，用于可视化（与 ISS 错开初始相位便于区分）
      longitudeOfAscendingNodeDeg: 200,
      argumentOfPeriapsisDeg: 0,
      meanAnomalyAtEpochDeg: 90,
      periodDays: 0.06403, // 约 92.2 分钟
    },
    referencePlane: 'planetEquator',
    massKg: 1.0e5,
    spanMeters: 55,
    noteZh:
      '中国载人空间站，2022 年三舱构型建成：天和核心舱 + 问天/梦天实验舱组成 T 字构型，配柔性太阳翼',
    dataSource: '中国载人航天工程办公室（CMSA）公开数据 / CelesTrak TLE（高度约 390 km，倾角 41.5°）',
  },
  {
    id: 'hubble',
    name: 'Hubble Space Telescope',
    nameZh: '哈勃太空望远镜',
    parentId: 'earth',
    kind: 'artificial',
    // 实际长度约 13.2 m，此处为可视化示意尺寸
    radiusKm: 0.0066,
    color: '#c8c2b8',
    orbit: {
      // 地球半径 6371 km + 轨道高度约 540 km
      semiMajorAxisKm: 6911,
      eccentricity: 0.0003,
      inclinationDeg: 28.5,
      // 历元相位为近似值，用于可视化
      longitudeOfAscendingNodeDeg: 80,
      argumentOfPeriapsisDeg: 0,
      meanAnomalyAtEpochDeg: 180,
      periodDays: 0.0663, // 约 95.4 分钟
    },
    referencePlane: 'planetEquator',
    massKg: 1.11e4,
    spanMeters: 13.2,
    noteZh: '轨道高度约 540 km，1990 年发射的光学空间望远镜；镜筒长 13.2 m，主镜口径 2.4 m',
    dataSource: 'STScI / NASA Hubble 公开轨道数据（高度约 540 km，倾角 28.5°）',
  },
  {
    id: 'geo-satellite',
    name: 'Geostationary Satellite (schematic)',
    nameZh: '地球静止轨道卫星（示意）',
    parentId: 'earth',
    kind: 'artificial',
    // 通信卫星实际尺寸约数米至数十米，此处为可视化示意尺寸
    radiusKm: 0.03,
    color: '#e8d8a8',
    orbit: {
      // 静止轨道半径 42,164 km（高度约 35,786 km），周期 = 恒星日
      semiMajorAxisKm: 42164,
      eccentricity: 0,
      // 静止轨道位于赤道面（倾角 0）
      inclinationDeg: 0,
      longitudeOfAscendingNodeDeg: 0,
      argumentOfPeriapsisDeg: 0,
      meanAnomalyAtEpochDeg: 120,
      // 恒星日 23.934 小时 = 0.99727 天（与地球自转同步）
      periodDays: 0.99727,
    },
    referencePlane: 'planetEquator',
    massKg: 3.5e3,
    spanMeters: 21,
    noteZh:
      '轨道周期与地球自转周期相同（恒星日），相对地面静止；以 NASA TDRS（跟踪与数据中继卫星，帆板翼展约 21 m、抛物面天线）为原型的静止轨道通信卫星示意',
    dataSource: 'ITU / NASA TDRS 静止轨道定义（半径 42,164 km，周期 23.934 小时）',
  },
  // ---- 火星卫星（可选需求 3.1.1） ----
  {
    id: 'phobos',
    name: 'Phobos',
    nameZh: '火卫一（福波斯）',
    parentId: 'mars',
    kind: 'natural',
    radiusKm: 11.1,
    color: '#8f7f70',
    orbit: {
      semiMajorAxisKm: 9376,
      eccentricity: 0.0151,
      inclinationDeg: 1.08,
      // 历元相位为近似值，用于可视化
      longitudeOfAscendingNodeDeg: 0,
      argumentOfPeriapsisDeg: 0,
      meanAnomalyAtEpochDeg: 40,
      // 公转周期 7.65 小时——比火星自转还快，从火星表面看"西升东落"
      periodDays: 0.31891,
    },
    referencePlane: 'planetEquator',
    tidallyLocked: true,
    massKg: 1.06e16,
    noteZh: '公转周期（7.65 小时）比火星自转还快；轨道正缓慢衰减，预计数千万年后解体或撞击火星',
    dataSource: NASA_SATELLITE_SOURCE,
  },
  {
    id: 'deimos',
    name: 'Deimos',
    nameZh: '火卫二（得摩斯）',
    parentId: 'mars',
    kind: 'natural',
    radiusKm: 6.2,
    color: '#9a8c7d',
    orbit: {
      semiMajorAxisKm: 23463,
      eccentricity: 0.00033,
      inclinationDeg: 1.79,
      // 历元相位为近似值，用于可视化
      longitudeOfAscendingNodeDeg: 0,
      argumentOfPeriapsisDeg: 0,
      meanAnomalyAtEpochDeg: 220,
      periodDays: 1.2624,
    },
    referencePlane: 'planetEquator',
    tidallyLocked: true,
    massKg: 1.51e15,
    noteZh: '太阳系最小的卫星之一，表面覆盖细粉尘（风化层）',
    dataSource: NASA_SATELLITE_SOURCE,
  },
  // ---- 土星卫星补充（可选需求 3.1.1：土卫一、土卫五） ----
  {
    id: 'mimas',
    name: 'Mimas',
    nameZh: '土卫一（弥玛斯）',
    parentId: 'saturn',
    kind: 'natural',
    radiusKm: 198.2,
    color: '#cfd2d6',
    orbit: {
      semiMajorAxisKm: 185540,
      eccentricity: 0.0196,
      inclinationDeg: 1.57,
      // 历元相位为近似值，用于可视化
      longitudeOfAscendingNodeDeg: 0,
      argumentOfPeriapsisDeg: 0,
      meanAnomalyAtEpochDeg: 300,
      periodDays: 0.942422,
    },
    referencePlane: 'planetEquator',
    tidallyLocked: true,
    massKg: 3.75e19,
    noteZh: '巨大的赫歇尔撞击坑使其形似"死星"；与卡西尼缝内粒子构成 2:1 共振（清空缝隙）',
    dataSource: NASA_SATELLITE_SOURCE,
  },
  {
    id: 'rhea',
    name: 'Rhea',
    nameZh: '土卫五（瑞亚）',
    parentId: 'saturn',
    kind: 'natural',
    radiusKm: 763.8,
    color: '#c8c4bc',
    orbit: {
      semiMajorAxisKm: 527070,
      eccentricity: 0.0012,
      inclinationDeg: 0.35,
      // 历元相位为近似值，用于可视化
      longitudeOfAscendingNodeDeg: 0,
      argumentOfPeriapsisDeg: 0,
      meanAnomalyAtEpochDeg: 130,
      periodDays: 4.518212,
    },
    referencePlane: 'planetEquator',
    tidallyLocked: true,
    massKg: 2.31e21,
    noteZh: '土星第二大卫星，冰质表面布满撞击坑',
    dataSource: NASA_SATELLITE_SOURCE,
  },
  // ---- 海王星卫星（可选需求 3.1.1：海卫一逆行轨道） ----
  {
    id: 'triton',
    name: 'Triton',
    nameZh: '海卫一（特里同）',
    parentId: 'neptune',
    kind: 'natural',
    radiusKm: 1353.4,
    color: '#d8c8be',
    orbit: {
      semiMajorAxisKm: 354760,
      eccentricity: 0.000016,
      // 倾角 156.9° > 90°：逆行轨道！太阳系唯一逆行的大型卫星，
      // 被认为是海王星俘获的柯伊伯带天体
      inclinationDeg: 156.9,
      // 历元相位为近似值，用于可视化
      longitudeOfAscendingNodeDeg: 0,
      argumentOfPeriapsisDeg: 0,
      meanAnomalyAtEpochDeg: 80,
      periodDays: 5.876854,
    },
    referencePlane: 'planetEquator',
    tidallyLocked: true,
    massKg: 2.14e22,
    noteZh: '太阳系唯一逆行公转的大型卫星（倾角 156.9°），可能是被俘获的柯伊伯带天体；表面有氮冰间歇泉',
    dataSource: NASA_SATELLITE_SOURCE,
  },
  // ---- 冥王星卫星（P5 §3.4 可选项：冥卫一卡戎） ----
  {
    id: 'charon',
    name: 'Charon',
    nameZh: '冥卫一（卡戎）',
    parentId: 'pluto',
    kind: 'natural',
    radiusKm: 606,
    color: '#b3a89c',
    orbit: {
      semiMajorAxisKm: 19591,
      eccentricity: 0.0002,
      // 相对冥王星赤道面近共面（冥王星-卡戎系统高度规整）
      inclinationDeg: 0.08,
      // 历元相位为近似值，用于可视化
      longitudeOfAscendingNodeDeg: 0,
      argumentOfPeriapsisDeg: 0,
      meanAnomalyAtEpochDeg: 0,
      // 公转周期 6.387 天 = 冥王星自转周期（双向潮汐锁定）
      periodDays: 6.3872,
    },
    referencePlane: 'planetEquator',
    massKg: 1.586e21,
    tidallyLocked: true,
    noteZh:
      '冥王星-卡戎双矮行星系统：双向潮汐锁定（冥王星也始终以同一面朝向卡戎），共同质心位于冥王星体外',
    dataSource: 'NASA New Horizons / NASA Planetary Satellite Fact Sheet（半径 606 km，公转 6.39 天）',
  },
  // ---- 伽利略四卫星（木星）：io:europa:ganymede 轨道共振 1:2:4 ----
  {
    id: 'io',
    name: 'Io',
    nameZh: '木卫一（伊奥）',
    parentId: 'jupiter',
    kind: 'natural',
    radiusKm: 1821.6,
    color: '#d9b13f', // 硫磺黄（活火山喷发的硫化物覆盖表面）
    orbit: {
      semiMajorAxisKm: 421800,
      eccentricity: 0.0041,
      inclinationDeg: 0.036,
      // 历元相位为近似值，用于可视化
      longitudeOfAscendingNodeDeg: 0,
      argumentOfPeriapsisDeg: 0,
      meanAnomalyAtEpochDeg: 0,
      periodDays: 1.769138,
    },
    referencePlane: 'planetEquator',
    massKg: 8.932e22,
    tidallyLocked: true,
    noteZh: '太阳系火山活动最剧烈的天体；与木卫二、木卫三构成 1:2:4 轨道共振',
    dataSource: NASA_SATELLITE_SOURCE,
  },
  {
    id: 'europa',
    name: 'Europa',
    nameZh: '木卫二（欧罗巴）',
    parentId: 'jupiter',
    kind: 'natural',
    radiusKm: 1560.8,
    color: '#c9b696',
    orbit: {
      semiMajorAxisKm: 671100,
      eccentricity: 0.0094,
      inclinationDeg: 0.466,
      // 历元相位为近似值，用于可视化
      longitudeOfAscendingNodeDeg: 0,
      argumentOfPeriapsisDeg: 0,
      meanAnomalyAtEpochDeg: 90,
      periodDays: 3.551181,
    },
    referencePlane: 'planetEquator',
    massKg: 4.8e22,
    tidallyLocked: true,
    noteZh: '冰壳下有全球性液态水海洋；与木卫一、木卫三构成 1:2:4 轨道共振',
    dataSource: NASA_SATELLITE_SOURCE,
  },
  {
    id: 'ganymede',
    name: 'Ganymede',
    nameZh: '木卫三（盖尼米得）',
    parentId: 'jupiter',
    kind: 'natural',
    radiusKm: 2634.1, // 太阳系最大卫星，比水星（2439.7 km）还大
    color: '#9a8d7b',
    orbit: {
      semiMajorAxisKm: 1070400,
      eccentricity: 0.0013,
      inclinationDeg: 0.177,
      // 历元相位为近似值，用于可视化
      longitudeOfAscendingNodeDeg: 0,
      argumentOfPeriapsisDeg: 0,
      meanAnomalyAtEpochDeg: 180,
      periodDays: 7.154553,
    },
    referencePlane: 'planetEquator',
    massKg: 1.482e23,
    tidallyLocked: true,
    noteZh: '太阳系最大卫星；与木卫一、木卫二构成 1:2:4 轨道共振',
    dataSource: NASA_SATELLITE_SOURCE,
  },
  {
    id: 'callisto',
    name: 'Callisto',
    nameZh: '木卫四（卡里斯托）',
    parentId: 'jupiter',
    kind: 'natural',
    radiusKm: 2410.3,
    color: '#77695a',
    orbit: {
      semiMajorAxisKm: 1882700,
      eccentricity: 0.0074,
      inclinationDeg: 0.192,
      // 历元相位为近似值，用于可视化
      longitudeOfAscendingNodeDeg: 0,
      argumentOfPeriapsisDeg: 0,
      meanAnomalyAtEpochDeg: 270,
      periodDays: 16.689017,
    },
    referencePlane: 'planetEquator',
    massKg: 1.076e23,
    tidallyLocked: true,
    noteZh: '表面撞击坑密度极高，是太阳系最古老的地表之一（未参与 1:2:4 共振）',
    dataSource: NASA_SATELLITE_SOURCE,
  },
  // ---- 土星卫星 ----
  {
    id: 'titan',
    name: 'Titan',
    nameZh: '土卫六（泰坦）',
    parentId: 'saturn',
    kind: 'natural',
    radiusKm: 2574.7,
    color: '#d79a3c',
    orbit: {
      semiMajorAxisKm: 1221870,
      eccentricity: 0.0288,
      inclinationDeg: 0.28,
      // 历元相位为近似值，用于可视化
      longitudeOfAscendingNodeDeg: 0,
      argumentOfPeriapsisDeg: 0,
      meanAnomalyAtEpochDeg: 45,
      periodDays: 15.945421,
    },
    referencePlane: 'planetEquator',
    massKg: 1.345e23,
    tidallyLocked: true,
    noteZh: '拥有橙色浓厚氮基大气，是太阳系唯一有浓密大气的卫星',
    dataSource: NASA_SATELLITE_SOURCE,
  },
  {
    id: 'enceladus',
    name: 'Enceladus',
    nameZh: '土卫二（恩克拉多斯）',
    parentId: 'saturn',
    kind: 'natural',
    radiusKm: 252.1,
    color: '#eff3f6',
    orbit: {
      semiMajorAxisKm: 238040,
      eccentricity: 0.0047,
      inclinationDeg: 0.009,
      // 历元相位为近似值，用于可视化
      longitudeOfAscendingNodeDeg: 0,
      argumentOfPeriapsisDeg: 0,
      meanAnomalyAtEpochDeg: 200,
      periodDays: 1.370218,
    },
    referencePlane: 'planetEquator',
    massKg: 1.08e20,
    tidallyLocked: true,
    noteZh: '高反照率冰面（太阳系反照率最高的天体之一），南极有冰羽喷泉',
    dataSource: NASA_SATELLITE_SOURCE,
  },
] as const;

/**
 * 按所属行星 id 查找卫星列表
 */
export function getMoonsByParent(parentId: string): MoonData[] {
  return MOONS.filter((m) => m.parentId === parentId);
}

/**
 * 按 id 查找卫星
 */
export function getMoonById(id: string): MoonData | undefined {
  return MOONS.find((m) => m.id === id);
}
