/**
 * R4-3 体积渲染框架 ① 单测：密度场构建 / 塑形基元 / CPU 发射-吸收积分校验
 * （IMPROVEMENT_REQUIREMENTS_4 §R4-3 验收 3：含确定性双次构建逐字节一致断言）
 */

import * as THREE from 'three';
import {
  assertVolumeTextureSize,
  buildDensityData,
  buildDensityTexture,
  clampVolumeSteps,
  constantDensityEmissionAnalytic,
  ellipsoidSdf,
  fbm3,
  integrateEmissionAbsorption,
  intersectRayBox,
  makeSphericalFbmCloudSampler,
  sdfDensityFalloff,
  shellSdf,
  smoothSubtractSdf,
  smoothUnionSdf,
  sphereSdf,
  volumeSeed,
  VOLUME_STEPS_DEFAULT,
  VOLUME_STEPS_MAX,
  VOLUME_STEPS_MIN,
  VOLUME_TEXTURE_MAX_SIZE,
  VOLUME_TEXTURE_MIN_SIZE,
} from '@/utils/volume';

describe('volumeSeed（FNV-1a 确定性种子）', () => {
  it('同一 id 双次调用一致，为 32 位无符号整数', () => {
    const a = volumeSeed('volume-test');
    expect(volumeSeed('volume-test')).toBe(a);
    expect(Number.isInteger(a)).toBe(true);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThanOrEqual(0xffffffff);
  });

  it('不同 id 产生不同种子', () => {
    expect(volumeSeed('orion-nebula')).not.toBe(volumeSeed('ring-nebula'));
    expect(volumeSeed('')).not.toBe(volumeSeed('a'));
  });
});

describe('clampVolumeSteps（步进数钳制 16–128）', () => {
  it('区间内取整、区间外钳制', () => {
    expect(clampVolumeSteps(64)).toBe(64);
    expect(clampVolumeSteps(63.6)).toBe(64);
    expect(clampVolumeSteps(1)).toBe(VOLUME_STEPS_MIN);
    expect(clampVolumeSteps(999)).toBe(VOLUME_STEPS_MAX);
  });

  it('非有限输入回落默认 64', () => {
    expect(clampVolumeSteps(NaN)).toBe(VOLUME_STEPS_DEFAULT);
    expect(clampVolumeSteps(Infinity)).toBe(VOLUME_STEPS_DEFAULT);
  });
});

describe('fbm3（3D 值噪声分形，复用 valueNoise3D 基元）', () => {
  it('输出在 [0,1] 且确定性（同参双次一致）', () => {
    for (let i = 0; i < 50; i += 1) {
      const x = (i * 0.37) % 5;
      const y = (i * 0.73) % 5;
      const z = (i * 1.19) % 5;
      const v = fbm3(x, y, z, { seed: 42 });
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      expect(fbm3(x, y, z, { seed: 42 })).toBe(v);
    }
  });

  it('不同种子产生不同场（域偏移注入）', () => {
    expect(fbm3(1.3, 2.1, 0.7, { seed: 1 })).not.toBe(fbm3(1.3, 2.1, 0.7, { seed: 2 }));
  });

  it('空间连续（微小位移下取值变化微小）', () => {
    const eps = 1e-4;
    const a = fbm3(1.5, -0.3, 2.2, { seed: 7 });
    const b = fbm3(1.5 + eps, -0.3, 2.2, { seed: 7 });
    expect(Math.abs(a - b)).toBeLessThan(0.01);
  });

  it('octaves 非法抛 RangeError', () => {
    expect(() => fbm3(0, 0, 0, { octaves: 0 })).toThrow(RangeError);
    expect(() => fbm3(0, 0, 0, { octaves: 2.5 })).toThrow(RangeError);
  });
});

