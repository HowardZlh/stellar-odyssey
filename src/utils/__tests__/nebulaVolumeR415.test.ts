/**
 * R4-15 马头星云吸收体积单测
 * （IMPROVEMENT_REQUIREMENTS_4 §R4-15）
 *
 * 覆盖：密度场关键点（§R4-15 验收：马头轮廓内吸收高/轮廓外低、发射
 * 通道近零、IC 434 发射幕在轮廓后方为正）、轮廓组合 SDF、确定性
 * （FNV-1a 种子，附录 A §2）、主场景接入配置（volume 池规格/包围盒/
 * 交叉淡出零回退——背景幕布保留方案登记）、通用层配置、预览页注册。
 */

import {
  buildRgDensityData,
  HORSEHEAD_PILLAR_EMISSION_MAX,
  HORSEHEAD_PILLAR_PARTS,
  HORSEHEAD_SCREEN_LEVEL,
  HORSEHEAD_TEXTURE_SIZE,
  HORSEHEAD_VOLUME_ID,
  horseheadPillarSdf,
  makeHorseheadSampler,
  type NebulaSample,
} from '@/utils/nebulaVolume';
import { volumeSeed, VOLUME_TEXTURE_MAX_SIZE } from '@/utils/volume';
import {
  HORSEHEAD_SCENE_VOLUME_PARAMS,
  HORSEHEAD_VOLUME_BOX_FACTOR,
  horseheadCurtainFactor,
  horseheadNearLayerFactor,
  horseheadVolumeBoxEdgeUnits,
  horseheadVolumeDetailLayerSpec,
  horseheadVolumeLayerConfig,
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
  sampler: ReturnType<typeof makeHorseheadSampler>,
  x: number,
  y: number,
  z: number,
): NebulaSample {
  const out: NebulaSample = { emission: 0, absorption: 0 };
  sampler(x, y, z, out);
  return { ...out };
}

/** 轮廓部件中心（颈柱/头部/吻部/鬃丘/底部云堤，测试锚点） */
const NECK = HORSEHEAD_PILLAR_PARTS[0].center;
const HEAD = HORSEHEAD_PILLAR_PARTS[1].center;
const SNOUT = HORSEHEAD_PILLAR_PARTS[2].center;

/** 轮廓外参考点：前方（发射幕之前）/侧上方/侧后方（幕布区） */
const OUTSIDE_FRONT: readonly [number, number, number] = [0, 0.3, 0.6];
const OUTSIDE_SIDE: readonly [number, number, number] = [0.75, 0.7, 0];
const SCREEN_CLEAR: readonly [number, number, number] = [-0.6, 0.1, -0.5];

describe('R4-15 horseheadPillarSdf（马头轮廓组合 SDF，5 椭球平滑并）', () => {
  it('各部件中心在轮廓内（SDF < 0）', () => {
    for (const part of HORSEHEAD_PILLAR_PARTS) {
      const [cx, cy, cz] = part.center;
      expect(horseheadPillarSdf(cx, cy, cz)).toBeLessThan(0);
    }
  });

  it('域角落与前方远点在轮廓外（SDF > 0）', () => {
    expect(horseheadPillarSdf(1, 1, 1)).toBeGreaterThan(0);
    expect(horseheadPillarSdf(-1, 1, -1)).toBeGreaterThan(0);
    expect(horseheadPillarSdf(...OUTSIDE_FRONT)).toBeGreaterThan(0);
    expect(horseheadPillarSdf(...OUTSIDE_SIDE)).toBeGreaterThan(0);
  });

  it('颈柱与头部之间平滑连接（中间点仍在轮廓内——非分离团块）', () => {
    // 颈柱顶（y≈0）与头部底（y≈0）衔接带
    expect(horseheadPillarSdf(0, -0.05, 0)).toBeLessThan(0);
  });
});

