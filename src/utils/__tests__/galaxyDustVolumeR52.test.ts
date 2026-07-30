/**
 * R5-2 星系体积尘埃盘单元测试（IMPROVEMENT_REQUIREMENTS_5 §R5-2）
 *
 * 覆盖：覆盖清单与逐星系参数登记（LMC 弱档）、尘埃通道双线性采样、
 * 垂直指数薄层衰减、密度扩展（2D 图 × z 衰减伪 3D）体素构建（布局/
 * 确定性/降采样口径）、纯吸收透过率参考实现（与 R4-3
 * integrateEmissionAbsorption 离散格式交叉校验）、各向异性光程缩放
 * （斜视/侧视消光增强判据）、包围盒尺寸、volume 池细节层规格（与星云
 * 体积层同池容量 1、阈值与近观粒子层同源）、淡入目标、预览页滑杆注册。
 */

import {
  buildDustDiskDensityData,
  DUST_VOLUME_BASE_STEPS,
  DUST_VOLUME_GALAXY_IDS,
  DUST_VOLUME_MAP_GAMMA,
  DUST_VOLUME_TEX_BYTES,
  DUST_VOLUME_TEX_SIZE_XZ,
  DUST_VOLUME_TEX_SIZE_Y,
  dustDiskDensityAt,
  dustTransmittance,
  dustVerticalFalloff,
  dustVolumeFadeTarget,
  dustWorldStepScale,
  GALAXY_DUST_VOLUME_PARAMS,
  galaxyDustVolumeBoxUnits,
  galaxyDustVolumeDetailLayerSpec,
  galaxyDustVolumeParams,
  isDustVolumeGalaxy,
  sampleDustBilinear,
} from '@/utils/galaxyDustVolume';
import type { GalaxyChannelMap } from '@/utils/galaxyNearView';
import { galaxyNearViewEnterDistanceUnits } from '@/utils/galaxyNearView';
import { NEAR_VIEW_EXIT_RATIO } from '@/utils/nearView';
import {
  integrateEmissionAbsorption,
  VOLUME_STEPS_MAX,
  VOLUME_STEPS_MIN,
} from '@/utils/volume';
import {
  DETAIL_LRU_CAPACITY_BY_KIND,
  estimateGpuBytes,
  VOLUME_TEXTURE_MAX_SIZE,
} from '@/utils/detailLayer';
import { previewEntryForBody, previewHasVolumeLayer } from '@/utils/devPreview';

/** 构造测试用单通道图（行主序字节） */
function makeMap(size: number, fill: (col: number, row: number) => number): GalaxyChannelMap {
  const data = new Uint8Array(size * size);
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      data[row * size + col] = fill(col, row);
    }
  }
  return { size, data };
}

describe('R5-2 覆盖清单与逐星系参数登记', () => {
  it('覆盖 m31/m33/lmc（M31 打样 + M33/LMC 套用），smc/椭圆/未知不覆盖', () => {
    expect([...DUST_VOLUME_GALAXY_IDS]).toEqual(['m31', 'm33', 'lmc']);
    expect(isDustVolumeGalaxy('m31')).toBe(true);
    expect(isDustVolumeGalaxy('m33')).toBe(true);
    expect(isDustVolumeGalaxy('lmc')).toBe(true);
    expect(isDustVolumeGalaxy('smc')).toBe(false);
    expect(isDustVolumeGalaxy('m87')).toBe(false);
    expect(isDustVolumeGalaxy('unknown')).toBe(false);
  });

  it('LMC 消光强度为弱档（σ 显著小于旋涡星系，登记）', () => {
    const m31 = galaxyDustVolumeParams('m31');
    const m33 = galaxyDustVolumeParams('m33');
    const lmc = galaxyDustVolumeParams('lmc');
    expect(lmc.extinctionSigma).toBeLessThan(m33.extinctionSigma);
    expect(m33.extinctionSigma).toBeLessThan(m31.extinctionSigma);
    expect(lmc.extinctionSigma).toBeLessThanOrEqual(m31.extinctionSigma / 3);
  });

  it('登记参数合法：σ>0、盒厚>0、标高 h01 ∈(0,1]', () => {
    for (const id of DUST_VOLUME_GALAXY_IDS) {
      const p = GALAXY_DUST_VOLUME_PARAMS[id];
      expect(p.extinctionSigma).toBeGreaterThan(0);
      expect(p.boxThicknessLy).toBeGreaterThan(0);
      expect(p.h01).toBeGreaterThan(0);
      expect(p.h01).toBeLessThanOrEqual(1);
    }
  });

  it('未覆盖星系取参数抛 RangeError（注册期防错）', () => {
    expect(() => galaxyDustVolumeParams('smc')).toThrow(RangeError);
    expect(() => galaxyDustVolumeParams('m87')).toThrow(RangeError);
    expect(() => galaxyDustVolumeParams('')).toThrow(RangeError);
  });
});

