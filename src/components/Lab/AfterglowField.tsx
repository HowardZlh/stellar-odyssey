'use client';

/**
 * 风切变余迹系统（M3-3，需求 §1.5）：~500 粒子绑定亮流星/火流星槽位
 * （selectAfterglowSlots：火流星优先 + 质量降序），一个 THREE.Points
 * （1 draw call）。
 *
 * 确定性循环：粒子复用母槽位 aSeed/aGateRank/aFireballRank——与流星系统
 * 同一 fract 相位、同一门控公式（契约 C2），母槽位点燃则余迹粒子随之走
 * 同一周期；页签切换随父级 slots 一次性重建（契约 C2.1）。
 *
 * 时间线（每周期内）：粒子在母流星路径上按 aPathT 均布，t 过 aDepositTime
 * （= aPathT × 母寿命）后点亮（流星头掠过沉积），母流星熄灭（t > aDuration）
 * 后进入渐隐窗（普通 1–3 s / 火流星 ~10 s，M1 常量）。
 *
 * 风切变（§1.5）：顶点 shader 以粒子高度 y 采样 3D 值噪声（hash3/valueNoise3
 * 复用 SunCutaway/Sun 现成片段，勿新写）产生水平蛇形偏移；幅度 ∝ uWindSpeed ×
 * 滞空时长（m/s→km 换算 ×3 可辨度增益，登记艺术化）。
 *
 * 演示扩展分支（M3.5-3，与 MeteorField 同构）：aSlotIndex = 绑定的母槽位
 * 下标；uDemoSlot 命中时演示窗口 t ∈ [aDepositTime, aDuration+aFadeDur]
 * 起算点换 uDemoStart 并绕过双门控。登记限制：余迹只绑 50 槽位（火流星
 * 全绑定、普通演示槽位可能无余迹）。
 */

import type { JSX } from 'react';
import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import {
  AFTERGLOW_FADE_FIREBALL_SEC,
  AFTERGLOW_FADE_ORDINARY_SEC,
  AFTERGLOW_MAX_SLOTS,
  AFTERGLOW_PARTICLE_BUDGET,
  METEOR_CYCLE_PERIOD_SEC,
  evalCubic,
  fluxFraction,
  horizontalFromEquatorial,
  localSiderealTime,
  sceneDirFromAltAz,
  selectAfterglowSlots,
  visibleHourlyRate,
  type MeteorSlot,
} from '@/utils/meteorShower';
import { createSeededRandom } from '@/utils/random';
import { fovPointScaleFactor } from '@/utils/labGestures';
import type { LabFrameRefs } from '@/components/Lab/labTypes';

/** 粒子路径抖动/渐隐时长烘焙种子（确定性） */
const AFTERGLOW_SEED = 0xaf7e91;

/**
 * 3D 值噪声（SunCutaway.tsx 现成片段搬运，与 utils/stellarSurface 镜像一致；
 * M3.6-4 起被 MeteorField 片元闪烁与 MeteorHeadDetail 等离子体 fbm 复用导出）
 */
export const NOISE_GLSL = /* glsl */ `
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
`;

