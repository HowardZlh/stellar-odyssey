'use client';

/**
 * 黑洞引力透镜 raymarch（R4-11 原型 + R4-12 吸积盘物理，
 * IMPROVEMENT_REQUIREMENTS_4 §R4-11/§R4-12 / §0.3 方案 C）
 *
 * 渲染模型：包围球（SphereGeometry 半径 = LENSING_DOMAIN_RADIUS_RS，物体
 * 空间即 r_s 单位，世界尺寸经 mesh.scale = rsWorld 控制）内固定步长弯折
 * raymarch——弱场积分核空间分布 + 二阶闭式总量预算 + 解析阴影判据 +
 * 光子环沿程积累发光，全部公式/常数与 `utils/blackHoleLensing.ts` CPU
 * 参考追踪单点同源（模板插值引用，单测断言系数一致）。
 *
 * 吸积盘（R4-12，物理近似登记见 utils/blackHoleLensing.ts 文件头）：
 * - 几何薄盘在盘空间 y=0 平面、r ∈ [uDiskInnerRs, uDiskOuterRs]；弯折步进
 *   循环内做平面跨越检测（前后两步盘面高度异号 → 线性插值求交，非解析
 *   求交）——弯曲光线可多次交盘，上下缘翻折像即来源；
 * - 温度 T(r) ∝ r^(−3/4)（NT 内缘截断剖面）→ 黑体 LUT 着色（R4-6
 *   blackbodyRGB 预采样）；多普勒束流 δ³ 增亮/减暗 + 色温 ×δ_eff；
 *   引力红移 g = √(1−r_s/r) 亮度 ×g³ + 色温 ×g；
 * - 条纹：差速旋转（ω ∝ r^(−3/2)）值噪声（cos/sin 嵌入消 φ 接缝），
 *   uTime 驱动流动；
 * - 前向透射合成：盘近不透明（每次交盘透射率 ×(1−a·0.92)），交盘后背景
 *   星场按剩余透射率显示，光子环发光全程叠加。
 *
 * 背景采样：出射方向查程序化星场 cubemap（`buildStarfieldCubeTexture`，
 * 128px/面，无贴图资产）。消费方同时把同一 cubemap 设为 scene.background，
 * 包围球轮廓处弯曲量趋零（切向短弦，积分核积不出偏转）→ 球内外星场
 * 连续无接缝（实测登记）。
 *
 * 管线兼容（附录 A §5）：
 * - log depth buffer：含 logdepthbuf include（`Starfield.tsx` :33 先例同式）；
 * - 不透明输出（alpha=1，黑洞阴影须遮蔽背景），side=BackSide 保证相机
 *   推入包围球内仍有面片可栅格化（起步点钳到相机处）；
 * - 数值稳定：方向零分量/零长度防护、单步偏转钳上限、总预算硬钳、
 *   输出亮度硬钳——任意视角无 NaN/Inf 输出；
 * - 步进上限：循环编译期上界 LENSING_STEPS_MAX（=128），uSteps 运行时可调。
 *
 * 资源生命周期（附录 A §6）：材质/星场 cubemap 由消费方持有并 dispose
 * （`disposeBlackHoleLensedMaterial` 可一并回收工厂自建的 cubemap）。
 */

import type { JSX, RefObject } from 'react';
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import {
  CAPTURE_RADIUS_RS,
  DEFLECTION_SECOND_ORDER_COEFF,
  DISK_BETA_MAX,
  DISK_INNER_RADIUS_RS_DEFAULT,
  DISK_LUT_TEMP_MAX_K,
  DISK_LUT_TEMP_MIN_K,
  DISK_LUT_WIDTH,
  DISK_OUTER_RADIUS_RS_DEFAULT,
  DISK_STRIPE_OMEGA,
  DISK_TEMP_PEAK_K_DEFAULT,
  DISK_TEMP_PROFILE_NORM,
  GRAV_REDSHIFT_FLOOR,
  LENSING_DOMAIN_RADIUS_RS,
  LENSING_STEPS_DEFAULT,
  LENSING_STEPS_MAX,
  MAX_BEND_PER_STEP_RAD,
  PHOTON_RING_IMPACT_RS,
  PHOTON_RING_IMPACT_SIGMA_RS,
  PHOTON_RING_SIGMA_RS,
  PHOTON_SPHERE_RADIUS_RS,
  STARFIELD_FACE_SIZE,
  buildBlackbodyLutData,
  buildStarfieldFaceData,
  clampDiskRadii,
  clampLensingSteps,
} from '@/utils/blackHoleLensing';

