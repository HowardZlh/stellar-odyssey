/**
 * R4-23 星系团屏幕空间引力透镜纯逻辑单测：SIS 偏转/透镜方程/切向放大率、
 * 爱因斯坦角半径与 UV 换算、影响域窗、uniform 组合、源持有者、
 * 背景源确定性布局 + 预览注册
 */
import {
  CLUSTER_EINSTEIN_RADIUS_UNITS,
  CLUSTER_LENSING_BODY_ID,
  CLUSTER_LENSING_DOMAIN_FACTOR,
  CLUSTER_LENSING_DOMAIN_INNER_RATIO,
  CLUSTER_LENSING_FADE_SECONDS,
  CLUSTER_LENSING_THETA_E_UV_MAX,
  LENSED_BACKGROUND_SOURCE_COUNT,
  angleToUvRadius,
  clusterLensingSource,
  clusterLensingUniforms,
  einsteinAngleRad,
  lensDomainWindow,
  lensedBackgroundSources,
  resetClusterLensingSource,
  sisDeflectionMagnitude,
  sisSourceOffset,
  sisTangentialMagnification,
  writeClusterLensingEffectStrength,
  writeClusterLensingSource,
} from '../clusterLensing';
import { DETAIL_LAYER_TRANSITION_SECONDS } from '../detailLayer';
import { previewEntryForBody, MAX_PREVIEW_PARAMS } from '../devPreview';

