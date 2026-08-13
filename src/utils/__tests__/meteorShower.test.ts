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
  ATMOSPHERE_TOP_KM,
  BURN_LAYER_TOP_KM,
  DEFAULT_FIREBALL_RATE,
  DEFAULT_LIMITING_MAG,
  DEFAULT_OBSERVER_LAT_DEG,
  EARTH_RADIUS_KM,
  EPOCH_LOCAL_HOURS,
  FOLLOW_DISTANCE_DEFAULT_KM,
  FOLLOW_DISTANCE_MAX_KM,
  FOLLOW_DISTANCE_MIN_KM,
  FRAGMENT_CONE_HALF_ANGLE_RAD,
  FRAGMENT_MAX_LATERAL_KM,
  KAPPA_CYGNIDS,
  METEOR_CYCLE_PERIOD_SEC,
  METEOR_SLOT_COUNT,
  PERSEIDS,
  SPACE_CAMERA_RADIUS_MAX_UNITS,
  STAR_DOME_RADIUS_UNITS,
  airDensityAtKm,
  equatorialToHorizontalMatrix,
  equatorialUnitVector,
  evalCubic,
  fitCubicThroughOrigin,
  fluxFraction,
  followOrbitPose,
  formatClockHHMM,
  formatDurationClock,
  fragmentLateralMagnitudeKm,
  groundAimPosition,
  horizontalFromEquatorial,
  ignitedSlots,
  labQualityTier,
  labSunDirection,
  localClockHours,
  localSiderealTime,
  makeMeteorSlots,
  nextIgnition,
  pickDemoSlot,
  sceneDirFromAltAz,
  selectAfterglowSlots,
  slotPhase,
  solveAblationRK4,
  spaceAimPosition,
  trailLag,
  truncateAblationCurves,
  visibleHourlyRate,
  type DemoCameraView,
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

  test('M3 周期覆写与历元时刻登记（量化差异见 MeteorShowerParams 注释）', () => {
    expect(PERSEIDS.cyclePeriodSec).toBe(3600);
    expect(KAPPA_CYGNIDS.cyclePeriodSec).toBe(4800);
    expect(EPOCH_LOCAL_HOURS.perseids).toBe(2);
    expect(EPOCH_LOCAL_HOURS.kappaCygnids).toBe(23);
  });
});

