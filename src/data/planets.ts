/**
 * 八大行星真实数据（J2000 历元）
 *
 * 数据来源：
 * - 轨道六要素：E.M. Standish, "Keplerian Elements for Approximate Positions of
 *   the Major Planets", NASA JPL, https://ssd.jpl.nasa.gov/planets/approx_pos.html
 *   （表中给出 a, e, i, L, ϖ, Ω；此处换算 ω = ϖ − Ω，M₀ = L − ϖ）
 * - 自转周期/轴倾角/半径：NASA Planetary Fact Sheet,
 *   https://nssdc.gsfc.nasa.gov/planetary/factsheet/
 *
 * 关键事实校验点：
 * - 金星自转周期 −5832.5 小时（约 243 天，逆向，比公转周期 224.7 天还长）
 * - 天王星轴倾角 97.77°（侧躺）
 * - 木星自转最快（约 9.925 小时）
 * - 地球轴倾角 23.44°
 */

import type { PlanetData } from '@/types';

const JPL_SOURCE = 'NASA JPL Keplerian Elements (J2000) / NASA Planetary Fact Sheet';

export const PLANETS: readonly PlanetData[] = [
  {
    id: 'mercury',
    name: 'Mercury',
    nameZh: '水星',
    radiusKm: 2439.7,
    color: '#9c8e82',
    orbit: {
      semiMajorAxisAu: 0.38709893,
      eccentricity: 0.20563069,
      inclinationDeg: 7.00487,
      longitudeOfAscendingNodeDeg: 48.33167,
      argumentOfPerihelionDeg: 77.45645 - 48.33167,
      meanAnomalyAtEpochDeg: 252.25084 - 77.45645,
    },
    rotation: { siderealPeriodHours: 1407.6, axialTiltDeg: 0.034 },
    orbitalPeriodYears: 0.2408,
    dataSource: JPL_SOURCE,
  },
  {
    id: 'venus',
    name: 'Venus',
    nameZh: '金星',
    radiusKm: 6051.8,
    color: '#e8cda2',
    orbit: {
      semiMajorAxisAu: 0.72333199,
      eccentricity: 0.00677323,
      inclinationDeg: 3.39471,
      longitudeOfAscendingNodeDeg: 76.68069,
      argumentOfPerihelionDeg: 131.53298 - 76.68069,
      meanAnomalyAtEpochDeg: 181.97973 - 131.53298,
    },
    // 金星逆向自转（负周期），周期约 243 天，是唯一"日出于西"的行星
    rotation: { siderealPeriodHours: -5832.5, axialTiltDeg: 177.36 },
    orbitalPeriodYears: 0.6152,
    // 浓厚二氧化碳大气的淡黄色辉光
    surface: { hasAtmosphereGlow: true, atmosphereColor: '#e6d4a8' },
    dataSource: JPL_SOURCE,
  },
  {
    id: 'earth',
    name: 'Earth',
    nameZh: '地球',
    radiusKm: 6371.0,
    color: '#4d7fbe',
    orbit: {
      semiMajorAxisAu: 1.00000011,
      eccentricity: 0.01671022,
      inclinationDeg: 0.00005,
      longitudeOfAscendingNodeDeg: -11.26064,
      argumentOfPerihelionDeg: 102.94719 - -11.26064,
      meanAnomalyAtEpochDeg: 100.46435 - 102.94719,
    },
    rotation: { siderealPeriodHours: 23.9345, axialTiltDeg: 23.44 },
    orbitalPeriodYears: 1.0,
    // 大陆海洋/云层/大气辉光（需求 3.1.1）
    surface: { hasCloudLayer: true, hasAtmosphereGlow: true, atmosphereColor: '#6ab7ff' },
    dataSource: JPL_SOURCE,
  },
  {
    id: 'mars',
    name: 'Mars',
    nameZh: '火星',
    radiusKm: 3389.5,
    color: '#c1572f',
    orbit: {
      semiMajorAxisAu: 1.52366231,
      eccentricity: 0.09341233,
      inclinationDeg: 1.85061,
      longitudeOfAscendingNodeDeg: 49.57854,
      argumentOfPerihelionDeg: 336.04084 - 49.57854,
      meanAnomalyAtEpochDeg: 355.45332 - 336.04084,
    },
    rotation: { siderealPeriodHours: 24.6229, axialTiltDeg: 25.19 },
    orbitalPeriodYears: 1.8808,
    // 稀薄大气的微弱红色辉光
    surface: { hasAtmosphereGlow: true, atmosphereColor: '#d9a08a' },
    dataSource: JPL_SOURCE,
  },
  {
    id: 'jupiter',
    name: 'Jupiter',
    nameZh: '木星',
    radiusKm: 69911,
    color: '#c9a37c',
    orbit: {
      semiMajorAxisAu: 5.20336301,
      eccentricity: 0.04839266,
      inclinationDeg: 1.3053,
      longitudeOfAscendingNodeDeg: 100.55615,
      argumentOfPerihelionDeg: 14.75385 - 100.55615,
      meanAnomalyAtEpochDeg: 34.40438 - 14.75385,
    },
    // 木星自转最快：约 9.925 小时
    rotation: { siderealPeriodHours: 9.925, axialTiltDeg: 3.13 },
    orbitalPeriodYears: 11.862,
    dataSource: JPL_SOURCE,
  },
  {
    id: 'saturn',
    name: 'Saturn',
    nameZh: '土星',
    radiusKm: 58232,
    color: '#d8c193',
    orbit: {
      semiMajorAxisAu: 9.53707032,
      eccentricity: 0.0541506,
      inclinationDeg: 2.48446,
      longitudeOfAscendingNodeDeg: 113.71504,
      argumentOfPerihelionDeg: 92.43194 - 113.71504,
      meanAnomalyAtEpochDeg: 49.94432 - 92.43194,
    },
    rotation: { siderealPeriodHours: 10.656, axialTiltDeg: 26.73 },
    orbitalPeriodYears: 29.457,
    // 土星主环：C 环内缘（74,500 km）至 F 环（140,220 km），
    // 卡西尼缝位于约 117,500 km；来源：NASA Saturn Fact Sheet
    ring: {
      innerRadiusKm: 74500,
      outerRadiusKm: 140220,
      gapCenter01: 0.65,
      gapWidth01: 0.05,
      color: '#d6c49a',
      opacity: 0.85,
    },
    dataSource: JPL_SOURCE,
  },
  {
    id: 'uranus',
    name: 'Uranus',
    nameZh: '天王星',
    radiusKm: 25362,
    color: '#9bd4d9',
    orbit: {
      semiMajorAxisAu: 19.19126393,
      eccentricity: 0.04716771,
      inclinationDeg: 0.76986,
      longitudeOfAscendingNodeDeg: 74.22988,
      argumentOfPerihelionDeg: 170.96424 - 74.22988,
      meanAnomalyAtEpochDeg: 313.23218 - 170.96424,
    },
    // 天王星侧躺（轴倾角 97.77°）且逆向自转
    rotation: { siderealPeriodHours: -17.24, axialTiltDeg: 97.77 },
    orbitalPeriodYears: 84.011,
    dataSource: JPL_SOURCE,
  },
  {
    id: 'neptune',
    name: 'Neptune',
    nameZh: '海王星',
    radiusKm: 24622,
    color: '#4666e0',
    orbit: {
      semiMajorAxisAu: 30.06896348,
      eccentricity: 0.00858587,
      inclinationDeg: 1.76917,
      longitudeOfAscendingNodeDeg: 131.72169,
      argumentOfPerihelionDeg: 44.97135 - 131.72169,
      meanAnomalyAtEpochDeg: 304.88003 - 44.97135,
    },
    rotation: { siderealPeriodHours: 16.11, axialTiltDeg: 28.32 },
    orbitalPeriodYears: 164.79,
    dataSource: JPL_SOURCE,
  },
] as const;

/** 太阳参数，来源：NASA Sun Fact Sheet */
export const SUN = {
  id: 'sun',
  name: 'Sun',
  nameZh: '太阳',
  radiusKm: 695700,
  color: '#ffcc55',
  dataSource: 'NASA Sun Fact Sheet, https://nssdc.gsfc.nasa.gov/planetary/factsheet/sunfact.html',
} as const;

/**
 * 按 id 查找行星
 */
export function getPlanetById(id: string): PlanetData | undefined {
  return PLANETS.find((p) => p.id === id);
}
