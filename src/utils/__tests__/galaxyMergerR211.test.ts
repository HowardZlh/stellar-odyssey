/**
 * R2-11 银河系—仙女座碰撞合并后续演化单测
 *
 * 覆盖：签名分离距离曲线（首次穿越/回摆/终态归零）、振荡包络、
 * 形态插值、星暴亮度曲线、潮汐扭曲、阶段状态机、场景单位同源换算、
 * 确定性/时间可逆语义。
 */

import {
  MERGER_ELLIPTICAL_END_MYR,
  MERGER_ELLIPTICAL_START_MYR,
  MERGER_FATE_NOTE_ZH,
  MERGER_SOURCE_NOTE_ZH,
  MERGER_OSC_AMPLITUDE_LY,
  MERGER_OSC_DECAY_PER_MYR,
  MERGER_OSC_PERIOD_MYR,
  MERGER_STARBURST_WEIGHTS,
  MERGER_T0_MYR,
  MERGER_TIDAL_ONSET_LY,
  mergerEllipticalMix01,
  mergerNoticeZh,
  mergerOscillationEnvelopeLy,
  mergerStage,
  mergerStageLabelZh,
  mergerStarburst01,
  mergerTauMyr,
  mergerTidalDistortion01,
  mwM31SignedSeparationLy,
  mwM31SignedSeparationSceneUnits,
} from '@/utils/galaxyMerger';
import { DAYS_PER_MYR } from '@/utils/galaxy';
import { cosmicDistanceToSceneUnits } from '@/utils/scale';
import {
  MW_M31_INITIAL_SEPARATION_LY,
  mwM31ApproachSeparationLy,
  mwM31SeparationLy,
} from '@/utils/universe';

/** τ（T0 后百万年）→ 模拟天 */
function tauToDays(tauMyr: number): number {
  return (MERGER_T0_MYR + tauMyr) * DAYS_PER_MYR;
}