describe('M3 渲染/控件联动纯函数（§1.5 / §3 / §4）', () => {
  test('fragmentLateralMagnitudeKm：锥角几何 + 上限钳制', () => {
    // 线性位移 59 km/s、寿命 1 s：崩溃后剩余路径 = 59×0.2 km
    const linear: [number, number, number] = [59, 0, 0];
    const expected = Math.tan(FRAGMENT_CONE_HALF_ANGLE_RAD) * 59 * 0.2;
    expect(fragmentLateralMagnitudeKm(linear, 1)).toBeCloseTo(expected, 10);
    expect(fragmentLateralMagnitudeKm(linear, 1)).toBeLessThan(FRAGMENT_MAX_LATERAL_KM);
    // 超长剩余路径 → 钳到 1 km 上限（§1.5：位移 ≤1 场景单位）
    expect(fragmentLateralMagnitudeKm([500, 0, 0], 1)).toBe(FRAGMENT_MAX_LATERAL_KM);
    // 零位移 → 0（负增量同样钳到 0）
    expect(fragmentLateralMagnitudeKm([0, 0, 0], 1)).toBe(0);
    expect(() => fragmentLateralMagnitudeKm(linear, 0)).toThrow(RangeError);
  });

  test('localClockHours：回绕 [0, 24)', () => {
    expect(localClockHours(2, 0, 0)).toBe(2);
    expect(localClockHours(23, 2, 0)).toBe(1);
    expect(localClockHours(2, -6, 0)).toBe(20);
    expect(localClockHours(23, 0, 1.5)).toBeCloseTo(0.5, 12);
    expect(localClockHours(2, 0, 48)).toBe(2);
  });

  test('formatClockHHMM：HH:MM 格式与归一', () => {
    expect(formatClockHHMM(0)).toBe('00:00');
    expect(formatClockHHMM(1.25)).toBe('01:15');
    expect(formatClockHHMM(23 + 59.9 / 60)).toBe('23:59');
    expect(formatClockHHMM(24.5)).toBe('00:30');
    expect(formatClockHHMM(-0.5)).toBe('23:30');
    expect(() => formatClockHHMM(Number.NaN)).toThrow(RangeError);
  });

  test('selectAfterglowSlots：火流星优先 + 质量降序 + 上限截取', () => {
    const slots = makeMeteorSlots(7, 64, PERSEIDS);
    const picked = selectAfterglowSlots(slots, 20);
    expect(picked).toHaveLength(20);
    const kinds = picked.map((i) => slots[i].isFireball);
    // 分界：火流星段在前、普通段在后（不得交错）
    const firstOrdinary = kinds.indexOf(false);
    expect(firstOrdinary).toBeGreaterThan(0);
    expect(kinds.slice(0, firstOrdinary).every(Boolean)).toBe(true);
    expect(kinds.slice(firstOrdinary).some(Boolean)).toBe(false);
    // 各段内质量降序（亮流星优先，§1.5）
    for (let i = 1; i < picked.length; i++) {
      if (kinds[i] === kinds[i - 1]) {
        expect(slots[picked[i]].massKg).toBeLessThanOrEqual(slots[picked[i - 1]].massKg);
      }
    }
    // 上限超过槽位数 → 全量；确定性；非法上限抛错
    expect(selectAfterglowSlots(slots, 999)).toHaveLength(64);
    expect(selectAfterglowSlots(slots, 20)).toEqual(picked);
    expect(() => selectAfterglowSlots(slots, 0)).toThrow(RangeError);
  });

  test('aGateRank 分层采样：排序后逐名次落在各自 1/N 条带（量化方差消除，登记）', () => {
    const slots = makeMeteorSlots(42, 128, PERSEIDS);
    const ranks = slots.map((s) => s.aGateRank).sort((a, b) => a - b);
    for (let k = 0; k < ranks.length; k++) {
      expect(ranks[k]).toBeGreaterThanOrEqual(k / 128);
      expect(ranks[k]).toBeLessThan((k + 1) / 128);
    }
  });

  test('火流星身份 Bresenham 精确份额 + aFireballRank 随门控名次单调（fireballRate 单调响应）', () => {
    const slots = makeMeteorSlots(42, 200, PERSEIDS);
    expect(slots.filter((s) => s.isFireball)).toHaveLength(200 * PERSEIDS.fireballSlotFraction);
    const fireballs = slots
      .filter((s) => s.isFireball)
      .sort((a, b) => a.aGateRank - b.aGateRank);
    for (let i = 1; i < fireballs.length; i++) {
      expect(fireballs[i].aFireballRank).toBeGreaterThan(fireballs[i - 1].aFireballRank);
    }
  });

  test('默认观测条件下双雨激活槽位 ≥1 且数量与 HR×T/3600 一致（周期覆写锁定）', () => {
    for (const shower of [PERSEIDS, KAPPA_CYGNIDS]) {
      const lst = localSiderealTime(shower.epochLst0Deg, 0, 0);
      const radiant = horizontalFromEquatorial(
        shower.radiantRaDeg,
        shower.radiantDecDeg,
        DEFAULT_OBSERVER_LAT_DEG,
        lst
      );
      const hr = visibleHourlyRate(
        shower.zhr,
        shower.populationIndex,
        radiant.altRad,
        DEFAULT_LIMITING_MAG
      );
      const flux = fluxFraction(hr, METEOR_SLOT_COUNT, shower.cyclePeriodSec);
      const slots = makeMeteorSlots(1, METEOR_SLOT_COUNT, shower);
      const active = slots.filter((s) => s.aGateRank < flux);
      // 低流量雨不得量化归零（T=60 时天鹅座κ期望 0.026 槽 → 恒空，登记差异动机）
      expect(active.length).toBeGreaterThanOrEqual(1);
      // 分层门控下激活数 = 期望值 ±1（速率恒等于 HR/3600，物理速率不受 T 影响）
      expect(Math.abs(active.length - (hr * shower.cyclePeriodSec) / 3600)).toBeLessThanOrEqual(1);
    }
  });

  test('天鹅座κ默认条件：激活集含火流星候选且默认 fireballRate 即激活（目验可达性）', () => {
    const lst = localSiderealTime(KAPPA_CYGNIDS.epochLst0Deg, 0, 0);
    const radiant = horizontalFromEquatorial(
      KAPPA_CYGNIDS.radiantRaDeg,
      KAPPA_CYGNIDS.radiantDecDeg,
      DEFAULT_OBSERVER_LAT_DEG,
      lst
    );
    const hr = visibleHourlyRate(
      KAPPA_CYGNIDS.zhr,
      KAPPA_CYGNIDS.populationIndex,
      radiant.altRad,
      DEFAULT_LIMITING_MAG
    );
    const flux = fluxFraction(hr, METEOR_SLOT_COUNT, KAPPA_CYGNIDS.cyclePeriodSec);
    const slots = makeMeteorSlots(1, METEOR_SLOT_COUNT, KAPPA_CYGNIDS);
    const visibleFireballs = slots.filter(
      (s) => s.aGateRank < flux && s.isFireball && s.aFireballRank < DEFAULT_FIREBALL_RATE
    );
    expect(visibleFireballs.length).toBeGreaterThanOrEqual(1);
    // 普通流星同样在激活集内（默认体验非"全火流星"）
    expect(slots.some((s) => s.aGateRank < flux && !s.isFireball)).toBe(true);
  });
});

