/**
 * E-M1 日食几何纯函数层单测（需求 §M1-5 锚点清单）：
 * 双圆遮挡解析式（相切=0/全含=1/半径比反例）、eclipseKind 三态边界、
 * 本影锥长域、方位角→场景向量东西镜像防守（契约 C4）、贝利珠漏光剖面
 * （均匀月缘→均匀漏光/单谷→单珠）、99%→100% 天光断崖、偏折角 1.7520″
 * 日面边缘锚点、插值端点/越界钳制、站心变换锚点。
 */
import {
  SUN_RADIUS_KM,
  MOON_MEAN_RADIUS_KM,
  EARTH_MEAN_RADIUS_KM,
  SUN_MEAN_ANGULAR_RADIUS_DEG,
  GR_LIMB_DEFLECTION_ARCSEC,
  LIMB_PROFILE_SAMPLE_COUNT,
  TOPO_ANGULAR_COLUMNS,
  GRAZING_COS_MIN,
  interpolateEphemeris,
  geoSampleFromRow,
  topocentricSunMoon,
  altAzToSceneDirection,
  eclipseObscuration,
  eclipseMagnitude,
  eclipseKind,
  umbraCone,
  penumbraCone,
  umbraFootprint,
  beadsLeakProfile,
  eclipseSkyDarkening,
  starDeflectionArcsec,
  topoAngularSepDeg,
  deriveContactTimes,
  type EphemerisSeries,
} from '@/utils/solarEclipse';
import { sceneDirFromAltAz } from '@/utils/meteorShower';

const DEG = Math.PI / 180;

// ---------------------------------------------------------------------------
// 双圆遮挡解析式（§M1-5 锚点）
// ---------------------------------------------------------------------------

describe('eclipseObscuration', () => {
  const rs = 0.267 * DEG;

  it('外切（sep = sunR+moonR）遮挡率 = 0，相离 = 0', () => {
    expect(eclipseObscuration(rs, rs, 2 * rs)).toBe(0);
    expect(eclipseObscuration(rs, rs, 3 * rs)).toBe(0);
  });

  it('同心全含（moonR ≥ sunR，sep ≤ moonR−sunR）= 1', () => {
    const rm = rs * 1.05;
    expect(eclipseObscuration(rs, rm, 0)).toBe(1);
    expect(eclipseObscuration(rs, rm, rm - rs)).toBe(1);
  });

  it('半径比反例：环食内含（moonR < sunR）= (moonR/sunR)² 而非 1', () => {
    const rm = rs * 0.95;
    expect(eclipseObscuration(rs, rm, 0)).toBeCloseTo(0.95 ** 2, 10);
    expect(eclipseObscuration(rs, rm, 0)).toBeLessThan(1);
  });

  it('等半径半重叠：解析值 1 − 2(α−sinα·cosα)/π（α=acos(1/2)）的镜像式', () => {
    // d = r：透镜面积 = 2r²(π/3 − √3/4)，遮挡率 = 透镜/πr²
    const expected = (2 * (Math.PI / 3 - Math.sqrt(3) / 4)) / Math.PI;
    expect(eclipseObscuration(rs, rs, rs)).toBeCloseTo(expected, 10);
  });

  it('偏食段随角距单调递减', () => {
    const rm = rs * 1.03;
    let prev = 1;
    for (let f = 0.1; f <= 0.95; f += 0.1) {
      const obs = eclipseObscuration(rs, rm, (rm - rs) + f * 2 * rs);
      expect(obs).toBeLessThan(prev);
      prev = obs;
    }
  });

  it('非法入参抛 RangeError', () => {
    expect(() => eclipseObscuration(0, 1, 0)).toThrow(RangeError);
    expect(() => eclipseObscuration(1, -1, 0)).toThrow(RangeError);
    expect(() => eclipseObscuration(1, 1, -0.1)).toThrow(RangeError);
    expect(() => eclipseObscuration(NaN, 1, 0)).toThrow(RangeError);
  });
});

