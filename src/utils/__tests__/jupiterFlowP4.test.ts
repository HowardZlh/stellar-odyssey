/**
 * 木星云层差速流动测试（P4，需求 §4.7 气态行星动态细节）
 */

import {
  EQUATORIAL_JET_RATE,
  FLOW_PHASE_WRAP_RAD,
  FLOW_VISUAL_GAIN,
  TEMPERATE_JET_RATE,
  flowShaderPhase,
  jovianDriftRate,
  jovianFlowUvOffset,
  latitudeFromV,
} from '@/utils/jupiterFlow';

const DEG = Math.PI / 180;

describe('纬向漂移速率剖面（真实大气环流带结构）', () => {
  it('赤道急流最快且为东向（System I 超前）', () => {
    const equator = jovianDriftRate(0);
    expect(equator).toBeCloseTo(EQUATORIAL_JET_RATE, 3);
    // 赤道为全剖面最大值
    for (let lat = -90; lat <= 90; lat += 3) {
      expect(jovianDriftRate(lat * DEG)).toBeLessThanOrEqual(equator + 1e-9);
    }
  });

  it('温带（±24° 附近）出现反向（西向）急流', () => {
    expect(jovianDriftRate(24 * DEG)).toBeLessThan(0);
    expect(jovianDriftRate(-24 * DEG)).toBeLessThan(0);
  });

  it('高纬（±42° 附近）出现较弱东向急流（交替带结构）', () => {
    expect(jovianDriftRate(42 * DEG)).toBeGreaterThan(0);
    expect(jovianDriftRate(42 * DEG)).toBeLessThan(jovianDriftRate(0));
  });

  it('剖面南北对称', () => {
    for (let lat = 0; lat <= 90; lat += 5) {
      expect(jovianDriftRate(lat * DEG)).toBeCloseTo(jovianDriftRate(-lat * DEG), 10);
    }
  });

  it('速率量级与真实一致（|漂移| ≤ 赤道急流 0.8%）', () => {
    for (let lat = -90; lat <= 90; lat += 1) {
      expect(Math.abs(jovianDriftRate(lat * DEG))).toBeLessThanOrEqual(EQUATORIAL_JET_RATE);
    }
    expect(TEMPERATE_JET_RATE).toBeLessThan(EQUATORIAL_JET_RATE);
  });

  it('非法纬度抛错', () => {
    expect(() => jovianDriftRate(Number.NaN)).toThrow(RangeError);
  });
});

describe('UV 漂移量（shader 镜像）', () => {
  it('漂移量 = −速率·相位/2π（东向漂移 U 减小）', () => {
    const phase = Math.PI * 4; // 两圈自转
    expect(jovianFlowUvOffset(0, phase)).toBeCloseTo(-EQUATORIAL_JET_RATE * 2);
  });

  it('相位 0 时无漂移', () => {
    expect(jovianFlowUvOffset(0.3, 0)).toBe(0);
  });

  it('赤道与温带反向漂移（差速剪切可辨识）', () => {
    const phase = Math.PI * 20;
    const eq = jovianFlowUvOffset(0, phase);
    const temperate = jovianFlowUvOffset(24 * DEG, phase);
    expect(eq * temperate).toBeLessThan(0);
  });
});

describe('纬度换算与视觉增益', () => {
  it('UV.y → 纬度：0.5 为赤道，0/1 为南北极', () => {
    expect(latitudeFromV(0.5)).toBe(0);
    expect(latitudeFromV(1)).toBeCloseTo(Math.PI / 2);
    expect(latitudeFromV(0)).toBeCloseTo(-Math.PI / 2);
    expect(latitudeFromV(2)).toBeCloseTo(Math.PI / 2); // 越界钳制
  });

  it('视觉增益为有限正数（艺术化登记：剖面结构真实、相位放大便于观察）', () => {
    expect(FLOW_VISUAL_GAIN).toBeGreaterThan(1);
    expect(FLOW_VISUAL_GAIN).toBeLessThanOrEqual(10);
  });
});

describe('flowShaderPhase（流动相位回卷，float32 uniform 精度保护）', () => {
  it('常规行星视角时间尺度（< 回卷窗口，约 4096 个自转）恒等返回', () => {
    expect(flowShaderPhase(0)).toBe(0);
    expect(flowShaderPhase(Math.PI * 2 * 100)).toBeCloseTo(Math.PI * 2 * 100, 12);
    expect(flowShaderPhase(FLOW_PHASE_WRAP_RAD - 1)).toBe(FLOW_PHASE_WRAP_RAD - 1);
  });

  it('银河系/宇宙视角时间压缩后（10¹⁰⁺ 弧度）回卷到 [0, 窗口)', () => {
    // 回归背景：simDays 达 10⁹⁺ 天时木星累计自转角 ~10¹⁰ 弧度，
    // ×视觉增益后 float32 uniform 精度失效，近观云层流动帧间跳变
    for (const phase of [4.76e10 * FLOW_VISUAL_GAIN, 1e12, FLOW_PHASE_WRAP_RAD * 3.3]) {
      const t = flowShaderPhase(phase);
      expect(t).toBeGreaterThanOrEqual(0);
      expect(t).toBeLessThan(FLOW_PHASE_WRAP_RAD);
    }
  });

  it('回卷窗口为 2π 整数倍：基础自转对齐不受回卷影响', () => {
    expect(FLOW_PHASE_WRAP_RAD / (Math.PI * 2)).toBeCloseTo(1536, 9);
    // 回卷前后相位在模 2π 意义下一致（中等量级下偏差可忽略）
    const raw = 1e8;
    const diff = raw - flowShaderPhase(raw);
    const residual = diff % (Math.PI * 2);
    const dist = Math.min(residual, Math.PI * 2 - residual);
    expect(dist).toBeLessThan(1e-3);
  });

  it('时间倒退（负相位）同样回卷到 [0, 窗口)', () => {
    const t = flowShaderPhase(-Math.PI);
    expect(t).toBeGreaterThanOrEqual(0);
    expect(t).toBeLessThan(FLOW_PHASE_WRAP_RAD);
  });

  it('非有限输入抛错', () => {
    expect(() => flowShaderPhase(Number.NaN)).toThrow(RangeError);
    expect(() => flowShaderPhase(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});
