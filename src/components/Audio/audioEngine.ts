/**
 * 音效播放引擎（Web Audio API 薄封装）
 *
 * 声明：真空中无声音，本系统音效为艺术化设计。
 *
 * P0 阶段无外部音频资产，使用程序化合成（噪声 + 低频振荡 + 滤波）生成
 * 各层级环境音；增益混合逻辑在 utils/audioMixer.ts（纯函数、可测试）。
 *
 * 降级策略（需求 3.4.2）：AudioContext 不可用或初始化失败时静默不报错。
 */

import type { ViewLevel } from '@/types';
import { VIEW_LEVELS } from '@/types';
import { PROCEDURAL_SOUND_PARAMS } from '@/data/sounds';

interface LevelNodes {
  gain: GainNode;
  sources: AudioScheduledSourceNode[];
}

export class AudioEngine {
  private context: AudioContext | null = null;

  private masterGain: GainNode | null = null;

  private levels: Partial<Record<ViewLevel, LevelNodes>> = {};

  /** 是否已成功初始化 */
  get initialized(): boolean {
    return this.context !== null;
  }

  /**
   * 初始化（须由用户手势触发以满足浏览器自动播放策略）
   * 失败时静默降级。
   */
  init(): void {
    if (this.context) return;
    try {
      const Ctor: typeof AudioContext | undefined =
        typeof window !== 'undefined'
          ? window.AudioContext ??
            (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
          : undefined;
      if (!Ctor) return;
      const context = new Ctor();
      const master = context.createGain();
      master.gain.value = 0;
      master.connect(context.destination);
      this.context = context;
      this.masterGain = master;
      for (const level of VIEW_LEVELS) {
        this.levels[level] = this.buildLevelChain(context, master, level);
      }
    } catch {
      // 静默降级：无音效但不影响主功能
      this.context = null;
      this.masterGain = null;
    }
  }

  /**
   * 应用各层级增益（0-1），带短平滑避免爆音
   */
  applyGains(gains: Record<ViewLevel, number>, masterVolume = 1): void {
    if (!this.context || !this.masterGain) return;
    const now = this.context.currentTime;
    this.masterGain.gain.setTargetAtTime(masterVolume, now, 0.05);
    for (const level of VIEW_LEVELS) {
      const nodes = this.levels[level];
      if (nodes) {
        nodes.gain.gain.setTargetAtTime(gains[level], now, 0.1);
      }
    }
  }

  /**
   * 恢复被浏览器挂起的 AudioContext
   */
  resume(): void {
    if (this.context && this.context.state === 'suspended') {
      void this.context.resume().catch(() => undefined);
    }
  }

  /**
   * 释放全部音频资源
   */
  dispose(): void {
    for (const level of VIEW_LEVELS) {
      const nodes = this.levels[level];
      if (nodes) {
        for (const source of nodes.sources) {
          try {
            source.stop();
          } catch {
            // 已停止的源重复 stop 会抛错，忽略
          }
        }
      }
    }
    this.levels = {};
    if (this.context) {
      void this.context.close().catch(() => undefined);
    }
    this.context = null;
    this.masterGain = null;
  }

  private buildLevelChain(
    context: AudioContext,
    destination: GainNode,
    level: ViewLevel,
  ): LevelNodes {
    const params = PROCEDURAL_SOUND_PARAMS[level];
    const levelGain = context.createGain();
    levelGain.gain.value = 0;
    levelGain.connect(destination);

    const sources: AudioScheduledSourceNode[] = [];

    // 噪声源（风声/氛围底噪）→ 低通滤波
    const noiseBuffer = this.createNoiseBuffer(context);
    const noise = context.createBufferSource();
    noise.buffer = noiseBuffer;
    noise.loop = true;
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = params.filterFrequency;
    const noiseGain = context.createGain();
    noiseGain.gain.value = params.noiseGain;
    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(levelGain);
    noise.start();
    sources.push(noise);

    // 低频振荡（太阳轰鸣/宇宙铺底）
    const osc = context.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = params.oscillatorFrequency;
    const oscGain = context.createGain();
    oscGain.gain.value = params.oscGain;
    osc.connect(oscGain);
    oscGain.connect(levelGain);
    osc.start();
    sources.push(osc);

    return { gain: levelGain, sources };
  }

  private createNoiseBuffer(context: AudioContext): AudioBuffer {
    const seconds = 2;
    const buffer = context.createBuffer(1, context.sampleRate * seconds, context.sampleRate);
    const data = buffer.getChannelData(0);
    // 粉噪近似（Paul Kellet 简化法），比白噪更柔和
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    for (let i = 0; i < data.length; i += 1) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + white * 0.099046;
      b1 = 0.963 * b1 + white * 0.2965164;
      b2 = 0.57 * b2 + white * 1.0526913;
      data[i] = (b0 + b1 + b2 + white * 0.1848) * 0.11;
    }
    return buffer;
  }
}
