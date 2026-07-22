/**
 * 天体跟随/飞往目标解析测试（需求 3.2.3 / 7 单元测试）
 */

import type { SupernovaEvent } from '@/types';
import { SUN, getPlanetById } from '@/data/planets';
import { getMoonById } from '@/data/moons';
import { getGalaxyById } from '@/data/galaxies';
import {
  MAX_VIEW_DISTANCE_UNITS,
  MIN_VIEW_DISTANCE_UNITS,
  galacticPointToSceneUnits,
  resolveFocusTarget,
  supernovaFocusTarget,
  viewDistanceForRadius,
} from '@/utils/cameraFocus';
import { DEG_TO_RAD, heliocentricPosition } from '@/utils/physics';
import {
  SCENE_UNITS_PER_LY,
  bodyDisplayRadius,
  cosmicDistanceToSceneUnits,
  eclipticToScene,
} from '@/utils/scale';
import { satelliteOrbitDisplayRadius } from '@/utils/satellites';
import { ECLIPTIC_GALACTIC_TILT_DEG, sunGalacticPositionLy } from '@/utils/galaxy';
import { mwM31SeparationLy } from '@/utils/universe';

describe('viewDistanceForRadius', () => {
  it('推荐距离为半径 6 倍，钳制在有效范围', () => {
    expect(viewDistanceForRadius(10)).toBe(60);
    expect(viewDistanceForRadius(0.01)).toBe(MIN_VIEW_DISTANCE_UNITS);
    expect(viewDistanceForRadius(1e9)).toBe(MAX_VIEW_DISTANCE_UNITS);
  });

  it('非法半径抛出 RangeError', () => {
    expect(() => viewDistanceForRadius(-1)).toThrow(RangeError);
    expect(() => viewDistanceForRadius(Number.NaN)).toThrow(RangeError);
  });
});

describe('galacticPointToSceneUnits（银心系 → 场景坐标）', () => {
  it('太阳当前位置映射到场景原点（嵌套一致性 3.1.4）', () => {
    for (const simDays of [0, 1e9, 4.56e10]) {
      const sun = sunGalacticPositionLy(simDays);
      const p = galacticPointToSceneUnits(sun, simDays);
      expect(p.x).toBeCloseTo(0, 6);
      expect(p.y).toBeCloseTo(0, 6);
      expect(p.z).toBeCloseTo(0, 6);
    }
  });

  it('纯 x 偏移不受绕 X 轴倾斜影响', () => {
    const sun = sunGalacticPositionLy(0);
    const p = galacticPointToSceneUnits({ x: sun.x + 1000, y: sun.y, z: sun.z }, 0);
    expect(p.x).toBeCloseTo(1000 * SCENE_UNITS_PER_LY, 6);
    expect(p.y).toBeCloseTo(0, 6);
    expect(p.z).toBeCloseTo(0, 6);
  });

  it('y/z 偏移按黄道-银道倾角旋转（60.2°）', () => {
    const sun = sunGalacticPositionLy(0);
    const tilt = ECLIPTIC_GALACTIC_TILT_DEG * DEG_TO_RAD;
    const p = galacticPointToSceneUnits({ x: sun.x, y: sun.y + 100, z: sun.z }, 0);
    expect(p.x).toBeCloseTo(0, 6);
    expect(p.y).toBeCloseTo(100 * SCENE_UNITS_PER_LY * Math.cos(tilt), 6);
    expect(p.z).toBeCloseTo(100 * SCENE_UNITS_PER_LY * Math.sin(tilt), 6);
  });
});

