/**
 * 太阳黑子系统纯逻辑（S2，IMPROVEMENT_REQUIREMENTS_SOLAR §4.3-1）
 *
 * 科学背景（数据来源：NASA Sun Fact Sheet；SILSO 黑子观测；Hale 1919 极性定律）：
 * - 黑子为光球强磁场抑制对流形成的低温暗区：本影 ~3,500–4,500 °C
 *   （对比光球 ~5,500 °C），外围半影呈放射状纤维结构。
 * - 通常成对出现（前导/后随黑子，磁极相反——Hale 极性定律，信息面板科普）。
 * - 分布于中低纬度带（±35° 以内），随较差自转移动（赤道快于高纬）。
 * - 生命周期数天至数周。
 *
 * 实现：固定 SUNSPOT_PAIR_SLOTS 个"黑子对槽位"，每个槽位按自身周期
 * 循环生成→演化→消散；一切参数由 (槽位, 周期序号) 的确定性哈希导出
 * （可复现，禁止每帧 Math.random——需求 §4.3-1 硬性），黑子经度按所在
 * 纬度的较差自转角速度随模拟时间推进（utils/solarRotation.ts，float64）。
 *
 * ── 艺术化/近似登记（需求 §3、AGENTS.md 数据准确性）──────────────────
 * - 黑子角尺寸：真实大黑子群直径约 2°–6°（日面角度），此处本影+半影
 *   半径取 0.06–0.13 rad（≈3.4°–7.4°，直径最大 ~15°），约放大 2–3 倍
 *   以保证 L1 近观可辨（真实比例模式沿用，因黑子相对尺寸不随半径映射变化）。
 * - 黑子数量（S3 周期联动）：5 对槽位为渲染上限，实际激活对数随 11 年
 *   活动周期黑子包络增减（极小期约 1 对、极大期满 5 对；真实极大期黑子
 *   数可达 200+，此处以槽位数示意相对多寡，登记见 utils/solarCycle.ts）。
 * - 黑子生成纬度（S3 蝴蝶图，Spörer 定律）：周期初于 ±30° 高纬生成、随
 *   相位向赤道（±5°）迁移；每个槽位出生时按当时相位锚定纬度带中心，
 *   叠加槽位哈希抖动（±SUNSPOT_LAT_JITTER_DEG）保留分散性。
 * - 本影亮度取 0.28（按 T⁴ 辐射：(4,000/5,772)⁴ ≈ 0.23，取略高值保留纹理）。
 * 数据来源：NASA/SDO 黑子观测；Solanki (2003) Sunspots: An overview；
 * 蝴蝶图 Maunder (1904)、Hathaway (2015)。
 */

import { solarRotationAngleRad } from '@/utils/solarRotation';
import {
  butterflyLatitudeDeg,
  cycleSunspotEnvelope,
  solarCyclePhase01,
} from '@/utils/solarCycle';

/** 黑子对槽位数（恒定循环，登记见文件头）——每槽位即一个"活动区/黑子群" */
export const SUNSPOT_PAIR_SLOTS = 5;

/**
 * 单群最大黑子颗数（S4 A1）：1 前导 + 最多 (SUNSPOT_MAX_SPOTS_PER_GROUP-1) 卫星。
 * 复杂群按 McIntosh 分级最多渲染此数（登记见文件头）。
 */
export const SUNSPOT_MAX_SPOTS_PER_GROUP = 5;

/**
 * 渲染上限（shader uniform 数组长度）：S4 由"每槽固定 2 颗"扩为"每槽最多
 * SUNSPOT_MAX_SPOTS_PER_GROUP 颗"（1 前导 + N 卫星）。仍在 shader 循环预算内
 * （5 槽 × 5 = 25，取整为 24 上限并按需截断，登记见文件头）。
 */
export const SUNSPOT_MAX_RENDERED = 24;

/** 黑子纬度带（±35°，真实分布） */
export const SUNSPOT_MAX_LAT_DEG = 35;
export const SUNSPOT_MIN_LAT_DEG = 5;

/** 生命周期范围（天：数天至数周，真实量级） */
export const SUNSPOT_MIN_LIFE_DAYS = 6;
export const SUNSPOT_MAX_LIFE_DAYS = 38;

/** 槽位基础周期（天）：生命周期 + 静默间隙 */
export const SUNSPOT_BASE_EPOCH_DAYS = 55;

/** 本影/半影参数（登记见文件头） */
export const SUNSPOT_UMBRA_FRAC = 0.45;
export const SUNSPOT_UMBRA_BRIGHTNESS = 0.28;
export const SUNSPOT_PENUMBRA_BRIGHTNESS = 0.68;

/** 前导/后随黑子经度间隔范围（度，真实量级 3°–10°+） */
export const SUNSPOT_PAIR_SEPARATION_MIN_DEG = 8;
export const SUNSPOT_PAIR_SEPARATION_MAX_DEG = 16;

/** 本影+半影角半径范围（弧度，尺寸放大登记见文件头） */
export const SUNSPOT_RADIUS_MIN_RAD = 0.06;
export const SUNSPOT_RADIUS_MAX_RAD = 0.13;

/** 后随黑子相对前导的半径比例（前导黑子通常更大更持久） */
export const SUNSPOT_FOLLOWER_RADIUS_RATIO = 0.72;

/**
 * 黑子生成纬度抖动（度，S3）：在蝴蝶图相位锚定纬度带中心上叠加的
 * 槽位随机偏移，保留黑子在纬度带内的分散性（真实黑子分布于活动带内而
 * 非集中一线）。
 */
