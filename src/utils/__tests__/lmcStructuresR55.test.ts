/**
 * R5-5 LMC 标志结构单元测试（IMPROVEMENT_REQUIREMENTS_5 §R5-5 A）
 *
 * 覆盖：30 Doradus 位置换算（gnomonic 切平面镜像 + 产物密度图落点
 * 亮区实证——"位置正确可辨"验收锚定）、影像帧常量与烘焙产物 meta
 * 一致性（单点同源防漂移）、可视化放大系数与包围盒尺度、中央棒椭圆
 * 权重（几何/各向异性/域）、applyLmcBarTint（副本语义/棒内偏黄/棒外
 * 零改动）、影像组合接入（= 采样 + 棒 tint 逐字节等价）、detailLayer
 * 预算登记（sprite + 48³ 纹理并入）、预览页滑杆注册与信息面板行。
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodePng } from '../../../scripts/bake-data/pngCodec.ts';
import {
  LMC_BAR_ANGLE_RAD,
  LMC_BAR_CENTER_LY,
  LMC_BAR_SEMI_MAJOR_LY,
  LMC_BAR_SEMI_MINOR_LY,
  LMC_BAR_TINT,
  LMC_BAR_TINT_BLEND,
  LMC_DISTANCE_LY,
  LMC_IMAGE_CENTER_DEC_DEG,
  LMC_IMAGE_CENTER_RA_DEG,
  LMC_IMAGE_CROP_RADIUS_DEG,
  LMC_LANDMARK_NOTE_ZH,
  LMC_LANDMARK_SOURCE_ZH,
  TARANTULA_BOX_EDGE_PER_RADIUS,
  TARANTULA_CLOUD_OPTIONS,
  TARANTULA_DEC_DEG,
  TARANTULA_RA_DEG,
  TARANTULA_REAL_RADIUS_LY,
  TARANTULA_SCALE_BOOST_DEFAULT,
  TARANTULA_SPRITE_COUNT,
  TARANTULA_VOLUME_TEXTURE_SIZE,
  lmcBarWeight01,
  skyToLmcDiskLy,
  tarantulaBoxEdgeUnits,
  tarantulaDiskPositionLy,
  tarantulaVisualRadiusLy,
} from '@/utils/lmcStructures';
import {
  applyLmcBarTint,
  galaxyComponentQuota,
  galaxyDetailLayerSpec,
  galaxyNearViewSeed,
  generateGalaxyNearViewCompositeFromMaps,
  imageDrivenThicknessLy,
  sampleParticlesFromMap,
  type GalaxyChannelMap,
  type GalaxyColorMapData,
  type GalaxyImageMaps,
  type GalaxyNearViewParticles,
} from '@/utils/galaxyNearView';
import {
  GPU_BYTES_PER_PARTICLE,
  estimateGpuBytes,
  volumeTextureGpuBytes,
} from '@/utils/detailLayer';
import { VOLUME_TEXTURE_MAX_SIZE } from '@/utils/volume';
import { MAX_PREVIEW_PARAMS, previewEntryForBody } from '@/utils/devPreview';
import { getBodyInfoById } from '@/data/catalog';

// ---------------------------------------------------------------------------
// 30 Doradus 位置换算（gnomonic 镜像 + 产物实证）
// ---------------------------------------------------------------------------

describe('skyToLmcDiskLy（SIMBAD → 盘面坐标换算，§R5-5 A 第 1 条）', () => {
  it('影像中心 → 原点', () => {
    const p = skyToLmcDiskLy(LMC_IMAGE_CENTER_RA_DEG, LMC_IMAGE_CENTER_DEC_DEG);
    expect(p.xLy).toBeCloseTo(0, 6);
    expect(p.zLy).toBeCloseTo(0, 6);
  });

  it('30 Dor 落点 = 登记锚定值（东北象限：东 = −x、北 = −z）', () => {
    const p = tarantulaDiskPositionLy();
    expect(p.xLy).toBeCloseTo(-3837, 0);
    expect(p.zLy).toBeCloseTo(-1746, 0);
    // 30 Dor 在 LMC 中心东偏北 → xLy/zLy 均为负（北上东左约定）
    expect(p.xLy).toBeLessThan(0);
    expect(p.zLy).toBeLessThan(0);
  });

  it('非有限输入抛 RangeError', () => {
    expect(() => skyToLmcDiskLy(Number.NaN, 0)).toThrow(RangeError);
    expect(() => skyToLmcDiskLy(0, Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });

  it('正东方向偏移 → 纯 −x 位移（方位约定锚定）', () => {
    // 与中心同 Dec、RA 偏东 1°：η ≈ 0（二阶小量）、ξ > 0 → xLy < 0
    const p = skyToLmcDiskLy(LMC_IMAGE_CENTER_RA_DEG + 1, LMC_IMAGE_CENTER_DEC_DEG);
    expect(p.xLy).toBeLessThan(0);
    expect(Math.abs(p.zLy)).toBeLessThan(Math.abs(p.xLy) * 0.02);
  });
});

describe('影像帧常量与烘焙产物一致性（单点同源防漂移）', () => {
  const metaPath = join(process.cwd(), 'public/data/galaxy-maps/lmc-meta.json');
  const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as {
    mapSizePx: number;
    mapRadiusLy: number;
  };

  it('mapRadiusLy = lyPerDeg(距离) × 裁剪半径（烘焙公式复算）', () => {
    const expected = (Math.PI / 180) * LMC_DISTANCE_LY * LMC_IMAGE_CROP_RADIUS_DEG;
    expect(meta.mapRadiusLy).toBeCloseTo(expected, 0);
  });

  it('30 Dor 落点在产物密度图上为饱和亮区（位置正确性实证）', () => {
    const png = decodePng(
      readFileSync(join(process.cwd(), 'public/data/galaxy-maps/lmc-density.png')),
    );
    expect(png.width).toBe(meta.mapSizePx);
    const p = tarantulaDiskPositionLy();
    const col = Math.round(((p.xLy / meta.mapRadiusLy + 1) / 2) * png.width);
    const row = Math.round(((p.zLy / meta.mapRadiusLy + 1) / 2) * png.height);
    const at = (c: number, r: number): number =>
      png.data[(r * png.width + c) * png.channels];
    expect(at(col, row)).toBe(255);
    // 5×5 邻域均值 ≥ 10× 全图均值（延展亮结而非孤立像素）
    let local = 0;
    for (let dr = -2; dr <= 2; dr += 1) {
      for (let dc = -2; dc <= 2; dc += 1) {
        local += at(col + dc, row + dr);
      }
    }
    local /= 25;
    let global = 0;
    for (let i = 0; i < png.width * png.height; i += 1) {
      global += png.data[i * png.channels];
    }
    global /= png.width * png.height;
    expect(local).toBeGreaterThan(global * 10);
  });
});

// ---------------------------------------------------------------------------
// 可视化放大系数与包围盒
// ---------------------------------------------------------------------------

describe('tarantulaVisualRadiusLy / tarantulaBoxEdgeUnits（放大系数登记）', () => {
  it('默认 = 真实半径 × 放大系数登记档', () => {
    expect(tarantulaVisualRadiusLy()).toBeCloseTo(
      TARANTULA_REAL_RADIUS_LY * TARANTULA_SCALE_BOOST_DEFAULT,
      10,
    );
    expect(tarantulaVisualRadiusLy(2)).toBeCloseTo(TARANTULA_REAL_RADIUS_LY * 2, 10);
  });

  it('可视化直径远小于盘直径（可辨不喧宾夺主：占比 < 15%）', () => {
    expect((tarantulaVisualRadiusLy() * 2) / 30000).toBeLessThan(0.15);
  });

  it('包围盒 = 可视化半径 × 系数 × unitsPerLy（线性）', () => {
    expect(tarantulaBoxEdgeUnits(1)).toBeCloseTo(
      tarantulaVisualRadiusLy() * TARANTULA_BOX_EDGE_PER_RADIUS,
      10,
    );
    expect(tarantulaBoxEdgeUnits(0.5, 2)).toBeCloseTo(
      tarantulaVisualRadiusLy(2) * TARANTULA_BOX_EDGE_PER_RADIUS * 0.5,
      10,
    );
  });

  it('非法输入抛 RangeError', () => {
    expect(() => tarantulaVisualRadiusLy(0)).toThrow(RangeError);
    expect(() => tarantulaVisualRadiusLy(-1)).toThrow(RangeError);
    expect(() => tarantulaVisualRadiusLy(Number.NaN)).toThrow(RangeError);
    expect(() => tarantulaBoxEdgeUnits(0)).toThrow(RangeError);
    expect(() => tarantulaBoxEdgeUnits(Number.NaN)).toThrow(RangeError);
  });

  it('体积纹理 48³ 在附录 A ≤128³ 约束内；球壳基元参数域合法', () => {
    expect(TARANTULA_VOLUME_TEXTURE_SIZE).toBeLessThanOrEqual(VOLUME_TEXTURE_MAX_SIZE);
    expect(TARANTULA_CLOUD_OPTIONS.radius).toBeGreaterThan(0);
    expect(TARANTULA_CLOUD_OPTIONS.radius).toBeLessThan(1);
    expect(TARANTULA_CLOUD_OPTIONS.coverage).toBeGreaterThan(0);
    expect(TARANTULA_CLOUD_OPTIONS.coverage).toBeLessThan(1);
  });
});

// ---------------------------------------------------------------------------
// 中央棒权重与色彩分层
// ---------------------------------------------------------------------------

describe('lmcBarWeight01（棒椭圆权重，拟合几何登记）', () => {
  it('棒中心满权重；椭圆外零权重', () => {
    expect(lmcBarWeight01(LMC_BAR_CENTER_LY.xLy, LMC_BAR_CENTER_LY.zLy)).toBe(1);
    expect(lmcBarWeight01(12000, 12000)).toBe(0);
    // 主轴端点之外（沿主轴 1.2× 半长轴）
    const cosA = Math.cos(LMC_BAR_ANGLE_RAD);
    const sinA = Math.sin(LMC_BAR_ANGLE_RAD);
    const d = LMC_BAR_SEMI_MAJOR_LY * 1.2;
    expect(
      lmcBarWeight01(LMC_BAR_CENTER_LY.xLy + d * cosA, LMC_BAR_CENTER_LY.zLy + d * sinA),
    ).toBe(0);
  });

  it('各向异性：同距离下主轴方向权重 > 短轴方向（棒为长椭圆）', () => {
    const cosA = Math.cos(LMC_BAR_ANGLE_RAD);
    const sinA = Math.sin(LMC_BAR_ANGLE_RAD);
    const d = LMC_BAR_SEMI_MINOR_LY; // 介于短轴与长轴之间的探针距离
    const alongMajor = lmcBarWeight01(
      LMC_BAR_CENTER_LY.xLy + d * cosA,
      LMC_BAR_CENTER_LY.zLy + d * sinA,
    );
    const alongMinor = lmcBarWeight01(
      LMC_BAR_CENTER_LY.xLy - d * sinA,
      LMC_BAR_CENTER_LY.zLy + d * cosA,
    );
    expect(alongMajor).toBeGreaterThan(alongMinor);
    expect(alongMajor).toBeGreaterThan(0.9);
  });

  it('权重域 [0,1] 单调衰减；非有限输入返回 0', () => {
    let prev = 1.01;
    const cosA = Math.cos(LMC_BAR_ANGLE_RAD);
    const sinA = Math.sin(LMC_BAR_ANGLE_RAD);
    for (let d = 0; d <= LMC_BAR_SEMI_MAJOR_LY * 1.3; d += 200) {
      const w = lmcBarWeight01(
        LMC_BAR_CENTER_LY.xLy + d * cosA,
        LMC_BAR_CENTER_LY.zLy + d * sinA,
      );
      expect(w).toBeGreaterThanOrEqual(0);
      expect(w).toBeLessThanOrEqual(prev + 1e-12);
      prev = w;
    }
    expect(lmcBarWeight01(Number.NaN, 0)).toBe(0);
    expect(lmcBarWeight01(0, Number.POSITIVE_INFINITY)).toBe(0);
  });
});

/** 构造两粒子集：一粒在棒中心、一粒远在盘外缘（蓝白色基准） */
function twoParticles(): GalaxyNearViewParticles {
  return {
    count: 2,
    positionsLy: new Float32Array([
      LMC_BAR_CENTER_LY.xLy,
      0,
      LMC_BAR_CENTER_LY.zLy,
      14000,
      0,
      14000,
    ]),
    colors: new Float32Array([0.5, 0.65, 0.9, 0.5, 0.65, 0.9]),
    sizes: new Float32Array([1, 1]),
  };
}

