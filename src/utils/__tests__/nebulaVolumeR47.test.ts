/**
 * M42 体积密度场纯逻辑测试（R4-7，IMPROVEMENT_REQUIREMENTS_4 §R4-7 验收）
 *
 * 覆盖：确定性（同种子逐字节一致）、关键采样点密度断言（腔内低/壳层高/
 * 暗湾吸收通道高/西北亮弓不对称）、分帧构建（预算语义 + 与一次性构建
 * 逐字节一致 + 打点字段）、双通道发射-吸收积分（与单通道参考及解析解
 * 对照）、RG 纹理参数、输入校验。
 */

import * as THREE from 'three';
import {
  M42_CAVITY_RADIUS,
  M42_COLOR_WEIGHT_INNER_R,
  M42_COLOR_WEIGHT_OUTER_R,
  M42_DARK_BAY_CENTER,
  M42_TEXTURE_SIZE,
  M42_TRAPEZIUM_CENTER,
  M42_VOLUME_ID,
  TRAPEZIUM_STAR_OFFSETS,
  advanceRgVolumeBuild,
  buildRgDensityData,
  constantDualEmissionAnalytic,
  createRgDensityTexture,
  createRgVolumeBuild,
  integrateEmissionAbsorptionDual,
  m42ColorWeight01,
  makeM42Sampler,
  rgVolumeBuildDone,
  rgVolumeBuildProgress01,
  trapeziumStarBoxPositions,
  trapeziumStarPositions,
  type NebulaSample,
} from '@/utils/nebulaVolume';
import { integrateEmissionAbsorption, volumeSeed } from '@/utils/volume';

const sampler = makeM42Sampler();
const scratch: NebulaSample = { emission: 0, absorption: 0 };
const sampleAt = (x: number, y: number, z: number): NebulaSample => {
  sampler(x, y, z, scratch);
  return { emission: scratch.emission, absorption: scratch.absorption };
};

const [TCX, TCY, TCZ] = M42_TRAPEZIUM_CENTER;

describe('Trapezium 星点位置（与空腔一致，§R4-7 需求）', () => {
  it('四颗星 = 空腔中心 + 偏移，全部落在空腔半径内', () => {
    const positions = trapeziumStarPositions();
    expect(positions).toHaveLength(4);
    positions.forEach(([x, y, z], i) => {
      expect(x).toBeCloseTo(TCX + TRAPEZIUM_STAR_OFFSETS[i][0], 12);
      expect(y).toBeCloseTo(TCY + TRAPEZIUM_STAR_OFFSETS[i][1], 12);
      expect(z).toBeCloseTo(TCZ + TRAPEZIUM_STAR_OFFSETS[i][2], 12);
      const r = Math.hypot(x - TCX, y - TCY, z - TCZ);
      expect(r).toBeLessThan(M42_CAVITY_RADIUS);
    });
  });

  it('盒局部坐标 = 归一化域坐标 ÷ 2（VolumeMaterial 单位盒约定）', () => {
    const normalized = trapeziumStarPositions();
    const box = trapeziumStarBoxPositions();
    box.forEach(([x, y, z], i) => {
      expect(x).toBeCloseTo(normalized[i][0] / 2, 12);
      expect(y).toBeCloseTo(normalized[i][1] / 2, 12);
      expect(z).toBeCloseTo(normalized[i][2] / 2, 12);
    });
  });

  it('星点处发射与吸收密度均近零（位于空腔内，sprite 内嵌不被云体遮蔽）', () => {
    for (const [x, y, z] of trapeziumStarPositions()) {
      const v = sampleAt(x, y, z);
      expect(v.emission).toBeLessThan(0.02);
      expect(v.absorption).toBeLessThan(0.02);
    }
  });
});

