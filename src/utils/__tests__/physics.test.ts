/**
 * 开普勒轨道物理计算单元测试（需求 7：物理计算函数必须完整测试）
 */

import type { OrbitalElements } from '@/types';
import {
  DAYS_PER_YEAR,
  DEG_TO_RAD,
  J2000_EPOCH_MS,
  daysSinceJ2000,
  heliocentricDistanceAu,
  heliocentricPosition,
  meanAnomalyAtTime,
  meanMotionRadPerDay,
  normalizeAngle,
  orbitalPeriodYears,
  positionFromTrueAnomaly,
  rotationAngleAtTime,
  sampleOrbitPoints,
  solveKeplerEquation,
  trueAnomalyFromEccentric,
} from '@/utils/physics';
import { PLANETS, getPlanetById } from '@/data/planets';

const EARTH = getPlanetById('earth')!.orbit;

/** 高离心率测试轨道（哈雷彗星量级 e≈0.967） */
const HIGH_ECC_ORBIT: OrbitalElements = {
  semiMajorAxisAu: 17.8,
  eccentricity: 0.967,
  inclinationDeg: 162.26,
  longitudeOfAscendingNodeDeg: 58.42,
  argumentOfPerihelionDeg: 111.33,
  meanAnomalyAtEpochDeg: 38.38,
};

describe('daysSinceJ2000', () => {
  it('J2000 历元当天为 0', () => {
    expect(daysSinceJ2000(new Date(J2000_EPOCH_MS))).toBe(0);
  });

  it('历元后一天为 1，之前为负', () => {
    expect(daysSinceJ2000(new Date(J2000_EPOCH_MS + 86400000))).toBe(1);
    expect(daysSinceJ2000(new Date(J2000_EPOCH_MS - 86400000))).toBe(-1);
  });
});

describe('normalizeAngle', () => {
  it('将角度规范化到 [0, 2π)', () => {
    expect(normalizeAngle(0)).toBe(0);
    expect(normalizeAngle(Math.PI * 2)).toBeCloseTo(0, 12);
    expect(normalizeAngle(Math.PI * 5)).toBeCloseTo(Math.PI, 12);
    expect(normalizeAngle(-Math.PI / 2)).toBeCloseTo((3 * Math.PI) / 2, 12);
  });
});

describe('solveKeplerEquation', () => {
  it('圆轨道（e=0）时 E = M', () => {
    for (const M of [0, 0.5, Math.PI, 5.5]) {
      expect(solveKeplerEquation(M, 0)).toBeCloseTo(M, 9);
    }
  });

  it('解满足开普勒方程 M = E − e·sinE（常规离心率）', () => {
    for (const e of [0.0167, 0.2056, 0.5]) {
      for (let M = 0; M < Math.PI * 2; M += 0.3) {
        const E = solveKeplerEquation(M, e);
        expect(normalizeAngle(E - e * Math.sin(E))).toBeCloseTo(normalizeAngle(M), 8);
      }
    }
  });

  it('高离心率（哈雷彗星 e=0.967）依然收敛', () => {
    for (let M = 0.05; M < Math.PI * 2; M += 0.25) {
      const E = solveKeplerEquation(M, 0.967);
      expect(normalizeAngle(E - 0.967 * Math.sin(E))).toBeCloseTo(normalizeAngle(M), 7);
    }
  });

  it('M=0 附近（sinM=0 分支）正常求解', () => {
    const E = solveKeplerEquation(0, 0.5);
    expect(normalizeAngle(E - 0.5 * Math.sin(E))).toBeCloseTo(0, 8);
  });

  it('非椭圆离心率抛出异常', () => {
    expect(() => solveKeplerEquation(1, 1)).toThrow(RangeError);
    expect(() => solveKeplerEquation(1, 1.5)).toThrow(RangeError);
    expect(() => solveKeplerEquation(1, -0.1)).toThrow(RangeError);
  });
});

describe('trueAnomalyFromEccentric', () => {
  it('近日点（E=0）与远日点（E=π）不变', () => {
    expect(trueAnomalyFromEccentric(0, 0.3)).toBeCloseTo(0, 12);
    expect(Math.abs(trueAnomalyFromEccentric(Math.PI, 0.3))).toBeCloseTo(Math.PI, 12);
  });

  it('椭圆轨道上真近点角超前偏近点角（上半程）', () => {
    const nu = trueAnomalyFromEccentric(1, 0.5);
    expect(nu).toBeGreaterThan(1);
  });
});

