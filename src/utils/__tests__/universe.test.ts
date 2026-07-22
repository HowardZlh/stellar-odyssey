/**
 * 宇宙级运动与大尺度结构单元测试（需求 3.1.3）
 */

import { DAYS_PER_MYR, KM_S_TO_LY_PER_MYR } from '@/utils/galaxy';
import { createSeededRandom } from '@/utils/random';
import {
  LG_PECULIAR_VELOCITY_KM_S,
  M31_MASS_FRACTION,
  MW_M31_APPROACH_KM_S,
  MW_M31_INITIAL_SEPARATION_LY,
  MW_M31_MERGE_MYR,
  generateCosmicWeb,
  localGroupPositionsLy,
  mwM31MergeCountdownMyr,
  mwM31SeparationLy,
  satelliteGalaxyPositionLy,
  type CosmicWebConfig,
} from '@/utils/universe';

/** 百万年 → 模拟天数 */
const myrToDays = (myr: number): number => myr * DAYS_PER_MYR;

const WEB_CONFIG: CosmicWebConfig = {
  seed: 2024,
  nodeCount: 40,
  minRadiusUnits: 40,
  maxRadiusUnits: 160,
  linksPerNode: 3,
  galaxiesPerLink: 12,
  galaxiesPerNode: 30,
  filamentJitterUnits: 3,
  clusterRadiusUnits: 6,
};

describe('常量科学性（数据来源范围断言）', () => {
  it('MW–M31：距离 250 万光年、接近 110 km/s、约 45 亿年后合并', () => {
    expect(MW_M31_INITIAL_SEPARATION_LY).toBe(2.5e6);
    expect(MW_M31_APPROACH_KM_S).toBe(110);
    expect(MW_M31_MERGE_MYR).toBe(4500);
  });

  it('本星系群本动速度约 620 km/s，M31 质量占比约 0.556', () => {
    expect(LG_PECULIAR_VELOCITY_KM_S).toBe(620);
    expect(M31_MASS_FRACTION).toBeCloseTo(0.556, 6);
  });
});

describe('mwM31SeparationLy', () => {
  it('t=0 → 2.5e6 光年', () => {
    expect(mwM31SeparationLy(0)).toBeCloseTo(MW_M31_INITIAL_SEPARATION_LY, 6);
  });

  it('单调递减（0 → 4500 Myr）', () => {
    let prev = mwM31SeparationLy(0);
    for (let t = 100; t <= MW_M31_MERGE_MYR; t += 100) {
      const d = mwM31SeparationLy(myrToDays(t));
      expect(d).toBeLessThan(prev);
      prev = d;
    }
  });

  it('t=4500 Myr → ≈0（容差 1 ly）', () => {
    expect(mwM31SeparationLy(myrToDays(MW_M31_MERGE_MYR))).toBeLessThan(1);
  });

  it('t>4500 Myr → 0（clamp）', () => {
    expect(mwM31SeparationLy(myrToDays(5000))).toBe(0);
    expect(mwM31SeparationLy(myrToDays(10000))).toBe(0);
  });

  it('初速度校验：t=0 附近的接近速率 ≈ 110×3.3357 ly/Myr（容差 5%）', () => {
    const dtMyr = 0.1;
    const rate = (mwM31SeparationLy(0) - mwM31SeparationLy(myrToDays(dtMyr))) / dtMyr;
    const expected = MW_M31_APPROACH_KM_S * KM_S_TO_LY_PER_MYR;
    expect(rate).toBeGreaterThan(expected * 0.95);
    expect(rate).toBeLessThan(expected * 1.05);
  });

  it('t<0 允许回溯：距离大于当前值', () => {
    expect(mwM31SeparationLy(myrToDays(-100))).toBeGreaterThan(MW_M31_INITIAL_SEPARATION_LY);
  });
});

