'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { MILKY_WAY } from '@/data/galaxies';
import { useSimulationStore } from '@/store';
import { DEG_TO_RAD } from '@/utils/physics';
import { SCENE_UNITS_PER_LY, trapezoidWeight } from '@/utils/scale';
import {
  ARM_PATTERN_SPEED_RAD_PER_MYR,
  DENSITY_WAVE_CONTRAST,
  ECLIPTIC_GALACTIC_TILT_DEG,
  GALACTIC_BULGE_RADIUS_LY,
  GALACTIC_DISK_RADIUS_LY,
  GALACTIC_DISK_THICKNESS_LY,
  GALACTIC_YEAR_MYR,
  generateGalaxyDiskParticles,
  simDaysToMyr,
  sunGalacticPositionLy,
} from '@/utils/galaxy';
import { createTrailBuffer, clearTrail, pushTrailPoint, trailToOrderedArray } from '@/utils/trail';
import { createGlowSpriteCanvas } from '@/components/CelestialBody/proceduralTextures';
import { SpecialBodies } from '@/components/Scene/SpecialBodies';
import { Supernova } from '@/components/Scene/Supernova';

/** 银盘粒子数（附录A：30,000–50,000） */
const DISK_PARTICLE_COUNT = 40000;
/** 尾迹采样间隔（百万年） */
const TRAIL_SAMPLE_MYR = 0.8;
/** 尾迹容量（约覆盖 1.4 个银河年） */
const TRAIL_CAPACITY = 400;
/** 预测线刷新阈值（百万年） */
const PREDICTION_REFRESH_MYR = 5;

/**
 * 银河系场景（需求 3.1.2）：
 * - 3D 棒旋结构：核球 + 银盘（4条主旋臂）+ 中心辉光；粒子较差自转
 *   （线速度平坦 ~220 km/s，角速度内圈大于外圈，顶点着色器逐帧推进）
 * - 太阳系绕银心运动：整个银河系组反向平移，使太阳系（场景原点）始终位于
 *   其银心系轨道对应位置 —— 跨层级缩放时太阳系位置不跳变（需求 3.1.4）
 * - 黄道面与银道面夹角 60.2°：银河系组整体倾斜
 * - "You are here" 标记（可开关）+ 运动方向箭头
 * - 波浪形轨迹：历史尾迹（环形缓冲实线，尾端渐隐）+ 未来预测线（虚线）
 */