describe('R4-15 马头密度场关键采样点（§R4-15 验收：轮廓内吸收高/外低、发射近零）', () => {
  const sampler = makeHorseheadSampler();

  it('轮廓内（颈柱/头部/吻部中心）吸收高（≥0.5）', () => {
    expect(sampleAt(sampler, ...NECK).absorption).toBeGreaterThanOrEqual(0.5);
    expect(sampleAt(sampler, ...HEAD).absorption).toBeGreaterThanOrEqual(0.5);
    expect(sampleAt(sampler, ...SNOUT).absorption).toBeGreaterThanOrEqual(0.4);
  });

  it('轮廓外吸收低（前方/侧上方/幕布区 ≤0.05）', () => {
    expect(sampleAt(sampler, ...OUTSIDE_FRONT).absorption).toBeLessThanOrEqual(0.05);
    expect(sampleAt(sampler, ...OUTSIDE_SIDE).absorption).toBeLessThanOrEqual(0.05);
    expect(sampleAt(sampler, ...SCREEN_CLEAR).absorption).toBeLessThanOrEqual(0.05);
  });

  it('马头轮廓内发射通道近零（≤ HORSEHEAD_PILLAR_EMISSION_MAX，冷分子云不发光）', () => {
    expect(HORSEHEAD_PILLAR_EMISSION_MAX).toBeLessThanOrEqual(0.02);
    expect(sampleAt(sampler, ...NECK).emission).toBeLessThanOrEqual(
      HORSEHEAD_PILLAR_EMISSION_MAX,
    );
    expect(sampleAt(sampler, ...HEAD).emission).toBeLessThanOrEqual(
      HORSEHEAD_PILLAR_EMISSION_MAX,
    );
    expect(sampleAt(sampler, ...SNOUT).emission).toBeLessThanOrEqual(
      HORSEHEAD_PILLAR_EMISSION_MAX,
    );
  });

  it('IC 434 发射幕：轮廓后方清空区发射为正（≥0.04），前方近零', () => {
    const screen = sampleAt(sampler, ...SCREEN_CLEAR).emission;
    expect(screen).toBeGreaterThanOrEqual(0.04);
    expect(screen).toBeLessThanOrEqual(HORSEHEAD_SCREEN_LEVEL);
    // 前方（幕布 z 前缘之前）发射近零：剪影 = 吸收柱遮挡后方幕布
    expect(sampleAt(sampler, ...OUTSIDE_FRONT).emission).toBeLessThanOrEqual(0.01);
    // 幕布发射远高于轮廓内残留（剪影对比度）
    expect(screen).toBeGreaterThan(sampleAt(sampler, ...HEAD).emission * 3);
  });

  it('域角落双通道为零（早退路径 + 盒边软窗防切边）', () => {
    for (const [x, y, z] of [
      [0.99, 0.99, 0.99],
      [-0.99, 0.99, 0.6],
    ] as const) {
      const s = sampleAt(sampler, x, y, z);
      expect(s.emission).toBe(0);
      expect(s.absorption).toBe(0);
    }
  });

  it('粗网格全域输出落在 [0,1]（双通道）', () => {
    const out: NebulaSample = { emission: 0, absorption: 0 };
    for (let zi = -1; zi <= 1; zi += 0.25) {
      for (let yi = -1; yi <= 1; yi += 0.25) {
        for (let xi = -1; xi <= 1; xi += 0.25) {
          sampler(xi, yi, zi, out);
          expect(out.emission).toBeGreaterThanOrEqual(0);
          expect(out.emission).toBeLessThanOrEqual(1);
          expect(out.absorption).toBeGreaterThanOrEqual(0);
          expect(out.absorption).toBeLessThanOrEqual(1);
        }
      }
    }
  });
});

describe('R4-15 确定性（附录 A §2：FNV-1a 种子）', () => {
  it('同种子双次构建逐字节一致（24³ 快速断言）', () => {
    const a = buildRgDensityData(24, makeHorseheadSampler());
    const b = buildRgDensityData(24, makeHorseheadSampler());
    expect(Buffer.compare(Buffer.from(a), Buffer.from(b))).toBe(0);
  });

  it('默认种子 = volumeSeed(horsehead-nebula)；不同种子输出不同', () => {
    const def = buildRgDensityData(16, makeHorseheadSampler());
    const same = buildRgDensityData(16, makeHorseheadSampler(volumeSeed(HORSEHEAD_VOLUME_ID)));
    const other = buildRgDensityData(16, makeHorseheadSampler(volumeSeed('other-seed')));
    expect(Buffer.compare(Buffer.from(def), Buffer.from(same))).toBe(0);
    expect(Buffer.compare(Buffer.from(def), Buffer.from(other))).not.toBe(0);
  });
});

