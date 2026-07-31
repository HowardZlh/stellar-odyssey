'use client';

/**
 * 费米气泡（R5-6，IMPROVEMENT_REQUIREMENTS_5 §R5-6）
 *
 * 挂载于 `Scene/Galaxy.tsx` 根组银心（组本地原点）：银心上下双极椭球
 * 体积——64³ R8 单纹理双泡（utils/fermiBubbles 纯逻辑塑形，Su et al.
 * 2010 形态参数登记）经 R4-3 `VolumeMaterial` 直绘 raymarch，淡紫 →
 * 品红双色档极低密度弥散辉光（伽马射线可见光艺术化登记）。
 *
 * 渲染路径登记：直绘小体积（R5-5 LmcTarantula 同款先例）——L4 远观
 * 包围盒屏占比小，无需 R4-4 半分辨率 RT；非立方包围盒各向异性光程经
 * uWorldStepScale 修正（R5-2 先例）。不占 volume 池（随银河系组常驻
 * 挂载，仅 visible/uniform 门控，粒子/纹理预算 ≈262 KB 登记）。
 *
 * 可见性链路：银河系层级权重（Galaxy.tsx trapezoidWeight，getOpacity
 * 闭包注入）× 显示开关淡入淡出（store.showFermiBubbles，~0.8s 平滑）；
 * 默认可见度低（低 intensity/低密度），L4 近观银河系侧视可辨。
 * 淡入淡出经 uDensityScale × opacity（发射/自吸收同步趋零，无暗盒
 * 残影，LmcTarantula 同式登记）。
 *
 * 资源生命周期（附录 A §6）：密度纹理/体积材质（disposeVolumeMaterial
 * 托管蓝噪声）随组件卸载 dispose。
 * 渲染纪律（附录 A §2）：每帧仅 uniform/标量直写，零分配零随机。
 */

import type { JSX } from 'react';
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useSimulationStore } from '@/store';
import { buildDensityTexture, volumeSeed } from '@/utils/volume';
import {
  FERMI_BUBBLES_TEXTURE_SIZE,
  fermiBubblesBoxScaleUnits,
  fermiBubblesWorldStepScale,
  makeFermiBubblesSampler,
} from '@/utils/fermiBubbles';
import { advanceFrameTransition } from '@/utils/galacticFrame';
import {
  createVolumeMaterial,
  disposeVolumeMaterial,
} from '@/components/Scene/volumetric/VolumeMaterial';
import { UNIVERSE_RENDER_ORDER } from '@/utils/universeRenderOrder';
import { SCENE_UNITS_PER_LY } from '@/utils/scale';

/** 体积对象不参与射线检测 */
const NOOP_RAYCAST = (): void => {};

/** 淡紫（低密度端）→ 品红（高密度端）双色档（§R5-6 指定，目验调参） */
const FERMI_COLOR_A = '#8f6bdc';
const FERMI_COLOR_B = '#ff66cc';

/** 体积基础参数（目验调参登记：极低密度弥散辉光——"默认可见度低、
 * L4 近观可辨"验收口径；初值 1.5/0.85 无头目验双泡过于醒目（正视投影
 * 盖过银盘），下调至 1.2/0.5 弥散淡雅档；吸收弱档保持辉光通透） */
const FERMI_STEPS = 40;
const FERMI_DENSITY_SCALE = 1.2;
const FERMI_ABSORPTION = 0.6;
const FERMI_INTENSITY = 0.5;

/** 开关淡入淡出时长（秒） */
const FERMI_FADE_SECONDS = 0.8;

export interface FermiBubblesProps {
  /** 读取本帧银河系层级权重（Galaxy.tsx trapezoidWeight 闭包注入） */
  getOpacity: () => number;
}

/** 费米气泡双极体积（几何/材质/纹理随卸载 dispose） */
export function FermiBubbles({ getOpacity }: FermiBubblesProps): JSX.Element {
  const meshRef = useRef<THREE.Mesh>(null);
  const fadeRef = useRef(0);

  // 密度纹理 + 体积材质（确定性种子；挂载构建一次，64³ ≪100ms 免分帧）
  const { texture, material } = useMemo(() => {
    const tex = buildDensityTexture(
      FERMI_BUBBLES_TEXTURE_SIZE,
      makeFermiBubblesSampler(volumeSeed('fermi-bubbles')),
    );
    const mat = createVolumeMaterial({
      map: tex,
      steps: FERMI_STEPS,
      colorA: FERMI_COLOR_A,
      colorB: FERMI_COLOR_B,
      densityScale: FERMI_DENSITY_SCALE,
      absorption: FERMI_ABSORPTION,
      threshold: 0.5,
      intensity: FERMI_INTENSITY,
      worldStepScale: fermiBubblesWorldStepScale(),
    });
    return { texture: tex, material: mat };
  }, []);
  useEffect(
    () => () => {
      texture.dispose();
      disposeVolumeMaterial(material);
    },
    [texture, material],
  );

  // 包围盒世界尺寸（非立方：24,000 × 54,000 × 24,000 ly，静态）
  const boxScale = useMemo(() => fermiBubblesBoxScaleUnits(SCENE_UNITS_PER_LY), []);

  useFrame((_, delta) => {
    const show = useSimulationStore.getState().showFermiBubbles;
    fadeRef.current = advanceFrameTransition(
      fadeRef.current,
      show ? 1 : 0,
      delta,
      FERMI_FADE_SECONDS,
    );
    const opacity = getOpacity() * fadeRef.current;
    const mesh = meshRef.current;
    if (!mesh) return;
    mesh.visible = opacity > 0.001;
    if (mesh.visible) {
      // 淡入淡出经密度倍率（发射/自吸收同步趋零，无暗盒残影登记）
      material.uniforms.uDensityScale.value = FERMI_DENSITY_SCALE * opacity;
    }
  });

  return (
    <mesh
      ref={meshRef}
      scale={boxScale}
      // L4 透明层注册表（频闪修复）：原与体积合成并列 renderOrder=10
      // 存在同值深度歧义，错开为直绘发射体积档（早于尘埃盘合成 →
      // 被跟随星系尘埃按透射率压暗，与消光方案 a 物理一致）
      renderOrder={UNIVERSE_RENDER_ORDER.emissiveVolumes}
      material={material}
      raycast={NOOP_RAYCAST}
      visible={false}
    >
      <boxGeometry args={[1, 1, 1]} />
    </mesh>
  );
}
