/**
 * LE-M1 月食几何/丹戎纯函数层单测（需求 §M1-4 逐条锚点）：
 * - 影锥半径双锚点：月距 0.72/1.28 R⊕（容差断言）+ 卫星距与 earthShadow.ts
 *   圆柱互差 <3%（双模型适用域互证——真锥函数正确性的最强机器证据）；
 * - 锥长 ∈ [135, 145] 万 km；食分三态边界 ↔ kind；
 * - umbraShading 径向单调 + 丹戎五档次序；penumbraShading 幅度上限（红线 ②）；
 * - 月光极限星等满月/全食两端锚点；对冲因子 0° 峰值；东西镜像防守；
 * - 插值端点钳制（复用日食契约 C7 interpolateEphemeris，不重复实现的消费侧锁定）。
 */
import {
  DANJON_SHADOW_ENLARGEMENT,
  DANJON_UMBRA_PRESETS,
  EARTH_EQUATORIAL_RADIUS_KM,
  EARTH_RING_GAIN,
  FULL_MOON_LM_SUPPRESSION_MAG,
  NO_ECLIPSE_MAGNITUDE,
  OPPOSITION_SURGE_AMPLITUDE,
  PENUMBRA_SHADING_MAX_DIM,
  earthRingColor,
  lunarEclipseKind,
  moonlightLimitingMagDelta,
  oppositionSurgeFactor,
  penumbraRadiusKmAt,
  penumbraShading,
  penumbralMagnitude,
  shadowAxisGeometryKm,
  shadowAxisOffsetKm,
  turbidityToDanjonL,
  umbraConeLengthKm,
  umbraRadiusKmAt,
  umbraShading,
  umbralMagnitude,
  type ShadingRgb,
} from '../lunarEclipse';
import { UMBRA_INNER_FACTOR, UMBRA_OUTER_FACTOR } from '../earthShadow';
import {
  MOON_MEAN_RADIUS_KM,
  interpolateEphemeris,
  altAzToSceneDirection,
} from '../solarEclipse';

/** 月地平均距离 / 日地平均距离（km，锚点口径） */
const MOON_DIST_KM = 384400;
const SUN_DIST_KM = 1.496e8;

/** Rec.709 感知亮度 */
function luma(rgb: ShadingRgb): number {
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}