describe('M3.5 目验辅助纯函数（§M3.5-1）', () => {
  /** 最小合成槽位（调度/挑选/位姿测试用；物理场无关字段取占位值） */
  const mkSlot = (over: Partial<MeteorSlot> = {}): MeteorSlot => ({
    aSeed: 0.5,
    aGateRank: 0.1,
    aFireballRank: 0.5,
    isFireball: false,
    startPos: [0, 115, 0],
    lifetimeSec: 1,
    massKg: 1e-4,
    dispCoefs: [40, 0, 0],
    intenCoefs: [1, 0, 0],
    ...over,
  });

  describe('nextIgnition（契约 C2 前瞻镜像）', () => {
    test('解析解 = 逐槽位回绕公式的最小值（门控同式过滤）', () => {
      const slots = makeMeteorSlots(11, 40, KAPPA_CYGNIDS);
      const T = KAPPA_CYGNIDS.cyclePeriodSec;
      const from = 987.6;
      const flux = 0.5;
      const fb = 0.6;
      const expected = slots
        .map((s, i) => ({ i, t: (Math.floor(s.aSeed + from / T) + 1 - s.aSeed) * T }))
        .filter(({ i }) => {
          const s = slots[i];
          return s.aGateRank < flux && (!s.isFireball || s.aFireballRank < fb);
        })
        .sort((a, b) => a.t - b.t)[0];
      const got = nextIgnition(slots, flux, fb, from, T, false);
      expect(got).not.toBeNull();
      expect(got!.slotIndex).toBe(expected.i);
      expect(got!.igniteAtSec).toBeCloseTo(expected.t, 9);
    });

    test('与 ignitedSlots 交叉锁定：点燃瞬间被镜像捕获、此前无更早候选', () => {
      const slots = makeMeteorSlots(7, 64, PERSEIDS);
      const T = PERSEIDS.cyclePeriodSec;
      const flux = 0.25;
      const fb = DEFAULT_FIREBALL_RATE;
      let from = 123.456;
      for (let k = 0; k < 5; k++) {
        const next = nextIgnition(slots, flux, fb, from, T, false);
        expect(next).not.toBeNull();
        const { slotIndex, igniteAtSec } = next!;
        expect(igniteAtSec).toBeGreaterThan(from);
        const eps = 1e-6 * T;
        // 点燃瞬间：ignitedSlots(igniteAt−ε, igniteAt+ε] 捕获该槽位
        expect(ignitedSlots(igniteAtSec - eps, igniteAtSec + eps, slots, flux, T)).toContain(
          slotIndex
        );
        // (from, igniteAt−ε] 内无同门控口径的更早点燃（ignitedSlots 只带流量
        // 门控，需按 nextIgnition 口径补火流星门控过滤后为空）
        if (igniteAtSec - eps > from) {
          const earlier = ignitedSlots(from, igniteAtSec - eps, slots, flux, T).filter(
            (i) => !slots[i].isFireball || slots[i].aFireballRank < fb
          );
          expect(earlier).toHaveLength(0);
        }
        from = igniteAtSec;
      }
    });

    test('fireballOnly：只扫火流星槽位', () => {
      const slots = makeMeteorSlots(7, 64, PERSEIDS);
      const T = PERSEIDS.cyclePeriodSec;
      const got = nextIgnition(slots, 1, 1, 0, T, true);
      expect(got).not.toBeNull();
      expect(slots[got!.slotIndex].isFireball).toBe(true);
      // 火流星候选时刻 ≥ 全量候选时刻（子集最小值不早于全集）
      const all = nextIgnition(slots, 1, 1, 0, T, false);
      expect(got!.igniteAtSec).toBeGreaterThanOrEqual(all!.igniteAtSec);
    });

    test('无候选：流量为零 / 火流星门控全关 → null；非法周期抛错', () => {
      const slots = makeMeteorSlots(7, 32, PERSEIDS);
      expect(nextIgnition(slots, 0, 1, 0, 3600, false)).toBeNull();
      expect(nextIgnition(slots, 1, 0, 0, 3600, true)).toBeNull();
      expect(nextIgnition([], 1, 1, 0, 3600, false)).toBeNull();
      expect(() => nextIgnition(slots, 1, 1, 0, 0, false)).toThrow(RangeError);
    });

    test('严格 > from：从点燃时刻再查询给出严格更晚时刻（单调推进）', () => {
      const slot = mkSlot({ aSeed: 0.25 });
      const T = 100;
      const first = nextIgnition([slot], 1, 1, 0, T, false);
      // t = (⌊0.25⌋ + 1 − 0.25) × 100 = 75
      expect(first!.igniteAtSec).toBeCloseTo(75, 10);
      const second = nextIgnition([slot], 1, 1, first!.igniteAtSec, T, false);
      expect(second!.igniteAtSec).toBeCloseTo(175, 9);
    });
  });

  describe('pickDemoSlot v2（M3.6-1 视锥感知；契约 C1 签名变更）', () => {
    const velocityDir: [number, number, number] = [0, -1, 0];
    /** 视锥描述便捷构造（默认北望地平、fovY 90°、方形视口） */
    const mkView = (over: Partial<DemoCameraView> = {}): DemoCameraView => ({
      position: [0, 0, 0],
      viewDir: [0, 0, -1],
      upDir: [0, 1, 0],
      fovYRad: Math.PI / 2,
      aspect: 1,
      ...over,
    });

    test('全轨迹入视锥者胜出：needsAim=false，midPoint = 轨迹中点', () => {
      // dispCoefs [40,0,0]、寿命 1：start y=115 → end y=75、中点 y=95
      const north = mkSlot({ startPos: [0, 100, -200] }); // 视野中心附近（|y/z|≤0.85）
      const behind = mkSlot({ startPos: [0, 100, 200] }); // 背向相机
      const pick = pickDemoSlot([behind, north], velocityDir, mkView(), false);
      expect(pick).not.toBeNull();
      expect(pick!.slotIndex).toBe(1);
      expect(pick!.needsAim).toBe(false);
      expect(pick!.midPoint).toEqual([0, 100 - 20, -200]);
    });

    test('边距锚点：起点在名义 FOV 内但超 15% 边距 → 过滤（needsAim 保底）', () => {
      // fovY 90°：名义 |y/z| ≤ 1，边距后 ≤ 0.85——起点 y/z = 0.9 越界
      const marginal = mkSlot({ startPos: [0, 180, -200] });
      const pick = pickDemoSlot([marginal], velocityDir, mkView(), false);
      expect(pick).not.toBeNull();
      expect(pick!.needsAim).toBe(true);
      // 起点 y/z = 0.8 且烧尽点 y/z = 0.7 均在边距内 → 合格
      const inside = mkSlot({ startPos: [0, 160, -200] });
      expect(pickDemoSlot([inside], velocityDir, mkView(), false)!.needsAim).toBe(false);
    });

    test('起点入画但烧尽点出画 → 整条轨迹不合格（硬性双端判定）', () => {
      // 起点 y/z=0.825 入画；烧尽点 y = 205−40 = 165 → 后仰视角高于边距？
      // 用超近距设计：start (0, 30, −40)：起点 y/z = 0.75 ✓，烧尽点 y = −10
      // → y/z = −0.25 ✓仍入画；改用横向出画：start (30, 30, −40) x/z=0.75 ✓
      // 烧尽点 x 不变但 y=−10 ✓——需纵深出画：velocity 朝相机 [0,0,1]
      const towardCamera = mkSlot({ startPos: [0, 0, -30] }); // 烧尽点 z = −30+40 = +10：背向
      const pick = pickDemoSlot([towardCamera], [0, 0, 1], mkView(), false);
      expect(pick!.needsAim).toBe(true);
    });

    test('needsAim 保底 = 全域最优（中点方向最贴近视线，原 M3.5 评分）', () => {
      const sideways = mkSlot({ startPos: [300, 115, -50] }); // 中点偏东（视野外）
      const behind = mkSlot({ startPos: [0, 115, 300] }); // 中点背向
      const pick = pickDemoSlot([behind, sideways], velocityDir, mkView(), false);
      expect(pick!.slotIndex).toBe(1);
      expect(pick!.needsAim).toBe(true);
      expect(pick!.midPoint).toEqual([300, 95, -50]);
    });

    test('fireballOnly：入画的普通槽位在场时仍只挑火流星', () => {
      const ordinary = mkSlot({ startPos: [0, 100, -200] });
      const fireball = mkSlot({ startPos: [300, 115, -50], isFireball: true });
      const pick = pickDemoSlot([ordinary, fireball], velocityDir, mkView(), true);
      expect(pick!.slotIndex).toBe(1);
      expect(pick!.needsAim).toBe(true);
    });

    test('upDir 与视线平行（仰望天顶）退化：兜底基有限且正常挑选', () => {
      const overhead = mkSlot({ startPos: [0, 115, 0] });
      const view = mkView({ viewDir: [0, 1, 0], upDir: [0, 1, 0] });
      const pick = pickDemoSlot([overhead], velocityDir, view, false);
      expect(pick!.slotIndex).toBe(0);
      expect(pick!.needsAim).toBe(false);
    });

    test('退化：无候选/中点与相机重合 → null；非法视锥抛错', () => {
      const ordinary = mkSlot();
      expect(pickDemoSlot([ordinary], velocityDir, mkView(), true)).toBeNull();
      // 相机恰在中点 (0,95,0)：方向未定义 → 跳过 → null
      expect(
        pickDemoSlot([ordinary], velocityDir, mkView({ position: [0, 95, 0] }), false)
      ).toBeNull();
      expect(() =>
        pickDemoSlot([ordinary], velocityDir, mkView({ viewDir: [0, 0, 0] }), false)
      ).toThrow(RangeError);
      expect(() => pickDemoSlot([ordinary], velocityDir, mkView({ fovYRad: 0 }), false)).toThrow(
        RangeError
      );
      expect(() => pickDemoSlot([ordinary], velocityDir, mkView({ aspect: 0 }), false)).toThrow(
        RangeError
      );
    });
  });

  describe('aim 目标机位（M3.6-1，决策 A1 自动运镜）', () => {
    test('groundAimPosition：反转轨道范式——机位 = −normalize(mid)×radius', () => {
      const mid: [number, number, number] = [100, 100, -50];
      const r = 1.2;
      const pos = groundAimPosition(mid, r);
      const midLen = Math.hypot(...mid);
      expect(Math.hypot(...pos)).toBeCloseTo(r, 10);
      // lookAt 原点即正对中点：pos 与 mid 反向共线
      for (let i = 0; i < 3; i++) {
        expect(pos[i]).toBeCloseTo((-mid[i] / midLen) * r, 10);
      }
      expect(() => groundAimPosition([0, 0, 0], 1)).toThrow(RangeError);
      expect(() => groundAimPosition(mid, 0)).toThrow(RangeError);
    });

    test('spaceAimPosition：中点—target—相机共线（lookAt target 时中点居中偏后）', () => {
      const mid: [number, number, number] = [100, 95, -50];
      const target: [number, number, number] = [0, 97, 0];
      const dist = 500;
      const pos = spaceAimPosition(mid, target, dist);
      // 相机—target 距离 = dist
      const d = Math.hypot(pos[0] - target[0], pos[1] - target[1], pos[2] - target[2]);
      expect(d).toBeCloseTo(dist, 9);
      // 相机—target 与 target—mid 同向（中点在 target 正后方）
      const tm = Math.hypot(target[0] - mid[0], target[1] - mid[1], target[2] - mid[2]);
      for (let i = 0; i < 3; i++) {
        expect((pos[i] - target[i]) / dist).toBeCloseTo((target[i] - mid[i]) / tm, 10);
      }
      expect(() => spaceAimPosition(target, target, 500)).toThrow(RangeError);
      expect(() => spaceAimPosition(mid, target, 0)).toThrow(RangeError);
    });
  });

  describe('followOrbitPose（M3.6-2 环绕位姿；契约 C1 签名变更）', () => {
    const startPos: [number, number, number] = [10, 115, -5];
    const dispCoefs: [number, number, number] = [50, -10, 1];
    const lifetime = 1;
    const vRaw: [number, number, number] = [1, -2, 0.5];
    const vLen = Math.hypot(...vRaw);
    const v: [number, number, number] = [vRaw[0] / vLen, vRaw[1] / vLen, vRaw[2] / vLen];
    const dist = FOLLOW_DISTANCE_DEFAULT_KM;

    test('target = 流星头部（shader 位移公式 CPU 镜像）', () => {
      for (const t of [0, 0.3, 0.7, 1]) {
        const disp = evalCubic(dispCoefs, t);
        const pose = followOrbitPose(startPos, dispCoefs, lifetime, v, t, 0, 0, dist);
        expect(pose.target[0]).toBeCloseTo(startPos[0] + v[0] * disp, 10);
        expect(pose.target[1]).toBeCloseTo(startPos[1] + v[1] * disp, 10);
        expect(pose.target[2]).toBeCloseTo(startPos[2] + v[2] * disp, 10);
      }
    });

    test('默认 az=0/elev=0：纯侧视（视线 ⊥ v）且视线水平（⊥ up）', () => {
      const { position, target } = followOrbitPose(startPos, dispCoefs, lifetime, v, 0.5, 0, 0, dist);
      const look = [target[0] - position[0], target[1] - position[1], target[2] - position[2]];
      expect(look[0] * v[0] + look[1] * v[1] + look[2] * v[2]).toBeCloseTo(0, 10);
      expect(look[1]).toBeCloseTo(0, 10); // 水平：视线 up 分量为零
    });

    test('任意方位/仰角下相机—头部距离恒等于 distanceKm', () => {
      for (const az of [0, 0.7, Math.PI, 4.2, -1.3]) {
        for (const el of [0, 0.5, -0.9, 1.2]) {
          for (const d of [FOLLOW_DISTANCE_MIN_KM, dist, FOLLOW_DISTANCE_MAX_KM]) {
            const { position, target } = followOrbitPose(
              startPos,
              dispCoefs,
              lifetime,
              v,
              0.5,
              az,
              el,
              d
            );
            const got = Math.hypot(
              position[0] - target[0],
              position[1] - target[1],
              position[2] - target[2]
            );
            expect(got).toBeCloseTo(d, 10);
          }
        }
      }
    });

    test('仰角正方向：elev>0 时相机移向速度反方向一侧（offset·v = −sinE）', () => {
      const el = 0.6;
      const { position, target } = followOrbitPose(
        startPos,
        dispCoefs,
        lifetime,
        v,
        0.5,
        0,
        el,
        dist
      );
      const off = [
        (position[0] - target[0]) / dist,
        (position[1] - target[1]) / dist,
        (position[2] - target[2]) / dist,
      ];
      expect(off[0] * v[0] + off[1] * v[1] + off[2] * v[2]).toBeCloseTo(-Math.sin(el), 10);
    });

    test('elapsed 钳制 [0, lifetime]：烧尽后驻留烧尽点（无落地，科学红线）', () => {
      const atEnd = followOrbitPose(startPos, dispCoefs, lifetime, v, lifetime, 1, 0.3, dist);
      const after = followOrbitPose(startPos, dispCoefs, lifetime, v, lifetime + 5, 1, 0.3, dist);
      expect(after).toEqual(atEnd);
      const atStart = followOrbitPose(startPos, dispCoefs, lifetime, v, 0, 1, 0.3, dist);
      const before = followOrbitPose(startPos, dispCoefs, lifetime, v, -1, 1, 0.3, dist);
      expect(before).toEqual(atStart);
    });

    test('铅垂速度退化：+X 兜底正交化，位姿有限且距离不变', () => {
      const vertical: [number, number, number] = [0, -1, 0];
      const pose = followOrbitPose([0, 115, 0], dispCoefs, lifetime, vertical, 0.5, 0.4, 0.2, dist);
      expect(pose.position.every(Number.isFinite)).toBe(true);
      const d = Math.hypot(
        pose.position[0] - pose.target[0],
        pose.position[1] - pose.target[1],
        pose.position[2] - pose.target[2]
      );
      expect(d).toBeCloseTo(dist, 10);
    });

    test('非法寿命/距离抛错', () => {
      expect(() => followOrbitPose(startPos, dispCoefs, 0, v, 0, 0, 0, dist)).toThrow(RangeError);
      expect(() => followOrbitPose(startPos, dispCoefs, lifetime, v, 0, 0, 0, 0)).toThrow(
        RangeError
      );
    });
  });

  describe('labSunDirection（M3.6-3 昼夜 terminator 驱动）', () => {
    test('12:00 正午：太阳高度角高正（lat 40° → sinAlt = cos26° ≈ 0.899）', () => {
      const dir = labSunDirection(12, 40);
      expect(dir[1]).toBeCloseTo(Math.cos((40 - 14) * DEG), 6);
      expect(Math.hypot(...dir)).toBeCloseTo(1, 10);
    });

    test('02:00 凌晨（英仙座历元）：太阳深居地平下（夜面 + 城市夜灯前提）', () => {
      const dir = labSunDirection(2, 40);
      expect(dir[1]).toBeLessThan(-0.4);
      expect(Math.hypot(...dir)).toBeCloseTo(1, 10);
    });

    test('非法输入抛错', () => {
      expect(() => labSunDirection(Number.NaN, 40)).toThrow(RangeError);
      expect(() => labSunDirection(2, Number.POSITIVE_INFINITY)).toThrow(RangeError);
    });
  });

  describe('trailLag（M3.6-4① 条痕头密尾疏分布）', () => {
    test('端点锁定 0/1 且严格单调递增', () => {
      const n = 48;
      expect(trailLag(0, n)).toBe(0);
      expect(trailLag(n - 1, n)).toBe(1);
      for (let k = 1; k < n; k++) {
        expect(trailLag(k, n)).toBeGreaterThan(trailLag(k - 1, n));
      }
    });

    test('头部相邻间距 < 尾部（exponent 1.6 非线性压缩）', () => {
      const n = 48;
      const headGap = trailLag(1, n) - trailLag(0, n);
      const tailGap = trailLag(n - 1, n) - trailLag(n - 2, n);
      expect(headGap).toBeLessThan(tailGap);
    });

    test('exponent=1 退化为线性；非法输入抛错', () => {
      expect(trailLag(12, 25, 1)).toBeCloseTo(0.5, 10);
      expect(() => trailLag(0, 1)).toThrow(RangeError);
      expect(() => trailLag(-1, 48)).toThrow(RangeError);
      expect(() => trailLag(48, 48)).toThrow(RangeError);
      expect(() => trailLag(0.5, 48)).toThrow(RangeError);
      expect(() => trailLag(0, 48, 0)).toThrow(RangeError);
    });
  });

  describe('M3.6 契约 C5 常量联动（回写 §0.3 的实现锚点）', () => {
    test('星穹 10000 / 太空半径上限 3000 / 地球 1:1 / 大气顶盖燃烧层', () => {
      expect(STAR_DOME_RADIUS_UNITS).toBe(10000);
      expect(SPACE_CAMERA_RADIUS_MAX_UNITS).toBe(3000);
      expect(EARTH_RADIUS_KM).toBe(6371); // 科学准确性红线：禁止艺术缩放
      expect(ATMOSPHERE_TOP_KM).toBeGreaterThanOrEqual(BURN_LAYER_TOP_KM);
      // 太空档最远 3000 km 视地平 limb 斜距 < 星穹半径（防星点穿地球边缘）
      const h = SPACE_CAMERA_RADIUS_MAX_UNITS;
      const limbDist = Math.sqrt((EARTH_RADIUS_KM + h) ** 2 - EARTH_RADIUS_KM ** 2);
      expect(limbDist).toBeLessThan(STAR_DOME_RADIUS_UNITS);
      // 地面档视差重核：漫游半径 1.5 / 星穹 10000 = 0.015% < 0.05% 红线
      expect(1.5 / STAR_DOME_RADIUS_UNITS).toBeLessThan(0.0005);
    });
  });

  describe('formatDurationClock（倒计时格式化）', () => {
    test('m:ss（< 1 h）与 h:mm:ss（≥ 1 h）', () => {
      expect(formatDurationClock(0)).toBe('0:00');
      expect(formatDurationClock(1)).toBe('0:01');
      expect(formatDurationClock(90)).toBe('1:30');
      expect(formatDurationClock(600)).toBe('10:00');
      expect(formatDurationClock(3661)).toBe('1:01:01');
      expect(formatDurationClock(7200)).toBe('2:00:00');
    });

    test('向上取整（倒计时口径）与负值钳制', () => {
      expect(formatDurationClock(0.4)).toBe('0:01');
      expect(formatDurationClock(59.2)).toBe('1:00');
      expect(formatDurationClock(3599.5)).toBe('1:00:00');
      expect(formatDurationClock(-5)).toBe('0:00');
    });

    test('非有限输入抛错', () => {
      expect(() => formatDurationClock(Number.NaN)).toThrow(RangeError);
      expect(() => formatDurationClock(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    });
  });
});
