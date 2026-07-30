/**
 * 体积 raymarch ShaderMaterial 工厂（R4-3，IMPROVEMENT_REQUIREMENTS_4 §R4-3 / §0.3 方案 B）
 *
 * 渲染模型：单位盒（BoxGeometry 1×1×1，世界尺寸经 mesh.scale 控制）内固定
 * 步数步进采样 3D 密度纹理（R8，`utils/volume.buildDensityTexture` 产出），
 * 发射-吸收积分（离散格式与 `utils/volume.integrateEmissionAbsorption` CPU
 * 参考实现同式，单测据此校验一致性），密度→双色映射（uColorA/uColorB +
 * 密度阈值平滑混色，Hα/OIII 窄带映射的载体）。
 *
 * 管线兼容（附录 A §5）：
 * - log depth buffer：含 logdepthbuf include（`Starfield.tsx` :33 先例）；
 * - 相机盒内/盒外两种入射：slab 求交后 t0 钳到 0（盒内从相机处起步），
 *   side=BackSide 保证相机穿入盒内时仍有面片可栅格化、画面连续；
 * - 透明排序：depthWrite=false，renderOrder 由挂载方设置
 *   （`VOLUME_RENDER_ORDER` 常量），depthTest 保留（被前景实体遮挡正确）；
 * - Bloom 共存：输出亮度经 uIntensity 控制并硬钳上限（防发光溢出），
 *   方向零分量加下限防除零——无 NaN/Inf 输出；
 * - 蓝噪声抖动（R4-4）：步进起点按 64×64 蓝噪声掩码逐像素偏移 [0,1) 个
 *   步长（texelFetch + gl_FragCoord mod 平铺），打散步进条带；uJitter=0
 *   可关（预览页 A/B 对比）。工厂未显式传入掩码时自建实例并随
 *   `disposeVolumeMaterial` 一并释放（附录 A §6）；
 * - 预留 uniforms：uTime（R4-7 流动）、uQuality（档位标量 0.5–1，由
 *   adaptiveQuality 每帧写入，本阶段步数/RT 比例在 CPU 侧落地，shader
 *   暂不消费该标量——R4-7 细节淡出可按需接入）；
 * - 各向异性光程（R5-2）：uWorldStepScale（默认 (1,1,1) 零行为变化）
 *   ——非均匀缩放盒（如星系薄盘）在单位盒局部空间步进时，局部步长不
 *   反映世界光程；积分步长乘 |rd ⊙ uWorldStepScale| 校正，使斜视/侧视
 *   （长光程）消光强于正视（短光程）。消费方按 utils/galaxyDustVolume
 *   dustWorldStepScale（最长轴归一化）写入。
 *
 * GLSL 版本登记：sampler3D/inverse() 需要 GLSL ES 3.0——three r169 WebGL2-only，
 * ShaderMaterial 默认路径即以 `#version 300 es` + 兼容 define（varying/gl_FragColor/
 * texture2D→texture）编译，故**不设** `glslVersion: GLSL3`（显式 GLSL3 会关闭
 * gl_FragColor 兼容 define，致 tonemapping/colorspace include 编译失败，实测登记）。
 * 相机局部坐标经 inverse(modelMatrix) 在顶点级求得（盒仅 8 顶点，开销可忽略），
 * 无需 CPU 侧每帧上传逆矩阵 uniform。
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

/**
 * 体积层 renderOrder（挂载方对 mesh 设置）：晚于常规透明对象绘制，
 * 保证发射-吸收合成覆盖在既有半透明层之上。
 */
export const VOLUME_RENDER_ORDER = 10;

/** 输出亮度硬钳上限（防 Bloom 溢出，验收 §R4-3.2） */
export const VOLUME_MAX_OUTPUT_LUMINANCE = 12.0;

