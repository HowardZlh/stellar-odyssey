'use client';


import type { JSX } from 'react';
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useSimulationStore } from '@/store';
import { setObjectTreeRaycastEnabled } from '@/utils/raycastGate';
import {
  CUTAWAY_LAYER_COLORS,
  SUN_CORE_OUTER_FRAC,
  SUN_RADIATIVE_OUTER_FRAC,
  advanceCutawayProgress,
  cutawayLayerAtRadius,
  cutawayWedgeAngleRad,
  corePulseFactor,
  isInCutawayWedge,
} from '@/utils/sunCutaway';
import { granulationPhase } from '@/utils/sunSurface';

/**
 * 太阳内部结构剖面模式（S2，IMPROVEMENT_REQUIREMENTS_SOLAR §4.1）：
 * 1/4 球体切除（cutaway）视图——沿经度 0°→90° 楔形切除，两个过极轴的
 * 半圆切面呈现核心/辐射区/对流区分层色带（可点选，显示科普卡片）。
 *
 * - 开合过渡 ≤2 秒平滑（advanceCutawayProgress，楔形张角 0→π/2 缓动）；
 *   关闭后组隐藏、raycast 关闭（不拦截光球点击）。
 * - 核心能量脉动 / 对流胞循环动画由模拟时间驱动（暂停冻结，
 *   艺术化示意登记于 utils/sunCutaway.ts 文件头）。
 * - 分层半径 0.25/0.7 R☉ 基于标准太阳模型（登记于 utils/sunCutaway.ts）。
 * - 剖面模式下外部活动特效互斥淡出（SunActivity 内处理，§4.1/§5.3）。
 */

const WEDGE_GLSL = /* glsl */ `
  // 楔形切除判定（sunCutaway.isInCutawayWedge 镜像）：φ ∈ [0, wedge] 丢弃
  bool inWedge(vec3 objPos, float wedge) {
    float phi = atan(-objPos.z, objPos.x);
    return phi >= 0.0 && phi <= wedge;
  }
`;

const NOISE_GLSL = /* glsl */ `
  float hash3(vec3 p) {
    return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
  }
  float smooth01(float t) { t = clamp(t, 0.0, 1.0); return t*t*(3.0-2.0*t); }
  float valueNoise3(vec3 p) {
    vec3 i = floor(p);
    vec3 f = p - i;
    vec3 t = vec3(smooth01(f.x), smooth01(f.y), smooth01(f.z));
    float v000 = hash3(i);
    float v100 = hash3(i + vec3(1.0, 0.0, 0.0));
    float v010 = hash3(i + vec3(0.0, 1.0, 0.0));
    float v110 = hash3(i + vec3(1.0, 1.0, 0.0));
    float v001 = hash3(i + vec3(0.0, 0.0, 1.0));
    float v101 = hash3(i + vec3(1.0, 0.0, 1.0));
    float v011 = hash3(i + vec3(0.0, 1.0, 1.0));
    float v111 = hash3(i + vec3(1.0, 1.0, 1.0));
    float a = mix(mix(v000, v100, t.x), mix(v010, v110, t.x), t.y);
    float b = mix(mix(v001, v101, t.x), mix(v011, v111, t.x), t.y);
    return mix(a, b, t.z);
  }
`;

/** 分层 id → 高亮 uniform 整数（0 未选中） */
const LAYER_TO_INT: Record<string, number> = { core: 1, radiative: 2, convective: 3 };

interface SunCutawayProps {
  /** 太阳显示半径（场景单位） */
  radius: number;
  /** 光球 2K 底图（剖面外壳复用，避免开合瞬间观感跳变） */
  surfaceTexture: THREE.Texture | null;
}