export function Galaxy(): JSX.Element {
  const groupRef = useRef<THREE.Group>(null);
  const markerRef = useRef<THREE.Group>(null);
  const arrowRef = useRef<THREE.ArrowHelper>(null);
  const showYouAreHere = useSimulationStore((s) => s.showYouAreHere);
  // Html 标签不随父级 visible 隐藏，需单独按层级门控（银河系内容 L2/L3 边界起可见）
  const inGalaxyRange = useSimulationStore((s) => s.continuousLevel > 2.5);

  const tiltRad = ECLIPTIC_GALACTIC_TILT_DEG * DEG_TO_RAD;

  // ---------- 银盘粒子（确定性生成 + 较差自转着色器） ----------
  const { diskGeometry, diskMaterial } = useMemo(() => {
    const particles = generateGalaxyDiskParticles({
      count: DISK_PARTICLE_COUNT,
      seed: 20260722,
      armCount: MILKY_WAY.armNames.length,
      diskRadiusLy: GALACTIC_DISK_RADIUS_LY,
      thicknessLy: GALACTIC_DISK_THICKNESS_LY,
      bulgeRadiusLy: GALACTIC_BULGE_RADIUS_LY,
      bulgeFraction: 0.18,
      spiralTightness: 1.2,
      armSpreadRad: 0.28,
    });
    const n = particles.count;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    geo.setAttribute('aRadiusLy', new THREE.BufferAttribute(particles.radiiLy, 1));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(particles.phases, 1));
    geo.setAttribute('aHeightLy', new THREE.BufferAttribute(particles.heightsLy, 1));
    geo.setAttribute('aColor', new THREE.BufferAttribute(particles.colors, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(particles.sizes, 1));
    geo.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(0, 0, 0),
      GALACTIC_DISK_RADIUS_LY * SCENE_UNITS_PER_LY * 1.2,
    );

    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uMyr: { value: 0 },
        uOpacity: { value: 0 },
        uUnitsPerLy: { value: SCENE_UNITS_PER_LY },
        // 旋臂密度波（可选需求 3.1.2）：图案角速度与恒星公转角速度不同
        uPatternSpeed: { value: ARM_PATTERN_SPEED_RAD_PER_MYR },
        uWaveContrast: { value: DENSITY_WAVE_CONTRAST },
      },
      vertexShader: /* glsl */ `
        attribute float aRadiusLy;
        attribute float aPhase;
        attribute float aHeightLy;
        attribute vec3 aColor;
        attribute float aSize;
        uniform float uMyr;
        uniform float uUnitsPerLy;
        uniform float uPatternSpeed;
        uniform float uWaveContrast;
        varying vec3 vColor;
        varying float vWave;

        void main() {
          // 较差自转：平坦旋转曲线 v=220km/s → ω = v/r（内圈快、外圈慢）
          float omega = (220.0 * 3.3357) / max(aRadiusLy, 500.0);
          float angle = aPhase + omega * uMyr;
          vec3 pos = vec3(
            aRadiusLy * cos(angle),
            aHeightLy,
            -aRadiusLy * sin(angle)
          ) * uUnitsPerLy;
          vColor = aColor;
          // 旋臂密度波（与 utils/galaxy.densityWaveBrightness 公式一致）：
          // 对数螺旋图案以恒定角速度 uPatternSpeed 刚性旋转，
          // 恒星以 ω(r) 较差公转 → 恒星周期性穿越旋臂（增亮）
          float patternPhase = uPatternSpeed * uMyr + 1.2 * log(1.0 + aRadiusLy / 8000.0);
          vWave = 1.0 + uWaveContrast * cos(4.0 * (angle - patternPhase));
          vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
          // 远距离（L4）下限 1.2px，保证银河系整体形态仍可辨识
          gl_PointSize = clamp(aSize * (2600.0 / -mvPosition.z), 1.2, 6.0);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uOpacity;
        varying vec3 vColor;
        varying float vWave;

        void main() {
          vec2 c = gl_PointCoord - vec2(0.5);
          float d2 = dot(c, c);
          if (d2 > 0.25) discard;
          // 柔和圆点（中心亮边缘淡）；密度波调制亮度（vWave ∈ [1−c, 1+c]）
          float falloff = 1.0 - smoothstep(0.05, 0.25, d2);
          gl_FragColor = vec4(vColor * vWave, uOpacity * (0.35 + 0.65 * falloff));
        }
      `,
    });
    return { diskGeometry: geo, diskMaterial: mat };
  }, []);

  // ---------- 中心辉光（多层）与银心标记 ----------
  const glowTextures = useMemo(() => {
    const core = new THREE.CanvasTexture(createGlowSpriteCanvas('#ffe8c8', 256));
    const halo = new THREE.CanvasTexture(createGlowSpriteCanvas('#c8d4ff', 256));
    const marker = new THREE.CanvasTexture(createGlowSpriteCanvas('#7fffd4', 128));
    return { core, halo, marker };
  }, []);

  const coreSpriteRef = useRef<THREE.Sprite>(null);
  const haloSpriteRef = useRef<THREE.Sprite>(null);
  const markerSpriteRef = useRef<THREE.Sprite>(null);

  // ---------- 太阳系轨迹：历史尾迹 + 未来预测线 ----------
  const trail = useMemo(() => createTrailBuffer(TRAIL_CAPACITY), []);
  const lastSampleMyrRef = useRef<number | null>(null);

  const { trailGeometry, trailMaterial, trailLine } = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(TRAIL_CAPACITY * 3), 3),
    );
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(TRAIL_CAPACITY * 3), 3));
    geo.setDrawRange(0, 0);
    const mat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
    });
    const line = new THREE.Line(geo, mat);
    line.frustumCulled = false;
    return { trailGeometry: geo, trailMaterial: mat, trailLine: line };
  }, []);

  const { predictionGeometry, predictionMaterial, predictionLine } = useMemo(() => {
    const segments = 256;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array((segments + 1) * 3), 3),
    );
    const mat = new THREE.LineDashedMaterial({
      color: '#9fd8ff',
      transparent: true,
      opacity: 0.5,
      dashSize: 18,
      gapSize: 12,
    });
    const line = new THREE.Line(geo, mat);
    line.frustumCulled = false;
    return { predictionGeometry: geo, predictionMaterial: mat, predictionLine: line };
  }, []);
  const lastPredictionMyrRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      diskGeometry.dispose();
      diskMaterial.dispose();
      trailGeometry.dispose();
      trailMaterial.dispose();
      predictionGeometry.dispose();
      predictionMaterial.dispose();
      glowTextures.core.dispose();
      glowTextures.halo.dispose();
      glowTextures.marker.dispose();
    };
  }, [diskGeometry, diskMaterial, trailGeometry, trailMaterial, predictionGeometry, predictionMaterial, glowTextures]);

  const tmpLocal = useMemo(() => new THREE.Vector3(), []);
  const tmpWorld = useMemo(() => new THREE.Vector3(), []);
  const tiltEuler = useMemo(() => new THREE.Euler(tiltRad, 0, 0), [tiltRad]);

  /** 刷新未来预测线（一条银河年的波浪形轨迹，虚线） */
  const refreshPrediction = (myr: number): void => {
    const segments = 256;
    const pos = predictionGeometry.attributes.position as THREE.BufferAttribute;
    for (let s = 0; s <= segments; s += 1) {
      const t = myr + (s / segments) * GALACTIC_YEAR_MYR;
      const p = sunGalacticPositionLy(t * 365.25e6);
      pos.setXYZ(
        s,
        p.x * SCENE_UNITS_PER_LY,
        p.y * SCENE_UNITS_PER_LY,
        p.z * SCENE_UNITS_PER_LY,
      );
    }
    pos.needsUpdate = true;
    predictionLine.computeLineDistances();
    lastPredictionMyrRef.current = myr;
  };

  useFrame(() => {
    const state = useSimulationStore.getState();
    const { simDays, continuousLevel } = state;
    const group = groupRef.current;
    if (!group) return;

    // LOD：越过 L2/L3 边界（2.5，与视角标签一致）后淡入，L3/L4 完整可见
    // （L4 下银河系自旋仍可辨识；连续层级上限为 4，平台区延伸至 4 以上保证
    // L4 不淡出）。起点不得低于 2.5：否则太阳系视角下太阳邻域的银河粒子
    // 会贴着太阳显示，被误认为"柯伊伯带跑错位置"（bug 修复）
    const weight = trapezoidWeight(continuousLevel, 2.5, 2.9, 4.5, 5);
    group.visible = weight > 0.001;
    diskMaterial.uniforms.uOpacity.value = weight;
    if (!group.visible) return;

    const myr = simDaysToMyr(simDays);
    diskMaterial.uniforms.uMyr.value = myr;

    // 太阳系银心系位置（光年 → 场景单位）
    const sunLy = sunGalacticPositionLy(simDays);
    tmpLocal.set(
      sunLy.x * SCENE_UNITS_PER_LY,
      sunLy.y * SCENE_UNITS_PER_LY,
      sunLy.z * SCENE_UNITS_PER_LY,
    );

    // 银河系组平移：太阳系（场景原点）位于其轨道对应位置（嵌套一致性 3.1.4）
    group.rotation.copy(tiltEuler);
    tmpWorld.copy(tmpLocal).applyEuler(tiltEuler);
    group.position.set(-tmpWorld.x, -tmpWorld.y, -tmpWorld.z);

    // 历史尾迹采样（时间倒退或大跳变时清空，避免坐标残留）
    const lastSample = lastSampleMyrRef.current;
    if (lastSample === null || myr < lastSample || myr - lastSample > TRAIL_SAMPLE_MYR * 50) {
      clearTrail(trail);
      lastSampleMyrRef.current = myr;
      pushTrailPoint(trail, tmpLocal.x, tmpLocal.y, tmpLocal.z);
    } else if (myr - lastSample >= TRAIL_SAMPLE_MYR) {
      pushTrailPoint(trail, tmpLocal.x, tmpLocal.y, tmpLocal.z);
      lastSampleMyrRef.current = myr;
    }
    // 尾迹几何更新（尾端渐隐：颜色从暗到亮）
    const ordered = trailToOrderedArray(trail);
    const count = ordered.length / 3;
    const posAttr = trailGeometry.attributes.position as THREE.BufferAttribute;
    const colAttr = trailGeometry.attributes.color as THREE.BufferAttribute;
    for (let i = 0; i < count; i += 1) {
      posAttr.setXYZ(i, ordered[i * 3], ordered[i * 3 + 1], ordered[i * 3 + 2]);
      const fade = count > 1 ? i / (count - 1) : 1;
      colAttr.setXYZ(i, 0.35 * fade + 0.05, 0.75 * fade + 0.08, 0.55 * fade + 0.1);
    }
    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
    trailGeometry.setDrawRange(0, count);
    trailMaterial.opacity = 0.9 * weight;

    // 预测线（虚线）：时间推进超过阈值后刷新
    const lastPrediction = lastPredictionMyrRef.current;
    if (lastPrediction === null || Math.abs(myr - lastPrediction) > PREDICTION_REFRESH_MYR) {
      refreshPrediction(myr);
    }
    predictionMaterial.opacity = 0.5 * weight;

    // You are here 标记与运动方向箭头
    if (markerRef.current) {
      markerRef.current.position.copy(tmpLocal);
      markerRef.current.visible = state.showYouAreHere && weight > 0.05;
    }
    if (arrowRef.current) {
      // 运动方向：位置对时间的数值微分
      const ahead = sunGalacticPositionLy(simDays + 365.25e6 * 0.5);
      const dir = new THREE.Vector3(
        ahead.x - sunLy.x,
        ahead.y - sunLy.y,
        ahead.z - sunLy.z,
      ).normalize();
      arrowRef.current.setDirection(dir);
      arrowRef.current.visible = state.showYouAreHere && weight > 0.05;
    }
    // 中心辉光透明度
    if (coreSpriteRef.current) {
      (coreSpriteRef.current.material as THREE.SpriteMaterial).opacity = 0.9 * weight;
    }
    if (haloSpriteRef.current) {
      (haloSpriteRef.current.material as THREE.SpriteMaterial).opacity = 0.35 * weight;
    }
    if (markerSpriteRef.current) {
      (markerSpriteRef.current.material as THREE.SpriteMaterial).opacity = 0.95 * weight;
    }
  });

  const diskRadiusUnits = GALACTIC_DISK_RADIUS_LY * SCENE_UNITS_PER_LY;

  return (
    // 初始不可见：首帧 useFrame 前不渲染银河系内容（消除 L1/L2 下的闪现竞态）
    <group ref={groupRef} visible={false}>
      {/* 银盘粒子（棒旋结构 + 较差自转） */}
      <points geometry={diskGeometry} material={diskMaterial} />

      {/* 中心辉光（核球）与银晕光层 */}
      <sprite ref={coreSpriteRef} scale={[diskRadiusUnits * 0.35, diskRadiusUnits * 0.28, 1]}>
        <spriteMaterial
          map={glowTextures.core}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </sprite>
      <sprite ref={haloSpriteRef} scale={[diskRadiusUnits * 1.1, diskRadiusUnits * 0.9, 1]}>
        <spriteMaterial
          map={glowTextures.halo}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </sprite>

      {/* 特殊天体系统（需求 3.1.5，P2）：黑洞（银心人马座A*）、脉冲星、
          红巨星/蓝巨星/天狼星双星、星云类——银心系本地坐标，随组变换 */}
      <SpecialBodies />

      {/* 超新星爆炸动态事件（需求 3.1.5，P2）：自动/手动触发 + 永久遗迹 */}
      <Supernova />

      {/* 太阳系轨迹：历史尾迹（实线渐隐）+ 未来预测线（虚线） */}
      <primitive object={trailLine} />
      <primitive object={predictionLine} />

      {/* You are here 标记（可开关，需求 3.1.2） */}
      <group ref={markerRef} visible={showYouAreHere}>
        <sprite ref={markerSpriteRef} scale={[90, 90, 1]}>
          <spriteMaterial
            map={glowTextures.marker}
            transparent
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </sprite>
        <arrowHelper
          ref={arrowRef}
          args={[new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 0, 0), 160, 0x7fffd4, 40, 20]}
        />
        {inGalaxyRange && (
          <Html
            position={[0, 60, 0]}
            center
            distanceFactor={2600}
            style={{ pointerEvents: 'none' }}
          >
            <span className="whitespace-nowrap rounded bg-black/50 px-2 py-0.5 text-xs text-emerald-300">
              你在这里（太阳系）
            </span>
          </Html>
        )}
      </group>
    </group>
  );
}
