/**
 * 渲染质量档位表（M2，REQUIREMENTS_MOBILE §M2）——唯一事实源
 *
 * 全部渲染降档数值集中于本表（§M2-1 档位表 + §M2-3 粒子预算 +
 * §M2-4 纹理预算），各消费点只 import 取值，禁止散落魔法数字。
 *
 * 硬性约束（单测保险丝）：high 档全部数值与改动前现状逐项一致——
 * 桌面（deviceTier 恒 'high'，M1 判定表）行为与画质零变化。
 *
 * 实现差异登记：
 * - "low 起步只升不探底"（§M2-2）与"low 档锁步数 32"（§M2-2 第三条）
 *   冲突处理：low 设备体积档**恒锁 low**（32 步 + RT 0.5，锁定即天然
 *   满足上限）；动态升降档通道（dpr/bloom 联动）保留给 medium 设备
 *   （mid 起步，可升 high 可降 low）——low 设备 dpr 恒 1、bloom 默认关，
 *   已无可再降项，动态联动为空操作故不挂载（AdaptiveQualityDriver）。
 * - 纹理 LRU 预算以 MB 登记（300/128/96），落地为细节层 LRU 天体容量
 *   （现状口径：2 天体 ≤300MB，即每天体名义 150MB）——
 *   `detailLruCapacityForBudgetMB`：high 2（= 现状 DETAIL_LRU_CAPACITY）、
 *   medium/low 1；medium/low 同时禁 4K 细节层，实际细节显存 ≈0。
 */

import type { DeviceTier } from '@/utils/deviceCapability';
import type { VolumeQualityTier } from '@/utils/adaptiveQuality';

/** Canvas dpr 配置（R3F dpr prop：定值或 [min, max] 区间） */
export type DprSpec = number | readonly [number, number];

/** 单档质量参数（§M2-1 表格 + §M2-3/§M2-4 预算） */
export interface QualityTierSpec {
  /** R3F Canvas dpr（high [1,2] = R3F 默认；medium [1,1.5]；low 1） */
  dpr: DprSpec;
  /** WebGL antialias（移动 tile GPU 上 MSAA 开销大） */
  antialias: boolean;
  /** 对数深度缓冲（移动 tile GPU 禁 early-z，low 关闭；z-fighting 目验登记） */
  logarithmicDepthBuffer: boolean;
  /** EffectComposer multisampling（4 / 2 / 0） */
  multisampling: number;
  /** Bloom 默认开关（low 默认关；用户仍可手动开启） */
  bloomDefault: boolean;
  /** 体积渲染初始档（adaptiveQuality 状态机起点：high/mid/low） */
  volumeInitialTier: VolumeQualityTier;
  /** 体积档锁定（low 设备恒锁 32 步 + RT 0.5，不参与升降档） */
  volumeTierLocked: boolean;
  /** L4 银河系盘粒子数（40,000 / 24,000 / 12,000） */
  diskParticleCount: number;
  /** 2MRS 目录保留比例（low 0.5 = 均匀跨步抽稀 50%） */
  catalogKeepFraction: number;
  /** 近观粒子全局预算（登记值：20,000 / 20,000 / 10,000） */
  nearViewParticleBudget: number;
  /** 单星系近观粒子上限（登记值：12,000 / 12,000 / 6,000） */
  galaxyNearViewMaxParticles: number;
  /** 单星系近观粒子生成比例（quota 各分量 floor 缩放，1 / 1 / 0.5） */
  galaxyNearViewParticleScale: number;
  /** 太阳活动粒子比例（太阳风/CME 生成数 floor 缩放，1 / 1 / 0.5） */
  solarParticleScale: number;
  /** 细节纹理 LRU 显存预算（MB：300 / 128 / 96） */
  textureLruBudgetMB: number;
  /** 是否允许 4K 近观细节层（medium/low 禁用，只用 2K 基础层） */
  allow4kDetail: boolean;
  /** 纹理各向异性过滤（4 / 2 / 2） */
  anisotropy: number;
}

