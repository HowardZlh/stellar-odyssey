'use client';


import type { JSX } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { MoonData } from '@/types';
import { useSimulationStore } from '@/store';
import {
  approachNearMagnification,
  nearMagnificationFrozen,
  satelliteNearMagnification,
  satelliteProximityFade01,
  satelliteScreenClampFactor,
} from '@/utils/satellites';
import {
  nadirAttitudeQuaternion,
  panelSunTrackAngleAboutZRad,
  panelSunTrackAngleRad,
} from '@/utils/satelliteAttitude';
import { earthShadowLight01, shadowDimFactor } from '@/utils/earthShadow';
import { satelliteModelEntry } from '@/data/models';
import { getSatelliteModelManager } from '@/components/CelestialBody/modelManager';
import {
  buildProceduralSatellite,
  collectPanelGroups,
  prepareGltfSatellite,
} from '@/components/CelestialBody/satelliteGeometry';

interface SatelliteModelProps {
  data: MoonData;
  /** 本体视觉半径（场景单位，模型整体跨度 = bodyRadius × 2.4，与远观盒体一致） */
  bodyRadius: number;
  /** 所属行星显示半径（场景单位，地影判定用） */
  parentRadiusUnits: number;
  /** 淡入进度 [0,1]（Moon.tsx 每帧驱动，与远观盒体交叉淡化，LOD 切换无突变） */
  fadeRef: MutableRefObject<number>;
  onClick: (e: { stopPropagation: () => void }) => void;
}

/** 姿态模式：对地定向（ISS/天宫/TDRS 天线朝地）或惯性固定（哈勃镜筒指向） */
function attitudeMode(bodyId: string): 'nadir' | 'inertial' {
  return bodyId === 'hubble' ? 'inertial' : 'nadir';
}

/**
 * 人造卫星近观精细模型（P7 §3.1）：
 * - glTF（NASA 公版，登记于 data/models.ts）优先；缺失/加载失败静默降级
 *   为程序化几何组合（satelliteGeometry.ts）
 * - 对地定向姿态（ISS/天宫/TDRS：−Y 指向地心、+X 沿飞行方向）；
 *   哈勃保持惯性固定姿态（镜筒指向恒定方向）
 * - 帆板对日跟踪（程序化模型的 sunTrackAxis 标记组；glTF 模型帆板已烘焙
 *   在整体网格中不单独跟踪，登记近似）
 * - 地影：卫星进入地球本影时变暗（utils/earthShadow，圆柱近似登记）
 * - 近观放大（登记）：相机贴近时平滑放大（satelliteNearMagnification）
 * - 反射光照：接入场景太阳点光源（光照方向与行星 terminator 统一——
 *   均以场景原点太阳为光源），无自发光
 */
