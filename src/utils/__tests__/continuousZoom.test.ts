/**
 * 连续维度缩放测试（需求 3.2.2 遨游模式）：
 * 连续层级、层级混合权重、宇宙距离压缩、连续时间压缩、速率钳制、连续音景混合
 */

import {
  COSMIC_LINEAR_MAX_LY,
  SCENE_UNITS_PER_LY,
  continuousLevelForDistance,
  cosmicDistanceToSceneUnits,
  discreteLevelFromContinuous,
  formatSceneScaleLabel,
  inverseCosmicDistanceToLy,
  levelBlendWeights,
  lyToSceneUnits,
  trapezoidWeight,
  LEVEL_DISTANCE_ANCHORS,
} from '@/utils/scale';
import {
  MAX_VISUAL_REVS_PER_SECOND,
  TIME_COMPRESSION,
  advanceSimTimeContinuous,
  rateClampFactor,
  timeCompressionForContinuousLevel,
  visualRevsPerRealSecond,
} from '@/utils/time';
import { computeContinuousSoundscapeGains } from '@/utils/audioMixer';

describe('continuousLevelForDistance', () => {
  it('锚点距离返回整数层级', () => {
    expect(continuousLevelForDistance(LEVEL_DISTANCE_ANCHORS[0])).toBeCloseTo(1, 6);
    expect(continuousLevelForDistance(LEVEL_DISTANCE_ANCHORS[1])).toBeCloseTo(2, 6);
    expect(continuousLevelForDistance(LEVEL_DISTANCE_ANCHORS[2])).toBeCloseTo(3, 6);
    expect(continuousLevelForDistance(LEVEL_DISTANCE_ANCHORS[3])).toBeCloseTo(4, 6);
  });

  it('超出范围时钳制到 [1, 4]', () => {
    expect(continuousLevelForDistance(0.001)).toBe(1);
    expect(continuousLevelForDistance(1e9)).toBe(4);
  });

  it('单调递增且对数插值（锚点几何均值处为半级）', () => {
    const mid = Math.sqrt(LEVEL_DISTANCE_ANCHORS[0] * LEVEL_DISTANCE_ANCHORS[1]);
    expect(continuousLevelForDistance(mid)).toBeCloseTo(1.5, 6);
    let prev = 0;
    for (const d of [5, 20, 80, 300, 1000, 5000, 20000]) {
      const f = continuousLevelForDistance(d);
      expect(f).toBeGreaterThanOrEqual(prev);
      prev = f;
    }
  });
});

describe('discreteLevelFromContinuous', () => {
  it('就近取整', () => {
    expect(discreteLevelFromContinuous(1)).toBe('L1');
    expect(discreteLevelFromContinuous(1.49)).toBe('L1');
    expect(discreteLevelFromContinuous(1.5)).toBe('L2');
    expect(discreteLevelFromContinuous(2.9)).toBe('L3');
    expect(discreteLevelFromContinuous(3.6)).toBe('L4');
  });
});

describe('levelBlendWeights', () => {
  it('整数层级时权重集中于该层', () => {
    expect(levelBlendWeights(2)).toEqual({ L1: 0, L2: 1, L3: 0, L4: 0 });
  });

  it('中间层级时相邻两层权重互补', () => {
    const w = levelBlendWeights(2.3);
    expect(w.L2).toBeCloseTo(0.7, 6);
    expect(w.L3).toBeCloseTo(0.3, 6);
    expect(w.L1).toBe(0);
    expect(w.L4).toBe(0);
  });

  it('超出范围钳制', () => {
    expect(levelBlendWeights(0.5).L1).toBe(1);
    expect(levelBlendWeights(9).L4).toBe(1);
  });
});

