/**
 * R4-10 星系近观多分量 ②：渲染接入纯逻辑 + M31 专属细节单元测试
 * （IMPROVEMENT_REQUIREMENTS_4 §R4-10）
 *
 * 覆盖：M31 专属姿态（真实倾角 77°，inclinedOrientationRad 欧拉角构造
 * 与法线夹角复核）、10 kpc 尘埃环增强（环带聚集/无环零回退/确定性）、
 * 核球偏黄（applyBulgeTint 副本语义与混合域）、预览覆写入口
 * （GalaxyCompositeOverrides 配额缩放与域校验）、detailLayerSpec GPU
 * 估算迁移（多分量配额合计）、信息面板结构行扩展与 RC3/S4G 来源登记、
 * 预览页条目注册（?body=m31 / lmc 滑杆三件）。
 */

import { getGalaxyById } from '@/data/galaxies';
import {
  DUST_LANE_THICKNESS_FACTOR,
  GALAXY_MORPHOLOGY_PARAMS,
  GALAXY_NEAR_VIEW_CONFIGS,
  GALAXY_NEAR_VIEW_MAX_PARTICLES,
  GALAXY_STRUCTURE_NOTE_BY_MORPHOLOGY_ZH,
  GALAXY_STRUCTURE_SOURCE_ZH,
  M31_BULGE_TINT,
  M31_BULGE_TINT_BLEND,
  M31_DUST_RING,
  M31_INCLINATION_DEG,
  M31_POSITION_ANGLE_DEG,
  applyBulgeTint,
  applyOldDiskColorGradient,
  galaxyComponentQuota,
  galaxyDetailLayerSpec,
  galaxyNearViewOrientation,
  galaxyNearViewSeed,
  galaxyOrientationFromId,
  generateDustLaneParticles,
  generateGalaxyNearViewComposite,
  generateGalaxyNearViewParticles,
  inclinedOrientationRad,
  m31NearViewOrientationRad,
  type SpiralNearViewConfig,
} from '@/utils/galaxyNearView';
import { GPU_BYTES_PER_PARTICLE } from '@/utils/detailLayer';
import { galaxyPreviewConfigForBody, previewEntryForBody } from '@/utils/devPreview';

/** 欧拉角 XYZ（three.js 'XYZ' 约定 R = Rx·Ry·Rz）作用于向量 */
function applyEulerXYZ(
  e: readonly [number, number, number],
  v: readonly [number, number, number],
): [number, number, number] {
  // Rz
  let [x, y, z] = v;
  const [ex, ey, ez] = e;
  let c = Math.cos(ez);
  let s = Math.sin(ez);
  [x, y] = [x * c - y * s, x * s + y * c];
  // Ry
  c = Math.cos(ey);
  s = Math.sin(ey);
  [x, z] = [x * c + z * s, -x * s + z * c];
  // Rx
  c = Math.cos(ex);
  s = Math.sin(ex);
  [y, z] = [y * c - z * s, y * s + z * c];
  return [x, y, z];
}

/** 两向量夹角（度） */
function angleDeg(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): number {
  const la = Math.hypot(...a);
  const lb = Math.hypot(...b);
  const dot = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (la * lb);
  return (Math.acos(Math.max(-1, Math.min(1, dot))) * 180) / Math.PI;
}

const M31_CFG = GALAXY_NEAR_VIEW_CONFIGS.m31 as SpiralNearViewConfig;

