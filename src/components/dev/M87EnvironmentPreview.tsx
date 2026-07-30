'use client';

import type { JSX } from 'react';
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { GalaxyNearViewLayer } from '@/components/Scene/GalaxyNearView';
import { M87EnvironmentContent } from '@/components/Scene/M87Environment';
import { BlackHoleLensedLayer } from '@/components/Scene/BlackHoleLensedLayer';
import { M87JetKnots, RelativisticJet } from '@/components/Scene/ExtragalacticObjects';
import { getGalaxyById } from '@/data/galaxies';
import { galaxyPlaneSizeUnits } from '@/utils/universe';
import { nearViewReferenceRadiusLy } from '@/utils/galaxyNearView';
import { NEAR_VIEW_EXIT_RATIO } from '@/utils/nearView';
import {
  DETAIL_LAYER_TRANSITION_SECONDS,
  detailGateUpdate,
} from '@/utils/detailLayer';
import { advanceFrameTransition } from '@/utils/galacticFrame';
import {
  M87_CORE_LENSED_CONFIG,
  M87_CORE_LENSING_ENTER_UNITS,
  M87_CORE_RS_WORLD_UNITS,
} from '@/utils/m87Environment';

/**
 * M87 星系团中心语境预览（R5-4，`/dev/preview?body=m87`）
 *
 * 复用主场景组件组装（方案 H）：椭球近观粒子层（GalaxyNearViewLayer）+
 * 环境层内容（M87EnvironmentContent：球状星团/成员点缀/ICM）+ 节点喷流
 * （RelativisticJet + M87JetKnots）+ 核心推近 EHT 透镜层。
 *
 * 透镜层门控：预览无 store 跟随语义，以相机到原点距离对主场景阈值
 * （× 预览缩放）作同式滞回判定 + 0.5s 淡入淡出（detailGateUpdate /
 * advanceFrameTransition 同源纯函数）——"核心推近（EHT 光子环）"预设
 * 按钮把相机推入阈值内即见光子环，拉回全景即淡出。
 *
 * 姿态静态无自转（推近序列截图需固定姿态，登记）。仅 dev 动态 import。
 */

/** 预览目标直径（场景单位；与 GalaxyNearViewPreview 同值） */
const PREVIEW_DIAMETER_UNITS = 3.2;

/** 预览恒定全可见权重（模块级常量，避免每次渲染新建函数） */
const WEIGHT_FULL = (): number => 1;

/** 喷流方向（主场景 M87Jet 同值） */
const JET_DIRECTION = new THREE.Vector3(0.55, 0.75, -0.37).normalize();

export function M87EnvironmentPreview({
  values,
}: {
  values: Record<string, number>;
}): JSX.Element {
  const galaxy = getGalaxyById('m87')!;
  const sizeUnits = galaxyPlaneSizeUnits(galaxy.diameterLy);
  const scale = PREVIEW_DIAMETER_UNITS / sizeUnits;

  // 主场景同源比例（unitsPerLy 在缩放组内取主场景值；pointScale 取
  // 预览视空间值——与 GalaxyNearViewPreview 的 pointScaleOverride 同式）
  const unitsPerLy = useMemo(
    () => sizeUnits / 2 / nearViewReferenceRadiusLy('m87'),
    [sizeUnits],
  );
  const pointScale = PREVIEW_DIAMETER_UNITS * 4;

  // ---- 核心透镜层门控（主场景阈值 × 预览缩放，同式滞回 + 0.5s 淡入淡出）----
  const enterUnits = M87_CORE_LENSING_ENTER_UNITS * scale;
  const exitUnits = enterUnits * NEAR_VIEW_EXIT_RATIO;
  const gateRef = useRef(false);
  const fadeRef = useRef(0);
  const getGate01 = useMemo(() => () => fadeRef.current, []);

  useFrame(({ camera }, delta) => {
    const distance = camera.position.length();
    gateRef.current = detailGateUpdate(
      gateRef.current,
      true,
      distance,
      enterUnits,
      exitUnits,
    ).active;
    fadeRef.current = advanceFrameTransition(
      fadeRef.current,
      gateRef.current ? 1 : 0,
      delta,
      DETAIL_LAYER_TRANSITION_SECONDS,
    );
  });

  const gcCount = Math.round(values.gcCount ?? 2000);
  const membersVisible = (values.members ?? 1) >= 0.5;
  const icmOpacity = values.icmOpacity ?? 0.14;

  return (
    <group>
      <group scale={scale}>
        {/* 椭球近观粒子层（R4-10 Sérsic；椭圆类不套用影像，maps=null） */}
        <GalaxyNearViewLayer
          galaxy={galaxy}
          getOpacity={WEIGHT_FULL}
          pointScaleOverride={pointScale}
          maps={null}
        />
        {/* 环境层：球状星团 + 室女座成员点缀 + ICM 辉光 */}
        <M87EnvironmentContent
          getOpacity={WEIGHT_FULL}
          pointScale={pointScale}
          unitsPerLy={unitsPerLy}
          gcCount={gcCount}
          membersVisible={membersVisible}
          icmOpacity={icmOpacity}
        />
        {/* 节点喷流（主场景同参：单侧 1,500 units + HST-1 类亮节点） */}
        <RelativisticJet
          direction={JET_DIRECTION}
          lengthUnits={1500}
          color="#bfd8ff"
          bilateral={false}
          baseOpacity={0.7}
          getWeight={WEIGHT_FULL}
        />
        <M87JetKnots direction={JET_DIRECTION} lengthUnits={1500} getWeight={WEIGHT_FULL} />
      </group>
      {/* M87* 核心透镜层（缩放组外挂载：rsWorld 直接取预览尺度，
          防缩放组二次缩放；推近阈值内淡入） */}
      <BlackHoleLensedLayer
        config={M87_CORE_LENSED_CONFIG}
        rsWorld={M87_CORE_RS_WORLD_UNITS * scale}
        getWeight={WEIGHT_FULL}
        getGate01={getGate01}
      />
    </group>
  );
}

export default M87EnvironmentPreview;