export const SUNSPOT_LAT_JITTER_DEG = 6;

/**
 * 极小期最少激活黑子对数（S3 周期联动）：即便包络接近 0 仍保留少量黑子对
 * （真实极小期黑子稀少但通常非零，且保证近观不至全空）。
 */
export const SUNSPOT_MIN_ACTIVE_PAIRS = 1;

/**
 * 确定性哈希（[0,1)）：与 GLSL hash 同风格的正弦散列，
 * 输入为整数槽位/周期序号 + 盐，跨帧、跨会话可复现。
 */
export function sunspotHash01(slot: number, cycle: number, salt: number): number {
  if (!Number.isFinite(slot) || !Number.isFinite(cycle) || !Number.isFinite(salt)) {
    throw new RangeError(`哈希输入必须为有限数，收到 ${slot}, ${cycle}, ${salt}`);
  }
  const v = Math.sin(slot * 127.1 + cycle * 311.7 + salt * 74.7 + 13.37) * 43758.5453;
  return v - Math.floor(v);
}

/** 平滑插值（GLSL smoothstep 镜像） */
function smooth01(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

/**
 * 槽位周期联动激活判定（S3，§4.4）：黑子对数随活动周期包络增减。
 * 每个槽位按其哈希得到一个 [0,1) 的"激活门槛"，仅当黑子包络高于门槛时
 * 该槽位才活跃——极小期（包络≈0）仅保留 SUNSPOT_MIN_ACTIVE_PAIRS 对，
 * 极大期（包络≈1）全部 SUNSPOT_PAIR_SLOTS 对活跃。
 *
 * 门槛按 slot 序号均匀分布并留出最小激活配额：slot < 最小配额恒活跃，
 * 其余槽位门槛在 (0,1) 内递增，随包络逐个"点亮"。
 *
 * @param slot 槽位序号 [0, SUNSPOT_PAIR_SLOTS)
 * @param envelope01 黑子相对数包络（cycleSunspotEnvelope 结果）∈ [0,1]
 * @returns 该槽位在当前周期相位下是否允许活跃
 */
export function sunspotSlotEnabledByCycle(slot: number, envelope01: number): boolean {
  if (!Number.isInteger(slot) || slot < 0 || slot >= SUNSPOT_PAIR_SLOTS) {
    throw new RangeError(`槽位必须为 [0, ${SUNSPOT_PAIR_SLOTS}) 内整数，收到 ${slot}`);
  }
  const e = Math.min(1, Math.max(0, envelope01));
  if (slot < SUNSPOT_MIN_ACTIVE_PAIRS) return true;
  // 剩余槽位门槛在 (0,1] 均匀分布：slot=min→较低门槛，slot=末→接近 1
  const rank = slot - SUNSPOT_MIN_ACTIVE_PAIRS + 1;
  const span = SUNSPOT_PAIR_SLOTS - SUNSPOT_MIN_ACTIVE_PAIRS;
  const threshold = span > 0 ? rank / (span + 1) : 0;
  return e >= threshold;
}

/**
 * 黑子生命周期包络（0-1）：前 25% 平滑生成，中段平台期，后 35% 平滑消散。
 *
 * @param t01 生命周期进度（<0 或 >1 时返回 0）
 */
export function sunspotEnvelope(t01: number): number {
  if (!Number.isFinite(t01)) {
    throw new RangeError(`生命周期进度必须为有限数，收到 ${t01}`);
  }
  if (t01 <= 0 || t01 >= 1) return 0;
  const rise = smooth01(t01 / 0.25);
  const fall = smooth01((1 - t01) / 0.35);
  return Math.min(rise, fall);
}

/** 单颗黑子实例（对内前导或后随） */
export interface SunspotInstance {
  /** 日面纬度（弧度） */
  latRad: number;
  /** 当前经度（弧度，含较差自转累计） */
  lonRad: number;
  /** 本影+半影角半径（弧度） */
  radiusRad: number;
  /** 当前强度（0-1，生命周期包络） */
  strength01: number;
}

// ---------------------------------------------------------------------------
// S4 A1：黑子群 McIntosh 复杂度分级（数据来源：McIntosh 1990 简化）
// ---------------------------------------------------------------------------

/**
 * 黑子群 McIntosh 简化复杂度分级（S4 A1，§4.7-A1）：
 * - 'A' 单极（unipolar）：仅前导 1 颗，无后随、无卫星（对应真实 Zurich A/H 类）。
 * - 'B' 双极（bipolar）：前导 + 后随 2 颗（对应真实 β 型，退化为 S2 的"对"）。
 * - 'C' 复杂群（complex βγ/βγδ）：前导大黑子 + 后随 + 2–3 颗卫星黑子，
 *   不规则多极簇（对应真实大型活动区）。
 *
 * 真实 McIntosh 分类为三字母（Zpc：修正 Zurich / 最大黑子半影 / 群内分布），
 * 此处以三档"复杂度"示意群规模差异，登记为艺术化简化（面板科普黑子分类）。
 */
export type SunspotGroupClass = 'A' | 'B' | 'C';

/** 各分级出现概率（演示倾斜：单极 35% / 双极 40% / 复杂 25%，登记见文件头） */
export const SUNSPOT_GROUP_CLASS_THRESHOLDS = { a: 0.35, b: 0.75 } as const;

/** 各分级黑子总颗数（含前导；复杂群卫星数另由哈希在范围内取） */
export const SUNSPOT_GROUP_MAX_SATELLITES = 3;

/** 卫星黑子相对前导的半径比例范围（卫星更小更短命） */
export const SUNSPOT_SATELLITE_RADIUS_MIN_RATIO = 0.28;
export const SUNSPOT_SATELLITE_RADIUS_MAX_RATIO = 0.55;

/**
 * 卫星黑子相对前导-后随连线（磁中性线）的散布：沿线归一化位置与横向偏移
 * （弧度）范围。卫星散布在群主轴附近，构成不规则多极簇。
 */
export const SUNSPOT_SATELLITE_ALONG_MIN = 0.15;
export const SUNSPOT_SATELLITE_ALONG_MAX = 0.85;
export const SUNSPOT_SATELLITE_PERP_MAX_RAD = 0.045;

/**
 * 群复杂度分级（S4 A1）：按 (槽位, 周期序号) 确定性哈希赋类型，
 * 单群生命周期内类型恒定（可复现，禁每帧随机）。
 *
 * @param slot 槽位序号
 * @param cycle 该槽位的周期序号
 * @returns McIntosh 简化分级
 */
export function sunspotGroupClass(slot: number, cycle: number): SunspotGroupClass {
  const r = sunspotHash01(slot, cycle, 51);
  if (r < SUNSPOT_GROUP_CLASS_THRESHOLDS.a) return 'A';
  if (r < SUNSPOT_GROUP_CLASS_THRESHOLDS.b) return 'B';
  return 'C';
}

/**
 * 分级 → 群内黑子总颗数（含前导）：A 单极 1 颗、B 双极 2 颗、
 * C 复杂群 2 + [1, SUNSPOT_GROUP_MAX_SATELLITES] 颗卫星。
 *
 * @param groupClass McIntosh 简化分级
 * @param satelliteRoll 卫星数随机 [0,1)（C 类用；A/B 忽略）
 * @returns 群内黑子颗数（≥1）
 */
export function sunspotGroupSpotCount(
  groupClass: SunspotGroupClass,
  satelliteRoll: number,
): number {
  if (groupClass === 'A') return 1;
  if (groupClass === 'B') return 2;
  const r = Math.min(1, Math.max(0, satelliteRoll));
  const satellites = 1 + Math.floor(r * SUNSPOT_GROUP_MAX_SATELLITES);
  return 2 + Math.min(SUNSPOT_GROUP_MAX_SATELLITES, satellites);
}

// ---------------------------------------------------------------------------
// S4 A3：群形态演化（生长/衰退、前导-后随自行分离、卫星先消散）
// ---------------------------------------------------------------------------

/** 群生长期末角半径相对峰值的下限（生成期黑子较小，登记见文件头） */
export const SUNSPOT_GROWTH_MIN_SCALE = 0.55;

/** 前导-后随自行分离随生命周期加大的额外比例（真实黑子群随时间东西向拉开） */
export const SUNSPOT_PROPER_MOTION_FRAC = 0.35;

/**
 * 群角半径演化因子（S4 A3）：随生命周期包络在生长/衰退期收缩
 * （生成期变大、衰退期缩小解体）。以生命周期强度映射：强度越高群越大，
 * 强度低（生长初/衰退末）群较小。下限 SUNSPOT_GROWTH_MIN_SCALE 保证可辨。
 *
 * @param strength01 生命周期包络（sunspotEnvelope 结果）∈ [0,1]
 * @returns 角半径缩放因子 ∈ [SUNSPOT_GROWTH_MIN_SCALE, 1]
 */
export function sunspotGrowthScale(strength01: number): number {
  const s = Math.min(1, Math.max(0, strength01));
  return SUNSPOT_GROWTH_MIN_SCALE + (1 - SUNSPOT_GROWTH_MIN_SCALE) * s;
}

/**
 * 前导-后随自行分离演化因子（S4 A3）：生命周期内经度间隔随时间加大
 * （真实黑子群前导黑子向西漂、后随向东，磁轴逐渐倾斜/拉开）。
 * 生成时为基准间隔、生命周期末达基准 × (1 + SUNSPOT_PROPER_MOTION_FRAC)。
 *
 * @param t01 生命周期进度 ∈ [0,1]
 * @returns 间隔倍数 ∈ [1, 1 + SUNSPOT_PROPER_MOTION_FRAC]
 */
export function sunspotProperMotionFactor(t01: number): number {
  const t = Math.min(1, Math.max(0, t01));
  return 1 + SUNSPOT_PROPER_MOTION_FRAC * t;
}

/**
 * 卫星黑子存活强度（S4 A3）：复杂群衰退时卫星黑子先于主偶极消散。
 * 卫星在生命周期后段（衰退期）比主体更早淡出——按卫星序号错开消散阈值：
 * 序号越大越早消失（外围卫星先解体）。
 *
 * @param mainStrength01 群主体强度（生命周期包络）∈ [0,1]
 * @param satelliteIndex 卫星序号（0 起，越大越外围/越早消散）
 * @param satelliteCount 卫星总数（≥1）
 * @param t01 生命周期进度 ∈ [0,1]
 * @returns 该卫星当前强度 ∈ [0, mainStrength01]
 */
export function sunspotSatelliteStrength(
  mainStrength01: number,
  satelliteIndex: number,
  satelliteCount: number,
  t01: number,
): number {
  const main = Math.min(1, Math.max(0, mainStrength01));
  if (satelliteCount <= 0) return 0;
  const t = Math.min(1, Math.max(0, t01));
  // 衰退期起点（生命周期 65% 起进入解体阶段）
  const decayStart = 0.65;
  if (t <= decayStart) return main;
  // 卫星按序号错开消散：序号 i 的卫星在 [decayStart, 1] 内更早归零
  const rank = (satelliteIndex + 1) / (satelliteCount + 1);
  // 该卫星的个体消散终点（rank 越大越早，最早约 decayStart，最晚接近 1）
  const vanishAt = decayStart + (1 - decayStart) * (1 - rank);
  if (t >= vanishAt) return 0;
  const fade = smooth01((vanishAt - t) / (vanishAt - decayStart));
  return main * fade;
}

/**
 * 槽位黑子对计算（写入调用方提供的实例，渲染循环零分配路径）
 *
 * @returns 该槽位当前是否活跃（false 时 out 实例内容未定义）
 */
export function sunspotPairInto(
  slot: number,
  simDays: number,
  outLeader: SunspotInstance,
  outFollower: SunspotInstance,
): boolean {
  if (!Number.isInteger(slot) || slot < 0 || slot >= SUNSPOT_PAIR_SLOTS) {
    throw new RangeError(`槽位必须为 [0, ${SUNSPOT_PAIR_SLOTS}) 内整数，收到 ${slot}`);
  }
  if (!Number.isFinite(simDays)) {
    throw new RangeError(`模拟时间必须为有限数，收到 ${simDays}`);
  }
  // 槽位周期（各槽位错开，避免同步生灭）
  const epochDays = SUNSPOT_BASE_EPOCH_DAYS * (1 + 0.4 * sunspotHash01(slot, 0, 991));
  const cycle = Math.floor(simDays / epochDays);
  // 本周期参数（确定性哈希）
  const lifeDays =
    SUNSPOT_MIN_LIFE_DAYS +
    (SUNSPOT_MAX_LIFE_DAYS - SUNSPOT_MIN_LIFE_DAYS) * sunspotHash01(slot, cycle, 1);
  const birthOffset = (epochDays - lifeDays) * sunspotHash01(slot, cycle, 2);
  const birthDays = cycle * epochDays + birthOffset;
  const t01 = (simDays - birthDays) / lifeDays;
  const strength01 = sunspotEnvelope(t01);
  if (strength01 <= 0) return false;

  // S3 周期联动：黑子对数随 11 年活动周期包络增减（极小期少、极大期满）。
  // 以出生时刻的周期包络门控该槽位（出生后即便包络下降仍完成其生命周期）。
  const cycleEnvelope = cycleSunspotEnvelope(solarCyclePhase01(birthDays));
  if (!sunspotSlotEnabledByCycle(slot, cycleEnvelope)) return false;

  const latSign = sunspotHash01(slot, cycle, 3) < 0.5 ? -1 : 1;
  // S3 蝴蝶图（Spörer 定律）：黑子生成纬度按出生时刻的周期相位插值——
  // 周期初 ±30° 高纬、周期末 ±5° 赤道；叠加槽位哈希抖动保留分散性，
  // 并钳制在 ±SUNSPOT_MAX_LAT_DEG 纬度带内。
  const bandCenterDeg = butterflyLatitudeDeg(solarCyclePhase01(birthDays));
  const jitterDeg = (sunspotHash01(slot, cycle, 4) * 2 - 1) * SUNSPOT_LAT_JITTER_DEG;
  const latDeg = Math.min(
    SUNSPOT_MAX_LAT_DEG,
    Math.max(SUNSPOT_MIN_LAT_DEG, bandCenterDeg + jitterDeg),
  );
  const latRad = (latSign * latDeg * Math.PI) / 180;
  const lonBirthRad = sunspotHash01(slot, cycle, 5) * Math.PI * 2;
  // 较差自转：出生后按所在纬度角速度东向移动（float64 累计，无回卷问题）
  const lonRad = lonBirthRad + solarRotationAngleRad(latRad, simDays - birthDays);
  const separationRad =
    ((SUNSPOT_PAIR_SEPARATION_MIN_DEG +
      (SUNSPOT_PAIR_SEPARATION_MAX_DEG - SUNSPOT_PAIR_SEPARATION_MIN_DEG) *
        sunspotHash01(slot, cycle, 6)) *
      Math.PI) /
    180;
  const radiusRad =
    SUNSPOT_RADIUS_MIN_RAD +
    (SUNSPOT_RADIUS_MAX_RAD - SUNSPOT_RADIUS_MIN_RAD) * sunspotHash01(slot, cycle, 7);

  // 前导黑子在自转方向（经度增大方向）前方，后随略小（Hale 对结构）
  outLeader.latRad = latRad;
  outLeader.lonRad = lonRad + separationRad / 2;
  outLeader.radiusRad = radiusRad;
  outLeader.strength01 = strength01;
  outFollower.latRad = latRad;
  outFollower.lonRad = lonRad - separationRad / 2;
  outFollower.radiusRad = radiusRad * SUNSPOT_FOLLOWER_RADIUS_RATIO;
  outFollower.strength01 = strength01;
  return true;
}

/** 单个黑子群（S4 A1）：前导 + 可选后随 + 卫星簇 + 分级 */
export interface SunspotGroup {
  /** McIntosh 简化分级 */
  groupClass: SunspotGroupClass;
  /** 群内黑子（[0] 为前导；B/C 类 [1] 为后随；其余为卫星） */
  spots: SunspotInstance[];
  /** 群内实际黑子数 */
  count: number;
  /** 前导方向（磁中性线端点 A，单位矢量） */
  leaderDir: { x: number; y: number; z: number };
  /** 后随方向（磁中性线端点 B，单位矢量；A 类退化为前导反向短轴） */
  followerDir: { x: number; y: number; z: number };
  /** 群主体强度（生命周期包络） */
  strength01: number;
}

/**
 * 创建可复用的空黑子群结构（预分配 SUNSPOT_MAX_SPOTS_PER_GROUP 颗，零分配路径复用）
 */
export function createSunspotGroup(): SunspotGroup {
  return {
    groupClass: 'A',
    spots: Array.from({ length: SUNSPOT_MAX_SPOTS_PER_GROUP }, () => ({
      latRad: 0,
      lonRad: 0,
      radiusRad: 0,
      strength01: 0,
    })),
    count: 0,
    leaderDir: { x: 1, y: 0, z: 0 },
    followerDir: { x: 1, y: 0, z: 0 },
    strength01: 0,
  };
}

/**
 * 槽位黑子群计算（S4 A1+A2+A3，写入调用方提供的群结构，渲染循环零分配路径）：
 * 复用 sunspotPairInto 的前导/后随几何作为群主偶极，再按 McIntosh 分级追加
 * 卫星黑子（沿磁中性线散布），并应用 A3 群形态演化（生长/衰退角半径缩放、
 * 前导-后随自行分离加大、卫星先消散）。
 *
 * @returns 该槽位当前是否有活跃黑子群（false 时 out 内容未定义）
 */
export function sunspotGroupInto(slot: number, simDays: number, out: SunspotGroup): boolean {
  if (!Number.isInteger(slot) || slot < 0 || slot >= SUNSPOT_PAIR_SLOTS) {
    throw new RangeError(`槽位必须为 [0, ${SUNSPOT_PAIR_SLOTS}) 内整数，收到 ${slot}`);
  }
  if (!sunspotPairInto(slot, simDays, out.spots[0], out.spots[1])) {
    out.count = 0;
    return false;
  }
  // 复算周期/生命周期进度（与 sunspotPairInto 同参数，用于 A3 演化与分级哈希）
  const epochDays = SUNSPOT_BASE_EPOCH_DAYS * (1 + 0.4 * sunspotHash01(slot, 0, 991));
  const cycle = Math.floor(simDays / epochDays);
  const lifeDays =
    SUNSPOT_MIN_LIFE_DAYS +
    (SUNSPOT_MAX_LIFE_DAYS - SUNSPOT_MIN_LIFE_DAYS) * sunspotHash01(slot, cycle, 1);
  const birthOffset = (epochDays - lifeDays) * sunspotHash01(slot, cycle, 2);
  const birthDays = cycle * epochDays + birthOffset;
  const t01 = (simDays - birthDays) / lifeDays;
  const strength = out.spots[0].strength01;

  const groupClass = sunspotGroupClass(slot, cycle);
  out.groupClass = groupClass;
  out.strength01 = strength;

  // A3：群角半径生长/衰退（前导与后随一并缩放）
  const growth = sunspotGrowthScale(strength);
  // A3：前导-后随自行分离随生命周期加大（围绕群中点对称拉开）
  const leader = out.spots[0];
  const follower = out.spots[1];
  const midLon = (leader.lonRad + follower.lonRad) / 2;
  const halfSepBase = (leader.lonRad - follower.lonRad) / 2;
  const properMotion = sunspotProperMotionFactor(t01);
  leader.lonRad = midLon + halfSepBase * properMotion;
  follower.lonRad = midLon - halfSepBase * properMotion;
  leader.radiusRad *= growth;
  follower.radiusRad *= growth;

  // 群主偶极方向（磁中性线端点）
  const dl = sunspotDirection(leader.latRad, leader.lonRad);
  const df = sunspotDirection(follower.latRad, follower.lonRad);
  out.leaderDir.x = dl.x;
  out.leaderDir.y = dl.y;
  out.leaderDir.z = dl.z;
  out.followerDir.x = df.x;
  out.followerDir.y = df.y;
  out.followerDir.z = df.z;

  if (groupClass === 'A') {
    // 单极：仅前导，后随视为退化（followerDir 用前导偏一微小量保证中性线有向）
    out.count = 1;
    out.followerDir.x = dl.x;
    out.followerDir.y = dl.y;
    out.followerDir.z = dl.z;
    return true;
  }
  if (groupClass === 'B') {
    out.count = 2;
    return true;
  }

  // C 复杂群：追加卫星黑子（沿磁中性线散布，A3 衰退期先消散）
  const satRoll = sunspotHash01(slot, cycle, 52);
  const total = sunspotGroupSpotCount('C', satRoll);
  const satelliteCount = total - 2;
  let count = 2;
  for (let s = 0; s < satelliteCount && count < SUNSPOT_MAX_SPOTS_PER_GROUP; s += 1) {
    const alongH = sunspotHash01(slot, cycle, 60 + s * 3);
    const perpH = sunspotHash01(slot, cycle, 61 + s * 3);
    const radH = sunspotHash01(slot, cycle, 62 + s * 3);
    const along =
      SUNSPOT_SATELLITE_ALONG_MIN +
      (SUNSPOT_SATELLITE_ALONG_MAX - SUNSPOT_SATELLITE_ALONG_MIN) * alongH;
    const perp = (perpH * 2 - 1) * SUNSPOT_SATELLITE_PERP_MAX_RAD;
    // 沿中性线插值经纬 + 横向偏移（纬度方向）
    const satLat = follower.latRad + (leader.latRad - follower.latRad) * along + perp;
    const satLon = follower.lonRad + (leader.lonRad - follower.lonRad) * along;
    const satRatio =
      SUNSPOT_SATELLITE_RADIUS_MIN_RATIO +
      (SUNSPOT_SATELLITE_RADIUS_MAX_RATIO - SUNSPOT_SATELLITE_RADIUS_MIN_RATIO) * radH;
    const satStrength = sunspotSatelliteStrength(strength, s, satelliteCount, t01);
    const spot = out.spots[count];
    spot.latRad = satLat;
    spot.lonRad = satLon;
    spot.radiusRad = leader.radiusRad * satRatio;
    spot.strength01 = satStrength;
    count += 1;
  }
  out.count = count;
  return true;
}

/** 槽位在某时刻的黑子群（未活跃时为 null；测试/事件用，非渲染循环路径） */
export function sunspotGroupState(slot: number, simDays: number): SunspotGroup | null {
  const group = createSunspotGroup();
  return sunspotGroupInto(slot, simDays, group) ? group : null;
}

/** 槽位在某时刻的黑子对（未活跃时为 null；测试/事件触发用，非渲染循环路径） */
export function sunspotPairState(
  slot: number,
  simDays: number,
): [SunspotInstance, SunspotInstance] | null {
  const leader: SunspotInstance = { latRad: 0, lonRad: 0, radiusRad: 0, strength01: 0 };
  const follower: SunspotInstance = { latRad: 0, lonRad: 0, radiusRad: 0, strength01: 0 };
  return sunspotPairInto(slot, simDays, leader, follower) ? [leader, follower] : null;
}

/**
 * 黑子方向单位矢量（对象空间，与 shader vObjPos 同约定）：
 * x = cosφ·cosλ, y = sinφ, z = −cosφ·sinλ
 */
export function sunspotDirection(latRad: number, lonRad: number): { x: number; y: number; z: number } {
  const cosLat = Math.cos(latRad);
  return {
    x: cosLat * Math.cos(lonRad),
    y: Math.sin(latRad),
    z: -cosLat * Math.sin(lonRad),
  };
}

// ---------------------------------------------------------------------------
// S4 A2：不规则本影边界 + 丝状半影（纯逻辑镜像，shader 同款计算）
// ---------------------------------------------------------------------------

/** 本影边界角向扰动幅度（相对本影半径，低频多边形化，登记见文件头） */
export const UMBRA_IRREGULAR_AMP = 0.28;

/** 本影边界角向噪声频率（低频 → 不规则多边形而非细碎） */
export const UMBRA_IRREGULAR_FREQ = 3.0;

/** 半影细丝径向条纹频率（penumbral filaments，放射状） */
export const PENUMBRA_FIBRIL_FREQ = 26.0;

/** 半影细丝亮度调制幅度 */
export const PENUMBRA_FIBRIL_AMP = 0.22;

/**
 * 不规则本影有效半径（S4 A2）：以片元相对黑子中心的方位角 azimuth 作低频
 * 角向噪声扰动，使本影边界呈不规则多边形（非正圆）。返回该方位上的本影
 * 有效角半径。shader 用同款 sin 叠加计算（GLSL 直接实现，不共享此函数）。
 *
 * @param baseUmbraRad 名义本影角半径（radiusRad × SUNSPOT_UMBRA_FRAC）
 * @param azimuthRad 片元相对黑子中心的方位角（弧度）
 * @param seed 每黑子独立相位种子（避免所有黑子同形）
 * @returns 扰动后本影有效角半径（>0）
 */
export function umbraIrregularRadius(
  baseUmbraRad: number,
  azimuthRad: number,
  seed: number,
): number {
  if (!(baseUmbraRad > 0)) {
    throw new RangeError(`本影半径必须为正数，收到 ${baseUmbraRad}`);
  }
  // 两个低频谐波叠加（3、5 次）构成不规则多边形轮廓
  const n =
    Math.sin(azimuthRad * UMBRA_IRREGULAR_FREQ + seed) * 0.6 +
    Math.sin(azimuthRad * (UMBRA_IRREGULAR_FREQ + 2) + seed * 1.7) * 0.4;
  return baseUmbraRad * (1 + UMBRA_IRREGULAR_AMP * n);
}

/**
 * 丝状半影亮度调制（S4 A2）：半影区径向拉伸的细丝纹理（penumbral filaments），
 * 以方位角高频条纹 × 径向渐变构成放射状细丝。返回叠加到半影基础亮度的偏移。
 *
 * @param azimuthRad 片元相对黑子中心的方位角（弧度）
 * @param radialFrac 半影内径向归一化位置 ∈ [0,1]（0 内缘 / 1 外缘）
 * @param fibrilNoise01 附加噪声 [0,1]（打破规则条纹，shader 用 valueNoise3）
 * @returns 亮度偏移 ∈ [-PENUMBRA_FIBRIL_AMP, PENUMBRA_FIBRIL_AMP]
 */
export function penumbraFibrilOffset(
  azimuthRad: number,
  radialFrac: number,
  fibrilNoise01: number,
): number {
  const rf = Math.min(1, Math.max(0, radialFrac));
  const nz = Math.min(1, Math.max(0, fibrilNoise01));
  // 高频角向条纹（放射状细丝）× 噪声抖动 × 径向包络（中段最明显）
  const stripes = Math.sin(azimuthRad * PENUMBRA_FIBRIL_FREQ + (nz - 0.5) * 6);
  const radialEnv = Math.sin(Math.PI * rf);
  return PENUMBRA_FIBRIL_AMP * stripes * radialEnv * (0.5 + 0.5 * nz);
}

// 渲染循环零分配路径的模块级暂存实例（fillSunspotShaderData 复用）
const SCRATCH_LEADER: SunspotInstance = { latRad: 0, lonRad: 0, radiusRad: 0, strength01: 0 };
const SCRATCH_FOLLOWER: SunspotInstance = { latRad: 0, lonRad: 0, radiusRad: 0, strength01: 0 };
// S4 群填充复用群结构（模块级零分配）
const SCRATCH_GROUP: SunspotGroup = createSunspotGroup();

/** 群级中性线 uniform 数组长度（= 槽位数，每槽一组前导/后随中性线） */
export const SUNSPOT_GROUP_SLOTS = SUNSPOT_PAIR_SLOTS;

/**
 * 填充 shader uniform 数据（S4，渲染循环禁止分配——写入预分配数组）：
 * 逐槽位展开黑子群（前导 + 后随 + 卫星），每颗黑子写一条方向 + 参数记录。
 *
 * outParams 布局（每黑子 3 float）：[radiusRad, strength01, azimuthSeed]。
 * azimuthSeed 供 shader A2 不规则本影/丝状半影独立相位（避免所有黑子同形）。
 *
 * @param simDays 模拟时间（天）
 * @param outDirs 长度 ≥ SUNSPOT_MAX_RENDERED×3 的方向数组（单位矢量 xyz）
 * @param outParams 长度 ≥ SUNSPOT_MAX_RENDERED×3 的参数数组
 * @returns 活跃黑子数（≤ SUNSPOT_MAX_RENDERED）
 */
export function fillSunspotShaderData(
  simDays: number,
  outDirs: Float32Array | number[],
  outParams: Float32Array | number[],
): number {
  if (outDirs.length < SUNSPOT_MAX_RENDERED * 3 || outParams.length < SUNSPOT_MAX_RENDERED * 3) {
    throw new RangeError(
      `输出数组长度不足：需要 ${SUNSPOT_MAX_RENDERED * 3}，收到 ${outDirs.length}/${outParams.length}`,
    );
  }
  let count = 0;
  for (let slot = 0; slot < SUNSPOT_PAIR_SLOTS; slot += 1) {
    if (!sunspotGroupInto(slot, simDays, SCRATCH_GROUP)) continue;
    for (let k = 0; k < SCRATCH_GROUP.count && count < SUNSPOT_MAX_RENDERED; k += 1) {
      const spot = SCRATCH_GROUP.spots[k];
      if (spot.strength01 <= 0) continue;
      const cosLat = Math.cos(spot.latRad);
      const base = count * 3;
      outDirs[base] = cosLat * Math.cos(spot.lonRad);
      outDirs[base + 1] = Math.sin(spot.latRad);
      outDirs[base + 2] = -cosLat * Math.sin(spot.lonRad);
      outParams[base] = spot.radiusRad;
      outParams[base + 1] = spot.strength01;
      // A2 独立方位相位种子（确定性，跨帧稳定）
      outParams[base + 2] = sunspotHash01(slot, k, 71) * Math.PI * 2;
      count += 1;
    }
  }
  return count;
}

/**
 * 填充群级中性线 shader 数据（S4，渲染循环零分配）：每活跃群写一条
 * 前导→后随中性线（供 shader S3 暗条、B1 双带耀斑几何）。
 *
 * @param simDays 模拟时间（天）
 * @param outLeaderDirs 长度 ≥ SUNSPOT_GROUP_SLOTS×3 前导方向数组
 * @param outFollowerDirs 长度 ≥ SUNSPOT_GROUP_SLOTS×3 后随方向数组
 * @param outStrength 长度 ≥ SUNSPOT_GROUP_SLOTS 群强度数组
 * @returns 活跃群数（≤ SUNSPOT_GROUP_SLOTS）
 */
export function fillSunspotGroupData(
  simDays: number,
  outLeaderDirs: Float32Array | number[],
  outFollowerDirs: Float32Array | number[],
  outStrength: Float32Array | number[],
): number {
  if (
    outLeaderDirs.length < SUNSPOT_GROUP_SLOTS * 3 ||
    outFollowerDirs.length < SUNSPOT_GROUP_SLOTS * 3 ||
    outStrength.length < SUNSPOT_GROUP_SLOTS
  ) {
    throw new RangeError(`群 uniform 数组长度不足（需要 ${SUNSPOT_GROUP_SLOTS} 组）`);
  }
  let count = 0;
  for (let slot = 0; slot < SUNSPOT_PAIR_SLOTS; slot += 1) {
    if (!sunspotGroupInto(slot, simDays, SCRATCH_GROUP)) continue;
    const base = count * 3;
    outLeaderDirs[base] = SCRATCH_GROUP.leaderDir.x;
    outLeaderDirs[base + 1] = SCRATCH_GROUP.leaderDir.y;
    outLeaderDirs[base + 2] = SCRATCH_GROUP.leaderDir.z;
    outFollowerDirs[base] = SCRATCH_GROUP.followerDir.x;
    outFollowerDirs[base + 1] = SCRATCH_GROUP.followerDir.y;
    outFollowerDirs[base + 2] = SCRATCH_GROUP.followerDir.z;
    outStrength[count] = SCRATCH_GROUP.strength01;
    count += 1;
  }
  return count;
}

/**
 * 黑子亮度乘数（shader 镜像）：本影深暗核心 + 半影放射状纤维过渡。
 *
 * @param angDistRad 片元方向与黑子中心的角距（弧度）
 * @param radiusRad 黑子总角半径（本影+半影）
 * @param strength01 生命周期强度（0-1）
 * @param fibril01 半影纤维噪声（0-1，径向条纹调制）
 * @returns 亮度乘数 ∈ (0,1]
 */
export function sunspotDarkening(
  angDistRad: number,
  radiusRad: number,
  strength01: number,
  fibril01: number,
): number {
  if (!(radiusRad > 0)) {
    throw new RangeError(`黑子半径必须为正数，收到 ${radiusRad}`);
  }
  const d = Math.max(0, angDistRad);
  if (d >= radiusRad) return 1;
  const s = Math.min(1, Math.max(0, strength01));
  const umbraR = radiusRad * SUNSPOT_UMBRA_FRAC;
  let factor: number;
  if (d <= umbraR) {
    factor = SUNSPOT_UMBRA_BRIGHTNESS;
  } else {
    const t = (d - umbraR) / (radiusRad - umbraR);
    const pen = SUNSPOT_PENUMBRA_BRIGHTNESS + 0.15 * (Math.min(1, Math.max(0, fibril01)) - 0.5);
    factor = pen + (1 - pen) * smooth01(t);
  }
  return 1 - (1 - factor) * s;
}

/**
 * 黑子视觉尺寸放大倍数（登记见文件头）：渲染角半径为真实的 ~2.5 倍
 * （文件头声明放大 2–3 倍），"可容纳 N 个地球"换算须用放大前真实尺寸。
 */
export const SUNSPOT_SIZE_EXAGGERATION = 2.5;

/** 太阳半径（km，NASA Sun Fact Sheet；地球换算用真实值） */
export const SUN_RADIUS_KM = 695700;

/** 地球半径（km，NASA Earth Fact Sheet；截面换算用真实值） */
export const EARTH_RADIUS_KM = 6371;

/**
 * 黑子可容纳地球数（S3 §4.5）：按黑子放大前真实角半径换算日面真实面积，
 * 除以地球截面积（π·R⊕²）。
 *
 * 真实黑子角半径 = 渲染角半径 / SUNSPOT_SIZE_EXAGGERATION；
 * 黑子在日面上的线半径 ≈ R☉ · θ_real（小角近似，θ 为日面大圆角距）；
 * 黑子面积 ≈ π·(R☉·θ_real)²；地球截面 = π·R⊕²；
 * N = (R☉·θ_real / R⊕)²。
 *
 * @param renderedRadiusRad 渲染角半径（弧度，含放大）
 * @returns 可容纳地球数（≥0，四舍五入由调用方按需处理）
 */
export function sunspotEarthCount(renderedRadiusRad: number): number {
  if (!(renderedRadiusRad > 0)) {
    throw new RangeError(`黑子半径必须为正数，收到 ${renderedRadiusRad}`);
  }
  const realRad = renderedRadiusRad / SUNSPOT_SIZE_EXAGGERATION;
  const spotLinearKm = SUN_RADIUS_KM * realRad;
  const ratio = spotLinearKm / EARTH_RADIUS_KM;
  return ratio * ratio;
}

/** 暗条（filament）半宽（弧度，S3 §4.3-6）：日面暗色细线的横向半宽 */
export const FILAMENT_HALF_WIDTH_RAD = 0.02;

/** 暗条暗化下限（相对亮度，暗条为悬浮冷等离子体在日面的投影暗线） */
export const FILAMENT_MIN_BRIGHTNESS = 0.55;

/**
 * 暗条亮度乘数（shader 镜像，§4.3-6）：黑子对之间的磁中性线附近呈现
 * 暗色细线（日珥在日面上的投影即暗条，冷等离子体吸收）。以片元到"中性线
 * 段"的横向角距作细带暗化，仅在段长范围内生效。
 *
 * @param perpDistRad 片元到中性线的横向角距（弧度）
 * @param alongFrac 沿中性线的归一化位置 ∈ [0,1]（0/1 为两端，超出不暗化）
 * @param strength01 黑子对强度（0-1，越强暗条越明显）
 * @returns 亮度乘数 ∈ [FILAMENT_MIN_BRIGHTNESS, 1]
 */
export function filamentDarkening(
  perpDistRad: number,
  alongFrac: number,
  strength01: number,
): number {
  if (alongFrac < 0 || alongFrac > 1) return 1;
  const d = Math.abs(perpDistRad);
  if (d >= FILAMENT_HALF_WIDTH_RAD) return 1;
  const s = Math.min(1, Math.max(0, strength01));
  // 横向三角窗（线心最暗）× 沿线两端渐隐（sin 包络）
  const across = 1 - d / FILAMENT_HALF_WIDTH_RAD;
  const along = Math.sin(Math.PI * alongFrac);
  const dark = (1 - FILAMENT_MIN_BRIGHTNESS) * across * along * s;
  return 1 - dark;
}

/**
 * 活动区方位（耀斑/日冕环锚定用）：优先取当前最强黑子对的中心方位；
 * 无活跃黑子时按确定性哈希回退到中低纬随机方位。
 *
 * @param simDays 模拟时间（天）
 * @param rand01 回退方位用随机数（[0,1)，事件触发时刻一次性采样）
 */
export function activeRegionLatLon(
  simDays: number,
  rand01: number,
): { latRad: number; lonRad: number } {
  let best: SunspotInstance | null = null;
  for (let slot = 0; slot < SUNSPOT_PAIR_SLOTS; slot += 1) {
    const pair = sunspotPairState(slot, simDays);
    if (pair && (!best || pair[0].strength01 > best.strength01)) {
      best = pair[0];
    }
  }
  if (best) {
    return { latRad: best.latRad, lonRad: best.lonRad };
  }
  const r = Math.min(1, Math.max(0, rand01));
  const latRad = ((r * 2 - 1) * 30 * Math.PI) / 180;
  return { latRad, lonRad: r * Math.PI * 2 };
}
