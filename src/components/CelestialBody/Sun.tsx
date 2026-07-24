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
  CHROMOSPHERE_COLOR,
  CHROMOSPHERE_FRESNEL_POWER,
  CHROMOSPHERE_MAX_ALPHA,
  CHROMOSPHERE_SHELL_SCALE,
  CORONA_COLOR,
  CORONA_FALLOFF_K,
  CORONA_QUAD_SCALE,
  CORONA_STREAMER_FREQ,
  CORONA_TIME_RATE,
  GRANULE_AMP_FAR,
  GRANULE_AMP_NEAR,
  GRANULE_CELL_SCALE,
  PHOTOSPHERE_BRIGHTNESS_GAIN,
  SUN_EDGE_REDNESS,
  SUN_LIMB_DARKENING_U,
  SUN_SPHERE_SEGMENTS,
  granulationPhase,
  spriteGlowOpacity,
} from '@/utils/sunSurface';
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

  // 光球 shader：米粒组织 + 临边昏暗 + 色温梯度（镜像 utils/sunSurface.ts）
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
        varying vec3 vNormal;
        varying vec3 vViewDir;
        varying vec3 vObjPos;
        varying vec2 vUv;

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
          vec3 base = uHasMap > 0.5
            ? texture2D(uMap, vUv).rgb * uTint
            : uFallbackColor;
          // 米粒组织（sunSurface.granulationBrightness 镜像）：
          // 胞中心亮、边界暗，幅度随近观细节强度增强
          float cells = fbm3(vObjPos * 1.5, uTime);
          float amp = mix(uAmpFar, uAmpNear, uDetailStrength);
          float bright = clamp(1.0 + (cells - 0.5) * 2.0 * amp, 0.6, 1.4);
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
        },
        vertexShader: /* glsl */ `
          varying vec3 vNormal;
          varying vec3 vViewDir;
          void main() {
            vNormal = normalize(normalMatrix * normal);
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
          varying vec3 vNormal;
          varying vec3 vViewDir;
          void main() {
            float mu = clamp(dot(normalize(vNormal), normalize(vViewDir)), 0.0, 1.0);
            float alpha = pow(1.0 - mu, uFresnelPower) * uMaxAlpha * uStrength;
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
            float streamer = (0.45 + 0.55 * streak) * (0.35 + 0.65 * eq);
            float a = fall * streamer * uStrength;
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
    const { simDays, continuousLevel } = useSimulationStore.getState();
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
    chromosphereMaterial.uniforms.uStrength.value = strength;
    coronaMaterial.uniforms.uStrength.value = strength;
    coronaMaterial.uniforms.uTime.value = phase * CORONA_TIME_RATE;
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
        onClick={(e) => {
          e.stopPropagation();
          selectBody(SUN.id);
        }}
      >
        <sphereGeometry args={[radius, SUN_SPHERE_SEGMENTS, SUN_SPHERE_SEGMENTS]} />
      </mesh>
      {/* 色球：放大壳层菲涅尔红环（氢α，厚度放大登记于 utils/sunSurface.ts） */}
      <mesh material={chromosphereMaterial} raycast={() => null}>
        <sphereGeometry
          args={[radius * CHROMOSPHERE_SHELL_SCALE, SUN_SPHERE_SEGMENTS, SUN_SPHERE_SEGMENTS]}
        />
      </mesh>
      {/* 结构化日冕（近观淡入）：径向衰减 + 赤道冕流 + 角向噪声条纹 */}
      <mesh
        ref={coronaRef}
        material={coronaMaterial}
        scale={[radius * CORONA_QUAD_SCALE, radius * CORONA_QUAD_SCALE, 1]}
        raycast={() => null}
      >
        <planeGeometry args={[1, 1]} />
      </mesh>
      {glowAssets.materials.map(([material, scale], idx) => (
        <sprite key={idx} material={material} scale={[scale, scale, 1]} />
      ))}
      {/* 附录A：太阳点光源强度 8 */}
      <pointLight intensity={8} distance={0} decay={0.4} color="#fff5e0" />
    </group>
  );
}
