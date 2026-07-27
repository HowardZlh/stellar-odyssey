/**
 * 旋臂密度波亮度测试（可选需求 3.1.2：旋臂图案转速与恒星公转速度不同）
 */

import {
  ARM_PATTERN_SPEED_RAD_PER_MYR,
  DENSITY_WAVE_CONTRAST,
  densityWaveBrightness,
  diskAngularSpeedRadPerMyr,
  type DensityWaveParams,
} from '@/utils/galaxy';

const PARAMS: DensityWaveParams = {
  armCount: 4,
  patternSpeedRadPerMyr: ARM_PATTERN_SPEED_RAD_PER_MYR,
  spiralTightness: 1.2,
  bulgeRadiusLy: 8000,
  contrast: DENSITY_WAVE_CONTRAST,
};

describe('densityWaveBrightness', () => {
  it('亮度因子恒在 [1−contrast, 1+contrast] 内', () => {
    for (let theta = 0; theta < Math.PI * 2; theta += 0.31) {
      for (const r of [3000, 12000, 26000, 45000]) {
        for (const t of [0, 57, 230]) {
          const b = densityWaveBrightness(theta, r, t, PARAMS);
          expect(b).toBeGreaterThanOrEqual(1 - PARAMS.contrast - 1e-9);
          expect(b).toBeLessThanOrEqual(1 + PARAMS.contrast + 1e-9);
        }
      }
    }
  });

  it('armCount 个方位角峰值：θ 平移 2π/armCount 后亮度相同', () => {
    const theta = 0.7;
    const b1 = densityWaveBrightness(theta, 26000, 10, PARAMS);
    const b2 = densityWaveBrightness(theta + (Math.PI * 2) / PARAMS.armCount, 26000, 10, PARAMS);
    expect(b2).toBeCloseTo(b1, 9);
  });

  it('图案刚性旋转：θ 与 t 按 Ω_p 同步平移时亮度不变', () => {
    const theta = 1.1;
    const r = 26000;
    const dt = 40; // Myr
    const b1 = densityWaveBrightness(theta, r, 0, PARAMS);
    const b2 = densityWaveBrightness(theta + PARAMS.patternSpeedRadPerMyr * dt, r, dt, PARAMS);
    expect(b2).toBeCloseTo(b1, 9);
  });

  it('恒星穿越旋臂：太阳半径处恒星角速度 ≠ 图案角速度，亮度随时间周期变化', () => {
    // 太阳附近 ω(26000 ly) ≈ 0.0282 rad/Myr > Ω_p = 0.02（文件头登记）
    const omega = diskAngularSpeedRadPerMyr(26000);
    expect(omega).not.toBeCloseTo(PARAMS.patternSpeedRadPerMyr, 3);
    // 随恒星公转采样：亮度必然变化（相对图案漂移 → 周期性穿越旋臂）
    const samples: number[] = [];
    for (let t = 0; t <= 400; t += 40) {
      samples.push(densityWaveBrightness(omega * t, 26000, t, PARAMS));
    }
    expect(Math.max(...samples) - Math.min(...samples)).toBeGreaterThan(0.3);
  });

  it('对数螺旋径向相位：同一方位角不同半径亮度不同', () => {
    const b1 = densityWaveBrightness(1.0, 10000, 0, PARAMS);
    const b2 = densityWaveBrightness(1.0, 40000, 0, PARAMS);
    expect(Math.abs(b1 - b2)).toBeGreaterThan(1e-3);
  });

  it('contrast = 0 时恒为 1（无密度波调制）', () => {
    const flat = { ...PARAMS, contrast: 0 };
    expect(densityWaveBrightness(0.4, 20000, 33, flat)).toBe(1);
  });

  it('非法参数抛出 RangeError', () => {
    expect(() => densityWaveBrightness(0, 0, 0, PARAMS)).toThrow(RangeError);
    expect(() => densityWaveBrightness(0, -100, 0, PARAMS)).toThrow(RangeError);
    expect(() => densityWaveBrightness(0, 100, 0, { ...PARAMS, contrast: -0.1 })).toThrow(
      RangeError,
    );
    expect(() => densityWaveBrightness(0, 100, 0, { ...PARAMS, contrast: 1.1 })).toThrow(
      RangeError,
    );
  });

  it('常量取值：Ω_p = 0.02 rad/Myr、对比度 0.55（文件头登记）', () => {
    expect(ARM_PATTERN_SPEED_RAD_PER_MYR).toBe(0.02);
    expect(DENSITY_WAVE_CONTRAST).toBe(0.55);
  });
});
