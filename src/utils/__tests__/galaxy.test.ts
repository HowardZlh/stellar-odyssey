/**
 * 银河系结构与太阳系绕银心运动单元测试（需求 3.1.2 / 4.4）
 */

import {
  DAYS_PER_MYR,
  ECLIPTIC_GALACTIC_TILT_DEG,
  GALACTIC_BULGE_RADIUS_LY,
  GALACTIC_DISK_RADIUS_LY,
  GALACTIC_DISK_THICKNESS_LY,
  GALACTIC_ROTATION_KM_S,
  GALACTIC_YEAR_MYR,
  KM_S_TO_LY_PER_MYR,
  SUN_GALACTIC_RADIUS_LY,
  SUN_VERTICAL_AMPLITUDE_LY,
  SUN_VERTICAL_PERIOD_MYR,
  GALAXY_SHADER_MYR_WRAP,
  diskAngularSpeedRadPerMyr,
  diskParticleAngle,
  galacticYearProgress,
  galaxyShaderMyr,
  generateGalaxyDiskParticles,
  simDaysToMyr,
  sunGalacticPositionLy,
  type GalaxyDiskParams,
} from '@/utils/galaxy';

/** 百万年 → 模拟天数 */
const myrToDays = (myr: number): number => myr * DAYS_PER_MYR;

const BASE_PARAMS: GalaxyDiskParams = {
  count: 4000,
  seed: 42,
  armCount: 4,
  diskRadiusLy: GALACTIC_DISK_RADIUS_LY,
  thicknessLy: GALACTIC_DISK_THICKNESS_LY,
  bulgeRadiusLy: GALACTIC_BULGE_RADIUS_LY,
  bulgeFraction: 0.15,
  spiralTightness: 1.2,
  armSpreadRad: 0.25,
};

describe('常量科学性（数据来源范围断言）', () => {
  it('银河年约 2.3 亿年', () => {
    expect(GALACTIC_YEAR_MYR).toBe(230);
  });

  it('太阳距银心约 2.6–2.7 万光年（自洽修正后 ≈8.24 kpc，落在 IAU 8.0–8.3 kpc 内）', () => {
    // P6 数据自洽：R 由 v·T/(2π) 反推，不再硬编码 26000
    expect(SUN_GALACTIC_RADIUS_LY).toBeGreaterThan(26000);
    expect(SUN_GALACTIC_RADIUS_LY).toBeLessThan(27500);
    // 8.0–8.3 kpc（1 kpc = 3261.56 ly）
    const kpc = SUN_GALACTIC_RADIUS_LY / 3261.56;
    expect(kpc).toBeGreaterThanOrEqual(8.0);
    expect(kpc).toBeLessThanOrEqual(8.3);
  });

  it('数据自洽：ω(R_sun) 精确等于银河年角速度 2π/T（P6 §3.1.2，消除 3% 偏差）', () => {
    expect(diskAngularSpeedRadPerMyr(SUN_GALACTIC_RADIUS_LY)).toBeCloseTo(
      (Math.PI * 2) / GALACTIC_YEAR_MYR,
      10,
    );
  });

  it('银盘直径约 10 万光年、厚约 1 千光年、核球约 8 千光年', () => {
    expect(GALACTIC_DISK_RADIUS_LY * 2).toBe(100000);
    expect(GALACTIC_DISK_THICKNESS_LY).toBe(1000);
    expect(GALACTIC_BULGE_RADIUS_LY).toBe(8000);
  });

  it('垂直振荡周期约 7000 万年，振幅在 ±70–100 pc（228–326 ly）内', () => {
    expect(SUN_VERTICAL_PERIOD_MYR).toBe(70);
    expect(SUN_VERTICAL_AMPLITUDE_LY).toBeGreaterThanOrEqual(228);
    expect(SUN_VERTICAL_AMPLITUDE_LY).toBeLessThanOrEqual(326);
  });

  it('旋转线速度 220 km/s，黄道-银道夹角 60.2°', () => {
    expect(GALACTIC_ROTATION_KM_S).toBe(220);
    expect(ECLIPTIC_GALACTIC_TILT_DEG).toBeCloseTo(60.2, 6);
  });

  it('单位换算：1 km/s ≈ 3.3357 ly/Myr（独立推导校验）', () => {
    // 1 km/s × 3.15576e13 s/Myr ÷ 9.4607e12 km/ly
    const derived = 3.15576e13 / 9.4607e12;
    expect(KM_S_TO_LY_PER_MYR).toBeCloseTo(derived, 2);
  });
});

