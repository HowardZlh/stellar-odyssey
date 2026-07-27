/**
 * 太阳活动真实度提升单测（S4，IMPROVEMENT_REQUIREMENTS_SOLAR §4.7 / §7-S4）：
 * 核心档——
 * - B1 双带耀斑（flareRibbonBoost）：沿磁中性线两侧带状增亮（two-ribbon）
 * - E2 活动区磁环族（coronalLoopCountForGroup / 环拱偏移 / 高度包络）
 * 进阶档——
 * - C1 CME 三分量（cmeParticleLayer/cmeLayerRadialFactor/cmeLayerBrightness）
 * - C2 CME 加速段（cmeAcceleratedElapsedDays）
 * - D1 帕克螺旋（parkerSpiralOffsetRad/parkerWindingTurns）
 * - B3 耀斑后环（postFlareLoopStrength01）
 * 精修档——
 * - B2 多峰光变（flareMultiPeakIntensity01）
 * - D2 快慢风交界 CIR（cirBrightnessFactor）
 * - E1 日珥纤维（prominenceFibrilFactor/prominenceIsActive）
 * 不破坏 S2/S3 既有耀斑/CME/日冕环行为（既有套件覆盖）。
 */

import {
  CIR_BRIGHTNESS_GAIN,
  CME_ACCEL_FRACTION,
  CME_LAYER_THRESHOLDS,
  CORONAL_LOOP_MAX,
  CORONAL_LOOP_MAX_PER_GROUP,
  FLARE_BRIGHTNESS_BOOST,
  FLARE_IMPULSIVE_FRACTION,
  FLARE_IMPULSIVE_PEAK,
  FLARE_MAIN_PEAK_AT,
  FLARE_RIBBON_HALF_WIDTH_RAD,
  FLARE_RIBBON_OFFSET_RAD,
  POST_FLARE_LOOP_START,
  PROMINENCE_ACTIVE_FIBRIL_AMP,
  PROMINENCE_QUIET_FIBRIL_AMP,
  SUN_ROTATION_RAD_PER_DAY,
  WIND_FAST_CONE_RAD,
  cirBrightnessFactor,
  cmeAcceleratedElapsedDays,
  cmeLayerBrightness,
  cmeLayerRadialFactor,
  cmeParticleLayer,
  coronalLoopArcadeHeightScale,
  coronalLoopArcadeOffset,
  coronalLoopCountForGroup,
  flareMultiPeakIntensity01,
  flareRibbonBoost,
  parkerSpiralOffsetRad,
  parkerWindingTurns,
  postFlareLoopStrength01,
  prominenceFibrilFactor,
  prominenceIsActive,
} from '@/utils/solarActivity';

describe('flareRibbonBoost（B1 双带耀斑）', () => {
  it('沿带端外（alongFrac 越界）无增亮', () => {
    expect(flareRibbonBoost(FLARE_RIBBON_OFFSET_RAD, -0.1, 1)).toBe(0);
    expect(flareRibbonBoost(FLARE_RIBBON_OFFSET_RAD, 1.1, 1)).toBe(0);
  });

  it('强度 0 无增亮', () => {
    expect(flareRibbonBoost(FLARE_RIBBON_OFFSET_RAD, 0.5, 0)).toBe(0);
  });

  it('两条带中心（±偏移）处峰值最强', () => {
    const atRibbon = flareRibbonBoost(FLARE_RIBBON_OFFSET_RAD, 0.5, 1);
    const atOtherRibbon = flareRibbonBoost(-FLARE_RIBBON_OFFSET_RAD, 0.5, 1);
    // 两条带对称，峰值相等且为正
    expect(atRibbon).toBeGreaterThan(0);
    expect(atOtherRibbon).toBeCloseTo(atRibbon, 6);
  });

  it('中性线正中（perp=0，两带之间）弱于带心', () => {
    const atCenter = flareRibbonBoost(0, 0.5, 1);
    const atRibbon = flareRibbonBoost(FLARE_RIBBON_OFFSET_RAD, 0.5, 1);
    expect(atCenter).toBeLessThan(atRibbon);
  });

  it('横向超出带半宽无增亮', () => {
    const far = FLARE_RIBBON_OFFSET_RAD + FLARE_RIBBON_HALF_WIDTH_RAD + 0.01;
    expect(flareRibbonBoost(far, 0.5, 1)).toBe(0);
  });

  it('峰值不超过 FLARE_BRIGHTNESS_BOOST', () => {
    let peak = 0;
    for (let perp = -0.15; perp <= 0.15; perp += 0.002) {
      for (let along = 0; along <= 1; along += 0.05) {
        peak = Math.max(peak, flareRibbonBoost(perp, along, 1));
      }
    }
    expect(peak).toBeGreaterThan(0);
    expect(peak).toBeLessThanOrEqual(FLARE_BRIGHTNESS_BOOST + 1e-6);
  });

  it('沿带方向中点（alongFrac=0.5）强于两端', () => {
    const mid = flareRibbonBoost(FLARE_RIBBON_OFFSET_RAD, 0.5, 1);
    const end = flareRibbonBoost(FLARE_RIBBON_OFFSET_RAD, 0.02, 1);
    expect(mid).toBeGreaterThan(end);
  });

  it('增亮随强度线性缩放', () => {
    const full = flareRibbonBoost(FLARE_RIBBON_OFFSET_RAD, 0.5, 1);
    const half = flareRibbonBoost(FLARE_RIBBON_OFFSET_RAD, 0.5, 0.5);
    expect(half).toBeCloseTo(full * 0.5, 6);
  });
});

