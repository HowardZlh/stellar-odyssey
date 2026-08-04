/**
 * 银心参考系观察模式位姿计算（P6，需求 3.1.1）
 *
 * 背景：银河系视角（L3）下用户反馈"太阳系有轨道但看不到它在轨道内运行"。
 * 根因（非计算 bug）是呈现设计抵消了全部运动线索——Galaxy 组每帧按太阳
 * 银心系位置**反向平移**，使太阳系恒居场景原点，运动只能靠"银河系整体相对
 * 滑动"体现，视觉上太阳系"钉死"不动。
 *
 * 本模块提供两种参考系下「银河系组的世界平移」与「太阳系标记的场景位置」的
 * 纯函数计算，供 Galaxy.tsx 渲染消费、供单测校验（组件内仅调用本模块 + three
 * 矩阵套用，逻辑镜像可测）：
 *
 * - 跟随太阳系（follow）：groupOffset = −sunWorld，太阳系标记落在场景原点；
 *   相机 target = 原点。银河系整体相对滑动（现状行为，保持向后兼容）。
 * - 银心固定（galactic-center）：groupOffset = 0（银心居场景原点），太阳系
 *   标记沿固定轨道线实际移动到 sunWorld；相机 target = 原点（银心）。
 *   "标记在轨道内跑"直接可见，且**不新增任何场景对象**（需求 §4）。
 *
 * 两模式以 galacticCenterWeight ∈ [0,1] 线性混合（0=跟随、1=银心固定），
 * 由 Galaxy.tsx 用 2 秒 easeInOutCubic 平滑推进（复用现有过渡机制）。混合式：
 *   groupOffset      = −(1 − w) · sunWorld
 *   markerScenePos   = groupOffset + sunWorld = w · sunWorld
 * 于是标记随 w 由原点平滑滑向轨道实际位置，银河系组同步反向滑回，
 * **同一模拟时间轴、场景内容无跳变**（需求 §3.1.1 模式切换过渡）。
 *
 * 坐标约定与 cameraFocus.galacticPointToSceneUnits / Galaxy 组变换一致：
 * 世界位置 = tiltX(pLy · unitsPerLy)，tiltX 为绕 X 轴倾斜 60.2°（黄道-银道夹角）。
 *
 * 艺术化/近似登记：无。本模块为纯几何变换，不含视觉夸大。
 */

import type { Vec3 } from '@/types';
import { DEG_TO_RAD } from '@/utils/physics';
import { ECLIPTIC_GALACTIC_TILT_DEG, sunGalacticPositionLy } from '@/utils/galaxy';
import { SCENE_UNITS_PER_LY } from '@/utils/scale';

/** 参考系观察模式 */
export type GalacticFrameMode = 'follow' | 'galactic-center';

/** 单帧位姿计算输入 */
export interface GalacticFrameInput {
  /** 模拟时间（天） */
  simDays: number;
  /**
   * 银心固定权重 ∈ [0,1]：0 = 跟随太阳系，1 = 银心固定；
   * 过渡期间取中间值（由 easeInOutCubic 提供）
   */
  galacticCenterWeight: number;
  /** 场景单位/光年（默认 SCENE_UNITS_PER_LY，可注入以便测试） */
  unitsPerLy?: number;
  /**
   * 垂直振荡视觉增益（默认 1）：对太阳 y 分量的放大倍数，与尾迹/预测线一致，
   * 保证跟随模式下标记仍精确落在场景原点（见 galacticMotionCues.ts 登记）。
   */
  verticalGain?: number;
}

/** 单帧位姿计算输出（场景单位） */
export interface GalacticFramePose {
  /** 银河系组的世界平移（应用于已倾斜的组） */
  groupOffset: Vec3;
  /** 太阳系标记的场景位置（相机可 target/飞往此点） */
  markerScenePos: Vec3;
  /** 太阳在银心系本地坐标下的倾斜后世界向量（groupOffset=0 时的标记位置） */
  sunWorld: Vec3;
}

/**
 * 绕 X 轴倾斜 60.2°（与 THREE.Euler(tilt,0,0) / galacticPointToSceneUnits 一致）
 */