describe('mwM31MergeCountdownMyr', () => {
  it('t=0 → 4500', () => {
    expect(mwM31MergeCountdownMyr(0)).toBe(4500);
  });

  it('t=4500 Myr → 0，超过 → 0', () => {
    expect(mwM31MergeCountdownMyr(myrToDays(4500))).toBe(0);
    expect(mwM31MergeCountdownMyr(myrToDays(6000))).toBe(0);
  });

  it('t=1000 Myr → 3500', () => {
    expect(mwM31MergeCountdownMyr(myrToDays(1000))).toBeCloseTo(3500, 6);
  });
});

describe('localGroupPositionsLy', () => {
  const DIR = { x: 1, y: 0, z: 0 };

  it('mw 与 m31 反向共线，|mw|+|m31| = 当前距离', () => {
    const { mw, m31 } = localGroupPositionsLy(0, { x: 1, y: 2, z: -2 });
    // 反向共线：叉积为零且点积为负
    const dot = mw.x * m31.x + mw.y * m31.y + mw.z * m31.z;
    expect(dot).toBeLessThan(0);
    const cross = {
      x: mw.y * m31.z - mw.z * m31.y,
      y: mw.z * m31.x - mw.x * m31.z,
      z: mw.x * m31.y - mw.y * m31.x,
    };
    expect(Math.hypot(cross.x, cross.y, cross.z)).toBeCloseTo(0, 4);
    const dMw = Math.hypot(mw.x, mw.y, mw.z);
    const dM31 = Math.hypot(m31.x, m31.y, m31.z);
    expect(dMw + dM31).toBeCloseTo(mwM31SeparationLy(0), 4);
  });

  it('质量比：|mw|/|m31| ≈ 0.556/0.444（到质心距离与质量成反比）', () => {
    const { mw, m31 } = localGroupPositionsLy(0, DIR);
    const ratio = Math.hypot(mw.x, mw.y, mw.z) / Math.hypot(m31.x, m31.y, m31.z);
    expect(ratio).toBeCloseTo(M31_MASS_FRACTION / (1 - M31_MASS_FRACTION), 6);
  });

  it('方向矢量非单位长度时结果与单位化一致（内部归一化）', () => {
    const a = localGroupPositionsLy(myrToDays(500), { x: 0, y: 0, z: 1 });
    const b = localGroupPositionsLy(myrToDays(500), { x: 0, y: 0, z: 42 });
    expect(b.mw.z).toBeCloseTo(a.mw.z, 8);
    expect(b.m31.z).toBeCloseTo(a.m31.z, 8);
  });

  it('零矢量抛 RangeError', () => {
    expect(() => localGroupPositionsLy(0, { x: 0, y: 0, z: 0 })).toThrow(RangeError);
  });
});

describe('satelliteGalaxyPositionLy', () => {
  const D = 160000; // 大麦哲伦云距离约 16 万光年
  const PERIOD = 1500;

  it('t=0、phase0=0、incl=0 → (d, 0, 0)', () => {
    const p = satelliteGalaxyPositionLy(D, PERIOD, 0, 0, 0);
    expect(p.x).toBeCloseTo(D, 6);
    expect(p.y).toBeCloseTo(0, 6);
    expect(p.z).toBeCloseTo(0, 6);
  });

  it('四分之一周期后到 (0, 0, −d)（自 +y 俯视逆时针）', () => {
    const p = satelliteGalaxyPositionLy(D, PERIOD, 0, 0, myrToDays(PERIOD / 4));
    expect(p.x).toBeCloseTo(0, 4);
    expect(p.y).toBeCloseTo(0, 4);
    expect(p.z).toBeCloseTo(-D, 4);
  });

  it('倾角 90° 时轨道在 x-y 面（z≈0）', () => {
    for (let t = 0; t <= PERIOD; t += PERIOD / 8) {
      const p = satelliteGalaxyPositionLy(D, PERIOD, 0.3, 90, myrToDays(t));
      expect(p.z).toBeCloseTo(0, 4);
      expect(Math.hypot(p.x, p.y)).toBeCloseTo(D, 4);
    }
  });

  it('初始相位 phase0 生效', () => {
    const p = satelliteGalaxyPositionLy(D, PERIOD, Math.PI / 2, 0, 0);
    expect(p.x).toBeCloseTo(0, 4);
    expect(p.z).toBeCloseTo(-D, 4);
  });

  it('非法参数抛 RangeError（距离 ≤0、周期 ≤0）', () => {
    expect(() => satelliteGalaxyPositionLy(0, PERIOD, 0, 0, 0)).toThrow(RangeError);
    expect(() => satelliteGalaxyPositionLy(-1, PERIOD, 0, 0, 0)).toThrow(RangeError);
    expect(() => satelliteGalaxyPositionLy(D, 0, 0, 0, 0)).toThrow(RangeError);
    expect(() => satelliteGalaxyPositionLy(D, -100, 0, 0, 0)).toThrow(RangeError);
  });
});

