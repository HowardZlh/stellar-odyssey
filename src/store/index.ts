/**
 * 全局状态管理（Zustand）
 *
 * 管理：模拟时间轴、速度控制、视角层级（离散锚点 + 连续缩放层级）、
 * 显示开关、音效设置、选中天体、速率钳制提示
 */

import { create } from 'zustand';
import type {
  CmeEvent,
  CmeNoticeInfo,
  SolarFlareClass,
  SolarFlareEvent,
  SolarFlareNoticeInfo,
  SupernovaEvent,
  Vec3,
  ViewLevel,
} from '@/types';
import { DEFAULT_ANCHOR_BODY_ID, isCycleBody, planetSystemIdForBody } from '@/utils/bodyCycle';
import {
  GALAXY_CYCLE_SEQUENCE,
  SCOPE_DEFAULT_BODY,
  SCOPE_HOME_LEVEL,
  UNIVERSE_CYCLE_SEQUENCE,
  cycleBodyIdInScope,
  isScopeCycleBody,
  scopeForFocusBody,
  scopeForLevel,
} from '@/utils/cycleScopes';
import type { CycleScope } from '@/utils/cycleScopes';
import { resolveFocusTarget } from '@/utils/cameraFocus';
import {
  FLY_TO_DISCARD_EXEMPT_SEC,
  VIEW_TRANSITION_DISCARD_EXEMPT_SEC,
  eventDiscardDue,
  eventInScope,
  noticeAgeUpdate,
  noticeAutoHideDue,
  outOfScopeElapsedUpdate,
} from '@/utils/eventScopes';
import { daysSinceJ2000 } from '@/utils/physics';
import type { GalacticFrameMode } from '@/utils/galacticFrame';
import { GALAXY_EXPAND_GAIN_DEFAULT, clampExpandGain } from '@/utils/galacticLatitude';
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
  /**
   * 当前生效的视角巡游域（R3 显式状态）：行星系统（L1）/太阳系（L2）/
   * 银河系（L3）/宇宙（L4）。锚点切换与自由缩放跨级时随离散层级同步；
   * 跟随/飞往巡游天体期间保持不变（配合层级锁定，序列不跨域漂移）。
   */
  cycleScope: CycleScope;
  /** 真实比例模式（需求 4.1：视觉夸大的真实比例开关，P2） */
  realScaleMode: boolean;
  /**
   * 银河系视角（L3）参考系观察模式（P6，需求 3.1.1）：
   * 'follow' 跟随太阳系（太阳系居原点、银河系相对滑动，现状默认）；
   * 'galactic-center' 银心固定（银心居原点、太阳系标记沿轨道实际移动）。
   * G 键切换，切换时 2 秒平滑过渡。
   */
  galacticFrameMode: GalacticFrameMode;
  /**
   * 银河系视角天体垂直展开开关（R3-6 §6.1-B，默认关）：开启后 L3 特殊天体
   * offsetLy.y 乘展开增益（约 1 秒平滑过渡）并显示高度指示线。观察辅助的
   * 视觉夸大（登记于 utils/galacticLatitude.ts）；仅影响 L3 银河系组特殊
   * 天体（可见窗口 2.5–3.9 天然限定，L1/L2/L4 零视觉影响）。V 键切换。
   */
  galaxyVerticalExpand: boolean;
  /** 展开增益滑块值（R3-6 §6.1-B：范围 [1,6]、默认 3、步进 0.5） */
  galaxyExpandGain: number;
  /**
   * G 键银心固定模式一次性引导提示可见（R2-6 §6.1：首次切入 L3 时 toast
   * 提示"按 G 切换银心固定视角观察太阳系公转"，会话内仅一次）
   */
  galacticFrameTipVisible: boolean;
  /** G 键引导提示已出现过（会话内一次性判定） */
  galacticFrameTipSeen: boolean;
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
  /**
   * 耀斑通知卡片快照（通知展示与事件生命周期解耦：事件先于最短展示
   * 时长完成时 activeSolarFlare 已置空，卡片仍需展示级别信息）
   */
  solarFlareNoticeInfo: SolarFlareNoticeInfo | null;
  /**
   * 耀斑通知展示计时（真实秒，上钳 EVENT_NOTICE_MIN_VISIBLE_REAL_SEC）：
   * 事件先于最短展示时长完成时通知驻留到时长再自动收起（高时间压缩比
   * 下事件真实时长可能不足两秒，用户来不及点击——通知展示按真实时间）
   */
  solarFlareNoticeAgeSec: number;
  /** 当前活跃 CME 事件（S2 §4.3-3；粒子缓冲复用，同一时刻至多一个） */
  activeCme: CmeEvent | null;
  /** CME 事件累计计数（生成事件 id） */
  cmeCounter: number;
  /** CME 事件通知可见（朝地球时附加地磁暴科普） */
  cmeNoticeVisible: boolean;
  /** CME 通知卡片快照（语义同 solarFlareNoticeInfo） */
  cmeNoticeInfo: CmeNoticeInfo | null;
  /** CME 通知展示计时（真实秒，语义同 solarFlareNoticeAgeSec） */
  cmeNoticeAgeSec: number;
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
   * CME 抵达通知展示计时（真实秒）：极光增强结束（auroraStartedAtSimDays
   * 置空）且展示满最短时长后自动收起（原先仅手动关闭/离域丢弃会收起）
   */
  cmeArrivalNoticeAgeSec: number;
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
  /**
   * R3-3 硬隔离：太阳活动事件（耀斑/CME/CME 抵达，共用同一视角域窗口）
   * 离域计时（真实秒）。0 = 域内；负值 = 运镜豁免窗口剩余；达
   * EVENT_DISCARD_GRACE_SEC（1 秒）时 tick 丢弃全部太阳活动事件状态。
   */
  solarEventsOutOfScopeSec: number;
  /** R3-3：超新星事件离域计时（真实秒，语义同上；遗迹不受丢弃影响） */
  supernovaOutOfScopeSec: number;
  /** R3-3：合并预览离域计时（真实秒，语义同上；到期恢复预览前时间） */
  mergerOutOfScopeSec: number;
  /** R3-3：离域计时已消费的锚点切换代次（变更帧写入运镜豁免） */
  eventScopeSeenTransitionId: number;
  /** R3-3：离域计时已消费的飞往请求代次（变更帧写入运镜豁免） */
  eventScopeSeenFlyToId: number;

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
   * 通用视角域天体循环切换（R2-5 §5.1-B；R3 四域重构）：按当前巡游域
   * （行星系统/太阳系/银河系/宇宙）沿域序列切换上一个（-1）/下一个（+1）
   * 并飞往跟随，离散层级锁定为该域主层级；未跟随时先飞往域记忆天体
   */
  cycleScopeBody: (direction: 1 | -1) => void;
  setRealScaleMode: (enabled: boolean) => void;
  toggleRealScaleMode: () => void;
  setGalacticFrameMode: (mode: GalacticFrameMode) => void;
  toggleGalacticFrameMode: () => void;
  /** 设置垂直展开开关（R3-6，V 键/面板复选框） */
  setGalaxyVerticalExpand: (on: boolean) => void;
  /** 切换垂直展开开关（V 键） */
  toggleGalaxyVerticalExpand: () => void;
  /** 设置展开增益滑块值（钳制到 [1,6]） */
  setGalaxyExpandGain: (gain: number) => void;
  /**
   * 首次进入 L3 时展示 G 键引导提示（R2-6 §6.1：会话内仅一次；
   * 已看过或已处于银心固定模式时不再展示）
   */
  showGalacticFrameTipOnce: () => void;
  /** 关闭 G 键引导提示（手动关闭/超时/切换模式后不再出现） */
  dismissGalacticFrameTip: () => void;
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

