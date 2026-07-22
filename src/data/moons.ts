/**
 * 卫星数据（自然卫星 + 人造卫星，需求 3.1.1）
 *
 * 数据来源：
 * - 自然卫星轨道/半径/周期：NASA Planetary Satellite Fact Sheet,
 *   https://nssdc.gsfc.nasa.gov/planetary/factsheet/（各行星卫星分表）
 * - ISS / 哈勃轨道参数：NASA Spot the Station / STScI 公开轨道数据
 *
 * 约定：
 * - meanAnomalyAtEpochDeg / 升交点经度 / 近点幅角为近似值，
 *   仅用于可视化的初始相位分布（历元相位为近似值，用于可视化）。
 * - 参考平面统一为行星赤道面（planetEquator）；月球例外（见下）。
 *
 * 关键事实校验点：
 * - 月球轨道相对黄道面倾角约 5.145°（不是相对地球赤道！）
 * - ISS 轨道高度约 400 km，周期约 92 分钟，倾角 51.6°
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
    noteZh: '轨道高度约 400 km，绕地球一圈约 92 分钟',
    dataSource: 'NASA Spot the Station（轨道高度约 400 km，倾角 51.6°）',
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
    noteZh: '轨道高度约 540 km，1990 年发射的光学空间望远镜',
    dataSource: 'STScI / NASA Hubble 公开轨道数据（高度约 540 km，倾角 28.5°）',
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