export function tiltAroundX(p: Vec3): Vec3 {
  const tilt = ECLIPTIC_GALACTIC_TILT_DEG * DEG_TO_RAD;
  const cos = Math.cos(tilt);
  const sin = Math.sin(tilt);
  return { x: p.x, y: p.y * cos - p.z * sin, z: p.y * sin + p.z * cos };
}

/**
 * 太阳在场景中的"银心系倾斜后世界位置"（银心居原点、组未平移时的位置，单位：场景单位）
 *
 * @param verticalGain 垂直分量视觉增益（默认 1，与尾迹/预测线一致）
 */
export function sunWorldScenePos(
  simDays: number,
  unitsPerLy = SCENE_UNITS_PER_LY,
  verticalGain = 1,
): Vec3 {
  const sun = sunGalacticPositionLy(simDays);
  return tiltAroundX({
    x: sun.x * unitsPerLy,
    y: sun.y * verticalGain * unitsPerLy,
    z: sun.z * unitsPerLy,
  });
}

/**
 * 计算当前帧的参考系位姿（纯函数，供渲染与单测共用）
 *
 * @throws RangeError 当 galacticCenterWeight 不在 [0,1] 或 unitsPerLy ≤ 0
 */
export function computeGalacticFramePose(input: GalacticFrameInput): GalacticFramePose {
  const { simDays, galacticCenterWeight: w } = input;
  const unitsPerLy = input.unitsPerLy ?? SCENE_UNITS_PER_LY;
  if (!Number.isFinite(w) || w < 0 || w > 1) {
    throw new RangeError(`galacticCenterWeight 必须在 [0,1] 内，收到 ${w}`);
  }
  if (!(unitsPerLy > 0)) {
    throw new RangeError(`unitsPerLy 必须为正数，收到 ${unitsPerLy}`);
  }
  const verticalGain = input.verticalGain ?? 1;
  const sunWorld = sunWorldScenePos(simDays, unitsPerLy, verticalGain);
  // groupOffset = −(1−w)·sunWorld；markerScenePos = groupOffset + sunWorld = w·sunWorld
  const groupOffset: Vec3 = {
    x: -(1 - w) * sunWorld.x,
    y: -(1 - w) * sunWorld.y,
    z: -(1 - w) * sunWorld.z,
  };
  const markerScenePos: Vec3 = {
    x: w * sunWorld.x,
    y: w * sunWorld.y,
    z: w * sunWorld.z,
  };
  return { groupOffset, markerScenePos, sunWorld };
}

/**
 * 模式 → 目标权重（follow=0，galactic-center=1）
 */
export function frameModeTargetWeight(mode: GalacticFrameMode): number {
  return mode === 'galactic-center' ? 1 : 0;
}

/** 参考系 HUD 文案（随模式实时更新，需求 §3.1.3 / §3.1.1） */
export function galacticFrameHudLabel(mode: GalacticFrameMode): string {
  return mode === 'galactic-center'
    ? '参考系：银心系（银心固定）'
    : '参考系：银心系（跟随太阳系）';
}

/** 参考系切换过渡时长（秒），复用视角过渡的 2 秒 easeInOutCubic 节奏 */
export const GALACTIC_FRAME_TRANSITION_SECONDS = 2;

/**
 * 推进参考系切换的线性过渡进度（0→1），钳制在 [0,1]。
 *
 * 到达目标值后恒稳定（bug 修复：原实现 current===target===1 时
 * `target > current` 为 false 落入递减分支，1 − step 后下一帧又加回，
 * 形成永久的逐帧极限环 1 ↔ 1−delta/seconds——所有停在 1 的过渡权重
 * （细节层淡入 opacity01、聚焦提升、参考系切换等）以 ~3% 振幅 30Hz
 * 振荡；黑洞透镜层 uFade 为双权重乘积、振幅翻倍且作用于最亮 HDR 内容
 * 经 Bloom 放大，呈整屏一亮一暗频闪。target===current 直接返回即修复；
 * 到达 0 无此问题——递减分支 max(0, 0−step)=0 本就稳定）。
 *
 * @param current 当前线性进度 ∈ [0,1]
 * @param target  目标线性进度（0 或 1）
 * @param deltaSeconds 帧时长（秒）
 * @param seconds 过渡总时长（秒，默认 GALACTIC_FRAME_TRANSITION_SECONDS）
 * @returns 新的线性进度 ∈ [0,1]
 */
