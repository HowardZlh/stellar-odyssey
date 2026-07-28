/**
 * 体积半分辨率渲染管线（R4-4，IMPROVEMENT_REQUIREMENTS_4 §R4-4）
 *
 * 方案登记（二选一）：采用「独立 RT + 合成 pass」真半分辨率路径（而非
 * "步数×抖动"等效近似）——体积 mesh 渲染到独立 WebGLRenderTarget，主场景
 * 内以全屏三角形合成，故无需实测登记两方案观感差异。集成方式：
 * - RT 常驻满分辨率尺寸，渲染经 **动态视口/剪裁子区域**（rt.viewport/
 *   scissor）落到 scale² 比例像素——RT 比例可连续取值（0.5–1 平滑插值，
 *   §R4-4 档位过渡 ≤0.5s），切档零重分配（不 setSize，无 GPU 分配churn）；
 * - 合成材质采样 uv×uUvScale（子区域归一化），上/右边缘钳到子区域内半
 *   像素（防双线性拉入区域外历史残留texel）；
 * - HalfFloat 线性 HDR（RT 不做 tone mapping/色彩空间转换），合成输出
 *   预乘 alpha（与 VolumeMaterial 输出约定一致：C_out = C_vol + T·C_bg），
 *   落入 EffectComposer 输入缓冲 → Bloom/ToneMapping 管线与直绘等效；
 * - 与 @react-three/postprocessing 零耦合：RT pass 在 useFrame（优先级
 *   介于 uniform 覆写与 Composer 渲染之间）手动 renderer.render 体积
 *   子场景；合成三角形是普通场景对象（renderOrder = VOLUME_RENDER_ORDER）。
 *
 * 差异登记：合成三角形 depthTest=false——体积层不再被主场景实体逐像素
 * 遮挡（预览页仅参考网格受影响，可关闭；主场景深度合成留待 R4-8 接入时
 * 处理）。RT 无 MSAA（体积为软性云雾，无几何边缘，实测无锯齿观感差异）。
 *
 * 资源生命周期（附录 A §6）：RT / 合成材质 / 三角形几何均由消费方
 * （VolumeTestPreview 等）持有并在卸载时 dispose。
 */

import * as THREE from 'three';

/** 合成用全屏三角形（NDC 直出，覆盖全屏且无对角接缝） */
export function createFullscreenTriangleGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3),
  );
  return geometry;
}

/**
 * 创建体积层渲染目标（满分辨率常驻，HalfFloat 线性 HDR，无深度附件）
 *
 * 渲染子区域经 `updateVolumeRtViewport` 按当前 RT 比例设定。
 */
export function createVolumeRenderTarget(width: number, height: number): THREE.WebGLRenderTarget {
  const rt = new THREE.WebGLRenderTarget(Math.max(1, width), Math.max(1, height), {
    format: THREE.RGBAFormat,
    type: THREE.HalfFloatType,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: false,
    stencilBuffer: false,
  });
  rt.texture.colorSpace = THREE.NoColorSpace; // 线性 HDR 中转，不做输出转换
  return rt;
}

/** 动态视口更新结果（合成 uniform 所需的子区域归一化参数） */
export interface VolumeRtViewportInfo {
  /** 子区域像素宽 */
  renderWidth: number;
  /** 子区域像素高 */
  renderHeight: number;
}

/**
 * 按 RT 比例设定渲染子区域（视口 + 剪裁，动态分辨率零重分配）
 *
 * @param scale 渲染比例（钳到 [0.25, 1]，档位映射 0.5–1）
 */
export function updateVolumeRtViewport(
  rt: THREE.WebGLRenderTarget,
  scale: number,
): VolumeRtViewportInfo {
  const s = Math.min(1, Math.max(0.25, scale));
  const w = Math.max(1, Math.round(rt.width * s));
  const h = Math.max(1, Math.round(rt.height * s));
  rt.viewport.set(0, 0, w, h);
  rt.scissor.set(0, 0, w, h);
  rt.scissorTest = true;
  return { renderWidth: w, renderHeight: h };
}

const COMPOSITE_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = position.xy * 0.5 + 0.5;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const COMPOSITE_FRAGMENT = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uRT;
  uniform vec2 uUvScale;    // 子区域 / RT 满尺寸
  uniform vec2 uUvClampMax; // 子区域内边缘半像素钳制（防采到区域外残留）
  void main() {
    vec2 uv = min(vUv * uUvScale, uUvClampMax);
    gl_FragColor = texture2D(uRT, uv);
  }
`;

/**
 * 创建体积合成材质（全屏三角形用；输出预乘 alpha，NormalBlending）
 *
 * uniforms（消费方每帧写入）：uUvScale/uUvClampMax 由
 * `writeCompositeUniforms` 按当前子区域设定。
 */
export function createVolumeCompositeMaterial(rt: THREE.WebGLRenderTarget): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'VolumeCompositeMaterial',
    vertexShader: COMPOSITE_VERTEX,
    fragmentShader: COMPOSITE_FRAGMENT,
    uniforms: {
      uRT: { value: rt.texture },
      uUvScale: { value: new THREE.Vector2(1, 1) },
      uUvClampMax: { value: new THREE.Vector2(1, 1) },
    },
    transparent: true,
    depthWrite: false,
    depthTest: false,
    premultipliedAlpha: true, // 与 VolumeMaterial 预乘输出链路一致
  });
}

/**
 * 写入合成材质的子区域采样 uniform（每帧调用，就地写零分配）
 */
export function writeCompositeUniforms(
  material: THREE.ShaderMaterial,
  rt: THREE.WebGLRenderTarget,
  info: VolumeRtViewportInfo,
): void {
  const scale = material.uniforms.uUvScale.value as THREE.Vector2;
  const clampMax = material.uniforms.uUvClampMax.value as THREE.Vector2;
  scale.set(info.renderWidth / rt.width, info.renderHeight / rt.height);
  clampMax.set((info.renderWidth - 0.5) / rt.width, (info.renderHeight - 0.5) / rt.height);
}
