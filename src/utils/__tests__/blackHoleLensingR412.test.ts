/**
 * R4-12 黑洞吸积盘物理纯逻辑单测（IMPROVEMENT_REQUIREMENTS_4 §R4-12）
 *
 * 覆盖：温度剖面（NT 内缘截断/峰值位置与归一化/r^(−3/4) 渐近）/
 * 开普勒 β（ISCO 精确值/单调性/上限钳）/多普勒因子（近侧增亮远侧减暗）/
 * 引力红移/束流亮度与观测色温组合/盘面跨越插值/黑体 LUT（确定性 +
 * 与 R4-6 blackbodyRGB 逐点一致）/内外缘钳制/shader 同式系数断言。
 */

import {
  DISK_BETA_MAX,
  DISK_INNER_RADIUS_RS_DEFAULT,
  DISK_LUT_TEMP_MAX_K,
  DISK_LUT_TEMP_MIN_K,
  DISK_LUT_WIDTH,
  DISK_OUTER_RADIUS_RS_DEFAULT,
  DISK_RADII_MIN_GAP_RS,
  DISK_STRIPE_OMEGA,
  DISK_TEMP_PEAK_K_DEFAULT,
  DISK_TEMP_PROFILE_NORM,
  DISK_TEMP_PROFILE_PEAK_U,
  GRAV_REDSHIFT_FLOOR,
  LENSING_DOMAIN_RADIUS_RS,
  buildBlackbodyLutData,
  clampDiskRadii,
  diskBeamedBrightness,
  diskKeplerianBeta,
  diskObservedTemperatureK,
  diskTemperatureFactor01,
  diskTemperatureK,
  dopplerFactor,
  gravitationalRedshiftFactor,
  planeCrossingLerp,
} from '@/utils/blackHoleLensing';
import { blackbodyRGB } from '@/utils/starPhysics';
import { LENSING_FRAGMENT_SHADER } from '@/components/Scene/volumetric/BlackHoleLensed';

describe('R4-12 常数登记', () => {
  it('盘内缘默认 3 r_s（Schwarzschild ISCO）、外缘 12 r_s（§R4-12）', () => {
    expect(DISK_INNER_RADIUS_RS_DEFAULT).toBe(3);
    expect(DISK_OUTER_RADIUS_RS_DEFAULT).toBe(12);
    // 外缘须留在包围球内（弯折光线在球内完成盘交）
    expect(DISK_OUTER_RADIUS_RS_DEFAULT).toBeLessThan(LENSING_DOMAIN_RADIUS_RS);
  });

  it('温度剖面峰值位置 u = 49/36 与归一化系数闭式一致', () => {
    expect(DISK_TEMP_PROFILE_PEAK_U).toBeCloseTo(49 / 36, 12);
    // NORM = (49/36)^(3/4) × 7^(1/4)（f(u) 极值点代入的解析倒数）
    expect(DISK_TEMP_PROFILE_NORM).toBeCloseTo(
      Math.pow(49 / 36, 0.75) * Math.pow(7, 0.25),
      12,
    );
    expect(DISK_TEMP_PROFILE_NORM).toBeCloseTo(2.0499, 3);
  });

  it('LUT 温度域覆盖盘温 × 偏移域且宽度 ≥2', () => {
    expect(DISK_LUT_TEMP_MIN_K).toBeLessThan(DISK_LUT_TEMP_MAX_K);
    expect(DISK_LUT_TEMP_MAX_K).toBeGreaterThan(DISK_TEMP_PEAK_K_DEFAULT);
    expect(DISK_LUT_WIDTH).toBeGreaterThanOrEqual(2);
  });
});