/**
 * R3-3 事件视角域硬隔离（IMPROVEMENT_REQUIREMENTS_3 §3.1-B）：每帧推进
 * 事件离域计时并执行到期丢弃，返回需合入本帧的状态增量。
 *
 * - 运镜豁免：viewTransitionId / flyToRequestId 变更帧将计时器写入负豁免
 *   窗口（锚点切换 2 秒 / 飞往 2.5 秒），运镜路径瞬间穿越域边界不误丢弃；
 * - 丢弃语义：清空事件全部关联状态（耀斑/CME 含在途抵达链与极光整链；
 *   超新星不归档遗迹、既有遗迹保留；合并预览等价"恢复预览前时间"）；
 *   计数器不回退，id 单调性保持；回域内不恢复被丢弃的事件；
 * - 零开销路径：无活跃事件时丢弃分支只做空判定；计时器域内恒 0、域外
 *   上钳到宽限期，稳态帧增量为空对象。
 */
function eventScopeDiscardUpdates(
  state: SimulationState,
  dtSec: number,
): Partial<SimulationState> {
  const updates: Partial<SimulationState> = {};
  let solar = state.solarEventsOutOfScopeSec;
  let supernova = state.supernovaOutOfScopeSec;
  let merger = state.mergerOutOfScopeSec;
  if (state.viewTransitionId !== state.eventScopeSeenTransitionId) {
    solar = Math.min(solar, -VIEW_TRANSITION_DISCARD_EXEMPT_SEC);
    supernova = Math.min(supernova, -VIEW_TRANSITION_DISCARD_EXEMPT_SEC);
    merger = Math.min(merger, -VIEW_TRANSITION_DISCARD_EXEMPT_SEC);
    updates.eventScopeSeenTransitionId = state.viewTransitionId;
  }
  if (state.flyToRequestId !== state.eventScopeSeenFlyToId) {
    solar = Math.min(solar, -FLY_TO_DISCARD_EXEMPT_SEC);
    supernova = Math.min(supernova, -FLY_TO_DISCARD_EXEMPT_SEC);
    merger = Math.min(merger, -FLY_TO_DISCARD_EXEMPT_SEC);
    updates.eventScopeSeenFlyToId = state.flyToRequestId;
  }
  const level = state.continuousLevel;
  solar = outOfScopeElapsedUpdate(solar, eventInScope('flare', level), dtSec);
  supernova = outOfScopeElapsedUpdate(supernova, eventInScope('supernova', level), dtSec);
  merger = outOfScopeElapsedUpdate(merger, eventInScope('merger', level), dtSec);
  if (solar !== state.solarEventsOutOfScopeSec) updates.solarEventsOutOfScopeSec = solar;
  if (supernova !== state.supernovaOutOfScopeSec) updates.supernovaOutOfScopeSec = supernova;
  if (merger !== state.mergerOutOfScopeSec) updates.mergerOutOfScopeSec = merger;
  if (eventDiscardDue(solar)) {
    if (state.activeSolarFlare) updates.activeSolarFlare = null;
    if (state.solarFlareNoticeVisible) updates.solarFlareNoticeVisible = false;
    if (state.solarFlareNoticeInfo) updates.solarFlareNoticeInfo = null;
    if (state.solarFlareNoticeAgeSec !== 0) updates.solarFlareNoticeAgeSec = 0;
    if (state.activeCme) updates.activeCme = null;
    if (state.cmeNoticeVisible) updates.cmeNoticeVisible = false;
    if (state.cmeNoticeInfo) updates.cmeNoticeInfo = null;
    if (state.cmeNoticeAgeSec !== 0) updates.cmeNoticeAgeSec = 0;
    if (state.cmeArrivalSimDays !== null) updates.cmeArrivalSimDays = null;
    if (state.auroraStartedAtSimDays !== null) updates.auroraStartedAtSimDays = null;
    if (state.cmeArrivalNoticeVisible) updates.cmeArrivalNoticeVisible = false;
    if (state.cmeArrivalNoticeAgeSec !== 0) updates.cmeArrivalNoticeAgeSec = 0;
  }
  if (eventDiscardDue(supernova)) {
    // 进行中的爆发动画直接终止、不归档为遗迹；supernovaRemnants 保留
    // （用户确认项 1：遗迹是场景装饰，非"进行中事件"）
    if (state.activeSupernova) updates.activeSupernova = null;
    if (state.supernovaNoticeVisible) updates.supernovaNoticeVisible = false;
  }
  if (eventDiscardDue(merger) && state.mergePreviewActive) {
    // 等价 restoreFromMergePreview（用户确认项 2）；预览自然结束后仅存的
    // mergePreviewReturnSimDays（"恢复预览前时间"按钮状态）非进行中事件，
    // 不受离域丢弃影响
    updates.mergePreviewActive = false;
    updates.mergePreviewProgress01 = 0;
    updates.simDays = state.mergePreviewReturnSimDays ?? state.simDays;
    updates.mergePreviewReturnSimDays = null;
  }
  return updates;
}