describe('R4-15 horseheadVolumeDetailLayerSpec（volume 池细节层规格）', () => {
  it('bodyId/kind 正确（与 M42/M57 同池，容量 1——巡游切换 LRU 逐出）', () => {
    const spec = horseheadVolumeDetailLayerSpec();
    expect(spec.bodyId).toBe('horsehead-nebula');
    expect(spec.bodyId).toBe(HORSEHEAD_VOLUME_ID);
    expect(spec.kind).toBe('volume');
    expect(DETAIL_LRU_CAPACITY_BY_KIND.volume).toBe(1);
  });

  it('进入/退出阈值与 R2-7 近观层同源同值（交叉过渡无空档）', () => {
    const spec = horseheadVolumeDetailLayerSpec();
    expect(spec.enterDistanceUnits).toBe(nearViewEnterDistanceUnits('horsehead-nebula'));
    expect(spec.exitDistanceUnits).toBe(nearViewExitDistanceUnits('horsehead-nebula'));
    expect(spec.exitDistanceUnits).toBeCloseTo(spec.enterDistanceUnits * 1.4, 10);
  });

  it('GPU 预算：96³ RG 双通道 1B/通道 ≈ 1.69 MB（§R4-15 预算登记）', () => {
    const spec = horseheadVolumeDetailLayerSpec();
    expect(HORSEHEAD_TEXTURE_SIZE).toBe(96);
    expect(HORSEHEAD_TEXTURE_SIZE).toBeLessThanOrEqual(VOLUME_TEXTURE_MAX_SIZE);
    expect(spec.budget.volumeTexBytes).toBe(96 * 96 * 96 * 2);
    expect(spec.budget.volumeTexBytes).toBe(
      volumeTextureGpuBytes(HORSEHEAD_TEXTURE_SIZE, 2, 1),
    );
    expect(spec.budget.gpuBytesEstimate).toBe(
      estimateGpuBytes({ volumeTexBytes: spec.budget.volumeTexBytes }),
    );
    expect(spec.budget.gpuBytesEstimate).toBeLessThanOrEqual(DETAIL_GPU_BUDGET_BYTES);
  });
});

describe('R4-15 horseheadVolumeBoxEdgeUnits（位姿尺度）', () => {
  it('边长 = 视觉尺寸 × 2.0（马头全高折算 ≈ 1.7× 视觉半径，与剪影组衔接）', () => {
    expect(HORSEHEAD_VOLUME_BOX_FACTOR).toBe(2.0);
    expect(horseheadVolumeBoxEdgeUnits(10)).toBeCloseTo(20, 10);
  });

  it('线性缩放；非正/非有限输入抛 RangeError', () => {
    expect(horseheadVolumeBoxEdgeUnits(24)).toBeCloseTo(
      horseheadVolumeBoxEdgeUnits(12) * 2,
      10,
    );
    expect(() => horseheadVolumeBoxEdgeUnits(0)).toThrow(RangeError);
    expect(() => horseheadVolumeBoxEdgeUnits(-1)).toThrow(RangeError);
    expect(() => horseheadVolumeBoxEdgeUnits(Number.NaN)).toThrow(RangeError);
  });
});