describe('diskTemperatureFactor01（NT 内缘截断剖面）', () => {
  const rIn = 3;

  it('内缘及以内为 0（无稳定圆轨道截断登记）', () => {
    expect(diskTemperatureFactor01(rIn, rIn)).toBe(0);
    expect(diskTemperatureFactor01(rIn * 0.5, rIn)).toBe(0);
    expect(diskTemperatureFactor01(Number.NaN, rIn)).toBe(0);
  });

  it('峰值 1 恰落 r = (49/36)·r_in（解析极值点）', () => {
    const rPeak = DISK_TEMP_PROFILE_PEAK_U * rIn;
    expect(diskTemperatureFactor01(rPeak, rIn)).toBeCloseTo(1, 9);
    // 两侧低于峰值
    expect(diskTemperatureFactor01(rPeak * 0.9, rIn)).toBeLessThan(1);
    expect(diskTemperatureFactor01(rPeak * 1.1, rIn)).toBeLessThan(1);
  });

  it('峰值以外单调下降', () => {
    let prev = diskTemperatureFactor01(DISK_TEMP_PROFILE_PEAK_U * rIn, rIn);
    for (let r = 4.5; r <= 12; r += 0.5) {
      const f = diskTemperatureFactor01(r, rIn);
      expect(f).toBeLessThan(prev);
      prev = f;
    }
  });

  it('远端趋 r^(−3/4) 渐近（截断项 → 1）：f(2r)/f(r) → 2^(−3/4)', () => {
    const r = 1e5;
    const ratio = diskTemperatureFactor01(2 * r, rIn) / diskTemperatureFactor01(r, rIn);
    expect(ratio).toBeCloseTo(Math.pow(2, -0.75), 3);
  });

  it('diskTemperatureK = 峰值温度 × 剖面', () => {
    const rPeak = DISK_TEMP_PROFILE_PEAK_U * rIn;
    expect(diskTemperatureK(rPeak, rIn)).toBeCloseTo(DISK_TEMP_PEAK_K_DEFAULT, 6);
    expect(diskTemperatureK(rPeak, rIn, 10000)).toBeCloseTo(10000, 6);
  });

  it('内缘非法（≤1 或非有限）抛 RangeError', () => {
    expect(() => diskTemperatureFactor01(5, 1)).toThrow(RangeError);
    expect(() => diskTemperatureFactor01(5, 0)).toThrow(RangeError);
    expect(() => diskTemperatureFactor01(5, Number.NaN)).toThrow(RangeError);
  });
});

describe('diskKeplerianBeta（Schwarzschild 圆轨道局域速度）', () => {
  it('ISCO r = 3 r_s 处恰 β = 0.5（精确解析值）', () => {
    expect(diskKeplerianBeta(3)).toBeCloseTo(0.5, 12);
  });

  it('随 r 单调下降（外盘慢）', () => {
    expect(diskKeplerianBeta(3)).toBeGreaterThan(diskKeplerianBeta(6));
    expect(diskKeplerianBeta(6)).toBeGreaterThan(diskKeplerianBeta(12));
    // r = 12 处 β = √(0.5/11)
    expect(diskKeplerianBeta(12)).toBeCloseTo(Math.sqrt(0.5 / 11), 12);
  });

  it('近视界/非法输入钳上限 DISK_BETA_MAX', () => {
    expect(diskKeplerianBeta(1.5)).toBe(DISK_BETA_MAX);
    expect(diskKeplerianBeta(1)).toBe(DISK_BETA_MAX);
    expect(diskKeplerianBeta(Number.NaN)).toBe(DISK_BETA_MAX);
    expect(DISK_BETA_MAX).toBeLessThan(1);
  });
});

