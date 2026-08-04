/**
 * R4-11 黑洞引力透镜纯逻辑单测（IMPROVEMENT_REQUIREMENTS_4 §R4-11）
 *
 * 覆盖：偏转角函数（弱场/二阶闭式）/撞击与阴影判定/光子环权重核/
 * CPU 参考光线追踪样例（与 shader 同式系数一致性断言）/程序化星场
 * 面数据（确定性，附录 A §2）。
 */

import {
  CAPTURE_RADIUS_RS,
  DEFLECTION_SECOND_ORDER_COEFF,
  LENSING_DOMAIN_RADIUS_RS,
  LENSING_STEPS_DEFAULT,
  LENSING_STEPS_MAX,
  LENSING_STEPS_MIN,
  MAX_BEND_PER_STEP_RAD,
  PHOTON_RING_IMPACT_RS,
  PHOTON_RING_IMPACT_SIGMA_RS,
  PHOTON_RING_SIGMA_RS,
  PHOTON_SPHERE_RADIUS_RS,
  STARFIELD_FACE_SIZE,
  STARFIELD_PALETTE,
  buildStarfieldFaceData,
  clampLensingSteps,
  deflectionAngleRad,
  deflectionRatePerRs,
  impactParameterRs,
  isCaptured,
  isShadowed,
  lensingSeed,
  photonRingWeight,
  ringImpactWeight,
  traceLensedRay,
  weakFieldDeflectionRad,
  type Vec3,
} from '@/utils/blackHoleLensing';
import { LENSING_FRAGMENT_SHADER } from '@/components/Scene/volumetric/BlackHoleLensed';

/** 从远处沿 +z 射入、撞击参数 b 沿 x 偏移的标准样例光线 */
function shoot(b: number, steps?: number) {
  return traceLensedRay({ x: b, y: 0, z: -40 }, { x: 0, y: 0, z: 1 }, { steps });
}

/** 两单位向量夹角（rad） */
function angleBetween(a: Vec3, b: Vec3): number {
  return Math.acos(Math.max(-1, Math.min(1, a.x * b.x + a.y * b.y + a.z * b.z)));
}

const FORWARD: Vec3 = { x: 0, y: 0, z: 1 };

describe('R4-11 常数登记', () => {
  it('临界撞击参数 b_crit = 3√3/2 ≈ 2.598（Schwarzschild 捕获截面精确值）', () => {
    expect(PHOTON_RING_IMPACT_RS).toBeCloseTo((3 * Math.sqrt(3)) / 2, 12);
    expect(PHOTON_RING_IMPACT_RS).toBeCloseTo(2.598, 3);
  });

  it('二阶系数 K = 15/8（二阶项 (15π/16)/b²，Keeton & Petters 2005）', () => {
    expect(DEFLECTION_SECOND_ORDER_COEFF).toBe(15 / 8);
  });

  it('半径序关系：撞击 1.05 < 光子球 1.5 < b_crit < 包围球 14', () => {
    expect(CAPTURE_RADIUS_RS).toBe(1.05);
    expect(PHOTON_SPHERE_RADIUS_RS).toBe(1.5);
    expect(CAPTURE_RADIUS_RS).toBeLessThan(PHOTON_SPHERE_RADIUS_RS);
    expect(PHOTON_SPHERE_RADIUS_RS).toBeLessThan(PHOTON_RING_IMPACT_RS);
    expect(PHOTON_RING_IMPACT_RS).toBeLessThan(LENSING_DOMAIN_RADIUS_RS);
  });

  it('步进钳制：默认 64、域 [16,128]、NaN 回退默认、取整', () => {
    expect(clampLensingSteps(Number.NaN)).toBe(LENSING_STEPS_DEFAULT);
    expect(clampLensingSteps(0)).toBe(LENSING_STEPS_MIN);
    expect(clampLensingSteps(999)).toBe(LENSING_STEPS_MAX);
    expect(clampLensingSteps(63.6)).toBe(64);
  });
});

