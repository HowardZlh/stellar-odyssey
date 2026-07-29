'use client';

import type { JSX } from 'react';
/**
 * 触须星系近观渲染组件（R4-22，IMPROVEMENT_REQUIREMENTS_4 §R4-22）
 *
 * 消费 `public/data/antennae.bin` 烘焙快照（Toomre & Toomre 1972 受限
 * 三体/测试粒子模拟，模拟参数登记见 scripts/bake-data/antennae.ts）：
 * 两核辉光 sprite + 双潮汐尾测试粒子 points——快照间线性插值随 simDays
 * 缓慢演化（时间映射登记见 utils/antennaeNearView 文件头）。
 *
 * 插值实现：顶点属性双快照布局（position = 快照 seg、aPosB = 快照
 * seg+1），shader 内 mix(position, aPosB, uMix)——每帧仅写 uniform，
 * 跨段时才重传两个属性缓冲（渲染循环零对象分配，附录 A §2）；
 * 自定义 shader 含 logdepthbuf include（附录 A §5 / Starfield 先例）。
 *
 * 布局/属性来自 utils/antennaeNearView 纯函数输出（组件只消费）；
 * geometry/material/CanvasTexture 卸载即 dispose（附录 A 内存管理）。
 */

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { createGlowSpriteCanvas } from '@/components/CelestialBody/proceduralTextures';
import type { AntennaeSnapshotsData } from '@/utils/bakedData';
import {
  antennaeCorePosition,
  antennaeSnapshotPhase,
  buildAntennaeParticleAttributes,
  writeAntennaeSnapshotPositions,
} from '@/utils/antennaeNearView';

// ---------------------------------------------------------------------------
// 双快照插值 points shader（软边圆点 + log depth 兼容，Pleiades 同系）
// ---------------------------------------------------------------------------

