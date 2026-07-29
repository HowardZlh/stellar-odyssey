/**
 * 星云双通道体积 raymarch ShaderMaterial 工厂
 * （R4-7，IMPROVEMENT_REQUIREMENTS_4 §R4-7 / §0.3 方案 B）
 *
 * 在 R4-3 `VolumeMaterial.ts`（R8 单通道 + 密度阈值双色）基础上的星云
 * 专用变体：采样 RG 双通道 3D 纹理（`utils/nebulaVolume.createRgDensityTexture`
 * 产出，R = 发射密度 / G = 吸收密度——前景尘埃只消光不发射），发射-吸收
 * 积分离散格式与 `nebulaVolume.integrateEmissionAbsorptionDual` CPU 参考
 * 实现同式（单测据此校验一致性）：
 *   E    += T · e · Δt
 *   T'    = T · exp(−(e·σe + a·σd) · Δt)
 *
 * Hα/OIII 双色映射（§R4-7）：混色权重随"到 uCore 的（椭球归一化）距离"
 * 变化（`m42ColorWeight01` 的 GLSL 镜像：smoothstep(uWeightInnerR,
 * uWeightOuterR, r) + uWeightBias 滑杆偏置）——内区 OIII 偏青、外区 Hα
 * 偏红；权重不烘焙进纹理（纯径向近似登记于 nebulaVolume.ts 文件头）。
 * R4-14 泛化登记：uCore/内外径/uWeightInvRadii（椭球归一化半径的逐轴
 * 倒数，M42 默认 (1,1,1) = 欧氏距离，行为零回退）可经参数覆写——M57
 * 以 (1/a,1/b,1/c) 使权重沿三轴椭球壳法向分层（`m57ColorWeight01` 镜像）。
 *
 * 管线兼容（附录 A §5，全部沿用 VolumeMaterial 先例）：log depth buffer
 * include 三件、盒内/盒外入射连续（slab t0 钳 0 + BackSide）、透明排序
 * （depthWrite=false + 预乘 alpha）、蓝噪声步进抖动（R4-4）、输出硬钳上限
 * 防 Bloom 溢出、方向零分量下限防除零；不设 glslVersion: GLSL3
 * （登记同 VolumeMaterial：three r169 默认路径即 GLSL ES 3.0）。
 * 释放走 `disposeVolumeMaterial`（工厂自建蓝噪声掩码经 userData 托管）。
 */

import * as THREE from 'three';
import {
  BLUE_NOISE_SIZE,
  buildBlueNoiseTexture,
  clampVolumeSteps,
  VOLUME_STEPS_DEFAULT,
  VOLUME_STEPS_MAX,
  VOLUME_STEPS_MIN,
} from '@/utils/volume';
import {
  M42_COLOR_WEIGHT_INNER_R,
  M42_COLOR_WEIGHT_OUTER_R,
  M42_TRAPEZIUM_CENTER,
} from '@/utils/nebulaVolume';
import { VOLUME_MAX_OUTPUT_LUMINANCE } from '@/components/Scene/volumetric/VolumeMaterial';

