'use client';


import type { JSX } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { ClampedHtmlLabel } from '@/components/Scene/ClampedHtmlLabel';
import * as THREE from 'three';
import type { GalaxyData } from '@/types';
import {
  GREAT_ATTRACTOR_DIRECTION,
  LANIAKEA,
  LG_CMB_VELOCITY_KM_S,
  LOCAL_GROUP_GALAXIES,
  M31_COMPANION_OFFSETS_LY,
  MAGELLANIC_STREAM,
  SAGITTARIUS_STREAM,
  SATELLITE_GALAXY_ORBITS,
} from '@/data/galaxies';
import { useSimulationStore } from '@/store';
import { cosmicDistanceToSceneUnits, lyToSceneUnits } from '@/utils/scale';
import { supergalacticPlanePointScene } from '@/utils/galaxyCatalog';
import { setObjectTreeRaycastEnabled } from '@/utils/raycastGate';
import { getSoftPointTexture } from '@/components/CelestialBody/sharedTextures';
import {
  M31_APPROACH_FLOW_COUNT,
  OBSERVABLE_UNIVERSE_RADIUS_LY,
  UNIVERSE_FADE,
  galaxyPlaneSizeUnits,
  generateCosmicWeb,
  hubbleScaleFactor,
  m31ApproachFlow01,
  magellanicStreamPointsLy,
  mergeGlowOpacity01,
  mwM31MergeCountdownMyr,
  satelliteGalaxyPositionLy,
  satelliteOrbitPointsLy,
  tidalStreamPointsLy,
  universeFadeWeight,
} from '@/utils/universe';
import {
  mergerEllipticalMix01,
  mergerStage,
  mergerStageLabelZh,
  mergerStarburst01,
  mergerTidalDistortion01,
  mwM31SignedSeparationLy,
  mwM31SignedSeparationSceneUnits,
} from '@/utils/galaxyMerger';
import {
  galaxyDetailLayerSpec,
  galaxySpriteImageUrl,
  resetGalaxyNearViewHolders,
} from '@/utils/galaxyNearView';
import { isDustVolumeGalaxy } from '@/utils/galaxyDustVolume';
import { useDetailLayer } from '@/hooks/useDetailLayer';
import { useGalaxyCatalog } from '@/hooks/useGalaxyCatalog';
import { useGalaxyImageMaps } from '@/hooks/useGalaxyImageMaps';
import { useBitmapTexture } from '@/hooks/useBitmapTexture';
import { GalaxyCatalog } from '@/components/Scene/GalaxyCatalog';
import { GalaxyNearViewLayer } from '@/components/Scene/GalaxyNearView';
import { GalaxyDustVolume } from '@/components/Scene/GalaxyDustVolumeLayer';
import {
  createGalaxySpriteCanvas,
  createGlowSpriteCanvas,
} from '@/components/CelestialBody/proceduralTextures';
import {
  AntennaeGalaxies,
  GammaRayBurst,
  LensingArcs,
  M87Jet,
  Quasar,
} from '@/components/Scene/ExtragalacticObjects';
import { M87Environment } from '@/components/Scene/M87Environment';

/**
 * 宇宙级内容 LOD 渐变区间（连续层级）：R5-3 起同源公式收敛至
 * utils/universe.universeFadeWeight / UNIVERSE_FADE（真实巡天目录层共用）
 */
const FADE = UNIVERSE_FADE;
const fadeWeight = universeFadeWeight;

interface GalaxyObjectProps {
  galaxy: GalaxyData;
}

/**
 * 单个河外星系：形态差异化贴图（旋涡/棒旋/椭圆/不规则，需求 3.1.3），
 * 位置每帧计算（M31 沿连线接近银河系；大小麦哲伦云绕银河系运动）。
 *
 * R2-8 近观升级：
 * - 贴图平面改 billboard 面向相机（薄片修复方案登记于 utils/galaxyNearView
 *   文件头：M31 真实倾角 77° 观测特征改由近观粒子层承载，艺术化差异已登记）；
 * - 飞往/跟随本星系且相机进入近观激活距离时，贴图平面交叉淡出到 3D 粒子
 *   近观层（GalaxyNearViewLayer），释放时淡入恢复；LRU 容量 1——最新激活
 *   星系挤出上一个持有者（挤出即卸载 dispose），远观非跟随保持贴图现状。
 */