const ANTENNAE_POINTS_VERTEX = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  attribute vec3 aPosB;
  attribute float aSize;
  uniform float uMix;
  uniform float uScale;
  uniform float uSizeGain;
  varying vec3 vColor;
  void main() {
    vColor = color;
    // 快照线性插值（§R4-22：随 simDays 缓慢演化，无跳变）
    vec3 p = mix(position, aPosB, uMix);
    vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = aSize * uSizeGain * (uScale / -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;
    #include <logdepthbuf_vertex>
  }
`;

const ANTENNAE_POINTS_FRAGMENT = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_fragment>
  uniform float uOpacity;
  varying vec3 vColor;
  void main() {
    #include <logdepthbuf_fragment>
    float d = length(gl_PointCoord - vec2(0.5));
    float alpha = (1.0 - smoothstep(0.16, 0.5, d)) * uOpacity;
    if (alpha < 0.01) discard;
    gl_FragColor = vec4(vColor, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export interface AntennaeNearViewProps {
  /** 烘焙快照（useAntennaeSnapshots 输出；null 时消费方不挂载本组件） */
  data: AntennaeSnapshotsData;
  /** 基准半径（场景单位；主场景 = EXTRAGALACTIC_VIEW_RADIUS_UNITS，预览页 = 1） */
  baseRadiusUnits: number;
  /** 读取本帧不透明度权重（层级权重 × 近观权重） */
  getOpacity: () => number;
  /** 读取本帧 simDays（主场景 = store.simDays；预览页 = 虚拟时钟映射） */
  getSimDays: () => number;
  /** 读取粒径增益（预览页滑杆；主场景恒 1） */
  getSizeGain?: () => number;
}

/**
 * 两核 + 双潮汐尾粒子层（§R4-22 需求 2）：主场景近观与预览页共用。
 */
export function AntennaeNearView({
  data,
  baseRadiusUnits,
  getOpacity,
  getSimDays,
  getSizeGain,
}: AntennaeNearViewProps): JSX.Element {
  const coreARef = useRef<THREE.Sprite>(null);
  const coreBRef = useRef<THREE.Sprite>(null);
  /** 当前已上传属性的快照区间（-1 = 未上传，首帧强制上传） */
  const segRef = useRef(-1);
  /** 核位置写入的复用对象（渲染循环零分配） */
  const coreScratchRef = useRef({ x: 0, y: 0, z: 0 });

  // 全部快照按场景缩放预展开（换段时仅 set 拷贝，不再重算缩放）
  const scaledSnapshots = useMemo(() => {
    const out: Float32Array[] = [];
    for (let s = 0; s < data.snapshotCount; s += 1) {
      out.push(
        writeAntennaeSnapshotPositions(
          data,
          s,
          baseRadiusUnits,
          new Float32Array(data.particleCount * 3),
        ),
      );
    }
    return out;
  }, [data, baseRadiusUnits]);

  const { geometry, material } = useMemo(() => {
    const attrs = buildAntennaeParticleAttributes(data, baseRadiusUnits);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(scaledSnapshots[0]), 3),
    );
    geo.setAttribute(
      'aPosB',
      new THREE.BufferAttribute(new Float32Array(scaledSnapshots[1]), 3),
    );
    geo.setAttribute('color', new THREE.BufferAttribute(attrs.colors, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(attrs.sizes, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uMix: { value: 0 },
        uOpacity: { value: 0 },
        uScale: { value: 400 },
        uSizeGain: { value: 1 },
      },
      vertexShader: ANTENNAE_POINTS_VERTEX,
      fragmentShader: ANTENNAE_POINTS_FRAGMENT,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    return { geometry: geo, material: mat };
  }, [data, baseRadiusUnits, scaledSnapshots]);

  const coreTextures = useMemo(
    () => ({
      warm: new THREE.CanvasTexture(createGlowSpriteCanvas('#ffd9b8', 64)),
      cool: new THREE.CanvasTexture(createGlowSpriteCanvas('#c8d8ff', 64)),
    }),
    [],
  );

  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
      coreTextures.warm.dispose();
      coreTextures.cool.dispose();
    },
    [geometry, material, coreTextures],
  );

  useFrame((state) => {
    const phase = antennaeSnapshotPhase(getSimDays(), data.snapshotCount);
    // 跨段：重传两侧快照属性缓冲（预展开数组 set 拷贝）
    if (phase.seg !== segRef.current) {
      segRef.current = phase.seg;
      const posA = geometry.getAttribute('position') as THREE.BufferAttribute;
      const posB = geometry.getAttribute('aPosB') as THREE.BufferAttribute;
      (posA.array as Float32Array).set(scaledSnapshots[phase.seg]);
      (posB.array as Float32Array).set(scaledSnapshots[phase.seg + 1]);
      posA.needsUpdate = true;
      posB.needsUpdate = true;
    }
    const k = getOpacity();
    material.uniforms.uMix.value = phase.mix;
    material.uniforms.uOpacity.value = k;
    // 点大小随屏幕像素高度换算（Starfield/Pleiades 同式）
    material.uniforms.uScale.value = state.gl.domElement.height * 0.5;
    material.uniforms.uSizeGain.value = getSizeGain ? getSizeGain() : 1;
    // 两核辉光 sprite：插值位置 + 不透明度联动
    const scratch = coreScratchRef.current;
    const coreEdge = baseRadiusUnits * 0.6;
    const spriteA = coreARef.current;
    if (spriteA) {
      antennaeCorePosition(data, phase, 0, baseRadiusUnits, scratch);
      spriteA.position.set(scratch.x, scratch.y, scratch.z);
      if (spriteA.scale.x !== coreEdge) spriteA.scale.set(coreEdge, coreEdge, 1);
      (spriteA.material as THREE.SpriteMaterial).opacity = 0.85 * k;
    }
    const spriteB = coreBRef.current;
    if (spriteB) {
      antennaeCorePosition(data, phase, 1, baseRadiusUnits, scratch);
      spriteB.position.set(scratch.x, scratch.y, scratch.z);
      if (spriteB.scale.x !== coreEdge) spriteB.scale.set(coreEdge, coreEdge, 1);
      (spriteB.material as THREE.SpriteMaterial).opacity = 0.85 * k;
    }
  });

  return (
    <group>
      {/* 双潮汐尾测试粒子（快照插值演化） */}
      <points geometry={geometry} material={material} frustumCulled={false} />
      {/* 两核辉光（NGC 4038 暖 / NGC 4039 冷）；userData.nearLayer：
          宿主 AntennaeGalaxies 的静态层 traverse 减淡按此标记跳过 */}
      <sprite ref={coreARef} userData={{ nearLayer: true }}>
        <spriteMaterial
          map={coreTextures.warm}
          transparent
          opacity={0}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </sprite>
      <sprite ref={coreBRef} userData={{ nearLayer: true }}>
        <spriteMaterial
          map={coreTextures.cool}
          transparent
          opacity={0}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </sprite>
    </group>
  );
}
