/**
 * 太阳活动事件纯逻辑单测（S2，IMPROVEMENT_REQUIREMENTS_SOLAR §4.3/§6）：
 * 耀斑阶段曲线、CME 壳层扩张/朝地球判定、太阳风相位、日珥/日冕环弧线
 */

import { createSeededRandom } from '@/utils/random';
import { AU_KM, SCENE_UNITS_PER_AU } from '@/utils/scale';
import {
  CME_CONE_HALF_ANGLE_DEG,
  CME_MAX_RADIUS_UNITS,
  CME_SPEED_KM_S_MAX,
  CME_SPEED_KM_S_MIN,
  FLARE_RISE_FRACTION,
  cmeConeDirections,
  cmeIsEarthDirected,
  cmeLinkProbability,
  cmeOpacity01,
  cmeProgress01,
  cmeShellRadiusUnits,
  cmeSpeedForClass,
  flareClassRoll,
  flareIntensity01,
  flareLocalBoost,
  flareMagnitudeRoll,
  flareProgress01,
  kmPerSecToUnitsPerDay,
  loopArcPoint,
  prominenceEvolveFactor,
  shouldAutoTriggerFlare,
  sunActivityStatusLines,
  windCycleDays,
  windParticleAlpha,
  windPhase01,
  windShaderDays,
} from '@/utils/solarActivity';

describe('耀斑（flare）', () => {
  it('级别判定按阈值：C 50% / M 35% / X 15%', () => {
    expect(flareClassRoll(0)).toBe('C');
    expect(flareClassRoll(0.49)).toBe('C');
    expect(flareClassRoll(0.5)).toBe('M');
    expect(flareClassRoll(0.84)).toBe('M');
    expect(flareClassRoll(0.85)).toBe('X');
    expect(flareClassRoll(0.99)).toBe('X');
  });

  it('级内量级在 1.0–9.9', () => {
    expect(flareMagnitudeRoll(0)).toBeCloseTo(1, 10);
    expect(flareMagnitudeRoll(1)).toBeCloseTo(9.9, 10);
  });

  it('强度曲线：起点/终点为 0，上升段单调、峰值 ≈1，随后指数衰减', () => {
    expect(flareIntensity01(0)).toBe(0);
    expect(flareIntensity01(1)).toBe(0);
    expect(flareIntensity01(-0.5)).toBe(0);
    expect(flareIntensity01(0.05)).toBeLessThan(flareIntensity01(0.12));
    expect(flareIntensity01(FLARE_RISE_FRACTION * 0.999)).toBeGreaterThan(0.99);
    // 指数衰减：峰值后单调下降
    expect(flareIntensity01(0.3)).toBeGreaterThan(flareIntensity01(0.6));
    expect(flareIntensity01(0.6)).toBeGreaterThan(flareIntensity01(0.95));
    expect(flareIntensity01(0.999)).toBeLessThan(0.05);
  });

  it('非有限进度抛错', () => {
    expect(() => flareIntensity01(Number.NaN)).toThrow(RangeError);
  });

  it('局部增亮：中心峰值 = 峰值倍数 × 强度，增亮区外为 0', () => {
    expect(flareLocalBoost(0, 1)).toBeCloseTo(3.2, 10);
    expect(flareLocalBoost(0, 0.5)).toBeCloseTo(1.6, 10);
    expect(flareLocalBoost(0.3, 1)).toBe(0);
    expect(flareLocalBoost(0.1, 1)).toBeGreaterThan(0);
    expect(flareLocalBoost(0.1, 1)).toBeLessThan(flareLocalBoost(0.05, 1));
  });

  it('进度计算与时长校验', () => {
    expect(flareProgress01(105, 100, 10)).toBeCloseTo(0.5, 12);
    expect(() => flareProgress01(0, 0, 0)).toThrow(RangeError);
  });

  it('泊松触发：Δt≤0 不触发、概率随 Δt 增大、大跳变被钳制', () => {
    expect(shouldAutoTriggerFlare(0, 0)).toBe(false);
    expect(shouldAutoTriggerFlare(0.5, 0.5, 60)).toBe(false);
    // rand=0 恒触发（p>0）
    expect(shouldAutoTriggerFlare(0, 0.5, 60)).toBe(true);
    // Δt 钳制到 1 天：超大跳变的触发概率与 1 天相同
    const p1 = 1 - Math.exp(-1 / 60);
    expect(shouldAutoTriggerFlare(p1 - 1e-9, 1e9, 60)).toBe(true);
    expect(shouldAutoTriggerFlare(p1 + 1e-9, 1e9, 60)).toBe(false);
    expect(() => shouldAutoTriggerFlare(0.5, 1, 0)).toThrow(RangeError);
  });
});

