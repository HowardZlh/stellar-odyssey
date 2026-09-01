/**
 * 统一细节层挂载 Hook（R4-2，IMPROVEMENT_REQUIREMENTS_4 §R4-2）
 *
 * 组件层薄封装：消费纯逻辑 utils/detailLayer 的门控/LRU 分池/GPU 预算
 * 注册表，返回 { active, opacity01 }——active 为挂载判据（React state，
 * 卸载即 dispose 细节层子树），opacity01 为帧读 getter（0.5s 交叉淡入
 * 淡出权重，渲染循环内读取，零逐帧 React 重渲染；差异登记：需求文本的
 * opacity01 值语义以 getter 形式交付，遵守附录 A 渲染纪律）。
 *
 * 保留策略两档（迁移自 R2-7/R2-8 现状语义，行为零回退）：
 * - 'release-on-exit'（R2-7 L3 语义）：门控退出 → 淡出完成即卸载并
 *   释放注册表持有权（"离开跟随/超出距离即释放"，无 LRU 保留）
 * - 'lru-retain'（R2-8 L4 语义）：门控退出仅淡出不卸载（LRU 保留，
 *   快速切回免重建）；被同池新持有者挤出或预算逐出时立即卸载 dispose
 *
 * spec 须由调用方 useMemo 稳定（每帧读取字段，不比较对象引用）。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import {
  DETAIL_LAYER_TRANSITION_SECONDS,
  claimDetailLayer,
  detailGateUpdate,
  detailLayerHolderIds,
  releaseDetailLayer,
  type DetailLayerSpec,
} from '@/utils/detailLayer';
import { advanceFrameTransition } from '@/utils/galacticFrame';
import { premiumDetailGateUpdate } from '@/utils/premiumGate';
import { remoteFreeScheduleActive } from '@/utils/remoteGateConfig';
import { remotePremiumBodyIdSet } from '@/utils/remoteGateConfigClient';
import { useSimulationStore } from '@/store';

/** 保留策略（R2-7 退出即释放 / R2-8 LRU 保留） */
export type DetailLayerRetention = 'release-on-exit' | 'lru-retain';

export interface UseDetailLayerOptions {
  /** 保留策略，默认 'release-on-exit'（R2-7 语义） */
  retention?: DetailLayerRetention;
  /** 距离参考对象（默认判据：相机到其世界坐标的距离） */
  objectRef?: React.RefObject<THREE.Object3D | null>;
  /** 自定义相机距离（场景单位；如日球层顶以相机位置模长为距离） */
  getDistanceUnits?: (camera: THREE.Camera) => number;
  /** 自定义跟随/飞往判据（默认 followBodyId/flyToBodyId === spec.bodyId） */
  getFocused?: () => boolean;
}

/** 渲染循环共用临时向量（零分配纪律） */
const DETAIL_LAYER_TMP_VEC = new THREE.Vector3();

/**
 * 统一细节层门控 Hook。
 *
 * @returns active 细节层是否挂载（React state，卸载即 dispose）；
 *   opacity01 帧读激活权重 getter（0.5s 淡入淡出，∈[0,1]）
 */
export function useDetailLayer(
  spec: DetailLayerSpec,
  options: UseDetailLayerOptions = {},
): { active: boolean; opacity01: () => number } {
  const { retention = 'release-on-exit', objectRef, getDistanceUnits, getFocused } = options;
  const [active, setActive] = useState(false);
  const mountedRef = useRef(false);
  const gateActiveRef = useRef(false);
  const opacityRef = useRef(0);
  // U2-2：锁定命中上报的本地帧级防抖（store 侧另有会话级同天体节流，
  // 本 ref 避免被拦期间逐帧调用 store action）
  const lockedReportedRef = useRef(false);
  const opacity01 = useCallback(() => opacityRef.current, []);

  // 卸载兜底：释放注册表持有权（幂等；组件树 dispose 由 React 卸载承担）
  useEffect(() => {
    const { bodyId, kind } = spec;
    return () => releaseDetailLayer(bodyId, kind);
  }, [spec]);

  useFrame(({ camera }, delta) => {
    const state = useSimulationStore.getState();
    const focused = getFocused
      ? getFocused()
      : state.followBodyId === spec.bodyId || state.flyToBodyId === spec.bodyId;
    let distance: number;
    if (getDistanceUnits) {
      distance = getDistanceUnits(camera);
    } else {
      const object = objectRef?.current;
      if (!object) return;
      distance = camera.position.distanceTo(object.getWorldPosition(DETAIL_LAYER_TMP_VEC));
    }
    const gate = detailGateUpdate(
      gateActiveRef.current,
      focused,
      distance,
      spec.enterDistanceUnits,
      spec.exitDistanceUnits,
    );
    // U2-2 权益叠加判定（纯函数）：免费天体/有效权益原样透传（现状零
    // 差异，detailGateUpdate 本体零改动）；付费天体无权益 → 强制
    // inactive（沿用下方既有淡出路径）+ 锁定命中上报（帧级防抖 +
    // store 会话级同天体节流）。A3 叠加：远程 detail 域经 getState 读取
    // （3D 场景不订阅纪律）——白名单整表替换（Set 按数组身份 memo，
    // 逐帧零分配）+ 限免窗口旁路；未配置（undefined，主流情形）零开销
    // 透传（options 不分配，行为与现状全等）。
    const nowMs = Date.now();
    const remoteDetail = state.remoteGateConfig.detail;
    const premiumGate = premiumDetailGateUpdate(
      gate.active,
      state.entitlement,
      spec.bodyId,
      nowMs / 1000,
      remoteDetail === undefined
        ? undefined
        : {
            premiumBodyIds: remotePremiumBodyIdSet(remoteDetail.premiumBodyIds),
            freeWindowActive: remoteFreeScheduleActive(remoteDetail, nowMs),
          },
    );
    if (premiumGate.lockedHit) {
      if (!lockedReportedRef.current) {
        lockedReportedRef.current = true;
        state.reportLockedHint('detail', spec.bodyId);
      }
    } else {
      lockedReportedRef.current = false;
    }
    gateActiveRef.current = premiumGate.active;
    // 激活即声明持有权（已是本池最新持有者时跳过，渲染循环零分配）
    if (premiumGate.active && detailLayerHolderIds(spec.kind)[0] !== spec.bodyId) {
      claimDetailLayer(spec);
    }
    opacityRef.current = advanceFrameTransition(
      opacityRef.current,
      premiumGate.active ? 1 : 0,
      delta,
      DETAIL_LAYER_TRANSITION_SECONDS,
    );
    // 挂载判据：
    // - release-on-exit：淡出完成后再卸载（激活/释放无突变，无 LRU 保留）
    // - lru-retain：持有权即挂载（淡出保留，挤出/预算逐出立即卸载）
    const shouldMount =
      retention === 'lru-retain'
        ? detailLayerHolderIds(spec.kind).includes(spec.bodyId)
        : premiumGate.active || opacityRef.current > 0.001;
    if (retention === 'release-on-exit' && !shouldMount && mountedRef.current) {
      // 淡出完成：释放持有权（资源随卸载 dispose，注册表同步出账）
      releaseDetailLayer(spec.bodyId, spec.kind);
    }
    if (shouldMount !== mountedRef.current) {
      mountedRef.current = shouldMount;
      setActive(shouldMount);
    }
  });

  return { active, opacity01 };
}