describe('影锥真锥半径（契约 C1，月距/卫星距双锚点）', () => {
  it('月距处本影 ≈ 0.72 R⊕、半影 ≈ 1.28 R⊕（纯几何锥，底稿 §一锚点）', () => {
    const rU = umbraRadiusKmAt(MOON_DIST_KM, SUN_DIST_KM, 0);
    const rP = penumbraRadiusKmAt(MOON_DIST_KM, SUN_DIST_KM, 0);
    expect(rU / EARTH_EQUATORIAL_RADIUS_KM).toBeCloseTo(0.72, 1);
    expect(Math.abs(rU - 4600)).toBeLessThan(90);
    expect(rP / EARTH_EQUATORIAL_RADIUS_KM).toBeCloseTo(1.28, 1);
    expect(Math.abs(rP - 8200)).toBeLessThan(150);
  });

  it('Danjon 放大（缺省 1.01 因子）本影略大于纯几何锥且比值 ≈ 放大量级', () => {
    const r0 = umbraRadiusKmAt(MOON_DIST_KM, SUN_DIST_KM, 0);
    const rD = umbraRadiusKmAt(MOON_DIST_KM, SUN_DIST_KM);
    expect(rD).toBeGreaterThan(r0);
    // 视差项 ×1.01 → 本影半径放大约 1.4%（放大量被 −Ss+Ps 项杠杆放大）
    expect(rD / r0).toBeGreaterThan(1.005);
    expect(rD / r0).toBeLessThan(1.03);
    expect(rD / EARTH_EQUATORIAL_RADIUS_KM).toBeGreaterThan(0.72);
    expect(rD / EARTH_EQUATORIAL_RADIUS_KM).toBeLessThan(0.75);
  });

  it('卫星距（3.6 万 km）与 earthShadow.ts 圆柱互差 < 3%（双模型适用域互证）', () => {
    const satDistKm = 36000;
    for (const enlargement of [0, DANJON_SHADOW_ENLARGEMENT]) {
      const rU = umbraRadiusKmAt(satDistKm, SUN_DIST_KM, enlargement);
      // 圆柱近似 = R⊕ 本身；earthShadow.ts 文件头登记「<3.6 万 km 处锥体收缩 <3%」
      expect(Math.abs(rU - EARTH_EQUATORIAL_RADIUS_KM) / EARTH_EQUATORIAL_RADIUS_KM).toBeLessThan(
        0.03
      );
      // 真锥值落在 earthShadow 的 smoothstep 软化带 [0.92, 1.12]·R 内
      expect(rU).toBeGreaterThan(UMBRA_INNER_FACTOR * EARTH_EQUATORIAL_RADIUS_KM);
      expect(rU).toBeLessThan(UMBRA_OUTER_FACTOR * EARTH_EQUATORIAL_RADIUS_KM);
    }
  });

  it('月距处固定系数已失效（0.92 R⊕ 偏大 ~27%——禁复用常数的量化依据）', () => {
    const rU = umbraRadiusKmAt(MOON_DIST_KM, SUN_DIST_KM, 0);
    const cylinder = UMBRA_INNER_FACTOR * EARTH_EQUATORIAL_RADIUS_KM;
    expect(cylinder / rU).toBeGreaterThan(1.2);
  });

  it('本影锥长 ∈ [135, 145] 万 km（两种放大约定均在域内）', () => {
    for (const enlargement of [0, DANJON_SHADOW_ENLARGEMENT]) {
      const lengthKm = umbraConeLengthKm(SUN_DIST_KM, enlargement);
      expect(lengthKm).toBeGreaterThan(1.35e6);
      expect(lengthKm).toBeLessThan(1.45e6);
      // 锥长处半径归零、锥外为 0
      expect(umbraRadiusKmAt(lengthKm, SUN_DIST_KM, enlargement)).toBeLessThan(1);
      expect(umbraRadiusKmAt(lengthKm * 1.05, SUN_DIST_KM, enlargement)).toBe(0);
    }
  });

  it('锥长 ≈ 3.7 × 月距（底稿 §一「月球只走到锥长 27%」的量化）', () => {
    const ratio = umbraConeLengthKm(SUN_DIST_KM, 0) / MOON_DIST_KM;
    expect(ratio).toBeGreaterThan(3.5);
    expect(ratio).toBeLessThan(3.8);
  });

  it('非法入参抛 RangeError（单位红线防守）', () => {
    expect(() => umbraRadiusKmAt(NaN, SUN_DIST_KM)).toThrow(RangeError);
    expect(() => umbraRadiusKmAt(MOON_DIST_KM, NaN)).toThrow(RangeError);
    expect(() => umbraRadiusKmAt(MOON_DIST_KM, SUN_DIST_KM, NaN)).toThrow(RangeError);
    expect(() => umbraRadiusKmAt(6000, SUN_DIST_KM)).toThrow(RangeError); // ≤ R⊕
    expect(() => umbraRadiusKmAt(MOON_DIST_KM, 1000)).toThrow(RangeError); // ≤ R☉
    expect(() => umbraRadiusKmAt(MOON_DIST_KM, SUN_DIST_KM, -0.1)).toThrow(RangeError);
    expect(() => penumbraRadiusKmAt(6000, SUN_DIST_KM)).toThrow(RangeError);
    expect(() => umbraConeLengthKm(1000)).toThrow(RangeError);
    expect(() => umbraConeLengthKm(SUN_DIST_KM, -1)).toThrow(RangeError);
    expect(() => umbraConeLengthKm(NaN)).toThrow(RangeError);
  });
});

