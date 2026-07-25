/**
 * 太阳系银心轨道运动线索强化单元测试（P6 §3.1.2 / §6 测试验收）
 */

import {
  PREDICTION_ARC_FRACTION,
  VERTICAL_VISUAL_GAIN,
  isPredictionArcOpen,
  samplePredictionArc,
  traveledArcAngleRad,
  verticalVisualGain,
} from '@/utils/galacticMotionCues';
import { GALACTIC_YEAR_MYR, sunGalacticPositionLy, DAYS_PER_MYR } from '@/utils/galaxy';

const myrToDays = (myr: number): number => myr * DAYS_PER_MYR;

describe('verticalVisualGain（真实比例不放大，登记于文件头）', () => {
  it('默认模式返回 VERTICAL_VISUAL_GAIN（>1，可辨）', () => {
    expect(verticalVisualGain(false)).toBe(VERTICAL_VISUAL_GAIN);
    expect(VERTICAL_VISUAL_GAIN).toBeGreaterThan(1);
  });

  it('真实比例模式返回 1（不放大，科学事实）', () => {
    expect(verticalVisualGain(true)).toBe(1);
  });
});

describe('samplePredictionArc（前方 1/4 银河年非闭合弧段）', () => {
  it('弧段比例为 1/4 银河年', () => {
    expect(PREDICTION_ARC_FRACTION).toBeCloseTo(0.25, 10);
  });

  it('返回 segments+1 个采样点', () => {
    const s = samplePredictionArc(0, 96);
    expect(s.length).toBe(97);
  });

  it('起点等于当前太阳位置（gain=1）', () => {
    const t = 40;
    const s = samplePredictionArc(t, 96, 1);
    const sun = sunGalacticPositionLy(t * DAYS_PER_MYR);
    expect(s[0].x).toBeCloseTo(sun.x, 6);
    expect(s[0].y).toBeCloseTo(sun.y, 6);
    expect(s[0].z).toBeCloseTo(sun.z, 6);
  });

  it('终点在前方 1/4 银河年处（非闭合：首尾距离显著大于 0）', () => {
    const s = samplePredictionArc(0, 96, 1);
    expect(isPredictionArcOpen(s)).toBe(true);
    // 终点对应 t = 1/4 银河年
    const end = sunGalacticPositionLy(myrToDays(GALACTIC_YEAR_MYR * PREDICTION_ARC_FRACTION));
    const last = s[s.length - 1];
    expect(last.x).toBeCloseTo(end.x, 4);
    expect(last.z).toBeCloseTo(end.z, 4);
  });

  it('弧段随时间滚动：不同起点采样起点不同（滚动刷新）', () => {
    const a = samplePredictionArc(0, 48, 1)[0];
    const b = samplePredictionArc(20, 48, 1)[0];
    expect(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z)).toBeGreaterThan(0);
  });

  it('gain 放大 y 分量（x/z 不变）', () => {
    const t = 30;
    const g1 = samplePredictionArc(t, 12, 1);
    const g6 = samplePredictionArc(t, 12, 6);
    for (let i = 0; i < g1.length; i += 1) {
      expect(g6[i].x).toBeCloseTo(g1[i].x, 9);
      expect(g6[i].z).toBeCloseTo(g1[i].z, 9);
      expect(g6[i].y).toBeCloseTo(g1[i].y * 6, 9);
    }
  });

  it('非法段数 / 弧段比例抛 RangeError', () => {
    expect(() => samplePredictionArc(0, 0)).toThrow(RangeError);
    expect(() => samplePredictionArc(0, 2.5)).toThrow(RangeError);
    expect(() => samplePredictionArc(0, 10, 1, 0)).toThrow(RangeError);
    expect(() => samplePredictionArc(0, 10, 1, -0.5)).toThrow(RangeError);
  });

  it('isPredictionArcOpen 对单点/空数组返回 false', () => {
    expect(isPredictionArcOpen([])).toBe(false);
    expect(isPredictionArcOpen([{ x: 1, y: 2, z: 3 }])).toBe(false);
  });
});

// P6 流动刻度（orbitFlowPhase01/orbitFlowTickAngle）已由 R2-6 银心系静止的
// 轨道银河年刻度（orbitGradationAngle）替换，差异登记见 galacticMotionCues.ts
// 文件头；新刻度与脉动高亮的测试见 galacticMotionCuesR26.test.ts

describe('traveledArcAngleRad（已走过弧段角度，HUD 高亮联动）', () => {
  it('与银河年进度一致：半圈 → π', () => {
    expect(traveledArcAngleRad(myrToDays(GALACTIC_YEAR_MYR / 2))).toBeCloseTo(Math.PI, 6);
  });

  it('整圈归零（[0,2π)）', () => {
    expect(traveledArcAngleRad(myrToDays(GALACTIC_YEAR_MYR))).toBeCloseTo(0, 6);
  });

  it('负时间也归一化到 [0,2π)', () => {
    const a = traveledArcAngleRad(myrToDays(-GALACTIC_YEAR_MYR / 2));
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(Math.PI * 2);
    expect(a).toBeCloseTo(Math.PI, 6);
  });
});