describe('偏转角函数', () => {
  it('弱场式 α = 2/b（即 4GM/(c²b)，r_s = 2GM/c²）', () => {
    expect(weakFieldDeflectionRad(4)).toBeCloseTo(0.5, 12);
    expect(weakFieldDeflectionRad(10)).toBeCloseTo(0.2, 12);
  });

  it('二阶闭式 α = 2/b + (15π/16)/b²', () => {
    for (const b of [2.6, 4, 8, 20]) {
      expect(deflectionAngleRad(b)).toBeCloseTo(2 / b + ((15 * Math.PI) / 16) / (b * b), 12);
    }
  });

  it('大 b 渐近回归弱场（二阶项占比 → 0）', () => {
    const ratio = deflectionAngleRad(1000) / weakFieldDeflectionRad(1000);
    expect(ratio).toBeGreaterThan(1);
    expect(ratio).toBeLessThan(1.01);
  });

  it('非正 b 返回 0（防护）', () => {
    expect(weakFieldDeflectionRad(0)).toBe(0);
    expect(weakFieldDeflectionRad(-1)).toBe(0);
    expect(deflectionAngleRad(0)).toBe(0);
    expect(deflectionAngleRad(Number.NaN)).toBe(0);
  });

  it('弯折空间分布核 = 弱场积分核 b/r³（r 下限钳制、负 b 归零）', () => {
    expect(deflectionRatePerRs(2, 3)).toBeCloseTo(3 / 8, 12);
    expect(deflectionRatePerRs(0, 3)).toBe(3 / 1e-12);
    expect(deflectionRatePerRs(2, -5)).toBe(0);
  });
});

describe('撞击/阴影判定', () => {
  it('撞击：r ≤ 1.05 r_s（§R4-11 指定阈值，边界含等号）', () => {
    expect(isCaptured(1.0)).toBe(true);
    expect(isCaptured(1.05)).toBe(true);
    expect(isCaptured(1.0500001)).toBe(false);
  });

  it('阴影：b < b_crit 且朝向中心（解析捕获截面，边界不含等号）', () => {
    expect(isShadowed(2.5, -1)).toBe(true);
    expect(isShadowed(PHOTON_RING_IMPACT_RS, -1)).toBe(false);
    expect(isShadowed(3, -1)).toBe(false);
    // 外行光线（radialDot ≥ 0）不论 b 均出射（近距观察者防误黑）
    expect(isShadowed(2.5, 1)).toBe(false);
    expect(isShadowed(0.5, 0)).toBe(false);
  });
});

describe('光子环权重核', () => {
  it('驻留核峰值在光子球 r = 1.5，对称衰减', () => {
    expect(photonRingWeight(PHOTON_SPHERE_RADIUS_RS)).toBeCloseTo(1, 12);
    expect(photonRingWeight(1.5 + PHOTON_RING_SIGMA_RS)).toBeCloseTo(Math.exp(-1), 12);
    expect(photonRingWeight(1.2)).toBeCloseTo(photonRingWeight(1.8), 12);
    expect(photonRingWeight(5)).toBeLessThan(1e-8);
  });

  it('撞击参数选通核峰值在 b_crit ≈ 2.6（§R4-11 增亮位置）', () => {
    expect(ringImpactWeight(PHOTON_RING_IMPACT_RS)).toBeCloseTo(1, 12);
    expect(ringImpactWeight(PHOTON_RING_IMPACT_RS + PHOTON_RING_IMPACT_SIGMA_RS)).toBeCloseTo(
      Math.exp(-1),
      12,
    );
    expect(ringImpactWeight(6)).toBeLessThan(1e-8);
  });
});

describe('撞击参数 impactParameterRs', () => {
  it('垂直入射 b = 横向偏移；对准中心 b = 0', () => {
    expect(impactParameterRs({ x: 3, y: 0, z: -40 }, FORWARD)).toBeCloseTo(3, 12);
    expect(impactParameterRs({ x: 0, y: 0, z: -40 }, FORWARD)).toBeCloseTo(0, 12);
    expect(impactParameterRs({ x: 0, y: -2.5, z: 7 }, FORWARD)).toBeCloseTo(2.5, 12);
  });
});

