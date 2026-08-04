'use client';

import type { JSX } from 'react';
import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { Effect } from 'postprocessing';
import {
  CLUSTER_LENSING_DOMAIN_INNER_RATIO,
  clusterLensingSource,
  clusterLensingUniforms,
  type ClusterLensingUniforms,
} from '@/utils/clusterLensing';

/**
 * 星系团屏幕空间引力透镜 Effect（R4-23，方案 a 登记）
 *
 * 方案登记（§R4-23 第 1 条二选一）：采用 a) postprocessing 自定义
 * Effect——团块质心 SIS 模型偏转屏幕 UV（uv_src = center + β(θ)，
 * 模型与近似登记见 utils/clusterLensing 文件头），背景（星场/宇宙网/
 * 近观背景源 sprite）在爱因斯坦半径附近被拉伸成切向弧/部分环。
 *
 * 与既有管线的集成（附录 A §5）：
 * - @react-three/postprocessing v3 按子对象收集 Effect：本效果为
 *   非卷积属性 → 自成 EffectPass 排在 Bloom（CONVOLUTION，独立
 *   EffectPass）之前，Bloom 采样的是已透镜化的帧缓冲——泛光光晕与
 *   透镜像几何一致，无错位伪影；既有 Bloom 配置零改动。
 * - 纯颜色域 UV 重采样，不读深度缓冲：与 log depth buffer、体积层
 *   （RT 在 EffectComposer 之前合成入场景）无交互，天然兼容。
 * - 挂载由 PostEffects 按"跟随/飞往 cluster-lensing"域判据控制
 *   （非跟随不挂载 → 零渲染开销），本组件只负责 uniform 帧写。
 */

/** 域窗内沿比例注入 shader（与 utils/clusterLensing.lensDomainWindow 同式） */
const INNER_RATIO_GLSL = CLUSTER_LENSING_DOMAIN_INNER_RATIO.toFixed(4);

/**
 * SIS 屏幕 UV 偏转 fragment（postprocessing Effect 约定的 mainUv 钩子）：
 * 方形 UV 空间（x 乘 aspect）中按 β = θ − θ_E·θ̂ 重采样，域窗外沿
 * smoothstep 归零（lensDomainWindow 同式，单测锚定 TS 侧一致性）
 */
const CLUSTER_LENSING_FRAGMENT = /* glsl */ `
  uniform vec2 uCenter;
  uniform float uThetaE;
  uniform float uRadiusMax;
  uniform float uAspect;
  uniform float uStrength;

  void mainUv(inout vec2 uv) {
    vec2 d = uv - uCenter;
    d.x *= uAspect;
    float r = length(d);
    float window = 1.0 - smoothstep(uRadiusMax * ${INNER_RATIO_GLSL}, uRadiusMax, r);
    float pull = uThetaE * uStrength * window;
    vec2 beta = d - pull * (d / max(r, 1e-5));
    beta.x /= uAspect;
    uv = clamp(uCenter + beta, 0.0, 1.0);
  }
`;

/** SIS 透镜 Effect（uniform 由 ClusterLensingPass 每帧直写） */
class ClusterLensingEffectImpl extends Effect {
  public constructor() {
    super('ClusterLensingEffect', CLUSTER_LENSING_FRAGMENT, {
      uniforms: new Map<string, THREE.Uniform>([
        ['uCenter', new THREE.Uniform(new THREE.Vector2(0.5, 0.5))],
        ['uThetaE', new THREE.Uniform(0)],
        ['uRadiusMax', new THREE.Uniform(0.001)],
        ['uAspect', new THREE.Uniform(1)],
        ['uStrength', new THREE.Uniform(0)],
      ]),
    });
  }
}

export interface ClusterLensingPassProps {
  /** 帧读效果强度 getter（PostEffects 淡入淡出 / 预览页常量 1） */
  getStrength: () => number;
}

/** 渲染循环临时向量（零分配纪律） */
const TMP_VIEW = new THREE.Vector3();
const TMP_NDC = new THREE.Vector3();
/** uniform 换算复用对象（clusterLensingUniforms out 参数） */
const TMP_UNIFORMS: ClusterLensingUniforms = {
  centerU: 0.5,
  centerV: 0.5,
  thetaEUv: 0,
  radiusMaxUv: 0.001,
};

/**
 * 透镜 Effect 的 R3F 挂载组件（EffectComposer 子节点）：
 * 每帧读源持有者（LensingArcs/预览场景写入）+ 相机投影 → uniform 直写。
 * 团块位于相机后方/不可见/强度归零时 uStrength=0（effect 数学恒等，
 * 挂载期间兜底；非跟随时组件整体不挂载才是零开销路径）。
 */
export function ClusterLensingPass({ getStrength }: ClusterLensingPassProps): JSX.Element {
  const effect = useMemo(() => new ClusterLensingEffectImpl(), []);
  useEffect(() => () => effect.dispose(), [effect]);

  useFrame(({ camera }) => {
    const uniforms = effect.uniforms;
    const uStrength = uniforms.get('uStrength')!;
    const src = clusterLensingSource();
    const strength = src.present ? getStrength() * src.visible01 : 0;
    if (strength <= 0.001) {
      uStrength.value = 0;
      return;
    }
    // 相机后方判据：视空间 z ≥ 0（project 会镜像穿帮，直接归零）
    TMP_VIEW.set(src.worldX, src.worldY, src.worldZ).applyMatrix4(
      camera.matrixWorldInverse,
    );
    if (TMP_VIEW.z >= -1e-3) {
      uStrength.value = 0;
      return;
    }
    const persp = camera as THREE.PerspectiveCamera;
    TMP_NDC.set(src.worldX, src.worldY, src.worldZ).project(camera);
    clusterLensingUniforms(
      TMP_NDC.x,
      TMP_NDC.y,
      TMP_VIEW.length(),
      THREE.MathUtils.degToRad(persp.fov),
      src.einsteinRadiusUnits,
      TMP_UNIFORMS,
    );
    (uniforms.get('uCenter')!.value as THREE.Vector2).set(
      TMP_UNIFORMS.centerU,
      TMP_UNIFORMS.centerV,
    );
    uniforms.get('uThetaE')!.value = TMP_UNIFORMS.thetaEUv;
    uniforms.get('uRadiusMax')!.value = TMP_UNIFORMS.radiusMaxUv;
    uniforms.get('uAspect')!.value = persp.aspect;
    uStrength.value = strength;
  });

  return <primitive object={effect} dispose={null} />;
}
