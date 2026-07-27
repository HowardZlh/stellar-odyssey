/**
 * R2-2 人造卫星角尺寸钳制 + 近观放大冻结/恢复 + 视角域门控测试（§2.2）
 */

import {
  MAG_FREEZE_FLY_TO_WINDOW_SECONDS,
  MAG_FREEZE_TRANSITION_WINDOW_SECONDS,
  MAG_RECOVERY_SECONDS,
  SATELLITE_MAX_SCREEN_HEIGHT_FRACTION,
  SATELLITE_NEAR_MAGNIFICATION,
  SATELLITE_PROXIMITY_FADE_END_UNITS,
  SATELLITE_PROXIMITY_FADE_START_UNITS,
  approachNearMagnification,
  nearMagnificationFrozen,
  satelliteProximityFade01,
  satelliteScreenClampFactor,
} from '@/utils/satellites';
import {
  focusBodyIdForDetail,
  focusPlanetSystemId,
  planetDetailScopeAllowed,
  satelliteDetailScopeAllowed,
} from '@/utils/bodyCycle';
import { detailGateUpdate, detailGateUpdateScoped } from '@/utils/planetDetail';

const FOV = (50 * Math.PI) / 180;

/** 钳制后投影屏高占比：displaySpan/2 ÷ distance ÷ tan(fov/2) */
function screenFraction(spanUnits: number, distance: number, factor: number): number {
  return (spanUnits * factor) / 2 / distance / Math.tan(FOV / 2);
}

describe('satelliteScreenClampFactor（R2-2 §2.2-A 角尺寸钳制）', () => {
  it('远距离（屏占比低于阈值）不钳制，系数为 1', () => {
    // ISS 显示跨度 ~0.17 单位 × 3 放大 = 0.5，在 6 单位外屏占比 ~4.5%
    expect(satelliteScreenClampFactor(6, 0.5, FOV)).toBe(1);
  });

  it('近距离钳制后屏占比恰为阈值（≈ 屏幕高度 10%）', () => {
    const span = 0.5;
    for (const d of [0.5, 1, 2]) {
      const factor = satelliteScreenClampFactor(d, span, FOV);
      expect(factor).toBeLessThan(1);
      expect(screenFraction(span, d, factor)).toBeCloseTo(
        SATELLITE_MAX_SCREEN_HEIGHT_FRACTION,
        10,
      );
    }
  });

  it('任意距离下钳制后屏占比均 ≤ 阈值（验收标准 1）', () => {
    const span = 0.5;
    for (let d = 0.01; d <= 10; d += 0.07) {
      const factor = satelliteScreenClampFactor(d, span, FOV);
      expect(screenFraction(span, d, factor)).toBeLessThanOrEqual(
        SATELLITE_MAX_SCREEN_HEIGHT_FRACTION + 1e-12,
      );
    }
  });

  it('钳制边界处连续（系数恰为 1，非阶跃）', () => {
    const span = 0.5;
    const boundary =
      span / 2 / (Math.tan(FOV / 2) * SATELLITE_MAX_SCREEN_HEIGHT_FRACTION);
    expect(satelliteScreenClampFactor(boundary, span, FOV)).toBeCloseTo(1, 10);
    expect(satelliteScreenClampFactor(boundary * 1.001, span, FOV)).toBe(1);
    expect(satelliteScreenClampFactor(boundary * 0.999, span, FOV)).toBeCloseTo(0.999, 3);
  });

  it('极限值：距离 → 0 时系数 → 0（不再铺满屏幕）', () => {
    expect(satelliteScreenClampFactor(0, 0.5, FOV)).toBe(0);
    expect(satelliteScreenClampFactor(1e-6, 0.5, FOV)).toBeLessThan(1e-4);
  });

  it('极限值：模型跨度为 0 时系数为 1（无除零）', () => {
    expect(satelliteScreenClampFactor(1, 0, FOV)).toBe(1);
    expect(satelliteScreenClampFactor(0, 0, FOV)).toBe(1);
  });

  it('非法输入抛 RangeError', () => {
    expect(() => satelliteScreenClampFactor(-1, 0.5, FOV)).toThrow(RangeError);
    expect(() => satelliteScreenClampFactor(NaN, 0.5, FOV)).toThrow(RangeError);
    expect(() => satelliteScreenClampFactor(1, -0.5, FOV)).toThrow(RangeError);
    expect(() => satelliteScreenClampFactor(1, NaN, FOV)).toThrow(RangeError);
    expect(() => satelliteScreenClampFactor(1, 0.5, 0)).toThrow(RangeError);
    expect(() => satelliteScreenClampFactor(1, 0.5, Math.PI)).toThrow(RangeError);
    expect(() => satelliteScreenClampFactor(1, 0.5, NaN)).toThrow(RangeError);
  });
});