const VERTEX_SHADER = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  varying vec3 vOrigin;
  varying vec3 vDirection;
  void main() {
    // 相机位置变换到盒局部空间（盒仅 8 顶点，inverse 开销可忽略）
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
  uniform sampler3D uMap;
  uniform float uSteps;
  uniform float uDensityScale;
  uniform float uAbsorption;
  uniform float uThreshold;
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  uniform float uIntensity;
  uniform sampler2D uBlueNoise; // 蓝噪声抖动掩码（64×64 Repeat 平铺，R4-4）
  uniform float uJitter;        // 抖动强度（0 关 / 1 开，预览页 A/B 对比）
  uniform float uTime;    // 预留：R4-7 密度场流动
  uniform float uQuality; // 档位标量（0.5–1，adaptiveQuality 写入；shader 暂不消费）
  uniform vec3 uWorldStepScale; // 各向异性光程缩放（R5-2；默认 (1,1,1) 零行为变化）

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
    // 方向零分量加下限（保号），防 slab 除零产生 NaN（CPU 镜像同式）
    vec3 rd = normalize(vDirection);
    vec3 s = step(vec3(0.0), rd) * 2.0 - 1.0;
    rd = s * max(abs(rd), vec3(1e-5));

    vec2 bounds = hitBox(vOrigin, rd);
    if (bounds.x > bounds.y || bounds.y < 0.0) discard;
    // 相机在盒内：从相机处起步（画面连续，验收 §R4-3.2）
    bounds.x = max(bounds.x, 0.0);

    float steps = clamp(uSteps, ${VOLUME_STEPS_MIN.toFixed(1)}, ${VOLUME_STEPS_MAX.toFixed(1)});
    float stepLen = (bounds.y - bounds.x) / steps;
    // 各向异性光程（R5-2）：局部步长 → 相对世界光程（默认 |rd|≈1 零变化）
    float pathLen = stepLen * length(rd * uWorldStepScale);
    // 蓝噪声抖动：步进起点逐像素偏移 [0,1) 个步长，打散条带（R4-4）。
    // 掩码 Repeat 平铺（环绕核生成无缝），gl_FragCoord 随 RT 视口缩放，
    // 半分辨率下仍按 RT 像素取值——抖动粒度与渲染分辨率一致。
    float jitter = texelFetch(uBlueNoise, ivec2(mod(gl_FragCoord.xy, ${BLUE_NOISE_SIZE.toFixed(1)})), 0).r;
    vec3 p = vOrigin + (bounds.x + stepLen * jitter * uJitter) * rd;
    vec3 delta = rd * stepLen;

    // 发射-吸收积分（front-to-back，与 CPU 参考实现 integrateEmissionAbsorption 同式）
    float transmittance = 1.0;
    vec3 accum = vec3(0.0);
    for (int i = 0; i < ${VOLUME_STEPS_MAX}; i++) {
      if (float(i) >= steps) break;
      float raw = texture(uMap, p + 0.5).r;
      float d = raw * uDensityScale;
      if (d > 0.0005) {
        // 双色映射：原始密度绕阈值平滑混色（低密度 A → 高密度 B）
        vec3 col = mix(uColorA, uColorB, smoothstep(uThreshold - 0.12, uThreshold + 0.12, raw));
        accum += transmittance * col * (d * pathLen);
        transmittance *= exp(-d * uAbsorption * pathLen);
        if (transmittance < 0.004) break; // 提前终止（不透明饱和）
      }
      p += delta;
    }

    float alpha = clamp(1.0 - transmittance, 0.0, 1.0);
    if (alpha < 0.001) discard;
    // uIntensity 控亮 + 硬钳上限：防 Bloom 溢出，无 NaN/Inf
    vec3 rgb = clamp(accum * uIntensity, vec3(0.0), vec3(${VOLUME_MAX_OUTPUT_LUMINANCE.toFixed(1)}));
    gl_FragColor = vec4(rgb, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/** 体积材质构造参数 */
export interface VolumeMaterialParams {
  /** 3D 密度纹理（`buildDensityTexture` 产出，R8） */
  map: THREE.Data3DTexture;
  /** 步进数（默认 64，钳制 16–128） */
  steps?: number;
  /** 低密度端颜色（默认 Hα 红） */
  colorA?: THREE.ColorRepresentation;
  /** 高密度端颜色（默认 OIII 青绿） */
  colorB?: THREE.ColorRepresentation;
  /** 密度倍率（默认 2.2） */
  densityScale?: number;
  /** 吸收系数 σ（默认 5） */
  absorption?: number;
  /** 双色混合密度阈值（默认 0.45） */
  threshold?: number;
  /** 输出亮度（默认 1.2，控 Bloom 贡献） */
  intensity?: number;
  /**
   * 蓝噪声抖动掩码（64×64 R8，`buildBlueNoiseTexture` 产出）。
   * 缺省时工厂自建实例并托管生命周期（`disposeVolumeMaterial` 释放）；
   * 显式传入时归调用方持有并负责 dispose。
   */
  blueNoise?: THREE.DataTexture;
  /**
   * 各向异性光程缩放（R5-2 非均匀盒；默认 (1,1,1) 零行为变化）。
   * 按 utils/galaxyDustVolume.dustWorldStepScale 最长轴归一化传入。
   */
  worldStepScale?: readonly [number, number, number];
}

/**
 * 创建体积 raymarch 材质（消费方持有并负责 dispose，附录 A §6；
 * 经 `disposeVolumeMaterial` 释放可一并回收工厂自建的蓝噪声掩码）
 *
 * 挂载约定：配合 BoxGeometry(1,1,1) 使用，世界尺寸经 mesh.scale 控制；
 * mesh.renderOrder 设为 `VOLUME_RENDER_ORDER`。
 */
export function createVolumeMaterial(params: VolumeMaterialParams): THREE.ShaderMaterial {
  const ownsBlueNoise = params.blueNoise === undefined;
  const blueNoise = params.blueNoise ?? buildBlueNoiseTexture();
  const material = new THREE.ShaderMaterial({
    name: 'VolumeMaterial',
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    uniforms: {
      uMap: { value: params.map },
      uSteps: { value: clampVolumeSteps(params.steps ?? VOLUME_STEPS_DEFAULT) },
      uDensityScale: { value: params.densityScale ?? 2.2 },
      uAbsorption: { value: params.absorption ?? 5 },
      uThreshold: { value: params.threshold ?? 0.45 },
      uColorA: { value: new THREE.Color(params.colorA ?? '#ff3b30') },
      uColorB: { value: new THREE.Color(params.colorB ?? '#2ee6c8') },
      uIntensity: { value: params.intensity ?? 1.2 },
      uBlueNoise: { value: blueNoise },
      uJitter: { value: 1 },
      uTime: { value: 0 },
      uQuality: { value: 1 },
      uWorldStepScale: {
        value: new THREE.Vector3(...(params.worldStepScale ?? [1, 1, 1])),
      },
    },
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.BackSide,
    // 发射-吸收输出为预乘形式（emission 独立于 alpha）：
    // 合成 C_out = C_vol + T·C_bg ⇔ NormalBlending + premultipliedAlpha
    premultipliedAlpha: true,
  });
  // 工厂自建掩码登记到 userData，disposeVolumeMaterial 一并释放（附录 A §6）
  if (ownsBlueNoise) {
    material.userData.ownedBlueNoise = blueNoise;
  }
  return material;
}

/**
 * 释放体积材质及工厂自建的蓝噪声掩码（消费方卸载时调用，附录 A §6）
 *
 * 显式传入的 blueNoise（调用方持有）不在此释放；密度纹理（uMap）
 * 生命周期归构建方（`buildDensityTexture` 调用侧），亦不在此释放。
 */
export function disposeVolumeMaterial(material: THREE.ShaderMaterial): void {
  const owned = material.userData.ownedBlueNoise as THREE.DataTexture | undefined;
  if (owned) {
    owned.dispose();
    delete material.userData.ownedBlueNoise;
  }
  material.dispose();
}
