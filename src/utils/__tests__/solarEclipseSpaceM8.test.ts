/**
 * E-M8 「天体比例」双模纯逻辑（IMPROVEMENT_REQUIREMENTS_SOLAR_ECLIPSE §M8）：
 * 艺术化半径与主场景 visualBodyRadius 同源锁定（层因子 150 派生断言，A18）、
 * 影锥径向档位倍率（真实档 A4/A16 回归防守零漂移）、
 * 影斑角距投影帽（2027 食甚一手锚点：帽心 = 真实足印方向、角半径 = 短半轴/R⊕）、
 * 小行星带点云生成器（确定性/径向域/点数）、艺术化档相机域常量。
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { validateSolarEclipses, type SolarEclipsesData } from '@/utils/bakedData';
import { SCENE_UNITS_PER_AU, visualBodyRadius } from '@/utils/scale';
import { EARTH_MEAN_RADIUS_KM, MOON_MEAN_RADIUS_KM } from '@/utils/solarEclipse';
import {
  ANTUMBRA_DARKEN_DEPTH,
  ASTEROID_BELT_INNER_AU,
  ASTEROID_BELT_OUTER_AU,
  ASTEROID_BELT_POINT_COUNT,
  ASTEROID_BELT_THICKNESS_AU,
  MOON_MAGNIFY_FACTOR,
  SPACE_ART_CAMERA_RADIUS_MIN_UNITS,
  SPACE_ART_EARTH_RADIUS_UNITS,
  SPACE_ART_EARTH_SCALE,
  SPACE_ART_INTRO_END_RADIUS_UNITS,
  SPACE_ART_INTRO_START_RADIUS_UNITS,
  SPACE_ART_MOON_SCALE,
  SPACE_ART_RADIUS_FACTOR,
  SPACE_AU_LINEAR_UNITS,
  SPACE_CAMERA_RADIUS_MAX_UNITS,
  SPACE_EARTH_RADIUS_UNITS,
  SPACE_MILKY_WAY_RADIUS_UNITS,
  SPACE_UNITS_PER_KM,
  UMBRA_DARKEN_DEPTH,
  UMBRA_MAGNIFY_FACTOR,
  artBodyRadiusUnits,
  artShadowCap,
  asteroidBeltLocalPoints,
  compressAuToUnits,
  coneRadialScale,
  coneRadialScaleForMode,
  emptyArtShadowCapState,
  emptyEclipseSpaceFrameState,
  spaceFrameState,
  spaceIntroPose,
  type ViewIntroPose,
} from '@/utils/solarEclipseSpace';

const eclipses = validateSolarEclipses(
  JSON.parse(readFileSync(join(process.cwd(), 'public/data/solar_eclipses.json'), 'utf8'))
) as SolarEclipsesData;

const e2027 = eclipses.events.find((e) => e.id === 'e2027')!;

describe('artBodyRadiusUnits（A18：visualBodyRadius 同源 × 层因子 150）', () => {
  it('层因子为 1,500 单位/AU ÷ 主场景 10 单位/AU 的派生量（严格等比锁定）', () => {
    expect(SPACE_ART_RADIUS_FACTOR).toBe(SPACE_AU_LINEAR_UNITS / SCENE_UNITS_PER_AU);
    expect(SPACE_ART_RADIUS_FACTOR).toBe(150);
  });

  it('与主场景 visualBodyRadius 逐值同源（不复制公式）', () => {
    for (const km of [2439.7, 6371, 69911, 695700]) {
      expect(artBodyRadiusUnits(km)).toBe(visualBodyRadius(km) * 150);
    }
  });

  it('L2 观感锚点：地球 ~93、木星 ~233、太阳 ~381 单位', () => {
    expect(artBodyRadiusUnits(6371)).toBeGreaterThan(88);
    expect(artBodyRadiusUnits(6371)).toBeLessThan(98);
    expect(artBodyRadiusUnits(69911)).toBeGreaterThan(225);
    expect(artBodyRadiusUnits(69911)).toBeLessThan(240);
    expect(artBodyRadiusUnits(695700)).toBeGreaterThan(370);
    expect(artBodyRadiusUnits(695700)).toBeLessThan(390);
  });

  it('地球/月球缩放倍率常量自洽', () => {
    expect(SPACE_ART_EARTH_RADIUS_UNITS).toBe(artBodyRadiusUnits(EARTH_MEAN_RADIUS_KM));
    expect(SPACE_ART_EARTH_SCALE).toBeCloseTo(
      SPACE_ART_EARTH_RADIUS_UNITS / SPACE_EARTH_RADIUS_UNITS,
      12
    );
    expect(SPACE_ART_MOON_SCALE).toBeCloseTo(
      artBodyRadiusUnits(MOON_MEAN_RADIUS_KM) / (MOON_MEAN_RADIUS_KM * SPACE_UNITS_PER_KM),
      12
    );
    // 艺术化月球（~41 单位）仍小于艺术化地球（~93 单位）——相对关系保持
    expect(SPACE_ART_MOON_SCALE * MOON_MEAN_RADIUS_KM * SPACE_UNITS_PER_KM).toBeLessThan(
      SPACE_ART_EARTH_RADIUS_UNITS
    );
  });
});

describe('coneRadialScaleForMode（档位倍率）', () => {
  it('真实档逐组合转发 coneRadialScale（A4/A16 语义零漂移回归防守）', () => {
    for (const kind of ['umbra', 'penumbra'] as const) {
      for (const u of [false, true]) {
        for (const m of [false, true]) {
          expect(coneRadialScaleForMode(kind, 'real', u, m)).toBe(coneRadialScale(kind, u, m));
        }
      }
    }
    expect(coneRadialScaleForMode('umbra', 'real', true, true)).toBe(
      UMBRA_MAGNIFY_FACTOR * MOON_MAGNIFY_FACTOR
    );
  });

  it('艺术化档双锥恒为艺术化月球倍率且忽略两开关（差异登记口径）', () => {
    for (const kind of ['umbra', 'penumbra'] as const) {
      for (const u of [false, true]) {
        for (const m of [false, true]) {
          expect(coneRadialScaleForMode(kind, 'art', u, m)).toBe(SPACE_ART_MOON_SCALE);
        }
      }
    }
  });
});

describe('artShadowCap（§M8-3 影斑角距投影）', () => {
  it('2027 食甚：本影帽心 = 真实足印方向、角半径 = 短半轴/R⊕（一手锚点）', () => {
    const space = emptyEclipseSpaceFrameState();
    spaceFrameState(e2027.geo, e2027.contacts.max, null, null, space);
    expect(space.footExists).toBe(true);
    const cap = artShadowCap(space);
    const fLen = Math.hypot(...space.footCenterScene);
    const dot =
      (cap.umbraDir[0] * space.footCenterScene[0] +
        cap.umbraDir[1] * space.footCenterScene[1] +
        cap.umbraDir[2] * space.footCenterScene[2]) /
      fLen;
    expect(dot).toBeGreaterThan(0.999999);
    // 2027 短轴 ~258 km → 角半径 asin(129/6371) ≈ 0.0202 rad
    expect(cap.umbraAngRad).toBeGreaterThan(0.017);
    expect(cap.umbraAngRad).toBeLessThan(0.023);
    expect(cap.umbraDepth01).toBe(UMBRA_DARKEN_DEPTH);
    // 半影帽：角半径显著大于本影（地面半影半径千公里级）且帽心与本影帽近同向
    expect(cap.penAngRad).toBeGreaterThan(cap.umbraAngRad * 5);
    expect(cap.penAngRad).toBeLessThan(1.2);
    const dirDot =
      cap.penDir[0] * cap.umbraDir[0] +
      cap.penDir[1] * cap.umbraDir[1] +
      cap.penDir[2] * cap.umbraDir[2];
    expect(dirDot).toBeGreaterThan(0.98);
  });

  it('假想远地点（405,696 km）：伪本影帽压暗深度切浅档', () => {
    const space = emptyEclipseSpaceFrameState();
    spaceFrameState(e2027.geo, e2027.contacts.max, 405696, null, space);
    expect(space.footExists).toBe(true);
    expect(space.footIsAntumbra).toBe(true);
    const cap = artShadowCap(space);
    expect(cap.umbraDepth01).toBe(ANTUMBRA_DARKEN_DEPTH);
  });

  it('无足印（倾角叙事离轴月位）：本影帽角半径为 0、半影帽方向仍为单位向量', () => {
    const space = emptyEclipseSpaceFrameState();
    // 月球置于黄道北侧远离影轴的叙事位（z 分量大 → 影锥掠过地球外）
    spaceFrameState(e2027.geo, e2027.contacts.max, null, [100000, 100000, 350000], space);
    expect(space.footExists).toBe(false);
    const cap = artShadowCap(space, emptyArtShadowCapState());
    expect(cap.umbraAngRad).toBe(0);
    expect(Math.hypot(...cap.umbraDir)).toBe(0);
    expect(Math.hypot(...cap.penDir)).toBeCloseTo(1, 6);
  });
});

describe('asteroidBeltLocalPoints（M8-5 示意点云）', () => {
  it('长度 = 3×点数且两次构建逐元一致（确定性种子）', () => {
    const a = asteroidBeltLocalPoints();
    const b = asteroidBeltLocalPoints();
    expect(a).toHaveLength(ASTEROID_BELT_POINT_COUNT * 3);
    expect(a).toEqual(b);
  });

  it('全部点落在压缩后的主带径向域内', () => {
    const pts = asteroidBeltLocalPoints(500);
    const rMin = compressAuToUnits(ASTEROID_BELT_INNER_AU) - 1e-3;
    const rMax =
      compressAuToUnits(
        Math.hypot(ASTEROID_BELT_OUTER_AU, ASTEROID_BELT_THICKNESS_AU / 2)
      ) + 1e-3;
    for (let i = 0; i < 500; i += 1) {
      const r = Math.hypot(pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]);
      expect(r).toBeGreaterThanOrEqual(rMin);
      expect(r).toBeLessThanOrEqual(rMax);
    }
  });

  it('种子不同输出不同；非法点数抛错', () => {
    const a = asteroidBeltLocalPoints(64, 1);
    const b = asteroidBeltLocalPoints(64, 2);
    expect(a).not.toEqual(b);
    expect(() => asteroidBeltLocalPoints(0)).toThrow(RangeError);
    expect(() => asteroidBeltLocalPoints(1.5)).toThrow(RangeError);
  });
});

describe('艺术化档相机域与运镜（§M8-4）', () => {
  it('相机最小半径 > 艺术化地球半径（机位不入球）；上限 3,800 在星穹内', () => {
    expect(SPACE_ART_CAMERA_RADIUS_MIN_UNITS).toBeGreaterThan(SPACE_ART_EARTH_RADIUS_UNITS);
    expect(SPACE_CAMERA_RADIUS_MAX_UNITS).toBe(3800);
    expect(SPACE_CAMERA_RADIUS_MAX_UNITS).toBeLessThan(SPACE_MILKY_WAY_RADIUS_UNITS);
    expect(SPACE_ART_INTRO_END_RADIUS_UNITS).toBeGreaterThan(SPACE_ART_CAMERA_RADIUS_MIN_UNITS);
    expect(SPACE_ART_INTRO_END_RADIUS_UNITS).toBeLessThan(SPACE_CAMERA_RADIUS_MAX_UNITS);
  });

  it('spaceIntroPose 收自定义起止半径（艺术化档运镜）', () => {
    const pose: ViewIntroPose = { pos: [0, 0, 0], fovDeg: 0 };
    const sunDir = [1, 0, 0] as const;
    spaceIntroPose(sunDir, 0, pose, SPACE_ART_INTRO_END_RADIUS_UNITS, SPACE_ART_INTRO_START_RADIUS_UNITS);
    expect(Math.hypot(...pose.pos)).toBeCloseTo(SPACE_ART_INTRO_START_RADIUS_UNITS, 6);
    spaceIntroPose(sunDir, 1, pose, SPACE_ART_INTRO_END_RADIUS_UNITS, SPACE_ART_INTRO_START_RADIUS_UNITS);
    expect(Math.hypot(...pose.pos)).toBeCloseTo(SPACE_ART_INTRO_END_RADIUS_UNITS, 6);
  });
});
