'use client';

/**
 * 近观流星头部细节层（M3.6-4③，决策 E③）：单 billboard mesh 程序化
 * 等离子体 shader——fbm 湍流火球 + 前缘冲击弓（沿速度屏幕投影定向）+
 * fresnel 边缘辉光 + HDR 核心喂 Bloom；火流星额外脉动 + 镁绿混色。
 * "行星近观 4K 细节层"的流星对应物。
 *
 * 渲染归属（登记）：常驻挂载 + 仅演示/跟随期间 visible（+1 draw call，
 * 不占 §4.1 的 3 个粒子系统预算——非粒子 mesh）。位置 = CPU 逐帧
 * evalCubic 求头部（shader 位移公式镜像；单 mesh position/quaternion/
 * uniform 更新，非粒子 buffer 上传——契约 C2.1 口径合规）。
 *
 * billboard 定向：quaternion 对齐相机（面向屏幕）后绕局部 Z 旋转，使
 * 局部 +X 轴对齐速度的屏幕投影方向——冲击弓恒在飞行前缘、湍流尾迹拖后。
 */

import type { JSX } from 'react';
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import {
  evalCubic,
  horizontalFromEquatorial,
  localSiderealTime,
  sceneDirFromAltAz,
  type MeteorSlot,
} from '@/utils/meteorShower';
import { NOISE_GLSL } from '@/components/Lab/AfterglowField';
import type { LabFrameRefs } from '@/components/Lab/labTypes';

/** 头部细节 billboard 半幅（km；等离子体包络 ~百米量级，火流星更大） */
const HEAD_SIZE_ORDINARY_KM = 0.14;
const HEAD_SIZE_FIREBALL_KM = 0.32;

const HEAD_VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/**
 * 程序化等离子体（局部坐标约定：+X = 飞行方向屏幕投影 = 冲击弓前缘，
 * −X = 湍流尾迹）。层次：HDR 白炽核（喂 Bloom）→ fbm 湍流火球（雨色）
 * → 前缘冲击弓（抛物线薄壳）→ fresnel 边缘辉光；火流星脉动 + 镁绿。
 */
const HEAD_FRAGMENT_SHADER = /* glsl */ `
  uniform float uTime;
  uniform float uIntensity;
  uniform float uIsFireball;
  uniform vec3 uColor;
  varying vec2 vUv;
  ${NOISE_GLSL}

  float fbm3(vec3 p) {
    float v = 0.0;
    v += 0.5 * valueNoise3(p);
    v += 0.25 * valueNoise3(p * 2.03);
    v += 0.125 * valueNoise3(p * 4.09);
    return v / 0.875;
  }

  void main() {
    vec2 c = vUv - vec2(0.5);
    // 火流星脉动：整体尺度呼吸（±12%）+ 亮度起伏
    float pulse = 1.0 + uIsFireball * 0.12 * sin(uTime * 26.0 + 3.0 * valueNoise3(vec3(uTime * 4.0)));
    c /= pulse;
    // 尾迹拖长：−X 侧半径放宽（椭圆偏心），+X 侧收紧贴冲击弓
    float stretch = mix(1.0, 2.4, smoothstep(0.0, -0.4, c.x));
    vec2 pc = vec2(c.x / stretch, c.y);
    float r = length(pc) * 2.0;
    if (r > 1.0) discard;
    // fbm 湍流：径向扰动（等离子体絮状边界，随时间流变、向尾部对流）
    float turb = fbm3(vec3(c * 9.0 + vec2(uTime * 2.2, 0.0), uTime * 3.1));
    float rTurb = r + (turb - 0.5) * 0.5;
    // 火球主体（雨色等离子体辉团）
    float body = 1.0 - smoothstep(0.12, 0.72, rTurb);
    // HDR 白炽核：核心过载 ×6 喂 Bloom（§4.4 口径）
    float core = (1.0 - smoothstep(0.0, 0.16, r)) * 6.0;
    // 前缘冲击弓：抛物线 x = x0 − k·y² 的薄壳带（仅 +X 侧，弓形包络）
    float bowX = 0.30 - 1.1 * c.y * c.y;
    float bow = exp(-pow((c.x - bowX) * 10.0, 2.0))
      * (1.0 - smoothstep(0.18, 0.42, abs(c.y)))
      * step(0.0, c.x);
    // fresnel 边缘辉光：椭圆包络切向亮环
    float fresnel = smoothstep(0.55, 0.95, rTurb) * (1.0 - smoothstep(0.95, 1.0, r));
    // 混色：火流星混镁绿 518 nm（烧蚀镁线发射，MeteorField 同口径）
    vec3 base = mix(uColor, vec3(0.25, 0.95, 0.4), uIsFireball * 0.5);
    float flicker = 0.85 + 0.3 * valueNoise3(vec3(uTime * 18.0, 7.7, 3.3));
    vec3 col = vec3(1.0, 0.98, 0.94) * core
      + base * body * 1.4
      + vec3(0.85, 0.95, 1.0) * bow * 1.8
      + base * fresnel * 0.7;
    float alpha = max(body, max(bow, fresnel)) * (1.0 - smoothstep(0.85, 1.0, r));
    gl_FragColor = vec4(col * uIntensity * flicker, alpha * min(uIntensity, 1.0));
  }
`;