describe('coronalLoopCountForGroup（E2 磁环族环数）', () => {
  it('单极群（1 颗）→ 1 环', () => {
    expect(coronalLoopCountForGroup(1)).toBe(1);
    expect(coronalLoopCountForGroup(0)).toBe(1);
  });

  it('双极群（2 颗）→ 2 环', () => {
    expect(coronalLoopCountForGroup(2)).toBe(2);
  });

  it('复杂群按颗数增至上限', () => {
    expect(coronalLoopCountForGroup(3)).toBe(3);
    expect(coronalLoopCountForGroup(4)).toBe(4);
    expect(coronalLoopCountForGroup(10)).toBe(CORONAL_LOOP_MAX_PER_GROUP);
  });

  it('单群环数不超过 CORONAL_LOOP_MAX_PER_GROUP', () => {
    for (let n = 1; n <= 8; n += 1) {
      expect(coronalLoopCountForGroup(n)).toBeLessThanOrEqual(CORONAL_LOOP_MAX_PER_GROUP);
    }
  });

  it('非有限输入退化为 1 环', () => {
    expect(coronalLoopCountForGroup(Number.NaN)).toBe(1);
  });
});

describe('coronalLoopArcadeOffset（E2 环拱横向铺开）', () => {
  it('单环居中（0）', () => {
    expect(coronalLoopArcadeOffset(0, 1)).toBe(0);
  });

  it('多环端点为 ±1、中央趋 0', () => {
    expect(coronalLoopArcadeOffset(0, 3)).toBeCloseTo(-1, 6);
    expect(coronalLoopArcadeOffset(2, 3)).toBeCloseTo(1, 6);
    expect(coronalLoopArcadeOffset(1, 3)).toBeCloseTo(0, 6);
  });

  it('偏移沿序号单调递增', () => {
    let prev = -Infinity;
    for (let i = 0; i < 4; i += 1) {
      const o = coronalLoopArcadeOffset(i, 4);
      expect(o).toBeGreaterThan(prev);
      prev = o;
    }
  });

  it('偏移分数落在 [-1, 1]', () => {
    for (let count = 1; count <= CORONAL_LOOP_MAX_PER_GROUP; count += 1) {
      for (let i = 0; i < count; i += 1) {
        const o = coronalLoopArcadeOffset(i, count);
        expect(o).toBeGreaterThanOrEqual(-1);
        expect(o).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('coronalLoopArcadeHeightScale（E2 环拱高度包络）', () => {
  it('单环高度为 1', () => {
    expect(coronalLoopArcadeHeightScale(0, 1)).toBe(1);
  });

  it('中央环最高、两侧略矮（拱形）', () => {
    const left = coronalLoopArcadeHeightScale(0, 3);
    const mid = coronalLoopArcadeHeightScale(1, 3);
    const right = coronalLoopArcadeHeightScale(2, 3);
    expect(mid).toBeGreaterThan(left);
    expect(mid).toBeGreaterThan(right);
    expect(left).toBeCloseTo(right, 6);
  });

  it('高度缩放落在 (0, 1]', () => {
    for (let count = 1; count <= CORONAL_LOOP_MAX_PER_GROUP; count += 1) {
      for (let i = 0; i < count; i += 1) {
        const h = coronalLoopArcadeHeightScale(i, count);
        expect(h).toBeGreaterThan(0);
        expect(h).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('磁环族池预算（E2 ≤ CORONAL_LOOP_MAX）', () => {
  it('5 群 × 最多每群环数不超过池上限', () => {
    // 最坏情况：所有 5 群均为复杂群满环
    const worst = 5 * CORONAL_LOOP_MAX_PER_GROUP;
    expect(worst).toBe(CORONAL_LOOP_MAX);
  });
});

// ---------------------------------------------------------------------------
// 进阶档
// ---------------------------------------------------------------------------

describe('cmeAcceleratedElapsedDays（C2 加速段运动学）', () => {
  const total = 10;
  const ta = CME_ACCEL_FRACTION * total;

  it('非正时刻返回 0，非法总时长抛错', () => {
    expect(cmeAcceleratedElapsedDays(0, total)).toBe(0);
    expect(cmeAcceleratedElapsedDays(-1, total)).toBe(0);
    expect(() => cmeAcceleratedElapsedDays(1, 0)).toThrow(RangeError);
    expect(() => cmeAcceleratedElapsedDays(1, -5)).toThrow(RangeError);
  });

  it('加速段内等效时间 = t²/(2ta)（匀加速位移）', () => {
    const t = ta * 0.5;
    expect(cmeAcceleratedElapsedDays(t, total)).toBeCloseTo((t * t) / (2 * ta), 10);
  });

  it('加速段末与匀速段接续连续（teff 连续）', () => {
    const eps = 1e-9;
    const before = cmeAcceleratedElapsedDays(ta - eps, total);
    const after = cmeAcceleratedElapsedDays(ta + eps, total);
    expect(Math.abs(after - before)).toBeLessThan(1e-6);
    // 加速段末等效时间 = ta/2
    expect(cmeAcceleratedElapsedDays(ta, total)).toBeCloseTo(ta / 2, 10);
  });

  it('匀速段等效时间线性推进且始终滞后于无加速情形', () => {
    const t1 = ta * 2;
    const t2 = ta * 3;
    const e1 = cmeAcceleratedElapsedDays(t1, total);
    const e2 = cmeAcceleratedElapsedDays(t2, total);
    expect(e2 - e1).toBeCloseTo(t2 - t1, 10);
    expect(e1).toBeLessThan(t1); // 加速段耗时导致总位移滞后
  });

  it('等效时间随实际时间单调递增', () => {
    let prev = -1;
    for (let t = 0; t <= total; t += total / 40) {
      const e = cmeAcceleratedElapsedDays(t, total);
      expect(e).toBeGreaterThanOrEqual(prev);
      prev = e;
    }
  });
});

describe('cmeParticleLayer / cmeLayerRadialFactor / cmeLayerBrightness（C1 三分量）', () => {
  it('按阈值分层：核 / 腔 / 前沿', () => {
    expect(cmeParticleLayer(0)).toBe(0);
    expect(cmeParticleLayer(CME_LAYER_THRESHOLDS.core - 1e-6)).toBe(0);
    expect(cmeParticleLayer(CME_LAYER_THRESHOLDS.core)).toBe(1);
    expect(cmeParticleLayer(CME_LAYER_THRESHOLDS.cavity - 1e-6)).toBe(1);
    expect(cmeParticleLayer(CME_LAYER_THRESHOLDS.cavity)).toBe(2);
    expect(cmeParticleLayer(0.999)).toBe(2);
  });

  it('输入越界钳制', () => {
    expect(cmeParticleLayer(-1)).toBe(0);
    expect(cmeParticleLayer(2)).toBe(2);
  });

  it('径向位置分层：核最内 < 腔中层 < 前沿最外（区间不倒置）', () => {
    for (let j = 0; j <= 1; j += 0.25) {
      const core = cmeLayerRadialFactor(0, j);
      const cavity = cmeLayerRadialFactor(1, j);
      const front = cmeLayerRadialFactor(2, j);
      expect(core).toBeGreaterThan(0);
      expect(front).toBeLessThanOrEqual(1);
      expect(core).toBeLessThan(cavity + 1e-9);
      expect(cavity).toBeLessThan(front + 1e-9);
    }
  });

  it('亮度分层：暗腔显著暗于亮前沿与亮核', () => {
    expect(cmeLayerBrightness(1)).toBeLessThan(cmeLayerBrightness(0));
    expect(cmeLayerBrightness(1)).toBeLessThan(cmeLayerBrightness(2));
    expect(cmeLayerBrightness(2)).toBeGreaterThanOrEqual(cmeLayerBrightness(0));
  });
});

describe('parkerSpiralOffsetRad / parkerWindingTurns（D1 帕克螺旋）', () => {
  it('相位 0 无偏转、相位 1 偏转 −2π×圈数、随相位单调负向增大', () => {
    const turns = 0.4;
    expect(parkerSpiralOffsetRad(0, turns)).toBeCloseTo(0, 12);
    expect(parkerSpiralOffsetRad(1, turns)).toBeCloseTo(-turns * Math.PI * 2, 10);
    expect(parkerSpiralOffsetRad(0.7, turns)).toBeLessThan(parkerSpiralOffsetRad(0.3, turns));
  });

  it('相位越界钳制', () => {
    expect(parkerSpiralOffsetRad(-1, 1)).toBeCloseTo(0, 12);
    expect(parkerSpiralOffsetRad(2, 1)).toBeCloseTo(-Math.PI * 2, 10);
  });

  it('缠绕圈数 = Ω × 抵达时长 / 2π', () => {
    const r0 = 1;
    const rMax = 25;
    const speed = 3; // units/day
    const travel = (rMax - r0) / speed;
    expect(parkerWindingTurns(r0, rMax, speed)).toBeCloseTo(
      (SUN_ROTATION_RAD_PER_DAY * travel) / (Math.PI * 2),
      10,
    );
  });

  it('非法输入抛错', () => {
    expect(() => parkerWindingTurns(5, 5, 1)).toThrow(RangeError);
    expect(() => parkerWindingTurns(1, 10, 0)).toThrow(RangeError);
  });
});

describe('postFlareLoopStrength01（B3 耀斑后环）', () => {
  it('峰前与事件结束后为 0', () => {
    expect(postFlareLoopStrength01(0)).toBe(0);
    expect(postFlareLoopStrength01(POST_FLARE_LOOP_START)).toBe(0);
    expect(postFlareLoopStrength01(1)).toBe(0);
    expect(postFlareLoopStrength01(1.2)).toBe(0);
  });

  it('峰后快速拱起达到峰值 1', () => {
    const peakT = POST_FLARE_LOOP_START + (1 - POST_FLARE_LOOP_START) * 0.3;
    expect(postFlareLoopStrength01(peakT)).toBeCloseTo(1, 6);
    // 拱起段单调上升
    const early = postFlareLoopStrength01(POST_FLARE_LOOP_START + 0.02);
    expect(early).toBeGreaterThan(0);
    expect(early).toBeLessThan(1);
  });

  it('峰后缓慢消退且事件末平滑归零（无跳变）', () => {
    const peakT = POST_FLARE_LOOP_START + (1 - POST_FLARE_LOOP_START) * 0.3;
    const late = postFlareLoopStrength01(0.95);
    expect(late).toBeLessThan(postFlareLoopStrength01(peakT));
    // 事件末趋近 0
    expect(postFlareLoopStrength01(0.999)).toBeLessThan(0.01);
  });
});

// ---------------------------------------------------------------------------
// 精修档
// ---------------------------------------------------------------------------

describe('flareMultiPeakIntensity01（B2 多峰光变）', () => {
  it('事件外为 0，非有限抛错', () => {
    expect(flareMultiPeakIntensity01(0)).toBe(0);
    expect(flareMultiPeakIntensity01(1)).toBe(0);
    expect(flareMultiPeakIntensity01(-0.5)).toBe(0);
    expect(() => flareMultiPeakIntensity01(Number.NaN)).toThrow(RangeError);
  });

  it('脉冲相尖峰：t=脉冲相中心处达到脉冲峰值', () => {
    expect(flareMultiPeakIntensity01(FLARE_IMPULSIVE_FRACTION)).toBeCloseTo(
      FLARE_IMPULSIVE_PEAK,
      6,
    );
  });

  it('主峰位于 FLARE_MAIN_PEAK_AT 且为全局最大 1', () => {
    expect(flareMultiPeakIntensity01(FLARE_MAIN_PEAK_AT)).toBeCloseTo(1, 6);
    let maxV = 0;
    for (let t = 0.001; t < 1; t += 0.001) {
      maxV = Math.max(maxV, flareMultiPeakIntensity01(t));
    }
    expect(maxV).toBeLessThanOrEqual(1 + 1e-9);
  });

  it('多峰形态：脉冲峰与主峰之间存在回落（两个局部极大）', () => {
    const impulsive = flareMultiPeakIntensity01(FLARE_IMPULSIVE_FRACTION);
    const main = flareMultiPeakIntensity01(FLARE_MAIN_PEAK_AT);
    // 扫描两峰之间的最低点（回落谷）
    let dip = Infinity;
    for (let t = FLARE_IMPULSIVE_FRACTION; t <= FLARE_MAIN_PEAK_AT; t += 0.002) {
      dip = Math.min(dip, flareMultiPeakIntensity01(t));
    }
    expect(dip).toBeLessThan(impulsive);
    expect(dip).toBeLessThan(main);
  });

  it('主峰后指数余辉单调衰减', () => {
    let prev = flareMultiPeakIntensity01(FLARE_MAIN_PEAK_AT);
    for (let t = FLARE_MAIN_PEAK_AT + 0.05; t < 1; t += 0.05) {
      const v = flareMultiPeakIntensity01(t);
      expect(v).toBeLessThanOrEqual(prev + 1e-9);
      prev = v;
    }
  });
});

describe('cirBrightnessFactor（D2 快慢风交界 CIR）', () => {
  it('远离交界带为 1（无增强）', () => {
    expect(cirBrightnessFactor(1)).toBe(1); // 冕洞中心（快风核）
    expect(cirBrightnessFactor(-1)).toBe(1); // 对侧（纯慢风）
  });

  it('交界带中心（冕洞锥缘）增强最大且不超上限', () => {
    const atEdge = cirBrightnessFactor(Math.cos(WIND_FAST_CONE_RAD));
    expect(atEdge).toBeCloseTo(1 + CIR_BRIGHTNESS_GAIN, 6);
    for (let c = -1; c <= 1; c += 0.01) {
      const v = cirBrightnessFactor(c);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(1 + CIR_BRIGHTNESS_GAIN + 1e-9);
    }
  });

  it('输入越界钳制不抛错', () => {
    expect(cirBrightnessFactor(2)).toBe(1);
    expect(cirBrightnessFactor(-2)).toBe(1);
  });
});

describe('prominenceFibrilFactor / prominenceIsActive（E1 日珥纤维）', () => {
  it('调制因子非负且围绕 1 波动（幅度受限）', () => {
    for (let t = 0; t <= 1; t += 0.05) {
      for (const active of [false, true]) {
        const amp = active ? PROMINENCE_ACTIVE_FIBRIL_AMP : PROMINENCE_QUIET_FIBRIL_AMP;
        const v = prominenceFibrilFactor(t, 0.5, active);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1 + amp + 1e-9);
      }
    }
  });

  it('活动日珥纤维幅度大于宁静日珥（同相位对比波动范围）', () => {
    let quietRange = 0;
    let activeRange = 0;
    for (let t = 0; t <= 1; t += 0.01) {
      quietRange = Math.max(quietRange, Math.abs(prominenceFibrilFactor(t, 0.5, false) - 1));
      activeRange = Math.max(activeRange, Math.abs(prominenceFibrilFactor(t, 0.5, true) - 1));
    }
    expect(activeRange).toBeGreaterThan(quietRange);
  });

  it('不同噪声产生不同细丝相位', () => {
    expect(prominenceFibrilFactor(0.3, 0.1, true)).not.toBeCloseTo(
      prominenceFibrilFactor(0.3, 0.9, true),
      6,
    );
  });

  it('日珥类型按种子确定性判定', () => {
    expect(prominenceIsActive(0.2)).toBe(false);
    expect(prominenceIsActive(0.7)).toBe(true);
    expect(prominenceIsActive(0.7)).toBe(prominenceIsActive(0.7));
  });
});
