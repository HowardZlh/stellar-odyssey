"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import { MILKY_WAY } from "@/data/galaxies";
import { isGalaxyAnchoredFocusId } from "@/data/specialBodies";
import { useSimulationStore } from "@/store";
import { DEG_TO_RAD } from "@/utils/physics";
import { SCENE_UNITS_PER_LY, trapezoidWeight } from "@/utils/scale";
import {
  ARM_PATTERN_SPEED_RAD_PER_MYR,
  DENSITY_WAVE_CONTRAST,
  ECLIPTIC_GALACTIC_TILT_DEG,
  GALACTIC_BULGE_RADIUS_LY,
  GALACTIC_DISK_RADIUS_LY,
  GALACTIC_DISK_THICKNESS_LY,
  SUN_GALACTIC_RADIUS_LY,
  galaxyShaderMyr,
  generateGalaxyDiskParticles,
  simDaysToMyr,
  sunGalacticPositionLy,
} from "@/utils/galaxy";
import {
  advanceFrameTransition,
  computeGalacticFramePose,
  frameModeTargetWeight,
  resetRenderedGalacticFrame,
  setRenderedGalacticFrame,
} from "@/utils/galacticFrame";
import { setObjectTreeRaycastEnabled } from "@/utils/raycastGate";
import {
  orbitFlowTickAngle,
  samplePredictionArc,
  verticalVisualGain,
} from "@/utils/galacticMotionCues";
import { easeInOutCubic } from "@/utils/animation";
import {
  createTrailBuffer,
  clearTrail,
  pushTrailPoint,
  trailToOrderedArray,
} from "@/utils/trail";
import {
  createBulgeGlowCanvas,
  createGlowSpriteCanvas,
} from "@/components/CelestialBody/proceduralTextures";
import { SpecialBodies } from "@/components/Scene/SpecialBodies";
import { Supernova } from "@/components/Scene/Supernova";

