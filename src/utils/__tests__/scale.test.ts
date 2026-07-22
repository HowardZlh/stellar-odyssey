/**
 * 尺度管理单元测试（需求 5.1 / 3.2.2）
 */

import {
  AU_KM,
  LIGHT_YEAR_AU,
  MIN_VISUAL_RADIUS,
  SCENE_UNITS_PER_AU,
  auToSceneUnits,
  eclipticToScene,
  formatScaleLabel,
  levelForCameraDistance,
  sceneUnitsToAu,
  visualBodyRadius,
} from '@/utils/scale';
import { PLANETS, SUN } from '@/data/planets';

describe('单位转换', () => {
  it('AU 与场景单位互转（1 AU = 10 单位）', () => {
    expect(auToSceneUnits(1)).toBe(SCENE_UNITS_PER_AU);
    expect(auToSceneUnits(5.2)).toBeCloseTo(52, 10);
    expect(sceneUnitsToAu(auToSceneUnits(3.7))).toBeCloseTo(3.7, 12);
  });
});

describe('visualBodyRadius（对数压缩，已登记的视觉夸大处理）', () => {
  it('保持真实相对大小关系：太阳 > 木星 > 地球 > 水星', () => {
    const sun = visualBodyRadius(SUN.radiusKm);
    const jupiter = visualBodyRadius(69911);
    const earth = visualBodyRadius(6371);
    const mercury = visualBodyRadius(2439.7);
    expect(sun).toBeGreaterThan(jupiter);
    expect(jupiter).toBeGreaterThan(earth);
    expect(earth).toBeGreaterThan(mercury);
  });

  it('所有行星半径不小于最小可见半径', () => {
    for (const p of PLANETS) {
      expect(visualBodyRadius(p.radiusKm)).toBeGreaterThanOrEqual(MIN_VISUAL_RADIUS);
    }
  });

  it('极小天体钳制到最小可见半径', () => {
    expect(visualBodyRadius(1)).toBe(MIN_VISUAL_RADIUS);
  });

  it('压缩后量级合理（太阳约 2.5 场景单位，附录A 基准）', () => {
    expect(visualBodyRadius(SUN.radiusKm)).toBeGreaterThan(2);
    expect(visualBodyRadius(SUN.radiusKm)).toBeLessThan(3);
  });

  it('非正半径抛出异常', () => {
    expect(() => visualBodyRadius(0)).toThrow(RangeError);
    expect(() => visualBodyRadius(-100)).toThrow(RangeError);
  });
});

describe('eclipticToScene（黄道坐标 → 场景坐标）', () => {
  it('北黄极 +z 映射为场景 +Y', () => {
    const s = eclipticToScene({ x: 0, y: 0, z: 1 });
    expect(s.x).toBeCloseTo(0, 12);
    expect(s.y).toBeCloseTo(SCENE_UNITS_PER_AU, 12);
    expect(s.z).toBeCloseTo(0, 12);
  });

  it('黄道面 x-y 映射为场景 x-(−z)', () => {
    const sx = eclipticToScene({ x: 1, y: 0, z: 0 });
    expect(sx.x).toBeCloseTo(SCENE_UNITS_PER_AU, 12);
    expect(sx.y).toBeCloseTo(0, 12);
    expect(sx.z).toBeCloseTo(0, 12);
    const sy = eclipticToScene({ x: 0, y: 1, z: 0 });
    expect(sy.x).toBeCloseTo(0, 12);
    expect(sy.y).toBeCloseTo(0, 12);
    expect(sy.z).toBeCloseTo(-SCENE_UNITS_PER_AU, 12);
  });

  it('保持逆时针公转方向（黄道系逆时针 → 场景自上而下俯视逆时针）', () => {
    // 黄道系中从 (1,0) 逆时针转到 (0,1)：场景中 x+ → z−，
    // 从 +Y 俯视（screen 上方为 −z）表现为从右向上，即逆时针
    const p0 = eclipticToScene({ x: 1, y: 0, z: 0 });
    const p1 = eclipticToScene({ x: 0, y: 1, z: 0 });
    // 俯视角动量：x·(−vz) − (−z)·vx 形式，等价验证 z 分量变化方向
    expect(p1.z).toBeLessThan(p0.z);
  });
});

describe('formatScaleLabel（尺度标尺）', () => {
  it('小于 0.01 AU 时显示 km', () => {
    expect(formatScaleLabel(0.001)).toBe(`${Math.round(0.001 * AU_KM).toLocaleString('en-US')} km`);
  });

  it('AU 量级', () => {
    expect(formatScaleLabel(1)).toBe('1.0 AU');
    expect(formatScaleLabel(150)).toBe('150 AU');
    expect(formatScaleLabel(2500)).toBe('2,500 AU');
  });

  it('光年量级', () => {
    expect(formatScaleLabel(LIGHT_YEAR_AU)).toBe('1.0 光年');
    expect(formatScaleLabel(LIGHT_YEAR_AU * 0.5)).toContain('AU');
  });

  it('Mpc 量级', () => {
    const oneMpcAu = LIGHT_YEAR_AU * 1e6 * 3.26156;
    expect(formatScaleLabel(oneMpcAu * 2)).toBe('2.0 Mpc');
  });

  it('小于 1 的值使用有效数字', () => {
    expect(formatScaleLabel(0.5)).toBe('0.50 AU');
  });

  it('非法输入抛出异常', () => {
    expect(() => formatScaleLabel(-1)).toThrow(RangeError);
    expect(() => formatScaleLabel(NaN)).toThrow(RangeError);
    expect(() => formatScaleLabel(Infinity)).toThrow(RangeError);
  });
});

describe('levelForCameraDistance', () => {
  it('按距离阈值划分层级', () => {
    expect(levelForCameraDistance(5)).toBe('L1');
    expect(levelForCameraDistance(80)).toBe('L2');
    expect(levelForCameraDistance(2500)).toBe('L3');
    expect(levelForCameraDistance(20000)).toBe('L4');
  });

  it('边界值归属外层', () => {
    expect(levelForCameraDistance(30)).toBe('L2');
    expect(levelForCameraDistance(600)).toBe('L3');
    expect(levelForCameraDistance(5000)).toBe('L4');
  });
});