describe('inclinedOrientationRad（倾角姿态构造，§R4-10）', () => {
  it('盘面法线（局部 +y 的世界像）与视线夹角 = 倾角（多组视线/倾角/方位角）', () => {
    const cases: Array<{ los: [number, number, number]; incl: number; pa: number }> = [
      { los: [0, 0, 1], incl: 0, pa: 0 },
      { los: [0, 0, 1], incl: 45, pa: 20 },
      { los: [0.5, -0.3, 0.8], incl: 77, pa: 38 },
      { los: [1, 0, 0], incl: 62, pa: 120 },
      { los: [0, 1, 0.1], incl: 30, pa: -45 },
    ];
    for (const { los, incl, pa } of cases) {
      const e = inclinedOrientationRad({ x: los[0], y: los[1], z: los[2] }, incl, pa);
      const normal = applyEulerXYZ(e, [0, 1, 0]);
      expect(angleDeg(normal, los)).toBeCloseTo(incl, 5);
    }
  });

  it('旋转正交性：局部基三像两两垂直且长度 1（欧拉角提取无失真）', () => {
    const e = inclinedOrientationRad({ x: 0.5, y: -0.3, z: 0.8 }, 77, 38);
    const ux = applyEulerXYZ(e, [1, 0, 0]);
    const uy = applyEulerXYZ(e, [0, 1, 0]);
    const uz = applyEulerXYZ(e, [0, 0, 1]);
    expect(Math.hypot(...ux)).toBeCloseTo(1, 9);
    expect(Math.hypot(...uy)).toBeCloseTo(1, 9);
    expect(Math.hypot(...uz)).toBeCloseTo(1, 9);
    expect(angleDeg(ux, uy)).toBeCloseTo(90, 6);
    expect(angleDeg(uy, uz)).toBeCloseTo(90, 6);
    expect(angleDeg(ux, uz)).toBeCloseTo(90, 6);
  });

  it('万向锁退化分支（m13=±1）仍精确：视线 +x、倾角 90°', () => {
    const e = inclinedOrientationRad({ x: 1, y: 0, z: 0 }, 90, 0);
    const normal = applyEulerXYZ(e, [0, 1, 0]);
    expect(angleDeg(normal, [1, 0, 0])).toBeCloseTo(90, 5);
    const uz = applyEulerXYZ(e, [0, 0, 1]);
    expect(Math.hypot(...uz)).toBeCloseTo(1, 9);
  });

  it('倾角越界 / 方位角非有限 / 零向量视线抛 RangeError', () => {
    const los = { x: 0, y: 0, z: 1 };
    expect(() => inclinedOrientationRad(los, -1, 0)).toThrow(RangeError);
    expect(() => inclinedOrientationRad(los, 91, 0)).toThrow(RangeError);
    expect(() => inclinedOrientationRad(los, Number.NaN, 0)).toThrow(RangeError);
    expect(() => inclinedOrientationRad(los, 45, Number.NaN)).toThrow(RangeError);
    expect(() => inclinedOrientationRad({ x: 0, y: 0, z: 0 }, 45, 0)).toThrow(RangeError);
  });

  it('视线近平行世界 +y 时破奇异（up 改用 +x），构造仍正交', () => {
    const e = inclinedOrientationRad({ x: 0, y: 1, z: 0 }, 45, 0);
    const uy = applyEulerXYZ(e, [0, 1, 0]);
    expect(angleDeg(uy, [0, 1, 0])).toBeCloseTo(45, 5);
  });
});

describe('M31 专属姿态（§R4-10：真实倾角 77°，其余星系沿用 id 哈希）', () => {
  it('登记值：倾角 77°（NED）、PA 38°', () => {
    expect(M31_INCLINATION_DEG).toBe(77);
    expect(M31_POSITION_ANGLE_DEG).toBe(38);
  });

  it('m31NearViewOrientationRad：盘面法线与原点→M31 视线夹角 = 77°', () => {
    const e = m31NearViewOrientationRad();
    const d = getGalaxyById('m31')!.direction;
    const normal = applyEulerXYZ(e, [0, 1, 0]);
    expect(angleDeg(normal, [d.x, d.y, d.z])).toBeCloseTo(77, 5);
  });

  it('galaxyNearViewOrientation：m31 = 专属姿态且 ≠ 旧哈希；非影像星系 = id 哈希公式（R5-1 等价迁移）', () => {
    expect(galaxyNearViewOrientation('m31')).toEqual(m31NearViewOrientationRad());
    expect(galaxyNearViewOrientation('m31')).not.toEqual(galaxyOrientationFromId('m31'));
    for (const id of Object.keys(GALAXY_NEAR_VIEW_CONFIGS)) {
      if (id === 'm31' || ['m33', 'lmc', 'smc'].includes(id)) continue;
      expect(galaxyNearViewOrientation(id)).toEqual(galaxyOrientationFromId(id));
    }
  });

  it('R5-1 修订：影像驱动（未反投影）星系盘面正对视线——影像已含投影，防双重投影登记', () => {
    for (const id of ['m33', 'lmc', 'smc'] as const) {
      const e = galaxyNearViewOrientation(id);
      const d = getGalaxyById(id)!.direction;
      const normal = applyEulerXYZ(e, [0, 1, 0]);
      // 盘面法线 ∥ 视线（倾角 0 = 正对）
      expect(angleDeg(normal, [d.x, d.y, d.z])).toBeCloseTo(0, 4);
      expect(galaxyNearViewOrientation(id)).not.toEqual(galaxyOrientationFromId(id));
    }
  });
});

