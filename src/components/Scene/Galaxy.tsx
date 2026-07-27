"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { ClampedHtmlLabel } from "@/components/Scene/ClampedHtmlLabel";
import * as THREE from "three";
import { LOCAL_GROUP_GALAXIES, MILKY_WAY } from "@/data/galaxies";
import { isGalaxyAnchoredFocusId } from "@/data/specialBodies";
import { useSimulationStore } from "@/store";
import { DEG_TO_RAD } from "@/utils/physics";
import { SCENE_UNITS_PER_LY, trapezoidWeight } from "@/utils/scale";
import {
  ARM_PATTERN_SPEED_RAD_PER_MYR,
  BAR_PATTERN_SPEED_RAD_PER_MYR,
  DENSITY_WAVE_CONTRAST,
  ECLIPTIC_GALACTIC_TILT_DEG,
  GALACTIC_BULGE_RADIUS_LY,
  GALACTIC_DISK_RADIUS_LY,
  GALACTIC_DISK_THICKNESS_LY,
  GLOBULAR_CLUSTER_COUNT,
  GLOBULAR_CLUSTER_STARS,
  GLOBULAR_MAX_RADIUS_LY,
  GLOBULAR_MIN_RADIUS_LY,
  GLOBULAR_SPREAD_LY,
  HALO_FLATTENING,
  HALO_MAX_RADIUS_LY,
  HALO_MIN_RADIUS_LY,
  M13_EXCLUSION_RADIUS_LY,
  SUN_GALACTIC_RADIUS_LY,
  bulgeAxisRatio,
  dustLaneStrength,
  galaxyFaceOnFactor,
  galaxyShaderMyr,
  generateGalaxyDiskParticles,
  generateGalaxyHaloParticles,
  generateGlobularClusters,
  m13GalactocentricT0Ly,
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
import {
  mergerEllipticalMix01,
  mergerStarburst01,
  mergerTidalDistortion01,
  mwM31SignedSeparationLy,
} from "@/utils/galaxyMerger";
import { setObjectTreeRaycastEnabled } from "@/utils/raycastGate";
import {
  ORBIT_GRADATION_COUNT,
  gradationProgressLabel,
  isMajorGradation,
  markerBreathScale,
  markerPulse01,
  orbitGradationAngle,
  pulseRingOpacity,
  pulseRingScale,
  samplePredictionArc,
  verticalVisualGain,
} from "@/utils/galacticMotionCues";
import { easeInOutCubic } from "@/utils/animation";
import {
  GALAXY_EXPAND_TRANSITION_SECONDS,
  advanceExpandGainValue,
  diskMorphWeight,
  dustLaneExpandFade,
  effectiveExpandGain,
  haloExpandBoost,
} from "@/utils/galacticLatitude";
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

/**
 * 银盘粒子数（附录A：30,000–50,000）。
 *
 * R2-9 粒子预算登记（L4 银河系）：
 * - 银盘 40,000（内含核球 3,200 [8%] + 棒 4,000 [10%]，总数不变）；
 * - 3D 恒星银晕 +3,000（HALO_PARTICLE_COUNT）；
 * - 球状星团 +29×21 = 609（GLOBULAR_CLUSTER_COUNT × GLOBULAR_CLUSTER_STARS）；
 * - 本组件合计 43,609；L4 场景峰值 ≈ 43,609 + M13 基础星场 420
 *   + 星系近观层 ≤8,000（R2-8 LRU 容量 1）≈ 52,029，60 FPS 实测保持。
 * - R2-11 合并演化：零新增粒子（潮汐扭曲/椭球终态/星暴均为既有银盘
 *   粒子的顶点着色器 uniforms 调制，CPU 零逐粒子分配）。
 */
const DISK_PARTICLE_COUNT = 40000;
/** 3D 恒星银晕粒子数（R2-9 §9.1：2,000–4,000 区间） */
const HALO_PARTICLE_COUNT = 3000;
/** 核球粒子占比（R2-9：原 0.18 拆分为核球 0.08 + 棒 0.10） */
const BULGE_FRACTION = 0.08;
/** 棒粒子占比（R2-9 棒旋结构 SBbc，俯视可辨性优先取 0.10） */
const BAR_FRACTION = 0.1;
/** 尾迹采样间隔（百万年） */
const TRAIL_SAMPLE_MYR = 0.8;
/** 尾迹容量（约覆盖 1.4 个银河年） */
const TRAIL_CAPACITY = 400;
/** 预测线刷新阈值（百万年）：弧段较短，阈值调小以体现滚动刷新 */
const PREDICTION_REFRESH_MYR = 1.5;
/** 预测弧段采样段数 */
const PREDICTION_SEGMENTS = 96;
/** 聚焦权重提升过渡时长（秒），与 SpecialBodies 一致 */
const FOCUS_BOOST_SECONDS = 0.5;
/** You are here 标记基础尺寸（场景单位，脉动缩放的基准） */
const MARKER_BASE_SCALE = 90;
/**
 * 尾迹/预测弧亮度（R2-6 §6.1 已走过/未来弧段对比调亮，视觉调优登记）：
 * 尾迹不透明度 0.9→1.0、颜色系数整体上调；预测虚线 0.5→0.72 并提亮为
 * #bfe4ff——已走过（暖绿实线渐隐）与未来（冷蓝虚线）对比在 L3 锚点可辨。
 */
const TRAIL_OPACITY = 1.0;
const PREDICTION_OPACITY = 0.72;

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
      bulgeFraction: BULGE_FRACTION,
      spiralTightness: 1.2,
      armSpreadRad: 0.28,
      barFraction: BAR_FRACTION,
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
    geo.setAttribute("aBar", new THREE.BufferAttribute(particles.barFlags, 1));
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
        // R2-9 棒图案角速度（刚性旋转，utils/galaxy.barParticleAngle 同源）
        uBarOmega: { value: BAR_PATTERN_SPEED_RAD_PER_MYR },
        // R2-9 尘埃带侧视强度（0-1，CPU 每帧按视角求 dustLaneStrength）
        uDustLane: { value: 0 },
        // R2-11 合并演化（utils/galaxyMerger 纯函数每帧求值，粒子零新增）：
        // 潮汐扭曲强度 / 指向 M31 的组内本地单位矢量（含穿越侧符号）/
        // 终态椭圆插值 / 星暴亮度
        uTidal: { value: 0 },
        uTidalDir: { value: new THREE.Vector3(1, 0, 0) },
        uEll: { value: 0 },
        uBurst: { value: 0 },
        // R3-7 银河系整体垂直展开：盘 morph 权重（diskMorphWeight 由
        // R3-6 生效展开增益派生，与特殊天体展开同源；同 uEll 目标顺序 mix）
        uExpand: { value: 0 },
      },
      vertexShader: /* glsl */ `
        attribute float aRadiusLy;
        attribute float aPhase;
        attribute float aHeightLy;
        attribute vec3 aColor;
        attribute float aSize;
        attribute float aBar;
        uniform float uMyr;
        uniform float uUnitsPerLy;
        uniform float uPatternSpeed;
        uniform float uWaveContrast;
        uniform float uBarOmega;
        uniform float uDustLane;
        uniform float uTidal;
        uniform vec3 uTidalDir;
        uniform float uEll;
        uniform float uBurst;
        uniform float uExpand;
        varying vec3 vColor;
        varying float vWave;
        varying float vDust;

        float hash1(float n) { return fract(sin(n) * 43758.5453); }

        void main() {
          // 较差自转：平坦旋转曲线 v=220km/s → ω = v/r（内圈快、外圈慢）；
          // R2-9 棒粒子（aBar=1）改用棒图案角速度 Ω_b 刚性旋转，
          // 保持棒形态不被较差自转剪切（utils/galaxy.barParticleAngle 同源）
          float omega = mix((220.0 * 3.3357) / max(aRadiusLy, 500.0), uBarOmega, aBar);
          float angle = aPhase + omega * uMyr;
          vec3 pos = vec3(
            aRadiusLy * cos(angle),
            aHeightLy,
            -aRadiusLy * sin(angle)
          ) * uUnitsPerLy;
          // R2-11 终态椭球（Milkomeda）：盘面按半径比例增厚为椭球粒子云
          // （目标轴比约 0.5，旋臂/团块调制随 uEll 抹平于亮度分支）
          float hTargetLy = (aHeightLy / 500.0) * max(aRadiusLy, 6000.0) * 0.5;
          pos.y = mix(pos.y, hTargetLy * uUnitsPerLy, uEll);
          // R3-7 银河系整体垂直展开：同一椭球目标的第二次 mix（组合权重
          // 1−(1−uEll)(1−uExpand)，utils/galacticLatitude.combinedMorphWeight
          // 镜像登记；终态 Milkomeda uEll=1 时不受 V 开关影响）。
          // 每粒子按自身真实高度等比例抬升、x/z 不动 → 正面轮廓天然不变
          pos.y = mix(pos.y, hTargetLy * uUnitsPerLy, uExpand);
          // R2-11 潮汐扭曲（穿越/回摆期）：沿 MW–M31 连线拉伸（外盘更强，
          // 潮汐尾示意）+ 外盘朝伴星系侧整体偏置（潮汐桥示意）
          float outer = smoothstep(0.15, 1.0, aRadiusLy / 50000.0);
          float along = dot(pos, uTidalDir);
          pos += uTidalDir * (along * uTidal * (0.2 + 0.85 * outer));
          pos += uTidalDir * (uTidal * outer * 6000.0 * uUnitsPerLy);
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
          // R2-9 棒粒子不参与密度波/团块调制（棒为刚体图案，恒定增亮
          // 1.6 —— 俯视时棒状暖黄核心在核球辉光之外可辨）
          vWave = mix(vWave, 1.6, aBar);
          // R2-9 尘埃带侧视剪影：侧视时盘中平面（|h| 小）粒子吸光变暗
          // + 片元红化（加性混合无法画暗，以衰减近似，登记于 utils/galaxy.ts）
          float midplane = 1.0 - smoothstep(60.0, 380.0, abs(aHeightLy));
          vDust = uDustLane * midplane;
          vWave *= 1.0 - 0.85 * vDust;
          // R2-11 星暴增亮（穿越时刻）+ 终态旋臂/团块/棒调制抹平
          vWave *= 1.0 + 1.3 * uBurst;
          vWave = mix(vWave, 1.05, uEll);
          // R2-11 色调：终态偏老年恒星红黄；星暴短暂蓝白
          float lum = dot(vColor, vec3(0.4, 0.45, 0.15));
          vColor = mix(vColor, lum * vec3(1.3, 0.95, 0.62), uEll);
          vColor = mix(vColor, vColor * vec3(0.8, 0.95, 1.5) + vec3(0.12), 0.6 * uBurst);
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
        varying float vDust;

        void main() {
          vec2 c = gl_PointCoord - vec2(0.5);
          float d2 = dot(c, c);
          if (d2 > 0.25) discard;
          // 柔和圆点（中心亮边缘淡）；密度波调制亮度（vWave ∈ [1−c, 1+c]）
          float falloff = 1.0 - smoothstep(0.05, 0.25, d2);
          // R2-9 尘埃红化：中平面残余光偏红棕（星际消光蓝端更强）
          vec3 col = vColor * vWave;
          col = mix(col, col * vec3(1.0, 0.55, 0.38), vDust * 0.6);
          gl_FragColor = vec4(col, uOpacity * (0.35 + 0.65 * falloff));
        }
      `,
    });
    return { diskGeometry: geo, diskMaterial: mat };
  }, []);

  // ---------- R2-9：3D 恒星银晕 + 球状星团（静态粒子，零逐帧更新） ----------
  const { haloGeometry, haloMaterial, clusterGeometry, clusterMaterial } =
    useMemo(() => {
      /** 静态粒子集 → BufferGeometry（光年 → 场景单位一次性换算） */
      const buildGeometry = (set: {
        count: number;
        positionsLy: Float32Array;
        colors: Float32Array;
        sizes: Float32Array;
      }): THREE.BufferGeometry => {
        const positions = new Float32Array(set.count * 3);
        for (let i = 0; i < set.count * 3; i += 1) {
          positions[i] = set.positionsLy[i] * SCENE_UNITS_PER_LY;
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
        geo.setAttribute("aColor", new THREE.BufferAttribute(set.colors, 3));
        geo.setAttribute("aSize", new THREE.BufferAttribute(set.sizes, 1));
        geo.boundingSphere = new THREE.Sphere(
          new THREE.Vector3(0, 0, 0),
          HALO_MAX_RADIUS_LY * SCENE_UNITS_PER_LY * 1.1,
        );
        return geo;
      };
      /** 与银盘粒子同一像素换算/软圆点管线的静态点材质（颗粒感统一） */
      const buildMaterial = (): THREE.ShaderMaterial =>
        new THREE.ShaderMaterial({
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          uniforms: { uOpacity: { value: 0 } },
          vertexShader: /* glsl */ `
            attribute vec3 aColor;
            attribute float aSize;
            varying vec3 vColor;
            void main() {
              vColor = aColor;
              vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
              gl_PointSize = clamp(aSize * (2600.0 / -mvPosition.z), 1.0, 6.0);
              gl_Position = projectionMatrix * mvPosition;
            }
          `,
          fragmentShader: /* glsl */ `
            uniform float uOpacity;
            varying vec3 vColor;
            void main() {
              vec2 c = gl_PointCoord - vec2(0.5);
              float d2 = dot(c, c);
              if (d2 > 0.25) discard;
              float falloff = 1.0 - smoothstep(0.05, 0.25, d2);
              gl_FragColor = vec4(vColor, uOpacity * (0.35 + 0.65 * falloff));
            }
          `,
        });
      const halo = generateGalaxyHaloParticles({
        count: HALO_PARTICLE_COUNT,
        seed: 20260726,
        minRadiusLy: HALO_MIN_RADIUS_LY,
        maxRadiusLy: HALO_MAX_RADIUS_LY,
        flattening: HALO_FLATTENING,
      });
      // 球状星团：29 个程序化 + M13（L3 特殊天体条目联动，同一对象不重复
      // 渲染——其 t=0 银心系位置周围留排除区，见 utils/galaxy.ts 文件头）
      const clusters = generateGlobularClusters({
        clusterCount: GLOBULAR_CLUSTER_COUNT,
        starsPerCluster: GLOBULAR_CLUSTER_STARS,
        seed: 20260726,
        minRadiusLy: GLOBULAR_MIN_RADIUS_LY,
        maxRadiusLy: GLOBULAR_MAX_RADIUS_LY,
        spreadLy: GLOBULAR_SPREAD_LY,
        exclusion: {
          centerLy: m13GalactocentricT0Ly(),
          radiusLy: M13_EXCLUSION_RADIUS_LY,
        },
      });
      return {
        haloGeometry: buildGeometry(halo),
        haloMaterial: buildMaterial(),
        clusterGeometry: buildGeometry(clusters),
        clusterMaterial: buildMaterial(),
      };
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
    // 圆形软边贴图（P6：消除方形粒子），供轨道银河年刻度 PointsMaterial 使用
    const flowTick = new THREE.CanvasTexture(
      createGlowSpriteCanvas("#ffffff", 64),
    );
    return { core, halo, marker, flowTick };
  }, []);

  const coreSpriteRef = useRef<THREE.Sprite>(null);
  const haloSpriteRef = useRef<THREE.Sprite>(null);
  // R2-9 尘埃带侧视剪影：盘中平面扁椭球吸光暗带（普通透明混合，
  // renderOrder 置后 → 对先绘制的加性粒子/核球辉光做变暗叠加；
  // 仅侧视渐入（opacity ∝ dustLaneStrength），正视完全透明零成本）
  const dustLaneRef = useRef<THREE.Mesh>(null);
  const markerSpriteRef = useRef<THREE.Sprite>(null);
  // 脉动波纹扩散环（R2-6 §6.1：当前位置雷达波纹高亮，与 You are here 联动）
  const pulseRingRef = useRef<THREE.Sprite>(null);

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
        color: "#bfe4ff",
        transparent: true,
        opacity: PREDICTION_OPACITY,
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

  // ---------- 轨道银河年刻度（R2-6 §6.1）：银心系静止的进度"里程碑" ----------
  // 差异登记（见 galacticMotionCues.ts 文件头）：P6 流动光点与太阳共转，
  // 跟随模式下相对太阳方位恒定、运动线索弱；改为银心系静止刻度后，
  // 跟随模式下刻度以太阳真实公转速度整体滑过场景原点（参照物滑动），
  // 银心固定模式下脉动标记依次掠过静止刻度。位置固定 → 几何只建一次，
  // 渲染循环零更新（仅调不透明度）。
  const { gradationAssets, majorLabelPositions } = useMemo(() => {
    const rUnits = SUN_GALACTIC_RADIUS_LY * SCENE_UNITS_PER_LY;
    const minor: number[] = [];
    const major: number[] = [];
    const labels: { key: number; label: string; pos: [number, number, number] }[] = [];
    for (let i = 0; i < ORBIT_GRADATION_COUNT; i += 1) {
      const a = orbitGradationAngle(i);
      // 与 sunGalacticPositionLy 一致：x=R·cosθ，z=−R·sinθ，y=0（平均轨道环）
      const x = rUnits * Math.cos(a);
      const z = -rUnits * Math.sin(a);
      if (isMajorGradation(i)) {
        major.push(x, 0, z);
        labels.push({ key: i, label: gradationProgressLabel(i), pos: [x, 46, z] });
      } else {
        minor.push(x, 0, z);
      }
    }
    const bounding = new THREE.Sphere(new THREE.Vector3(0, 0, 0), rUnits * 1.2);
    const makePoints = (
      positions: number[],
      color: string,
      size: number,
    ): { geo: THREE.BufferGeometry; mat: THREE.PointsMaterial; pts: THREE.Points } => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute(
        "position",
        new THREE.BufferAttribute(new Float32Array(positions), 3),
      );
      geo.boundingSphere = bounding.clone();
      const mat = new THREE.PointsMaterial({
        color,
        size,
        map: glowTextures.flowTick,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        sizeAttenuation: true,
      });
      const pts = new THREE.Points(geo, mat);
      pts.frustumCulled = false;
      return { geo, mat, pts };
    };
    return {
      gradationAssets: {
        minor: makePoints(minor, "#7fd8ff", 42),
        major: makePoints(major, "#ffd27f", 92),
      },
      majorLabelPositions: labels,
    };
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
      haloGeometry.dispose();
      haloMaterial.dispose();
      clusterGeometry.dispose();
      clusterMaterial.dispose();
      trailGeometry.dispose();
      trailMaterial.dispose();
      predictionGeometry.dispose();
      predictionMaterial.dispose();
      gradationAssets.minor.geo.dispose();
      gradationAssets.minor.mat.dispose();
      gradationAssets.major.geo.dispose();
      gradationAssets.major.mat.dispose();
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
    haloGeometry,
    haloMaterial,
    clusterGeometry,
    clusterMaterial,
    trailGeometry,
    trailMaterial,
    predictionGeometry,
    predictionMaterial,
    gradationAssets,
    heightGeometry,
    heightMaterial,
    glowTextures,
  ]);

  const tmpLocal = useMemo(() => new THREE.Vector3(), []);
  const tiltEuler = useMemo(() => new THREE.Euler(tiltRad, 0, 0), [tiltRad]);
  // R2-11：指向 M31 的组内本地单位矢量（数据层世界方向经倾斜逆旋转，
  // 常量只算一次；穿越侧符号每帧乘在 uniform 上）
  const tidalDirLocal = useMemo(() => {
    const m31 = LOCAL_GROUP_GALAXIES.find((g) => g.id === "m31");
    return new THREE.Vector3(
      m31?.direction.x ?? 1,
      m31?.direction.y ?? 0,
      m31?.direction.z ?? 0,
    )
      .normalize()
      .applyEuler(new THREE.Euler(-tiltRad, 0, 0));
  }, [tiltRad]);
  // 参考系切换线性过渡进度（0=跟随太阳系 → 1=银心固定），每帧向目标推进
  const frameProgressRef = useRef(0);
  // R3-6 垂直展开：开关线性过渡进度（0=关 → 1=开，约 1 秒）+ 滑块值平滑跟随
  const expandProgressRef = useRef(0);
  const expandGainValueRef = useRef(
    useSimulationStore.getState().galaxyExpandGain,
  );
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

  useFrame((frameState, delta) => {
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
    // R2-9：银晕淡（包裹感背景层）、星团亮（点簇可辨）
    // （可见时下方 R3-7 分支会按展开 morph 权重覆写为 0.55·weight·boost）
    haloMaterial.uniforms.uOpacity.value = 0.55 * weight;
    clusterMaterial.uniforms.uOpacity.value = weight;
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
    // R3-6 垂直展开生效增益：开关约 1 秒平滑过渡（advanceFrameTransition 模式）
    // + 滑块拖动平滑跟随；仅乘在特殊天体 offsetLy.y 上（SpecialBodies 消费）
    expandProgressRef.current = advanceFrameTransition(
      expandProgressRef.current,
      state.galaxyVerticalExpand ? 1 : 0,
      delta,
      GALAXY_EXPAND_TRANSITION_SECONDS,
    );
    expandGainValueRef.current = advanceExpandGainValue(
      expandGainValueRef.current,
      state.galaxyExpandGain,
      delta,
    );
    const expandGain = effectiveExpandGain(
      expandGainValueRef.current,
      expandProgressRef.current,
    );

    // 渲染位姿注册（bug 修复）：cameraFocus/SpatialAudio 按本帧实际应用的
    // 银心固定权重/垂直增益/展开增益解析 L3 天体场景坐标，保证飞往/跟随与渲染一致
    setRenderedGalacticFrame(w, gain, expandGain);

    // R3-7 银河系整体垂直展开：盘 morph 权重由同一生效增益派生
    // （×1→0、×3→0.4、×6→1.0），写入盘粒子 uExpand（GPU morph 零新增粒子）；
    // 银晕展开态增亮 +30%（强化椭球轮廓，银晕粒子本身球状不参与 morph）
    const morph01 = diskMorphWeight(expandGain);
    diskMaterial.uniforms.uExpand.value = morph01;
    haloMaterial.uniforms.uOpacity.value =
      0.55 * weight * haloExpandBoost(morph01);

    // R2-9 视角因子：相机相对银心方向 → 正视程度（纯函数，倾斜逆旋转）
    // 驱动 1) 尘埃带侧视暗带强度；2) 核球辉光 sprite 椭球轴比
    const camPos = frameState.camera.position;
    const faceOn = galaxyFaceOnFactor(
      camPos.x - group.position.x,
      camPos.y - group.position.y,
      camPos.z - group.position.z,
      tiltRad,
    );
    // R2-11 合并演化 uniforms（纯函数每帧求值，确定性/时间可逆；
    // 粒子扰动全部在顶点着色器，CPU 零逐粒子分配）
    const ellMix = mergerEllipticalMix01(simDays);
    diskMaterial.uniforms.uEll.value = ellMix;
    diskMaterial.uniforms.uTidal.value = mergerTidalDistortion01(simDays);
    diskMaterial.uniforms.uBurst.value = mergerStarburst01(simDays);
    (diskMaterial.uniforms.uTidalDir.value as THREE.Vector3)
      .copy(tidalDirLocal)
      .multiplyScalar(mwM31SignedSeparationLy(simDays) < 0 ? -1 : 1);

    // 终态椭圆星系无尘埃带（气体在星暴中耗尽，随椭圆插值淡出）；
    // R3-7 展开态同样渐隐（morph 后"盘中平面"语义消失，单一应用点
    // 同时驱动 shader vDust / 暗带 mesh / 核球辉光压低链路）
    const dustLane =
      dustLaneStrength(faceOn) * (1 - ellMix) * dustLaneExpandFade(morph01);
    diskMaterial.uniforms.uDustLane.value = dustLane;
    if (dustLaneRef.current) {
      const laneMat = dustLaneRef.current.material as THREE.MeshBasicMaterial;
      laneMat.opacity = 0.62 * dustLane * weight;
      dustLaneRef.current.visible = laneMat.opacity > 0.01;
    }

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
    // 尾迹几何更新（尾端渐隐：颜色从暗到亮；R2-6 调亮登记见 TRAIL_OPACITY）
    const ordered = trailToOrderedArray(trail);
    const count = ordered.length / 3;
    const posAttr = trailGeometry.attributes.position as THREE.BufferAttribute;
    const colAttr = trailGeometry.attributes.color as THREE.BufferAttribute;
    for (let i = 0; i < count; i += 1) {
      posAttr.setXYZ(i, ordered[i * 3], ordered[i * 3 + 1], ordered[i * 3 + 2]);
      const fade = count > 1 ? i / (count - 1) : 1;
      colAttr.setXYZ(
        i,
        0.5 * fade + 0.08,
        0.92 * fade + 0.08,
        0.72 * fade + 0.12,
      );
    }
    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
    trailGeometry.setDrawRange(0, count);
    trailMaterial.opacity = TRAIL_OPACITY * weight;

    // 预测线（非闭合弧段，虚线）：时间推进超阈值或垂直增益变化后滚动刷新
    const lastPrediction = lastPredictionMyrRef.current;
    if (
      lastPrediction === null ||
      Math.abs(myr - lastPrediction) > PREDICTION_REFRESH_MYR ||
      lastGainRef.current !== gain
    ) {
      refreshPrediction(myr, gain);
    }
    predictionMaterial.opacity = PREDICTION_OPACITY * weight;

    // 轨道银河年刻度（R2-6 §6.1）：银心系静止的进度里程碑，位置零更新，
    // 跟随模式下随组平移整体滑过原点（参照物滑动），仅调不透明度
    gradationAssets.minor.mat.opacity = 0.7 * weight;
    gradationAssets.major.mat.opacity = 0.9 * weight;

    // You are here 标记与运动方向箭头 + 脉动高亮（R2-6 §6.1：
    // 真实秒驱动的 UI 高亮节奏，与模拟时间无关，登记见 galacticMotionCues.ts）
    const pulsePhase = markerPulse01(frameState.clock.elapsedTime);
    if (markerRef.current) {
      markerRef.current.position.copy(tmpLocal);
      const markerVisible = state.showYouAreHere && weight > 0.05;
      markerRef.current.visible = markerVisible;
      // Raycaster 不检查 visible：标记隐藏时禁用点选热区
      setObjectTreeRaycastEnabled(markerRef.current, markerVisible);
    }
    if (pulseRingRef.current) {
      const ringScale = MARKER_BASE_SCALE * pulseRingScale(pulsePhase);
      pulseRingRef.current.scale.set(ringScale, ringScale, 1);
      (pulseRingRef.current.material as THREE.SpriteMaterial).opacity =
        pulseRingOpacity(pulsePhase) * weight;
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
    // 中心辉光透明度 + R2-9 核球椭球感：辉光 sprite 纵横比随视角连续变化
    // （正视圆形 → 侧视压扁 0.5，billboard 呈现扁椭球不同视角的轴比）；
    // 侧视时随尘埃带强度压低辉光（−45%），避免白斑洗掉盘中平面暗带
    if (coreSpriteRef.current) {
      (coreSpriteRef.current.material as THREE.SpriteMaterial).opacity =
        0.85 * weight * (1 - 0.45 * dustLane);
      const coreW = GALACTIC_DISK_RADIUS_LY * SCENE_UNITS_PER_LY * 0.26;
      coreSpriteRef.current.scale.set(coreW, coreW * bulgeAxisRatio(faceOn), 1);
    }
    if (haloSpriteRef.current) {
      // R2-9：银晕辉光 sprite 降为弱环境光底（0.35 → 0.22），
      // 立体包裹感改由 3D 银晕粒子承载（叠加方案，登记）
      (haloSpriteRef.current.material as THREE.SpriteMaterial).opacity =
        0.22 * weight;
    }
    if (markerSpriteRef.current) {
      (markerSpriteRef.current.material as THREE.SpriteMaterial).opacity =
        0.95 * weight;
      // 呼吸脉动（R2-6 §6.1）：标记本体 ±12% 缩放呼吸，强化"当前位置"
      const breath = MARKER_BASE_SCALE * markerBreathScale(pulsePhase);
      markerSpriteRef.current.scale.set(breath, breath, 1);
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
      {/* 银盘粒子（棒旋结构 + 较差自转 + R2-9 棒刚性旋转/尘埃带侧视暗带） */}
      <points geometry={diskGeometry} material={diskMaterial} />

      {/* R2-9：3D 恒星银晕（r^-3.5 稀疏球壳）+ 球状星团点簇（29 + M13 联动） */}
      <points geometry={haloGeometry} material={haloMaterial} />
      <points geometry={clusterGeometry} material={clusterMaterial} />

      {/* R2-9 尘埃带侧视剪影：盘中平面扁椭球暗带（厚约 1,200 ly，
          renderOrder=2 在加性粒子之后普通混合 → 真实"吸光"变暗；
          侧视渐入、正视透明，强度由 useFrame 按 dustLaneStrength 驱动） */}
      <mesh
        ref={dustLaneRef}
        renderOrder={2}
        scale={[diskRadiusUnits * 0.96, diskRadiusUnits * 0.012, diskRadiusUnits * 0.96]}
        visible={false}
      >
        <sphereGeometry args={[1, 48, 12]} />
        <meshBasicMaterial
          color="#170d06"
          transparent
          opacity={0}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* 中心辉光（核球，R2-9 轴比随视角逐帧调整）与银晕弱环境光底 */}
      <sprite
        ref={coreSpriteRef}
        scale={[diskRadiusUnits * 0.26, diskRadiusUnits * 0.22, 1]}
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

      {/* 轨道银河年刻度（R2-6 §6.1）：银心系静止的进度里程碑光点
          （跟随模式下整体滑过原点体现"参照物滑动"），主刻度带进度标注 */}
      <primitive object={gradationAssets.minor.pts} />
      <primitive object={gradationAssets.major.pts} />
      {inGalaxyRange &&
        showYouAreHere &&
        majorLabelPositions.map((item) => (
          // R3-4：近距反向缩放钳制（开关归属维持现状，用户确认项 2）
          <ClampedHtmlLabel
            key={item.key}
            position={item.pos}
            distanceFactor={2600}
            style={{ pointerEvents: "none" }}
          >
            <span className="whitespace-nowrap rounded bg-black/40 px-1.5 py-0.5 text-[10px] text-amber-200/80">
              {item.label}
            </span>
          </ClampedHtmlLabel>
        ))}

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
        <sprite
          ref={markerSpriteRef}
          scale={[MARKER_BASE_SCALE, MARKER_BASE_SCALE, 1]}
        >
          <spriteMaterial
            map={glowTextures.marker}
            transparent
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </sprite>
        {/* 脉动波纹扩散环（R2-6 §6.1）：周期 2.4s 的雷达波纹，
            强化"轨道当前位置"高亮（随 You are here 开关联动显示/隐藏） */}
        <sprite
          ref={pulseRingRef}
          scale={[MARKER_BASE_SCALE, MARKER_BASE_SCALE, 1]}
        >
          <spriteMaterial
            map={glowTextures.marker}
            transparent
            opacity={0}
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
          // R3-4：近距反向缩放钳制（开关归属维持现状，用户确认项 2）
          <ClampedHtmlLabel
            position={[0, 60, 0]}
            distanceFactor={2600}
            style={{ pointerEvents: "none" }}
          >
            <span className="whitespace-nowrap rounded bg-black/50 px-2 py-0.5 text-xs text-emerald-300">
              你在这里（太阳系）
            </span>
          </ClampedHtmlLabel>
        )}
      </group>
    </group>
  );
}
