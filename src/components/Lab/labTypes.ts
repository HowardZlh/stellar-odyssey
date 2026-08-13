/**
 * 流星雨实验室共享类型（M3 + M3.5）：控件状态 + 帧循环共享 refs +
 * 演示/跟随/相机位姿桥
 *
 * 控件（§3）改动只写 settingsRef（uniforms 每帧消费，契约 C2.1：不触发
 * attribute 重建）；唯一的重建路径是页签切换（showerRef + slots useMemo）。
 * M3.5 的快进/演示/跟随/切档全部是交互事件路径（契约 C2.1 口径，零 buffer
 * 上传）。纯类型模块，无业务逻辑（可测逻辑一律下沉 utils/meteorShower.ts）。
 */

import type { MutableRefObject } from 'react';
import type { MeteorShowerParams } from '@/utils/meteorShower';
import {
  DEFAULT_FIREBALL_RATE,
  DEFAULT_LIMITING_MAG,
  DEFAULT_OBSERVER_LAT_DEG,
  DEFAULT_WIND_SPEED_M_PER_SEC,
} from '@/utils/meteorShower';

/** 观测视角档（§M3.5-4：地面环顾 ｜ 太空环绕俯瞰燃烧层） */
export type LabViewMode = 'ground' | 'space';

/** 控件面板状态（§3 全部 7 项 + 辐射点标注开关 + M3.5 跟随/燃烧层开关） */
export interface LabControlState {
  /** 时间推进率 [0, 10] */
  timeScale: number;
  /** 地方时偏移 [-6, +6] h，step 0.25 */
  hourOffset: number;
  /** 光害/极限星等 [1.0, 6.5]（恒星剔除与流量压低共用，§1.4） */
  limitingMag: number;
  /** 观测纬度 [-90, 90] 度 */
  observerLat: number;
  /** 火流星概率增益 [0, 1]（uFireballFraction 直接取值，§4.2） */
  fireballRate: number;
  /** 高空风速 [0, 100] m/s（余迹蛇形幅度，§1.5） */
  windSpeed: number;
  /** 辐射点标注开关（§3 辅助 UI） */
  showRadiant: boolean;
  /** 演示触发时进入跟随视角（§M3.5-6） */
  followOnDemo: boolean;
  /** 燃烧层参考盘开关（仅太空档渲染，默认开，§M3.5-5） */
  showBurnLayer: boolean;
}

/** 控件默认值（§3；数值默认量收口 utils/meteorShower.ts 常量） */
export const DEFAULT_LAB_CONTROLS: LabControlState = {
  timeScale: 1,
  hourOffset: 0,
  limitingMag: DEFAULT_LIMITING_MAG,
  observerLat: DEFAULT_OBSERVER_LAT_DEG,
  fireballRate: DEFAULT_FIREBALL_RATE,
  windSpeed: DEFAULT_WIND_SPEED_M_PER_SEC,
  showRadiant: true,
  followOnDemo: false,
  showBurnLayer: true,
};

/**
 * 演示注入状态（§M3.5-3，方案 B 时间轴外注入）：DOM 按钮写入，
 * MeteorField/AfterglowField useFrame 消费进 uDemoSlot/uDemoStart。
 * 时间真实性红线：演示非当前时刻真实流量调度，页面常显标注文案。
 */
export interface LabDemoState {
  /** 演示槽位下标（uDemoSlot；pickDemoSlot 产物） */
  slotIndex: number;
  /** 注入时刻（场景秒，uDemoStart） */
  startTimeSec: number;
  /** 过期时刻（场景秒 = 注入 + 寿命 + 余迹渐隐窗；过期自动清除恢复正常调度） */
  expiresAtSec: number;
}

/**
 * 跟随视角状态（§M3.5-6 + §M3.6-2 环绕参数）：DOM 触发写入，
 * FollowCameraRig useFrame 消费（每帧经 followOrbitPose 写相机）。
 * ESC/按钮/页签切换置 endRequested，rig 在下一帧复原相机后回调 DOM 层
 * 还原 timeScale/OrbitControls。环绕参数由跟随期间的拖拽/滚轮手势
 * mutate（交互事件路径，契约 C2.1 口径）；退出跟随不保留。
 */