describe('simDaysToMyr', () => {
  it('365.25e6 天 = 1 Myr，0 天 = 0', () => {
    expect(simDaysToMyr(DAYS_PER_MYR)).toBe(1);
    expect(simDaysToMyr(0)).toBe(0);
    expect(simDaysToMyr(-DAYS_PER_MYR * 2)).toBe(-2);
  });
});

describe('sunGalacticPositionLy', () => {
  it('t=0 时位于 (26000, 0, 0)', () => {
    const p = sunGalacticPositionLy(0);
    expect(p.x).toBeCloseTo(SUN_GALACTIC_RADIUS_LY, 6);
    expect(p.y).toBeCloseTo(0, 6);
    expect(p.z).toBeCloseTo(0, 6);
  });

  it('四分之一银河年后角度 π/2：x≈0，z≈−26000（自 +y 俯视逆时针）', () => {
    const p = sunGalacticPositionLy(myrToDays(GALACTIC_YEAR_MYR / 4));
    expect(p.x).toBeCloseTo(0, 4);
    expect(p.z).toBeCloseTo(-SUN_GALACTIC_RADIUS_LY, 4);
  });

  it('垂直振荡：t=17.5 Myr（周期 1/4）时 y≈300', () => {
    const p = sunGalacticPositionLy(myrToDays(SUN_VERTICAL_PERIOD_MYR / 4));
    expect(p.y).toBeCloseTo(SUN_VERTICAL_AMPLITUDE_LY, 4);
  });

  it('一个垂直周期（70 Myr）后 y 回到 ≈0', () => {
    const p = sunGalacticPositionLy(myrToDays(SUN_VERTICAL_PERIOD_MYR));
    expect(p.y).toBeCloseTo(0, 4);
  });

  it('波浪轨迹：一条银河年内 y 既有正值也有负值（需求 3.1.2 防静态化）', () => {
    let hasPositive = false;
    let hasNegative = false;
    for (let t = 0; t <= GALACTIC_YEAR_MYR; t += 5) {
      const y = sunGalacticPositionLy(myrToDays(t)).y;
      if (y > 50) hasPositive = true;
      if (y < -50) hasNegative = true;
    }
    expect(hasPositive).toBe(true);
    expect(hasNegative).toBe(true);
  });
});

describe('galacticYearProgress', () => {
  it('0 天 → 全零', () => {
    const p = galacticYearProgress(0);
    expect(p.angleRad).toBe(0);
    expect(p.orbits).toBe(0);
    expect(p.progress01).toBe(0);
  });

  it('115 Myr（半圈）→ progress01≈0.5、angleRad≈π', () => {
    const p = galacticYearProgress(myrToDays(GALACTIC_YEAR_MYR / 2));
    expect(p.angleRad).toBeCloseTo(Math.PI, 10);
    expect(p.orbits).toBe(0);
    expect(p.progress01).toBeCloseTo(0.5, 10);
  });

  it('230 Myr（整圈）→ orbits=1、progress01≈0', () => {
    const p = galacticYearProgress(myrToDays(GALACTIC_YEAR_MYR));
    expect(p.orbits).toBe(1);
    expect(p.progress01).toBeCloseTo(0, 10);
  });

  it('负时间（回溯半圈）→ orbits=−1、angleRad≈π（向下取整语义）', () => {
    const p = galacticYearProgress(myrToDays(-GALACTIC_YEAR_MYR / 2));
    expect(p.orbits).toBe(-1);
    expect(p.angleRad).toBeCloseTo(Math.PI, 10);
    expect(p.progress01).toBeCloseTo(0.5, 10);
  });
});

describe('diskAngularSpeedRadPerMyr（平坦旋转曲线，较差自转）', () => {
  it('内圈角速度 > 外圈（r=5000 vs 26000，防静态化）', () => {
    expect(diskAngularSpeedRadPerMyr(5000)).toBeGreaterThan(diskAngularSpeedRadPerMyr(26000));
  });

  it('线速度平坦：ω(26000)·26000 ≈ 220×3.3357', () => {
    expect(diskAngularSpeedRadPerMyr(26000) * 26000).toBeCloseTo(
      GALACTIC_ROTATION_KM_S * KM_S_TO_LY_PER_MYR,
      8,
    );
  });

  it('任意两半径线速度相同（v = ω·r 为常数）', () => {
    expect(diskAngularSpeedRadPerMyr(10000) * 10000).toBeCloseTo(
      diskAngularSpeedRadPerMyr(40000) * 40000,
      8,
    );
  });

  it('半径 ≤ 0 抛出 RangeError', () => {
    expect(() => diskAngularSpeedRadPerMyr(0)).toThrow(RangeError);
    expect(() => diskAngularSpeedRadPerMyr(-100)).toThrow(RangeError);
  });
});