describe('影轴几何与双食分（契约 C1）', () => {
  const sunPos: [number, number, number] = [SUN_DIST_KM, 0, 0];
  /** 望态月球位置：背日向 + 垂距 y */
  const moonAt = (perpKm: number): [number, number, number] => [-MOON_DIST_KM, perpKm, 0];

  it('影轴垂距与轴向投影（骨架沿 earthShadow.ts 手法，常数零复用）', () => {
    const g = shadowAxisGeometryKm(sunPos, moonAt(1234));
    expect(g.axialKm).toBeCloseTo(MOON_DIST_KM, 6);
    expect(g.perpKm).toBeCloseTo(1234, 6);
    expect(shadowAxisOffsetKm(sunPos, moonAt(1234))).toBeCloseTo(1234, 6);
  });

  it('东西镜像防守：垂距/食分对影轴两侧严格对称', () => {
    for (const perp of [500, 3000, 8000]) {
      const plus: [number, number, number] = [-MOON_DIST_KM, perp, 0];
      const minus: [number, number, number] = [-MOON_DIST_KM, -perp, 0];
      const zSide: [number, number, number] = [-MOON_DIST_KM, 0, perp];
      expect(shadowAxisOffsetKm(sunPos, plus)).toBeCloseTo(shadowAxisOffsetKm(sunPos, minus), 9);
      expect(umbralMagnitude(sunPos, plus)).toBeCloseTo(umbralMagnitude(sunPos, minus), 12);
      expect(umbralMagnitude(sunPos, plus)).toBeCloseTo(umbralMagnitude(sunPos, zSide), 12);
    }
  });

  it('食分三态边界 ↔ kind（<0 半影食 / 0–1 偏食 / >1 全食）', () => {
    const rU = umbraRadiusKmAt(MOON_DIST_KM, SUN_DIST_KM);
    const rP = penumbraRadiusKmAt(MOON_DIST_KM, SUN_DIST_KM);
    const kindAt = (perpKm: number): string =>
      lunarEclipseKind(
        umbralMagnitude(sunPos, moonAt(perpKm)),
        penumbralMagnitude(sunPos, moonAt(perpKm))
      );

    // 影心：食分最大 >1 → total
    expect(umbralMagnitude(sunPos, moonAt(0))).toBeGreaterThan(1);
    expect(kindAt(0)).toBe('total');
    // 食既边界（垂距 = rU − R月）：食分恰 1
    expect(umbralMagnitude(sunPos, moonAt(rU - MOON_MEAN_RADIUS_KM))).toBeCloseTo(1, 9);
    // 偏食带
    expect(kindAt(rU)).toBe('partial');
    const midMag = umbralMagnitude(sunPos, moonAt(rU));
    expect(midMag).toBeGreaterThan(0);
    expect(midMag).toBeLessThan(1);
    // 本影外切（垂距 = rU + R月）：本影食分恰 0 → penumbral
    expect(umbralMagnitude(sunPos, moonAt(rU + MOON_MEAN_RADIUS_KM))).toBeCloseTo(0, 9);
    expect(kindAt(rU + MOON_MEAN_RADIUS_KM)).toBe('penumbral');
    // 半影带
    expect(kindAt((rU + rP) / 2 + MOON_MEAN_RADIUS_KM)).toBe('penumbral');
    // 半影外切之外：none
    expect(penumbralMagnitude(sunPos, moonAt(rP + MOON_MEAN_RADIUS_KM))).toBeCloseTo(0, 9);
    expect(kindAt(rP + MOON_MEAN_RADIUS_KM + 1)).toBe('none');
  });

  it('向日侧（朔）返回无食哨兵 → none', () => {
    const newMoon: [number, number, number] = [MOON_DIST_KM, 0, 0];
    expect(umbralMagnitude(sunPos, newMoon)).toBe(NO_ECLIPSE_MAGNITUDE);
    expect(penumbralMagnitude(sunPos, newMoon)).toBe(NO_ECLIPSE_MAGNITUDE);
    expect(lunarEclipseKind(NO_ECLIPSE_MAGNITUDE, NO_ECLIPSE_MAGNITUDE)).toBe('none');
  });

  it('kind 边界约定：umbral=0 归 penumbral、=1 归 total；非法入参抛错', () => {
    expect(lunarEclipseKind(0, 0.5)).toBe('penumbral');
    expect(lunarEclipseKind(1, 2)).toBe('total');
    expect(lunarEclipseKind(0.5, 1.5)).toBe('partial');
    expect(lunarEclipseKind(-0.1, 0)).toBe('none');
    expect(() => lunarEclipseKind(NaN, 1)).toThrow(RangeError);
    expect(() => lunarEclipseKind(1, NaN)).toThrow(RangeError);
    expect(() => shadowAxisGeometryKm([0, 0, 0], [1, 2, 3])).toThrow(RangeError);
    expect(() => shadowAxisGeometryKm([NaN, 0, 0], [1, 2, 3])).toThrow(RangeError);
    expect(() => shadowAxisGeometryKm([1, 0, 0], [1, NaN, 3])).toThrow(RangeError);
  });
});

