'use client';

/**
 * R5-3 真实巡天目录点云（方案 G 渲染侧）
 *
 * 消费 `public/data/galaxy-catalog.bin`（2MRS，Huchra et al. 2012——来源/
 * 失真/去重登记见 scripts/bake-data/galaxyCatalog.ts 与 utils/galaxyCatalog
 * 文件头）：两级 Points——拉尼亚凯亚近域（≤80 Mpc）软圆点适度增大 +
 * 远景单像素，各一次 draw call（全目录共 2 次，≈43,500 顶点）。
 *
 * - 亮度档 → 顶点尺寸 + 颜色强度（加性混合下等效 alpha）；
 *   形态档 → 色调（椭圆偏黄/旋涡偏蓝白/未知中性）——属性由
 *   utils/galaxyCatalog.buildCatalogLodAttributes 纯函数一次构建；
 * - L4 窗口淡入与 Universe.tsx 同源（utils/universe.universeFadeWeight）；
 * - 哈勃膨胀联动：整体缩放与程序化宇宙网同式（hubbleScaleFactor）；
 * - 自定义 shader 含 logdepthbuf 三件 + tonemapping/colorspace 输出
 *   （附录 A §5 / Starfield 先例）；
 * - geometry/material 卸载即 dispose（附录 A 内存管理）；
 * - 产物缺失/加载失败时本组件不挂载（Universe.tsx 降级现状程序化宇宙网）。
 */

import type { JSX } from 'react';
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { GalaxyCatalogData } from '@/utils/bakedData';
import { buildCatalogLodAttributes } from '@/utils/galaxyCatalog';
import { hubbleScaleFactor, universeFadeWeight } from '@/utils/universe';
import { useSimulationStore } from '@/store';

const CATALOG_VERTEX = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  attribute float aSize;
  uniform float uPixelRatio;
  varying vec3 vColor;
  void main() {
    vColor = color;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uPixelRatio;
    gl_Position = projectionMatrix * mvPosition;
    #include <logdepthbuf_vertex>
  }
`;

const CATALOG_FRAGMENT = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_fragment>
  uniform float uOpacity;
  varying vec3 vColor;
  void main() {
    #include <logdepthbuf_fragment>
    float d = length(gl_PointCoord - vec2(0.5));
    float alpha = (1.0 - smoothstep(0.2, 0.5, d)) * uOpacity;
    if (alpha < 0.01) discard;
    gl_FragColor = vec4(vColor * alpha, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export interface GalaxyCatalogProps {
  /** 校验后的目录数据（null 时消费方不挂载本组件——降级登记） */
  data: GalaxyCatalogData;
}

function buildPoints(attrs: {
  count: number;
  positions: Float32Array;
  colors: Float32Array;
  sizes: Float32Array;
}): { points: THREE.Points; material: THREE.ShaderMaterial; geometry: THREE.BufferGeometry } {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(attrs.positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(attrs.colors, 3));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(attrs.sizes, 1));
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uOpacity: { value: 0 },
      uPixelRatio: { value: 1 },
    },
    vertexShader: CATALOG_VERTEX,
    fragmentShader: CATALOG_FRAGMENT,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  return { points, material, geometry };
}

/**
 * 真实巡天目录背景层（挂载于 Universe 组内；父组 visible 已按 L4 权重门控）
 */
export function GalaxyCatalog({ data }: GalaxyCatalogProps): JSX.Element {
  const groupRef = useRef<THREE.Group>(null);

  const { near, far } = useMemo(() => {
    const lod = buildCatalogLodAttributes(data);
    return { near: buildPoints(lod.near), far: buildPoints(lod.far) };
  }, [data]);

  useEffect(() => {
    return () => {
      near.geometry.dispose();
      near.material.dispose();
      far.geometry.dispose();
      far.material.dispose();
    };
  }, [near, far]);

  useFrame(({ gl }) => {
    const state = useSimulationStore.getState();
    const weight = universeFadeWeight(state.continuousLevel);
    const group = groupRef.current;
    if (!group) return;
    group.visible = weight > 0.001;
    if (!group.visible) return;
    // 哈勃膨胀联动（与程序化宇宙网同式，utils/universe.hubbleScaleFactor）
    group.scale.setScalar(hubbleScaleFactor(state.simDays));
    const pixelRatio = gl.getPixelRatio();
    // 透明度档（无头 Chrome 定量目验调参登记）：远景单像素点在加性混合下
    // 极易低于可见阈值——0.3 档实测仅 371 个可辨像素（远景几乎不可见），
    // 提至 0.75 后远景纤维/空带成结构主体；近域 0.95 略高保持室女座团突出
    near.material.uniforms.uOpacity.value = 0.95 * weight;
    near.material.uniforms.uPixelRatio.value = pixelRatio;
    far.material.uniforms.uOpacity.value = 0.75 * weight;
    far.material.uniforms.uPixelRatio.value = pixelRatio;
  });

  return (
    <group ref={groupRef} name="galaxy-catalog">
      <primitive object={near.points} />
      <primitive object={far.points} />
    </group>
  );
}