describe('diskParticleAngle', () => {
  it('与 ω(r)·t 公式一致：angle = phase0 + ω·tMyr', () => {
    const days = myrToDays(50);
    expect(diskParticleAngle(1.5, 20000, days)).toBeCloseTo(
      1.5 + diskAngularSpeedRadPerMyr(20000) * 50,
      10,
    );
  });

  it('t=0 时返回初始相位', () => {
    expect(diskParticleAngle(2.4, 30000, 0)).toBe(2.4);
  });

  it('静态化防护：不同半径粒子的角度增量不同（较差自转，非刚性旋转）', () => {
    const days = myrToDays(100);
    const delta1 = diskParticleAngle(0, 8000, days) - diskParticleAngle(0, 8000, 0);
    const delta2 = diskParticleAngle(0, 40000, days) - diskParticleAngle(0, 40000, 0);
    expect(delta1).not.toBeCloseTo(delta2, 6);
    expect(delta1).toBeGreaterThan(delta2);
  });
});

describe('generateGalaxyDiskParticles', () => {
  it('同 seed 两次结果逐元素相等（确定性，需求 4.5）', () => {
    const a = generateGalaxyDiskParticles(BASE_PARAMS);
    const b = generateGalaxyDiskParticles(BASE_PARAMS);
    expect(a.count).toBe(BASE_PARAMS.count);
    expect(a.radiiLy).toEqual(b.radiiLy);
    expect(a.phases).toEqual(b.phases);
    expect(a.heightsLy).toEqual(b.heightsLy);
    expect(a.colors).toEqual(b.colors);
    expect(a.sizes).toEqual(b.sizes);
  });

  it('不同 seed 结果不同', () => {
    const a = generateGalaxyDiskParticles(BASE_PARAMS);
    const b = generateGalaxyDiskParticles({ ...BASE_PARAMS, seed: 7 });
    expect(a.radiiLy).not.toEqual(b.radiiLy);
  });

  it('所有粒子半径 ≤ diskRadius', () => {
    const p = generateGalaxyDiskParticles(BASE_PARAMS);
    for (let i = 0; i < p.count; i += 1) {
      expect(p.radiiLy[i]).toBeLessThanOrEqual(BASE_PARAMS.diskRadiusLy);
      expect(p.radiiLy[i]).toBeGreaterThanOrEqual(0);
    }
  });

  it('高度绝对值大部分 < thickness（薄盘为主，核球允许更厚）', () => {
    const p = generateGalaxyDiskParticles(BASE_PARAMS);
    let thin = 0;
    for (let i = 0; i < p.count; i += 1) {
      if (Math.abs(p.heightsLy[i]) < BASE_PARAMS.thicknessLy) thin += 1;
    }
    expect(thin / p.count).toBeGreaterThan(0.7);
  });

  it('颜色包含 ≥6 种不同 RGB（需求 4.4 恒星颜色混合）', () => {
    const p = generateGalaxyDiskParticles(BASE_PARAMS);
    const unique = new Set<string>();
    for (let i = 0; i < p.count; i += 1) {
      unique.add(
        `${p.colors[i * 3].toFixed(4)},${p.colors[i * 3 + 1].toFixed(4)},${p.colors[
          i * 3 + 2
        ].toFixed(4)}`,
      );
    }
    expect(unique.size).toBeGreaterThanOrEqual(6);
  });

  it('sizes 在 [1.0, 2.5] 且中心样本均值 > 边缘样本均值（渐变，需求 4.4）', () => {
    const p = generateGalaxyDiskParticles(BASE_PARAMS);
    let innerSum = 0;
    let innerN = 0;
    let outerSum = 0;
    let outerN = 0;
    for (let i = 0; i < p.count; i += 1) {
      expect(p.sizes[i]).toBeGreaterThanOrEqual(1.0);
      expect(p.sizes[i]).toBeLessThanOrEqual(2.5);
      const r01 = p.radiiLy[i] / BASE_PARAMS.diskRadiusLy;
      if (r01 < 0.25) {
        innerSum += p.sizes[i];
        innerN += 1;
      } else if (r01 > 0.75) {
        outerSum += p.sizes[i];
        outerN += 1;
      }
    }
    expect(innerN).toBeGreaterThan(0);
    expect(outerN).toBeGreaterThan(0);
    expect(innerSum / innerN).toBeGreaterThan(outerSum / outerN);
  });

  it('核球粒子（前段）位于核球半径内且色调偏暖黄', () => {
    const p = generateGalaxyDiskParticles(BASE_PARAMS);
    const bulgeCount = Math.round(BASE_PARAMS.count * BASE_PARAMS.bulgeFraction);
    for (let i = 0; i < bulgeCount; i += 1) {
      const r3d = Math.hypot(p.radiiLy[i], p.heightsLy[i]);
      expect(r3d).toBeLessThanOrEqual(BASE_PARAMS.bulgeRadiusLy + 1e-3);
      // 暖黄：R > B
      expect(p.colors[i * 3]).toBeGreaterThan(p.colors[i * 3 + 2]);
    }
  });

  it('bulgeFraction=0 时无核球分支，全部为盘粒子', () => {
    const p = generateGalaxyDiskParticles({ ...BASE_PARAMS, count: 500, bulgeFraction: 0 });
    expect(p.count).toBe(500);
    for (let i = 0; i < p.count; i += 1) {
      expect(p.radiiLy[i]).toBeLessThanOrEqual(BASE_PARAMS.diskRadiusLy);
    }
  });

  it('非法参数抛 RangeError：count=0 / 非整数、armCount=0、bulgeFraction 越界', () => {
    expect(() => generateGalaxyDiskParticles({ ...BASE_PARAMS, count: 0 })).toThrow(RangeError);
    expect(() => generateGalaxyDiskParticles({ ...BASE_PARAMS, count: 2.5 })).toThrow(RangeError);
    expect(() => generateGalaxyDiskParticles({ ...BASE_PARAMS, armCount: 0 })).toThrow(RangeError);
    expect(() => generateGalaxyDiskParticles({ ...BASE_PARAMS, bulgeFraction: 1.5 })).toThrow(
      RangeError,
    );
    expect(() => generateGalaxyDiskParticles({ ...BASE_PARAMS, bulgeFraction: -0.1 })).toThrow(
      RangeError,
    );
  });
});