describe('dopplerFactor（相对论多普勒 δ）', () => {
  it('β = 0 恒为 1（无运动无偏移）', () => {
    expect(dopplerFactor(0, 1)).toBeCloseTo(1, 12);
    expect(dopplerFactor(0, -1)).toBeCloseTo(1, 12);
  });

  it('接近（cosθ > 0）δ > 1 增亮、远离（cosθ < 0）δ < 1 减暗', () => {
    const beta = 0.5;
    expect(dopplerFactor(beta, 1)).toBeGreaterThan(1);
    expect(dopplerFactor(beta, -1)).toBeLessThan(1);
    // β = 0.5 正对接近：δ = √0.75/0.5 = √3 ≈ 1.732
    expect(dopplerFactor(0.5, 1)).toBeCloseTo(Math.sqrt(3), 6);
    // 正对远离：δ = √0.75/1.5 = 1/√3
    expect(dopplerFactor(0.5, -1)).toBeCloseTo(1 / Math.sqrt(3), 6);
  });

  it('横向（cosθ = 0）为纯二阶红移 δ = √(1−β²) < 1', () => {
    expect(dopplerFactor(0.5, 0)).toBeCloseTo(Math.sqrt(0.75), 12);
  });

  it('非法输入钳制不产生 NaN/Inf', () => {
    expect(Number.isFinite(dopplerFactor(Number.NaN, 2))).toBe(true);
    expect(Number.isFinite(dopplerFactor(2, 1))).toBe(true);
    expect(Number.isFinite(dopplerFactor(0.999, 1))).toBe(true);
  });
});

describe('gravitationalRedshiftFactor（引力红移 g = √(1−r_s/r)）', () => {
  it('关键点：r = 3 → √(2/3)、r → ∞ → 1', () => {
    expect(gravitationalRedshiftFactor(3)).toBeCloseTo(Math.sqrt(2 / 3), 12);
    expect(gravitationalRedshiftFactor(1e9)).toBeCloseTo(1, 6);
  });

  it('随 r 减小单调加深（红移更强）', () => {
    expect(gravitationalRedshiftFactor(2)).toBeLessThan(gravitationalRedshiftFactor(3));
    expect(gravitationalRedshiftFactor(3)).toBeLessThan(gravitationalRedshiftFactor(12));
  });

  it('视界内/非法输入钳下限 GRAV_REDSHIFT_FLOOR', () => {
    expect(gravitationalRedshiftFactor(1)).toBe(GRAV_REDSHIFT_FLOOR);
    expect(gravitationalRedshiftFactor(0.5)).toBe(GRAV_REDSHIFT_FLOOR);
    expect(gravitationalRedshiftFactor(Number.NaN)).toBe(GRAV_REDSHIFT_FLOOR);
  });
});

describe('diskBeamedBrightness / diskObservedTemperatureK（束流组合）', () => {
  it('束流强度 1（物理档）：近/远亮度比 = (δ⁺/δ⁻)³（δ³ 近似登记）', () => {
    const beta = diskKeplerianBeta(3);
    const g = gravitationalRedshiftFactor(3);
    const dNear = dopplerFactor(beta, 0.9);
    const dFar = dopplerFactor(beta, -0.9);
    const ratio = diskBeamedBrightness(dNear, g, 1) / diskBeamedBrightness(dFar, g, 1);
    expect(ratio).toBeCloseTo(Math.pow(dNear / dFar, 3), 9);
    expect(ratio).toBeGreaterThan(2); // 近亮远暗不对称显著（验收观感依据）
  });

  it('束流强度 0：多普勒关闭，只剩引力项 g³', () => {
    const g = gravitationalRedshiftFactor(4);
    expect(diskBeamedBrightness(1.7, g, 0)).toBeCloseTo(g * g * g, 12);
    expect(diskBeamedBrightness(0.6, g, 0)).toBeCloseTo(g * g * g, 12);
  });

  it('观测色温 = 盘温 × δ^strength × g（近侧蓝移升温/远侧红移降温）', () => {
    const g = gravitationalRedshiftFactor(3);
    expect(diskObservedTemperatureK(7000, 1.5, g, 1)).toBeCloseTo(7000 * 1.5 * g, 9);
    expect(diskObservedTemperatureK(7000, 0.6, g, 1)).toBeLessThan(7000 * g);
    // strength=0 时色温不随 δ 变化
    expect(diskObservedTemperatureK(7000, 1.5, 1, 0)).toBeCloseTo(7000, 9);
  });

  it('引力红移不随束流滑杆关闭（物理常开登记）', () => {
    const g = gravitationalRedshiftFactor(2.5);
    expect(diskBeamedBrightness(1, g, 0)).toBeLessThan(1);
    expect(diskObservedTemperatureK(7000, 1, g, 0)).toBeLessThan(7000);
  });
});

