/**
 * 特殊天体动态效果纯函数测试（需求 3.1.5 / 7 单元测试）
 */

import {
  BLUE_GIANT_FLICKER_AMPLITUDE,
  RED_GIANT_BRIGHTNESS_AMPLITUDE,
  RED_GIANT_SCALE_AMPLITUDE,
  accretionDiskAngularSpeed,
  binaryStarPositions,
  blueGiantFlicker,
  dopplerBrightnessFactor,
  jetFlowPhase01,
  nebulaExpansionScale,
  pulsarBeamAngle,
  pulsarPulseIntensity,
  quasarFlicker,
  redGiantPulsation,
} from '@/utils/specialBodies';

describe('红巨星半规则脉动（参宿四）', () => {
  it('尺寸与亮度围绕 1 波动且不超过设计幅度', () => {
    for (let t = 0; t <= 30; t += 0.37) {
      const { scale, brightness } = redGiantPulsation(t);
      expect(scale).toBeGreaterThanOrEqual(1 - RED_GIANT_SCALE_AMPLITUDE);
      expect(scale).toBeLessThanOrEqual(1 + RED_GIANT_SCALE_AMPLITUDE);
      expect(brightness).toBeGreaterThanOrEqual(1 - RED_GIANT_BRIGHTNESS_AMPLITUDE);
      expect(brightness).toBeLessThanOrEqual(1 + RED_GIANT_BRIGHTNESS_AMPLITUDE);
    }
  });

  it('确定性：同一时间输入输出一致', () => {
    expect(redGiantPulsation(7.3)).toEqual(redGiantPulsation(7.3));
  });

  it('半规则特征：两个不可公度周期叠加使波形非单周期重复', () => {
    // 若为单周期 11s，则 f(t) 与 f(t+11) 应处处相等；叠加 4.3s 分量后不等
    const a = redGiantPulsation(2).scale;
    const b = redGiantPulsation(2 + 11).scale;
    expect(Math.abs(a - b)).toBeGreaterThan(1e-6);
  });
});

describe('蓝巨星高频微闪烁（参宿七）', () => {
  it('亮度围绕 1 微幅波动', () => {
    for (let t = 0; t <= 5; t += 0.11) {
      const v = blueGiantFlicker(t);
      expect(v).toBeGreaterThanOrEqual(1 - BLUE_GIANT_FLICKER_AMPLITUDE);
      expect(v).toBeLessThanOrEqual(1 + BLUE_GIANT_FLICKER_AMPLITUDE);
    }
  });

  it('确定性输出', () => {
    expect(blueGiantFlicker(1.5)).toBe(blueGiantFlicker(1.5));
  });
});

describe('双星互绕（天狼星A/B，需求 3.1.5）', () => {
  it('质量大的主星轨道半径更小（r_A·m_A = r_B·m_B）', () => {
    const massRatio = 2.06 / 1.02;
    const { primary, secondary } = binaryStarPositions(10, massRatio, 0);
    const rA = Math.hypot(primary.x, primary.y, primary.z);
    const rB = Math.hypot(secondary.x, secondary.y, secondary.z);
    expect(rA).toBeLessThan(rB);
    expect(rA * massRatio).toBeCloseTo(rB, 9);
    // 间距守恒
    expect(rA + rB).toBeCloseTo(10, 9);
  });

  it('两星始终位于质心两侧（位置矢量反向）', () => {
    for (const phase of [0, 0.7, Math.PI / 2, 2.5, Math.PI]) {
      const { primary, secondary } = binaryStarPositions(6, 2, phase);
      // 单位方向应相反：p/|p| = -s/|s|
      const rA = Math.hypot(primary.x, primary.z);
      const rB = Math.hypot(secondary.x, secondary.z);
      expect(primary.x / rA).toBeCloseTo(-secondary.x / rB, 9);
      expect(primary.z / rA).toBeCloseTo(-secondary.z / rB, 9);
    }
  });

  it('相位推进使两星绕质心转动', () => {
    const p0 = binaryStarPositions(6, 2, 0).primary;
    const p1 = binaryStarPositions(6, 2, Math.PI / 2).primary;
    expect(Math.hypot(p1.x - p0.x, p1.z - p0.z)).toBeGreaterThan(0.1);
  });

  it('非法参数抛出 RangeError', () => {
    expect(() => binaryStarPositions(0, 2, 0)).toThrow(RangeError);
    expect(() => binaryStarPositions(-1, 2, 0)).toThrow(RangeError);
    expect(() => binaryStarPositions(5, 0, 0)).toThrow(RangeError);
    expect(() => binaryStarPositions(5, -2, 0)).toThrow(RangeError);
  });
});

