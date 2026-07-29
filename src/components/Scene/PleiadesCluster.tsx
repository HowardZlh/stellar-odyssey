'use client';

import type { JSX } from 'react';
/**
 * 昴星团 Gaia 真实星表渲染组件（R4-17，IMPROVEMENT_REQUIREMENTS_4 §R4-17）
 *
 * 三件套（主场景 OpenCluster 昴星团分支与预览页共用，观感同源）：
 * - `PleiadesCatalogPoints`：成员星 points（每星独立粒径 shader——视星等→
 *   粒径/亮度；自定义 shader 含 logdepthbuf include，附录 A §5 / Starfield 先例）
 * - `PleiadesNamedStars`：9 颗命名亮星衍射星芒 sprite（复用
 *   proceduralTextures.createDiffractionSpikeCanvas）+ 悬停显示星名
 *   （小热区 + ClampedHtmlLabel，方案登记见 utils/pleiadesCatalog §6）
 * - `PleiadesReflectionNebula`：Merope/Maia/Alcyone/Electra 分层蓝色反射
 *   星云 sprite（尘埃散射星光微闪烁；方案登记见 utils/pleiadesCatalog §5）
 *
 * 布局/属性全部来自 utils/pleiadesCatalog 纯函数输出（组件只消费）；
 * geometry/material/CanvasTexture 卸载即 dispose（附录 A §6）；
 * getNebulaTexture 进程内缓存纹理共享复用、不 dispose。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { ClampedHtmlLabel } from '@/components/Scene/ClampedHtmlLabel';
import { createDiffractionSpikeCanvas } from '@/components/CelestialBody/proceduralTextures';
import { getNebulaTexture } from '@/components/CelestialBody/nebulaTextures';
import { blueGiantFlicker } from '@/utils/specialBodies';
import {
  pleiadesSkyViewRows,
  type PleiadesNamedPlacement,
  type PleiadesNebulaPlacement,
  type PleiadesStarAttributes,
} from '@/utils/pleiadesCatalog';

/**
 * 地球天空视图姿态四元数（utils/pleiadesCatalog.pleiadesSkyViewRows →
 * THREE 旋转；主场景/预览页共用——"自地球方向看"亮星构型与公版图像一致）
 */
export function pleiadesSkyViewQuaternion(): THREE.Quaternion {
  const { rowX, rowY, rowZ } = pleiadesSkyViewRows();
  const m = new THREE.Matrix4();
  // Matrix4.set 按行主序（rows 即旋转矩阵行向量）
  m.set(
    rowX.x, rowX.y, rowX.z, 0,
    rowY.x, rowY.y, rowY.z, 0,
    rowZ.x, rowZ.y, rowZ.z, 0,
    0, 0, 0, 1,
  );
  return new THREE.Quaternion().setFromRotationMatrix(m);
}

// ---------------------------------------------------------------------------
// 成员星 points shader（每星粒径属性 + 软边圆点 + log depth 兼容）
// ---------------------------------------------------------------------------

