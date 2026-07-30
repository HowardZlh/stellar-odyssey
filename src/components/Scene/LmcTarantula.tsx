'use client';

/**
 * LMC 30 Doradus（蜘蛛星云）近观叠加层（R5-5 A，IMPROVEMENT_REQUIREMENTS_5 §R5-5）
 *
 * 挂载于 `GalaxyNearViewLayer` 朝向组内（LMC 近观激活 + R5-1 影像驱动
 * 就绪时）：在真实相对位置（SIMBAD → 盘面坐标换算，utils/lmcStructures）
 * 叠加小型体积发射区——48³ R8 密度纹理（复用 `makeSphericalFbmCloudSampler`
 * 球壳 + fBm 基元，勿新造塑形函数登记）经 R4-3 `VolumeMaterial` 直绘
 * raymarch（Hα 粉红 → 亮粉白双色档）+ 中心 R136 超星团蓝白亮核 glow
 * sprite ×1。尺度放大 3.5×（登记 utils/lmcStructures 文件头）。
 *
 * 渲染路径登记：直绘小体积（R4-3 预览先例）——包围盒屏占比小，无需
 * R4-4 半分辨率 RT；与 R5-2 体积尘埃盘（独立 RT + 合成，volume 池）
 * 共存：本层随 lmc particles 池细节层挂卸（GPU/粒子预算并入
 * `galaxyDetailLayerSpec('lmc')` 登记），不占 volume 池容量。
 * 淡入淡出：uDensityScale × opacity01（发射与自吸收同步淡出，透明度
 * 趋 0 即 discard 无暗盒残影）。
 *
 * 资源生命周期（附录 A §6）：密度纹理/体积材质（disposeVolumeMaterial
 * 托管蓝噪声）/sprite 纹理随组件卸载 dispose。
 * 渲染纪律（附录 A §2）：每帧仅 uniform/标量直写，零分配零随机。
 */

import type { JSX } from 'react';
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import {
  buildDensityTexture,
  makeSphericalFbmCloudSampler,
  volumeSeed,
} from '@/utils/volume';
import {
  createVolumeMaterial,
  disposeVolumeMaterial,
  VOLUME_RENDER_ORDER,
} from '@/components/Scene/volumetric/VolumeMaterial';
import { createGlowSpriteCanvas } from '@/components/CelestialBody/proceduralTextures';
import {
  TARANTULA_CLOUD_OPTIONS,
  TARANTULA_SCALE_BOOST_DEFAULT,
  TARANTULA_VOLUME_TEXTURE_SIZE,
  tarantulaBoxEdgeUnits,
  tarantulaDiskPositionLy,
  tarantulaVisualRadiusLy,
} from '@/utils/lmcStructures';

/** 细节层对象不参与射线检测（点选仍由星系贴图平面承担） */
const NOOP_RAYCAST = (): void => {};

/** Hα 粉红（低密度端）→ 亮粉白（R136 周边高密度端）双色档（目验调参） */
const TARANTULA_COLOR_A = '#ff6f9e';
const TARANTULA_COLOR_B = '#ffd9e4';

/** 体积基础参数（目验调参登记：吸收弱档——发射星云为主、少量自吸收；
 * 亮度/密度按默认放大档 5× 下"粉红发射区可辨"无头目验上调
 * 1.5→3.0/2.6→3.2——初值粉红区仅数像素被加性星光淹没） */
const TARANTULA_STEPS = 32;
const TARANTULA_DENSITY_SCALE = 3.2;
const TARANTULA_ABSORPTION = 1.2;
const TARANTULA_INTENSITY = 3.0;

/** R136 亮核 sprite 边长 = 可视化半径 × 本系数 */
const R136_SPRITE_EDGE_PER_RADIUS = 1.3;

export interface LmcTarantulaOverlayProps {
  /** 光年 → 场景单位比例（与近观粒子层同源，GalaxyNearView 注入） */
  unitsPerLy: number;
  /** 读取本帧不透明度权重（层级权重 × 近观激活权重） */
  getOpacity: () => number;
  /** 亮度倍率覆写（预览页滑杆；缺省 1） */
  getBoost?: () => number;
  /** 放大系数覆写（预览页滑杆；缺省 TARANTULA_SCALE_BOOST_DEFAULT） */
  getScaleBoost?: () => number;
}

