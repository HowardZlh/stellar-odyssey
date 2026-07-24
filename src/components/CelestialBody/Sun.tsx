'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { SUN } from '@/data/planets';
import { detailTextureUrl, textureUrl } from '@/data/textures';
import { useSimulationStore } from '@/store';
import { useBitmapTexture } from '@/hooks/useBitmapTexture';
import { bodyDisplayRadius } from '@/utils/scale';
import { detailGateUpdate, detailStrength01 } from '@/utils/planetDetail';
import {
  FLARE_SPOT_RADIUS_RAD,
  flareIntensity01,
  flareLocalBoost,
  flareProgress01,
} from '@/utils/solarActivity';
import { SOLAR_OMEGA_COEFFS, solarShearShaderDays } from '@/utils/solarRotation';
import { solarCycleState } from '@/utils/solarCycle';
import {
  FILAMENT_HALF_WIDTH_RAD,
  FILAMENT_MIN_BRIGHTNESS,
  SUNSPOT_MAX_RENDERED,
  SUNSPOT_PENUMBRA_BRIGHTNESS,
  SUNSPOT_UMBRA_BRIGHTNESS,
  SUNSPOT_UMBRA_FRAC,
  fillSunspotShaderData,
} from '@/utils/sunspots';
import {
  CHROMOSPHERE_COLOR,
  CHROMOSPHERE_FRESNEL_POWER,
  CHROMOSPHERE_MAX_ALPHA,
  CHROMOSPHERE_SHELL_SCALE,
  CORONA_COLOR,
  CORONA_FALLOFF_K,
  CORONA_QUAD_SCALE,
  CORONA_STREAMER_FREQ,
  CORONA_TIME_RATE,
  CORONAL_HOLE_DIR,
  CORONAL_HOLE_MIN_BRIGHTNESS,
  CORONAL_HOLE_RADIUS_RAD,
  FACULAE_BRIGHTNESS_BOOST,
  FACULAE_OUTER_RADIUS_RATIO,
  GRANULE_AMP_FAR,
  GRANULE_AMP_NEAR,
  GRANULE_CELL_SCALE,
  PHOTOSPHERE_BRIGHTNESS_GAIN,
  SPICULE_AMP,
  SPICULE_NOISE_FREQ,
  SPICULE_TIME_RATE,
  SUPERGRANULE_AMP,
  SUPERGRANULE_CELL_SCALE,
  SUPERGRANULE_TIME_RATE,
  SUN_EDGE_REDNESS,
  SUN_LIMB_DARKENING_U,
  SUN_SPHERE_SEGMENTS,
  granulationPhase,
  spriteGlowOpacity,
} from '@/utils/sunSurface';
import { SunActivity } from './SunActivity';
import { SunCutaway } from './SunCutaway';
import { getTextureManager } from './textureManager';

/**
 * 太阳（S1，IMPROVEMENT_REQUIREMENTS_SOLAR §4.2/§5.1/§5.2）：
 * 光球 shader（米粒组织动态 + 临边昏暗 + 4K 底图混合）+ 色球边缘红环
 * + 结构化日冕（冕流基础形态）+ 点光源。
 *
 * - 光球：自定义 ShaderMaterial——球面 3D fBm 米粒亮度调制（随模拟时间
 *   演化、暂停冻结）、临边昏暗（V 波段 u≈0.6）、边缘色温梯度；
 *   4K 近观细节层 → 2K 底图 → 纯色降级三级纹理。
 * - 色球：放大壳层菲涅尔红环（氢α 656 nm），仅近观可辨（细节强度淡入）。
 * - 日冕：远观保持低成本 sprite 光晕（与升级前观感一致）；近观淡入
 *   结构化日冕广告牌（径向衰减 + 赤道冕流 + 角向噪声条纹），sprite
 *   光晕同步收敛避免叠加过曝（分级呈现，spriteGlowOpacity）。
 * - 近观门控（§5.2 硬性）：复用 P4 detailGateUpdate 滞回状态机——
 *   相机-太阳距离进入阈值时请求 4K 层（textureManager LRU 保留、
 *   离开 L1 语境立即释放）；所有近观效果强度随距离平滑淡入淡出。
 *
 * 纯逻辑镜像与艺术化登记见 utils/sunSurface.ts 文件头（米粒尺度/速率
 * 钳制/色球厚度放大/日冕范围压缩）；GLSL 噪声与 utils/stellarSurface.ts
 * hash3/valueNoise3D/convectionFbm3 镜像一致。
 *
 * S2 扩展（IMPROVEMENT_REQUIREMENTS_SOLAR §4.1/§4.3）：
 * - 黑子：光球 shader 暗区（本影+半影放射状纤维，镜像 utils/sunspots.ts），
 *   位置/强度每帧由确定性伪随机系统填充（零分配），随较差自转移动。
 * - 较差自转：按纬度对纹理 U 坐标附加差速相位（赤道 25.4 天/极区 34 天，
 *   镜像 utils/solarRotation.ts，相位回卷防 float32 精度失效）。
 * - 耀斑：活跃事件时源区局部增亮（镜像 solarActivity.flareLocalBoost，
 *   峰值超 Bloom 阈值自然泛光）；事件生命周期由 SunActivity 驱动。
 * - 剖面模式（§4.1）：开启时隐藏光球/色球/日冕/光晕，由 SunCutaway
 *   呈现 1/4 切除内部结构；外部活动特效互斥淡出（SunActivity 内处理）。
 */