describe('planeCrossingLerp（盘面跨越线性插值，shader 同式）', () => {
  it('对称跨越 t = 0.5；不对称按高度比例', () => {
    expect(planeCrossingLerp(1, -1)).toBeCloseTo(0.5, 12);
    expect(planeCrossingLerp(3, -1)).toBeCloseTo(0.75, 12);
    expect(planeCrossingLerp(1, -3)).toBeCloseTo(0.25, 12);
  });

  it('同值/非有限输入返回 0.5（防除零），输出钳 [0,1]', () => {
    expect(planeCrossingLerp(1, 1)).toBe(0.5);
    expect(planeCrossingLerp(Number.NaN, 1)).toBe(0.5);
    expect(planeCrossingLerp(2, 1)).toBeLessThanOrEqual(1);
    expect(planeCrossingLerp(-1, -2)).toBeGreaterThanOrEqual(0);
  });
});

describe('clampDiskRadii（内外缘滑杆钳制）', () => {
  it('合法输入原样通过', () => {
    expect(clampDiskRadii(3, 12)).toEqual({ innerRs: 3, outerRs: 12 });
  });

  it('内缘钳到外缘 − 最小间隔（防交叉）', () => {
    const r = clampDiskRadii(12, 6);
    expect(r.outerRs).toBe(6);
    expect(r.innerRs).toBe(6 - DISK_RADII_MIN_GAP_RS);
  });

  it('外缘上限 = 包围球半径 − 1；内缘下限 1.5', () => {
    const r = clampDiskRadii(0.5, 100);
    expect(r.outerRs).toBe(LENSING_DOMAIN_RADIUS_RS - 1);
    expect(r.innerRs).toBe(1.5);
  });

  it('非有限输入回落默认档', () => {
    const r = clampDiskRadii(Number.NaN, Number.NaN);
    expect(r.innerRs).toBe(DISK_INNER_RADIUS_RS_DEFAULT);
    expect(r.outerRs).toBe(DISK_OUTER_RADIUS_RS_DEFAULT);
  });
});

describe('buildBlackbodyLutData（R4-6 blackbodyRGB 复用）', () => {
  it('RGBA 布局、alpha 恒 255、确定性双次逐字节一致', () => {
    const a = buildBlackbodyLutData();
    const b = buildBlackbodyLutData();
    expect(a.length).toBe(DISK_LUT_WIDTH * 4);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
    for (let i = 3; i < a.length; i += 4) expect(a[i]).toBe(255);
  });

  it('逐 texel 与 blackbodyRGB 采样一致（同式断言）', () => {
    const data = buildBlackbodyLutData(16);
    for (let i = 0; i < 16; i += 1) {
      const t = DISK_LUT_TEMP_MIN_K + ((DISK_LUT_TEMP_MAX_K - DISK_LUT_TEMP_MIN_K) * i) / 15;
      const rgb = blackbodyRGB(t);
      expect(data[i * 4]).toBe(Math.round(rgb.r * 255));
      expect(data[i * 4 + 1]).toBe(Math.round(rgb.g * 255));
      expect(data[i * 4 + 2]).toBe(Math.round(rgb.b * 255));
    }
  });

  it('低温端偏红橙、高温端偏蓝（黑体色板方向正确）', () => {
    const data = buildBlackbodyLutData(8);
    // 低温：R > B；高温：B > R
    expect(data[0]).toBeGreaterThan(data[2]);
    expect(data[7 * 4 + 2]).toBeGreaterThan(data[7 * 4]);
  });

  it('宽度非法抛 RangeError', () => {
    expect(() => buildBlackbodyLutData(1)).toThrow(RangeError);
    expect(() => buildBlackbodyLutData(2.5)).toThrow(RangeError);
    expect(() => buildBlackbodyLutData(Number.NaN)).toThrow(RangeError);
  });
});