describe('M31 10 kpc 尘埃环（§R4-10：dust 分量环状增强）', () => {
  const quota = galaxyComponentQuota('m31');
  const seed = galaxyNearViewSeed('m31:dust');

  it('登记值：环半径 32,600 光年（10 kpc）、占比 ∈ (0,1)、σ 为正', () => {
    expect(M31_DUST_RING.radiusLy).toBe(32600);
    expect(M31_DUST_RING.fraction).toBeGreaterThan(0);
    expect(M31_DUST_RING.fraction).toBeLessThan(1);
    expect(M31_DUST_RING.sigmaLy).toBeGreaterThan(0);
  });

  it('带环生成：环带（±3σ）内粒子占比显著高于无环基线（环状增强可辨）', () => {
    const withRing = generateDustLaneParticles(M31_CFG, quota.dust, seed, M31_DUST_RING);
    const without = generateDustLaneParticles(M31_CFG, quota.dust, seed);
    const inBand = (p: Float32Array, n: number): number => {
      let hits = 0;
      for (let i = 0; i < n; i += 1) {
        const r = Math.hypot(p[i * 3], p[i * 3 + 2]);
        if (Math.abs(r - M31_DUST_RING.radiusLy) <= 3 * M31_DUST_RING.sigmaLy) hits += 1;
      }
      return hits / n;
    };
    const ringShare = inBand(withRing.positionsLy, withRing.count);
    const baseShare = inBand(without.positionsLy, without.count);
    // 环粒子占比 fraction 全部落带内 → 带内占比至少接近 fraction
    expect(ringShare).toBeGreaterThanOrEqual(M31_DUST_RING.fraction * 0.85);
    expect(ringShare).toBeGreaterThan(baseShare + 0.2);
  });

  it('带环粒子仍守分布契约：盘面半径 ∈ [核球, 0.95×盘半径]、薄层、深棕 <0.3、尺寸 [1.6,2.6]', () => {
    const dust = generateDustLaneParticles(M31_CFG, quota.dust, seed, M31_DUST_RING);
    const maxAbsY = (M31_CFG.thicknessLy / 2) * DUST_LANE_THICKNESS_FACTOR * 3 + 1e-6;
    for (let i = 0; i < dust.count; i += 1) {
      const planarR = Math.hypot(dust.positionsLy[i * 3], dust.positionsLy[i * 3 + 2]);
      expect(planarR).toBeGreaterThanOrEqual(M31_CFG.bulgeRadiusLy - 1e-3);
      expect(planarR).toBeLessThanOrEqual(M31_CFG.diskRadiusLy * 0.95 + 1e-3);
      expect(Math.abs(dust.positionsLy[i * 3 + 1])).toBeLessThanOrEqual(maxAbsY);
      expect(dust.sizes[i]).toBeGreaterThanOrEqual(1.6);
      expect(dust.sizes[i]).toBeLessThanOrEqual(2.6);
    }
    for (let i = 0; i < dust.count * 3; i += 1) {
      expect(dust.colors[i]).toBeLessThan(0.3);
    }
  });

  it('确定性：带环两次生成逐字节一致；环占比越界抛 RangeError', () => {
    const a = generateDustLaneParticles(M31_CFG, quota.dust, seed, M31_DUST_RING);
    const b = generateDustLaneParticles(M31_CFG, quota.dust, seed, M31_DUST_RING);
    expect(Array.from(a.positionsLy)).toEqual(Array.from(b.positionsLy));
    expect(Array.from(a.colors)).toEqual(Array.from(b.colors));
    expect(Array.from(a.sizes)).toEqual(Array.from(b.sizes));
    expect(() =>
      generateDustLaneParticles(M31_CFG, 10, seed, { ...M31_DUST_RING, fraction: 1.5 }),
    ).toThrow(RangeError);
    expect(() =>
      generateDustLaneParticles(M31_CFG, 10, seed, { ...M31_DUST_RING, fraction: -0.1 }),
    ).toThrow(RangeError);
  });

  it('composite(m31) 的 dust 分量含环增强；其余旋涡（m33）不套用', () => {
    const m31 = generateGalaxyNearViewComposite('m31');
    const m31Dust = m31.components.find((c) => c.component === 'dust')!;
    const ringHits = (() => {
      let hits = 0;
      for (let i = 0; i < m31Dust.count; i += 1) {
        const r = Math.hypot(m31Dust.positionsLy[i * 3], m31Dust.positionsLy[i * 3 + 2]);
        if (Math.abs(r - M31_DUST_RING.radiusLy) <= 3 * M31_DUST_RING.sigmaLy) hits += 1;
      }
      return hits / m31Dust.count;
    })();
    expect(ringHits).toBeGreaterThanOrEqual(M31_DUST_RING.fraction * 0.85);
    // m33 dust 与无环直接生成逐字节一致
    const m33 = generateGalaxyNearViewComposite('m33');
    const m33Dust = m33.components.find((c) => c.component === 'dust')!;
    const m33Direct = generateDustLaneParticles(
      GALAXY_NEAR_VIEW_CONFIGS.m33 as SpiralNearViewConfig,
      galaxyComponentQuota('m33').dust,
      galaxyNearViewSeed('m33:dust'),
    );
    expect(Array.from(m33Dust.positionsLy)).toEqual(Array.from(m33Direct.positionsLy));
  });
});

