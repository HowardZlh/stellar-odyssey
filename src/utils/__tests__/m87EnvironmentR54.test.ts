/**
 * R5-4 M87 纵深与星系团环境单测（IMPROVEMENT_REQUIREMENTS_5 §R5-4）：
 * 喷流节点参数/球状星团分布/室女座成员筛选/EHT 联动阈值与参数档/
 * 细节层规格/信息面板补行/预览页条目与预设视角校验。
 * 含真实产物集成断言（public/data/galaxy-catalog.bin 成员筛选）。
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import {
  M87_CORE_LENSED_CONFIG,
  M87_CORE_LENSING_DOMAIN_UNITS,
  M87_CORE_LENSING_ENTER_UNITS,
  M87_CORE_RS_WORLD_UNITS,
  M87_DISTANCE_MPC,
  M87_ENVIRONMENT_PARTICLES,
  M87_GC_COUNT,
  M87_GC_EFFECTIVE_RADIUS_LY,
  M87_GC_MAX_RADIUS_LY,
  M87_ICM_RADIUS_UNITS,
  M87_EXTRA_INFO_LINES_ZH,
  M87_JET_KNOTS,
  M87_JET_KNOT_DRIFT_PER_SEC,
  VIRGO_MEMBER_MAX_COUNT,
  VIRGO_MEMBER_MAX_OFFSET_UNITS,
  VIRGO_MEMBER_SHELL_MAX_MPC,
  VIRGO_MEMBER_SHELL_MIN_MPC,
  VIRGO_MEMBER_UNITS_PER_MPC,
  assertM87EnvironmentConfig,
  m87CoreLensingDetailLayerSpec,
  m87EnvironmentDetailLayerSpec,
  m87JetKnotOpacity01,
  m87JetKnotT01,
  sampleM87GlobularClusters,
  virgoMemberPoints,
} from '@/utils/m87Environment';
import {
  BLACK_HOLE_LENSED_CONFIGS,
  blackHoleRsWorldUnits,
} from '@/utils/blackHoleScene';
import { LENSING_DOMAIN_RADIUS_RS } from '@/utils/blackHoleLensing';
import { DETAIL_GPU_BUDGET_BYTES, estimateGpuBytes } from '@/utils/detailLayer';
import { NEAR_VIEW_EXIT_RATIO } from '@/utils/nearView';
import { galaxyNearViewEnterDistanceUnits } from '@/utils/galaxyNearView';
import { validateGalaxyCatalog, type GalaxyCatalogData } from '@/utils/bakedData';
import {
  JK_TIER_UNKNOWN,
  LY_PER_MPC,
  VIRGO_DEC_DEG,
  VIRGO_RA_DEG,
  equatorialToSupergalacticUnit,
  packCatalogW,
} from '@/utils/galaxyCatalogCore';
import { getSpecialBodyById } from '@/data/specialBodies';
import { SCENE_UNITS_PER_LY } from '@/utils/scale';
import { getBodyInfoById } from '@/data/catalog';
import {
  previewEntryForBody,
  previewMinCameraDistance,
  validatePreviewEntry,
  type PreviewEntry,
} from '@/utils/devPreview';

// ---------------------------------------------------------------------------
// 喷流节点
// ---------------------------------------------------------------------------

describe('M87 喷流节点（HST-1 类）', () => {
  it('节点数在 3–5 且沿轴位置递增、亮度递减（首节点最亮 = HST-1 类）', () => {
    expect(M87_JET_KNOTS.length).toBeGreaterThanOrEqual(3);
    expect(M87_JET_KNOTS.length).toBeLessThanOrEqual(5);
    expect(M87_JET_KNOTS[0].brightness).toBe(1);
    for (let i = 1; i < M87_JET_KNOTS.length; i += 1) {
      expect(M87_JET_KNOTS[i].t0).toBeGreaterThan(M87_JET_KNOTS[i - 1].t0);
      expect(M87_JET_KNOTS[i].brightness).toBeLessThan(M87_JET_KNOTS[i - 1].brightness);
    }
  });

  it('外移相位：t=0 为基准位置、随时间缓慢外移并循环回绕', () => {
    expect(m87JetKnotT01(0.2, 0)).toBeCloseTo(0.2, 12);
    const dt = 10;
    expect(m87JetKnotT01(0.2, dt)).toBeCloseTo(0.2 + dt * M87_JET_KNOT_DRIFT_PER_SEC, 12);
    // 回绕：一个完整周期后回到基准
    const period = 1 / M87_JET_KNOT_DRIFT_PER_SEC;
    expect(m87JetKnotT01(0.2, period)).toBeCloseTo(0.2, 6);
    // 缓慢：1 秒内位移 < 1% 轴长
    expect(M87_JET_KNOT_DRIFT_PER_SEC).toBeLessThan(0.01);
  });

  it('亮度沿轴衰减：轴向越远不透明度越低；循环端点淡入淡出防闪现', () => {
    const near = m87JetKnotOpacity01(0.1, 1);
    const far = m87JetKnotOpacity01(0.7, 1);
    expect(far).toBeLessThan(near);
    // 端点：t→0 淡入 / t→1 淡出
    expect(m87JetKnotOpacity01(0, 1)).toBe(0);
    expect(m87JetKnotOpacity01(0.999, 1)).toBeLessThan(0.02);
    // 亮度线性调制
    expect(m87JetKnotOpacity01(0.5, 0.5)).toBeCloseTo(m87JetKnotOpacity01(0.5, 1) * 0.5, 12);
  });

  it('非法入参抛 RangeError', () => {
    expect(() => m87JetKnotT01(1, 0)).toThrow(RangeError);
    expect(() => m87JetKnotT01(-0.1, 0)).toThrow(RangeError);
    expect(() => m87JetKnotT01(0.2, Number.NaN)).toThrow(RangeError);
    expect(() => m87JetKnotOpacity01(1, 1)).toThrow(RangeError);
    expect(() => m87JetKnotOpacity01(0.5, 1.2)).toThrow(RangeError);
    expect(() => m87JetKnotOpacity01(0.5, -0.1)).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// 球状星团分布
// ---------------------------------------------------------------------------

describe('M87 球状星团采样', () => {
  it('默认 2,000 个（真实 ~12,000 预算缩减登记）且属性长度自洽', () => {
    const gc = sampleM87GlobularClusters();
    expect(gc.count).toBe(M87_GC_COUNT);
    expect(M87_GC_COUNT).toBe(2000);
    expect(gc.positionsLy).toHaveLength(gc.count * 3);
    expect(gc.colors).toHaveLength(gc.count * 3);
    expect(gc.sizes).toHaveLength(gc.count);
  });

  it('确定性：同参数两次采样逐字节一致（附录 A §2）', () => {
    const a = sampleM87GlobularClusters();
    const b = sampleM87GlobularClusters();
    expect(Buffer.from(a.positionsLy.buffer).equals(Buffer.from(b.positionsLy.buffer))).toBe(true);
    expect(Buffer.from(a.colors.buffer).equals(Buffer.from(b.colors.buffer))).toBe(true);
    // 不同种子分布不同
    const c = sampleM87GlobularClusters(M87_GC_COUNT, 1);
    expect(Buffer.from(a.positionsLy.buffer).equals(Buffer.from(c.positionsLy.buffer))).toBe(
      false,
    );
  });

  it('径向幂律外包络：全部落于截断半径内、半数以内半径 ≈ 有效半径、外围有星团', () => {
    const gc = sampleM87GlobularClusters();
    const radii: number[] = [];
    let beyondStellarRe = 0;
    for (let i = 0; i < gc.count; i += 1) {
      const x = gc.positionsLy[i * 3];
      const y = gc.positionsLy[i * 3 + 1];
      const z = gc.positionsLy[i * 3 + 2];
      // 轴比反归一后的椭球半径 ≤ 截断
      const r = Math.hypot(x, y / 0.86, z / 0.92);
      expect(r).toBeLessThanOrEqual(M87_GC_MAX_RADIUS_LY + 1e-3);
      radii.push(r);
      if (Math.hypot(x, y, z) > 12000) beyondStellarRe += 1;
    }
    // 半数以内半径 ≈ R_max × 0.5² = 有效半径登记值（±15% 统计容差）
    radii.sort((a, b) => a - b);
    const median = radii[Math.floor(radii.length / 2)];
    expect(median).toBeGreaterThan(M87_GC_EFFECTIVE_RADIUS_LY * 0.85);
    expect(median).toBeLessThan(M87_GC_EFFECTIVE_RADIUS_LY * 1.15);
    // 外包络更延展：显著数量分布于恒星有效半径 12,000 ly 之外
    expect(beyondStellarRe).toBeGreaterThan(gc.count * 0.4);
    expect(M87_GC_EFFECTIVE_RADIUS_LY).toBeGreaterThan(12000);
  });

  it('红黄老年色（R ≥ G ≥ B 暖档）与小尺寸（0.5–1.4）', () => {
    const gc = sampleM87GlobularClusters(500);
    for (let i = 0; i < gc.count; i += 1) {
      expect(gc.colors[i * 3]).toBe(1);
      expect(gc.colors[i * 3 + 1]).toBeGreaterThanOrEqual(0.78);
      expect(gc.colors[i * 3 + 1]).toBeLessThanOrEqual(0.92);
      expect(gc.colors[i * 3 + 2]).toBeGreaterThanOrEqual(0.52);
      expect(gc.colors[i * 3 + 2]).toBeLessThanOrEqual(0.7);
      expect(gc.colors[i * 3 + 1]).toBeGreaterThan(gc.colors[i * 3 + 2]);
      expect(gc.sizes[i]).toBeGreaterThanOrEqual(0.5);
      expect(gc.sizes[i]).toBeLessThanOrEqual(1.4);
    }
  });

  it('非法入参抛 RangeError', () => {
    expect(() => sampleM87GlobularClusters(0)).toThrow(RangeError);
    expect(() => sampleM87GlobularClusters(1.5)).toThrow(RangeError);
    expect(() => sampleM87GlobularClusters(100, Number.NaN)).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// 室女座成员筛选（合成目录 + 真实产物）
// ---------------------------------------------------------------------------

/** 构造合成目录：给定超星系坐标/亮度/形态档 */
function makeCatalog(
  rows: ReadonlyArray<{ x: number; y: number; z: number; b: number; tier: 0 | 1 | 2 }>,
): GalaxyCatalogData {
  const positionsMpc = new Float32Array(rows.length * 3);
  const morphTiers = new Uint8Array(rows.length);
  const jkTiers = new Uint8Array(rows.length);
  const brightness01 = new Float32Array(rows.length);
  rows.forEach((r, i) => {
    positionsMpc[i * 3] = r.x;
    positionsMpc[i * 3 + 1] = r.y;
    positionsMpc[i * 3 + 2] = r.z;
    morphTiers[i] = r.tier;
    // virgoMemberPoints 走形态档色调（SC3 范围外登记），jk 档置未知档即可
    jkTiers[i] = JK_TIER_UNKNOWN;
    // 与产物同口径：亮度经 w 打包量化（bin V2）
    brightness01[i] = packCatalogW(r.tier, JK_TIER_UNKNOWN, r.b) % 1000 / 999;
  });
  return { count: rows.length, positionsMpc, morphTiers, jkTiers, brightness01 };
}