function GalaxyObject({ galaxy }: GalaxyObjectProps): JSX.Element {
  const groupRef = useRef<THREE.Group>(null);
  const meshRef = useRef<THREE.Mesh>(null);
  const selectBody = useSimulationStore((s) => s.selectBody);
  const showLabels = useSimulationStore((s) => s.showLabels);
  // Html 标签不随父级 visible 隐藏，需单独按层级门控
  const inRange = useSimulationStore((s) => s.continuousLevel > FADE.start);
  // R2-8：跟随/飞往本星系期间隐藏其标签（R2-7 近观标签治理同款——近距下
  // distanceFactor 缩放呈大字号遮挡近观结构；信息面板已示名称）
  const focusedNow = useSimulationStore(
    (s) => s.followBodyId === galaxy.id || s.flyToBodyId === galaxy.id,
  );
  // R2-11：并入 Milkomeda 终态后隐藏 M31/伴星系标签（贴图已淡出，
  // 布尔选择器仅在过渡中点跨越时重渲染）
  const mergedAway = useSimulationStore(
    (s) =>
      (galaxy.id === 'm31' || galaxy.id === 'm32' || galaxy.id === 'm110') &&
      mergerEllipticalMix01(s.simDays) >= 0.5,
  );

  // ---- R2-8 近观门控（R4-2 起经统一细节层机制 hooks/useDetailLayer 挂接：
  // 滞回阈值 + 0.5s 淡入淡出 + LRU 保留（'lru-retain'）语义零回退）----
  const weightRef = useRef(0);
  const nearSpec = useMemo(() => galaxyDetailLayerSpec(galaxy.id), [galaxy.id]);
  const { active: nearMounted, opacity01: getNear01 } = useDetailLayer(nearSpec, {
    objectRef: groupRef,
    retention: 'lru-retain',
  });
  /** 近观层不透明度 = 宇宙层级淡入权重 × 近观激活权重 */
  const getNearOpacity = useCallback(
    () => weightRef.current * getNear01(),
    [getNear01],
  );
  /** R5-2 体积尘埃盘视觉淡入权重（GalaxyDustVolumeLayer 输出；
   * dust 暗粒子互斥淡出消费，体积未挂载/降级时恒 0 零回退） */
  const dustVolumeFadeRef = useRef(0);
  const getDustDim = useCallback(() => dustVolumeFadeRef.current, []);
  const getWeight = useCallback(() => weightRef.current, []);

  // R5-1：近观影像权重图懒加载（近观层激活时才 fetch/解码；
  // 加载完成前与失败时为 null → GalaxyNearViewLayer 参数化降级，登记）
  const imageMaps = useGalaxyImageMaps(nearMounted ? galaxy.id : null);

  const canvasTexture = useMemo(() => {
    // M31/M33 专属形态（P6 §3.4，与通用旋涡星系区分）
    const variant =
      galaxy.id === 'm31' ? 'm31' : galaxy.id === 'm33' ? 'm33' : undefined;
    const canvas = createGalaxySpriteCanvas(
      galaxy.morphology,
      galaxy.morphology === 'elliptical' ? '#ffe2b8' : '#cfd8ff',
      256,
      20260722,
      variant,
    );
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }, [galaxy.morphology, galaxy.id]);

  useEffect(() => {
    return () => {
      canvasTexture.dispose();
    };
  }, [canvasTexture]);

  // R5-1 远景贴图源选择（§R5-1 E）：覆盖星系影像贴图优先（经共享
  // textureManager 懒加载并计入既有纹理预算/进度体系；L4 淡入域内才
  // 请求），加载完成前与未覆盖星系降级程序化 canvas（覆盖清单登记于
  // galaxySpriteImageUrl）。billboard/尺寸/淡入淡出逻辑零改动。
  const spriteBitmap = useBitmapTexture(galaxySpriteImageUrl(galaxy.id), 6, inRange);
  const texture = spriteBitmap ?? canvasTexture;

  // 视觉尺寸：直径相对银河系换算（同源公式 utils/universe.galaxyPlaneSizeUnits，
  // 登记：×0.55 抑制压缩距离下的透视夸大）
  const sizeUnits = galaxyPlaneSizeUnits(galaxy.diameterLy);

  useFrame(({ camera }) => {
    const state = useSimulationStore.getState();
    const group = groupRef.current;
    if (!group) return;
    const weight = fadeWeight(state.continuousLevel);
    weightRef.current = weight;
    group.visible = weight > 0.001;
    // Raycaster 不检查 visible：淡出后禁用 raycast，避免 L2/L3 下隐形星系拦截点击
    setObjectTreeRaycastEnabled(group, weight > 0.05);
    if (!group.visible) return;

    const { simDays } = state;
    if (galaxy.id === 'm31') {
      // 银河系—仙女座相互接近 + 合并后回摆振荡（R2-11：签名分离距离，
      // 穿越后 M31 在初始方向另一侧，utils/galaxyMerger 同源公式）
      const d = mwM31SignedSeparationSceneUnits(simDays);
      group.position.set(
        galaxy.direction.x * d,
        galaxy.direction.y * d,
        galaxy.direction.z * d,
      );
    } else if (galaxy.id === 'm32' || galaxy.id === 'm110') {
      // M31 伴星系（可选需求）：随 M31 一同接近/回摆（示意偏移已登记）
      const m31Data = LOCAL_GROUP_GALAXIES.find((g) => g.id === 'm31');
      if (m31Data) {
        const d = mwM31SignedSeparationSceneUnits(simDays);
        const offset = M31_COMPANION_OFFSETS_LY[galaxy.id];
        group.position.set(
          m31Data.direction.x * d + lyToSceneUnits(offset.x),
          m31Data.direction.y * d + lyToSceneUnits(offset.y),
          m31Data.direction.z * d + lyToSceneUnits(offset.z),
        );
      }
    } else if (galaxy.id === 'lmc' || galaxy.id === 'smc' || galaxy.id === 'sagittarius-dwarf') {
      // 卫星星系绕银河系运动（R2-10：direction 自洽轨道，t=0 位置 =
      // direction×distance 与静态首帧一致；人马座矮星系极轨道缓慢运动）
      const orbit = SATELLITE_GALAXY_ORBITS[galaxy.id];
      const p = satelliteGalaxyPositionLy(
        galaxy.distanceLy,
        orbit.periodMyr,
        galaxy.direction,
        orbit.inclinationDeg,
        simDays,
      );
      group.position.set(lyToSceneUnits(p.x), lyToSceneUnits(p.y), lyToSceneUnits(p.z));
    }
    // 其余星系静态（初始 position；M32/M110 随 M31、宇宙网静止属预期，
    // 面板"运动（模拟）"行登记，R2-10）

    // R2-8 近观门控/LRU 已迁移至 useDetailLayer（R4-2，本 useFrame 前
    // 同帧先行更新）；此处仅消费 getNear01() 做贴图交叉淡出
    if (meshRef.current) {
      // billboard 面向相机（薄片修复，登记见组件头注释）；
      // 近观层激活时贴图交叉淡出（释放时随 near01 回落自动淡入）
      meshRef.current.quaternion.copy(camera.quaternion);
      const mat = meshRef.current.material as THREE.MeshBasicMaterial;
      let opacity = weight * (1 - getNear01());
      // R2-11 合并演化：M31 及伴星系随终态过渡淡出并入 Milkomeda
      // （椭球终态由银河系粒子盘着色器承载）；M31 贴图穿越期潮汐拉伸 +
      // 星暴时刻蓝白偏色（艺术化登记于 utils/galaxyMerger 文件头）
      if (galaxy.id === 'm31' || galaxy.id === 'm32' || galaxy.id === 'm110') {
        opacity *= 1 - mergerEllipticalMix01(state.simDays);
        if (galaxy.id === 'm31') {
          const tidal = mergerTidalDistortion01(state.simDays);
          const burst = mergerStarburst01(state.simDays);
          meshRef.current.scale.set(1 + 0.55 * tidal, 1 - 0.28 * tidal, 1);
          mat.color.setRGB(1 - 0.22 * burst, 1 - 0.08 * burst, 1);
        }
      }
      mat.opacity = opacity;
    }
  });

  const staticDistance = cosmicDistanceToSceneUnits(galaxy.distanceLy);

  return (
    <group
      ref={groupRef}
      position={[
        galaxy.direction.x * staticDistance,
        galaxy.direction.y * staticDistance,
        galaxy.direction.z * staticDistance,
      ]}
      name={galaxy.id}
    >
      <mesh
        ref={meshRef}
        onClick={(e) => {
          e.stopPropagation();
          selectBody(galaxy.id);
        }}
      >
        <planeGeometry args={[sizeUnits, sizeUnits]} />
        <meshBasicMaterial
          map={texture}
          transparent
          depthWrite={false}
          side={THREE.DoubleSide}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
      {/* R2-8 近观 3D 粒子层（LRU 容量 1；卸载即 dispose）；
          R5-1：影像权重图就绪时切换影像驱动采样（缺失降级参数化） */}
      {nearMounted && (
        <GalaxyNearViewLayer
          galaxy={galaxy}
          getOpacity={getNearOpacity}
          maps={imageMaps}
          getDustDim={getDustDim}
        />
      )}
      {/* R5-2 体积尘埃盘（视线消光）：覆盖星系（m31/m33/lmc）经
          useDetailLayer volume 池（容量 1，与星云体积层互逐）门控；
          影像产物缺失时不挂载（dust 暗粒子保持 R4-10 现状，登记） */}
      {isDustVolumeGalaxy(galaxy.id) && (
        <GalaxyDustVolume
          galaxy={galaxy}
          groupRef={groupRef}
          maps={imageMaps}
          getWeight={getWeight}
          fadeRef={dustVolumeFadeRef}
        />
      )}
      {showLabels && inRange && !focusedNow && !mergedAway && (
        // R3-4：近距反向缩放钳制（焦点隐藏 R2-8 保留）
        <ClampedHtmlLabel
          position={[0, sizeUnits * 0.55, 0]}
          distanceFactor={9000}
          style={{ pointerEvents: 'none' }}
        >
          <span className="whitespace-nowrap text-xs text-gray-200/80">{galaxy.nameZh}</span>
        </ClampedHtmlLabel>
      )}
    </group>
  );
}

