/**
 * R2-6 太阳系绕银心轨道运动可感知细节增强测试
 * （IMPROVEMENT_REQUIREMENTS_2 §R2-6 §6.1 / §6.2：
 *   垂直增益上限、轨道银河年刻度、脉动高亮相位、HUD 进度一致性）
 */

import {
  MARKER_BREATH_AMPLITUDE,
  MARKER_PULSE_PERIOD_SEC,
  ORBIT_GRADATION_COUNT,
  ORBIT_MAJOR_GRADATION_EVERY,
  PULSE_RING_MAX_SCALE,
  PULSE_RING_PEAK_OPACITY,
  VERTICAL_VISUAL_GAIN,
  gradationProgressLabel,
  isMajorGradation,
  markerBreathScale,
  markerPulse01,
  orbitGradationAngle,
  pulseRingOpacity,
  pulseRingScale,
  traveledArcAngleRad,
} from '@/utils/galacticMotionCues';
import {
  DAYS_PER_MYR,
  GALACTIC_YEAR_MYR,
  galacticYearProgress,
  sunGalacticPositionLy,
} from '@/utils/galaxy';

const myrToDays = (myr: number): number => myr * DAYS_PER_MYR;

describe('VERTICAL_VISUAL_GAIN（R2-6 §6.1 增益提升登记）', () => {
  it('提升至 10（>6 的 P6 原值，可辨性增强）', () => {
    expect(VERTICAL_VISUAL_GAIN).toBe(10);
  });

  it('不超过需求建议上限 ×10（不破坏"准圆轨道"认知）', () => {
    expect(VERTICAL_VISUAL_GAIN).toBeLessThanOrEqual(10);
  });
});

describe('orbitGradationAngle（银心系静止的轨道银河年刻度）', () => {
  it('刻度均匀分布：间隔 2π/count', () => {
    for (let i = 1; i < ORBIT_GRADATION_COUNT; i += 1) {
      const d = orbitGradationAngle(i) - orbitGradationAngle(i - 1);
      expect(d).toBeCloseTo((Math.PI * 2) / ORBIT_GRADATION_COUNT, 10);
    }
  });

  it('刻度角在 [0,2π) 内且首格为 0', () => {
    expect(orbitGradationAngle(0)).toBe(0);
    for (let i = 0; i < ORBIT_GRADATION_COUNT; i += 1) {
      const a = orbitGradationAngle(i);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThan(Math.PI * 2);
    }
  });

  it('自定义 count 生效', () => {
    expect(orbitGradationAngle(1, 4)).toBeCloseTo(Math.PI / 2, 10);
  });

  it('非法 count / index 抛 RangeError', () => {
    expect(() => orbitGradationAngle(0, 0)).toThrow(RangeError);
    expect(() => orbitGradationAngle(0, 2.5)).toThrow(RangeError);
    expect(() => orbitGradationAngle(-1)).toThrow(RangeError);
    expect(() => orbitGradationAngle(ORBIT_GRADATION_COUNT)).toThrow(RangeError);
    expect(() => orbitGradationAngle(1.5)).toThrow(RangeError);
  });
});

describe('isMajorGradation / gradationProgressLabel（0%/25%/50%/75% 主刻度）', () => {
  it('主刻度恰为 0、6、12、18（count=24、every=6）', () => {
    const majors: number[] = [];
    for (let i = 0; i < ORBIT_GRADATION_COUNT; i += 1) {
      if (isMajorGradation(i)) majors.push(i);
    }
    expect(majors).toEqual([0, 6, 12, 18]);
    expect(ORBIT_MAJOR_GRADATION_EVERY).toBe(6);
  });

  it('主刻度标签为银河年进度百分比', () => {
    expect(gradationProgressLabel(0)).toBe('银河年 0%');
    expect(gradationProgressLabel(6)).toBe('银河年 25%');
    expect(gradationProgressLabel(12)).toBe('银河年 50%');
    expect(gradationProgressLabel(18)).toBe('银河年 75%');
  });

  it('非整除刻度标签保留一位小数', () => {
    expect(gradationProgressLabel(1)).toBe(`银河年 ${(100 / 24).toFixed(1)}%`);
  });

  it('非法参数抛 RangeError', () => {
    expect(() => isMajorGradation(-1)).toThrow(RangeError);
    expect(() => isMajorGradation(1.5)).toThrow(RangeError);
    expect(() => isMajorGradation(0, 0)).toThrow(RangeError);
    expect(() => gradationProgressLabel(24)).toThrow(RangeError);
  });
});