describe('SDF 塑形基元（球/椭球/壳层/软衰减）', () => {
  it('sphereSdf：内负外正、表面为零', () => {
    expect(sphereSdf(0, 0, 0, 1)).toBe(-1);
    expect(sphereSdf(1, 0, 0, 1)).toBeCloseTo(0, 12);
    expect(sphereSdf(2, 0, 0, 1)).toBeCloseTo(1, 12);
  });

  it('ellipsoidSdf：等轴退化为球、轴端点为零、原点为负最短半轴', () => {
    expect(ellipsoidSdf(0.5, 0, 0, 1, 1, 1)).toBeCloseTo(sphereSdf(0.5, 0, 0, 1), 10);
    expect(ellipsoidSdf(2, 0, 0, 2, 1, 0.5)).toBeCloseTo(0, 10);
    expect(ellipsoidSdf(0, 1, 0, 2, 1, 0.5)).toBeCloseTo(0, 10);
    expect(ellipsoidSdf(0, 0, 0, 2, 1, 0.5)).toBeCloseTo(-0.5, 10);
    // 外部为正
    expect(ellipsoidSdf(3, 0, 0, 2, 1, 0.5)).toBeGreaterThan(0);
  });

  it('ellipsoidSdf：非正半轴抛 RangeError', () => {
    expect(() => ellipsoidSdf(0, 0, 0, 0, 1, 1)).toThrow(RangeError);
    expect(() => ellipsoidSdf(0, 0, 0, 1, -1, 1)).toThrow(RangeError);
  });

  it('shellSdf：基础表面处最深（-厚度/2），远离表面为正', () => {
    expect(shellSdf(0, 0.2)).toBeCloseTo(-0.1, 12);
    expect(shellSdf(0.5, 0.2)).toBeCloseTo(0.4, 12);
    expect(shellSdf(-0.5, 0.2)).toBeCloseTo(0.4, 12);
    expect(() => shellSdf(0, 0)).toThrow(RangeError);
  });

  it('sdfDensityFalloff：内部 1、软带单调降至 0、越界钳制', () => {
    expect(sdfDensityFalloff(-1, 0.5)).toBe(1);
    expect(sdfDensityFalloff(0, 0.5)).toBe(1);
    expect(sdfDensityFalloff(0.5, 0.5)).toBe(0);
    expect(sdfDensityFalloff(2, 0.5)).toBe(0);
    const mid = sdfDensityFalloff(0.25, 0.5);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    // 单调：软带内取值随 sd 增大不升
    let prev = 1;
    for (let sd = 0; sd <= 0.5; sd += 0.05) {
      const v = sdfDensityFalloff(sd, 0.5);
      expect(v).toBeLessThanOrEqual(prev + 1e-12);
      prev = v;
    }
    expect(() => sdfDensityFalloff(0, 0)).toThrow(RangeError);
  });
});

describe('SDF 平滑并/差（IQ 多项式）', () => {
  it('k=0 退化为硬并 min / 硬差 max(d1,-d2)', () => {
    expect(smoothUnionSdf(0.3, -0.2, 0)).toBe(-0.2);
    expect(smoothSubtractSdf(-0.3, -0.2, 0)).toBe(0.2);
  });

  it('平滑并 ≤ 硬并（融合只会加料不会减料），远离融合带时等于硬并', () => {
    for (const [d1, d2] of [
      [0.1, 0.15],
      [-0.05, 0.02],
      [0.3, -0.1],
    ] as const) {
      expect(smoothUnionSdf(d1, d2, 0.2)).toBeLessThanOrEqual(Math.min(d1, d2) + 1e-12);
    }
    // 两距离差超过 k：与硬并一致
    expect(smoothUnionSdf(5, -0.3, 0.2)).toBeCloseTo(-0.3, 12);
    expect(smoothUnionSdf(-0.3, 5, 0.2)).toBeCloseTo(-0.3, 12);
  });

  it('平滑差 ≥ 硬差（挖除只会多挖不会少挖），远离融合带时等于硬差', () => {
    for (const [d1, d2] of [
      [-0.1, -0.15],
      [-0.05, 0.02],
      [0.3, -0.1],
    ] as const) {
      expect(smoothSubtractSdf(d1, d2, 0.2)).toBeGreaterThanOrEqual(
        Math.max(d1, -d2) - 1e-12,
      );
    }
    expect(smoothSubtractSdf(-5, -0.3, 0.2)).toBeCloseTo(0.3, 12);
    expect(smoothSubtractSdf(0.5, -5, 0.2)).toBeCloseTo(5, 12);
  });

  it('平滑并对参数对称', () => {
    expect(smoothUnionSdf(0.12, -0.07, 0.25)).toBeCloseTo(smoothUnionSdf(-0.07, 0.12, 0.25), 12);
  });
});

