'use client';


import type { JSX } from 'react';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Bloom, EffectComposer } from '@react-three/postprocessing';
import type { BloomEffect } from 'postprocessing';
import { useSimulationStore } from '@/store';
import {
  BLOOM_LUMINANCE_SMOOTHING,
  BLOOM_LUMINANCE_THRESHOLD,
  bloomIntensityForLevel,
} from '@/utils/bloom';
import {
  CLUSTER_LENSING_BODY_ID,
  CLUSTER_LENSING_FADE_SECONDS,
  writeClusterLensingEffectStrength,
} from '@/utils/clusterLensing';
import { advanceFrameTransition } from '@/utils/galacticFrame';
import { qualityTierSpec } from '@/utils/qualityTier';
import { ClusterLensingPass } from '@/components/Scene/ClusterLensingEffect';

/**
 * 后处理管线（P3-3，需求 §4.6 Bloom 泛光 + R4-23 星系团引力透镜）
 *
 * - 选择性发光：亮度阈值方案（luminanceThreshold），仅高亮度发光体
 *   （太阳、恒星类特殊天体、超新星峰值、黑洞吸积盘、类星体、银心辉光）
 *   参与泛光；行星表面/轨道线/UI 不受影响
 * - 强度随连续层级适配（utils/bloom.ts 纯逻辑）：L1/L2 较强突出太阳，
 *   L3/L4 收敛避免银盘/宇宙网整体过曝；每帧插值更新（无对象创建）
 * - R4-23 星系团屏幕空间引力透镜（方案 a，登记见 ClusterLensingEffect
 *   文件头）：仅跟随/飞往 cluster-lensing 时挂载 SIS 偏转 Effect
 *   （域判据复用 LensingArcs 现状），0.5s 淡入淡出（与统一细节层同
 *   节奏）；非跟随且淡出完成即卸载 → 零渲染开销。透镜 Effect 自成
 *   EffectPass 排在 Bloom 之前（Bloom 采样已透镜化帧缓冲，无错位）
 * - 开关关闭且透镜未激活时整个 EffectComposer 卸载（渲染回到默认管线，
 *   零开销）
 *
 * 兼容性登记：Canvas 启用 logarithmicDepthBuffer（需求 5.1）。Bloom 与
 * 透镜 Effect 均为纯颜色域效果、不读取深度缓冲，与对数深度无冲突（依赖
 * 深度的效果如 SSAO/DoF 才受影响，本项目未使用）；EffectComposer
 * multisampling=4 补偿离屏渲染目标失去的默认 MSAA。
 */
export function PostEffects(): JSX.Element | null {
  // M2-2 生效 bloom = 用户开关 && 自适应门（桌面门恒 true = 现状；
  // medium 设备全局档跌 low 时 AdaptiveQualityDriver 关门省 Bloom 开销）
  const bloomEnabled = useSimulationStore((s) => s.bloomEnabled && s.adaptiveBloomGate);
  // M2-1 multisampling 按设备档（4 / 2 / 0；启动一次性写入，会话内不变）
  const multisampling = useSimulationStore(
    (s) => qualityTierSpec(s.deviceTier).multisampling,
  );
  // R4-23 域判据（复用 LensingArcs 现状：跟随/飞往 cluster-lensing）
  const lensFocused = useSimulationStore(
    (s) =>
      s.followBodyId === CLUSTER_LENSING_BODY_ID ||
      s.flyToBodyId === CLUSTER_LENSING_BODY_ID,
  );
  const bloomRef = useRef<BloomEffect | null>(null);
  // 透镜挂载门（焦点在本天体 或 淡出未完成时保持挂载，防突变）
  const [lensMounted, setLensMounted] = useState(false);
  const lensMountedRef = useRef(false);
  const lensStrengthRef = useRef(0);
  const getLensStrength = useCallback(() => lensStrengthRef.current, []);

  // Bloom 强度随连续层级实时插值 + 透镜强度淡入淡出（跨层级缩放平滑变化）
  useFrame((_, delta) => {
    const state = useSimulationStore.getState();
    if (bloomRef.current) {
      bloomRef.current.intensity = bloomIntensityForLevel(state.continuousLevel);
    }
    const focused =
      state.followBodyId === CLUSTER_LENSING_BODY_ID ||
      state.flyToBodyId === CLUSTER_LENSING_BODY_ID;
    lensStrengthRef.current = advanceFrameTransition(
      lensStrengthRef.current,
      focused ? 1 : 0,
      delta,
      CLUSTER_LENSING_FADE_SECONDS,
    );
    // 实际生效强度回写持有者（LensingArcs 近观静态弧减淡消费）
    writeClusterLensingEffectStrength(lensStrengthRef.current);
    const shouldMount = focused || lensStrengthRef.current > 0.001;
    if (shouldMount !== lensMountedRef.current) {
      lensMountedRef.current = shouldMount;
      setLensMounted(shouldMount);
    }
  });

  // Bloom 元素 memo 固定引用（R4-23 修复登记：透镜挂载 setState 触发
  // PostEffects 重渲染时，库的 Bloom 便捷包装会 JSON.stringify 全部 props
  // ——含已填充的 bloomRef（BloomEffect 场景图循环引用）→ 崩溃。元素
  // 引用不变则 React 直接跳过该子树重渲染，规避 stringify）
  const bloomElement = useMemo(
    () => (
      <Bloom
        // 库的 ref 类型标注为 typeof BloomEffect（已知类型瑕疵），实际转发实例
        ref={bloomRef as unknown as React.Ref<typeof BloomEffect>}
        intensity={bloomIntensityForLevel(2)}
        luminanceThreshold={BLOOM_LUMINANCE_THRESHOLD}
        luminanceSmoothing={BLOOM_LUMINANCE_SMOOTHING}
        mipmapBlur
      />
    ),
    [],
  );

  if (!bloomEnabled && !lensMounted) return null;

  return (
    <EffectComposer multisampling={multisampling}>
      {/* R4-23 透镜 Effect（非跟随不挂载零开销；置于 Bloom 之前） */}
      {lensMounted || lensFocused ? (
        <ClusterLensingPass getStrength={getLensStrength} />
      ) : (
        <></>
      )}
      {bloomEnabled ? bloomElement : <></>}
    </EffectComposer>
  );
}