describe('M31 核球偏黄（§R4-10：applyBulgeTint）', () => {
  it('副本语义：入参不变、positions/sizes 引用共享、colors 为新数组', () => {
    const raw = generateGalaxyNearViewParticles('m31');
    const before = Array.from(raw.colors);
    const tinted = applyBulgeTint(raw, M31_CFG);
    expect(Array.from(raw.colors)).toEqual(before);
    expect(tinted.positionsLy).toBe(raw.positionsLy);
    expect(tinted.sizes).toBe(raw.sizes);
    expect(tinted.colors).not.toBe(raw.colors);
  });

  it('核球内（3D 半径 ≤ 核球半径）粒子向偏黄 tint 混合；核球外逐字节不变', () => {
    const raw = generateGalaxyNearViewParticles('m31');
    const tinted = applyBulgeTint(raw, M31_CFG);
    let bulgeChanged = 0;
    for (let i = 0; i < raw.count; i += 1) {
      const r = Math.hypot(
        raw.positionsLy[i * 3],
        raw.positionsLy[i * 3 + 1],
        raw.positionsLy[i * 3 + 2],
      );
      const changed =
        tinted.colors[i * 3] !== raw.colors[i * 3] ||
        tinted.colors[i * 3 + 1] !== raw.colors[i * 3 + 1] ||
        tinted.colors[i * 3 + 2] !== raw.colors[i * 3 + 2];
      if (r > M31_CFG.bulgeRadiusLy) {
        expect(changed).toBe(false);
      } else if (changed) {
        bulgeChanged += 1;
        // 混合朝向 tint：各通道与 tint 的距离单调不增（偏黄方向）
        const tint = [M31_BULGE_TINT.r, M31_BULGE_TINT.g, M31_BULGE_TINT.b];
        for (let ch = 0; ch < 3; ch += 1) {
          const before = Math.abs(raw.colors[i * 3 + ch] - tint[ch]);
          const after = Math.abs(tinted.colors[i * 3 + ch] - tint[ch]);
          expect(after).toBeLessThanOrEqual(before + 1e-9);
        }
      }
    }
    expect(bulgeChanged).toBeGreaterThan(100);
  });

  it('tint 登记为暖黄（r > g > b）；blend 域校验抛 RangeError', () => {
    expect(M31_BULGE_TINT.r).toBeGreaterThan(M31_BULGE_TINT.g);
    expect(M31_BULGE_TINT.g).toBeGreaterThan(M31_BULGE_TINT.b);
    expect(M31_BULGE_TINT_BLEND).toBeGreaterThan(0);
    expect(M31_BULGE_TINT_BLEND).toBeLessThanOrEqual(1);
    const raw = generateGalaxyNearViewParticles('m31');
    expect(() => applyBulgeTint(raw, M31_CFG, M31_BULGE_TINT, -0.1)).toThrow(RangeError);
    expect(() => applyBulgeTint(raw, M31_CFG, M31_BULGE_TINT, 1.1)).toThrow(RangeError);
    expect(() => applyBulgeTint(raw, M31_CFG, M31_BULGE_TINT, Number.NaN)).toThrow(RangeError);
  });

  it('composite(m31).base = 色梯度 + 核球偏黄（对照仅梯度：核球区差异、盘区一致）', () => {
    const raw = generateGalaxyNearViewParticles('m31');
    const gradedOnly = applyOldDiskColorGradient(raw, M31_CFG);
    const base = generateGalaxyNearViewComposite('m31').base;
    let diffInBulge = 0;
    for (let i = 0; i < raw.count; i += 1) {
      const r3d = Math.hypot(
        raw.positionsLy[i * 3],
        raw.positionsLy[i * 3 + 1],
        raw.positionsLy[i * 3 + 2],
      );
      const same =
        base.colors[i * 3] === gradedOnly.colors[i * 3] &&
        base.colors[i * 3 + 1] === gradedOnly.colors[i * 3 + 1] &&
        base.colors[i * 3 + 2] === gradedOnly.colors[i * 3 + 2];
      if (r3d > M31_CFG.bulgeRadiusLy) {
        expect(same).toBe(true);
      } else if (!same) {
        diffInBulge += 1;
      }
    }
    expect(diffInBulge).toBeGreaterThan(100);
    // 其余旋涡（m33）不套用核球偏黄：base 与仅梯度逐字节一致
    const m33Raw = generateGalaxyNearViewParticles('m33');
    const m33Cfg = GALAXY_NEAR_VIEW_CONFIGS.m33 as SpiralNearViewConfig;
    expect(Array.from(generateGalaxyNearViewComposite('m33').base.colors)).toEqual(
      Array.from(applyOldDiskColorGradient(m33Raw, m33Cfg).colors),
    );
  });
});