describe('generateCosmicWeb', () => {
  it('同 config 两次结果逐元素相等（确定性）', () => {
    const a = generateCosmicWeb(WEB_CONFIG);
    const b = generateCosmicWeb(WEB_CONFIG);
    expect(a.galaxyCount).toBe(b.galaxyCount);
    expect(a.nodePositions).toEqual(b.nodePositions);
    expect(a.galaxyPositions).toEqual(b.galaxyPositions);
    expect(a.galaxyColors).toEqual(b.galaxyColors);
  });

  it('不同 seed 结果不同', () => {
    const a = generateCosmicWeb(WEB_CONFIG);
    const b = generateCosmicWeb({ ...WEB_CONFIG, seed: 9 });
    expect(a.nodePositions).not.toEqual(b.nodePositions);
  });

  it('节点都在球壳半径范围内（容差 1e-3）', () => {
    const web = generateCosmicWeb(WEB_CONFIG);
    for (let i = 0; i < WEB_CONFIG.nodeCount; i += 1) {
      const r = Math.hypot(
        web.nodePositions[i * 3],
        web.nodePositions[i * 3 + 1],
        web.nodePositions[i * 3 + 2],
      );
      expect(r).toBeGreaterThanOrEqual(WEB_CONFIG.minRadiusUnits - 1e-3);
      expect(r).toBeLessThanOrEqual(WEB_CONFIG.maxRadiusUnits + 1e-3);
    }
  });

  it('galaxyCount = 边数×galaxiesPerLink + nodeCount×galaxiesPerNode（边数 > 0 且为整数）', () => {
    const web = generateCosmicWeb(WEB_CONFIG);
    const clusterGalaxies = WEB_CONFIG.nodeCount * WEB_CONFIG.galaxiesPerNode;
    const filamentGalaxies = web.galaxyCount - clusterGalaxies;
    expect(filamentGalaxies).toBeGreaterThan(0);
    expect(filamentGalaxies % WEB_CONFIG.galaxiesPerLink).toBe(0);
    const edgeCount = filamentGalaxies / WEB_CONFIG.galaxiesPerLink;
    // 每节点 3 条近邻边、去重后至少 nodeCount×links/2 条
    expect(edgeCount).toBeGreaterThanOrEqual(
      (WEB_CONFIG.nodeCount * WEB_CONFIG.linksPerNode) / 2,
    );
    expect(web.galaxyPositions).toHaveLength(web.galaxyCount * 3);
    expect(web.galaxyColors).toHaveLength(web.galaxyCount * 3);
  });

  it('颜色为昏暗多样色调（亮度受限且非单一颜色）', () => {
    const web = generateCosmicWeb(WEB_CONFIG);
    const unique = new Set<string>();
    for (let i = 0; i < web.galaxyCount; i += 1) {
      const r = web.galaxyColors[i * 3];
      const g = web.galaxyColors[i * 3 + 1];
      const b = web.galaxyColors[i * 3 + 2];
      expect(Math.max(r, g, b)).toBeLessThanOrEqual(0.8 + 1e-6);
      expect(Math.max(r, g, b)).toBeGreaterThan(0);
      unique.add(`${r.toFixed(3)},${g.toFixed(3)},${b.toFixed(3)}`);
    }
    expect(unique.size).toBeGreaterThan(10);
  });

  it('非均匀性：星系到最近节点距离的中位数显著小于均匀期望', () => {
    const web = generateCosmicWeb(WEB_CONFIG);
    const dists: number[] = [];
    for (let i = 0; i < web.galaxyCount; i += 1) {
      let best = Infinity;
      for (let j = 0; j < WEB_CONFIG.nodeCount; j += 1) {
        const dx = web.galaxyPositions[i * 3] - web.nodePositions[j * 3];
        const dy = web.galaxyPositions[i * 3 + 1] - web.nodePositions[j * 3 + 1];
        const dz = web.galaxyPositions[i * 3 + 2] - web.nodePositions[j * 3 + 2];
        best = Math.min(best, Math.sqrt(dx * dx + dy * dy + dz * dz));
      }
      dists.push(best);
    }
    dists.sort((a, b) => a - b);
    const median = dists[Math.floor(dists.length / 2)];
    expect(median).toBeLessThan((WEB_CONFIG.maxRadiusUnits - WEB_CONFIG.minRadiusUnits) / 4);
  });

  it('存在空洞：球壳内均匀采样点中 ≥30% 远离所有星系（聚集非均匀）', () => {
    const web = generateCosmicWeb(WEB_CONFIG);
    const rand = createSeededRandom(777);
    const threshold = WEB_CONFIG.clusterRadiusUnits * 2;
    let farCount = 0;
    const samples = 200;
    for (let s = 0; s < samples; s += 1) {
      const r =
        WEB_CONFIG.minRadiusUnits +
        (WEB_CONFIG.maxRadiusUnits - WEB_CONFIG.minRadiusUnits) * rand();
      const cosPolar = rand() * 2 - 1;
      const azimuth = Math.PI * 2 * rand();
      const sinPolar = Math.sqrt(1 - cosPolar * cosPolar);
      const px = r * sinPolar * Math.cos(azimuth);
      const py = r * cosPolar;
      const pz = r * sinPolar * Math.sin(azimuth);
      let nearest = Infinity;
      for (let i = 0; i < web.galaxyCount; i += 1) {
        const dx = px - web.galaxyPositions[i * 3];
        const dy = py - web.galaxyPositions[i * 3 + 1];
        const dz = pz - web.galaxyPositions[i * 3 + 2];
        nearest = Math.min(nearest, Math.sqrt(dx * dx + dy * dy + dz * dz));
      }
      if (nearest > threshold) farCount += 1;
    }
    expect(farCount / samples).toBeGreaterThanOrEqual(0.3);
  });

  it('linksPerNode 超过 nodeCount−1 时自动截断（不越界）', () => {
    const web = generateCosmicWeb({
      ...WEB_CONFIG,
      nodeCount: 3,
      linksPerNode: 10,
      galaxiesPerLink: 2,
      galaxiesPerNode: 1,
    });
    // 3 个节点全连接 = 3 条边 → 3×2 + 3×1 = 9
    expect(web.galaxyCount).toBe(9);
  });

  it('非法参数抛 RangeError（逐项校验）', () => {
    expect(() => generateCosmicWeb({ ...WEB_CONFIG, nodeCount: 1 })).toThrow(RangeError);
    expect(() => generateCosmicWeb({ ...WEB_CONFIG, nodeCount: 2.5 })).toThrow(RangeError);
    expect(() => generateCosmicWeb({ ...WEB_CONFIG, minRadiusUnits: 0 })).toThrow(RangeError);
    expect(() => generateCosmicWeb({ ...WEB_CONFIG, maxRadiusUnits: 40 })).toThrow(RangeError);
    expect(() => generateCosmicWeb({ ...WEB_CONFIG, linksPerNode: -1 })).toThrow(RangeError);
    expect(() => generateCosmicWeb({ ...WEB_CONFIG, galaxiesPerLink: -1 })).toThrow(RangeError);
    expect(() => generateCosmicWeb({ ...WEB_CONFIG, galaxiesPerNode: -1 })).toThrow(RangeError);
  });
});
