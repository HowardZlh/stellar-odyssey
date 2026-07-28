'use client';

import type { JSX } from 'react';
import { useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { StellarSurface } from '@/components/Scene/SpecialBodies';
import { stellarSphereSegments } from '@/utils/stellarSurface';
import type { PreviewEntry } from '@/utils/devPreview';

/**
 * 预览场景（R4-1）：按条目 componentKey 挂载对应细节组件，注入滑杆参数值。
 *
 * 本组件仅在 `/dev/preview` 动态 import 时加载（主 bundle 零增大）。不消费主
 * 场景 store / 音频 / 主循环；时间由本地 `timeScale` 参数驱动一个虚拟时钟。
 */
export interface PreviewSceneProps {
  entry: PreviewEntry;
  /** 当前滑杆值映射（key → value） */
  values: Record<string, number>;
  /** 曝光（tone mapping exposure） */
  exposure: number;
}

/** 曝光同步：把面板曝光写入 renderer（每帧廉价标量赋值，无对象分配） */
function ExposureSync({ exposure }: { exposure: number }): null {
  const gl = useThree((s) => s.gl);
  useFrame(() => {
    gl.toneMappingExposure = exposure;
  });
  return null;
}

/**
 * 参宿四恒星表面预览：复用现有 `StellarSurface`（管线验证样例）
 *
 * `StellarSurface` 的 uTime 取 `clock.elapsedTime` 且 getWeight 门控。预览页需要
 * 时间流速可调：这里用一个随 timeScale 累加的虚拟时钟覆写 material.uTime，
 * 并令 getWeight 恒为 1（预览始终完全可见）。
 */
function StellarSurfacePreview({ values }: { values: Record<string, number> }): JSX.Element {
  const groupRef = useRef<THREE.Group>(null);
  const virtualTimeRef = useRef(0);
  const radius = 1.4;
  const segments = useMemo(() => stellarSphereSegments(radius * 30), [radius]);

  const limbU = values.limbU ?? 0.75;
  const cellScale = values.cellScale ?? 2.2;
  const convection = values.convection ?? 0.7;
  const rednessStrength = values.rednessStrength ?? 0.6;
  const timeScale = values.timeScale ?? 1;

  // 覆写 StellarSurface 内部 useFrame 写入的 uTime：本组件 useFrame 在其后执行，
  // 用虚拟时钟（受 timeScale 调制）覆盖，实现时间流速可调。
  useFrame((_, delta) => {
    virtualTimeRef.current += delta * timeScale;
    const group = groupRef.current;
    if (!group) return;
    group.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      const mat = mesh.material as THREE.ShaderMaterial | undefined;
      if (mat && mat.uniforms && mat.uniforms.uTime) {
        mat.uniforms.uTime.value = virtualTimeRef.current;
        mat.uniforms.uOpacity.value = 1;
      }
    });
    group.rotation.y += delta * 0.05 * timeScale;
  });

  return (
    <group ref={groupRef}>
      <StellarSurface
        getWeight={() => 1}
        radius={radius}
        segments={segments}
        color="#ff6a3c"
        limbU={limbU}
        cellScale={cellScale}
        convection={convection}
        rednessStrength={rednessStrength}
      />
      {/* 外层弥散气体壳（与 RedGiant 现状观感一致） */}
      <mesh>
        <sphereGeometry args={[radius * 1.5, 32, 32]} />
        <meshBasicMaterial
          color="#ff6a3c"
          transparent
          opacity={0.12}
          side={THREE.BackSide}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

export function PreviewScene({ entry, values, exposure }: PreviewSceneProps): JSX.Element {
  return (
    <>
      <ExposureSync exposure={exposure} />
      {entry.componentKey === 'stellar-surface' ? (
        <StellarSurfacePreview values={values} />
      ) : (
        <mesh>
          <boxGeometry args={[1, 1, 1]} />
          <meshBasicMaterial color="#888" wireframe />
        </mesh>
      )}
    </>
  );
}
