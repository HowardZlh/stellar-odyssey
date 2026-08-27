/**
 * 太阳活动周期调制单测（S3，IMPROVEMENT_REQUIREMENTS_SOLAR §4.4/§6）：
 * 耀斑/CME 泊松平均间隔按活动周期频率因子缩放（极大期频繁、极小期稀疏）。
 */

import {
  AURORA_ENHANCEMENT_DAYS,
  CME_INDEPENDENT_MEAN_INTERVAL_DAYS,
  CME_SPEED_KM_S_MAX,
  CME_SPEED_KM_S_MIN,
  FLARE_MEAN_INTERVAL_DAYS,
  PROMINENCE_ERUPTION_DAYS,
  PROMINENCE_ERUPTION_LIFT,
  WIND_FAST_CONE_RAD,
  WIND_FAST_SPEED_GAIN,
  auroraEnhancement01,
  cmeArrivalDelayDays,
  cycleModulatedMeanInterval,
  prominenceEruptionLift,
  shouldAutoTriggerFlare,
  windSpeedFactorForDirection,
} from '@/utils/solarActivity';
import { CYCLE_FREQ_FACTOR_MAX, CYCLE_FREQ_FACTOR_MIN } from '@/utils/solarCycle';

describe('cycleModulatedMeanInterval（周期调制平均间隔）', () => {
  it('因子为 1 时均值不变', () => {
    expect(cycleModulatedMeanInterval(FLARE_MEAN_INTERVAL_DAYS, 1)).toBe(FLARE_MEAN_INTERVAL_DAYS);
  });

  it('因子越大（极大期）均值越短（更频繁）', () => {
    const maxFactor = cycleModulatedMeanInterval(FLARE_MEAN_INTERVAL_DAYS, CYCLE_FREQ_FACTOR_MAX);
    const minFactor = cycleModulatedMeanInterval(FLARE_MEAN_INTERVAL_DAYS, CYCLE_FREQ_FACTOR_MIN);
    expect(maxFactor).toBeLessThan(minFactor);
    expect(maxFactor).toBeCloseTo(FLARE_MEAN_INTERVAL_DAYS / CYCLE_FREQ_FACTOR_MAX, 6);
  });

  it('CME 均值同样受调制', () => {
    expect(cycleModulatedMeanInterval(CME_INDEPENDENT_MEAN_INTERVAL_DAYS, 2)).toBeCloseTo(
      CME_INDEPENDENT_MEAN_INTERVAL_DAYS / 2,
      6,
    );
  });

  it('非正输入抛错', () => {
    expect(() => cycleModulatedMeanInterval(0, 1)).toThrow(RangeError);
    expect(() => cycleModulatedMeanInterval(60, 0)).toThrow(RangeError);
    expect(() => cycleModulatedMeanInterval(60, -1)).toThrow(RangeError);
  });
});

describe('调制后触发概率与频率因子一致', () => {
  it('极大期均值下触发概率高于极小期均值', () => {
    // 相同 Δt=0.5 天、相同随机数：均值越短，触发阈值 (1-exp(-Δt/mean)) 越大
    const maxMean = cycleModulatedMeanInterval(FLARE_MEAN_INTERVAL_DAYS, CYCLE_FREQ_FACTOR_MAX);
    const minMean = cycleModulatedMeanInterval(FLARE_MEAN_INTERVAL_DAYS, CYCLE_FREQ_FACTOR_MIN);
    // 取一个介于两阈值之间的随机数：极大期触发、极小期不触发
    const pMax = 1 - Math.exp(-0.5 / maxMean);
    const pMin = 1 - Math.exp(-0.5 / minMean);
    const between = (pMax + pMin) / 2;
    expect(shouldAutoTriggerFlare(between, 0.5, maxMean)).toBe(true);
    expect(shouldAutoTriggerFlare(between, 0.5, minMean)).toBe(false);
  });
});

describe('windSpeedFactorForDirection（日冕洞快风方向加权）', () => {
  it('冕洞锥外为常速慢风（因子 1）', () => {
    const cosOutside = Math.cos(WIND_FAST_CONE_RAD + 0.1);
    expect(windSpeedFactorForDirection(cosOutside)).toBe(1);
  });

  it('冕洞方向（cos=1）为最快风', () => {
    expect(windSpeedFactorForDirection(1)).toBeCloseTo(WIND_FAST_SPEED_GAIN, 6);
  });

  it('从锥中心到锥缘速度单调下降到 1', () => {
    const center = windSpeedFactorForDirection(Math.cos(0));
    const mid = windSpeedFactorForDirection(Math.cos(WIND_FAST_CONE_RAD * 0.5));
    const edge = windSpeedFactorForDirection(Math.cos(WIND_FAST_CONE_RAD * 0.95));
    expect(center).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(edge);
    expect(edge).toBeGreaterThanOrEqual(1);
  });

  it('因子恒在 [1, 增益]', () => {
    for (let a = 0; a < Math.PI; a += 0.1) {
      const v = windSpeedFactorForDirection(Math.cos(a));
      expect(v).toBeGreaterThanOrEqual(1 - 1e-9);
      expect(v).toBeLessThanOrEqual(WIND_FAST_SPEED_GAIN + 1e-9);
    }
  });
});