const AFTERGLOW_VERTEX_SHADER = /* glsl */ `
  attribute float aSeed;
  attribute float aGateRank;
  attribute float aFireballRank;
  attribute float aIsFireball;
  attribute float aDuration;
  attribute float aFadeDur;
  attribute float aDepositTime;
  attribute float aDispKm;
  attribute float aNoiseSeed;
  attribute float aSlotIndex;
  attribute vec3 aStartPos;
  uniform float uTime;
  uniform float uCyclePeriod;
  uniform float uFluxFraction;
  uniform float uFireballFraction;
  uniform float uDemoSlot;
  uniform float uDemoStart;
  uniform vec3 uVelocityDir;
  uniform float uWindSpeed;
  uniform float uPhenomenon;
  uniform float uScale;
  varying float vAlpha;
  varying vec3 vColor;
  ${NOISE_GLSL}

  void main() {
    float cycle = fract(aSeed + uTime / uCyclePeriod);   // 与母槽位同相位（契约 C2）
    float t = cycle * uCyclePeriod;
    bool gated = aGateRank >= uFluxFraction               // 门控与流星系统严格同式
      || (aIsFireball > 0.5 && aFireballRank >= uFireballFraction);
    // 演示扩展分支（M3.5-3，与 MeteorField 同构）：起算点换 uDemoStart、绕过双门控
    bool isDemo = uDemoSlot >= 0.0 && abs(aSlotIndex - uDemoSlot) < 0.5;
    if (isDemo) {
      t = uTime - uDemoStart;
      gated = false;
    }
    bool culled = gated || t < aDepositTime || t > aDuration + aFadeDur;
    if (culled) {
      vAlpha = 0.0;
      vColor = vec3(0.0);
      gl_PointSize = 0.0;
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }
    float age = t - aDepositTime;                        // 沉积后滞空时长
    vec3 pos = aStartPos + uVelocityDir * aDispKm;       // 母流星路径采样点
    // 风切变：以高度 y 采样 3D 噪声 → 水平蛇形偏移（不同高度相位不同 = 切变）
    float ny = pos.y * 0.12;
    float n1 = valueNoise3(vec3(ny, aNoiseSeed * 43.7, uTime * 0.05)) - 0.5;
    float n2 = valueNoise3(vec3(ny + 17.3, aNoiseSeed * 43.7 + 5.1, uTime * 0.05)) - 0.5;
    float driftKm = uWindSpeed * age * 0.003;            // m/s×s→km ×3 可辨度增益（登记）
    pos.x += n1 * 2.0 * driftKm;
    pos.z += n2 * 2.0 * driftKm;
    // 渐隐：母流星熄灭后进入衰减窗（平方衰减，尾段更柔）
    float fadeOut = 1.0 - clamp((t - aDuration) / aFadeDur, 0.0, 1.0);
    float rampIn = smoothstep(0.0, 0.08, age);
    vAlpha = rampIn * fadeOut * fadeOut * (0.28 + 0.4 * aIsFireball);
    // 电离余迹偏翠绿（O I 557.7 nm 余辉口径），微混所属雨基色
    vec3 base = mix(vec3(0.62, 0.76, 1.0), vec3(1.0, 0.68, 0.32), uPhenomenon);
    vColor = mix(vec3(0.5, 0.9, 0.68), base, 0.3);
    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    gl_PointSize = clamp((2.2 + 2.4 * aIsFireball) * (uScale / -mvPosition.z), 0.0, 14.0);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const AFTERGLOW_FRAGMENT_SHADER = /* glsl */ `
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    if (vAlpha <= 0.0) discard;
    vec2 c = gl_PointCoord - vec2(0.5);
    float d2 = dot(c, c);
    if (d2 > 0.25) discard;
    float soft = 1.0 - smoothstep(0.02, 0.25, d2);
    gl_FragColor = vec4(vColor * vAlpha * soft, vAlpha * soft);
  }
