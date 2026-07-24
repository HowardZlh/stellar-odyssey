/**
 * 太阳表面与日冕纯逻辑测试（S1，IMPROVEMENT_REQUIREMENTS_SOLAR §4.2/§6）
 */

import {
  CHROMOSPHERE_COLOR,
  CHROMOSPHERE_FRESNEL_POWER,
  CHROMOSPHERE_MAX_ALPHA,
  CHROMOSPHERE_SHELL_SCALE,
  CORONA_COLOR,
  CORONA_FALLOFF_K,
  CORONA_QUAD_SCALE,
  CORONA_STREAMER_FREQ,
  CORONA_TIME_RATE,
  GLOW_NEAR_FADE,
  GRANULE_AMP_FAR,
  GRANULE_AMP_NEAR,
  GRANULE_CELL_SCALE,
  GRANULE_OCTAVES,
  GRANULE_PHASE_WRAP,
  GRANULE_TIME_RATE,
  PHOTOSPHERE_BRIGHTNESS_GAIN,
  SUN_EDGE_REDNESS,
  SUN_LIMB_DARKENING_U,
  SUN_SPHERE_SEGMENTS,
  chromosphereRimAlpha,
  coronaIntensity,
  coronaRadialFalloff,
  coronaStreamerFactor,
  granulationAmplitude,
  granulationBrightness,
  granulationPhase,
  spriteGlowOpacity,
} from '@/utils/sunSurface';
import { limbDarkening } from '@/utils/stellarSurface';