describe('applyLmcBarTint（棒区偏黄色彩分层，副本语义）', () => {
  it('棒中心粒子向偏黄 tint 混合满档；棒外粒子逐字节零改动', () => {
    const p = twoParticles();
    const out = applyLmcBarTint(p);
    // 棒中心：混合权重 = LMC_BAR_TINT_BLEND（权重 1）
    expect(out.colors[0]).toBeCloseTo(0.5 + (LMC_BAR_TINT.r - 0.5) * LMC_BAR_TINT_BLEND, 6);
    expect(out.colors[1]).toBeCloseTo(
      0.65 + (LMC_BAR_TINT.g - 0.65) * LMC_BAR_TINT_BLEND,
      6,
    );
    expect(out.colors[2]).toBeCloseTo(
      0.9 + (LMC_BAR_TINT.b - 0.9) * LMC_BAR_TINT_BLEND,
      6,
    );
    // 偏黄方向：红/绿升、蓝降（老年星族 vs 蓝白盘的分层可辨前提）
    expect(out.colors[0]).toBeGreaterThan(0.5);
    expect(out.colors[2]).toBeLessThan(0.9);
    // 棒外零改动（float32 存储值逐位一致）
    expect(out.colors[3]).toBe(Math.fround(0.5));
    expect(out.colors[4]).toBe(Math.fround(0.65));
    expect(out.colors[5]).toBe(Math.fround(0.9));
  });

  it('副本语义：入参 colors 不变，positions/sizes 引用复用', () => {
    const p = twoParticles();
    const out = applyLmcBarTint(p);
    expect(p.colors[0]).toBe(0.5);
    expect(out.colors).not.toBe(p.colors);
    expect(out.positionsLy).toBe(p.positionsLy);
    expect(out.sizes).toBe(p.sizes);
    expect(out.count).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 影像组合接入（lmc 基础层 = 采样 + 棒 tint）
// ---------------------------------------------------------------------------

const SIZE = 16;

function channelMap(fill: (col: number, row: number) => number): GalaxyChannelMap {
  const data = new Uint8Array(SIZE * SIZE);
  for (let row = 0; row < SIZE; row += 1) {
    for (let col = 0; col < SIZE; col += 1) {
      data[row * SIZE + col] = fill(col, row);
    }
  }
  return { size: SIZE, data };
}

function syntheticMaps(): GalaxyImageMaps {
  const color = new Uint8Array(SIZE * SIZE * 3);
  for (let i = 0; i < SIZE * SIZE; i += 1) {
    color[i * 3] = 120;
    color[i * 3 + 1] = 160;
    color[i * 3 + 2] = 230;
  }
  return {
    mapRadiusLy: 15647,
    density: channelMap(() => 128),
    color: { size: SIZE, data: color } satisfies GalaxyColorMapData,
    dust: channelMap(() => 0),
  };
}

describe('generateGalaxyNearViewCompositeFromMaps（R5-5 lmc 棒 tint 接入）', () => {
  it('lmc 影像基础层 = sampleParticlesFromMap + applyLmcBarTint 逐字节等价', () => {
    const maps = syntheticMaps();
    const composite = generateGalaxyNearViewCompositeFromMaps('lmc', maps);
    const raw = sampleParticlesFromMap(
      maps.density,
      maps.color,
      galaxyComponentQuota('lmc').base,
      galaxyNearViewSeed('lmc:map'),
      { mapRadiusLy: maps.mapRadiusLy, thicknessLy: imageDrivenThicknessLy('lmc') },
    );
    const expected = applyLmcBarTint(raw);
    expect(Buffer.from(composite.base.colors.buffer)).toEqual(
      Buffer.from(expected.colors.buffer),
    );
    expect(Buffer.from(composite.base.positionsLy.buffer)).toEqual(
      Buffer.from(raw.positionsLy.buffer),
    );
  });

  it('棒 tint 确定性：两次组合逐字节一致；smc 不套用（颜色 = 原采样）', () => {
    const maps = syntheticMaps();
    const a = generateGalaxyNearViewCompositeFromMaps('lmc', maps);
    const b = generateGalaxyNearViewCompositeFromMaps('lmc', maps);
    expect(Buffer.from(a.base.colors.buffer)).toEqual(Buffer.from(b.base.colors.buffer));
    const smc = generateGalaxyNearViewCompositeFromMaps('smc', maps);
    const smcRaw = sampleParticlesFromMap(
      maps.density,
      maps.color,
      galaxyComponentQuota('smc').base,
      galaxyNearViewSeed('smc:map'),
      { mapRadiusLy: maps.mapRadiusLy, thicknessLy: imageDrivenThicknessLy('smc') },
    );
    expect(Buffer.from(smc.base.colors.buffer)).toEqual(Buffer.from(smcRaw.colors.buffer));
  });
});

// ---------------------------------------------------------------------------
// detailLayer 预算登记（R5-5 lmc 例外）
// ---------------------------------------------------------------------------

describe('galaxyDetailLayerSpec lmc 预算（30 Dor 叠加层并入登记）', () => {
  it('particles = 配额 + R136 sprite；估算含 48³ R8 纹理', () => {
    const spec = galaxyDetailLayerSpec('lmc');
    const particles = galaxyComponentQuota('lmc').total + TARANTULA_SPRITE_COUNT;
    const texBytes = volumeTextureGpuBytes(TARANTULA_VOLUME_TEXTURE_SIZE, 1, 1);
    expect(spec.budget.particles).toBe(particles);
    expect(spec.budget.volumeTexBytes).toBe(texBytes);
    expect(spec.budget.gpuBytesEstimate).toBe(
      particles * GPU_BYTES_PER_PARTICLE + texBytes,
    );
    expect(spec.budget.gpuBytesEstimate).toBe(
      estimateGpuBytes({ particles, volumeTexBytes: texBytes }),
    );
    // 其余星系无 volumeTexBytes（零回退）
    expect(galaxyDetailLayerSpec('m31').budget.volumeTexBytes).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 预览页与信息面板（§R5-5 A 第 3 条）
// ---------------------------------------------------------------------------

describe('预览页 ?body=lmc 滑杆与信息面板行（§R5-5 A 第 3 条）', () => {
  it('lmc 条目含 dor30Boost/dor30Scale，默认 1/登记放大档，总数 = 8 上限内', () => {
    const entry = previewEntryForBody('lmc')!;
    const boost = entry.params.find((p) => p.key === 'dor30Boost');
    const scale = entry.params.find((p) => p.key === 'dor30Scale');
    expect(boost?.default).toBe(1);
    expect(boost?.min).toBe(0); // 0 = 关闭对照档
    expect(scale?.default).toBe(TARANTULA_SCALE_BOOST_DEFAULT);
    expect(entry.params.length).toBeLessThanOrEqual(MAX_PREVIEW_PARAMS);
    expect(entry.dataSource).toMatch(/SIMBAD/);
  });

  it('LMC 卡片含"标志结构"行 + dataSource 登记来源', () => {
    const info = getBodyInfoById('lmc')!;
    const landmark = info.lines.find((l) => l.label === '标志结构');
    expect(landmark?.value).toBe(LMC_LANDMARK_NOTE_ZH);
    expect(landmark?.value).toContain('30 Doradus');
    expect(landmark?.value).toContain('中央棒');
    expect(info.dataSource).toContain(LMC_LANDMARK_SOURCE_ZH);
    // 其余星系卡片无此行（零回退）
    expect(getBodyInfoById('m33')!.lines.some((l) => l.label === '标志结构')).toBe(false);
  });

  it('文案登记：30 Dor 放大系数与蜘蛛星云/R136 提及', () => {
    expect(LMC_LANDMARK_NOTE_ZH).toContain('蜘蛛星云');
    expect(LMC_LANDMARK_NOTE_ZH).toContain('R136');
    expect(LMC_LANDMARK_NOTE_ZH).toContain(`${TARANTULA_SCALE_BOOST_DEFAULT}×`);
    expect(LMC_LANDMARK_SOURCE_ZH).toContain('SIMBAD');
  });
});
