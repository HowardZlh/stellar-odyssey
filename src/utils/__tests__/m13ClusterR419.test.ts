/**
 * R4-19 M13 球状星团 King 分布 + HR 图颜色 单元测试
 *
 * 覆盖：King 三维密度单调递减/边界、64 点逆 CDF 反查表（单调性/端点/
 * 半质量半径锚定）、采样插值、HR 两档 Teff 采样、属性构建（确定性/
 * 蓝星比例/径向壳层密度单调递减/数值域）。
 */

import {
  KING_TABLE_POINTS,
  M13_BASE_STAR_COUNT,
  M13_BLUE_FRACTION,
  M13_BLUE_TEFF_MAX_K,
  M13_BLUE_TEFF_MIN_K,
  M13_NEAR_STAR_COUNT,
  M13_RED_TEFF_MAX_K,
  M13_RED_TEFF_MIN_K,
  buildKingRadiusTable01,
  buildM13ClusterAttributes,
  kingDensity3D,
  kingHalfMassRadius01,
  kingShapeFromProfile,
  m13StarTeffK,
  sampleKingRadius01,
} from '@/utils/m13Cluster';
import type { M13Profile } from '@/utils/bakedData';

/** M13（NGC 6205，Harris 目录）核/潮汐半径比：1.28 pc / 43.4 pc */
const M13_RC_OVER_RT = 1.28 / 43.4;

const M13_PROFILE: M13Profile = {
  id: 'NGC 6205',
  nameZh: 'M13 武仙座球状星团',
  coreRadiusArcmin: 0.62,
  halfLightRadiusArcmin: 1.69,
  tidalRadiusArcmin: 21.01,
  concentration: 1.53,
  distanceKpc: 7.1,
  integratedVMag: 5.78,
  metallicityFeH: -1.53,
  coreRadiusPc: 1.28,
  tidalRadiusPc: 43.4,
};

describe('kingDensity3D', () => {
  it('径向密度严格单调递减（M13 参数，0 → r_t 均匀网格）', () => {
    let prev = Number.POSITIVE_INFINITY;
    for (let i = 0; i < 200; i += 1) {
      const r = i / 200;
      const rho = kingDensity3D(r, M13_RC_OVER_RT);
      expect(rho).toBeGreaterThan(0);
      expect(rho).toBeLessThan(prev);
      prev = rho;
    }
  });

  it('潮汐半径处截断为 0（r ≥ r_t 与负半径均为 0）', () => {
    expect(kingDensity3D(1, M13_RC_OVER_RT)).toBe(0);
    expect(kingDensity3D(1.5, M13_RC_OVER_RT)).toBe(0);
    expect(kingDensity3D(-0.1, M13_RC_OVER_RT)).toBe(0);
    // 逼近 r_t 时密度趋于 0（连续截断，无跳变）
    expect(kingDensity3D(0.999, M13_RC_OVER_RT)).toBeLessThan(
      kingDensity3D(0.5, M13_RC_OVER_RT) * 1e-2,
    );
  });

  it('核半径内密度接近中心值（King 核平台特征）', () => {
    const center = kingDensity3D(0, M13_RC_OVER_RT);
    const atCore = kingDensity3D(M13_RC_OVER_RT, M13_RC_OVER_RT);
    expect(atCore).toBeGreaterThan(center * 0.3);
  });

  it('非法核/潮汐半径比抛 RangeError', () => {
    expect(() => kingDensity3D(0.5, 0)).toThrow(RangeError);
    expect(() => kingDensity3D(0.5, 1)).toThrow(RangeError);
    expect(() => kingDensity3D(0.5, Number.NaN)).toThrow(RangeError);
  });
});