const VERTEX_SHADER = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  varying vec3 vOrigin;
  varying vec3 vDirection;
  void main() {
    vOrigin = vec3(inverse(modelMatrix) * vec4(cameraPosition, 1.0));
    vDirection = position - vOrigin;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    #include <logdepthbuf_vertex>
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  precision highp float;
  precision highp sampler3D;
  #include <common>
  #include <logdepthbuf_pars_fragment>
  varying vec3 vOrigin;
  varying vec3 vDirection;
  uniform sampler3D uMap;      // RG：R=发射密度 G=吸收密度（前景尘埃）
  uniform float uSteps;
  uniform float uDensityScale; // 发射密度倍率（滑杆）
  uniform float uDustStrength; // 吸收密度倍率（滑杆）
  uniform float uSigmaEmission; // 发射介质自吸收系数 σe
  uniform float uSigmaDust;     // 尘埃消光系数 σd
  uniform vec3 uColorOIII;     // 内区 OIII 青绿
  uniform vec3 uColorHa;       // 外区 Hα 红
  uniform float uWeightBias;   // 双色权重偏置（滑杆，-1..1）
  uniform vec3 uCore;          // 权重中心（归一化域 [-1,1]³；M42=Trapezium）
  uniform vec3 uWeightInvRadii; // 椭球归一化逐轴倒数（M42=(1,1,1) 欧氏）
  uniform float uWeightInnerR;
  uniform float uWeightOuterR;
  uniform float uIntensity;
  uniform sampler2D uBlueNoise;
  uniform float uJitter;
  uniform float uTime;    // 预留：密度场流动（R4-8 按需接入）
  uniform float uQuality; // 档位标量（adaptiveQuality 写入；shader 暂不消费）

  // 单位盒 [-0.5, 0.5]³ slab 求交（utils/volume.intersectRayBox 的 GLSL 镜像）
  vec2 hitBox(vec3 orig, vec3 dir) {
    const vec3 boxMin = vec3(-0.5);
    const vec3 boxMax = vec3(0.5);
    vec3 invDir = 1.0 / dir;
    vec3 tA = (boxMin - orig) * invDir;
    vec3 tB = (boxMax - orig) * invDir;
    vec3 tMin = min(tA, tB);
    vec3 tMax = max(tA, tB);
    float t0 = max(tMin.x, max(tMin.y, tMin.z));
    float t1 = min(tMax.x, min(tMax.y, tMax.z));
    return vec2(t0, t1);
  }

  void main() {
    #include <logdepthbuf_fragment>
    vec3 rd = normalize(vDirection);
    vec3 s = step(vec3(0.0), rd) * 2.0 - 1.0;
    rd = s * max(abs(rd), vec3(1e-5));

    vec2 bounds = hitBox(vOrigin, rd);
    if (bounds.x > bounds.y || bounds.y < 0.0) discard;
    bounds.x = max(bounds.x, 0.0);

    float steps = clamp(uSteps, ${VOLUME_STEPS_MIN.toFixed(1)}, ${VOLUME_STEPS_MAX.toFixed(1)});
    float stepLen = (bounds.y - bounds.x) / steps;
    float jitter = texelFetch(uBlueNoise, ivec2(mod(gl_FragCoord.xy, ${BLUE_NOISE_SIZE.toFixed(1)})), 0).r;
    vec3 p = vOrigin + (bounds.x + stepLen * jitter * uJitter) * rd;
    vec3 delta = rd * stepLen;

    // 双通道发射-吸收积分（front-to-back，与 CPU 参考实现
    // integrateEmissionAbsorptionDual 同式）
    float transmittance = 1.0;
    vec3 accum = vec3(0.0);
    for (int i = 0; i < ${VOLUME_STEPS_MAX}; i++) {
      if (float(i) >= steps) break;
      vec2 rg = texture(uMap, p + 0.5).rg;
      float e = rg.r * uDensityScale;
      float a = rg.g * uDustStrength;
      if (e > 0.0005 || a > 0.0005) {
        if (e > 0.0005) {
          // 双色映射：m42/m57ColorWeight01 的 GLSL 镜像（盒局部 ×2 =
          // 归一化域；uWeightInvRadii=(1,1,1) 时退化为欧氏距离）
          float r = length((p * 2.0 - uCore) * uWeightInvRadii);
          float w = clamp(smoothstep(uWeightInnerR, uWeightOuterR, r) + uWeightBias, 0.0, 1.0);
          vec3 col = mix(uColorOIII, uColorHa, w);
          accum += transmittance * col * (e * stepLen);
        }
        transmittance *= exp(-(e * uSigmaEmission + a * uSigmaDust) * stepLen);
        if (transmittance < 0.004) break;
      }
      p += delta;
    }

    float alpha = clamp(1.0 - transmittance, 0.0, 1.0);
    if (alpha < 0.001) discard;
    vec3 rgb = clamp(accum * uIntensity, vec3(0.0), vec3(${VOLUME_MAX_OUTPUT_LUMINANCE.toFixed(1)}));
    gl_FragColor = vec4(rgb, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/** 星云体积材质构造参数 */
export interface NebulaVolumeMaterialParams {
  /** RG 双通道 3D 密度纹理（`createRgDensityTexture` 产出） */
  map: THREE.Data3DTexture;
  /** 步进数（默认 64，钳制 16–128） */
  steps?: number;
  /** 外区 Hα 颜色（默认自然色近似红） */
  colorHa?: THREE.ColorRepresentation;
  /** 内区 OIII 颜色（默认青绿） */
  colorOIII?: THREE.ColorRepresentation;
  /** 发射密度倍率（默认 3.2——补偿密度场 ×0.32 总量标定） */
  densityScale?: number;
  /** 吸收密度倍率（默认 1） */
  dustStrength?: number;
  /** 发射介质自吸收系数 σe（默认 3） */
  sigmaEmission?: number;
  /** 尘埃消光系数 σd（默认 9——暗湾可辨且不投出过长阴影隧道，目验调参） */
  sigmaDust?: number;
  /** 双色权重偏置（默认 0） */
  weightBias?: number;
  /** 输出亮度（默认 1.3） */
  intensity?: number;
  /** 双色权重中心（归一化域 [-1,1]³；默认 M42 Trapezium 中心） */
  core?: readonly [number, number, number];
  /** 双色权重内径（默认 M42 常量） */
  weightInnerR?: number;
  /** 双色权重外径（默认 M42 常量） */
  weightOuterR?: number;
  /** 椭球归一化逐轴倒数（默认 (1,1,1) 欧氏距离；M57 = (1/a,1/b,1/c)） */
  weightInvRadii?: readonly [number, number, number];
  /** 蓝噪声掩码（缺省工厂自建并托管；显式传入归调用方持有） */
  blueNoise?: THREE.DataTexture;
}

/**
 * 创建星云双通道体积材质（M42 默认参数；释放走 `disposeVolumeMaterial`）
 *
 * 挂载约定同 VolumeMaterial：BoxGeometry(1,1,1) + mesh.scale 控世界尺寸，
 * renderOrder 设 `VOLUME_RENDER_ORDER`。
 */
export function createNebulaVolumeMaterial(
  params: NebulaVolumeMaterialParams,
): THREE.ShaderMaterial {
  const ownsBlueNoise = params.blueNoise === undefined;
  const blueNoise = params.blueNoise ?? buildBlueNoiseTexture();
  const [cx, cy, cz] = params.core ?? M42_TRAPEZIUM_CENTER;
  const [wx, wy, wz] = params.weightInvRadii ?? [1, 1, 1];
  const material = new THREE.ShaderMaterial({
    name: 'NebulaVolumeMaterial',
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    uniforms: {
      uMap: { value: params.map },
      uSteps: { value: clampVolumeSteps(params.steps ?? VOLUME_STEPS_DEFAULT) },
      uDensityScale: { value: params.densityScale ?? 3.2 },
      uDustStrength: { value: params.dustStrength ?? 1 },
      uSigmaEmission: { value: params.sigmaEmission ?? 3 },
      uSigmaDust: { value: params.sigmaDust ?? 9 },
      uColorHa: { value: new THREE.Color(params.colorHa ?? '#ff5040') },
      uColorOIII: { value: new THREE.Color(params.colorOIII ?? '#2fd8c4') },
      uWeightBias: { value: params.weightBias ?? 0 },
      uCore: { value: new THREE.Vector3(cx, cy, cz) },
      uWeightInvRadii: { value: new THREE.Vector3(wx, wy, wz) },
      uWeightInnerR: { value: params.weightInnerR ?? M42_COLOR_WEIGHT_INNER_R },
      uWeightOuterR: { value: params.weightOuterR ?? M42_COLOR_WEIGHT_OUTER_R },
      uIntensity: { value: params.intensity ?? 1.3 },
      uBlueNoise: { value: blueNoise },
      uJitter: { value: 1 },
      uTime: { value: 0 },
      uQuality: { value: 1 },
    },
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.BackSide,
    premultipliedAlpha: true,
  });
  if (ownsBlueNoise) {
    material.userData.ownedBlueNoise = blueNoise;
  }
  return material;
}