describe('室女座团成员筛选（R5-3 目录子集，选择登记）', () => {
  const virgoDir = equatorialToSupergalacticUnit(VIRGO_RA_DEG, VIRGO_DEC_DEG);

  it('锥角/径向壳过滤：锥外与壳外条目被剔除', () => {
    const inside = {
      x: virgoDir.x * 16,
      y: virgoDir.y * 16,
      z: virgoDir.z * 16,
      b: 0.8,
      tier: 0 as const,
    };
    const tooNear = { x: virgoDir.x * 5, y: virgoDir.y * 5, z: virgoDir.z * 5, b: 0.9, tier: 1 as const };
    const tooFar = { x: virgoDir.x * 40, y: virgoDir.y * 40, z: virgoDir.z * 40, b: 0.9, tier: 1 as const };
    // 反方向（锥外 180°）
    const offCone = { x: -virgoDir.x * 16, y: -virgoDir.y * 16, z: -virgoDir.z * 16, b: 0.9, tier: 1 as const };
    const pts = virgoMemberPoints(makeCatalog([inside, tooNear, tooFar, offCone]));
    expect(pts.count).toBe(1);
  });

  it('按亮度降序取前 N（超额时截断到 100）', () => {
    const rows = Array.from({ length: 130 }, (_, i) => ({
      x: virgoDir.x * (14 + (i % 7) * 0.5),
      y: virgoDir.y * (14 + (i % 7) * 0.5),
      z: virgoDir.z * (14 + (i % 7) * 0.5),
      b: (i % 100) / 100,
      tier: (i % 3) as 0 | 1 | 2,
    }));
    const pts = virgoMemberPoints(makeCatalog(rows));
    expect(pts.count).toBe(VIRGO_MEMBER_MAX_COUNT);
    // 尺寸随亮度：全部 ≥ 最低入选亮度对应尺寸（截断生效的间接断言）
    for (let i = 0; i < pts.count; i += 1) {
      expect(pts.sizes[i]).toBeGreaterThanOrEqual(6);
      expect(pts.sizes[i]).toBeLessThanOrEqual(12);
    }
  });

  it('相对位移 = (成员 − M87) × 线性压缩且方向经 R5-3 同一旋转链（长度保持）', () => {
    // 成员置于 M87 正后方 2 Mpc（同方向 18.56 Mpc）
    const d = M87_DISTANCE_MPC + 2;
    const pts = virgoMemberPoints(
      makeCatalog([{ x: virgoDir.x * d, y: virgoDir.y * d, z: virgoDir.z * d, b: 0.5, tier: 1 }]),
    );
    expect(pts.count).toBe(1);
    const len = Math.hypot(pts.positionsUnits[0], pts.positionsUnits[1], pts.positionsUnits[2]);
    // 旋转保长：|位移| = 2 Mpc × 1,200 units/Mpc（Float32 存储精度容差）
    expect(len).toBeCloseTo(2 * VIRGO_MEMBER_UNITS_PER_MPC, 1);
    expect(len).toBeLessThanOrEqual(VIRGO_MEMBER_MAX_OFFSET_UNITS);
  });

  it('形态档色调区分：椭圆偏黄（R>B）、旋涡蓝白（B>R）', () => {
    const d = M87_DISTANCE_MPC;
    const mk = (tier: 0 | 1): GalaxyCatalogData =>
      makeCatalog([
        { x: virgoDir.x * (d + 1), y: virgoDir.y * (d + 1), z: virgoDir.z * (d + 1), b: 1, tier },
      ]);
    const elliptical = virgoMemberPoints(mk(0));
    const spiral = virgoMemberPoints(mk(1));
    expect(elliptical.colors[0]).toBeGreaterThan(elliptical.colors[2]);
    expect(spiral.colors[2]).toBeGreaterThan(spiral.colors[0]);
  });

  it('空目录/无命中返回 count=0（组件侧不挂成员层，降级登记）', () => {
    expect(virgoMemberPoints(makeCatalog([])).count).toBe(0);
  });

  it('确定性：同目录两次筛选逐字节一致', () => {
    const rows = Array.from({ length: 40 }, (_, i) => ({
      x: virgoDir.x * (13 + i * 0.2),
      y: virgoDir.y * (13 + i * 0.2),
      z: virgoDir.z * (13 + i * 0.2),
      b: ((i * 37) % 100) / 100,
      tier: (i % 3) as 0 | 1 | 2,
    }));
    const cat = makeCatalog(rows);
    const a = virgoMemberPoints(cat);
    const b = virgoMemberPoints(cat);
    expect(Buffer.from(a.positionsUnits.buffer).equals(Buffer.from(b.positionsUnits.buffer))).toBe(
      true,
    );
  });
});

