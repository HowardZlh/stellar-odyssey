/**
 * R4-13 黑洞引力透镜场景接入纯逻辑单测（IMPROVEMENT_REQUIREMENTS_4 §R4-13）
 *
 * 覆盖：两黑洞参数配置区分（Sgr A* 暗弱橙红 / 天鹅座 X-1 明亮蓝白）/
 * 尺度换算（视界半径 = 廉价 shader 黑球系数同源、包围球小于飞抵观察
 * 距离）/detailLayer 规格（lensing 池、阈值 R2-7 同源、GPU 预算）/
 * 盘姿态矩阵（廉价盘平面对齐、正视/侧视端点、正交性）/自适应档位
 * 步数映射/shader R4-13 增量 uniform 同源断言。
 */

import {
  BLACK_HOLE_DISK_INCLINATION_DEG,
  BLACK_HOLE_HORIZON_RADIUS_FACTOR,
  BLACK_HOLE_LENSED_BASE_STEPS,
  BLACK_HOLE_LENSED_CONFIGS,
  BLACK_HOLE_LENSING_GPU_BYTES,
  assertBlackHoleLensedConfigs,
  blackHoleDiskRotElements,
  blackHoleLensedConfig,
  blackHoleLensingDetailLayerSpec,
  blackHoleRsWorldUnits,
} from '@/utils/blackHoleScene';
import {
  DETAIL_GPU_BUDGET_BYTES,
  DETAIL_LRU_CAPACITY_BY_KIND,
} from '@/utils/detailLayer';
import {
  nearViewEnterDistanceUnits,
  nearViewExitDistanceUnits,
} from '@/utils/nearView';
import {
  DISK_LUT_WIDTH,
  LENSING_DOMAIN_RADIUS_RS,
  LENSING_STEPS_DEFAULT,
  STARFIELD_FACE_SIZE,
  clampDiskRadii,
  clampLensingSteps,
} from '@/utils/blackHoleLensing';
import { VOLUME_QUALITY_SPECS, stepsForTier } from '@/utils/adaptiveQuality';
import { getSpecialBodyById } from '@/data/specialBodies';
import { SCENE_UNITS_PER_LY } from '@/utils/scale';
import { LENSING_FRAGMENT_SHADER } from '@/components/Scene/volumetric/BlackHoleLensed';

const BH_IDS = ['sgr-a-star', 'cygnus-x1'] as const;

describe('R4-13 常数登记', () => {
  it('视界半径系数 0.32（廉价 shader 黑球单点同源）', () => {
    expect(BLACK_HOLE_HORIZON_RADIUS_FACTOR).toBe(0.32);
  });

  it('盘倾角 = 廉价盘 rotation.x = −π/2.6 的法线姿态（≈69.23°）', () => {
    expect(BLACK_HOLE_DISK_INCLINATION_DEG).toBeCloseTo(180 / 2.6, 10);
  });

  it('基准步数与 R4-11 默认步数同源（64）', () => {
    expect(BLACK_HOLE_LENSED_BASE_STEPS).toBe(LENSING_STEPS_DEFAULT);
    expect(BLACK_HOLE_LENSED_BASE_STEPS).toBe(64);
  });

  it('GPU 估算 = 星场 cubemap 6 面 RGBA + 黑体 LUT（远低于总预算）', () => {
    expect(BLACK_HOLE_LENSING_GPU_BYTES).toBe(
      6 * STARFIELD_FACE_SIZE * STARFIELD_FACE_SIZE * 4 + DISK_LUT_WIDTH * 4,
    );
    expect(BLACK_HOLE_LENSING_GPU_BYTES).toBeLessThan(DETAIL_GPU_BUDGET_BYTES / 100);
  });

  it('lensing 池容量 1（§R4-13 第 4 条）', () => {
    expect(DETAIL_LRU_CAPACITY_BY_KIND.lensing).toBe(1);
  });
});