describe('lyToSceneUnits / cosmicDistanceToSceneUnits', () => {
  it('线性区：光年线性映射', () => {
    expect(lyToSceneUnits(1000)).toBeCloseTo(1000 * SCENE_UNITS_PER_LY, 9);
    expect(cosmicDistanceToSceneUnits(100000)).toBeCloseTo(100000 * SCENE_UNITS_PER_LY, 6);
  });

  it('对数区：连续衔接且压缩三个数量级到同屏', () => {
    const atBoundary = cosmicDistanceToSceneUnits(COSMIC_LINEAR_MAX_LY);
    const justBeyond = cosmicDistanceToSceneUnits(COSMIC_LINEAR_MAX_LY * 1.001);
    expect(justBeyond).toBeGreaterThan(atBoundary);
    expect(justBeyond - atBoundary).toBeLessThan(5);

    const m31 = cosmicDistanceToSceneUnits(2.5e6); // 250万光年
    const virgo = cosmicDistanceToSceneUnits(5.4e7); // 5400万光年
    const laniakea = cosmicDistanceToSceneUnits(2.6e8);
    expect(m31).toBeGreaterThan(10000);
    expect(m31).toBeLessThan(14000);
    expect(virgo).toBeGreaterThan(m31);
    expect(laniakea).toBeGreaterThan(virgo);
    expect(laniakea).toBeLessThan(20000); // 同屏可见
  });

  it('非法距离抛错', () => {
    expect(() => cosmicDistanceToSceneUnits(-1)).toThrow(RangeError);
    expect(() => cosmicDistanceToSceneUnits(Number.NaN)).toThrow(RangeError);
  });

  it('反函数与正函数互逆（线性区与对数区）', () => {
    for (const ly of [50000, 160000, 2.5e6, 5.4e7]) {
      const units = cosmicDistanceToSceneUnits(ly);
      expect(inverseCosmicDistanceToLy(units)).toBeCloseTo(ly, ly * 1e-9);
    }
    expect(() => inverseCosmicDistanceToLy(-5)).toThrow(RangeError);
  });
});

describe('formatSceneScaleLabel（分层场景尺度标尺）', () => {
  it('L1/L2 按 AU 线性映射', () => {
    expect(formatSceneScaleLabel(100, 2)).toBe('10.0 AU');
    expect(formatSceneScaleLabel(14, 1.2)).toBe('1.4 AU');
  });

  it('L3 按光年线性映射（银河系尺度）', () => {
    // 2915 单位 → 58,300 光年（跨越银盘）
    expect(formatSceneScaleLabel(2915, 3)).toContain('光年');
    expect(formatSceneScaleLabel(2915, 3)).toContain('58,300');
  });

  it('L4 按宇宙压缩反函数映射（Mpc 量级）', () => {
    const label = formatSceneScaleLabel(14422, 4);
    expect(label).toContain('Mpc');
  });
});

describe('trapezoidWeight（LOD 渐变）', () => {
  it('平台区为 1，两侧线性渐变，区间外为 0', () => {
    expect(trapezoidWeight(1.0, 2, 2.5, 3.5, 4)).toBe(0);
    expect(trapezoidWeight(2.25, 2, 2.5, 3.5, 4)).toBeCloseTo(0.5, 9);
    expect(trapezoidWeight(3.0, 2, 2.5, 3.5, 4)).toBe(1);
    expect(trapezoidWeight(3.75, 2, 2.5, 3.5, 4)).toBeCloseTo(0.5, 9);
    expect(trapezoidWeight(4.5, 2, 2.5, 3.5, 4)).toBe(0);
  });

  it('边界值处理与非法节点抛错', () => {
    expect(trapezoidWeight(2, 2, 2.5, 3.5, 4)).toBe(0);
    expect(trapezoidWeight(2.5, 2, 2.5, 3.5, 4)).toBe(1);
    expect(() => trapezoidWeight(1, 3, 2, 3.5, 4)).toThrow(RangeError);
  });
});

describe('timeCompressionForContinuousLevel', () => {
  it('整数层级取该层压缩比', () => {
    expect(timeCompressionForContinuousLevel(1)).toBe(TIME_COMPRESSION.L1);
    expect(timeCompressionForContinuousLevel(2)).toBe(TIME_COMPRESSION.L2);
    expect(timeCompressionForContinuousLevel(4)).toBe(TIME_COMPRESSION.L4);
  });

  it('中间层级为对数空间插值（几何均值）', () => {
    const mid = timeCompressionForContinuousLevel(2.5);
    expect(mid).toBeCloseTo(Math.sqrt(TIME_COMPRESSION.L2 * TIME_COMPRESSION.L3), 0);
  });

  it('超出范围钳制', () => {
    expect(timeCompressionForContinuousLevel(0)).toBe(TIME_COMPRESSION.L1);
    expect(timeCompressionForContinuousLevel(5)).toBe(TIME_COMPRESSION.L4);
  });
});