`;

interface AfterglowAssets {
  geometry: THREE.BufferGeometry;
  material: THREE.ShaderMaterial;
}

/**
 * 一次性烘焙余迹粒子 attribute（契约 C2.1 路径）：绑定槽位 = M1
 * selectAfterglowSlots；粒子沿母路径按 aPathT 均布（带抖动），沉积点位移
 * aDispKm 用 evalCubic CPU 预求值（shader 免多项式）。
 */
function buildAfterglowAssets(slots: readonly MeteorSlot[]): AfterglowAssets {
  const bound = selectAfterglowSlots(slots, AFTERGLOW_MAX_SLOTS);
  const perSlot = Math.max(4, Math.floor(AFTERGLOW_PARTICLE_BUDGET / Math.max(bound.length, 1)));
  const n = bound.length * perSlot;
  const positions = new Float32Array(n * 3);
  const seeds = new Float32Array(n);
  const gateRanks = new Float32Array(n);
  const fireballRanks = new Float32Array(n);
  const isFireballs = new Float32Array(n);
  const durations = new Float32Array(n);
  const fadeDurs = new Float32Array(n);
  const depositTimes = new Float32Array(n);
  const dispKms = new Float32Array(n);
  const noiseSeeds = new Float32Array(n);
  const slotIndices = new Float32Array(n);
  const startPositions = new Float32Array(n * 3);

  const rand = createSeededRandom(AFTERGLOW_SEED);
  const [fadeLo, fadeHi] = AFTERGLOW_FADE_ORDINARY_SEC;
  let v = 0;
  for (const slotIndex of bound) {
    const slot = slots[slotIndex];
    for (let p = 0; p < perSlot; p++) {
      const pathT = (p + rand()) / perSlot; // 沿路径均布（分层抖动）
      seeds[v] = slot.aSeed;
      gateRanks[v] = slot.aGateRank;
      fireballRanks[v] = slot.aFireballRank;
      isFireballs[v] = slot.isFireball ? 1 : 0;
      durations[v] = slot.lifetimeSec;
      fadeDurs[v] = slot.isFireball
        ? AFTERGLOW_FADE_FIREBALL_SEC
        : fadeLo + rand() * (fadeHi - fadeLo);
      depositTimes[v] = pathT * slot.lifetimeSec;
      dispKms[v] = evalCubic(slot.dispCoefs, pathT * slot.lifetimeSec);
      noiseSeeds[v] = rand();
      slotIndices[v] = slotIndex; // 母槽位下标（演示注入寻址，M3.5-3）
      startPositions[v * 3] = slot.startPos[0];
      startPositions[v * 3 + 1] = slot.startPos[1];
      startPositions[v * 3 + 2] = slot.startPos[2];
      v += 1;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
  geometry.setAttribute('aGateRank', new THREE.BufferAttribute(gateRanks, 1));
  geometry.setAttribute('aFireballRank', new THREE.BufferAttribute(fireballRanks, 1));
  geometry.setAttribute('aIsFireball', new THREE.BufferAttribute(isFireballs, 1));
  geometry.setAttribute('aDuration', new THREE.BufferAttribute(durations, 1));
  geometry.setAttribute('aFadeDur', new THREE.BufferAttribute(fadeDurs, 1));
  geometry.setAttribute('aDepositTime', new THREE.BufferAttribute(depositTimes, 1));
  geometry.setAttribute('aDispKm', new THREE.BufferAttribute(dispKms, 1));
  geometry.setAttribute('aNoiseSeed', new THREE.BufferAttribute(noiseSeeds, 1));
  geometry.setAttribute('aSlotIndex', new THREE.BufferAttribute(slotIndices, 1));
  geometry.setAttribute('aStartPos', new THREE.BufferAttribute(startPositions, 3));

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uCyclePeriod: { value: METEOR_CYCLE_PERIOD_SEC },
      uFluxFraction: { value: 0 },
      uFireballFraction: { value: 0 },
      // 演示注入（M3.5-3）：-1 = 无演示；与 MeteorField 同一 demoRef 事实源
      uDemoSlot: { value: -1 },
      uDemoStart: { value: 0 },
      uWindSpeed: { value: 0 },
      uVelocityDir: { value: new THREE.Vector3(0, -1, 0) },
      uPhenomenon: { value: 0 },
      uScale: { value: 400 },
    },
    vertexShader: AFTERGLOW_VERTEX_SHADER,
    fragmentShader: AFTERGLOW_FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  return { geometry, material };
}

interface AfterglowFieldProps {
  slots: readonly MeteorSlot[];
  refs: LabFrameRefs;
}

/** 余迹粒子系统（1 draw call；每帧只更新 uniforms） */
export function AfterglowField({ slots, refs }: AfterglowFieldProps): JSX.Element {
  const { geometry, material } = useMemo(() => buildAfterglowAssets(slots), [slots]);

  useEffect(() => {
    return () => {
      geometry.dispose();
      material.dispose();
    };
  }, [geometry, material]);

  useFrame((state) => {
    const s = refs.settingsRef.current;
    const shower = refs.showerRef.current;
    const t = refs.timeSecRef.current;
    const lst = localSiderealTime(shower.epochLst0Deg, s.hourOffset, t / 3600);
    const radiant = horizontalFromEquatorial(
      shower.radiantRaDeg,
      shower.radiantDecDeg,
      s.observerLat,
      lst
    );
    const dir = sceneDirFromAltAz(radiant);
    const hr = visibleHourlyRate(shower.zhr, shower.populationIndex, radiant.altRad, s.limitingMag);
    const u = material.uniforms;
    u.uTime.value = t;
    u.uCyclePeriod.value = shower.cyclePeriodSec;
    u.uFluxFraction.value = fluxFraction(hr, slots.length, shower.cyclePeriodSec);
    u.uFireballFraction.value = s.fireballRate;
    const demo = refs.demoRef.current;
    u.uDemoSlot.value = demo ? demo.slotIndex : -1;
    u.uDemoStart.value = demo ? demo.startTimeSec : 0;
    u.uWindSpeed.value = s.windSpeed;
    (u.uVelocityDir.value as THREE.Vector3).set(-dir[0], -dir[1], -dir[2]);
    // 色相同 MeteorField 口径：天鹅座κ橙黄，其余（英仙座/狮子座暴）蓝白
    u.uPhenomenon.value = shower.id === 'kappaCygnids' ? 1 : 0;
    // 像素尺度 + FOV 缩放补偿（触控板捏合缩放时与星穹同步等比，方案 A）
    u.uScale.value =
      state.gl.domElement.height *
      0.5 *
      fovPointScaleFactor((state.camera as THREE.PerspectiveCamera).fov);
  });

  return <points geometry={geometry} material={material} frustumCulled={false} />;
}
