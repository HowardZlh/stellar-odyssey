'use client';

import { useEffect, useRef } from 'react';
import { useSimulationStore } from '@/store';
import { PROCEDURAL_SOUND_PARAMS, planetSoundParams } from '@/data/sounds';
import type { PlanetAmbienceTransition, SoundParams } from '@/utils/audioMixer';
import {
  advancePlanetAmbienceTransition,
  computeContinuousSoundscapeGains,
  mixSoundParams,
  startPlanetAmbienceTransition,
} from '@/utils/audioMixer';
import { getSharedAudioEngine } from '@/components/Audio/audioEngine';

/** 行星音景参数解析：null（未跟随/无差异化定义）回退地球基准（L1 现状） */
function ambienceParamsFor(bodyId: string | null): SoundParams {
  return planetSoundParams(bodyId) ?? PROCEDURAL_SOUND_PARAMS.L1;
}

/** UI 布尔开关键（翻转时播放点击音，可选需求 3.4.2 操作音效） */
const UI_TOGGLE_KEYS = [
  'paused',
  'showOrbits',
  'showLabels',
  'showSatelliteOrbits',
  'showYouAreHere',
  'showVelocityVectors',
  'realScaleMode',
  'showPerformance',
  'bloomEnabled',
  'sunCutawayMode',
] as const;

/**
 * 音效控制器：
 * - 连续缩放时音景随尺度实时混合（需求 3.4.2：跟随维度而非仅切换事件）；
 *   离散视角切换由相机 2 秒过渡动画驱动连续层级变化，
 *   自然形成 1–3 秒的交叉淡入淡出，两种模式统一
 * - UI 操作音效（可选需求 3.4.2）：选择天体/视角切换/开关翻转
 * - 音量/静音跟随全局状态
 * - 加载/初始化失败静默降级
 *
 * 引擎为共享单例（getSharedAudioEngine），与 Canvas 内的
 * SpatialAudio（3D 空间音源）共用同一 AudioContext。
 */
export function AudioController(): null {
  const audioEnabled = useSimulationStore((s) => s.audioEnabled);
  // 行星差异化音景过渡状态（P3-6）：纯逻辑推进见 utils/audioMixer.ts
  const ambienceRef = useRef<PlanetAmbienceTransition>({ fromId: null, toId: null, progress: 1 });
  const lastFrameMsRef = useRef<number | null>(null);

  // 音效开启时初始化引擎（开关点击即用户手势，满足自动播放策略）
  useEffect(() => {
    const engine = getSharedAudioEngine();
    if (audioEnabled) {
      engine.init();
      engine.resume();
    }
  }, [audioEnabled]);

  // 增益更新循环：按连续层级实时混合 + L1 行星差异化音景过渡（P3-6）
  useEffect(() => {
    let frameId = 0;

    const update = (timestampMs: number): void => {
      const state = useSimulationStore.getState();
      const { audioEnabled: enabled, audioVolume, continuousLevel } = state;
      const gains = computeContinuousSoundscapeGains(continuousLevel, audioVolume, !enabled);
      const engine = getSharedAudioEngine();
      if (engine.initialized) {
        engine.applyGains(gains, enabled ? 1 : 0);

        // 行星音景（需求 3.4.1）：L1 且跟随/聚焦某行星时切到该行星参数，
        // 1–3 秒平滑过渡（mixSoundParams 频率对数插值 + 增益线性插值）
        const deltaSec =
          lastFrameMsRef.current === null
            ? 0
            : Math.max(0, (timestampMs - lastFrameMsRef.current) / 1000);
        const focusId = state.followBodyId ?? state.selectedBodyId;
        const targetId =
          state.viewLevel === 'L1' && planetSoundParams(focusId) ? focusId : null;
        ambienceRef.current = advancePlanetAmbienceTransition(
          startPlanetAmbienceTransition(ambienceRef.current, targetId),
          deltaSec,
        );
        const transition = ambienceRef.current;
        engine.setPlanetAmbience(
          mixSoundParams(
            ambienceParamsFor(transition.fromId),
            ambienceParamsFor(transition.toId),
            transition.progress,
          ),
        );
      }
      lastFrameMsRef.current = timestampMs;
      frameId = requestAnimationFrame(update);
    };
    frameId = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frameId);
  }, []);

  // 事件音效联动：超新星爆发 + UI 操作音（选择/视角切换/开关翻转）
  useEffect(() => {
    const unsubscribe = useSimulationStore.subscribe((state, prevState) => {
      if (!state.audioEnabled) return;
      const engine = getSharedAudioEngine();
      if (!engine.initialized) return;

      // 超新星爆发（需求 3.1.5 音效联动）：低频冲击
      if (state.activeSupernova && state.activeSupernova.id !== prevState.activeSupernova?.id) {
        engine.playSupernovaBurst(state.audioVolume);
      }
      // 太阳耀斑爆发（S2 §4.6）：短促低频冲击
      if (
        state.activeSolarFlare &&
        state.activeSolarFlare.id !== prevState.activeSolarFlare?.id
      ) {
        engine.playFlareBurst(state.audioVolume);
      }
      // CME（S2 §4.6）：更长的低频涌动（1–3 秒平滑起落）
      if (state.activeCme && state.activeCme.id !== prevState.activeCme?.id) {
        engine.playCmeSurge(state.audioVolume);
      }
      // 选择天体：双音上行提示
      if (state.selectedBodyId !== null && state.selectedBodyId !== prevState.selectedBodyId) {
        engine.playSelectBlip(state.audioVolume);
      }
      // 视角切换：噪声下扫"嗖"声
      if (state.viewTransitionId !== prevState.viewTransitionId) {
        engine.playViewWhoosh(state.audioVolume);
      }
      // 布尔开关翻转：短促点击音
      for (const key of UI_TOGGLE_KEYS) {
        if (state[key] !== prevState[key]) {
          engine.playUiClick(state.audioVolume);
          break;
        }
      }
    });
    return unsubscribe;
  }, []);

  // 卸载时释放音频资源（共享单例由页面级组件持有，卸载即整页退出）
  useEffect(() => {
    return () => {
      getSharedAudioEngine().dispose();
    };
  }, []);

  return null;
}
