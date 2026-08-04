/**
 * R4-8 猎户座星云 M42 体积化 ②：主场景接入配置单测
 * （IMPROVEMENT_REQUIREMENTS_4 §R4-8）
 *
 * 覆盖：细节层规格（阈值与 R2-7 近观同源、GPU 预算 128³ RG = 4 MB、
 * volume 池容量约束）、包围盒尺度、交叉淡出权重纯函数（R2-7 行为零
 * 回退边界 + 单调性）、构建就绪淡入目标、默认参数登记。
 */

import {
  ORION_SCENE_VOLUME_PARAMS,
  ORION_VOLUME_BOX_FACTOR,
  ORION_VOLUME_STAR_SPRITE_FACTOR,
  orionBaseLayerFactor,
  orionPuffFactor,
  orionVolumeBoxEdgeUnits,
  orionVolumeDetailLayerSpec,
  orionVolumeFadeTarget,
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
import { M42_TEXTURE_SIZE, M42_VOLUME_ID } from '@/utils/nebulaVolume';
import { VOLUME_STEPS_MAX, VOLUME_STEPS_MIN } from '@/utils/volume';

describe('R4-8 orionVolumeDetailLayerSpec（volume 池细节层规格）', () => {
  it('bodyId/kind 正确（volume 池，与 store 跟随判据对齐）', () => {
    const spec = orionVolumeDetailLayerSpec();
    expect(spec.bodyId).toBe('orion-nebula');
    expect(spec.bodyId).toBe(M42_VOLUME_ID);
    expect(spec.kind).toBe('volume');
  });

  it('进入/退出阈值与 R2-7 近观层同源同值（同时机激活，交叉过渡无空档）', () => {
    const spec = orionVolumeDetailLayerSpec();
    expect(spec.enterDistanceUnits).toBe(nearViewEnterDistanceUnits('orion-nebula'));
    expect(spec.exitDistanceUnits).toBe(nearViewExitDistanceUnits('orion-nebula'));
  });

  it('退出阈值 = 进入阈值 × 1.4（滞回防抖，detailLayer 语义）', () => {
    const spec = orionVolumeDetailLayerSpec();
    expect(spec.exitDistanceUnits).toBeCloseTo(spec.enterDistanceUnits * 1.4, 10);
  });

  it('GPU 预算：128³ RG 双通道 1B/通道 = 4 MB，估算一致且在总预算内', () => {
    const spec = orionVolumeDetailLayerSpec();
    expect(spec.budget.volumeTexBytes).toBe(128 * 128 * 128 * 2);
    expect(spec.budget.volumeTexBytes).toBe(volumeTextureGpuBytes(M42_TEXTURE_SIZE, 2, 1));
    expect(spec.budget.gpuBytesEstimate).toBe(
      estimateGpuBytes({ volumeTexBytes: spec.budget.volumeTexBytes }),
    );
    expect(spec.budget.gpuBytesEstimate).toBeLessThanOrEqual(DETAIL_GPU_BUDGET_BYTES);
  });

  it('volume 池容量 1（附录 A：切换其他体积天体时 LRU 逐出）', () => {
    expect(DETAIL_LRU_CAPACITY_BY_KIND.volume).toBe(1);
  });
});

describe('R4-8 orionVolumeBoxEdgeUnits（位姿尺度）', () => {
  it('边长 = 视觉尺寸 × 2.6（与 R4-7 预览页观感比例一致）', () => {
    expect(ORION_VOLUME_BOX_FACTOR).toBe(2.6);
    expect(orionVolumeBoxEdgeUnits(12)).toBeCloseTo(31.2, 10);
    expect(orionVolumeBoxEdgeUnits(1)).toBeCloseTo(2.6, 10);
  });

  it('线性缩放（visualRadiusLy 变化时包围盒同步）', () => {
    expect(orionVolumeBoxEdgeUnits(24)).toBeCloseTo(orionVolumeBoxEdgeUnits(12) * 2, 10);
  });

  it('非正/非有限输入抛 RangeError', () => {
    expect(() => orionVolumeBoxEdgeUnits(0)).toThrow(RangeError);
    expect(() => orionVolumeBoxEdgeUnits(-1)).toThrow(RangeError);
    expect(() => orionVolumeBoxEdgeUnits(Number.NaN)).toThrow(RangeError);
    expect(() => orionVolumeBoxEdgeUnits(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe('R4-8 orionBaseLayerFactor（billboard 交叉淡出）', () => {
  it('vol01 = 0 时与 R2-7 现状逐点一致（行为零回退）', () => {
    for (const near01 of [0, 0.25, 0.5, 0.75, 1]) {
      expect(orionBaseLayerFactor(near01, 0)).toBeCloseTo(1 - 0.35 * near01, 10);
    }
  });

  it('体积淡入至满时 billboard 完全隐去；退出反向恢复', () => {
    expect(orionBaseLayerFactor(1, 1)).toBe(0);
    expect(orionBaseLayerFactor(0, 1)).toBe(0);
    // 反向恢复：vol01 回落后系数回升
    expect(orionBaseLayerFactor(1, 0.5)).toBeGreaterThan(orionBaseLayerFactor(1, 1));
    expect(orionBaseLayerFactor(1, 0)).toBeGreaterThan(orionBaseLayerFactor(1, 0.5));
  });

  it('对 vol01 单调不增，值域 [0,1]', () => {
    let prev = Number.POSITIVE_INFINITY;
    for (let v = 0; v <= 1.0001; v += 0.1) {
      const f = orionBaseLayerFactor(0.6, v);
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThanOrEqual(1);
      expect(f).toBeLessThanOrEqual(prev);
      prev = f;
    }
  });

  it('越界输入钳制（防御）', () => {
    expect(orionBaseLayerFactor(-1, -1)).toBe(1);
    expect(orionBaseLayerFactor(2, 2)).toBe(0);
  });
});

describe('R4-8 orionPuffFactor（PuffCloud 交叉淡出）', () => {
  it('体积未激活时保持 R2-7 行为（= near01）', () => {
    for (const near01 of [0, 0.3, 0.7, 1]) {
      expect(orionPuffFactor(near01, 0)).toBeCloseTo(near01, 10);
    }
  });

  it('体积淡入至满时团絮完全隐去', () => {
    expect(orionPuffFactor(1, 1)).toBe(0);
    expect(orionPuffFactor(0.5, 1)).toBe(0);
  });

  it('交叉中点：两层各半（0.5s 窗口内重叠无空档）', () => {
    expect(orionPuffFactor(1, 0.5)).toBeCloseTo(0.5, 10);
  });

  it('越界输入钳制', () => {
    expect(orionPuffFactor(2, -1)).toBe(1);
    expect(orionPuffFactor(-1, 2)).toBe(0);
  });
});

describe('R4-8 orionVolumeFadeTarget（构建就绪门控）', () => {
  it('烘焙未完成时目标恒为 0（billboard 保持，无过渡空档）', () => {
    expect(orionVolumeFadeTarget(0, false)).toBe(0);
    expect(orionVolumeFadeTarget(0.5, false)).toBe(0);
    expect(orionVolumeFadeTarget(1, false)).toBe(0);
  });

  it('就绪后跟随门控权重（钳制 [0,1]）', () => {
    expect(orionVolumeFadeTarget(0, true)).toBe(0);
    expect(orionVolumeFadeTarget(0.42, true)).toBeCloseTo(0.42, 10);
    expect(orionVolumeFadeTarget(1, true)).toBe(1);
    expect(orionVolumeFadeTarget(1.5, true)).toBe(1);
    expect(orionVolumeFadeTarget(-0.5, true)).toBe(0);
  });
});

describe('R4-8 ORION_SCENE_VOLUME_PARAMS（默认参数登记）', () => {
  it('基准步数在钳制范围内（自适应缩放后仍合法）', () => {
    const { baseSteps } = ORION_SCENE_VOLUME_PARAMS;
    expect(baseSteps).toBeGreaterThanOrEqual(VOLUME_STEPS_MIN);
    expect(baseSteps).toBeLessThanOrEqual(VOLUME_STEPS_MAX);
    // low 档 ×0.5 后不低于下限
    expect(baseSteps * 0.5).toBeGreaterThanOrEqual(VOLUME_STEPS_MIN);
  });

  it('密度/吸收/亮度为正；权重偏置在 [-1,1]', () => {
    expect(ORION_SCENE_VOLUME_PARAMS.densityScale).toBeGreaterThan(0);
    expect(ORION_SCENE_VOLUME_PARAMS.dustStrength).toBeGreaterThanOrEqual(0);
    expect(ORION_SCENE_VOLUME_PARAMS.intensity).toBeGreaterThan(0);
    expect(ORION_SCENE_VOLUME_PARAMS.weightBias).toBeGreaterThanOrEqual(-1);
    expect(ORION_SCENE_VOLUME_PARAMS.weightBias).toBeLessThanOrEqual(1);
  });

  it('自然色近似为合法 hex（Hα 红棕暖色 / OIII 青灰冷色，登记）', () => {
    const hex = /^#[0-9a-f]{6}$/;
    expect(ORION_SCENE_VOLUME_PARAMS.colorHa).toMatch(hex);
    expect(ORION_SCENE_VOLUME_PARAMS.colorOIII).toMatch(hex);
    // Hα 红棕：R 分量主导；OIII 青灰：G/B 不低于 R
    const rgb = (hex6: string): [number, number, number] => [
      parseInt(hex6.slice(1, 3), 16),
      parseInt(hex6.slice(3, 5), 16),
      parseInt(hex6.slice(5, 7), 16),
    ];
    const [har, hag, hab] = rgb(ORION_SCENE_VOLUME_PARAMS.colorHa);
    expect(har).toBeGreaterThan(hag);
    expect(har).toBeGreaterThan(hab);
    const [or, og, ob] = rgb(ORION_SCENE_VOLUME_PARAMS.colorOIII);
    expect(og).toBeGreaterThanOrEqual(or);
    expect(ob).toBeGreaterThanOrEqual(or);
  });

  it('星点 sprite 系数与 R4-7 预览页一致（0.12 × 盒边长）', () => {
    expect(ORION_VOLUME_STAR_SPRITE_FACTOR).toBe(0.12);
  });
});
