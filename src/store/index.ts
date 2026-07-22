/**
 * 全局状态管理（Zustand）
 *
 * 管理：模拟时间轴、速度控制、视角层级（离散锚点 + 连续缩放层级）、
 * 显示开关、音效设置、选中天体、速率钳制提示
 */

import { create } from 'zustand';
import type { SupernovaEvent, Vec3, ViewLevel } from '@/types';
import { daysSinceJ2000 } from '@/utils/physics';
import { continuousLevelForDistance, discreteLevelFromContinuous } from '@/utils/scale';
import { SN_MAX_REMNANTS, clampSupernovaDuration } from '@/utils/supernova';
import { advanceSimTimeContinuous, clampSpeedMultiplier } from '@/utils/time';

export interface SimulationState {
  /** 模拟时间：J2000 历元起天数（初始为真实当前日期，需求 3.1.1 真实日期模式） */
  simDays: number;
  /** 是否暂停 */
  paused: boolean;
  /** 全局速度倍率 */
  speedMultiplier: number;
  /** 当前视角层级（离散，视角标签与锚点逻辑使用） */
  viewLevel: ViewLevel;
  /** 连续缩放层级 1.0–4.0（需求 3.2.2 遨游模式，驱动 LOD/时间压缩/音景混合） */
  continuousLevel: number;
  /** 相机到场景原点距离（场景单位，尺度标尺 UI 使用） */
  cameraDistanceUnits: number;
  /** 视角切换代次（每次锚点切换 +1，供相机过渡动画识别新目标） */
  viewTransitionId: number;
  /** 轨道线显示 */
  showOrbits: boolean;
  /** 卫星轨道线显示（行星视角下默认显示，需求 3.1.1） */
  showSatelliteOrbits: boolean;
  /** 标签显示 */
  showLabels: boolean;
  /** "You are here" 位置标记显示（需求 3.1.2） */
  showYouAreHere: boolean;
  /** 速度矢量箭头显示（本星系群本动等，需求 3.1.3） */
  showVelocityVectors: boolean;
  /** 音效开关 */
  audioEnabled: boolean;
  /** 音量（0-1） */
  audioVolume: number;
  /** 选中天体 id（null 为未选中） */
  selectedBodyId: string | null;
  /** 速率钳制提示（快周期卫星"运动已减速显示"，需求 3.3） */
  rateClampNotice: boolean;
  /** 跟随天体 id（相机锁定该天体随其运动，需求 3.2.3；null 为不跟随） */
  followBodyId: string | null;
  /** 飞往目标 id（需求 3.2.3 点选后平滑运镜） */
  flyToBodyId: string | null;
  /** 飞往请求代次（每次请求 +1，供 CameraController 识别新请求） */
  flyToRequestId: number;
  /** 真实比例模式（需求 4.1：视觉夸大的真实比例开关，P2） */
  realScaleMode: boolean;
  /** 当前活跃超新星事件（需求 3.1.5 动态事件；同一时刻至多一个） */
  activeSupernova: SupernovaEvent | null;
  /** 已完成的超新星遗迹（永久保留，FIFO 上限 SN_MAX_REMNANTS） */
  supernovaRemnants: SupernovaEvent[];
  /** 超新星事件通知可见（爆发时 UI 提示 + "飞往观看"按钮） */
  supernovaNoticeVisible: boolean;
  /** 超新星事件累计计数（生成事件 id） */
  supernovaCounter: number;

  // actions
  tick: (realDeltaSeconds: number) => void;
  setPaused: (paused: boolean) => void;
  togglePaused: () => void;
  setSpeedMultiplier: (multiplier: number) => void;
  setViewLevel: (level: ViewLevel) => void;
  /** 相机缩放驱动的连续层级同步（不触发锚点过渡动画） */
  syncZoomLevel: (continuousLevel: number) => void;
  /**
   * 相机距离同步（内部换算连续层级，供 CameraController 每帧调用）
   *
   * @param updateViewLevel 是否同步离散层级；锚点过渡动画期间应为 false，
   * 否则相机尚未到达目标时离散层级会被拉回起点导致过渡目标被改写
   */
  syncCameraDistance: (distanceUnits: number, updateViewLevel?: boolean) => void;
  setShowOrbits: (show: boolean) => void;
  setShowSatelliteOrbits: (show: boolean) => void;
  setShowLabels: (show: boolean) => void;
  setShowYouAreHere: (show: boolean) => void;
  setShowVelocityVectors: (show: boolean) => void;
  setAudioEnabled: (enabled: boolean) => void;
  toggleAudio: () => void;
  setAudioVolume: (volume: number) => void;
  selectBody: (id: string | null) => void;
  setRateClampNotice: (active: boolean) => void;
  resetToNow: () => void;
  /** 设置跟随天体（null 取消跟随） */
  setFollowBody: (id: string | null) => void;
  /** 请求飞往天体（平滑运镜，到达后自动进入跟随模式） */
  requestFlyTo: (id: string) => void;
  setRealScaleMode: (enabled: boolean) => void;
  toggleRealScaleMode: () => void;
  /**
   * 触发超新星（手动演示或自动触发；已有活跃事件时忽略）
   *
   * @param positionLy 爆发位置（银心系本地坐标，光年）
   * @param progenitorMassSun 前身星质量（决定遗迹致密天体类型）
   * @param durationSec 动画总时长（钳制到 10–30 秒）
   * @param nowMs 触发时刻（真实毫秒，便于测试注入）
   */
  triggerSupernova: (
    positionLy: Vec3,
    progenitorMassSun: number,
    durationSec?: number,
    nowMs?: number,
  ) => void;
  /** 活跃超新星动画完成：归档为永久遗迹（FIFO 上限） */
  archiveSupernova: () => void;
  dismissSupernovaNotice: () => void;
}