describe('orbitalPeriodYears（开普勒第三定律）', () => {
  it('地球 a=1 AU → 1 年', () => {
    expect(orbitalPeriodYears(1)).toBeCloseTo(1, 12);
  });

  it('木星 a=5.203 AU → 约 11.86 年', () => {
    expect(orbitalPeriodYears(5.20336301)).toBeCloseTo(11.86, 1);
  });

  it('非正半长轴抛出异常', () => {
    expect(() => orbitalPeriodYears(0)).toThrow(RangeError);
    expect(() => orbitalPeriodYears(-1)).toThrow(RangeError);
  });
});

describe('meanMotionRadPerDay / meanAnomalyAtTime', () => {
  it('地球平均运动约 0.0172 rad/天', () => {
    expect(meanMotionRadPerDay(1)).toBeCloseTo((Math.PI * 2) / 365.25, 10);
  });

  it('历元时刻平近点角等于 M₀', () => {
    const M = meanAnomalyAtTime(EARTH, 0);
    expect(M).toBeCloseTo(normalizeAngle(EARTH.meanAnomalyAtEpochDeg * DEG_TO_RAD), 10);
  });

  it('经过一个完整周期后平近点角回到原值', () => {
    const periodDays = orbitalPeriodYears(EARTH.semiMajorAxisAu) * DAYS_PER_YEAR;
    const m0 = meanAnomalyAtTime(EARTH, 0);
    const m1 = meanAnomalyAtTime(EARTH, periodDays);
    expect(m1).toBeCloseTo(m0, 6);
  });
});

describe('positionFromTrueAnomaly', () => {
  it('近日点距离 = a(1−e)，远日点距离 = a(1+e)', () => {
    const { semiMajorAxisAu: a, eccentricity: e } = EARTH;
    const peri = positionFromTrueAnomaly(EARTH, 0);
    const apo = positionFromTrueAnomaly(EARTH, Math.PI);
    expect(Math.hypot(peri.x, peri.y, peri.z)).toBeCloseTo(a * (1 - e), 10);
    expect(Math.hypot(apo.x, apo.y, apo.z)).toBeCloseTo(a * (1 + e), 10);
  });

  it('地球轨道几乎无倾角，z 分量近似为 0', () => {
    for (let nu = 0; nu < Math.PI * 2; nu += 0.5) {
      const p = positionFromTrueAnomaly(EARTH, nu);
      expect(Math.abs(p.z)).toBeLessThan(1e-5);
    }
  });

  it('水星轨道倾角 7° 产生显著 z 分量', () => {
    const mercury = getPlanetById('mercury')!.orbit;
    let maxZ = 0;
    for (let nu = 0; nu < Math.PI * 2; nu += 0.1) {
      maxZ = Math.max(maxZ, Math.abs(positionFromTrueAnomaly(mercury, nu).z));
    }
    // 最大 z ≈ a·sin(i)
    expect(maxZ).toBeGreaterThan(mercury.semiMajorAxisAu * Math.sin(7 * DEG_TO_RAD) * 0.8);
  });
});