describe('米粒组织（granulation，§4.2 光球层）', () => {
  it('调制幅度随近观细节强度从远观值线性插值到近观值', () => {
    expect(granulationAmplitude(0)).toBeCloseTo(GRANULE_AMP_FAR, 10);
    expect(granulationAmplitude(1)).toBeCloseTo(GRANULE_AMP_NEAR, 10);
    expect(granulationAmplitude(0.5)).toBeCloseTo((GRANULE_AMP_FAR + GRANULE_AMP_NEAR) / 2, 10);
    // 越界钳制
    expect(granulationAmplitude(-1)).toBeCloseTo(GRANULE_AMP_FAR, 10);
    expect(granulationAmplitude(2)).toBeCloseTo(GRANULE_AMP_NEAR, 10);
  });

  it('亮度乘数：胞中心（fbm 高）亮、胞边界（fbm 低）暗，中值不变', () => {
    const amp = granulationAmplitude(1);
    expect(granulationBrightness(1, amp)).toBeGreaterThan(1);
    expect(granulationBrightness(0, amp)).toBeLessThan(1);
    expect(granulationBrightness(0.5, amp)).toBeCloseTo(1, 10);
  });

  it('亮度乘数钳制在 [0.6, 1.4] 防过曝/过暗', () => {
    expect(granulationBrightness(1, 10)).toBe(1.4);
    expect(granulationBrightness(0, 10)).toBe(0.6);
  });

  it('演化相位随模拟时间单调推进并在回卷周期内', () => {
    const p1 = granulationPhase(10);
    const p2 = granulationPhase(20);
    expect(p1).toBeCloseTo((10 * GRANULE_TIME_RATE) % GRANULE_PHASE_WRAP, 10);
    expect(p2).toBeGreaterThan(p1);
    for (const days of [0, 1, 1e6, 1e12]) {
      const p = granulationPhase(days);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThan(GRANULE_PHASE_WRAP);
    }
  });

  it('相位对负时间（时间倒退）仍归一到 [0, WRAP)', () => {
    const p = granulationPhase(-1);
    expect(p).toBeGreaterThanOrEqual(0);
    expect(p).toBeLessThan(GRANULE_PHASE_WRAP);
  });

  it('非法模拟时间抛出 RangeError', () => {
    expect(() => granulationPhase(Number.NaN)).toThrow(RangeError);
    expect(() => granulationPhase(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe('临边昏暗与光球常量（§4.2）', () => {
  it('太阳 V 波段线性系数 u=0.6（Cox 2000），与 stellarSurface 共用公式', () => {
    expect(SUN_LIMB_DARKENING_U).toBe(0.6);
    // 盘面中心全亮、边缘按 1−u 衰减
    expect(limbDarkening(1, SUN_LIMB_DARKENING_U)).toBeCloseTo(1, 10);
    expect(limbDarkening(0, SUN_LIMB_DARKENING_U)).toBeCloseTo(0.4, 10);
  });

  it('中心亮度增益适度（>1 补偿临边昏暗，≤1.4 防 Bloom 过曝）', () => {
    expect(PHOTOSPHERE_BRIGHTNESS_GAIN).toBeGreaterThan(1);
    expect(PHOTOSPHERE_BRIGHTNESS_GAIN).toBeLessThanOrEqual(1.4);
  });

  it('球体分段数提升至近观平滑水平（≥64）', () => {
    expect(SUN_SPHERE_SEGMENTS).toBeGreaterThanOrEqual(64);
  });

  it('shader 常量在合理区间：边缘偏红克制、米粒频率为正、fBm 与 GLSL 固定 4 层一致', () => {
    expect(SUN_EDGE_REDNESS).toBeGreaterThan(0);
    expect(SUN_EDGE_REDNESS).toBeLessThanOrEqual(0.5);
    expect(GRANULE_CELL_SCALE).toBeGreaterThan(0);
    expect(GRANULE_OCTAVES).toBe(4);
  });
});

describe('色球边缘红环（§4.2 色球层）', () => {
  it('透明度集中于临边：中心（μ=1）为 0，边缘（μ=0）达峰值', () => {
    expect(chromosphereRimAlpha(1, 1)).toBeCloseTo(0, 10);
    expect(chromosphereRimAlpha(0, 1)).toBeCloseTo(CHROMOSPHERE_MAX_ALPHA, 10);
  });

  it('透明度随 μ 单调递减（红环向盘面中心快速衰减）', () => {
    let prev = chromosphereRimAlpha(0, 1);
    for (let mu = 0.1; mu <= 1; mu += 0.1) {
      const a = chromosphereRimAlpha(mu, 1);
      expect(a).toBeLessThanOrEqual(prev);
      prev = a;
    }
  });

  it('远观（细节强度 0）完全不可见，随强度线性淡入', () => {
    expect(chromosphereRimAlpha(0, 0)).toBe(0);
    expect(chromosphereRimAlpha(0, 0.5)).toBeCloseTo(CHROMOSPHERE_MAX_ALPHA * 0.5, 10);
  });

  it('壳层放大登记：倍率 >1 且 ≤1.05（克制的视觉夸大）', () => {
    expect(CHROMOSPHERE_SHELL_SCALE).toBeGreaterThan(1);
    expect(CHROMOSPHERE_SHELL_SCALE).toBeLessThanOrEqual(1.05);
  });

  it('色球颜色为氢α红色（R 显著高于 G/B）', () => {
    expect(CHROMOSPHERE_COLOR.r).toBeGreaterThan(CHROMOSPHERE_COLOR.g * 2);
    expect(CHROMOSPHERE_COLOR.r).toBeGreaterThan(CHROMOSPHERE_COLOR.b * 2);
  });
});

describe('结构化日冕（§4.2 日冕）', () => {
  it('径向衰减：日面内为 1，日面外随距离单调递减趋近 0', () => {
    expect(coronaRadialFalloff(0.5)).toBe(1);
    expect(coronaRadialFalloff(1)).toBe(1);
    let prev = coronaRadialFalloff(1);
    for (let r = 1.2; r <= CORONA_QUAD_SCALE / 2; r += 0.4) {
      const f = coronaRadialFalloff(r);
      expect(f).toBeLessThan(prev);
      prev = f;
    }
    expect(coronaRadialFalloff(CORONA_QUAD_SCALE / 2)).toBeLessThan(0.01);
  });

  it('非法径向距离抛出 RangeError', () => {
    expect(() => coronaRadialFalloff(-1)).toThrow(RangeError);
    expect(() => coronaRadialFalloff(Number.NaN)).toThrow(RangeError);
  });

  it('冕流因子：赤道方向（|y|=0）强于极区（|y|=1）', () => {
    const equator = coronaStreamerFactor(0, 0.5);
    const pole = coronaStreamerFactor(1, 0.5);
    expect(equator).toBeGreaterThan(pole * 2);
  });

  it('冕流因子随角向噪声增强（条纹明暗差异）', () => {
    expect(coronaStreamerFactor(0, 1)).toBeGreaterThan(coronaStreamerFactor(0, 0));
  });

  it('综合亮度：远观（强度 0）为 0——结构化日冕仅近观淡入', () => {
    expect(coronaIntensity(1.5, 0, 0.5, 0)).toBe(0);
    expect(coronaIntensity(1.5, 0, 0.5, 1)).toBeGreaterThan(0);
  });

  it('综合亮度随近观强度线性缩放', () => {
    const half = coronaIntensity(1.2, 0.3, 0.5, 0.5);
    const full = coronaIntensity(1.2, 0.3, 0.5, 1);
    expect(half).toBeCloseTo(full / 2, 10);
  });

  it('日冕常量在合理区间：衰减/频率为正、演化远慢于米粒、颜色为暖白', () => {
    expect(CORONA_FALLOFF_K).toBeGreaterThan(0);
    expect(CORONA_STREAMER_FREQ).toBeGreaterThan(0);
    expect(CORONA_TIME_RATE).toBeGreaterThan(0);
    expect(CORONA_TIME_RATE).toBeLessThan(1);
    expect(CORONA_COLOR.r).toBeGreaterThanOrEqual(CORONA_COLOR.g);
    expect(CORONA_COLOR.g).toBeGreaterThanOrEqual(CORONA_COLOR.b);
    expect(CHROMOSPHERE_FRESNEL_POWER).toBeGreaterThan(1);
  });
});

describe('分级呈现混合（§4.2 日冕分级 + 远观观感保持）', () => {
  it('sprite 光晕远观全强度（与升级前观感一致）', () => {
    expect(spriteGlowOpacity(0)).toBe(1);
  });

  it('近观收敛让位结构化日冕且保持可见（0 < opacity < 1）', () => {
    const near = spriteGlowOpacity(1);
    expect(near).toBeCloseTo(1 - GLOW_NEAR_FADE, 10);
    expect(near).toBeGreaterThan(0);
  });

  it('随强度单调递减（平滑无突变）', () => {
    let prev = spriteGlowOpacity(0);
    for (let s = 0.2; s <= 1; s += 0.2) {
      const o = spriteGlowOpacity(s);
      expect(o).toBeLessThan(prev);
      prev = o;
    }
  });
});
