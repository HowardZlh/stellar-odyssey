"use client";

/**
 * 日全食实验室声景（E-M6-1，需求 §5）：阶段化环境声景 + 接触时刻提示音。
 *
 * 科学口径红线（§5，UI 侧 `lab.eclipseAudioNote` 双语常显说明）：真实
 * 日食无声——环境底噪渐弱与全食段「近乎寂静」为艺术表达（A8 登记），
 * 食既/生光提示音为可听化（sonification）设计。
 *
 * 组件分工（LabAudio 流星雨范式）：
 * - EclipseAudioBridge（DOM 层）：共享 AudioEngine 单例接入全局 store
 *   音效开关（audioEnabled 开 = masterGain 1、关 = 0）；主场景四层环境
 *   音景增益恒 0；开关开启即惰性构建日食声景常驻层（开关点击 = 用户
 *   手势，满足自动播放策略）；卸载时释放引擎。
 * - EclipseSoundscapeDriver（Canvas 内）：useFrame 读 refs（tSec 单值
 *   状态源）经 utils/eclipseAudio 纯函数重建声景包络（seek 一致、零
 *   帧间累积、out 参复用零 GC），逐帧喂给引擎平滑增益；正向跨越
 *   C2/C3（钻石环时刻）触发提示音，帧跨度超限（seek/快进）不补播。
 */

import { useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useSimulationStore } from "@/store";
import type { ViewLevel } from "@/types";
import { VIEW_LEVELS } from "@/types";
import { getSharedAudioEngine } from "@/components/Audio/audioEngine";
import {
  ECLIPSE_AMBIENT_PEAK_GAIN,
  eclipseChimeCrossing,
  eclipseSoundscapeGains,
  emptyEclipseSoundscapeGains,
} from "@/utils/eclipseAudio";
import type { EclipseContacts } from "@/utils/solarEclipseLab";

/** 主场景四层环境音景在实验室恒 0（LabAudio 同口径；日食只出声景/提示音） */
const ZERO_LEVEL_GAINS: Record<ViewLevel, number> = VIEW_LEVELS.reduce(
  (acc, level) => {
    acc[level] = 0;
    return acc;
  },
  {} as Record<ViewLevel, number>,
);

/**
 * 日食声景桥（DOM 层）：音效开关变更时初始化/恢复共享引擎、应用
 * masterGain 并构建声景层；卸载时释放（页面级持有，同 LabAudioBridge）。
 */
export function EclipseAudioBridge(): null {
  const audioEnabled = useSimulationStore((s) => s.audioEnabled);

  useEffect(() => {
    const engine = getSharedAudioEngine();
    if (audioEnabled) {
      engine.init();
      void engine.resume();
      engine.ensureEclipseSoundscape();
    }
    if (engine.initialized) {
      engine.applyGains(ZERO_LEVEL_GAINS, audioEnabled ? 1 : 0);
    }
  }, [audioEnabled]);

  useEffect(() => {
    return () => {
      getSharedAudioEngine().dispose();
    };
  }, []);

  return null;
}

/** 驱动器所需的最小 refs 面（结构子集，SolarEclipseLab 的 EclipseFrameRefs 满足） */
export interface EclipseSoundscapeRefs {
  /** 事件时间轴秒（单值状态源） */
  tSecRef: { current: number };
  /** 当前事件（contacts 消费；页签切换渲染期同步） */
  eventRef: { current: { event: { contacts: EclipseContacts } } };
  /** M3 控件状态（假想模式时提示音静默——时间轴互斥语义） */
  settingsRef: { current: { hypoActive: boolean } };
}

/** 声景驱动器（Canvas 内；包络由 tSec 逐帧重建，引擎侧短平滑防爆音） */
export function EclipseSoundscapeDriver({
  refs,
}: {
  refs: EclipseSoundscapeRefs;
}): null {
  const prevTimeRef = useRef(refs.tSecRef.current);
  /** 包络 out 复用（零 GC） */
  const gainsRef = useRef(emptyEclipseSoundscapeGains());

  useFrame(() => {
    const prev = prevTimeRef.current;
    const curr = refs.tSecRef.current;
    prevTimeRef.current = curr;

    const engine = getSharedAudioEngine();
    if (!engine.initialized) return;
    const store = useSimulationStore.getState();
    if (!store.audioEnabled) {
      engine.setEclipseSoundscapeGains(0, 0);
      return;
    }

    const contacts = refs.eventRef.current.event.contacts;
    const gains = eclipseSoundscapeGains(curr, contacts, gainsRef.current);
    const vol = store.audioVolume;
    engine.setEclipseSoundscapeGains(
      gains.ambient01 * ECLIPSE_AMBIENT_PEAK_GAIN * vol,
      gains.air01 * vol,
    );

    // 食既/生光提示音（钻石环时刻 sonification）：假想模式静默（§3.3
    // 与真实时间轴互斥——contacts 属真实事件语义）
    if (!refs.settingsRef.current.hypoActive) {
      if (eclipseChimeCrossing(prev, curr, contacts.c2))
        engine.playEclipseChime(vol);
      if (eclipseChimeCrossing(prev, curr, contacts.c3))
        engine.playEclipseChime(vol);
    }
  });

  return null;
}
