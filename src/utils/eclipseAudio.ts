/**
 * 日全食实验室声景纯函数层（E-M6-1，需求 §5）
 *
 * 声景随阶段演变：偏食段环境底噪（白日虫鸟声抽象化）→ C2 前渐弱 →
 * 全食段近乎寂静（只留极低空气感底噪）→ C3 后环境声回归。
 * 钻石环/食既、生光时刻配极轻提示音（sonification 口径，UI 双语注明
 * ——真实日食无声，流星雨 §5 科学口径红线同款）。
 *
 * A8 登记（艺术化）：全食「寂静」为艺术表达而非物理测量——真实现场
 * 环境声（人群/风/动物）因地而异，且日食本身不发声；本包络只承载
 * 「环境骤静」的沉浸叙事。UI 侧 `lab.eclipseAudioNote` 双语注明。
 *
 * 纪律（§7）：不 import React/three；包络由时间轴秒 tSec 单值重建
 * （seek 一致，无帧间累积）；逐帧调用零 GC（out 参复用）。
 * 平滑口径：包络在食时间域上 60s 渐变（导览变速在 C2−90s 起已降至
 * ×1 实时，包络以真实节奏可闻）；真实时钟侧再由 AudioEngine
 * setTargetAtTime（tc 0.25s）短平滑防爆音——合成 1–3s 量级过渡（§5）。
 */

import type { EclipseContacts } from "@/utils/solarEclipseLab";

/** 环境底噪在 C2 前渐弱 / C3 后回归的过渡时长（食时间秒） */
export const AMBIENT_FADE_SEC = 60;

/** 偏食段空气感底噪垫层增益（被环境底噪掩蔽的低垫层） */
export const AIR_BASE_GAIN = 0.03;

/** 全食段空气感底噪目标增益（近寂静而非绝对静音——A8 口径） */
export const AIR_TOTALITY_GAIN = 0.1;

/** 环境底噪层峰值增益（合成层标定值；最终增益 = ambient01 × 峰值 × 音量） */
export const ECLIPSE_AMBIENT_PEAK_GAIN = 0.14;

/**
 * 提示音跨越判据的帧跨度上限（食时间秒）：接触时刻附近导览变速已是
 * ×1 实时（帧步 ≪1s）；scrubber 拖动/页签切换一跳数十分钟——超限
 * 即视为跳变，不补播「跨过的」提示音（LabAudioTrigger 同口径）。
 */
export const CHIME_MAX_FRAME_SPAN_SEC = 30;

/** 声景增益组（逐帧 out 复用零 GC） */
export interface EclipseSoundscapeGains {
  /** 环境底噪归一增益（0–1；偏食段 1 → C2 渐弱至 0 → C3 后回归） */
  ambient01: number;
  /** 空气感底噪归一增益（0–1；全食段升至 AIR_TOTALITY_GAIN 量级） */
  air01: number;
}

/** 空声景增益组（挂载期分配一次） */
export function emptyEclipseSoundscapeGains(): EclipseSoundscapeGains {
  return { ambient01: 1, air01: AIR_BASE_GAIN };
}

/** Hermite 平滑（smoothstep 同式；0–1 钳制） */
function smooth01(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

/**
 * 声景包络（§5）：tSec 单值重建（seek 一致）。
 *
 * - ambient01：[C2−60s, C2] 平滑 1→0，[C2, C3] 恒 0（全食近寂静），
 *   [C3, C3+60s] 平滑 0→1，窗外恒 1（偏食/食外均为白日底噪）；
 * - air01：与 ambient 互补——ambient 弱化多少，空气感垫层就抬升多少
 *   （AIR_BASE → AIR_TOTALITY），保证全食段不是数字绝对静音（A8）。
 *
 * 偏食事件（无全食段）时 contacts.c2 = contacts.c3 = 食甚附近由烘焙
 * 产物保证；本函数只按区间求值，不假设事件类型。
 */
export function eclipseSoundscapeGains(
  tSec: number,
  contacts: EclipseContacts,
  out: EclipseSoundscapeGains,
): EclipseSoundscapeGains {
  let ambient = 1;
  if (tSec >= contacts.c2 && tSec <= contacts.c3) {
    ambient = 0;
  } else if (tSec < contacts.c2) {
    // C2 前渐弱：距 C2 越近越静
    ambient = smooth01((contacts.c2 - tSec) / AMBIENT_FADE_SEC);
  } else {
    // C3 后回归
    ambient = smooth01((tSec - contacts.c3) / AMBIENT_FADE_SEC);
  }
  out.ambient01 = ambient;
  out.air01 =
    AIR_BASE_GAIN + (AIR_TOTALITY_GAIN - AIR_BASE_GAIN) * (1 - ambient);
  return out;
}

/**
 * 提示音触发判据：本帧是否正向跨越接触时刻（食既 C2 / 生光 C3——
 * 钻石环所在时刻）。仅正向播放触发；帧跨度超限（seek/页签切换/
 * 导览快进段）不补播。
 */
export function eclipseChimeCrossing(
  prevSec: number,
  currSec: number,
  contactSec: number,
): boolean {
  if (currSec <= prevSec) return false;
  if (currSec - prevSec > CHIME_MAX_FRAME_SPAN_SEC) return false;
  return prevSec < contactSec && contactSec <= currSec;
}
