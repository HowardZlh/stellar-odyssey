/**
 * 太阳表面/日冕真实度提升单测（S4 精修档，IMPROVEMENT_REQUIREMENTS_SOLAR §4.7 / §7-S4）：
 * - E3 盔状冕流 + 极羽（helmetStreamerFactor / polarPlumeBrightness）
 * - F1 米粒暗巷网络 + 超米粒网络磁场亮点
 *   （intergranularLaneDarkening / networkBrightPointBoost）
 * 不破坏 S1/S3 既有冕流/米粒/超米粒行为（既有套件覆盖）。
 */

import {
  HELMET_STREAMER_SHARPNESS,
  INTERGRANULAR_LANE_DARKEN,
  INTERGRANULAR_LANE_THRESHOLD,
  NETWORK_BRIGHT_POINT_GAIN,
  NETWORK_BRIGHT_POINT_THRESHOLD,
  POLAR_PLUME_CONE_RAD,
  POLAR_PLUME_GAIN,
  helmetStreamerFactor,
  intergranularLaneDarkening,
  networkBrightPointBoost,
  polarPlumeBrightness,
} from '@/utils/sunSurface';

describe('helmetStreamerFactor（E3 盔状冕流）', () => {
  it('赤道（y=0）最强为 1、极区（y=1）为 0', () => {
    expect(helmetStreamerFactor(0, 0)).toBeCloseTo(1, 10);
    expect(helmetStreamerFactor(1, 0)).toBeCloseTo(0, 10);
    expect(helmetStreamerFactor(0, 1)).toBeCloseTo(1, 10);
    expect(helmetStreamerFactor(1, 1)).toBeCloseTo(0, 10);
  });

  it('极小期（iso=0）尖顶比二次幂更锐（中纬处更弱）', () => {
    const y = 0.5;
    const helmet = helmetStreamerFactor(y, 0);
    const quadratic = Math.pow(1 - y, 2);
    expect(helmet).toBeLessThan(quadratic);
    // 锐度来自高次幂
    expect(helmet).toBeCloseTo(Math.pow(1 - y, HELMET_STREAMER_SHARPNESS), 10);
  });

  it('极大期（iso=1）退化为二次幂弥散形态', () => {
    for (let y = 0; y <= 1; y += 0.2) {
      expect(helmetStreamerFactor(y, 1)).toBeCloseTo(Math.pow(1 - y, 2), 10);
    }
  });

  it('随 |y| 单调递减且输入越界钳制', () => {
    let prev = Infinity;
    for (let y = 0; y <= 1; y += 0.1) {
      const v = helmetStreamerFactor(y, 0.3);
      expect(v).toBeLessThanOrEqual(prev + 1e-12);
      prev = v;
    }
    expect(helmetStreamerFactor(-1, 0)).toBeCloseTo(1, 10);
    expect(helmetStreamerFactor(2, 0)).toBeCloseTo(0, 10);
  });
});

describe('polarPlumeBrightness（E3 极羽）', () => {
  const cosCone = Math.cos(POLAR_PLUME_CONE_RAD);

  it('极轴锥外无极羽', () => {
    expect(polarPlumeBrightness(0, 0.5)).toBe(0);
    expect(polarPlumeBrightness(cosCone, 0.5)).toBe(0);
    expect(polarPlumeBrightness(cosCone - 0.01, 0.9)).toBe(0);
  });

  it('锥内亮度为正且不超过增益上限', () => {
    for (let y = cosCone + 0.01; y <= 1; y += 0.02) {
      for (let n = 0; n <= 1; n += 0.2) {
        const v = polarPlumeBrightness(y, n);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(POLAR_PLUME_GAIN + 1e-9);
      }
    }
  });

  it('越靠极点包络越强（同噪声下）', () => {
    const n = 0.25; // sin(0.25×18π) 非零相位
    const mid = polarPlumeBrightness(cosCone + (1 - cosCone) * 0.4, n);
    const pole = polarPlumeBrightness(1, n);
    expect(pole).toBeGreaterThan(mid);
  });

  it('角向噪声形成条纹（不同噪声值亮度不同）', () => {
    const y = 0.95;
    const a = polarPlumeBrightness(y, 0.1);
    const b = polarPlumeBrightness(y, 0.35);
    expect(Math.abs(a - b)).toBeGreaterThan(1e-6);
  });
});

describe('intergranularLaneDarkening（F1 暗巷网络）', () => {
  it('阈值以上（胞内亮区）不暗化', () => {
    expect(intergranularLaneDarkening(INTERGRANULAR_LANE_THRESHOLD, 1)).toBe(1);
    expect(intergranularLaneDarkening(0.8, 1)).toBe(1);
  });

  it('阈值以下按深度暗化，fBm=0（巷心）最暗', () => {
    const laneCenter = intergranularLaneDarkening(0, 1);
    expect(laneCenter).toBeCloseTo(1 - INTERGRANULAR_LANE_DARKEN, 10);
    const halfway = intergranularLaneDarkening(INTERGRANULAR_LANE_THRESHOLD / 2, 1);
    expect(halfway).toBeGreaterThan(laneCenter);
    expect(halfway).toBeLessThan(1);
  });

  it('远观（强度 0）不强化暗巷（既有观感不变）', () => {
    expect(intergranularLaneDarkening(0.1, 0)).toBe(1);
  });

  it('暗化随近观强度线性增强且输入钳制', () => {
    const full = 1 - intergranularLaneDarkening(0, 1);
    const half = 1 - intergranularLaneDarkening(0, 0.5);
    expect(half).toBeCloseTo(full / 2, 10);
    expect(intergranularLaneDarkening(-1, 2)).toBeCloseTo(1 - INTERGRANULAR_LANE_DARKEN, 10);
  });
});

describe('networkBrightPointBoost（F1 网络磁场亮点）', () => {
  it('阈值以下（超米粒胞内）无亮点', () => {
    expect(networkBrightPointBoost(NETWORK_BRIGHT_POINT_THRESHOLD, 1)).toBe(0);
    expect(networkBrightPointBoost(0.3, 1)).toBe(0);
  });

  it('阈值以上增亮且不超过增益上限，边界（fBm=1）最亮', () => {
    const atMax = networkBrightPointBoost(1, 1);
    expect(atMax).toBeCloseTo(NETWORK_BRIGHT_POINT_GAIN, 10);
    for (let f = NETWORK_BRIGHT_POINT_THRESHOLD; f <= 1; f += 0.05) {
      const v = networkBrightPointBoost(f, 1);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(NETWORK_BRIGHT_POINT_GAIN + 1e-9);
    }
  });

  it('增亮随阈值以上超米粒值单调递增', () => {
    let prev = -1;
    for (let f = NETWORK_BRIGHT_POINT_THRESHOLD; f <= 1; f += 0.02) {
      const v = networkBrightPointBoost(f, 1);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it('远观（强度 0）无亮点（既有观感不变）', () => {
    expect(networkBrightPointBoost(0.9, 0)).toBe(0);
  });
});