describe('发射-吸收积分（CPU 参考实现 vs 恒定密度解析解，shader 同式校验）', () => {
  it('零密度：透射率 1、发射 0', () => {
    const r = integrateEmissionAbsorption(new Float32Array(64), 0.01, 5);
    expect(r.transmittance).toBe(1);
    expect(r.emission).toBe(0);
  });

  it('恒定密度离散积分收敛到解析解（步数增多误差递减，512 步相对误差 <1%）', () => {
    const rho = 1.6;
    const sigma = 4;
    const L = 1.0;
    const exact = constantDensityEmissionAnalytic(rho, sigma, L);
    let prevErr = Infinity;
    for (const steps of [64, 256, 512]) {
      const samples = new Float32Array(steps).fill(rho);
      const got = integrateEmissionAbsorption(samples, L / steps, sigma);
      const err =
        Math.abs(got.emission - exact.emission) / exact.emission +
        Math.abs(got.transmittance - exact.transmittance);
      expect(err).toBeLessThan(prevErr);
      prevErr = err;
    }
    const samples = new Float32Array(512).fill(rho);
    const got = integrateEmissionAbsorption(samples, L / 512, sigma);
    expect(Math.abs(got.emission - exact.emission) / exact.emission).toBeLessThan(0.01);
    expect(Math.abs(got.transmittance - exact.transmittance)).toBeLessThan(0.01);
  });

  it('透射率单调不增且落在 [0,1]；负密度按 0 处理（shader d>0 分支镜像）', () => {
    const r1 = integrateEmissionAbsorption([1, 1], 0.5, 2);
    const r2 = integrateEmissionAbsorption([1, 1, 1, 1], 0.5, 2);
    expect(r2.transmittance).toBeLessThanOrEqual(r1.transmittance);
    expect(r2.transmittance).toBeGreaterThanOrEqual(0);
    expect(r1.transmittance).toBeLessThanOrEqual(1);
    const neg = integrateEmissionAbsorption([-3, -1], 0.5, 2);
    expect(neg.transmittance).toBe(1);
    expect(neg.emission).toBe(0);
  });

  it('入参校验：步长/吸收系数非法抛 RangeError', () => {
    expect(() => integrateEmissionAbsorption([1], 0, 1)).toThrow(RangeError);
    expect(() => integrateEmissionAbsorption([1], -0.1, 1)).toThrow(RangeError);
    expect(() => integrateEmissionAbsorption([1], 0.1, -1)).toThrow(RangeError);
    expect(() => integrateEmissionAbsorption([1], 0.1, NaN)).toThrow(RangeError);
  });

  it('解析解：σ=0 退化为 ρL；非法入参抛 RangeError', () => {
    const r = constantDensityEmissionAnalytic(2, 0, 3);
    expect(r.emission).toBe(6);
    expect(r.transmittance).toBe(1);
    expect(() => constantDensityEmissionAnalytic(-1, 1, 1)).toThrow(RangeError);
    expect(() => constantDensityEmissionAnalytic(1, 1, -1)).toThrow(RangeError);
  });
});

