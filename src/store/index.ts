/**
 * 全局状态管理（Zustand）
 *
 * 管理：模拟时间轴、速度控制、视角层级（离散锚点 + 连续缩放层级）、
 * 显示开关、音效设置、选中天体、速率钳制提示
 */

import { create } from 'zustand';
import type {
  CmeEvent,
  SolarFlareClass,
  SolarFlareEvent,
  SupernovaEvent,
  Vec3,
  ViewLevel,
} from '@/types';
import { DEFAULT_ANCHOR_BODY_ID, cycleBodyId, isCycleBody } from '@/utils/bodyCycle';
import {
  SCOPE_DEFAULT_BODY,
  cycleBodyIdInScope,
  isScopeCycleBody,
  scopeForViewLevel,
} from '@/utils/cycleScopes';
import { resolveFocusTarget } from '@/utils/cameraFocus';
import { daysSinceJ2000 } from '@/utils/physics';
import type { GalacticFrameMode } from '@/utils/galacticFrame';
import { continuousLevelForDistance, discreteLevelFromContinuous } from '@/utils/scale';
import { CME_SPEED_KM_S_MAX, CME_SPEED_KM_S_MIN, FLARE_DURATION_DAYS } from '@/utils/solarActivity';
import type { SunCutawayLayerId } from '@/utils/sunCutaway';
import { SN_MAX_REMNANTS, clampSupernovaDuration } from '@/utils/supernova';
import { advanceSimTimeContinuous, clampSpeedMultiplier } from '@/utils/time';
import { MERGE_PREVIEW_DURATION_SEC, mergePreviewSimDays } from '@/utils/universe';

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
  /** 行星速率钳制提示（R2-3 淡出区间"行星运动已减速显示"，与卫星文案区分） */
  planetRateClampNotice: boolean;
  /** 跟随天体 id（相机锁定该天体随其运动，需求 3.2.3；null 为不跟随） */
  followBodyId: string | null;
  /** 飞往目标 id（需求 3.2.3 点选后平滑运镜） */
  flyToBodyId: string | null;
  /** 飞往请求代次（每次请求 +1，供 CameraController 识别新请求） */
  flyToRequestId: number;
  /**
   * L1 行星视角锚定天体（P4，需求 3.2.4）：
   * 进入 L1 时飞往并跟随该天体（默认地球），会话内记忆上次锚定天体
   */
  anchorBodyId: string;
  /**
   * L3 银河系域上次锚定天体（R2-5 §5.1-B：每域独立会话内记忆，
   * 切换视角回来时序列位置恢复；默认人马座 A*）
   */
  galaxyAnchorBodyId: string;
  /** L4 宇宙域上次锚定天体（R2-5 §5.1-B，默认仙女座 M31） */
  universeAnchorBodyId: string;
  /** 真实比例模式（需求 4.1：视觉夸大的真实比例开关，P2） */
  realScaleMode: boolean;
  /**
   * 银河系视角（L3）参考系观察模式（P6，需求 3.1.1）：
   * 'follow' 跟随太阳系（太阳系居原点、银河系相对滑动，现状默认）；
   * 'galactic-center' 银心固定（银心居原点、太阳系标记沿轨道实际移动）。
   * G 键切换，切换时 2 秒平滑过渡。
   */
  galacticFrameMode: GalacticFrameMode;
  /** 当前活跃超新星事件（需求 3.1.5 动态事件；同一时刻至多一个） */
  activeSupernova: SupernovaEvent | null;
  /** 已完成的超新星遗迹（永久保留，FIFO 上限 SN_MAX_REMNANTS） */
  supernovaRemnants: SupernovaEvent[];
  /** 超新星事件通知可见（爆发时 UI 提示 + "飞往观看"按钮） */
  supernovaNoticeVisible: boolean;
  /** 超新星事件累计计数（生成事件 id） */
  supernovaCounter: number;
  /** 当前活跃太阳耀斑事件（S2 §4.3-2；同一时刻至多一个） */
  activeSolarFlare: SolarFlareEvent | null;
  /** 耀斑事件累计计数（生成事件 id） */
  solarFlareCounter: number;
  /** 耀斑事件通知可见（级别 + "飞往观看"按钮） */
  solarFlareNoticeVisible: boolean;
  /** 当前活跃 CME 事件（S2 §4.3-3；粒子缓冲复用，同一时刻至多一个） */
  activeCme: CmeEvent | null;
  /** CME 事件累计计数（生成事件 id） */
  cmeCounter: number;
  /** CME 事件通知可见（朝地球时附加地磁暴科普） */
  cmeNoticeVisible: boolean;
  /**
   * 朝地球 CME 预计抵达地球的模拟时间（S3 §4.3-3；null 为无在途 CME）。
   * 抵达后触发地球极区极光增强示意 + "已抵达"通知。
   */
  cmeArrivalSimDays: number | null;
  /** CME 抵达地球触发极光增强的起始模拟时间（null 为未抵达/无极光） */
  auroraStartedAtSimDays: number | null;
  /** CME 已抵达地球通知可见 */
  cmeArrivalNoticeVisible: boolean;
  /**
   * 点选的太阳表面特征（S3 §4.5：黑子群/日珥单独点选热区科普卡片）；
   * null 为未选。value 由 HudInfo 展示（含"可容纳 N 个地球"动态换算）。
   */
  selectedSolarFeature: {
    kind: 'sunspot' | 'prominence';
    /** 中文标题 */
    titleZh: string;
    /** 科普正文 */
    descZh: string;
    /** "可容纳 N 个地球"（仅黑子，四舍五入整数；日珥为 null） */
    earthCount: number | null;
  } | null;
  /** 太阳内部结构剖面模式（S2 §4.1：1/4 切除视图，与外部活动特效互斥） */
  sunCutawayMode: boolean;
  /** 剖面模式当前点选分层（null 为未选） */
  sunCutawayLayer: SunCutawayLayerId | null;
  /** 性能监控面板显示（FPS/内存，可开关，需求 3.5.2 可选项） */
  showPerformance: boolean;
  /** Bloom 泛光效果开关（P3，需求 4.6：默认开启，低性能设备可关闭） */
  bloomEnabled: boolean;
  /** 银河系—仙女座碰撞合并快进预览进行中（可选需求 3.1.3） */
  mergePreviewActive: boolean;
  /** 合并预览进度（0-1） */
  mergePreviewProgress01: number;
  /** 合并预览起点模拟时间（预览取消/结束后可恢复） */
  mergePreviewReturnSimDays: number | null;

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
  setPlanetRateClampNotice: (active: boolean) => void;
  resetToNow: () => void;
  /** 设置跟随天体（null 取消跟随） */
  setFollowBody: (id: string | null) => void;
  /** 请求飞往天体（平滑运镜，到达后自动进入跟随模式） */
  requestFlyTo: (id: string) => void;
  /**
   * 行星视角天体循环切换（P4，需求 3.2.4）：
   * 沿固定序列切换上一颗（-1）/下一颗（+1），飞往并跟随新天体
   */
  cycleAnchorBody: (direction: 1 | -1) => void;
  /**
   * 通用视角域天体循环切换（R2-5 §5.1-B）：按当前视角域（行星/银河系/
   * 宇宙）沿域序列切换上一个（-1）/下一个（+1）并飞往跟随；行星域行为
   * 与 cycleAnchorBody 一致（不回退）；L3/L4 域未跟随时先飞往记忆天体
   */
  cycleScopeBody: (direction: 1 | -1) => void;
  setRealScaleMode: (enabled: boolean) => void;
  toggleRealScaleMode: () => void;
  setGalacticFrameMode: (mode: GalacticFrameMode) => void;
  toggleGalacticFrameMode: () => void;
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
  /**
   * 触发太阳耀斑（手动演示或泊松自动触发；已有活跃事件时忽略）
   *
   * @param params.flareClass C/M/X 级别
   * @param params.magnitude 级内量级（1.0–9.9）
   * @param params.sourceDir 源活动区方位（单位矢量，黑子群附近）
   * @param params.startedAtSimDays 触发时刻（模拟天）
   * @param params.cmeLinked 是否联动 CME（按级别概率判定后传入）
   * @param params.durationDays 动画时长（模拟天，默认 FLARE_DURATION_DAYS）
   */
  triggerSolarFlare: (params: {
    flareClass: SolarFlareClass;
    magnitude: number;
    sourceDir: Vec3;
    startedAtSimDays: number;
    cmeLinked: boolean;
    durationDays?: number;
  }) => void;
  /** 活跃耀斑动画完成：清除事件（无遗迹） */
  completeSolarFlare: () => void;
  dismissSolarFlareNotice: () => void;
  /**
   * 触发 CME（耀斑联动/独立低概率/手动演示；已有活跃事件时忽略；
   * 速度钳制到 250–3,000 km/s 真实量级）
   */
  triggerCme: (params: {
    direction: Vec3;
    speedKmS: number;
    startedAtSimDays: number;
    earthDirected: boolean;
  }) => void;
  /** 活跃 CME 粒子壳层抵达回收边界：清除事件（粒子缓冲复用） */
  completeCme: () => void;
  dismissCmeNotice: () => void;
  /** 排定朝地球 CME 抵达时间（触发时按传播延迟计算；null 取消） */
  scheduleCmeArrival: (arrivalSimDays: number | null) => void;
  /** CME 抵达地球：触发极光增强 + "已抵达"通知（清除排定的抵达时间） */
  triggerCmeArrival: (atSimDays: number) => void;
  /** 极光增强动画完成：清除极光状态 */
  completeAurora: () => void;
  dismissCmeArrivalNotice: () => void;
  /** 点选太阳表面特征（黑子群/日珥科普卡片；null 关闭） */
  setSelectedSolarFeature: (
    feature: SimulationState['selectedSolarFeature'],
  ) => void;
  /** 剖面模式开关（关闭时同时清除分层选中） */
  setSunCutawayMode: (enabled: boolean) => void;
  /** 剖面分层点选（null 取消选中） */
  setSunCutawayLayer: (layer: SunCutawayLayerId | null) => void;
  setShowPerformance: (show: boolean) => void;
  setBloomEnabled: (enabled: boolean) => void;
  toggleBloom: () => void;
  /**
   * 启动银河系—仙女座碰撞合并快进预览（可选需求 3.1.3）：
   * 模拟时间在 MERGE_PREVIEW_DURATION_SEC 内平滑快进到合并时刻，
   * 并切换到宇宙视角（L4）观看
   */
  startMergePreview: () => void;
  /** 取消/结束合并预览并恢复预览前的模拟时间 */
  restoreFromMergePreview: () => void;
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
  planetRateClampNotice: false,
  followBodyId: null,
  flyToBodyId: null,
  flyToRequestId: 0,
  anchorBodyId: DEFAULT_ANCHOR_BODY_ID,
  galaxyAnchorBodyId: SCOPE_DEFAULT_BODY.galaxy,
  universeAnchorBodyId: SCOPE_DEFAULT_BODY.universe,
  realScaleMode: false,
  galacticFrameMode: 'follow',
  activeSupernova: null,
  supernovaRemnants: [],
  supernovaNoticeVisible: false,
  supernovaCounter: 0,
  activeSolarFlare: null,
  solarFlareCounter: 0,
  solarFlareNoticeVisible: false,
  activeCme: null,
  cmeCounter: 0,
  cmeNoticeVisible: false,
  cmeArrivalSimDays: null,
  auroraStartedAtSimDays: null,
  cmeArrivalNoticeVisible: false,
  selectedSolarFeature: null,
  sunCutawayMode: false,
  sunCutawayLayer: null,
  showPerformance: false,
  bloomEnabled: true,
  mergePreviewActive: false,
  mergePreviewProgress01: 0,
  mergePreviewReturnSimDays: null,

  tick: (realDeltaSeconds) =>
    set((state) => {
      // 合并预览进行中：模拟时间按缓动插值快进到合并时刻（可选需求 3.1.3）
      if (state.mergePreviewActive) {
        if (realDeltaSeconds < 0) {
          throw new RangeError(`时间增量不能为负，收到 ${realDeltaSeconds}`);
        }
        const progress = Math.min(
          1,
          state.mergePreviewProgress01 + realDeltaSeconds / MERGE_PREVIEW_DURATION_SEC,
        );
        return {
          simDays: mergePreviewSimDays(state.mergePreviewReturnSimDays ?? state.simDays, progress),
          mergePreviewProgress01: progress,
          // 到达合并时刻后预览结束（保留 returnSimDays 供恢复）
          mergePreviewActive: progress < 1,
        };
      }
      return {
        simDays: advanceSimTimeContinuous(
          state.simDays,
          realDeltaSeconds,
          state.continuousLevel,
          state.speedMultiplier,
          state.paused,
        ),
      };
    }),

  setPaused: (paused) => set({ paused }),

  togglePaused: () => set((state) => ({ paused: !state.paused })),

  setSpeedMultiplier: (multiplier) => set({ speedMultiplier: clampSpeedMultiplier(multiplier) }),

  setViewLevel: (level) =>
    set((state) => {
      // P4（需求 3.2.4）L1 锚点行为变更：不再飞向固定坐标，
      // 改为飞往并跟随序列当前锚定天体（默认地球，会话内记忆）；
      // 已在 L1 时再次触发同样重新对准锚定天体
      if (level === 'L1') {
        return {
          viewLevel: level,
          continuousLevel: LEVEL_TO_CONTINUOUS[level],
          flyToBodyId: state.anchorBodyId,
          flyToRequestId: state.flyToRequestId + 1,
          followBodyId: state.anchorBodyId,
          // R2-1 §1.1-A：显式锚点切换自动关闭信息面板（清空选中）
          selectedBodyId: null,
          selectedSolarFeature: null,
        };
      }
      // 层级未变且无跟随/飞往时无事可做；跟随远距天体（如哈雷彗星 ~20 AU）
      // 时层级读数可能已是目标层级，此时仍需取消跟随并回到固定锚点（P4 修复）
      if (state.viewLevel === level && !state.followBodyId && !state.flyToBodyId) return state;
      return {
        viewLevel: level,
        continuousLevel: LEVEL_TO_CONTINUOUS[level],
        viewTransitionId: state.viewTransitionId + 1,
        // 锚点切换取消跟随/飞往（相机回到固定锚点，需求 3.2.4：L2-L4 取消跟随）
        followBodyId: null,
        flyToBodyId: null,
        // R2-1 §1.1-A：显式锚点切换（按钮/1-4 快捷键）自动关闭信息面板；
        // 连续滚轮缩放跨层级走 syncZoomLevel/syncCameraDistance，不清空选中
        selectedBodyId: null,
        selectedSolarFeature: null,
      };
    }),

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
  setPlanetRateClampNotice: (active) => set({ planetRateClampNotice: active }),

  resetToNow: () => set({ simDays: initialSimDays() }),

  setFollowBody: (id) => set({ followBodyId: id }),

  requestFlyTo: (id) =>
    set((state) => {
      // R2-1 §1.1-B 兜底：目标解析失败时拒绝进入跟随（不写入 followBodyId，
      // 静默忽略），防止未来新增天体重蹈"无运镜却显示跟随中"的假跟随死锁。
      // 超新星事件（sn-*）由 CameraController 按事件状态单独解析，此处
      // 按事件存在性（活跃事件或遗迹）校验。
      const resolvable = id.startsWith('sn-')
        ? state.activeSupernova?.id === id || state.supernovaRemnants.some((r) => r.id === id)
        : resolveFocusTarget(id, state.simDays, state.realScaleMode) !== null;
      if (!resolvable) return state;
      // R2-5 §5.1-B 各域序列位置记忆：L3/L4 域仅在"该域当前生效"时记录，
      // 防跨域误写（如 L1/L2 耀斑通知"飞往太阳"不得改写银河系域记忆——
      // 太阳虽是 L3 序列出发站，但此时语境是太阳系视角）
      const activeScope = scopeForViewLevel(state.continuousLevel, state.followBodyId);
      return {
        flyToBodyId: id,
        flyToRequestId: state.flyToRequestId + 1,
        // 飞抵后保持锁定该天体（跟随模式），运镜期间同样按目标跟踪
        followBodyId: id,
        // 序列内天体记为 L1 锚定天体（会话内记忆，需求 3.2.4）
        anchorBodyId: isCycleBody(id) ? id : state.anchorBodyId,
        galaxyAnchorBodyId:
          activeScope === 'galaxy' && isScopeCycleBody('galaxy', id)
            ? id
            : state.galaxyAnchorBodyId,
        universeAnchorBodyId:
          activeScope === 'universe' && isScopeCycleBody('universe', id)
            ? id
            : state.universeAnchorBodyId,
      };
    }),

  cycleAnchorBody: (direction) =>
    set((state) => {
      const next = cycleBodyId(state.anchorBodyId, direction);
      return {
        anchorBodyId: next,
        flyToBodyId: next,
        flyToRequestId: state.flyToRequestId + 1,
        followBodyId: next,
      };
    }),

  cycleScopeBody: (direction) =>
    set((state) => {
      const scope = scopeForViewLevel(state.continuousLevel, state.followBodyId);
      if (scope === 'planet') {
        // 行星域：与 cycleAnchorBody 完全一致（P4 现状保持，行为不回退）
        const next = cycleBodyId(state.anchorBodyId, direction);
        return {
          anchorBodyId: next,
          flyToBodyId: next,
          flyToRequestId: state.flyToRequestId + 1,
          followBodyId: next,
        };
      }
      const remembered =
        scope === 'galaxy' ? state.galaxyAnchorBodyId : state.universeAnchorBodyId;
      const followingInScope =
        state.followBodyId !== null && isScopeCycleBody(scope, state.followBodyId);
      // §5.1-B：跟随域内天体时沿序列切换；未跟随时点击即飞往记忆天体
      // （初始为域默认：L3=sgr-a-star / L4=m31），开始游览不产生跳步
      const next = followingInScope
        ? cycleBodyIdInScope(scope, state.followBodyId!, direction)
        : remembered;
      // 与 requestFlyTo 相同的解析兜底（防未来序列成员解析失败进入假跟随）
      if (resolveFocusTarget(next, state.simDays, state.realScaleMode) === null) {
        return state;
      }
      return {
        flyToBodyId: next,
        flyToRequestId: state.flyToRequestId + 1,
        followBodyId: next,
        ...(scope === 'galaxy'
          ? { galaxyAnchorBodyId: next }
          : { universeAnchorBodyId: next }),
      };
    }),

  setRealScaleMode: (enabled) => set({ realScaleMode: enabled }),

  toggleRealScaleMode: () => set((state) => ({ realScaleMode: !state.realScaleMode })),

  setGalacticFrameMode: (mode) => set({ galacticFrameMode: mode }),

  toggleGalacticFrameMode: () =>
    set((state) => ({
      galacticFrameMode: state.galacticFrameMode === 'follow' ? 'galactic-center' : 'follow',
    })),

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

  triggerSolarFlare: (params) =>
    set((state) => {
      // 同一时刻至多一个活跃耀斑（避免动画/音效叠加）
      if (state.activeSolarFlare) return state;
      if (!(params.magnitude > 0) || !Number.isFinite(params.startedAtSimDays)) return state;
      const counter = state.solarFlareCounter + 1;
      const event: SolarFlareEvent = {
        id: `flare-${counter}`,
        flareClass: params.flareClass,
        magnitude: params.magnitude,
        startedAtSimDays: params.startedAtSimDays,
        durationDays: params.durationDays ?? FLARE_DURATION_DAYS,
        sourceDir: params.sourceDir,
        cmeLinked: params.cmeLinked,
      };
      return {
        activeSolarFlare: event,
        solarFlareCounter: counter,
        solarFlareNoticeVisible: true,
      };
    }),

  completeSolarFlare: () =>
    set((state) => {
      if (!state.activeSolarFlare) return state;
      return { activeSolarFlare: null, solarFlareNoticeVisible: false };
    }),

  dismissSolarFlareNotice: () => set({ solarFlareNoticeVisible: false }),

  triggerCme: (params) =>
    set((state) => {
      // 同一时刻至多一个活跃 CME（粒子环形缓冲复用，防内存增长）
      if (state.activeCme) return state;
      if (!Number.isFinite(params.startedAtSimDays)) return state;
      const counter = state.cmeCounter + 1;
      const event: CmeEvent = {
        id: `cme-${counter}`,
        direction: params.direction,
        // 速度钳制到真实观测量级（250–3,000 km/s）
        speedKmS: Math.min(CME_SPEED_KM_S_MAX, Math.max(CME_SPEED_KM_S_MIN, params.speedKmS)),
        startedAtSimDays: params.startedAtSimDays,
        earthDirected: params.earthDirected,
      };
      return { activeCme: event, cmeCounter: counter, cmeNoticeVisible: true };
    }),

  completeCme: () =>
    set((state) => {
      if (!state.activeCme) return state;
      return { activeCme: null, cmeNoticeVisible: false };
    }),

  dismissCmeNotice: () => set({ cmeNoticeVisible: false }),

  scheduleCmeArrival: (arrivalSimDays) => set({ cmeArrivalSimDays: arrivalSimDays }),

  triggerCmeArrival: (atSimDays) =>
    set((state) => {
      if (!Number.isFinite(atSimDays)) return state;
      return {
        cmeArrivalSimDays: null,
        auroraStartedAtSimDays: atSimDays,
        cmeArrivalNoticeVisible: true,
      };
    }),

  completeAurora: () =>
    set((state) => {
      if (state.auroraStartedAtSimDays === null) return state;
      return { auroraStartedAtSimDays: null };
    }),

  dismissCmeArrivalNotice: () => set({ cmeArrivalNoticeVisible: false }),

  setSelectedSolarFeature: (feature) => set({ selectedSolarFeature: feature }),

  setSunCutawayMode: (enabled) =>
    set((state) => {
      if (state.sunCutawayMode === enabled) return state;
      // 关闭时清除分层选中（§4.1 关闭恢复完整球体）
      return enabled
        ? { sunCutawayMode: true }
        : { sunCutawayMode: false, sunCutawayLayer: null };
    }),

  setSunCutawayLayer: (layer) => set({ sunCutawayLayer: layer }),

  setShowPerformance: (show) => set({ showPerformance: show }),

  setBloomEnabled: (enabled) => set({ bloomEnabled: enabled }),

  toggleBloom: () => set((state) => ({ bloomEnabled: !state.bloomEnabled })),

  startMergePreview: () =>
    set((state) => {
      if (state.mergePreviewActive) return state;
      return {
        mergePreviewActive: true,
        mergePreviewProgress01: 0,
        mergePreviewReturnSimDays: state.simDays,
        // 切换到宇宙视角观看（与 setViewLevel 一致的锚点过渡）
        viewLevel: 'L4',
        continuousLevel: LEVEL_TO_CONTINUOUS.L4,
        viewTransitionId: state.viewTransitionId + 1,
        followBodyId: null,
        flyToBodyId: null,
      };
    }),

  restoreFromMergePreview: () =>
    set((state) => {
      if (state.mergePreviewReturnSimDays === null) return state;
      return {
        mergePreviewActive: false,
        mergePreviewProgress01: 0,
        simDays: state.mergePreviewReturnSimDays,
        mergePreviewReturnSimDays: null,
      };
    }),
}));