/** 盘发光基准亮度（uDiskBrightness 默认档；Bloom 联调不过曝——2.6 档
 * 实测全盘洗白失去黑体色阶与束流对比，0.85 档内白外橙梯度与近亮远暗
 * 不对称均可辨（远侧脱离 tonemap 饱和区），目验调参登记） */
export const DISK_DEFAULT_BRIGHTNESS = 0.85;

/** 输出亮度硬钳上限（防 Bloom 溢出，VolumeMaterial 同策略） */
export const LENSING_MAX_OUTPUT_LUMINANCE = 8.0;

/** 光子环发光默认色（EHT M87★/Sgr A★ 观感的暖橙白，艺术化登记） */
export const PHOTON_RING_DEFAULT_COLOR = '#ffc27a';

const VERTEX_SHADER = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  varying vec3 vOrigin;
  varying vec3 vDirection;
  varying mat3 vModelRot;
  void main() {
    // 相机位置变换到物体空间（r_s 单位；球顶点少，inverse 开销可忽略）
    vOrigin = vec3(inverse(modelMatrix) * vec4(cameraPosition, 1.0));
    vDirection = position - vOrigin;
    // 物体→世界旋转（fragment 无内建 modelMatrix；等比缩放经 normalize 消去）
    vModelRot = mat3(modelMatrix);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    #include <logdepthbuf_vertex>
  }