describe('两黑洞参数配置区分（§R4-13 第 2 条）', () => {
  it('仅登记两黑洞成员，其余 id 返回 null', () => {
    expect(Object.keys(BLACK_HOLE_LENSED_CONFIGS).sort()).toEqual(
      [...BH_IDS].sort(),
    );
    for (const id of BH_IDS) {
      expect(blackHoleLensedConfig(id)).toBe(BLACK_HOLE_LENSED_CONFIGS[id]);
    }
    expect(blackHoleLensedConfig('orion-nebula')).toBeNull();
    expect(blackHoleLensedConfig('')).toBeNull();
  });

  it('Sgr A* 盘暗弱偏橙红（温标 <1）/ 天鹅座 X-1 盘亮偏蓝白（温标 >1）', () => {
    const sgr = BLACK_HOLE_LENSED_CONFIGS['sgr-a-star'];
    const cyg = BLACK_HOLE_LENSED_CONFIGS['cygnus-x1'];
    expect(sgr.diskTempScale).toBeLessThan(1);
    expect(cyg.diskTempScale).toBeGreaterThan(1);
    expect(sgr.diskBrightness).toBeLessThan(cyg.diskBrightness);
    // 峰值色温落在黑体 LUT 表现域内的可辨色档（登记 ≈4,600 / ≈9,800 K）
    expect(sgr.diskTempScale * 7200).toBeCloseTo(4608, 0);
    expect(cyg.diskTempScale * 7200).toBeCloseTo(9792, 0);
  });

  it('束流强度均为物理档 δ³（=1，R4-12 语义）', () => {
    for (const id of BH_IDS) {
      expect(BLACK_HOLE_LENSED_CONFIGS[id].beamStrength).toBe(1);
    }
  });

  it('盘内外缘经 clampDiskRadii 恒等（配置不越界）且外缘留在包围球内', () => {
    for (const id of BH_IDS) {
      const cfg = BLACK_HOLE_LENSED_CONFIGS[id];
      const clamped = clampDiskRadii(cfg.diskInnerRs, cfg.diskOuterRs);
      expect(clamped.innerRs).toBe(cfg.diskInnerRs);
      expect(clamped.outerRs).toBe(cfg.diskOuterRs);
      expect(cfg.diskInnerRs).toBe(3); // ISCO
      expect(cfg.diskOuterRs).toBeLessThan(LENSING_DOMAIN_RADIUS_RS - 1 + 1e-9);
    }
  });

  it('配置自洽校验：现行配置通过；越界内外缘/超预算抛 RangeError', () => {
    expect(() => assertBlackHoleLensedConfigs(BLACK_HOLE_LENSED_CONFIGS)).not.toThrow();
    const bad = {
      'sgr-a-star': {
        ...BLACK_HOLE_LENSED_CONFIGS['sgr-a-star'],
        diskInnerRs: 0.5, // clampDiskRadii 下限 1.5，会被改写
      },
    };
    expect(() => assertBlackHoleLensedConfigs(bad)).toThrow(RangeError);
    expect(() =>
      assertBlackHoleLensedConfigs(BLACK_HOLE_LENSED_CONFIGS, DETAIL_GPU_BUDGET_BYTES + 1),
    ).toThrow(RangeError);
  });

  it('两黑洞星场种子不同（确定性 + 形态区分）、盘倾角同取廉价盘对齐值', () => {
    const sgr = BLACK_HOLE_LENSED_CONFIGS['sgr-a-star'];
    const cyg = BLACK_HOLE_LENSED_CONFIGS['cygnus-x1'];
    expect(sgr.starfieldSeed).not.toBe(cyg.starfieldSeed);
    expect(sgr.diskInclinationDeg).toBe(BLACK_HOLE_DISK_INCLINATION_DEG);
    expect(cyg.diskInclinationDeg).toBe(BLACK_HOLE_DISK_INCLINATION_DEG);
  });
});

