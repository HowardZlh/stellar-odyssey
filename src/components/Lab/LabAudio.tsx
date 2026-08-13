'use client';

/**
 * 流星雨实验室音频（M4-1，需求 §5）：射电回波可听化 + 火流星静电爆裂。
 *
 * 科学口径红线（§5，UI 侧有双语"可听化 sonification"说明）：真实流星
 * 无声；哨鸣模拟射电前向散射回波（无线电观测手段）、爆裂声对应静电
 * 传声（有争议的罕见现象）——均为观测手段/现象的声音化演绎。
 *
 * 组件分工：
 * - LabAudioBridge（DOM 层）：共享 AudioEngine 单例接入全局 store 的
 *   音效开关（audioEnabled 开 = masterGain 1、关 = 0，masterGain 链
 *   天然承接静音）；主场景四层环境音景增益恒 0（实验室只出事件音）。
 * - LabAudioTrigger（Canvas 内）：useFrame 中经 M1 `ignitedSlots` 纯函数
 *   （契约 C2 CPU 镜像）取本帧点燃槽位，只对可听子集（selectAudibleSlots：
 *   火流星全量 + 普通槽位质量前 25%）触发哨鸣——普通流星密集时静默防
 *   音疲劳；帧上限 AUDIBLE_MAX_PER_FRAME + 真实间隔节流兜底（延时摄影
 *   高倍率）。火流星在碎裂时刻（0.8T，§1.5）追加 crackle；演示注入
 *   （时间轴外，demoRef 变更侦测）同样发声。渲染循环零 buffer 上传、
 *   触发路径零常驻 GC（pending 数组仅火流星点燃时增长）。
 */

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useSimulationStore } from '@/store';
import type { ViewLevel } from '@/types';
import { VIEW_LEVELS } from '@/types';
import { getSharedAudioEngine } from '@/components/Audio/audioEngine';
import {
  AUDIBLE_MAX_PER_FRAME,
  AUDIBLE_MIN_GAP_REAL_SEC,
  EPOCH_LOCAL_HOURS,
  EPOCH_SUN_DECLINATION_DEG,
  FRAGMENT_BREAKUP_PROGRESS,
  fluxFraction,
  horizontalFromEquatorial,
  ignitedSlots,
  localSiderealTime,
  selectAudibleSlots,
  visibleHourlyRate,
  type MeteorSlot,
} from '@/utils/meteorShower';
import { effectiveLimitingMag, labSunAltitudeRad } from '@/utils/labSky';
import type { LabFrameRefs } from '@/components/Lab/labTypes';

/** 主场景四层环境音景在实验室恒 0（实验室只出流星事件音，走 masterGain） */
const ZERO_LEVEL_GAINS: Record<ViewLevel, number> = VIEW_LEVELS.reduce(
  (acc, level) => {
    acc[level] = 0;
    return acc;
  },
  {} as Record<ViewLevel, number>
);

/** 帧间时间跨度上限系数（快进跳变判据：正常帧 delta ≤ 0.1 × timeScale） */
const DISCONTINUITY_FACTOR_SEC = 0.11;

/**
 * 实验室音频桥（DOM 层）：音效开关变更时初始化/恢复共享引擎并应用
 * masterGain（开 = 1、关 = 0；音量在事件触发侧按 audioVolume 取值，
 * 与主场景 playSupernovaBurst 同口径）。开关点击即用户手势，满足
 * 浏览器自动播放策略；卸载时释放（页面级持有，同 AudioController）。
 */