describe('真实产物集成（public/data/galaxy-catalog.bin）', () => {
  const file = readFileSync(join(process.cwd(), 'public', 'data', 'galaxy-catalog.bin'));
  const data = validateGalaxyCatalog(
    file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength),
  )!;

  it('成员点缀满配 100 个且位移全部有界（团本体窗口有效）', () => {
    const pts = virgoMemberPoints(data);
    expect(pts.count).toBe(VIRGO_MEMBER_MAX_COUNT);
    for (let i = 0; i < pts.count; i += 1) {
      const len = Math.hypot(
        pts.positionsUnits[i * 3],
        pts.positionsUnits[i * 3 + 1],
        pts.positionsUnits[i * 3 + 2],
      );
      expect(Number.isFinite(len)).toBe(true);
      expect(len).toBeLessThanOrEqual(VIRGO_MEMBER_MAX_OFFSET_UNITS);
      // M87 自身已烘焙期去重：无位移趋零的重影点
      expect(len).toBeGreaterThan(50);
    }
  });

  it('成员位移落于近观语境内（≤ 星系近观激活距离，点缀不越出语境）', () => {
    const pts = virgoMemberPoints(data);
    const enter = galaxyNearViewEnterDistanceUnits('m87');
    for (let i = 0; i < pts.count; i += 1) {
      const len = Math.hypot(
        pts.positionsUnits[i * 3],
        pts.positionsUnits[i * 3 + 1],
        pts.positionsUnits[i * 3 + 2],
      );
      expect(len).toBeLessThan(enter);
    }
  });
});