export interface LabFollowState {
  /** 跟随槽位下标（与演示注入同槽位） */
  slotIndex: number;
  /** 演示注入时刻（场景秒；elapsed = uTime − 本值） */
  startTimeSec: number;
  /** 进入跟随前的时间流速（结束时还原） */
  savedTimeScale: number;
  /** DOM 层请求结束（ESC/退出按钮/页签切换强制结束） */
  endRequested: boolean;
  /** 环绕方位角（弧度，绕飞行方向轴 360° 无限制；默认 0 = 纯侧视，M3.6-2） */
  azimuthRad: number;
  /** 环绕仰角（弧度，手势侧经 clampFollowElevation 钳制 ±75°；默认 0 = 水平） */
  elevationRad: number;
  /** 相机—头部距离（km，滚轮经 clampFollowDistance 钳制 [0.6, 6]；默认 1.5） */
  distanceKm: number;
}

/**
 * 演示自动运镜状态（§M3.6-1，决策 A1）：handleDemo 发现 needsAim 时写入，
 * AimRig useFrame 消费——~0.6 s 球面插值（方向 slerp + 半径 lerp）相机到
 * aim 目标机位，到位后回调 DOM 层注入演示并清除本状态。aim 期间演示/快进
 * 按钮禁用、OrbitControls 卸载（防 damping 争抢相机）。
 */
export interface LabAimState {
  /** 待注入演示的槽位下标（pickDemoSlot 全域最优） */
  slotIndex: number;
  /** 轨道中心（地面档 = 原点；太空档 = 燃烧层中心） */
  center: [number, number, number];
  /** 起点相机相对中心的偏移（球面插值起点） */
  fromOffset: [number, number, number];
  /** 目标相机相对中心的偏移（groundAimPosition/spaceAimPosition 产物 − center） */
  toOffset: [number, number, number];
  /** 已推进时长（真实秒，rig 每帧累加；≥ AIM_DURATION_SEC 时完成） */
  elapsedSec: number;
}

/** 相机位姿桥（CameraPoseBridge 每帧 mutate；DOM 演示按钮读取喂 pickDemoSlot） */
export interface LabCameraPose {
  /** 相机世界坐标（场景单位） */
  position: [number, number, number];
  /** 视线方向（单位向量，相机 −Z 世界方向） */
  viewDir: [number, number, number];
  /** 相机上方向（单位向量，matrixWorld 第 2 列；pickDemoSlot v2 视锥基） */
  upDir: [number, number, number];
  /** 垂直视野角（弧度） */
  fovYRad: number;
  /** 视口宽高比 */
  aspect: number;
}

/**
 * 帧循环共享 refs：DOM 层（面板/HUD）写入，Canvas 子树 useFrame 读取——
 * 场景组件不订阅 React 状态（滑杆拖动零场景重渲染）。
 */
export interface LabFrameRefs {
  /** 场景推进时钟（秒，已经 timeScale 放大的 uTime；页签切换归零） */
  timeSecRef: MutableRefObject<number>;
  /** 控件状态（渲染期同步赋值，useFrame 逐帧读取） */
  settingsRef: MutableRefObject<LabControlState>;
  /** 当前流星雨参数（页签切换随 slots 重建一并更新） */
  showerRef: MutableRefObject<MeteorShowerParams>;
  /** 演示注入状态（null = 无演示；LabTimeDriver 负责过期清除） */
  demoRef: MutableRefObject<LabDemoState | null>;
  /** 跟随视角状态（null = 未跟随） */
  followRef: MutableRefObject<LabFollowState | null>;
  /** 演示自动运镜状态（null = 无运镜；AimRig 完成/取消时清除，M3.6-1） */
  aimRef: MutableRefObject<LabAimState | null>;
  /** 相机位姿桥（Canvas 内每帧 mutate，DOM 事件路径只读） */
  cameraPoseRef: MutableRefObject<LabCameraPose>;
}
