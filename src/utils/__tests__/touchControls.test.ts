/**
 * M4 触屏交互纯逻辑单测（REQUIREMENTS_MOBILE §M4-1/M4-2）：
 * 捏合 dolly 对数速度曲线锁定（3–4 次捏合跨太阳→宇宙全景）+ 分档系数。
 */
import {
  ROAM_MAX_DISTANCE,
  ROAM_MIN_DISTANCE,
  orbitDampingFactor,
  pickRadiusScale,
  touchDollyZoomSpeed,
} from '../touchControls';

describe('orbitDampingFactor（M4-1 阻尼分档）', () => {
  it('桌面 = 现状 0.08（零变化）', () => {
    expect(orbitDampingFactor(false)).toBe(0.08);
  });

  it('触屏 = 0.12', () => {
    expect(orbitDampingFactor(true)).toBe(0.12);
  });
});

describe('touchDollyZoomSpeed（M4-1 捏合速度对数曲线）', () => {
  it('端点：最近 1.0 / 最远 2.6', () => {
    expect(touchDollyZoomSpeed(ROAM_MIN_DISTANCE)).toBeCloseTo(1.0, 10);
    expect(touchDollyZoomSpeed(ROAM_MAX_DISTANCE)).toBeCloseTo(2.6, 10);
  });

  it('越界钳制到端点值', () => {
    expect(touchDollyZoomSpeed(0.01)).toBeCloseTo(1.0, 10);
    expect(touchDollyZoomSpeed(1e9)).toBeCloseTo(2.6, 10);
  });

  it('非法输入（NaN/Infinity）降级最小速度', () => {
    expect(touchDollyZoomSpeed(Number.NaN)).toBe(1.0);
    expect(touchDollyZoomSpeed(Number.POSITIVE_INFINITY)).toBe(1.0);
  });

  it('随距离单调不减', () => {
    const samples = [1.5, 5, 20, 100, 500, 3000, 10000, 42000];
    for (let i = 1; i < samples.length; i += 1) {
      expect(touchDollyZoomSpeed(samples[i])).toBeGreaterThanOrEqual(
        touchDollyZoomSpeed(samples[i - 1]),
      );
    }
  });

  it('对数中点速度 ≈ 区间中值（对数线性验证）', () => {
    const midLog = (Math.log10(ROAM_MIN_DISTANCE) + Math.log10(ROAM_MAX_DISTANCE)) / 2;
    expect(touchDollyZoomSpeed(10 ** midLog)).toBeCloseTo((1.0 + 2.6) / 2, 10);
  });

  /**
   * 曲线锁定（M4-1 验收指标）：模拟连续捏合手势——OrbitControls 捏合
   * dolly 为 radius ×= ratio^zoomSpeed（ratio = 手指间距变化比，单次
   * 手势取 5 ≈ 60px→300px），zoomSpeed 按手势起点距离取值（保守近似：
   * 实际手势中 zoomSpeed 随距离增长逐帧更新只会更快）。
   */
  function simulatePinchOutCount(from: number, to: number, fingerRatio: number): number {
    let d = from;
    let n = 0;
    while (d < to && n < 20) {
      d *= fingerRatio ** touchDollyZoomSpeed(d);
      n += 1;
    }
    return n;
  }

  it('太阳近观（5 units）→ 宇宙全景（42000）：3–4 次捏合可达', () => {
    const n = simulatePinchOutCount(5, ROAM_MAX_DISTANCE, 5);
    expect(n).toBeGreaterThanOrEqual(3);
    expect(n).toBeLessThanOrEqual(4);
  });

  it('反向（宇宙全景 → 太阳近观）：同量级捏合次数（≤5）', () => {
    let d = ROAM_MAX_DISTANCE;
    let n = 0;
    while (d > 5 && n < 20) {
      d /= 5 ** touchDollyZoomSpeed(d);
      n += 1;
    }
    expect(n).toBeLessThanOrEqual(5);
  });
});

describe('pickRadiusScale（M4-2 拾取球命中放大）', () => {
  it('桌面 = 现状（×1，零变化）', () => {
    expect(pickRadiusScale(false)).toBe(1);
  });

  it('触屏 ×2', () => {
    expect(pickRadiusScale(true)).toBe(2);
  });
});
