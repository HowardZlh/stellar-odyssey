'use client';

/**
 * 类星体 3C 273 近观细节层组件（R4-21，IMPROVEMENT_REQUIREMENTS_4 §R4-21）
 *
 * 由 `ExtragalacticObjects.Quasar` 经 useDetailLayer({kind:'particles'},
 * 'lru-retain' L4 语义) 门控挂载；预览页（`dev/QuasarNearViewPreview`）
 * 复用同一 `QuasarNearCore`（观感同源）。三层结构（喷流为既有第四层）：
 * - 吸积盘：平面环形 mesh + R4-12 盘着色 GLSL 镜像（温度剖面黑体色 ×
 *   多普勒束流 δ³ × 引力红移 g³ × 差速条纹；常数与
 *   `utils/blackHoleLensing` 单点同源，透镜 raymarch 不启用登记）；
 * - BLR 弥散辉光：glow sprite（光变联动呼吸）；
 * - 尘埃环面：确定性粒子环 points（暗红棕，`utils/quasarNearView`）。
 *
 * 管线兼容（附录 A §5）：自定义 shader 均含 logdepthbuf 三件 +
 * tonemapping/colorspace 输出（Starfield/PleiadesCluster 先例）。
 * 资源生命周期（附录 A §6）：geometry/material/纹理/LUT 卸载即 dispose。
 * 渲染纪律（附录 A §2）：每帧仅 uniform 标量直写，零对象分配、零随机。
 */

import type { JSX } from 'react';
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import {
  DISK_BETA_MAX,
  DISK_INNER_RADIUS_RS_DEFAULT,
  DISK_LUT_TEMP_MAX_K,
  DISK_LUT_TEMP_MIN_K,
  DISK_OUTER_RADIUS_RS_DEFAULT,
  DISK_STRIPE_OMEGA,
  DISK_TEMP_PROFILE_NORM,
  GRAV_REDSHIFT_FLOOR,
} from '@/utils/blackHoleLensing';
import { buildBlackbodyLutTexture } from '@/components/Scene/volumetric/BlackHoleLensed';
import { createGlowSpriteCanvas } from '@/components/CelestialBody/proceduralTextures';
import { quasarFlicker } from '@/utils/specialBodies';
import {
  QUASAR_BLR_GLOW_HALF_FACTOR,
  QUASAR_DISK_INNER_FACTOR,
  QUASAR_DISK_OUTER_FACTOR,
  QUASAR_DISK_TEMP_PEAK_K,
  generateQuasarTorusParticles,
  quasarBlrOpacity,
} from '@/utils/quasarNearView';

/** 细节层对象不参与射线检测（点选仍由既有核心 sprite 承担） */
const NOOP_RAYCAST = (): void => {};

// ---------------------------------------------------------------------------
// 吸积盘 shader（R4-12 非透镜简化版；常数模板插值单点同源）
// ---------------------------------------------------------------------------

const DISK_VERTEX = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  varying vec2 vLocal;
  varying vec3 vWorldPos;
  varying vec3 vCenterWorld;
  varying vec3 vNormalWorld;
  void main() {
    vLocal = position.xy;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorldPos = world.xyz;
    vCenterWorld = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    vNormalWorld = normalize((modelMatrix * vec4(0.0, 0.0, 1.0, 0.0)).xyz);
    gl_Position = projectionMatrix * viewMatrix * world;
    #include <logdepthbuf_vertex>
  }
