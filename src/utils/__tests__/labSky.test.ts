/**
 * M3.8 夜天光纯函数层单测（IMPROVEMENT_REQUIREMENTS_METEOR_SHOWERS §M3.8-1/2/3）
 *
 * 覆盖：太阳高度角（与 labSunDirection 同式交叉锁定/历元锚点）、有效极限
 * 星等（夜间域透传/锚点值/单调递减/白昼 −4）、天光配色（通道域/地平 ≥ 天顶/
 * p 与 alt 单调族/sunGlow 晨昏带包络）、地面反照（暗于地平亮于纯黑）、
 * 山脊剖面（长度/值域/周期无缝/同种子确定性）。
 */

import {
  DAYLIGHT_LIMITING_MAG,
  DAY_HORIZON,
  DAY_ZENITH,
  GROUND_ALBEDO_FACTOR,
  HEAD_MAX_ANGLE_RAD,
  NIGHT_HORIZON_BASE,
  NIGHT_ZENITH_BASE,
  RIBBON_NEAR_DISTANCE_KM,
  RIDGE_MAX_HEIGHT_KM,
  RIDGE_MIN_HEIGHT_KM,
  RIDGE_RADIUS_KM,
  RIDGE_SEGMENTS,
  SKY_DOME_RADIUS_FACTOR,
  TWILIGHT_LM_ANCHORS,
  effectiveLimitingMag,
  emptyLabSkyColors,
  labGroundColor,
  labSkyColors,
  labSunAltitudeRad,
  ridgeHeightProfile,
} from '@/utils/labSky';
import {
  EPOCH_LOCAL_HOURS,
  EPOCH_SUN_DECLINATION_DEG,
  STAR_DOME_RADIUS_UNITS,
  labSunDirection,
  localClockHours,
} from '@/utils/meteorShower';

const DEG = Math.PI / 180;

describe('labSunAltitudeRad（M3.8-1 太阳高度角）', () => {
  it('与 labSunDirection 的 y 分量同式（sin(alt) 交叉锁定）', () => {
    const cases: Array<[number, number, number, number, number]> = [
      [2, 14, 0, 0, 40],
      [2, 14, 3.5, 1.2, 40],
      [23, 13, -2, 0.4, 28],
      [5, -19, 0, 2, 40],
    ];
    for (const [epoch, dec, offset, elapsed, lat] of cases) {
      const alt = labSunAltitudeRad(epoch, dec, offset, elapsed, lat);
      const clock = localClockHours(epoch, offset, elapsed);
      const dir = labSunDirection(clock, lat, dec);
      expect(Math.sin(alt)).toBeCloseTo(dir[1], 10);
    }
  });

  it('英仙座历元 02:00（dec +14°, lat 40°N）：太阳深居地平下（< −18°，天文夜）', () => {
    const alt = labSunAltitudeRad(
      EPOCH_LOCAL_HOURS.perseids,
      EPOCH_SUN_DECLINATION_DEG.perseids,
      0,
      0,
      40
    );
    expect(alt).toBeLessThan(-18 * DEG);
  });

  it('正午（clock=12 → 时角 0）：alt = 90° − |lat − dec|', () => {
    const alt = labSunAltitudeRad(12, 14, 0, 0, 40);
    expect(alt).toBeCloseTo((90 - (40 - 14)) * DEG, 10);
  });

  it('hourOffset 拨向黎明单调抬升（历元 02:00 → +4h = 06:00 晨光）', () => {
    const altNight = labSunAltitudeRad(2, 14, 0, 0, 40);
    const altDawn = labSunAltitudeRad(2, 14, 4, 0, 40);
    const altMorning = labSunAltitudeRad(2, 14, 6, 0, 40);
    expect(altDawn).toBeGreaterThan(altNight);
    expect(altMorning).toBeGreaterThan(altDawn);
  });

  it('非法输入抛 RangeError', () => {
    expect(() => labSunAltitudeRad(2, NaN, 0, 0, 40)).toThrow(RangeError);
    expect(() => labSunAltitudeRad(2, 14, 0, 0, Infinity)).toThrow(RangeError);
  });
});

