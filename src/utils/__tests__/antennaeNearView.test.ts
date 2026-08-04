/**
 * R4-22 触须星系近观纯逻辑单测：detailLayer 规格 / simDays→快照相位
 * （三角波连续性）/ 快照位置缩放 / 核插值 / 粒子属性确定性 + 预览注册
 */
import {
  ANTENNAE_BODY_ID,
  ANTENNAE_COLOR_DISK_A,
  ANTENNAE_COLOR_DISK_B,
  ANTENNAE_CORE_SPRITE_COUNT,
  ANTENNAE_GPU_BYTES_PER_PARTICLE,
  ANTENNAE_MAX_PARTICLES,
  ANTENNAE_SIZE_MAX_FACTOR,
  ANTENNAE_SIZE_MIN_FACTOR,
  ANTENNAE_SNAPSHOT_SPAN_MYR,
  ANTENNAE_STATIC_NEAR_DIM,
  ANTENNAE_UNITS_PER_RP_FACTOR,
  antennaeCorePosition,
  antennaeDetailLayerSpec,
  antennaeNearViewEnterDistanceUnits,
  antennaeSnapshotPhase,
  buildAntennaeParticleAttributes,
  writeAntennaeSnapshotPositions,
} from '../antennaeNearView';
import {
  EXTRAGALACTIC_VIEW_RADIUS_UNITS,
  viewDistanceForRadius,
} from '../cameraFocus';
import { NEAR_VIEW_ENTER_RATIO, NEAR_VIEW_EXIT_RATIO } from '../nearView';
import { DAYS_PER_MYR } from '../galaxy';
import type { AntennaeSnapshotsData } from '../bakedData';
import { previewEntryForBody, MAX_PREVIEW_PARAMS } from '../devPreview';

/** 构造最小快照数据（S=8、N=4、nA=2；坐标 = 快照索引编码便于断言） */
function makeData(): AntennaeSnapshotsData {
  const S = 8;
  const N = 4;
  const cores = new Float32Array(S * 6);
  const positions = new Float32Array(S * N * 3);
  for (let s = 0; s < S; s += 1) {
    for (let i = 0; i < 6; i += 1) cores[s * 6 + i] = s * 10 + i;
    for (let i = 0; i < N * 3; i += 1) positions[s * N * 3 + i] = s + i * 0.1;
  }
  return { snapshotCount: S, particleCount: N, diskACount: 2, cores, positions };
}

// ---------------------------------------------------------------------------
// detailLayer 规格
// ---------------------------------------------------------------------------

describe('antennaeDetailLayerSpec', () => {
  it('starCatalog 池 + 阈值与 cameraFocus/nearView 同源', () => {
    const spec = antennaeDetailLayerSpec();
    expect(spec.bodyId).toBe(ANTENNAE_BODY_ID);
    expect(spec.kind).toBe('starCatalog');
    const enter =
      viewDistanceForRadius(EXTRAGALACTIC_VIEW_RADIUS_UNITS) * NEAR_VIEW_ENTER_RATIO;
    expect(spec.enterDistanceUnits).toBeCloseTo(enter, 10);
    expect(spec.exitDistanceUnits).toBeCloseTo(enter * NEAR_VIEW_EXIT_RATIO, 10);
    expect(antennaeNearViewEnterDistanceUnits()).toBeCloseTo(enter, 10);
  });

  it('预算登记：粒子 ≤12,000、GPU 按 40 B/粒实际布局', () => {
    const spec = antennaeDetailLayerSpec();
    expect(spec.budget.particles).toBe(ANTENNAE_MAX_PARTICLES + ANTENNAE_CORE_SPRITE_COUNT);
    expect(spec.budget.particles!).toBeLessThanOrEqual(12000);
    expect(spec.budget.gpuBytesEstimate).toBe(
      ANTENNAE_MAX_PARTICLES * ANTENNAE_GPU_BYTES_PER_PARTICLE,
    );
  });
});

// ---------------------------------------------------------------------------
// simDays → 快照相位（三角波连续性）
// ---------------------------------------------------------------------------

/** 相位展平为连续标量（seg + mix）便于连续性断言 */
function flatPhase(simDays: number, count: number): number {
  const p = antennaeSnapshotPhase(simDays, count);
  return p.seg + p.mix;
}

