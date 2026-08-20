/**
 * 实验室触控板手势纯函数单测（方案 A）：环顾角增量换算/FOV 捏合缩放/
 * polar 与 FOV 钳制/星点尺度补偿
 */
import {
  LAB_FOV_DEFAULT_DEG,
  LAB_FOV_MAX_DEG,
  LAB_FOV_MIN_DEG,
  LAB_FOV_TELESCOPIC_MIN_DEG,
  LAB_ROTATE_SPEED_MIN_RATIO,
  LAB_POLAR_MAX_RAD,
  LAB_POLAR_MIN_RAD,
  WHEEL_LOOK_SIGN,
  clampFollowDistance,
  clampFollowElevation,
  clampLabFovDeg,
  clampLabPolar,
  followOrbitDelta,
  fovPointScaleFactor,
  labRotateSpeedForFov,
  pinchFovDeg,
  safariGestureFovDeg,
  touchPinchScale,
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

describe('touchPinchScale（M4-2 触屏双指捏合 → 累计比例）', () => {
  it('比例 = 当前双指距 / 起始双指距（>1 张开 = 放大）', () => {
    expect(touchPinchScale(100, 200)).toBeCloseTo(2, 12);
    expect(touchPinchScale(200, 100)).toBeCloseTo(0.5, 12);
    expect(touchPinchScale(150, 150)).toBe(1);
  });

  it('与 safariGestureFovDeg 组合：张开变窄、捏拢变宽（同一钳制函数复用）', () => {
    expect(safariGestureFovDeg(65, touchPinchScale(100, 200))).toBeCloseTo(32.5, 12);
    expect(safariGestureFovDeg(60, touchPinchScale(100, 80))).toBeCloseTo(75, 12);
  });

  it('非法输入（起始距 ≤0 / 非有限）返回 1（不缩放）', () => {
    expect(touchPinchScale(0, 100)).toBe(1);
    expect(touchPinchScale(-5, 100)).toBe(1);
    expect(touchPinchScale(100, 0)).toBe(1);
    expect(touchPinchScale(Number.NaN, 100)).toBe(1);
    expect(touchPinchScale(100, Number.POSITIVE_INFINITY)).toBe(1);
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

// ---------------------------------------------------------------------------
// LE-M6 补丁 P1：望远档 FOV 下限 + 旋转速度自适应
// ---------------------------------------------------------------------------

describe('LE-M6 P1 望远档（LAB_FOV_TELESCOPIC_MIN_DEG）', () => {
  it('缺省档口径不变（流星雨/观察站逐像素零回归）', () => {
    expect(LAB_FOV_MIN_DEG).toBe(30);
    expect(clampLabFovDeg(10)).toBe(30);
    expect(pinchFovDeg(31, -500)).toBe(30);
    expect(safariGestureFovDeg(65, 10)).toBe(30);
    expect(wheelLookDelta(0, 100, 1000, 10).dPhiRad).toBeCloseTo(
      (30 * Math.PI) / 180 / 1000 * 100,
      12,
    );
  });

  it('望远档下限 3°，且足以把 0.5° 量级的日月盘放大到视口高 >15%', () => {
    expect(LAB_FOV_TELESCOPIC_MIN_DEG).toBe(3);
    expect(clampLabFovDeg(1, LAB_FOV_TELESCOPIC_MIN_DEG)).toBe(3);
    expect(clampLabFovDeg(8, LAB_FOV_TELESCOPIC_MIN_DEG)).toBe(8);
    // 月视直径 0.542°（2029 事件 HUD 实测）在下限处占视口高的比例
    expect(0.542 / LAB_FOV_TELESCOPIC_MIN_DEG).toBeGreaterThan(0.15);
    // 相对缺省档的放大倍数
    expect(LAB_FOV_MIN_DEG / LAB_FOV_TELESCOPIC_MIN_DEG).toBe(10);
  });

  it('望远档贯通捏合三链（ctrl+wheel / Safari gesture / 触屏双指）', () => {
    expect(pinchFovDeg(31, -500, LAB_FOV_TELESCOPIC_MIN_DEG)).toBe(3);
    expect(safariGestureFovDeg(65, 100, LAB_FOV_TELESCOPIC_MIN_DEG)).toBe(3);
    expect(
      safariGestureFovDeg(
        65,
        touchPinchScale(50, 5000),
        LAB_FOV_TELESCOPIC_MIN_DEG,
      ),
    ).toBe(3);
    // 上限与非法入参行为不随下限变化
    expect(pinchFovDeg(84, 500, LAB_FOV_TELESCOPIC_MIN_DEG)).toBe(85);
    expect(safariGestureFovDeg(65, 0, LAB_FOV_TELESCOPIC_MIN_DEG)).toBe(65);
    expect(pinchFovDeg(65, Number.NaN, LAB_FOV_TELESCOPIC_MIN_DEG)).toBe(65);
  });

  it('望远档下环顾步长随 FOV 变细（每像素角度恒定的手感前提）', () => {
    const wide = wheelLookDelta(0, 100, 1000, 65, LAB_FOV_TELESCOPIC_MIN_DEG);
    const tele = wheelLookDelta(0, 100, 1000, 3, LAB_FOV_TELESCOPIC_MIN_DEG);
    expect(tele.dPhiRad).toBeCloseTo(wide.dPhiRad * (3 / 65), 12);
  });

  it('minDeg 非法/越界入参安全钳回合法域（防调用方传脏值）', () => {
    expect(clampLabFovDeg(1, Number.NaN)).toBe(LAB_FOV_MIN_DEG);
    expect(clampLabFovDeg(1, 0)).toBe(LAB_FOV_TELESCOPIC_MIN_DEG);
    expect(clampLabFovDeg(1, 200)).toBe(LAB_FOV_MAX_DEG);
  });

  it('星点尺度补偿在望远档下不再继续放大（恒星是不可分辨点源）', () => {
    expect(fovPointScaleFactor(3)).toBe(fovPointScaleFactor(30));
    expect(fovPointScaleFactor(1)).toBe(fovPointScaleFactor(LAB_FOV_MIN_DEG));
  });
});

describe('labRotateSpeedForFov（望远档旋转速度自适应）', () => {
  it('默认 FOV 处恒等于基准速度（既有手感零变化）', () => {
    expect(labRotateSpeedForFov(0.45, LAB_FOV_DEFAULT_DEG)).toBeCloseTo(0.45, 12);
  });

  it('速度 ∝ FOV：望远档下拖拽的屏幕像素手感恒定', () => {
    expect(labRotateSpeedForFov(0.45, 32.5)).toBeCloseTo(0.225, 12);
    expect(labRotateSpeedForFov(0.45, 13)).toBeCloseTo(0.09, 12);
    // 3° 时约为默认的 1/21——否则一次拖拽会扫过数十个屏宽
    expect(labRotateSpeedForFov(0.45, 3) / 0.45).toBeCloseTo(3 / 65, 12);
  });

  it('单调递增且恒为正（下限比例防归零卡死）', () => {
    let prev = 0;
    for (let fov = 3; fov <= 85; fov += 1) {
      const s = labRotateSpeedForFov(0.5, fov);
      expect(s).toBeGreaterThan(prev);
      prev = s;
    }
    expect(labRotateSpeedForFov(0.5, 0.01)).toBeGreaterThan(0);
    expect(LAB_ROTATE_SPEED_MIN_RATIO).toBeGreaterThan(0);
  });

  it('非法入参：基准 ≤0 返回 0，FOV 非有限退回默认档速度', () => {
    expect(labRotateSpeedForFov(0, 30)).toBe(0);
    expect(labRotateSpeedForFov(-1, 30)).toBe(0);
    expect(labRotateSpeedForFov(Number.NaN, 30)).toBe(0);
    expect(labRotateSpeedForFov(0.45, Number.NaN)).toBeCloseTo(0.45, 12);
  });
});
