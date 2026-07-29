/**
 * R4-21 类星体 3C 273 近观纯逻辑单测（IMPROVEMENT_REQUIREMENTS_4 §R4-21）
 *
 * 覆盖：detailLayer 规格（particles 池/阈值同源/GPU 预算）、尘埃环面
 * 粒子生成（确定性/环面几何/暗红棕配色/粒径域/尺度线性）、四层结构
 * 几何次序（盘 → BLR → 环面）、核心减淡与 BLR 光变联动权重、盘半径
 * 参数化（R4-12 常数单点同源）、预览页注册（§R4-21 第 3 条）。
 */

import {
  QUASAR_BLR_BASE_OPACITY,
  QUASAR_BLR_GLOW_HALF_FACTOR,
  QUASAR_BODY_ID,
  QUASAR_CORE_NEAR_DIM,
  QUASAR_DISK_INNER_FACTOR,
  QUASAR_DISK_OUTER_FACTOR,
  QUASAR_DISK_TEMP_PEAK_K,
  QUASAR_NEAR_SPRITE_COUNT,
  QUASAR_TORUS_COLOR_INNER,
  QUASAR_TORUS_COLOR_OUTER,
  QUASAR_TORUS_FLATTEN_Y,
  QUASAR_TORUS_MAJOR_FACTOR,
  QUASAR_TORUS_MINOR_FACTOR,
  QUASAR_TORUS_PARTICLE_COUNT,
  QUASAR_TORUS_SIZE_MAX_FACTOR,
  QUASAR_TORUS_SIZE_MIN_FACTOR,
  generateQuasarTorusParticles,
  quasarBlrOpacity,
  quasarCoreNearFactor,
  quasarDetailLayerSpec,
  quasarDiskRadiusRs,
  quasarNearViewEnterDistanceUnits,
} from '@/utils/quasarNearView';
import {
  EXTRAGALACTIC_VIEW_RADIUS_UNITS,
  viewDistanceForRadius,
} from '@/utils/cameraFocus';
import { NEAR_VIEW_ENTER_RATIO, NEAR_VIEW_EXIT_RATIO } from '@/utils/nearView';
import { GPU_BYTES_PER_PARTICLE, estimateGpuBytes } from '@/utils/detailLayer';
import {
  DISK_INNER_RADIUS_RS_DEFAULT,
  DISK_LUT_TEMP_MAX_K,
  DISK_OUTER_RADIUS_RS_DEFAULT,
} from '@/utils/blackHoleLensing';
import { GALAXY_NEAR_VIEW_MAX_PARTICLES } from '@/utils/galaxyNearView';
import { previewEntryForBody } from '@/utils/devPreview';

describe('R4-21 detailLayer 规格（阈值同源 + 预算）', () => {
  it('进入阈值 = 河外飞往观察距离 × NEAR_VIEW_ENTER_RATIO（同源公式）', () => {
    expect(quasarNearViewEnterDistanceUnits()).toBe(
      viewDistanceForRadius(EXTRAGALACTIC_VIEW_RADIUS_UNITS) * NEAR_VIEW_ENTER_RATIO,
    );
    // 现值锚定：300 × 6 × 1.5 = 2700（cameraFocus 半径 6 倍公式）
    expect(quasarNearViewEnterDistanceUnits()).toBe(2700);
  });

  it('规格：particles 池 + bodyId + 滞回退出阈值 ×1.4', () => {
    const spec = quasarDetailLayerSpec();
    expect(spec.bodyId).toBe(QUASAR_BODY_ID);
    expect(spec.kind).toBe('particles');
    expect(spec.enterDistanceUnits).toBe(quasarNearViewEnterDistanceUnits());
    expect(spec.exitDistanceUnits).toBeCloseTo(
      spec.enterDistanceUnits * NEAR_VIEW_EXIT_RATIO,
      9,
    );
  });

  it('粒子预算：环面 2,400 + BLR sprite 1，≤ 单目标 12,000 且不超星系近观峰值', () => {
    const spec = quasarDetailLayerSpec();
    const particles = QUASAR_TORUS_PARTICLE_COUNT + QUASAR_NEAR_SPRITE_COUNT;
    expect(spec.budget.particles).toBe(particles);
    expect(particles).toBeLessThanOrEqual(12000);
    // 共池（particles 容量 1）且低于星系近观上限 → 全局峰值登记不变
    expect(particles).toBeLessThanOrEqual(GALAXY_NEAR_VIEW_MAX_PARTICLES);
  });

  it('GPU 估算 = estimateGpuBytes（28 B/粒布局一致）', () => {
    const spec = quasarDetailLayerSpec();
    expect(spec.budget.gpuBytesEstimate).toBe(
      estimateGpuBytes({ particles: spec.budget.particles }),
    );
    expect(spec.budget.gpuBytesEstimate).toBe(
      (QUASAR_TORUS_PARTICLE_COUNT + QUASAR_NEAR_SPRITE_COUNT) * GPU_BYTES_PER_PARTICLE,
    );
  });
});

