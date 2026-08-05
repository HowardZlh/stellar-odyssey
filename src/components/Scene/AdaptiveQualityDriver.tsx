'use client';

/**
 * 全局自适应质量驱动（M2-2，REQUIREMENTS_MOBILE §M2）
 *
 * adaptiveQuality 状态机（换档阈值/驻留逻辑零改动复用）从"仅控体积步数"
 * 扩展出全局输出通道：换档时联动 R3F `setDpr`（adaptiveDpr：设备档 dpr
 * 为上界的动态钳制）与 bloom 门（store.adaptiveBloomGate，PostEffects
 * 生效 bloom = 用户开关 && 门）。
 *
 * 挂载策略（实现差异登记，见 qualityTier.ts 文件头）：
 * - high 设备（桌面）：**不挂载**——桌面行为与现状零变化的硬约束保险丝；
 *   体积层各自的 adaptiveQuality 实例照旧（现状行为）。
 * - medium 设备：mid 起步（初始 dpr 即 Canvas 档位值 [1,1.5]），可升可降
 *   ——跌至 low 时 dpr 钳 1 + bloom 门关，恢复后回升。
 * - low 设备：不挂载——dpr 恒 1 / bloom 默认关 / 体积档恒锁 low，
 *   无动态可调项（挂载为空操作）；bloom 门保持 true，尊重用户手动开启。
 *
 * 消费方：SolarSystemApp 按 deviceTier === 'medium' 条件挂载于 Canvas 内。
 */

import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { createAdaptiveQuality, recordQualityFrame } from '@/utils/adaptiveQuality';
import type { VolumeQualityTier } from '@/utils/adaptiveQuality';
import { adaptiveDpr, qualityTierSpec } from '@/utils/qualityTier';
import { useSimulationStore } from '@/store';

export function AdaptiveQualityDriver(): null {
  const setDpr = useThree((s) => s.setDpr);
  // 挂载期档位快照（deviceTier 启动一次性写入，不随会话变化）
  const specRef = useRef(qualityTierSpec(useSimulationStore.getState().deviceTier));
  const adaptiveRef = useRef(
    createAdaptiveQuality(0, specRef.current.volumeInitialTier),
  );
  const nowMsRef = useRef(0);
  // 已应用输出档（仅换档时触达 setDpr/store，渲染循环零多余写入）
  const appliedRef = useRef<VolumeQualityTier>(specRef.current.volumeInitialTier);

  useFrame((_, delta) => {
    nowMsRef.current += delta * 1000;
    const state = recordQualityFrame(adaptiveRef.current, nowMsRef.current);
    if (state.tier === appliedRef.current) return;
    appliedRef.current = state.tier;
    // dpr 联动：R3F setDpr 接受定值或 [min,max]（readonly 元组结构一致）
    setDpr(adaptiveDpr(specRef.current.dpr, state.tier) as number | [number, number]);
    // bloom 门联动：low 档关（用户 bloomEnabled 开关不改写）
    const gate = state.tier !== 'low';
    const store = useSimulationStore.getState();
    if (gate !== store.adaptiveBloomGate) store.setAdaptiveBloomGate(gate);
  });

  return null;
}
