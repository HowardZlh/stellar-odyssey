/**
 * 特殊天体动态效果的纯函数（需求 3.1.5）
 *
 * 所有动画驱动逻辑与渲染分离为确定性纯函数，保证可测试性；
 * 渲染组件（components/Scene/SpecialBodies.tsx）仅负责把结果写入 three.js 对象。
 *
 * 艺术化处理登记（需求 4.1）：
 * - 脉动/闪烁/膨胀周期以"真实时间秒"驱动（真实周期为数月至数万年，
 *   按模拟时间驱动在高压缩比下退化为噪声），周期常量为艺术化取值；
 * - 天狼星双星互绕、蟹状脉冲星自转按 3.3 速率钳制策略降速显示。
 */

import type { Vec3 } from '@/types';

/** 红巨星脉动周期（秒，两个不可公度周期叠加 → 半规则变星特征） */
export const RED_GIANT_PERIOD_1_SEC = 11;
export const RED_GIANT_PERIOD_2_SEC = 4.3;

/** 红巨星脉动幅度：尺寸 ±6%，亮度 ±25% */
export const RED_GIANT_SCALE_AMPLITUDE = 0.06;
export const RED_GIANT_BRIGHTNESS_AMPLITUDE = 0.25;

/**
 * 红巨星半规则脉动（原型：参宿四）
 *
 * 两个不可公度周期的正弦叠加产生"缓慢不规则"的脉动效果，
 * 返回尺寸缩放与亮度系数（均以 1 为基准）。
 */
export function redGiantPulsation(tSec: number): { scale: number; brightness: number } {
  const s =
    0.6 * Math.sin((Math.PI * 2 * tSec) / RED_GIANT_PERIOD_1_SEC) +
    0.4 * Math.sin((Math.PI * 2 * tSec) / RED_GIANT_PERIOD_2_SEC + 1.7);
  return {
    scale: 1 + RED_GIANT_SCALE_AMPLITUDE * s,
    brightness: 1 + RED_GIANT_BRIGHTNESS_AMPLITUDE * s,
  };
}

/** 蓝巨星微闪烁幅度（±8%）与频率（Hz 量级艺术化取值） */
export const BLUE_GIANT_FLICKER_AMPLITUDE = 0.08;

/**
 * 蓝巨星高频微闪烁（原型：参宿七）：多频正弦叠加，返回亮度系数（基准 1）
 */
export function blueGiantFlicker(tSec: number): number {
  const s =
    0.5 * Math.sin(Math.PI * 2 * tSec * 2.3) +
    0.3 * Math.sin(Math.PI * 2 * tSec * 5.1 + 0.8) +
    0.2 * Math.sin(Math.PI * 2 * tSec * 9.7 + 2.1);
  return 1 + BLUE_GIANT_FLICKER_AMPLITUDE * s;
}

/**
 * 双星互绕位置（原型：天狼星A/B，需求 3.1.5 白矮星动态）
 *
 * 绕共同质心的圆轨道近似：质量大的 A 星轨道半径小
 * （r_A = sep·m_B/(m_A+m_B)），两星始终位于质心两侧。
 *
 * @param separationUnits 两星间距（场景单位）
 * @param massRatio m_A / m_B（天狼星约 2.06/1.02 ≈ 2.02）
 * @param phaseRad 当前轨道相位（弧度，由调用方按钳制策略推进）
 * @returns 质心坐标系下两星位置（x-z 平面）
 */
export function binaryStarPositions(
  separationUnits: number,
  massRatio: number,
  phaseRad: number,
): { primary: Vec3; secondary: Vec3 } {
  if (separationUnits <= 0) {
    throw new RangeError(`双星间距必须为正数，收到 ${separationUnits}`);
  }
  if (massRatio <= 0) {
    throw new RangeError(`质量比必须为正数，收到 ${massRatio}`);
  }
  const rPrimary = separationUnits / (1 + massRatio);
  const rSecondary = separationUnits - rPrimary;
  return {
    primary: {
      x: rPrimary * Math.cos(phaseRad),
      y: 0,
      z: -rPrimary * Math.sin(phaseRad),
    },
    secondary: {
      x: -rSecondary * Math.cos(phaseRad),
      y: 0,
      z: rSecondary * Math.sin(phaseRad),
    },
  };
}

/**
 * 脉冲星射束当前旋转角（弧度）：匀速自转
 *
 * @param tSec 真实时间（秒）
 * @param periodSec 可视化自转周期（真实 33 ms 降频表现，已登记）
 */
