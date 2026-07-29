/**
 * R4-16 蟹状星云丝状结构 + PWN 环面/喷流单测
 * （IMPROVEMENT_REQUIREMENTS_4 §R4-16）
 *
 * 覆盖：丝状骨架折线（条数/域内/确定性）、密度场关键点（§R4-16 验收：
 * 丝状脊密度 > 弥散区、内部弥散为正、吸收通道恒零、包络外归零）、
 * PWN 环面强度剖面（环面平面增强断言 + 主环/内环形态）、双色权重、
 * 确定性（FNV-1a 种子，附录 A §2）、主场景接入配置（volume 池规格/
 * 包围盒/交叉淡出零回退/透射补偿）、通用层配置、预览页注册。
 */

import {
  buildRgDensityData,
  CRAB_COLOR_WEIGHT_INNER_R,
  CRAB_COLOR_WEIGHT_OUTER_R,
  CRAB_DIFFUSE_LEVEL,
  CRAB_ENVELOPE_RADII,
  CRAB_FILAMENT_COUNT,
  CRAB_FILAMENT_RADIUS,
  CRAB_TEXTURE_SIZE,
  CRAB_TORUS_INNER_RHO01,
  CRAB_TORUS_RING_RHO01,
  CRAB_VOLUME_ID,
  crabColorWeight01,
  crabFilamentDistance,
  crabFilamentPolylines,
  crabTorusIntensity,
  makeCrabSampler,
  type NebulaSample,
} from '@/utils/nebulaVolume';
import { volumeSeed, VOLUME_TEXTURE_MAX_SIZE } from '@/utils/volume';
import {
  CRAB_PWN_JET_LENGTH_FACTOR,
  CRAB_PWN_TORUS_RADIUS_FACTOR,
  CRAB_SCENE_VOLUME_PARAMS,
  CRAB_VOLUME_BOX_FACTOR,
  crabBaseLayerFactor,
  crabCoreBoostFactor,
  crabNearLayerFactor,
  crabVolumeBoxEdgeUnits,
  crabVolumeDetailLayerSpec,
  crabVolumeLayerConfig,
} from '@/utils/nebulaVolumeScene';
import {
  DETAIL_GPU_BUDGET_BYTES,
  DETAIL_LRU_CAPACITY_BY_KIND,
  estimateGpuBytes,
  volumeTextureGpuBytes,
} from '@/utils/detailLayer';
import {
  nearViewEnterDistanceUnits,
  nearViewExitDistanceUnits,
} from '@/utils/nearView';
import {
  previewEntryForBody,
  VOLUME_PREVIEW_COMPONENT_KEYS,
} from '@/utils/devPreview';

/** 采样便捷封装（复用 scratch，返回发射/吸收副本） */
function sampleAt(
  sampler: ReturnType<typeof makeCrabSampler>,
  x: number,
  y: number,
  z: number,
): NebulaSample {
  const out: NebulaSample = { emission: 0, absorption: 0 };
  sampler(x, y, z, out);
  return { ...out };
}

/** 椭球归一化半径（测试辅助） */
function qLenOf(x: number, y: number, z: number): number {
  const [ax, ay, az] = CRAB_ENVELOPE_RADII;
  return Math.sqrt((x / ax) ** 2 + (y / ay) ** 2 + (z / az) ** 2);
}

describe('R4-16 crabFilamentPolylines（丝状骨架折线，确定性）', () => {
  const polylines = crabFilamentPolylines();

  it('条数落在省 token 约定 8–12 条（取 12）', () => {
    expect(CRAB_FILAMENT_COUNT).toBeGreaterThanOrEqual(8);
    expect(CRAB_FILAMENT_COUNT).toBeLessThanOrEqual(12);
    expect(polylines).toHaveLength(CRAB_FILAMENT_COUNT);
  });

  it('骨架点全部落在包络内（qLen < 1）且远离中心（qLen > 0.2）', () => {
    for (const poly of polylines) {
      expect(poly.length).toBeGreaterThanOrEqual(4);
      for (const [x, y, z] of poly) {
        const q = qLenOf(x, y, z);
        expect(q).toBeLessThan(1);
        expect(q).toBeGreaterThan(0.2);
      }
    }
  });

  it('同种子双次生成逐点一致；不同种子输出不同', () => {
    const again = crabFilamentPolylines();
    expect(again).toEqual(polylines);
    const other = crabFilamentPolylines(volumeSeed('other-seed'));
    expect(other).not.toEqual(polylines);
  });

  it('crabFilamentDistance：骨架点上距离近零，域角落距离大', () => {
    const [x, y, z] = polylines[0][3];
    expect(crabFilamentDistance(x, y, z)).toBeLessThan(1e-9);
    expect(crabFilamentDistance(1, 1, 1)).toBeGreaterThan(0.3);
  });
});

