'use client';

import { useFrame } from '@react-three/fiber';
import { useSimulationStore } from '@/store';

/**
 * 模拟时钟：每帧按当前层级时间压缩比推进全局模拟时间轴（需求 3.3）
 */
export function SimulationClock(): null {
  const tick = useSimulationStore((s) => s.tick);

  useFrame((_, delta) => {
    // 钳制单帧最大时长，避免标签页切回时时间跳变
    tick(Math.min(delta, 0.1));
  });

  return null;
}