`;

// 常数经模板插值与 utils/blackHoleLensing.ts 单点同源（导出供单测断言系数一致）
export const LENSING_FRAGMENT_SHADER = /* glsl */ `
  precision highp float;
  #include <common>
  #include <logdepthbuf_pars_fragment>
  varying vec3 vOrigin;
  varying vec3 vDirection;
  varying mat3 vModelRot;
  uniform samplerCube uStarfield;
  uniform sampler2D uBlackbodyLUT;
  uniform float uSteps;
  uniform float uRingStrength;
  uniform vec3 uRingColor;
  uniform float uStarIntensity;
  uniform float uTime;
  uniform float uDiskInnerRs;
  uniform float uDiskOuterRs;
  uniform float uBeamStrength;
  uniform float uDiskBrightness;
  uniform mat3 uDiskRot;
  // R4-13 场景接入：盘峰值色温缩放（两黑洞橙红/蓝白区分）+ 输出淡入权重
  uniform float uDiskTempScale;
  uniform float uFade;

  const float R_DOMAIN = ${LENSING_DOMAIN_RADIUS_RS.toFixed(1)};
  const float R_CAPTURE = ${CAPTURE_RADIUS_RS.toFixed(2)};
  const float R_PHOTON = ${PHOTON_SPHERE_RADIUS_RS.toFixed(1)};
  const float B_CRIT = ${PHOTON_RING_IMPACT_RS.toFixed(6)};
  const float RING_SIGMA_R = ${PHOTON_RING_SIGMA_RS.toFixed(2)};
  const float RING_SIGMA_B = ${PHOTON_RING_IMPACT_SIGMA_RS.toFixed(2)};
  // 二阶闭式系数 K·π/2（α = 2/b + (K·π/2)/b²，K = ${DEFLECTION_SECOND_ORDER_COEFF}）
  const float SECOND_ORDER = ${((DEFLECTION_SECOND_ORDER_COEFF * Math.PI) / 2).toFixed(6)};
  const float MAX_BEND = ${MAX_BEND_PER_STEP_RAD.toFixed(2)};
  // R4-12 吸积盘常数（utils/blackHoleLensing.ts 单点同源，单测断言）
  const float DISK_TEMP_NORM = ${DISK_TEMP_PROFILE_NORM.toFixed(6)};
  const float DISK_PEAK_K = ${DISK_TEMP_PEAK_K_DEFAULT.toFixed(1)};
  const float DISK_BETA_MAX = ${DISK_BETA_MAX.toFixed(2)};
  const float GRAV_FLOOR = ${GRAV_REDSHIFT_FLOOR.toFixed(2)};
  const float LUT_T_MIN = ${DISK_LUT_TEMP_MIN_K.toFixed(1)};
  const float LUT_T_MAX = ${DISK_LUT_TEMP_MAX_K.toFixed(1)};
  const float STRIPE_OMEGA = ${DISK_STRIPE_OMEGA.toFixed(1)};

  // 值噪声（盘条纹用；确定性 hash，无逐帧随机——附录 A §2）
  float bhHash(vec2 q) {
    return fract(sin(dot(q, vec2(127.1, 311.7))) * 43758.5453);
  }
  float bhNoise(vec2 q) {
    vec2 i = floor(q);
    vec2 f = fract(q);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(bhHash(i), bhHash(i + vec2(1.0, 0.0)), u.x),
      mix(bhHash(i + vec2(0.0, 1.0)), bhHash(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
  }

  void main() {
    #include <logdepthbuf_fragment>
    // 方向归一化（零长度防护）
    vec3 rd = vDirection;
    float rdLen = length(rd);
    rd = rdLen > 1e-12 ? rd / rdLen : vec3(0.0, 0.0, 1.0);

    // 包围球入口（相机在球内则从相机起步；CPU 参考 traceLensedRay 同式）
    vec3 p = vOrigin;
    float ro2 = dot(p, p);
    if (ro2 > R_DOMAIN * R_DOMAIN) {
      float tm = -dot(p, rd);
      float d2 = ro2 - tm * tm;
      float disc = R_DOMAIN * R_DOMAIN - d2;
      // BackSide 面片保证有交点；数值防护取 max
      float tEntry = tm - sqrt(max(disc, 0.0));
      p += rd * max(tEntry, 0.0);
    }

    // 守恒撞击参数 b 于入口一次性求得（CPU 同式）
    float b = length(cross(p, rd));
    // 环发光选通（b ≈ b_crit 高斯）与阴影解析判据
    float dB = (b - B_CRIT) / RING_SIGMA_B;
    float ringGate = exp(-dB * dB);
    // 阴影解析判据：b < b_crit 且起步朝向中心（外行光线不论 b 均出射，
    // 近距观察者视野才不整片误黑；CPU isShadowed 同式）
    bool shadowed = b < B_CRIT && dot(p, rd) < 0.0;
    // 二阶闭式总预算（b→0 发散防护：硬钳 20 rad，黑洞阴影内方向不参与成像）
    float bendBudget = min(2.0 / max(b, 1e-4) + SECOND_ORDER / max(b * b, 1e-4), 20.0);

    float steps = clamp(uSteps, 16.0, ${LENSING_STEPS_MAX.toFixed(1)});
    float ds = (2.0 * R_DOMAIN) / steps;
    vec3 dir = rd;
    float glow = 0.0;
    bool captured = false;

    // 吸积盘前向透射合成状态（R4-12）：盘空间 = uDiskRot × 物体空间
    vec3 diskP = uDiskRot * p;
    vec3 diskAccum = vec3(0.0);
    float trans = 1.0;

    for (int i = 0; i < ${LENSING_STEPS_MAX}; i++) {
      if (float(i) >= steps) break;
      float r = length(p);
      // 撞击终止为黑（§R4-11：r ≤ 1.05 r_s）
      if (r <= R_CAPTURE) { captured = true; break; }
      // 光子环发光积累（b 选通 × 光子球邻域驻留，CPU 同式；
      // R4-12：乘剩余透射率——盘后方的环发光被盘遮蔽，盘前不受影响）
      float dR = (r - R_PHOTON) / RING_SIGMA_R;
      glow += ringGate * exp(-dR * dR) * ds * trans;
      // 弱场核弯折（dα 钳单步上限与总预算，CPU 同式）
      float rSafe = max(r, 1e-4);
      float dAlpha = min(min(b / (rSafe * rSafe * rSafe) * ds, MAX_BEND), bendBudget);
      bendBudget -= dAlpha;
      vec3 inward = -p / rSafe;
      vec3 perp = inward - dot(inward, dir) * dir;
      float perpLen = length(perp);
      if (perpLen > 1e-6 && dAlpha > 0.0) {
        dir = normalize(dir * cos(dAlpha) + (perp / perpLen) * sin(dAlpha));
      }
      vec3 pNext = p + dir * ds;
      // 薄盘平面跨越检测（R4-12：盘面高度异号 → 线性插值求交，
      // planeCrossingLerp 同式；弯曲光线可多次交盘 = 上下缘翻折像来源）
      vec3 diskPNext = uDiskRot * pNext;
      if (diskP.y * diskPNext.y < 0.0 && trans > 0.02) {
        float tC = clamp(diskP.y / (diskP.y - diskPNext.y), 0.0, 1.0);
        vec3 hit = mix(diskP, diskPNext, tC);
        float rC = length(hit.xz);
        if (rC > uDiskInnerRs && rC < uDiskOuterRs) {
          // 温度剖面（diskTemperatureFactor01 同式）
          float uu = rC / uDiskInnerRs;
          float tf = clamp(
            pow(uu, -0.75) * pow(max(1.0 - inversesqrt(uu), 0.0), 0.25) * DISK_TEMP_NORM,
            0.0, 1.0);
          // 开普勒 β（diskKeplerianBeta 同式）+ 多普勒 δ（dopplerFactor 同式）
          float beta = min(sqrt(0.5 / max(rC - 1.0, 0.5)), DISK_BETA_MAX);
          vec3 vel = normalize(vec3(-hit.z, 0.0, hit.x));
          float cosT = dot(vel, -(uDiskRot * dir));
          float delta = sqrt(1.0 - beta * beta) / max(1.0 - beta * cosT, 1e-3);
          float dEff = pow(max(delta, 1e-3), uBeamStrength);
          // 引力红移（gravitationalRedshiftFactor 同式）
          float g = max(sqrt(max(1.0 - 1.0 / rC, 0.0)), GRAV_FLOOR);
          // 观测色温 → 黑体 LUT（diskObservedTemperatureK 同式）
          float tObs = DISK_PEAK_K * tf * dEff * g;
          // R4-13：两黑洞峰值温标缩放（Sgr A* 0.64 橙红 / Cyg X-1 1.36 蓝白）
          tObs *= uDiskTempScale;
          vec3 col = texture(uBlackbodyLUT,
            vec2(clamp((tObs - LUT_T_MIN) / (LUT_T_MAX - LUT_T_MIN), 0.0, 1.0), 0.5)).rgb;
          // 差速旋转流动条纹（ω ∝ r^-3/2；cos/sin 嵌入消 φ 接缝，可视化登记；
          // 径向频率高/角向低 → 细密环状纹理，Interstellar 观感）
          float phiP = atan(hit.z, hit.x) - STRIPE_OMEGA * pow(rC, -1.5) * uTime;
          vec2 q = vec2(rC * 5.0, 0.0) + 1.8 * vec2(cos(phiP), sin(phiP));
          float n = 0.6 * bhNoise(q) + 0.4 * bhNoise(q * vec2(2.3, 1.7) + 17.1);
          float stripe = 0.66 + 0.68 * n;
          // 亮度 = 基准 × 剖面²（T⁴ 压缩档登记）× δ_eff³ × g³ × 条纹
          float lum = uDiskBrightness * tf * tf * dEff * dEff * dEff * g * g * g * stripe;
          // 内外缘软化 + 条纹微透明
          float edge = smoothstep(uDiskInnerRs, uDiskInnerRs * 1.06, rC)
            * (1.0 - smoothstep(uDiskOuterRs * 0.86, uDiskOuterRs, rC));
          float a = edge * clamp(0.8 + 0.35 * (n - 0.5), 0.0, 1.0);
          diskAccum += trans * col * lum * a;
          trans *= 1.0 - a * 0.92;
        }
      }
      p = pNext;
      diskP = diskPNext;
      // 出包围球且正在远离：提前终止出射
      if (dot(p, p) > R_DOMAIN * R_DOMAIN && dot(p, dir) > 0.0) break;
    }

    // 背景：弯曲后方向采样星场 cubemap（物体→世界旋转；撞击/阴影为黑）
    vec3 worldDir = normalize(vModelRot * dir);
    vec3 bg = (captured || shadowed) ? vec3(0.0) : texture(uStarfield, worldDir).rgb * uStarIntensity;
    vec3 rgb = diskAccum + trans * bg + uRingColor * (glow * uRingStrength);
    // 输出亮度硬钳（防 Bloom 溢出，无 NaN/Inf）
    rgb = clamp(rgb, vec3(0.0), vec3(${LENSING_MAX_OUTPUT_LUMINANCE.toFixed(1)}));
    // alpha = uFade（R4-13 交叉淡出；默认 1，opaque 材质下被忽略 = 原行为）
    gl_FragColor = vec4(rgb, uFade);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/**
 * 生成程序化星场 cubemap（128px/面，`buildStarfieldFaceData` 确定性数据
 * → canvas → CubeTexture；无贴图资产）。调用方持有并负责 dispose。
 */
export function buildStarfieldCubeTexture(seed?: number): THREE.CubeTexture {
  const faces: HTMLCanvasElement[] = [];
  for (let f = 0; f < 6; f += 1) {
    const data = buildStarfieldFaceData(f, STARFIELD_FACE_SIZE, seed);
    const canvas = document.createElement('canvas');
    canvas.width = STARFIELD_FACE_SIZE;
    canvas.height = STARFIELD_FACE_SIZE;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.putImageData(
        new ImageData(new Uint8ClampedArray(data), STARFIELD_FACE_SIZE, STARFIELD_FACE_SIZE),
        0,
        0,
      );
    }
    faces.push(canvas);
  }
  const texture = new THREE.CubeTexture(faces);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/**
 * 黑体色 LUT 纹理（R4-12：`buildBlackbodyLutData` 预采样 blackbodyRGB →
 * 宽 × 1 RGBA DataTexture，sRGB 存储 GPU 解码为线性）。调用方持有并 dispose。
 */
export function buildBlackbodyLutTexture(width: number = DISK_LUT_WIDTH): THREE.DataTexture {
  const texture = new THREE.DataTexture(buildBlackbodyLutData(width), width, 1, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

/** 透镜材质构造参数 */
export interface BlackHoleLensedMaterialParams {
  /** 星场 cubemap（缺省时工厂自建并托管生命周期） */
  starfield?: THREE.CubeTexture;
  /** 步进数（默认 64，钳制 16–128） */
  steps?: number;
  /** 光子环发光强度（默认 3） */
  ringStrength?: number;
  /** 光子环发光色（默认暖橙白） */
  ringColor?: THREE.ColorRepresentation;
  /** 背景星场亮度倍率（默认 1） */
  starIntensity?: number;
  /** 盘内缘半径（r_s，默认 3 = ISCO；经 clampDiskRadii 钳制） */
  diskInnerRs?: number;
  /** 盘外缘半径（r_s，默认 12；经 clampDiskRadii 钳制） */
  diskOuterRs?: number;
  /** 束流强度（δ 指数缩放，默认 1 = 物理档 δ³，0 关闭束流） */
  beamStrength?: number;
  /** 盘发光基准亮度（默认 DISK_DEFAULT_BRIGHTNESS；0 隐藏盘） */
  diskBrightness?: number;
  /** 盘峰值色温缩放（默认 1 = 7200 K 压标档；R4-13 两黑洞橙红/蓝白区分） */
  diskTempScale?: number;
}

/**
 * 创建黑洞透镜 raymarch 材质（消费方持有并负责 dispose，附录 A §6；
 * 经 `disposeBlackHoleLensedMaterial` 释放可一并回收工厂自建 cubemap）
 *
 * 挂载约定：配合 SphereGeometry(LENSING_DOMAIN_RADIUS_RS) 使用（物体空间
 * = r_s 单位），世界尺寸经 mesh.scale = rsWorld（每 r_s 的世界长度）控制，
 * 且须为等比缩放、不旋转（cubemap 采样方向经 modelMatrix 旋转部分变换）。
 */
export function createBlackHoleLensedMaterial(
  params: BlackHoleLensedMaterialParams = {},
): THREE.ShaderMaterial {
  const ownsStarfield = params.starfield === undefined;
  const starfield = params.starfield ?? buildStarfieldCubeTexture();
  const blackbodyLut = buildBlackbodyLutTexture();
  const radii = clampDiskRadii(
    params.diskInnerRs ?? DISK_INNER_RADIUS_RS_DEFAULT,
    params.diskOuterRs ?? DISK_OUTER_RADIUS_RS_DEFAULT,
  );
  const material = new THREE.ShaderMaterial({
    name: 'BlackHoleLensedMaterial',
    vertexShader: VERTEX_SHADER,
    fragmentShader: LENSING_FRAGMENT_SHADER,
    uniforms: {
      uStarfield: { value: starfield },
      uBlackbodyLUT: { value: blackbodyLut },
      uSteps: { value: clampLensingSteps(params.steps ?? LENSING_STEPS_DEFAULT) },
      uRingStrength: { value: params.ringStrength ?? 3 },
      uRingColor: { value: new THREE.Color(params.ringColor ?? PHOTON_RING_DEFAULT_COLOR) },
      uStarIntensity: { value: params.starIntensity ?? 1 },
      uTime: { value: 0 },
      uDiskInnerRs: { value: radii.innerRs },
      uDiskOuterRs: { value: radii.outerRs },
      uBeamStrength: { value: params.beamStrength ?? 1 },
      uDiskBrightness: { value: params.diskBrightness ?? DISK_DEFAULT_BRIGHTNESS },
      uDiskTempScale: { value: params.diskTempScale ?? 1 },
      // 输出淡入权重（R4-13 交叉淡出；opaque 默认态下 alpha 被忽略）
      uFade: { value: 1 },
      // 盘姿态（物体空间 → 盘空间；恒等 = 盘在物体 xz 平面）
      uDiskRot: { value: new THREE.Matrix3() },
    },
    side: THREE.BackSide,
    transparent: false,
    depthWrite: true,
    depthTest: true,
  });
  if (ownsStarfield) {
    material.userData.ownedStarfield = starfield;
  }
  // LUT 恒由工厂自建，登记到 userData 随 dispose 一并释放（附录 A §6）
  material.userData.ownedBlackbodyLut = blackbodyLut;
  return material;
}

/**
 * 释放透镜材质及工厂自建的星场 cubemap（消费方卸载时调用，附录 A §6）；
 * 显式传入的 starfield（调用方持有）不在此释放。
 */
export function disposeBlackHoleLensedMaterial(material: THREE.ShaderMaterial): void {
  const owned = material.userData.ownedStarfield as THREE.CubeTexture | undefined;
  if (owned) {
    owned.dispose();
    delete material.userData.ownedStarfield;
  }
  const ownedLut = material.userData.ownedBlackbodyLut as THREE.DataTexture | undefined;
  if (ownedLut) {
    ownedLut.dispose();
    delete material.userData.ownedBlackbodyLut;
  }
  material.dispose();
}

/** 组件 props */
export interface BlackHoleLensedProps {
  /** 每 r_s 的世界长度（包围球世界半径 = rsWorld × 14） */
  rsWorld: number;
  /** 星场 cubemap（调用方持有生命周期；与 scene.background 共用同一实例） */
  starfield: THREE.CubeTexture;
  /** 初始步进数（默认 64；运行时经 materialRef 写 uSteps） */
  steps?: number;
  /** 材质引用出口（消费方逐帧写 uniform，如预览页滑杆） */
  materialRef?: RefObject<THREE.ShaderMaterial | null>;
}

/**
 * 黑洞引力透镜包围球组件：材质挂载即建、卸载即 dispose（cubemap 归
 * 调用方）。mesh 不旋转、等比缩放（材质挂载约定）。
 */
export function BlackHoleLensed({
  rsWorld,
  starfield,
  steps,
  materialRef,
}: BlackHoleLensedProps): JSX.Element {
  const material = useMemo(
    () => createBlackHoleLensedMaterial({ starfield, steps }),
    // steps 仅取初值（运行时经 materialRef 写 uSteps，避免材质重建）
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [starfield],
  );
  useEffect(() => {
    if (materialRef) materialRef.current = material;
    return () => {
      if (materialRef) materialRef.current = null;
      disposeBlackHoleLensedMaterial(material);
    };
  }, [material, materialRef]);
  return (
    <mesh scale={rsWorld} material={material}>
      <sphereGeometry args={[LENSING_DOMAIN_RADIUS_RS, 48, 24]} />
    </mesh>
  );
}

export default BlackHoleLensed;
