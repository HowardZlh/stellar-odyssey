/**
 * 月食实验室声景纯函数层（LE 迭代 M6-1，需求 §5）
 *
 * 月食声景比日食**安静克制**（§5 明写）：全程只有一层夜间环境底噪
 * （虫鸣抽象化）随食甚渐深而**微妙**变化 + 七接触点的可听化提示音；
 * 文化卡钟声不走本层（文化演绎与科学声景分离，B10——由文化卡交互
 * 直接触发引擎单发音，不进包络）。
 *
 * 科学口径红线（§5 / §3.4，UI 侧 `lab.lunarAudioNote` 双语常显）：
 * **真实月食无声**——夜环境底噪与接触点提示音均为可听化（sonification）
 * 设计；「食甚渐深 → 夜声更沉」为艺术表达（B15 登记），无声学实测依据，
 * 因此幅度刻意压在「微妙」量级（夜声层最多衰减 22%，不制造戏剧性骤静
 * ——那是日食全食段的现场事实，月食没有）。
 *
 * 纪律（§7）：不 import React/three；包络由「时间轴秒 tSec 派生的本影
 * 食分」单值重建（seek 一致，无帧间累积）；逐帧调用零 GC（out 参复用）。
 * 平滑口径：包络对食分连续可导（smoothstep），真实时钟侧再由 AudioEngine
 * setTargetAtTime（tc 0.3s）短平滑防爆音——合成 1–3s 量级过渡（§5）。
 */

import type { LunarEclipseContacts } from "@/utils/bakedData";
import type { LunarPhaseKey } from "@/utils/lunarEclipseLab";

/** 夜环境底噪层峰值增益（合成层标定值；最终增益 = night01 × 峰值 × 音量） */
export const LUNAR_NIGHT_PEAK_GAIN = 0.11;

/**
 * 食甚最深处夜声层的残留比例（B15：**微妙**变化的量化上限——
 * 只降 22%，不做日食式「骤静」。§5「比日食安静克制」的实现口径）。
 */
export const LUNAR_NIGHT_DEEP_FACTOR = 0.78;

/** 空气感低频垫层增益·食外基线（全程常驻的极低垫层） */
export const LUNAR_AIR_BASE_GAIN = 0.03;

/** 空气感低频垫层增益·全食最深处（夜色「沉下来」的补偿抬升） */
export const LUNAR_AIR_DEEP_GAIN = 0.085;

/**
 * 提示音跨越判据的帧跨度上限（食时间秒）。
 *
 * 月食加速档为**恒定倍率**（窗口跨度/90s ≈ ×160–250，B1 差异登记 ②），
 * 60 FPS 下帧步 ≈2.7–4.2s、30 FPS 下 ≈5.4–8.3s——30s 上限足以覆盖低帧率
 * 播放；scrubber 一拖数十分钟即超限，视为跳变不补播（日食 M6 同口径）。
 */
export const LUNAR_CHIME_MAX_FRAME_SPAN_SEC = 30;

/** 声景增益组（逐帧 out 复用零 GC） */
export interface LunarSoundscapeGains {
  /** 夜环境底噪归一增益（0–1；食外 1 → 全食最深 LUNAR_NIGHT_DEEP_FACTOR） */
  night01: number;
  /** 空气感低频垫层增益（0–1；与 night01 反向微升） */
  air01: number;
}

/** 空声景增益组（挂载期分配一次） */
export function emptyLunarSoundscapeGains(): LunarSoundscapeGains {
  return { night01: 1, air01: LUNAR_AIR_BASE_GAIN };
}