describe('eclipseMagnitude', () => {
  const rs = 0.267 * DEG;

  it('无食 = 0；中心食 = 视直径比；偏食 = 侵入比', () => {
    const rm = rs * 1.079;
    expect(eclipseMagnitude(rs, rm, 2 * rs + rm)).toBe(0);
    expect(eclipseMagnitude(rs, rm, 0)).toBeCloseTo(1.079, 10);
    // 偏食中点：sep = (sunR+moonR)/2 → mag = (sunR+moonR)/(4·sunR)
    const sep = (rs + rm) / 2;
    expect(eclipseMagnitude(rs, rm, sep)).toBeCloseTo((rs + rm) / (4 * rs), 10);
  });

  it('环食中心食食分 = moonR/sunR < 1', () => {
    const rm = rs * 0.94;
    expect(eclipseMagnitude(rs, rm, 0)).toBeCloseTo(0.94, 10);
  });
});

describe('eclipseKind 三态边界（§M1-5）', () => {
  const rs = 0.267 * DEG;

  it('total：moonR > sunR 且 sep ≤ moonR−sunR', () => {
    const rm = rs * 1.05;
    expect(eclipseKind(rs, rm, 0)).toBe('total');
    expect(eclipseKind(rs, rm, rm - rs)).toBe('total');
    expect(eclipseKind(rs, rm, (rm - rs) * 1.001)).toBe('partial');
  });

  it('annular：moonR < sunR 且 sep ≤ sunR−moonR', () => {
    const rm = rs * 0.95;
    expect(eclipseKind(rs, rm, 0)).toBe('annular');
    expect(eclipseKind(rs, rm, rs - rm)).toBe('annular');
    expect(eclipseKind(rs, rm, (rs - rm) * 1.001)).toBe('partial');
  });

  it('none/partial 外边界：sep = sunR+moonR 归 none，略小于则 partial', () => {
    const rm = rs * 1.02;
    expect(eclipseKind(rs, rm, rs + rm)).toBe('none');
    expect(eclipseKind(rs, rm, (rs + rm) * 0.999)).toBe('partial');
  });

  it('等半径（moonR = sunR）sep=0 归 total（珠状食极限归全食侧）', () => {
    expect(eclipseKind(rs, rs, 0)).toBe('total');
  });

  it('月地距离滑杆链路：拉远月球 → 视半径缩小 → total 连续退化为 annular', () => {
    // 同一物理月球：视半径 ∝ 1/距离
    const sunSd = SUN_MEAN_ANGULAR_RADIUS_DEG * DEG;
    const sdAt = (distKm: number): number => Math.asin(MOON_MEAN_RADIUS_KM / distKm);
    expect(eclipseKind(sunSd, sdAt(363104), 0)).toBe('total');
    expect(eclipseKind(sunSd, sdAt(405696), 0)).toBe('annular');
  });
});

// ---------------------------------------------------------------------------
// 真锥影几何（§1.2 锚点）
// ---------------------------------------------------------------------------

