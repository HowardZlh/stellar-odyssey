/**
 * 太阳活动事件纯逻辑（S2，IMPROVEMENT_REQUIREMENTS_SOLAR §4.3-2/3/4/6）：
 * 耀斑（flare）、日冕物质抛射（CME）、太阳风（solar wind）、日珥/日冕环。
 *
 * 科学背景（数据来源：NOAA GOES X 射线耀斑分级；NASA/SOHO LASCO CME 目录；
 * Yashiro et al. 2005 耀斑-CME 关联统计；Parker 1958 太阳风理论）：
 * - 耀斑：活动区磁重联释放能量，按软 X 射线峰值通量分级 C/M/X
 *   （每级 10 倍），几分钟内可释放相当于数十亿颗氢弹的能量。
 * - CME：大团等离子体从日冕喷出，速度 250–3,000 km/s；与耀斑的
 *   关联率随级别升高（X 级 ~90%）；朝地球方向时可能引发地磁暴。
 * - 太阳风：日冕持续外流的带电粒子流（质子/电子），速度 400–800 km/s。
 * - 日珥：色球物质沿磁力线悬浮于日冕中的弧状结构，寿命数天至数月。
 *
 * ── 艺术化/近似登记（需求 §3、AGENTS.md 数据准确性）──────────────────
 * - 耀斑时长（速率钳制类减速登记）：真实几分钟至几小时；模拟以
 *   FLARE_DURATION_DAYS（模拟天）呈现——L1 默认时间压缩比（1 秒≈4 小时）
 *   下约 10 秒动画；暂停冻结、快进联动（共享模拟时间轴）。
 * - 耀斑触发频率：真实频率随活动周期在"每天数次～数周一次"间变化
 *   （周期联动属 S3），模拟按泊松过程取理想化平均间隔
 *   FLARE_MEAN_INTERVAL_DAYS，且 C/M/X 概率分布向高级别倾斜以便演示。
 * - CME/太阳风速度：物理速度量级真实（km/s 按场景尺度换算），
 *   CME 粒子在 CME_MAX_RADIUS_UNITS（约 2.6 AU）处淡出回收（真实 CME
 *   持续传播至日球层边缘）。
 * - 日珥高度取 ~0.22 R☉（真实大日珥数万公里 ≈ 0.05–0.1 R☉，特大爆发
 *   日珥可达 0.5 R☉；此处取放大值保证近观可辨）。
 */

import type { SolarFlareClass } from '@/types';
import { AU_KM, SCENE_UNITS_PER_AU } from '@/utils/scale';

// ---------------------------------------------------------------------------
// 耀斑（solar flare）
// ---------------------------------------------------------------------------

/** 耀斑动画总时长（模拟天；L1 压缩比下约 10 秒，减速登记见文件头） */
export const FLARE_DURATION_DAYS = 1.6;

/** 耀斑自动触发平均间隔（模拟天，泊松过程；频率理想化登记见文件头） */
export const FLARE_MEAN_INTERVAL_DAYS = 60;

/** 单帧模拟时间增量上限（天）：防时间跳变/快进后瞬间连爆 */
export const FLARE_TRIGGER_DELTA_CLAMP_DAYS = 1;

/** 耀斑亮起阶段占比（其余为指数衰减） */
export const FLARE_RISE_FRACTION = 0.18;

/** 耀斑级别分布（演示倾斜登记见文件头）：C 50% / M 35% / X 15% */
export const FLARE_CLASS_THRESHOLDS = { c: 0.5, m: 0.85 } as const;

/** 光球局部增亮峰值倍数（Bloom 阈值 0.55 之上，自然联动泛光） */
export const FLARE_BRIGHTNESS_BOOST = 3.2;

/** 耀斑增亮区角半径（弧度） */
export const FLARE_SPOT_RADIUS_RAD = 0.22;

/**
 * 耀斑级别判定（确定性映射，触发时刻一次性采样随机数）
 */