describe('sampleDustBilinear 尘埃通道双线性采样', () => {
  const map = makeMap(4, (col, row) => (row === 0 ? col * 60 : 255));

  it('像素中心对齐：角点取角像素值', () => {
    expect(sampleDustBilinear(map, 0, 0)).toBeCloseTo(0, 10);
    expect(sampleDustBilinear(map, 1, 0)).toBeCloseTo(180 / 255, 10);
    expect(sampleDustBilinear(map, 0, 1)).toBeCloseTo(1, 10);
  });

  it('中点双线性插值', () => {
    // 行 0 内 u=1/6 → x=0.5：像素 0(0) 与 1(60) 均值 30
    expect(sampleDustBilinear(map, 1 / 6, 0)).toBeCloseTo(30 / 255, 10);
    // v=1/6 → z=0.5：行 0 (0) 与行 1 (255) 均值
    expect(sampleDustBilinear(map, 0, 1 / 6)).toBeCloseTo(255 / 2 / 255, 10);
  });

  it('越界坐标钳到边缘（ClampToEdge 语义）', () => {
    expect(sampleDustBilinear(map, -0.5, 0)).toBeCloseTo(0, 10);
    expect(sampleDustBilinear(map, 1.5, 0)).toBeCloseTo(180 / 255, 10);
    expect(sampleDustBilinear(map, 0, 2)).toBeCloseTo(1, 10);
  });

  it('输出恒 ∈[0,1]', () => {
    for (let i = 0; i <= 10; i += 1) {
      for (let j = 0; j <= 10; j += 1) {
        const v = sampleDustBilinear(map, i / 10, j / 10);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it('非法图尺寸/数据长度/非有限坐标抛 RangeError', () => {
    expect(() => sampleDustBilinear({ size: 1, data: new Uint8Array(1) }, 0, 0)).toThrow(
      RangeError,
    );
    expect(() => sampleDustBilinear({ size: 4, data: new Uint8Array(3) }, 0, 0)).toThrow(
      RangeError,
    );
    expect(() => sampleDustBilinear(map, NaN, 0)).toThrow(RangeError);
    expect(() => sampleDustBilinear(map, 0, Infinity)).toThrow(RangeError);
  });
});

describe('dustVerticalFalloff 垂直指数薄层（伪 3D z 向）', () => {
  it('归一化：中心 f(0)=1、盒边缘 f(±1)=0（无硬截断缝）', () => {
    expect(dustVerticalFalloff(0, 0.4)).toBeCloseTo(1, 10);
    expect(dustVerticalFalloff(1, 0.4)).toBeCloseTo(0, 10);
    expect(dustVerticalFalloff(-1, 0.4)).toBeCloseTo(0, 10);
    expect(dustVerticalFalloff(1.5, 0.4)).toBe(0);
  });

  it('随 |y| 单调递减且上下对称', () => {
    let prev = dustVerticalFalloff(0, 0.35);
    for (let i = 1; i <= 10; i += 1) {
      const y = i / 10;
      const v = dustVerticalFalloff(y, 0.35);
      expect(v).toBeLessThan(prev);
      expect(dustVerticalFalloff(-y, 0.35)).toBeCloseTo(v, 12);
      prev = v;
    }
  });

  it('指数形状：标高处衰减比与归一化指数一致', () => {
    const h = 0.4;
    const edge = Math.exp(-1 / h);
    const expected = (Math.exp(-1) - edge) / (1 - edge);
    expect(dustVerticalFalloff(h, h)).toBeCloseTo(expected, 12);
  });

  it('h01 越界（≤0/>1/非有限）与 y01 非有限抛 RangeError', () => {
    expect(() => dustVerticalFalloff(0, 0)).toThrow(RangeError);
    expect(() => dustVerticalFalloff(0, 1.2)).toThrow(RangeError);
    expect(() => dustVerticalFalloff(0, NaN)).toThrow(RangeError);
    expect(() => dustVerticalFalloff(NaN, 0.4)).toThrow(RangeError);
  });
});

describe('dustDiskDensityAt 密度参考采样（盘面图^γ × 垂直衰减可分离乘积）', () => {
  const map = makeMap(4, (col) => col * 80);

  it('= 双线性采样^γ × 垂直衰减（组合一致；γ=2 与 R4-10 尘埃粒子权重同口径）', () => {
    expect(DUST_VOLUME_MAP_GAMMA).toBe(2);
    const x01 = 0.3;
    const z01 = -0.4;
    const y01 = 0.5;
    const h01 = 0.4;
    expect(dustDiskDensityAt(map, x01, y01, z01, h01)).toBeCloseTo(
      Math.pow(sampleDustBilinear(map, (x01 + 1) / 2, (z01 + 1) / 2), DUST_VOLUME_MAP_GAMMA) *
        dustVerticalFalloff(y01, h01),
      12,
    );
  });

  it('盘面坐标口径：x→列 u、z→行 v（与 R5-1 sampleParticlesFromMap 一致）', () => {
    // 图沿列递增：x01=-1（列 0）密度 0，x01=1（列 3）最大
    expect(dustDiskDensityAt(map, -1, 0, 0, 0.4)).toBeCloseTo(0, 10);
    expect(dustDiskDensityAt(map, 1, 0, 0, 0.4)).toBeCloseTo((240 / 255) ** 2, 10);
  });

  it('对比度整形抬升暗带/弥散比（γ 次幂单调放大对比）', () => {
    const lane = dustDiskDensityAt(map, 1, 0, 0, 0.4); // dust01 高
    const diffuse = dustDiskDensityAt(map, -1 / 3, 0, 0, 0.4); // dust01 = 80/255
    expect(lane / diffuse).toBeGreaterThan((240 / 255) / (80 / 255) + 1);
  });
});

describe('buildDustDiskDensityData 体素构建（非立方 R8）', () => {
  const map = makeMap(8, (col, row) => ((col + row * 8) * 3) % 256);

  it('长度 = sizeXZ × sizeY × sizeXZ，布局 x + sx·(y + sy·z) 与参考采样一致', () => {
    const sx = 8;
    const sy = 4;
    const data = buildDustDiskDensityData(map, sx, sy, 0.4);
    expect(data.length).toBe(sx * sy * sx);
    // 逐体素对照参考实现（体素中心映射 (i+0.5)/n）
    for (const [x, y, z] of [
      [0, 0, 0],
      [3, 1, 5],
      [7, 3, 7],
      [4, 2, 1],
    ] as const) {
      const x01 = ((x + 0.5) / sx) * 2 - 1;
      const y01 = ((y + 0.5) / sy) * 2 - 1;
      const z01 = ((z + 0.5) / sx) * 2 - 1;
      const expected = Math.round(dustDiskDensityAt(map, x01, y01, z01, 0.4) * 255);
      expect(data[x + sx * (y + sy * z)]).toBe(expected);
    }
  });

  it('两次构建逐字节一致（确定性）', () => {
    const a = buildDustDiskDensityData(map, 8, 4, 0.35);
    const b = buildDustDiskDensityData(map, 8, 4, 0.35);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it('垂直边缘层密度趋零（归一化衰减，盒边界无硬缝）', () => {
    const sx = 8;
    const sy = 8;
    const data = buildDustDiskDensityData(map, sx, sy, 0.3);
    for (let z = 0; z < sx; z += 1) {
      for (let x = 0; x < sx; x += 1) {
        const edgeTop = data[x + sx * (0 + sy * z)];
        const edgeBottom = data[x + sx * (sy - 1 + sy * z)];
        const mid = data[x + sx * (sy / 2 + sy * z)];
        expect(edgeTop).toBeLessThanOrEqual(mid + 1);
        expect(edgeBottom).toBeLessThanOrEqual(mid + 1);
        expect(edgeTop).toBeLessThanOrEqual(Math.round(0.06 * 255));
      }
    }
  });

  it('分辨率越界（<2 / >128 / 非整数）抛 RangeError', () => {
    expect(() => buildDustDiskDensityData(map, 1, 4, 0.4)).toThrow(RangeError);
    expect(() => buildDustDiskDensityData(map, 8, VOLUME_TEXTURE_MAX_SIZE + 1, 0.4)).toThrow(
      RangeError,
    );
    expect(() => buildDustDiskDensityData(map, 8.5, 4, 0.4)).toThrow(RangeError);
  });

  it('登记纹理规格：128×32×128 各维 ≤128（附录 A）、512 KB', () => {
    expect(DUST_VOLUME_TEX_SIZE_XZ).toBeLessThanOrEqual(VOLUME_TEXTURE_MAX_SIZE);
    expect(DUST_VOLUME_TEX_SIZE_Y).toBeLessThanOrEqual(VOLUME_TEXTURE_MAX_SIZE);
    expect(DUST_VOLUME_TEX_BYTES).toBe(128 * 32 * 128);
  });
});

describe('dustTransmittance 纯吸收透过率（与 R4-3 离散格式交叉校验）', () => {
  it('解析一致：T = exp(-Σ ρσΔt)', () => {
    const densities = [0.2, 0.5, 0.8, 0.1];
    const t = dustTransmittance(densities, 0.05, 20);
    const tau = densities.reduce((s, d) => s + d * 20 * 0.05, 0);
    expect(t).toBeCloseTo(Math.exp(-tau), 12);
  });

  it('与 integrateEmissionAbsorption.transmittance 同式（发射置零仅取透过率）', () => {
    const densities = [0, 0.3, 0.9, 0.45, 0.12];
    const ref = integrateEmissionAbsorption(densities, 0.1, 8);
    expect(dustTransmittance(densities, 0.1, 8)).toBeCloseTo(ref.transmittance, 12);
  });

  it('零密度/零消光 → T=1；密度越高 T 单调下降', () => {
    expect(dustTransmittance([0, 0, 0], 0.1, 20)).toBe(1);
    expect(dustTransmittance([0.5], 0.1, 0)).toBe(1);
    expect(dustTransmittance([0.8], 0.1, 20)).toBeLessThan(
      dustTransmittance([0.4], 0.1, 20),
    );
  });

  it('非法入参（步长 ≤0、σ<0、密度负/非有限）抛 RangeError', () => {
    expect(() => dustTransmittance([0.5], 0, 20)).toThrow(RangeError);
    expect(() => dustTransmittance([0.5], -1, 20)).toThrow(RangeError);
    expect(() => dustTransmittance([0.5], 0.1, -1)).toThrow(RangeError);
    expect(() => dustTransmittance([-0.1], 0.1, 20)).toThrow(RangeError);
    expect(() => dustTransmittance([NaN], 0.1, 20)).toThrow(RangeError);
  });
});

describe('dustWorldStepScale 各向异性光程（斜视/侧视消光增强判据）', () => {
  it('最长轴归一化：薄盘 (w, t, w) → (1, t/w, 1)', () => {
    expect(dustWorldStepScale(10, 0.2, 10)).toEqual([1, 0.02, 1]);
    expect(dustWorldStepScale(2, 2, 2)).toEqual([1, 1, 1]);
  });

  it('侧视（穿盘面）与正视（穿薄轴）相对光程比 = 宽/厚（消光随倾角增强）', () => {
    const [sx, sy] = dustWorldStepScale(10, 0.2, 10);
    // 侧视方向 (1,0,0)：|d⊙s| = sx；正视方向 (0,1,0)：|d⊙s| = sy
    expect(sx / sy).toBeCloseTo(10 / 0.2, 10);
  });

  it('非正/非有限分量抛 RangeError', () => {
    expect(() => dustWorldStepScale(0, 1, 1)).toThrow(RangeError);
    expect(() => dustWorldStepScale(1, -1, 1)).toThrow(RangeError);
    expect(() => dustWorldStepScale(1, 1, NaN)).toThrow(RangeError);
  });
});

describe('galaxyDustVolumeBoxUnits 包围盒（与近观粒子层同口径对齐）', () => {
  it('盘面 x/z = 贴图平面全宽；y = 盒厚 × unitsPerLy（sizeUnits/2/mapRadiusLy）', () => {
    const box = galaxyDustVolumeBoxUnits('m31', 4, 75274);
    expect(box.x).toBe(4);
    expect(box.z).toBe(4);
    expect(box.y).toBeCloseTo(
      GALAXY_DUST_VOLUME_PARAMS.m31.boxThicknessLy * (4 / 2 / 75274),
      12,
    );
  });

  it('盘厚覆写（预览页滑杆）生效', () => {
    const box = galaxyDustVolumeBoxUnits('m31', 4, 75274, 5200);
    expect(box.y).toBeCloseTo(5200 * (4 / 2 / 75274), 12);
  });

  it('非法入参（尺寸/图半径/盘厚非正、未覆盖星系）抛 RangeError', () => {
    expect(() => galaxyDustVolumeBoxUnits('m31', 0, 75274)).toThrow(RangeError);
    expect(() => galaxyDustVolumeBoxUnits('m31', 4, 0)).toThrow(RangeError);
    expect(() => galaxyDustVolumeBoxUnits('m31', 4, 75274, -1)).toThrow(RangeError);
    expect(() => galaxyDustVolumeBoxUnits('smc', 4, 75274)).toThrow(RangeError);
  });
});

describe('galaxyDustVolumeDetailLayerSpec（volume 池，与星云体积层同池容量 1）', () => {
  it('kind=volume、阈值与近观粒子层同源（enter 同值、exit ×1.4 滞回）', () => {
    for (const id of DUST_VOLUME_GALAXY_IDS) {
      const spec = galaxyDustVolumeDetailLayerSpec(id);
      expect(spec.bodyId).toBe(id);
      expect(spec.kind).toBe('volume');
      const enter = galaxyNearViewEnterDistanceUnits(id);
      expect(spec.enterDistanceUnits).toBeCloseTo(enter, 12);
      expect(spec.exitDistanceUnits).toBeCloseTo(enter * NEAR_VIEW_EXIT_RATIO, 12);
    }
  });

  it('GPU 预算：volumeTexBytes = 512 KB，估算与 estimateGpuBytes 同源', () => {
    const spec = galaxyDustVolumeDetailLayerSpec('m31');
    expect(spec.budget.volumeTexBytes).toBe(DUST_VOLUME_TEX_BYTES);
    expect(spec.budget.gpuBytesEstimate).toBe(
      estimateGpuBytes({ volumeTexBytes: DUST_VOLUME_TEX_BYTES }),
    );
  });

  it('volume 池容量 1（与星云体积层互逐语义前提）', () => {
    expect(DETAIL_LRU_CAPACITY_BY_KIND.volume).toBe(1);
  });

  it('未覆盖星系抛 RangeError', () => {
    expect(() => galaxyDustVolumeDetailLayerSpec('smc')).toThrow(RangeError);
    expect(() => galaxyDustVolumeDetailLayerSpec('m87')).toThrow(RangeError);
  });
});

describe('dustVolumeFadeTarget 淡入目标（互斥切换无空档）', () => {
  it('就绪前恒 0（dust 暗粒子保持）、就绪后跟随门控', () => {
    expect(dustVolumeFadeTarget(0.7, false)).toBe(0);
    expect(dustVolumeFadeTarget(0.7, true)).toBe(0.7);
    expect(dustVolumeFadeTarget(0, true)).toBe(0);
    expect(dustVolumeFadeTarget(1, true)).toBe(1);
  });

  it('门控权重越界抛 RangeError', () => {
    expect(() => dustVolumeFadeTarget(-0.1, true)).toThrow(RangeError);
    expect(() => dustVolumeFadeTarget(1.1, true)).toThrow(RangeError);
    expect(() => dustVolumeFadeTarget(NaN, true)).toThrow(RangeError);
  });
});

describe('R5-2 预览页注册（消光强度/盘厚滑杆）', () => {
  it('m31/m33/lmc 条目含 volExtinction/volThicknessLy，默认值 = 登记值', () => {
    for (const id of DUST_VOLUME_GALAXY_IDS) {
      const entry = previewEntryForBody(id);
      expect(entry).not.toBeNull();
      const ext = entry!.params.find((p) => p.key === 'volExtinction');
      const thick = entry!.params.find((p) => p.key === 'volThicknessLy');
      expect(ext?.default).toBe(GALAXY_DUST_VOLUME_PARAMS[id].extinctionSigma);
      expect(ext?.min).toBe(0); // σ=0 = R4-10 暗粒子对照档
      expect(thick?.default).toBe(GALAXY_DUST_VOLUME_PARAMS[id].boxThicknessLy);
    }
  });

  it('smc 条目不含体积滑杆（不套用登记）', () => {
    const entry = previewEntryForBody('smc');
    expect(entry!.params.some((p) => p.key === 'volExtinction')).toBe(false);
  });

  it('previewHasVolumeLayer：m31/m33/lmc 为体积特例、smc 否', () => {
    expect(previewHasVolumeLayer(previewEntryForBody('m31'))).toBe(true);
    expect(previewHasVolumeLayer(previewEntryForBody('m33'))).toBe(true);
    expect(previewHasVolumeLayer(previewEntryForBody('lmc'))).toBe(true);
    expect(previewHasVolumeLayer(previewEntryForBody('smc'))).toBe(false);
  });

  it('基准步数在 R4-3 步数钳制域内', () => {
    expect(DUST_VOLUME_BASE_STEPS).toBeGreaterThanOrEqual(VOLUME_STEPS_MIN);
    expect(DUST_VOLUME_BASE_STEPS).toBeLessThanOrEqual(VOLUME_STEPS_MAX);
  });
});