/**
 * 初始模拟时间：真实当前日期（行星初始相位与 J2000 历元数据一致，需求 3.1.1）
 */
export function initialSimDays(now: Date = new Date()): number {
  return daysSinceJ2000(now);
}

const LEVEL_TO_CONTINUOUS: Record<ViewLevel, number> = { L1: 1, L2: 2, L3: 3, L4: 4 };

export const useSimulationStore = create<SimulationState>((set) => ({
  simDays: initialSimDays(),
  paused: false,
  speedMultiplier: 1,
  viewLevel: 'L2',
  continuousLevel: 2,
  cameraDistanceUnits: 100,
  viewTransitionId: 0,
  showOrbits: true,
  showSatelliteOrbits: true,
  showLabels: true,
  showYouAreHere: true,
  showVelocityVectors: true,
  audioEnabled: false,
  audioVolume: 0.8,
  selectedBodyId: null,
  rateClampNotice: false,
  followBodyId: null,
  flyToBodyId: null,
  flyToRequestId: 0,
  realScaleMode: false,
  activeSupernova: null,
  supernovaRemnants: [],
  supernovaNoticeVisible: false,
  supernovaCounter: 0,

  tick: (realDeltaSeconds) =>
    set((state) => ({
      simDays: advanceSimTimeContinuous(
        state.simDays,
        realDeltaSeconds,
        state.continuousLevel,
        state.speedMultiplier,
        state.paused,
      ),
    })),

  setPaused: (paused) => set({ paused }),

  togglePaused: () => set((state) => ({ paused: !state.paused })),

  setSpeedMultiplier: (multiplier) => set({ speedMultiplier: clampSpeedMultiplier(multiplier) }),

  setViewLevel: (level) =>
    set((state) =>
      state.viewLevel === level
        ? state
        : {
            viewLevel: level,
            continuousLevel: LEVEL_TO_CONTINUOUS[level],
            viewTransitionId: state.viewTransitionId + 1,
            // 锚点切换取消跟随/飞往（相机回到固定锚点）
            followBodyId: null,
            flyToBodyId: null,
          },
    ),

  syncZoomLevel: (continuousLevel) =>
    set((state) => {
      const clamped = Math.min(4, Math.max(1, continuousLevel));
      const level = discreteLevelFromContinuous(clamped);
      if (state.continuousLevel === clamped && state.viewLevel === level) {
        return state;
      }
      // 连续缩放不触发锚点过渡动画（viewTransitionId 不变）
      return { continuousLevel: clamped, viewLevel: level };
    }),

  syncCameraDistance: (distanceUnits, updateViewLevel = true) =>
    set((state) => {
      const clamped = Math.min(4, Math.max(1, continuousLevelForDistance(distanceUnits)));
      const level = updateViewLevel ? discreteLevelFromContinuous(clamped) : state.viewLevel;
      if (
        state.cameraDistanceUnits === distanceUnits &&
        state.continuousLevel === clamped &&
        state.viewLevel === level
      ) {
        return state;
      }
      return { cameraDistanceUnits: distanceUnits, continuousLevel: clamped, viewLevel: level };
    }),

  setShowOrbits: (show) => set({ showOrbits: show }),

  setShowSatelliteOrbits: (show) => set({ showSatelliteOrbits: show }),

  setShowLabels: (show) => set({ showLabels: show }),

  setShowYouAreHere: (show) => set({ showYouAreHere: show }),

  setShowVelocityVectors: (show) => set({ showVelocityVectors: show }),

  setAudioEnabled: (enabled) => set({ audioEnabled: enabled }),

  toggleAudio: () => set((state) => ({ audioEnabled: !state.audioEnabled })),

  setAudioVolume: (volume) => set({ audioVolume: Math.min(1, Math.max(0, volume)) }),

  selectBody: (id) => set({ selectedBodyId: id }),

  setRateClampNotice: (active) => set({ rateClampNotice: active }),

  resetToNow: () => set({ simDays: initialSimDays() }),

  setFollowBody: (id) => set({ followBodyId: id }),

  requestFlyTo: (id) =>
    set((state) => ({
      flyToBodyId: id,
      flyToRequestId: state.flyToRequestId + 1,
      // 飞抵后保持锁定该天体（跟随模式），运镜期间同样按目标跟踪
      followBodyId: id,
    })),

  setRealScaleMode: (enabled) => set({ realScaleMode: enabled }),

  toggleRealScaleMode: () => set((state) => ({ realScaleMode: !state.realScaleMode })),

  triggerSupernova: (positionLy, progenitorMassSun, durationSec, nowMs) =>
    set((state) => {
      // 同一时刻至多一个活跃事件（避免动画/音效叠加）
      if (state.activeSupernova) return state;
      if (progenitorMassSun <= 0) return state;
      const counter = state.supernovaCounter + 1;
      const event: SupernovaEvent = {
        id: `sn-${counter}`,
        positionLy,
        startedAtMs: nowMs ?? Date.now(),
        durationSec: clampSupernovaDuration(durationSec ?? Number.NaN),
        progenitorMassSun,
      };
      return {
        activeSupernova: event,
        supernovaCounter: counter,
        supernovaNoticeVisible: true,
      };
    }),

  archiveSupernova: () =>
    set((state) => {
      if (!state.activeSupernova) return state;
      const remnants = [...state.supernovaRemnants, state.activeSupernova];
      // FIFO：超出上限时移除最早的遗迹（环形缓冲思想，防内存增长）
      while (remnants.length > SN_MAX_REMNANTS) {
        remnants.shift();
      }
      return { activeSupernova: null, supernovaRemnants: remnants };
    }),

  dismissSupernovaNotice: () => set({ supernovaNoticeVisible: false }),
}));
