"use client";

/**
 * 月食实验室声景（LE 迭代 M6-1，需求 §5）：夜环境底噪 + 接触点可听化提示音。
 *
 * 科学口径红线（§5，UI 侧 `lab.lunarAudioNote` 双语常显说明）：**真实月食
 * 无声**——夜声底噪随食甚渐深的微妙变化为艺术表达（B15 登记），七接触点
 * 提示音为可听化（sonification）设计。文化卡钟声**不在本组件**（B10：文化
 * 演绎与科学声景分离，由 LunarCultureCard 按钮直接触发引擎单发音）。
 *
 * 组件分工（日食 EclipseAudio / 流星雨 LabAudio 同范式）：
 * - LunarAudioBridge（DOM 层）：共享 AudioEngine 单例接入全局 store 音效
 *   开关（audioEnabled 开 = masterGain 1、关 = 0）；主场景四层环境音景增益
 *   恒 0；开关开启即惰性构建月食夜声景常驻层（开关点击 = 用户手势，满足
 *   自动播放策略）；卸载时释放引擎。
 * - LunarSoundscapeDriver（Canvas 内）：useFrame 读 refs（tSec 单值状态源
 *   → frameRef.umbralMag）经 utils/lunarEclipseAudio 纯函数重建声景包络
 *   （seek 一致、零帧间累积、out 参复用零 GC），逐帧喂给引擎平滑增益；
 *   正向跨越七接触点（按事件 contacts 缺省）触发提示音，帧跨度超限
 *   （seek 拖动/页签切换）不补播。
 */

import { useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useSimulationStore } from "@/store";
import type { ViewLevel } from "@/types";
import { VIEW_LEVELS } from "@/types";
import { getSharedAudioEngine } from "@/components/Audio/audioEngine";
import type { LunarEclipseContacts } from "@/utils/bakedData";
import {
  LUNAR_CHIME_TONE_PARAMS,
  LUNAR_NIGHT_PEAK_GAIN,
  emptyLunarSoundscapeGains,
  lunarContactChimeCrossings,
  lunarSoundscapeGains,
} from "@/utils/lunarEclipseAudio";

/** 主场景四层环境音景在实验室恒 0（LabAudio/EclipseAudio 同口径） */
const ZERO_LEVEL_GAINS: Record<ViewLevel, number> = VIEW_LEVELS.reduce(
  (acc, level) => {
    acc[level] = 0;
    return acc;
  },
  {} as Record<ViewLevel, number>,
);

/**
 * 月食声景桥（DOM 层）：音效开关变更时初始化/恢复共享引擎、应用 masterGain
 * 并构建夜声景层；卸载时释放（页面级持有，同 EclipseAudioBridge）。
 */
export function LunarAudioBridge(): null {
  const audioEnabled = useSimulationStore((s) => s.audioEnabled);

  useEffect(() => {
    const engine = getSharedAudioEngine();
    if (audioEnabled) {
      engine.init();
      void engine.resume();
      engine.ensureLunarSoundscape();
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

/** 驱动器所需的最小 refs 面（结构子集，LunarEclipseLab 的 LunarFrameRefs 满足） */
export interface LunarSoundscapeRefs {
  /** 事件时间轴秒（单值状态源） */
  tSecRef: { current: number };
  /** 当前事件（contacts 消费；页签切换渲染期同步） */
  eventRef: { current: { event: { contacts: LunarEclipseContacts } } };
  /** 帧状态（本影食分——声景包络的唯一驱动量，由 tSec 经契约 C1 求得） */
  frameRef: { current: { umbralMag: number } };
}

/** 声景驱动器（Canvas 内；包络由食分逐帧重建，引擎侧短平滑防爆音） */
export function LunarSoundscapeDriver({
  refs,
}: {
  refs: LunarSoundscapeRefs;
}): null {
  const prevTimeRef = useRef(refs.tSecRef.current);
  /** 包络 out 复用（零 GC） */
  const gainsRef = useRef(emptyLunarSoundscapeGains());

  useFrame(() => {
    const prev = prevTimeRef.current;
    const curr = refs.tSecRef.current;
    prevTimeRef.current = curr;

    const engine = getSharedAudioEngine();
    if (!engine.initialized) return;
    const store = useSimulationStore.getState();
    if (!store.audioEnabled) {
      engine.setLunarSoundscapeGains(0, 0);
      return;
    }

    const gains = lunarSoundscapeGains(
      refs.frameRef.current.umbralMag,
      gainsRef.current,
    );
    const vol = store.audioVolume;
    engine.setLunarSoundscapeGains(
      gains.night01 * LUNAR_NIGHT_PEAK_GAIN * vol,
      gains.air01 * vol,
    );

    // 七接触点可听化提示音（按事件 contacts 缺省——偏食无 U2/U3、
    // 半影食仅 P1/食甚/P4；帧跨度超限的 seek 跳变不补播）
    const contacts = refs.eventRef.current.event.contacts;
    for (const hit of lunarContactChimeCrossings(prev, curr, contacts)) {
      const params = LUNAR_CHIME_TONE_PARAMS[hit.tone];
      engine.playLunarContactChime(
        params.freq,
        params.peak,
        params.decaySec,
        vol,
      );
    }
  });

  return null;
}