// ---------------------------------------------------------------------------
// EHT 联动阈值 / M87* 参数档 / 细节层规格
// ---------------------------------------------------------------------------

describe('M87* EHT 联动（lensing 池参数档 + 推近阈值）', () => {
  it('M87 距离换算自洽（5.4×10⁷ ly ↔ Mpc）', () => {
    expect(M87_DISTANCE_MPC).toBeCloseTo(5.4e7 / LY_PER_MPC, 9);
    expect(M87_DISTANCE_MPC).toBeGreaterThan(VIRGO_MEMBER_SHELL_MIN_MPC);
    expect(M87_DISTANCE_MPC).toBeLessThan(VIRGO_MEMBER_SHELL_MAX_MPC);
  });

  it('参数档"盘更暗环更大"成立：盘亮度 < Sgr A* 档、r_s 世界长度 > 两黑洞', () => {
    expect(M87_CORE_LENSED_CONFIG.diskBrightness).toBeLessThan(
      BLACK_HOLE_LENSED_CONFIGS['sgr-a-star'].diskBrightness,
    );
    const sgr = getSpecialBodyById('sgr-a-star')!;
    const sgrRsWorld = blackHoleRsWorldUnits(sgr.visualRadiusLy! * SCENE_UNITS_PER_LY);
    expect(M87_CORE_RS_WORLD_UNITS).toBeGreaterThan(sgrRsWorld);
    // 近正视倾角（EHT 2019 ≈ 17°），与两黑洞侧视档区分
    expect(M87_CORE_LENSED_CONFIG.diskInclinationDeg).toBe(17);
    expect(M87_CORE_LENSED_CONFIG.diskInclinationDeg).toBeLessThan(
      BLACK_HOLE_LENSED_CONFIGS['sgr-a-star'].diskInclinationDeg,
    );
    // 星场种子与两黑洞不同（确定性区分）
    expect(M87_CORE_LENSED_CONFIG.starfieldSeed).not.toBe(
      BLACK_HOLE_LENSED_CONFIGS['sgr-a-star'].starfieldSeed,
    );
    expect(M87_CORE_LENSED_CONFIG.starfieldSeed).not.toBe(
      BLACK_HOLE_LENSED_CONFIGS['cygnus-x1'].starfieldSeed,
    );
  });

  it('推近阈值次序：包围球 < 激活距离 < 星系近观激活距离（跨尺度过渡链）', () => {
    expect(M87_CORE_LENSING_DOMAIN_UNITS).toBe(
      M87_CORE_RS_WORLD_UNITS * LENSING_DOMAIN_RADIUS_RS,
    );
    expect(M87_CORE_LENSING_DOMAIN_UNITS).toBeLessThan(M87_CORE_LENSING_ENTER_UNITS);
    expect(M87_CORE_LENSING_ENTER_UNITS).toBeLessThan(galaxyNearViewEnterDistanceUnits('m87'));
  });

  it('透镜细节层规格：lensing 池、bodyId=m87、滞回退出 ×1.4 同源、预算入账', () => {
    const spec = m87CoreLensingDetailLayerSpec();
    expect(spec.bodyId).toBe('m87');
    expect(spec.kind).toBe('lensing');
    expect(spec.enterDistanceUnits).toBe(M87_CORE_LENSING_ENTER_UNITS);
    expect(spec.exitDistanceUnits).toBeCloseTo(
      M87_CORE_LENSING_ENTER_UNITS * NEAR_VIEW_EXIT_RATIO,
      9,
    );
    expect(spec.budget.gpuBytesEstimate).toBeGreaterThan(0);
    expect(spec.budget.gpuBytesEstimate).toBeLessThan(DETAIL_GPU_BUDGET_BYTES);
  });

  it('环境细节层规格：starCatalog 池、阈值与星系近观同源、粒子预算 2,100', () => {
    const spec = m87EnvironmentDetailLayerSpec();
    expect(spec.bodyId).toBe('m87');
    expect(spec.kind).toBe('starCatalog');
    expect(spec.enterDistanceUnits).toBe(galaxyNearViewEnterDistanceUnits('m87'));
    expect(spec.exitDistanceUnits).toBeCloseTo(
      spec.enterDistanceUnits * NEAR_VIEW_EXIT_RATIO,
      9,
    );
    expect(spec.budget.particles).toBe(M87_ENVIRONMENT_PARTICLES);
    expect(M87_ENVIRONMENT_PARTICLES).toBe(M87_GC_COUNT + VIRGO_MEMBER_MAX_COUNT);
    expect(spec.budget.gpuBytesEstimate).toBe(
      estimateGpuBytes({ particles: M87_ENVIRONMENT_PARTICLES }),
    );
  });

  it('ICM 辉光半径与成员压缩同源（2 Mpc × 1,200 units/Mpc）', () => {
    expect(M87_ICM_RADIUS_UNITS).toBe(2 * VIRGO_MEMBER_UNITS_PER_MPC);
  });
});

