/**
 * R4-14 环状星云 M57 壳层体积模型单测
 * （IMPROVEMENT_REQUIREMENTS_4 §R4-14）
 *
 * 覆盖：密度场关键点（§R4-14 验收：赤道环密度 > 极向、内腔低、吸收
 * 通道恒零、外晕弱壳）、椭球归一化双色权重、确定性（FNV-1a 种子，
 * 附录 A §2）、主场景接入配置（volume 池规格/包围盒/交叉淡出零回退）、
 * 通用层配置（M42 泛化等价 + M57 白矮星色档）、预览页注册。
 */

import {
  buildRgDensityData,
  M57_CAVITY_FILL,
  M57_COLOR_WEIGHT_INNER_R,
  M57_COLOR_WEIGHT_OUTER_R,
  M57_HALO_RADII_FACTOR,
  M57_POLAR_FLOOR,
  M57_SHELL_RADII,
  M57_TEXTURE_SIZE,
  M57_VOLUME_ID,
  M42_TEXTURE_SIZE,
  m57ColorWeight01,
  makeM57Sampler,
  trapeziumStarBoxPositions,
  type NebulaSample,
} from '@/utils/nebulaVolume';
import { volumeSeed, VOLUME_TEXTURE_MAX_SIZE } from '@/utils/volume';
import {
  M57_CENTRAL_STAR_TEFF_K,
  M57_SCENE_VOLUME_PARAMS,
  M57_VOLUME_BOX_FACTOR,
  M57_VOLUME_STAR_SPRITE_FACTOR,
  ORION_SCENE_VOLUME_PARAMS,
  ORION_VOLUME_STAR_SPRITE_FACTOR,
  m57BillboardFactor,
  m57NearLayerFactor,
  m57VolumeBoxEdgeUnits,
  m57VolumeDetailLayerSpec,
  m57VolumeLayerConfig,
  orionVolumeLayerConfig,
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
import { blackbodyRGB } from '@/utils/starPhysics';
import {
  previewEntryForBody,
  VOLUME_PREVIEW_COMPONENT_KEYS,
} from '@/utils/devPreview';

const [AX, AY, AZ] = M57_SHELL_RADII;

/** 采样便捷封装（复用 scratch，返回发射/吸收） */
function sampleAt(
  sampler: ReturnType<typeof makeM57Sampler>,
  x: number,
  y: number,
  z: number,
): NebulaSample {
  const out: NebulaSample = { emission: 0, absorption: 0 };
  sampler(x, y, z, out);
  return { ...out };
}

/** 赤道壳中面（qLen=1、z=0）沿方位角的发射均值 */
function equatorShellMean(sampler: ReturnType<typeof makeM57Sampler>, n = 16): number {
  let sum = 0;
  for (let i = 0; i < n; i += 1) {
    const theta = (Math.PI * 2 * i) / n;
    sum += sampleAt(sampler, AX * Math.cos(theta), AY * Math.sin(theta), 0).emission;
  }
  return sum / n;
}

/** 极向壳中面（qLen=1、±z 极点）的发射均值 */
function polarShellMean(sampler: ReturnType<typeof makeM57Sampler>): number {
  return (
    (sampleAt(sampler, 0, 0, AZ).emission + sampleAt(sampler, 0, 0, -AZ).emission) / 2
  );
}

describe('R4-14 m57ColorWeight01（椭球归一化双色权重，shader 同式镜像）', () => {
  it('内径以内为 0（OIII 青绿）、外径以外为 1（Hα/NII 红橙）', () => {
    expect(m57ColorWeight01(0)).toBe(0);
    expect(m57ColorWeight01(M57_COLOR_WEIGHT_INNER_R)).toBe(0);
    expect(m57ColorWeight01(M57_COLOR_WEIGHT_OUTER_R)).toBe(1);
    expect(m57ColorWeight01(2)).toBe(1);
  });

  it('区间内单调递增且中点为 0.5', () => {
    const mid = (M57_COLOR_WEIGHT_INNER_R + M57_COLOR_WEIGHT_OUTER_R) / 2;
    expect(m57ColorWeight01(mid)).toBeCloseTo(0.5, 10);
    let prev = -1;
    for (let i = 0; i <= 10; i += 1) {
      const q =
        M57_COLOR_WEIGHT_INNER_R +
        ((M57_COLOR_WEIGHT_OUTER_R - M57_COLOR_WEIGHT_INNER_R) * i) / 10;
      const w = m57ColorWeight01(q);
      expect(w).toBeGreaterThanOrEqual(prev);
      prev = w;
    }
  });

  it('壳中面（qLen=1）位于混色过渡带内（内缘偏青、外缘偏红可分层）', () => {
    expect(M57_COLOR_WEIGHT_INNER_R).toBeLessThan(1);
    expect(M57_COLOR_WEIGHT_OUTER_R).toBeGreaterThan(1);
  });

  it('负数 / 非有限输入抛 RangeError', () => {
    expect(() => m57ColorWeight01(-0.1)).toThrow(RangeError);
    expect(() => m57ColorWeight01(Number.NaN)).toThrow(RangeError);
    expect(() => m57ColorWeight01(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe('R4-14 M57 密度场关键采样点（§R4-14 验收：赤道环 > 极向、内腔低）', () => {
  const sampler = makeM57Sampler();

  it('赤道壳中面发射密度高（束状调制下限 0.55 × 赤道权重 1）', () => {
    expect(equatorShellMean(sampler)).toBeGreaterThan(0.4);
  });

  it('赤道环密度 > 极向暗瓣（≥2.5×；极向残余 ≈ POLAR_FLOOR 档）', () => {
    const equator = equatorShellMean(sampler);
    const polar = polarShellMean(sampler);
    expect(polar).toBeGreaterThan(0); // 暗瓣仍有残余（非撕裂）
    expect(equator).toBeGreaterThan(polar * 2.5);
    // 极向残余量级与登记档一致（束状调制 [0.55,1] 容差）
    expect(polar).toBeLessThanOrEqual(M57_POLAR_FLOOR * 1.2);
  });

  it('内腔近空：中心发射 ≈ 弱充盈档（≤0.1 且 ≪ 赤道壳）', () => {
    const cavity = sampleAt(sampler, 0, 0, 0).emission;
    expect(cavity).toBeLessThanOrEqual(0.1);
    expect(cavity).toBeCloseTo(M57_CAVITY_FILL, 5);
    expect(equatorShellMean(sampler)).toBeGreaterThan(cavity * 5);
  });

  it('外晕弱壳：晕中面发射为弱正值（远低于赤道壳）', () => {
    const halo = sampleAt(sampler, AX * M57_HALO_RADII_FACTOR, 0, 0).emission;
    expect(halo).toBeGreaterThan(0.01);
    expect(halo).toBeLessThan(0.15);
    expect(halo).toBeLessThan(equatorShellMean(sampler) * 0.3);
  });

  it('吸收通道恒零（M57 无前景尘埃登记；粗网格全域断言）', () => {
    const out: NebulaSample = { emission: 0, absorption: 0 };
    for (let zi = -1; zi <= 1; zi += 0.5) {
      for (let yi = -1; yi <= 1; yi += 0.5) {
        for (let xi = -1; xi <= 1; xi += 0.5) {
          sampler(xi, yi, zi, out);
          expect(out.absorption).toBe(0);
        }
      }
    }
  });

  it('晕外缘之外（域角落）发射为零（早退路径）', () => {
    expect(sampleAt(sampler, 1, 1, 1).emission).toBe(0);
    expect(sampleAt(sampler, -1, -1, 1).emission).toBe(0);
  });

  it('粗网格全域输出落在 [0,1]', () => {
    const out: NebulaSample = { emission: 0, absorption: 0 };
    for (let zi = -1; zi <= 1; zi += 0.25) {
      for (let yi = -1; yi <= 1; yi += 0.25) {
        for (let xi = -1; xi <= 1; xi += 0.25) {
          sampler(xi, yi, zi, out);
          expect(out.emission).toBeGreaterThanOrEqual(0);
          expect(out.emission).toBeLessThanOrEqual(1);
        }
      }
    }
  });
});

describe('R4-14 确定性（附录 A §2：FNV-1a 种子）', () => {
  it('同种子双次构建逐字节一致（24³ 快速断言）', () => {
    const a = buildRgDensityData(24, makeM57Sampler());
    const b = buildRgDensityData(24, makeM57Sampler());
    expect(Buffer.compare(Buffer.from(a), Buffer.from(b))).toBe(0);
  });

  it('默认种子 = volumeSeed(ring-nebula)；不同种子输出不同', () => {
    const def = buildRgDensityData(16, makeM57Sampler());
    const same = buildRgDensityData(16, makeM57Sampler(volumeSeed(M57_VOLUME_ID)));
    const other = buildRgDensityData(16, makeM57Sampler(volumeSeed('other-seed')));
    expect(Buffer.compare(Buffer.from(def), Buffer.from(same))).toBe(0);
    expect(Buffer.compare(Buffer.from(def), Buffer.from(other))).not.toBe(0);
  });
});

describe('R4-14 m57VolumeDetailLayerSpec（volume 池细节层规格）', () => {
  it('bodyId/kind 正确（与 M42 同池，容量 1——巡游切换 LRU 逐出）', () => {
    const spec = m57VolumeDetailLayerSpec();
    expect(spec.bodyId).toBe('ring-nebula');
    expect(spec.bodyId).toBe(M57_VOLUME_ID);
    expect(spec.kind).toBe('volume');
    expect(DETAIL_LRU_CAPACITY_BY_KIND.volume).toBe(1);
  });

  it('进入/退出阈值与 R2-7 近观层同源同值（交叉过渡无空档）', () => {
    const spec = m57VolumeDetailLayerSpec();
    expect(spec.enterDistanceUnits).toBe(nearViewEnterDistanceUnits('ring-nebula'));
    expect(spec.exitDistanceUnits).toBe(nearViewExitDistanceUnits('ring-nebula'));
    expect(spec.exitDistanceUnits).toBeCloseTo(spec.enterDistanceUnits * 1.4, 10);
  });

  it('GPU 预算：96³ RG 双通道 1B/通道 ≈ 1.69 MB（§R4-14 预算登记）', () => {
    const spec = m57VolumeDetailLayerSpec();
    expect(M57_TEXTURE_SIZE).toBe(96);
    expect(M57_TEXTURE_SIZE).toBeLessThanOrEqual(VOLUME_TEXTURE_MAX_SIZE);
    expect(spec.budget.volumeTexBytes).toBe(96 * 96 * 96 * 2);
    expect(spec.budget.volumeTexBytes).toBe(volumeTextureGpuBytes(M57_TEXTURE_SIZE, 2, 1));
    expect(spec.budget.gpuBytesEstimate).toBe(
      estimateGpuBytes({ volumeTexBytes: spec.budget.volumeTexBytes }),
    );
    expect(spec.budget.gpuBytesEstimate).toBeLessThanOrEqual(DETAIL_GPU_BUDGET_BYTES);
  });
});

describe('R4-14 m57VolumeBoxEdgeUnits（位姿尺度）', () => {
  it('边长 = 视觉尺寸 × 2.9（壳中面折算 ≈ 0.84× 视觉半径，与 R2-7 环径衔接）', () => {
    expect(M57_VOLUME_BOX_FACTOR).toBe(2.9);
    expect(m57VolumeBoxEdgeUnits(10)).toBeCloseTo(29, 10);
    // 壳中面世界半径 ≈ R2-7 环体粒子环径（0.85×size）量级
    expect((AX * M57_VOLUME_BOX_FACTOR) / 2).toBeCloseTo(0.85, 1);
  });

  it('线性缩放；非正/非有限输入抛 RangeError', () => {
    expect(m57VolumeBoxEdgeUnits(24)).toBeCloseTo(m57VolumeBoxEdgeUnits(12) * 2, 10);
    expect(() => m57VolumeBoxEdgeUnits(0)).toThrow(RangeError);
    expect(() => m57VolumeBoxEdgeUnits(-1)).toThrow(RangeError);
    expect(() => m57VolumeBoxEdgeUnits(Number.NaN)).toThrow(RangeError);
  });
});

describe('R4-14 交叉淡出纯函数（billboard/环粒子/外晕，§R4-14 第 3 条）', () => {
  it('m57BillboardFactor：vol01=0 时恒 1（R2-7 行为零回退）', () => {
    expect(m57BillboardFactor(0)).toBe(1);
  });

  it('m57BillboardFactor：体积淡入至满时完全隐去；单调不增 + 越界钳制', () => {
    expect(m57BillboardFactor(1)).toBe(0);
    expect(m57BillboardFactor(0.5)).toBeCloseTo(0.5, 10);
    expect(m57BillboardFactor(-1)).toBe(1);
    expect(m57BillboardFactor(2)).toBe(0);
  });

  it('m57NearLayerFactor：体积未激活时保持 R2-7 行为（= near01）', () => {
    for (const near01 of [0, 0.3, 0.7, 1]) {
      expect(m57NearLayerFactor(near01, 0)).toBeCloseTo(near01, 10);
    }
  });

  it('m57NearLayerFactor：体积淡入时同步淡出（+200 环向粒子移交登记）', () => {
    expect(m57NearLayerFactor(1, 1)).toBe(0);
    expect(m57NearLayerFactor(1, 0.5)).toBeCloseTo(0.5, 10);
    expect(m57NearLayerFactor(-1, 2)).toBe(0);
  });
});

describe('R4-14 通用层配置（NebulaVolumeLayerConfig：M42 泛化等价 + M57）', () => {
  it('M57 配置：id/纹理边长/单星点（中心白矮星）/材质参数同源', () => {
    const config = m57VolumeLayerConfig();
    expect(config.volumeId).toBe(M57_VOLUME_ID);
    expect(config.textureSize).toBe(M57_TEXTURE_SIZE);
    expect(config.stars).toHaveLength(1);
    expect(config.stars[0].position).toEqual([0, 0, 0]);
    expect(config.stars[0].scaleFactor).toBe(M57_VOLUME_STAR_SPRITE_FACTOR);
    expect(config.params.densityScale).toBe(M57_SCENE_VOLUME_PARAMS.densityScale);
    expect(config.params.colorOIII).toBe(M57_SCENE_VOLUME_PARAMS.colorOIII);
    expect(config.params.dustStrength).toBe(0); // 吸收通道恒零登记
    expect(config.logTag).toContain('R4-14');
  });

  it('M57 双色权重按椭球归一化（weightInvRadii = 1/半轴；core = 原点）', () => {
    const config = m57VolumeLayerConfig();
    expect(config.params.core).toEqual([0, 0, 0]);
    expect(config.params.weightInnerR).toBe(M57_COLOR_WEIGHT_INNER_R);
    expect(config.params.weightOuterR).toBe(M57_COLOR_WEIGHT_OUTER_R);
    expect(config.params.weightInvRadii).toEqual([1 / AX, 1 / AY, 1 / AZ]);
  });

  it('M57 白矮星 sprite 色档 = R4-6 blackbodyRGB（Teff 125 kK 经表上限钳制）', () => {
    const config = m57VolumeLayerConfig();
    expect(M57_CENTRAL_STAR_TEFF_K).toBe(125000);
    const rgb = blackbodyRGB(M57_CENTRAL_STAR_TEFF_K); // 内部钳制到 50 kK 档
    expect(config.starTint).toEqual([
      Math.round(rgb.r * 255),
      Math.round(rgb.g * 255),
      Math.round(rgb.b * 255),
    ]);
    // 偏蓝白（B 分量最大）
    expect(config.starTint[2]).toBeGreaterThan(config.starTint[0]);
  });

  it('M57 makeSampler 与直接构造确定性一致', () => {
    const config = m57VolumeLayerConfig();
    const a = buildRgDensityData(16, config.makeSampler());
    const b = buildRgDensityData(16, makeM57Sampler());
    expect(Buffer.compare(Buffer.from(a), Buffer.from(b))).toBe(0);
  });

  it('M42 泛化配置与 R4-8 现状等价（行为零回退：参数/星点/纹理边长）', () => {
    const config = orionVolumeLayerConfig();
    expect(config.volumeId).toBe('orion-nebula');
    expect(config.textureSize).toBe(M42_TEXTURE_SIZE);
    expect(config.params).toEqual(ORION_SCENE_VOLUME_PARAMS);
    expect(config.stars.map((s) => s.position)).toEqual(trapeziumStarBoxPositions());
    for (const s of config.stars) {
      expect(s.scaleFactor).toBe(ORION_VOLUME_STAR_SPRITE_FACTOR);
    }
    expect(config.starTint).toEqual([210, 225, 255]);
  });
});

describe('R4-14 预览页注册（?body=ring-nebula）', () => {
  it('ring-nebula 已注册且 componentKey 为 ring-nebula-volume（体积类 HUD）', () => {
    const entry = previewEntryForBody('ring-nebula');
    expect(entry).not.toBeNull();
    expect(entry!.componentKey).toBe('ring-nebula-volume');
    expect(VOLUME_PREVIEW_COMPONENT_KEYS.has('ring-nebula-volume')).toBe(true);
  });

  it('滑杆：步数默认 48（结构较简单）、双色权重 [-1,1]、总数 ≤ 上限且无尘埃滑杆', () => {
    const entry = previewEntryForBody('ring-nebula')!;
    expect(entry.params.length).toBeLessThanOrEqual(8);
    const steps = entry.params.find((p) => p.key === 'steps')!;
    expect(steps.default).toBe(48);
    expect(steps.min).toBe(16);
    expect(steps.max).toBe(128);
    const bias = entry.params.find((p) => p.key === 'weightBias')!;
    expect(bias.default).toBe(0);
    expect(bias.min).toBe(-1);
    expect(bias.max).toBe(1);
    expect(entry.params.find((p) => p.key === 'dust')).toBeUndefined();
    const density = entry.params.find((p) => p.key === 'density')!;
    expect(density.default).toBe(M57_SCENE_VOLUME_PARAMS.densityScale);
  });

  it("数据来源登记 O'Dell et al. 2013 三轴椭球壳模型（§0.4）", () => {
    const entry = previewEntryForBody('ring-nebula')!;
    expect(entry.dataSource).toContain("O'Dell");
    expect(entry.dataSource).toContain('三轴椭球壳');
  });
});