describe('galaxyShaderMyr（银盘 shader 时间回卷，float32/GPU 精度保护）', () => {
  it('常规银河系时间尺度（< 回卷窗口）恒等返回，行为与未回卷一致', () => {
    expect(galaxyShaderMyr(0)).toBe(0);
    expect(galaxyShaderMyr(230)).toBe(230);
    expect(galaxyShaderMyr(GALAXY_SHADER_MYR_WRAP - 1)).toBe(GALAXY_SHADER_MYR_WRAP - 1);
  });

  it('宇宙视角长时间驻留（10⁴⁺ Myr）回卷到 [0, 窗口)', () => {
    for (const myr of [1e4, 1e5, GALAXY_SHADER_MYR_WRAP, GALAXY_SHADER_MYR_WRAP * 13.7]) {
      const t = galaxyShaderMyr(myr);
      expect(t).toBeGreaterThanOrEqual(0);
      expect(t).toBeLessThan(GALAXY_SHADER_MYR_WRAP);
    }
  });

  it('时间倒退（负值）同样回卷到 [0, 窗口)', () => {
    const t = galaxyShaderMyr(-100);
    expect(t).toBeGreaterThanOrEqual(0);
    expect(t).toBeLessThan(GALAXY_SHADER_MYR_WRAP);
    expect(t).toBeCloseTo(GALAXY_SHADER_MYR_WRAP - 100, 9);
  });

  it('回卷幅度上界：最内圈粒子（着色器钳制半径 500 光年）ω·t 处于 float32 可靠范围', () => {
    const omegaMax = (GALACTIC_ROTATION_KM_S * KM_S_TO_LY_PER_MYR) / 500;
    expect(omegaMax * GALAXY_SHADER_MYR_WRAP).toBeLessThan(3100);
  });

  it('回卷时间下较差自转保持（内圈角速度仍大于外圈）', () => {
    const hugeMyr = 1e5;
    const t = galaxyShaderMyr(hugeMyr);
    const inner = diskParticleAngle(0, 5000, t * DAYS_PER_MYR) % (Math.PI * 2);
    const outer = diskParticleAngle(0, 40000, t * DAYS_PER_MYR) % (Math.PI * 2);
    // 同窗口时间下内外圈角度不同（开普勒式剪切依然存在，防刚性旋转）
    expect(inner).not.toBeCloseTo(outer, 3);
  });

  it('非有限输入抛错', () => {
    expect(() => galaxyShaderMyr(Number.NaN)).toThrow(RangeError);
    expect(() => galaxyShaderMyr(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});
