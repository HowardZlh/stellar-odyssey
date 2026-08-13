/**
 * 实验室触控板手势纯函数单测（方案 A）：环顾角增量换算/FOV 捏合缩放/
 * polar 与 FOV 钳制/星点尺度补偿
 */
import {
  LAB_FOV_DEFAULT_DEG,
  LAB_FOV_MAX_DEG,
  LAB_FOV_MIN_DEG,
  LAB_POLAR_MAX_RAD,
  LAB_POLAR_MIN_RAD,
  WHEEL_LOOK_SIGN,
  clampFollowDistance,
  clampFollowElevation,
  clampLabFovDeg,
  clampLabPolar,
  followOrbitDelta,
  fovPointScaleFactor,
  pinchFovDeg,
  safariGestureFovDeg,
  wheelLookDelta,
} from '../labGestures';
import {
  FOLLOW_DISTANCE_DEFAULT_KM,
  FOLLOW_DISTANCE_MAX_KM,
  FOLLOW_DISTANCE_MIN_KM,
  FOLLOW_ELEVATION_MAX_RAD,
} from '../meteorShower';

describe('clampLabFovDeg / clampLabPolar（钳制域）', () => {
  it('FOV 钳制到 [30, 85]，默认 65 在域内，非有限数回退默认', () => {
    expect(LAB_FOV_MIN_DEG).toBe(30);
    expect(LAB_FOV_MAX_DEG).toBe(85);
    expect(clampLabFovDeg(10)).toBe(LAB_FOV_MIN_DEG);
    expect(clampLabFovDeg(120)).toBe(LAB_FOV_MAX_DEG);
    expect(clampLabFovDeg(65)).toBe(65);
    expect(clampLabFovDeg(Number.NaN)).toBe(LAB_FOV_DEFAULT_DEG);
    expect(LAB_FOV_DEFAULT_DEG).toBeGreaterThanOrEqual(LAB_FOV_MIN_DEG);
    expect(LAB_FOV_DEFAULT_DEG).toBeLessThanOrEqual(LAB_FOV_MAX_DEG);
  });

  it('polar 钳制与 M2 相机域一致（俯角 ≤20°、仰角 ≤~88°）', () => {
    expect(LAB_POLAR_MIN_RAD).toBeCloseTo(Math.PI / 2 - 0.35, 12);
    expect(LAB_POLAR_MAX_RAD).toBeCloseTo(Math.PI - 0.02, 12);
    expect(clampLabPolar(0)).toBe(LAB_POLAR_MIN_RAD);
    expect(clampLabPolar(Math.PI)).toBe(LAB_POLAR_MAX_RAD);
    const mid = Math.PI * 0.7;
    expect(clampLabPolar(mid)).toBe(mid);
    expect(clampLabPolar(Number.NaN)).toBe(LAB_POLAR_MIN_RAD);
  });
});

describe('wheelLookDelta（双指滚动 → 环顾）', () => {
  it('1 px 滚动 ≈ 1 px 星空位移：radPerPx = fov/视口高', () => {
    const { dThetaRad, dPhiRad } = wheelLookDelta(100, -50, 800, 65);
    const radPerPx = (65 * Math.PI) / 180 / 800;
    expect(dThetaRad).toBeCloseTo(WHEEL_LOOK_SIGN * radPerPx * 100, 12);
    expect(dPhiRad).toBeCloseTo(WHEEL_LOOK_SIGN * radPerPx * -50, 12);
  });

  it('FOV 变窄（放大）时同像素滚动的角增量等比变小（指向手感恒定）', () => {
    const wide = wheelLookDelta(100, 0, 800, 65);
    const narrow = wheelLookDelta(100, 0, 800, 32.5);
    expect(narrow.dThetaRad).toBeCloseTo(wide.dThetaRad / 2, 12);
  });

  it('零输入与非法输入返回零增量（防御）', () => {
    expect(wheelLookDelta(0, 0, 800, 65)).toEqual({ dThetaRad: 0, dPhiRad: 0 });
    expect(wheelLookDelta(Number.NaN, 10, 800, 65)).toEqual({ dThetaRad: 0, dPhiRad: 0 });
    expect(wheelLookDelta(10, Number.NaN, 800, 65)).toEqual({ dThetaRad: 0, dPhiRad: 0 });
    expect(wheelLookDelta(10, 10, 0, 65)).toEqual({ dThetaRad: 0, dPhiRad: 0 });
    expect(wheelLookDelta(10, 10, -1, 65)).toEqual({ dThetaRad: 0, dPhiRad: 0 });
    expect(wheelLookDelta(10, 10, 800, Number.NaN)).toEqual({ dThetaRad: 0, dPhiRad: 0 });
  });

  it('FOV 越界输入按钳制后取值（不产生超域灵敏度）', () => {
    const clamped = wheelLookDelta(100, 0, 800, 200);
    const atMax = wheelLookDelta(100, 0, 800, LAB_FOV_MAX_DEG);
    expect(clamped.dThetaRad).toBeCloseTo(atMax.dThetaRad, 12);
  });
});