describe('mergerTauMyr', () => {
  it('T0 处为 0，前后符号正确', () => {
    expect(mergerTauMyr(tauToDays(0))).toBeCloseTo(0, 9);
    expect(mergerTauMyr(tauToDays(-100))).toBeCloseTo(-100, 6);
    expect(mergerTauMyr(tauToDays(250))).toBeCloseTo(250, 6);
  });

  it('非有限输入抛 RangeError', () => {
    expect(() => mergerTauMyr(Number.NaN)).toThrow(RangeError);
    expect(() => mergerTauMyr(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe('mwM31SignedSeparationLy（分离距离曲线）', () => {
  it('合并前与接近曲线同源（正值一侧）', () => {
    expect(mwM31SignedSeparationLy(0)).toBeCloseTo(MW_M31_INITIAL_SEPARATION_LY, 6);
    const at1000 = tauToDays(-3500);
    expect(mwM31SignedSeparationLy(at1000)).toBeCloseTo(
      mwM31ApproachSeparationLy(at1000),
      6,
    );
    expect(mwM31SignedSeparationLy(at1000)).toBeGreaterThan(0);
  });

  it('T0 处连续过零（穿越而非停滞）', () => {
    expect(Math.abs(mwM31SignedSeparationLy(tauToDays(-0.01)))).toBeLessThan(100);
    expect(Math.abs(mwM31SignedSeparationLy(tauToDays(0)))).toBeLessThan(1e-6);
    expect(Math.abs(mwM31SignedSeparationLy(tauToDays(0.01)))).toBeLessThan(100);
  });

  it('首次穿越后 M31 越过原点到另一侧（负值）并减速远离', () => {
    const s10 = mwM31SignedSeparationLy(tauToDays(10));
    const s30 = mwM31SignedSeparationLy(tauToDays(30));
    expect(s10).toBeLessThan(0);
    expect(s30).toBeLessThan(s10); // 继续远离（更负）
    // 远离速率递减（减速）：|s30−s10| 段均速 < |s10−0| 段均速
    const v1 = Math.abs(s10) / 10;
    const v2 = Math.abs(s30 - s10) / 20;
    expect(v2).toBeLessThan(v1);
  });

  it('回摆振荡：半周期整数倍处过零，往返减幅', () => {
    const half = MERGER_OSC_PERIOD_MYR / 2;
    expect(Math.abs(mwM31SignedSeparationLy(tauToDays(half)))).toBeLessThan(1);
    expect(Math.abs(mwM31SignedSeparationLy(tauToDays(2 * half)))).toBeLessThan(1);
    // 第一摆（负侧）与第二摆（正侧）极值：幅度衰减、方向相反
    const swing1 = mwM31SignedSeparationLy(tauToDays(34));
    const swing2 = mwM31SignedSeparationLy(tauToDays(34 + half));
    expect(swing1).toBeLessThan(0);
    expect(swing2).toBeGreaterThan(0);
    expect(Math.abs(swing2)).toBeLessThan(Math.abs(swing1));
    // 首摆幅度在登记量级（≈1e5 光年，van der Marel 首次远心点量级）
    expect(Math.abs(swing1)).toBeGreaterThan(0.5e5);
    expect(Math.abs(swing1)).toBeLessThan(MERGER_OSC_AMPLITUDE_LY);
  });

  it('终态过渡完成后严格归零（核心并合）', () => {
    expect(mwM31SignedSeparationLy(tauToDays(MERGER_ELLIPTICAL_END_MYR))).toBe(0);
    expect(mwM31SignedSeparationLy(tauToDays(1000))).toBe(0);
    expect(Math.abs(mwM31SignedSeparationLy(tauToDays(10000)))).toBe(0);
  });

  it('与旧非负距离函数的合并前语义一致', () => {
    for (const tau of [-4500, -2000, -500, -1]) {
      const d = tauToDays(tau);
      expect(mwM31SignedSeparationLy(d)).toBeCloseTo(mwM31SeparationLy(d), 6);
    }
  });
});

describe('mergerOscillationEnvelopeLy（振荡包络）', () => {
  it('τ=0 为满幅，单调递减', () => {
    expect(mergerOscillationEnvelopeLy(0)).toBeCloseTo(MERGER_OSC_AMPLITUDE_LY, 6);
    let prev = mergerOscillationEnvelopeLy(0);
    for (let tau = 20; tau <= 400; tau += 20) {
      const e = mergerOscillationEnvelopeLy(tau);
      expect(e).toBeLessThan(prev);
      prev = e;
    }
  });

  it('每半周期衰减到 45%（阻尼登记值）', () => {
    const half = MERGER_OSC_PERIOD_MYR / 2;
    const ratio =
      mergerOscillationEnvelopeLy(half) / mergerOscillationEnvelopeLy(0);
    expect(ratio).toBeCloseTo(0.45, 6);
    expect(MERGER_OSC_DECAY_PER_MYR).toBeGreaterThan(0);
  });

  it('τ < 0 按满幅计；非有限输入抛 RangeError', () => {
    expect(mergerOscillationEnvelopeLy(-100)).toBeCloseTo(MERGER_OSC_AMPLITUDE_LY, 6);
    expect(() => mergerOscillationEnvelopeLy(Number.NaN)).toThrow(RangeError);
  });
});

describe('mergerEllipticalMix01（形态插值）', () => {
  it('过渡窗口前为 0、后为 1，中点 0.5（smoothstep）', () => {
    expect(mergerEllipticalMix01(tauToDays(-1000))).toBe(0);
    expect(mergerEllipticalMix01(tauToDays(MERGER_ELLIPTICAL_START_MYR))).toBe(0);
    expect(mergerEllipticalMix01(tauToDays(MERGER_ELLIPTICAL_END_MYR))).toBe(1);
    expect(mergerEllipticalMix01(tauToDays(10000))).toBe(1);
    const mid = (MERGER_ELLIPTICAL_START_MYR + MERGER_ELLIPTICAL_END_MYR) / 2;
    expect(mergerEllipticalMix01(tauToDays(mid))).toBeCloseTo(0.5, 9);
  });

  it('过渡窗口内单调递增且值域 [0,1]', () => {
    let prev = -1;
    for (
      let tau = MERGER_ELLIPTICAL_START_MYR;
      tau <= MERGER_ELLIPTICAL_END_MYR;
      tau += 10
    ) {
      const m = mergerEllipticalMix01(tauToDays(tau));
      expect(m).toBeGreaterThanOrEqual(0);
      expect(m).toBeLessThanOrEqual(1);
      expect(m).toBeGreaterThanOrEqual(prev);
      prev = m;
    }
  });
});

describe('mergerStarburst01（星暴亮度曲线）', () => {
  it('每次穿越处峰值，权重递减', () => {
    const half = MERGER_OSC_PERIOD_MYR / 2;
    expect(mergerStarburst01(tauToDays(0))).toBeCloseTo(
      MERGER_STARBURST_WEIGHTS[0],
      3,
    );
    expect(mergerStarburst01(tauToDays(half))).toBeCloseTo(
      MERGER_STARBURST_WEIGHTS[1],
      3,
    );
    expect(mergerStarburst01(tauToDays(2 * half))).toBeCloseTo(
      MERGER_STARBURST_WEIGHTS[2],
      3,
    );
  });

  it('远离穿越时刻趋于 0，且始终在 [0,1]', () => {
    expect(mergerStarburst01(tauToDays(-500))).toBeCloseTo(0, 6);
    expect(mergerStarburst01(tauToDays(40))).toBeLessThan(0.2);
    expect(mergerStarburst01(tauToDays(1000))).toBeCloseTo(0, 6);
    for (let tau = -100; tau <= 500; tau += 7) {
      const b = mergerStarburst01(tauToDays(tau));
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThanOrEqual(1);
    }
  });

  it('穿越前短暂预热（高斯前沿），亮度对称回落', () => {
    const before = mergerStarburst01(tauToDays(-15));
    const after = mergerStarburst01(tauToDays(15));
    expect(before).toBeGreaterThan(0.3);
    expect(before).toBeCloseTo(after, 3);
  });
});

describe('mergerTidalDistortion01（潮汐扭曲强度）', () => {
  it('远距为 0，接近段随距离缩短渐强', () => {
    expect(mergerTidalDistortion01(0)).toBe(0);
    const far = mergerTidalDistortion01(tauToDays(-800));
    const near = mergerTidalDistortion01(tauToDays(-200));
    expect(near).toBeGreaterThan(far);
    expect(mergerTidalDistortion01(tauToDays(0))).toBeCloseTo(1, 6);
  });

  it('回摆期间持续显现（|s| ≪ onset），终态归零', () => {
    expect(MERGER_OSC_AMPLITUDE_LY).toBeLessThan(MERGER_TIDAL_ONSET_LY);
    expect(mergerTidalDistortion01(tauToDays(34))).toBeGreaterThan(0.6);
    expect(mergerTidalDistortion01(tauToDays(120))).toBeGreaterThan(0.6);
    expect(mergerTidalDistortion01(tauToDays(MERGER_ELLIPTICAL_END_MYR))).toBe(0);
    expect(mergerTidalDistortion01(tauToDays(2000))).toBe(0);
  });

  it('值域 [0,1]', () => {
    for (let tau = -4500; tau <= 600; tau += 90) {
      const t = mergerTidalDistortion01(tauToDays(tau));
      expect(t).toBeGreaterThanOrEqual(0);
      expect(t).toBeLessThanOrEqual(1);
    }
  });
});

describe('mergerStage（阶段状态机）', () => {
  it('τ 分段边界正确', () => {
    const half = MERGER_OSC_PERIOD_MYR / 2;
    expect(mergerStage(tauToDays(-1))).toBe('approaching');
    expect(mergerStage(tauToDays(0))).toBe('first-passage');
    expect(mergerStage(tauToDays(half - 0.01))).toBe('first-passage');
    expect(mergerStage(tauToDays(half))).toBe('oscillation');
    expect(mergerStage(tauToDays(MERGER_ELLIPTICAL_START_MYR - 0.01))).toBe(
      'oscillation',
    );
    expect(mergerStage(tauToDays(MERGER_ELLIPTICAL_START_MYR))).toBe('coalescing');
    expect(mergerStage(tauToDays(MERGER_ELLIPTICAL_END_MYR - 0.01))).toBe(
      'coalescing',
    );
    expect(mergerStage(tauToDays(MERGER_ELLIPTICAL_END_MYR))).toBe('merged');
    expect(mergerStage(tauToDays(99999))).toBe('merged');
  });
});

describe('mergerStageLabelZh / mergerNoticeZh（HUD 联动文案）', () => {
  it('合并前无标签/卡片，合并后各阶段有区分文案', () => {
    expect(mergerStageLabelZh(tauToDays(-100))).toBeNull();
    expect(mergerNoticeZh(tauToDays(-100))).toBeNull();
    const labels = new Set(
      [10, 100, 300, 500].map((tau) => mergerStageLabelZh(tauToDays(tau))),
    );
    expect(labels.size).toBe(4);
    for (const label of labels) {
      expect(typeof label).toBe('string');
      expect((label as string).length).toBeGreaterThan(0);
    }
    expect(mergerStageLabelZh(tauToDays(500))).toContain('Milkomeda');
    const notice = mergerNoticeZh(tauToDays(10));
    expect(notice).not.toBeNull();
    expect(notice!.stageZh).toContain('首次穿越');
    expect(notice!.tauMyr).toBeCloseTo(10, 6);
  });

  it('太阳系命运/来源登记文案完整（§11.1 科普卡片）', () => {
    expect(MERGER_FATE_NOTE_ZH).toContain('太阳系');
    expect(MERGER_FATE_NOTE_ZH).toContain('碰撞的概率');
    expect(MERGER_SOURCE_NOTE_ZH).toContain('van der Marel');
    expect(MERGER_SOURCE_NOTE_ZH).toContain('时间压缩');
  });
});

describe('mwM31SignedSeparationSceneUnits（渲染同源换算）', () => {
  it('符号透传、绝对值与宇宙距离压缩一致', () => {
    const dApproach = tauToDays(-500);
    const sLy = mwM31SignedSeparationLy(dApproach);
    expect(mwM31SignedSeparationSceneUnits(dApproach)).toBeCloseTo(
      cosmicDistanceToSceneUnits(sLy),
      6,
    );
    const dSwing = tauToDays(34); // 首摆负侧
    const sSwing = mwM31SignedSeparationLy(dSwing);
    expect(sSwing).toBeLessThan(0);
    expect(mwM31SignedSeparationSceneUnits(dSwing)).toBeCloseTo(
      -cosmicDistanceToSceneUnits(-sSwing),
      6,
    );
    expect(mwM31SignedSeparationSceneUnits(tauToDays(1000))).toBe(0);
  });
});

describe('确定性与时间可逆（R2-11 验收 2）', () => {
  it('同一模拟时间重复求值结果一致（无内部状态）', () => {
    const d = tauToDays(123);
    const first = {
      s: mwM31SignedSeparationLy(d),
      burst: mergerStarburst01(d),
      tidal: mergerTidalDistortion01(d),
      mix: mergerEllipticalMix01(d),
    };
    // 中途求值其他时刻（模拟时间前进再回退）
    mwM31SignedSeparationLy(tauToDays(400));
    mergerStarburst01(tauToDays(-100));
    expect(mwM31SignedSeparationLy(d)).toBe(first.s);
    expect(mergerStarburst01(d)).toBe(first.burst);
    expect(mergerTidalDistortion01(d)).toBe(first.tidal);
    expect(mergerEllipticalMix01(d)).toBe(first.mix);
  });

  it('时间回退到合并前即复原（全部演化量归位）', () => {
    const before = tauToDays(-600);
    expect(mergerStage(before)).toBe('approaching');
    expect(mergerEllipticalMix01(before)).toBe(0);
    expect(mergerTidalDistortion01(before)).toBeLessThan(0.2);
    expect(mwM31SignedSeparationLy(before)).toBeGreaterThan(0);
  });
});