export function flareClassRoll(rand01: number): SolarFlareClass {
  const r = Math.min(1, Math.max(0, rand01));
  if (r < FLARE_CLASS_THRESHOLDS.c) return 'C';
  if (r < FLARE_CLASS_THRESHOLDS.m) return 'M';
  return 'X';
}

/**
 * 耀斑级内量级（1.0–9.9，如 X2.3 的 2.3）
 */
export function flareMagnitudeRoll(rand01: number): number {
  const r = Math.min(1, Math.max(0, rand01));
  return Math.round((1 + r * 8.9) * 10) / 10;
}

/**
 * 耀斑强度曲线（0-1）：局部快速增亮（easeOut）→ 峰值 → 指数衰减
 * （需求 §4.3-2 阶段动画；衰减常数使结束时 ≈0.018）。
 *
 * @param t01 事件进度（<0 或 ≥1 时返回 0）
 */
export function flareIntensity01(t01: number): number {
  if (!Number.isFinite(t01)) {
    throw new RangeError(`事件进度必须为有限数，收到 ${t01}`);
  }
  if (t01 <= 0 || t01 >= 1) return 0;
  if (t01 < FLARE_RISE_FRACTION) {
    const t = t01 / FLARE_RISE_FRACTION;
    return 1 - Math.pow(1 - t, 3);
  }
  const t = (t01 - FLARE_RISE_FRACTION) / (1 - FLARE_RISE_FRACTION);
  return Math.exp(-4 * t);
}

/**
 * 耀斑光球局部增亮量（shader 镜像）：增亮区平滑衰减窗 × 峰值倍数 × 强度。
 * 峰值亮度远超 Bloom 阈值（0.55），自然联动泛光（需求 §4.3-2 峰值闪光）。
 *
 * @param angDistRad 片元方向与耀斑源的角距（弧度）
 * @param intensity01 耀斑强度（flareIntensity01 结果）
 */
export function flareLocalBoost(angDistRad: number, intensity01: number): number {
  const t = Math.min(1, Math.max(0, angDistRad / FLARE_SPOT_RADIUS_RAD));
  const w = 1 - t * t * (3 - 2 * t);
  return FLARE_BRIGHTNESS_BOOST * Math.min(1, Math.max(0, intensity01)) * w * w;
}

/**
 * 耀斑事件进度（0-1，超出范围钳制到边界外由 flareIntensity01 归零）
 */
export function flareProgress01(simDays: number, startedAtSimDays: number, durationDays: number): number {
  if (!(durationDays > 0)) {
    throw new RangeError(`事件时长必须为正数，收到 ${durationDays}`);
  }
  return (simDays - startedAtSimDays) / durationDays;
}

/**
 * 自动触发判定（泊松过程，同超新星范式）：Δt 内至少发生一次的概率
 * p = 1 − exp(−Δt/mean)；Δt 先按 FLARE_TRIGGER_DELTA_CLAMP_DAYS 钳制。
 */
export function shouldAutoTriggerFlare(
  rand01: number,
  deltaSimDays: number,
  meanIntervalDays: number = FLARE_MEAN_INTERVAL_DAYS,
): boolean {
  if (meanIntervalDays <= 0) {
    throw new RangeError(`平均间隔必须为正数，收到 ${meanIntervalDays}`);
  }
  if (deltaSimDays <= 0) return false;
  const clamped = Math.min(deltaSimDays, FLARE_TRIGGER_DELTA_CLAMP_DAYS);
  return rand01 < 1 - Math.exp(-clamped / meanIntervalDays);
}

// ---------------------------------------------------------------------------
// CME（日冕物质抛射）
// ---------------------------------------------------------------------------

/** CME 速度范围（km/s，真实量级） */
export const CME_SPEED_KM_S_MIN = 250;
export const CME_SPEED_KM_S_MAX = 3000;

/** CME 粒子壳层最大半径（场景单位 ≈ 2.6 AU，淡出回收边界，登记见文件头） */
export const CME_MAX_RADIUS_UNITS = 26;