describe('pinchFovDeg（ctrl+wheel 捏合 → FOV）', () => {
  it('捏合张开（deltaY<0）FOV 变窄 = 放大；捏拢（deltaY>0）变宽', () => {
    expect(pinchFovDeg(65, -10)).toBeLessThan(65);
    expect(pinchFovDeg(65, 10)).toBeGreaterThan(65);
  });

  it('指数缩放可逆：+d 后 −d 回到原值', () => {
    const zoomed = pinchFovDeg(60, -25);
    expect(pinchFovDeg(zoomed, 25)).toBeCloseTo(60, 10);
  });

  it('钳制到 [30, 85]；deltaY 非有限数返回钳制后的当前值', () => {
    expect(pinchFovDeg(31, -500)).toBe(LAB_FOV_MIN_DEG);
    expect(pinchFovDeg(84, 500)).toBe(LAB_FOV_MAX_DEG);
    expect(pinchFovDeg(65, Number.NaN)).toBe(65);
    expect(pinchFovDeg(200, Number.NaN)).toBe(LAB_FOV_MAX_DEG);
  });
});

describe('safariGestureFovDeg（gesture* 捏合 → FOV）', () => {
  it('scale>1 张开 = FOV 变窄；scale<1 = 变宽；以手势起始 FOV 为基准', () => {
    expect(safariGestureFovDeg(65, 2)).toBeCloseTo(32.5, 12);
    expect(safariGestureFovDeg(60, 0.8)).toBeCloseTo(75, 12);
  });

  it('钳制到 [30, 85]；scale 非法（≤0/NaN）返回钳制后的起始值', () => {
    expect(safariGestureFovDeg(65, 10)).toBe(LAB_FOV_MIN_DEG);
    expect(safariGestureFovDeg(65, 0.1)).toBe(LAB_FOV_MAX_DEG);
    expect(safariGestureFovDeg(65, 0)).toBe(65);
    expect(safariGestureFovDeg(65, -1)).toBe(65);
    expect(safariGestureFovDeg(65, Number.NaN)).toBe(65);
  });
});

describe('fovPointScaleFactor（星点尺度补偿）', () => {
  it('默认 FOV 时恒 1（与 M2 观感逐像素一致）', () => {
    expect(fovPointScaleFactor(LAB_FOV_DEFAULT_DEG)).toBeCloseTo(1, 12);
  });

  it('FOV 变窄（放大）因子 >1，变宽 <1，单调递减', () => {
    expect(fovPointScaleFactor(30)).toBeGreaterThan(1);
    expect(fovPointScaleFactor(85)).toBeLessThan(1);
    expect(fovPointScaleFactor(40)).toBeGreaterThan(fovPointScaleFactor(50));
  });

  it('与透视投影因子一致：factor = tan(默认/2)/tan(fov/2)', () => {
    const expected = Math.tan((65 * Math.PI) / 360) / Math.tan((40 * Math.PI) / 360);
    expect(fovPointScaleFactor(40)).toBeCloseTo(expected, 12);
  });
});

describe('M3.6-2 跟随环绕手势（followOrbitDelta / clampFollowElevation / clampFollowDistance）', () => {
  it('followOrbitDelta：拖满视口高 = 180°；拖拽上移（dy<0）= 仰角增大', () => {
    const d = followOrbitDelta(400, -800, 800);
    expect(d.dAzimuthRad).toBeCloseTo((Math.PI / 800) * 400, 12);
    expect(d.dElevationRad).toBeCloseTo(Math.PI, 12); // −(π/800)×(−800)
  });

  it('followOrbitDelta：非法输入（NaN/非正视口高）返回零增量', () => {
    expect(followOrbitDelta(Number.NaN, 10, 800)).toEqual({ dAzimuthRad: 0, dElevationRad: 0 });
    expect(followOrbitDelta(10, Number.NaN, 800)).toEqual({ dAzimuthRad: 0, dElevationRad: 0 });
    expect(followOrbitDelta(10, 10, 0)).toEqual({ dAzimuthRad: 0, dElevationRad: 0 });
    expect(followOrbitDelta(10, 10, -1)).toEqual({ dAzimuthRad: 0, dElevationRad: 0 });
  });

  it('clampFollowElevation：钳制 ±75°（防头/尾奇异），NaN 回退 0', () => {
    expect(clampFollowElevation(Math.PI)).toBeCloseTo(FOLLOW_ELEVATION_MAX_RAD, 12);
    expect(clampFollowElevation(-Math.PI)).toBeCloseTo(-FOLLOW_ELEVATION_MAX_RAD, 12);
    expect(clampFollowElevation(0.3)).toBe(0.3);
    expect(clampFollowElevation(Number.NaN)).toBe(0);
    expect(FOLLOW_ELEVATION_MAX_RAD).toBeCloseTo((75 * Math.PI) / 180, 12);
  });

  it('clampFollowDistance：指数缩放可逆（滚轮往返回原值）', () => {
    const zoomed = clampFollowDistance(1.5, -200);
    expect(zoomed).toBeLessThan(1.5); // deltaY<0 = 拉近
    expect(clampFollowDistance(zoomed, 200)).toBeCloseTo(1.5, 10);
  });

  it('clampFollowDistance：钳制 [0.6, 6] km；NaN 输入回退', () => {
    expect(clampFollowDistance(1.5, -100000)).toBe(FOLLOW_DISTANCE_MIN_KM);
    expect(clampFollowDistance(1.5, 100000)).toBe(FOLLOW_DISTANCE_MAX_KM);
    expect(clampFollowDistance(100, 0)).toBe(FOLLOW_DISTANCE_MAX_KM);
    expect(clampFollowDistance(0.01, 0)).toBe(FOLLOW_DISTANCE_MIN_KM);
    expect(clampFollowDistance(Number.NaN, 0)).toBe(FOLLOW_DISTANCE_DEFAULT_KM);
    expect(clampFollowDistance(1.5, Number.NaN)).toBe(1.5);
  });
});