describe('umbraCone / penumbraCone', () => {
  // 典型日食构型：太阳在 +x 1.496e8 km，月球在 −x 方向观测者侧 3.78e5 km
  const sunPos: [number, number, number] = [1.496e8, 0, 0];
  const moonPos: [number, number, number] = [3.78e5, 0, 0];

  it('本影锥长 ∈ [360000, 385000] km（§M1-5 锚点）', () => {
    const cone = umbraCone(sunPos, moonPos);
    expect(cone.lengthKm).toBeGreaterThanOrEqual(360000);
    expect(cone.lengthKm).toBeLessThanOrEqual(385000);
  });

  it('本影锥轴向背日、顶点在月球背日侧', () => {
    const cone = umbraCone(sunPos, moonPos);
    expect(cone.axis[0]).toBeCloseTo(-1, 6); // 背日 = −x
    expect(cone.apexKm[0]).toBeLessThan(moonPos[0]);
    expect(cone.halfAngleRad).toBeGreaterThan(0);
    expect(cone.halfAngleRad).toBeLessThan(0.01);
  });

  it('月地距离拉远 → 锥尖到不了地面（环食几何自然成立）', () => {
    const nearCone = umbraCone(sunPos, [3.63104e5, 0, 0]);
    const farCone = umbraCone(sunPos, [4.05696e5, 0, 0]);
    // 近地点：锥长 > 月心到地面距离 → 真本影触地
    expect(nearCone.lengthKm).toBeGreaterThan(3.63104e5 - EARTH_MEAN_RADIUS_KM);
    // 远地点：锥长 < 月心到地面距离 → 伪本影（环食）
    expect(farCone.lengthKm).toBeLessThan(4.05696e5 - EARTH_MEAN_RADIUS_KM);
  });

  it('半影锥：顶点在月球向日侧，地表足印直径 > 6400 km（§1.2）', () => {
    const cone = penumbraCone(sunPos, moonPos);
    expect(cone.apexKm[0]).toBeGreaterThan(moonPos[0]);
    const fp = umbraFootprint(cone, [0, 0, 0], EARTH_MEAN_RADIUS_KM);
    expect(fp.exists).toBe(true);
    expect(fp.minorAxisKm).toBeGreaterThan(6400);
  });

  it('日月距离非法抛 RangeError', () => {
    expect(() => umbraCone([0, 0, 0], [1, 0, 0])).toThrow(RangeError);
    expect(() => penumbraCone([0, 0, 0], [1, 0, 0])).toThrow(RangeError);
  });
});

