/**
 * 太阳 11 年活动周期单测（S3，IMPROVEMENT_REQUIREMENTS_SOLAR §4.4/§6）：
 * 相位锚定第 25 周期、黑子数包络（不对称上升/下降）、相位名判定、
 * 事件频率调制、蝴蝶图纬度迁移、周期序号推进。
 */

import {
  BUTTERFLY_LAT_HIGH_DEG,
  BUTTERFLY_LAT_LOW_DEG,
  CYCLE_FREQ_FACTOR_MAX,
  CYCLE_FREQ_FACTOR_MIN,
  RISE_PHASE_FRACTION,
  SOLAR_CYCLE_25_MIN_SIMDAYS,
  SOLAR_CYCLE_25_NUMBER,
  SOLAR_CYCLE_LENGTH_DAYS,
  SOLAR_CYCLE_PHASE_LABELS_ZH,
  butterflyLatitudeDeg,
  cycleFrequencyFactor,
  cyclePhaseName,
  cycleSunspotEnvelope,
  solarCycleNumber,
  solarCyclePhase01,
  solarCycleState,
  solarCycleStatusLine,
  sunspotRelativeBar,
} from '@/utils/solarCycle';

describe('solarCyclePhase01（周期相位）', () => {
  it('极小锚点相位为 0', () => {
    expect(solarCyclePhase01(SOLAR_CYCLE_25_MIN_SIMDAYS)).toBeCloseTo(0, 10);
  });

  it('半个周期后相位约 0.5', () => {
    expect(
      solarCyclePhase01(SOLAR_CYCLE_25_MIN_SIMDAYS + SOLAR_CYCLE_LENGTH_DAYS * 0.5),
    ).toBeCloseTo(0.5, 10);
  });

  it('整数个周期回卷到相同相位', () => {
    const base = solarCyclePhase01(SOLAR_CYCLE_25_MIN_SIMDAYS + 1234);
    expect(
      solarCyclePhase01(SOLAR_CYCLE_25_MIN_SIMDAYS + 1234 + SOLAR_CYCLE_LENGTH_DAYS * 3),
    ).toBeCloseTo(base, 8);
  });

  it('锚点之前（负相位）回卷到 [0,1)', () => {
    const p = solarCyclePhase01(SOLAR_CYCLE_25_MIN_SIMDAYS - SOLAR_CYCLE_LENGTH_DAYS * 0.25);
    expect(p).toBeGreaterThanOrEqual(0);
    expect(p).toBeLessThan(1);
    expect(p).toBeCloseTo(0.75, 8);
  });

  it('非有限输入抛错', () => {
    expect(() => solarCyclePhase01(Number.NaN)).toThrow(RangeError);
  });
});