/**
 * 事件通知最短展示时长推进（IMPROVEMENT：高时间压缩比下耀斑/CME 事件
 * 真实时长可能不足两秒，通知随事件完成立即消失，用户来不及点击）：
 * 每帧按真实时间推进可见通知的展示计时，事件已结束且计时满
 * EVENT_NOTICE_MIN_VISIBLE_REAL_SEC（15 真实秒）时自动收起。
 *
 * - 事件持续超过最短时长：通知随事件完成即刻收起（tick 下一帧判定，
 *   原"通知随事件生命周期"语义保留）；
 * - 手动关闭（dismiss*）与离域丢弃（discard 增量）不受下限约束；
 * - 超新星通知不走本机制：动画时长本就 ≥10 真实秒（SN_MIN_DURATION_SEC），
 *   且"飞往观看"目标在归档后不可解析，通知随 activeSupernova 消失合理；
 * - 零开销路径：无可见通知时仅做布尔判定；计时到顶后保持恒值，
 *   稳态帧增量为空对象。
 */
function eventNoticeLingerUpdates(
  state: SimulationState,
  discard: Partial<SimulationState>,
  dtSec: number,
): Partial<SimulationState> {
  const updates: Partial<SimulationState> = {};
  // 本帧被离域丢弃的通知不再推进计时（discard 已清零关联状态）
  const flareVisible =
    discard.solarFlareNoticeVisible === undefined
      ? state.solarFlareNoticeVisible
      : discard.solarFlareNoticeVisible;
  if (flareVisible) {
    const age = noticeAgeUpdate(state.solarFlareNoticeAgeSec, dtSec);
    if (noticeAutoHideDue(age, state.activeSolarFlare === null)) {
      updates.solarFlareNoticeVisible = false;
      updates.solarFlareNoticeInfo = null;
      updates.solarFlareNoticeAgeSec = 0;
    } else if (age !== state.solarFlareNoticeAgeSec) {
      updates.solarFlareNoticeAgeSec = age;
    }
  }
  const cmeVisible =
    discard.cmeNoticeVisible === undefined ? state.cmeNoticeVisible : discard.cmeNoticeVisible;
  if (cmeVisible) {
    const age = noticeAgeUpdate(state.cmeNoticeAgeSec, dtSec);
    if (noticeAutoHideDue(age, state.activeCme === null)) {
      updates.cmeNoticeVisible = false;
      updates.cmeNoticeInfo = null;
      updates.cmeNoticeAgeSec = 0;
    } else if (age !== state.cmeNoticeAgeSec) {
      updates.cmeNoticeAgeSec = age;
    }
  }
  const arrivalVisible =
    discard.cmeArrivalNoticeVisible === undefined
      ? state.cmeArrivalNoticeVisible
      : discard.cmeArrivalNoticeVisible;
  if (arrivalVisible) {
    const age = noticeAgeUpdate(state.cmeArrivalNoticeAgeSec, dtSec);
    if (noticeAutoHideDue(age, state.auroraStartedAtSimDays === null)) {
      updates.cmeArrivalNoticeVisible = false;
      updates.cmeArrivalNoticeAgeSec = 0;
    } else if (age !== state.cmeArrivalNoticeAgeSec) {
      updates.cmeArrivalNoticeAgeSec = age;
    }
  }
  return updates;
}

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
  // 初始视角为 L2 太阳系锚点，对应太阳系巡游域
  cycleScope: 'solar',
  realScaleMode: false,
  galacticFrameMode: 'follow',
  galaxyVerticalExpand: false,
  galaxyExpandGain: GALAXY_EXPAND_GAIN_DEFAULT,
  galacticFrameTipVisible: false,
  galacticFrameTipSeen: false,
  activeSupernova: null,
  supernovaRemnants: [],
  supernovaNoticeVisible: false,
  supernovaCounter: 0,
  activeSolarFlare: null,
  solarFlareCounter: 0,
  solarFlareNoticeVisible: false,
  solarFlareNoticeInfo: null,
  solarFlareNoticeAgeSec: 0,
  activeCme: null,
  cmeCounter: 0,
  cmeNoticeVisible: false,
  cmeNoticeInfo: null,
  cmeNoticeAgeSec: 0,
  cmeArrivalSimDays: null,
  auroraStartedAtSimDays: null,
  cmeArrivalNoticeVisible: false,
  cmeArrivalNoticeAgeSec: 0,
  selectedSolarFeature: null,
  sunCutawayMode: false,
  sunCutawayLayer: null,
  showPerformance: false,
  bloomEnabled: true,
  mergePreviewActive: false,
  mergePreviewProgress01: 0,
  mergePreviewReturnSimDays: null,
  solarEventsOutOfScopeSec: 0,
  supernovaOutOfScopeSec: 0,
  mergerOutOfScopeSec: 0,
  eventScopeSeenTransitionId: 0,
  eventScopeSeenFlyToId: 0,

  tick: (realDeltaSeconds) =>
    set((state) => {
      if (realDeltaSeconds < 0) {
        throw new RangeError(`时间增量不能为负，收到 ${realDeltaSeconds}`);
      }
      // R3-3 硬隔离：事件离域计时推进 + 到期丢弃（真实时间驱动、不受
      // 暂停影响——丢弃语义随视角而非模拟时间；合并预览被丢弃时增量
      // 含 simDays 回跳恢复）
      const discard = eventScopeDiscardUpdates(state, realDeltaSeconds);
      // 事件通知最短展示时长推进（真实时间驱动，与丢弃计时同帧合入）
      const linger = eventNoticeLingerUpdates(state, discard, realDeltaSeconds);
      // 合并预览进行中（且本帧未被丢弃）：模拟时间按缓动插值快进到
      // 合并时刻（可选需求 3.1.3）
      if (state.mergePreviewActive && discard.mergePreviewActive !== false) {
        const progress = Math.min(
          1,
          state.mergePreviewProgress01 + realDeltaSeconds / MERGE_PREVIEW_DURATION_SEC,
        );
        return {
          ...discard,
          ...linger,
          simDays: mergePreviewSimDays(state.mergePreviewReturnSimDays ?? state.simDays, progress),
          mergePreviewProgress01: progress,
          // 到达合并时刻后预览结束（保留 returnSimDays 供恢复）
          mergePreviewActive: progress < 1,
        };
      }
      if (discard.simDays !== undefined) {
        // 合并预览被离域丢弃：模拟时间已回跳到预览前时刻，本帧不再推进
        return { ...discard, ...linger };
      }
      return {
        ...discard,
        ...linger,
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
          cycleScope: scopeForLevel(level),
          flyToBodyId: state.anchorBodyId,
          flyToRequestId: state.flyToRequestId + 1,
          followBodyId: state.anchorBodyId,
          // R3-2：按 1 = 切换到锚定天体，简介面板跟随显示该天体
          // （R2-1"关闭面板"语义仅保留给 L2-L4 固定锚点——无目标天体）
          selectedBodyId: state.anchorBodyId,
          selectedSolarFeature: null,
        };
      }
      // 层级未变且无跟随/飞往时无事可做；跟随远距天体（如哈雷彗星 ~20 AU）
      // 时层级读数可能已是目标层级，此时仍需取消跟随并回到固定锚点（P4 修复）
      if (state.viewLevel === level && !state.followBodyId && !state.flyToBodyId) return state;
      return {
        viewLevel: level,
        continuousLevel: LEVEL_TO_CONTINUOUS[level],
        cycleScope: scopeForLevel(level),
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
      // R3 需求 2 层级锁定：跟随/飞往期间离散层级与巡游域保持不变
      // （不随相机-原点距离漂移），仅同步连续层级
      const locked = state.followBodyId !== null || state.flyToBodyId !== null;
      const level = locked ? state.viewLevel : discreteLevelFromContinuous(clamped);
      if (state.continuousLevel === clamped && state.viewLevel === level) {
        return state;
      }
      // 连续缩放不触发锚点过渡动画（viewTransitionId 不变）
      return {
        continuousLevel: clamped,
        viewLevel: level,
        cycleScope: locked ? state.cycleScope : scopeForLevel(level),
      };
    }),

  syncCameraDistance: (distanceUnits, updateViewLevel = true) =>
    set((state) => {
      const clamped = Math.min(4, Math.max(1, continuousLevelForDistance(distanceUnits)));
      // R3 需求 2 层级锁定：跟随/飞往期间离散层级与巡游域锁定为进入
      // 巡游时的值（跟随阋神星不再跳 L3、跟随猎户座星云不再跌回 L2），
      // 直到用户按 1-4/层级按钮显式切换或 Esc 取消跟随
      const locked = state.followBodyId !== null || state.flyToBodyId !== null;
      const level =
        updateViewLevel && !locked ? discreteLevelFromContinuous(clamped) : state.viewLevel;
      if (
        state.cameraDistanceUnits === distanceUnits &&
        state.continuousLevel === clamped &&
        state.viewLevel === level
      ) {
        return state;
      }
      return {
        cameraDistanceUnits: distanceUnits,
        continuousLevel: clamped,
        viewLevel: level,
        cycleScope: updateViewLevel && !locked ? scopeForLevel(level) : state.cycleScope,
      };
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
      // R3：飞往目标按域归类切换当前巡游域，并将离散层级锁定为该域
      // 主层级（如 L2 点选卫星飞往 → system 域 + L1 行星视角；点选
      // 日球层顶飞往 → galaxy 域 + L3）。太阳保持当前域（防 L1/L2
      // 耀斑通知"飞往太阳"误改写银河系域记忆/层级，登记于 cycleScopes）
      const nextScope = scopeForFocusBody(id, state.cycleScope);
      // R3-2：飞往 = 切换到该天体，简介面板跟随显示（超新星事件无
      // 信息目录条目，维持现状不改写选中）
      const isSupernova = id.startsWith('sn-');
      return {
        flyToBodyId: id,
        flyToRequestId: state.flyToRequestId + 1,
        // 飞抵后保持锁定该天体（跟随模式），运镜期间同样按目标跟踪
        followBodyId: id,
        selectedBodyId: isSupernova ? state.selectedBodyId : id,
        selectedSolarFeature: isSupernova ? state.selectedSolarFeature : null,
        cycleScope: nextScope,
        viewLevel: SCOPE_HOME_LEVEL[nextScope],
        // 行星域天体（行星/矮行星/彗星/卫星）记为 L1 锚定天体（会话内记忆）
        anchorBodyId: isCycleBody(id) ? id : state.anchorBodyId,
        galaxyAnchorBodyId:
          nextScope === 'galaxy' && GALAXY_CYCLE_SEQUENCE.includes(id)
            ? id
            : state.galaxyAnchorBodyId,
        universeAnchorBodyId:
          nextScope === 'universe' && UNIVERSE_CYCLE_SEQUENCE.includes(id)
            ? id
            : state.universeAnchorBodyId,
      };
    }),

  cycleScopeBody: (direction) =>
    set((state) => {
      const scope = state.cycleScope;
      const followingInScope =
        state.followBodyId !== null && isScopeCycleBody(scope, state.followBodyId);
      // 跟随域内天体时沿序列切换；未跟随时点击即飞往域记忆天体
      // （行星域=锚定天体；L3=sgr-a-star / L4=m31 起始），不产生跳步
      let next: string;
      if (followingInScope) {
        next = cycleBodyIdInScope(scope, state.followBodyId!, direction);
      } else if (scope === 'system' || scope === 'solar') {
        // 行星域回落到锚定天体（solar 域锚定为卫星时映射到其所属行星），
        // 不产生位移——先锚定再切换的语义由"下一次调用"完成
        const mapped =
          scope === 'solar' ? planetSystemIdForBody(state.anchorBodyId) : state.anchorBodyId;
        next = isScopeCycleBody(scope, mapped) ? mapped : SCOPE_DEFAULT_BODY[scope];
      } else {
        next = scope === 'galaxy' ? state.galaxyAnchorBodyId : state.universeAnchorBodyId;
      }
      // 与 requestFlyTo 相同的解析兜底（防未来序列成员解析失败进入假跟随）
      if (resolveFocusTarget(next, state.simDays, state.realScaleMode) === null) {
        return state;
      }
      // R3 需求 1：system 域单成员系统（无卫星行星）无从切换，原地不动
      if (followingInScope && next === state.followBodyId) return state;
      return {
        flyToBodyId: next,
        flyToRequestId: state.flyToRequestId + 1,
        followBodyId: next,
        // R3-2：巡游切换（上一个/下一个/[/]/面板 ←→，含未跟随时的
        // 起始锚定）= 切换到该天体，简介面板跟随显示
        selectedBodyId: next,
        selectedSolarFeature: null,
        // R3 需求 2：巡游期间离散层级锁定为域主层级
        viewLevel: SCOPE_HOME_LEVEL[scope],
        ...(scope === 'system' || scope === 'solar'
          ? { anchorBodyId: next }
          : scope === 'galaxy'
            ? { galaxyAnchorBodyId: next }
            : { universeAnchorBodyId: next }),
      };
    }),

  setRealScaleMode: (enabled) => set({ realScaleMode: enabled }),

  toggleRealScaleMode: () => set((state) => ({ realScaleMode: !state.realScaleMode })),

  setGalacticFrameMode: (mode) =>
    // 用户已切换模式 = 已发现该功能，引导提示收起且不再出现（R2-6 §6.1）
    set({ galacticFrameTipVisible: false, galacticFrameTipSeen: true, galacticFrameMode: mode }),

  toggleGalacticFrameMode: () =>
    set((state) => ({
      galacticFrameMode: state.galacticFrameMode === 'follow' ? 'galactic-center' : 'follow',
      galacticFrameTipVisible: false,
      galacticFrameTipSeen: true,
    })),

  setGalaxyVerticalExpand: (on) => set({ galaxyVerticalExpand: on }),

  toggleGalaxyVerticalExpand: () =>
    set((state) => ({ galaxyVerticalExpand: !state.galaxyVerticalExpand })),

  setGalaxyExpandGain: (gain) => set({ galaxyExpandGain: clampExpandGain(gain) }),

  showGalacticFrameTipOnce: () =>
    set((state) => {
      // 会话内一次性：已看过不再展示；已处于银心固定模式说明用户已会用
      if (state.galacticFrameTipSeen || state.galacticFrameMode === 'galactic-center') {
        return state;
      }
      return { galacticFrameTipVisible: true, galacticFrameTipSeen: true };
    }),

  dismissGalacticFrameTip: () => set({ galacticFrameTipVisible: false }),

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
        // 快照通知展示信息（事件先于最短展示时长完成时卡片仍可渲染）
        solarFlareNoticeInfo: {
          flareClass: event.flareClass,
          magnitude: event.magnitude,
          cmeLinked: event.cmeLinked,
        },
        solarFlareNoticeAgeSec: 0,
      };
    }),

  completeSolarFlare: () =>
    set((state) => {
      if (!state.activeSolarFlare) return state;
      // 通知不随事件完成立即收起：由 tick 按最短展示时长
      // （EVENT_NOTICE_MIN_VISIBLE_REAL_SEC）判定自动收起
      return { activeSolarFlare: null };
    }),

  dismissSolarFlareNotice: () =>
    set({ solarFlareNoticeVisible: false, solarFlareNoticeInfo: null, solarFlareNoticeAgeSec: 0 }),

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
      return {
        activeCme: event,
        cmeCounter: counter,
        cmeNoticeVisible: true,
        cmeNoticeInfo: { speedKmS: event.speedKmS, earthDirected: event.earthDirected },
        cmeNoticeAgeSec: 0,
      };
    }),

  completeCme: () =>
    set((state) => {
      if (!state.activeCme) return state;
      // 通知收起交由 tick 按最短展示时长判定（同 completeSolarFlare）
      return { activeCme: null };
    }),

  dismissCmeNotice: () =>
    set({ cmeNoticeVisible: false, cmeNoticeInfo: null, cmeNoticeAgeSec: 0 }),

  scheduleCmeArrival: (arrivalSimDays) => set({ cmeArrivalSimDays: arrivalSimDays }),

  triggerCmeArrival: (atSimDays) =>
    set((state) => {
      if (!Number.isFinite(atSimDays)) return state;
      return {
        cmeArrivalSimDays: null,
        auroraStartedAtSimDays: atSimDays,
        cmeArrivalNoticeVisible: true,
        cmeArrivalNoticeAgeSec: 0,
      };
    }),

  completeAurora: () =>
    set((state) => {
      if (state.auroraStartedAtSimDays === null) return state;
      return { auroraStartedAtSimDays: null };
    }),

  dismissCmeArrivalNotice: () =>
    set({ cmeArrivalNoticeVisible: false, cmeArrivalNoticeAgeSec: 0 }),

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
        cycleScope: 'universe' as CycleScope,
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

// R4-24 集成回归专用：dev 环境暴露 store 供无头 Chrome CDP 验收脚本读写状态。
// 生产构建（NODE_ENV=production）下条件恒假，摇树剔除；运行时逻辑零影响。
if (process.env.NODE_ENV !== 'production' && typeof window !== 'undefined') {
  (window as Window & { __simStore?: unknown }).__simStore = useSimulationStore;
}
