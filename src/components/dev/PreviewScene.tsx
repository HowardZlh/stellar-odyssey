'use client';

import type { JSX, RefObject } from 'react';
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { StellarSurface } from '@/components/Scene/SpecialBodies';
import { stellarSphereSegments } from '@/utils/stellarSurface';
import type { PreviewEntry } from '@/utils/devPreview';
import { VolumeTestPreview } from '@/components/dev/VolumeTestPreview';

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
  /** 曝光（tone mapping exposure，经 ToneMapping(ACES) 效果在帧缓冲级生效） */
  exposure: number;
  /** HUD 虚拟时钟读数节点（每帧直写 textContent，不走 React state） */
  clockLabelRef?: RefObject<HTMLSpanElement | null>;
  /** HUD 体积质量档位读数节点（R4-4，仅体积类条目消费） */
  qualityLabelRef?: RefObject<HTMLSpanElement | null>;
}

/**
 * 预览层 useFrame 优先级：显式排在默认订阅者（0，含 StellarSurface 自身的
 * uTime 写入）之后、EffectComposer 渲染（1）之前，保证本层对 uniform 的
 * 覆写始终最后落笔——不依赖 React effect 挂载顺序的隐式行为（bug 修复）。
 */
const PREVIEW_OVERRIDE_PRIORITY = 0.5;

/** 预览自转基准角速度（rad/s，timeScale=1 档）：高于主场景观感基准，
 * 让时间流速滑杆的反馈数秒内肉眼可辨（bug 修复：原 0.05 过于缓慢） */
const PREVIEW_SPIN_RAD_PER_SEC = 0.15;

/** 预览恒定全可见权重（模块级常量，避免每次渲染新建函数） */
const WEIGHT_FULL = (): number => 1;

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
 * 滑杆调参路径（bug 修复：原实现经 props 触发 useMemo 高频重建 ShaderMaterial）：
 * StellarSurface 以默认 props 挂载一次（材质零重建），挂载时缓存其
 * ShaderMaterial 引用，随后每帧按滑杆值直写 uniform（uLimbU/uCellScale/
 * uConvection/uRedness），时间经虚拟时钟（timeScale 调制）覆写 uTime。
 */
function StellarSurfacePreview({
  values,
  clockLabelRef,
}: {
  values: Record<string, number>;
  clockLabelRef?: RefObject<HTMLSpanElement | null>;
}): JSX.Element {
  const groupRef = useRef<THREE.Group>(null);
  const materialRef = useRef<THREE.ShaderMaterial | null>(null);
  const virtualTimeRef = useRef(0);
  const clockTextRef = useRef('');
  const radius = 1.4;
  const segments = useMemo(() => stellarSphereSegments(radius * 30), [radius]);

  // 挂载时一次性缓存 StellarSurface 的 ShaderMaterial（材质 props 静态不重建，
  // 渲染循环零遍历/零闭包分配，附录 A §2）
  useEffect(() => {
    let found: THREE.ShaderMaterial | null = null;
    groupRef.current?.traverse((obj) => {
      const mat = (obj as THREE.Mesh).material as THREE.ShaderMaterial | undefined;
      if (!found && mat && mat.uniforms && mat.uniforms.uTime) {
        found = mat;
      }
    });
    materialRef.current = found;
    return () => {
      materialRef.current = null;
    };
  }, []);

  useFrame((_, delta) => {
    const timeScale = values.timeScale ?? 1;
    virtualTimeRef.current += delta * timeScale;
    const group = groupRef.current;
    const mat = materialRef.current;
    if (group) {
      group.rotation.y += delta * PREVIEW_SPIN_RAD_PER_SEC * timeScale;
    }
    if (mat) {
      mat.uniforms.uTime.value = virtualTimeRef.current;
      mat.uniforms.uOpacity.value = 1;
      mat.uniforms.uLimbU.value = values.limbU ?? 0.75;
      mat.uniforms.uCellScale.value = values.cellScale ?? 2.2;
      mat.uniforms.uConvection.value = values.convection ?? 0.7;
      mat.uniforms.uRedness.value = values.rednessStrength ?? 0.6;
    }
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
    <group ref={groupRef}>
      <StellarSurface
        getWeight={WEIGHT_FULL}
        radius={radius}
        segments={segments}
        color="#ff6a3c"
        limbU={0.75}
        cellScale={2.2}
        convection={0.7}
        rednessStrength={0.6}
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

export function PreviewScene({
  entry,
  values,
  exposure,
  clockLabelRef,
  qualityLabelRef,
}: PreviewSceneProps): JSX.Element {
  return (
    <>
      <ExposureSync exposure={exposure} />
      {entry.componentKey === 'stellar-surface' ? (
        <StellarSurfacePreview values={values} clockLabelRef={clockLabelRef} />
      ) : entry.componentKey === 'volume-raymarch-test' ? (
        <VolumeTestPreview
          values={values}
          clockLabelRef={clockLabelRef}
          qualityLabelRef={qualityLabelRef}
        />
      ) : (
        <mesh>
          <boxGeometry args={[1, 1, 1]} />
          <meshBasicMaterial color="#888" wireframe />
        </mesh>
      )}
    </>
  );
}