describe('effectiveLimitingMag（M3.8-2 晨昏蒙影链）', () => {
  it('夜间域（alt ≤ −18°）透传用户 lm', () => {
    expect(effectiveLimitingMag(6.5, -18 * DEG)).toBe(6.5);
    expect(effectiveLimitingMag(4.2, -30 * DEG)).toBe(4.2);
    expect(effectiveLimitingMag(1.0, -90 * DEG)).toBe(1.0);
  });

  it('锚点值精确命中：−12° → 5.0、−6° → 2.0、0° → −4', () => {
    expect(effectiveLimitingMag(6.5, -12 * DEG)).toBeCloseTo(5.0, 10);
    expect(effectiveLimitingMag(6.5, -6 * DEG)).toBeCloseTo(2.0, 10);
    expect(effectiveLimitingMag(6.5, 0)).toBeCloseTo(DAYLIGHT_LIMITING_MAG, 10);
  });

  it('锚点间分段线性（−9° 为 −12/−6 中点 → 3.5）', () => {
    expect(effectiveLimitingMag(6.5, -9 * DEG)).toBeCloseTo(3.5, 10);
    expect(effectiveLimitingMag(6.5, -15 * DEG)).toBeCloseTo(5.75, 10);
  });

  it('太阳抬升单调递减（userLm 6.5 全域扫描）', () => {
    let prev = Infinity;
    for (let altDeg = -25; altDeg <= 10; altDeg += 0.5) {
      const lm = effectiveLimitingMag(6.5, altDeg * DEG);
      expect(lm).toBeLessThanOrEqual(prev + 1e-12);
      prev = lm;
    }
  });

  it('白昼（alt ≥ 0°）恒 −4（含正午）', () => {
    expect(effectiveLimitingMag(6.5, 10 * DEG)).toBe(DAYLIGHT_LIMITING_MAG);
    expect(effectiveLimitingMag(6.5, 60 * DEG)).toBe(DAYLIGHT_LIMITING_MAG);
  });

  it('用户 lm 低于上限时透传（min 语义：光害重的用户不受晨昏抬升）', () => {
    expect(effectiveLimitingMag(1.5, -9 * DEG)).toBe(1.5);
    expect(effectiveLimitingMag(-5, 10 * DEG)).toBe(-5);
  });

  it('锚点表首尾与常量一致（防手滑改锚点）', () => {
    expect(TWILIGHT_LM_ANCHORS[0][0]).toBe(-18);
    expect(TWILIGHT_LM_ANCHORS[TWILIGHT_LM_ANCHORS.length - 1]).toEqual([0, -4]);
  });

  it('非法输入抛 RangeError', () => {
    expect(() => effectiveLimitingMag(NaN, 0)).toThrow(RangeError);
    expect(() => effectiveLimitingMag(6.5, NaN)).toThrow(RangeError);
  });
});