/** 档位表（§M2-1/§M2-3/§M2-4；high 档 = 现状，单测逐项断言） */
export const QUALITY_TIER_SPECS: Readonly<Record<DeviceTier, QualityTierSpec>> = {
  high: {
    dpr: [1, 2],
    antialias: true,
    logarithmicDepthBuffer: true,
    multisampling: 4,
    bloomDefault: true,
    volumeInitialTier: 'high',
    volumeTierLocked: false,
    diskParticleCount: 40000,
    catalogKeepFraction: 1,
    nearViewParticleBudget: 20000,
    galaxyNearViewMaxParticles: 12000,
    galaxyNearViewParticleScale: 1,
    solarParticleScale: 1,
    textureLruBudgetMB: 300,
    allow4kDetail: true,
    anisotropy: 4,
  },
  medium: {
    dpr: [1, 1.5],
    antialias: false,
    logarithmicDepthBuffer: true,
    multisampling: 2,
    bloomDefault: true,
    volumeInitialTier: 'mid',
    volumeTierLocked: false,
    diskParticleCount: 24000,
    catalogKeepFraction: 1,
    nearViewParticleBudget: 20000,
    galaxyNearViewMaxParticles: 12000,
    galaxyNearViewParticleScale: 1,
    solarParticleScale: 1,
    textureLruBudgetMB: 128,
    allow4kDetail: false,
    anisotropy: 2,
  },
  low: {
    dpr: 1,
    antialias: false,
    logarithmicDepthBuffer: false,
    multisampling: 0,
    bloomDefault: false,
    volumeInitialTier: 'low',
    volumeTierLocked: true,
    diskParticleCount: 12000,
    catalogKeepFraction: 0.5,
    nearViewParticleBudget: 10000,
    galaxyNearViewMaxParticles: 6000,
    galaxyNearViewParticleScale: 0.5,
    solarParticleScale: 0.5,
    textureLruBudgetMB: 96,
    allow4kDetail: false,
    anisotropy: 2,
  },
};

/** 取档位参数（唯一入口） */
export function qualityTierSpec(tier: DeviceTier): QualityTierSpec {
  return QUALITY_TIER_SPECS[tier];
}

/** 细节层单天体名义显存（MB）：现状口径 2 天体 ≤300MB（textureBudget.ts） */
export const DETAIL_BODY_NOMINAL_MB = 150;

/**
 * 细节层 LRU 天体容量 = floor(预算 MB / 单天体名义 150MB)，下限 1
 * （high 300 → 2 = 现状 DETAIL_LRU_CAPACITY；medium 128 / low 96 → 1）
 */
export function detailLruCapacityForBudgetMB(budgetMB: number): number {
  if (!(budgetMB > 0) || !Number.isFinite(budgetMB)) {
    throw new RangeError(`纹理预算必须为正有限数，收到 ${budgetMB}`);
  }
  return Math.max(1, Math.floor(budgetMB / DETAIL_BODY_NOMINAL_MB));
}

/** 纹理并发加载数（§M2-4：桌面 3 / 触屏 2） */
export function textureConcurrency(isTouch: boolean): number {
  return isTouch ? 2 : 3;
}

/**
 * 自适应质量档 → 生效 dpr（AdaptiveQualityDriver 联动 R3F setDpr）：
 * 设备档 dpr 为上界（永不超出 §M2-1 表值），自适应档施加动态上限——
 * high 无附加上限 / mid 1.5 / low 1。区间上下界同时钳制。
 */
export function adaptiveDpr(base: DprSpec, tier: VolumeQualityTier): DprSpec {
  const cap = tier === 'low' ? 1 : tier === 'mid' ? 1.5 : Number.POSITIVE_INFINITY;
  if (typeof base === 'number') return Math.min(base, cap);
  const lo = Math.min(base[0], cap);
  const hi = Math.min(base[1], cap);
  return lo === hi ? lo : [lo, hi];
}

/**
 * 2MRS 目录均匀跨步步长（§M2-3 抽稀方式登记：烘焙 bin 按**距离**确定性
 * 排序（scripts/bake-data/galaxyCatalog.ts:164）——非亮度序，截断会整体
 * 砍掉远场结构，故取**均匀跨步采样**：保留 index % stride === 0 的条目，
 * 近域/远景两级按同一全局步长均匀变薄）
 */
export function catalogSampleStride(keepFraction: number): number {
  if (!(keepFraction > 0) || keepFraction > 1 || !Number.isFinite(keepFraction)) {
    throw new RangeError(`保留比例必须在 (0,1] 内，收到 ${keepFraction}`);
  }
  return Math.max(1, Math.round(1 / keepFraction));
}