describe('R4-16 蟹状密度场关键采样点（§R4-16 验收：丝状脊 > 弥散区）', () => {
  const sampler = makeCrabSampler();
  const polylines = crabFilamentPolylines();

  /** 骨架中段采样点（丝状脊上，取每条折线中点） */
  const ridgePoints = polylines.map((poly) => poly[Math.floor(poly.length / 2)]);

  /** 弥散参考点：同径向范围内远离所有丝（距离 > 丝影响截断）的确定性扫描 */
  function diffusePoints(): (readonly [number, number, number])[] {
    const found: (readonly [number, number, number])[] = [];
    for (let i = 0; i < 200 && found.length < 6; i += 1) {
      // 确定性方向扫描（黄金角螺旋）
      const t = (i + 0.5) / 200;
      const polar = Math.acos(1 - 2 * t);
      const azimuth = i * 2.399963229728653;
      const q = 0.55;
      const [ax, ay, az] = CRAB_ENVELOPE_RADII;
      const x = Math.sin(polar) * Math.cos(azimuth) * q * ax;
      const y = Math.cos(polar) * q * ay;
      const z = Math.sin(polar) * Math.sin(azimuth) * q * az;
      if (crabFilamentDistance(x, y, z) > 0.2) found.push([x, y, z] as const);
    }
    return found;
  }

  it('丝状脊平均密度 ≥ 2.5× 弥散区平均密度（验收断言）', () => {
    const diffuse = diffusePoints();
    expect(diffuse.length).toBeGreaterThanOrEqual(3);
    const mean = (pts: readonly (readonly [number, number, number])[]): number =>
      pts.reduce((acc, [x, y, z]) => acc + sampleAt(sampler, x, y, z).emission, 0) / pts.length;
    const ridgeMean = mean(ridgePoints);
    const diffuseMean = mean(diffuse);
    expect(diffuseMean).toBeGreaterThan(0.02); // 弥散区本身为正（OIII 内弥散）
    expect(ridgeMean).toBeGreaterThanOrEqual(diffuseMean * 2.5);
  });

  it('内部弥散为正（中心近域 OIII 充盈），量级 ≈ CRAB_DIFFUSE_LEVEL', () => {
    const center = sampleAt(sampler, 0.06, 0.04, 0.02).emission;
    expect(center).toBeGreaterThan(0.04);
    expect(center).toBeLessThanOrEqual(CRAB_DIFFUSE_LEVEL * 1.5 + 0.9); // 中心可能恰有丝路过
  });

  it('包络外归零（qLen > 1.3 早退路径）', () => {
    for (const [x, y, z] of [
      [0.99, 0.99, 0.99],
      [-0.95, 0.9, -0.9],
      [0, -0.95, 0.9],
    ] as const) {
      expect(qLenOf(x, y, z)).toBeGreaterThan(1.3);
      const s = sampleAt(sampler, x, y, z);
      expect(s.emission).toBe(0);
      expect(s.absorption).toBe(0);
    }
  });

  it('吸收通道恒零（蟹状无显著前景尘埃登记，粗网格全域断言）', () => {
    const out: NebulaSample = { emission: 0, absorption: 0 };
    for (let zi = -1; zi <= 1; zi += 0.25) {
      for (let yi = -1; yi <= 1; yi += 0.25) {
        for (let xi = -1; xi <= 1; xi += 0.25) {
          sampler(xi, yi, zi, out);
          expect(out.absorption).toBe(0);
          expect(out.emission).toBeGreaterThanOrEqual(0);
          expect(out.emission).toBeLessThanOrEqual(1);
        }
      }
    }
  });
});

