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

/** 程序化合成参数：各层级环境音的滤波中心频率（Hz）与特征 */
export const PROCEDURAL_SOUND_PARAMS: Record<
  ViewLevel,
  { filterFrequency: number; oscillatorFrequency: number; noiseGain: number; oscGain: number }
> = {
  // L1 行星环境音：类风声（带通噪声为主）
  L1: { filterFrequency: 500, oscillatorFrequency: 55, noiseGain: 2.4, oscGain: 0.5 },
  // L2 太阳低频轰鸣：低频振荡为主
  L2: { filterFrequency: 240, oscillatorFrequency: 40, noiseGain: 1.4, oscGain: 1.5 },
  // L3 深空音乐：空灵中频
  L3: { filterFrequency: 300, oscillatorFrequency: 110, noiseGain: 0.9, oscGain: 1.2 },
  // L4 宇宙背景：极低频铺底
  L4: { filterFrequency: 130, oscillatorFrequency: 30, noiseGain: 1.0, oscGain: 1.8 },
};
