/**
 * R2-3 行星冻结-淡出门控测试（消除 L3 视角"高压缩比未冻结"乱转窗口）
 *
 * 覆盖：淡出曲线（2.6→3.0 smoothstep）、冻结判定（原 3.2 硬阈值统一替代）、
 * 钳制相位推进连续性（累计无跳变）、相位→等效时间往返、提示聚合。
 * 相位连续性回归：淡出区间内行星视觉角速度经 rateClampFactor 钳制后
 * 每帧步进 ≤ 0.5 圈/秒 × 帧时长（原 L3 锚点处每帧数千圈乱跳）。
 */

import {
  PLANET_FADE_END_LEVEL,
  PLANET_FADE_START_LEVEL,
  advanceClampedPhase,
  clearPlanetRateClampReports,
  equivalentDaysForPhase,
  planetFrozen,
  planetVisibilityWeight,
  reportPlanetRateClamp,
} from '@/utils/freezeGate';
import { meanAnomalyAtTime, normalizeAngle } from '@/utils/physics';
import {
  MAX_VISUAL_REVS_PER_SECOND,
  rateClampFactor,
  timeCompressionForContinuousLevel,
} from '@/utils/time';

describe('planetVisibilityWeight（R2-3 淡出曲线）', () => {
  it('淡出起点（2.6）之前完全可见', () => {
    expect(planetVisibilityWeight(1.0)).toBe(1);
    expect(planetVisibilityWeight(2.0)).toBe(1);
    expect(planetVisibilityWeight(2.4)).toBe(1);
    expect(planetVisibilityWeight(PLANET_FADE_START_LEVEL)).toBe(1);
  });

  it('淡出终点（3.0，L3 锚点前）及之后完全隐藏', () => {
    expect(planetVisibilityWeight(PLANET_FADE_END_LEVEL)).toBe(0);
    expect(planetVisibilityWeight(3.1)).toBe(0);
    expect(planetVisibilityWeight(3.2)).toBe(0);
    expect(planetVisibilityWeight(4.0)).toBe(0);
  });

  it('区间中点权重为 0.5（smoothstep 对称）', () => {
    const mid = (PLANET_FADE_START_LEVEL + PLANET_FADE_END_LEVEL) / 2;
    expect(planetVisibilityWeight(mid)).toBeCloseTo(0.5, 10);
  });

  it('全程单调不增（2.4 → 3.2 缓慢缩放平滑淡出，无突变）', () => {
    let prev = planetVisibilityWeight(2.4);
    for (let level = 2.4; level <= 3.2; level += 0.005) {
      const w = planetVisibilityWeight(level);
      expect(w).toBeLessThanOrEqual(prev + 1e-12);
      expect(w).toBeGreaterThanOrEqual(0);
      expect(w).toBeLessThanOrEqual(1);
      prev = w;
    }
  });

  it('边界处连续（无阶跃）', () => {
    const eps = 1e-6;
    expect(planetVisibilityWeight(PLANET_FADE_START_LEVEL + eps)).toBeCloseTo(1, 5);
    expect(planetVisibilityWeight(PLANET_FADE_END_LEVEL - eps)).toBeCloseTo(0, 5);
  });

  it('相邻采样点权重差有界（帧间无可感知跳变）', () => {
    const step = 0.001;
    let prev = planetVisibilityWeight(2.5);
    for (let level = 2.5; level <= 3.1; level += step) {
      const w = planetVisibilityWeight(level);
      // smoothstep 最大斜率 1.5/(区间宽 0.4) = 3.75 → 每 0.001 层级 ≤ 0.00375
      expect(Math.abs(prev - w)).toBeLessThanOrEqual(3.75 * step + 1e-9);
      prev = w;
    }
  });

  it('非有限输入抛错', () => {
    expect(() => planetVisibilityWeight(Number.NaN)).toThrow(RangeError);
    expect(() => planetVisibilityWeight(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe('planetFrozen（原 3.2 硬阈值统一替代）', () => {
  it('淡出完毕（≥3.0）即冻结', () => {
    expect(planetFrozen(3.0)).toBe(true);
    expect(planetFrozen(3.05)).toBe(true);
    // 原阈值 3.2 处仍冻结（行为不回退）
    expect(planetFrozen(3.2)).toBe(true);
    expect(planetFrozen(4.0)).toBe(true);
  });

  it('淡出区间内与之前不冻结（部分可见时仍演算）', () => {
    expect(planetFrozen(1.0)).toBe(false);
    expect(planetFrozen(2.0)).toBe(false);
    expect(planetFrozen(2.6)).toBe(false);
    expect(planetFrozen(2.99)).toBe(false);
  });
});

describe('advanceClampedPhase（R2-3 钳制相位推进）', () => {
  const n = (Math.PI * 2) / 365.25; // 地球平均运动（弧度/天）

  it('接管帧以精确相位为起点（无跳变）', () => {
    expect(advanceClampedPhase(null, 1.234, 100, n, 0.5)).toBeCloseTo(1.234, 12);
    // 精确相位未规范化时输出规范化到 [0, 2π)
    expect(advanceClampedPhase(null, Math.PI * 2 + 0.5, 100, n, 0.5)).toBeCloseTo(0.5, 12);
  });

  it('钳制中按降速角速度增量累计', () => {
    const next = advanceClampedPhase(1.0, 9.99, 10, n, 0.25);
    expect(next).toBeCloseTo(normalizeAngle(1.0 + n * 10 * 0.25), 12);
  });

  it('时间回拨（负增量）同样降速回退', () => {
    const next = advanceClampedPhase(1.0, 0, -10, n, 0.25);
    expect(next).toBeCloseTo(normalizeAngle(1.0 - n * 10 * 0.25), 12);
  });

  it('因子逐帧变化时相位连续（每帧步进 ≤ 未钳制步进）', () => {
    let phase = advanceClampedPhase(null, 0.7, 0, n, 1);
    const deltaDays = 5;
    for (let i = 1; i <= 200; i += 1) {
      const factor = Math.max(0.01, 1 - i * 0.01);
      const next = advanceClampedPhase(phase, 999, deltaDays, n, factor);
      const stepped = normalizeAngle(next - phase);
      const step = Math.min(stepped, Math.PI * 2 - stepped);
      expect(step).toBeLessThanOrEqual(n * deltaDays + 1e-12);
      phase = next;
    }
  });

  it('非法输入抛错', () => {
    expect(() => advanceClampedPhase(null, Number.NaN, 1, n, 0.5)).toThrow(RangeError);
    expect(() => advanceClampedPhase(1, 1, 1, n, 0)).toThrow(RangeError);
    expect(() => advanceClampedPhase(1, 1, 1, n, 1.5)).toThrow(RangeError);
    expect(() => advanceClampedPhase(1, 1, 1, n, Number.NaN)).toThrow(RangeError);
  });
});

describe('equivalentDaysForPhase（相位 → 等效历元后天数）', () => {
  it('与 meanAnomalyAtTime 往返一致（地球 a=1 AU，周期 365.25 天）', () => {
    const elements = {
      semiMajorAxisAu: 1,
      eccentricity: 0.0167,
      inclinationDeg: 0,
      longitudeOfAscendingNodeDeg: 0,
      argumentOfPerihelionDeg: 102.9,
      meanAnomalyAtEpochDeg: 100.46,
    };
    for (const phase of [0, 0.5, Math.PI, 5.5]) {
      const days = equivalentDaysForPhase(phase, elements.meanAnomalyAtEpochDeg, 365.25);
      expect(days).toBeGreaterThanOrEqual(0);
      expect(days).toBeLessThan(365.25);
      expect(meanAnomalyAtTime(elements, days)).toBeCloseTo(phase, 8);
    }
  });

  it('逆行轨道（负周期）等效时间换算方向正确', () => {
    // 负周期（逆行）下平均运动为负，等效时间为负方向推进且平近点角互逆
    const days = equivalentDaysForPhase(0.5, 0, -100);
    expect(days).toBeLessThan(0);
    expect(normalizeAngle(days * ((Math.PI * 2) / -100))).toBeCloseTo(0.5, 10);
  });

  it('非法输入抛错', () => {
    expect(() => equivalentDaysForPhase(Number.NaN, 0, 100)).toThrow(RangeError);
    expect(() => equivalentDaysForPhase(1, 0, 0)).toThrow(RangeError);
    expect(() => equivalentDaysForPhase(1, 0, Number.NaN)).toThrow(RangeError);
  });
});

describe('相位连续性回归（R2-3：淡出区间视觉角速度 ≤ 0.5 圈/秒）', () => {
  const frameSeconds = 1 / 60;
  const planets: Array<[string, number]> = [
    ['水星', 87.97],
    ['地球', 365.25],
    ['海王星', 60190],
  ];

  it.each(planets)('%s：连续层级 2.4→3.0 逐帧步进有界（原每帧数千圈）', (_name, period) => {
    const n = (Math.PI * 2) / period;
    let phase: number | null = null;
    let simDays = 8000;
    for (let level = 2.4; level < 3.0; level += 0.01) {
      const compression = timeCompressionForContinuousLevel(level);
      const deltaSimDays = (compression * frameSeconds) / 86400;
      const factor = rateClampFactor(period, compression, 1);
      const exact = normalizeAngle(
        ((100 * Math.PI) / 180) + n * (simDays + deltaSimDays),
      );
      const clamped = factor < 1;
      const next: number = clamped
        ? advanceClampedPhase(phase, exact, deltaSimDays, n, factor)
        : exact;
      if (phase !== null && clamped) {
        const stepped = normalizeAngle(next - phase);
        const step = Math.min(stepped, Math.PI * 2 - stepped);
        // 视觉角速度钳制：每帧 ≤ 0.5 圈/秒 × 帧时长（+浮点余量）
        expect(step).toBeLessThanOrEqual(
          Math.PI * 2 * MAX_VISUAL_REVS_PER_SECOND * frameSeconds + 1e-9,
        );
      }
      phase = clamped ? next : null;
      simDays += deltaSimDays;
    }
  });

  it('L3 锚点（3.0）时间压缩比下地球未钳制时每帧转数达数百圈（根因复现）', () => {
    const compression = timeCompressionForContinuousLevel(3.0);
    const deltaSimDays = (compression * frameSeconds) / 86400;
    expect(deltaSimDays / 365.25).toBeGreaterThan(30); // 每帧 >30 圈 → 必须冻结/钳制
  });

  it('钳制解除后按共享时间轴精确求值（返回 L2/L1 相位与模拟时间一致）', () => {
    // 组件逻辑：clamped=false 时 phase = exactPhase（Moon.tsx/Planet.tsx 同款），
    // 此处验证等效时间换算不引入偏差：等效时间处的平近点角与相位严格互逆
    const period = 365.25;
    const phase = 2.345;
    const days = equivalentDaysForPhase(phase, 0, period);
    expect(normalizeAngle(((Math.PI * 2) / period) * days)).toBeCloseTo(phase, 10);
  });
});

describe('reportPlanetRateClamp（"行星运动已减速显示"提示聚合）', () => {
  beforeEach(() => clearPlanetRateClampReports());
  afterAll(() => clearPlanetRateClampReports());

  it('任一天体钳制即提示；全部解除才熄灭（多天体互写不抖动）', () => {
    expect(reportPlanetRateClamp('mercury', true)).toBe(true);
    // 海王星未钳制（周期长阈值晚）不熄灭提示——原共享布尔互写会逐帧抖动
    expect(reportPlanetRateClamp('neptune', false)).toBe(true);
    expect(reportPlanetRateClamp('earth', true)).toBe(true);
    expect(reportPlanetRateClamp('mercury', false)).toBe(true);
    expect(reportPlanetRateClamp('earth', false)).toBe(false);
  });

  it('重复上报幂等', () => {
    expect(reportPlanetRateClamp('earth', true)).toBe(true);
    expect(reportPlanetRateClamp('earth', true)).toBe(true);
    expect(reportPlanetRateClamp('earth', false)).toBe(false);
    expect(reportPlanetRateClamp('earth', false)).toBe(false);
  });
});
