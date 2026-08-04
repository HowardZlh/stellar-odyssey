/**
 * R4-20 WR 124 星风抛射壳 + 脉冲星射束体积化单测
 * （IMPROVEMENT_REQUIREMENTS_4 §R4-20）
 *
 * 覆盖：M1-67 团块泡沫壳密度场（壳带定位/内外早退归零/团块泡沫离散性/
 * 吸收通道恒零/确定性 FNV-1a 种子，附录 A §2）、主场景接入配置（volume
 * 池规格 64³/包围盒/壳 mesh 交叉淡出零回退/光晕透射补偿/径向膨胀 CPU
 * 镜像与既有壳 mesh 动画同参）、通用层配置、预览页注册（?body=wr-124
 * 组合条目 + HUD 体积档行特例）、脉冲星射束体积锥密度塑形纯函数
 * （轴向幂律衰减 + 弦长边缘软化，shader GLSL 镜像）。
 */

import {
  buildRgDensityData,
  makeWr124Sampler,
  WR124_FOAM_EDGE_HI,
  WR124_FOAM_EDGE_LO,
  WR124_FOAM_FLOOR,
  WR124_SHELL_MID_R,
  WR124_SHELL_THICKNESS,
  WR124_TEXTURE_SIZE,
  WR124_VOLUME_ID,
  type NebulaSample,
} from '@/utils/nebulaVolume';
import { volumeSeed, VOLUME_TEXTURE_MAX_SIZE } from '@/utils/volume';
import {
  WR124_EXPAND_AMP,
  WR124_EXPAND_PERIOD_SEC,
  WR124_SCENE_VOLUME_PARAMS,
  WR124_VOLUME_BOX_FACTOR,
  wr124CoreBoostFactor,
  wr124ShellMeshFactor,
  wr124VolumeBoxEdgeUnits,
  wr124VolumeDetailLayerSpec,
  wr124VolumeExpansionScale,
  wr124VolumeLayerConfig,
} from '@/utils/nebulaVolumeScene';
import {
  DETAIL_GPU_BUDGET_BYTES,
  estimateGpuBytes,
  volumeTextureGpuBytes,
} from '@/utils/detailLayer';
import {
  nearViewEnterDistanceUnits,
  nearViewExitDistanceUnits,
} from '@/utils/nearView';
import {
  previewEntryForBody,
  previewHasVolumeLayer,
} from '@/utils/devPreview';
import {
  nebulaExpansionScale,
  PULSAR_BEAM_AXIAL_EXPONENT,
  PULSAR_BEAM_EDGE_EXPONENT,
  pulsarBeamAxial01,
  pulsarBeamChord01,
} from '@/utils/specialBodies';

/** 采样便捷封装（复用 scratch，返回发射/吸收副本） */
function sampleAt(
  sampler: ReturnType<typeof makeWr124Sampler>,
  x: number,
  y: number,
  z: number,
): NebulaSample {
  const out: NebulaSample = { emission: 0, absorption: 0 };
  sampler(x, y, z, out);
  return { ...out };
}

/** 确定性球面方向扫描（黄金角螺旋，无随机） */
function sphereDirections(count: number): (readonly [number, number, number])[] {
  const dirs: (readonly [number, number, number])[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i += 1) {
    const y = 1 - (2 * (i + 0.5)) / count;
    const r = Math.sqrt(1 - y * y);
    const phi = golden * i;
    dirs.push([r * Math.cos(phi), y, r * Math.sin(phi)] as const);
  }
  return dirs;
}