describe('resolveFocusTarget：太阳系天体', () => {
  it('太阳：场景原点 + 按显示半径推荐距离', () => {
    const target = resolveFocusTarget('sun', 0);
    expect(target).not.toBeNull();
    expect(target!.position).toEqual({ x: 0, y: 0, z: 0 });
    expect(target!.viewDistanceUnits).toBeCloseTo(
      viewDistanceForRadius(bodyDisplayRadius(SUN.radiusKm, false)),
      9,
    );
  });

  it('地球：位置与开普勒方程求解一致', () => {
    const simDays = 1234.5;
    const earth = getPlanetById('earth')!;
    const expected = eclipticToScene(heliocentricPosition(earth.orbit, simDays));
    const target = resolveFocusTarget('earth', simDays);
    expect(target!.position.x).toBeCloseTo(expected.x, 9);
    expect(target!.position.y).toBeCloseTo(expected.y, 9);
    expect(target!.position.z).toBeCloseTo(expected.z, 9);
  });

  it('冥王星（矮行星）可解析', () => {
    expect(resolveFocusTarget('pluto', 0)).not.toBeNull();
  });

  it('哈雷彗星可解析且位置随时间变化', () => {
    const a = resolveFocusTarget('halley', 0)!;
    const b = resolveFocusTarget('halley', 5000)!;
    expect(Math.hypot(b.position.x - a.position.x, b.position.z - a.position.z)).toBeGreaterThan(0);
  });

  it('真实比例模式下行星观察距离更近（半径更小）', () => {
    const visual = resolveFocusTarget('earth', 0, false)!;
    const real = resolveFocusTarget('earth', 0, true)!;
    expect(real.viewDistanceUnits).toBeLessThan(visual.viewDistanceUnits);
  });
});

describe('resolveFocusTarget：卫星', () => {
  it('月球位置在地球附近（距离等于视觉轨道半径量级）', () => {
    const simDays = 42;
    const earth = getPlanetById('earth')!;
    const moon = getMoonById('moon')!;
    const earthPos = eclipticToScene(heliocentricPosition(earth.orbit, simDays));
    const target = resolveFocusTarget('moon', simDays)!;
    const dist = Math.hypot(
      target.position.x - earthPos.x,
      target.position.y - earthPos.y,
      target.position.z - earthPos.z,
    );
    const orbitRadius = satelliteOrbitDisplayRadius(
      moon.kind,
      earth.radiusKm,
      moon.orbit.semiMajorAxisKm,
      false,
    );
    // 椭圆轨道：日心距在 a(1−e) 与 a(1+e) 之间
    expect(dist).toBeGreaterThanOrEqual(orbitRadius * (1 - moon.orbit.eccentricity) - 1e-6);
    expect(dist).toBeLessThanOrEqual(orbitRadius * (1 + moon.orbit.eccentricity) + 1e-6);
  });

  it('ISS（人造卫星，赤道面参考平面）可解析且贴近地球', () => {
    const simDays = 10;
    const earth = getPlanetById('earth')!;
    const earthPos = eclipticToScene(heliocentricPosition(earth.orbit, simDays));
    const target = resolveFocusTarget('iss', simDays)!;
    const dist = Math.hypot(
      target.position.x - earthPos.x,
      target.position.y - earthPos.y,
      target.position.z - earthPos.z,
    );
    expect(dist).toBeLessThan(2);
    expect(dist).toBeGreaterThan(0);
  });
});

