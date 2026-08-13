/**
 * R5-3 真实巡天目录场景映射单测：三轴锚定旋转（M87 精确对齐 + 偏差登记）/
 * 对数距离压缩与 L4 尺度同源 / 两级 LOD 拆分 / 颜色尺寸映射 / 文案常量
 */
import type { GalaxyCatalogData } from '../bakedData';
import {
  GALAXY_CATALOG_DISTORTIONS_ZH,
  GALAXY_CATALOG_SOURCE_ZH,
  LANIAKEA_NEAR_MAX_MPC,
  MORPH_TIER_COLORS_SRGB,
  SUPERGALACTIC_POLE_SCENE,
  buildCatalogLodAttributes,
  buildCatalogSceneRotation,
  catalogAnchorDeviationDeg,
  catalogDistanceToSceneUnits,
  catalogFarSizePx,
  catalogIntensity01,
  catalogNearSizePx,
  galacticToScene,
  supergalacticPlanePointScene,
  supergalacticPlaneTiltDeg,
  supergalacticToScene,
} from '../galaxyCatalog';
import {
  LY_PER_MPC,
  equatorialToSupergalacticUnit,
  galacticUnitFromLB,
} from '../galaxyCatalogCore';
import { LOCAL_GROUP_GALAXIES } from '@/data/galaxies';
import { cosmicDistanceToSceneUnits, trapezoidWeight } from '../scale';
import { UNIVERSE_FADE, universeFadeWeight } from '../universe';

function norm(v: { x: number; y: number; z: number }): number {
  return Math.hypot(v.x, v.y, v.z);
}

