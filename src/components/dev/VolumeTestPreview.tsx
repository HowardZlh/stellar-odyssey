'use client';

import type { JSX, RefObject } from 'react';
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import {
  buildDensityTexture,
  clampVolumeSteps,
  makeSphericalFbmCloudSampler,
  volumeSeed,
} from '@/utils/volume';
import {
  createVolumeMaterial,
  VOLUME_RENDER_ORDER,
} from '@/components/Scene/volumetric/VolumeMaterial';

/**
 * 体积渲染框架测试体（R4-3 框架检查点，`/dev/preview?body=volume-test`）
 *
 * 球形 fBm 密度云：96³ R8 密度纹理（确定性种子 = volumeSeed('volume-test')，
 * 双次进入形态一致）+ raymarch 材质（VolumeMaterial 工厂）。滑杆值每帧直写
 * uniform（R4-1 修复后的既定路径：材质零重建、渲染循环零分配）。
 *
 * 仅 dev 预览页动态 import 加载（主 bundle 零增大）；本阶段不接主场景（§R4-3）。
 */

/** 密度纹理边长（≤128 附录 A §1；96³ 兼顾细节与构建耗时） */
const VOLUME_TEST_TEXTURE_SIZE = 96;

/** 体积盒世界边长（单位盒经 mesh.scale 放大） */
const VOLUME_TEST_BOX_SIZE = 2.4;

/** 与 PreviewScene 一致：预览层 uniform 覆写排在默认订阅者后、Composer 前 */
const PREVIEW_OVERRIDE_PRIORITY = 0.5;

export interface VolumeTestPreviewProps {
  /** 当前滑杆值映射（key → value） */
  values: Record<string, number>;
  /** HUD 虚拟时钟读数节点（每帧直写 textContent，不走 React state） */
  clockLabelRef?: RefObject<HTMLSpanElement | null>;
}

export function VolumeTestPreview({
  values,
  clockLabelRef,
}: VolumeTestPreviewProps): JSX.Element {
  const virtualTimeRef = useRef(0);
  const clockTextRef = useRef('');

  // 密度纹理 + 材质：挂载时构建一次（确定性种子），卸载即 dispose（附录 A §6）
  const { texture, material } = useMemo(() => {
    const sampler = makeSphericalFbmCloudSampler({ seed: volumeSeed('volume-test') });
    const tex = buildDensityTexture(VOLUME_TEST_TEXTURE_SIZE, sampler);
    const mat = createVolumeMaterial({ map: tex });
    return { texture: tex, material: mat };
  }, []);

  useEffect(() => {
    return () => {
      material.dispose();
      texture.dispose();
    };
  }, [material, texture]);

  useFrame((_, delta) => {
    virtualTimeRef.current += delta;
    const u = material.uniforms;
    u.uTime.value = virtualTimeRef.current; // 预留 uniform（本阶段 shader 不消费）
    u.uSteps.value = clampVolumeSteps(values.steps ?? 64);
    u.uDensityScale.value = values.density ?? 2.2;
    u.uAbsorption.value = values.absorption ?? 5;
    u.uThreshold.value = values.threshold ?? 0.45;
    u.uIntensity.value = values.intensity ?? 1.2;
    // 双色：色相滑杆 → HSL（就地 setHSL，零分配）
    (u.uColorA.value as THREE.Color).setHSL(((values.hueA ?? 352) % 360) / 360, 0.9, 0.55);
    (u.uColorB.value as THREE.Color).setHSL(((values.hueB ?? 172) % 360) / 360, 0.85, 0.6);
    // HUD 虚拟时钟读数（0.1s 粒度，内容变化才写 DOM）
    const label = clockLabelRef?.current;
    if (label) {
      const text = virtualTimeRef.current.toFixed(1);
      if (text !== clockTextRef.current) {
        clockTextRef.current = text;
        label.textContent = text;
      }
    }
  }, PREVIEW_OVERRIDE_PRIORITY);

  return (
    <mesh
      material={material}
      renderOrder={VOLUME_RENDER_ORDER}
      scale={[VOLUME_TEST_BOX_SIZE, VOLUME_TEST_BOX_SIZE, VOLUME_TEST_BOX_SIZE]}
    >
      <boxGeometry args={[1, 1, 1]} />
    </mesh>
  );
}

export default VolumeTestPreview;