describe('m42ColorWeight01（Hα/OIII 径向混色权重，shader 同式镜像）', () => {
  it('内径以内为 0（OIII 青）、外径以外为 1（Hα 红）', () => {
    expect(m42ColorWeight01(0)).toBe(0);
    expect(m42ColorWeight01(M42_COLOR_WEIGHT_INNER_R)).toBe(0);
    expect(m42ColorWeight01(M42_COLOR_WEIGHT_OUTER_R)).toBe(1);
    expect(m42ColorWeight01(2)).toBe(1);
  });

  it('区间内单调递增且中点为 0.5', () => {
    const mid = (M42_COLOR_WEIGHT_INNER_R + M42_COLOR_WEIGHT_OUTER_R) / 2;
    expect(m42ColorWeight01(mid)).toBeCloseTo(0.5, 10);
    let prev = -1;
    for (let r = 0; r <= 1; r += 0.05) {
      const w = m42ColorWeight01(r);
      expect(w).toBeGreaterThanOrEqual(prev);
      prev = w;
    }
  });

  it('负数 / 非有限输入抛 RangeError', () => {
    expect(() => m42ColorWeight01(-0.1)).toThrow(RangeError);
    expect(() => m42ColorWeight01(Number.NaN)).toThrow(RangeError);
    expect(() => m42ColorWeight01(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe('M42 密度场关键采样点（§R4-7 验收：腔内低/壳层高/暗湾吸收高）', () => {
  it('Trapezium 空腔中心发射密度为零（空腔挖孔生效）', () => {
    const v = sampleAt(TCX, TCY, TCZ);
    expect(v.emission).toBeLessThan(0.02);
  });

  it('电离前沿壳层（空腔外侧中径处）发射密度高（≥0.25 且 ≥10× 腔内）', () => {
    const shellPoints: readonly (readonly [number, number, number])[] = [
      [TCX, TCY - 0.2, TCZ],
      [TCX - 0.2, TCY, TCZ],
      [TCX, TCY, TCZ - 0.2],
      [TCX - 0.14, TCY + 0.14, TCZ - 0.03],
    ];
    const cavity = sampleAt(TCX, TCY, TCZ).emission;
    let sum = 0;
    for (const [x, y, z] of shellPoints) {
      const e = sampleAt(x, y, z).emission;
      expect(e).toBeGreaterThan(0.25);
      sum += e;
    }
    expect(sum / shellPoints.length).toBeGreaterThan(Math.max(cavity * 10, 0.4));
  });

  it('东南暗湾中心吸收通道高（>0.5），西北镜像点吸收近零（不对称前景尘埃）', () => {
    const [bx, by, bz] = M42_DARK_BAY_CENTER;
    expect(sampleAt(bx, by, bz).absorption).toBeGreaterThan(0.5);
    expect(sampleAt(-bx, -by, bz).absorption).toBeLessThan(0.02);
  });

  it('西北亮弓：西北象限发射柱积分 ≥1.25× 东南镜像柱（扇贝腔壁角向加权）', () => {
    const column = (ox: number, oy: number): number => {
      let s = 0;
      for (let z = -0.8; z <= 0.8; z += 0.05) s += sampleAt(TCX + ox, TCY + oy, z).emission;
      return s;
    };
    for (const r of [0.25, 0.35, 0.45]) {
      const d = r * Math.SQRT1_2;
      expect(column(d, d)).toBeGreaterThan(1.25 * column(-d, -d));
    }
  });

  it('包络与尘埃湾之外（域角落）双通道均为零（早退路径）', () => {
    const v = sampleAt(0.95, 0.95, 0.95);
    expect(v.emission).toBe(0);
    expect(v.absorption).toBe(0);
  });

  it('粗网格全域输出落在 [0,1]', () => {
    for (let z = -0.9; z <= 0.9; z += 0.3) {
      for (let y = -0.9; y <= 0.9; y += 0.3) {
        for (let x = -0.9; x <= 0.9; x += 0.3) {
          const v = sampleAt(x, y, z);
          expect(v.emission).toBeGreaterThanOrEqual(0);
          expect(v.emission).toBeLessThanOrEqual(1);
          expect(v.absorption).toBeGreaterThanOrEqual(0);
          expect(v.absorption).toBeLessThanOrEqual(1);
        }
      }
    }
  });
});

describe('确定性（附录 A §2：FNV-1a 种子）', () => {
  it('同种子双次构建逐字节一致', () => {
    const a = buildRgDensityData(16, makeM42Sampler());
    const b = buildRgDensityData(16, makeM42Sampler());
    expect(a).toEqual(b);
  });

  it('默认种子 = volumeSeed(orion-nebula)；不同种子输出不同', () => {
    const base = buildRgDensityData(16, makeM42Sampler(volumeSeed(M42_VOLUME_ID)));
    const dflt = buildRgDensityData(16, makeM42Sampler());
    expect(dflt).toEqual(base);
    const other = buildRgDensityData(16, makeM42Sampler(volumeSeed('another-seed')));
    expect(other).not.toEqual(base);
  });
});

describe('分帧构建（§R4-7 实现方式登记：z 切片粒度 + 时间预算）', () => {
  it('M42_TEXTURE_SIZE 为 128（§R4-7 需求）', () => {
    expect(M42_TEXTURE_SIZE).toBe(128);
  });

  it('假时钟下预算语义：每次至少 1 片、超预算即让出（5ms/片 × 12ms 预算 → 3 片）', () => {
    let t = 0;
    const fakeNow = (): number => {
      t += 5;
      return t;
    };
    const state = createRgVolumeBuild(8, sampler);
    const done = advanceRgVolumeBuild(state, 12, fakeNow);
    expect(done).toBe(false);
    expect(state.nextZ).toBe(3); // 5/10 < 12 继续，15 ≥ 12 停
    expect(state.chunkCount).toBe(1);
    expect(state.maxChunkMs).toBeGreaterThan(0);
    expect(state.computeMs).toBe(state.maxChunkMs);
  });

  it('极小预算下仍至少推进 1 片（收敛保证）', () => {
    const state = createRgVolumeBuild(4, sampler);
    advanceRgVolumeBuild(state, 1e-9);
    expect(state.nextZ).toBeGreaterThanOrEqual(1);
  });

  it('分帧结果与一次性构建逐字节一致（与分块方式无关）', () => {
    const chunked = createRgVolumeBuild(16, makeM42Sampler());
    let guard = 0;
    while (!advanceRgVolumeBuild(chunked, 1e-9) && guard < 64) guard += 1;
    expect(rgVolumeBuildDone(chunked)).toBe(true);
    expect(chunked.chunkCount).toBeGreaterThan(1); // 确为多块推进
    expect(chunked.data).toEqual(buildRgDensityData(16, makeM42Sampler()));
  });

  it('进度 0 → (0,1) → 1；完成后再推进为幂等 no-op', () => {
    const state = createRgVolumeBuild(4, sampler);
    expect(rgVolumeBuildProgress01(state)).toBe(0);
    advanceRgVolumeBuild(state, 1e-9);
    expect(rgVolumeBuildProgress01(state)).toBeGreaterThan(0);
    while (!advanceRgVolumeBuild(state, Number.POSITIVE_INFINITY)) {
      /* 推进至完成 */
    }
    expect(rgVolumeBuildProgress01(state)).toBe(1);
    const chunks = state.chunkCount;
    expect(advanceRgVolumeBuild(state, 1)).toBe(true);
    expect(state.chunkCount).toBe(chunks); // 完成后不再计块
  });

  it('时间预算非正抛 RangeError；边长越界经附录 A 校验抛 RangeError', () => {
    const state = createRgVolumeBuild(4, sampler);
    expect(() => advanceRgVolumeBuild(state, 0)).toThrow(RangeError);
    expect(() => advanceRgVolumeBuild(state, Number.NaN)).toThrow(RangeError);
    expect(() => createRgVolumeBuild(1, sampler)).toThrow(RangeError);
    expect(() => createRgVolumeBuild(129, sampler)).toThrow(RangeError);
    expect(() => createRgVolumeBuild(16.5, sampler)).toThrow(RangeError);
  });

  it('采样器输出非有限数 / 越界时烘焙钳制到 [0,255]', () => {
    const weird = (x: number, _y: number, _z: number, out: NebulaSample): void => {
      out.emission = x < 0 ? Number.NaN : 5;
      out.absorption = -3;
    };
    const data = buildRgDensityData(2, weird);
    // x<0 半边 NaN → 0；x>0 半边 5 → 钳 255；吸收 -3 → 0
    expect(data[0]).toBe(0);
    expect(data[2]).toBe(255);
    for (let i = 1; i < data.length; i += 2) expect(data[i]).toBe(0);
  });
});

describe('createRgDensityTexture（RG 双通道 Data3DTexture）', () => {
  it('纹理参数：RGFormat/UnsignedByte/三线性/ClampToEdge/unpackAlignment=1', () => {
    const data = buildRgDensityData(8, sampler);
    const texture = createRgDensityTexture(8, data);
    expect(texture).toBeInstanceOf(THREE.Data3DTexture);
    expect(texture.image.width).toBe(8);
    expect(texture.image.height).toBe(8);
    expect(texture.image.depth).toBe(8);
    expect(texture.format).toBe(THREE.RGFormat);
    expect(texture.type).toBe(THREE.UnsignedByteType);
    expect(texture.minFilter).toBe(THREE.LinearFilter);
    expect(texture.magFilter).toBe(THREE.LinearFilter);
    expect(texture.wrapS).toBe(THREE.ClampToEdgeWrapping);
    expect(texture.wrapR).toBe(THREE.ClampToEdgeWrapping);
    expect(texture.unpackAlignment).toBe(1);
    expect(texture.version).toBeGreaterThan(0); // needsUpdate=true 递增 version
    texture.dispose();
  });

  it('数据长度与 size³×2 不符 / 边长越界抛 RangeError', () => {
    expect(() => createRgDensityTexture(8, new Uint8Array(8))).toThrow(RangeError);
    expect(() => createRgDensityTexture(200, new Uint8Array(200 ** 3 * 2))).toThrow(RangeError);
  });
});

describe('integrateEmissionAbsorptionDual（双通道积分，shader 同式）', () => {
  it('吸收通道全零时与单通道参考实现一致（σd 任意）', () => {
    const emission = [0.2, 0.7, 0.4, 0.9, 0.1];
    const zeros = [0, 0, 0, 0, 0];
    const dual = integrateEmissionAbsorptionDual(emission, zeros, 0.1, 4, 22);
    const single = integrateEmissionAbsorption(emission, 0.1, 4);
    expect(dual.emission).toBeCloseTo(single.emission, 12);
    expect(dual.transmittance).toBeCloseTo(single.transmittance, 12);
  });

  it('恒定双通道密度细分收敛到解析解', () => {
    const n = 4000;
    const stepLen = 1 / n;
    const e = new Array(n).fill(0.6);
    const a = new Array(n).fill(0.3);
    const numeric = integrateEmissionAbsorptionDual(e, a, stepLen, 3, 22);
    const analytic = constantDualEmissionAnalytic(0.6, 0.3, 3, 22, 1);
    expect(numeric.transmittance).toBeCloseTo(analytic.transmittance, 3);
    expect(numeric.emission).toBeCloseTo(analytic.emission, 3);
  });

  it('尘埃只消光不发射：加入吸收通道后透射率与发射累计均下降', () => {
    const e = [0.5, 0.5, 0.5, 0.5];
    const noDust = integrateEmissionAbsorptionDual(e, [0, 0, 0, 0], 0.25, 3, 22);
    const dust = integrateEmissionAbsorptionDual(e, [0.4, 0.4, 0.4, 0.4], 0.25, 3, 22);
    expect(dust.transmittance).toBeLessThan(noDust.transmittance);
    expect(dust.emission).toBeLessThan(noDust.emission);
  });

  it('负密度按 0 处理（shader max 同式）', () => {
    const r = integrateEmissionAbsorptionDual([-1, 0.5], [-1, 0], 0.5, 3, 22);
    const ref = integrateEmissionAbsorptionDual([0, 0.5], [0, 0], 0.5, 3, 22);
    expect(r.emission).toBeCloseTo(ref.emission, 12);
    expect(r.transmittance).toBeCloseTo(ref.transmittance, 12);
  });

  it('输入校验：长度不一致/步长非正/系数为负抛 RangeError', () => {
    expect(() => integrateEmissionAbsorptionDual([1], [1, 2], 0.1, 3, 22)).toThrow(RangeError);
    expect(() => integrateEmissionAbsorptionDual([1], [1], 0, 3, 22)).toThrow(RangeError);
    expect(() =>
      integrateEmissionAbsorptionDual([1], [1], Number.POSITIVE_INFINITY, 3, 22),
    ).toThrow(RangeError);
    expect(() => integrateEmissionAbsorptionDual([1], [1], 0.1, -1, 22)).toThrow(RangeError);
    expect(() => integrateEmissionAbsorptionDual([1], [1], 0.1, 3, -1)).toThrow(RangeError);
  });
});

describe('constantDualEmissionAnalytic（解析对照基准）', () => {
  it('σ_t = 0 退化为 E = e·L、T = 1', () => {
    const r = constantDualEmissionAnalytic(0.5, 0.3, 0, 0, 2);
    expect(r.emission).toBeCloseTo(1, 12);
    expect(r.transmittance).toBe(1);
  });

  it('T = exp(−(e·σe + a·σd)·L)', () => {
    const r = constantDualEmissionAnalytic(0.5, 0.25, 4, 8, 0.5);
    expect(r.transmittance).toBeCloseTo(Math.exp(-(0.5 * 4 + 0.25 * 8) * 0.5), 12);
  });

  it('负输入抛 RangeError', () => {
    expect(() => constantDualEmissionAnalytic(-1, 0, 1, 1, 1)).toThrow(RangeError);
    expect(() => constantDualEmissionAnalytic(0, -1, 1, 1, 1)).toThrow(RangeError);
    expect(() => constantDualEmissionAnalytic(0, 0, 1, 1, -1)).toThrow(RangeError);
  });
});
