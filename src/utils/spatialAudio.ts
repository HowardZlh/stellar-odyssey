/**
 * 3D 空间音效的纯逻辑（可选需求 3.4.2：靠近发声天体时对应音源增强）
 *
 * 播放端使用 Web Audio API PannerNode（components/Audio/audioEngine.ts），
 * 本文件负责可测试的坐标归一化与增益门控逻辑。
 *
 * 声明：真空中无声音，音效为艺术化设计。
 *
 * 坐标归一化：场景单位跨多个数量级（行星视角 O(10) → 宇宙视角 O(10⁴)），
 * 直接喂给 PannerNode 的 inverse 距离模型会导致外层完全听不见。
 * 因此每个音源定义自己的 unitsPerAudioUnit（场景单位/音频单位），
 * 将"典型可闻距离"归一化到 refDistance 量级。
 */

import type { ViewLevel } from '@/types';
import type { Vec3 } from '@/types';
import { trapezoidWeight } from '@/utils/scale';

/** 空间音源定义 */
export interface SpatialSourceConfig {
  id: string;
  nameZh: string;
  /** 所属层级（决定可闻的连续层级窗口） */
  level: ViewLevel;
  /** 场景单位 → 音频单位换算（越大音源"可闻范围"越大） */
  unitsPerAudioUnit: number;
  /** 可闻窗口（连续层级梯形节点） */
  fade: { x0: number; x1: number; x2: number; x3: number };
  /** 振荡基频（Hz，程序化合成） */
  oscillatorFrequency: number;
  /** 基础增益 */
  baseGain: number;
}

/**
 * 空间音源清单：太阳（L1/L2 低频轰鸣）、人马座A* 黑洞（L3 深沉嗡鸣）
 *
 * 需求示例即"太阳、黑洞等"；音源位置由渲染端每帧提供。
 */
export const SPATIAL_SOURCES: readonly SpatialSourceConfig[] = [
  {
    id: 'sun-hum',
    nameZh: '太阳低频轰鸣',
    level: 'L2',
    unitsPerAudioUnit: 40,
    fade: { x0: 1, x1: 1, x2: 2.4, x3: 3.0 },
    oscillatorFrequency: 36,
    baseGain: 1.0,
  },
  {
    id: 'black-hole-hum',
    nameZh: '人马座A* 深沉嗡鸣',
    level: 'L3',
    unitsPerAudioUnit: 600,
    fade: { x0: 2.4, x1: 2.8, x2: 3.6, x3: 4.01 },
    oscillatorFrequency: 26,
    baseGain: 1.1,
  },
] as const;

/**
 * 场景坐标 → 音频坐标（PannerNode 坐标系）
 */
export function toAudioPosition(sceneRelative: Vec3, unitsPerAudioUnit: number): Vec3 {
  if (unitsPerAudioUnit <= 0) {
    throw new RangeError(`坐标换算系数必须为正数，收到 ${unitsPerAudioUnit}`);
  }
  return {
    x: sceneRelative.x / unitsPerAudioUnit,
    y: sceneRelative.y / unitsPerAudioUnit,
    z: sceneRelative.z / unitsPerAudioUnit,
  };
}

/**
 * 音源层级门控增益（0-1）：仅在音源所属层级窗口内可闻
 *
 * 与音景混合（audioMixer）互补：音景为全局铺底，空间音源为局部增强。
 */
export function spatialSourceLevelGain(
  config: SpatialSourceConfig,
  continuousLevel: number,
): number {
  return trapezoidWeight(
    continuousLevel,
    config.fade.x0,
    config.fade.x1,
    config.fade.x2,
    config.fade.x3,
  );
}

/**
 * 按 id 查找空间音源配置
 */
export function getSpatialSourceById(id: string): SpatialSourceConfig | undefined {
  return SPATIAL_SOURCES.find((s) => s.id === id);
}