describe('CPU 参考光线追踪（shader 同式镜像）', () => {
  it('样例①（b=6 弱场）：出射且总偏转 = 二阶闭式（预算硬钳一致性）', () => {
    const r = shoot(6);
    expect(r.status).toBe('escaped');
    expect(angleBetween(FORWARD, r.direction)).toBeCloseTo(deflectionAngleRad(6), 3);
  });

  it('样例②（b=3/b=4 中场）：出射且总偏转 = 二阶闭式', () => {
    for (const b of [3, 4]) {
      const r = shoot(b);
      expect(r.status).toBe('escaped');
      expect(angleBetween(FORWARD, r.direction)).toBeCloseTo(deflectionAngleRad(b), 3);
    }
  });

  it('样例③（b=2.6 近临界）：环发光显著高于两侧（光子环成形）', () => {
    const nearRing = shoot(2.6);
    expect(nearRing.ringGlow).toBeGreaterThan(0.5);
    expect(nearRing.ringGlow).toBeGreaterThan(shoot(2.2).ringGlow * 2);
    expect(nearRing.ringGlow).toBeGreaterThan(shoot(3.2).ringGlow * 2);
  });

  it('样例④（b=1 深入射）：撞击终止为黑，minR ≤ 1.05', () => {
    const r = shoot(1);
    expect(r.status).toBe('captured');
    expect(r.minRadiusRs).toBeLessThanOrEqual(CAPTURE_RADIUS_RS);
    expect(r.stepsUsed).toBeLessThan(LENSING_STEPS_DEFAULT);
  });

  it('样例⑤（b=2.5 < b_crit）：解析阴影判据兜底为 captured', () => {
    expect(shoot(2.5).status).toBe('captured');
  });

  it('截断登记：域边缘（b=10）偏转不超过闭式（预算未耗尽）', () => {
    const r = shoot(10);
    const bend = angleBetween(FORWARD, r.direction);
    expect(r.status).toBe('escaped');
    expect(bend).toBeLessThanOrEqual(deflectionAngleRad(10) + 1e-9);
    expect(bend).toBeGreaterThan(deflectionAngleRad(10) * 0.5);
  });

  it('未命中包围球：原方向出射、零步进、零环发光', () => {
    const r = traceLensedRay({ x: 40, y: 0, z: -40 }, FORWARD);
    expect(r.status).toBe('escaped');
    expect(r.stepsUsed).toBe(0);
    expect(r.ringGlow).toBe(0);
    expect(r.direction).toEqual(FORWARD);
    // 背向远离（tm ≤ 0）同样直接出射
    expect(traceLensedRay({ x: 0, y: 0, z: 40 }, FORWARD).stepsUsed).toBe(0);
  });

  it('起点在包围球内：直接步进（正常出射）', () => {
    const r = traceLensedRay({ x: 5, y: 0, z: -5 }, FORWARD, { steps: 128 });
    expect(r.status).toBe('escaped');
    expect(r.stepsUsed).toBeGreaterThan(0);
  });

  it('近距观察者外行光线：b < b_crit 亦出射（视野不整片误黑）', () => {
    // 观察者位于 2 r_s（光子球外、b_crit 内），径向朝外反向追踪
    const outward = traceLensedRay({ x: 0, y: 0, z: 2 }, FORWARD);
    expect(outward.status).toBe('escaped');
    // 同位置朝向中心的光线仍为阴影/撞击
    const inward = traceLensedRay({ x: 0, y: 0, z: 2 }, { x: 0, y: 0, z: -1 });
    expect(inward.status).toBe('captured');
  });

  it('数值防护：零方向/对心光线/全 b 扫掠无 NaN', () => {
    const zeroDir = traceLensedRay({ x: 5, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
    expect(Number.isFinite(zeroDir.direction.x)).toBe(true);
    const center = traceLensedRay({ x: 0, y: 0, z: -40 }, FORWARD);
    expect(center.status).toBe('captured');
    for (let b = 0.1; b <= 13.6; b += 0.5) {
      const r = shoot(b);
      expect(Number.isFinite(r.direction.x)).toBe(true);
      expect(Number.isFinite(r.direction.y)).toBe(true);
      expect(Number.isFinite(r.direction.z)).toBe(true);
      expect(Number.isFinite(r.ringGlow)).toBe(true);
      const len = Math.hypot(r.direction.x, r.direction.y, r.direction.z);
      expect(len).toBeCloseTo(1, 6);
    }
  });

  it('确定性：同输入两次追踪结果一致（附录 A §2）', () => {
    expect(shoot(2.7)).toEqual(shoot(2.7));
  });

  it('步数选项：高步数基准与 64 步偏转一致（预算控制总量）', () => {
    const lo = angleBetween(FORWARD, shoot(4, 64).direction);
    const hi = angleBetween(FORWARD, shoot(4, 1024).direction);
    expect(lo).toBeCloseTo(hi, 3);
  });
});

describe('shader 系数一致性（常数单点同源断言）', () => {
  it('fragment shader 内嵌常数与纯逻辑模块同值', () => {
    expect(LENSING_FRAGMENT_SHADER).toContain(
      `R_DOMAIN = ${LENSING_DOMAIN_RADIUS_RS.toFixed(1)}`,
    );
    expect(LENSING_FRAGMENT_SHADER).toContain(`R_CAPTURE = ${CAPTURE_RADIUS_RS.toFixed(2)}`);
    expect(LENSING_FRAGMENT_SHADER).toContain(`R_PHOTON = ${PHOTON_SPHERE_RADIUS_RS.toFixed(1)}`);
    expect(LENSING_FRAGMENT_SHADER).toContain(`B_CRIT = ${PHOTON_RING_IMPACT_RS.toFixed(6)}`);
    expect(LENSING_FRAGMENT_SHADER).toContain(
      `RING_SIGMA_R = ${PHOTON_RING_SIGMA_RS.toFixed(2)}`,
    );
    expect(LENSING_FRAGMENT_SHADER).toContain(
      `RING_SIGMA_B = ${PHOTON_RING_IMPACT_SIGMA_RS.toFixed(2)}`,
    );
    expect(LENSING_FRAGMENT_SHADER).toContain(
      `SECOND_ORDER = ${((DEFLECTION_SECOND_ORDER_COEFF * Math.PI) / 2).toFixed(6)}`,
    );
    expect(LENSING_FRAGMENT_SHADER).toContain(`MAX_BEND = ${MAX_BEND_PER_STEP_RAD.toFixed(2)}`);
    // 循环编译期上界 = 步数上限；log depth 兼容 include（附录 A §5）
    expect(LENSING_FRAGMENT_SHADER).toContain(`i < ${LENSING_STEPS_MAX}`);
    expect(LENSING_FRAGMENT_SHADER).toContain('logdepthbuf_fragment');
  });
});

describe('程序化星场面数据（128px/面，无贴图资产）', () => {
  it('尺寸/格式：RGBA 长度 = size²×4，alpha 全 255', () => {
    const data = buildStarfieldFaceData(0, 32);
    expect(data.length).toBe(32 * 32 * 4);
    for (let i = 3; i < data.length; i += 4) {
      expect(data[i]).toBe(255);
    }
  });

  it('默认 128px/面（§R4-11 指定小尺寸）', () => {
    expect(STARFIELD_FACE_SIZE).toBe(128);
    expect(buildStarfieldFaceData(2).length).toBe(128 * 128 * 4);
  });

  it('确定性：同面同种子两次生成一致；不同面/种子内容不同（附录 A §2）', () => {
    const a = buildStarfieldFaceData(1, 64);
    expect(a).toEqual(buildStarfieldFaceData(1, 64));
    expect(a).not.toEqual(buildStarfieldFaceData(2, 64));
    expect(a).not.toEqual(buildStarfieldFaceData(1, 64, 12345));
  });

  it('含星点（非全黑）且分量在 0–255', () => {
    const data = buildStarfieldFaceData(3);
    let lit = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] > 0 || data[i + 1] > 0 || data[i + 2] > 0) lit += 1;
      expect(data[i]).toBeLessThanOrEqual(255);
    }
    expect(lit).toBeGreaterThan(100);
    expect(lit).toBeLessThan(128 * 128 * 0.5);
  });

  it('色板为 O/B 蓝 → M 红 sRGB 档（Starfield 同源观感）', () => {
    expect(STARFIELD_PALETTE.length).toBeGreaterThanOrEqual(5);
    expect(STARFIELD_PALETTE[0][2]).toBeGreaterThan(STARFIELD_PALETTE[0][0]); // 蓝端
    const last = STARFIELD_PALETTE[STARFIELD_PALETTE.length - 1];
    expect(last[0]).toBeGreaterThan(last[2]); // 红端
  });

  it('lensingSeed：FNV-1a 确定性哈希，不同 id 不同种子', () => {
    expect(lensingSeed('blackhole-starfield')).toBe(lensingSeed('blackhole-starfield'));
    expect(lensingSeed('a')).not.toBe(lensingSeed('b'));
    expect(Number.isInteger(lensingSeed('x'))).toBe(true);
  });
});