interface MeteorHeadDetailProps {
  slots: readonly MeteorSlot[];
  refs: LabFrameRefs;
}

/** 近观流星头部等离子体细节（单 mesh；每帧只动 position/quaternion/uniforms） */
export function MeteorHeadDetail({ slots, refs }: MeteorHeadDetailProps): JSX.Element {
  const meshRef = useRef<THREE.Mesh>(null);

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uIntensity: { value: 0 },
          uIsFireball: { value: 0 },
          uColor: { value: new THREE.Color(0.62, 0.76, 1.0) },
        },
        vertexShader: HEAD_VERTEX_SHADER,
        fragmentShader: HEAD_FRAGMENT_SHADER,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    []
  );

  // 帧临时对象（挂载期复用，渲染循环零 GC）
  const tmp = useMemo(
    () => ({ vCam: new THREE.Vector3(), qz: new THREE.Quaternion(), zAxis: new THREE.Vector3(0, 0, 1) }),
    []
  );

  useEffect(() => {
    return () => {
      material.dispose();
    };
  }, [material]);

  useFrame((state) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    // 仅演示/跟随期间可见（followRef 槽位与演示同源，优先取跟随）
    const active = refs.followRef.current ?? refs.demoRef.current;
    const slot = active ? (slots[active.slotIndex] as MeteorSlot | undefined) : undefined;
    if (!active || !slot) {
      mesh.visible = false;
      return;
    }
    const elapsed = refs.timeSecRef.current - active.startTimeSec;
    if (elapsed < 0 || elapsed > slot.lifetimeSec) {
      mesh.visible = false;
      return;
    }
    // 头部位置 = shader 位移公式 CPU 镜像（流量链经 M1 纯函数）
    const s = refs.settingsRef.current;
    const shower = refs.showerRef.current;
    const lst = localSiderealTime(shower.epochLst0Deg, s.hourOffset, refs.timeSecRef.current / 3600);
    const radiant = horizontalFromEquatorial(
      shower.radiantRaDeg,
      shower.radiantDecDeg,
      s.observerLat,
      lst
    );
    const dir = sceneDirFromAltAz(radiant);
    const disp = evalCubic(slot.dispCoefs, elapsed);
    mesh.position.set(
      slot.startPos[0] - dir[0] * disp,
      slot.startPos[1] - dir[1] * disp,
      slot.startPos[2] - dir[2] * disp
    );
    // billboard：面向相机 + 局部 +X 对齐速度屏幕投影（冲击弓恒在前缘）
    const camera = state.camera;
    tmp.vCam.set(-dir[0], -dir[1], -dir[2]).transformDirection(camera.matrixWorldInverse);
    const angle = Math.atan2(tmp.vCam.y, tmp.vCam.x);
    mesh.quaternion.copy(camera.quaternion).multiply(tmp.qz.setFromAxisAngle(tmp.zAxis, angle));
    mesh.scale.setScalar(slot.isFireball ? HEAD_SIZE_FIREBALL_KM : HEAD_SIZE_ORDINARY_KM);
    // 亮度 = 拟合强度曲线（首尾 smoothstep 抗锯齿叠乘，MeteorField 同式）
    const progress = elapsed / slot.lifetimeSec;
    const fadeIn = Math.min(progress / 0.04, 1);
    const fadeOut = Math.min((1 - progress) / 0.03, 1);
    const inten = Math.max(evalCubic(slot.intenCoefs, elapsed), 0) * fadeIn * fadeOut;
    const u = material.uniforms;
    u.uTime.value = refs.timeSecRef.current;
    u.uIntensity.value = inten;
    u.uIsFireball.value = slot.isFireball ? 1 : 0;
    // 色相同 MeteorField 口径：天鹅座κ橙黄，其余（英仙座/狮子座暴）蓝白
    const warm = shower.id === 'kappaCygnids';
    (u.uColor.value as THREE.Color).setRGB(warm ? 1.0 : 0.62, warm ? 0.68 : 0.76, warm ? 0.32 : 1.0);
    mesh.visible = inten > 0.001;
  });

  return (
    <mesh ref={meshRef} material={material} visible={false} frustumCulled={false}>
      <planeGeometry args={[2, 2]} />
    </mesh>
  );
}
