'use client';

import { useEffect, useRef } from 'react';
import { useSimulationStore } from '@/store';
import { computeContinuousSoundscapeGains } from '@/utils/audioMixer';
import { AudioEngine } from '@/components/Audio/audioEngine';

/**
 * 音效控制器：
 * - 连续缩放时音景随尺度实时混合（需求 3.4.2：跟随维度而非仅切换事件）；
 *   离散视角切换由相机 2 秒过渡动画驱动连续层级变化，
 *   自然形成 1–3 秒的交叉淡入淡出，两种模式统一
 * - 音量/静音跟随全局状态
 * - 加载/初始化失败静默降级
 */
export function AudioController(): null {
  const engineRef = useRef<AudioEngine | null>(null);

  const audioEnabled = useSimulationStore((s) => s.audioEnabled);

  // 音效开启时初始化引擎（开关点击即用户手势，满足自动播放策略）
  useEffect(() => {
    if (audioEnabled && !engineRef.current) {
      const engine = new AudioEngine();
      engine.init();
      engineRef.current = engine;
    }
    engineRef.current?.resume();
  }, [audioEnabled]);

  // 增益更新循环：按连续层级实时混合
  useEffect(() => {
    let frameId = 0;

    const update = (): void => {
      const {
        audioEnabled: enabled,
        audioVolume,
        continuousLevel,
      } = useSimulationStore.getState();
      const gains = computeContinuousSoundscapeGains(continuousLevel, audioVolume, !enabled);
      engineRef.current?.applyGains(gains, enabled ? 1 : 0);
      frameId = requestAnimationFrame(update);
    };
    frameId = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frameId);
  }, []);

  // 超新星爆发音效联动（需求 3.1.5）：活跃事件出现时播放低频冲击
  useEffect(() => {
    const unsubscribe = useSimulationStore.subscribe((state, prevState) => {
      if (
        state.activeSupernova &&
        state.activeSupernova.id !== prevState.activeSupernova?.id &&
        state.audioEnabled
      ) {
        engineRef.current?.playSupernovaBurst(state.audioVolume);
      }
    });
    return unsubscribe;
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
