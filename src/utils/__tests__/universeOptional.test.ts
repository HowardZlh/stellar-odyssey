/**
 * 宇宙级可选项纯函数测试（可选需求 3.1.3 / 7 单元测试）：
 * 合并快进预览 / 合并辉光 / 哈勃膨胀 / 麦哲伦星流 / 可观测宇宙边界 / 红移变红
 */

import {
  HUBBLE_H0_PER_MYR,
  HUBBLE_MAX_SCALE,
  MAGELLANIC_STREAM_TRAIL_MYR,
  MERGE_GLOW_ONSET_LY,
  MERGE_TARGET_SIM_DAYS,
  MW_M31_MERGE_MYR,
  OBSERVABLE_UNIVERSE_RADIUS_LY,
  generateCosmicWeb,
  hubbleScaleFactor,
  magellanicStreamPointsLy,
  mergeGlowOpacity01,
  mergePreviewSimDays,
  satelliteGalaxyPositionLy,
  type CosmicWebConfig,
} from '@/utils/universe';
import { DAYS_PER_MYR } from '@/utils/galaxy';

describe('mergePreviewSimDays（合并快进插值）', () => {
  const START = 12345;

  it('端点：progress=0 为起点、progress=1 精确到达合并时刻', () => {
    expect(mergePreviewSimDays(START, 0)).toBe(START);
    expect(mergePreviewSimDays(START, 1)).toBe(MERGE_TARGET_SIM_DAYS);
  });

  it('progress 越界钳制到 [0, 1]', () => {
    expect(mergePreviewSimDays(START, -0.5)).toBe(START);
    expect(mergePreviewSimDays(START, 1.7)).toBe(MERGE_TARGET_SIM_DAYS);
  });

  it('单调递增（起点早于合并时刻时）', () => {
    let prev = mergePreviewSimDays(START, 0);
    for (let p = 0.1; p <= 1; p += 0.1) {
      const cur = mergePreviewSimDays(START, p);
      expect(cur).toBeGreaterThanOrEqual(prev);
      prev = cur;
    }
  });

  it('合并时刻常量：4500 Myr 对应的天数', () => {
    expect(MERGE_TARGET_SIM_DAYS).toBeCloseTo(MW_M31_MERGE_MYR * DAYS_PER_MYR, 3);
  });
});

