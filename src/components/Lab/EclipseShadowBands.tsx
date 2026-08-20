'use client';

/**
 * 影带（shadow bands）屏幕空间 pass（E-M3-5，需求 §4.3；登记 A7）
 *
 * 机制真实（大气湍流折射细月牙准直光在地面投下快速低对比明暗波纹）、
 * 形态为程序化风格再现——科普卡（lab.eclipseCardC2）注明。
 *
 * 先例骨架：Scene/ClusterLensingEffect.tsx + PostEffects 挂载纪律——
 * postprocessing 自定义 Effect（非卷积属性自成 EffectPass 排在 Bloom 前），
 * **非影带时段由父组件卸载本 pass（零渲染开销）**，挂载期间每帧只写
 * 标量 uniform（强度包络 shadowBandsStrength01 + 相位 = tSec 派生——
 * §3.1 红线：效果由 tSec 单值可重建，无帧间累积）。
 *
 * 形态：屏幕下部（地面区域）细而快的波纹——两组斜向正弦 + 哈希抖动，
 * 波长/速度取观测记录量级（波纹间距 ~10 cm 级、移速数 m/s，映射到屏幕
 * 空间为高频快速平移），对比度 ≤5%（低对比是影带难以察觉的真实特征）。
 */

import type { JSX } from 'react';
import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { Effect } from 'postprocessing';

/** 波纹最大亮度对比（±5%；真实影带对比度低于此量级） */
const BANDS_CONTRAST = 0.05;

/** 屏幕下部包络：uv.y 低于此值波纹全强，向上渐隐（地面区域近似） */
const BANDS_TOP_EDGE = 0.55;
const BANDS_FADE_SPAN = 0.2;

/**
 * mainImage 钩子：inputColor × (1 + 波纹)。波纹 = 两组不同频率/走向的
 * 正弦叠加 × 行向哈希抖动（打散规则条纹），uTime 驱动快速平移。
 */
const SHADOW_BANDS_FRAGMENT = /* glsl */ `
  uniform float uStrength;
  uniform float uTime;
  uniform float uAspect;

  float sbHash(float n) {
    return fract(sin(n * 127.1) * 43758.5453);
  }

  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    vec2 p = vec2(uv.x * uAspect, uv.y);
    // 两组细波纹（不同频率与斜率，快速平移；相位由事件时间轴秒派生）
    float w1 = sin(p.x * 90.0 + p.y * 24.0 + uTime * 9.0);
    float w2 = sin(p.x * 140.0 - p.y * 36.0 + uTime * 13.7);
    // 行向哈希抖动：打散规则干涉纹，趋近湍流的无序观感
    float jitter = sbHash(floor(p.y * 60.0)) - 0.5;
    float ripple = (w1 * 0.6 + w2 * 0.4) * (0.7 + 0.6 * jitter);
    // 屏幕下部包络（地面区域），向上渐隐
    float ground = 1.0 - smoothstep(${(BANDS_TOP_EDGE - BANDS_FADE_SPAN).toFixed(2)}, ${BANDS_TOP_EDGE.toFixed(2)}, uv.y);
    float gain = 1.0 + ${BANDS_CONTRAST.toFixed(3)} * ripple * ground * uStrength;
    outputColor = vec4(inputColor.rgb * gain, inputColor.a);
  }
`;

/** 影带 Effect（uniform 由 pass 组件每帧直写） */
class EclipseShadowBandsEffectImpl extends Effect {
  public constructor() {
    super('EclipseShadowBandsEffect', SHADOW_BANDS_FRAGMENT, {
      uniforms: new Map<string, THREE.Uniform>([
        ['uStrength', new THREE.Uniform(0)],
        ['uTime', new THREE.Uniform(0)],
        ['uAspect', new THREE.Uniform(1)],
      ]),
    });
  }
}

export interface EclipseShadowBandsPassProps {
  /** 帧读强度（shadowBandsStrength01 包络；父级时段门控只在窗内挂载） */
  getStrength: () => number;
  /** 帧读相位时间（秒；tSec 派生——seek 一致性） */
  getTime: () => number;
}

/** 影带 pass 挂载组件（EffectComposer 子节点；窗外由父级卸载零开销） */
export function EclipseShadowBandsPass({
  getStrength,
  getTime,
}: EclipseShadowBandsPassProps): JSX.Element {
  const effect = useMemo(() => new EclipseShadowBandsEffectImpl(), []);
  useEffect(() => () => effect.dispose(), [effect]);

  useFrame(({ camera }) => {
    effect.uniforms.get('uStrength')!.value = getStrength();
    effect.uniforms.get('uTime')!.value = getTime();
    effect.uniforms.get('uAspect')!.value = (camera as THREE.PerspectiveCamera).aspect ?? 1;
  });

  return <primitive object={effect} dispose={null} />;
}