export function pulsarBeamAngle(tSec: number, periodSec: number): number {
  if (periodSec <= 0) {
    throw new RangeError(`自转周期必须为正数，收到 ${periodSec}`);
  }
  return ((Math.PI * 2) / periodSec) * tSec;
}

/** 脉冲锐度指数（越大脉冲越窄） */
export const PULSAR_PULSE_SHARPNESS = 12;

/**
 * 脉冲星脉冲强度（0-1，灯塔效应）
 *
 * 双极射束：每自转一圈两个射束各扫过视线一次 → 每圈两次脉冲。
 * 强度 = |cos(θ)|^sharpness（θ 为射束与视线夹角的等效相位）。
 */
export function pulsarPulseIntensity(tSec: number, periodSec: number): number {
  const angle = pulsarBeamAngle(tSec, periodSec);
  return Math.pow(Math.abs(Math.cos(angle)), PULSAR_PULSE_SHARPNESS);
}

/**
 * 吸积盘开普勒较差旋转角速度（相对值）
 *
 * ω ∝ r^-3/2（开普勒第三定律），归一化使 r=1（外缘）时 ω=1，
 * 内圈角速度大于外圈（需求 3.1.5 黑洞吸积盘）。
 *
 * @param radius01 归一化半径（0 < r ≤ 1）
 */
export function accretionDiskAngularSpeed(radius01: number): number {
  if (radius01 <= 0 || radius01 > 1) {
    throw new RangeError(`归一化半径必须在 (0, 1] 内，收到 ${radius01}`);
  }
  return Math.pow(radius01, -1.5);
}

/**
 * 吸积盘多普勒集束亮度因子（可选需求：接近侧亮、远离侧暗）
 *
 * 相对论集束近似 D³：factor = 1 / (1 − β·cosθ)³，
 * cosθ = 1 时物质朝向观察者（最亮）。
 *
 * @param cosTheta 盘面切向速度与视线夹角余弦（-1 到 1）
 * @param beta v/c（0 ≤ β < 1）
 */
export function dopplerBrightnessFactor(cosTheta: number, beta: number): number {
  if (beta < 0 || beta >= 1) {
    throw new RangeError(`β 必须在 [0, 1) 内，收到 ${beta}`);
  }
  const clamped = Math.min(1, Math.max(-1, cosTheta));
  return 1 / Math.pow(1 - beta * clamped, 3);
}

/**
 * 星云缓慢膨胀缩放（行星状星云等，艺术化加速已登记）
 *
 * 以真实时间驱动的缓慢呼吸式膨胀：1 → 1+amplitude 循环
 * （真实膨胀速度约 20–30 km/s，模拟时间高压缩比下无法逐帧表现）。
 */
export function nebulaExpansionScale(
  tSec: number,
  periodSec = 60,
  amplitude = 0.08,
): number {
  if (periodSec <= 0) {
    throw new RangeError(`膨胀周期必须为正数，收到 ${periodSec}`);
  }
  const phase01 = (tSec / periodSec) % 1;
  const cyclic = phase01 < 0 ? phase01 + 1 : phase01;
  // 平滑循环（sin² 保证首尾连续）
  return 1 + amplitude * Math.sin(Math.PI * cyclic) ** 2;
}

/**
 * 类星体光变闪烁（原型：3C 273）：多周期叠加的不规则光变，返回亮度系数（基准 1）
 */
export function quasarFlicker(tSec: number): number {
  const s =
    0.45 * Math.sin(Math.PI * 2 * tSec * 0.31) +
    0.3 * Math.sin(Math.PI * 2 * tSec * 0.83 + 1.2) +
    0.25 * Math.sin(Math.PI * 2 * tSec * 1.7 + 2.6);
  return 1 + 0.2 * s;
}

/**
 * 喷流流动动画相位（0-1 循环）：贴图/粒子沿喷流方向流动
 */
export function jetFlowPhase01(tSec: number, cyclePerSec = 0.5): number {
  const p = (tSec * cyclePerSec) % 1;
  return p < 0 ? p + 1 : p;
}

// ---------------------------------------------------------------------------
// 可选项扩展（需求 3.1.5 可选特殊天体的动态效果纯函数）
// ---------------------------------------------------------------------------

/** 星风粒子外流循环周期（秒，艺术化取值，已登记） */
export const STELLAR_WIND_CYCLE_SEC = 6;