describe('shader 同式系数断言（模板插值单点同源）', () => {
  it('盘常数经模板插值写入 fragment shader', () => {
    expect(LENSING_FRAGMENT_SHADER).toContain(
      `const float DISK_TEMP_NORM = ${DISK_TEMP_PROFILE_NORM.toFixed(6)};`,
    );
    expect(LENSING_FRAGMENT_SHADER).toContain(
      `const float DISK_PEAK_K = ${DISK_TEMP_PEAK_K_DEFAULT.toFixed(1)};`,
    );
    expect(LENSING_FRAGMENT_SHADER).toContain(
      `const float DISK_BETA_MAX = ${DISK_BETA_MAX.toFixed(2)};`,
    );
    expect(LENSING_FRAGMENT_SHADER).toContain(
      `const float GRAV_FLOOR = ${GRAV_REDSHIFT_FLOOR.toFixed(2)};`,
    );
    expect(LENSING_FRAGMENT_SHADER).toContain(
      `const float LUT_T_MIN = ${DISK_LUT_TEMP_MIN_K.toFixed(1)};`,
    );
    expect(LENSING_FRAGMENT_SHADER).toContain(
      `const float LUT_T_MAX = ${DISK_LUT_TEMP_MAX_K.toFixed(1)};`,
    );
    expect(LENSING_FRAGMENT_SHADER).toContain(
      `const float STRIPE_OMEGA = ${DISK_STRIPE_OMEGA.toFixed(1)};`,
    );
  });

  it('shader 含温度剖面/β/δ/g 同式片段（diskTemperatureFactor01 等镜像）', () => {
    // T(r) ∝ r^(−3/4) × 截断^(1/4)
    expect(LENSING_FRAGMENT_SHADER).toContain(
      'pow(uu, -0.75) * pow(max(1.0 - inversesqrt(uu), 0.0), 0.25) * DISK_TEMP_NORM',
    );
    // β = √(0.5/(r−1)) 钳上限
    expect(LENSING_FRAGMENT_SHADER).toContain('min(sqrt(0.5 / max(rC - 1.0, 0.5)), DISK_BETA_MAX)');
    // δ = √(1−β²)/(1−β·cosθ)
    expect(LENSING_FRAGMENT_SHADER).toContain(
      'sqrt(1.0 - beta * beta) / max(1.0 - beta * cosT, 1e-3)',
    );
    // g = √(1−1/r) 钳下限
    expect(LENSING_FRAGMENT_SHADER).toContain('max(sqrt(max(1.0 - 1.0 / rC, 0.0)), GRAV_FLOOR)');
    // 观测色温 = 峰值 × 剖面 × δ_eff × g
    expect(LENSING_FRAGMENT_SHADER).toContain('DISK_PEAK_K * tf * dEff * g');
    // 亮度 δ_eff³ × g³（δ³ 近似 + 引力减暗）
    expect(LENSING_FRAGMENT_SHADER).toContain('dEff * dEff * dEff * g * g * g');
  });

  it('shader 含盘面跨越检测与 R4-12 uniforms', () => {
    expect(LENSING_FRAGMENT_SHADER).toContain('diskP.y * diskPNext.y < 0.0');
    for (const u of [
      'uBlackbodyLUT',
      'uTime',
      'uDiskInnerRs',
      'uDiskOuterRs',
      'uBeamStrength',
      'uDiskBrightness',
      'uDiskRot',
    ]) {
      expect(LENSING_FRAGMENT_SHADER).toContain(u);
    }
  });
});
