'use client';

/**
 * 近观流星头部细节层（M3.6-4③ 决策 E③；M3.8-4① S1 重做）：单 billboard
 * mesh 程序化等离子体 shader——"小而实"结构：紧凑 HDR 辉光核（喂 Bloom）
 * + 短锥形等离子尾（沿 −X 收敛）+ fbm 高频湍流只调制亮度（不扰动轮廓
 * 半径——消 S1"水滴气泡"边界感）+ 前缘细弧冲击弓（弱化）+ alpha 紧贴
 * 发光区（亮背景不显形）；火流星脉动 + 镁绿保留。
 *
 * S1 修正登记（2026-08-13）：尺寸减半（0.14/0.32 → 0.06/0.16 km 半幅）
 * + 角尺寸钳制 scale = min(sizeKm, dist×tan(HEAD_MAX_ANGLE_RAD/2))
 * （θmax = 8°，任意观距不吞屏——最近 0.6 km 观距原尺寸张角达 26°/56°）。
 *
 * 渲染归属（登记）：常驻挂载 + 仅演示/跟随期间 visible（+1 draw call，
 * 不占 §4.1 的 3 个粒子系统预算——非粒子 mesh）。位置 = CPU 逐帧
 * evalCubic 求头部（shader 位移公式镜像；单 mesh position/quaternion/
 * scale/uniform 更新，非粒子 buffer 上传——契约 C2.1 口径合规）。
 *
 * billboard 定向：quaternion 对齐相机（面向屏幕）后绕局部 Z 旋转，使
 * 局部 +X 轴对齐速度的屏幕投影方向——冲击弓恒在飞行前缘、等离子尾拖后。
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
import { HEAD_MAX_ANGLE_RAD } from '@/utils/labSky';
import { NOISE_GLSL } from '@/components/Lab/AfterglowField';
import type { LabFrameRefs } from '@/components/Lab/labTypes';

/** 头部细节 billboard 半幅（km；M3.8-4① S1 减半——紧凑等离子体包络量级） */
const HEAD_SIZE_ORDINARY_KM = 0.06;
const HEAD_SIZE_FIREBALL_KM = 0.16;

/** 角尺寸钳制预乘因子 tan(θmax/2)（θmax = 8°，任意观距不吞屏） */
const HEAD_ANGULAR_CLAMP_TAN = Math.tan(HEAD_MAX_ANGLE_RAD / 2);

const HEAD_VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/**
 * 程序化等离子体（M3.8-4① S1 重做；局部坐标约定：+X = 飞行方向屏幕投影
 * = 冲击弓前缘，−X = 等离子尾）。"小而实"层次：紧凑 HDR 白炽核（半径
 * ~0.09，×6 喂 Bloom）→ 短锥形等离子尾（−X 收敛、长 ~2× 核径，fbm 高频
 * 多倍频**只乘亮度不扰动轮廓半径**——消气球边界感）→ 前缘细弧冲击弓
 * （弱化薄壳）；alpha 紧贴发光区（阈值以下 → 0，亮背景不显形）。
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
    v += 0.25 * valueNoise3(p * 2.11);
    v += 0.125 * valueNoise3(p * 4.31);
    v += 0.0625 * valueNoise3(p * 8.53);
    return v / 0.9375;
  }

  void main() {
    vec2 c = vUv - vec2(0.5);
    // 火流星脉动：尺度呼吸（±10%）——保留 M3.6 口径
    float pulse = 1.0 + uIsFireball * 0.10 * sin(uTime * 26.0 + 3.0 * valueNoise3(vec3(uTime * 4.0)));
    c /= pulse;
    float rc = length(c);
    // 紧凑 HDR 白炽核：半径 ~0.09（quad 半幅的 18%），×6 喂 Bloom（§4.4）
    float core = (1.0 - smoothstep(0.0, 0.09, rc)) * 6.0;
    // 短锥形等离子尾：c.x ∈ [−0.36, 0]（长 ~2× 核径），半宽 0.07 → 0 收敛
    float tailT = clamp(-c.x / 0.36, 0.0, 1.0);
    float halfW = mix(0.07, 0.006, tailT);
    float tail = (1.0 - smoothstep(halfW * 0.3, halfW, abs(c.y)))
      * (1.0 - tailT) * (1.0 - tailT)
      * step(c.x, 0.0) * step(-0.36, c.x);
    // fbm 高频湍流：只乘亮度、不扰动轮廓半径（S1 根源修正——等离子体
    // 密度起伏观感，轮廓由核/锥形包络严格限定）
    float turb = fbm3(vec3(c * 22.0 + vec2(uTime * 2.5, 0.0), uTime * 3.5));
    tail *= 0.5 + 0.5 * turb;
    // 前缘细弧冲击弓（弱化）：核外薄弧带（半径 0.12、σ≈0.017），仅 +X 侧
    float ang = c.x / max(rc, 1e-5);
    float bow = exp(-pow((rc - 0.12) * 60.0, 2.0)) * smoothstep(0.35, 0.9, ang) * 0.5;
    // 混色：火流星混镁绿 518 nm（烧蚀镁线发射，MeteorField 同口径）
    vec3 base = mix(uColor, vec3(0.25, 0.95, 0.4), uIsFireball * 0.5);
    float flicker = 0.85 + 0.3 * valueNoise3(vec3(uTime * 18.0, 7.7, 3.3));
    vec3 col = vec3(1.0, 0.98, 0.94) * core
      + base * tail * 1.5
      + vec3(0.85, 0.95, 1.0) * bow;
    // alpha 紧贴发光区：归一发光强度低于阈值 → 0（消大范围弱包络，
    // 加性混合下亮背景不显形灰色气泡）
    float glow = core / 6.0 + tail + bow;
    float alpha = smoothstep(0.04, 0.30, glow);
    if (alpha < 0.01) discard;
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
    // 角尺寸钳制（M3.8-4① S1）：scale = min(sizeKm, dist×tan(θmax/2))——
    // 近观（跟随最近 0.6 km）张角恒 ≤ 8°，任意观距不吞屏
    const sizeKm = slot.isFireball ? HEAD_SIZE_FIREBALL_KM : HEAD_SIZE_ORDINARY_KM;
    const distKm = camera.position.distanceTo(mesh.position);
    mesh.scale.setScalar(Math.min(sizeKm, distKm * HEAD_ANGULAR_CLAMP_TAN));
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
