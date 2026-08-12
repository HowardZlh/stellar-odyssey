/**
 * M1-7 流星雨物理纯函数层单测（IMPROVEMENT_REQUIREMENTS_METEOR_SHOWERS §M1-7）
 *
 * 覆盖：坐标族（LST 锚点/北极星/轴向防镜像）、流量族（§1.4 显式公式边界）、
 * 烧蚀族（RK4 单调减速/位移量级防单位混用/强度先增后减/峰值归一/入速峰值前移/
 * 拟合残差上界）、调度族（契约 C2 三独立随机数/fract 公式一致含跨周期/
 * aGateRank 反耦合）、降级判定。
 */

import {
  AIR_DENSITY_SEA_LEVEL,
  ATMOSPHERE_SCALE_HEIGHT_KM,
  BURN_LAYER_TOP_KM,
  DEFAULT_OBSERVER_LAT_DEG,
  KAPPA_CYGNIDS,
  METEOR_CYCLE_PERIOD_SEC,
  PERSEIDS,
  airDensityAtKm,
  equatorialToHorizontalMatrix,
  equatorialUnitVector,
  evalCubic,
  fitCubicThroughOrigin,
  fluxFraction,
  horizontalFromEquatorial,
  ignitedSlots,
  labQualityTier,
  localSiderealTime,
  makeMeteorSlots,
  sceneDirFromAltAz,
  slotPhase,
  solveAblationRK4,
  truncateAblationCurves,
  visibleHourlyRate,
  type MeteorSlot,
} from '@/utils/meteorShower';

const DEG = Math.PI / 180;

