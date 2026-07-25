'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import type { MoonData, OrbitalElements } from '@/types';
import { useSimulationStore } from '@/store';
import { detailGateUpdateScoped } from '@/utils/planetDetail';
import {
  focusBodyIdForDetail,
  planetDetailScopeAllowed,
  satelliteDetailScopeAllowed,
} from '@/utils/bodyCycle';
import {
  DEG_TO_RAD,
  RAD_TO_DEG,
  normalizeAngle,
  orbitPositionWithPeriod,
  sampleOrbitPoints,
} from '@/utils/physics';
import {
  satelliteBodyDisplayRadius,
  satelliteOrbitDisplayRadius,
  satelliteScreenClampFactor,
  tidalLockedRotationAngle,
} from '@/utils/satellites';
import { rateClampFactor, timeCompressionForContinuousLevel } from '@/utils/time';
import { planetFrozen } from '@/utils/freezeGate';
import {
  clearRenderedSatellitePhase,
  setRenderedSatellitePhase,
} from '@/utils/satellitePhase';
import { detailTextureUrl, normalMapUrl, textureUrl } from '@/data/textures';
import { satelliteModelEntry } from '@/data/models';
import { getMoonById } from '@/data/moons';
import { useBitmapTexture } from '@/hooks/useBitmapTexture';
import { createBodyTextureCanvas } from '@/components/CelestialBody/proceduralTextures';
import { getTextureManager } from '@/components/CelestialBody/textureManager';
import { getSatelliteModelManager } from '@/components/CelestialBody/modelManager';
import { SatelliteModel } from '@/components/CelestialBody/SatelliteModel';
import { bodyDisplayRadius } from '@/utils/scale';

interface MoonProps {
  data: MoonData;
  /** 所属行星真实半径（km），用于分层缩放 */
  parentRadiusKm: number;
}

/**
 * 卫星（自然/人造，需求 3.1.1）：
 * - 广义开普勒轨道绕行星运动（周期来自真实数据）
 * - 潮汐锁定卫星（月球等）自转与公转同步，始终同一面朝向行星
 * - 快周期人造卫星（ISS 92 分钟）在高时间压缩比下做速率钳制（需求 3.3），
 *   钳制时向 store 上报"运动已减速显示"提示；渲染相位写入注册表
 *   （utils/satellitePhase）保证相机跟随与渲染位置一致（P7）
 * - 人造卫星近观精细模型（P7 §3.1）：近观门控（滞回）激活时懒加载 glTF
 *   （加载期间/失败时程序化几何组合降级），与远观盒体交叉淡化切换；
 *   离开 L1 语境立即释放模型显存
 * - 轨道线可显示/隐藏（行星视角下默认显示）
 *
 * 参考平面：本组件渲染于行星的参考平面组内（赤道面或黄道面，
 * 由父组件按 data.referencePlane 决定挂载位置）。
 */