describe('labSkyColors（M3.8-1 天光配色）', () => {
  const scanAlts = [-40, -18, -12, -8, -6, -3, 0, 5, 30].map((d) => d * DEG);
  const scanLms = [1.0, 2.5, 4.0, 6.0, 6.5];

  it('全域通道 ∈ [0, 1]', () => {
    for (const lm of scanLms) {
      for (const alt of scanAlts) {
        const sky = labSkyColors(lm, alt);
        for (let c = 0; c < 3; c += 1) {
          expect(sky.zenith[c]).toBeGreaterThanOrEqual(0);
          expect(sky.zenith[c]).toBeLessThanOrEqual(1);
          expect(sky.horizon[c]).toBeGreaterThanOrEqual(0);
          expect(sky.horizon[c]).toBeLessThanOrEqual(1);
        }
        expect(sky.sunGlow).toBeGreaterThanOrEqual(0);
        expect(sky.sunGlow).toBeLessThanOrEqual(1);
      }
    }
  });

  it('地平亮度恒 ≥ 天顶（逐通道，夜空亮度分布红线）', () => {
    for (const lm of scanLms) {
      for (const alt of scanAlts) {
        const sky = labSkyColors(lm, alt);
        for (let c = 0; c < 3; c += 1) {
          expect(sky.horizon[c]).toBeGreaterThanOrEqual(sky.zenith[c] - 1e-12);
        }
      }
    }
  });

  it('深夜 lm 6.5：非纯黑且贴夜间基色', () => {
    const sky = labSkyColors(6.5, -40 * DEG);
    expect(sky.zenith).toEqual([...NIGHT_ZENITH_BASE]);
    expect(sky.horizon).toEqual([...NIGHT_HORIZON_BASE]);
    expect(sky.horizon[0]).toBeGreaterThan(0);
  });

  it('光害单调族：夜间域 lm 降低（p 升高）地平/天顶逐通道更亮', () => {
    let prev = labSkyColors(6.5, -40 * DEG);
    for (const lm of [5.5, 4.0, 2.5, 1.0]) {
      const sky = labSkyColors(lm, -40 * DEG);
      for (let c = 0; c < 3; c += 1) {
        expect(sky.horizon[c]).toBeGreaterThan(prev.horizon[c]);
        expect(sky.zenith[c]).toBeGreaterThan(prev.zenith[c]);
      }
      prev = sky;
    }
  });

  it('晨昏单调族：太阳抬升逐通道非降、白昼收敛白昼色', () => {
    let prev = labSkyColors(6.5, -40 * DEG);
    for (const altDeg of [-18, -12, -6, 0, 5, 30]) {
      const sky = labSkyColors(6.5, altDeg * DEG);
      for (let c = 0; c < 3; c += 1) {
        expect(sky.horizon[c]).toBeGreaterThanOrEqual(prev.horizon[c] - 1e-12);
        expect(sky.zenith[c]).toBeGreaterThanOrEqual(prev.zenith[c] - 1e-12);
      }
      prev = sky;
    }
    const noon = labSkyColors(6.5, 60 * DEG);
    for (let c = 0; c < 3; c += 1) {
      expect(noon.zenith[c]).toBeCloseTo(DAY_ZENITH[c], 10);
      expect(noon.horizon[c]).toBeCloseTo(DAY_HORIZON[c], 10);
    }
  });

  it('sunGlow：深夜与正午 ≈0，−6°（民用蒙影）显著 > 0', () => {
    expect(labSkyColors(6.5, -40 * DEG).sunGlow).toBeCloseTo(0, 10);
    expect(labSkyColors(6.5, 60 * DEG).sunGlow).toBeCloseTo(0, 10);
    expect(labSkyColors(6.5, -6 * DEG).sunGlow).toBeGreaterThan(0.5);
  });

  it('out 参数复用零分配（useFrame 契约 C2.1 口径）', () => {
    const out = emptyLabSkyColors();
    const returned = labSkyColors(3.0, -10 * DEG, out);
    expect(returned).toBe(out);
    expect(out.horizon[0]).toBeGreaterThan(0);
  });

  it('非法输入抛 RangeError', () => {
    expect(() => labSkyColors(NaN, 0)).toThrow(RangeError);
    expect(() => labSkyColors(6.5, Infinity)).toThrow(RangeError);
  });
});

describe('labGroundColor（M3.8-1 地面反照）', () => {
  it('暗于地平、亮于纯黑（反照系数比例）', () => {
    const sky = labSkyColors(6.5, -40 * DEG);
    const ground = labGroundColor(sky);
    for (let c = 0; c < 3; c += 1) {
      expect(ground[c]).toBeLessThan(sky.horizon[c]);
      expect(ground[c]).toBeGreaterThan(0);
      expect(ground[c]).toBeCloseTo(sky.horizon[c] * GROUND_ALBEDO_FACTOR, 10);
    }
  });

  it('out 参数复用', () => {
    const sky = labSkyColors(3.0, -8 * DEG);
    const out: [number, number, number] = [0, 0, 0];
    const returned = labGroundColor(sky, out);
    expect(returned).toBe(out);
    expect(out[0]).toBeGreaterThan(0);
  });
});