describe('坐标族（§1.3，契约 C5）', () => {
  test('localSiderealTime：简化模型 LST = LST₀ + 15.041°×(hourOffset+elapsedHours)', () => {
    expect(localSiderealTime(353.5, 0, 0)).toBeCloseTo(353.5 * DEG, 10);
    // 1 小时推进 = 15.041°（353.5 + 15.041 = 368.541 → 归一 8.541°）
    expect(localSiderealTime(353.5, 1, 0)).toBeCloseTo(8.541 * DEG, 6);
    // hourOffset 与 elapsedHours 等价可加
    expect(localSiderealTime(310, 2, 0.5)).toBeCloseTo(localSiderealTime(310, 0, 2.5), 12);
    // 负偏移归一到 [0, 2π)
    const lst = localSiderealTime(10, -6, 0);
    expect(lst).toBeGreaterThanOrEqual(0);
    expect(lst).toBeLessThan(2 * Math.PI);
    expect(lst).toBeCloseTo((10 - 6 * 15.041 + 360) * DEG, 6);
  });

  test('LST 锚点：英仙座历元辐射点 Alt≈52°（需求 §1.3）', () => {
    const lst = localSiderealTime(PERSEIDS.epochLst0Deg, 0, 0);
    const { altRad } = horizontalFromEquatorial(
      PERSEIDS.radiantRaDeg,
      PERSEIDS.radiantDecDeg,
      DEFAULT_OBSERVER_LAT_DEG,
      lst
    );
    expect(altRad / DEG).toBeGreaterThan(50);
    expect(altRad / DEG).toBeLessThan(54);
  });

  test('LST 锚点：天鹅座κ历元辐射点 Alt≈66°（需求 §1.3）', () => {
    const lst = localSiderealTime(KAPPA_CYGNIDS.epochLst0Deg, 0, 0);
    const { altRad } = horizontalFromEquatorial(
      KAPPA_CYGNIDS.radiantRaDeg,
      KAPPA_CYGNIDS.radiantDecDeg,
      DEFAULT_OBSERVER_LAT_DEG,
      lst
    );
    expect(altRad / DEG).toBeGreaterThan(64);
    expect(altRad / DEG).toBeLessThan(68);
  });

  test('北极星锚点：alt ≈ 观测纬度，方位 ≈ 正北（任意 LST）', () => {
    // Polaris J2000：RA 37.95°，Dec +89.264°
    for (const lat of [10, 40, 65]) {
      for (const lstDeg of [0, 123.4, 270]) {
        const { altRad, azRad } = horizontalFromEquatorial(37.95, 89.264, lat, lstDeg * DEG);
        expect(altRad / DEG).toBeGreaterThan(lat - 1);
        expect(altRad / DEG).toBeLessThan(lat + 1);
        // 方位在正北 ±2°（跨 0 归一）
        const azDeg = azRad / DEG;
        const northDelta = Math.min(azDeg, 360 - azDeg);
        expect(northDelta).toBeLessThan(2);
      }
    }
  });

  test('horizontalFromEquatorial：上中天时 Alt = 90 − |φ − δ|', () => {
    // H = 0（LST = RA），δ=20，φ=40 → Alt = 70°，位于正南（Az=180°）
    const { altRad, azRad } = horizontalFromEquatorial(100, 20, 40, 100 * DEG);
    expect(altRad / DEG).toBeCloseTo(70, 8);
    expect(azRad / DEG).toBeCloseTo(180, 8);
  });

  test('sceneDirFromAltAz 轴向锚点（契约 C5 防东西镜像）：Az=90°/Alt=0° → [1,0,0]', () => {
    const east = sceneDirFromAltAz({ altRad: 0, azRad: Math.PI / 2 });
    expect(east[0]).toBeCloseTo(1, 10);
    expect(east[1]).toBeCloseTo(0, 10);
    expect(east[2]).toBeCloseTo(0, 10);
    // 正北 → [0,0,-1]；天顶 → [0,1,0]
    const north = sceneDirFromAltAz({ altRad: 0, azRad: 0 });
    expect(north[0]).toBeCloseTo(0, 10);
    expect(north[2]).toBeCloseTo(-1, 10);
    const zenith = sceneDirFromAltAz({ altRad: Math.PI / 2, azRad: 0 });
    expect(zenith[1]).toBeCloseTo(1, 10);
  });

  test('equatorialToHorizontalMatrix 与 sceneDirFromAltAz∘horizontalFromEquatorial 等价', () => {
    const cases: Array<[number, number, number, number]> = [
      [46, 58, 40, 353.5 * DEG],
      [286, 59, 40, 310 * DEG],
      [37.95, 89.264, 65, 200 * DEG],
      [180, -30, -20, 45 * DEG],
      [0, 0, 0, 0],
    ];
    for (const [ra, dec, lat, lst] of cases) {
      const m = equatorialToHorizontalMatrix(lat, lst);
      const ve = equatorialUnitVector(ra, dec);
      const viaMatrix = [
        m[0] * ve[0] + m[1] * ve[1] + m[2] * ve[2],
        m[3] * ve[0] + m[4] * ve[1] + m[5] * ve[2],
        m[6] * ve[0] + m[7] * ve[1] + m[8] * ve[2],
      ];
      const viaFormula = sceneDirFromAltAz(horizontalFromEquatorial(ra, dec, lat, lst));
      for (let i = 0; i < 3; i++) {
        expect(viaMatrix[i]).toBeCloseTo(viaFormula[i], 10);
      }
    }
  });

  test('equatorialUnitVector 为单位向量', () => {
    const v = equatorialUnitVector(46, 58);
    expect(Math.hypot(v[0], v[1], v[2])).toBeCloseTo(1, 12);
  });
});

describe('流量族（§1.4）', () => {
  test('Alt ≤ 0 时流量为零', () => {
    expect(visibleHourlyRate(100, 2.2, 0, 6.5)).toBe(0);
    expect(visibleHourlyRate(100, 2.2, -0.3, 6.5)).toBe(0);
  });

  test('HR = ZHR·sin(Alt)/r^(6.5−lm)：是 sin 不是线性', () => {
    // lm = 6.5 → 分母 1，HR = ZHR·sin(Alt)
    expect(visibleHourlyRate(100, 2.2, Math.PI / 2, 6.5)).toBeCloseTo(100, 10);
    expect(visibleHourlyRate(100, 2.2, Math.PI / 6, 6.5)).toBeCloseTo(50, 10);
    // sin 非线性：alt=45° 应为 100·√2/2 ≈ 70.7，而非线性内插 50
    expect(visibleHourlyRate(100, 2.2, Math.PI / 4, 6.5)).toBeCloseTo(70.71, 1);
  });

  test('随 limitingMag 降低（光害加重）流量单调降低', () => {
    const alt = 52 * DEG;
    const rates = [6.5, 6.0, 5.0, 4.0, 3.0].map((lm) =>
      visibleHourlyRate(PERSEIDS.zhr, PERSEIDS.populationIndex, alt, lm)
    );
    for (let i = 1; i < rates.length; i++) {
      expect(rates[i]).toBeLessThan(rates[i - 1]);
    }
    // lm=6.0：HR = 100·sin(52°)/2.2^0.5 ≈ 53.1
    expect(rates[1]).toBeCloseTo((100 * Math.sin(alt)) / 2.2 ** 0.5, 6);
  });

  test('fluxFraction 显式公式：clamp(HR/3600 × cyclePeriod / slotCount, 0, 1)', () => {
    // HR=120、周期 60 s、200 槽：120/3600×60/200 = 0.01
    expect(fluxFraction(120, 200, 60)).toBeCloseTo(0.01, 12);
    // HR=0 → 0
    expect(fluxFraction(0, 200, 60)).toBe(0);
    // 超容量 → clamp 1（HR 巨大）
    expect(fluxFraction(1e9, 200, 60)).toBe(1);
    // 非法参数抛错
    expect(() => fluxFraction(100, 0, 60)).toThrow(RangeError);
    expect(() => fluxFraction(100, 200, 0)).toThrow(RangeError);
  });
});

