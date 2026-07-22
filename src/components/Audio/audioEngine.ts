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
      // 动态压缩器：允许较高的合成增益而不削波爆音
      const compressor = context.createDynamicsCompressor();
      compressor.threshold.value = -18;
      compressor.knee.value = 20;
      compressor.ratio.value = 6;
      compressor.attack.value = 0.01;
      compressor.release.value = 0.3;
      master.connect(compressor);
      compressor.connect(context.destination);
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
   * 超新星爆发音效（需求 3.1.5 音效联动）：低频冲击 + 噪声余响
   *
   * 程序化合成：低频正弦下扫（70→24 Hz）+ 短噪声爆发，
   * 经主压缩器输出防爆音；未初始化时静默降级。
   */
  playSupernovaBurst(volume = 1): void {
    if (!this.context || !this.masterGain) return;
    try {
      const context = this.context;
      const now = context.currentTime;
      const burstGain = context.createGain();
      burstGain.gain.setValueAtTime(0, now);
      burstGain.gain.linearRampToValueAtTime(0.9 * volume, now + 0.08);
      burstGain.gain.exponentialRampToValueAtTime(0.001, now + 4.5);
      burstGain.connect(this.masterGain);

      // 低频冲击：正弦下扫 + 2 倍泛音（小型扬声器可感知）
      for (const ratio of [1, 2]) {
        const osc = context.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(70 * ratio, now);
        osc.frequency.exponentialRampToValueAtTime(24 * ratio, now + 3.5);
        const oscGain = context.createGain();
        oscGain.gain.value = ratio === 1 ? 1 : 0.4;
        osc.connect(oscGain);
        oscGain.connect(burstGain);
        osc.start(now);
        osc.stop(now + 4.6);
      }

      // 噪声爆发余响（低通滤波）
      const noise = context.createBufferSource();
      noise.buffer = this.createNoiseBuffer(context);
      const filter = context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(900, now);
      filter.frequency.exponentialRampToValueAtTime(120, now + 3);
      const noiseGain = context.createGain();
      noiseGain.gain.value = 0.5;
      noise.connect(filter);
      filter.connect(noiseGain);
      noiseGain.connect(burstGain);
      noise.start(now);
      noise.stop(now + 4.6);
    } catch {
      // 静默降级
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

    // 低频振荡（太阳轰鸣/宇宙铺底）：
    // 基频 + 2/4 倍泛音——纯低频正弦（28–55 Hz）在小型扬声器上几乎不可闻，
    // 叠加泛音利用"缺失基频"心理声学效应，让低音在任何设备上都可感知
    const harmonics: Array<{ ratio: number; gain: number }> = [
      { ratio: 1, gain: 1 },
      { ratio: 2, gain: 0.5 },
      { ratio: 4, gain: 0.22 },
    ];
    for (const h of harmonics) {
      const osc = context.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = params.oscillatorFrequency * h.ratio;
      const oscGain = context.createGain();
      oscGain.gain.value = params.oscGain * h.gain;
      osc.connect(oscGain);
      oscGain.connect(levelGain);
      osc.start();
      sources.push(osc);
    }

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