describe('CME', () => {
  it('耀斑-CME 关联概率随级别递增（X > M > C）', () => {
    expect(cmeLinkProbability('X')).toBeGreaterThan(cmeLinkProbability('M'));
    expect(cmeLinkProbability('M')).toBeGreaterThan(cmeLinkProbability('C'));
  });

  it('速度按级别取值且落在真实量级 250–3,000 km/s', () => {
    for (const cls of ['C', 'M', 'X'] as const) {
      for (const r of [0, 0.5, 1]) {
        const v = cmeSpeedForClass(cls, r);
        expect(v).toBeGreaterThanOrEqual(CME_SPEED_KM_S_MIN);
        expect(v).toBeLessThanOrEqual(CME_SPEED_KM_S_MAX);
      }
    }
    expect(cmeSpeedForClass('X', 0.5)).toBeGreaterThan(cmeSpeedForClass('C', 0.5));
  });

  it('km/s → 场景单位/天 换算正确（1,000 km/s ≈ 5.78 单位/天）', () => {
    const expected = (1000 * 86400 * SCENE_UNITS_PER_AU) / AU_KM;
    expect(kmPerSecToUnitsPerDay(1000)).toBeCloseTo(expected, 10);
    expect(expected).toBeCloseTo(5.775, 2);
    expect(() => kmPerSecToUnitsPerDay(0)).toThrow(RangeError);
  });

  it('壳层匀速扩张 r = r0 + v·t（负时间返回 r0）', () => {
    expect(cmeShellRadiusUnits(2, 3, 5)).toBeCloseTo(11, 12);
    expect(cmeShellRadiusUnits(-1, 3, 5)).toBe(5);
  });

  it('进度/透明度：初期快速浮现，抵达回收边界时归零', () => {
    expect(cmeProgress01(0)).toBe(0);
    expect(cmeProgress01(CME_MAX_RADIUS_UNITS)).toBe(1);
    expect(cmeProgress01(CME_MAX_RADIUS_UNITS * 2)).toBe(1);
    expect(() => cmeProgress01(1, 0)).toThrow(RangeError);
    expect(cmeOpacity01(0)).toBe(0);
    expect(cmeOpacity01(0.04)).toBeGreaterThan(0.9);
    expect(cmeOpacity01(1)).toBe(0);
    expect(cmeOpacity01(0.3)).toBeGreaterThan(cmeOpacity01(0.7));
  });

  it('朝地球判定：夹角小于阈值为 true', () => {
    const earth = { x: 1, y: 0, z: 0 };
    expect(cmeIsEarthDirected({ x: 1, y: 0, z: 0 }, earth)).toBe(true);
    // 20° 偏差 < 25° 阈值
    const near = { x: Math.cos(0.349), y: Math.sin(0.349), z: 0 };
    expect(cmeIsEarthDirected(near, earth)).toBe(true);
    // 40° 偏差 > 25° 阈值
    const far = { x: Math.cos(0.698), y: Math.sin(0.698), z: 0 };
    expect(cmeIsEarthDirected(far, earth)).toBe(false);
    expect(cmeIsEarthDirected({ x: -1, y: 0, z: 0 }, earth)).toBe(false);
  });

  it('锥内粒子方向：确定性、单位矢量、极角 ≤ 半张角', () => {
    const a = cmeConeDirections(64, createSeededRandom(7));
    const b = cmeConeDirections(64, createSeededRandom(7));
    expect(a).toEqual(b);
    const cosHalf = Math.cos((CME_CONE_HALF_ANGLE_DEG * Math.PI) / 180);
    for (let i = 0; i < 64; i += 1) {
      const len = Math.hypot(a[i * 3], a[i * 3 + 1], a[i * 3 + 2]);
      expect(len).toBeCloseTo(1, 6);
      // 锥轴为 +Y：cosθ = y ≥ cos(半张角)
      expect(a[i * 3 + 1]).toBeGreaterThanOrEqual(cosHalf - 1e-6);
    }
    expect(() => cmeConeDirections(0, createSeededRandom(1))).toThrow(RangeError);
  });
});