describe('预览覆写入口（§R4-10：GalaxyCompositeOverrides）', () => {
  it('dust/HII 覆写线性缩放配额；域 [0,1] 内任意组合总量 ≤ 12,000', () => {
    const zero = galaxyComponentQuota('m31', { dustStrength: 0, hiiDensity: 0 });
    expect(zero.dust).toBe(0);
    expect(zero.hii).toBe(0);
    expect(zero.youngClusters).toBe(0);
    const full = galaxyComponentQuota('m31', { dustStrength: 1, hiiDensity: 1 });
    expect(full.dust).toBe(1600);
    expect(full.hii).toBe(140);
    expect(full.youngClusters).toBe(1000);
    for (const id of Object.keys(GALAXY_NEAR_VIEW_CONFIGS)) {
      const q = galaxyComponentQuota(id, { dustStrength: 1, hiiDensity: 1 });
      expect(q.total).toBeLessThanOrEqual(GALAXY_NEAR_VIEW_MAX_PARTICLES);
    }
  });

  it('undefined 覆写透传登记值（与无覆写一致）', () => {
    expect(galaxyComponentQuota('m31', {})).toEqual(galaxyComponentQuota('m31'));
    expect(galaxyComponentQuota('m31', { dustStrength: undefined })).toEqual(
      galaxyComponentQuota('m31'),
    );
  });

  it('覆写越界/NaN 抛 RangeError', () => {
    expect(() => galaxyComponentQuota('m31', { dustStrength: -0.1 })).toThrow(RangeError);
    expect(() => galaxyComponentQuota('m31', { dustStrength: 1.1 })).toThrow(RangeError);
    expect(() => galaxyComponentQuota('m31', { hiiDensity: Number.NaN })).toThrow(RangeError);
  });

  it('composite 覆写贯通：dust=0 → dust 分量空；HII 覆写改变 hii/星团数量', () => {
    const c = generateGalaxyNearViewComposite('m31', { dustStrength: 0, hiiDensity: 1 });
    const dust = c.components.find((p) => p.component === 'dust')!;
    const yc = c.components.find((p) => p.component === 'youngClusters')!;
    expect(dust.count).toBe(0);
    expect(yc.count).toBe(1000);
    expect(c.totalCount).toBeLessThanOrEqual(GALAXY_NEAR_VIEW_MAX_PARTICLES);
  });

  it('非旋涡覆写不产生分量（LMC 对照登记：新分量配额恒 0）', () => {
    const c = generateGalaxyNearViewComposite('lmc', { dustStrength: 1, hiiDensity: 1 });
    expect(c.components).toEqual([]);
    expect(c.totalCount).toBe(c.base.count);
  });
});

