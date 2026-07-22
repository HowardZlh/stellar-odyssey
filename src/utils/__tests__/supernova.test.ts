/**
 * 超新星爆炸动态事件纯逻辑测试（需求 3.1.5 / 7 单元测试）
 */

import { createSeededRandom } from '@/utils/random';
import {
  SN_BLACK_HOLE_MASS_THRESHOLD_SUN,
  SN_DEFAULT_DURATION_SEC,
  SN_MAX_DURATION_SEC,
  SN_MIN_DURATION_SEC,
  SN_PHASE_FRACTIONS,
  clampSupernovaDuration,
  randomArmPositionLy,
  remnantCompactObject,
  shouldAutoTriggerSupernova,
  supernovaPhaseAt,
  supernovaVisualState,
} from '@/utils/supernova';

const DURATION = 20;

describe('动画时长配置（10–30 秒可配置）', () => {
  it('钳制到 [10, 30] 秒', () => {
    expect(clampSupernovaDuration(5)).toBe(SN_MIN_DURATION_SEC);
    expect(clampSupernovaDuration(60)).toBe(SN_MAX_DURATION_SEC);
    expect(clampSupernovaDuration(18)).toBe(18);
  });

  it('非有限输入回退默认时长', () => {
    expect(clampSupernovaDuration(Number.NaN)).toBe(SN_DEFAULT_DURATION_SEC);
    expect(clampSupernovaDuration(Infinity)).toBe(SN_DEFAULT_DURATION_SEC);
  });
});

describe('四阶段判定', () => {
  it('按时间比例进入对应阶段', () => {
    const brightenEnd = DURATION * SN_PHASE_FRACTIONS.brighten;
    const shockEnd = DURATION * (SN_PHASE_FRACTIONS.brighten + SN_PHASE_FRACTIONS.shock);
    expect(supernovaPhaseAt(0, DURATION)).toBe('brightening');
    expect(supernovaPhaseAt(brightenEnd - 0.01, DURATION)).toBe('brightening');
    expect(supernovaPhaseAt(brightenEnd + 0.01, DURATION)).toBe('shockwave');
    expect(supernovaPhaseAt(shockEnd + 0.01, DURATION)).toBe('decay');
    expect(supernovaPhaseAt(DURATION, DURATION)).toBe('remnant');
    expect(supernovaPhaseAt(DURATION * 10, DURATION)).toBe('remnant');
  });

  it('时长非正抛出 RangeError', () => {
    expect(() => supernovaPhaseAt(1, 0)).toThrow(RangeError);
    expect(() => supernovaVisualState(1, -5)).toThrow(RangeError);
  });
});

describe('可视状态曲线（需求 3.1.5 阶段动画）', () => {
  const brightenEnd = DURATION * SN_PHASE_FRACTIONS.brighten;

  it('阶段1：亮度数秒内骤增至峰值 1', () => {
    const early = supernovaVisualState(brightenEnd * 0.3, DURATION);
    const late = supernovaVisualState(brightenEnd * 0.9, DURATION);
    expect(early.brightness01).toBeGreaterThan(0);
    expect(late.brightness01).toBeGreaterThan(early.brightness01);
    expect(supernovaVisualState(brightenEnd, DURATION).brightness01).toBeCloseTo(1, 6);
    // 增亮期间冲击波尚未出现
    expect(early.shockRadius01).toBe(0);
    expect(early.shockOpacity01).toBe(0);
  });

  it('阶段2：冲击波按 Sedov-Taylor（r ∝ t^0.4）减速扩张', () => {
    const shockSpan = DURATION - brightenEnd;
    const r1 = supernovaVisualState(brightenEnd + shockSpan * 0.25, DURATION).shockRadius01;
    const r2 = supernovaVisualState(brightenEnd + shockSpan * 0.5, DURATION).shockRadius01;
    const r3 = supernovaVisualState(brightenEnd + shockSpan * 0.75, DURATION).shockRadius01;
    // 单调扩张
    expect(r2).toBeGreaterThan(r1);
    expect(r3).toBeGreaterThan(r2);
    // 减速：等时间间隔内增量递减
    expect(r2 - r1).toBeGreaterThan(r3 - r2);
    // 幂律精确性：t=0.25 → 0.25^0.4
    expect(r1).toBeCloseTo(Math.pow(0.25, 0.4), 9);
  });

  it('阶段3：亮度按衰减曲线回落', () => {
    const shockEnd = DURATION * (SN_PHASE_FRACTIONS.brighten + SN_PHASE_FRACTIONS.shock);
    const a = supernovaVisualState(shockEnd, DURATION);
    const b = supernovaVisualState((shockEnd + DURATION) / 2, DURATION);
    expect(b.brightness01).toBeLessThan(a.brightness01);
    // 遗迹渐显（decay 阶段）
    expect(b.remnantOpacity01).toBeGreaterThan(0);
    expect(b.remnantOpacity01).toBeLessThan(1);
  });

  it('阶段4：遗迹期冲击波达最大、遗迹完全显现、余辉维持', () => {
    const s = supernovaVisualState(DURATION + 1, DURATION);
    expect(s.phase).toBe('remnant');
    expect(s.shockRadius01).toBeCloseTo(1, 9);
    expect(s.remnantOpacity01).toBe(1);
    expect(s.brightness01).toBeCloseTo(0.05, 9);
    expect(s.shockOpacity01).toBeCloseTo(0.12, 9);
  });

  it('全程状态值在 [0, 1] 有效范围内', () => {
    for (let t = 0; t <= DURATION * 1.5; t += 0.37) {
      const s = supernovaVisualState(t, DURATION);
      expect(s.brightness01).toBeGreaterThanOrEqual(0);
      expect(s.brightness01).toBeLessThanOrEqual(1);
      expect(s.shockRadius01).toBeGreaterThanOrEqual(0);
      expect(s.shockRadius01).toBeLessThanOrEqual(1);
      expect(s.shockOpacity01).toBeGreaterThanOrEqual(0);
      expect(s.shockOpacity01).toBeLessThanOrEqual(1);
      expect(s.remnantOpacity01).toBeGreaterThanOrEqual(0);
      expect(s.remnantOpacity01).toBeLessThanOrEqual(1);
    }
  });

  it('负 elapsed 视为 0（触发瞬间）', () => {
    const s = supernovaVisualState(-1, DURATION);
    expect(s.brightness01).toBe(0);
    expect(s.shockRadius01).toBe(0);
  });
});

