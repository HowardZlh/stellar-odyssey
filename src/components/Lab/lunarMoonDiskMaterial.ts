/**
 * 月盘 quad 血月 shader 材质工厂（LE 迭代 M5 自 LunarEclipseLab.tsx 抽出的
 * 纯重构；契约 C4「同一 GLSL 镜像换 uniform，禁止复制出多套实现」的实现层
 * 单点——shader 字符串与 uniform 集**逐字保持** M3-1/M3-6 原样）。
 *
 * 消费点：LunarEclipseLab.tsx（地面月盘 quad + 三联对比小视口）、
 * LunarSelenelionScene.tsx（M5-3 彩蛋场景被食之月——同一镜像第三消费点）。
 * 太空月球球体走 LunarEclipseSpaceView 内的球面变体（同一 GLSL_UMBRA_SHADING
 * 注入段，见 lunarBloodMoonGlsl.ts 文件头）。
 */

import * as THREE from 'three';
import {
  PENUMBRA_SHADING_MAX_DIM,
} from '@/utils/lunarEclipse';
import {
  LUNAR_ALBEDO_MEAN,
  LUNAR_LIMB_SURGE_EXPONENT,
  LUNAR_MOON_BASE_GAIN,
  LUNAR_QUAD_HALF_ANGLE_RAD,
  UMBRA_EDGE_BLEND_FRAC,
  moonLimbSurgeGain,
} from '@/utils/lunarEclipseLab';
import { GLSL_UMBRA_SHADING } from '@/components/Lab/lunarBloodMoonGlsl';

/** 度 → 弧度（单位换算，非球面公式） */
const DEG = Math.PI / 180;

/**
 * 月盘 quad 顶点着色（日食 quad 同约定）：quad 本地角坐标（弧度）——
 * +X = 方位角减小向（lookAt 原点后的本地系）、+Y = 高度角增大向；
 * uShadowOffset 与此同系（CPU 侧换算）。
 */