`;

const DISK_FRAGMENT = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_fragment>
  uniform float uTime;
  uniform float uOpacity;
  uniform float uFlicker;
  uniform float uBeam;
  uniform float uGain;
  uniform sampler2D uBlackbodyLUT;
  varying vec2 vLocal;
  varying vec3 vWorldPos;
  varying vec3 vCenterWorld;
  varying vec3 vNormalWorld;
  // R4-12 吸积盘常数（utils/blackHoleLensing.ts 单点同源，单测断言）
  const float INNER01 = ${(QUASAR_DISK_INNER_FACTOR / QUASAR_DISK_OUTER_FACTOR).toFixed(6)};
  const float R_IN = ${DISK_INNER_RADIUS_RS_DEFAULT.toFixed(1)};
  const float R_OUT = ${DISK_OUTER_RADIUS_RS_DEFAULT.toFixed(1)};
  const float TEMP_NORM = ${DISK_TEMP_PROFILE_NORM.toFixed(6)};
  const float BETA_MAX = ${DISK_BETA_MAX.toFixed(2)};
  const float G_FLOOR = ${GRAV_REDSHIFT_FLOOR.toFixed(2)};
  const float LUT_T_MIN = ${DISK_LUT_TEMP_MIN_K.toFixed(1)};
  const float LUT_T_MAX = ${DISK_LUT_TEMP_MAX_K.toFixed(1)};
  const float PEAK_K = ${QUASAR_DISK_TEMP_PEAK_K.toFixed(1)};
  const float STRIPE_OMEGA = ${DISK_STRIPE_OMEGA.toFixed(1)};
  // 值噪声（盘条纹；确定性 hash，无逐帧随机——附录 A §2）
  float qnHash(vec2 q) {
    return fract(sin(dot(q, vec2(127.1, 311.7))) * 43758.5453);
  }
  float qnNoise(vec2 q) {
    vec2 i = floor(q);
    vec2 f = fract(q);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(qnHash(i), qnHash(i + vec2(1.0, 0.0)), u.x),
      mix(qnHash(i + vec2(0.0, 1.0)), qnHash(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
  }
  void main() {
    #include <logdepthbuf_fragment>
    float rho = length(vLocal);
    if (rho > 1.0 || rho < INNER01 * 0.92) discard;
    // 环带参数化 → r_s（quasarDiskRadiusRs 同式）
    float t01 = clamp((rho - INNER01) / (1.0 - INNER01), 0.0, 1.0);
    float rRs = mix(R_IN, R_OUT, t01);
    // 温度剖面（diskTemperatureFactor01 同式）
    float uu = rRs / R_IN;
    float tf = clamp(
      pow(uu, -0.75) * pow(max(1.0 - inversesqrt(uu), 0.0), 0.25) * TEMP_NORM,
      0.0, 1.0);
    // 开普勒 β（diskKeplerianBeta 同式）+ 多普勒 δ（dopplerFactor 同式）
    float beta = min(sqrt(0.5 / max(rRs - 1.0, 0.5)), BETA_MAX);
    vec3 radial = normalize(vWorldPos - vCenterWorld);
    vec3 vel = normalize(cross(vNormalWorld, radial));
    vec3 viewDir = normalize(cameraPosition - vWorldPos);
    float cosT = dot(vel, viewDir);
    float delta = sqrt(1.0 - beta * beta) / max(1.0 - beta * cosT, 1e-3);
    float dEff = pow(max(delta, 1e-3), uBeam);
    // 引力红移（gravitationalRedshiftFactor 同式）
    float g = max(sqrt(max(1.0 - 1.0 / rRs, 0.0)), G_FLOOR);
    // 观测色温 → 黑体 LUT（diskObservedTemperatureK 同式）
    float tObs = PEAK_K * tf * dEff * g;
    vec3 col = texture2D(uBlackbodyLUT,
      vec2(clamp((tObs - LUT_T_MIN) / (LUT_T_MAX - LUT_T_MIN), 0.0, 1.0), 0.5)).rgb;
    // 差速旋转条纹（ω ∝ r^-3/2，BlackHoleLensed 同式；cos/sin 嵌入消接缝）
    float phiP = atan(vLocal.y, vLocal.x) - STRIPE_OMEGA * pow(rRs, -1.5) * uTime;
    vec2 q = vec2(rRs * 2.2, 0.0) + 1.8 * vec2(cos(phiP), sin(phiP));
    float n = 0.6 * qnNoise(q) + 0.4 * qnNoise(q * vec2(2.3, 1.7) + 17.1);
    float stripe = 0.7 + 0.5 * n;
    // 亮度 = 基准 0.75（目验调参：防核心区 Bloom 洗白）× 增益 × 光变 ×
    // 剖面²（T⁴ 压缩档登记）× δ_eff³ × g³ × 条纹
    float lum = 0.75 * uGain * uFlicker * tf * tf * dEff * dEff * dEff * g * g * g * stripe;
    // 内外缘软化
    float edge = smoothstep(INNER01, INNER01 * 1.12, rho)
      * (1.0 - smoothstep(0.86, 1.0, rho));
    vec3 rgb = clamp(col * lum, vec3(0.0), vec3(4.0));
    gl_FragColor = vec4(rgb, edge * uOpacity);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

// ---------------------------------------------------------------------------
// 尘埃环面 points shader（PleiadesCluster 先例：每粒粒径 + 软边圆点）
// ---------------------------------------------------------------------------

const TORUS_VERTEX = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  attribute float aSize;
  uniform float uScale;
  varying vec3 vColor;
  void main() {
    vColor = color;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * (uScale / -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;
    #include <logdepthbuf_vertex>
  }
`;