describe('R4-20 makeWr124Sampler（M1-67 团块泡沫壳密度场）', () => {
  const sampler = makeWr124Sampler();

  it('吸收通道恒零（M1-67 发射主导登记）', () => {
    for (const [dx, dy, dz] of sphereDirections(32)) {
      const r = WR124_SHELL_MID_R;
      expect(sampleAt(sampler, dx * r, dy * r, dz * r).absorption).toBe(0);
    }
  });

  it('壳内近空与壳外零密度（内/外早退门）', () => {
    // 中心与内腔（r < 0.2）
    expect(sampleAt(sampler, 0, 0, 0).emission).toBe(0);
    for (const [dx, dy, dz] of sphereDirections(16)) {
      expect(sampleAt(sampler, dx * 0.15, dy * 0.15, dz * 0.15).emission).toBe(0);
      // 外缘之外（r > 0.98 外早退门）
      expect(sampleAt(sampler, dx * 0.995, dy * 0.995, dz * 0.995).emission).toBe(0);
    }
  });

  it('壳带上存在显著发射（团块处 > 0.4）', () => {
    let peak = 0;
    for (const [dx, dy, dz] of sphereDirections(256)) {
      const r = WR124_SHELL_MID_R;
      const e = sampleAt(sampler, dx * r, dy * r, dz * r).emission;
      if (e > peak) peak = e;
    }
    expect(peak).toBeGreaterThan(0.4);
  });

  it('团块泡沫离散性：壳中面角向扫描同时存在"结"（亮）与"隙"（暗）', () => {
    const values = sphereDirections(512).map(([dx, dy, dz]) => {
      const r = WR124_SHELL_MID_R;
      return sampleAt(sampler, dx * r, dy * r, dz * r).emission;
    });
    const knots = values.filter((v) => v > 0.35).length;
    const gaps = values.filter((v) => v < 0.15).length;
    // 泡沫观感：两类区域都占可辨比例（>5%），非均匀壳
    expect(knots).toBeGreaterThan(values.length * 0.05);
    expect(gaps).toBeGreaterThan(values.length * 0.05);
  });

  it('密度值全部落在 [0,1]', () => {
    for (const [dx, dy, dz] of sphereDirections(64)) {
      for (const r of [0.3, 0.45, 0.6, 0.75, 0.9]) {
        const { emission } = sampleAt(sampler, dx * r, dy * r, dz * r);
        expect(emission).toBeGreaterThanOrEqual(0);
        expect(emission).toBeLessThanOrEqual(1);
      }
    }
  });

  it('确定性：同种子双次烘焙逐字节一致；不同种子输出不同（附录 A §2）', () => {
    const a = buildRgDensityData(24, makeWr124Sampler());
    const b = buildRgDensityData(24, makeWr124Sampler());
    expect(Buffer.compare(Buffer.from(a), Buffer.from(b))).toBe(0);
    const c = buildRgDensityData(24, makeWr124Sampler(volumeSeed('other-seed')));
    expect(Buffer.compare(Buffer.from(a), Buffer.from(c))).not.toBe(0);
  });

  it('形态常量域检查（64³ ≤ 上限；泡沫阈值/谷底在 (0,1) 且下 < 上）', () => {
    expect(WR124_TEXTURE_SIZE).toBe(64);
    expect(WR124_TEXTURE_SIZE).toBeLessThanOrEqual(VOLUME_TEXTURE_MAX_SIZE);
    expect(WR124_FOAM_EDGE_LO).toBeGreaterThan(0);
    expect(WR124_FOAM_EDGE_HI).toBeGreaterThan(WR124_FOAM_EDGE_LO);
    expect(WR124_FOAM_EDGE_HI).toBeLessThan(1);
    expect(WR124_FOAM_FLOOR).toBeGreaterThan(0);
    expect(WR124_FOAM_FLOOR).toBeLessThan(1);
    // 壳带（含厚度）全部落在归一化域内
    expect(WR124_SHELL_MID_R + WR124_SHELL_THICKNESS / 2).toBeLessThan(1);
    expect(WR124_SHELL_MID_R - WR124_SHELL_THICKNESS / 2).toBeGreaterThan(0);
  });
});

describe('R4-20 wr124VolumeDetailLayerSpec（volume 池细节层规格）', () => {
  it('规格：bodyId=wr-124、kind=volume、64³ RG 预算 512 KB', () => {
    const spec = wr124VolumeDetailLayerSpec();
    expect(spec.bodyId).toBe(WR124_VOLUME_ID);
    expect(spec.kind).toBe('volume');
    const expected = volumeTextureGpuBytes(WR124_TEXTURE_SIZE, 2, 1);
    expect(expected).toBe(64 * 64 * 64 * 2);
    expect(spec.budget.volumeTexBytes).toBe(expected);
    expect(spec.budget.gpuBytesEstimate).toBe(
      estimateGpuBytes({ volumeTexBytes: expected }),
    );
    expect(spec.budget.gpuBytesEstimate).toBeLessThanOrEqual(DETAIL_GPU_BUDGET_BYTES);
  });

  it('阈值与 R2-7/R4-18 近观层同源同值（同时机激活）', () => {
    const spec = wr124VolumeDetailLayerSpec();
    expect(spec.enterDistanceUnits).toBe(nearViewEnterDistanceUnits(WR124_VOLUME_ID));
    expect(spec.exitDistanceUnits).toBe(nearViewExitDistanceUnits(WR124_VOLUME_ID));
    expect(spec.exitDistanceUnits).toBeGreaterThan(spec.enterDistanceUnits);
  });
});