describe('R4-21 四层结构几何次序（盘 → BLR → 尘埃环面）', () => {
  it('盘内缘 < 盘外缘 < BLR 辉光半边长 < 环面主半径', () => {
    expect(QUASAR_DISK_INNER_FACTOR).toBeGreaterThan(0);
    expect(QUASAR_DISK_INNER_FACTOR).toBeLessThan(QUASAR_DISK_OUTER_FACTOR);
    expect(QUASAR_DISK_OUTER_FACTOR).toBeLessThan(QUASAR_BLR_GLOW_HALF_FACTOR);
    expect(QUASAR_BLR_GLOW_HALF_FACTOR).toBeLessThan(QUASAR_TORUS_MAJOR_FACTOR);
  });

  it('盘外缘不与环面内缘重叠（层次可辨）', () => {
    expect(QUASAR_DISK_OUTER_FACTOR).toBeLessThan(
      QUASAR_TORUS_MAJOR_FACTOR - QUASAR_TORUS_MINOR_FACTOR,
    );
  });

  it('环面压扁系数 ∈ (0,1]；粒径域次序合法', () => {
    expect(QUASAR_TORUS_FLATTEN_Y).toBeGreaterThan(0);
    expect(QUASAR_TORUS_FLATTEN_Y).toBeLessThanOrEqual(1);
    expect(QUASAR_TORUS_SIZE_MIN_FACTOR).toBeGreaterThan(0);
    expect(QUASAR_TORUS_SIZE_MIN_FACTOR).toBeLessThan(QUASAR_TORUS_SIZE_MAX_FACTOR);
  });
});