const TORUS_FRAGMENT = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_fragment>
  uniform float uOpacity;
  varying vec3 vColor;
  void main() {
    #include <logdepthbuf_fragment>
    float d = length(gl_PointCoord - vec2(0.5));
    float alpha = (1.0 - smoothstep(0.12, 0.5, d)) * uOpacity;
    if (alpha < 0.01) discard;
    gl_FragColor = vec4(vColor, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export interface QuasarNearCoreProps {
  /** 基准半径（场景单位；主场景 = EXTRAGALACTIC_VIEW_RADIUS_UNITS，预览 = 1） */
  baseRadiusUnits: number;
  /** 读取本帧不透明度权重（层级权重 × 近观权重） */
  getOpacity: () => number;
  /** 虚拟时钟覆写（预览页 timeScale；缺省用场景时钟） */
  getTimeSec?: () => number;
  /** 束流强度覆写（δ 指数；缺省 1 = R4-12 物理档 δ³） */
  getBeamStrength?: () => number;
  /** 盘亮度倍率覆写（缺省 1） */
  getDiskGain?: () => number;
  /** 尘埃环面亮度倍率覆写（缺省 1） */
  getTorusGain?: () => number;
}

/**
 * 类星体近观核心三层（吸积盘 + BLR 辉光 + 尘埃环面粒子环）；
 * 环面轴 = 局部 +y（挂载方以组姿态对齐喷流轴）。
 */
export function QuasarNearCore({
  baseRadiusUnits,
  getOpacity,
  getTimeSec,
  getBeamStrength,
  getDiskGain,
  getTorusGain,
}: QuasarNearCoreProps): JSX.Element {
  const blrRef = useRef<THREE.Sprite>(null);

  // 黑体 LUT（R4-12 buildBlackbodyLutData 复用；卸载 dispose）
  const lutTexture = useMemo(() => buildBlackbodyLutTexture(), []);
  useEffect(() => () => lutTexture.dispose(), [lutTexture]);

  const diskMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        uniforms: {
          uTime: { value: 0 },
          uOpacity: { value: 0 },
          uFlicker: { value: 1 },
          uBeam: { value: 1 },
          uGain: { value: 1 },
          uBlackbodyLUT: { value: lutTexture },
        },
        vertexShader: DISK_VERTEX,
        fragmentShader: DISK_FRAGMENT,
      }),
    [lutTexture],
  );
  useEffect(() => () => diskMaterial.dispose(), [diskMaterial]);

  // 尘埃环面粒子（确定性纯函数输出，组件只消费）
  const { torusGeometry, torusMaterial } = useMemo(() => {
    const particles = generateQuasarTorusParticles(baseRadiusUnits);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(particles.positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(particles.colors, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(particles.sizes, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uOpacity: { value: 0 },
        uScale: { value: 400 },
      },
      vertexShader: TORUS_VERTEX,
      fragmentShader: TORUS_FRAGMENT,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      // 尘埃为吸收介质：NormalBlending——粒子堆叠维持暗红棕而非
      // additive 堆亮成米白（目验调参登记）
      blending: THREE.NormalBlending,
    });
    return { torusGeometry: geo, torusMaterial: mat };
  }, [baseRadiusUnits]);
  useEffect(
    () => () => {
      torusGeometry.dispose();
      torusMaterial.dispose();
    },
    [torusGeometry, torusMaterial],
  );

  // BLR 弥散辉光纹理（冷蓝白，盘外缘 → 环面之间的过渡层）
  const blrTexture = useMemo(
    () => new THREE.CanvasTexture(createGlowSpriteCanvas('#cfe0ff', 128)),
    [],
  );
  useEffect(() => () => blrTexture.dispose(), [blrTexture]);

  useFrame(({ clock, gl }) => {
    const t = getTimeSec ? getTimeSec() : clock.elapsedTime;
    const opacity = getOpacity();
    const flicker = quasarFlicker(t);
    diskMaterial.uniforms.uTime.value = t;
    diskMaterial.uniforms.uOpacity.value = opacity;
    diskMaterial.uniforms.uFlicker.value = flicker;
    diskMaterial.uniforms.uBeam.value = getBeamStrength ? getBeamStrength() : 1;
    diskMaterial.uniforms.uGain.value = getDiskGain ? getDiskGain() : 1;
    // 点大小随屏幕像素高度换算（Starfield/PleiadesCluster 同式）
    torusMaterial.uniforms.uScale.value = gl.domElement.height * 0.5;
    torusMaterial.uniforms.uOpacity.value =
      0.5 * opacity * (getTorusGain ? getTorusGain() : 1);
    if (blrRef.current) {
      (blrRef.current.material as THREE.SpriteMaterial).opacity = quasarBlrOpacity(
        opacity,
        flicker,
      );
    }
  });

  const diskOuter = QUASAR_DISK_OUTER_FACTOR * baseRadiusUnits;
  const blrEdge = QUASAR_BLR_GLOW_HALF_FACTOR * baseRadiusUnits * 2;
  return (
    <group>
      {/* 吸积盘（局部 x-z 平面，⊥ 环面轴 y；亮蓝白） */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        scale={[diskOuter, diskOuter, 1]}
        material={diskMaterial}
        raycast={NOOP_RAYCAST}
      >
        <planeGeometry args={[2, 2]} />
      </mesh>
      {/* BLR 弥散辉光过渡层（光变联动呼吸） */}
      <sprite ref={blrRef} scale={[blrEdge, blrEdge, 1]} raycast={NOOP_RAYCAST}>
        <spriteMaterial
          map={blrTexture}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          opacity={0}
        />
      </sprite>
      {/* 尘埃环面粒子环（暗红棕） */}
      <points
        geometry={torusGeometry}
        material={torusMaterial}
        raycast={NOOP_RAYCAST}
      />
    </group>
  );
}