describe('R4-20 wr124VolumeBoxEdgeUnits（位姿尺度）', () => {
  it('边长 = 尺寸 × 6.0（壳中面 1.8× 视觉半径，与既有壳 mesh 1.9× 衔接）', () => {
    expect(WR124_VOLUME_BOX_FACTOR).toBe(6.0);
    expect(wr124VolumeBoxEdgeUnits(10)).toBeCloseTo(60, 10);
    // 壳中面世界半径 = 0.6 × 边长/2 = 1.8 × 尺寸
    expect((WR124_SHELL_MID_R * wr124VolumeBoxEdgeUnits(1)) / 2).toBeCloseTo(1.8, 10);
  });

  it('线性 + 非法输入抛 RangeError', () => {
    expect(wr124VolumeBoxEdgeUnits(24)).toBeCloseTo(wr124VolumeBoxEdgeUnits(12) * 2, 10);
    expect(() => wr124VolumeBoxEdgeUnits(0)).toThrow(RangeError);
    expect(() => wr124VolumeBoxEdgeUnits(-1)).toThrow(RangeError);
    expect(() => wr124VolumeBoxEdgeUnits(Number.NaN)).toThrow(RangeError);
  });
});

describe('R4-20 交叉淡出/透射补偿系数（零回退边界）', () => {
  it('wr124ShellMeshFactor：vol01=0 恒 1（现状零回退）→ 1 时壳 mesh 全隐', () => {
    expect(wr124ShellMeshFactor(0)).toBe(1);
    expect(wr124ShellMeshFactor(1)).toBe(0);
    expect(wr124ShellMeshFactor(0.5)).toBeCloseTo(0.5, 10);
    // 域外钳制
    expect(wr124ShellMeshFactor(-1)).toBe(1);
    expect(wr124ShellMeshFactor(2)).toBe(0);
  });

  it('wr124CoreBoostFactor：vol01=0 恒 1（零回退）→ 1 时 ×1.35（低于蟹状 0.6 档）', () => {
    expect(wr124CoreBoostFactor(0)).toBe(1);
    expect(wr124CoreBoostFactor(1)).toBeCloseTo(1.35, 10);
    expect(wr124CoreBoostFactor(0.5)).toBeCloseTo(1.175, 10);
    expect(wr124CoreBoostFactor(-1)).toBe(1);
    expect(wr124CoreBoostFactor(2)).toBeCloseTo(1.35, 10);
  });
});

describe('R4-20 径向膨胀（uTime 驱动，CPU 镜像与既有壳 mesh 动画同参）', () => {
  it('与 nebulaExpansionScale(t, 80, 0.14) 逐点一致（壳 mesh 同参登记）', () => {
    for (const t of [0, 7.5, 20, 40, 63.2, 80, 123.4]) {
      expect(wr124VolumeExpansionScale(t)).toBeCloseTo(
        nebulaExpansionScale(t, 80, 0.14),
        12,
      );
    }
  });

  it('GLSL 镜像公式：1 + amp·sin²(π·fract(t/period))；t=0 → 1、半周期 → 1+amp', () => {
    expect(wr124VolumeExpansionScale(0)).toBeCloseTo(1, 12);
    expect(wr124VolumeExpansionScale(WR124_EXPAND_PERIOD_SEC / 2)).toBeCloseTo(
      1 + WR124_EXPAND_AMP,
      12,
    );
    for (const t of [3, 11, 29, 55]) {
      const phase = (t / WR124_EXPAND_PERIOD_SEC) % 1;
      const expected = 1 + WR124_EXPAND_AMP * Math.sin(Math.PI * phase) ** 2;
      expect(wr124VolumeExpansionScale(t)).toBeCloseTo(expected, 12);
    }
  });

  it('配置参数与常量同源（expandAmp/expandPeriodSec 随材质透传）', () => {
    expect(WR124_SCENE_VOLUME_PARAMS.expandAmp).toBe(WR124_EXPAND_AMP);
    expect(WR124_SCENE_VOLUME_PARAMS.expandPeriodSec).toBe(WR124_EXPAND_PERIOD_SEC);
    expect(WR124_EXPAND_AMP).toBeGreaterThan(0);
    expect(WR124_EXPAND_PERIOD_SEC).toBeGreaterThan(0);
    // 膨胀满幅时壳外缘（早退门 ~0.98）仍在归一化域内（无切边）
    expect(0.98 * (1 + WR124_EXPAND_AMP)).toBeLessThanOrEqual(1.14);
  });
});

