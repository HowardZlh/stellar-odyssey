'use client';

import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Bloom, EffectComposer } from '@react-three/postprocessing';
import type { BloomEffect } from 'postprocessing';
import { useSimulationStore } from '@/store';
import {
  BLOOM_LUMINANCE_SMOOTHING,
  BLOOM_LUMINANCE_THRESHOLD,
  bloomIntensityForLevel,
} from '@/utils/bloom';

/**
 * 后处理管线（P3-3，需求 §4.6 Bloom 泛光）
 *
 * - 选择性发光：亮度阈值方案（luminanceThreshold），仅高亮度发光体
 *   （太阳、恒星类特殊天体、超新星峰值、黑洞吸积盘、类星体、银心辉光）
 *   参与泛光；行星表面/轨道线/UI 不受影响
 * - 强度随连续层级适配（utils/bloom.ts 纯逻辑）：L1/L2 较强突出太阳，
 *   L3/L4 收敛避免银盘/宇宙网整体过曝；每帧插值更新（无对象创建）
 * - 开关关闭时整个 EffectComposer 卸载（渲染回到默认管线，零开销）
 *
 * 兼容性登记：Canvas 启用 logarithmicDepthBuffer（需求 5.1）。Bloom 为
 * 纯颜色域效果、不读取深度缓冲，与对数深度无冲突（依赖深度的效果如
 * SSAO/DoF 才受影响，本项目未使用）；EffectComposer multisampling=4
 * 补偿离屏渲染目标失去的默认 MSAA。
 */
export function PostEffects(): JSX.Element | null {
  const bloomEnabled = useSimulationStore((s) => s.bloomEnabled);
  const bloomRef = useRef<BloomEffect | null>(null);

  // Bloom 强度随连续层级实时插值（跨层级缩放平滑变化，需求 §4.6）
  useFrame(() => {
    if (!bloomRef.current) return;
    const { continuousLevel } = useSimulationStore.getState();
    bloomRef.current.intensity = bloomIntensityForLevel(continuousLevel);
  });

  if (!bloomEnabled) return null;

  return (
    <EffectComposer multisampling={4}>
      <Bloom
        // 库的 ref 类型标注为 typeof BloomEffect（已知类型瑕疵），实际转发实例
        ref={bloomRef as unknown as React.Ref<typeof BloomEffect>}
        intensity={bloomIntensityForLevel(2)}
        luminanceThreshold={BLOOM_LUMINANCE_THRESHOLD}
        luminanceSmoothing={BLOOM_LUMINANCE_SMOOTHING}
        mipmapBlur
      />
    </EffectComposer>
  );
}
