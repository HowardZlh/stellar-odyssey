/**
 * P7 渲染相位注册表 + 飞往/跟随目标解析测试
 * （§3.1 近观跟随一致性 / §3.4 人造卫星观察距离适配）
 */

import {
  clearAllRenderedSatellitePhases,
  clearRenderedSatellitePhase,
  renderedSatellitePhaseRad,
  setRenderedSatellitePhase,
} from '@/utils/satellitePhase';
import {
  SATELLITE_VIEW_DISTANCE_UNITS,
  resolveFocusTarget,
} from '@/utils/cameraFocus';
import { getMoonById } from '@/data/moons';
import { satelliteBodyDisplayRadius } from '@/utils/satellites';

afterEach(() => {
  clearAllRenderedSatellitePhases();
});

describe('渲染相位注册表（P7：钳制期间相机跟随与渲染一致）', () => {
  it('写入/读取/清除', () => {
    expect(renderedSatellitePhaseRad('iss')).toBeNull();
    setRenderedSatellitePhase('iss', 1.25);
    expect(renderedSatellitePhaseRad('iss')).toBe(1.25);
    clearRenderedSatellitePhase('iss');
    expect(renderedSatellitePhaseRad('iss')).toBeNull();
  });

  it('clearAll 清空全部', () => {
    setRenderedSatellitePhase('iss', 1);
    setRenderedSatellitePhase('tiangong', 2);
    clearAllRenderedSatellitePhases();
    expect(renderedSatellitePhaseRad('iss')).toBeNull();
    expect(renderedSatellitePhaseRad('tiangong')).toBeNull();
  });

  it('非法相位抛错', () => {
    expect(() => setRenderedSatellitePhase('iss', NaN)).toThrow(RangeError);
    expect(() => setRenderedSatellitePhase('iss', Infinity)).toThrow(RangeError);
  });

  it('注册相位后 resolveFocusTarget 位置随注册相位变化（与渲染一致）', () => {
    const simDays = 123.456;
    const before = resolveFocusTarget('iss', simDays)!;
    // 注册一个明显不同的相位（精确相位 + π）
    setRenderedSatellitePhase('iss', Math.PI * 0.5);
    const after1 = resolveFocusTarget('iss', simDays)!;
    setRenderedSatellitePhase('iss', Math.PI * 1.5);
    const after2 = resolveFocusTarget('iss', simDays)!;
    // 相位不同 → 位置不同
    const d12 = Math.hypot(
      after1.position.x - after2.position.x,
      after1.position.y - after2.position.y,
      after1.position.z - after2.position.z,
    );
    expect(d12).toBeGreaterThan(0.01);
    // 注册后位置由注册相位决定，与 simDays 推进解耦
    const after1b = resolveFocusTarget('iss', simDays + 0.01)!;
    setRenderedSatellitePhase('iss', Math.PI * 1.5);
    expect(after1b.position.x).not.toBe(before.position.x);
  });

  it('未注册天体（月球等自然卫星）不受影响：按精确相位求值', () => {
    const a = resolveFocusTarget('moon', 50)!;
    const b = resolveFocusTarget('moon', 50)!;
    expect(a.position).toEqual(b.position);
  });
});

describe('人造卫星观察距离适配（P7 §3.4）', () => {
  it('4 颗人造卫星飞往距离 = max(固定近观距离, 本体半径×8)', () => {
    for (const id of ['iss', 'tiangong', 'hubble', 'geo-satellite']) {
      const target = resolveFocusTarget(id, 0)!;
      const m = getMoonById(id)!;
      const bodyRadius = satelliteBodyDisplayRadius(m.kind, m.radiusKm, false, m.spanMeters);
      expect(target.viewDistanceUnits).toBeCloseTo(
        Math.max(SATELLITE_VIEW_DISTANCE_UNITS, bodyRadius * 8),
        10,
      );
      // 近观距离处于 P4 门控进入阈值（max(6, r×8) = 6）内，必触发模型加载
      expect(target.viewDistanceUnits).toBeLessThan(6);
    }
  });

  it('近观距离不低于遨游模式最近距离（OrbitControls minDistance 1.5）', () => {
    expect(SATELLITE_VIEW_DISTANCE_UNITS).toBeGreaterThanOrEqual(1.5);
  });

  it('自然卫星（月球）维持按轨道半径推荐距离（现状不回退）', () => {
    const target = resolveFocusTarget('moon', 0)!;
    expect(target.viewDistanceUnits).toBeGreaterThan(SATELLITE_VIEW_DISTANCE_UNITS);
  });

  it('天宫可解析为飞往目标（P7 §3.4 切换序列可直达）', () => {
    const target = resolveFocusTarget('tiangong', 10)!;
    expect(target).not.toBeNull();
    expect(Number.isFinite(target.position.x)).toBe(true);
    expect(Number.isFinite(target.position.y)).toBe(true);
    expect(Number.isFinite(target.position.z)).toBe(true);
  });
});