/** 银盘粒子数（附录A：30,000–50,000） */
const DISK_PARTICLE_COUNT = 40000;
/** 尾迹采样间隔（百万年） */
const TRAIL_SAMPLE_MYR = 0.8;
/** 尾迹容量（约覆盖 1.4 个银河年） */
const TRAIL_CAPACITY = 400;
/** 预测线刷新阈值（百万年）：弧段较短，阈值调小以体现滚动刷新 */
const PREDICTION_REFRESH_MYR = 1.5;
/** 预测弧段采样段数 */
const PREDICTION_SEGMENTS = 96;
/** 轨道流动刻度光点数（沿轨道均匀分布，整体以太阳角速度流动） */
const FLOW_TICK_COUNT = 48;
/** 聚焦权重提升过渡时长（秒），与 SpecialBodies 一致 */
const FOCUS_BOOST_SECONDS = 0.5;

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
  const selectBody = useSimulationStore((s) => s.selectBody);
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
    geo.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(n * 3), 3),
    );
    geo.setAttribute(
      "aRadiusLy",
      new THREE.BufferAttribute(particles.radiiLy, 1),
    );
    geo.setAttribute("aPhase", new THREE.BufferAttribute(particles.phases, 1));
    geo.setAttribute(
      "aHeightLy",
      new THREE.BufferAttribute(particles.heightsLy, 1),
    );
    geo.setAttribute("aColor", new THREE.BufferAttribute(particles.colors, 3));
    geo.setAttribute("aSize", new THREE.BufferAttribute(particles.sizes, 1));
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

        float hash1(float n) { return fract(sin(n) * 43758.5453); }

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
          float armCos = cos(4.0 * (angle - patternPhase));
          vWave = 1.0 + uWaveContrast * armCos;
          // P6 §3.3 旋臂 HII 区团块串珠：沿臂脊按噪声聚类增亮（形态参考旋涡星系）
          float armRidge = smoothstep(0.6, 1.0, armCos);
          float clump = hash1(floor(aPhase * 40.0) + floor(aRadiusLy / 1500.0) * 7.0);
          vWave += armRidge * step(0.72, clump) * 0.9;
          // P6 §3.3 尘埃带示意：旋臂内侧（armCos 上升沿）亮度不对称衰减
          float dust = smoothstep(-0.2, 0.6, sin(4.0 * (angle - patternPhase) + 0.5));
          vWave *= mix(0.62, 1.0, dust);
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
    // 核球/银晕：噪声扰动多层辉光（P6 §3.3，替换纯径向渐变圆斑）
    const core = new THREE.CanvasTexture(
      createBulgeGlowCanvas("#ffe8c8", 256, 91),
    );
    const halo = new THREE.CanvasTexture(
      createBulgeGlowCanvas("#c8d4ff", 256, 41),
    );
    const marker = new THREE.CanvasTexture(
      createGlowSpriteCanvas("#7fffd4", 128),
    );
    // 圆形软边贴图（P6：消除方形粒子），供流动刻度 PointsMaterial 使用
    const flowTick = new THREE.CanvasTexture(
      createGlowSpriteCanvas("#ffffff", 64),
    );
    return { core, halo, marker, flowTick };
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
      "position",
      new THREE.BufferAttribute(new Float32Array(TRAIL_CAPACITY * 3), 3),
    );
    geo.setAttribute(
      "color",
      new THREE.BufferAttribute(new Float32Array(TRAIL_CAPACITY * 3), 3),
    );
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

  const { predictionGeometry, predictionMaterial, predictionLine } =
    useMemo(() => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute(
        "position",
        new THREE.BufferAttribute(
          new Float32Array((PREDICTION_SEGMENTS + 1) * 3),
          3,
        ),
      );
      const mat = new THREE.LineDashedMaterial({
        color: "#9fd8ff",
        transparent: true,
        opacity: 0.5,
        dashSize: 18,
        gapSize: 12,
      });
      const line = new THREE.Line(geo, mat);
      line.frustumCulled = false;
      return {
        predictionGeometry: geo,
        predictionMaterial: mat,
        predictionLine: line,
      };
    }, []);
  const lastPredictionMyrRef = useRef<number | null>(null);
  const lastGainRef = useRef<number>(1);

  // ---------- 轨道流动刻度（P6 §3.1.2）：沿轨道流动的光点，体现运动 ----------
  const { flowGeometry, flowMaterial, flowPoints } = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(FLOW_TICK_COUNT * 3), 3),
    );
    geo.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(0, 0, 0),
      SUN_GALACTIC_RADIUS_LY * SCENE_UNITS_PER_LY * 1.2,
    );
    const mat = new THREE.PointsMaterial({
      color: "#7fd8ff",
      size: 22,
      map: glowTextures.flowTick,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    return { flowGeometry: geo, flowMaterial: mat, flowPoints: pts };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- 高度指示线（P6 §3.1.2）：标记 → 银盘投影点的细线 ----------
  const { heightGeometry, heightMaterial, heightLine } = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(2 * 3), 3),
    );
    const mat = new THREE.LineBasicMaterial({
      color: "#7fffd4",
      transparent: true,
      opacity: 0.5,
    });
    const line = new THREE.Line(geo, mat);
    line.frustumCulled = false;
    return { heightGeometry: geo, heightMaterial: mat, heightLine: line };
  }, []);

  // 组件卸载时重置渲染位姿注册表（回到默认跟随模式解析行为）
  useEffect(() => () => resetRenderedGalacticFrame(), []);

  useEffect(() => {
    return () => {
      diskGeometry.dispose();
      diskMaterial.dispose();
      trailGeometry.dispose();
      trailMaterial.dispose();
      predictionGeometry.dispose();
      predictionMaterial.dispose();
      flowGeometry.dispose();
      flowMaterial.dispose();
      heightGeometry.dispose();
      heightMaterial.dispose();
      glowTextures.core.dispose();
      glowTextures.halo.dispose();
      glowTextures.marker.dispose();
      glowTextures.flowTick.dispose();
    };
  }, [
    diskGeometry,
    diskMaterial,
    trailGeometry,
    trailMaterial,
    predictionGeometry,
    predictionMaterial,
    flowGeometry,
    flowMaterial,
    heightGeometry,
    heightMaterial,
    glowTextures,
  ]);

  const tmpLocal = useMemo(() => new THREE.Vector3(), []);
  const tiltEuler = useMemo(() => new THREE.Euler(tiltRad, 0, 0), [tiltRad]);
  // 参考系切换线性过渡进度（0=跟随太阳系 → 1=银心固定），每帧向目标推进
  const frameProgressRef = useRef(0);
  // 聚焦权重提升进度（bug 修复：飞往/跟随 L3 特殊天体/超新星后目标不可见）：
  // 这些目标距场景原点仅 150–400 单位，飞抵后连续层级跌入 L2 区间，
  // 银河系内容按层级门控会完全淡出。跟随期间组权重提升至 1（0.5 秒平滑），
  // 保证目标天体及其所在的银河系环境可见；取消跟随后恢复层级门控。
  const focusBoostRef = useRef(0);

  /**
   * 刷新未来预测线（P6 §3.1.2）：前方约 1/4 银河年的**非闭合弧段**，
   * 随时间滚动刷新，与历史尾迹首尾衔接不重叠；y 分量按视觉增益放大
   * （默认模式放大、真实比例模式为 1），使波浪起伏可辨。
   */
  const refreshPrediction = (myr: number, gain: number): void => {
    const samples = samplePredictionArc(myr, PREDICTION_SEGMENTS, gain);
    const pos = predictionGeometry.attributes.position as THREE.BufferAttribute;
    for (let s = 0; s < samples.length; s += 1) {
      const p = samples[s];
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
    lastGainRef.current = gain;
  };

  useFrame((_, delta) => {
    const state = useSimulationStore.getState();
    const { simDays, continuousLevel } = state;
    const group = groupRef.current;
    if (!group) return;

    // LOD：越过 L2/L3 边界（2.5，与视角标签一致）后淡入，L3/L4 完整可见
    // （L4 下银河系自旋仍可辨识；连续层级上限为 4，平台区延伸至 4 以上保证
    // L4 不淡出）。起点不得低于 2.5：否则太阳系视角下太阳邻域的银河粒子
    // 会贴着太阳显示，被误认为"柯伊伯带跑错位置"（bug 修复）。
    // 聚焦提升：跟随/飞往银河系锚定天体（特殊天体/超新星）期间保持可见
    // （见 focusBoostRef 注释），常规 L2 游览（无跟随）行为不变
    const focusId = state.followBodyId ?? state.flyToBodyId;
    focusBoostRef.current = advanceFrameTransition(
      focusBoostRef.current,
      focusId && isGalaxyAnchoredFocusId(focusId) ? 1 : 0,
      delta,
      FOCUS_BOOST_SECONDS,
    );
    const weight = Math.max(
      trapezoidWeight(continuousLevel, 2.5, 2.9, 4.5, 5),
      focusBoostRef.current,
    );
    group.visible = weight > 0.001;
    diskMaterial.uniforms.uOpacity.value = weight;
    if (!group.visible) return;

    const myr = simDaysToMyr(simDays);
    // 时间回卷（bug 防护）：宇宙视角长时间驻留后 ω·t 会超出 float32 与
    // GPU sin/cos 可靠范围导致银盘粒子坍缩（统计近似登记于 utils/galaxy.ts）
    diskMaterial.uniforms.uMyr.value = galaxyShaderMyr(myr);

    // 垂直振荡视觉增益（P6 §3.1.2）：默认模式放大 y 使波浪起伏可辨，
    // 真实比例模式为 1（不放大，属科学事实，登记于 galacticMotionCues.ts 文件头）
    const gain = verticalVisualGain(state.realScaleMode);

    // 太阳系银心系位置（光年 → 场景单位，未倾斜的组内本地坐标）
    const sunLy = sunGalacticPositionLy(simDays);
    tmpLocal.set(
      sunLy.x * SCENE_UNITS_PER_LY,
      sunLy.y * gain * SCENE_UNITS_PER_LY,
      sunLy.z * SCENE_UNITS_PER_LY,
    );

    // 参考系切换过渡（P6 §3.1.1）：向目标模式平滑推进线性进度，
    // easeInOutCubic 缓动为银心固定权重 w（0=跟随太阳系、1=银心固定）
    frameProgressRef.current = advanceFrameTransition(
      frameProgressRef.current,
      frameModeTargetWeight(state.galacticFrameMode) as 0 | 1,
      delta,
    );
    const w = easeInOutCubic(frameProgressRef.current);

    // 银河系组位姿（纯逻辑 utils/galacticFrame）：
    // 跟随模式 groupOffset=−sunWorld（太阳系居原点，银河系相对滑动）；
    // 银心模式 groupOffset=0（银心居原点，标记沿轨道实际移动）。
    // 组先应用倾斜旋转，再按世界空间 groupOffset 平移（不新增场景对象）。
    const pose = computeGalacticFramePose({
      simDays,
      galacticCenterWeight: w,
      verticalGain: gain,
    });
    group.rotation.copy(tiltEuler);
    group.position.set(
      pose.groupOffset.x,
      pose.groupOffset.y,
      pose.groupOffset.z,
    );
    // 渲染位姿注册（bug 修复）：cameraFocus/SpatialAudio 按本帧实际应用的
    // 银心固定权重与垂直增益解析 L3 天体场景坐标，保证飞往/跟随与渲染一致
    setRenderedGalacticFrame(w, gain);

    // 历史尾迹采样（时间倒退/大跳变/垂直增益切换时清空，避免坐标残留或折角）
    const lastSample = lastSampleMyrRef.current;
    const gainChanged = lastGainRef.current !== gain;
    if (
      lastSample === null ||
      myr < lastSample ||
      myr - lastSample > TRAIL_SAMPLE_MYR * 50 ||
      gainChanged
    ) {
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
      colAttr.setXYZ(
        i,
        0.35 * fade + 0.05,
        0.75 * fade + 0.08,
        0.55 * fade + 0.1,
      );
    }
    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
    trailGeometry.setDrawRange(0, count);
    trailMaterial.opacity = 0.9 * weight;

    // 预测线（非闭合弧段，虚线）：时间推进超阈值或垂直增益变化后滚动刷新
    const lastPrediction = lastPredictionMyrRef.current;
    if (
      lastPrediction === null ||
      Math.abs(myr - lastPrediction) > PREDICTION_REFRESH_MYR ||
      lastGainRef.current !== gain
    ) {
      refreshPrediction(myr, gain);
    }
    predictionMaterial.opacity = 0.5 * weight;

    // 轨道流动刻度（P6 §3.1.2）：沿轨道以太阳实际角速度流动的光点，
    // 跟随模式下使"银河系相对滑动"可感知；银心模式下与标记一同展示轨道内运动
    const flowPos = flowGeometry.attributes.position as THREE.BufferAttribute;
    const rUnits = SUN_GALACTIC_RADIUS_LY * SCENE_UNITS_PER_LY;
    for (let i = 0; i < FLOW_TICK_COUNT; i += 1) {
      const a = orbitFlowTickAngle(simDays, i, FLOW_TICK_COUNT);
      // 与 sunGalacticPositionLy 一致：x=R·cosθ，z=−R·sinθ，y=0（沿平均轨道环）
      flowPos.setXYZ(i, rUnits * Math.cos(a), 0, -rUnits * Math.sin(a));
    }
    flowPos.needsUpdate = true;
    flowMaterial.opacity = 0.55 * weight;

    // You are here 标记与运动方向箭头
    if (markerRef.current) {
      markerRef.current.position.copy(tmpLocal);
      const markerVisible = state.showYouAreHere && weight > 0.05;
      markerRef.current.visible = markerVisible;
      // Raycaster 不检查 visible：标记隐藏时禁用点选热区
      setObjectTreeRaycastEnabled(markerRef.current, markerVisible);
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
      (coreSpriteRef.current.material as THREE.SpriteMaterial).opacity =
        0.9 * weight;
    }
    if (haloSpriteRef.current) {
      (haloSpriteRef.current.material as THREE.SpriteMaterial).opacity =
        0.35 * weight;
    }
    if (markerSpriteRef.current) {
      (markerSpriteRef.current.material as THREE.SpriteMaterial).opacity =
        0.95 * weight;
    }
    // 高度指示线：标记（tmpLocal，含垂直增益）→ 银盘面投影点（y=0）
    const hPos = heightGeometry.attributes.position as THREE.BufferAttribute;
    hPos.setXYZ(0, tmpLocal.x, tmpLocal.y, tmpLocal.z);
    hPos.setXYZ(1, tmpLocal.x, 0, tmpLocal.z);
    hPos.needsUpdate = true;
    heightMaterial.opacity = 0.5 * weight;
    heightLine.visible = state.showYouAreHere && weight > 0.05;
  });

  const diskRadiusUnits = GALACTIC_DISK_RADIUS_LY * SCENE_UNITS_PER_LY;

  return (
    // 初始不可见：首帧 useFrame 前不渲染银河系内容（消除 L1/L2 下的闪现竞态）
    <group ref={groupRef} visible={false}>
      {/* 银盘粒子（棒旋结构 + 较差自转） */}
      <points geometry={diskGeometry} material={diskMaterial} />

      {/* 中心辉光（核球）与银晕光层 */}
      <sprite
        ref={coreSpriteRef}
        scale={[diskRadiusUnits * 0.35, diskRadiusUnits * 0.28, 1]}
      >
        <spriteMaterial
          map={glowTextures.core}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </sprite>
      <sprite
        ref={haloSpriteRef}
        scale={[diskRadiusUnits * 1.1, diskRadiusUnits * 0.9, 1]}
      >
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

      {/* 太阳系轨迹：历史尾迹（实线渐隐）+ 未来预测弧段（虚线，非闭合滚动） */}
      <primitive object={trailLine} />
      <primitive object={predictionLine} />

      {/* 轨道流动刻度（P6 §3.1.2）：沿轨道流动的圆形软边光点 */}
      <primitive object={flowPoints} />

      {/* 高度指示线（P6 §3.1.2）：You are here → 银盘面投影点 */}
      <primitive object={heightLine} />

      {/* You are here 标记（可开关，需求 3.1.2） */}
      <group ref={markerRef} visible={showYouAreHere}>
        {/* 点选热区（需求 §3.1.1：太阳系标记可点选/可飞往——选中太阳后
            信息面板"飞往"即导航回太阳系；银心固定模式下任何"飞往"都会
            自动切回跟随模式，见 CameraController）。
            让位规则（bug 修复）：特殊天体（参宿四等）在屏幕上聚集于标记
            周围，射线常先命中本热区；若同一射线还命中了其他可交互对象，
            本热区不得吞掉点击（不选中、不 stopPropagation，事件继续传播
            到天体自身的 onClick） */}
        <mesh
          onClick={(e) => {
            const hasOther = e.intersections.some(
              (hit) => hit.eventObject !== e.eventObject,
            );
            if (hasOther) return;
            e.stopPropagation();
            selectBody("sun");
          }}
        >
          <sphereGeometry args={[42, 12, 12]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
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
          args={[
            new THREE.Vector3(0, 0, -1),
            new THREE.Vector3(0, 0, 0),
            160,
            0x7fffd4,
            40,
            20,
          ]}
        />
        {inGalaxyRange && (
          <Html
            position={[0, 60, 0]}
            center
            distanceFactor={2600}
            style={{ pointerEvents: "none" }}
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