/**
 * 星风粒子外流相位（0-1，蓝巨星/沃尔夫-拉叶星强星风，可选需求）
 *
 * 每个粒子按各自 seed01 错开相位，沿径向从 0（恒星表面）流动到 1（外缘）
 * 后循环回收。返回值即归一化径向距离。
 *
 * @param seed01 粒子确定性种子（[0,1) 内的初始相位偏移）
 */
export function stellarWindPhase01(
  tSec: number,
  seed01: number,
  cycleSec = STELLAR_WIND_CYCLE_SEC,
): number {
  if (cycleSec <= 0) {
    throw new RangeError(`星风循环周期必须为正数，收到 ${cycleSec}`);
  }
  const p = (tSec / cycleSec + seed01) % 1;
  return p < 0 ? p + 1 : p;
}

/** 造父变星可视化光变周期（秒；造父一真实周期 5.366 天，降频表现已登记） */
export const CEPHEID_VISUAL_PERIOD_SEC = 8;

/** 造父变星光变幅度（±35%，接近造父一 δ Cep 视星等 3.48–4.37 的幅度感受） */
export const CEPHEID_BRIGHTNESS_AMPLITUDE = 0.35;

/** 造父变星光变曲线上升段占比（快速上升、缓慢下降的锯齿形特征） */
export const CEPHEID_RISE_FRACTION = 0.25;

/**
 * 造父变星周期性光变（原型：造父一 δ Cephei，可选需求）
 *
 * 经典造父光变曲线为不对称锯齿形：快速增亮（约 1/4 周期）、
 * 缓慢变暗（约 3/4 周期）。返回亮度系数（基准 1，1±amplitude）。
 */
export function cepheidBrightness(tSec: number, periodSec = CEPHEID_VISUAL_PERIOD_SEC): number {
  if (periodSec <= 0) {
    throw new RangeError(`光变周期必须为正数，收到 ${periodSec}`);
  }
  let phase = (tSec / periodSec) % 1;
  if (phase < 0) phase += 1;
  // 上升段：0 → 1（半余弦平滑）；下降段：1 → 0（半余弦平滑）
  const level01 =
    phase < CEPHEID_RISE_FRACTION
      ? 0.5 - 0.5 * Math.cos((Math.PI * phase) / CEPHEID_RISE_FRACTION)
      : 0.5 +
        0.5 *
          Math.cos(
            (Math.PI * (phase - CEPHEID_RISE_FRACTION)) / (1 - CEPHEID_RISE_FRACTION),
          );
  return 1 - CEPHEID_BRIGHTNESS_AMPLITUDE + 2 * CEPHEID_BRIGHTNESS_AMPLITUDE * level01;
}

/** 伽马射线暴演示循环周期（秒）：每周期一次短暂爆发（示意降频，已登记） */
export const GRB_CYCLE_SEC = 45;

/** 伽马射线暴闪光持续时长（秒，长暴量级艺术化取值） */
export const GRB_FLASH_DURATION_SEC = 3;

/**
 * 伽马射线暴闪光状态（可选需求 3.1.5 河外对象）
 *
 * 每 cycleSec 一次爆发：前 flashSec 内强度从 1 指数衰减到 ~0，其余时间为 0。
 * 真实 GRB 为一次性事件（此处循环重放为演示示意，已登记）。
 *
 * @returns intensity01 当前闪光强度（0-1）；cycleIndex 当前循环序号（确定性变化用）
 */
export function grbFlashState(
  tSec: number,
  cycleSec = GRB_CYCLE_SEC,
  flashSec = GRB_FLASH_DURATION_SEC,
): { intensity01: number; cycleIndex: number } {
  if (cycleSec <= 0 || flashSec <= 0) {
    throw new RangeError(`GRB 周期与时长必须为正数，收到 ${cycleSec}, ${flashSec}`);
  }
  const cycleIndex = Math.floor(tSec / cycleSec);
  let inCycle = tSec % cycleSec;
  if (inCycle < 0) inCycle += cycleSec;
  if (inCycle >= flashSec) {
    return { intensity01: 0, cycleIndex };
  }
  // 快速上升（前 8%）+ 指数衰减（FRED 光变曲线：Fast Rise, Exponential Decay）
  const rise = Math.min(1, inCycle / (flashSec * 0.08));
  const decay = Math.exp((-3 * inCycle) / flashSec);
  return { intensity01: rise * decay, cycleIndex };
}