/** 30 Dor 体积发射区 + R136 亮核（几何/材质/纹理随卸载 dispose） */
export function LmcTarantulaOverlay({
  unitsPerLy,
  getOpacity,
  getBoost,
  getScaleBoost,
}: LmcTarantulaOverlayProps): JSX.Element {
  const meshRef = useRef<THREE.Mesh>(null);
  const spriteRef = useRef<THREE.Sprite>(null);

  // 密度纹理 + 体积材质（确定性种子；挂载构建一次，48³ ≪100ms 免分帧）
  const { texture, material } = useMemo(() => {
    const tex = buildDensityTexture(
      TARANTULA_VOLUME_TEXTURE_SIZE,
      makeSphericalFbmCloudSampler({
        seed: volumeSeed('lmc-30dor'),
        ...TARANTULA_CLOUD_OPTIONS,
      }),
    );
    const mat = createVolumeMaterial({
      map: tex,
      steps: TARANTULA_STEPS,
      colorA: TARANTULA_COLOR_A,
      colorB: TARANTULA_COLOR_B,
      densityScale: TARANTULA_DENSITY_SCALE,
      absorption: TARANTULA_ABSORPTION,
      threshold: 0.5,
      intensity: TARANTULA_INTENSITY,
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

  const spriteTexture = useMemo(
    () => new THREE.CanvasTexture(createGlowSpriteCanvas('#cfe2ff', 64)),
    [],
  );
  useEffect(() => () => spriteTexture.dispose(), [spriteTexture]);

  // 30 Dor 盘面位置（场景单位；SIMBAD → 盘面换算，登记见 utils/lmcStructures）
  const position = useMemo<[number, number, number]>(() => {
    const p = tarantulaDiskPositionLy();
    return [p.xLy * unitsPerLy, 0, p.zLy * unitsPerLy];
  }, [unitsPerLy]);

  useFrame(() => {
    const opacity = getOpacity();
    const boost = getBoost ? getBoost() : 1;
    const scaleBoost = getScaleBoost ? getScaleBoost() : TARANTULA_SCALE_BOOST_DEFAULT;
    const visible = opacity > 0.001 && boost > 0.001 && scaleBoost > 0.001;
    const mesh = meshRef.current;
    if (mesh) {
      mesh.visible = visible;
      if (visible) {
        mesh.scale.setScalar(tarantulaBoxEdgeUnits(unitsPerLy, scaleBoost));
        // 淡入淡出经密度倍率（发射/自吸收同步趋零，无暗盒残影登记）
        material.uniforms.uDensityScale.value = TARANTULA_DENSITY_SCALE * opacity;
        material.uniforms.uIntensity.value = TARANTULA_INTENSITY * boost;
      }
    }
    const sprite = spriteRef.current;
    if (sprite) {
      sprite.visible = visible;
      if (visible) {
        const edge =
          tarantulaVisualRadiusLy(scaleBoost) * R136_SPRITE_EDGE_PER_RADIUS * unitsPerLy;
        sprite.scale.set(edge, edge, 1);
        (sprite.material as THREE.SpriteMaterial).opacity =
          0.95 * opacity * Math.min(1, boost);
      }
    }
  });

  return (
    <group position={position}>
      {/* Hα 粉红体积发射区（48³ 直绘 raymarch） */}
      <mesh
        ref={meshRef}
        renderOrder={VOLUME_RENDER_ORDER}
        material={material}
        raycast={NOOP_RAYCAST}
        visible={false}
      >
        <boxGeometry args={[1, 1, 1]} />
      </mesh>
      {/* R136 超星团蓝白亮核 */}
      <sprite ref={spriteRef} raycast={NOOP_RAYCAST} visible={false}>
        <spriteMaterial
          map={spriteTexture}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          opacity={0}
        />
      </sprite>
    </group>
  );
}