export function SunCutaway({ radius, surfaceTexture }: SunCutawayProps): JSX.Element {
  const groupRef = useRef<THREE.Group>(null);
  const faceBRef = useRef<THREE.Mesh>(null);
  const progressRef = useRef(0);
  const raycastEnabledRef = useRef(false);
  // 当前楔形张角（点选判定用：楔形内被 shader 丢弃的"幽灵面"不拦截点击）
  const wedgeRef = useRef(0);
  const setSunCutawayLayer = useSimulationStore((s) => s.setSunCutawayLayer);

  // 外壳：光球贴图 + 临边昏暗 + 楔形切除（背面呈对流区内壁暗橙色）
  const shellMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        side: THREE.DoubleSide,
        uniforms: {
          uMap: { value: null },
          uHasMap: { value: 0 },
          uFallback: { value: new THREE.Color('#ffcc55') },
          uWedge: { value: 0 },
          uLimbU: { value: 0.6 },
        },
        vertexShader: /* glsl */ `
          varying vec3 vObjPos;
          varying vec3 vNormal;
          varying vec3 vViewDir;
          varying vec2 vUv;
          void main() {
            vObjPos = normalize(position);
            vNormal = normalize(normalMatrix * normal);
            vUv = uv;
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            vViewDir = normalize(-mv.xyz);
            gl_Position = projectionMatrix * mv;
          }
        `,
        fragmentShader: /* glsl */ `
          uniform sampler2D uMap;
          uniform float uHasMap;
          uniform vec3 uFallback;
          uniform float uWedge;
          uniform float uLimbU;
          varying vec3 vObjPos;
          varying vec3 vNormal;
          varying vec3 vViewDir;
          varying vec2 vUv;
          ${WEDGE_GLSL}
          void main() {
            if (inWedge(vObjPos, uWedge)) discard;
            if (!gl_FrontFacing) {
              // 切除后可见的对流区内壁（暗橙）
              gl_FragColor = vec4(vec3(0.45, 0.16, 0.05), 1.0);
            } else {
              vec3 base = uHasMap > 0.5 ? texture2D(uMap, vUv).rgb : uFallback;
              float mu = clamp(dot(normalize(vNormal), normalize(vViewDir)), 0.0, 1.0);
              float limb = 1.0 - uLimbU * (1.0 - mu);
              gl_FragColor = vec4(base * limb * 1.12, 1.0);
            }
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }
        `,
      }),
    [],
  );

  // 辐射区球面（0.7 R☉）：橙黄渐变 + 微弱径向光纹，同样楔形切除
  const radiativeMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        side: THREE.DoubleSide,
        uniforms: {
          uWedge: { value: 0 },
          uTime: { value: 0 },
          uColor: {
            value: new THREE.Vector3(
              CUTAWAY_LAYER_COLORS.radiative.r,
              CUTAWAY_LAYER_COLORS.radiative.g,
              CUTAWAY_LAYER_COLORS.radiative.b,
            ),
          },
        },
        vertexShader: /* glsl */ `
          varying vec3 vObjPos;
          void main() {
            vObjPos = normalize(position);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform float uWedge;
          uniform float uTime;
          uniform vec3 uColor;
          varying vec3 vObjPos;
          ${WEDGE_GLSL}
          ${NOISE_GLSL}
          void main() {
            if (inWedge(vObjPos, uWedge)) discard;
            float n = valueNoise3(vObjPos * 8.0 + vec3(0.0, uTime * 0.03, 0.0));
            vec3 col = uColor * (0.85 + 0.3 * n);
            if (!gl_FrontFacing) col *= 0.55;
            gl_FragColor = vec4(col, 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }
        `,
      }),
    [],
  );

  // 核心球（0.25 R☉）：白热高亮 + 缓慢能量脉动
  const coreMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uPulse: { value: 1 },
          uColor: {
            value: new THREE.Vector3(
              CUTAWAY_LAYER_COLORS.core.r,
              CUTAWAY_LAYER_COLORS.core.g,
              CUTAWAY_LAYER_COLORS.core.b,
            ),
          },
        },
        vertexShader: /* glsl */ `
          void main() {
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform float uPulse;
          uniform vec3 uColor;
          void main() {
            gl_FragColor = vec4(uColor * uPulse * 1.15, 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }
        `,
      }),
    [],
  );

  // 剖切面（两个过极轴半圆）：分层色带 + 温度梯度 + 动画 + 点选高亮
  const faceMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        side: THREE.DoubleSide,
        uniforms: {
          uRadius: { value: radius },
          uTime: { value: 0 },
          uPulse: { value: 1 },
          uSelected: { value: 0 },
        },
        vertexShader: /* glsl */ `
          varying vec2 vLocal;
          void main() {
            vLocal = position.xy;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform float uRadius;
          uniform float uTime;
          uniform float uPulse;
          uniform int uSelected;
          varying vec2 vLocal;
          ${NOISE_GLSL}
          void main() {
            float r01 = length(vLocal) / uRadius;
            if (r01 > 1.0) discard;
            vec3 col;
            int layer;
            if (r01 <= ${SUN_CORE_OUTER_FRAC.toFixed(4)}) {
              // 核心：白热 + 能量脉动（sunCutaway.corePulseFactor 镜像）
              layer = 1;
              float n = valueNoise3(vec3(vLocal * 8.0 / uRadius, uTime * 0.3));
              col = vec3(${CUTAWAY_LAYER_COLORS.core.r.toFixed(3)}, ${CUTAWAY_LAYER_COLORS.core.g.toFixed(3)}, ${CUTAWAY_LAYER_COLORS.core.b.toFixed(3)})
                * uPulse * (0.95 + 0.1 * n);
            } else if (r01 <= ${SUN_RADIATIVE_OUTER_FRAC.toFixed(4)}) {
              // 辐射区：橙黄渐变 + 微弱径向光纹
              layer = 2;
              float ang = atan(vLocal.y, vLocal.x);
              float streak = valueNoise3(vec3(ang * 3.0, r01 * 2.0 - uTime * 0.02, 1.7));
              float g = (r01 - 0.25) / 0.45;
              col = mix(vec3(1.0, 0.85, 0.5), vec3(1.0, 0.55, 0.15), g) * (0.88 + 0.24 * streak);
            } else {
              // 对流区：上升/下沉对流胞循环动画（艺术化加速，登记）
              layer = 3;
              float cells = valueNoise3(vec3(vLocal * 16.0 / uRadius, uTime * 0.6));
              float g = (r01 - 0.7) / 0.3;
              col = mix(vec3(0.95, 0.42, 0.12), vec3(0.82, 0.3, 0.08), g) * (0.78 + 0.44 * cells);
            }
            // 分层边界细线（0.25 / 0.7 R☉）
            float edge = min(abs(r01 - 0.25), abs(r01 - 0.7));
            col = mix(vec3(1.0, 0.95, 0.85), col, smoothstep(0.0, 0.01, edge));
            // 点选高亮
            if (layer == uSelected) col *= 1.3;
            gl_FragColor = vec4(col, 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }
        `,
      }),
    [radius],
  );

  // 纹理就绪同步（复用光球 2K 底图，开合瞬间观感一致）
  useEffect(() => {
    shellMaterial.uniforms.uMap.value = surfaceTexture;
    shellMaterial.uniforms.uHasMap.value = surfaceTexture ? 1 : 0;
  }, [surfaceTexture, shellMaterial]);

  // 卸载释放（AGENTS.md 内存管理）
  useEffect(() => {
    return () => {
      shellMaterial.dispose();
      radiativeMaterial.dispose();
      coreMaterial.dispose();
      faceMaterial.dispose();
    };
  }, [shellMaterial, radiativeMaterial, coreMaterial, faceMaterial]);

  /** 切面点选：本地半径 → 分层（§4.1 各层可点选） */
  const handleFaceClick = (e: {
    stopPropagation: () => void;
    point: THREE.Vector3;
    object: THREE.Object3D;
  }): void => {
    e.stopPropagation();
    const local = e.object.worldToLocal(e.point.clone());
    const r01 = Math.min(1, Math.hypot(local.x, local.y) / radius);
    setSunCutawayLayer(cutawayLayerAtRadius(r01));
  };

  useFrame((_, rawDelta) => {
    const { simDays, sunCutawayMode, sunCutawayLayer } = useSimulationStore.getState();
    // 开合过渡（真实时间 UI 过渡，≤2 秒；钳制单帧防标签页切回跳变）
    progressRef.current = advanceCutawayProgress(
      progressRef.current,
      sunCutawayMode,
      Math.min(rawDelta, 0.1),
    );
    const group = groupRef.current;
    if (!group) return;
    const visible = progressRef.current > 0.001;
    group.visible = visible;
    // 隐藏时关闭 raycast（不拦截光球点击；仅状态变化时遍历）
    if (raycastEnabledRef.current !== visible) {
      raycastEnabledRef.current = visible;
      setObjectTreeRaycastEnabled(group, visible);
    }
    if (!visible) return;

    const wedge = cutawayWedgeAngleRad(progressRef.current);
    wedgeRef.current = wedge;
    shellMaterial.uniforms.uWedge.value = wedge;
    radiativeMaterial.uniforms.uWedge.value = wedge;
    // 切面 B 随楔形张角旋转（切面 A 固定于 φ=0）
    if (faceBRef.current) {
      faceBRef.current.rotation.y = wedge;
    }
    // 动画：模拟时间轴驱动（暂停冻结）
    const phase = granulationPhase(simDays);
    radiativeMaterial.uniforms.uTime.value = phase;
    faceMaterial.uniforms.uTime.value = phase;
    const pulse = corePulseFactor(simDays);
    coreMaterial.uniforms.uPulse.value = pulse;
    faceMaterial.uniforms.uPulse.value = pulse;
    faceMaterial.uniforms.uSelected.value = sunCutawayLayer
      ? LAYER_TO_INT[sunCutawayLayer] ?? 0
      : 0;
  });

  /**
   * 球面点选（外壳/辐射区）：命中点位于楔形切除区时为 shader 已丢弃的
   * "幽灵面"——不拦截（不 stopPropagation），让射线继续命中切面/内层。
   */
  const layerClick = (layer: 'core' | 'radiative' | 'convective') => (e: {
    stopPropagation: () => void;
    point: THREE.Vector3;
  }): void => {
    const group = groupRef.current;
    if (group && layer !== 'core') {
      const local = group.worldToLocal(e.point.clone());
      if (isInCutawayWedge(local.x, local.z, wedgeRef.current)) return;
    }
    e.stopPropagation();
    setSunCutawayLayer(layer);
  };

  return (
    <group ref={groupRef} name="sun-cutaway" visible={false}>
      {/* 外壳（对流区外边界 = 光球面），点选 → 对流区 */}
      <mesh material={shellMaterial} onClick={layerClick('convective')}>
        <sphereGeometry args={[radius, 64, 64]} />
      </mesh>
      {/* 辐射区球面（0.7 R☉），点选 → 辐射区 */}
      <mesh material={radiativeMaterial} onClick={layerClick('radiative')}>
        <sphereGeometry args={[radius * SUN_RADIATIVE_OUTER_FRAC, 48, 48]} />
      </mesh>
      {/* 核心（0.25 R☉），点选 → 核心 */}
      <mesh material={coreMaterial} onClick={layerClick('core')}>
        <sphereGeometry args={[radius * SUN_CORE_OUTER_FRAC, 32, 32]} />
      </mesh>
      {/* 剖切面 A（φ=0，含极轴半圆）与 B（φ=楔形张角，随开合旋转） */}
      <mesh material={faceMaterial} onClick={handleFaceClick}>
        <circleGeometry args={[radius, 64, -Math.PI / 2, Math.PI]} />
      </mesh>
      <mesh ref={faceBRef} material={faceMaterial} onClick={handleFaceClick}>
        <circleGeometry args={[radius, 64, -Math.PI / 2, Math.PI]} />
      </mesh>
    </group>
  );
}
