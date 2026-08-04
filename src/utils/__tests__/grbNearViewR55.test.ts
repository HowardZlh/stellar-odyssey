/**
 * R5-5 GRB 近观细节层单元测试（IMPROVEMENT_REQUIREMENTS_5 §R5-5 B）
 *
 * 覆盖：detailLayer 规格（particles 池、阈值与类星体/星系近观同源、
 * 预算 13 粒）、喷流开角参数化（tan 半开角 + 域校验）、余辉膨胀壳曲线
 * （R ∝ t^(1/4) 单调膨胀、幂律减暗 α=1.2、周期末淡出归零无重放跳变、
 * 负时间回卷）、近观喷流权重（爆发升起/指数衰减/地板/周期末归零）、
 * 静态双锥减淡域、预览页 ?body=grb 注册与 Piran 2004 来源登记、
 * 现状核对结论（常驻演示物周期时钟同源）。
 */

import {
  GRB_AFTERGLOW_DECAY_ALPHA,
  GRB_AFTERGLOW_MAX_RADIUS_FACTOR,
  GRB_AFTERGLOW_TAU_SEC,
  GRB_BODY_ID,
  GRB_CYCLE_FADE_OUT_END_SEC,
  GRB_CYCLE_FADE_OUT_START_SEC,
  GRB_NEAR_JET_FLOOR,
  GRB_NEAR_JET_FULL_ANGLE_DEG,
  GRB_NEAR_JET_LENGTH_FACTOR,
  GRB_NEAR_PARTICLE_COUNT,
  GRB_NEAR_SOURCE_ZH,
  GRB_STATIC_NEAR_DIM,
  grbAfterglowState,
  grbDetailLayerSpec,
  grbNearJetWeight01,
  grbNearViewEnterDistanceUnits,
  jetConeRadiusFactor,
} from '@/utils/grbNearView';
import { GRB_CYCLE_SEC, GRB_FLASH_DURATION_SEC } from '@/utils/specialBodies';
import {
  EXTRAGALACTIC_VIEW_RADIUS_UNITS,
  viewDistanceForRadius,
} from '@/utils/cameraFocus';
import { NEAR_VIEW_ENTER_RATIO, NEAR_VIEW_EXIT_RATIO } from '@/utils/nearView';
import { GPU_BYTES_PER_PARTICLE, estimateGpuBytes } from '@/utils/detailLayer';
import { quasarNearViewEnterDistanceUnits } from '@/utils/quasarNearView';
import { MAX_PREVIEW_PARAMS, previewEntryForBody } from '@/utils/devPreview';
import { getSpecialBodyById } from '@/data/specialBodies';

// ---------------------------------------------------------------------------
// detailLayer 规格
// ---------------------------------------------------------------------------

describe('grbDetailLayerSpec（particles 池，阈值同源）', () => {
  it('进入 = 河外飞往观察距离 × 1.5（与类星体同式同值）；退出 × 1.4', () => {
    const spec = grbDetailLayerSpec();
    expect(spec.bodyId).toBe(GRB_BODY_ID);
    expect(spec.kind).toBe('particles');
    expect(spec.enterDistanceUnits).toBeCloseTo(
      viewDistanceForRadius(EXTRAGALACTIC_VIEW_RADIUS_UNITS) * NEAR_VIEW_ENTER_RATIO,
      10,
    );
    expect(spec.enterDistanceUnits).toBeCloseTo(grbNearViewEnterDistanceUnits(), 10);
    expect(spec.enterDistanceUnits).toBeCloseTo(quasarNearViewEnterDistanceUnits(), 10);
    expect(spec.exitDistanceUnits).toBeCloseTo(
      spec.enterDistanceUnits * NEAR_VIEW_EXIT_RATIO,
      10,
    );
  });

  it('预算：13 粒（锥 2 + 节点 sprite 10 + 余辉壳 1）≪ 单目标 12,000', () => {
    const spec = grbDetailLayerSpec();
    expect(spec.budget.particles).toBe(GRB_NEAR_PARTICLE_COUNT);
    expect(GRB_NEAR_PARTICLE_COUNT).toBe(13);
    expect(spec.budget.gpuBytesEstimate).toBe(
      GRB_NEAR_PARTICLE_COUNT * GPU_BYTES_PER_PARTICLE,
    );
    expect(spec.budget.gpuBytesEstimate).toBe(
      estimateGpuBytes({ particles: GRB_NEAR_PARTICLE_COUNT }),
    );
  });
});

// ---------------------------------------------------------------------------
// 喷流开角参数化
// ---------------------------------------------------------------------------

