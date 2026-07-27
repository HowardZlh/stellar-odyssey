/**
 * 恒星闪烁纯逻辑测试（P3-5，需求 §4.6）
 *
 * 科学性登记验证：真空中恒星不闪烁（闪烁源于大气湍流），效果采用
 * 方案A 仅 L1 行星视角启用——层级增益必须在进入 L2 前淡出为 0。
 */

import {
  TWINKLE_AMP_MAX,
  TWINKLE_AMP_MIN,
  TWINKLE_FREQ_MAX_HZ,
  TWINKLE_FREQ_MIN_HZ,
  TWINKLE_FULL_LEVEL,
  TWINKLE_ZERO_LEVEL,
  twinkleAmplitude,
  twinkleFactor,
  twinkleFrequencyHz,
  twinkleLevelGain,
} from '@/utils/starTwinkle';

describe('twinkleLevelGain 层级淡出（方案A：仅 L1 启用）', () => {
  it('L1 深处（≤1.15）完全启用', () => {
    expect(twinkleLevelGain(1)).toBe(1);
    expect(twinkleLevelGain(TWINKLE_FULL_LEVEL)).toBe(1);
  });

  it('进入 L2 前（≥1.85）完全淡出为 0（科学性登记要求）', () => {
    expect(twinkleLevelGain(TWINKLE_ZERO_LEVEL)).toBe(0);
    expect(twinkleLevelGain(2)).toBe(0);
    expect(twinkleLevelGain(3)).toBe(0);
    expect(twinkleLevelGain(4)).toBe(0);
  });

  it('过渡区间内线性淡出', () => {
    const mid = (TWINKLE_FULL_LEVEL + TWINKLE_ZERO_LEVEL) / 2;
    expect(twinkleLevelGain(mid)).toBeCloseTo(0.5);
    expect(twinkleLevelGain(1.3)).toBeGreaterThan(twinkleLevelGain(1.7));
  });
});

describe('twinkleFrequencyHz 频率映射', () => {
  it('映射到 0.5–2 Hz 低频区间（需求 4.6）', () => {
    expect(twinkleFrequencyHz(0)).toBe(TWINKLE_FREQ_MIN_HZ);
    expect(twinkleFrequencyHz(1)).toBe(TWINKLE_FREQ_MAX_HZ);
    expect(TWINKLE_FREQ_MIN_HZ).toBe(0.5);
    expect(TWINKLE_FREQ_MAX_HZ).toBe(2);
  });

  it('超界输入钳制', () => {
    expect(twinkleFrequencyHz(-1)).toBe(TWINKLE_FREQ_MIN_HZ);
    expect(twinkleFrequencyHz(2)).toBe(TWINKLE_FREQ_MAX_HZ);
  });
});

describe('twinkleAmplitude 幅度（亮星略明显、暗星微弱）', () => {
  it('幅度始终在 ±10–20% 区间内（需求 4.6 克制要求）', () => {
    for (const b of [0, 0.3, 0.5, 0.8, 1]) {
      for (const r of [0, 0.5, 1]) {
        const amp = twinkleAmplitude(b, r);
        expect(amp).toBeGreaterThanOrEqual(TWINKLE_AMP_MIN);
        expect(amp).toBeLessThanOrEqual(TWINKLE_AMP_MAX);
      }
    }
  });

  it('亮星幅度大于暗星（同随机值）', () => {
    expect(twinkleAmplitude(1, 0.5)).toBeGreaterThan(twinkleAmplitude(0, 0.5));
  });

  it('超界输入钳制不抛错', () => {
    expect(twinkleAmplitude(-1, 2)).toBeGreaterThanOrEqual(TWINKLE_AMP_MIN);
  });
});

describe('twinkleFactor 亮度因子（确定性双正弦）', () => {
  it('同一输入必得同一输出（确定性，无每帧随机数）', () => {
    const a = twinkleFactor(1.234, 0.4, 1.2, 0.15);
    const b = twinkleFactor(1.234, 0.4, 1.2, 0.15);
    expect(a).toBe(b);
  });

  it('结果始终在 [1 - amp, 1 + amp] 内', () => {
    const amp = 0.2;
    for (let t = 0; t < 5; t += 0.13) {
      const factor = twinkleFactor(t, 0.7, 1.5, amp);
      expect(factor).toBeGreaterThanOrEqual(1 - amp);
      expect(factor).toBeLessThanOrEqual(1 + amp);
    }
  });

  it('层级增益为 0 时恒为 1（L2 及以外无闪烁）', () => {
    for (let t = 0; t < 3; t += 0.37) {
      expect(twinkleFactor(t, 0.2, 1, 0.2, 0)).toBe(1);
    }
  });

  it('不同相位的星互不同步（每星独立相位）', () => {
    const a = twinkleFactor(1, 0.1, 1, 0.2);
    const b = twinkleFactor(1, 0.6, 1, 0.2);
    expect(a).not.toBeCloseTo(b, 5);
  });

  it('随时间变化（非静态扰动）', () => {
    const a = twinkleFactor(0.1, 0.4, 1.2, 0.15);
    const b = twinkleFactor(0.45, 0.4, 1.2, 0.15);
    expect(a).not.toBeCloseTo(b, 5);
  });
});