describe('烧蚀族（§1.1）', () => {
  test('大气密度指数衰减：ρ(0)=ρ₀，每升高 H 衰减 e 倍', () => {
    expect(airDensityAtKm(0)).toBeCloseTo(AIR_DENSITY_SEA_LEVEL, 12);
    expect(airDensityAtKm(ATMOSPHERE_SCALE_HEIGHT_KM)).toBeCloseTo(
      AIR_DENSITY_SEA_LEVEL / Math.E,
      10
    );
  });

  test('RK4 速度单调递减', () => {
    for (const massKg of [1e-5, 1e-3, 1e-1]) {
      const curves = solveAblationRK4({ massKg, entrySpeedKmPerSec: 59 });
      for (let i = 1; i < curves.vKmPerSec.length; i++) {
        expect(curves.vKmPerSec[i]).toBeLessThanOrEqual(curves.vKmPerSec[i - 1] + 1e-12);
      }
      // 确实发生了减速（非常数）
      expect(curves.vKmPerSec[curves.vKmPerSec.length - 1]).toBeLessThan(curves.vKmPerSec[0]);
    }
  });

  test('位移量级：1 s 内 ~40–60 km（防 SI/km 单位混用红线）', () => {
    // 代表性质量（普通上限 1e-3 / 火流星下限 1e-2），英仙座入速 59 km/s
    for (const massKg of [1e-3, 1e-2]) {
      const curves = solveAblationRK4({ massKg, entrySpeedKmPerSec: 59, durationSec: 1 });
      const sEnd = curves.sKm[curves.sKm.length - 1];
      expect(sEnd).toBeGreaterThan(40);
      expect(sEnd).toBeLessThan(60);
    }
  });

  test('位移单调不减，t=0 时为 0', () => {
    const curves = solveAblationRK4({ massKg: 1e-4, entrySpeedKmPerSec: 59 });
    expect(curves.sKm[0]).toBe(0);
    for (let i = 1; i < curves.sKm.length; i++) {
      expect(curves.sKm[i]).toBeGreaterThanOrEqual(curves.sKm[i - 1]);
    }
  });

  test('强度曲线先增后减、峰值归一', () => {
    const curves = solveAblationRK4({ massKg: 1e-3, entrySpeedKmPerSec: 59 });
    const peakIndex = curves.intensity.indexOf(Math.max(...curves.intensity));
    // 峰值归一 = 1，且不在端点（先增后减）
    expect(Math.max(...curves.intensity)).toBeCloseTo(1, 12);
    expect(peakIndex).toBeGreaterThan(0);
    expect(peakIndex).toBeLessThan(curves.intensity.length - 1);
    // 峰值前显著增亮、峰值后显著转暗
    expect(curves.intensity[0]).toBeLessThan(0.2);
    expect(curves.intensity[curves.intensity.length - 1]).toBeLessThan(0.2);
    expect(curves.peakTimeSec).toBeCloseTo(curves.ts[peakIndex], 12);
  });

  test('入速越大峰值越靠前（同质量对比）', () => {
    const fast = solveAblationRK4({ massKg: 1e-4, entrySpeedKmPerSec: 59 });
    const slow = solveAblationRK4({ massKg: 1e-4, entrySpeedKmPerSec: 25 });
    expect(fast.peakTimeSec).toBeLessThan(slow.peakTimeSec);
  });

  test('非法参数抛错', () => {
    expect(() => solveAblationRK4({ massKg: 0, entrySpeedKmPerSec: 59 })).toThrow(RangeError);
    expect(() => solveAblationRK4({ massKg: 1e-3, entrySpeedKmPerSec: -1 })).toThrow(RangeError);
    expect(() =>
      solveAblationRK4({ massKg: 1e-3, entrySpeedKmPerSec: 59, durationSec: 0 })
    ).toThrow(RangeError);
    expect(() => solveAblationRK4({ massKg: 1e-3, entrySpeedKmPerSec: 59, steps: 1 })).toThrow(
      RangeError
    );
  });

  test('truncateAblationCurves：小质量截断到有效发光窗口，大质量原样返回', () => {
    const small = solveAblationRK4({ massKg: 1e-6, entrySpeedKmPerSec: 59 });
    const truncated = truncateAblationCurves(small);
    expect(truncated.ts.length).toBeLessThan(small.ts.length);
    // 截断点在峰值之后、强度已衰减
    expect(truncated.ts[truncated.ts.length - 1]).toBeGreaterThan(truncated.peakTimeSec);
    expect(truncated.intensity[truncated.intensity.length - 1]).toBeLessThan(0.02);
    // 大质量火流星（1 s 内未烧尽）不截断
    const big = solveAblationRK4({ massKg: 1, entrySpeedKmPerSec: 59 });
    expect(truncateAblationCurves(big)).toBe(big);
    expect(() => truncateAblationCurves(small, 1.5)).toThrow(RangeError);
  });

  test('fitCubicThroughOrigin：精确还原三次多项式（c₀=0）', () => {
    const ts = Array.from({ length: 50 }, (_, i) => i / 49);
    const truth: [number, number, number] = [2.5, -1.2, 0.7];
    const ys = ts.map((t) => evalCubic(truth, t));
    const fit = fitCubicThroughOrigin(ts, ys);
    for (let i = 0; i < 3; i++) {
      expect(fit[i]).toBeCloseTo(truth[i], 8);
    }
  });

  test('拟合残差上界：位移 ≤1 km（截断窗）、强度 RMS ≤0.2', () => {
    for (const massKg of [1e-6, 1e-4, 1e-3, 1e-2]) {
      const curves = truncateAblationCurves(
        solveAblationRK4({ massKg, entrySpeedKmPerSec: 59 })
      );
      const dispFit = fitCubicThroughOrigin(curves.ts, curves.sKm);
      const intenFit = fitCubicThroughOrigin(curves.ts, curves.intensity);
      const dispMaxRes = Math.max(
        ...curves.ts.map((t, i) => Math.abs(evalCubic(dispFit, t) - curves.sKm[i]))
      );
      const intenRms = Math.sqrt(
        curves.ts.reduce(
          (sum, t, i) => sum + (evalCubic(intenFit, t) - curves.intensity[i]) ** 2,
          0
        ) / curves.ts.length
      );
      expect(dispMaxRes).toBeLessThanOrEqual(1);
      expect(intenRms).toBeLessThanOrEqual(0.2);
    }
  });

  test('fitCubicThroughOrigin 非法输入抛错', () => {
    expect(() => fitCubicThroughOrigin([1, 2], [1, 2, 3])).toThrow(RangeError);
    expect(() => fitCubicThroughOrigin([1, 2], [1, 2])).toThrow(RangeError);
    // 样本 t 全为 0 → 正规方程奇异
    expect(() => fitCubicThroughOrigin([0, 0, 0, 0], [0, 1, 2, 3])).toThrow(RangeError);
  });
});