describe('尺度换算（§R4-13 第 3 条压缩登记）', () => {
  it('rsWorld = 视觉尺寸 × 0.32（Sgr A* 4.8 / Cyg X-1 2.08 场景单位）', () => {
    expect(blackHoleRsWorldUnits(15)).toBeCloseTo(4.8, 10);
    expect(blackHoleRsWorldUnits(6.5)).toBeCloseTo(2.08, 10);
  });

  it('非法尺寸抛 RangeError', () => {
    expect(() => blackHoleRsWorldUnits(0)).toThrow(RangeError);
    expect(() => blackHoleRsWorldUnits(-1)).toThrow(RangeError);
    expect(() => blackHoleRsWorldUnits(Number.NaN)).toThrow(RangeError);
    expect(() => blackHoleRsWorldUnits(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });

  it('包围球世界半径小于飞抵观察距离（飞抵后相机恒在球外）', () => {
    for (const id of BH_IDS) {
      const body = getSpecialBodyById(id)!;
      const sizeUnits = body.visualRadiusLy * SCENE_UNITS_PER_LY;
      const domainRadius = blackHoleRsWorldUnits(sizeUnits) * LENSING_DOMAIN_RADIUS_RS;
      const viewDistance = nearViewEnterDistanceUnits(id) / 1.5;
      expect(domainRadius).toBeLessThan(viewDistance);
    }
  });
});

describe('detailLayer 规格（lensing 池，阈值 R2-7 同源）', () => {
  it.each(BH_IDS)('%s：kind/阈值/预算逐项一致', (id) => {
    const spec = blackHoleLensingDetailLayerSpec(id);
    expect(spec.bodyId).toBe(id);
    expect(spec.kind).toBe('lensing');
    expect(spec.enterDistanceUnits).toBe(nearViewEnterDistanceUnits(id));
    expect(spec.exitDistanceUnits).toBe(nearViewExitDistanceUnits(id));
    expect(spec.exitDistanceUnits).toBeCloseTo(spec.enterDistanceUnits * 1.4, 10);
    expect(spec.budget.gpuBytesEstimate).toBe(BLACK_HOLE_LENSING_GPU_BYTES);
  });

  it('未登记 id 抛 RangeError', () => {
    expect(() => blackHoleLensingDetailLayerSpec('betelgeuse')).toThrow(RangeError);
    expect(() => blackHoleLensingDetailLayerSpec('')).toThrow(RangeError);
  });
});

/** 行主序 9 元矩阵作用于向量 */
function applyRot(
  m: readonly number[],
  v: readonly [number, number, number],
): [number, number, number] {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

describe('盘姿态矩阵（物体空间 → 盘空间，R4-12 预览页同式）', () => {
  it('侧视 90°：恒等矩阵（盘在物体 xz 平面）', () => {
    const m = blackHoleDiskRotElements(90);
    const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    m.forEach((v, i) => expect(v).toBeCloseTo(identity[i], 12));
  });

  it('正视 0°：物体 +z（盘法线）映射到盘空间 +y', () => {
    const m = blackHoleDiskRotElements(0);
    const mapped = applyRot(m, [0, 0, 1]);
    expect(mapped[0]).toBeCloseTo(0, 12);
    expect(mapped[1]).toBeCloseTo(1, 12);
    expect(mapped[2]).toBeCloseTo(0, 12);
  });

  it('69.23° 对齐档：廉价盘法线（Rx(−π/2.6)·ẑ）映射到盘空间 +y（交叉淡出盘面无跳变）', () => {
    // 廉价 shader 盘：ring 几何 xy 平面 rotation.x = −π/2.6 → 法线
    const a = -Math.PI / 2.6;
    const cheapNormal: [number, number, number] = [
      0,
      -Math.sin(a), // y' = −z·sin a（z=1）
      Math.cos(a),
    ];
    const m = blackHoleDiskRotElements(BLACK_HOLE_DISK_INCLINATION_DEG);
    const mapped = applyRot(m, cheapNormal);
    expect(mapped[0]).toBeCloseTo(0, 12);
    expect(mapped[1]).toBeCloseTo(1, 12);
    expect(mapped[2]).toBeCloseTo(0, 12);
  });

  it('任意倾角均为正交旋转（行向量归一正交，det = 1）', () => {
    for (const incl of [0, 30, BLACK_HOLE_DISK_INCLINATION_DEG, 90]) {
      const m = blackHoleDiskRotElements(incl);
      const rows = [m.slice(0, 3), m.slice(3, 6), m.slice(6, 9)];
      for (const r of rows) {
        expect(r[0] * r[0] + r[1] * r[1] + r[2] * r[2]).toBeCloseTo(1, 12);
      }
      const det =
        m[0] * (m[4] * m[8] - m[5] * m[7]) -
        m[1] * (m[3] * m[8] - m[5] * m[6]) +
        m[2] * (m[3] * m[7] - m[4] * m[6]);
      expect(det).toBeCloseTo(1, 12);
    }
  });

  it('非有限倾角抛 RangeError', () => {
    expect(() => blackHoleDiskRotElements(Number.NaN)).toThrow(RangeError);
    expect(() => blackHoleDiskRotElements(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe('自适应档位步数映射（§R4-13 第 4 条，R4-4 档位复用）', () => {
  it('64 基准 → high 64 / mid 48 / low 32（clampLensingSteps 域内）', () => {
    expect(stepsForTier(BLACK_HOLE_LENSED_BASE_STEPS, 'high')).toBe(64);
    expect(stepsForTier(BLACK_HOLE_LENSED_BASE_STEPS, 'mid')).toBe(48);
    expect(stepsForTier(BLACK_HOLE_LENSED_BASE_STEPS, 'low')).toBe(32);
    for (const tier of ['high', 'mid', 'low'] as const) {
      const steps = BLACK_HOLE_LENSED_BASE_STEPS * VOLUME_QUALITY_SPECS[tier].stepScale;
      expect(clampLensingSteps(steps)).toBe(stepsForTier(BLACK_HOLE_LENSED_BASE_STEPS, tier));
    }
  });
});

describe('shader R4-13 增量同源断言', () => {
  it('fragment shader 含温标缩放与淡入权重 uniform 及同式语句', () => {
    expect(LENSING_FRAGMENT_SHADER).toContain('uniform float uDiskTempScale;');
    expect(LENSING_FRAGMENT_SHADER).toContain('uniform float uFade;');
    expect(LENSING_FRAGMENT_SHADER).toContain('tObs *= uDiskTempScale;');
    expect(LENSING_FRAGMENT_SHADER).toContain('gl_FragColor = vec4(rgb, uFade);');
  });
});