/** CME 锥面半张角（度，典型 CME 角宽 ~45°–60°，取半角 30°） */
export const CME_CONE_HALF_ANGLE_DEG = 30;

/** 朝地球判定角阈值（度）：抛射方向与日-地连线夹角小于该值视为朝向地球 */
export const CME_EARTH_DIRECTED_DEG = 25;

/** 独立 CME（无耀斑前导）自动触发平均间隔（模拟天，泊松；频率理想化登记见文件头） */
export const CME_INDEPENDENT_MEAN_INTERVAL_DAYS = 180;

/** 耀斑-CME 关联概率（Yashiro et al. 2005 量级）：级别越高关联率越高 */
export function cmeLinkProbability(flareClass: SolarFlareClass): number {
  switch (flareClass) {
    case 'X':
      return 0.9;
    case 'M':
      return 0.4;
    default:
      return 0.1;
  }
}

/**
 * 按耀斑级别取 CME 速度（km/s）：级别越高越快（观测统计趋势）
 */
export function cmeSpeedForClass(flareClass: SolarFlareClass, rand01: number): number {
  const r = Math.min(1, Math.max(0, rand01));
  switch (flareClass) {
    case 'X':
      return 1200 + r * (CME_SPEED_KM_S_MAX - 1200);
    case 'M':
      return 600 + r * 900;
    default:
      return CME_SPEED_KM_S_MIN + r * 450;
  }
}

/**
 * km/s → 场景单位/模拟天（物理速度按场景尺度换算，1 AU = 10 单位）
 */
export function kmPerSecToUnitsPerDay(kmPerSec: number): number {
  if (!(kmPerSec > 0) || !Number.isFinite(kmPerSec)) {
    throw new RangeError(`速度必须为正有限数，收到 ${kmPerSec}`);
  }
  return (kmPerSec * 86400 * SCENE_UNITS_PER_AU) / AU_KM;
}

/**
 * CME 壳层半径（场景单位）：匀速扩张 r = r0 + v·t
 */
export function cmeShellRadiusUnits(
  elapsedDays: number,
  speedUnitsPerDay: number,
  startRadiusUnits: number,
): number {
  if (elapsedDays < 0) return startRadiusUnits;
  return startRadiusUnits + speedUnitsPerDay * elapsedDays;
}

/**
 * CME 事件进度（0-1）：壳层半径相对最大回收半径
 */
export function cmeProgress01(shellRadiusUnits: number, maxRadiusUnits: number = CME_MAX_RADIUS_UNITS): number {
  if (!(maxRadiusUnits > 0)) {
    throw new RangeError(`最大半径必须为正数，收到 ${maxRadiusUnits}`);
  }
  return Math.min(1, Math.max(0, shellRadiusUnits / maxRadiusUnits));
}

/**
 * CME 壳层透明度（0-1）：喷发初期快速浮现，扩张中随进度衰减淡出
 */
export function cmeOpacity01(progress01: number): number {
  const p = Math.min(1, Math.max(0, progress01));
  const appear = Math.min(1, p / 0.04);
  return appear * Math.pow(1 - p, 1.4);
}

/**
 * 是否朝向地球（点积角阈值判定）
 *
 * @param cmeDir CME 抛射方向（单位矢量）
 * @param earthDir 日→地方向（单位矢量）
 */
export function cmeIsEarthDirected(
  cmeDir: { x: number; y: number; z: number },
  earthDir: { x: number; y: number; z: number },
  thresholdDeg: number = CME_EARTH_DIRECTED_DEG,
): boolean {
  const dot = cmeDir.x * earthDir.x + cmeDir.y * earthDir.y + cmeDir.z * earthDir.z;
  return dot >= Math.cos((thresholdDeg * Math.PI) / 180);
}