export function advanceFrameTransition(
  current: number,
  target: 0 | 1,
  deltaSeconds: number,
  seconds = GALACTIC_FRAME_TRANSITION_SECONDS,
): number {
  if (!(seconds > 0)) {
    throw new RangeError(`过渡时长必须为正数，收到 ${seconds}`);
  }
  if (target === current) {
    return current;
  }
  const step = deltaSeconds / seconds;
  if (target > current) {
    return Math.min(1, current + step);
  }
  return Math.max(0, current - step);
}

// ---------------------------------------------------------------------------
// 渲染位姿注册表（bug 修复：飞往/跟随 L3 天体与渲染位姿一致）
// ---------------------------------------------------------------------------

/**
 * 渲染端实际生效的参考系位姿参数（镜像 satellitePhase.ts 的注册表模式）
 *
 * 背景（P6 自查修复）：cameraFocus.galacticPointToSceneUnits 原按"跟随模式、
 * 无垂直增益"的固定公式换算银心系坐标 → 场景坐标；P6 引入银心固定模式
 * （groupOffset=0）与垂直视觉增益（默认 6）后，若解析端不感知这两个参数：
 * - 银心固定模式下飞往特殊天体/超新星/银心会错位整个太阳轨道半径（~1300 单位）；
 * - 跟随模式默认增益下所有银河系组内容的世界 y 与解析值偏差最高 ±(gain−1)·300 ly。
 *
 * Galaxy.tsx 每帧把实际应用的（缓动后）银心固定权重与垂直增益写入本注册表，
 * cameraFocus / SpatialAudio 按注册值解析，保证"相机飞往/跟随的点"与
 * "渲染的天体"始终一致。未注册（组件未挂载/单测）时取默认 w=0、gain=1，
 * 行为与历史公式完全一致。
 */
export interface RenderedGalacticFrame {
  /** 银心固定权重 ∈ [0,1]（缓动后的实际应用值） */
  weight: number;
  /** 垂直振荡视觉增益 ≥1（真实比例模式为 1；仅作用于太阳 y） */
  verticalGain: number;
  /**
   * 天体垂直展开增益 ≥1（R3-6 §6.1-D：过渡缓动后的实际应用值，
   * 乘在 sun-relative 特殊天体的 offsetLy.y 上，与 verticalGain 互不相乘；
   * sgr-a-star（银心原点 y=0）不参与展开。R3-7 起同一增益经
   * diskMorphWeight 派生盘 morph 权重：银盘粒子 uExpand uniform 与
   * 超新星事件/遗迹（morphGalacticYLy）随盘 morph 为扁旋转椭球体
   * ——渲染与解析同源，禁止第二套过渡状态）
   */
  expandGain: number;
}

const DEFAULT_RENDERED_FRAME: RenderedGalacticFrame = {
  weight: 0,
  verticalGain: 1,
  expandGain: 1,
};

let renderedFrame: RenderedGalacticFrame = DEFAULT_RENDERED_FRAME;

/** 写入当前帧实际应用的参考系位姿参数（Galaxy.tsx 每帧调用） */
export function setRenderedGalacticFrame(
  weight: number,
  verticalGain: number,
  expandGain = 1,
): void {
  if (!Number.isFinite(weight) || weight < 0 || weight > 1) {
    throw new RangeError(`银心固定权重必须在 [0,1] 内，收到 ${weight}`);
  }
  if (!Number.isFinite(verticalGain) || verticalGain < 1) {
    throw new RangeError(`垂直增益必须 ≥1，收到 ${verticalGain}`);
  }
  if (!Number.isFinite(expandGain) || expandGain < 1) {
    throw new RangeError(`展开增益必须 ≥1，收到 ${expandGain}`);
  }
  renderedFrame = { weight, verticalGain, expandGain };
}

/** 读取当前渲染位姿参数（未注册返回默认 w=0、gain=1，即历史跟随模式行为） */
export function renderedGalacticFrame(): RenderedGalacticFrame {
  return renderedFrame;
}

/** 重置注册表（Galaxy 组件卸载/测试用） */
export function resetRenderedGalacticFrame(): void {
  renderedFrame = DEFAULT_RENDERED_FRAME;
}
