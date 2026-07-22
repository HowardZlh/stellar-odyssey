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

import type { Vec3, ViewLevel } from '@/types';
import { VIEW_LEVELS } from '@/types';
import { PROCEDURAL_SOUND_PARAMS } from '@/data/sounds';
import { SPATIAL_SOURCES } from '@/utils/spatialAudio';

interface LevelNodes {
  gain: GainNode;
  sources: AudioScheduledSourceNode[];
}

interface SpatialNodes {
  panner: PannerNode;
  gain: GainNode;
  sources: AudioScheduledSourceNode[];
}

export class AudioEngine {
  private context: AudioContext | null = null;

  private masterGain: GainNode | null = null;

  private levels: Partial<Record<ViewLevel, LevelNodes>> = {};

  private spatial: Map<string, SpatialNodes> = new Map();

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
      // 3D 空间音源（可选需求 3.4.2：PannerNode，靠近太阳/黑洞时增强）
      for (const config of SPATIAL_SOURCES) {
        this.spatial.set(config.id, this.buildSpatialChain(context, master, config));
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
   * 更新空间音源（可选需求 3.4.2 3D 空间音效）
   *
   * @param id 音源 id（utils/spatialAudio.SPATIAL_SOURCES）
   * @param cameraLocalPosition 相机局部坐标系下的音源位置（音频单位；
   *   相机局部系下监听者恒位于原点、面向 -z，无需设置 listener 姿态）
   * @param gain01 层级门控增益（0-1，spatialSourceLevelGain 计算）
   */
  setSpatialSource(id: string, cameraLocalPosition: Vec3, gain01: number): void {
    if (!this.context) return;
    const nodes = this.spatial.get(id);
    if (!nodes) return;
    try {
      const now = this.context.currentTime;
      const clamped = Math.min(1, Math.max(0, gain01));
      nodes.gain.gain.setTargetAtTime(clamped, now, 0.1);
      if (nodes.panner.positionX) {
        nodes.panner.positionX.setTargetAtTime(cameraLocalPosition.x, now, 0.05);
        nodes.panner.positionY.setTargetAtTime(cameraLocalPosition.y, now, 0.05);
        nodes.panner.positionZ.setTargetAtTime(cameraLocalPosition.z, now, 0.05);
      } else {
        // Safari 旧版回退
        nodes.panner.setPosition(
          cameraLocalPosition.x,
          cameraLocalPosition.y,
          cameraLocalPosition.z,
        );
      }
    } catch {
      // 静默降级
    }
  }

  /**
   * UI 操作音效（可选需求 3.4.2）：短促点击音（开关/按钮）
   */
  playUiClick(volume = 1): void {
    this.playBlip([880], 0.05, 0.16 * volume);
  }

  /**
   * 选择天体音效（可选需求 3.4.2）：双音上行提示
   */
  playSelectBlip(volume = 1): void {
    this.playBlip([660, 990], 0.09, 0.2 * volume);
  }

  /**
   * 视角切换音效（可选需求 3.4.2）：滤波噪声下扫"嗖"声
   */
  playViewWhoosh(volume = 1): void {
    if (!this.context || !this.masterGain) return;
    try {
      const context = this.context;
      const now = context.currentTime;
      const noise = context.createBufferSource();
      noise.buffer = this.createNoiseBuffer(context);
      const filter = context.createBiquadFilter();
      filter.type = 'bandpass';
      filter.Q.value = 1.2;
      filter.frequency.setValueAtTime(1800, now);
      filter.frequency.exponentialRampToValueAtTime(220, now + 0.7);
      const gain = context.createGain();
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.35 * volume, now + 0.08);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.8);
      noise.connect(filter);
      filter.connect(gain);
      gain.connect(this.masterGain);
      noise.start(now);
      noise.stop(now + 0.85);
    } catch {
      // 静默降级
    }
  }

  /** 短音序列（UI 音效共用）：正弦短音 + 指数衰减 */
  private playBlip(frequencies: number[], noteSec: number, peakGain: number): void {
    if (!this.context || !this.masterGain) return;
    try {
      const context = this.context;
      let start = context.currentTime;
      for (const freq of frequencies) {
        const osc = context.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = freq;
        const gain = context.createGain();
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(peakGain, start + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.001, start + noteSec);
        osc.connect(gain);
        gain.connect(this.masterGain);
        osc.start(start);
        osc.stop(start + noteSec + 0.02);
        start += noteSec * 0.7;
      }
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
    for (const nodes of this.spatial.values()) {
      for (const source of nodes.sources) {
        try {
          source.stop();
        } catch {
          // 已停止的源重复 stop 会抛错，忽略
        }
      }
    }
    this.spatial.clear();
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

  /**
   * 构建 3D 空间音源链（可选需求 3.4.2）：
   * 振荡器（基频 + 2/4 倍泛音，与 buildLevelChain 同理利用"缺失基频"效应）
   * → 门控增益（初始 0，由 setSpatialSource 按层级窗口调制）
   * → PannerNode（equalpower + inverse 距离模型，靠近时自然增强）
   * → 主增益
   */
  private buildSpatialChain(
    context: AudioContext,
    destination: GainNode,
    config: { oscillatorFrequency: number; baseGain: number },
  ): SpatialNodes {
    const panner = context.createPanner();
    panner.panningModel = 'equalpower';
    panner.distanceModel = 'inverse';
    panner.refDistance = 1;
    panner.connect(destination);

    const gate = context.createGain();
    gate.gain.value = 0;
    gate.connect(panner);

    const sources: AudioScheduledSourceNode[] = [];
    const harmonics: Array<{ ratio: number; gain: number }> = [
      { ratio: 1, gain: 1 },
      { ratio: 2, gain: 0.5 },
      { ratio: 4, gain: 0.22 },
    ];
    for (const h of harmonics) {
      const osc = context.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = config.oscillatorFrequency * h.ratio;
      const oscGain = context.createGain();
      oscGain.gain.value = config.baseGain * h.gain;
      osc.connect(oscGain);
      oscGain.connect(gate);
      osc.start();
      sources.push(osc);
    }

    return { panner, gain: gate, sources };
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

let sharedEngine: AudioEngine | null = null;

/**
 * 共享音效引擎单例：AudioController（音景/UI 音效）与
 * SpatialAudio（Canvas 内 3D 空间音源）共用同一 AudioContext。
 * init() 幂等，由用户手势侧（音效开关）触发初始化。
 */
export function getSharedAudioEngine(): AudioEngine {
  if (!sharedEngine) {
    sharedEngine = new AudioEngine();
  }
  return sharedEngine;
}