describe('satelliteProximityFade01（R2-2 §2.2-A 极近淡出）', () => {
  it('起点外全不透明，终点内全透明', () => {
    expect(satelliteProximityFade01(SATELLITE_PROXIMITY_FADE_START_UNITS)).toBe(1);
    expect(satelliteProximityFade01(10)).toBe(1);
    expect(satelliteProximityFade01(SATELLITE_PROXIMITY_FADE_END_UNITS)).toBe(0);
    expect(satelliteProximityFade01(0)).toBe(0);
  });

  it('区间内平滑单调（smoothstep）', () => {
    const mid =
      (SATELLITE_PROXIMITY_FADE_START_UNITS + SATELLITE_PROXIMITY_FADE_END_UNITS) / 2;
    expect(satelliteProximityFade01(mid)).toBeCloseTo(0.5, 10);
    let prev = 0;
    for (let i = 0; i <= 100; i += 1) {
      const d =
        SATELLITE_PROXIMITY_FADE_END_UNITS +
        ((SATELLITE_PROXIMITY_FADE_START_UNITS - SATELLITE_PROXIMITY_FADE_END_UNITS) * i) /
          100;
      const v = satelliteProximityFade01(d);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it('非法输入抛 RangeError', () => {
    expect(() => satelliteProximityFade01(-0.1)).toThrow(RangeError);
    expect(() => satelliteProximityFade01(NaN)).toThrow(RangeError);
  });
});

describe('nearMagnificationFrozen（R2-2 §2.2-B 过渡冻结）', () => {
  const PAST = Number.POSITIVE_INFINITY;

  it('飞往运镜 2.5 秒窗口内冻结（flyToBodyId 飞抵后保留，故按请求计时）', () => {
    expect(nearMagnificationFrozen(0, PAST)).toBe(true);
    expect(nearMagnificationFrozen(MAG_FREEZE_FLY_TO_WINDOW_SECONDS - 0.01, PAST)).toBe(true);
    expect(nearMagnificationFrozen(MAG_FREEZE_FLY_TO_WINDOW_SECONDS, PAST)).toBe(false);
  });

  it('视角锚点过渡 2 秒窗口内冻结，窗口外解除', () => {
    expect(nearMagnificationFrozen(PAST, 0)).toBe(true);
    expect(nearMagnificationFrozen(PAST, MAG_FREEZE_TRANSITION_WINDOW_SECONDS - 0.01)).toBe(
      true,
    );
    expect(nearMagnificationFrozen(PAST, MAG_FREEZE_TRANSITION_WINDOW_SECONDS)).toBe(false);
    expect(nearMagnificationFrozen(PAST, PAST)).toBe(false);
  });

  it('两窗口均已过才解除冻结', () => {
    expect(nearMagnificationFrozen(1, PAST)).toBe(true);
    expect(nearMagnificationFrozen(PAST, 1)).toBe(true);
    expect(nearMagnificationFrozen(3, 2.5)).toBe(false);
  });
});

describe('approachNearMagnification（R2-2 §2.2-B 平滑恢复）', () => {
  it('1× → 最大倍数全程恰用 MAG_RECOVERY_SECONDS 秒（≤1 秒要求）', () => {
    let mag = 1;
    let seconds = 0;
    const dt = 1 / 60;
    while (mag < SATELLITE_NEAR_MAGNIFICATION && seconds < 5) {
      mag = approachNearMagnification(mag, SATELLITE_NEAR_MAGNIFICATION, dt);
      seconds += dt;
    }
    expect(mag).toBe(SATELLITE_NEAR_MAGNIFICATION);
    expect(seconds).toBeLessThanOrEqual(MAG_RECOVERY_SECONDS + 2 * dt);
  });

  it('冻结方向（→1×）同速率平滑，无尺寸跳变', () => {
    const dt = 1 / 60;
    const next = approachNearMagnification(SATELLITE_NEAR_MAGNIFICATION, 1, dt);
    expect(next).toBeLessThan(SATELLITE_NEAR_MAGNIFICATION);
    expect(SATELLITE_NEAR_MAGNIFICATION - next).toBeCloseTo(
      ((SATELLITE_NEAR_MAGNIFICATION - 1) / MAG_RECOVERY_SECONDS) * dt,
      10,
    );
  });

  it('接近目标时收敛到目标（不振荡）', () => {
    expect(approachNearMagnification(2.999, 3, 1)).toBe(3);
    expect(approachNearMagnification(3, 3, 1 / 60)).toBe(3);
  });

  it('非法输入抛 RangeError', () => {
    expect(() => approachNearMagnification(NaN, 1, 0.016)).toThrow(RangeError);
    expect(() => approachNearMagnification(1, NaN, 0.016)).toThrow(RangeError);
    expect(() => approachNearMagnification(1, 3, -0.1)).toThrow(RangeError);
    expect(() => approachNearMagnification(1, 3, NaN)).toThrow(RangeError);
  });
});

describe('focusBodyIdForDetail / focusPlanetSystemId（R2-2 §2.2-C）', () => {
  it('焦点优先级：飞往 > 跟随 > L1 锚定', () => {
    expect(focusBodyIdForDetail('L1', 'mars', 'earth', 'earth')).toBe('mars');
    expect(focusBodyIdForDetail('L1', null, 'moon', 'earth')).toBe('moon');
    expect(focusBodyIdForDetail('L1', null, null, 'earth')).toBe('earth');
  });

  it('L2-L4 无跟随时无焦点', () => {
    expect(focusBodyIdForDetail('L2', null, null, 'earth')).toBeNull();
    expect(focusBodyIdForDetail('L3', null, null, 'earth')).toBeNull();
    expect(focusBodyIdForDetail('L4', null, null, 'earth')).toBeNull();
  });

  it('系统归属：卫星归其行星，行星归自身，无焦点为 null', () => {
    expect(focusPlanetSystemId('earth', null)).toBe('earth');
    expect(focusPlanetSystemId('moon', 'earth')).toBe('earth');
    expect(focusPlanetSystemId('iss', 'earth')).toBe('earth');
    expect(focusPlanetSystemId(null, null)).toBeNull();
  });
});

describe('satelliteDetailScopeAllowed（R2-2 §2.2-C 人造卫星细节域门控）', () => {
  it('L1 语境 + 地球系统焦点（地球/月球/该卫星本身）→ 允许', () => {
    expect(satelliteDetailScopeAllowed('L1', 'earth', null, 'earth')).toBe(true);
    expect(satelliteDetailScopeAllowed('L1', 'moon', 'earth', 'earth')).toBe(true);
    expect(satelliteDetailScopeAllowed('L1', 'iss', 'earth', 'earth')).toBe(true);
  });

  it('跟随火星/木星 → 地球卫星不允许（验收标准 2）', () => {
    expect(satelliteDetailScopeAllowed('L1', 'mars', null, 'earth')).toBe(false);
    expect(satelliteDetailScopeAllowed('L1', 'jupiter', null, 'earth')).toBe(false);
  });

  it('跟随序列内天体（层级读数 L2）保持 L1 语境判定', () => {
    // 跟随地球但相机拉远层级读数为 L2：仍视为 L1 语境（cycleControlVisible 同款）
    expect(satelliteDetailScopeAllowed('L2', 'earth', null, 'earth')).toBe(true);
    expect(satelliteDetailScopeAllowed('L2', 'neptune', null, 'earth')).toBe(false);
  });

  it('L2-L4 无焦点/非序列焦点 → 不允许', () => {
    expect(satelliteDetailScopeAllowed('L2', null, null, 'earth')).toBe(false);
    expect(satelliteDetailScopeAllowed('L3', 'heliopause', null, 'earth')).toBe(false);
    expect(satelliteDetailScopeAllowed('L4', null, null, 'earth')).toBe(false);
  });
});

describe('planetDetailScopeAllowed（R2-2 §2.2-C 行星细节域门控）', () => {
  it('焦点系统与行星一致 → 允许（含跟随其卫星）', () => {
    expect(planetDetailScopeAllowed('earth', null, 'earth')).toBe(true);
    expect(planetDetailScopeAllowed('moon', 'earth', 'earth')).toBe(true);
    expect(planetDetailScopeAllowed('iss', 'earth', 'earth')).toBe(true);
    expect(planetDetailScopeAllowed('mars', null, 'mars')).toBe(true);
  });

  it('焦点在其他行星系统 → 不允许（防运镜擦过误激活）', () => {
    expect(planetDetailScopeAllowed('earth', null, 'mars')).toBe(false);
    expect(planetDetailScopeAllowed('moon', 'earth', 'mars')).toBe(false);
  });

  it('无焦点（自由镜头）回落距离判据 → 允许', () => {
    expect(planetDetailScopeAllowed(null, null, 'earth')).toBe(true);
  });
});

describe('detailGateUpdateScoped（R2-2 §2.2-C 门控叠加）', () => {
  it('系统一致时行为与 detailGateUpdate 一致', () => {
    expect(detailGateUpdateScoped(false, 1, 0.5, 1.0, true)).toEqual(
      detailGateUpdate(false, 1, 0.5, 1.0),
    );
    expect(detailGateUpdateScoped(true, 100, 0.5, 1.0, true)).toEqual(
      detailGateUpdate(true, 100, 0.5, 1.0),
    );
  });

  it('系统不一致时禁止激活；已激活则立即退出并释放显存', () => {
    expect(detailGateUpdateScoped(false, 1, 0.5, 1.0, false)).toEqual({
      active: false,
      releaseNow: false,
    });
    expect(detailGateUpdateScoped(true, 1, 0.5, 1.0, false)).toEqual({
      active: false,
      releaseNow: true,
    });
  });
});