/**
 * 宇宙级场景（需求 3.1.3）：
 * - 本星系群成员（真实相对距离/大小，距离对数压缩已登记于 utils/scale.ts）
 * - 银河系—仙女座接近轨迹线 + 碰撞倒计时提示
 * - 本星系群整体本动：速度矢量箭头 + 数值标签（不实际移动场景，避免坐标漂移）
 * - 宇宙网大尺度结构：星系团（节点）—纤维—空洞，确定性算法
 * - 拉尼亚凯亚超星系团边界示意 + 巨引源标记
 *
 * 参考系（3.1.3 参考系定义）：L4 使用本星系群质心系的银河系中心近似
 * （银河系保持原点，M31 以相对速度接近，本动以矢量表达）。
 */
export function Universe(): JSX.Element {
  const groupRef = useRef<THREE.Group>(null);
  const mergeLabelRef = useRef<HTMLSpanElement>(null);
  const webRef = useRef<THREE.Points>(null);
  const mergeGlowRef = useRef<THREE.Sprite>(null);
  const showVelocityVectors = useSimulationStore((s) => s.showVelocityVectors);
  const showLabels = useSimulationStore((s) => s.showLabels);
  // Html 标签不随父级 visible 隐藏，需单独按层级门控
  const inRange = useSimulationStore((s) => s.continuousLevel > FADE.start);

  // ---------- 真实巡天目录（R5-3：2MRS 点云；进入 L4 淡入窗口才加载） ----------
  const showGalaxyCatalog = useSimulationStore((s) => s.showGalaxyCatalog);
  const galaxyCatalog = useGalaxyCatalog(inRange);
  /** 目录激活 = 加载成功 × 显示开关（关闭/降级时程序化宇宙网恢复主层亮度） */
  const catalogActive = galaxyCatalog !== null && showGalaxyCatalog;
  const catalogActiveRef = useRef(false);
  catalogActiveRef.current = catalogActive;

  // ---------- 宇宙网（确定性，节点—纤维—空洞） ----------
  const { webGeometry, webMaterial } = useMemo(() => {
    const web = generateCosmicWeb({
      seed: 20260724,
      nodeCount: 56,
      minRadiusUnits: 13500,
      maxRadiusUnits: 19500,
      linksPerNode: 2,
      galaxiesPerLink: 42,
      galaxiesPerNode: 60,
      filamentJitterUnits: 260,
      clusterRadiusUnits: 320,
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(web.galaxyPositions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(web.galaxyColors, 3));
    const mat = new THREE.PointsMaterial({
      size: 55,
      map: getSoftPointTexture(),
      vertexColors: true,
      transparent: true,
      opacity: 0,
      sizeAttenuation: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    return { webGeometry: geo, webMaterial: mat };
  }, []);

  // ---------- MW–M31 接近轨迹线（虚线预测线） ----------
  const m31 = useMemo(() => LOCAL_GROUP_GALAXIES.find((g) => g.id === 'm31'), []);
  const lmc = useMemo(() => LOCAL_GROUP_GALAXIES.find((g) => g.id === 'lmc'), []);
  const sgr = useMemo(
    () => LOCAL_GROUP_GALAXIES.find((g) => g.id === 'sagittarius-dwarf'),
    [],
  );
  /** 潮汐流上次采样的模拟时间（暂停时跳过重采样，渲染循环纪律） */
  const lastStreamSimDaysRef = useRef(Number.NaN);
  const { approachGeometry, approachMaterial } = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(2 * 3), 3));
    const mat = new THREE.LineDashedMaterial({
      color: '#ffb27f',
      transparent: true,
      opacity: 0,
      dashSize: 260,
      gapSize: 180,
    });
    return { approachGeometry: geo, approachMaterial: mat };
  }, []);
  const approachLine = useMemo(() => {
    const line = new THREE.Line(approachGeometry, approachMaterial);
    line.frustumCulled = false;
    return line;
  }, [approachGeometry, approachMaterial]);

  // ---------- 拉尼亚凯亚边界示意（R5-3：改置于真实超星系平面） ----------
  const laniakeaRadius = cosmicDistanceToSceneUnits(LANIAKEA.diameterLy / 2);
  const { boundaryGeometry, boundaryMaterial } = useMemo(() => {
    const segments = 128;
    const positions = new Float32Array((segments + 1) * 3);
    for (let s = 0; s <= segments; s += 1) {
      const a = (s / segments) * Math.PI * 2;
      // R5-3 对齐核对：边界环由场景 XZ 平面改置真实超星系平面（SGZ=0，
      // 室女座团 SGB ≈ −2.3° 落在该面内 → 环穿过目录室女座超密度处；
      // 相对银盘面倾角 ≈ 84.5° 为真实几何，登记于 utils/galaxyCatalog 文件头）
      const p = supergalacticPlanePointScene(laniakeaRadius, a);
      positions[s * 3] = p.x;
      positions[s * 3 + 1] = p.y;
      positions[s * 3 + 2] = p.z;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.LineBasicMaterial({
      color: '#6a5a9a',
      transparent: true,
      opacity: 0,
    });
    return { boundaryGeometry: geo, boundaryMaterial: mat };
  }, [laniakeaRadius]);
  /** 边界标签落点：超星系平面环上 0.72R 处（与环同面，抬升 800 单位避让） */
  const laniakeaLabelPosition = useMemo<[number, number, number]>(() => {
    const p = supergalacticPlanePointScene(laniakeaRadius * 0.72, 0);
    return [p.x, p.y + 800, p.z];
  }, [laniakeaRadius]);
  const boundaryLine = useMemo(
    () => new THREE.Line(boundaryGeometry, boundaryMaterial),
    [boundaryGeometry, boundaryMaterial],
  );

  // ---------- 可观测宇宙边界示意（可选需求 3.1.3） ----------
  const observableRadius = cosmicDistanceToSceneUnits(OBSERVABLE_UNIVERSE_RADIUS_LY);
  const { observableGeometry, observableMaterial } = useMemo(() => {
    const segments = 160;
    const positions = new Float32Array((segments + 1) * 3);
    for (let s = 0; s <= segments; s += 1) {
      const a = (s / segments) * Math.PI * 2;
      positions[s * 3] = Math.cos(a) * observableRadius;
      positions[s * 3 + 1] = 0;
      positions[s * 3 + 2] = Math.sin(a) * observableRadius;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.LineBasicMaterial({
      color: '#8a4a5a',
      transparent: true,
      opacity: 0,
    });
    return { observableGeometry: geo, observableMaterial: mat };
  }, [observableRadius]);
  const observableLine = useMemo(() => {
    const line = new THREE.Line(observableGeometry, observableMaterial);
    line.frustumCulled = false;
    return line;
  }, [observableGeometry, observableMaterial]);

  // ---------- 卫星星系轨道线（R2-10：与运动位置同源公式，随轨道线开关） ----------
  const satelliteOrbitLines = useMemo(() => {
    const segments = 256;
    return (
      Object.keys(SATELLITE_GALAXY_ORBITS) as Array<keyof typeof SATELLITE_GALAXY_ORBITS>
    ).map((id) => {
      const galaxy = LOCAL_GROUP_GALAXIES.find((g) => g.id === id)!;
      const orbit = SATELLITE_GALAXY_ORBITS[id];
      // 同源公式（utils/universe.satelliteOrbitPointsLy 与
      // satelliteGalaxyPositionLy 共用 orbitPointLy，禁止两套参数）
      const pts = satelliteOrbitPointsLy(
        galaxy.distanceLy,
        galaxy.direction,
        orbit.inclinationDeg,
        segments,
      );
      const positions = new Float32Array(pts.length * 3);
      for (let i = 0; i < pts.length; i += 1) {
        positions[i * 3] = lyToSceneUnits(pts[i].x);
        positions[i * 3 + 1] = lyToSceneUnits(pts[i].y);
        positions[i * 3 + 2] = lyToSceneUnits(pts[i].z);
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      // 细线（与麦哲伦星流的弥散粒子带视觉区分，R2-10 星流澄清）
      const material = new THREE.LineBasicMaterial({
        color: '#8fb0d8',
        transparent: true,
        opacity: 0,
      });
      const line = new THREE.Line(geometry, material);
      line.frustumCulled = false;
      return { id, geometry, material, line };
    });
  }, []);

  // ---------- 人马座潮汐流（R2-10：前导臂+尾随臂稀疏星流，≤1,500 粒） ----------
  const { sgrStreamGeometry, sgrStreamMaterial } = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(SAGITTARIUS_STREAM.pointCount * 3), 3),
    );
    const mat = new THREE.PointsMaterial({
      color: SAGITTARIUS_STREAM.color,
      size: 60,
      map: getSoftPointTexture(),
      transparent: true,
      opacity: 0,
      sizeAttenuation: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    return { sgrStreamGeometry: geo, sgrStreamMaterial: mat };
  }, []);
  const sgrStreamPoints = useMemo(() => {
    const pts = new THREE.Points(sgrStreamGeometry, sgrStreamMaterial);
    pts.frustumCulled = false;
    return pts;
  }, [sgrStreamGeometry, sgrStreamMaterial]);

  // ---------- M31 接近进度流动光点（R2-10：复用流动刻度模式的 UI 节奏） ----------
  const { flowGeometry, flowMaterial } = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(M31_APPROACH_FLOW_COUNT * 3), 3),
    );
    const mat = new THREE.PointsMaterial({
      color: '#ffc890',
      size: 160,
      map: getSoftPointTexture(),
      transparent: true,
      opacity: 0,
      sizeAttenuation: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    return { flowGeometry: geo, flowMaterial: mat };
  }, []);
  const flowPoints = useMemo(() => {
    const pts = new THREE.Points(flowGeometry, flowMaterial);
    pts.frustumCulled = false;
    return pts;
  }, [flowGeometry, flowMaterial]);

  // ---------- 麦哲伦星流（可选需求 3.1.3） ----------
  const { streamGeometry, streamMaterial } = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(MAGELLANIC_STREAM.pointCount * 3), 3),
    );
    const mat = new THREE.PointsMaterial({
      color: MAGELLANIC_STREAM.color,
      size: 90,
      map: getSoftPointTexture(),
      transparent: true,
      opacity: 0,
      sizeAttenuation: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    return { streamGeometry: geo, streamMaterial: mat };
  }, []);
  const streamPoints = useMemo(() => {
    const pts = new THREE.Points(streamGeometry, streamMaterial);
    pts.frustumCulled = false;
    return pts;
  }, [streamGeometry, streamMaterial]);

  // ---------- 银河系—仙女座合并辉光（可选需求 3.1.3 碰撞合并预览） ----------
  const mergeGlowTexture = useMemo(
    () => new THREE.CanvasTexture(createGlowSpriteCanvas('#ffe0c0', 128)),
    [],
  );

  useEffect(() => {
    return () => {
      webGeometry.dispose();
      webMaterial.dispose();
      approachGeometry.dispose();
      approachMaterial.dispose();
      boundaryGeometry.dispose();
      boundaryMaterial.dispose();
      observableGeometry.dispose();
      observableMaterial.dispose();
      streamGeometry.dispose();
      streamMaterial.dispose();
      sgrStreamGeometry.dispose();
      sgrStreamMaterial.dispose();
      flowGeometry.dispose();
      flowMaterial.dispose();
      for (const o of satelliteOrbitLines) {
        o.geometry.dispose();
        o.material.dispose();
      }
      mergeGlowTexture.dispose();
    };
  }, [webGeometry, webMaterial, approachGeometry, approachMaterial, boundaryGeometry, boundaryMaterial, observableGeometry, observableMaterial, streamGeometry, streamMaterial, sgrStreamGeometry, sgrStreamMaterial, flowGeometry, flowMaterial, satelliteOrbitLines, mergeGlowTexture]);

  // R2-8：场景卸载时重置星系近观层 LRU 持有者注册表（防跨挂载残留）
  useEffect(() => () => resetGalaxyNearViewHolders(), []);

  useFrame((frameState) => {
    const state = useSimulationStore.getState();
    const group = groupRef.current;
    if (!group) return;
    const weight = fadeWeight(state.continuousLevel);
    group.visible = weight > 0.001;
    if (!group.visible) return;

    // R5-3 关系登记（§0.3 方案 G 推荐方案）：真实目录激活时程序化宇宙网
    // 降为低透明度氛围底层（0.75 → 0.2），目录关闭/降级时恢复主层现状
    webMaterial.opacity = (catalogActiveRef.current ? 0.2 : 0.75) * weight;
    boundaryMaterial.opacity = 0.28 * weight;
    approachMaterial.opacity = 0.7 * weight;
    observableMaterial.opacity = 0.22 * weight;
    streamMaterial.opacity = 0.5 * weight;
    sgrStreamMaterial.opacity = 0.42 * weight;
    flowMaterial.opacity = 0.8 * weight;

    // 卫星星系轨道线（R2-10）：随"轨道线开关"控制，细线低透明度
    const orbitOpacity = state.showOrbits ? 0.32 * weight : 0;
    for (const o of satelliteOrbitLines) {
      o.material.opacity = orbitOpacity;
      o.line.visible = orbitOpacity > 0.001;
    }

    // 哈勃膨胀示意（可选需求 3.1.3）：宇宙网整体随时间膨胀，
    // 退行速度自然与距离成正比（v = H·d，哈勃定律）
    if (webRef.current) {
      webRef.current.scale.setScalar(hubbleScaleFactor(state.simDays));
    }

    // 潮汐流更新（仅模拟时间变化时重采样：暂停时零演算）
    if (state.simDays !== lastStreamSimDaysRef.current) {
      lastStreamSimDaysRef.current = state.simDays;

      // 麦哲伦星流：沿 LMC 轨道向后拖尾（跟随 LMC 运动，同源公式）
      const lmcData = lmc;
      if (lmcData) {
        const lmcOrbit = SATELLITE_GALAXY_ORBITS.lmc;
        const streamPts = magellanicStreamPointsLy(
          lmcData.distanceLy,
          lmcOrbit.periodMyr,
          lmcData.direction,
          lmcOrbit.inclinationDeg,
          state.simDays,
          MAGELLANIC_STREAM.pointCount,
          MAGELLANIC_STREAM.seed,
        );
        const pos = streamGeometry.attributes.position as THREE.BufferAttribute;
        for (let i = 0; i < streamPts.length; i += 1) {
          pos.setXYZ(
            i,
            lyToSceneUnits(streamPts[i].x),
            lyToSceneUnits(streamPts[i].y),
            lyToSceneUnits(streamPts[i].z),
          );
        }
        pos.needsUpdate = true;
      }

      // 人马座潮汐流（R2-10）：沿极轨道前后延伸的稀疏星流（同源公式）
      if (sgr) {
        const sgrOrbit = SATELLITE_GALAXY_ORBITS['sagittarius-dwarf'];
        const sgrPts = tidalStreamPointsLy(
          sgr.distanceLy,
          sgrOrbit.periodMyr,
          sgr.direction,
          sgrOrbit.inclinationDeg,
          state.simDays,
          SAGITTARIUS_STREAM.pointCount,
          {
            backMyr: SAGITTARIUS_STREAM.backMyr,
            forwardMyr: SAGITTARIUS_STREAM.forwardMyr,
            jitterFrac: SAGITTARIUS_STREAM.jitterFrac,
            seed: SAGITTARIUS_STREAM.seed,
          },
        );
        const pos = sgrStreamGeometry.attributes.position as THREE.BufferAttribute;
        for (let i = 0; i < sgrPts.length; i += 1) {
          pos.setXYZ(
            i,
            lyToSceneUnits(sgrPts[i].x),
            lyToSceneUnits(sgrPts[i].y),
            lyToSceneUnits(sgrPts[i].z),
          );
        }
        pos.needsUpdate = true;
      }
    }

    // 接近轨迹线端点更新：M31 当前位置 → 银河系（原点）
    // R2-11：合并时刻后进入演化序列（穿越/回摆/终态），签名距离同源公式
    if (m31) {
      const stage = mergerStage(state.simDays);
      const approaching = stage === 'approaching';
      const d = mwM31SignedSeparationSceneUnits(state.simDays);
      const separation = Math.abs(mwM31SignedSeparationLy(state.simDays));

      // 接近虚线/流动光点仅接近段有意义（穿越后语义失效，隐藏；
      // 时间回退到合并前自动恢复——确定性可逆）
      approachLine.visible = approaching;
      flowPoints.visible = approaching;
      if (approaching) {
        const pos = approachGeometry.attributes.position as THREE.BufferAttribute;
        pos.setXYZ(0, m31.direction.x * d, m31.direction.y * d, m31.direction.z * d);
        pos.setXYZ(1, 0, 0, 0);
        pos.needsUpdate = true;
        approachLine.computeLineDistances();

        // 接近进度流动光点（R2-10）：自 M31 端流向银河系端，等相位间隔
        // （真实秒驱动的 UI 节奏示意，流速非物理量——登记于 utils/universe.ts）
        const flowPos = flowGeometry.attributes.position as THREE.BufferAttribute;
        const elapsed = frameState.clock.elapsedTime;
        for (let i = 0; i < M31_APPROACH_FLOW_COUNT; i += 1) {
          const s = m31ApproachFlow01(elapsed, i);
          const k = d * (1 - s);
          flowPos.setXYZ(i, m31.direction.x * k, m31.direction.y * k, m31.direction.z * k);
        }
        flowPos.needsUpdate = true;
      }

      // 碰撞倒计时 / 合并演化阶段提示（R2-11 HUD 标签联动）
      if (mergeLabelRef.current) {
        const stageLabel = mergerStageLabelZh(state.simDays);
        const countdown = mwM31MergeCountdownMyr(state.simDays);
        mergeLabelRef.current.textContent =
          stageLabel === null
            ? `银河系—仙女座相互接近（~110 km/s），约 ${(countdown / 1000).toFixed(1)} 十亿年后碰撞合并`
            : `银河系—仙女座合并演化：${stageLabel}`;
      }

      // 合并辉光（碰撞合并过程示意）——接近后期在两者之间显现增强；
      // R2-11：穿越时刻星暴蓝白闪亮（气体压缩触发恒星形成，艺术化登记），
      // 终态过渡为 Milkomeda 核心暖色辉光
      if (mergeGlowRef.current) {
        const glow = mergeGlowOpacity01(separation);
        const burst = mergerStarburst01(state.simDays);
        const ellMix = mergerEllipticalMix01(state.simDays);
        mergeGlowRef.current.visible = glow > 0.001;
        const mid = d * 0.5;
        mergeGlowRef.current.position.set(
          m31.direction.x * mid,
          m31.direction.y * mid,
          m31.direction.z * mid,
        );
        const s = (2600 + 1800 * glow) * (1 + 0.9 * burst + 0.35 * ellMix);
        mergeGlowRef.current.scale.set(s, s, 1);
        const glowMat = mergeGlowRef.current.material as THREE.SpriteMaterial;
        glowMat.opacity = Math.min(1, 0.75 * glow * weight * (1 + 0.6 * burst));
        // 色调：星暴蓝白（压 R/G 抬相对蓝）→ 终态老年恒星暖红黄（压 B）
        glowMat.color.setRGB(
          1 - 0.25 * burst,
          1 - 0.1 * burst - 0.12 * ellMix,
          1 - 0.35 * ellMix,
        );
      }
    }
    // 本星系群整体本动仅作矢量指示，不移动场景（需求 3.1.3，避免坐标漂移）
  });

  const greatAttractorDistance = cosmicDistanceToSceneUnits(2.2e8);

  return (
    <group ref={groupRef}>
      {/* 本星系群与近邻星系团成员（四类形态差异化） */}
      {LOCAL_GROUP_GALAXIES.map((galaxy) => (
        <GalaxyObject key={galaxy.id} galaxy={galaxy} />
      ))}

      {/* 河外特殊对象（需求 3.1.5，P2）：类星体 3C 273 + M87 单侧喷流；
          可选项：触须星系碰撞现场 + 星系团引力透镜弧 + 伽马射线暴 */}
      <Quasar />
      <M87Jet />
      {/* R5-4：M87 纵深与星系团环境（球状星团/室女座成员/ICM + M87* 透镜） */}
      <M87Environment />
      <AntennaeGalaxies />
      <LensingArcs />
      <GammaRayBurst />

      {/* 麦哲伦星流（可选需求）：LMC/SMC 被潮汐剥离的气体流 */}
      <primitive object={streamPoints} />

      {/* 人马座潮汐流（R2-10）：沿极轨道前后延伸的稀疏星流（正被撕裂示意） */}
      <primitive object={sgrStreamPoints} />

      {/* 卫星星系轨道线（R2-10）：与运动位置同源公式的细线，随轨道线开关 */}
      {satelliteOrbitLines.map((o) => (
        <primitive key={o.id} object={o.line} />
      ))}

      {/* M31 接近进度流动光点（R2-10）：沿接近虚线流向银河系 */}
      <primitive object={flowPoints} />

      {/* 银河系—仙女座合并辉光（可选需求：碰撞合并示意，接近后期显现） */}
      <sprite ref={mergeGlowRef} visible={false}>
        <spriteMaterial
          map={mergeGlowTexture}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </sprite>

      {/* MW–M31 接近轨迹（虚线） + 碰撞提示 */}
      <primitive object={approachLine} />
      {showLabels && inRange && m31 && (
        // R3-4：近距反向缩放钳制（子元素既有 ref 直改逻辑不受影响）
        <ClampedHtmlLabel
          position={[
            m31.direction.x * 6000,
            m31.direction.y * 6000 + 500,
            m31.direction.z * 6000,
          ]}
          distanceFactor={12000}
          style={{ pointerEvents: 'none' }}
        >
          <span
            ref={mergeLabelRef}
            className="whitespace-nowrap rounded bg-black/50 px-2 py-0.5 text-xs text-orange-200"
          />
        </ClampedHtmlLabel>
      )}

      {/* 本星系群整体本动矢量（可开关；仅矢量指示，不移动场景） */}
      {showVelocityVectors && inRange && (
        <group>
          <arrowHelper
            args={[
              new THREE.Vector3(
                GREAT_ATTRACTOR_DIRECTION.x,
                GREAT_ATTRACTOR_DIRECTION.y,
                GREAT_ATTRACTOR_DIRECTION.z,
              ),
              new THREE.Vector3(0, 0, 0),
              4200,
              0xffd27f,
              900,
              420,
            ]}
          />
          <ClampedHtmlLabel
            position={[
              GREAT_ATTRACTOR_DIRECTION.x * 4600,
              GREAT_ATTRACTOR_DIRECTION.y * 4600,
              GREAT_ATTRACTOR_DIRECTION.z * 4600,
            ]}
            distanceFactor={12000}
            style={{ pointerEvents: 'none' }}
          >
            <span className="whitespace-nowrap rounded bg-black/50 px-2 py-0.5 text-xs text-amber-200">
              本星系群本动 ~{LG_CMB_VELOCITY_KM_S} km/s（朝巨引源/沙普利方向，相对 CMB）
            </span>
          </ClampedHtmlLabel>
        </group>
      )}

      {/* 宇宙网：星系团（节点）—纤维—空洞（确定性分布）；
          整体缩放表达哈勃膨胀（可选需求），远端星系颜色偏红（红移示意）；
          R5-3：真实目录激活时降为氛围底层（opacity 0.2，useFrame 内切换） */}
      <points ref={webRef} geometry={webGeometry} material={webMaterial} />

      {/* 真实巡天背景（R5-3）：2MRS ~43,500 星系两级点云（室女座团聚集/
          银道空带/纤维走向为真实数据）；加载失败或开关关闭时不挂载——
          程序化宇宙网恢复主层（降级登记） */}
      {catalogActive && galaxyCatalog && <GalaxyCatalog data={galaxyCatalog} />}

      {/* 拉尼亚凯亚超星系团边界示意 + 巨引源标记 */}
      <primitive object={boundaryLine} />

      {/* 可观测宇宙边界示意（可选需求：约 465 亿光年，距离对数压缩） */}
      <primitive object={observableLine} />
      {showLabels && inRange && (
        <ClampedHtmlLabel
          position={[observableRadius * 0.7, -900, observableRadius * 0.3]}
          distanceFactor={14000}
          style={{ pointerEvents: 'none' }}
        >
          <span className="whitespace-nowrap text-xs text-rose-300/60">
            可观测宇宙边界示意（半径约 465 亿光年）
          </span>
        </ClampedHtmlLabel>
      )}
      {showLabels && inRange && (
        <ClampedHtmlLabel
          /* R5-3：标签随边界环迁至真实超星系平面（环上一点 + 少量抬升） */
          position={laniakeaLabelPosition}
          distanceFactor={14000}
          style={{ pointerEvents: 'none' }}
        >
          <span className="whitespace-nowrap text-xs text-purple-300/70">
            {LANIAKEA.nameZh}边界示意（直径约 5.2 亿光年）
          </span>
        </ClampedHtmlLabel>
      )}
      {showLabels && inRange && (
        <ClampedHtmlLabel
          position={[
            GREAT_ATTRACTOR_DIRECTION.x * greatAttractorDistance,
            GREAT_ATTRACTOR_DIRECTION.y * greatAttractorDistance,
            GREAT_ATTRACTOR_DIRECTION.z * greatAttractorDistance,
          ]}
          distanceFactor={14000}
          style={{ pointerEvents: 'none' }}
        >
          <span className="whitespace-nowrap text-xs text-amber-300/70">{LANIAKEA.greatAttractorZh}</span>
        </ClampedHtmlLabel>
      )}
    </group>
  );
}
