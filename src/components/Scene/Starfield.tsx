'use client';


import type { JSX } from 'react';
/**
 * 确定性星场背景 + 恒星闪烁（P3-5，需求 §4.6）
 *
 * ⚠ 科学性登记（强制）：真空中恒星不闪烁——闪烁源于大气湍流（视宁度），
 * 太空中恒星亮度恒定。本闪烁为艺术化处理，采用方案A：仅 L1 行星视角启用
 * （符合"处于行星大气内观察"的物理逻辑），L2 及以外层级闪烁淡出为 0。
 * 帮助信息另有说明（HelpHint）。纯逻辑与参数见 utils/starTwinkle.ts。
 *
 * 确定性：每星独立相位/频率/幅度由种子随机流预生成为顶点属性
 * （无每帧随机数）；亮度扰动为双正弦叠加（频率不可通约），低频 0.5–2 Hz、
 * 幅度 ±10–20%，亮星略明显、暗星微弱。
 */

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useSimulationStore } from '@/store';
import { createSeededRandom } from '@/utils/random';
import { twinkleAmplitude, twinkleFrequencyHz, twinkleLevelGain } from '@/utils/starTwinkle';

/** 恒星温度色板（O/B 蓝 → M 红，需求 4.1/4.2） */
const STAR_COLORS = ['#9bb0ff', '#aabfff', '#cad7ff', '#f8f7ff', '#fff4ea', '#ffd2a1', '#ffcc6f'];

interface StarfieldProps {
  count?: number;
  innerRadius?: number;
  outerRadius?: number;
  seed?: number;
}

const VERTEX_SHADER = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  attribute float aPhase;
  attribute float aFreq;
  attribute float aAmp;
  uniform float uTime;
  uniform float uTwinkle;
  uniform float uSize;
  uniform float uScale;
  varying vec3 vColor;
  void main() {
    // 双正弦叠加闪烁（utils/starTwinkle.twinkleFactor 镜像；确定性、无随机数）
    float wave = 0.7 * sin(6.28318 * (aFreq * uTime + aPhase))
               + 0.3 * sin(6.28318 * (2.33 * aFreq * uTime + 2.7 * aPhase));
    float tw = 1.0 + aAmp * uTwinkle * wave;
    vColor = color * tw;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = uSize * (uScale / -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;
    #include <logdepthbuf_vertex>
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_fragment>
  varying vec3 vColor;
  void main() {
    #include <logdepthbuf_fragment>
    // 柔边圆形星点
    float d = length(gl_PointCoord - vec2(0.5));
    float alpha = (1.0 - smoothstep(0.28, 0.5, d)) * 0.9;
    if (alpha < 0.01) discard;
    gl_FragColor = vec4(vColor, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/**
 * 确定性星场背景：种子化伪随机保证位置稳定（无闪屏），
 * 颜色按恒星温度分布采样，亮度含距离衰减。
 */
export function Starfield({
  count = 6000,
  innerRadius = 2000,
  outerRadius = 40000,
  seed = 20260722,
}: StarfieldProps): JSX.Element {
  const lastGainRef = useRef(-1);

  const { geometry, material } = useMemo(() => {
    const rand = createSeededRandom(seed);
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const phases = new Float32Array(count);
    const freqs = new Float32Array(count);
    const amps = new Float32Array(count);
    const color = new THREE.Color();

    for (let i = 0; i < count; i += 1) {
      // 球壳内均匀分布
      const u = rand();
      const v = rand();
      const theta = 2 * Math.PI * u;
      const phi = Math.acos(2 * v - 1);
      const r = innerRadius + (outerRadius - innerRadius) * Math.cbrt(rand());
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.cos(phi);
      positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);

      // 温度色板 + 距离衰减
      color.set(STAR_COLORS[Math.floor(rand() * STAR_COLORS.length)]);
      const falloff = 1 - (0.6 * (r - innerRadius)) / (outerRadius - innerRadius);
      colors[i * 3] = color.r * falloff;
      colors[i * 3 + 1] = color.g * falloff;
      colors[i * 3 + 2] = color.b * falloff;

      // 闪烁参数（确定性预生成）：亮星幅度略大、暗星微弱
      phases[i] = rand();
      freqs[i] = twinkleFrequencyHz(rand());
      amps[i] = twinkleAmplitude(falloff, rand());
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
    geo.setAttribute('aFreq', new THREE.BufferAttribute(freqs, 1));
    geo.setAttribute('aAmp', new THREE.BufferAttribute(amps, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uTwinkle: { value: 0 },
        uSize: { value: 12 },
        uScale: { value: 400 },
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
    });
    return { geometry: geo, material: mat };
  }, [count, innerRadius, outerRadius, seed]);

  useEffect(() => {
    return () => {
      geometry.dispose();
      material.dispose();
    };
  }, [geometry, material]);

  useFrame((state) => {
    // 点大小随屏幕像素高度衰减（对齐 PointsMaterial sizeAttenuation 行为）
    material.uniforms.uScale.value = state.gl.domElement.height * 0.5;
    const { continuousLevel } = useSimulationStore.getState();
    const gain = twinkleLevelGain(continuousLevel);
    // uniform 更新按可见性门控：L2 及以外（gain=0）跳过时间推进
    if (gain === 0 && lastGainRef.current === 0) return;
    lastGainRef.current = gain;
    material.uniforms.uTwinkle.value = gain;
    material.uniforms.uTime.value = state.clock.elapsedTime;
  });

  return <points geometry={geometry} material={material} />;
}
