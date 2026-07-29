'use client';

import type { JSX } from 'react';
/**
 * 星系团引力透镜预览场景（R4-23，`/dev/preview?body=cluster-lensing`）
 *
 * 与主场景共用 `Scene/ClusterLensingEffect` 的 SIS 屏幕空间 Effect
 * （由 DevPreviewHarness 挂入 EffectComposer，Bloom/ToneMapping 之前）。
 * 本组件只负责场景内容与持有者写入：团块弥散光晕（透镜体锚点）+
 * 确定性背景源 sprite（lensedBackgroundSources 同源布局按预览尺度
 * 缩放，世界系固定 → 绕行目验弧位置随视角一致）。
 *
 * 滑杆：爱因斯坦半径/透镜强度经持有者帧写直达 Effect uniform；
 * 背景源亮度帧写 sprite 材质（无重建）。参考网格开启时同被 UV 偏转，
 * 可直观检查折射域与爱因斯坦环位置。
 */

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import {
  CLUSTER_EINSTEIN_RADIUS_UNITS,
  lensedBackgroundSources,
  resetClusterLensingSource,
  writeClusterLensingSource,
} from '@/utils/clusterLensing';
import { createGlowSpriteCanvas } from '@/components/CelestialBody/proceduralTextures';

/** 预览默认爱因斯坦半径（场景单位；与 devPreview 滑杆默认值同值） */
const PREVIEW_EINSTEIN_RADIUS_UNITS = 2;

/** 背景源布局缩放：主场景布局（∝ CLUSTER_EINSTEIN_RADIUS_UNITS）→ 预览尺度 */
const PREVIEW_LAYOUT_SCALE = PREVIEW_EINSTEIN_RADIUS_UNITS / CLUSTER_EINSTEIN_RADIUS_UNITS;

export function ClusterLensingPreview({
  values,
}: {
  values: Record<string, number>;
}): JSX.Element {
  const groupRef = useRef<THREE.Group>(null);
  const valuesRef = useRef(values);
  valuesRef.current = values;

  // 与主场景同源的确定性背景源布局（附录 A §2），按预览尺度缩放；
  // z 取负：预览相机自 +z 观察原点，团块之后 = −z
  const sources = useMemo(
    () =>
      lensedBackgroundSources().map((s) => ({
        x: s.x * PREVIEW_LAYOUT_SCALE,
        y: s.y * PREVIEW_LAYOUT_SCALE,
        z: -s.z * PREVIEW_LAYOUT_SCALE,
        scale: s.scale * PREVIEW_LAYOUT_SCALE,
        warmth01: s.warmth01,
      })),
    [],
  );
  const textures = useMemo(
    () => ({
      warm: new THREE.CanvasTexture(createGlowSpriteCanvas('#ffe3c8', 64)),
      cool: new THREE.CanvasTexture(createGlowSpriteCanvas('#cfe0ff', 64)),
      core: new THREE.CanvasTexture(createGlowSpriteCanvas('#dfe6ff', 128)),
    }),
    [],
  );
  useEffect(
    () => () => {
      textures.warm.dispose();
      textures.cool.dispose();
      textures.core.dispose();
    },
    [textures],
  );
  // 卸载清理持有者（Effect 读到 present=false 即归零）
  useEffect(() => () => resetClusterLensingSource(), []);

  useFrame(() => {
    const v = valuesRef.current;
    // 持有者帧写：团块质心 = 原点，强度/爱因斯坦半径来自滑杆
    writeClusterLensingSource(
      0,
      0,
      0,
      v.strength ?? 1,
      v.einsteinRadius ?? PREVIEW_EINSTEIN_RADIUS_UNITS,
    );
    // 背景源亮度帧写（少量 sprite 遍历，无材质重建）
    const gain = v.sourceGain ?? 1;
    groupRef.current?.traverse((obj) => {
      if (obj instanceof THREE.Sprite) {
        const mat = obj.material as THREE.SpriteMaterial;
        mat.opacity = ((obj.userData.baseOpacity as number | undefined) ?? 0.8) * gain;
      }
    });
  });

  return (
    <group ref={groupRef}>
      {/* 团块弥散光晕（透镜体可见锚点，中心不随源亮度滑杆增益过曝） */}
      <sprite scale={[4, 4, 1]} userData={{ baseOpacity: 0.4 }}>
        <spriteMaterial
          map={textures.core}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </sprite>
      {/* 背景源：世界系固定于团块之后，被 SIS Effect 拉伸成切向弧/部分环 */}
      {sources.map((s, i) => (
        <sprite
          key={i}
          position={[s.x, s.y, s.z]}
          scale={[s.scale, s.scale, 1]}
          userData={{ baseOpacity: 0.9 }}
        >
          <spriteMaterial
            map={s.warmth01 < 0.5 ? textures.warm : textures.cool}
            transparent
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </sprite>
      ))}
    </group>
  );
}
