'use client';

/**
 * 伽马射线暴 GRB 221009A 近观细节层组件（R5-5 B，IMPROVEMENT_REQUIREMENTS_5 §R5-5）
 *
 * 由 `ExtragalacticObjects.GammaRayBurst` 经 useDetailLayer({kind:'particles'},
 * 'lru-retain' L4 语义) 门控挂载；预览页（`dev/GrbNearViewPreview`）复用
 * 同一 `GrbNearCore`（观感同源）。两层结构（喷流轴 = 局部 +y，挂载方以
 * 组姿态对齐静态双锥轴）：
 * - 相对论双喷流：复用 `RelativisticJet`（参数化登记：radiusFactor =
 *   tan(全开角/2) ≈ 5° 更窄、蓝白更亮档），可见权重随周期时钟
 *   `grbNearJetWeight01` 爆发增亮/衰减；
 * - 余辉膨胀壳：球壳 mesh 临边增亮渐变（视线切向壳层光程长的近似），
 *   `grbAfterglowState` 驱动 uTime 语义的膨胀（R ∝ t^(1/4)）与幂律减暗、
 *   颜色随龄蓝白→暗橙（Piran 2004 图景登记 utils/grbNearView 文件头）。
 *
 * 管线兼容（附录 A §5）：壳层 shader 含 logdepthbuf 三件 +
 * tonemapping/colorspace 输出（QuasarNearView 先例）。
 * 资源生命周期（附录 A §6）：geometry/material 卸载即 dispose。
 * 渲染纪律（附录 A §2）：每帧仅 uniform/标量直写，零对象分配、零随机。
 */

import type { JSX } from 'react';
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { RelativisticJet } from '@/components/Scene/ExtragalacticObjects';
import {
  GRB_AFTERGLOW_COLOR_COOL,
  GRB_AFTERGLOW_COLOR_HOT,
  GRB_AFTERGLOW_MAX_RADIUS_FACTOR,
  GRB_NEAR_JET_BASE_OPACITY,
  GRB_NEAR_JET_COLOR,
  GRB_NEAR_JET_FULL_ANGLE_DEG,
  GRB_NEAR_JET_LENGTH_FACTOR,
  grbAfterglowState,
  grbNearJetWeight01,
  jetConeRadiusFactor,
} from '@/utils/grbNearView';

/** 细节层对象不参与射线检测（点选仍由既有闪光 sprite 承担） */
const NOOP_RAYCAST = (): void => {};

/** 喷流方向（局部 +y；挂载方以组姿态对齐静态双锥轴） */
const JET_DIRECTION = new THREE.Vector3(0, 1, 0);

// ---------------------------------------------------------------------------
// 余辉壳 shader（临边增亮球壳：视线切向壳层光程长的薄壳近似）
// ---------------------------------------------------------------------------

const SHELL_VERTEX = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  varying vec3 vNormalW;
  varying vec3 vWorldPos;
  void main() {
    vNormalW = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorldPos = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
    #include <logdepthbuf_vertex>
  }
