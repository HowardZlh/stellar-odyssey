/**
 * 分级音景定义（需求 3.4.1 视角—音景映射）
 *
 * 声明：真空中无声音，音效为艺术化设计。
 * P0 阶段无外部音频资产，播放引擎使用 Web Audio 程序化合成环境音；
 * src 预留给后续替换为真实音频文件（OGG/MP3，≤50MB，≥128kbps），
 * 加载失败时静默降级（需求 3.4.2）。
 */

import type { SoundscapeConfig, ViewLevel } from '@/types';

export const SOUNDSCAPES: Record<ViewLevel, SoundscapeConfig> = {
  L1: {
    level: 'L1',
    nameZh: '行星环境音',
    src: '/sounds/planet-ambience.ogg',
    baseVolume: 0.7,
  },
  L2: {
    level: 'L2',
    nameZh: '太空氛围音 + 太阳低频轰鸣',
    src: '/sounds/solar-system-ambience.ogg',
    baseVolume: 0.6,
  },
  L3: {
    level: 'L3',
    nameZh: '深空音乐',
    src: '/sounds/galaxy-ambience.ogg',
    baseVolume: 0.5,
  },
  L4: {
    level: 'L4',
    nameZh: '宏大宇宙背景音',
    src: '/sounds/universe-ambience.ogg',
    baseVolume: 0.5,
  },
};

/** 程序化环境音合成参数（滤波频率 Hz / 振荡基频 Hz / 噪声与振荡增益） */
export interface ProceduralSoundParams {
  filterFrequency: number;
  oscillatorFrequency: number;
  noiseGain: number;
  oscGain: number;
}

/** 程序化合成参数：各层级环境音的滤波中心频率（Hz）与特征 */
export const PROCEDURAL_SOUND_PARAMS: Record<ViewLevel, ProceduralSoundParams> = {
  // L1 行星环境音：类风声（带通噪声为主）——地球基准（见 PLANET_SOUND_PARAMS）
  L1: { filterFrequency: 500, oscillatorFrequency: 55, noiseGain: 2.4, oscGain: 0.5 },
  // L2 太阳低频轰鸣：低频振荡为主
  L2: { filterFrequency: 240, oscillatorFrequency: 40, noiseGain: 1.4, oscGain: 1.5 },
  // L3 深空音乐：空灵中频
  L3: { filterFrequency: 300, oscillatorFrequency: 110, noiseGain: 0.9, oscGain: 1.2 },
  // L4 宇宙背景：极低频铺底
  L4: { filterFrequency: 130, oscillatorFrequency: 30, noiseGain: 1.0, oscGain: 1.8 },
};

/** 行星差异化音景参数（含大气特征说明） */
export interface PlanetSoundParams extends ProceduralSoundParams {
  /** 大气特征与音景设计说明（科学依据登记） */
  noteZh: string;
}

/**
 * L1 行星差异化音景（P3-6，需求 §3.4.1 登记差异消除）
 *
 * 声明：真空中无声音，行星环境音为按各行星大气特征参数化的艺术化设计。
 * 参数依据（登记）：
 * - 水星：无大气（仅极稀薄外逸层）→ 近乎静音的极小残响
 * - 金星：92 bar 浓密 CO₂ 大气 → 低频沉闷轰鸣（滤波频率最低、噪声最强）
 * - 地球：现状基准（与 PROCEDURAL_SOUND_PARAMS.L1 一致）
 * - 火星：气压不足地球 1% 的稀薄大气 → 高频微弱风声（滤波频率高、增益小）
 * - 木星/土星/天王星/海王星：气态/冰巨行星深厚大气 → 深沉低频轰鸣
 */
export const PLANET_SOUND_PARAMS: Readonly<Record<string, PlanetSoundParams>> = {
  mercury: {
    filterFrequency: 900,
    oscillatorFrequency: 66,
    noiseGain: 0.06,
    oscGain: 0.03,
    noteZh: '水星近真空（仅极稀薄外逸层），几乎静音——仅保留极小艺术化残响',
  },
  venus: {
    filterFrequency: 170,
    oscillatorFrequency: 36,
    noiseGain: 3.0,
    oscGain: 1.3,
    noteZh: '金星 92 bar 浓密 CO₂ 大气，低频沉闷轰鸣',
  },
  earth: {
    filterFrequency: 500,
    oscillatorFrequency: 55,
    noiseGain: 2.4,
    oscGain: 0.5,
    noteZh: '地球大气基准风声（现状 L1 音景）',
  },
  mars: {
    filterFrequency: 1500,
    oscillatorFrequency: 95,
    noiseGain: 0.7,
    oscGain: 0.12,
    noteZh: '火星大气稀薄（不足地球 1% 气压），高频微弱风声',
  },
  jupiter: {
    filterFrequency: 140,
    oscillatorFrequency: 28,
    noiseGain: 2.7,
    oscGain: 2.3,
    noteZh: '木星深厚氢氦大气，深沉低频轰鸣',
  },
  saturn: {
    filterFrequency: 160,
    oscillatorFrequency: 32,
    noiseGain: 2.5,
    oscGain: 2.0,
    noteZh: '土星气态巨行星大气，深沉轰鸣（略高于木星）',
  },
  uranus: {
    filterFrequency: 200,
    oscillatorFrequency: 40,
    noiseGain: 2.1,
    oscGain: 1.6,
    noteZh: '天王星冰巨行星大气，低频轰鸣偏冷色',
  },
  neptune: {
    filterFrequency: 180,
    oscillatorFrequency: 36,
    noiseGain: 2.3,
    oscGain: 1.8,
    noteZh: '海王星冰巨行星大气（太阳系最强风速），低频轰鸣',
  },
};

/**
 * 查询行星音景参数：未定义差异化音景的天体（卫星/矮行星等）
 * 返回 null（调用方回退地球基准）。
 */
export function planetSoundParams(bodyId: string | null): PlanetSoundParams | null {
  if (!bodyId) return null;
  return PLANET_SOUND_PARAMS[bodyId] ?? null;
}