describe('advanceSimTimeContinuous', () => {
  it('按连续层级压缩比推进', () => {
    const next = advanceSimTimeContinuous(0, 1, 2, 1, false);
    expect(next).toBeCloseTo(TIME_COMPRESSION.L2 / 86400, 6);
  });

  it('暂停时不推进', () => {
    expect(advanceSimTimeContinuous(100, 1, 3, 1, true)).toBe(100);
  });

  it('倍率生效并钳制', () => {
    const x2 = advanceSimTimeContinuous(0, 1, 2, 2, false);
    expect(x2).toBeCloseTo((TIME_COMPRESSION.L2 * 2) / 86400, 6);
  });

  it('负时间增量抛错', () => {
    expect(() => advanceSimTimeContinuous(0, -1, 2, 1, false)).toThrow(RangeError);
  });
});

describe('速率钳制（需求 3.3）', () => {
  const ISS_PERIOD_DAYS = 0.0645; // 约 92 分钟

  it('ISS 在 L1 压缩比下超过阈值需要钳制', () => {
    const revs = visualRevsPerRealSecond(ISS_PERIOD_DAYS, TIME_COMPRESSION.L1, 1);
    expect(revs).toBeGreaterThan(MAX_VISUAL_REVS_PER_SECOND);
    const factor = rateClampFactor(ISS_PERIOD_DAYS, TIME_COMPRESSION.L1, 1);
    expect(factor).toBeLessThan(1);
    // 钳制后正好等于阈值
    expect(revs * factor).toBeCloseTo(MAX_VISUAL_REVS_PER_SECOND, 9);
  });

  it('月球（27.3天）在 L1 下无需钳制', () => {
    expect(rateClampFactor(27.321661, TIME_COMPRESSION.L1, 1)).toBe(1);
  });

  it('暂停（倍率0）时不钳制', () => {
    expect(rateClampFactor(ISS_PERIOD_DAYS, TIME_COMPRESSION.L1, 0)).toBe(1);
  });

  it('周期为 0 抛错', () => {
    expect(() => visualRevsPerRealSecond(0, TIME_COMPRESSION.L1, 1)).toThrow(RangeError);
  });
});

describe('computeContinuousSoundscapeGains（需求 3.4.2 连续音景混合）', () => {
  it('整数层级时仅该层有增益', () => {
    const gains = computeContinuousSoundscapeGains(3, 0.8, false);
    expect(gains.L3).toBeCloseTo(0.8, 6);
    expect(gains.L1 + gains.L2 + gains.L4).toBe(0);
  });

  it('中间层级时相邻两层等功率混合', () => {
    const gains = computeContinuousSoundscapeGains(2.5, 1, false);
    expect(gains.L2).toBeCloseTo(Math.sqrt(0.5), 6);
    expect(gains.L3).toBeCloseTo(Math.sqrt(0.5), 6);
    // 等功率：功率和为 1
    expect(gains.L2 ** 2 + gains.L3 ** 2).toBeCloseTo(1, 6);
  });

  it('静音或音量 0 时全部为 0', () => {
    const muted = computeContinuousSoundscapeGains(2.5, 1, true);
    const zero = computeContinuousSoundscapeGains(2.5, 0, false);
    for (const level of ['L1', 'L2', 'L3', 'L4'] as const) {
      expect(muted[level]).toBe(0);
      expect(zero[level]).toBe(0);
    }
  });

  it('随连续层级变化增益平滑过渡（跟随维度而非切换事件）', () => {
    const a = computeContinuousSoundscapeGains(2.1, 1, false);
    const b = computeContinuousSoundscapeGains(2.2, 1, false);
    expect(b.L3).toBeGreaterThan(a.L3);
    expect(b.L2).toBeLessThan(a.L2);
  });

  it('超出范围钳制', () => {
    expect(computeContinuousSoundscapeGains(0.2, 1, false).L1).toBe(1);
    expect(computeContinuousSoundscapeGains(8, 1, false).L4).toBe(1);
  });
});