describe('buildKingRadiusTable01 / sampleKingRadius01', () => {
  const table = buildKingRadiusTable01(M13_RC_OVER_RT);

  it('默认 64 点；端点为 0 与 1；严格单调递增', () => {
    expect(table.length).toBe(KING_TABLE_POINTS);
    expect(table[0]).toBe(0);
    expect(table[table.length - 1]).toBe(1);
    for (let i = 1; i < table.length; i += 1) {
      expect(table[i]).toBeGreaterThan(table[i - 1]);
    }
  });

  it('半质量半径锚定：M13 参数下 ≈ 0.121 r_t ≈ 5.2 pc（±0.015）', () => {
    const rHalf = kingHalfMassRadius01(table);
    expect(rHalf).toBeGreaterThan(0.121 - 0.015);
    expect(rHalf).toBeLessThan(0.121 + 0.015);
    // pc 尺度（潮汐半径 43.4 pc）：≈1.5× 投影半光度半径 3.49 pc
    const rHalfPc = rHalf * 43.4;
    expect(rHalfPc).toBeGreaterThan(3.49);
    expect(rHalfPc).toBeLessThan(2 * 3.49 * 1.1);
  });

  it('采样插值：u 域外钳制、u=0/0.5/1 与表一致、中间值介于相邻表点', () => {
    expect(sampleKingRadius01(table, -1)).toBe(0);
    expect(sampleKingRadius01(table, 2)).toBe(1);
    expect(sampleKingRadius01(table, 0)).toBe(0);
    expect(sampleKingRadius01(table, 1)).toBe(1);
    const u = 31.5 / (KING_TABLE_POINTS - 1); // 表点 31 与 32 的正中
    const r = sampleKingRadius01(table, u);
    expect(r).toBeGreaterThan(table[31]);
    expect(r).toBeLessThan(table[32]);
    expect(r).toBeCloseTo((table[31] + table[32]) / 2, 12);
  });

  it('非法点数抛 RangeError', () => {
    expect(() => buildKingRadiusTable01(M13_RC_OVER_RT, 1)).toThrow(RangeError);
    expect(() => buildKingRadiusTable01(M13_RC_OVER_RT, 2.5)).toThrow(
      RangeError,
    );
  });

  it('kingShapeFromProfile：pc 值同源比值', () => {
    expect(kingShapeFromProfile(M13_PROFILE)).toBeCloseTo(M13_RC_OVER_RT, 12);
  });
});

describe('m13StarTeffK（HR 两档颜色分布）', () => {
  it('蓝星档（uKind < 0.1）：Teff ∈ [7,500, 10,500] K 线性', () => {
    expect(m13StarTeffK(0, 0)).toBe(M13_BLUE_TEFF_MIN_K);
    expect(m13StarTeffK(0.05, 1)).toBe(M13_BLUE_TEFF_MAX_K);
    expect(m13StarTeffK(0.09, 0.5)).toBe(
      (M13_BLUE_TEFF_MIN_K + M13_BLUE_TEFF_MAX_K) / 2,
    );
  });

  it('红黄档（uKind ≥ 0.1）：Teff ∈ [3,900, 5,800] K，u² 偏斜偏冷端', () => {
    expect(m13StarTeffK(M13_BLUE_FRACTION, 0)).toBe(M13_RED_TEFF_MIN_K);
    expect(m13StarTeffK(0.5, 1)).toBe(M13_RED_TEFF_MAX_K);
    // u² 偏斜：中位 uSpread=0.5 落在下四分位（偏冷）
    const mid = m13StarTeffK(0.5, 0.5);
    expect(mid).toBe(
      M13_RED_TEFF_MIN_K + (M13_RED_TEFF_MAX_K - M13_RED_TEFF_MIN_K) * 0.25,
    );
  });
});