describe('heliocentricPosition（核心：开普勒方程求位置）', () => {
  it('地球日心距离始终在 [0.983, 1.017] AU 之间', () => {
    for (let t = 0; t < 400; t += 10) {
      const d = heliocentricDistanceAu(EARTH, t);
      expect(d).toBeGreaterThanOrEqual(0.9832);
      expect(d).toBeLessThanOrEqual(1.0168);
    }
  });

  it('J2000 后约 2.5 天地球到达近日点（真实历表：2000-01-03）', () => {
    // M(t)=0 时为近日点
    const n = meanMotionRadPerDay(EARTH.semiMajorAxisAu);
    const M0 = normalizeAngle(EARTH.meanAnomalyAtEpochDeg * DEG_TO_RAD);
    const tPeri = (Math.PI * 2 - M0) / n;
    expect(tPeri).toBeGreaterThan(1);
    expect(tPeri).toBeLessThan(4);
    const d = heliocentricDistanceAu(EARTH, tPeri);
    expect(d).toBeCloseTo(EARTH.semiMajorAxisAu * (1 - EARTH.eccentricity), 6);
  });

  it('公转方向：自北黄极俯视为逆时针（角动量 z 分量为正）', () => {
    for (const planet of PLANETS) {
      const dt = 0.01;
      const p0 = heliocentricPosition(planet.orbit, 100);
      const p1 = heliocentricPosition(planet.orbit, 100 + dt);
      const vx = (p1.x - p0.x) / dt;
      const vy = (p1.y - p0.y) / dt;
      const lz = p0.x * vy - p0.y * vx;
      expect(lz).toBeGreaterThan(0);
    }
  });

  it('开普勒第二定律：匀面速度（近日点与远日点面积速度相等）', () => {
    const arealVelocity = (elements: OrbitalElements, t: number): number => {
      const dt = 1e-3;
      const p0 = heliocentricPosition(elements, t);
      const p1 = heliocentricPosition(elements, t + dt);
      const vx = (p1.x - p0.x) / dt;
      const vy = (p1.y - p0.y) / dt;
      const vz = (p1.z - p0.z) / dt;
      // |r × v| / 2
      const cx = p0.y * vz - p0.z * vy;
      const cy = p0.z * vx - p0.x * vz;
      const cz = p0.x * vy - p0.y * vx;
      return Math.hypot(cx, cy, cz) / 2;
    };
    const n = meanMotionRadPerDay(EARTH.semiMajorAxisAu);
    const M0 = normalizeAngle(EARTH.meanAnomalyAtEpochDeg * DEG_TO_RAD);
    const tPeri = (Math.PI * 2 - M0) / n;
    const tApo = tPeri + (orbitalPeriodYears(1) * DAYS_PER_YEAR) / 2;
    const aPeri = arealVelocity(EARTH, tPeri);
    const aApo = arealVelocity(EARTH, tApo);
    expect(aPeri).toBeCloseTo(aApo, 6);
  });

  it('开普勒第二定律：近日点速度大于远日点（高离心率轨道效果显著）', () => {
    const speed = (elements: OrbitalElements, t: number): number => {
      const dt = 1e-3;
      const p0 = heliocentricPosition(elements, t);
      const p1 = heliocentricPosition(elements, t + dt);
      return Math.hypot(p1.x - p0.x, p1.y - p0.y, p1.z - p0.z) / dt;
    };
    const n = meanMotionRadPerDay(HIGH_ECC_ORBIT.semiMajorAxisAu);
    const M0 = normalizeAngle(HIGH_ECC_ORBIT.meanAnomalyAtEpochDeg * DEG_TO_RAD);
    const tPeri = (Math.PI * 2 - M0) / n;
    const periodDays = orbitalPeriodYears(HIGH_ECC_ORBIT.semiMajorAxisAu) * DAYS_PER_YEAR;
    const vPeri = speed(HIGH_ECC_ORBIT, tPeri);
    const vApo = speed(HIGH_ECC_ORBIT, tPeri + periodDays / 2);
    // e=0.967 时近日点/远日点速度比 = (1+e)/(1−e) ≈ 59.6
    expect(vPeri / vApo).toBeGreaterThan(50);
  });

  it('逆行轨道（倾角 162° > 90°）角动量 z 分量为负', () => {
    const dt = 0.01;
    const p0 = heliocentricPosition(HIGH_ECC_ORBIT, 50);
    const p1 = heliocentricPosition(HIGH_ECC_ORBIT, 50 + dt);
    const lz = p0.x * ((p1.y - p0.y) / dt) - p0.y * ((p1.x - p0.x) / dt);
    expect(lz).toBeLessThan(0);
  });
});

describe('sampleOrbitPoints', () => {
  it('返回 segments+1 个点且首尾闭合', () => {
    const points = sampleOrbitPoints(EARTH, 64);
    expect(points).toHaveLength(65);
    expect(points[0].x).toBeCloseTo(points[64].x, 9);
    expect(points[0].y).toBeCloseTo(points[64].y, 9);
    expect(points[0].z).toBeCloseTo(points[64].z, 9);
  });

  it('所有采样点日心距离在 [a(1−e), a(1+e)] 内（准确椭圆）', () => {
    const { semiMajorAxisAu: a, eccentricity: e } = HIGH_ECC_ORBIT;
    for (const p of sampleOrbitPoints(HIGH_ECC_ORBIT, 128)) {
      const r = Math.hypot(p.x, p.y, p.z);
      expect(r).toBeGreaterThanOrEqual(a * (1 - e) - 1e-9);
      expect(r).toBeLessThanOrEqual(a * (1 + e) + 1e-9);
    }
  });

  it('默认 512 分段', () => {
    expect(sampleOrbitPoints(EARTH)).toHaveLength(513);
  });

  it('分段数不足抛出异常', () => {
    expect(() => sampleOrbitPoints(EARTH, 2)).toThrow(RangeError);
  });
});

describe('rotationAngleAtTime', () => {
  it('24 小时周期一天转 2π', () => {
    expect(rotationAngleAtTime(24, 1)).toBeCloseTo(Math.PI * 2, 10);
  });

  it('负周期（金星/天王星逆向标记）返回负角度', () => {
    expect(rotationAngleAtTime(-5832.5, 10)).toBeLessThan(0);
  });

  it('木星 9.925 小时自转快于地球', () => {
    expect(rotationAngleAtTime(9.925, 1)).toBeGreaterThan(rotationAngleAtTime(23.9345, 1));
  });

  it('零周期抛出异常', () => {
    expect(() => rotationAngleAtTime(0, 1)).toThrow(RangeError);
  });
});