describe('solarCycleNumber（周期序号）', () => {
  it('锚点处为第 25 周期', () => {
    expect(solarCycleNumber(SOLAR_CYCLE_25_MIN_SIMDAYS)).toBe(SOLAR_CYCLE_25_NUMBER);
    expect(solarCycleNumber(SOLAR_CYCLE_25_MIN_SIMDAYS + 100)).toBe(SOLAR_CYCLE_25_NUMBER);
  });

  it('每满一个周期序号 +1', () => {
    expect(solarCycleNumber(SOLAR_CYCLE_25_MIN_SIMDAYS + SOLAR_CYCLE_LENGTH_DAYS * 1.5)).toBe(
      SOLAR_CYCLE_25_NUMBER + 1,
    );
    expect(solarCycleNumber(SOLAR_CYCLE_25_MIN_SIMDAYS + SOLAR_CYCLE_LENGTH_DAYS * 2.1)).toBe(
      SOLAR_CYCLE_25_NUMBER + 2,
    );
  });

  it('锚点之前序号 -1', () => {
    expect(solarCycleNumber(SOLAR_CYCLE_25_MIN_SIMDAYS - 10)).toBe(SOLAR_CYCLE_25_NUMBER - 1);
  });

  it('非有限输入抛错', () => {
    expect(() => solarCycleNumber(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe('cycleSunspotEnvelope（黑子相对数包络）', () => {
  it('极小相位为 0、极大相位为 1', () => {
    expect(cycleSunspotEnvelope(0)).toBeCloseTo(0, 10);
    expect(cycleSunspotEnvelope(RISE_PHASE_FRACTION)).toBeCloseTo(1, 10);
    expect(cycleSunspotEnvelope(1)).toBeCloseTo(0, 10);
  });

  it('上升段单调增、下降段单调减', () => {
    expect(cycleSunspotEnvelope(0.1)).toBeLessThan(cycleSunspotEnvelope(0.3));
    expect(cycleSunspotEnvelope(0.5)).toBeGreaterThan(cycleSunspotEnvelope(0.9));
  });

  it('输出恒在 [0,1]', () => {
    for (let p = 0; p <= 1.0001; p += 0.02) {
      const e = cycleSunspotEnvelope(p);
      expect(e).toBeGreaterThanOrEqual(0);
      expect(e).toBeLessThanOrEqual(1);
    }
  });

  it('相位回卷（>1）等价于取小数部分', () => {
    expect(cycleSunspotEnvelope(1.3)).toBeCloseTo(cycleSunspotEnvelope(0.3), 10);
  });

  it('上升期比下降期陡（不对称：上升快下降慢）', () => {
    // 相同包络增量在上升段所需相位跨度更小
    const riseSpan = RISE_PHASE_FRACTION;
    const declineSpan = 1 - RISE_PHASE_FRACTION;
    expect(riseSpan).toBeLessThan(declineSpan);
  });

  it('非有限输入抛错', () => {
    expect(() => cycleSunspotEnvelope(Number.NaN)).toThrow(RangeError);
  });
});

describe('cyclePhaseName（相位名）', () => {
  it('峰谷判定为极大/极小', () => {
    expect(cyclePhaseName(RISE_PHASE_FRACTION, cycleSunspotEnvelope(RISE_PHASE_FRACTION))).toBe(
      'maximum',
    );
    expect(cyclePhaseName(0, cycleSunspotEnvelope(0))).toBe('minimum');
  });

  it('上升段/下降段判定', () => {
    expect(cyclePhaseName(0.2, cycleSunspotEnvelope(0.2))).toBe('rising');
    expect(cyclePhaseName(0.7, cycleSunspotEnvelope(0.7))).toBe('declining');
  });

  it('所有相位名都有中文标签', () => {
    for (const name of ['rising', 'maximum', 'declining', 'minimum'] as const) {
      expect(SOLAR_CYCLE_PHASE_LABELS_ZH[name]).toBeTruthy();
    }
  });
});

describe('cycleFrequencyFactor（事件频率调制）', () => {
  it('极小期为最小因子、极大期为最大因子', () => {
    expect(cycleFrequencyFactor(0)).toBeCloseTo(CYCLE_FREQ_FACTOR_MIN, 10);
    expect(cycleFrequencyFactor(1)).toBeCloseTo(CYCLE_FREQ_FACTOR_MAX, 10);
  });

  it('随包络单调递增', () => {
    expect(cycleFrequencyFactor(0.3)).toBeLessThan(cycleFrequencyFactor(0.7));
  });

  it('输入越界钳制', () => {
    expect(cycleFrequencyFactor(-1)).toBeCloseTo(CYCLE_FREQ_FACTOR_MIN, 10);
    expect(cycleFrequencyFactor(2)).toBeCloseTo(CYCLE_FREQ_FACTOR_MAX, 10);
  });
});

describe('butterflyLatitudeDeg（蝴蝶图纬度迁移）', () => {
  it('周期初高纬、周期末赤道', () => {
    expect(butterflyLatitudeDeg(0)).toBeCloseTo(BUTTERFLY_LAT_HIGH_DEG, 6);
    expect(butterflyLatitudeDeg(1 - 1e-9)).toBeCloseTo(BUTTERFLY_LAT_LOW_DEG, 4);
  });

  it('随相位单调向赤道迁移', () => {
    expect(butterflyLatitudeDeg(0.2)).toBeGreaterThan(butterflyLatitudeDeg(0.6));
    expect(butterflyLatitudeDeg(0.6)).toBeGreaterThan(butterflyLatitudeDeg(0.9));
  });

  it('输出恒在纬度带内', () => {
    for (let p = 0; p < 1; p += 0.05) {
      const lat = butterflyLatitudeDeg(p);
      expect(lat).toBeLessThanOrEqual(BUTTERFLY_LAT_HIGH_DEG + 1e-6);
      expect(lat).toBeGreaterThanOrEqual(BUTTERFLY_LAT_LOW_DEG - 1e-6);
    }
  });

  it('非有限输入抛错', () => {
    expect(() => butterflyLatitudeDeg(Number.NaN)).toThrow(RangeError);
  });
});

describe('solarCycleState（综合状态）', () => {
  it('锚点处：第 25 周期、极小相位、包络 ≈0', () => {
    const s = solarCycleState(SOLAR_CYCLE_25_MIN_SIMDAYS);
    expect(s.cycleNumber).toBe(SOLAR_CYCLE_25_NUMBER);
    expect(s.phase01).toBeCloseTo(0, 8);
    expect(s.sunspotEnvelope01).toBeCloseTo(0, 8);
    expect(s.phaseName).toBe('minimum');
    expect(s.frequencyFactor).toBeCloseTo(CYCLE_FREQ_FACTOR_MIN, 6);
    expect(s.coronaIsotropy01).toBeCloseTo(0, 8);
  });

  it('极大时刻：包络 ≈1、相位名极大、频率因子最大、各向同性最高', () => {
    const s = solarCycleState(
      SOLAR_CYCLE_25_MIN_SIMDAYS + SOLAR_CYCLE_LENGTH_DAYS * RISE_PHASE_FRACTION,
    );
    expect(s.sunspotEnvelope01).toBeCloseTo(1, 6);
    expect(s.phaseName).toBe('maximum');
    expect(s.frequencyFactor).toBeCloseTo(CYCLE_FREQ_FACTOR_MAX, 6);
    expect(s.coronaIsotropy01).toBeCloseTo(1, 6);
  });

  it('当前真实日期附近（第 25 周期下降期）相位名合理', () => {
    // 2026-07 ≈ J2000 + 9701 天，处于极大（2024-10）之后的下降期
    const now = 9701;
    const s = solarCycleState(now);
    expect(s.cycleNumber).toBe(25);
    expect(['declining', 'maximum']).toContain(s.phaseName);
  });
});

describe('sunspotRelativeBar（黑子相对数示意条）', () => {
  it('极小/极大填充比例正确', () => {
    expect(sunspotRelativeBar(0, 10)).toBe('░░░░░░░░░░');
    expect(sunspotRelativeBar(1, 10)).toBe('██████████');
    expect(sunspotRelativeBar(0.5, 10)).toBe('█████░░░░░');
  });

  it('总长恒等于分段数', () => {
    for (let e = 0; e <= 1; e += 0.13) {
      expect(sunspotRelativeBar(e, 8)).toHaveLength(8);
    }
  });

  it('非法分段数抛错', () => {
    expect(() => sunspotRelativeBar(0.5, 0)).toThrow(RangeError);
  });
});

describe('solarCycleStatusLine（状态行）', () => {
  it('含周期序号、相位名、百分比', () => {
    const s = solarCycleState(
      SOLAR_CYCLE_25_MIN_SIMDAYS + SOLAR_CYCLE_LENGTH_DAYS * RISE_PHASE_FRACTION,
    );
    const line = solarCycleStatusLine(s);
    expect(line.label).toBe('活动周期');
    expect(line.value).toContain('第 25 周期');
    expect(line.value).toContain('极大期');
    expect(line.value).toContain('100%');
  });
});