describe('umbraFootprint', () => {
  const sunPos: [number, number, number] = [1.496e8, 0, 0];

  it('近地点构型：真本影触地（isAntumbra=false），足印在向日面', () => {
    const cone = umbraCone(sunPos, [3.63104e5, 0, 0]);
    const fp = umbraFootprint(cone, [0, 0, 0], EARTH_MEAN_RADIUS_KM);
    expect(fp.exists).toBe(true);
    expect(fp.isAntumbra).toBe(false);
    expect(fp.centerKm).not.toBeNull();
    expect((fp.centerKm as readonly number[])[0]).toBeCloseTo(EARTH_MEAN_RADIUS_KM, 0);
    expect(fp.minorAxisKm).toBeGreaterThan(50);
    expect(fp.minorAxisKm).toBeLessThan(400);
    // 正入射（影轴过地心）长短轴相等
    expect(fp.majorAxisKm).toBeCloseTo(fp.minorAxisKm, 6);
  });

  it('远地点构型：伪本影分支（isAntumbra=true，环食）', () => {
    const cone = umbraCone(sunPos, [4.05696e5, 0, 0]);
    const fp = umbraFootprint(cone, [0, 0, 0], EARTH_MEAN_RADIUS_KM);
    expect(fp.exists).toBe(true);
    expect(fp.isAntumbra).toBe(true);
    expect(fp.minorAxisKm).toBeGreaterThan(0);
  });

  it('影轴偏离地球 → 无足印', () => {
    const cone = umbraCone(sunPos, [3.78e5, 5e4, 0]);
    // 影轴沿 −x 略偏 +y，向地心方向的垂距 > 地球半径 → miss
    const fp = umbraFootprint(cone, [0, -5e4, 0], EARTH_MEAN_RADIUS_KM);
    expect(fp.exists).toBe(false);
    expect(fp.centerKm).toBeNull();
  });

  it('斜入射：长轴 = 短轴/cos(入射角)，且受掠射钳制护栏', () => {
    // 月球横向偏移 → 足印偏离日下点 → 入射角 > 0 → 长轴 > 短轴
    const cone = umbraCone(sunPos, [3.7e5, 4.2e3, 0]);
    const fp = umbraFootprint(cone, [0, 0, 0], EARTH_MEAN_RADIUS_KM);
    expect(fp.exists).toBe(true);
    expect(fp.majorAxisKm).toBeGreaterThan(fp.minorAxisKm);
    expect(fp.majorAxisKm).toBeLessThanOrEqual(fp.minorAxisKm / GRAZING_COS_MIN + 1e-9);
  });

  it('地球半径非法抛 RangeError', () => {
    const cone = umbraCone(sunPos, [3.78e5, 0, 0]);
    expect(() => umbraFootprint(cone, [0, 0, 0], 0)).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// 贝利珠漏光剖面（§M1-5 锚点）
// ---------------------------------------------------------------------------

describe('beadsLeakProfile', () => {
  const rs = 0.26 * DEG;
  const rm = 0.262 * DEG;

  it('均匀月缘 + 同心 → 均匀漏光（§M1-5 锚点）', () => {
    // moonR < sunR（环食内含瞬间）：日缘处处超出月缘等量
    const uniform = new Array(LIMB_PROFILE_SAMPLE_COUNT).fill(0);
    const leak = beadsLeakProfile(rm, rs, 0, 0, uniform);
    expect(leak).toHaveLength(LIMB_PROFILE_SAMPLE_COUNT);
    const first = leak[0];
    expect(first).toBeGreaterThan(0);
    for (const v of leak) expect(v).toBeCloseTo(first, 12);
  });

  it('单谷剖面 → 单珠位置锚点（§M1-5）', () => {
    // C2 内切瞬间（moonR 刚够全含，余量 ≈ 0.66 km 角当量），
    // 仅极角 300 处有 3 km 深谷 → 唯一漏光点
    const rmTight = rs * (1 + 1e-4 / 0.26); // rm − rs ≈ 1e-4°
    const profile = new Array(LIMB_PROFILE_SAMPLE_COUNT).fill(0);
    profile[300] = -3; // 3 km 深谷
    const leak = beadsLeakProfile(rs, rmTight, 0, 0, profile);
    const positive = leak.map((v, i) => [v, i]).filter(([v]) => v > 0);
    expect(positive).toHaveLength(1);
    expect(positive[0][1]).toBe(300);
  });

  it('山峰（正偏差）不产生漏光，谷深与漏光量一致（km→角量换算自洽）', () => {
    const rmTight = rs * (1 + 1e-4 / 0.26);
    const profile = new Array(LIMB_PROFILE_SAMPLE_COUNT).fill(0);
    profile[100] = 3;
    profile[200] = -2;
    const leak = beadsLeakProfile(rs, rmTight, 0, 0, profile);
    expect(leak[100]).toBe(0);
    // 漏光角 = 谷深角量 − (moonR−sunR)
    const kmToRad = rmTight / MOON_MEAN_RADIUS_KM;
    expect(leak[200]).toBeCloseTo(2 * kmToRad - (rmTight - rs), 12);
  });

  it('深偏食大角距：背日侧无漏光（视线不与日盘相交分支）', () => {
    const uniform = new Array(LIMB_PROFILE_SAMPLE_COUNT).fill(0);
    // 月心偏离日心 0.45°（> sunR），posAngle=0（月在日北）
    const leak = beadsLeakProfile(rs, rm, 0.45 * DEG, 0, uniform);
    // 月北缘（极角 0，背日向）：无漏光；月南缘（极角 180，朝日向）：有漏光
    expect(leak[0]).toBe(0);
    expect(leak[360]).toBeGreaterThan(0);
  });

  it('剖面长度非 720 抛 RangeError', () => {
    expect(() => beadsLeakProfile(rs, rm, 0, 0, [0, 1, 2])).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// 天光非线性感知曲线（§1.4 锚点）
// ---------------------------------------------------------------------------

describe('eclipseSkyDarkening', () => {
  it('90% 遮挡前几乎无感（因子 ≥ 0.9）', () => {
    expect(eclipseSkyDarkening(60, 0).skyFactor01).toBeCloseTo(1, 5);
    expect(eclipseSkyDarkening(60, 0.5).skyFactor01).toBeGreaterThan(0.95);
    expect(eclipseSkyDarkening(60, 0.9).skyFactor01).toBeGreaterThanOrEqual(0.9);
  });

  it('99% 仍近白天：极限星等仍为白昼档（≪ 亮星可见阈值）', () => {
    const d = eclipseSkyDarkening(60, 0.99);
    expect(d.skyFactor01).toBeGreaterThan(0.5);
    expect(d.limitingMag).toBeLessThanOrEqual(-4 + 1e-9);
  });

  it('99% → 100% 天光断崖（§M1-5 锚点：因子骤降 ≥5×）', () => {
    const at99 = eclipseSkyDarkening(60, 0.99).skyFactor01;
    const at100 = eclipseSkyDarkening(60, 1).skyFactor01;
    expect(at99 / at100).toBeGreaterThanOrEqual(5);
  });

  it('全食：等效太阳高度 −9°（深度晨昏），极限星等达亮行星/亮星可见档', () => {
    const d = eclipseSkyDarkening(60, 1);
    expect(d.equivalentSunAltDeg).toBeCloseTo(-9, 6);
    expect(d.limitingMag).toBeGreaterThan(3);
    expect(d.limitingMag).toBeLessThanOrEqual(6.5);
  });

  it('遮挡率单调：因子随遮挡率不增', () => {
    let prev = Infinity;
    for (const obs of [0, 0.3, 0.6, 0.9, 0.95, 0.99, 0.995, 0.999, 1]) {
      const f = eclipseSkyDarkening(45, obs).skyFactor01;
      expect(f).toBeLessThanOrEqual(prev + 1e-12);
      prev = f;
    }
  });

  it('太阳高度调制：低太阳天光更暗；越界遮挡率钳制', () => {
    expect(eclipseSkyDarkening(5, 0).skyFactor01).toBeLessThan(
      eclipseSkyDarkening(60, 0).skyFactor01
    );
    expect(eclipseSkyDarkening(-20, 0).skyFactor01).toBe(0);
    expect(eclipseSkyDarkening(60, 1.5).skyFactor01).toBe(
      eclipseSkyDarkening(60, 1).skyFactor01
    );
    expect(eclipseSkyDarkening(60, -0.5).skyFactor01).toBe(
      eclipseSkyDarkening(60, 0).skyFactor01
    );
    expect(() => eclipseSkyDarkening(NaN, 0)).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// 星光偏折（M5 消费，§M1-5 锚点）
// ---------------------------------------------------------------------------

describe('starDeflectionArcsec', () => {
  it('日面边缘 = 1.7520″（§M1-5 锚点）', () => {
    expect(starDeflectionArcsec(SUN_MEAN_ANGULAR_RADIUS_DEG)).toBeCloseTo(
      GR_LIMB_DEFLECTION_ARCSEC,
      10
    );
  });

  it('2× 边缘角距 → 减半；入参小于边缘钳制到边缘值', () => {
    expect(starDeflectionArcsec(2 * SUN_MEAN_ANGULAR_RADIUS_DEG)).toBeCloseTo(
      GR_LIMB_DEFLECTION_ARCSEC / 2,
      10
    );
    expect(starDeflectionArcsec(0)).toBeCloseTo(GR_LIMB_DEFLECTION_ARCSEC, 10);
    expect(() => starDeflectionArcsec(NaN)).toThrow(RangeError);
  });

  it('毕宿星团量级：角距 5° 处偏折 ~0.09″（Eddington 实测量级自洽）', () => {
    const d = starDeflectionArcsec(5);
    expect(d).toBeGreaterThan(0.05);
    expect(d).toBeLessThan(0.15);
  });
});

// ---------------------------------------------------------------------------
// 插值（端点/越界钳制 + 角度回绕，§M1-5 锚点）
// ---------------------------------------------------------------------------

describe('interpolateEphemeris', () => {
  const series: EphemerisSeries = {
    t0: 1000,
    dtSec: 60,
    rows: [
      [0, 359, 10],
      [10, 1, 20],
      [20, 3, 30],
    ],
  };

  it('中点线性插值', () => {
    expect(interpolateEphemeris(series, 1030)).toEqual([5, 180, 15]);
  });

  it('角度列走最短弧（359° → 1° 过 0 不过 180）', () => {
    const row = interpolateEphemeris(series, 1030, [1]);
    expect(row[1]).toBeCloseTo(0, 10);
    // 非回绕段照常
    expect(interpolateEphemeris(series, 1090, [1])[1]).toBeCloseTo(2, 10);
  });

  it('端点/越界钳制：t < t0 取首行，t > 末行取末行（§M1-5 锚点）', () => {
    expect(interpolateEphemeris(series, -5000)).toEqual([0, 359, 10]);
    expect(interpolateEphemeris(series, 1e9)).toEqual([20, 3, 30]);
    expect(interpolateEphemeris(series, 1000)).toEqual([0, 359, 10]);
    expect(interpolateEphemeris(series, 1120)).toEqual([20, 3, 30]);
  });

  it('非法序列/时刻抛 RangeError', () => {
    expect(() => interpolateEphemeris({ t0: 0, dtSec: 0, rows: [[1]] }, 0)).toThrow(RangeError);
    expect(() => interpolateEphemeris({ t0: 0, dtSec: 60, rows: [] }, 0)).toThrow(RangeError);
    expect(() => interpolateEphemeris(series, NaN)).toThrow(RangeError);
  });

  it('TOPO_ANGULAR_COLUMNS 登记方位角与位置角列', () => {
    expect(TOPO_ANGULAR_COLUMNS).toEqual([1, 4, 6]);
  });
});

describe('geoSampleFromRow', () => {
  it('解码 8 列 geo 行并归一方向', () => {
    const s = geoSampleFromRow([2, 0, 0, 1.5e8, 0, 3, 0, 3.8e5], 123);
    expect(s.tSec).toBe(123);
    expect(s.sunDir).toEqual([1, 0, 0]);
    expect(s.moonDir).toEqual([0, 1, 0]);
    expect(s.sunDistKm).toBe(1.5e8);
    expect(s.moonDistKm).toBe(3.8e5);
  });

  it('列数错误/零方向向量抛 RangeError', () => {
    expect(() => geoSampleFromRow([1, 2, 3], 0)).toThrow(RangeError);
    expect(() => geoSampleFromRow([0, 0, 0, 1.5e8, 0, 1, 0, 3.8e5], 0)).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// 站心变换 + 东西镜像防守（契约 C4，§M1-5 锚点）
// ---------------------------------------------------------------------------

describe('topocentricSunMoon', () => {
  // J2000 历元（2000-01-01 12:00 UTC）：GMST = 280.46061837°。
  // 取观测点东经 360−280.4606… → 当地恒星时 LST = 0（本地子午线指向 RA 0）。
  const T_J2000 = 946728000;
  const LON_LST0 = 360 - 280.46061837;
  const observer = { latDeg: 0, lonDeg: LON_LST0, altM: 0 };

  it('RA=0 天体在赤道观测点天顶（alt ≈ 90°）', () => {
    const topo = topocentricSunMoon(
      {
        tSec: T_J2000,
        sunDir: [1, 0, 0],
        sunDistKm: 1.496e8,
        moonDir: [1, 0, 0],
        moonDistKm: 3.784e5,
      },
      observer
    );
    expect(topo.sunAltDeg).toBeGreaterThan(89.9);
    expect(topo.moonAltDeg).toBeGreaterThan(89);
    // 视半径：太阳 ~0.266°、月球 ~0.26°+站心视差增大
    expect(topo.sunSdDeg).toBeGreaterThan(0.25);
    expect(topo.sunSdDeg).toBeLessThan(0.28);
    expect(topo.moonSdDeg).toBeGreaterThan(0.25);
    expect(topo.moonSdDeg).toBeLessThan(0.28);
    expect(topo.sepDeg).toBeLessThan(0.01);
  });

  it('东西镜像防守（契约 C4）：RA=90°（正东天体）→ Az≈90° → 场景 +X', () => {
    const topo = topocentricSunMoon(
      {
        tSec: T_J2000,
        sunDir: [0, 1, 0],
        sunDistKm: 1.496e8,
        moonDir: [0, 1, 0],
        moonDistKm: 3.784e5,
      },
      observer
    );
    expect(topo.sunAzDeg).toBeGreaterThan(89.5);
    expect(topo.sunAzDeg).toBeLessThan(90.5);
    // 远天体地平高度 ≈ 0；月球受站心视差压低 ~0.95°
    expect(Math.abs(topo.sunAltDeg)).toBeLessThan(0.1);
    expect(topo.moonAltDeg).toBeLessThan(-0.7);
    expect(topo.moonAltDeg).toBeGreaterThan(-1.2);
    const scene = altAzToSceneDirection(0, topo.sunAzDeg);
    expect(scene[0]).toBeGreaterThan(0.99); // +X = 正东
    expect(Math.abs(scene[2])).toBeLessThan(0.01);
  });

  it('北天极方向 → Az≈0（正北）→ 场景 −Z', () => {
    const topo = topocentricSunMoon(
      {
        tSec: T_J2000,
        sunDir: [0, 0, 1],
        sunDistKm: 1.496e8,
        moonDir: [0, 0, 1],
        moonDistKm: 3.784e5,
      },
      observer
    );
    expect(Math.min(topo.sunAzDeg, 360 - topo.sunAzDeg)).toBeLessThan(0.1);
    const scene = altAzToSceneDirection(topo.sunAltDeg, topo.sunAzDeg);
    expect(scene[2]).toBeLessThan(-0.9); // −Z = 正北
  });

  it('位置角：月在日北 → PA≈0，月在日东 → PA≈90（天球北起经东）', () => {
    const delta = 0.3 * DEG;
    const north = topocentricSunMoon(
      {
        tSec: T_J2000,
        sunDir: [1, 0, 0],
        sunDistKm: 1.496e8,
        moonDir: [Math.cos(delta), 0, Math.sin(delta)],
        moonDistKm: 1.496e8, // 远距抑制视差，纯几何锚点
      },
      observer
    );
    expect(Math.min(north.posAngleDeg, 360 - north.posAngleDeg)).toBeLessThan(0.5);
    expect(north.sepDeg).toBeCloseTo(0.3, 3);
    const east = topocentricSunMoon(
      {
        tSec: T_J2000,
        sunDir: [1, 0, 0],
        sunDistKm: 1.496e8,
        moonDir: [Math.cos(delta), Math.sin(delta), 0],
        moonDistKm: 1.496e8,
      },
      observer
    );
    expect(east.posAngleDeg).toBeGreaterThan(89.5);
    expect(east.posAngleDeg).toBeLessThan(90.5);
  });

  it('altAzToSceneDirection 与 meteorShower.sceneDirFromAltAz 同源一致', () => {
    const viaEclipse = altAzToSceneDirection(30, 120);
    const viaMeteor = sceneDirFromAltAz({ altRad: 30 * DEG, azRad: 120 * DEG });
    expect(viaEclipse[0]).toBeCloseTo(viaMeteor[0], 12);
    expect(viaEclipse[1]).toBeCloseTo(viaMeteor[1], 12);
    expect(viaEclipse[2]).toBeCloseTo(viaMeteor[2], 12);
  });

  it('非法入参抛 RangeError', () => {
    const sample = {
      tSec: T_J2000,
      sunDir: [1, 0, 0] as const,
      sunDistKm: 1.5e8,
      moonDir: [1, 0, 0] as const,
      moonDistKm: 3.8e5,
    };
    expect(() => topocentricSunMoon(sample, { latDeg: 91, lonDeg: 0, altM: 0 })).toThrow(
      RangeError
    );
    expect(() => topocentricSunMoon(sample, { latDeg: NaN, lonDeg: 0, altM: 0 })).toThrow(
      RangeError
    );
    expect(() =>
      topocentricSunMoon({ ...sample, sunDistKm: 0 }, { latDeg: 0, lonDeg: 0, altM: 0 })
    ).toThrow(RangeError);
    expect(() => altAzToSceneDirection(NaN, 0)).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// 接触时刻反解（§1.3 工具）
// ---------------------------------------------------------------------------

describe('deriveContactTimes / topoAngularSepDeg', () => {
  /** 合成 topo 序列：日固定于 (alt 0, az 180)，月方位角线性扫过，构造对称食 */
  function syntheticSeries(): EphemerisSeries {
    const rows: number[][] = [];
    const sunSd = 0.25;
    const moonSd = 0.26;
    for (let i = 0; i <= 100; i += 1) {
      const t = i * 10; // dt=10s，跨度 1000s
      const delta = (Math.abs(t - 500) / 500) * 0.6; // 角距 0.6° → 0 → 0.6°
      rows.push([0, 180, sunSd, 0, 180 + delta, moonSd, delta >= 0 ? 90 : 270]);
    }
    return { t0: 0, dtSec: 10, rows };
  }

  it('topoAngularSepDeg：赤道地平构型角距 = 方位差', () => {
    const sep = topoAngularSepDeg([0, 180, 0.25, 0, 180.4, 0.26, 90]);
    expect(sep).toBeCloseTo(0.4, 10);
    expect(() => topoAngularSepDeg([1, 2, 3])).toThrow(RangeError);
  });

  it('对称合成食：C1/C2/max/C3/C4 反解齐全且对称', () => {
    const derived = deriveContactTimes(syntheticSeries());
    expect(derived).not.toBeNull();
    const d = derived as NonNullable<typeof derived>;
    // 外切 delta = 0.51° → t = 500 ± 425；内切 delta = 0.01° → t = 500 ± 8.33
    expect(d.c1).toBeCloseTo(75, 0);
    expect(d.c4).toBeCloseTo(925, 0);
    expect(d.c2).not.toBeNull();
    expect(d.c3).not.toBeNull();
    expect(d.c2 as number).toBeCloseTo(491.7, 0);
    expect(d.c3 as number).toBeCloseTo(508.3, 0);
    expect(d.max).toBeCloseTo(500, 0);
  });

  it('偏食序列（无内切）：c2/c3 为 null；过短序列返回 null', () => {
    const rows: number[][] = [];
    for (let i = 0; i <= 40; i += 1) {
      const delta = 0.2 + (Math.abs(i - 20) / 20) * 0.4; // 最小 0.2° > |sd 差|
      rows.push([0, 180, 0.25, 0, 180 + delta, 0.26, 90]);
    }
    const derived = deriveContactTimes({ t0: 0, dtSec: 10, rows });
    expect(derived).not.toBeNull();
    expect((derived as NonNullable<typeof derived>).c2).toBeNull();
    expect((derived as NonNullable<typeof derived>).c3).toBeNull();
    expect(deriveContactTimes({ t0: 0, dtSec: 10, rows: [rows[0]] })).toBeNull();
  });

  it('无外切交叉（全程无食）返回 null', () => {
    const rows: number[][] = [];
    for (let i = 0; i <= 10; i += 1) {
      rows.push([0, 180, 0.25, 0, 183, 0.26, 90]);
    }
    expect(deriveContactTimes({ t0: 0, dtSec: 10, rows })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 常量登记
// ---------------------------------------------------------------------------

describe('常量与契约登记', () => {
  it('物理常量与场景比例（契约 C4）', () => {
    expect(SUN_RADIUS_KM).toBe(695700);
    expect(MOON_MEAN_RADIUS_KM).toBe(1737.4);
    expect(LIMB_PROFILE_SAMPLE_COUNT).toBe(720);
  });
});
