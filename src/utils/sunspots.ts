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
 * - 黑子数量：恒定 5 对槽位循环（真实数量随 11 年周期 0–200+ 变化，
 *   周期联动属 S3 范围），呈现中等活动水平。
 * - 本影亮度取 0.28（按 T⁴ 辐射：(4,000/5,772)⁴ ≈ 0.23，取略高值保留纹理）。
 * 数据来源：NASA/SDO 黑子观测；Solanki (2003) Sunspots: An overview。
 */

import { solarRotationAngleRad } from '@/utils/solarRotation';

/** 黑子对槽位数（恒定循环，登记见文件头） */
export const SUNSPOT_PAIR_SLOTS = 5;

/** 渲染上限（shader uniform 数组长度 = 槽位 × 2） */
export const SUNSPOT_MAX_RENDERED = SUNSPOT_PAIR_SLOTS * 2;

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

  const latSign = sunspotHash01(slot, cycle, 3) < 0.5 ? -1 : 1;
  const latDeg =
    SUNSPOT_MIN_LAT_DEG +
    (SUNSPOT_MAX_LAT_DEG - SUNSPOT_MIN_LAT_DEG) * sunspotHash01(slot, cycle, 4);
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

// 渲染循环零分配路径的模块级暂存实例（fillSunspotShaderData 复用）
const SCRATCH_LEADER: SunspotInstance = { latRad: 0, lonRad: 0, radiusRad: 0, strength01: 0 };
const SCRATCH_FOLLOWER: SunspotInstance = { latRad: 0, lonRad: 0, radiusRad: 0, strength01: 0 };

/**
 * 填充 shader uniform 数据（渲染循环禁止分配——写入预分配数组）
 *
 * @param simDays 模拟时间（天）
 * @param outDirs 长度 ≥ SUNSPOT_MAX_RENDERED×3 的方向数组（单位矢量 xyz）
 * @param outParams 长度 ≥ SUNSPOT_MAX_RENDERED×3 的参数数组（radiusRad, strength, 保留位）
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
    if (!sunspotPairInto(slot, simDays, SCRATCH_LEADER, SCRATCH_FOLLOWER)) continue;
    for (const spot of [SCRATCH_LEADER, SCRATCH_FOLLOWER] as const) {
      const cosLat = Math.cos(spot.latRad);
      const base = count * 3;
      outDirs[base] = cosLat * Math.cos(spot.lonRad);
      outDirs[base + 1] = Math.sin(spot.latRad);
      outDirs[base + 2] = -cosLat * Math.sin(spot.lonRad);
      outParams[base] = spot.radiusRad;
      outParams[base + 1] = spot.strength01;
      outParams[base + 2] = 0;
      count += 1;
    }
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