/**
 * CME 锥内粒子方向（围绕 +Y 轴的确定性分布，渲染端整体旋转到抛射方向）：
 * 极角在 [0, 半张角] 内按面积均匀，方位角低差异分布 + 哈希抖动。
 *
 * @param count 粒子数
 * @param rand 随机数生成器（createSeededRandom 保证确定性）
 */
export function cmeConeDirections(count: number, rand: () => number): Float32Array {
  if (!Number.isInteger(count) || count <= 0) {
    throw new RangeError(`粒子数必须为正整数，收到 ${count}`);
  }
  const out = new Float32Array(count * 3);
  const cosHalf = Math.cos((CME_CONE_HALF_ANGLE_DEG * Math.PI) / 180);
  for (let i = 0; i < count; i += 1) {
    // 球冠面积均匀采样：cosθ ∈ [cosHalf, 1]
    const cosTheta = cosHalf + (1 - cosHalf) * rand();
    const sinTheta = Math.sqrt(Math.max(0, 1 - cosTheta * cosTheta));
    const phi = rand() * Math.PI * 2;
    out[i * 3] = sinTheta * Math.cos(phi);
    out[i * 3 + 1] = cosTheta;
    out[i * 3 + 2] = sinTheta * Math.sin(phi);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 太阳风（solar wind）
// ---------------------------------------------------------------------------

/** 太阳风典型速度（km/s，慢风 ~400 / 快风 ~800，取中值示意） */
export const WIND_SPEED_KM_S = 500;

/** 太阳风粒子数（常驻低密度；与 CME 峰值合计 ≤ 20,000，需求 §5.3） */
export const WIND_PARTICLE_COUNT = 6000;

/** CME 单事件粒子数（环形缓冲复用，事件间不增长） */
export const CME_PARTICLE_COUNT = 9000;

/** 太阳风外边界（场景单位 ≈ 2.4 AU） */
export const WIND_MAX_RADIUS_UNITS = 24;

/**
 * 太阳风单粒子循环周期（模拟天）：外边界距离 / 速度
 */
export function windCycleDays(
  startRadiusUnits: number,
  maxRadiusUnits: number = WIND_MAX_RADIUS_UNITS,
  speedKmS: number = WIND_SPEED_KM_S,
): number {
  if (!(maxRadiusUnits > startRadiusUnits)) {
    throw new RangeError(`外边界必须大于起始半径，收到 ${startRadiusUnits} → ${maxRadiusUnits}`);
  }
  return (maxRadiusUnits - startRadiusUnits) / kmPerSecToUnitsPerDay(speedKmS);
}

/**
 * 太阳风相位（0-1 循环回收，shader 镜像）：fract(t/cycle + seed)
 */
export function windPhase01(simDays: number, seed01: number, cycleDays: number): number {
  if (!(cycleDays > 0)) {
    throw new RangeError(`循环周期必须为正数，收到 ${cycleDays}`);
  }
  const raw = (simDays / cycleDays + seed01) % 1;
  return raw < 0 ? raw + 1 : raw;
}

/**
 * 太阳风 shader 时间回卷（天）：窗口取周期的 2048 倍整数倍——
 * fract((t+W)/cycle) ≡ fract(t/cycle)，回卷零观感差异（精确周期对齐）。
 */
export function windShaderDays(simDays: number, cycleDays: number): number {
  if (!Number.isFinite(simDays)) {
    throw new RangeError(`模拟时间必须为有限数，收到 ${simDays}`);
  }
  if (!(cycleDays > 0)) {
    throw new RangeError(`循环周期必须为正数，收到 ${cycleDays}`);
  }
  const wrap = cycleDays * 2048;
  const wrapped = simDays % wrap;
  return wrapped < 0 ? wrapped + wrap : wrapped;
}

/** 太阳风粒子基础透明度（亮度克制，不喧宾夺主——需求 §4.3-4） */
export const WIND_BASE_ALPHA = 0.16;

/**
 * 太阳风粒子透明度（shader 镜像）：随外流相位衰减 × 近观强度微增
 *
 * @param phase01 外流相位（0 出发 → 1 回收）
 * @param nearStrength01 近观细节强度（L1 更明显，L2 微弱可感知）
 */
export function windParticleAlpha(phase01: number, nearStrength01: number): number {
  const p = Math.min(1, Math.max(0, phase01));
  const s = Math.min(1, Math.max(0, nearStrength01));
  return WIND_BASE_ALPHA * (1 - p) * (0.45 + 0.55 * s);
}

// ---------------------------------------------------------------------------
// 日珥 / 日冕环（prominence / coronal loop）
// ---------------------------------------------------------------------------

/** 常驻日珥数量（少量常驻 + 缓慢演化，需求 §4.3-6） */
export const PROMINENCE_COUNT = 3;

/** 日珥拱顶高度（× 太阳半径，放大登记见文件头） */
export const PROMINENCE_HEIGHT_FRAC = 0.22;

/** 日珥足点跨度（弧度，日面大圆角距） */
export const PROMINENCE_SPAN_RAD = 0.5;

/** 日珥形态缓慢演化周期（模拟天，数天至数月量级取下限便于观察） */
export const PROMINENCE_EVOLVE_DAYS = 9;

/** 日冕环渲染上限（锚定活跃黑子对足点） */
export const CORONAL_LOOP_MAX = 5;

/** 日冕环拱顶高度（× 足点间距） */
export const CORONAL_LOOP_HEIGHT_RATIO = 0.6;

/**
 * 日珥缓慢演化因子（0.75–1.25 高度脉动，模拟时间驱动、暂停冻结）
 */
export function prominenceEvolveFactor(simDays: number, seed01: number): number {
  if (!Number.isFinite(simDays)) {
    throw new RangeError(`模拟时间必须为有限数，收到 ${simDays}`);
  }
  const phase = (simDays / PROMINENCE_EVOLVE_DAYS + seed01 * 7.31) * Math.PI * 2;
  return 1 + 0.25 * Math.sin(phase);
}

/**
 * 日珥/日冕环单位弧线采样点（局部坐标：足点 (±0.5, 0, 0)，拱顶 (0, h, 0)）：
 * 半椭圆参数化，渲染端按足点间距缩放并贴附到日面。
 *
 * @param t01 弧线参数 0-1
 * @param heightRatio 拱顶高度与足点间距之比
 */
export function loopArcPoint(t01: number, heightRatio: number): { x: number; y: number; z: number } {
  const t = Math.min(1, Math.max(0, t01));
  const angle = Math.PI * (1 - t);
  return {
    x: 0.5 * Math.cos(angle),
    y: heightRatio * Math.sin(angle),
    z: 0,
  };
}

// ---------------------------------------------------------------------------
// 信息面板扩展（§4.5：当前活动事件行，供 HudInfo 渲染、可单测）
// ---------------------------------------------------------------------------

/** 与 data/catalog.BodyInfoLine 同构（避免 utils → data 反向依赖） */
export interface ActivityInfoLine {
  label: string;
  value: string;
}

/**
 * 太阳信息面板"当前活动事件"行（§4.5）
 */
export function sunActivityStatusLines(
  flare: { class: SolarFlareClass; magnitude: number } | null,
  cme: { speedKmS: number; earthDirected: boolean } | null,
): ActivityInfoLine[] {
  const lines: ActivityInfoLine[] = [];
  if (flare) {
    lines.push({
      label: '当前耀斑',
      value: `${flare.class}${flare.magnitude.toFixed(1)} 级（磁重联爆发进行中）`,
    });
  }
  if (cme) {
    lines.push({
      label: '当前 CME',
      value: `${Math.round(cme.speedKmS)} km/s${cme.earthDirected ? '，朝向地球（可能引发地磁暴）' : ''}`,
    });
  }
  if (lines.length === 0) {
    lines.push({ label: '当前活动', value: '平静（可在控制面板手动触发演示）' });
  }
  return lines;
}
