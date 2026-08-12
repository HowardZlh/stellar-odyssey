/**
 * 流星雨实验室共享类型（M3）：控件状态 + 帧循环共享 refs
 *
 * 控件（§3）改动只写 settingsRef（uniforms 每帧消费，契约 C2.1：不触发
 * attribute 重建）；唯一的重建路径是页签切换（showerRef + slots useMemo）。
 * 纯类型模块，无业务逻辑（可测逻辑一律下沉 utils/meteorShower.ts）。
 */

import type { MutableRefObject } from 'react';
import type { MeteorShowerParams } from '@/utils/meteorShower';
import {
  DEFAULT_FIREBALL_RATE,
  DEFAULT_LIMITING_MAG,
  DEFAULT_OBSERVER_LAT_DEG,
  DEFAULT_WIND_SPEED_M_PER_SEC,
} from '@/utils/meteorShower';

/** 控件面板状态（§3 全部 7 项 + 辐射点标注开关） */
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
};

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
}