describe('resolveFocusTarget：河外星系', () => {
  it('M31 位置沿方向矢量、距离随模拟时间接近（需求 3.1.3）', () => {
    const m31 = getGalaxyById('m31')!;
    const simDays = 0;
    const expectedD = cosmicDistanceToSceneUnits(mwM31SeparationLy(simDays));
    const target = resolveFocusTarget('m31', simDays)!;
    expect(target.position.x).toBeCloseTo(m31.direction.x * expectedD, 6);
    expect(target.position.y).toBeCloseTo(m31.direction.y * expectedD, 6);
    expect(target.position.z).toBeCloseTo(m31.direction.z * expectedD, 6);
    // 时间推进后更近
    const later = resolveFocusTarget('m31', 365.25e9)!;
    const dNow = Math.hypot(target.position.x, target.position.y, target.position.z);
    const dLater = Math.hypot(later.position.x, later.position.y, later.position.z);
    expect(dLater).toBeLessThan(dNow);
  });

  it('大麦哲伦云（卫星星系）位置随时间绕转', () => {
    const a = resolveFocusTarget('lmc', 0)!;
    const b = resolveFocusTarget('lmc', 365.25e8)!;
    expect(
      Math.hypot(
        b.position.x - a.position.x,
        b.position.y - a.position.y,
        b.position.z - a.position.z,
      ),
    ).toBeGreaterThan(1);
  });

  it('M87（静态星系）按压缩距离定位', () => {
    const m87 = getGalaxyById('m87')!;
    // direction 为近似单位矢量（|v|≈1，数据文件已登记），期望值按实际模长修正
    const dirNorm = Math.hypot(m87.direction.x, m87.direction.y, m87.direction.z);
    const d = cosmicDistanceToSceneUnits(m87.distanceLy) * dirNorm;
    const target = resolveFocusTarget('m87', 0)!;
    expect(Math.hypot(target.position.x, target.position.y, target.position.z)).toBeCloseTo(d, 6);
  });
});

describe('resolveFocusTarget：特殊天体（需求 3.1.5）', () => {
  it('人马座A*（银心）位置与银心系原点映射一致', () => {
    const simDays = 8.4e9;
    const expected = galacticPointToSceneUnits({ x: 0, y: 0, z: 0 }, simDays);
    const target = resolveFocusTarget('sgr-a-star', simDays)!;
    expect(target.position.x).toBeCloseTo(expected.x, 6);
    expect(target.position.y).toBeCloseTo(expected.y, 6);
    expect(target.position.z).toBeCloseTo(expected.z, 6);
    expect(target.viewDistanceUnits).toBeGreaterThanOrEqual(40);
  });

  it('参宿四（随太阳共转）目标位置与模拟时间无关', () => {
    const a = resolveFocusTarget('betelgeuse', 0)!;
    const b = resolveFocusTarget('betelgeuse', 4.2e10)!;
    expect(a.position.x).toBeCloseTo(b.position.x, 6);
    expect(a.position.y).toBeCloseTo(b.position.y, 6);
    expect(a.position.z).toBeCloseTo(b.position.z, 6);
  });

  it('类星体 3C 273 按宇宙距离压缩定位', () => {
    const target = resolveFocusTarget('quasar-3c273', 0)!;
    const d = Math.hypot(target.position.x, target.position.y, target.position.z);
    // direction 为近似单位矢量（|v|≈1），允许 ‰ 级偏差
    expect(Math.abs(d - cosmicDistanceToSceneUnits(2.4e9)) / d).toBeLessThan(2e-3);
  });

  it('全部特殊天体均可解析（可点选 → 可飞往）', () => {
    for (const id of [
      'betelgeuse',
      'rigel',
      'sirius',
      'crab-pulsar',
      'sgr-a-star',
      'orion-nebula',
      'ring-nebula',
      'm13-cluster',
      'quasar-3c273',
    ]) {
      expect(resolveFocusTarget(id, 0)).not.toBeNull();
    }
  });
});

describe('supernovaFocusTarget', () => {
  it('位置按银心系坐标映射', () => {
    const event: SupernovaEvent = {
      id: 'sn-1',
      positionLy: { x: 20000, y: 100, z: -8000 },
      startedAtMs: 0,
      durationSec: 18,
      progenitorMassSun: 15,
    };
    const simDays = 123456;
    const expected = galacticPointToSceneUnits(event.positionLy, simDays);
    const target = supernovaFocusTarget(event, simDays);
    expect(target.position).toEqual(expected);
    expect(target.viewDistanceUnits).toBeGreaterThan(0);
  });
});

describe('未知 id', () => {
  it('返回 null（调用方忽略请求）', () => {
    expect(resolveFocusTarget('not-a-body', 0)).toBeNull();
  });
});