describe('R4-16 crabTorusIntensity（PWN 环面强度剖面，shader GLSL 镜像）', () => {
  it('环面平面增强（验收断言）：同径向半径下平面内强度 > 离面强度', () => {
    const inPlane = crabTorusIntensity(CRAB_TORUS_RING_RHO01, 0);
    expect(inPlane).toBeGreaterThan(crabTorusIntensity(CRAB_TORUS_RING_RHO01, 0.25) * 2);
    expect(inPlane).toBeGreaterThan(crabTorusIntensity(CRAB_TORUS_RING_RHO01, 0.5) * 5);
  });

  it('主环中径处强度峰值：> 中心、> 外缘（环形发射体形态）', () => {
    const ring = crabTorusIntensity(CRAB_TORUS_RING_RHO01, 0);
    expect(ring).toBeGreaterThan(crabTorusIntensity(0, 0));
    expect(ring).toBeGreaterThan(crabTorusIntensity(1, 0) * 2);
  });

  it('内环（Chandra 内环）处呈局部隆起：> 两环之间谷值', () => {
    const inner = crabTorusIntensity(CRAB_TORUS_INNER_RHO01, 0);
    const valley = crabTorusIntensity(
      (CRAB_TORUS_INNER_RHO01 + CRAB_TORUS_RING_RHO01) / 2,
      0,
    );
    expect(inner).toBeGreaterThan(valley);
  });

  it('非负输出；非法输入抛 RangeError', () => {
    expect(crabTorusIntensity(0.3, 0.1)).toBeGreaterThan(0);
    expect(() => crabTorusIntensity(-0.1, 0)).toThrow(RangeError);
    expect(() => crabTorusIntensity(Number.NaN, 0)).toThrow(RangeError);
    expect(() => crabTorusIntensity(0.5, Number.NaN)).toThrow(RangeError);
  });
});

