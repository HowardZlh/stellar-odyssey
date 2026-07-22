/**
 * 小天体数据：彗星、矮行星（冥王星）、小行星带、柯伊伯带（需求 3.1.1）
 *
 * 数据来源：
 * - 彗星轨道要素：NASA JPL Small-Body Database, https://ssd.jpl.nasa.gov/tools/sbdb_lookup.html
 * - 冥王星轨道要素：NASA JPL Keplerian Elements（同 planets.ts 来源体系）
 * - 主带/柯伊伯带范围：NASA Solar System Exploration（小行星带约 2.2–3.2 AU，
 *   柯伊伯带约 30–50 AU）
 *
 * 关键事实校验点：
 * - 哈雷彗星 e≈0.967，远日点 a(1+e)≈35 AU（海王星轨道外）
 * - 哈雷倾角 162.26° > 90°：逆行轨道，公转方向与行星相反
 * - 冥王星轨道倾角约 17°，与海王星构成约 2:3 轨道共振
 */

import type { BeltConfig, CometData, PlanetData } from '@/types';

const JPL_SBDB_SOURCE = 'NASA JPL Small-Body Database, https://ssd.jpl.nasa.gov/tools/sbdb_lookup.html';

export const COMETS: readonly CometData[] = [
  {
    id: 'halley',
    name: '1P/Halley',
    nameZh: '哈雷彗星',
    nucleusRadiusKm: 5.5,
    color: '#bfe3ef',
    orbit: {
      semiMajorAxisAu: 17.834,
      // 高离心率：近日点约 0.59 AU，远日点约 35 AU（在海王星轨道之外）
      eccentricity: 0.96714,
      // 倾角 162.26° > 90°：逆行轨道，公转方向与八大行星相反！
      inclinationDeg: 162.26,
      longitudeOfAscendingNodeDeg: 58.42,
      argumentOfPerihelionDeg: 111.33,
      // 上次过近日点 1986-02-09，J2000 历元距其约 13.9 年：
      // M₀ ≈ 13.9 / 75.32 × 360° ≈ 66.4°（近似换算，用于可视化）
      meanAnomalyAtEpochDeg: 66.4,
    },
    orbitalPeriodYears: 75.32,
    tailActivationAu: 5,
    massKg: 2.2e14,
    dataSource: JPL_SBDB_SOURCE,
  },
  {
    id: 'encke',
    name: '2P/Encke',
    nameZh: '恩克彗星',
    nucleusRadiusKm: 2.4,
    color: '#cfd8e8',
    orbit: {
      semiMajorAxisAu: 2.215,
      eccentricity: 0.848,
      inclinationDeg: 11.78,
      longitudeOfAscendingNodeDeg: 334.57,
      argumentOfPerihelionDeg: 186.54,
      // 历元相位为近似值，用于可视化（恩克彗星周期短、过近日点频繁）
      meanAnomalyAtEpochDeg: 120,
    },
    // 已知周期最短的彗星（约 3.3 年）
    orbitalPeriodYears: 3.3,
    tailActivationAu: 2,
    dataSource: JPL_SBDB_SOURCE,
  },
] as const;

/**
 * 矮行星冥王星（2006 年 IAU 决议重分类为矮行星）
 *
 * 数据来源：NASA JPL Keplerian Elements / NASA Pluto Fact Sheet
 * - 轨道倾角 17.14°，显著高于八大行星
 * - 与海王星构成约 2:3 轨道共振：247.94 / 164.79 ≈ 1.505
 * - 逆向自转（负周期），自转轴倾角 122.53°
 */
export const PLUTO: PlanetData = {
  id: 'pluto',
  name: 'Pluto',
  nameZh: '冥王星',
  classificationZh: '矮行星',
  radiusKm: 1188.3,
  color: '#c9ad8f',
  orbit: {
    semiMajorAxisAu: 39.48168677,
    eccentricity: 0.24880766,
    // 轨道倾角 17°：远高于八大行星（最高的水星也只有 7°）
    inclinationDeg: 17.14175,
    longitudeOfAscendingNodeDeg: 110.30347,
    argumentOfPerihelionDeg: 224.06676 - 110.30347,
    meanAnomalyAtEpochDeg: 238.92881 - 224.06676,
  },
  // 逆向自转（负周期，约 6.39 天）
  rotation: { siderealPeriodHours: -153.3, axialTiltDeg: 122.53 },
  // 与海王星（164.79 年）构成约 2:3 共振：247.94 / 164.79 ≈ 1.505
  orbitalPeriodYears: 247.94,
  massKg: 1.303e22,
  dataSource: 'NASA JPL Keplerian Elements / NASA Pluto Fact Sheet',
};

/**
 * 其他矮行星（可选需求 3.1.1）：阋神星、鸟神星、妊神星
 *
 * 数据来源：NASA JPL Small-Body Database（轨道要素为历元近似值，用于可视化）
 * - 阋神星质量比冥王星还大（其发现直接导致 2006 年行星重新定义）
 * - 妊神星自转 3.9 小时（太阳系大天体中最快，被甩成椭球形）
 */