describe('intersectRayBox（shader hitBox 的 CPU 镜像：盒外/盒内两种入射）', () => {
  it('盒外正向入射：t0 > 0 且区间长度 = 穿越厚度', () => {
    const hit = intersectRayBox([0, 0, -2], [0, 0, 1]);
    expect(hit).not.toBeNull();
    expect(hit!.t0).toBeCloseTo(1.5, 10);
    expect(hit!.t1).toBeCloseTo(2.5, 10);
  });

  it('相机在盒内：t0 < 0 < t1（shader 钳 t0 到 0 后从相机处起步）', () => {
    const hit = intersectRayBox([0.1, -0.2, 0], [0, 0, 1]);
    expect(hit).not.toBeNull();
    expect(hit!.t0).toBeLessThan(0);
    expect(hit!.t1).toBeCloseTo(0.5, 10);
  });

  it('偏轴未命中返回 null；盒在射线反向返回 null', () => {
    expect(intersectRayBox([0, 2, -2], [0, 0, 1])).toBeNull();
    expect(intersectRayBox([0, 0, -2], [0, 0, -1])).toBeNull();
  });

  it('方向零分量无 NaN（1e-5 下限防除零，与 shader 同式）', () => {
    const hit = intersectRayBox([0, 0, -2], [0, 0.0, 1]);
    expect(hit).not.toBeNull();
    expect(Number.isNaN(hit!.t0)).toBe(false);
    expect(Number.isNaN(hit!.t1)).toBe(false);
    // 完全零分量方向且起点在盒面上的斜角射线也不产生 NaN
    const grazing = intersectRayBox([-0.5, 0, -2], [0, 0, 1]);
    expect(grazing === null || Number.isFinite(grazing.t0)).toBe(true);
  });

  it('自定义盒界（非单位盒）', () => {
    const hit = intersectRayBox([0, 0, -4], [0, 0, 1], -1, 1);
    expect(hit!.t0).toBeCloseTo(3, 10);
    expect(hit!.t1).toBeCloseTo(5, 10);
  });
});

describe('buildDensityData / assertVolumeTextureSize（R8 体素构建）', () => {
  it('边长越界/非整数抛 RangeError（附录 A §1：≤128）', () => {
    expect(() => assertVolumeTextureSize(VOLUME_TEXTURE_MAX_SIZE + 1)).toThrow(RangeError);
    expect(() => assertVolumeTextureSize(VOLUME_TEXTURE_MIN_SIZE - 1)).toThrow(RangeError);
    expect(() => assertVolumeTextureSize(32.5)).toThrow(RangeError);
    expect(() => buildDensityData(129, () => 0)).toThrow(RangeError);
    expect(() => assertVolumeTextureSize(128)).not.toThrow();
    expect(() => assertVolumeTextureSize(2)).not.toThrow();
  });

  it('确定性：同一 sampler 双次构建逐字节一致（验收 §R4-3.3）', () => {
    const sampler = makeSphericalFbmCloudSampler({ seed: volumeSeed('volume-test') });
    const a = buildDensityData(24, sampler);
    const b = buildDensityData(24, sampler);
    expect(a.length).toBe(24 * 24 * 24);
    expect(Buffer.compare(Buffer.from(a), Buffer.from(b))).toBe(0);
  });

  it('体素中心坐标映射到 (-1,1)（size=2 时为 ±0.5）', () => {
    const coords: number[][] = [];
    buildDensityData(2, (x, y, z) => {
      coords.push([x, y, z]);
      return 0;
    });
    expect(coords).toHaveLength(8);
    for (const [x, y, z] of coords) {
      expect([Math.abs(x), Math.abs(y), Math.abs(z)]).toEqual([0.5, 0.5, 0.5]);
    }
  });

  it('采样值钳制到 [0,1] 映射 0–255；NaN 归零', () => {
    const data = buildDensityData(2, (x) => (x < 0 ? 5 : x > 0 ? -3 : 0));
    for (const v of data) {
      expect(v === 0 || v === 255).toBe(true);
    }
    const nanData = buildDensityData(2, () => NaN);
    expect(Math.max(...nanData)).toBe(0);
  });
});