describe('umbraShading 丹戎径向着色（契约 C1/C4 红线 ①）', () => {
  it('径向严格单调：任意档位中心暗于外缘（禁均匀变暗）', () => {
    for (const danjonL of [0, 0.5, 1, 2, 2.7, 3, 4]) {
      let prev = -1;
      for (let r = 0; r <= 1.0001; r += 0.1) {
        const bright = luma(umbraShading(Math.min(r, 1), danjonL));
        expect(bright).toBeGreaterThan(prev);
        prev = bright;
      }
    }
  });

  it('丹戎五档次序：L0 全域暗于 L1 … 暗于 L4（档间亮度严格递增）', () => {
    for (const r of [0, 0.3, 0.7, 1]) {
      for (let l = 0; l < 4; l += 1) {
        expect(luma(umbraShading(r, l))).toBeLessThan(luma(umbraShading(r, l + 1)));
      }
    }
  });

  it('L0 几乎不可见、L4 亮铜红且红通道占优（底稿 §六美术规格）', () => {
    expect(luma(umbraShading(0.5, 0))).toBeLessThan(0.02);
    const l4 = umbraShading(1, 4);
    expect(luma(l4)).toBeGreaterThan(0.2);
    expect(l4[0]).toBeGreaterThan(l4[1]);
    expect(l4[1]).toBeGreaterThan(l4[2]);
  });

  it('入参钳制与档间连续性；预设表恰五档', () => {
    expect(DANJON_UMBRA_PRESETS).toHaveLength(5);
    expect(umbraShading(-1, 2)).toEqual(umbraShading(0, 2));
    expect(umbraShading(2, 2)).toEqual(umbraShading(1, 2));
    expect(umbraShading(0.5, -1)).toEqual(umbraShading(0.5, 0));
    expect(umbraShading(0.5, 9)).toEqual(umbraShading(0.5, 4));
    // L=4 落在末段插值上限（i0=3, w=1）应精确等于 L4 预设端点
    expect(umbraShading(0, 4)[0]).toBeCloseTo(DANJON_UMBRA_PRESETS[4].center[0], 12);
    expect(umbraShading(1, 4)[0]).toBeCloseTo(DANJON_UMBRA_PRESETS[4].edge[0], 12);
    expect(() => umbraShading(NaN, 2)).toThrow(RangeError);
    expect(() => umbraShading(0.5, NaN)).toThrow(RangeError);
  });
});

describe('penumbraShading 半影微妙变暗（红线 ② 机器防守）', () => {
  it('幅度上限：全域调暗 ≤ PENUMBRA_SHADING_MAX_DIM，外缘无变暗', () => {
    expect(penumbraShading(1)).toBe(1);
    for (let r = 0; r <= 1.0001; r += 0.05) {
      const f = penumbraShading(Math.min(r, 1));
      expect(f).toBeGreaterThanOrEqual(1 - PENUMBRA_SHADING_MAX_DIM);
      expect(f).toBeLessThanOrEqual(1);
    }
  });

  it('纯半影食域（r ≥ 0.6）变暗 < 0.09——「几乎无感」的量化承诺', () => {
    for (const r of [0.6, 0.7, 0.8, 0.9]) {
      expect(1 - penumbraShading(r)).toBeLessThan(0.09);
    }
  });

  it('径向单调 + 钳制 + 非法入参', () => {
    let prev = 0;
    for (let r = 0; r <= 1.0001; r += 0.1) {
      const f = penumbraShading(Math.min(r, 1));
      expect(f).toBeGreaterThanOrEqual(prev);
      prev = f;
    }
    expect(penumbraShading(-5)).toBe(penumbraShading(0));
    expect(penumbraShading(5)).toBe(1);
    expect(() => penumbraShading(NaN)).toThrow(RangeError);
  });
});