const CATALOG_POINTS_VERTEX = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  attribute float aSize;
  uniform float uScale;
  uniform float uSizeGain;
  varying vec3 vColor;
  void main() {
    vColor = color;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    // 世界单位粒径 × 距离衰减（对齐 PointsMaterial sizeAttenuation 语义）
    gl_PointSize = aSize * uSizeGain * (uScale / -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;
    #include <logdepthbuf_vertex>
  }
`;

const CATALOG_POINTS_FRAGMENT = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_fragment>
  uniform float uOpacity;
  varying vec3 vColor;
  void main() {
    #include <logdepthbuf_fragment>
    float d = length(gl_PointCoord - vec2(0.5));
    float alpha = (1.0 - smoothstep(0.18, 0.5, d)) * uOpacity;
    if (alpha < 0.01) discard;
    gl_FragColor = vec4(vColor, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export interface PleiadesCatalogPointsProps {
  /** 顶点属性（utils/pleiadesCatalog.buildPleiadesStarAttributes 输出切片） */
  attributes: PleiadesStarAttributes;
  /** 读取本帧不透明度权重（层级权重 × 近观权重） */
  getOpacity: () => number;
  /** 读取粒径增益（预览页滑杆；主场景恒 1） */
  getSizeGain?: () => number;
}

/** 成员星 points：真实 3D 位置 + 黑体色 + 每星粒径（§R4-17 需求 1） */
export function PleiadesCatalogPoints({
  attributes,
  getOpacity,
  getSizeGain,
}: PleiadesCatalogPointsProps): JSX.Element {
  const { geometry, material } = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(attributes.positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(attributes.colors, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(attributes.sizes, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uOpacity: { value: 0 },
        uScale: { value: 400 },
        uSizeGain: { value: 1 },
      },
      vertexShader: CATALOG_POINTS_VERTEX,
      fragmentShader: CATALOG_POINTS_FRAGMENT,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    return { geometry: geo, material: mat };
  }, [attributes]);

  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  useFrame((state) => {
    // 点大小随屏幕像素高度换算（Starfield 同式）
    material.uniforms.uScale.value = state.gl.domElement.height * 0.5;
    material.uniforms.uOpacity.value = getOpacity();
    material.uniforms.uSizeGain.value = getSizeGain ? getSizeGain() : 1;
  });

  return <points geometry={geometry} material={material} />;
}

// ---------------------------------------------------------------------------
// 命名亮星星芒 + 悬停星名
// ---------------------------------------------------------------------------

export interface PleiadesNamedStarsProps {
  placements: readonly PleiadesNamedPlacement[];
  getOpacity: () => number;
  /** 读取星芒尺寸增益（预览页滑杆；主场景恒 1） */
  getSpikeGain?: () => number;
  /** 悬停星名标签开关（预览页无主场景标签体系时可关） */
  interactive?: boolean;
}

/** 命名亮星：真实相对位置 + 衍射星芒 sprite + 悬停星名（§R4-17 需求 2） */
export function PleiadesNamedStars({
  placements,
  getOpacity,
  getSpikeGain,
  interactive = true,
}: PleiadesNamedStarsProps): JSX.Element {
  const spritesRef = useRef<THREE.Group>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const spikeTexture = useMemo(
    () => new THREE.CanvasTexture(createDiffractionSpikeCanvas('#dbe8ff', 128)),
    [],
  );
  useEffect(() => () => spikeTexture.dispose(), [spikeTexture]);

  useFrame(() => {
    const group = spritesRef.current;
    if (!group) return;
    const k = getOpacity();
    const gain = getSpikeGain ? getSpikeGain() : 1;
    for (let i = 0; i < group.children.length; i += 1) {
      const sprite = group.children[i] as THREE.Sprite;
      const p = placements[i];
      sprite.material.opacity = 0.9 * k;
      const s = p.spikeScaleUnits * gain;
      if (sprite.scale.x !== s) sprite.scale.set(s, s, 1);
    }
  });

  return (
    <group>
      <group ref={spritesRef}>
        {placements.map((p) => (
          <sprite key={p.name} position={[p.x, p.y, p.z]}>
            <spriteMaterial
              map={spikeTexture}
              transparent
              opacity={0}
              depthWrite={false}
              blending={THREE.AdditiveBlending}
            />
          </sprite>
        ))}
      </group>
      {interactive &&
        placements.map((p, i) => (
          <mesh
            key={p.name}
            position={[p.x, p.y, p.z]}
            onPointerOver={(e) => {
              e.stopPropagation();
              setHovered(i);
            }}
            onPointerOut={() => {
              setHovered((prev) => (prev === i ? null : prev));
            }}
          >
            <sphereGeometry args={[p.spikeScaleUnits * 0.28, 8, 8]} />
            <meshBasicMaterial transparent opacity={0} depthWrite={false} />
          </mesh>
        ))}
      {interactive && hovered !== null && (
        <ClampedHtmlLabel
          position={[
            placements[hovered].x,
            placements[hovered].y + placements[hovered].spikeScaleUnits * 0.55,
            placements[hovered].z,
          ]}
          distanceFactor={600}
          style={{ pointerEvents: 'none' }}
        >
          <span className="whitespace-nowrap rounded bg-black/50 px-1.5 py-0.5 text-xs text-sky-100">
            {placements[hovered].nameZh} {placements[hovered].name} · V{' '}
            {placements[hovered].vMag.toFixed(2)}
          </span>
        </ClampedHtmlLabel>
      )}
    </group>
  );
}

// ---------------------------------------------------------------------------
// 蓝色反射星云（分层 sprite，方案登记见 utils/pleiadesCatalog §5）
// ---------------------------------------------------------------------------

/** 蓝色反射星云纹理变体（进程内缓存共享，色调区别于发射星云红/青） */
function reflectionNebulaTextures(): readonly THREE.Texture[] {
  return [
    getNebulaTexture({
      size: 256,
      seed: 4171,
      innerColor: '#dbe6ff',
      outerColor: '#5a78c8',
      filamentStrength: 0.65,
      irregularity: 0.8,
      octaves: 5,
      shape: 'cloud',
    }),
    getNebulaTexture({
      size: 256,
      seed: 4172,
      innerColor: '#c4d6ff',
      outerColor: '#46609e',
      filamentStrength: 0.75,
      irregularity: 0.85,
      octaves: 5,
      shape: 'cloud',
    }),
    getNebulaTexture({
      size: 256,
      seed: 4173,
      innerColor: '#cfe0ff',
      outerColor: '#516dae',
      filamentStrength: 0.55,
      irregularity: 0.7,
      octaves: 5,
      shape: 'cloud',
    }),
  ];
}

export interface PleiadesReflectionNebulaProps {
  placements: readonly PleiadesNebulaPlacement[];
  getOpacity: () => number;
  /** 读取星云强度增益（预览页滑杆；主场景恒 1） */
  getStrength?: () => number;
}

/** 反射星云分层 sprite（星光散射微闪烁；§R4-17 需求 3） */
export function PleiadesReflectionNebula({
  placements,
  getOpacity,
  getStrength,
}: PleiadesReflectionNebulaProps): JSX.Element {
  const groupRef = useRef<THREE.Group>(null);
  const textures = useMemo(() => reflectionNebulaTextures(), []);

  useFrame(({ clock }) => {
    const group = groupRef.current;
    if (!group) return;
    const k = getOpacity() * (getStrength ? getStrength() : 1);
    for (let i = 0; i < group.children.length; i += 1) {
      const sprite = group.children[i] as THREE.Sprite;
      const p = placements[i];
      // 各宿主相位错开的微闪烁（星光散射，蓝巨星闪烁函数复用）
      sprite.material.opacity =
        p.opacity * blueGiantFlicker(clock.elapsedTime * 0.4 + i * 1.7) * k;
    }
  });

  return (
    <group ref={groupRef}>
      {placements.map((p, i) => (
        <sprite
          key={`${p.hostName}-${i}`}
          position={[p.x, p.y, p.z]}
          scale={[p.scaleUnits, p.scaleUnits, 1]}
        >
          <spriteMaterial
            map={textures[p.textureIndex]}
            rotation={p.rotationRad}
            transparent
            opacity={0}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </sprite>
      ))}
    </group>
  );
}