describe('galaxyDetailLayerSpec GPU 估算迁移（R4-9 登记项兑现）', () => {
  it('budget.particles = 多分量配额合计（m31 = 9,850）；估算 = 28 B/粒', () => {
    const spec = galaxyDetailLayerSpec('m31');
    expect(spec.budget.particles).toBe(9850);
    expect(spec.budget.gpuBytesEstimate).toBe(9850 * GPU_BYTES_PER_PARTICLE);
  });

  it('非旋涡：配额合计 = 基础层（阈值语义零回退）', () => {
    for (const id of ['m87', 'lmc', 'smc', 'm32']) {
      const spec = galaxyDetailLayerSpec(id);
      expect(spec.budget.particles).toBe(GALAXY_NEAR_VIEW_CONFIGS[id].particleCount);
    }
  });
});

describe('信息面板扩展（§R4-10：结构行 + RC3/S4G 来源）', () => {
  it('旋涡/棒旋结构行含尘埃带与 HII/年轻星团描述；椭圆标注无 dust/HII', () => {
    expect(GALAXY_STRUCTURE_NOTE_BY_MORPHOLOGY_ZH.spiral).toContain('尘埃带');
    expect(GALAXY_STRUCTURE_NOTE_BY_MORPHOLOGY_ZH.spiral).toContain('HII');
    expect(GALAXY_STRUCTURE_NOTE_BY_MORPHOLOGY_ZH.spiral).toContain('年轻星团');
    expect(GALAXY_STRUCTURE_NOTE_BY_MORPHOLOGY_ZH['barred-spiral']).toContain('尘埃带');
    expect(GALAXY_STRUCTURE_NOTE_BY_MORPHOLOGY_ZH.elliptical).toContain('无尘埃带/HII 区');
  });

  it('dataSource 追加 RC3/S4G（既有 Hubble/NED/Sérsic 登记保留）', () => {
    expect(GALAXY_STRUCTURE_SOURCE_ZH).toContain('RC3');
    expect(GALAXY_STRUCTURE_SOURCE_ZH).toContain('S4G');
    expect(GALAXY_STRUCTURE_SOURCE_ZH).toContain('NED');
    expect(GALAXY_STRUCTURE_SOURCE_ZH).toContain('Sérsic');
  });
});

describe('预览页注册（§R4-10：?body=m31 + 不规则对照 lmc；R5-1 等价迁移：滑杆增影像驱动开关）', () => {
  it('m31/lmc 条目注册且 componentKey = galaxy-near-view，滑杆四件（影像开关/dust/HII/倾角）', () => {
    for (const id of ['m31', 'lmc']) {
      const entry = previewEntryForBody(id);
      expect(entry).not.toBeNull();
      expect(entry!.componentKey).toBe('galaxy-near-view');
      expect(entry!.params.map((p) => p.key)).toEqual([
        'imageDriven',
        'dustStrength',
        'hiiDensity',
        'inclinationDeg',
      ]);
    }
  });

  it('默认值 = 形态参数表登记值（dust/HII；倾角：M31 = 77 反投影再倾转，LMC = 0 影像已含投影登记）', () => {
    for (const id of ['m31', 'lmc'] as const) {
      const entry = previewEntryForBody(id)!;
      const morph = GALAXY_MORPHOLOGY_PARAMS[id];
      const byKey = new Map(entry.params.map((p) => [p.key, p.default]));
      expect(byKey.get('dustStrength')).toBe(morph.dustStrength);
      expect(byKey.get('hiiDensity')).toBe(morph.hiiDensity);
      expect(byKey.get('imageDriven')).toBe(1);
      // R5-1 登记：M31 权重图已反投影到盘面 → 预览按真实倾角再倾转；
      // 其余星系影像未反投影（已含投影）→ 默认倾角 0
      expect(byKey.get('inclinationDeg')).toBe(id === 'm31' ? 77 : 0);
    }
  });

  it('dataSource 登记 RC3/S4G（附录 A §4）；星系预览配置映射一致', () => {
    expect(previewEntryForBody('m31')!.dataSource).toMatch(/RC3/);
    expect(previewEntryForBody('m31')!.dataSource).toMatch(/S4G/);
    expect(previewEntryForBody('lmc')!.dataSource).toMatch(/RC3/);
    expect(galaxyPreviewConfigForBody('m31')).toEqual({
      galaxyId: 'm31',
      positionAngleDeg: 38,
    });
    expect(galaxyPreviewConfigForBody('lmc')).toEqual({ galaxyId: 'lmc', positionAngleDeg: 0 });
    expect(galaxyPreviewConfigForBody('betelgeuse')).toBeNull();
    expect(galaxyPreviewConfigForBody(null)).toBeNull();
  });
});