describe('超星系 → 场景旋转（三轴锚定）', () => {
  it('旋转矩阵正交（行范数 1、行间正交、det = +1）', () => {
    const m = buildCatalogSceneRotation();
    const row = (i: number): number[] => [m[i * 3], m[i * 3 + 1], m[i * 3 + 2]];
    for (let i = 0; i < 3; i += 1) {
      expect(Math.hypot(...row(i))).toBeCloseTo(1, 9);
      for (let j = i + 1; j < 3; j += 1) {
        const d = row(i)[0] * row(j)[0] + row(i)[1] * row(j)[1] + row(i)[2] * row(j)[2];
        expect(d).toBeCloseTo(0, 9);
      }
    }
    const det =
      m[0] * (m[4] * m[8] - m[5] * m[7]) -
      m[1] * (m[3] * m[8] - m[5] * m[6]) +
      m[2] * (m[3] * m[7] - m[4] * m[6]);
    expect(det).toBeCloseTo(1, 9);
  });

  it('主锚：银道面 → 场景 XZ 平面（银道空带精确落在渲染银盘面内）', () => {
    for (const l of [0, 47, 120, 213, 300, 359]) {
      const p = galacticToScene(galacticUnitFromLB(l, 0));
      expect(Math.abs(p.y)).toBeLessThan(1e-12);
      expect(Math.hypot(p.x, p.y, p.z)).toBeCloseTo(1, 9);
    }
    // 银道北极 → 场景 +y
    const pole = galacticToScene(galacticUnitFromLB(0, 90));
    expect(pole.y).toBeCloseTo(1, 9);
    // |b| = 5° 遮挡带边界 → 场景 |y| = sin 5°（空带半厚）
    const zoa = galacticToScene(galacticUnitFromLB(66, 5));
    expect(zoa.y).toBeCloseTo(Math.sin((5 * Math.PI) / 180), 9);
  });

  it('次锚：M87 方位对齐，残余为仰角差 ≈ 15.2°（登记）', () => {
    const dev = catalogAnchorDeviationDeg('m87');
    expect(dev).toBeGreaterThan(10);
    expect(dev).toBeLessThan(20);
    // 方位角（绕 y）已对齐
    const real = galacticToScene(galacticUnitFromLB(283.78, 74.49));
    const scene = LOCAL_GROUP_GALAXIES.find((g) => g.id === 'm87')!.direction;
    expect(Math.atan2(real.z, real.x)).toBeCloseTo(
      Math.atan2(scene.z, scene.x),
      2,
    );
  });

  it('其余实体星系偏差逐一登记（示意方向非刚体旋转像，±5° 漂移带）', () => {
    // 偏差登记（2026-07-30 实现值：示意 direction 与真实银道方向之差）：
    const registered: Record<string, number> = {
      m31: 75.0,
      m33: 89.4,
      lmc: 41.5,
      smc: 44.3,
      m32: 75.1,
      m110: 74.6,
      'sagittarius-dwarf': 45.2,
    };
    for (const [id, expected] of Object.entries(registered)) {
      const dev = catalogAnchorDeviationDeg(id);
      expect(Math.abs(dev - expected)).toBeLessThan(5);
    }
  });

  it('旋转保范数；未知实体 id 抛 RangeError', () => {
    const v = supergalacticToScene({ x: 0.6, y: -0.48, z: 0.64 });
    expect(norm(v)).toBeCloseTo(Math.hypot(0.6, -0.48, 0.64), 9);
    expect(() => catalogAnchorDeviationDeg('unknown')).toThrow(RangeError);
  });

  it('拉尼亚凯亚边界对齐核对：环置真实超星系平面，室女座团（SGB≈−2.3°）落在环面内', () => {
    const virgoScene = supergalacticToScene(
      equatorialToSupergalacticUnit(187.7059, 12.3911),
    );
    // 室女座方向与超星系平面法向近乎垂直（面内 → |cos| = sin|SGB| ≈ 0.04）
    const cosToPole =
      (virgoScene.x * SUPERGALACTIC_POLE_SCENE.x +
        virgoScene.y * SUPERGALACTIC_POLE_SCENE.y +
        virgoScene.z * SUPERGALACTIC_POLE_SCENE.z) /
      norm(virgoScene);
    expect(Math.abs(cosToPole)).toBeLessThan(0.06);
    // 环上存在与室女座方向角距 < 3° 的点（环穿过超密度处）
    let best = 180;
    for (let i = 0; i < 720; i += 1) {
      const p = supergalacticPlanePointScene(1, (i / 720) * Math.PI * 2);
      const cos =
        (p.x * virgoScene.x + p.y * virgoScene.y + p.z * virgoScene.z) / norm(virgoScene);
      best = Math.min(best, (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI);
    }
    expect(best).toBeLessThan(3);
  });

  it('超星系平面与场景银盘面倾角 ≈ 84.5°（真实几何登记）；环点半径精确', () => {
    expect(supergalacticPlaneTiltDeg()).toBeGreaterThan(80);
    expect(supergalacticPlaneTiltDeg()).toBeLessThan(88);
    const p = supergalacticPlanePointScene(1200, 1.1);
    expect(norm(p)).toBeCloseTo(1200, 6);
    // 环面内 → 与法向正交
    const dotPole =
      p.x * SUPERGALACTIC_POLE_SCENE.x +
      p.y * SUPERGALACTIC_POLE_SCENE.y +
      p.z * SUPERGALACTIC_POLE_SCENE.z;
    expect(Math.abs(dotPole)).toBeLessThan(1e-9);
    expect(() => supergalacticPlanePointScene(0, 0)).toThrow(RangeError);
    expect(() => supergalacticPlanePointScene(10, Number.NaN)).toThrow(RangeError);
  });
});

describe('对数距离压缩（与 L4 尺度同源）', () => {
  it('catalogDistanceToSceneUnits = cosmicDistanceToSceneUnits(Mpc→ly)（同源公式）', () => {
    for (const mpc of [1.5, 16.56, 80, 300, 740]) {
      expect(catalogDistanceToSceneUnits(mpc)).toBeCloseTo(
        cosmicDistanceToSceneUnits(mpc * LY_PER_MPC),
        10,
      );
    }
    // 室女座团 ~16.56 Mpc（5.4e7 ly）≈ 15,830 单位（scale.ts 登记效果值）
    expect(catalogDistanceToSceneUnits(5.4e7 / LY_PER_MPC)).toBeCloseTo(
      cosmicDistanceToSceneUnits(5.4e7),
      6,
    );
    expect(() => catalogDistanceToSceneUnits(0)).toThrow(RangeError);
    expect(() => catalogDistanceToSceneUnits(Number.NaN)).toThrow(RangeError);
  });
});

describe('颜色 / 尺寸映射', () => {
  it('亮度档 → 强度（0.3–1.0 单调）；越界拒绝', () => {
    expect(catalogIntensity01(0)).toBeCloseTo(0.3, 10);
    expect(catalogIntensity01(1)).toBeCloseTo(1, 10);
    expect(catalogIntensity01(0.5)).toBeGreaterThan(catalogIntensity01(0.2));
    expect(() => catalogIntensity01(-0.1)).toThrow(RangeError);
    expect(() => catalogIntensity01(1.1)).toThrow(RangeError);
  });

  it('远景近单像素（1.4–2.6 px）；拉尼亚凯亚近域适度增大（2.2–4.8 px）', () => {
    expect(catalogFarSizePx(0)).toBeCloseTo(1.4, 10);
    expect(catalogFarSizePx(1)).toBeCloseTo(2.6, 10);
    expect(catalogNearSizePx(0)).toBeCloseTo(2.2, 10);
    expect(catalogNearSizePx(1)).toBeCloseTo(4.8, 10);
    expect(catalogNearSizePx(0.5)).toBeGreaterThan(catalogFarSizePx(1));
  });

  it('形态档基色（SC3 起 jk 未知档回退路径）：椭圆偏黄（R>B）、旋涡偏蓝白（B>R）、未知中性', () => {
    const [e, s, u] = MORPH_TIER_COLORS_SRGB;
    expect(e[0]).toBeGreaterThan(e[2]);
    expect(s[2]).toBeGreaterThan(s[0]);
    expect(Math.abs(u[0] - u[2])).toBeLessThan(0.15);
  });
});

describe('两级 LOD 属性构建', () => {
  /** 合成目录：近域 2 条（10/79 Mpc）+ 远景 2 条（81/300 Mpc），三档形态；
   * jk 档覆盖红端/蓝端/未知/中段（SC3 V2） */
  const data: GalaxyCatalogData = {
    count: 4,
    positionsMpc: new Float32Array([10, 0, 0, 0, 79, 0, 0, 0, 81, 150, 150, 150 * Math.SQRT2]),
    morphTiers: new Uint8Array([0, 1, 2, 1]),
    jkTiers: new Uint8Array([98, 0, 99, 49]),
    brightness01: new Float32Array([1, 0.5, 0, 0.25]),
  };

  it('近/远拆分以 80 Mpc（拉尼亚凯亚半径）为界', () => {
    expect(LANIAKEA_NEAR_MAX_MPC).toBe(80);
    const lod = buildCatalogLodAttributes(data);
    expect(lod.near.count).toBe(2);
    expect(lod.far.count).toBe(2);
    expect(lod.near.positions).toHaveLength(6);
    expect(lod.near.colors).toHaveLength(6);
    expect(lod.near.sizes).toHaveLength(2);
  });

  it('位置 = 旋转方向 × 压缩距离（模长与档位一致）', () => {
    const lod = buildCatalogLodAttributes(data);
    const r0 = Math.hypot(lod.near.positions[0], lod.near.positions[1], lod.near.positions[2]);
    expect(r0).toBeCloseTo(catalogDistanceToSceneUnits(10), 3);
    const rFar = Math.hypot(lod.far.positions[3], lod.far.positions[4], lod.far.positions[5]);
    expect(rFar).toBeCloseTo(catalogDistanceToSceneUnits(300), 2);
  });

  it('尺寸/颜色按档位映射（近域大于远景；亮度强度单调）', () => {
    const lod = buildCatalogLodAttributes(data);
    expect(lod.near.sizes[0]).toBeCloseTo(catalogNearSizePx(1), 5);
    expect(lod.far.sizes[0]).toBeCloseTo(catalogFarSizePx(0), 5);
    // 近域第 0 条（椭圆 b=1）红通道 > 蓝通道
    expect(lod.near.colors[0]).toBeGreaterThan(lod.near.colors[2]);
    // 远景第 1 条（旋涡 b=0.25）亮度低于近域第 0 条（b=1）
    expect(lod.far.colors[3]).toBeLessThan(lod.near.colors[0]);
  });

  it('确定性：两次构建逐字节一致', () => {
    const a = buildCatalogLodAttributes(data);
    const b = buildCatalogLodAttributes(data);
    expect(a.near.positions).toEqual(b.near.positions);
    expect(a.far.colors).toEqual(b.far.colors);
    expect(a.near.sizes).toEqual(b.near.sizes);
  });
});

describe('文案常量（§R5-3：来源 + 三项失真登记）', () => {
  it('来源提及 2MRS/Huchra；失真登记含指状效应/近距误差/银道遮挡带', () => {
    expect(GALAXY_CATALOG_SOURCE_ZH).toContain('2MRS');
    expect(GALAXY_CATALOG_SOURCE_ZH).toContain('Huchra');
    expect(GALAXY_CATALOG_DISTORTIONS_ZH).toContain('指状效应');
    expect(GALAXY_CATALOG_DISTORTIONS_ZH).toContain('近距');
    expect(GALAXY_CATALOG_DISTORTIONS_ZH).toContain('银道');
  });
});

describe('L4 淡入窗口（Universe.tsx 与目录层同源）', () => {
  it('窗口 3.05–3.6 淡入、平台延至 4.5、与 trapezoidWeight 同式', () => {
    expect(UNIVERSE_FADE.start).toBe(3.05);
    expect(UNIVERSE_FADE.full).toBe(3.6);
    expect(universeFadeWeight(3.0)).toBe(0);
    expect(universeFadeWeight(3.05)).toBe(0);
    expect(universeFadeWeight(3.325)).toBeCloseTo(0.5, 10);
    expect(universeFadeWeight(3.6)).toBe(1);
    expect(universeFadeWeight(4)).toBe(1);
    for (const level of [3.0, 3.2, 3.5, 3.9, 4.4]) {
      expect(universeFadeWeight(level)).toBeCloseTo(
        trapezoidWeight(level, 3.05, 3.6, 4.5, 5),
        12,
      );
    }
  });
});

describe('场景方向覆盖核对（数据侧）', () => {
  it('LOCAL_GROUP_GALAXIES 的 m87/m31 direction 为单位矢量（锚定前提）', () => {
    for (const id of ['m87', 'm31']) {
      const g = LOCAL_GROUP_GALAXIES.find((x) => x.id === id)!;
      expect(norm(g.direction)).toBeCloseTo(1, 1);
    }
  });
});
