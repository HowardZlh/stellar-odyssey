'use client';

import { useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useSimulationStore } from '@/store';
import { getSharedAudioEngine } from '@/components/Audio/audioEngine';
import { SPATIAL_SOURCES, spatialSourceLevelGain, toAudioPosition } from '@/utils/spatialAudio';
import { galacticPointToSceneUnits } from '@/utils/cameraFocus';

/**
 * 3D 空间音效驱动组件（可选需求 3.4.2：靠近太阳/黑洞时对应音源增强）
 *
 * 必须挂载在 Canvas 内：每帧将发声天体的世界坐标转换到相机局部坐标系
 * （监听者恒位于原点、面向 -z，无需维护 AudioListener 姿态），再按
 * unitsPerAudioUnit 归一化后喂给共享音效引擎的 PannerNode。
 *
 * 音源位置：
 * - 太阳：场景原点（本项目以太阳系为场景原点）
 * - 人马座A*：银心（银心系原点经 galacticPointToSceneUnits 随模拟时间变换）
 *
 * 声明：真空中无声音，音效为艺术化设计。
 */
export function SpatialAudio(): null {
  // 复用临时向量，避免渲染循环中创建新对象（AGENTS.md 性能规范）
  const tmp = useMemo(() => new THREE.Vector3(), []);

  useFrame(({ camera }) => {
    const engine = getSharedAudioEngine();
    if (!engine.initialized) return;
    const { simDays, continuousLevel, audioEnabled } = useSimulationStore.getState();
    const enabledFactor = audioEnabled ? 1 : 0;

    for (const config of SPATIAL_SOURCES) {
      if (config.id === 'sun-hum') {
        tmp.set(0, 0, 0);
      } else {
        // black-hole-hum：人马座A* 位于银心（银心系原点）
        const p = galacticPointToSceneUnits({ x: 0, y: 0, z: 0 }, simDays);
        tmp.set(p.x, p.y, p.z);
      }
      camera.worldToLocal(tmp);
      const audioPos = toAudioPosition(
        { x: tmp.x, y: tmp.y, z: tmp.z },
        config.unitsPerAudioUnit,
      );
      const gain01 = spatialSourceLevelGain(config, continuousLevel) * enabledFactor;
      engine.setSpatialSource(config.id, audioPos, gain01);
    }
  });

  return null;
}