describe('R4-20 通用层配置（NebulaVolumeLayerConfig）', () => {
  it('配置字段：64³、weightBias=1（Hα 单色登记）、无内嵌星点、吸收恒零', () => {
    const config = wr124VolumeLayerConfig();
    expect(config.volumeId).toBe(WR124_VOLUME_ID);
    expect(config.textureSize).toBe(WR124_TEXTURE_SIZE);
    expect(config.params.weightBias).toBe(1);
    expect(config.params.dustStrength).toBe(0);
    expect(config.params.expandAmp).toBe(WR124_EXPAND_AMP);
    expect(config.params.expandPeriodSec).toBe(WR124_EXPAND_PERIOD_SEC);
    expect(config.stars).toHaveLength(0);
    expect(config.logTag).toContain('R4-20');
  });

  it('makeSampler 与默认种子采样器一致（确定性接线）', () => {
    const config = wr124VolumeLayerConfig();
    const a = buildRgDensityData(16, config.makeSampler());
    const b = buildRgDensityData(16, makeWr124Sampler());
    expect(Buffer.compare(Buffer.from(a), Buffer.from(b))).toBe(0);
  });
});

describe('R4-20 预览页注册（?body=wr-124 组合条目）', () => {
  it('wr-124 条目：stellar-surface 组合抛射壳滑杆两件（密度/膨胀幅度）', () => {
    const entry = previewEntryForBody('wr-124');
    expect(entry).not.toBeNull();
    expect(entry!.componentKey).toBe('stellar-surface');
    const density = entry!.params.find((p) => p.key === 'density')!;
    expect(density.default).toBe(WR124_SCENE_VOLUME_PARAMS.densityScale);
    const expand = entry!.params.find((p) => p.key === 'expandAmp')!;
    expect(expand.default).toBe(WR124_EXPAND_AMP);
    expect(expand.max).toBeGreaterThanOrEqual(WR124_EXPAND_AMP);
    // 相机外推：覆盖恒星 + 完整壳层（盒半宽 7 单位）
    expect(entry!.cameraDistance).toBeGreaterThan(7);
    expect(entry!.dataSource).toContain('M1-67');
  });

  it('previewHasVolumeLayer：wr-124 特例 true；其余恒星 false；体积条目 true', () => {
    expect(previewHasVolumeLayer(previewEntryForBody('wr-124'))).toBe(true);
    expect(previewHasVolumeLayer(previewEntryForBody('betelgeuse'))).toBe(false);
    expect(previewHasVolumeLayer(previewEntryForBody('crab-pulsar'))).toBe(true);
    expect(previewHasVolumeLayer(null)).toBe(false);
    expect(previewHasVolumeLayer(undefined)).toBe(false);
  });
});

describe('R4-20 脉冲星射束体积锥密度塑形（shader GLSL 镜像）', () => {
  it('pulsarBeamAxial01：根部 1 → 尖端 0，幂律单调递减', () => {
    expect(pulsarBeamAxial01(0)).toBe(1);
    expect(pulsarBeamAxial01(1)).toBe(0);
    let prev = pulsarBeamAxial01(0);
    for (let i = 1; i <= 20; i += 1) {
      const v = pulsarBeamAxial01(i / 20);
      expect(v).toBeLessThan(prev);
      prev = v;
    }
  });

  it('pulsarBeamAxial01：域外钳制 + 幂律指数镜像 + 非有限抛错', () => {
    expect(pulsarBeamAxial01(-0.5)).toBe(1);
    expect(pulsarBeamAxial01(1.5)).toBe(0);
    expect(pulsarBeamAxial01(0.5)).toBeCloseTo(
      Math.pow(0.5, PULSAR_BEAM_AXIAL_EXPONENT),
      12,
    );
    expect(() => pulsarBeamAxial01(Number.NaN)).toThrow(RangeError);
    expect(() => pulsarBeamAxial01(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });

  it('pulsarBeamChord01：轮廓边缘（n⊥v）→ 0 软消失、中心线 → 1（无硬边锥）', () => {
    expect(pulsarBeamChord01(0)).toBe(0);
    expect(pulsarBeamChord01(1)).toBe(1);
    let prev = pulsarBeamChord01(0);
    for (let i = 1; i <= 20; i += 1) {
      const v = pulsarBeamChord01(i / 20);
      expect(v).toBeGreaterThan(prev);
      prev = v;
    }
  });

  it('pulsarBeamChord01：正背面对称（DoubleSide）+ 域外钳制 + 非有限抛错', () => {
    for (const c of [0.2, 0.5, 0.9]) {
      expect(pulsarBeamChord01(-c)).toBeCloseTo(pulsarBeamChord01(c), 12);
    }
    expect(pulsarBeamChord01(1.5)).toBe(1);
    expect(pulsarBeamChord01(-1.5)).toBe(1);
    expect(pulsarBeamChord01(0.5)).toBeCloseTo(
      Math.pow(0.5, PULSAR_BEAM_EDGE_EXPONENT),
      12,
    );
    expect(() => pulsarBeamChord01(Number.NaN)).toThrow(RangeError);
  });
});