describe('太阳风（solar wind）', () => {
  it('循环周期 = 行程 / 速度（500 km/s、~21.2 单位 ≈ 7.3 天）', () => {
    const cycle = windCycleDays(2.8);
    expect(cycle).toBeCloseTo((24 - 2.8) / kmPerSecToUnitsPerDay(500), 10);
    expect(() => windCycleDays(30)).toThrow(RangeError);
  });

  it('相位 0-1 循环且负时间补正', () => {
    expect(windPhase01(0, 0.25, 10)).toBeCloseTo(0.25, 12);
    expect(windPhase01(10, 0.25, 10)).toBeCloseTo(0.25, 12);
    expect(windPhase01(-2.5, 0, 10)).toBeCloseTo(0.75, 12);
    expect(() => windPhase01(0, 0, 0)).toThrow(RangeError);
  });

  it('shader 时间回卷是周期的整数倍（回卷零观感差异）', () => {
    const cycle = 7.3;
    const wrap = cycle * 2048;
    const t = wrap * 3 + 11.5;
    expect(windPhase01(windShaderDays(t, cycle), 0.1, cycle)).toBeCloseTo(
      windPhase01(t, 0.1, cycle),
      6,
    );
    expect(windShaderDays(-1, cycle)).toBeGreaterThanOrEqual(0);
    expect(() => windShaderDays(Number.NaN, cycle)).toThrow(RangeError);
    expect(() => windShaderDays(1, 0)).toThrow(RangeError);
  });

  it('粒子透明度：亮度克制（≤0.16）、随相位衰减、近观更明显', () => {
    expect(windParticleAlpha(0, 1)).toBeLessThanOrEqual(0.16);
    expect(windParticleAlpha(0.9, 1)).toBeLessThan(windParticleAlpha(0.1, 1));
    expect(windParticleAlpha(0.5, 1)).toBeGreaterThan(windParticleAlpha(0.5, 0));
    expect(windParticleAlpha(0.5, 0)).toBeGreaterThan(0);
  });
});

describe('日珥 / 日冕环', () => {
  it('演化因子在 0.75–1.25 内缓慢脉动且确定性', () => {
    for (let d = 0; d < 30; d += 0.7) {
      const f = prominenceEvolveFactor(d, 0.3);
      expect(f).toBeGreaterThanOrEqual(0.75 - 1e-9);
      expect(f).toBeLessThanOrEqual(1.25 + 1e-9);
    }
    expect(prominenceEvolveFactor(5, 0.3)).toBe(prominenceEvolveFactor(5, 0.3));
    expect(() => prominenceEvolveFactor(Number.NaN, 0)).toThrow(RangeError);
  });

  it('弧线端点为足点 (±0.5,0)、中点为拱顶 (0,h)', () => {
    const start = loopArcPoint(0, 0.6);
    const mid = loopArcPoint(0.5, 0.6);
    const end = loopArcPoint(1, 0.6);
    expect(start.x).toBeCloseTo(-0.5, 12);
    expect(start.y).toBeCloseTo(0, 12);
    expect(mid.x).toBeCloseTo(0, 12);
    expect(mid.y).toBeCloseTo(0.6, 12);
    expect(end.x).toBeCloseTo(0.5, 12);
    expect(end.y).toBeCloseTo(0, 12);
  });
});

describe('sunActivityStatusLines（信息面板扩展 §4.5）', () => {
  it('无事件时显示平静提示', () => {
    const lines = sunActivityStatusLines(null, null);
    expect(lines).toHaveLength(1);
    expect(lines[0].value).toContain('平静');
  });

  it('活跃耀斑/CME 分别成行，朝地球 CME 附加地磁暴提示', () => {
    const lines = sunActivityStatusLines(
      { class: 'X', magnitude: 2.3 },
      { speedKmS: 1500, earthDirected: true },
    );
    expect(lines).toHaveLength(2);
    expect(lines[0].value).toContain('X2.3');
    expect(lines[1].value).toContain('1500 km/s');
    expect(lines[1].value).toContain('地磁暴');
    const quiet = sunActivityStatusLines(null, { speedKmS: 800, earthDirected: false });
    expect(quiet[0].value).not.toContain('地磁暴');
  });
});