describe('jetConeRadiusFactor（开角 ~5° 参数化登记）', () => {
  it('系数 = tan(全开角/2)；5° 档 ≈ 0.0437', () => {
    expect(jetConeRadiusFactor(5)).toBeCloseTo(Math.tan((2.5 * Math.PI) / 180), 10);
    expect(jetConeRadiusFactor(GRB_NEAR_JET_FULL_ANGLE_DEG)).toBeCloseTo(0.04366, 4);
    expect(jetConeRadiusFactor(90 - 1e-9)).toBeLessThan(1);
  });

  it('登记档：全开角 5°、喷流长度因子 7（近观细节层几何）', () => {
    expect(GRB_NEAR_JET_FULL_ANGLE_DEG).toBe(5);
    expect(GRB_NEAR_JET_LENGTH_FACTOR).toBe(7);
  });

  it('开角域 (0, 90) 外抛 RangeError', () => {
    expect(() => jetConeRadiusFactor(0)).toThrow(RangeError);
    expect(() => jetConeRadiusFactor(90)).toThrow(RangeError);
    expect(() => jetConeRadiusFactor(-5)).toThrow(RangeError);
    expect(() => jetConeRadiusFactor(Number.NaN)).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// 余辉膨胀壳曲线（Piran 2004 图景登记）
// ---------------------------------------------------------------------------

describe('grbAfterglowState（膨胀减暗曲线）', () => {
  it('半径 R ∝ t^(1/4)：周期内单调膨胀，0 → ≈1', () => {
    expect(grbAfterglowState(0).radius01).toBe(0);
    let prev = -1;
    for (let t = 0; t < GRB_CYCLE_SEC; t += 0.5) {
      const { radius01 } = grbAfterglowState(t);
      expect(radius01).toBeGreaterThanOrEqual(prev);
      prev = radius01;
    }
    expect(grbAfterglowState(GRB_CYCLE_SEC - 1e-6).radius01).toBeCloseTo(1, 3);
    // 幂律锚定：t = 周期/16 时半径 = (1/16)^0.25 = 1/2
    expect(grbAfterglowState(GRB_CYCLE_SEC / 16).radius01).toBeCloseTo(0.5, 10);
  });

  it('强度：起燃 → 峰值在爆发早期 → 幂律衰减 → 周期末归零', () => {
    expect(grbAfterglowState(0).opacity01).toBe(0);
    const early = grbAfterglowState(GRB_FLASH_DURATION_SEC).opacity01;
    const mid = grbAfterglowState(20).opacity01;
    const late = grbAfterglowState(GRB_CYCLE_SEC - GRB_CYCLE_FADE_OUT_END_SEC).opacity01;
    expect(early).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(late);
    expect(late).toBeLessThanOrEqual(1e-9);
    // 重放连续性：周期末与下一循环起点均 ≈ 0（无跳变）
    expect(grbAfterglowState(GRB_CYCLE_SEC + 1e-6).opacity01).toBeCloseTo(0, 6);
  });

  it('幂律衰减指数 α = 1.2（中段两点比值锚定，起燃/末端淡出均满值区）', () => {
    const t1 = GRB_AFTERGLOW_TAU_SEC;
    const t2 = GRB_AFTERGLOW_TAU_SEC * 2;
    const ratio = grbAfterglowState(t2).opacity01 / grbAfterglowState(t1).opacity01;
    const expected =
      Math.pow((t2 + GRB_AFTERGLOW_TAU_SEC) / GRB_AFTERGLOW_TAU_SEC, -GRB_AFTERGLOW_DECAY_ALPHA) /
      Math.pow((t1 + GRB_AFTERGLOW_TAU_SEC) / GRB_AFTERGLOW_TAU_SEC, -GRB_AFTERGLOW_DECAY_ALPHA);
    expect(ratio).toBeCloseTo(expected, 10);
    expect(GRB_AFTERGLOW_DECAY_ALPHA).toBe(1.2);
  });

  it('age01 = 周期内相位；负时间回卷；非法周期抛 RangeError', () => {
    expect(grbAfterglowState(9).age01).toBeCloseTo(9 / GRB_CYCLE_SEC, 10);
    const wrapped = grbAfterglowState(-GRB_CYCLE_SEC + 9);
    expect(wrapped.age01).toBeCloseTo(9 / GRB_CYCLE_SEC, 10);
    expect(wrapped.opacity01).toBeCloseTo(grbAfterglowState(9).opacity01, 10);
    expect(() => grbAfterglowState(0, 0)).toThrow(RangeError);
    expect(() => grbAfterglowState(0, GRB_CYCLE_SEC, -1)).toThrow(RangeError);
    // 非有限时间防御性取 0（渲染时钟异常帧不产生 NaN）
    expect(grbAfterglowState(Number.NaN).opacity01).toBe(0);
    expect(grbNearJetWeight01(Number.NaN)).toBe(0);
  });

  it('两帧对比可辨（验收锚定）：t=5s 与 t=25s 半径/强度均显著演化', () => {
    const a = grbAfterglowState(5);
    const b = grbAfterglowState(25);
    expect(b.radius01 - a.radius01).toBeGreaterThan(0.2);
    expect(a.opacity01 / Math.max(b.opacity01, 1e-9)).toBeGreaterThan(2);
  });

  it('最大可视化半径因子为正（组件尺度消费）', () => {
    expect(GRB_AFTERGLOW_MAX_RADIUS_FACTOR).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 近观喷流权重
// ---------------------------------------------------------------------------

describe('grbNearJetWeight01（喷流随周期出现/衰减）', () => {
  it('爆发起点 0 → 快速升起 ≈ 满值 → 指数衰减 → 地板 → 周期末归零', () => {
    expect(grbNearJetWeight01(0)).toBe(0);
    expect(grbNearJetWeight01(0.5)).toBeGreaterThan(0.85);
    const mid = grbNearJetWeight01(GRB_CYCLE_SEC / 2);
    expect(mid).toBeGreaterThan(GRB_NEAR_JET_FLOOR * 0.9);
    expect(mid).toBeLessThan(GRB_NEAR_JET_FLOOR * 1.5);
    expect(grbNearJetWeight01(GRB_CYCLE_SEC - GRB_CYCLE_FADE_OUT_END_SEC)).toBeCloseTo(
      0,
      6,
    );
    // 衰减单调（升起完成后至淡出窗前）
    let prev = 2;
    for (let t = 1; t < GRB_CYCLE_SEC - GRB_CYCLE_FADE_OUT_START_SEC; t += 1) {
      const w = grbNearJetWeight01(t);
      expect(w).toBeLessThanOrEqual(prev + 1e-12);
      prev = w;
    }
  });

  it('地板档 ∈ (0,1)（演示可见性登记）；减淡幅度 ∈ (0,1]', () => {
    expect(GRB_NEAR_JET_FLOOR).toBeGreaterThan(0);
    expect(GRB_NEAR_JET_FLOOR).toBeLessThan(1);
    expect(GRB_STATIC_NEAR_DIM).toBeGreaterThan(0);
    expect(GRB_STATIC_NEAR_DIM).toBeLessThanOrEqual(1);
  });

  it('周期时钟与主场景 grbFlashState 同源（默认参数 = GRB_CYCLE_SEC/FLASH）；非法参数抛 RangeError', () => {
    expect(grbNearJetWeight01(9)).toBeCloseTo(
      grbNearJetWeight01(9 + GRB_CYCLE_SEC),
      10,
    );
    expect(grbNearJetWeight01(9)).toBeCloseTo(
      grbNearJetWeight01(9, GRB_CYCLE_SEC, GRB_FLASH_DURATION_SEC),
      10,
    );
    expect(() => grbNearJetWeight01(0, -1)).toThrow(RangeError);
    expect(() => grbNearJetWeight01(0, GRB_CYCLE_SEC, 0)).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// 预览页注册与来源登记（§R5-5 B 第 2 条）
// ---------------------------------------------------------------------------

describe('预览页 ?body=grb 注册与登记（§R5-5 B）', () => {
  it('grb 条目注册：componentKey/滑杆四件/开角默认 5°/上限内', () => {
    const entry = previewEntryForBody('grb')!;
    expect(entry.componentKey).toBe('grb-near-view');
    expect(entry.params.map((p) => p.key)).toEqual([
      'timeScale',
      'jetAngleDeg',
      'jetGain',
      'shellGain',
    ]);
    expect(entry.params.find((p) => p.key === 'jetAngleDeg')?.default).toBe(
      GRB_NEAR_JET_FULL_ANGLE_DEG,
    );
    expect(entry.params.length).toBeLessThanOrEqual(MAX_PREVIEW_PARAMS);
  });

  it('来源登记：Piran 2004 火球模型图景 + 常驻演示物结论（预览 dataSource + 信息面板）', () => {
    const entry = previewEntryForBody('grb')!;
    expect(entry.dataSource).toBe(GRB_NEAR_SOURCE_ZH);
    expect(GRB_NEAR_SOURCE_ZH).toMatch(/Piran 2004/);
    expect(GRB_NEAR_SOURCE_ZH).toContain('常驻演示物');
    // 信息面板 dataSource 同步登记（data/specialBodies GRB 条目）
    expect(getSpecialBodyById(GRB_BODY_ID)!.dataSource).toMatch(/Piran 2004/);
  });
});