describe('SIS 偏转纯函数', () => {
  it('偏转角大小恒为 θ_E（与像面半径无关），θ=0 处为 0', () => {
    expect(sisDeflectionMagnitude(0.5, 0.2)).toBe(0.2);
    expect(sisDeflectionMagnitude(100, 0.2)).toBe(0.2);
    expect(sisDeflectionMagnitude(0, 0.2)).toBe(0);
    expect(sisDeflectionMagnitude(1, 0)).toBe(0);
  });

  it('非法入参抛 RangeError', () => {
    expect(() => sisDeflectionMagnitude(-1, 0.2)).toThrow(RangeError);
    expect(() => sisDeflectionMagnitude(Number.NaN, 0.2)).toThrow(RangeError);
    expect(() => sisDeflectionMagnitude(1, -0.1)).toThrow(RangeError);
    expect(() => sisDeflectionMagnitude(1, Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });

  it('透镜方程 β = θ − θ_E·θ̂：径向内拉 θ_E、方向保持', () => {
    const beta = sisSourceOffset(0.3, 0.4, 0.1); // r = 0.5，θ̂ = (0.6, 0.8)
    expect(beta.x).toBeCloseTo(0.3 - 0.1 * 0.6, 12);
    expect(beta.y).toBeCloseTo(0.4 - 0.1 * 0.8, 12);
  });

  it('爱因斯坦环上（r = θ_E）β = 0（背景点源成完整环）', () => {
    const beta = sisSourceOffset(0.2, 0, 0.2);
    expect(Math.hypot(beta.x, beta.y)).toBeCloseTo(0, 12);
  });

  it('环内（r < θ_E）β 反号（翻转像），θ=0 连续性取原值', () => {
    const beta = sisSourceOffset(0.1, 0, 0.2);
    expect(beta.x).toBeCloseTo(-0.1, 12);
    expect(sisSourceOffset(0, 0, 0.2)).toEqual({ x: 0, y: 0 });
  });

  it('θ_E=0 无透镜：β = θ', () => {
    expect(sisSourceOffset(0.3, -0.4, 0)).toEqual({ x: 0.3, y: -0.4 });
  });

  it('切向放大率：r→θ_E⁺ 发散、r≫θ_E → 1、环内为负（翻转）', () => {
    expect(sisTangentialMagnification(0.2001, 0.2)).toBeGreaterThan(1000);
    expect(sisTangentialMagnification(1e6, 0.2)).toBeCloseTo(1, 6);
    expect(sisTangentialMagnification(0.1, 0.2)).toBeLessThan(0);
  });

  it('切向放大率非法入参抛 RangeError', () => {
    expect(() => sisTangentialMagnification(0, 0.2)).toThrow(RangeError);
    expect(() => sisTangentialMagnification(-1, 0.2)).toThrow(RangeError);
    expect(() => sisTangentialMagnification(1, -0.2)).toThrow(RangeError);
  });
});

describe('屏幕 UV 换算', () => {
  it('爱因斯坦角半径 = atan(R_E/d)：随距离缩小、远观自然消隐', () => {
    expect(einsteinAngleRad(420, 1800)).toBeCloseTo(Math.atan(420 / 1800), 12);
    expect(einsteinAngleRad(420, 1e9)).toBeLessThan(1e-6);
    expect(einsteinAngleRad(0, 100)).toBe(0);
  });

  it('爱因斯坦角半径非法入参抛 RangeError', () => {
    expect(() => einsteinAngleRad(-1, 100)).toThrow(RangeError);
    expect(() => einsteinAngleRad(420, 0)).toThrow(RangeError);
    expect(() => einsteinAngleRad(420, -5)).toThrow(RangeError);
    expect(() => einsteinAngleRad(Number.NaN, 100)).toThrow(RangeError);
  });

  it('角度→方形 UV：fovY 半高对应 0.5，比例线性于 tan', () => {
    const fov = (60 * Math.PI) / 180;
    expect(angleToUvRadius(fov / 2, fov)).toBeCloseTo(0.5, 12);
    expect(angleToUvRadius(0, fov)).toBe(0);
  });

  it('角度→UV 非法入参抛 RangeError', () => {
    const fov = (60 * Math.PI) / 180;
    expect(() => angleToUvRadius(-0.1, fov)).toThrow(RangeError);
    expect(() => angleToUvRadius(Math.PI / 2, fov)).toThrow(RangeError);
    expect(() => angleToUvRadius(0.1, 0)).toThrow(RangeError);
    expect(() => angleToUvRadius(0.1, Math.PI)).toThrow(RangeError);
  });

  it('域窗：内沿全强度、外沿归零、中段单调平滑（smoothstep）', () => {
    const rMax = 0.3;
    const inner = rMax * CLUSTER_LENSING_DOMAIN_INNER_RATIO;
    expect(lensDomainWindow(0, rMax)).toBe(1);
    expect(lensDomainWindow(inner, rMax)).toBe(1);
    expect(lensDomainWindow(rMax, rMax)).toBe(0);
    expect(lensDomainWindow(rMax * 2, rMax)).toBe(0);
    const mid = (inner + rMax) / 2;
    expect(lensDomainWindow(mid, rMax)).toBeCloseTo(0.5, 12);
    // 单调递减抽查
    let prev = 1;
    for (let r = inner; r <= rMax; r += (rMax - inner) / 20) {
      const w = lensDomainWindow(r, rMax);
      expect(w).toBeLessThanOrEqual(prev + 1e-12);
      prev = w;
    }
  });

  it('域窗非法入参抛 RangeError', () => {
    expect(() => lensDomainWindow(-1, 0.3)).toThrow(RangeError);
    expect(() => lensDomainWindow(0.1, 0)).toThrow(RangeError);
    expect(() => lensDomainWindow(Number.NaN, 0.3)).toThrow(RangeError);
  });

  it('uniform 组合：NDC→UV 中心、θ_E 上限钳制、域外沿 = θ_E × 系数', () => {
    const fov = (60 * Math.PI) / 180;
    const u = clusterLensingUniforms(0.2, -0.4, 1800, fov);
    expect(u.centerU).toBeCloseTo(0.6, 12);
    expect(u.centerV).toBeCloseTo(0.3, 12);
    const expected = angleToUvRadius(
      einsteinAngleRad(CLUSTER_EINSTEIN_RADIUS_UNITS, 1800),
      fov,
    );
    expect(u.thetaEUv).toBeCloseTo(expected, 12);
    expect(u.radiusMaxUv).toBeCloseTo(u.thetaEUv * CLUSTER_LENSING_DOMAIN_FACTOR, 12);
    // 近距推进：θ_E 钳到安全上限（防全屏翻转）
    const near = clusterLensingUniforms(0, 0, 200, fov);
    expect(near.thetaEUv).toBe(CLUSTER_LENSING_THETA_E_UV_MAX);
    // out 参数复用（渲染循环零分配路径）：返回同一对象且字段更新
    const reused = clusterLensingUniforms(
      0.2,
      -0.4,
      1800,
      fov,
      CLUSTER_EINSTEIN_RADIUS_UNITS,
      near,
    );
    expect(reused).toBe(near);
    expect(reused.centerU).toBeCloseTo(0.6, 12);
  });

  it('uniform 组合非法 NDC 抛 RangeError', () => {
    const fov = (60 * Math.PI) / 180;
    expect(() => clusterLensingUniforms(Number.NaN, 0, 1800, fov)).toThrow(RangeError);
    expect(() => clusterLensingUniforms(0, Number.POSITIVE_INFINITY, 1800, fov)).toThrow(
      RangeError,
    );
  });

  it('淡入淡出时长与统一细节层过渡同值同源', () => {
    expect(CLUSTER_LENSING_FADE_SECONDS).toBe(DETAIL_LAYER_TRANSITION_SECONDS);
  });
});

describe('源持有者（场景组件 → 后期 Effect）', () => {
  afterEach(() => resetClusterLensingSource());

  it('初始/重置后 present=false 且全零', () => {
    resetClusterLensingSource();
    const s = clusterLensingSource();
    expect(s.present).toBe(false);
    expect(s.visible01).toBe(0);
    expect(s.worldX).toBe(0);
  });

  it('写入后可读且 visible01 钳制 [0,1]，重置恢复初始', () => {
    writeClusterLensingSource(10, -20, 30, 1.7);
    const s = clusterLensingSource();
    expect(s.present).toBe(true);
    expect(s.worldX).toBe(10);
    expect(s.worldY).toBe(-20);
    expect(s.worldZ).toBe(30);
    expect(s.visible01).toBe(1);
    expect(s.einsteinRadiusUnits).toBe(CLUSTER_EINSTEIN_RADIUS_UNITS);
    writeClusterLensingSource(0, 0, 0, -0.5, 100);
    expect(clusterLensingSource().visible01).toBe(0);
    expect(clusterLensingSource().einsteinRadiusUnits).toBe(100);
    resetClusterLensingSource();
    expect(clusterLensingSource().present).toBe(false);
    expect(clusterLensingSource().einsteinRadiusUnits).toBe(
      CLUSTER_EINSTEIN_RADIUS_UNITS,
    );
  });

  it('爱因斯坦半径覆写非法值抛 RangeError；效果强度回写钳制 [0,1]', () => {
    expect(() => writeClusterLensingSource(0, 0, 0, 1, -1)).toThrow(RangeError);
    expect(() => writeClusterLensingSource(0, 0, 0, 1, Number.NaN)).toThrow(RangeError);
    writeClusterLensingEffectStrength(2);
    expect(clusterLensingSource().effectStrength01).toBe(1);
    writeClusterLensingEffectStrength(-1);
    expect(clusterLensingSource().effectStrength01).toBe(0);
    writeClusterLensingEffectStrength(0.4);
    expect(clusterLensingSource().effectStrength01).toBe(0.4);
    resetClusterLensingSource();
    expect(clusterLensingSource().effectStrength01).toBe(0);
  });
});

describe('背景源确定性布局', () => {
  it('默认数量且两次生成逐字段一致（附录 A §2 确定性）', () => {
    const a = lensedBackgroundSources();
    const b = lensedBackgroundSources();
    expect(a).toHaveLength(LENSED_BACKGROUND_SOURCE_COUNT);
    expect(a).toEqual(b);
  });

  it('横向半径落于 0.35–1.1 × R_E、纵深为正（背景语义）、参数有界', () => {
    for (const s of lensedBackgroundSources()) {
      const r = Math.hypot(s.x, s.y);
      expect(r).toBeGreaterThanOrEqual(CLUSTER_EINSTEIN_RADIUS_UNITS * 0.35 - 1e-9);
      expect(r).toBeLessThanOrEqual(CLUSTER_EINSTEIN_RADIUS_UNITS * 1.1 + 1e-9);
      expect(s.z).toBeGreaterThan(0);
      expect(s.scale).toBeGreaterThan(0);
      expect(s.warmth01).toBeGreaterThanOrEqual(0);
      expect(s.warmth01).toBeLessThanOrEqual(1);
    }
  });

  it('不同种子布局不同；数量越界抛 RangeError', () => {
    const a = lensedBackgroundSources(6, 1);
    const b = lensedBackgroundSources(6, 2);
    expect(a).not.toEqual(b);
    expect(lensedBackgroundSources(0)).toEqual([]);
    expect(() => lensedBackgroundSources(-1)).toThrow(RangeError);
    expect(() => lensedBackgroundSources(65)).toThrow(RangeError);
    expect(() => lensedBackgroundSources(1.5)).toThrow(RangeError);
  });
});

describe('预览注册（§R4-23 第 3 条）', () => {
  it('?body=cluster-lensing 已注册且滑杆 ≤ 上限', () => {
    const entry = previewEntryForBody(CLUSTER_LENSING_BODY_ID);
    expect(entry).not.toBeNull();
    expect(entry!.componentKey).toBe('cluster-lensing-effect');
    expect(entry!.params.length).toBeLessThanOrEqual(MAX_PREVIEW_PARAMS);
    expect(entry!.dataSource).toContain('SIS');
  });
});
