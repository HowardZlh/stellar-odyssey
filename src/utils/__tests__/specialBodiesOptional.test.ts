/**
 * 可选特殊天体动态效果纯函数测试（可选需求 3.1.5 / 7 单元测试）：
 * 星风外流 / 造父变星光变 / 伽马射线暴闪光
 */

import {
  CEPHEID_BRIGHTNESS_AMPLITUDE,
  CEPHEID_RISE_FRACTION,
  CEPHEID_VISUAL_PERIOD_SEC,
  GRB_CYCLE_SEC,
  GRB_FLASH_DURATION_SEC,
  STELLAR_WIND_CYCLE_SEC,
  cepheidBrightness,
  grbFlashState,
  stellarWindPhase01,
} from '@/utils/specialBodies';

describe('stellarWindPhase01（星风粒子外流）', () => {
  it('返回值恒在 [0, 1) 内（含负时间回溯）', () => {
    for (const t of [-20, -3.3, 0, 1.7, 100, 1e4]) {
      for (const seed of [0, 0.25, 0.999]) {
        const p = stellarWindPhase01(t, seed);
        expect(p).toBeGreaterThanOrEqual(0);
        expect(p).toBeLessThan(1);
      }
    }
  });

  it('随时间线性推进并按周期循环', () => {
    const p0 = stellarWindPhase01(0, 0);
    const pHalf = stellarWindPhase01(STELLAR_WIND_CYCLE_SEC / 2, 0);
    const pFull = stellarWindPhase01(STELLAR_WIND_CYCLE_SEC, 0);
    expect(p0).toBeCloseTo(0, 9);
    expect(pHalf).toBeCloseTo(0.5, 9);
    expect(pFull).toBeCloseTo(0, 9);
  });

  it('seed01 错开粒子相位（不同粒子不同步）', () => {
    expect(stellarWindPhase01(1, 0)).not.toBeCloseTo(stellarWindPhase01(1, 0.5), 6);
    expect(stellarWindPhase01(0, 0.3)).toBeCloseTo(0.3, 9);
  });

  it('非正周期抛出 RangeError', () => {
    expect(() => stellarWindPhase01(1, 0, 0)).toThrow(RangeError);
    expect(() => stellarWindPhase01(1, 0, -6)).toThrow(RangeError);
  });
});

describe('cepheidBrightness（造父变星锯齿光变）', () => {
  it('亮度恒在 [1−幅度, 1+幅度] 内', () => {
    for (let t = -10; t <= 30; t += 0.13) {
      const b = cepheidBrightness(t);
      expect(b).toBeGreaterThanOrEqual(1 - CEPHEID_BRIGHTNESS_AMPLITUDE - 1e-9);
      expect(b).toBeLessThanOrEqual(1 + CEPHEID_BRIGHTNESS_AMPLITUDE + 1e-9);
    }
  });

  it('相位 0 为最暗、上升段末（rise fraction）为最亮', () => {
    expect(cepheidBrightness(0)).toBeCloseTo(1 - CEPHEID_BRIGHTNESS_AMPLITUDE, 9);
    expect(cepheidBrightness(CEPHEID_VISUAL_PERIOD_SEC * CEPHEID_RISE_FRACTION)).toBeCloseTo(
      1 + CEPHEID_BRIGHTNESS_AMPLITUDE,
      9,
    );
  });

  it('不对称锯齿：快速上升（1/4 周期）、缓慢下降（3/4 周期）', () => {
    expect(CEPHEID_RISE_FRACTION).toBeLessThan(0.5);
    const period = CEPHEID_VISUAL_PERIOD_SEC;
    // 上升段中点斜率 > 下降段中点斜率（幅度对称但时长不对称）
    const dt = 0.01;
    const riseMid = period * CEPHEID_RISE_FRACTION * 0.5;
    const fallMid = period * (CEPHEID_RISE_FRACTION + (1 - CEPHEID_RISE_FRACTION) * 0.5);
    const riseSlope = (cepheidBrightness(riseMid + dt) - cepheidBrightness(riseMid - dt)) / (2 * dt);
    const fallSlope = (cepheidBrightness(fallMid + dt) - cepheidBrightness(fallMid - dt)) / (2 * dt);
    expect(riseSlope).toBeGreaterThan(0);
    expect(fallSlope).toBeLessThan(0);
    expect(riseSlope).toBeGreaterThan(Math.abs(fallSlope));
  });

  it('按周期循环（含负时间）', () => {
    expect(cepheidBrightness(3)).toBeCloseTo(cepheidBrightness(3 + CEPHEID_VISUAL_PERIOD_SEC), 9);
    expect(cepheidBrightness(-1)).toBeCloseTo(
      cepheidBrightness(-1 + CEPHEID_VISUAL_PERIOD_SEC),
      9,
    );
  });

  it('自定义周期生效、非正周期抛出 RangeError', () => {
    expect(cepheidBrightness(2, 4)).toBeCloseTo(cepheidBrightness(6, 4), 9);
    expect(() => cepheidBrightness(1, 0)).toThrow(RangeError);
    expect(() => cepheidBrightness(1, -8)).toThrow(RangeError);
  });
});

describe('grbFlashState（伽马射线暴 FRED 闪光）', () => {
  it('闪光窗口内强度 > 0，窗口外为 0', () => {
    expect(grbFlashState(0.5).intensity01).toBeGreaterThan(0);
    expect(grbFlashState(GRB_FLASH_DURATION_SEC + 1).intensity01).toBe(0);
    expect(grbFlashState(GRB_CYCLE_SEC - 1).intensity01).toBe(0);
  });

  it('FRED 光变：快速上升后指数衰减（峰值靠前）', () => {
    const peak = grbFlashState(GRB_FLASH_DURATION_SEC * 0.08).intensity01;
    const later = grbFlashState(GRB_FLASH_DURATION_SEC * 0.6).intensity01;
    expect(peak).toBeGreaterThan(later);
    expect(later).toBeGreaterThan(0);
    // 上升段：起点强度低于峰值
    expect(grbFlashState(GRB_FLASH_DURATION_SEC * 0.01).intensity01).toBeLessThan(peak);
  });

  it('强度恒在 [0, 1] 内', () => {
    for (let t = 0; t <= GRB_CYCLE_SEC * 2; t += 0.37) {
      const { intensity01 } = grbFlashState(t);
      expect(intensity01).toBeGreaterThanOrEqual(0);
      expect(intensity01).toBeLessThanOrEqual(1);
    }
  });

  it('cycleIndex 为循环序号且随周期递增（演示性重放，已登记）', () => {
    expect(grbFlashState(1).cycleIndex).toBe(0);
    expect(grbFlashState(GRB_CYCLE_SEC + 1).cycleIndex).toBe(1);
    expect(grbFlashState(GRB_CYCLE_SEC * 5 + 2).cycleIndex).toBe(5);
  });

  it('负时间回溯：窗口相位归一化到 [0, cycle) 内', () => {
    const { intensity01 } = grbFlashState(-GRB_CYCLE_SEC + 0.5);
    expect(intensity01).toBeGreaterThan(0);
  });

  it('非正周期/时长抛出 RangeError', () => {
    expect(() => grbFlashState(1, 0)).toThrow(RangeError);
    expect(() => grbFlashState(1, 45, 0)).toThrow(RangeError);
    expect(() => grbFlashState(1, -45, 3)).toThrow(RangeError);
  });
});