describe('buildDensityTexture（THREE.Data3DTexture 参数约定）', () => {
  it('R8 单通道 / 三线性 / ClampToEdge / unpackAlignment=1，尺寸与数据一致', () => {
    const tex = buildDensityTexture(8, (x, y, z) => (x + y + z + 3) / 6);
    expect(tex).toBeInstanceOf(THREE.Data3DTexture);
    expect(tex.format).toBe(THREE.RedFormat);
    expect(tex.type).toBe(THREE.UnsignedByteType);
    expect(tex.minFilter).toBe(THREE.LinearFilter);
    expect(tex.magFilter).toBe(THREE.LinearFilter);
    expect(tex.wrapR).toBe(THREE.ClampToEdgeWrapping);
    expect(tex.unpackAlignment).toBe(1);
    expect(tex.image.width).toBe(8);
    expect(tex.image.height).toBe(8);
    expect(tex.image.depth).toBe(8);
    const expected = buildDensityData(8, (x, y, z) => (x + y + z + 3) / 6);
    expect(Buffer.compare(Buffer.from(tex.image.data as Uint8Array), Buffer.from(expected))).toBe(
      0,
    );
    tex.dispose();
  });

  it('越界边长抛 RangeError（不产出纹理）', () => {
    expect(() => buildDensityTexture(256, () => 0)).toThrow(RangeError);
  });
});

describe('makeSphericalFbmCloudSampler（预览测试体密度场）', () => {
  const sampler = makeSphericalFbmCloudSampler({ seed: volumeSeed('volume-test') });

  it('输出在 [0,1] 且确定性', () => {
    for (let i = 0; i < 60; i += 1) {
      const x = ((i * 7) % 21) / 10 - 1;
      const y = ((i * 11) % 21) / 10 - 1;
      const z = ((i * 13) % 21) / 10 - 1;
      const v = sampler(x, y, z);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      expect(sampler(x, y, z)).toBe(v);
    }
  });

  it('球壳衰减带外（盒角）密度为 0（防贴纹理边界）', () => {
    expect(sampler(1, 1, 1)).toBe(0);
    expect(sampler(-1, -1, 1)).toBe(0);
  });

  it('云内有可观非零占比（体积感来源），且不同种子形态不同', () => {
    const other = makeSphericalFbmCloudSampler({ seed: volumeSeed('another-cloud') });
    let nonZero = 0;
    let diff = 0;
    let total = 0;
    for (let xi = 0; xi < 12; xi += 1) {
      for (let yi = 0; yi < 12; yi += 1) {
        for (let zi = 0; zi < 12; zi += 1) {
          const x = ((xi + 0.5) / 12) * 2 - 1;
          const y = ((yi + 0.5) / 12) * 2 - 1;
          const z = ((zi + 0.5) / 12) * 2 - 1;
          const a = sampler(x, y, z);
          if (a > 0) nonZero += 1;
          if (a !== other(x, y, z)) diff += 1;
          total += 1;
        }
      }
    }
    expect(nonZero / total).toBeGreaterThan(0.05);
    expect(diff).toBeGreaterThan(0);
  });

  it('自定义配置（频率/层数/半径/覆盖）生效且不越界', () => {
    const dense = makeSphericalFbmCloudSampler({
      seed: 1,
      frequency: 1.5,
      octaves: 2,
      radius: 0.6,
      softness: 0.2,
      coverage: 0.1,
    });
    const v = dense(0.1, 0, 0);
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(1);
    // 半径 0.6 + softness 0.2 之外必为 0
    expect(dense(0.9, 0, 0)).toBe(0);
  });
});