export function Moon({ data, parentRadiusKm }: MoonProps): JSX.Element {
  const groupRef = useRef<THREE.Group>(null);
  const bodyRef = useRef<THREE.Mesh>(null);
  const clampedRef = useRef(false);
  /** 钳制期间的累计相位（弧度），保证降速显示时运动平滑无跳变 */
  const clampedPhaseRef = useRef<number | null>(null);
  const lastSimDaysRef = useRef<number | null>(null);
  const selectBody = useSimulationStore((s) => s.selectBody);
  const showSatelliteOrbits = useSimulationStore((s) => s.showSatelliteOrbits);
  const showLabels = useSimulationStore((s) => s.showLabels);
  // 卫星标签仅行星视角显示（避免太阳系视角下重叠杂乱）
  const isPlanetView = useSimulationStore((s) => s.viewLevel === 'L1');
  // 真实比例模式（需求 4.1）：轨道与本体按真实距离/半径线性映射
  const realScaleMode = useSimulationStore((s) => s.realScaleMode);

  const bodyRadius = satelliteBodyDisplayRadius(
    data.kind,
    data.radiusKm,
    realScaleMode,
    data.spanMeters,
  );
  // 视觉轨道要素：半长轴替换为分层缩放后的场景单位（登记于 utils/satellites.ts）
  const visualElements = useMemo<OrbitalElements>(
    () => ({
      semiMajorAxisAu: satelliteOrbitDisplayRadius(
        data.kind,
        parentRadiusKm,
        data.orbit.semiMajorAxisKm,
        realScaleMode,
      ),
      eccentricity: data.orbit.eccentricity,
      inclinationDeg: data.orbit.inclinationDeg,
      longitudeOfAscendingNodeDeg: data.orbit.longitudeOfAscendingNodeDeg,
      argumentOfPerihelionDeg: data.orbit.argumentOfPeriapsisDeg,
      meanAnomalyAtEpochDeg: data.orbit.meanAnomalyAtEpochDeg,
    }),
    [data, parentRadiusKm, realScaleMode],
  );

  // 渲染循环内复用的可变要素副本（避免每帧创建新对象）
  const frameElements = useMemo<OrbitalElements>(() => ({ ...visualElements }), [visualElements]);

  // 真实位图纹理（P3-1，月球）：行星视角才懒加载；失败/未就绪时程序化降级
  const bitmapTexture = useBitmapTexture(textureUrl(data.id, 'surface'), 2, isPlanetView);

  // P4 近观细节层（需求 4.7，月球）：4K 底图 + LOLA 法线贴图，
  // 相机-卫星距离进入近观阈值时激活（滞回状态机，与行星一致）
  const camera = useThree((s) => s.camera);
  const [detailActive, setDetailActive] = useState(false);
  const detailActiveRef = useRef(false);
  const worldPos = useMemo(() => new THREE.Vector3(), []);

  // P7 人造卫星近观精细模型门控（复用 P4 滞回状态机）：
  // 门控激活时懒加载 glTF 并与远观盒体交叉淡化；离开 L1 语境立即释放
  const isArtificial = data.kind === 'artificial';
  const [modelActive, setModelActive] = useState(false);
  const modelActiveRef = useRef(false);
  const modelFadeRef = useRef(0);
  const boxMaterialRef = useRef<THREE.MeshStandardMaterial>(null);
  // P7 标签避让：相机贴近卫星时隐藏标签（近距离下 Html distanceFactor
  // 会将标签放大到遮挡画面）
  const [labelHidden, setLabelHidden] = useState(false);
  const labelHiddenRef = useRef(false);
  const parentRadiusUnits = bodyDisplayRadius(parentRadiusKm, realScaleMode);
  const detailSurfaceUrl = detailTextureUrl(data.id, 'surface');
  const detailNormalUrl = normalMapUrl(data.id);
  const hasDetail = detailSurfaceUrl !== null || detailNormalUrl !== null;
  const detailSurfaceBitmap = useBitmapTexture(detailSurfaceUrl, 0, detailActive);
  const detailNormalBitmap = useBitmapTexture(detailNormalUrl, 0, detailActive);
  useEffect(() => {
    if (!hasDetail) return undefined;
    const bodyId = data.id;
    return () => {
      getTextureManager().releaseDetail(bodyId);
    };
  }, [data.id, hasDetail]);

  const proceduralTexture = useMemo(() => {
    if (data.kind === 'artificial' || bitmapTexture) return null;
    const canvas = createBodyTextureCanvas(data.id, data.color, 256);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }, [data.id, data.color, data.kind, bitmapTexture]);

  // 纹理分级（P4）：4K 细节层 → 2K 位图 → 程序化降级
  const texture =
    data.kind === 'artificial'
      ? null
      : ((detailActive ? detailSurfaceBitmap : null) ?? bitmapTexture ?? proceduralTexture);
  const normalTexture = detailActive ? detailNormalBitmap : null;

  useEffect(() => {
    return () => {
      // 位图纹理由 TextureManager 统一持有与释放，仅释放自建 canvas 纹理
      proceduralTexture?.dispose();
    };
  }, [proceduralTexture]);

  useFrame((_, delta) => {
    const state = useSimulationStore.getState();
    const { simDays, continuousLevel, speedMultiplier } = state;

    // 速率钳制（需求 3.3）：视觉转速 > 0.5 圈/秒时降速显示
    const compression = timeCompressionForContinuousLevel(continuousLevel);
    const factor = rateClampFactor(data.orbit.periodDays, compression, speedMultiplier);
    // 提示仅在卫星可见的层级显示（外层视角下太阳系内容已冻结隐藏；
    // R2-3：冻结判定收敛至 utils/freezeGate，与行星淡出-冻结同步）
    const clamped = factor < 1 && !planetFrozen(continuousLevel);
    if (clamped !== clampedRef.current) {
      clampedRef.current = clamped;
      state.setRateClampNotice(clamped);
    }

    // 轨道相位（平近点角，弧度）：
    // - 未钳制：严格按共享模拟时间轴求值（跨层级返回时位置一致，需求 3.3）
    // - 钳制中：按降速后的角速度增量累计（平滑，无因子变化导致的跳变）
    const meanMotion = (Math.PI * 2) / data.orbit.periodDays;
    const exactPhase = normalizeAngle(
      data.orbit.meanAnomalyAtEpochDeg * DEG_TO_RAD + meanMotion * simDays,
    );
    let phase: number;
    if (!clamped) {
      phase = exactPhase;
      clampedPhaseRef.current = null;
    } else {
      const last = lastSimDaysRef.current;
      if (clampedPhaseRef.current === null || last === null) {
        clampedPhaseRef.current = exactPhase;
      } else {
        clampedPhaseRef.current = normalizeAngle(
          clampedPhaseRef.current + meanMotion * (simDays - last) * factor,
        );
      }
      phase = clampedPhaseRef.current;
    }
    lastSimDaysRef.current = simDays;

    // 以当前相位求解开普勒方程得到位置（历元时刻取 0，相位即平近点角）
    frameElements.meanAnomalyAtEpochDeg = phase * RAD_TO_DEG;
    const p = orbitPositionWithPeriod(frameElements, data.orbit.periodDays, 0);
    if (groupRef.current) {
      // 参考平面局部坐标 → three.js（x-y 平面 → x-(-z)，z → y）
      groupRef.current.position.set(p.x, p.z, -p.y);
    }
    if (bodyRef.current && data.tidallyLocked) {
      // 潮汐锁定：自转角 = 轨道相位角 + π（始终同一面朝向行星）
      bodyRef.current.rotation.y = tidalLockedRotationAngle(phase);
    }

    // P7：人造卫星渲染相位写入注册表（速率钳制期间相机跟随与渲染一致）
    if (isArtificial) {
      setRenderedSatellitePhase(data.id, phase);
    }

    // P7 标签避让：相机贴近（距离 < max(1.2, 半径×6)）时隐藏卫星标签
    if (groupRef.current) {
      groupRef.current.getWorldPosition(worldPos);
      const distForLabel = camera.position.distanceTo(worldPos);
      const hideLabel = distForLabel < Math.max(1.2, bodyRadius * 6);
      if (hideLabel !== labelHiddenRef.current) {
        labelHiddenRef.current = hideLabel;
        setLabelHidden(hideLabel);
      }
    }

    // R2-2 §2.2-C 目标行星系统一致判定：焦点目标（飞往/跟随/L1 锚定）
    // 须与本卫星属同一行星系统，防运镜路径擦过其他天体时误激活近观细节
    const focusId = focusBodyIdForDetail(
      state.viewLevel,
      state.flyToBodyId,
      state.followBodyId,
      state.anchorBodyId,
    );
    const focusParentId = focusId ? (getMoonById(focusId)?.parentId ?? null) : null;

    // P7 人造卫星近观模型门控（滞回状态机，复用 P4 detailGateUpdate；
    // R2-2 叠加视角域门控：仅 L1 语境且焦点属于同一行星系统时可激活）
    if (isArtificial && groupRef.current) {
      groupRef.current.getWorldPosition(worldPos);
      const distToBody = camera.position.distanceTo(worldPos);
      // R2-2 §2.2-A：远观盒体同样接入角尺寸钳制（运镜路径贴近/穿过
      // 卫星轨道时盒体也不得超过屏幕高度约 10%）
      if (bodyRef.current) {
        const fovRad = THREE.MathUtils.degToRad(
          (camera as THREE.PerspectiveCamera).fov ?? 50,
        );
        const boxClamp = satelliteScreenClampFactor(distToBody, bodyRadius * 2.4, fovRad);
        bodyRef.current.scale.setScalar(boxClamp);
      }
      const gate = detailGateUpdateScoped(
        modelActiveRef.current,
        distToBody,
        Math.max(bodyRadius, 1e-6),
        continuousLevel,
        satelliteDetailScopeAllowed(state.viewLevel, focusId, focusParentId, data.parentId),
      );
      if (gate.active !== modelActiveRef.current) {
        modelActiveRef.current = gate.active;
        setModelActive(gate.active);
        if (gate.active) modelFadeRef.current = 0;
      }
      if (gate.releaseNow) {
        // 离开 L1 语境：立即释放 glTF 模型显存（P7 §4）
        const url = satelliteModelEntry(data.id)?.url;
        if (url) getSatelliteModelManager().release(url);
      }
      // 交叉淡化（LOD 切换无突变）：模型淡入、远观盒体淡出
      if (modelActiveRef.current && modelFadeRef.current < 1) {
        modelFadeRef.current = Math.min(1, modelFadeRef.current + delta / 0.35);
      }
      const boxMat = boxMaterialRef.current;
      if (boxMat) {
        const fade = modelActiveRef.current ? modelFadeRef.current : 0;
        boxMat.transparent = fade > 0;
        boxMat.opacity = 1 - fade;
      }
      if (bodyRef.current) {
        // 盒体完全淡出后隐藏（避免与模型叠加渲染）
        bodyRef.current.visible = !(modelActiveRef.current && modelFadeRef.current >= 1);
      }
    }

    // P4 近观细节门控（需求 4.7，月球）：相机-卫星距离滞回状态机；
    // R2-2 叠加目标行星系统一致显式判定（焦点在其他行星系统时不激活）
    if (hasDetail && groupRef.current) {
      groupRef.current.getWorldPosition(worldPos);
      const distToBody = camera.position.distanceTo(worldPos);
      const gate = detailGateUpdateScoped(
        detailActiveRef.current,
        distToBody,
        bodyRadius,
        continuousLevel,
        planetDetailScopeAllowed(focusId, focusParentId, data.parentId),
      );
      if (gate.active !== detailActiveRef.current) {
        detailActiveRef.current = gate.active;
        setDetailActive(gate.active);
        if (gate.active) {
          const urls = [detailSurfaceUrl, detailNormalUrl].filter(
            (u): u is string => u !== null,
          );
          getTextureManager().retainDetail(data.id, urls);
        }
      }
      if (gate.releaseNow) {
        getTextureManager().releaseDetail(data.id);
      }
    }
  });

  // 卸载时清除钳制提示
  useEffect(() => {
    return () => {
      if (clampedRef.current) {
        useSimulationStore.getState().setRateClampNotice(false);
      }
    };
  }, []);

  // P7：卸载时清除渲染相位注册并释放 glTF 模型
  useEffect(() => {
    if (!isArtificial) return undefined;
    const bodyId = data.id;
    return () => {
      clearRenderedSatellitePhase(bodyId);
      const url = satelliteModelEntry(bodyId)?.url;
      if (url) getSatelliteModelManager().release(url);
    };
  }, [data.id, isArtificial]);

  const orbitLine = useMemo(() => {
    const points = sampleOrbitPoints(visualElements, 128).map(
      (p) => new THREE.Vector3(p.x, p.z, -p.y),
    );
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({
      color: data.kind === 'artificial' ? '#7fd4c1' : '#88AAFF',
      transparent: true,
      opacity: 0.45,
    });
    return new THREE.Line(geometry, material);
  }, [visualElements, data.kind]);

  useEffect(() => {
    return () => {
      orbitLine.geometry.dispose();
      (orbitLine.material as THREE.Material).dispose();
    };
  }, [orbitLine]);

  return (
    <group>
      {showSatelliteOrbits && <primitive object={orbitLine} />}
      <group ref={groupRef} name={data.id}>
        <mesh
          ref={bodyRef}
          onClick={(e) => {
            e.stopPropagation();
            selectBody(data.id);
          }}
        >
          {data.kind === 'artificial' ? (
            <boxGeometry args={[bodyRadius * 2.4, bodyRadius, bodyRadius]} />
          ) : (
            <sphereGeometry args={[bodyRadius, 32, 32]} />
          )}
          {texture ? (
            // P4：近观激活时叠加法线贴图（月球环形山立体细节，LOLA 高程转换）
            <meshStandardMaterial
              map={texture}
              normalMap={normalTexture ?? undefined}
              roughness={0.9}
              metalness={0.02}
            />
          ) : (
            // 远观轻量表示保留微自发光保证可见性（P7 登记：真实航天器不发光，
            // 近观精细模型为纯反射光照，盒体在近观门控激活后交叉淡出）
            <meshStandardMaterial
              ref={boxMaterialRef}
              color={data.color}
              roughness={0.4}
              metalness={0.6}
              emissive={data.color}
              emissiveIntensity={0.25}
            />
          )}
        </mesh>
        {isArtificial && modelActive && (
          <SatelliteModel
            data={data}
            bodyRadius={bodyRadius}
            parentRadiusUnits={parentRadiusUnits}
            fadeRef={modelFadeRef}
            onClick={() => selectBody(data.id)}
          />
        )}
        {showLabels && isPlanetView && !modelActive && !labelHidden && (
          // P7 §3.5 标签避让：近观模型激活或相机贴近时隐藏本体标签
          // （近距离下 Html distanceFactor 缩放会放大遮挡模型；名称已由
          // HUD 跟随模式与天体切换控件显示），退出近观后恢复
          <Html
            position={[0, bodyRadius + 0.15, 0]}
            center
            distanceFactor={16}
            style={{ pointerEvents: 'none' }}
          >
            <span className="whitespace-nowrap text-[10px] text-gray-300/70">{data.nameZh}</span>
          </Html>
        )}
      </group>
    </group>
  );
}
