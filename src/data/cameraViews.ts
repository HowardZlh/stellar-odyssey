/**
 * 四视角锚点相机配置（需求 3.2.1）
 *
 * 背景色取自附录A参考值；距离参数基于 1 AU = 10 场景单位的映射。
 * P0 阶段 L3/L4 场景内容未实现，锚点先行提供远景占位（拉远视角+星场）。
 */

import type { CameraViewConfig, ViewLevel } from '@/types';

export const CAMERA_VIEWS: Record<ViewLevel, CameraViewConfig> = {
  L1: {
    level: 'L1',
    nameZh: '行星视角',
    // 默认聚焦地球轨道附近（运行时由跟随逻辑对准地球实际位置）
    position: { x: 12, y: 3, z: 6 },
    target: { x: 10, y: 0, z: 0 },
    fov: 45,
    minDistance: 1,
    maxDistance: 60,
    background: '#1a1a2e',
  },
  L2: {
    level: 'L2',
    nameZh: '太阳系视角',
    // 附录A：太阳系视角距离 80
    position: { x: 0, y: 60, z: 80 },
    target: { x: 0, y: 0, z: 0 },
    fov: 50,
    minDistance: 20,
    maxDistance: 500,
    background: '#1a1a35',
  },
  L3: {
    level: 'L3',
    nameZh: '银河系视角',
    position: { x: 0, y: 1500, z: 2500 },
    target: { x: 0, y: 0, z: 0 },
    fov: 55,
    minDistance: 500,
    maxDistance: 5000,
    background: '#1a1a4a',
  },
  L4: {
    level: 'L4',
    nameZh: '宇宙视角',
    position: { x: 0, y: 8000, z: 12000 },
    target: { x: 0, y: 0, z: 0 },
    fov: 60,
    minDistance: 5000,
    maxDistance: 50000,
    background: '#000000',
  },
};

/** 视角切换动画时长（秒） */
export const VIEW_TRANSITION_SECONDS = 2;