/** Hermite 平滑（smoothstep 同式；0–1 钳制） */
function smooth01(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

/**
 * 食深归一（0–1）：本影食分 → 声景驱动量。
 *
 * - umbralMag ≤ 0（半影段/食外）→ 0：**半影段声景零变化**
 *   （§1.4 红线 ②「半影变暗肉眼几乎无感」的听觉侧对应——不得为可感知
 *   而在半影段做声音变化）；
 * - 0 → 1（偏食段本影缺口扩大）→ smoothstep 平滑上行；
 * - ≥1（全食段）→ 1（饱和，全食深浅不再改变声景）。
 */
export function lunarEclipseDepth01(umbralMag: number): number {
  if (!Number.isFinite(umbralMag)) return 0;
  return smooth01(umbralMag);
}

/**
 * 声景包络（§5）：由本影食分单值重建（食分本身由 tSec 经契约 C1 纯函数
 * 求得 → seek 一致）。
 *
 * - night01：1 → LUNAR_NIGHT_DEEP_FACTOR 随食深线性插值（微妙，B15）；
 * - air01：LUNAR_AIR_BASE_GAIN → LUNAR_AIR_DEEP_GAIN 同源反向抬升
 *   （夜色沉下来的低频补偿，绝不静音）。
 */
export function lunarSoundscapeGains(
  umbralMag: number,
  out: LunarSoundscapeGains,
): LunarSoundscapeGains {
  const depth = lunarEclipseDepth01(umbralMag);
  out.night01 = 1 - (1 - LUNAR_NIGHT_DEEP_FACTOR) * depth;
  out.air01 =
    LUNAR_AIR_BASE_GAIN + (LUNAR_AIR_DEEP_GAIN - LUNAR_AIR_BASE_GAIN) * depth;
  return out;
}

/**
 * 单接触点跨越判据：本帧是否正向跨越该时刻。仅正向播放触发；
 * 帧跨度超限（seek 跳变/页签切换）不补播（日食 M6 同口径）。
 */
export function lunarChimeCrossing(
  prevSec: number,
  currSec: number,
  contactSec: number,
): boolean {
  if (currSec <= prevSec) return false;
  if (currSec - prevSec > LUNAR_CHIME_MAX_FRAME_SPAN_SEC) return false;
  return prevSec < contactSec && contactSec <= currSec;
}

/**
 * 接触点音色分组（可听化设计口径）：
 * - 'umbral'：U1/U2/U3/U4——本影接触，「咬入/吞没/复出/离开」的实质节点，
 *   稍亮稍长；
 * - 'penumbral'：P1/P4——半影接触，肉眼几乎无感（§1.4），提示音相应最轻；
 * - 'max'：食甚，中间档（单音标记最深时刻）。
 */
export type LunarChimeTone = "penumbral" | "umbral" | "max";

/** 七接触点定义序（key → contacts 字段 → 音色分组；缺省锚点自动跳过） */
const LUNAR_CHIME_DEFS: ReadonlyArray<{
  key: LunarPhaseKey;
  tone: LunarChimeTone;
  pick: (c: LunarEclipseContacts) => number | null;
}> = [
  { key: "p1", tone: "penumbral", pick: (c) => c.p1 },
  { key: "u1", tone: "umbral", pick: (c) => c.u1 },
  { key: "u2", tone: "umbral", pick: (c) => c.u2 },
  { key: "max", tone: "max", pick: (c) => c.max },
  { key: "u3", tone: "umbral", pick: (c) => c.u3 },
  { key: "u4", tone: "umbral", pick: (c) => c.u4 },
  { key: "p4", tone: "penumbral", pick: (c) => c.p4 },
];

/** 本帧跨越的接触点（按定义序；缺省锚点——偏食无 U2/U3、半影食仅 P1/max/P4——天然跳过） */
export function lunarContactChimeCrossings(
  prevSec: number,
  currSec: number,
  contacts: LunarEclipseContacts,
): Array<{ key: LunarPhaseKey; tone: LunarChimeTone }> {
  const out: Array<{ key: LunarPhaseKey; tone: LunarChimeTone }> = [];
  for (const def of LUNAR_CHIME_DEFS) {
    const t = def.pick(contacts);
    if (t === null) continue;
    if (lunarChimeCrossing(prevSec, currSec, t)) {
      out.push({ key: def.key, tone: def.tone });
    }
  }
  return out;
}

/** 音色分组 → 合成参数（基频 Hz / 峰值增益 / 衰减秒；引擎侧消费） */
export const LUNAR_CHIME_TONE_PARAMS: Readonly<
  Record<LunarChimeTone, { freq: number; peak: number; decaySec: number }>
> = {
  // 半影接触：最轻（对应「肉眼几乎无感」）
  penumbral: { freq: 523.25, peak: 0.05, decaySec: 1.6 },
  // 本影接触：稍亮稍长
  umbral: { freq: 659.25, peak: 0.11, decaySec: 2.6 },
  // 食甚：中间档
  max: { freq: 587.33, peak: 0.08, decaySec: 2.2 },
};