`;

const SHELL_FRAGMENT = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_fragment>
  uniform float uOpacity;
  uniform float uAge01;
  uniform vec3 uColorHot;
  uniform vec3 uColorCool;
  varying vec3 vNormalW;
  varying vec3 vWorldPos;
  void main() {
    #include <logdepthbuf_fragment>
    vec3 viewDir = normalize(cameraPosition - vWorldPos);
    float mu = abs(dot(normalize(vNormalW), viewDir));
    // 临边增亮（薄壳视线弦长近似）：边缘亮、盘心弱余量
    float limb = pow(1.0 - mu, 2.0) * 0.9 + 0.1;
    // 颜色随龄蓝白 → 暗橙（频段演化艺术化档，登记）
    vec3 col = mix(uColorHot, uColorCool, clamp(uAge01, 0.0, 1.0));
    float a = limb * uOpacity;
    if (a < 0.003) discard;
    gl_FragColor = vec4(col * (0.4 + 1.6 * limb), a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export interface GrbNearCoreProps {
  /** 基准半径（场景单位；主场景 = EXTRAGALACTIC_VIEW_RADIUS_UNITS，预览 = 1） */
  baseRadiusUnits: number;
  /** 读取本帧不透明度权重（层级权重 × 近观权重） */
  getOpacity: () => number;
  /** 虚拟时钟覆写（预览页 timeScale；缺省用场景时钟——与主场景
   * grbFlashState 同一时基，闪光/喷流/余辉相位同步） */
  getTimeSec?: () => number;
  /** 喷流全开角覆写（度；预览页滑杆，缺省 5° 登记档） */
  getJetAngleDeg?: () => number;
  /** 喷流亮度倍率覆写（缺省 1） */
  getJetGain?: () => number;
  /** 余辉强度倍率覆写（缺省 1） */
  getShellGain?: () => number;
}

/**
 * GRB 近观两层（双喷流 + 余辉膨胀壳）；喷流轴 = 局部 +y。
 * 开角滑杆变化经 props 触发锥体几何重建（仅预览页交互期，登记）。
 */
export function GrbNearCore({
  baseRadiusUnits,
  getOpacity,
  getTimeSec,
  getJetAngleDeg,
  getJetGain,
  getShellGain,
}: GrbNearCoreProps): JSX.Element {
  const shellRef = useRef<THREE.Mesh>(null);
  const timeRef = useRef(0);

  const shellMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        uniforms: {
          uOpacity: { value: 0 },
          uAge01: { value: 0 },
          uColorHot: { value: new THREE.Color(GRB_AFTERGLOW_COLOR_HOT) },
          uColorCool: { value: new THREE.Color(GRB_AFTERGLOW_COLOR_COOL) },
        },
        vertexShader: SHELL_VERTEX,
        fragmentShader: SHELL_FRAGMENT,
      }),
    [],
  );
  useEffect(() => () => shellMaterial.dispose(), [shellMaterial]);

  /** 喷流可见权重（层级/近观权重 × 周期演化 × 亮度滑杆；帧读闭包挂载期固定） */
  const getJetWeight = useMemo(
    () => () =>
      getOpacity() *
      grbNearJetWeight01(timeRef.current) *
      Math.min(2, getJetGain ? getJetGain() : 1),
    [getOpacity, getJetGain],
  );

  useFrame(({ clock }) => {
    const t = getTimeSec ? getTimeSec() : clock.elapsedTime;
    timeRef.current = t;
    const shell = shellRef.current;
    if (!shell) return;
    const { radius01, opacity01, age01 } = grbAfterglowState(t);
    const opacity =
      opacity01 * getOpacity() * Math.min(2, getShellGain ? getShellGain() : 1);
    shell.visible = opacity > 0.003 && radius01 > 0.001;
    if (!shell.visible) return;
    shell.scale.setScalar(
      Math.max(1e-4, radius01 * GRB_AFTERGLOW_MAX_RADIUS_FACTOR * baseRadiusUnits),
    );
    shellMaterial.uniforms.uOpacity.value = opacity;
    shellMaterial.uniforms.uAge01.value = age01;
  });

  const jetAngleDeg = getJetAngleDeg ? getJetAngleDeg() : GRB_NEAR_JET_FULL_ANGLE_DEG;

  return (
    <group>
      {/* 相对论双喷流（RelativisticJet 参数化复用：~5° 更窄、蓝白更亮） */}
      <RelativisticJet
        direction={JET_DIRECTION}
        lengthUnits={GRB_NEAR_JET_LENGTH_FACTOR * baseRadiusUnits}
        color={GRB_NEAR_JET_COLOR}
        bilateral
        baseOpacity={GRB_NEAR_JET_BASE_OPACITY}
        radiusFactor={jetConeRadiusFactor(jetAngleDeg)}
        getWeight={getJetWeight}
      />
      {/* 余辉膨胀壳（uTime 语义膨胀减暗：R ∝ t^(1/4) + 幂律衰减登记） */}
      <mesh
        ref={shellRef}
        material={shellMaterial}
        raycast={NOOP_RAYCAST}
        visible={false}
      >
        <sphereGeometry args={[1, 48, 32]} />
      </mesh>
    </group>
  );
}