describe('generateQuasarTorusParticles（确定性 + 环面几何 + 配色）', () => {
  const BASE = 300;

  it('确定性：两次生成逐字节一致（附录 A §2）', () => {
    const a = generateQuasarTorusParticles(BASE);
    const b = generateQuasarTorusParticles(BASE);
    expect(a.count).toBe(QUASAR_TORUS_PARTICLE_COUNT);
    expect(Buffer.from(a.positions.buffer).equals(Buffer.from(b.positions.buffer))).toBe(true);
    expect(Buffer.from(a.colors.buffer).equals(Buffer.from(b.colors.buffer))).toBe(true);
    expect(Buffer.from(a.sizes.buffer).equals(Buffer.from(b.sizes.buffer))).toBe(true);
  });

  it('属性长度与 count 一致', () => {
    const p = generateQuasarTorusParticles(BASE);
    expect(p.positions.length).toBe(p.count * 3);
    expect(p.colors.length).toBe(p.count * 3);
    expect(p.sizes.length).toBe(p.count);
  });

  it('全部粒子落于压扁环面管内（|(√(x²+z²)−R, y/flatten)| ≤ r_minor）', () => {
    const p = generateQuasarTorusParticles(BASE);
    const major = QUASAR_TORUS_MAJOR_FACTOR * BASE;
    const minor = QUASAR_TORUS_MINOR_FACTOR * BASE;
    for (let i = 0; i < p.count; i += 1) {
      const x = p.positions[i * 3];
      const y = p.positions[i * 3 + 1];
      const z = p.positions[i * 3 + 2];
      const ring = Math.hypot(x, z) - major;
      const tube = Math.hypot(ring, y / QUASAR_TORUS_FLATTEN_Y);
      expect(tube).toBeLessThanOrEqual(minor * (1 + 1e-6));
    }
  });

  it('暗红棕配色：逐粒 r > g > b 且分量 ∈ (0,1]（配色端点亦满足）', () => {
    for (const c of [QUASAR_TORUS_COLOR_INNER, QUASAR_TORUS_COLOR_OUTER]) {
      expect(c.r).toBeGreaterThan(c.g);
      expect(c.g).toBeGreaterThan(c.b);
    }
    const p = generateQuasarTorusParticles(BASE);
    for (let i = 0; i < p.count; i += 1) {
      const r = p.colors[i * 3];
      const g = p.colors[i * 3 + 1];
      const b = p.colors[i * 3 + 2];
      expect(r).toBeGreaterThan(g);
      expect(g).toBeGreaterThan(b);
      expect(r).toBeGreaterThan(0);
      expect(r).toBeLessThanOrEqual(1);
      // 暗档：红通道不超过 0.8（区别于盘亮蓝白）
      expect(r).toBeLessThanOrEqual(0.8);
    }
  });

  it('粒径落于登记域 [min,max] × 基准半径', () => {
    const p = generateQuasarTorusParticles(BASE);
    for (let i = 0; i < p.count; i += 1) {
      expect(p.sizes[i]).toBeGreaterThanOrEqual(QUASAR_TORUS_SIZE_MIN_FACTOR * BASE);
      expect(p.sizes[i]).toBeLessThanOrEqual(QUASAR_TORUS_SIZE_MAX_FACTOR * BASE);
    }
  });

  it('尺度线性：基准半径 ×2 → 位置/粒径 ×2、颜色不变', () => {
    const a = generateQuasarTorusParticles(1);
    const b = generateQuasarTorusParticles(2);
    for (let i = 0; i < 30; i += 1) {
      expect(b.positions[i]).toBeCloseTo(a.positions[i] * 2, 6);
    }
    for (let i = 0; i < 10; i += 1) {
      expect(b.sizes[i]).toBeCloseTo(a.sizes[i] * 2, 6);
      expect(b.colors[i]).toBe(a.colors[i]);
    }
  });

  it('非法基准半径抛 RangeError', () => {
    expect(() => generateQuasarTorusParticles(0)).toThrow(RangeError);
    expect(() => generateQuasarTorusParticles(-1)).toThrow(RangeError);
    expect(() => generateQuasarTorusParticles(Number.NaN)).toThrow(RangeError);
    expect(() => generateQuasarTorusParticles(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe('quasarCoreNearFactor（核心减淡，光变不回退）', () => {
  it('near01=0 → 1（远景零回退）；near01=1 → 1 − DIM', () => {
    expect(quasarCoreNearFactor(0)).toBe(1);
    expect(quasarCoreNearFactor(1)).toBeCloseTo(1 - QUASAR_CORE_NEAR_DIM, 9);
  });

  it('单调递减且始终 > 0（核心闪烁保留可辨）', () => {
    let prev = quasarCoreNearFactor(0);
    for (let t = 0.1; t <= 1; t += 0.1) {
      const f = quasarCoreNearFactor(t);
      expect(f).toBeLessThan(prev);
      expect(f).toBeGreaterThan(0);
      prev = f;
    }
  });

  it('越界/非有限输入钳制', () => {
    expect(quasarCoreNearFactor(-1)).toBe(1);
    expect(quasarCoreNearFactor(2)).toBeCloseTo(1 - QUASAR_CORE_NEAR_DIM, 9);
    expect(quasarCoreNearFactor(Number.NaN)).toBe(1);
  });
});

describe('quasarBlrOpacity（BLR 辉光光变联动）', () => {
  it('near01=0 → 0；flicker=1 基准 → 基础档', () => {
    expect(quasarBlrOpacity(0, 1)).toBe(0);
    expect(quasarBlrOpacity(1, 1)).toBeCloseTo(QUASAR_BLR_BASE_OPACITY, 9);
  });

  it('光变呼吸：flicker 越大辉光越亮（联动可辨）', () => {
    expect(quasarBlrOpacity(1, 1.2)).toBeGreaterThan(quasarBlrOpacity(1, 0.8));
  });

  it('非有限 flicker 回落基准；负值钳 0', () => {
    expect(quasarBlrOpacity(1, Number.NaN)).toBeCloseTo(QUASAR_BLR_BASE_OPACITY, 9);
    expect(quasarBlrOpacity(1, -5)).toBeCloseTo(QUASAR_BLR_BASE_OPACITY * 0.75, 9);
  });
});

describe('quasarDiskRadiusRs（R4-12 常数单点同源）', () => {
  it('t=0 → ISCO 内缘 3 r_s；t=1 → 外缘 12 r_s', () => {
    expect(quasarDiskRadiusRs(0)).toBe(DISK_INNER_RADIUS_RS_DEFAULT);
    expect(quasarDiskRadiusRs(1)).toBe(DISK_OUTER_RADIUS_RS_DEFAULT);
  });

  it('线性单调；越界/非有限钳制到端点', () => {
    expect(quasarDiskRadiusRs(0.5)).toBeCloseTo(
      (DISK_INNER_RADIUS_RS_DEFAULT + DISK_OUTER_RADIUS_RS_DEFAULT) / 2,
      9,
    );
    expect(quasarDiskRadiusRs(-1)).toBe(DISK_INNER_RADIUS_RS_DEFAULT);
    expect(quasarDiskRadiusRs(2)).toBe(DISK_OUTER_RADIUS_RS_DEFAULT);
    expect(quasarDiskRadiusRs(Number.NaN)).toBe(DISK_INNER_RADIUS_RS_DEFAULT);
  });

  it('峰值色温压标档落于黑体 LUT 域内（亮蓝白观感）', () => {
    expect(QUASAR_DISK_TEMP_PEAK_K).toBeGreaterThan(9000); // 蓝白档
    expect(QUASAR_DISK_TEMP_PEAK_K).toBeLessThanOrEqual(DISK_LUT_TEMP_MAX_K);
  });
});

describe('预览页注册（§R4-21 第 3 条：?body=quasar-3c273）', () => {
  it('quasar-3c273 已注册且 componentKey 为 quasar-near-view', () => {
    const entry = previewEntryForBody('quasar-3c273');
    expect(entry).not.toBeNull();
    expect(entry!.componentKey).toBe('quasar-near-view');
  });

  it('滑杆 4 件：束流强度/盘亮度/环面亮度/时间流速（束流默认物理档 1）', () => {
    const entry = previewEntryForBody('quasar-3c273')!;
    expect(entry.params.map((p) => p.key)).toEqual([
      'beamStrength',
      'diskGain',
      'torusGain',
      'timeScale',
    ]);
    const beam = entry.params.find((p) => p.key === 'beamStrength')!;
    expect(beam.default).toBe(1);
    expect(beam.min).toBe(0);
    expect(beam.max).toBe(2);
  });

  it('dataSource 登记 R4-12 复用 + AGN 统一模型 + 压标（附录 A §4）', () => {
    const src = previewEntryForBody('quasar-3c273')!.dataSource!;
    expect(src).toMatch(/R4-12 复用/);
    expect(src).toMatch(/Urry & Padovani 1995/);
    expect(src).toMatch(/12,000 K/);
  });
});
