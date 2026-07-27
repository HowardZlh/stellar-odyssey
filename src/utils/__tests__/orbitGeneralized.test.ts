/**
 * 广义开普勒轨道测试（卫星绕行星、彗星逆行轨道，需求 3.1.1）
 */

import type { OrbitalElements } from '@/types';
import {
  DEG_TO_RAD,
  heliocentricPosition,
  orbitMeanAnomalyWithPeriod,
  orbitPositionWithPeriod,
  solveKeplerEquation,
  trueAnomalyFromEccentric,
} from '@/utils/physics';

const MOON_ORBIT: OrbitalElements = {
  semiMajorAxisAu: 384400, // 广义接口：单位与字段一致即可（此处为 km）
  eccentricity: 0.0549,
  inclinationDeg: 5.145,
  longitudeOfAscendingNodeDeg: 125.08,
  argumentOfPerihelionDeg: 318.15,
  meanAnomalyAtEpochDeg: 115.36,
};

describe('orbitPositionWithPeriod', () => {
  it('一个周期后回到初始位置', () => {
    const period = 27.321661;
    const p0 = orbitPositionWithPeriod(MOON_ORBIT, period, 0);
    const p1 = orbitPositionWithPeriod(MOON_ORBIT, period, period);
    expect(p1.x).toBeCloseTo(p0.x, 3);
    expect(p1.y).toBeCloseTo(p0.y, 3);
    expect(p1.z).toBeCloseTo(p0.z, 3);
  });

  it('距离在近点与远点之间', () => {
    const a = MOON_ORBIT.semiMajorAxisAu;
    const e = MOON_ORBIT.eccentricity;
    for (const t of [0, 5, 13, 20]) {
      const p = orbitPositionWithPeriod(MOON_ORBIT, 27.321661, t);
      const r = Math.hypot(p.x, p.y, p.z);
      expect(r).toBeGreaterThanOrEqual(a * (1 - e) - 1);
      expect(r).toBeLessThanOrEqual(a * (1 + e) + 1);
    }
  });

  it('满足开普勒第二定律：近点角速度快于远点', () => {
    const period = 27.321661;
    const dt = 0.01;
    // 近点：M=0
    const orbitAtPeri = { ...MOON_ORBIT, meanAnomalyAtEpochDeg: 0 };
    const p1 = orbitPositionWithPeriod(orbitAtPeri, period, 0);
    const p2 = orbitPositionWithPeriod(orbitAtPeri, period, dt);
    const vPeri = Math.hypot(p2.x - p1.x, p2.y - p1.y, p2.z - p1.z) / dt;
    // 远点：M=180°
    const orbitAtApo = { ...MOON_ORBIT, meanAnomalyAtEpochDeg: 180 };
    const q1 = orbitPositionWithPeriod(orbitAtApo, period, 0);
    const q2 = orbitPositionWithPeriod(orbitAtApo, period, dt);
    const vApo = Math.hypot(q2.x - q1.x, q2.y - q1.y, q2.z - q1.z) / dt;
    expect(vPeri).toBeGreaterThan(vApo);
  });

  it('与太阳中心版本一致（地球轨道对照）', () => {
    const earthOrbit: OrbitalElements = {
      semiMajorAxisAu: 1.00000011,
      eccentricity: 0.01671022,
      inclinationDeg: 0.00005,
      longitudeOfAscendingNodeDeg: -11.26064,
      argumentOfPerihelionDeg: 114.20783,
      meanAnomalyAtEpochDeg: -2.48284,
    };
    const periodDays = 365.25 * Math.pow(earthOrbit.semiMajorAxisAu, 1.5);
    const viaSun = heliocentricPosition(earthOrbit, 500);
    const viaPeriod = orbitPositionWithPeriod(earthOrbit, periodDays, 500);
    expect(viaPeriod.x).toBeCloseTo(viaSun.x, 4);
    expect(viaPeriod.y).toBeCloseTo(viaSun.y, 4);
    expect(viaPeriod.z).toBeCloseTo(viaSun.z, 4);
  });

  it('高离心率轨道（哈雷 e≈0.967）位置有界且近日点距离正确', () => {
    const halley: OrbitalElements = {
      semiMajorAxisAu: 17.834,
      eccentricity: 0.96714,
      inclinationDeg: 162.26,
      longitudeOfAscendingNodeDeg: 58.42,
      argumentOfPerihelionDeg: 111.33,
      meanAnomalyAtEpochDeg: 0, // 近日点
    };
    const p = orbitPositionWithPeriod(halley, 75.32 * 365.25, 0);
    const r = Math.hypot(p.x, p.y, p.z);
    expect(r).toBeCloseTo(17.834 * (1 - 0.96714), 3); // 约 0.586 AU
  });

  it('逆行轨道（倾角 >90°）公转方向与顺行相反（自北黄极俯视）', () => {
    const prograde: OrbitalElements = {
      semiMajorAxisAu: 10,
      eccentricity: 0,
      inclinationDeg: 0,
      longitudeOfAscendingNodeDeg: 0,
      argumentOfPerihelionDeg: 0,
      meanAnomalyAtEpochDeg: 0,
    };
    const retrograde: OrbitalElements = { ...prograde, inclinationDeg: 180 };
    const dt = 10;
    const period = 1000;
    // z 分量为 0，用叉积 z 分量判断旋转方向
    const p0 = orbitPositionWithPeriod(prograde, period, 0);
    const p1 = orbitPositionWithPeriod(prograde, period, dt);
    const progradeCross = p0.x * p1.y - p0.y * p1.x;
    const q0 = orbitPositionWithPeriod(retrograde, period, 0);
    const q1 = orbitPositionWithPeriod(retrograde, period, dt);
    const retrogradeCross = q0.x * q1.y - q0.y * q1.x;
    expect(progradeCross).toBeGreaterThan(0); // 逆时针
    expect(retrogradeCross).toBeLessThan(0); // 顺时针（逆行）
  });

  it('周期为 0 抛错', () => {
    expect(() => orbitPositionWithPeriod(MOON_ORBIT, 0, 10)).toThrow(RangeError);
  });
});

describe('orbitMeanAnomalyWithPeriod', () => {
  it('相位随时间线性推进并规范化', () => {
    const m0 = orbitMeanAnomalyWithPeriod(0, 10, 0);
    const m25 = orbitMeanAnomalyWithPeriod(0, 10, 2.5);
    expect(m0).toBe(0);
    expect(m25).toBeCloseTo(Math.PI / 2, 9);
    expect(orbitMeanAnomalyWithPeriod(0, 10, 10)).toBeCloseTo(0, 9);
  });

  it('周期为 0 抛错', () => {
    expect(() => orbitMeanAnomalyWithPeriod(0, 0, 1)).toThrow(RangeError);
  });
});

describe('高离心率开普勒方程回归', () => {
  it('e=0.99 时仍收敛且残差小', () => {
    for (const M of [0.1, 1, 2, 3, 5]) {
      const E = solveKeplerEquation(M, 0.99);
      expect(Math.abs(E - 0.99 * Math.sin(E) - (M % (Math.PI * 2)))).toBeLessThan(1e-8);
      const nu = trueAnomalyFromEccentric(E, 0.99);
      expect(Number.isFinite(nu)).toBe(true);
    }
  });

  it('倾角转换常量自洽', () => {
    expect(162.26 * DEG_TO_RAD).toBeGreaterThan(Math.PI / 2); // 哈雷为逆行
  });
});
