/**
 * 太阳较差自转单测（S2，IMPROVEMENT_REQUIREMENTS_SOLAR §4.2/§6）
 */

import {
  SOLAR_ROTATION_EQUATOR_DAYS,
  SOLAR_ROTATION_LAT60_DAYS,
  SOLAR_ROTATION_POLE_DAYS,
  SOLAR_SHEAR_WRAP_DAYS,
  solarRotationAngleRad,
  solarRotationOmegaDegPerDay,
  solarRotationPeriodDays,
  solarShearShaderDays,
  solarRotationUvOffset,
} from '@/utils/solarRotation';

describe('solarRotationOmegaDegPerDay / solarRotationPeriodDays', () => {
  it('赤道周期精确 25.4 天', () => {
    expect(solarRotationPeriodDays(0)).toBeCloseTo(SOLAR_ROTATION_EQUATOR_DAYS, 10);
  });

  it('纬度 60° 周期精确 30.9 天', () => {
    expect(solarRotationPeriodDays(Math.PI / 3)).toBeCloseTo(SOLAR_ROTATION_LAT60_DAYS, 8);
  });

  it('极区周期精确 34 天', () => {
    expect(solarRotationPeriodDays(Math.PI / 2)).toBeCloseTo(SOLAR_ROTATION_POLE_DAYS, 8);
  });

  it('南北半球对称', () => {
    expect(solarRotationOmegaDegPerDay(-0.5)).toBeCloseTo(solarRotationOmegaDegPerDay(0.5), 12);
  });

  it('角速度随 |纬度| 单调递减（赤道快于高纬）', () => {
    let prev = solarRotationOmegaDegPerDay(0);
    for (let deg = 5; deg <= 90; deg += 5) {
      const omega = solarRotationOmegaDegPerDay((deg * Math.PI) / 180);
      expect(omega).toBeLessThan(prev);
      prev = omega;
    }
  });

  it('非有限纬度抛错', () => {
    expect(() => solarRotationOmegaDegPerDay(Number.NaN)).toThrow(RangeError);
  });
});

describe('solarRotationAngleRad', () => {
  it('赤道一个周期累计 2π', () => {
    expect(solarRotationAngleRad(0, SOLAR_ROTATION_EQUATOR_DAYS)).toBeCloseTo(Math.PI * 2, 10);
  });

  it('同一时间跨度内赤道角度大于高纬（较差自转可观察）', () => {
    const days = 10;
    expect(solarRotationAngleRad(0, days)).toBeGreaterThan(
      solarRotationAngleRad((60 * Math.PI) / 180, days),
    );
  });

  it('非有限模拟时间抛错', () => {
    expect(() => solarRotationAngleRad(0, Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe('solarRotationUvOffset（相对赤道剪切呈现，登记见文件头）', () => {
  it('赤道相对相位恒为 0（纹理不整体平移）', () => {
    expect(solarRotationUvOffset(0, 100)).toBeCloseTo(0, 12);
  });

  it('中高纬相对赤道西退（角速度更小 → 正偏移方向）且随纬度增大', () => {
    const mid = solarRotationUvOffset(Math.PI / 6, 10);
    const pole = solarRotationUvOffset(Math.PI / 2, 10);
    expect(mid).toBeGreaterThan(0);
    expect(pole).toBeGreaterThan(mid);
  });

  it('剪切窗口内极区最大剪切约 0.32 圈（有界防错位条纹）', () => {
    const maxShear = solarRotationUvOffset(Math.PI / 2, SOLAR_SHEAR_WRAP_DAYS);
    expect(maxShear).toBeGreaterThan(0.25);
    expect(maxShear).toBeLessThan(0.4);
  });
});

describe('solarShearShaderDays（剪切相位回卷）', () => {
  it('窗口内恒等返回', () => {
    expect(solarShearShaderDays(10)).toBe(10);
  });

  it('超出窗口回卷到 [0, W)', () => {
    const wrapped = solarShearShaderDays(SOLAR_SHEAR_WRAP_DAYS + 3);
    expect(wrapped).toBeCloseTo(3, 9);
    expect(wrapped).toBeGreaterThanOrEqual(0);
    expect(wrapped).toBeLessThan(SOLAR_SHEAR_WRAP_DAYS);
  });

  it('负时间补正到 [0, W)', () => {
    const wrapped = solarShearShaderDays(-5);
    expect(wrapped).toBeCloseTo(SOLAR_SHEAR_WRAP_DAYS - 5, 9);
  });

  it('非有限输入抛错', () => {
    expect(() => solarShearShaderDays(Number.NaN)).toThrow(RangeError);
  });
});