describe('buildM13ClusterAttributes', () => {
  const table = buildKingRadiusTable01(M13_RC_OVER_RT);
  const build = (seed: number, count: number) =>
    buildM13ClusterAttributes({
      seed,
      count,
      radiusUnits: 10,
      table,
      brightnessMin: 0.35,
      brightnessMax: 0.8,
    });

  it('属性长度/数值域正确且全有限；半径 ≤ 视觉半径（潮汐截断）', () => {
    const { positions, colors } = build(20260722, M13_BASE_STAR_COUNT);
    expect(positions.length).toBe(M13_BASE_STAR_COUNT * 3);
    expect(colors.length).toBe(M13_BASE_STAR_COUNT * 3);
    for (let i = 0; i < M13_BASE_STAR_COUNT; i += 1) {
      const x = positions[i * 3];
      const y = positions[i * 3 + 1];
      const z = positions[i * 3 + 2];
      const r = Math.hypot(x, y, z);
      expect(Number.isFinite(r)).toBe(true);
      expect(r).toBeLessThanOrEqual(10 + 1e-6);
      for (let c = 0; c < 3; c += 1) {
        const v = colors[i * 3 + c];
        expect(Number.isFinite(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it('确定性种子：同种子两次构建逐字节一致；异种子不同', () => {
    const a = build(20260722, 300);
    const b = build(20260722, 300);
    expect(a.positions).toEqual(b.positions);
    expect(a.colors).toEqual(b.colors);
    expect(a.blueCount).toBe(b.blueCount);
    const c = build(20260723, 300);
    expect(c.positions).not.toEqual(a.positions);
  });

  it('径向壳层数密度单调递减（近观 1,200 粒，等厚 6 壳层体密度）', () => {
    const { positions } = build(20260723, M13_NEAR_STAR_COUNT);
    const shells = 6;
    const counts = new Array<number>(shells).fill(0);
    for (let i = 0; i < M13_NEAR_STAR_COUNT; i += 1) {
      const r = Math.hypot(
        positions[i * 3],
        positions[i * 3 + 1],
        positions[i * 3 + 2],
      );
      const k = Math.min(shells - 1, Math.floor((r / 10) * shells));
      counts[k] += 1;
    }
    // 体密度 = 计数 / 壳层体积（∝ (k+1)³−k³）；King 分布下严格递减
    let prevDensity = Number.POSITIVE_INFINITY;
    for (let k = 0; k < shells; k += 1) {
      const volume = (k + 1) ** 3 - k ** 3;
      const density = counts[k] / volume;
      expect(density).toBeLessThan(prevDensity);
      prevDensity = density;
    }
    // 中心致密核：最内壳层（r < r_t/6）粒子数过半（半质量半径 0.121 r_t）
    expect(counts[0]).toBeGreaterThan(M13_NEAR_STAR_COUNT / 2);
    // 外围稀疏晕仍有成员（非全部塌缩在核心）
    expect(counts[shells - 1]).toBeGreaterThan(0);
  });

  it('蓝星比例 ≈ 10%（两级粒子合计 1,620，比例 ±3% 容差）', () => {
    const base = build(20260722, M13_BASE_STAR_COUNT);
    const near = build(20260723, M13_NEAR_STAR_COUNT);
    const total = M13_BASE_STAR_COUNT + M13_NEAR_STAR_COUNT;
    const ratio = (base.blueCount + near.blueCount) / total;
    expect(ratio).toBeGreaterThan(M13_BLUE_FRACTION - 0.03);
    expect(ratio).toBeLessThan(M13_BLUE_FRACTION + 0.03);
  });

  it('颜色档观感：红黄星族 r>b（暖色）、蓝星档 b>r（冷色）', () => {
    const { colors, positions } = build(20260722, 400);
    expect(positions.length).toBe(1200);
    let warm = 0;
    let cool = 0;
    for (let i = 0; i < 400; i += 1) {
      const r = colors[i * 3];
      const b = colors[i * 3 + 2];
      if (r > b) warm += 1;
      else cool += 1;
    }
    // 红黄主色为绝对主体，蓝星为点缀（§R4-19 验收 1）
    expect(warm).toBeGreaterThan(400 * 0.8);
    expect(cool).toBeGreaterThan(0);
  });

  it('非法粒子数抛 RangeError', () => {
    expect(() => build(1, 0)).toThrow(RangeError);
    expect(() => build(1, 2.5)).toThrow(RangeError);
  });
});
