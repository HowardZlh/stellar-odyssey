'use client';


import type { JSX } from 'react';
/**
 * L4 星系近观 3D 粒子层组件（R2-8 交付，R4-10 多分量渲染接入）
 *
 * 挂载于 Universe.tsx GalaxyObject 组内（星系本地坐标系），呈现纯逻辑
 * utils/galaxyNearView 生成的确定性多分量粒子结构（R4-9 组合入口）：
 * - 基础层（核球+盘+旋臂/团块云/Sérsic 椭球）：加性软圆点（R2-8 现状
 *   管线，颜色升级为老年盘底色梯度 + M31 核球偏黄）；
 * - HII 区 + 年轻星团：合入加性混合的第二 Points（不同 size/color
 *   通道：HII 粉色大颗粒放宽点径上限，星团蓝白小颗粒串）；
 * - 尘埃带：normal 混合暗色第三 Points，renderOrder 置于加性星光层
 *   之后——对先绘制的加性亮层做普通混合变暗，实现"吸光"暗纹观感
 *   （§R4-10 方案登记：加性混合无法画暗；Galaxy.tsx 银河系尘埃带同款先例）。
 *
 * 粒子静态（几何只建一次，渲染循环仅更新 uOpacity，零分配零随机）；
 * 粒子层朝向 = galaxyNearViewOrientation（R4-10：M31 真实倾角 77° 专属
 * 姿态，其余星系沿用 id 哈希）。卸载即 dispose 全部几何与材质（LRU
 * 挤出时由父组件卸载）。
 */

import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { GalaxyData } from '@/types';
import {
  galaxyNearViewOrientation,
  generateGalaxyNearViewCompositeAuto,
  isImageDrivenGalaxy,
  nearViewReferenceRadiusLy,
  type GalaxyCompositeOverrides,
  type GalaxyImageMaps,
  type GalaxyNearViewParticles,
} from '@/utils/galaxyNearView';
import { galaxyPlaneSizeUnits } from '@/utils/universe';
import { LmcTarantulaOverlay } from '@/components/Scene/LmcTarantula';

/** 尘埃暗纹层 renderOrder（晚于默认 0 的加性星光层与远观贴图平面） */
export const DUST_LAYER_RENDER_ORDER = 2;

/** 软圆点 shader 参数（层间差异经 uniform 注入，shader 源共享；
 * R5-4 起导出供 M87 环境层复用——"复用既有点云样式"，禁止两套 shader） */
export interface SoftPointsOptions {
  blending: THREE.Blending;
  /** gl_PointSize 上限（px）：基础层 6 与 R2-8 现状一致；HII 层放宽 */
  maxSizePx: number;
  /** 圆点 alpha = uOpacity × (alphaBase + alphaScale × falloff) */
  alphaBase: number;
  alphaScale: number;
  pointScale: number;
}

/** 与 Galaxy.tsx 银盘粒子同风格的软边圆点 shader（尺寸随距离衰减） */
export function createSoftPointsMaterial(opts: SoftPointsOptions): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: opts.blending,
    uniforms: {
      uOpacity: { value: 0 },
      uPointScale: { value: opts.pointScale },
      uMaxSize: { value: opts.maxSizePx },
      uAlphaBase: { value: opts.alphaBase },
      uAlphaScale: { value: opts.alphaScale },
    },
    vertexShader: /* glsl */ `
      attribute vec3 aColor;
      attribute float aSize;
      uniform float uPointScale;
      uniform float uMaxSize;
      varying vec3 vColor;

      void main() {
        vColor = aColor;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = clamp(aSize * (uPointScale / -mvPosition.z), 1.0, uMaxSize);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uOpacity;
      uniform float uAlphaBase;
      uniform float uAlphaScale;
      varying vec3 vColor;

      void main() {
        vec2 c = gl_PointCoord - vec2(0.5);
        float d2 = dot(c, c);
        if (d2 > 0.25) discard;
        float falloff = 1.0 - smoothstep(0.05, 0.25, d2);
        gl_FragColor = vec4(vColor, uOpacity * (uAlphaBase + uAlphaScale * falloff));
      }
    `,
  });
}

/** 粒子集（光年坐标）→ BufferGeometry（场景单位；boundingSphere 手设免计算；
 * R5-4 起导出供 M87 环境层复用（成员点缀传 unitsPerLy=1 直用场景单位） */