export const OTHER_DWARF_PLANETS: readonly PlanetData[] = [
  {
    id: 'eris',
    name: 'Eris',
    nameZh: '阋神星',
    classificationZh: '矮行星',
    radiusKm: 1163,
    color: '#d8d4cc',
    orbit: {
      semiMajorAxisAu: 67.86,
      // 高离心率：近日点约 38 AU，远日点约 97 AU（离散盘天体）
      eccentricity: 0.436,
      // 轨道倾角 44°：远高于冥王星（17°）
      inclinationDeg: 44.04,
      longitudeOfAscendingNodeDeg: 35.95,
      argumentOfPerihelionDeg: 151.64,
      // 历元相位为近似值，用于可视化
      meanAnomalyAtEpochDeg: 205.99,
    },
    rotation: { siderealPeriodHours: 25.9, axialTiltDeg: 78.3 },
    orbitalPeriodYears: 559,
    massKg: 1.66e22,
    dataSource: JPL_SBDB_SOURCE,
  },
  {
    id: 'makemake',
    name: 'Makemake',
    nameZh: '鸟神星',
    classificationZh: '矮行星',
    radiusKm: 715,
    color: '#c9a48a',
    orbit: {
      semiMajorAxisAu: 45.43,
      eccentricity: 0.161,
      inclinationDeg: 28.98,
      longitudeOfAscendingNodeDeg: 79.62,
      argumentOfPerihelionDeg: 294.83,
      // 历元相位为近似值，用于可视化
      meanAnomalyAtEpochDeg: 165.5,
    },
    rotation: { siderealPeriodHours: 22.83, axialTiltDeg: 29 },
    orbitalPeriodYears: 306.2,
    massKg: 3.1e21,
    dataSource: JPL_SBDB_SOURCE,
  },
  {
    id: 'haumea',
    name: 'Haumea',
    nameZh: '妊神星',
    classificationZh: '矮行星',
    // 平均半径（实际为约 2322×1704×1026 km 的椭球，因高速自转被甩扁）
    radiusKm: 816,
    color: '#e2e2e6',
    orbit: {
      semiMajorAxisAu: 43.12,
      eccentricity: 0.195,
      inclinationDeg: 28.21,
      longitudeOfAscendingNodeDeg: 122.16,
      argumentOfPerihelionDeg: 238.78,
      // 历元相位为近似值，用于可视化
      meanAnomalyAtEpochDeg: 218.2,
    },
    // 自转周期 3.92 小时：太阳系大型天体中最快
    rotation: { siderealPeriodHours: 3.915, axialTiltDeg: 126 },
    orbitalPeriodYears: 283.1,
    massKg: 4.01e21,
    dataSource: JPL_SBDB_SOURCE,
  },
] as const;

/** 全部矮行星（冥王星 + 阋神星 + 鸟神星 + 妊神星） */
export const DWARF_PLANETS: readonly PlanetData[] = [PLUTO, ...OTHER_DWARF_PLANETS] as const;

/**
 * 按 id 查找矮行星
 */
export function getDwarfPlanetById(id: string): PlanetData | undefined {
  return DWARF_PLANETS.find((d) => d.id === id);
}

/**
 * 小行星带：位于火星（1.52 AU）与木星（5.20 AU）轨道之间
 * 主带范围约 2.2–3.2 AU，来源：NASA Solar System Exploration – Asteroid Belt
 */
export const ASTEROID_BELT: BeltConfig = {
  id: 'asteroid-belt',
  nameZh: '小行星带',
  innerAu: 2.2,
  outerAu: 3.2,
  count: 6000,
  maxEccentricity: 0.15,
  maxInclinationDeg: 8,
  color: '#8a7f6d',
  colorVariation: 0.4,
  particleSize: 0.35,
  seed: 20260722,
  dataSource:
    'NASA Solar System Exploration – Asteroid Belt（主带范围约 2.2–3.2 AU，位于火星与木星之间）',
};

/**
 * 柯伊伯带：海王星轨道（30.07 AU）以外约 30–50 AU
 *
 * 注意：柯伊伯带空间密度远低于小行星带——其体积比主带大几个量级，
 * 而此处粒子数与主带相近，故单位体积密度远低（视觉上更稀疏、更弥散）。
 */
export const KUIPER_BELT: BeltConfig = {
  id: 'kuiper-belt',
  nameZh: '柯伊伯带',
  innerAu: 30,
  outerAu: 50,
  count: 4500,
  maxEccentricity: 0.1,
  maxInclinationDeg: 10,
  color: '#7d93b5', // 冰质天体的冷色调
  colorVariation: 0.35,
  particleSize: 0.4,
  seed: 20260723,
  dataSource: 'NASA Solar System Exploration – Kuiper Belt（约 30–50 AU，海王星轨道外）',
};

/**
 * 按 id 查找彗星
 */
export function getCometById(id: string): CometData | undefined {
  return COMETS.find((c) => c.id === id);
}