describe('mergeGlowOpacity01（合并辉光）', () => {
  it('距离 0 时为 1、起始距离处为 0、超出为 0', () => {
    expect(mergeGlowOpacity01(0)).toBe(1);
    expect(mergeGlowOpacity01(MERGE_GLOW_ONSET_LY)).toBe(0);
    expect(mergeGlowOpacity01(MERGE_GLOW_ONSET_LY * 3)).toBe(0);
  });

  it('中间线性渐变且随距离单调递减', () => {
    expect(mergeGlowOpacity01(MERGE_GLOW_ONSET_LY / 2)).toBeCloseTo(0.5, 9);
    expect(mergeGlowOpacity01(1e5)).toBeGreaterThan(mergeGlowOpacity01(3e5));
  });

  it('非法距离抛出 RangeError', () => {
    expect(() => mergeGlowOpacity01(-1)).toThrow(RangeError);
    expect(() => mergeGlowOpacity01(Number.NaN)).toThrow(RangeError);
    expect(() => mergeGlowOpacity01(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe('hubbleScaleFactor（哈勃膨胀示意）', () => {
  it('t=0 时为 1（当前时刻无缩放）', () => {
    expect(hubbleScaleFactor(0)).toBe(1);
  });

  it('未来膨胀、回溯收缩（v = H·d 的几何本质）', () => {
    const future = hubbleScaleFactor(1000 * DAYS_PER_MYR);
    const past = hubbleScaleFactor(-1000 * DAYS_PER_MYR);
    expect(future).toBeGreaterThan(1);
    expect(past).toBeLessThan(1);
    expect(future).toBeCloseTo(1 + HUBBLE_H0_PER_MYR * 1000, 9);
  });

  it('上下限钳制：上限 HUBBLE_MAX_SCALE、下限 0.2', () => {
    expect(hubbleScaleFactor(1e9 * DAYS_PER_MYR)).toBe(HUBBLE_MAX_SCALE);
    expect(hubbleScaleFactor(-1e9 * DAYS_PER_MYR)).toBe(0.2);
  });

  it('哈勃常数取值 ≈ 70 km/s/Mpc 换算（7.16e-5 /Myr）', () => {
    expect(HUBBLE_H0_PER_MYR).toBeCloseTo(7.16e-5, 9);
  });

  it('负哈勃常数抛出 RangeError', () => {
    expect(() => hubbleScaleFactor(0, -1)).toThrow(RangeError);
  });
});

describe('magellanicStreamPointsLy（麦哲伦星流）', () => {
  const DIR = { x: -0.2049, y: -0.9222, z: 0.3279 } as const;
  const ARGS = [160000, 1500, DIR, 35, 1e10, 60] as const;

  it('输出点数等于 count', () => {
    const points = magellanicStreamPointsLy(...ARGS);
    expect(points).toHaveLength(60);
  });

  it('确定性：同参数输出一致、不同种子不同', () => {
    const a = magellanicStreamPointsLy(...ARGS);
    const b = magellanicStreamPointsLy(...ARGS);
    const c = magellanicStreamPointsLy(160000, 1500, DIR, 35, 1e10, 60, 999);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it('首点靠近 LMC 当前轨道位置（抖动最小，与运动位置同源）', () => {
    const points = magellanicStreamPointsLy(...ARGS);
    const lmc = satelliteGalaxyPositionLy(160000, 1500, DIR, 35, 1e10);
    const d = Math.hypot(points[0].x - lmc.x, points[0].y - lmc.y, points[0].z - lmc.z);
    // 首点抖动幅度 ≤ distance×0.04×0.3×√3
    expect(d).toBeLessThan(160000 * 0.04 * 0.3 * Math.sqrt(3) + 1e-6);
  });

  it('尾端点回溯到 MAGELLANIC_STREAM_TRAIL_MYR 前的轨道位置附近', () => {
    const points = magellanicStreamPointsLy(...ARGS);
    const tail = satelliteGalaxyPositionLy(
      160000,
      1500,
      DIR,
      35,
      1e10 - MAGELLANIC_STREAM_TRAIL_MYR * DAYS_PER_MYR,
    );
    const last = points[points.length - 1];
    const d = Math.hypot(last.x - tail.x, last.y - tail.y, last.z - tail.z);
    // 尾端抖动幅度 ≤ distance×0.04×1.3×√3
    expect(d).toBeLessThan(160000 * 0.04 * 1.3 * Math.sqrt(3) + 1e-6);
  });

  it('非法采样点数抛出 RangeError', () => {
    expect(() => magellanicStreamPointsLy(160000, 1500, DIR, 35, 0, 1)).toThrow(RangeError);
    expect(() => magellanicStreamPointsLy(160000, 1500, DIR, 35, 0, 2.5)).toThrow(RangeError);
  });
});

describe('可观测宇宙边界常量', () => {
  it('半径约 465 亿光年（Planck 2018 共动距离）', () => {
    expect(OBSERVABLE_UNIVERSE_RADIUS_LY).toBe(4.65e10);
  });
});

describe('宇宙网红移变红示意（可选需求 3.1.3）', () => {
  const CONFIG: CosmicWebConfig = {
    seed: 42,
    nodeCount: 24,
    minRadiusUnits: 4000,
    maxRadiusUnits: 20000,
    linksPerNode: 3,
    galaxiesPerLink: 12,
    galaxiesPerNode: 30,
    filamentJitterUnits: 300,
    clusterRadiusUnits: 500,
  };

  it('越远的星系 B/R 比越低（色调偏红趋势）', () => {
    const web = generateCosmicWeb(CONFIG);
    const entries: Array<{ dist: number; ratio: number }> = [];
    for (let i = 0; i < web.galaxyCount; i += 1) {
      const x = web.galaxyPositions[i * 3];
      const y = web.galaxyPositions[i * 3 + 1];
      const z = web.galaxyPositions[i * 3 + 2];
      const r = web.galaxyColors[i * 3];
      const b = web.galaxyColors[i * 3 + 2];
      entries.push({ dist: Math.hypot(x, y, z), ratio: b / Math.max(r, 1e-9) });
    }
    entries.sort((a, b) => a.dist - b.dist);
    const quarter = Math.floor(entries.length / 4);
    const near = entries.slice(0, quarter);
    const far = entries.slice(-quarter);
    const mean = (arr: Array<{ ratio: number }>): number =>
      arr.reduce((sum, e) => sum + e.ratio, 0) / arr.length;
    // 远处星系 G/B 通道被压低 → B/R 比显著低于近处
    expect(mean(far)).toBeLessThan(mean(near) * 0.85);
  });

  it('红移处理后亮度仍保持昏暗上限（≤ 0.8）', () => {
    const web = generateCosmicWeb(CONFIG);
    for (let i = 0; i < web.galaxyCount * 3; i += 1) {
      expect(web.galaxyColors[i]).toBeLessThanOrEqual(0.8 + 1e-6);
      expect(web.galaxyColors[i]).toBeGreaterThanOrEqual(0);
    }
  });
});