export function buildPointsGeometry(
  particles: GalaxyNearViewParticles,
  unitsPerLy: number,
  boundingRadiusUnits: number,
): THREE.BufferGeometry {
  const positions = new Float32Array(particles.count * 3);
  for (let i = 0; i < particles.count * 3; i += 1) {
    positions[i] = particles.positionsLy[i] * unitsPerLy;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aColor', new THREE.BufferAttribute(particles.colors, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(particles.sizes, 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), boundingRadiusUnits);
  return geo;
}

/** 合并多个分量粒子集（HII + 年轻星团合入同一加性 Points，attribute 拼接） */
function mergeParticles(sets: readonly GalaxyNearViewParticles[]): GalaxyNearViewParticles {
  let count = 0;
  for (const s of sets) count += s.count;
  const positionsLy = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  let offset = 0;
  for (const s of sets) {
    positionsLy.set(s.positionsLy, offset * 3);
    colors.set(s.colors, offset * 3);
    sizes.set(s.sizes, offset);
    offset += s.count;
  }
  return { count, positionsLy, colors, sizes };
}

interface GalaxyNearViewLayerProps {
  galaxy: GalaxyData;
  /** 读取本帧不透明度权重（宇宙层级淡入权重 × 近观激活权重） */
  getOpacity: () => number;
  /** 分量强度覆写（预览页滑杆专用；主场景不传，登记值驱动） */
  overrides?: GalaxyCompositeOverrides;
  /** 朝向覆写（预览页倾角滑杆专用；主场景不传 = galaxyNearViewOrientation） */
  orientationOverride?: [number, number, number];
  /** 点径缩放覆写（预览页缩放场景专用；主场景不传 = sizeUnits×4 现状公式） */
  pointScaleOverride?: number;
  /**
   * R5-1 影像权重图（useGalaxyImageMaps 产物）：就绪且属覆盖星系时
   * 切换影像驱动采样；null/undefined 降级 R4-9 参数化生成（登记）。
   */
  maps?: GalaxyImageMaps | null;
  /**
   * R5-2 体积尘埃盘互斥淡出权重读取（∈[0,1]，GalaxyDustVolumeLayer
   * fadeRef）：dust 暗粒子 uOpacity 乘 (1 - dim)——体积消光激活时暗
   * 粒子淡出（§0.3 方案 F 互斥登记），体积卸载/降级时权重回 0 恢复
   * R4-10 现状。不传 = 恒 0（零回退）。
   */
  getDustDim?: () => number;
  /** R5-5：30 Dor 亮度倍率覆写（预览页滑杆专用；主场景不传 = 1） */
  getTarantulaBoost?: () => number;
  /** R5-5：30 Dor 放大系数覆写（预览页滑杆专用；主场景不传 = 3.5 登记档） */
  getTarantulaScaleBoost?: () => number;
}

/** 近观多分量粒子层（几何/材质随组件卸载 dispose） */
export function GalaxyNearViewLayer({
  galaxy,
  getOpacity,
  overrides,
  orientationOverride,
  pointScaleOverride,
  maps,
  getDustDim,
  getTarantulaBoost,
  getTarantulaScaleBoost,
}: GalaxyNearViewLayerProps): JSX.Element {
  const orientation = useMemo(
    () => orientationOverride ?? galaxyNearViewOrientation(galaxy.id),
    [galaxy.id, orientationOverride],
  );

  const layers = useMemo(() => {
    // R5-1：影像权重图就绪 → 影像驱动采样；否则参数化降级（登记）
    const activeMaps = maps && isImageDrivenGalaxy(galaxy.id) ? maps : null;
    const composite = generateGalaxyNearViewCompositeAuto(galaxy.id, activeMaps, overrides);
    // 光年 → 场景单位：粒子参考半径对齐贴图平面半边长（同源公式，
    // 交叉淡出时 3D 结构与贴图平面尺寸一致无跳变）；影像驱动路径的
    // 参考半径 = 产物 meta 图半径（贴图平面 = 同源影像裁剪域，对应）
    const sizeUnits = galaxyPlaneSizeUnits(galaxy.diameterLy);
    const referenceRadiusLy = activeMaps
      ? activeMaps.mapRadiusLy
      : nearViewReferenceRadiusLy(galaxy.id);
    const unitsPerLy = sizeUnits / 2 / referenceRadiusLy;
    const pointScale = pointScaleOverride ?? sizeUnits * 4;

    // 基础层：R2-8 现状参数（加性、点径上限 6、alpha 0.35+0.65×falloff）
    const baseGeometry = buildPointsGeometry(composite.base, unitsPerLy, sizeUnits);
    const baseMaterial = createSoftPointsMaterial({
      blending: THREE.AdditiveBlending,
      maxSizePx: 6,
      alphaBase: 0.35,
      alphaScale: 0.65,
      pointScale,
    });

    // HII + 年轻星团：合入加性层不同 size/color 通道（HII 大颗粒放宽
    // 点径上限呈发射团辉斑、星团小颗粒串沿脊线）
    const dust = composite.components.find((c) => c.component === 'dust');
    const additiveSets = composite.components.filter((c) => c.component !== 'dust');
    const merged = mergeParticles(additiveSets);
    const emissiveGeometry =
      merged.count > 0 ? buildPointsGeometry(merged, unitsPerLy, sizeUnits) : null;
    const emissiveMaterial = emissiveGeometry
      ? createSoftPointsMaterial({
          blending: THREE.AdditiveBlending,
          maxSizePx: 16,
          alphaBase: 0.2,
          alphaScale: 0.8,
          pointScale,
        })
      : null;

    // 尘埃带：normal 混合暗色（renderOrder 置于加性层后，"吸光"暗纹）
    const dustGeometry =
      dust && dust.count > 0 ? buildPointsGeometry(dust, unitsPerLy, sizeUnits) : null;
    const dustMaterial = dustGeometry
      ? createSoftPointsMaterial({
          blending: THREE.NormalBlending,
          maxSizePx: 9,
          alphaBase: 0,
          alphaScale: 0.62,
          pointScale,
        })
      : null;

    return {
      baseGeometry,
      baseMaterial,
      emissiveGeometry,
      emissiveMaterial,
      dustGeometry,
      dustMaterial,
      // R5-5：30 Dor 叠加层消费（影像驱动激活时才挂载，降级零回退登记）
      unitsPerLy,
      imageDriven: activeMaps !== null,
    };
  }, [galaxy.id, galaxy.diameterLy, overrides, pointScaleOverride, maps]);

  useEffect(() => {
    return () => {
      layers.baseGeometry.dispose();
      layers.baseMaterial.dispose();
      layers.emissiveGeometry?.dispose();
      layers.emissiveMaterial?.dispose();
      layers.dustGeometry?.dispose();
      layers.dustMaterial?.dispose();
    };
  }, [layers]);

  useFrame(() => {
    const opacity = getOpacity();
    layers.baseMaterial.uniforms.uOpacity.value = opacity;
    if (layers.emissiveMaterial) {
      layers.emissiveMaterial.uniforms.uOpacity.value = opacity;
    }
    if (layers.dustMaterial) {
      // R5-2：体积尘埃盘激活时暗粒子互补淡出（互斥登记，见 props 注释）
      const dim = getDustDim ? getDustDim() : 0;
      layers.dustMaterial.uniforms.uOpacity.value = opacity * (1 - dim);
    }
  });

  return (
    <group rotation={orientation}>
      <points
        geometry={layers.baseGeometry}
        material={layers.baseMaterial}
        frustumCulled={false}
        raycast={() => null}
      />
      {layers.emissiveGeometry && layers.emissiveMaterial && (
        <points
          geometry={layers.emissiveGeometry}
          material={layers.emissiveMaterial}
          frustumCulled={false}
          raycast={() => null}
        />
      )}
      {layers.dustGeometry && layers.dustMaterial && (
        <points
          geometry={layers.dustGeometry}
          material={layers.dustMaterial}
          renderOrder={DUST_LAYER_RENDER_ORDER}
          frustumCulled={false}
          raycast={() => null}
        />
      )}
      {/* R5-5：LMC 30 Doradus 叠加层（真实相对位置的体积发射区 + R136
          亮核；影像驱动就绪才挂载——参数化降级无棒/亮区几何对应，登记） */}
      {galaxy.id === 'lmc' && layers.imageDriven && (
        <LmcTarantulaOverlay
          unitsPerLy={layers.unitsPerLy}
          getOpacity={getOpacity}
          getBoost={getTarantulaBoost}
          getScaleBoost={getTarantulaScaleBoost}
        />
      )}
    </group>
  );
}