export function SatelliteModel({
  data,
  bodyRadius,
  parentRadiusUnits,
  fadeRef,
  onClick,
}: SatelliteModelProps): JSX.Element {
  const camera = useThree((s) => s.camera);
  const containerRef = useRef<THREE.Group>(null);
  const entry = satelliteModelEntry(data.id);
  const url = entry?.url ?? null;

  // glTF 加载状态（订阅管理器；null url 直接走程序化路径）
  const [gltfScene, setGltfScene] = useState<THREE.Group | null>(() =>
    url ? getSatelliteModelManager().scene(url) : null,
  );
  useEffect(() => {
    if (!url) return undefined;
    const manager = getSatelliteModelManager();
    manager.request(url);
    setGltfScene(manager.scene(url));
    const unsubscribe = manager.subscribe(url, () => {
      setGltfScene(manager.scene(url));
    });
    return unsubscribe;
  }, [url]);

  // 模型对象：glTF 就绪 → 克隆独立实例（源场景只读，归 modelManager）；
  // 否则程序化几何组合
  const model = useMemo<THREE.Group>(() => {
    if (gltfScene) return prepareGltfSatellite(gltfScene, data.id);
    return buildProceduralSatellite(data.id);
  }, [gltfScene, data.id]);

  // 释放契约（谁创建谁释放）：
  // - 程序化分支：自建材质/几何全部 dispose
  // - glTF 分支：只 dispose 实例私有材质（prepareGltfSatellite 逐 mesh 克隆），
  //   共享 geometry/texture 归 modelManager release() 统一释放，勿碰
  useEffect(() => {
    const owned = model;
    const ownsGeometry = !gltfScene;
    return () => {
      owned.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (!mesh.isMesh) return;
        if (ownsGeometry) mesh.geometry.dispose();
        const material = mesh.material as THREE.Material | THREE.Material[];
        if (Array.isArray(material)) {
          material.forEach((m) => m.dispose());
        } else if (material) {
          material.dispose();
        }
      });
    };
  }, [model, gltfScene]);

  const panelGroups = useMemo(() => collectPanelGroups(model), [model]);

  // 帧循环复用对象（避免每帧分配）
  const worldPos = useMemo(() => new THREE.Vector3(), []);
  const parentWorldPos = useMemo(() => new THREE.Vector3(), []);
  const sunDirWorld = useMemo(() => new THREE.Vector3(), []);
  const sunDirModel = useMemo(() => new THREE.Vector3(), []);
  const worldQuat = useMemo(() => new THREE.Quaternion(), []);
  const invQuat = useMemo(() => new THREE.Quaternion(), []);
  const prevLocalPos = useRef<THREE.Vector3 | null>(null);
  const lastDim = useRef(-1);
  const fadeApplied = useRef(false);
  // R2-2 §2.2-B：平滑放大倍数（冻结/恢复双向限速逼近，无尺寸跳变）
  const magRef = useRef(1);
  // 视角锚点过渡计时（挂载时取当前 id、计时视为已过窗口，仅响应后续变化）
  const transitionRef = useRef({
    id: useSimulationStore.getState().viewTransitionId,
    elapsed: Number.POSITIVE_INFINITY,
  });
  // 飞往运镜计时（挂载常发生在运镜途中——运镜路径贴近卫星触发门控，
  // 故挂载即从 0 计时按冻结处理；稳态挂载多等一个窗口后平滑恢复，无跳变）
  const flyRef = useRef({
    id: useSimulationStore.getState().flyToRequestId,
    elapsed: 0,
  });

  // 惯性固定姿态（哈勃）：固定指向（一次性设定）
  useEffect(() => {
    if (attitudeMode(data.id) === 'inertial' && containerRef.current) {
      containerRef.current.rotation.set(0.35, 0.8, 0.15);
    }
  }, [data.id]);

  useFrame((_, delta) => {
    const container = containerRef.current;
    if (!container) return;
    const orbitGroup = container.parent;
    if (!orbitGroup) return;

    // 近观放大（登记的视觉夸大）：按相机-卫星距离平滑插值
    container.getWorldPosition(worldPos);
    const dist = camera.position.distanceTo(worldPos);

    // R2-2 §2.2-B：飞往运镜（2.5 秒窗口）/视角锚点过渡（2 秒窗口）内
    // 冻结近观放大为 1×，到达跟随后 ≤1 秒限速平滑恢复
    // （approachNearMagnification；flyToBodyId 飞抵后保留故以请求计时判定）
    const state = useSimulationStore.getState();
    if (state.viewTransitionId !== transitionRef.current.id) {
      transitionRef.current.id = state.viewTransitionId;
      transitionRef.current.elapsed = 0;
    } else if (Number.isFinite(transitionRef.current.elapsed)) {
      transitionRef.current.elapsed += delta;
    }
    if (state.flyToRequestId !== flyRef.current.id) {
      flyRef.current.id = state.flyToRequestId;
      flyRef.current.elapsed = 0;
    } else {
      flyRef.current.elapsed += delta;
    }
    const frozen = nearMagnificationFrozen(
      flyRef.current.elapsed,
      transitionRef.current.elapsed,
    );
    const magTarget = frozen ? 1 : satelliteNearMagnification(dist);
    magRef.current = approachNearMagnification(magRef.current, magTarget, delta);
    const mag = magRef.current;

    // R2-2 §2.2-A：角尺寸钳制——投影屏占比超屏幕高度约 10% 时按比例缩小
    // （模型归一化全展跨度 = scale × 2.4，与远观盒体一致）
    const fovRad = THREE.MathUtils.degToRad(
      (camera as THREE.PerspectiveCamera).fov ?? 50,
    );
    const clamp = satelliteScreenClampFactor(dist, bodyRadius * mag * 2.4, fovRad);
    const fade = Math.min(1, Math.max(0, fadeRef.current));
    const scale = bodyRadius * mag * clamp * (0.9 + 0.1 * fade);
    container.scale.setScalar(scale);

    // 淡入（LOD 切换无突变）：与远观盒体交叉淡化；
    // R2-2 §2.2-A：相机极近（穿模路径）时叠加平滑淡出（opacity → 0）
    const opacity = fade * satelliteProximityFade01(dist);
    if (opacity < 1 || fadeApplied.current) {
      fadeApplied.current = opacity < 1;
      model.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (!mesh.isMesh) return;
        const material = mesh.material as THREE.Material;
        if (!material) return;
        material.transparent = opacity < 1;
        material.opacity = opacity;
      });
    }

    // 对地定向姿态：位置/速度取自轨道组局部坐标（行星参考平面系）
    if (attitudeMode(data.id) === 'nadir') {
      const p = orbitGroup.position;
      const prev = prevLocalPos.current;
      if (prev) {
        const vx = p.x - prev.x;
        const vy = p.y - prev.y;
        const vz = p.z - prev.z;
        if (vx * vx + vy * vy + vz * vz > 1e-12) {
          const q = nadirAttitudeQuaternion(
            { x: p.x, y: p.y, z: p.z },
            { x: vx, y: vy, z: vz },
          );
          if (q) container.quaternion.set(q.x, q.y, q.z, q.w);
        }
        prev.copy(p);
      } else {
        prevLocalPos.current = new THREE.Vector3().copy(p);
      }
    }

    // 太阳方向（场景原点为太阳）→ 模型坐标系
    container.getWorldQuaternion(worldQuat);
    invQuat.copy(worldQuat).invert();
    sunDirWorld.copy(worldPos).multiplyScalar(-1).normalize();
    sunDirModel.copy(sunDirWorld).applyQuaternion(invQuat);

    // 帆板对日跟踪（简化为绕单轴，登记近似）
    for (const wing of panelGroups) {
      if (wing.userData.sunTrackAxis === 'x') {
        wing.rotation.x = panelSunTrackAngleRad(sunDirModel);
      } else {
        wing.rotation.z = panelSunTrackAngleAboutZRad(sunDirModel);
      }
    }

    // 地影（P7 可选项）：卫星相对行星中心位置 + 行星指向太阳方向
    const planetGroup = orbitGroup.parent;
    let dim = 1;
    if (planetGroup) {
      planetGroup.getWorldPosition(parentWorldPos);
      const rel = {
        x: worldPos.x - parentWorldPos.x,
        y: worldPos.y - parentWorldPos.y,
        z: worldPos.z - parentWorldPos.z,
      };
      const dLen = parentWorldPos.length();
      if (dLen > 1e-6) {
        const sunFromPlanet = {
          x: -parentWorldPos.x / dLen,
          y: -parentWorldPos.y / dLen,
          z: -parentWorldPos.z / dLen,
        };
        dim = shadowDimFactor(earthShadowLight01(rel, parentRadiusUnits, sunFromPlanet));
      }
    }
    // 亮度系数变化时应用到全部材质（基准色缓存于 userData）
    if (Math.abs(dim - lastDim.current) > 0.01) {
      lastDim.current = dim;
      model.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (!mesh.isMesh) return;
        const material = mesh.material as THREE.MeshStandardMaterial;
        if (!material || !material.color) return;
        if (!material.userData.baseColor) {
          material.userData.baseColor = material.color.clone();
        }
        material.color
          .copy(material.userData.baseColor as THREE.Color)
          .multiplyScalar(dim);
      });
    }
  });

  return (
    <group
      ref={containerRef}
      onClick={(e) => {
        e.stopPropagation();
        onClick(e);
      }}
    >
      <primitive object={model} />
    </group>
  );
}