export const LUNAR_QUAD_VERTEX_SHADER = /* glsl */ `
  uniform float uHalfAngle;
  varying vec2 vAng;
  void main() {
    vAng = (uv - 0.5) * 2.0 * uHalfAngle;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/**
 * 月盘 fragment（契约 C4，M3-1 血月两段式；常量模板注入自 lunarEclipse/
 * lunarEclipseLab——CPU/GLSL 镜像纪律，bloodMoonIlluminationRgb 同式照抄）：
 * 1 月面反照：2K 月面贴图球面映射（近面中心 lon 0 = 贴图中心；静态姿态
 *   近似登记 B11），未就绪时中性灰（LUNAR_ALBEDO_MEAN）降级；
 * 2 血月照度：ρ = |像素角位 − 影盘中心|——本影段 umbraShading 丹戎径向
 *   色表 ÷ 平均反照（红线 ①：径向梯度，靠影心暗、靠影缘亮黄）；半影段
 *   penumbraShading（外缘无变暗、内缘 −0.55，r≥0.6 段变暗 <0.09——「半影
 *   几乎无感」红线 ② 的 GLSL 侧）× 月缘增亮（对冲效应，B5：直射分量独占，
 *   本影内由色表接管不双计）；本影缘窄带 smoothstep 混合（几何软化登记）；
 * 3 曝光：uExposure 标量乘子（契约 C4 简单曝光滑杆，无状态机；B2 登记）；
 * 4 地圆论证（M3-6）：uFitCircle 开启时在本影边界描拟合圆弧（月盘外也
 *   可见，quad 域内截段）——不同时刻/事件弧线曲率恒定的古希腊推理教具。
 */
export const LUNAR_QUAD_FRAGMENT_SHADER = /* glsl */ `
  uniform float uMoonR;
  uniform vec2 uShadowOffset;
  uniform float uUmbraR;
  uniform float uPenumbraR;
  uniform sampler2D uMoonTex;
  uniform float uHasTex;
  uniform float uGain;
  uniform float uDanjonL;
  uniform float uExposure;
  uniform float uFitCircle;
  varying vec2 vAng;

  const float PI = 3.14159265;
  const float TWO_PI = 6.28318531;

  ${GLSL_UMBRA_SHADING}

  void main() {
    float rm = length(vAng);
    // 盘缘软化：视半径 3% 固定角宽（FOV 放大时缘宽随真实角尺度）
    float aa = uMoonR * 0.03;
    float disk = 1.0 - smoothstep(uMoonR - aa, uMoonR + aa, rm);
    float rho = length(vAng - uShadowOffset);

    // 地圆论证拟合圆（M3-6）：本影边界描线（月盘外亦渲染，圆弧连续可见）
    float ring = 0.0;
    if (uFitCircle > 0.5 && uUmbraR > 0.0) {
      float lw = uMoonR * 0.05;
      ring = (1.0 - smoothstep(lw, lw * 2.0, abs(rho - uUmbraR))) * 0.85;
    }
    if (disk < 0.003 && ring < 0.01) discard;

    // 月面贴图球面映射（近面可见半球 lon ∈ [−90°, 90°]，中心 = 贴图中心）
    vec2 pn = vAng / uMoonR;
    float pz = sqrt(max(1.0 - dot(pn, pn), 0.0));
    float lon = atan(pn.x, pz);
    float lat = asin(clamp(pn.y, -1.0, 1.0));
    vec2 uv = vec2(0.5 + lon / TWO_PI, 0.5 + lat / PI);
    vec3 albedo = uHasTex > 0.5
      ? texture2D(uMoonTex, uv).rgb
      : vec3(${LUNAR_ALBEDO_MEAN.toFixed(2)});

    // 血月照度（bloodMoonIlluminationRgb GLSL 镜像；uUmbraR/uPenumbraR 由
    // 契约 C1 影锥函数逐帧驱动——缺口方位随影轴几何真实变化）
    float limb = 1.0
      + ${(moonLimbSurgeGain(1) - 1).toFixed(4)}
        * pow(clamp(rm / uMoonR, 0.0, 1.0), ${LUNAR_LIMB_SURGE_EXPONENT.toFixed(1)});
    vec3 illum = vec3(limb);
    if (uPenumbraR - uUmbraR > 1e-9) {
      float rp = clamp((rho - uUmbraR) / (uPenumbraR - uUmbraR), 0.0, 1.0);
      illum = vec3(
        (1.0 - ${PENUMBRA_SHADING_MAX_DIM.toFixed(2)} * (1.0 - rp) * (1.0 - rp)) * limb
      );
      if (uUmbraR > 0.0) {
        vec3 blood = umbraShading(rho / uUmbraR, uDanjonL)
          / ${LUNAR_ALBEDO_MEAN.toFixed(2)};
        float w = uUmbraR * ${UMBRA_EDGE_BLEND_FRAC.toFixed(3)};
        float s = smoothstep(uUmbraR - w, uUmbraR + w, rho);
        illum = mix(blood, illum, s);
      }
    }

    vec3 col = albedo * uGain * uExposure * illum;
    vec3 pm = mix(col * disk, vec3(0.35, 0.75, 1.0), ring);
    gl_FragColor = vec4(pm, max(disk, ring));
  }
`;

/**
 * 月盘 shader 材质工厂（主 quad / 三联对比小视口 / selenelion 彩蛋共用——
 * 契约 C4「同一 GLSL 镜像换 uniform」，禁止复制出多套实现）。
 */
export function createLunarMoonMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uHalfAngle: { value: LUNAR_QUAD_HALF_ANGLE_RAD },
      uMoonR: { value: 0.259 * DEG },
      uShadowOffset: { value: new THREE.Vector2(0, 0) },
      uUmbraR: { value: 0 },
      uPenumbraR: { value: 0 },
      uMoonTex: { value: null as THREE.Texture | null },
      uHasTex: { value: 0 },
      uGain: { value: LUNAR_MOON_BASE_GAIN },
      uDanjonL: { value: 2 },
      uExposure: { value: 1 },
      uFitCircle: { value: 0 },
    },
    vertexShader: LUNAR_QUAD_VERTEX_SHADER,
    fragmentShader: LUNAR_QUAD_FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    premultipliedAlpha: true,
  });
}
