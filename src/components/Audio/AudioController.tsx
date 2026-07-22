'use client';

import { useEffect, useRef } from 'react';
import { useSimulationStore } from '@/store';
import type { CrossfadeState } from '@/utils/audioMixer';
import { advanceCrossfade, computeSoundscapeGains, startCrossfade } from '@/utils/audioMixer';
import { AudioEngine } from '@/components/Audio/audioEngine';

/**
 * 音效控制器：
 * - 视角切换时音景交叉淡入淡出（1–3 秒，需求 3.4.2）
 * - 音量/静音跟随全局状态
 * - 加载/初始化失败静默降级
 */
export function AudioController(): null {
  const engineRef = useRef<AudioEngine | null>(null);
  const crossfadeRef = useRef<CrossfadeState>({ from: 'L2', to: 'L2', progress: 1 });

  const audioEnabled = useSimulationStore((s) => s.audioEnabled);
  const viewLevel = useSimulationStore((s) => s.viewLevel);

  // 音效开启时初始化引擎（开关点击即用户手势，满足自动播放策略）
  useEffect(() => {
    if (audioEnabled && !engineRef.current) {
      const engine = new AudioEngine();
      engine.init();
      engineRef.current = engine;
    }
    engineRef.current?.resume();
  }, [audioEnabled]);

  // 视角变化触发交叉淡入淡出
  useEffect(() => {
    crossfadeRef.current = startCrossfade(crossfadeRef.current, viewLevel);
  }, [viewLevel]);

  // 增益更新循环
  useEffect(() => {
    let frameId = 0;
    let lastTime = performance.now();

    const update = (): void => {
      const now = performance.now();
      const delta = (now - lastTime) / 1000;
      lastTime = now;

      crossfadeRef.current = advanceCrossfade(crossfadeRef.current, delta);
      const { audioEnabled: enabled, audioVolume } = useSimulationStore.getState();
      const gains = computeSoundscapeGains(crossfadeRef.current, audioVolume, !enabled);
      engineRef.current?.applyGains(gains, enabled ? 1 : 0);

      frameId = requestAnimationFrame(update);
    };
    frameId = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frameId);
  }, []);

  // 卸载时释放音频资源
  useEffect(() => {
    return () => {
      engineRef.current?.dispose();
      engineRef.current = null;
    };
  }, []);

  return null;
}