// ---------------------------------------------------------------------------
// 配置自洽校验
// ---------------------------------------------------------------------------

describe('assertM87EnvironmentConfig', () => {
  it('默认配置通过（模块加载即执行）', () => {
    expect(() => assertM87EnvironmentConfig()).not.toThrow();
  });

  it('节点数越界抛 RangeError', () => {
    expect(() => assertM87EnvironmentConfig([])).toThrow(RangeError);
    expect(() =>
      assertM87EnvironmentConfig(
        Array.from({ length: 6 }, (_, i) => ({
          t0: i / 6,
          brightness: 1 - i * 0.1,
          sizeFactor: 0.1,
        })),
      ),
    ).toThrow(RangeError);
  });

  it('节点参数越界/次序违例抛 RangeError', () => {
    expect(() =>
      assertM87EnvironmentConfig([
        { t0: 1.2, brightness: 1, sizeFactor: 0.1 },
        { t0: 0.4, brightness: 0.5, sizeFactor: 0.1 },
        { t0: 0.6, brightness: 0.3, sizeFactor: 0.1 },
      ]),
    ).toThrow(RangeError);
    expect(() =>
      assertM87EnvironmentConfig([
        { t0: 0.1, brightness: 0.5, sizeFactor: 0.1 },
        { t0: 0.4, brightness: 0.8, sizeFactor: 0.1 }, // 亮度未递减
        { t0: 0.6, brightness: 0.3, sizeFactor: 0.1 },
      ]),
    ).toThrow(RangeError);
  });

  it('阈值次序违例抛 RangeError（包围球 ≥ 激活 / 激活 ≥ 近观）', () => {
    expect(() => assertM87EnvironmentConfig(M87_JET_KNOTS, 100, 200)).toThrow(RangeError);
    expect(() => assertM87EnvironmentConfig(M87_JET_KNOTS, 1e9, 100)).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// 信息面板补行 + 预览页条目
// ---------------------------------------------------------------------------

describe('信息面板 M87 卡片（§R5-4 第 5 条）', () => {
  it('补 M87*·球状星团·室女座团三行且登记来源', () => {
    const info = getBodyInfoById('m87')!;
    const labels = info.lines.map((l) => l.label);
    expect(labels).toEqual(expect.arrayContaining(['M87*', '球状星团', '室女座团']));
    expect(M87_EXTRA_INFO_LINES_ZH).toHaveLength(3);
    expect(info.dataSource).toContain('EHT');
    expect(info.dataSource).toContain('Tamura');
    expect(info.dataSource).toContain('2MRS');
    // 成员不可点选的选择登记呈现于面板行
    expect(info.lines.find((l) => l.label === '室女座团')!.value).toContain('不可点选');
  });

  it('其他星系卡片不受影响（无增补行）', () => {
    const m31 = getBodyInfoById('m31')!;
    expect(m31.lines.map((l) => l.label)).not.toContain('M87*');
  });
});

describe('预览页 m87 条目（§R5-4 第 5 条：核心推近预设视角）', () => {
  it('已注册且含"核心推近"预设按钮与放宽的最近距离', () => {
    const entry = previewEntryForBody('m87');
    expect(entry).not.toBeNull();
    expect(entry!.componentKey).toBe('m87-environment');
    expect(entry!.viewPresets!.map((v) => v.key)).toEqual(['overview', 'core']);
    const core = entry!.viewPresets!.find((v) => v.key === 'core')!;
    // 核心预设落于（缩放后）激活阈值内、包围球外
    const scale = 3.2 / 3300; // 预览直径 / m87 贴图平面边长（组件同式）
    expect(core.distanceUnits).toBeLessThan(M87_CORE_LENSING_ENTER_UNITS * scale);
    expect(core.distanceUnits).toBeGreaterThan(M87_CORE_LENSING_DOMAIN_UNITS * scale);
    // 最近距离覆写允许推到预设距离
    expect(previewMinCameraDistance(entry!)).toBeLessThanOrEqual(core.distanceUnits);
  });

  it('未覆写条目的最近距离维持历史默认（cameraDistance × 0.5）', () => {
    const m31 = previewEntryForBody('m31')!;
    expect(previewMinCameraDistance(m31)).toBeCloseTo(m31.cameraDistance * 0.5, 12);
  });

  it('validatePreviewEntry：预设视角键重复/距离越界/最近距离非法抛 RangeError', () => {
    const base: PreviewEntry = {
      bodyId: 'x',
      title: 't',
      componentKey: 'k',
      params: [],
      cameraDistance: 4,
    };
    expect(() =>
      validatePreviewEntry({
        ...base,
        viewPresets: [
          { key: 'a', label: 'A', distanceUnits: 3 },
          { key: 'a', label: 'B', distanceUnits: 3 },
        ],
      }),
    ).toThrow(RangeError);
    expect(() =>
      validatePreviewEntry({
        ...base,
        viewPresets: [{ key: 'a', label: 'A', distanceUnits: 0.1 }],
      }),
    ).toThrow(RangeError);
    expect(() => validatePreviewEntry({ ...base, minCameraDistance: 0 })).toThrow(RangeError);
    expect(() => validatePreviewEntry({ ...base, minCameraDistance: 5 })).toThrow(RangeError);
    // 合法组合通过
    expect(() =>
      validatePreviewEntry({
        ...base,
        minCameraDistance: 0.2,
        viewPresets: [{ key: 'a', label: 'A', distanceUnits: 0.3 }],
      }),
    ).not.toThrow();
  });
});