describe('prominenceEruptionLift（爆发日珥前导）', () => {
  it('窗口外为 0', () => {
    expect(prominenceEruptionLift(0)).toBe(0);
    expect(prominenceEruptionLift(-1)).toBe(0);
    expect(prominenceEruptionLift(PROMINENCE_ERUPTION_DAYS)).toBe(0);
    expect(prominenceEruptionLift(PROMINENCE_ERUPTION_DAYS + 1)).toBe(0);
  });

  it('先拉升后回落（峰值在 60% 处附近）', () => {
    const rise = prominenceEruptionLift(PROMINENCE_ERUPTION_DAYS * 0.3);
    const peak = prominenceEruptionLift(PROMINENCE_ERUPTION_DAYS * 0.6);
    const fall = prominenceEruptionLift(PROMINENCE_ERUPTION_DAYS * 0.9);
    expect(peak).toBeGreaterThan(rise);
    expect(peak).toBeGreaterThan(fall);
  });

  it('峰值约为额定抬升倍数', () => {
    expect(prominenceEruptionLift(PROMINENCE_ERUPTION_DAYS * 0.6)).toBeCloseTo(
      PROMINENCE_ERUPTION_LIFT,
      6,
    );
  });

  it('抬升恒非负', () => {
    for (let d = 0; d < PROMINENCE_ERUPTION_DAYS; d += PROMINENCE_ERUPTION_DAYS / 20) {
      expect(prominenceEruptionLift(d)).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('cmeArrivalDelayDays（CME 抵达地球传播延迟）', () => {
  it('速度越快抵达越早', () => {
    expect(cmeArrivalDelayDays(CME_SPEED_KM_S_MAX)).toBeLessThan(
      cmeArrivalDelayDays(CME_SPEED_KM_S_MIN),
    );
  });

  it('量级落在真实 1–3 天附近（慢 CME 稍长）', () => {
    // 250 km/s ≈ 6.9 天、1000 km/s ≈ 1.7 天、3000 km/s ≈ 0.58 天
    expect(cmeArrivalDelayDays(1000)).toBeGreaterThan(1);
    expect(cmeArrivalDelayDays(1000)).toBeLessThan(3);
  });

  it('非正速度抛错', () => {
    expect(() => cmeArrivalDelayDays(0)).toThrow(RangeError);
    expect(() => cmeArrivalDelayDays(-100)).toThrow(RangeError);
  });
});

describe('auroraEnhancement01（极光增强强度）', () => {
  it('窗口外为 0', () => {
    expect(auroraEnhancement01(0)).toBe(0);
    expect(auroraEnhancement01(-1)).toBe(0);
    expect(auroraEnhancement01(AURORA_ENHANCEMENT_DAYS)).toBe(0);
  });

  it('快速起亮后消退', () => {
    const rise = auroraEnhancement01(AURORA_ENHANCEMENT_DAYS * 0.1);
    const peakish = auroraEnhancement01(AURORA_ENHANCEMENT_DAYS * 0.16);
    const late = auroraEnhancement01(AURORA_ENHANCEMENT_DAYS * 0.9);
    expect(peakish).toBeGreaterThan(rise);
    expect(peakish).toBeGreaterThan(late);
  });

  it('强度恒在 [0,1]', () => {
    for (let d = 0; d < AURORA_ENHANCEMENT_DAYS; d += AURORA_ENHANCEMENT_DAYS / 20) {
      const v = auroraEnhancement01(d);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('自定义窗口时长（dev 录制调参 recAuroraDays）：曲线随时长缩放', () => {
    // 默认时长在 8 天窗口内仍处增强中；8 天整点归零
    expect(auroraEnhancement01(AURORA_ENHANCEMENT_DAYS, 8)).toBeGreaterThan(0);
    expect(auroraEnhancement01(8, 8)).toBe(0);
    // 相对相位等价：t/duration 相同 → 强度相同
    expect(auroraEnhancement01(0.8, 8)).toBeCloseTo(
      auroraEnhancement01(AURORA_ENHANCEMENT_DAYS * 0.1),
    );
  });

  it('非正窗口时长抛错', () => {
    expect(() => auroraEnhancement01(1, 0)).toThrow(RangeError);
    expect(() => auroraEnhancement01(1, -2)).toThrow(RangeError);
  });
});