describe('turbidityToDanjonL / moonlightLimitingMagDelta / oppositionSurgeFactor / earthRingColor', () => {
  it('浑浊度映射：t=0 → L4（洁净）、t=1 → L0（皮纳图博级）、单调递减 + 钳制', () => {
    expect(turbidityToDanjonL(0)).toBe(4);
    expect(turbidityToDanjonL(1)).toBe(0);
    expect(turbidityToDanjonL(0.5)).toBeCloseTo(2, 12);
    expect(turbidityToDanjonL(-1)).toBe(4);
    expect(turbidityToDanjonL(2)).toBe(0);
    for (let t = 0; t < 1; t += 0.1) {
      expect(turbidityToDanjonL(t + 0.1)).toBeLessThan(turbidityToDanjonL(t));
    }
    expect(() => turbidityToDanjonL(NaN)).toThrow(RangeError);
  });

  it('月光压制两端锚点：满月 4 等、全食（~万倍变暗）≈ 0 且 < 0.5 等', () => {
    expect(moonlightLimitingMagDelta(1)).toBeCloseTo(FULL_MOON_LM_SUPPRESSION_MAG, 10);
    expect(moonlightLimitingMagDelta(0)).toBe(0);
    expect(moonlightLimitingMagDelta(1e-4)).toBeLessThan(0.5);
    expect(moonlightLimitingMagDelta(1e-4)).toBeGreaterThan(0);
    // 单调 + 钳制
    let prev = -1;
    for (const b of [0, 1e-4, 1e-3, 0.01, 0.1, 0.5, 1]) {
      const d = moonlightLimitingMagDelta(b);
      expect(d).toBeGreaterThan(prev);
      prev = d;
    }
    expect(moonlightLimitingMagDelta(-1)).toBe(0);
    expect(moonlightLimitingMagDelta(2)).toBeCloseTo(FULL_MOON_LM_SUPPRESSION_MAG, 10);
    expect(() => moonlightLimitingMagDelta(NaN)).toThrow(RangeError);
  });

  it('对冲因子：相位角 0° 峰值 1+A、对称、随 |相位| 单调衰减', () => {
    expect(oppositionSurgeFactor(0)).toBeCloseTo(1 + OPPOSITION_SURGE_AMPLITUDE, 12);
    expect(oppositionSurgeFactor(-2)).toBeCloseTo(oppositionSurgeFactor(2), 12);
    expect(oppositionSurgeFactor(0)).toBeGreaterThan(oppositionSurgeFactor(2));
    expect(oppositionSurgeFactor(2)).toBeGreaterThan(oppositionSurgeFactor(10));
    expect(oppositionSurgeFactor(60)).toBeCloseTo(1, 5);
    expect(() => oppositionSurgeFactor(NaN)).toThrow(RangeError);
  });

  it('红环色与浑浊度同源：亮度随 t 单调下降、红通道占优、通道 ∈ [0,1]', () => {
    let prev = Infinity;
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const rgb = earthRingColor(t);
      const bright = luma(rgb);
      expect(bright).toBeLessThan(prev);
      prev = bright;
      expect(rgb[0]).toBeGreaterThan(rgb[1]);
      expect(rgb[1]).toBeGreaterThan(rgb[2]);
      for (const c of rgb) {
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(1);
      }
    }
    // 同源保证：洁净大气红环明亮（增益后 > 未增益的 L4 近缘色）
    expect(luma(earthRingColor(0))).toBeGreaterThan(luma(umbraShading(0.85, 4)));
    expect(EARTH_RING_GAIN).toBeGreaterThan(1);
  });
});

describe('插值与场景方向复用（日食契约 C7 消费侧锁定）', () => {
  it('interpolateEphemeris 端点钳制（不外推）+ 中点线性', () => {
    const series = {
      t0: 1000,
      dtSec: 60,
      rows: [
        [10, 100],
        [20, 200],
        [30, 300],
      ],
    };
    expect(interpolateEphemeris(series, -1e9)).toEqual([10, 100]);
    expect(interpolateEphemeris(series, 1e12)).toEqual([30, 300]);
    expect(interpolateEphemeris(series, 1030)).toEqual([15, 150]);
  });

  it('地面视角东西镜像防守：Az=90°（正东）→ +X（M2 消费的场景轴约定）', () => {
    const [x, y, z] = altAzToSceneDirection(0, 90);
    expect(x).toBeCloseTo(1, 10);
    expect(y).toBeCloseTo(0, 10);
    expect(z).toBeCloseTo(0, 10);
  });
});
