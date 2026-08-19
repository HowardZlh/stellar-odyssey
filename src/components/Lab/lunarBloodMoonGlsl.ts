/**
 * 血月 umbraShading GLSL 镜像共享模板（LE 迭代 M4；契约 C4「三视角共用同一
 * 函数镜像，禁止各写一套」的实现层单点）。
 *
 * M3-1 原位于 LunarEclipseLab.tsx（地面月盘 quad 注入）；M4 月球太空球体
 * shader 需注入同一镜像段，故抽为共享常量——**字符串逐字保持**（纯重构，
 * 契约 C4 镜像纪律：CPU 事实源 = utils/lunarEclipse.umbraShading，逐式照抄
 * ——档间线性内插 + 径向指数混合；色表常量模板注入自 DANJON_UMBRA_PRESETS）。
 *
 * 消费点：LunarEclipseLab.tsx（地面 quad + 三联对比小视口）、
 * LunarEclipseSpaceView.tsx（太空月球球体）。M5 月球视角不适用（红环走
 * earthRingColor CPU 链）。
 */

import {
  DANJON_UMBRA_PRESETS,
  UMBRA_SHADING_EDGE_EXPONENT,
  type ShadingRgb,
} from '@/utils/lunarEclipse';

/** ShadingRgb → GLSL vec3 字面量（丹戎色表模板注入；照抄勿变形纪律） */
export function glslVec3(rgb: ShadingRgb): string {
  return `vec3(${rgb[0].toFixed(4)}, ${rgb[1].toFixed(4)}, ${rgb[2].toFixed(4)})`;
}

/**
 * umbraShading 的 GLSL 镜像段（契约 C4：CPU 事实源 = utils/lunarEclipse
 * umbraShading，逐式照抄——档间线性内插 + 径向指数混合；色表常量模板注入
 * 自 DANJON_UMBRA_PRESETS，三视角共用本镜像，禁止各写一套）。
 */
export const GLSL_UMBRA_SHADING = /* glsl */ `
  vec3 umbraShading(float rNorm, float danjonL) {
    float t = pow(clamp(rNorm, 0.0, 1.0), ${UMBRA_SHADING_EDGE_EXPONENT.toFixed(2)});
    float l = clamp(danjonL, 0.0, 4.0);
    float i0 = min(floor(l), 3.0);
    float w = l - i0;
    vec3 center; vec3 edge;
    if (i0 < 0.5) {
      center = mix(${glslVec3(DANJON_UMBRA_PRESETS[0].center)}, ${glslVec3(DANJON_UMBRA_PRESETS[1].center)}, w);
      edge = mix(${glslVec3(DANJON_UMBRA_PRESETS[0].edge)}, ${glslVec3(DANJON_UMBRA_PRESETS[1].edge)}, w);
    } else if (i0 < 1.5) {
      center = mix(${glslVec3(DANJON_UMBRA_PRESETS[1].center)}, ${glslVec3(DANJON_UMBRA_PRESETS[2].center)}, w);
      edge = mix(${glslVec3(DANJON_UMBRA_PRESETS[1].edge)}, ${glslVec3(DANJON_UMBRA_PRESETS[2].edge)}, w);
    } else if (i0 < 2.5) {
      center = mix(${glslVec3(DANJON_UMBRA_PRESETS[2].center)}, ${glslVec3(DANJON_UMBRA_PRESETS[3].center)}, w);
      edge = mix(${glslVec3(DANJON_UMBRA_PRESETS[2].edge)}, ${glslVec3(DANJON_UMBRA_PRESETS[3].edge)}, w);
    } else {
      center = mix(${glslVec3(DANJON_UMBRA_PRESETS[3].center)}, ${glslVec3(DANJON_UMBRA_PRESETS[4].center)}, w);
      edge = mix(${glslVec3(DANJON_UMBRA_PRESETS[3].edge)}, ${glslVec3(DANJON_UMBRA_PRESETS[4].edge)}, w);
    }
    return mix(center, edge, t);
  }
`;