describe('R4-16 crabColorWeight01（内 OIII 青弥散 / 外 Hα 红橙丝）', () => {
  it('内径以内恒 0（OIII）、外径以外恒 1（Hα）、中点单调过渡', () => {
    expect(crabColorWeight01(0)).toBe(0);
    expect(crabColorWeight01(CRAB_COLOR_WEIGHT_INNER_R)).toBe(0);
    expect(crabColorWeight01(CRAB_COLOR_WEIGHT_OUTER_R)).toBe(1);
    expect(crabColorWeight01(2)).toBe(1);
    const mid = crabColorWeight01(
      (CRAB_COLOR_WEIGHT_INNER_R + CRAB_COLOR_WEIGHT_OUTER_R) / 2,
    );
    expect(mid).toBeGreaterThan(0.4);
    expect(mid).toBeLessThan(0.6);
  });

  it('非法输入抛 RangeError', () => {
    expect(() => crabColorWeight01(-0.1)).toThrow(RangeError);
    expect(() => crabColorWeight01(Number.NaN)).toThrow(RangeError);
    expect(() => crabColorWeight01(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe('R4-16 确定性（附录 A §2：FNV-1a 种子）', () => {
  it('同种子双次构建逐字节一致（24³ 快速断言）', () => {
    const a = buildRgDensityData(24, makeCrabSampler());
    const b = buildRgDensityData(24, makeCrabSampler());
    expect(Buffer.compare(Buffer.from(a), Buffer.from(b))).toBe(0);
  });

  it('默认种子 = volumeSeed(crab-pulsar)；不同种子输出不同', () => {
    const def = buildRgDensityData(16, makeCrabSampler());
    const same = buildRgDensityData(16, makeCrabSampler(volumeSeed(CRAB_VOLUME_ID)));
    const other = buildRgDensityData(16, makeCrabSampler(volumeSeed('other-seed')));
    expect(Buffer.compare(Buffer.from(def), Buffer.from(same))).toBe(0);
    expect(Buffer.compare(Buffer.from(def), Buffer.from(other))).not.toBe(0);
  });
});

describe('R4-16 crabVolumeDetailLayerSpec（volume 池细节层规格）', () => {
  it('bodyId/kind 正确（与 M42/M57/马头同池，容量 1——巡游切换 LRU 逐出）', () => {
    const spec = crabVolumeDetailLayerSpec();
    expect(spec.bodyId).toBe('crab-pulsar');
    expect(spec.bodyId).toBe(CRAB_VOLUME_ID);
    expect(spec.kind).toBe('volume');
    expect(DETAIL_LRU_CAPACITY_BY_KIND.volume).toBe(1);
  });

  it('进入/退出阈值与 R2-7 近观层同源同值（交叉过渡无空档）', () => {
    const spec = crabVolumeDetailLayerSpec();
    expect(spec.enterDistanceUnits).toBe(nearViewEnterDistanceUnits('crab-pulsar'));
    expect(spec.exitDistanceUnits).toBe(nearViewExitDistanceUnits('crab-pulsar'));
    expect(spec.exitDistanceUnits).toBeCloseTo(spec.enterDistanceUnits * 1.4, 10);
  });

  it('GPU 预算：128³ RG 双通道 1B/通道 = 4 MB（§R4-16 指定 128³）', () => {
    const spec = crabVolumeDetailLayerSpec();
    expect(CRAB_TEXTURE_SIZE).toBe(128);
    expect(CRAB_TEXTURE_SIZE).toBeLessThanOrEqual(VOLUME_TEXTURE_MAX_SIZE);
    expect(spec.budget.volumeTexBytes).toBe(128 * 128 * 128 * 2);
    expect(spec.budget.volumeTexBytes).toBe(volumeTextureGpuBytes(CRAB_TEXTURE_SIZE, 2, 1));
    expect(spec.budget.gpuBytesEstimate).toBe(
      estimateGpuBytes({ volumeTexBytes: spec.budget.volumeTexBytes }),
    );
    expect(spec.budget.gpuBytesEstimate).toBeLessThanOrEqual(DETAIL_GPU_BUDGET_BYTES);
  });
});

describe('R4-16 crabVolumeBoxEdgeUnits（位姿尺度）', () => {
  it('边长 = 视觉尺寸 × 2.6（包络长半轴折算 ≈1.0× 视觉半径，与遗迹壳衔接）', () => {
    expect(CRAB_VOLUME_BOX_FACTOR).toBe(2.6);
    expect(crabVolumeBoxEdgeUnits(10)).toBeCloseTo(26, 10);
  });

  it('线性缩放；非正/非有限输入抛 RangeError', () => {
    expect(crabVolumeBoxEdgeUnits(24)).toBeCloseTo(crabVolumeBoxEdgeUnits(12) * 2, 10);
    expect(() => crabVolumeBoxEdgeUnits(0)).toThrow(RangeError);
    expect(() => crabVolumeBoxEdgeUnits(-1)).toThrow(RangeError);
    expect(() => crabVolumeBoxEdgeUnits(Number.NaN)).toThrow(RangeError);
  });
});

describe('R4-16 交叉淡出/透射补偿纯函数（§R4-16 第 3 条）', () => {
  it('crabBaseLayerFactor：vol01=0 时 = R2-7 现状（1 − 0.45·near01，零回退）', () => {
    for (const near01 of [0, 0.3, 0.7, 1]) {
      expect(crabBaseLayerFactor(near01, 0)).toBeCloseTo(1 - 0.45 * near01, 10);
    }
  });

  it('crabBaseLayerFactor：体积满时归零（遗迹壳 billboard 移交体积丝网）', () => {
    expect(crabBaseLayerFactor(0, 1)).toBe(0);
    expect(crabBaseLayerFactor(1, 1)).toBe(0);
    expect(crabBaseLayerFactor(0, 0.5)).toBeCloseTo(0.5, 10);
    expect(crabBaseLayerFactor(-1, 2)).toBe(0); // 越界钳制
  });

  it('crabNearLayerFactor：体积未激活时保持 R2-7 行为（= near01）', () => {
    for (const near01 of [0, 0.3, 0.7, 1]) {
      expect(crabNearLayerFactor(near01, 0)).toBeCloseTo(near01, 10);
    }
  });

  it('crabNearLayerFactor：体积淡入时同步淡出（+16 丝状云团移交登记）', () => {
    expect(crabNearLayerFactor(1, 1)).toBe(0);
    expect(crabNearLayerFactor(1, 0.5)).toBeCloseTo(0.5, 10);
    expect(crabNearLayerFactor(-1, 2)).toBe(0);
  });

  it('crabCoreBoostFactor：vol01=0 恒 1（零回退）、满值 1.6（透射补偿登记）', () => {
    expect(crabCoreBoostFactor(0)).toBe(1);
    expect(crabCoreBoostFactor(1)).toBeCloseTo(1.6, 10);
    expect(crabCoreBoostFactor(0.5)).toBeCloseTo(1.3, 10);
    expect(crabCoreBoostFactor(-1)).toBe(1);
    expect(crabCoreBoostFactor(2)).toBeCloseTo(1.6, 10);
  });
});

describe('R4-16 通用层配置（NebulaVolumeLayerConfig）与 PWN 尺度', () => {
  it('配置：id/纹理边长/内嵌中心脉冲星蓝白核 sprite/材质参数同源', () => {
    const config = crabVolumeLayerConfig();
    expect(config.volumeId).toBe(CRAB_VOLUME_ID);
    expect(config.textureSize).toBe(CRAB_TEXTURE_SIZE);
    expect(config.stars).toHaveLength(1);
    expect(config.stars[0].position).toEqual([0, 0, 0]);
    expect(config.params.densityScale).toBe(CRAB_SCENE_VOLUME_PARAMS.densityScale);
    expect(config.params.dustStrength).toBe(0); // 吸收通道恒零登记
    expect(config.logTag).toContain('R4-16');
    // 蓝白核色调（同步辐射色向）
    expect(config.starTint[2]).toBeGreaterThanOrEqual(config.starTint[0]);
  });

  it('双色权重经椭球归一化（weightInvRadii = 包络半轴倒数）', () => {
    const config = crabVolumeLayerConfig();
    const [ax, ay, az] = CRAB_ENVELOPE_RADII;
    expect(config.params.weightInvRadii).toEqual([1 / ax, 1 / ay, 1 / az]);
    expect(config.params.weightInnerR).toBe(CRAB_COLOR_WEIGHT_INNER_R);
    expect(config.params.weightOuterR).toBe(CRAB_COLOR_WEIGHT_OUTER_R);
  });

  it('makeSampler 与直接构造确定性一致', () => {
    const config = crabVolumeLayerConfig();
    const a = buildRgDensityData(16, config.makeSampler());
    const b = buildRgDensityData(16, makeCrabSampler());
    expect(Buffer.compare(Buffer.from(a), Buffer.from(b))).toBe(0);
  });

  it('PWN 尺度常数：环面半径/喷流长度系数为正且小于星云半径量级（夸大登记）', () => {
    expect(CRAB_PWN_TORUS_RADIUS_FACTOR).toBeGreaterThan(0);
    expect(CRAB_PWN_TORUS_RADIUS_FACTOR).toBeLessThan(1);
    expect(CRAB_PWN_JET_LENGTH_FACTOR).toBeGreaterThan(0);
    expect(CRAB_PWN_JET_LENGTH_FACTOR).toBeLessThanOrEqual(1);
    // 主环有效半径（环中径 × 几何半宽）≈ 0.30× 视觉半径
    expect(CRAB_PWN_TORUS_RADIUS_FACTOR * CRAB_TORUS_RING_RHO01).toBeCloseTo(0.2976, 3);
    // 丝半径远小于包络（丝状细结构自洽）
    expect(CRAB_FILAMENT_RADIUS).toBeLessThan(0.1);
  });
});

describe('R4-16 预览页注册（?body=crab-pulsar）', () => {
  it('crab-pulsar 已注册且 componentKey 为 crab-nebula-volume（体积类 HUD）', () => {
    const entry = previewEntryForBody('crab-pulsar');
    expect(entry).not.toBeNull();
    expect(entry!.componentKey).toBe('crab-nebula-volume');
    expect(VOLUME_PREVIEW_COMPONENT_KEYS.has('crab-nebula-volume')).toBe(true);
  });

  it('滑杆：步数/密度/亮度默认与主场景参数同源、无尘埃滑杆、总数 ≤8', () => {
    const entry = previewEntryForBody('crab-pulsar')!;
    expect(entry.params.length).toBeLessThanOrEqual(8);
    const steps = entry.params.find((p) => p.key === 'steps')!;
    expect(steps.default).toBe(CRAB_SCENE_VOLUME_PARAMS.baseSteps);
    const density = entry.params.find((p) => p.key === 'density')!;
    expect(density.default).toBe(CRAB_SCENE_VOLUME_PARAMS.densityScale);
    const intensity = entry.params.find((p) => p.key === 'intensity')!;
    expect(intensity.default).toBe(CRAB_SCENE_VOLUME_PARAMS.intensity);
    expect(entry.params.find((p) => p.key === 'dust')).toBeUndefined();
  });

  it('数据来源登记 Hubble 丝网形态参考 + Chandra 环面/喷流参考（§0.4）', () => {
    const entry = previewEntryForBody('crab-pulsar')!;
    expect(entry.dataSource).toContain('Hubble');
    expect(entry.dataSource).toContain('Chandra');
  });
});