describe('调度族（契约 C2）', () => {
  const slots = makeMeteorSlots(42, 128, PERSEIDS);

  test('makeMeteorSlots：确定性（同种子同产物）与数量', () => {
    expect(slots).toHaveLength(128);
    const again = makeMeteorSlots(42, 128, PERSEIDS);
    expect(again).toEqual(slots);
    const other = makeMeteorSlots(43, 128, PERSEIDS);
    expect(other).not.toEqual(slots);
    expect(() => makeMeteorSlots(42, 0, PERSEIDS)).toThrow(RangeError);
  });

  test('三个独立随机数（契约 C2 反耦合）：aSeed/aGateRank/aFireballRank 两两不相关', () => {
    const pairs: Array<[keyof MeteorSlot, keyof MeteorSlot]> = [
      ['aSeed', 'aGateRank'],
      ['aSeed', 'aFireballRank'],
      ['aGateRank', 'aFireballRank'],
    ];
    for (const [ka, kb] of pairs) {
      const a = slots.map((s) => s[ka] as number);
      const b = slots.map((s) => s[kb] as number);
      // 禁止复用同一随机数：不得逐槽相等
      expect(a.some((v, i) => Math.abs(v - b[i]) > 1e-9)).toBe(true);
      // Pearson 相关系数近零（|ρ| < 0.25，128 样本下强相关必被捕获）
      const meanA = a.reduce((s, v) => s + v, 0) / a.length;
      const meanB = b.reduce((s, v) => s + v, 0) / b.length;
      let cov = 0;
      let varA = 0;
      let varB = 0;
      for (let i = 0; i < a.length; i++) {
        cov += (a[i] - meanA) * (b[i] - meanB);
        varA += (a[i] - meanA) ** 2;
        varB += (b[i] - meanB) ** 2;
      }
      expect(Math.abs(cov / Math.sqrt(varA * varB))).toBeLessThan(0.25);
    }
  });

  test('槽位元数据域：随机数 [0,1)、起点在燃烧层顶、质量档与身份一致', () => {
    for (const slot of slots) {
      for (const key of ['aSeed', 'aGateRank', 'aFireballRank'] as const) {
        expect(slot[key]).toBeGreaterThanOrEqual(0);
        expect(slot[key]).toBeLessThan(1);
      }
      expect(slot.startPos[1]).toBe(BURN_LAYER_TOP_KM);
      expect(Math.hypot(slot.startPos[0], slot.startPos[2])).toBeLessThanOrEqual(300);
      if (slot.isFireball) {
        expect(slot.massKg).toBeGreaterThanOrEqual(1e-2);
        expect(slot.massKg).toBeLessThanOrEqual(1);
      } else {
        expect(slot.massKg).toBeGreaterThanOrEqual(1e-6);
        expect(slot.massKg).toBeLessThanOrEqual(1e-3);
      }
      expect(slot.lifetimeSec).toBeGreaterThan(0.1);
      expect(slot.lifetimeSec).toBeLessThanOrEqual(1.2);
      // 拟合系数可用：寿命末端位移为正且量级合理（km）
      const sEnd = evalCubic(slot.dispCoefs, slot.lifetimeSec);
      expect(sEnd).toBeGreaterThan(5);
      expect(sEnd).toBeLessThan(80);
    }
    // 两类槽位都存在（128 槽位下火流星比例 0.1 应有命中）
    expect(slots.some((s) => s.isFireball)).toBe(true);
    expect(slots.some((s) => !s.isFireball)).toBe(true);
  });

  test('入速差异体现：天鹅座κ（25 km/s）位移系数显著小于英仙座（59 km/s）', () => {
    const kcgSlots = makeMeteorSlots(42, 32, KAPPA_CYGNIDS);
    const perMedian = slots[0].dispCoefs[0];
    const kcgMedian = kcgSlots[0].dispCoefs[0];
    // c₁ ≈ 初速（km/s）：59 vs 25
    expect(perMedian).toBeGreaterThan(40);
    expect(kcgMedian).toBeLessThan(35);
  });

  test('slotPhase 与 shader fract 公式一致', () => {
    expect(slotPhase(0.3, 0, 60)).toBeCloseTo(0.3, 12);
    expect(slotPhase(0.3, 30, 60)).toBeCloseTo(0.8, 12);
    expect(slotPhase(0.3, 60, 60)).toBeCloseTo(0.3, 12);
    expect(slotPhase(0.9, 12, 60)).toBeCloseTo(0.1, 12);
  });

  test('ignitedSlots 与 fract 公式一致：相位回绕瞬间点燃（含跨周期边界）', () => {
    const T = METEOR_CYCLE_PERIOD_SEC;
    const single: MeteorSlot[] = [{ ...slots[0], aSeed: 0.75, aGateRank: 0.0 }];
    // 点燃时刻：aSeed + t/T 过整数 → t = 0.25T + kT
    expect(ignitedSlots(0, 0.24 * T, single, 1)).toEqual([]);
    expect(ignitedSlots(0.24 * T, 0.26 * T, single, 1)).toEqual([0]);
    // 跨周期边界：prev 在第 1 周期末、curr 进入第 2 周期
    expect(ignitedSlots(0.99 * T, 1.01 * T, single, 1)).toEqual([]);
    expect(ignitedSlots(1.2 * T, 1.3 * T, single, 1)).toEqual([0]);
    // 一帧跨多周期也只报一次（floor 差 > 0）
    expect(ignitedSlots(0, 2.5 * T, single, 1)).toEqual([0]);
    // 时间不动 → 空
    expect(ignitedSlots(5, 5, single, 1)).toEqual([]);
    expect(() => ignitedSlots(10, 5, single, 1)).toThrow(RangeError);
    expect(() => ignitedSlots(0, 5, single, 1, 0)).toThrow(RangeError);
  });

  test('门控用 aGateRank 而非 aSeed（契约 C2 反耦合断言）', () => {
    const T = METEOR_CYCLE_PERIOD_SEC;
    // aSeed 大（0.9）但 aGateRank 小（0.1）→ fluxFrac=0.2 时必须能点燃
    const gatedIn: MeteorSlot[] = [{ ...slots[0], aSeed: 0.9, aGateRank: 0.1 }];
    expect(ignitedSlots(0, T, gatedIn, 0.2)).toEqual([0]);
    // aSeed 小（0.1）但 aGateRank 大（0.9）→ fluxFrac=0.2 时必须被剔除
    const gatedOut: MeteorSlot[] = [{ ...slots[0], aSeed: 0.1, aGateRank: 0.9 }];
    expect(ignitedSlots(0, T, gatedOut, 0.2)).toEqual([]);
    // fluxFrac=0 → 全部剔除
    expect(ignitedSlots(0, T, slots, 0)).toEqual([]);
    // fluxFrac=1 → 一整周期内全部点燃一次
    expect(ignitedSlots(0, T, slots, 1)).toHaveLength(slots.length);
  });

  test('激活槽位相位不集中（挤团爆发反例防守，契约 C2）', () => {
    // 门控通过（aGateRank < 0.3）的槽位，其 aSeed 应仍散布全 [0,1) 区间
    const active = slots.filter((s) => s.aGateRank < 0.3).map((s) => s.aSeed);
    expect(active.length).toBeGreaterThan(10);
    expect(Math.max(...active)).toBeGreaterThan(0.7);
    expect(Math.min(...active)).toBeLessThan(0.3);
  });
});