export function LabAudioBridge(): null {
  const audioEnabled = useSimulationStore((s) => s.audioEnabled);

  useEffect(() => {
    const engine = getSharedAudioEngine();
    if (audioEnabled) {
      engine.init();
      void engine.resume();
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

interface LabAudioTriggerProps {
  slots: readonly MeteorSlot[];
  refs: LabFrameRefs;
}

/** 流星点燃 → 音效触发器（Canvas 内；流量链与 MeteorField 每帧同式） */
export function LabAudioTrigger({ slots, refs }: LabAudioTriggerProps): null {
  // 可听子集（火流星全量 + 普通槽位质量前 25%，slots 变更时重建）
  const audible = useMemo(() => selectAudibleSlots(slots), [slots]);
  const prevTimeRef = useRef(refs.timeSecRef.current);
  /** 待触发 crackle 的场景时刻（火流星点燃时压入 点燃 + 0.8T，§1.5） */
  const pendingCracklesRef = useRef<number[]>([]);
  /** 已发声的演示注入时刻（demoRef 变更侦测，避免每帧重复触发） */
  const lastDemoStartRef = useRef<number | null>(null);
  /** 上一次普通流星哨鸣的真实时刻（AUDIBLE_MIN_GAP_REAL_SEC 节流） */
  const lastPingRealSecRef = useRef(-Infinity);

  // 页签切换（slots 重建 + uTime 归零）：镜像时钟与待触发队列同步复位
  useEffect(() => {
    prevTimeRef.current = refs.timeSecRef.current;
    pendingCracklesRef.current = [];
    lastDemoStartRef.current = null;
  }, [slots, refs]);

  useFrame((state) => {
    const prev = prevTimeRef.current;
    const curr = refs.timeSecRef.current;
    prevTimeRef.current = curr;

    const store = useSimulationStore.getState();
    if (!store.audioEnabled) {
      pendingCracklesRef.current.length = 0;
      lastDemoStartRef.current = refs.demoRef.current?.startTimeSec ?? null;
      return;
    }
    const engine = getSharedAudioEngine();
    if (!engine.initialized) return;

    const s = refs.settingsRef.current;
    const shower = refs.showerRef.current;
    const nowRealSec = state.clock.elapsedTime;

    /** 哨鸣 + 火流星 crackle 排程（真实间隔节流：火流星豁免，§5 频度控制） */
    const ping = (slot: MeteorSlot): boolean => {
      if (!slot.isFireball && nowRealSec - lastPingRealSecRef.current < AUDIBLE_MIN_GAP_REAL_SEC) {
        return false;
      }
      engine.playMeteorPing(slot.isFireball, store.audioVolume);
      lastPingRealSecRef.current = nowRealSec;
      return true;
    };

    // 演示注入（时间轴外，方案 B）：demoRef 出现新注入时刻即发声
    const demo = refs.demoRef.current;
    if (demo && demo.startTimeSec !== lastDemoStartRef.current) {
      lastDemoStartRef.current = demo.startTimeSec;
      const slot = slots[demo.slotIndex];
      if (slot) {
        ping(slot);
        if (slot.isFireball) {
          pendingCracklesRef.current.push(
            demo.startTimeSec + FRAGMENT_BREAKUP_PROGRESS * slot.lifetimeSec
          );
        }
      }
    }

    // 真实调度点燃（契约 C2 CPU 镜像）：跳变帧（快进）不回放跨过的点燃
    const maxFrameSpan = DISCONTINUITY_FACTOR_SEC * Math.max(s.timeScale, 1);
    if (curr > prev && curr - prev <= maxFrameSpan) {
      // 流量链（与 MeteorField 每帧严格同式，全部 M1/M3.8 纯函数）
      const lst = localSiderealTime(shower.epochLst0Deg, s.hourOffset, curr / 3600);
      const radiant = horizontalFromEquatorial(
        shower.radiantRaDeg,
        shower.radiantDecDeg,
        s.observerLat,
        lst
      );
      const sunAlt = labSunAltitudeRad(
        EPOCH_LOCAL_HOURS[shower.id],
        EPOCH_SUN_DECLINATION_DEG[shower.id],
        s.hourOffset,
        curr / 3600,
        s.observerLat
      );
      const lmEff = effectiveLimitingMag(s.limitingMag, sunAlt);
      const hr = visibleHourlyRate(shower.zhr, shower.populationIndex, radiant.altRad, lmEff);
      const fluxFrac = fluxFraction(hr, slots.length, shower.cyclePeriodSec);
      const ignited = ignitedSlots(prev, curr, slots, fluxFrac, shower.cyclePeriodSec);
      let fired = 0;
      for (const i of ignited) {
        if (fired >= AUDIBLE_MAX_PER_FRAME) break;
        if (!audible.has(i)) continue; // 普通流星密集时静默（§5 频度控制）
        const slot = slots[i];
        // 火流星双门控镜像（§4.2：shader 中 aFireballRank ≥ uFireballFraction
        // 的火流星槽位整槽剔除，不点燃即不发声）
        if (slot.isFireball && slot.aFireballRank >= s.fireballRate) continue;
        if (!ping(slot)) continue;
        fired += 1;
        if (slot.isFireball) {
          pendingCracklesRef.current.push(curr + FRAGMENT_BREAKUP_PROGRESS * slot.lifetimeSec);
        }
      }
    } else if (curr < prev || curr - prev > maxFrameSpan) {
      // 时间跳变（快进/页签竞态兜底）：丢弃旧队列防"过去的爆裂"补播
      pendingCracklesRef.current.length = 0;
    }

    // 火流星碎裂时刻到达 → crackle（倒序遍历 + splice，无中间数组）
    const pending = pendingCracklesRef.current;
    for (let k = pending.length - 1; k >= 0; k--) {
      if (curr >= pending[k]) {
        engine.playFireballCrackle(store.audioVolume);
        pending.splice(k, 1);
      }
    }
  });

  return null;
}