describe('antennaeSnapshotPhase', () => {
  const spanDays = ANTENNAE_SNAPSHOT_SPAN_MYR * DAYS_PER_MYR;

  it('起点相位 0，半程单调递增至末快照', () => {
    expect(antennaeSnapshotPhase(0, 10)).toEqual({ seg: 0, mix: 0 });
    let prev = -1;
    for (let k = 0; k <= 20; k += 1) {
      const v = flatPhase((spanDays * k) / 20, 10);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
    expect(prev).toBeCloseTo(9, 10);
  });

  it('三角波折返：全程末端两侧相位连续（插值无跳变）', () => {
    const eps = spanDays * 1e-6;
    const before = flatPhase(spanDays - eps, 10);
    const after = flatPhase(spanDays + eps, 10);
    expect(Math.abs(after - before)).toBeLessThan(1e-3);
    // 2× 全程回到起点两侧同样连续
    const nearZeroA = flatPhase(2 * spanDays - eps, 10);
    const nearZeroB = flatPhase(2 * spanDays + eps, 10);
    expect(Math.abs(nearZeroA - nearZeroB)).toBeLessThan(1e-3);
    expect(nearZeroB).toBeLessThan(1e-3);
  });

  it('seg 钳制在 [0, S−2]、mix ∈ [0,1]（含相位恰为整数处）', () => {
    const atEnd = antennaeSnapshotPhase(spanDays, 10);
    expect(atEnd.seg).toBe(8);
    expect(atEnd.mix).toBeCloseTo(1, 10);
    for (let k = 0; k <= 40; k += 1) {
      const p = antennaeSnapshotPhase((spanDays * 2 * k) / 40 + k * 1e7, 8);
      expect(p.seg).toBeGreaterThanOrEqual(0);
      expect(p.seg).toBeLessThanOrEqual(6);
      expect(p.mix).toBeGreaterThanOrEqual(0);
      expect(p.mix).toBeLessThanOrEqual(1);
    }
  });

  it('非法输入回落相位 0（NaN/Infinity/快照数 <2）', () => {
    expect(antennaeSnapshotPhase(Number.NaN, 10)).toEqual({ seg: 0, mix: 0 });
    expect(antennaeSnapshotPhase(Number.POSITIVE_INFINITY, 10)).toEqual({ seg: 0, mix: 0 });
    expect(antennaeSnapshotPhase(1e9, 1)).toEqual({ seg: 0, mix: 0 });
    expect(antennaeSnapshotPhase(1e9, Number.NaN)).toEqual({ seg: 0, mix: 0 });
  });

  it('负 simDays 取绝对值（防御；演化对称）', () => {
    expect(flatPhase(-spanDays / 2, 10)).toBeCloseTo(flatPhase(spanDays / 2, 10), 10);
  });
});

// ---------------------------------------------------------------------------
// 快照位置缩放写入
// ---------------------------------------------------------------------------

describe('writeAntennaeSnapshotPositions', () => {
  it('按 0.75×基准半径缩放写入', () => {
    const data = makeData();
    const out = new Float32Array(data.particleCount * 3);
    writeAntennaeSnapshotPositions(data, 2, 300, out);
    const scale = ANTENNAE_UNITS_PER_RP_FACTOR * 300;
    expect(out[0]).toBeCloseTo(2 * scale, 3);
    expect(out[5]).toBeCloseTo((2 + 0.5) * scale, 3);
  });

  it('越界快照索引/非法基准半径/缓冲不足抛 RangeError', () => {
    const data = makeData();
    const out = new Float32Array(data.particleCount * 3);
    expect(() => writeAntennaeSnapshotPositions(data, 8, 300, out)).toThrow(RangeError);
    expect(() => writeAntennaeSnapshotPositions(data, -1, 300, out)).toThrow(RangeError);
    expect(() => writeAntennaeSnapshotPositions(data, 1.5, 300, out)).toThrow(RangeError);
    expect(() => writeAntennaeSnapshotPositions(data, 0, 0, out)).toThrow(RangeError);
    expect(() => writeAntennaeSnapshotPositions(data, 0, Number.NaN, out)).toThrow(RangeError);
    expect(() =>
      writeAntennaeSnapshotPositions(data, 0, 300, new Float32Array(3)),
    ).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// 核插值
// ---------------------------------------------------------------------------

describe('antennaeCorePosition', () => {
  it('区间内线性插值（核 A/B 各自坐标槽位）', () => {
    const data = makeData();
    const out = { x: 0, y: 0, z: 0 };
    const scale = ANTENNAE_UNITS_PER_RP_FACTOR * 100;
    // 核 A：快照 1（10,11,12）→ 快照 2（20,21,22），mix=0.5 → 15,16,17
    antennaeCorePosition(data, { seg: 1, mix: 0.5 }, 0, 100, out);
    expect(out.x).toBeCloseTo(15 * scale, 3);
    expect(out.y).toBeCloseTo(16 * scale, 3);
    expect(out.z).toBeCloseTo(17 * scale, 3);
    // 核 B：槽位偏移 3（13..15 → 23..25）
    antennaeCorePosition(data, { seg: 1, mix: 0 }, 1, 100, out);
    expect(out.x).toBeCloseTo(13 * scale, 3);
  });

  it('相位越界防御性钳制', () => {
    const data = makeData();
    const out = { x: 0, y: 0, z: 0 };
    const scale = ANTENNAE_UNITS_PER_RP_FACTOR * 1;
    antennaeCorePosition(data, { seg: 99, mix: 2 }, 0, 1, out);
    // 钳到末区间 seg=6、mix=1 → 快照 7 的核 A x = 70
    expect(out.x).toBeCloseTo(70 * scale, 3);
    antennaeCorePosition(data, { seg: -5, mix: -1 }, 0, 1, out);
    expect(out.x).toBeCloseTo(0, 6);
  });
});

// ---------------------------------------------------------------------------
// 粒子属性（确定性 + 双盘配色）
// ---------------------------------------------------------------------------

describe('buildAntennaeParticleAttributes', () => {
  it('两次调用逐字节一致（附录 A §2 确定性）', () => {
    const data = makeData();
    const a = buildAntennaeParticleAttributes(data, 300);
    const b = buildAntennaeParticleAttributes(data, 300);
    expect(Array.from(a.colors)).toEqual(Array.from(b.colors));
    expect(Array.from(a.sizes)).toEqual(Array.from(b.sizes));
    expect(a.count).toBe(data.particleCount);
  });

  it('盘 A 暖色（r>b）/盘 B 冷色（b>r），粒径落于登记域', () => {
    const data = makeData();
    const { colors, sizes } = buildAntennaeParticleAttributes(data, 300);
    for (let i = 0; i < data.particleCount; i += 1) {
      const r = colors[i * 3];
      const b = colors[i * 3 + 2];
      if (i < data.diskACount) expect(r).toBeGreaterThan(b);
      else expect(b).toBeGreaterThan(r);
      expect(sizes[i]).toBeGreaterThanOrEqual(ANTENNAE_SIZE_MIN_FACTOR * 300);
      expect(sizes[i]).toBeLessThanOrEqual(ANTENNAE_SIZE_MAX_FACTOR * 300);
    }
    // 基准色相对关系（登记值防回归）
    expect(ANTENNAE_COLOR_DISK_A.r).toBeGreaterThan(ANTENNAE_COLOR_DISK_A.b);
    expect(ANTENNAE_COLOR_DISK_B.b).toBeGreaterThan(ANTENNAE_COLOR_DISK_B.r);
  });

  it('非法基准半径抛 RangeError', () => {
    const data = makeData();
    expect(() => buildAntennaeParticleAttributes(data, 0)).toThrow(RangeError);
    expect(() => buildAntennaeParticleAttributes(data, Number.NaN)).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// 静态层减淡系数与预览注册
// ---------------------------------------------------------------------------

describe('R4-22 登记项', () => {
  it('静态层近观减淡幅度落于 (0,1)（保留残影不至全隐）', () => {
    expect(ANTENNAE_STATIC_NEAR_DIM).toBeGreaterThan(0);
    expect(ANTENNAE_STATIC_NEAR_DIM).toBeLessThan(1);
  });

  it('预览页注册 ?body=antennae（componentKey/滑杆/数据源登记）', () => {
    const entry = previewEntryForBody('antennae');
    expect(entry).not.toBeNull();
    expect(entry!.componentKey).toBe('antennae-near-view');
    expect(entry!.params.length).toBeLessThanOrEqual(MAX_PREVIEW_PARAMS);
    expect(entry!.params.map((p) => p.key)).toEqual(
      expect.arrayContaining(['timeScale', 'sizeGain']),
    );
    expect(entry!.dataSource).toContain('Toomre & Toomre');
  });
});