describe('自动触发（泊松过程，需求 3.1.5 触发方式）', () => {
  it('随机数低于概率阈值时触发', () => {
    // Δ=平均间隔时 p = 1 − e^-1 ≈ 0.632
    expect(shouldAutoTriggerSupernova(0.5, 60, 60)).toBe(true);
    expect(shouldAutoTriggerSupernova(0.7, 60, 60)).toBe(false);
  });

  it('时间未推进不触发', () => {
    expect(shouldAutoTriggerSupernova(0, 0, 60)).toBe(false);
    expect(shouldAutoTriggerSupernova(0, -1, 60)).toBe(false);
  });

  it('小时间步概率近似 Δt/mean', () => {
    // Δ=0.6，mean=60 → p ≈ 0.00995
    expect(shouldAutoTriggerSupernova(0.009, 0.6, 60)).toBe(true);
    expect(shouldAutoTriggerSupernova(0.011, 0.6, 60)).toBe(false);
  });

  it('平均间隔非正抛出 RangeError', () => {
    expect(() => shouldAutoTriggerSupernova(0.5, 1, 0)).toThrow(RangeError);
  });
});

describe('旋臂内随机爆发位置', () => {
  const params = {
    armCount: 4,
    spiralTightness: 1.2,
    bulgeRadiusLy: 8000,
    diskRadiusLy: 50000,
    heightSpreadLy: 300,
  };

  it('位置在核球外、银盘 85% 内，垂直高度在散布范围内', () => {
    const rand = createSeededRandom(12345);
    for (let i = 0; i < 50; i += 1) {
      const p = randomArmPositionLy(rand, params);
      const r = Math.hypot(p.x, p.z);
      expect(r).toBeGreaterThanOrEqual(params.bulgeRadiusLy);
      expect(r).toBeLessThanOrEqual(params.diskRadiusLy * 0.85);
      expect(Math.abs(p.y)).toBeLessThanOrEqual(params.heightSpreadLy);
    }
  });

  it('确定性：同一种子生成相同位置序列', () => {
    const a = randomArmPositionLy(createSeededRandom(7), params);
    const b = randomArmPositionLy(createSeededRandom(7), params);
    expect(a).toEqual(b);
  });

  it('旋臂数非法抛出 RangeError', () => {
    expect(() => randomArmPositionLy(createSeededRandom(1), { ...params, armCount: 0 })).toThrow(
      RangeError,
    );
  });
});

describe('遗迹致密天体类型（按前身星质量）', () => {
  it('≥ 20 M☉ 为黑洞，否则中子星', () => {
    expect(remnantCompactObject(SN_BLACK_HOLE_MASS_THRESHOLD_SUN)).toBe('black-hole');
    expect(remnantCompactObject(25)).toBe('black-hole');
    expect(remnantCompactObject(19.9)).toBe('neutron-star');
    expect(remnantCompactObject(12)).toBe('neutron-star');
  });

  it('质量非正抛出 RangeError', () => {
    expect(() => remnantCompactObject(0)).toThrow(RangeError);
    expect(() => remnantCompactObject(-5)).toThrow(RangeError);
  });
});