export function Sun(): JSX.Element {
  // 真实比例模式（需求 4.1）：太阳半径按真实线性比例映射（约 0.047 场景单位）
  const realScaleMode = useSimulationStore((s) => s.realScaleMode);
  const radius = bodyDisplayRadius(SUN.radiusKm, realScaleMode);
  const selectBody = useSimulationStore((s) => s.selectBody);
  // 太阳为 L2 主发光体：2K 底图启动即加载（P3-2 优先级 1，仅次于聚焦天体）
  const sunTexture = useBitmapTexture(textureUrl('sun', 'surface'), 1, true);
  // S1 近观细节层：4K 底图仅近观门控激活时请求（优先级 0，2K 先显示防空窗）
  const [detailActive, setDetailActive] = useState(false);
  const detailActiveRef = useRef(false);
  const detailUrl = detailTextureUrl('sun', 'surface');
  const detailTexture = useBitmapTexture(detailUrl, 0, detailActive);
  const surfaceTexture = (detailActive ? detailTexture : null) ?? sunTexture;

  const coronaRef = useRef<THREE.Mesh>(null);
  const sunGroupRef = useRef<THREE.Group>(null);
  // S2 剖面模式：开启时隐藏光球/色球/日冕/光晕（SunCutaway 互斥呈现）
  const cutawayMode = useSimulationStore((s) => s.sunCutawayMode);
  // 剖面模式下光球（visible=false 仍参与 raycast）不得拦截分层点选
  const photosphereRaycast = useMemo(() => {
    const base = THREE.Mesh.prototype.raycast;
    return function gatedRaycast(
      this: THREE.Mesh,
      raycaster: THREE.Raycaster,
      intersects: THREE.Intersection[],
    ): void {
      if (useSimulationStore.getState().sunCutawayMode) return;
      base.call(this, raycaster, intersects);
    };
  }, []);
  // 黑子 shader 数据暂存（渲染循环零分配）
  const spotScratch = useMemo(
    () => ({
      dirs: new Float32Array(SUNSPOT_MAX_RENDERED * 3),
      params: new Float32Array(SUNSPOT_MAX_RENDERED * 3),
    }),
    [],
  );

  // 光球 shader：米粒组织 + 临边昏暗 + 色温梯度（镜像 utils/sunSurface.ts）
  // + 黑子暗区（镜像 utils/sunspots.ts）+ 较差自转（镜像 utils/solarRotation.ts）
  // + 耀斑局部增亮（镜像 utils/solarActivity.ts）
  const photosphereMaterial = useMemo(() => {
    const fallback = new THREE.Color(SUN.color);
    const tint = new THREE.Color('#fff2d0');
    return new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: null },
        uHasMap: { value: 0 },
        uTint: { value: new THREE.Vector3(tint.r, tint.g, tint.b) },
        uFallbackColor: { value: new THREE.Vector3(fallback.r, fallback.g, fallback.b) },
        uTime: { value: 0 },
        uDetailStrength: { value: 0 },
        uLimbU: { value: SUN_LIMB_DARKENING_U },
        uRedness: { value: SUN_EDGE_REDNESS },
        uCellScale: { value: GRANULE_CELL_SCALE },
        uAmpFar: { value: GRANULE_AMP_FAR },
        uAmpNear: { value: GRANULE_AMP_NEAR },
        uGain: { value: PHOTOSPHERE_BRIGHTNESS_GAIN },
        // S2：较差自转相位（回卷天数）+ 黑子 + 耀斑
        uRotDays: { value: 0 },
        uSpotCount: { value: 0 },
        uSpotDirs: {
          value: Array.from({ length: SUNSPOT_MAX_RENDERED }, () => new THREE.Vector3()),
        },
        uSpotParams: {
          value: Array.from({ length: SUNSPOT_MAX_RENDERED }, () => new THREE.Vector3()),
        },
        uFlareDir: { value: new THREE.Vector3(1, 0, 0) },
        uFlareAmp: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vNormal;
        varying vec3 vViewDir;
        varying vec3 vObjPos;
        varying vec2 vUv;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          vObjPos = normalize(position);
          vUv = uv;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vViewDir = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        uniform float uHasMap;
        uniform vec3 uTint;
        uniform vec3 uFallbackColor;
        uniform float uTime;
        uniform float uDetailStrength;
        uniform float uLimbU;
        uniform float uRedness;
        uniform float uCellScale;
        uniform float uAmpFar;
        uniform float uAmpNear;
        uniform float uGain;
        uniform float uRotDays;
        uniform int uSpotCount;
        uniform vec3 uSpotDirs[${SUNSPOT_MAX_RENDERED}];
        uniform vec3 uSpotParams[${SUNSPOT_MAX_RENDERED}];
        uniform vec3 uFlareDir;
        uniform float uFlareAmp;
        varying vec3 vNormal;
        varying vec3 vViewDir;
        varying vec3 vObjPos;
        varying vec2 vUv;

        // 较差自转角速度剖面（度/天，utils/solarRotation.solarRotationOmegaDegPerDay 镜像）
        float omegaDegPerDay(float lat) {
          float s2 = sin(lat) * sin(lat);
          return ${SOLAR_OMEGA_COEFFS.a.toFixed(8)}
            + (${SOLAR_OMEGA_COEFFS.b.toFixed(8)}) * s2
            + (${SOLAR_OMEGA_COEFFS.c.toFixed(8)}) * s2 * s2;
        }

        // 与 utils/stellarSurface.ts hash3/valueNoise3D/convectionFbm3 镜像一致
        //（3D 噪声以单位球面坐标采样：无经度接缝、无极点收缩）
        float hash3(vec3 p) {
          return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
        }
        float smooth01(float t) { t = clamp(t, 0.0, 1.0); return t*t*(3.0-2.0*t); }
        float valueNoise3(vec3 p) {
          vec3 i = floor(p);
          vec3 f = p - i;
          vec3 t = vec3(smooth01(f.x), smooth01(f.y), smooth01(f.z));
          float v000 = hash3(i);
          float v100 = hash3(i + vec3(1.0, 0.0, 0.0));
          float v010 = hash3(i + vec3(0.0, 1.0, 0.0));
          float v110 = hash3(i + vec3(1.0, 1.0, 0.0));
          float v001 = hash3(i + vec3(0.0, 0.0, 1.0));
          float v101 = hash3(i + vec3(1.0, 0.0, 1.0));
          float v011 = hash3(i + vec3(0.0, 1.0, 1.0));
          float v111 = hash3(i + vec3(1.0, 1.0, 1.0));
          float a = mix(mix(v000, v100, t.x), mix(v010, v110, t.x), t.y);
          float b = mix(mix(v001, v101, t.x), mix(v011, v111, t.x), t.y);
          return mix(a, b, t.z);
        }
        float fbm3(vec3 p, float t) {
          float sum = 0.0; float amp = 1.0; float total = 0.0; float freq = uCellScale;
          for (int o = 0; o < 4; o++) {
            float drift = t * (0.05 + float(o) * 0.02);
            sum += valueNoise3(p * freq + vec3(drift, -drift, drift * 0.7)) * amp;
            total += amp; amp *= 0.5; freq *= 2.0;
          }
          return sum / total;
        }

        void main() {
          // 较差自转（solarRotation.solarRotationUvOffset 镜像）：
          // 按纬度对纹理 U 坐标附加相对赤道的差速剪切相位（赤道 25.4 天 /
          // 极区 34 天；有界剪切窗口登记于 utils/solarRotation.ts）
          float lat = (vUv.y - 0.5) * 3.14159265358979;
          float uvShift = -(omegaDegPerDay(lat) - ${SOLAR_OMEGA_COEFFS.a.toFixed(8)}) * uRotDays / 360.0;
          vec2 uvR = vec2(fract(vUv.x + uvShift), vUv.y);
          vec3 base = uHasMap > 0.5
            ? texture2D(uMap, uvR).rgb * uTint
            : uFallbackColor;
          // 米粒组织（sunSurface.granulationBrightness 镜像）：
          // 胞中心亮、边界暗，幅度随近观细节强度增强
          float cells = fbm3(vObjPos * 1.5, uTime);
          float amp = mix(uAmpFar, uAmpNear, uDetailStrength);
          float bright = clamp(1.0 + (cells - 0.5) * 2.0 * amp, 0.6, 1.4);
          // S3 超米粒组织（sunSurface.supergranulationModulation 镜像）：
          // 低频大尺度亮度调制（~30,000 km），仅近观淡入
          float superCells = valueNoise3(
            vObjPos * ${SUPERGRANULE_CELL_SCALE.toFixed(4)}
            + vec3(uTime * ${SUPERGRANULE_TIME_RATE.toFixed(4)})
          );
          bright += (superCells - 0.5) * 2.0 * ${SUPERGRANULE_AMP.toFixed(4)} * uDetailStrength;
          // 黑子暗区（sunspots.sunspotDarkening 镜像）：本影深暗 +
          // 半影放射状纤维（围绕黑子中心的方向噪声调制）
          float spotFactor = 1.0;
          // S3 光斑（faculae）：黑子周边亮斑累加（sunSurface.faculaeBoost 镜像）
          float faculae = 0.0;
          float muEarly = clamp(dot(normalize(vNormal), normalize(vViewDir)), 0.0, 1.0);
          for (int i = 0; i < ${SUNSPOT_MAX_RENDERED}; i++) {
            if (i >= uSpotCount) break;
            vec3 sd = uSpotDirs[i];
            float cosAng = dot(vObjPos, sd);
            float ang = acos(clamp(cosAng, -1.0, 1.0));
            float radius = uSpotParams[i].x;
            float strength = uSpotParams[i].y;
            if (ang < radius) {
              float umbraR = radius * ${SUNSPOT_UMBRA_FRAC.toFixed(4)};
              float f;
              if (ang <= umbraR) {
                f = ${SUNSPOT_UMBRA_BRIGHTNESS.toFixed(4)};
              } else {
                float t = (ang - umbraR) / (radius - umbraR);
                vec3 rel = vObjPos - sd * cosAng;
                float fib = valueNoise3(normalize(rel + vec3(1e-5)) * 24.0 + sd * 60.0);
                float pen = ${SUNSPOT_PENUMBRA_BRIGHTNESS.toFixed(4)} + 0.15 * (fib - 0.5);
                f = pen + (1.0 - pen) * (t * t * (3.0 - 2.0 * t));
              }
              spotFactor = min(spotFactor, 1.0 - (1.0 - f) * strength);
            } else {
              // 光斑环带（黑子半径 → FACULAE_OUTER_RADIUS_RATIO×半径）
              float outer = radius * ${FACULAE_OUTER_RADIUS_RATIO.toFixed(4)};
              if (ang < outer) {
                float ft = (ang - radius) / (outer - radius);
                float band = sin(3.14159265 * ft);
                vec3 rel = vObjPos - sd * cosAng;
                float fn = valueNoise3(normalize(rel + vec3(1e-5)) * 30.0 + sd * 90.0);
                float limbW = 0.4 + 0.6 * (1.0 - muEarly);
                faculae += ${FACULAE_BRIGHTNESS_BOOST.toFixed(4)} * band * strength * limbW * (0.6 + 0.4 * fn);
              }
            }
          }
          bright *= spotFactor;
          // 光斑增亮随近观细节强度淡入（远观弱化，避免喧宾夺主）
          bright += faculae * mix(0.5, 1.0, uDetailStrength);
          // S3 暗条（filament，sunspots.filamentDarkening 镜像）：黑子对之间的
          // 磁中性线附近呈暗色细线（日珥在日面的投影，冷等离子体吸收）
          float filament = 1.0;
          for (int p = 0; p < ${SUNSPOT_MAX_RENDERED / 2}; p++) {
            int li = p * 2;
            int fi = p * 2 + 1;
            if (fi >= uSpotCount) break;
            vec3 a = uSpotDirs[li];
            vec3 b = uSpotDirs[fi];
            vec3 mid = normalize(a + b);
            vec3 axis = b - a;
            float axisLen = length(axis);
            if (axisLen < 1e-4) continue;
            axis /= axisLen;
            // 沿中性线的投影位置（相对中点，归一化到 [0,1]）
            float along = dot(vObjPos - mid, axis) / axisLen + 0.5;
            // 横向角距（片元方向到中性线的垂直角距近似）
            vec3 rel = vObjPos - mid;
            float perp = length(rel - axis * dot(rel, axis));
            float strength = uSpotParams[li].y;
            if (along >= 0.0 && along <= 1.0 && perp < ${FILAMENT_HALF_WIDTH_RAD.toFixed(4)}) {
              float across = 1.0 - perp / ${FILAMENT_HALF_WIDTH_RAD.toFixed(4)};
              float alongW = sin(3.14159265 * along);
              float dark = (1.0 - ${FILAMENT_MIN_BRIGHTNESS.toFixed(4)}) * across * alongW * strength;
              filament = min(filament, 1.0 - dark);
            }
          }
          bright *= filament;
          // 耀斑局部增亮（solarActivity.flareLocalBoost 镜像）：
          // 峰值远超 Bloom 阈值（0.55），自然联动泛光
          if (uFlareAmp > 0.001) {
            float fAng = acos(clamp(dot(vObjPos, uFlareDir), -1.0, 1.0));
            float ft = clamp(fAng / ${FLARE_SPOT_RADIUS_RAD.toFixed(4)}, 0.0, 1.0);
            float fw = 1.0 - ft * ft * (3.0 - 2.0 * ft);
            bright += uFlareAmp * fw * fw;
          }
          // 临边昏暗 μ = N·V（stellarSurface.limbDarkening 镜像）
          float mu = clamp(dot(normalize(vNormal), normalize(vViewDir)), 0.0, 1.0);
          float limb = 1.0 - uLimbU * (1.0 - mu);
          // 边缘色温梯度：盘面边缘偏暗红（较冷较深层辐射）
          float edge = pow(1.0 - mu, 1.5) * uRedness;
          vec3 col = base * vec3(1.0 - 0.15*edge, 1.0 - 0.55*edge, 1.0 - 0.75*edge);
          gl_FragColor = vec4(col * bright * limb * uGain, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });
  }, []);

  // 色球壳层：菲涅尔红环（氢α），仅近观淡入（sunSurface.chromosphereRimAlpha 镜像）
  const chromosphereMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: {
          uColor: {
            value: new THREE.Vector3(
              CHROMOSPHERE_COLOR.r,
              CHROMOSPHERE_COLOR.g,
              CHROMOSPHERE_COLOR.b,
            ),
          },
          uMaxAlpha: { value: CHROMOSPHERE_MAX_ALPHA },
          uFresnelPower: { value: CHROMOSPHERE_FRESNEL_POWER },
          uStrength: { value: 0 },
          // S3 针状体：色球边缘高频噪声扰动相位
          uTime: { value: 0 },
        },
        vertexShader: /* glsl */ `
          varying vec3 vNormal;
          varying vec3 vViewDir;
          varying vec3 vObjPos;
          void main() {
            vNormal = normalize(normalMatrix * normal);
            vObjPos = normalize(position);
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            vViewDir = normalize(-mv.xyz);
            gl_Position = projectionMatrix * mv;
          }
        `,
        fragmentShader: /* glsl */ `
          uniform vec3 uColor;
          uniform float uMaxAlpha;
          uniform float uFresnelPower;
          uniform float uStrength;
          uniform float uTime;
          varying vec3 vNormal;
          varying vec3 vViewDir;
          varying vec3 vObjPos;
          float hash3(vec3 p) {
            return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
          }
          void main() {
            float mu = clamp(dot(normalize(vNormal), normalize(vViewDir)), 0.0, 1.0);
            float alpha = pow(1.0 - mu, uFresnelPower) * uMaxAlpha * uStrength;
            // S3 针状体（sunSurface.spiculeRimPerturbation 镜像）：
            // 色球边缘高频锯齿状 alpha 扰动（细小针状喷流示意，勿加几何）
            float n = hash3(floor(vObjPos * ${SPICULE_NOISE_FREQ.toFixed(1)} + uTime));
            alpha = alpha * (1.0 + ${SPICULE_AMP.toFixed(4)} * (n - 0.5) * 2.0);
            alpha = max(0.0, alpha);
            gl_FragColor = vec4(uColor * alpha, alpha);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }
        `,
      }),
    [],
  );

  // 结构化日冕广告牌：径向衰减 + 赤道冕流 + 角向噪声（sunSurface.coronaIntensity 镜像）
  const coronaMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: {
          uColor: {
            value: new THREE.Vector3(CORONA_COLOR.r, CORONA_COLOR.g, CORONA_COLOR.b),
          },
          uQuadScale: { value: CORONA_QUAD_SCALE },
          uFalloffK: { value: CORONA_FALLOFF_K },
          uStreamerFreq: { value: CORONA_STREAMER_FREQ },
          uCenterW: { value: new THREE.Vector3() },
          uTime: { value: 0 },
          uStrength: { value: 0 },
          // S3 周期联动：日冕形态各向同性因子（0 极小期赤道集中 → 1 极大期全纬度）
          uIsotropy: { value: 0 },
          // S3 日冕洞：开放磁力线暗区方向（世界坐标单位矢量）
          uHoleDir: {
            value: new THREE.Vector3(CORONAL_HOLE_DIR.x, CORONAL_HOLE_DIR.y, CORONAL_HOLE_DIR.z),
          },
        },
        vertexShader: /* glsl */ `
          varying vec2 vLocal;
          varying vec3 vWorldPos;
          void main() {
            vLocal = position.xy;
            vec4 world = modelMatrix * vec4(position, 1.0);
            vWorldPos = world.xyz;
            gl_Position = projectionMatrix * viewMatrix * world;
          }
        `,
        fragmentShader: /* glsl */ `
          uniform vec3 uColor;
          uniform float uQuadScale;
          uniform float uFalloffK;
          uniform float uStreamerFreq;
          uniform vec3 uCenterW;
          uniform float uTime;
          uniform float uStrength;
          uniform float uIsotropy;
          uniform vec3 uHoleDir;
          varying vec2 vLocal;
          varying vec3 vWorldPos;

          float hash3(vec3 p) {
            return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
          }
          float smooth01(float t) { t = clamp(t, 0.0, 1.0); return t*t*(3.0-2.0*t); }
          float valueNoise3(vec3 p) {
            vec3 i = floor(p);
            vec3 f = p - i;
            vec3 t = vec3(smooth01(f.x), smooth01(f.y), smooth01(f.z));
            float v000 = hash3(i);
            float v100 = hash3(i + vec3(1.0, 0.0, 0.0));
            float v010 = hash3(i + vec3(0.0, 1.0, 0.0));
            float v110 = hash3(i + vec3(1.0, 1.0, 0.0));
            float v001 = hash3(i + vec3(0.0, 0.0, 1.0));
            float v101 = hash3(i + vec3(1.0, 0.0, 1.0));
            float v011 = hash3(i + vec3(0.0, 1.0, 1.0));
            float v111 = hash3(i + vec3(1.0, 1.0, 1.0));
            float a = mix(mix(v000, v100, t.x), mix(v010, v110, t.x), t.y);
            float b = mix(mix(v001, v101, t.x), mix(v011, v111, t.x), t.y);
            return mix(a, b, t.z);
          }
          float fbm3(vec3 p, float t) {
            float sum = 0.0; float amp = 1.0; float total = 0.0; float freq = uStreamerFreq;
            for (int o = 0; o < 4; o++) {
              float drift = t * (0.05 + float(o) * 0.02);
              sum += valueNoise3(p * freq + vec3(drift, -drift, drift * 0.7)) * amp;
              total += amp; amp *= 0.5; freq *= 2.0;
            }
            return sum / total;
          }

          void main() {
            // 距太阳中心距离（单位：太阳半径）；日面内片元被光球深度遮挡
            float rNorm = length(vLocal) * uQuadScale;
            float fall = rNorm <= 1.0 ? 1.0 : exp(-uFalloffK * (rNorm - 1.0));
            // 角向冕流：以世界方向采样噪声（径向自然拉长成条纹）
            vec3 dir = normalize(vWorldPos - uCenterW);
            float streak = fbm3(dir, uTime);
            float eq = pow(1.0 - abs(dir.y), 2.0);
            // S3 周期联动（sunSurface.coronaStreamerFactor 镜像）：
            // 极小期强赤道加权、极大期趋各向同性（日冕全纬度铺开）
            float angular = mix(0.35 + 0.65 * eq, 1.0, uIsotropy);
            float streamer = (0.45 + 0.55 * streak) * angular;
            // S3 日冕洞（sunSurface.coronalHoleDarkening 镜像）：开放磁力线暗区
            float holeAng = acos(clamp(dot(dir, normalize(uHoleDir)), -1.0, 1.0));
            float hole = 1.0;
            if (holeAng < ${CORONAL_HOLE_RADIUS_RAD.toFixed(4)}) {
              float ht = holeAng / ${CORONAL_HOLE_RADIUS_RAD.toFixed(4)};
              float hs = ht * ht * (3.0 - 2.0 * ht);
              hole = ${CORONAL_HOLE_MIN_BRIGHTNESS.toFixed(4)} + (1.0 - ${CORONAL_HOLE_MIN_BRIGHTNESS.toFixed(4)}) * hs;
            }
            float a = fall * streamer * hole * uStrength;
            gl_FragColor = vec4(uColor * a, a);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }
        `,
      }),
    [],
  );

  // 远观低成本光晕（径向渐变 sprite，分级呈现的 L2+ 表现，与升级前观感一致）
  const glowAssets = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
      gradient.addColorStop(0, 'rgba(255, 220, 130, 0.55)');
      gradient.addColorStop(0.4, 'rgba(255, 180, 80, 0.18)');
      gradient.addColorStop(1, 'rgba(255, 150, 50, 0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 128, 128);
    }
    const texture = new THREE.CanvasTexture(canvas);
    const materials = [2.5, 4, 6].map(
      (scale) =>
        [
          new THREE.SpriteMaterial({
            map: texture,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
          }),
          radius * scale,
        ] as const,
    );
    return { texture, materials };
  }, [radius]);

  // 纹理就绪状态同步到 uniform（4K 就绪前 2K 防空窗，失败降级纯色）
  useEffect(() => {
    photosphereMaterial.uniforms.uMap.value = surfaceTexture;
    photosphereMaterial.uniforms.uHasMap.value = surfaceTexture ? 1 : 0;
  }, [surfaceTexture, photosphereMaterial]);


  // 卸载释放（AGENTS.md 内存管理）：材质/光晕贴图/细节层显存
  useEffect(() => {
    return () => {
      photosphereMaterial.dispose();
      chromosphereMaterial.dispose();
      coronaMaterial.dispose();
      glowAssets.texture.dispose();
      for (const [material] of glowAssets.materials) {
        material.dispose();
      }
      getTextureManager().releaseDetail(SUN.id);
    };
  }, [photosphereMaterial, chromosphereMaterial, coronaMaterial, glowAssets]);

  useFrame(({ camera }) => {
    const { simDays, continuousLevel, activeSolarFlare } = useSimulationStore.getState();
    // 太阳恒居场景原点附近（银河系组反向平移锚定），以组世界坐标为准
    const group = sunGroupRef.current;
    const centerW = coronaMaterial.uniforms.uCenterW.value as THREE.Vector3;
    if (group) {
      group.getWorldPosition(centerW);
    }
    const distToSun = camera.position.distanceTo(centerW);
    // S1 近观门控（复用 P4 滞回状态机）：4K 层请求 + LRU 保留 + 离开即释放
    const gate = detailGateUpdate(detailActiveRef.current, distToSun, radius, continuousLevel);
    if (gate.active !== detailActiveRef.current) {
      detailActiveRef.current = gate.active;
      setDetailActive(gate.active);
      if (gate.active && detailUrl) {
        getTextureManager().retainDetail(SUN.id, [detailUrl]);
      }
    }
    if (gate.releaseNow) {
      getTextureManager().releaseDetail(SUN.id);
    }
    // 近观细节强度：随距离平滑淡入淡出（米粒幅度/色球/结构化日冕共用）
    const strength = gate.active ? detailStrength01(distToSun, radius) : 0;
    // 米粒演化相位：共享模拟时间轴（暂停冻结），速率钳制 + 回卷（登记）
    const phase = granulationPhase(simDays);
    photosphereMaterial.uniforms.uTime.value = phase;
    photosphereMaterial.uniforms.uDetailStrength.value = strength;
    // S2 较差自转纹理剪切相位（有界窗口回卷，登记于 utils/solarRotation.ts）
    photosphereMaterial.uniforms.uRotDays.value = solarShearShaderDays(simDays);
    // S2 黑子：确定性伪随机系统按模拟时间填充（零分配），随较差自转移动
    const spotCount = fillSunspotShaderData(simDays, spotScratch.dirs, spotScratch.params);
    photosphereMaterial.uniforms.uSpotCount.value = spotCount;
    const spotDirsU = photosphereMaterial.uniforms.uSpotDirs.value as THREE.Vector3[];
    const spotParamsU = photosphereMaterial.uniforms.uSpotParams.value as THREE.Vector3[];
    for (let i = 0; i < spotCount; i += 1) {
      spotDirsU[i].set(
        spotScratch.dirs[i * 3],
        spotScratch.dirs[i * 3 + 1],
        spotScratch.dirs[i * 3 + 2],
      );
      spotParamsU[i].set(
        spotScratch.params[i * 3],
        spotScratch.params[i * 3 + 1],
        spotScratch.params[i * 3 + 2],
      );
    }

    // S2 耀斑局部增亮（事件生命周期由 SunActivity 驱动，此处只读）
    let flareAmp = 0;
    if (activeSolarFlare) {
      const p = flareProgress01(
        simDays,
        activeSolarFlare.startedAtSimDays,
        activeSolarFlare.durationDays,
      );
      if (Number.isFinite(p)) {
        flareAmp = flareLocalBoost(0, flareIntensity01(p));
      }
      (photosphereMaterial.uniforms.uFlareDir.value as THREE.Vector3).set(
        activeSolarFlare.sourceDir.x,
        activeSolarFlare.sourceDir.y,
        activeSolarFlare.sourceDir.z,
      );
    }
    photosphereMaterial.uniforms.uFlareAmp.value = flareAmp;
    chromosphereMaterial.uniforms.uStrength.value = strength;
    // S3 针状体边缘扰动相位（较快演化）
    chromosphereMaterial.uniforms.uTime.value = phase * SPICULE_TIME_RATE;
    coronaMaterial.uniforms.uStrength.value = strength;
    coronaMaterial.uniforms.uTime.value = phase * CORONA_TIME_RATE;
    // S3 周期联动（§4.4）：日冕形态各向同性因子随活动周期包络（极小期
    // 赤道集中 → 极大期全纬度铺开）；仅结构化日冕可见时才需读取
    if (strength > 0) {
      coronaMaterial.uniforms.uIsotropy.value = solarCycleState(simDays).coronaIsotropy01;
    }
    // 日冕广告牌朝向相机
    if (coronaRef.current) {
      coronaRef.current.quaternion.copy(camera.quaternion);
    }
    // 分级呈现：近观时 sprite 光晕收敛让位给结构化日冕（平滑无突变）
    const glowOpacity = spriteGlowOpacity(strength);
    for (const [material] of glowAssets.materials) {
      material.opacity = glowOpacity;
    }
  });

  return (
    <group name="sun" ref={sunGroupRef}>
      <mesh
        material={photosphereMaterial}
        visible={!cutawayMode}
        raycast={photosphereRaycast}
        onClick={(e) => {
          e.stopPropagation();
          selectBody(SUN.id);
        }}
      >
        <sphereGeometry args={[radius, SUN_SPHERE_SEGMENTS, SUN_SPHERE_SEGMENTS]} />
      </mesh>
      {/* 色球：放大壳层菲涅尔红环（氢α，厚度放大登记于 utils/sunSurface.ts） */}
      <mesh material={chromosphereMaterial} visible={!cutawayMode} raycast={() => null}>
        <sphereGeometry
          args={[radius * CHROMOSPHERE_SHELL_SCALE, SUN_SPHERE_SEGMENTS, SUN_SPHERE_SEGMENTS]}
        />
      </mesh>
      {/* 结构化日冕（近观淡入）：径向衰减 + 赤道冕流 + 角向噪声条纹 */}
      <mesh
        ref={coronaRef}
        material={coronaMaterial}
        visible={!cutawayMode}
        scale={[radius * CORONA_QUAD_SCALE, radius * CORONA_QUAD_SCALE, 1]}
        raycast={() => null}
      >
        <planeGeometry args={[1, 1]} />
      </mesh>
      {glowAssets.materials.map(([material, scale], idx) => (
        <sprite key={idx} material={material} visible={!cutawayMode} scale={[scale, scale, 1]} />
      ))}
      {/* S2 太阳活动系统：太阳风/CME 粒子 + 日珥/日冕环 + 耀斑辉光与事件驱动 */}
      <SunActivity radius={radius} />
      {/* S2 内部结构剖面模式（§4.1）：1/4 切除视图，分层可点选 */}
      <SunCutaway radius={radius} surfaceTexture={sunTexture} />
      {/* 附录A：太阳点光源强度 8 */}
      <pointLight intensity={8} distance={0} decay={0.4} color="#fff5e0" />
    </group>
  );
}