describe('降级判定（§4.5）', () => {
  const desktop = {
    dpr: 2,
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    screenWidth: 2560,
    screenHeight: 1440,
    deviceMemoryGb: 16,
  };

  test('桌面高配 → full', () => {
    expect(labQualityTier(desktop)).toBe('full');
    // deviceMemory 缺失不参与判定
    expect(labQualityTier({ ...desktop, deviceMemoryGb: undefined })).toBe('full');
  });

  test('移动端 UA → reduced', () => {
    expect(
      labQualityTier({
        ...desktop,
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
      })
    ).toBe('reduced');
    expect(
      labQualityTier({ ...desktop, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8)' })
    ).toBe('reduced');
  });

  test('小屏（短边 < 768）→ reduced', () => {
    expect(labQualityTier({ ...desktop, screenWidth: 1400, screenHeight: 700 })).toBe('reduced');
  });

  test('低内存（≤ 4 GB）→ reduced', () => {
    expect(labQualityTier({ ...desktop, deviceMemoryGb: 4 })).toBe('reduced');
  });

  test('高 DPR 小屏（DPR ≥ 3 且短边 < 1024）→ reduced', () => {
    expect(labQualityTier({ ...desktop, dpr: 3, screenWidth: 1366, screenHeight: 900 })).toBe(
      'reduced'
    );
    // 高 DPR 大屏不降级
    expect(labQualityTier({ ...desktop, dpr: 3 })).toBe('full');
  });
});

describe('常量登记（§1.2 / 契约 C5）', () => {
  test('双雨参数与 IAU MDC 登记值一致', () => {
    expect(PERSEIDS).toMatchObject({
      radiantRaDeg: 46,
      radiantDecDeg: 58,
      entrySpeedKmPerSec: 59,
      zhr: 100,
      populationIndex: 2.2,
      epochLst0Deg: 353.5,
    });
    expect(KAPPA_CYGNIDS).toMatchObject({
      radiantRaDeg: 286,
      radiantDecDeg: 59,
      entrySpeedKmPerSec: 25,
      zhr: 3,
      populationIndex: 3.0,
      epochLst0Deg: 310,
    });
    // 天鹅座κ以慢速火流星著称 → 火流星基数更高
    expect(KAPPA_CYGNIDS.fireballSlotFraction).toBeGreaterThan(PERSEIDS.fireballSlotFraction);
  });
});