describe('HUD 银河年进度与轨道标记位置一致性（R2-6 §6.1 / §6.2 验收）', () => {
  it('模拟时间推进 k/count 银河年时，进度角恰等于第 k 格刻度角', () => {
    for (const k of [0, 1, 6, 12, 18, 23]) {
      const simDays = myrToDays((GALACTIC_YEAR_MYR * k) / ORBIT_GRADATION_COUNT);
      const progress = galacticYearProgress(simDays);
      expect(progress.angleRad).toBeCloseTo(orbitGradationAngle(k), 8);
      // traveledArcAngleRad（轨道高亮角度）与 HUD 进度同源
      expect(traveledArcAngleRad(simDays)).toBeCloseTo(progress.angleRad, 8);
    }
  });

  it('标记场景位置（sunGalacticPositionLy）反解角度与 HUD 进度一致', () => {
    for (const myr of [10, 57.5, 115, 172.5, 300]) {
      const simDays = myrToDays(myr);
      const p = sunGalacticPositionLy(simDays);
      // 坐标约定 x=R·cosθ，z=−R·sinθ → θ = atan2(−z, x)
      const raw = Math.atan2(-p.z, p.x);
      const angle = raw < 0 ? raw + Math.PI * 2 : raw;
      expect(angle).toBeCloseTo(galacticYearProgress(simDays).angleRad, 8);
    }
  });
});

describe('markerPulse01（脉动相位，真实秒驱动）', () => {
  it('t=0 相位为 0，周期整数倍回到 0', () => {
    expect(markerPulse01(0)).toBe(0);
    expect(markerPulse01(MARKER_PULSE_PERIOD_SEC)).toBeCloseTo(0, 10);
    expect(markerPulse01(MARKER_PULSE_PERIOD_SEC * 3)).toBeCloseTo(0, 10);
  });

  it('相位在 [0,1) 内循环（负时间同样归一化）', () => {
    for (const t of [0.3, 1.7, 2.4, 100.9, -0.6]) {
      const p = markerPulse01(t);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThan(1);
    }
    expect(markerPulse01(MARKER_PULSE_PERIOD_SEC / 2)).toBeCloseTo(0.5, 10);
  });

  it('非法经过秒数 / 周期抛 RangeError', () => {
    expect(() => markerPulse01(Number.NaN)).toThrow(RangeError);
    expect(() => markerPulse01(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => markerPulse01(0, 0)).toThrow(RangeError);
    expect(() => markerPulse01(0, -1)).toThrow(RangeError);
  });
});

describe('pulseRingScale / pulseRingOpacity（波纹扩散环曲线）', () => {
  it('扩散起点缩放为 1、趋近终点达最大缩放', () => {
    expect(pulseRingScale(0)).toBe(1);
    expect(pulseRingScale(0.999999)).toBeCloseTo(PULSE_RING_MAX_SCALE, 4);
  });

  it('缩放随相位单调递增（easeOut：先快后慢）', () => {
    let prev = pulseRingScale(0);
    for (let p = 0.1; p < 1; p += 0.1) {
      const cur = pulseRingScale(p);
      expect(cur).toBeGreaterThan(prev);
      prev = cur;
    }
    // easeOut：前半程扩散量大于后半程
    const first = pulseRingScale(0.5) - pulseRingScale(0);
    const second = pulseRingScale(0.999999) - pulseRingScale(0.5);
    expect(first).toBeGreaterThan(second);
  });

  it('不透明度从峰值单调衰减至 0（扩散尽头完全消隐）', () => {
    expect(pulseRingOpacity(0)).toBeCloseTo(PULSE_RING_PEAK_OPACITY, 10);
    let prev = pulseRingOpacity(0);
    for (let p = 0.1; p < 1; p += 0.1) {
      const cur = pulseRingOpacity(p);
      expect(cur).toBeLessThan(prev);
      prev = cur;
    }
    expect(pulseRingOpacity(0.999999)).toBeCloseTo(0, 4);
  });

  it('非法相位抛 RangeError', () => {
    for (const fn of [pulseRingScale, pulseRingOpacity, markerBreathScale]) {
      expect(() => fn(-0.1)).toThrow(RangeError);
      expect(() => fn(1)).toThrow(RangeError);
      expect(() => fn(Number.NaN)).toThrow(RangeError);
    }
  });
});

describe('markerBreathScale（标记本体呼吸脉动）', () => {
  it('呼吸缩放在 1 ± 幅度内且相位 0 处为 1', () => {
    expect(markerBreathScale(0)).toBeCloseTo(1, 10);
    for (let p = 0; p < 1; p += 0.05) {
      const s = markerBreathScale(p);
      expect(s).toBeGreaterThanOrEqual(1 - MARKER_BREATH_AMPLITUDE - 1e-9);
      expect(s).toBeLessThanOrEqual(1 + MARKER_BREATH_AMPLITUDE + 1e-9);
    }
  });

  it('相位 1/4 处达最大呼吸缩放', () => {
    expect(markerBreathScale(0.25)).toBeCloseTo(1 + MARKER_BREATH_AMPLITUDE, 10);
  });
});