describe('R4-15 交叉淡出纯函数（幕布/剪影/近观层，§R4-15 第 3 条）', () => {
  it('horseheadCurtainFactor：vol01=0 时恒 1（R2-7 行为零回退）', () => {
    expect(horseheadCurtainFactor(0)).toBe(1);
  });

  it('horseheadCurtainFactor：体积满时保留 65%（billboard 作幕布远景延伸登记）', () => {
    expect(horseheadCurtainFactor(1)).toBeCloseTo(0.65, 10);
    expect(horseheadCurtainFactor(0.5)).toBeCloseTo(0.825, 10);
    // 越界钳制
    expect(horseheadCurtainFactor(-1)).toBe(1);
    expect(horseheadCurtainFactor(2)).toBeCloseTo(0.65, 10);
  });

  it('horseheadNearLayerFactor：体积未激活时保持 R2-7 行为（= near01）', () => {
    for (const near01 of [0, 0.3, 0.7, 1]) {
      expect(horseheadNearLayerFactor(near01, 0)).toBeCloseTo(near01, 10);
    }
  });

  it('horseheadNearLayerFactor：体积淡入时同步淡出（2 视差发射层 + 3 暗云团移交登记）', () => {
    expect(horseheadNearLayerFactor(1, 1)).toBe(0);
    expect(horseheadNearLayerFactor(1, 0.5)).toBeCloseTo(0.5, 10);
    expect(horseheadNearLayerFactor(-1, 2)).toBe(0);
  });
});

describe('R4-15 通用层配置（NebulaVolumeLayerConfig）', () => {
  it('配置：id/纹理边长/无内嵌星点（冷分子云登记）/材质参数同源', () => {
    const config = horseheadVolumeLayerConfig();
    expect(config.volumeId).toBe(HORSEHEAD_VOLUME_ID);
    expect(config.textureSize).toBe(HORSEHEAD_TEXTURE_SIZE);
    expect(config.stars).toHaveLength(0);
    expect(config.params).toEqual(HORSEHEAD_SCENE_VOLUME_PARAMS);
    expect(config.logTag).toContain('R4-15');
  });

  it('吸收为主参数：dustStrength > 0、weightBias = +1（IC 434 Hα 单色登记）', () => {
    const config = horseheadVolumeLayerConfig();
    expect(config.params.dustStrength).toBeGreaterThan(0);
    expect(config.params.weightBias).toBe(1);
  });

  it('makeSampler 与直接构造确定性一致', () => {
    const config = horseheadVolumeLayerConfig();
    const a = buildRgDensityData(16, config.makeSampler());
    const b = buildRgDensityData(16, makeHorseheadSampler());
    expect(Buffer.compare(Buffer.from(a), Buffer.from(b))).toBe(0);
  });
});

describe('R4-15 预览页注册（?body=horsehead）', () => {
  it('horsehead 已注册且 componentKey 为 horsehead-nebula-volume（体积类 HUD）', () => {
    const entry = previewEntryForBody('horsehead');
    expect(entry).not.toBeNull();
    expect(entry!.componentKey).toBe('horsehead-nebula-volume');
    expect(VOLUME_PREVIEW_COMPONENT_KEYS.has('horsehead-nebula-volume')).toBe(true);
  });

  it('滑杆：步数默认 48、尘埃/密度默认与主场景参数同源、无双色权重滑杆、总数 ≤8', () => {
    const entry = previewEntryForBody('horsehead')!;
    expect(entry.params.length).toBeLessThanOrEqual(8);
    const steps = entry.params.find((p) => p.key === 'steps')!;
    expect(steps.default).toBe(HORSEHEAD_SCENE_VOLUME_PARAMS.baseSteps);
    const dust = entry.params.find((p) => p.key === 'dust')!;
    expect(dust.default).toBe(HORSEHEAD_SCENE_VOLUME_PARAMS.dustStrength);
    const density = entry.params.find((p) => p.key === 'density')!;
    expect(density.default).toBe(HORSEHEAD_SCENE_VOLUME_PARAMS.densityScale);
    expect(entry.params.find((p) => p.key === 'weightBias')).toBeUndefined();
  });

  it('数据来源登记 Hubble 公版轮廓参考 + 发射幕方案（§0.4）', () => {
    const entry = previewEntryForBody('horsehead')!;
    expect(entry.dataSource).toContain('Hubble');
    expect(entry.dataSource).toContain('IC 434');
  });
});