describe('ridgeHeightProfile（M3.8-3 山脊剖面）', () => {
  const SEED = 0x5eed17;

  it('长度 = segments、值域 [0.05, 0.9]、归一端点精确命中', () => {
    const profile = ridgeHeightProfile(RIDGE_SEGMENTS, SEED);
    expect(profile.length).toBe(RIDGE_SEGMENTS);
    let min = Infinity;
    let max = -Infinity;
    for (const h of profile) {
      expect(h).toBeGreaterThanOrEqual(RIDGE_MIN_HEIGHT_KM - 1e-6);
      expect(h).toBeLessThanOrEqual(RIDGE_MAX_HEIGHT_KM + 1e-6);
      if (h < min) min = h;
      if (h > max) max = h;
    }
    expect(min).toBeCloseTo(RIDGE_MIN_HEIGHT_KM, 5);
    expect(max).toBeCloseTo(RIDGE_MAX_HEIGHT_KM, 5);
  });

  it('周期无缝：环向回绕步长不大于内部最大步长（整数频率保证）', () => {
    const profile = ridgeHeightProfile(RIDGE_SEGMENTS, SEED);
    let maxInteriorStep = 0;
    for (let i = 1; i < profile.length; i += 1) {
      maxInteriorStep = Math.max(maxInteriorStep, Math.abs(profile[i] - profile[i - 1]));
    }
    const wrapStep = Math.abs(profile[0] - profile[profile.length - 1]);
    expect(wrapStep).toBeLessThanOrEqual(maxInteriorStep + 1e-9);
  });

  it('同种子确定性、异种子不同剖面', () => {
    const a = ridgeHeightProfile(64, SEED);
    const b = ridgeHeightProfile(64, SEED);
    const c = ridgeHeightProfile(64, SEED + 1);
    expect([...a]).toEqual([...b]);
    expect([...a]).not.toEqual([...c]);
  });

  it('非法段数抛 RangeError', () => {
    expect(() => ridgeHeightProfile(7, SEED)).toThrow(RangeError);
    expect(() => ridgeHeightProfile(2.5, SEED)).toThrow(RangeError);
  });
});

describe('M3.8 常量登记', () => {
  it('天光穹半径 = 星穹 ×1.2 = 12000 < far 25000（星点深度之后）', () => {
    expect(SKY_DOME_RADIUS_FACTOR).toBe(1.2);
    expect(STAR_DOME_RADIUS_UNITS * SKY_DOME_RADIUS_FACTOR).toBe(12000);
    expect(STAR_DOME_RADIUS_UNITS * SKY_DOME_RADIUS_FACTOR).toBeLessThan(
      STAR_DOME_RADIUS_UNITS * 2.5
    );
  });

  it('山脊几何量级：30 km 环、仰角域 ≈ [0.1°, 1.7°] 真实山脊线量级', () => {
    expect(RIDGE_RADIUS_KM).toBe(30);
    const minElevDeg = Math.atan(RIDGE_MIN_HEIGHT_KM / RIDGE_RADIUS_KM) / DEG;
    const maxElevDeg = Math.atan(RIDGE_MAX_HEIGHT_KM / RIDGE_RADIUS_KM) / DEG;
    expect(minElevDeg).toBeGreaterThan(0.05);
    expect(maxElevDeg).toBeLessThan(2);
  });

  it('头部最大张角 8°、ribbon 渐显阈值 8 km', () => {
    expect(HEAD_MAX_ANGLE_RAD).toBeCloseTo((8 * Math.PI) / 180, 12);
    expect(RIBBON_NEAR_DISTANCE_KM).toBe(8);
  });
});