describe('脉冲星灯塔效应（蟹状星云脉冲星）', () => {
  it('射束角随时间匀速推进（一个周期转 2π）', () => {
    expect(pulsarBeamAngle(0, 2.4)).toBe(0);
    expect(pulsarBeamAngle(2.4, 2.4)).toBeCloseTo(Math.PI * 2, 9);
    expect(pulsarBeamAngle(1.2, 2.4)).toBeCloseTo(Math.PI, 9);
  });

  it('周期非正抛出 RangeError', () => {
    expect(() => pulsarBeamAngle(1, 0)).toThrow(RangeError);
    expect(() => pulsarPulseIntensity(1, -2)).toThrow(RangeError);
  });

  it('脉冲强度在 [0, 1]，射束扫过视线时达到峰值', () => {
    // t=0：角 0 → |cos|=1 峰值
    expect(pulsarPulseIntensity(0, 2.4)).toBeCloseTo(1, 9);
    // 四分之一周期：角 π/2 → 接近 0
    expect(pulsarPulseIntensity(0.6, 2.4)).toBeLessThan(1e-6);
  });

  it('双极射束：每自转一圈产生两次脉冲（半周期后再次峰值）', () => {
    expect(pulsarPulseIntensity(1.2, 2.4)).toBeCloseTo(1, 9);
  });
});

describe('黑洞吸积盘（人马座A*）', () => {
  it('开普勒较差旋转：内圈角速度大于外圈（ω ∝ r^-1.5）', () => {
    expect(accretionDiskAngularSpeed(0.25)).toBeGreaterThan(accretionDiskAngularSpeed(0.5));
    expect(accretionDiskAngularSpeed(0.5)).toBeGreaterThan(accretionDiskAngularSpeed(1));
    // 归一化：外缘 r=1 时 ω=1
    expect(accretionDiskAngularSpeed(1)).toBeCloseTo(1, 9);
    // 精确幂律：r=0.25 → 0.25^-1.5 = 8
    expect(accretionDiskAngularSpeed(0.25)).toBeCloseTo(8, 9);
  });

  it('半径超出 (0, 1] 抛出 RangeError', () => {
    expect(() => accretionDiskAngularSpeed(0)).toThrow(RangeError);
    expect(() => accretionDiskAngularSpeed(-0.5)).toThrow(RangeError);
    expect(() => accretionDiskAngularSpeed(1.2)).toThrow(RangeError);
  });

  it('多普勒集束：接近侧亮、远离侧暗', () => {
    const approaching = dopplerBrightnessFactor(1, 0.35);
    const receding = dopplerBrightnessFactor(-1, 0.35);
    const perpendicular = dopplerBrightnessFactor(0, 0.35);
    expect(approaching).toBeGreaterThan(perpendicular);
    expect(perpendicular).toBeGreaterThan(receding);
    expect(perpendicular).toBeCloseTo(1, 9);
  });

  it('多普勒因子：cosθ 超界被钳制，β 非法抛错', () => {
    expect(dopplerBrightnessFactor(5, 0.3)).toBeCloseTo(dopplerBrightnessFactor(1, 0.3), 9);
    expect(dopplerBrightnessFactor(-5, 0.3)).toBeCloseTo(dopplerBrightnessFactor(-1, 0.3), 9);
    expect(() => dopplerBrightnessFactor(0, -0.1)).toThrow(RangeError);
    expect(() => dopplerBrightnessFactor(0, 1)).toThrow(RangeError);
  });
});

describe('星云缓慢膨胀（行星状星云等）', () => {
  it('缩放在 [1, 1+amplitude] 内循环', () => {
    for (let t = 0; t <= 150; t += 3.7) {
      const s = nebulaExpansionScale(t, 60, 0.08);
      expect(s).toBeGreaterThanOrEqual(1);
      expect(s).toBeLessThanOrEqual(1.08 + 1e-9);
    }
  });

  it('周期循环连续（sin² 保证首尾一致）', () => {
    expect(nebulaExpansionScale(0, 60, 0.1)).toBeCloseTo(nebulaExpansionScale(60, 60, 0.1), 9);
  });

  it('负时间同样有效（相位回绕）', () => {
    const s = nebulaExpansionScale(-15, 60, 0.1);
    expect(s).toBeGreaterThanOrEqual(1);
    expect(s).toBeLessThanOrEqual(1.1 + 1e-9);
  });

  it('周期非正抛出 RangeError', () => {
    expect(() => nebulaExpansionScale(1, 0)).toThrow(RangeError);
  });
});

describe('类星体光变与喷流流动（3C 273）', () => {
  it('光变闪烁围绕 1 波动（±20%）', () => {
    for (let t = 0; t <= 20; t += 0.53) {
      const v = quasarFlicker(t);
      expect(v).toBeGreaterThanOrEqual(0.8 - 1e-9);
      expect(v).toBeLessThanOrEqual(1.2 + 1e-9);
    }
  });

  it('喷流流动相位在 [0, 1) 循环，负时间回绕', () => {
    expect(jetFlowPhase01(0)).toBe(0);
    expect(jetFlowPhase01(1, 0.5)).toBeCloseTo(0.5, 9);
    expect(jetFlowPhase01(2, 0.5)).toBeCloseTo(0, 9);
    const negative = jetFlowPhase01(-0.6, 0.5);
    expect(negative).toBeGreaterThanOrEqual(0);
    expect(negative).toBeLessThan(1);
  });
});
