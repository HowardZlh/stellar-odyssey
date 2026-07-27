/**
 * 粒子化彗尾细节增强测试（需求 §4.7 彗尾细腻化）
 *
 * 锁定 Comet.tsx 粒子 shader 的 CPU 镜像纯函数行为：
 * 流动相位循环、横向扩散包络、离子尾摆动、轴向亮度衰减。
 */

import {
  ION_SWAY_WAVE_NUMBER,
  TAIL_FADE_EXPONENT,
  TAIL_SPREAD_EXPONENT,
  ionTailSwayOffset,
  tailAxialFade01,
  tailFlowT01,
  tailSpreadRadius,
} from '../cometTail';

describe('tailFlowT01（粒子流动相位）', () => {
  it('无环绕时为 seed + flow', () => {
    expect(tailFlowT01(0.3, 0.5)).toBeCloseTo(0.8, 12);
  });

  it('超过 1 时循环回收（物质外流循环）', () => {
    expect(tailFlowT01(0.7, 0.5)).toBeCloseTo(0.2, 12);
  });

  it('结果始终落在 [0, 1)', () => {
    for (let i = 0; i < 50; i += 1) {
      const t = tailFlowT01(i * 0.137, i * 0.311);
      expect(t).toBeGreaterThanOrEqual(0);
      expect(t).toBeLessThan(1);
    }
  });

  it('flow 推进使粒子沿尾轴前移（模 1 意义下）', () => {
    const t0 = tailFlowT01(0.2, 0.1);
    const t1 = tailFlowT01(0.2, 0.3);
    expect(t1).toBeGreaterThan(t0);
  });
});

describe('tailSpreadRadius（横向扩散包络）', () => {
  it('尾根（t=0）为核心半径，尾端（t=1）为最大半径', () => {
    expect(tailSpreadRadius(0, 0.05, 0.6)).toBeCloseTo(0.05, 12);
    expect(tailSpreadRadius(1, 0.05, 0.6)).toBeCloseTo(0.6, 12);
  });

  it('沿尾轴单调不减', () => {
    let prev = -Infinity;
    for (let i = 0; i <= 20; i += 1) {
      const r = tailSpreadRadius(i / 20, 0.05, 0.6);
      expect(r).toBeGreaterThanOrEqual(prev);
      prev = r;
    }
  });

  it('扩散指数 <1：根部展宽快于尾端（中点半径高于线性中值）', () => {
    expect(TAIL_SPREAD_EXPONENT).toBeLessThan(1);
    const mid = tailSpreadRadius(0.5, 0, 1);
    expect(mid).toBeGreaterThan(0.5);
  });

  it('t 越界钳制到 [0,1]', () => {
    expect(tailSpreadRadius(-1, 0.05, 0.6)).toBeCloseTo(0.05, 12);
    expect(tailSpreadRadius(2, 0.05, 0.6)).toBeCloseTo(0.6, 12);
  });

  it('非法半径（core<0 或 max<core）抛 RangeError', () => {
    expect(() => tailSpreadRadius(0.5, -0.1, 0.6)).toThrow(RangeError);
    expect(() => tailSpreadRadius(0.5, 0.6, 0.1)).toThrow(RangeError);
  });
});

describe('ionTailSwayOffset（离子尾太阳风摆动）', () => {
  it('尾根（t=0）固定不摆动（与彗核锚定）', () => {
    expect(ionTailSwayOffset(0, 1.23, 0.5)).toBe(0);
  });

  it('偏移绝对值不超过 amp·t（摆幅向尾端线性增大）', () => {
    for (let i = 0; i <= 20; i += 1) {
      const t = i / 20;
      for (let p = 0; p < 8; p += 1) {
        expect(Math.abs(ionTailSwayOffset(t, p * 0.9, 0.4))).toBeLessThanOrEqual(0.4 * t + 1e-12);
      }
    }
  });

  it('公式镜像：offset = amp·t·sin(phase − t·波数)', () => {
    const t = 0.75;
    const phase = 2.1;
    const amp = 0.3;
    expect(ionTailSwayOffset(t, phase, amp)).toBeCloseTo(
      amp * t * Math.sin(phase - t * ION_SWAY_WAVE_NUMBER),
      12,
    );
  });

  it('t 越界钳制到 [0,1]', () => {
    expect(ionTailSwayOffset(5, Math.PI / 2 + ION_SWAY_WAVE_NUMBER, 0.4)).toBeCloseTo(0.4, 12);
  });
});

describe('tailAxialFade01（轴向亮度衰减）', () => {
  it('尾根最亮（1）、尾端消隐至 0（消除截断突兀）', () => {
    expect(tailAxialFade01(0)).toBeCloseTo(1, 12);
    expect(tailAxialFade01(1)).toBeCloseTo(0, 12);
  });

  it('沿尾轴单调递减', () => {
    let prev = Infinity;
    for (let i = 0; i <= 20; i += 1) {
      const f = tailAxialFade01(i / 20);
      expect(f).toBeLessThanOrEqual(prev);
      prev = f;
    }
  });

  it('公式镜像：fade = (1−t)^指数', () => {
    expect(tailAxialFade01(0.5)).toBeCloseTo(Math.pow(0.5, TAIL_FADE_EXPONENT), 12);
  });

  it('t 越界钳制到 [0,1]', () => {
    expect(tailAxialFade01(-3)).toBeCloseTo(1, 12);
    expect(tailAxialFade01(9)).toBeCloseTo(0, 12);
  });
});
