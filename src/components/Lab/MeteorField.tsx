'use client';

/**
 * 流星条痕系统（M3-1/M3-2，需求 §4.2/§4.3/§4.4 + 契约 C2）：
 * 全部槽位一个 THREE.Points（1 draw call）——条痕 K=24 顶点 + 火流星
 * 3 组 × 6 子顶点碎片（非火流星槽位的碎片顶点 shader 内剔除）。
 *
 * GPU 确定性循环（契约 C2，公式与 M1 ignitedSlots/slotPhase 严格同式）：
 * - 循环相位 fract(aSeed + uTime/uCyclePeriod)
 * - 流量门控 aGateRank < uFluxFraction（与 aSeed 独立的随机属性）
 * - 火流星门控 aFireballRank < uFireballFraction（§4.2：身份烘焙期固定，
 *   门控只决定"该火流星槽位是否激活"，轨迹与质量永远匹配）
 * 渲染循环零 attribute 上传、零 buffer 重建（契约 C2.1：页签切换时由父级
 * 换 slots → useMemo 一次性重建，是唯一例外路径）。
 *
 * 物理消费（组件零内联物理，全部调 M1 纯函数）：
 * - 位移 = aDispCoefs 三次多项式（RK4 烘焙，含减速压缩——禁止匀速直线）
 * - 亮度 = aIntenCoefs 强度曲线（先增亮/峰值/骤灭；smoothstep 仅作首尾
 *   抗锯齿因子叠乘，§1.1 红线）
 * - 火流星末端闪爆 HDR ×15 喂 Bloom（§4.4）；镁绿 518 nm 混色
 * - uVelocityDir = −辐射点方向（全体平行 → 透视自然汇聚，§1.2）
 */

import type { JSX } from 'react';
import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import {
  FRAGMENT_BREAKUP_PROGRESS,
  METEOR_CYCLE_PERIOD_SEC,
  METEOR_FRAGMENT_GROUPS,
  METEOR_FRAGMENT_VERTICES,
  METEOR_LAG_SPAN_SEC,
  METEOR_TRAIL_VERTICES,
  fluxFraction,
  fragmentLateralMagnitudeKm,
  horizontalFromEquatorial,
  localSiderealTime,
  sceneDirFromAltAz,
  visibleHourlyRate,
  type MeteorSlot,
} from '@/utils/meteorShower';
import { createSeededRandom } from '@/utils/random';
import type { LabFrameRefs } from '@/components/Lab/labTypes';

/** 碎片 mini 条痕的 aLag 上限（主体条痕 aLag ∈ [0,1]，碎片更短） */
const FRAGMENT_LAG_MAX = 0.35;

/** aFragDir 烘焙种子（确定性，跨会话一致） */
const FRAGMENT_DIR_SEED = 0x4d33f0;

const METEOR_VERTEX_SHADER = /* glsl */ `
  attribute float aSeed;
  attribute float aGateRank;
  attribute float aFireballRank;
  attribute float aDuration;
  attribute float aIsFireball;
  attribute float aLag;
  attribute float aFragIndex;
  attribute vec3 aStartPos;
  attribute vec3 aDispCoefs;
  attribute vec3 aIntenCoefs;
  attribute vec3 aFragDir;
  uniform float uTime;
  uniform float uCyclePeriod;
  uniform float uLagSpan;
  uniform float uFluxFraction;
  uniform float uFireballFraction;
  uniform vec3 uVelocityDir;
  uniform float uPhenomenon;
  uniform float uScale;
  varying float vIntensity;
  varying vec3 vColor;

  void main() {
    float cycle   = fract(aSeed + uTime / uCyclePeriod);      // 循环相位（契约 C2）
    float elapsed = cycle * uCyclePeriod - aLag * uLagSpan;   // 条痕滞后采样（§4.3）
    bool culled = aGateRank >= uFluxFraction                  // 流量门控：独立属性（契约 C2）
      || elapsed < 0.0 || elapsed > aDuration
      || (aFragIndex > 0.5 && aIsFireball < 0.5)              // 非火流星槽位碎片剔除
      || (aIsFireball > 0.5 && aFireballRank >= uFireballFraction); // 火流星门控（§4.2）
    if (culled) {
      vIntensity = 0.0;
      vColor = vec3(0.0);
      gl_PointSize = 0.0;
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }
    float progress = elapsed / aDuration;
    // 位移 = RK4 拟合多项式（含减速压缩，禁止匀速直线）
    float disp = dot(aDispCoefs, vec3(elapsed, elapsed * elapsed, elapsed * elapsed * elapsed));
    vec3 pos = aStartPos + uVelocityDir * disp;               // 全体平行 → 透视汇聚辐射点
    // 火流星碎裂：progress>0.8 后碎片沿锥角发散（位移 ≤1 单位 = 1 km，§1.5）
    if (aFragIndex > 0.5 && progress > 0.8) {
      pos += aFragDir * ((progress - 0.8) / 0.2) * 1.0;
    }
    // 亮度 = 拟合强度曲线（smoothstep 仅首尾抗锯齿叠乘因子，禁止替代）
    float inten = max(dot(aIntenCoefs, vec3(elapsed, elapsed * elapsed, elapsed * elapsed * elapsed)), 0.0);
    vIntensity = inten * smoothstep(0.0, 0.04, progress) * smoothstep(1.0, 0.97, progress);
    // 火流星末端闪爆：HDR 过载喂 Bloom（§4.4）
    float burst = exp(-pow((progress - 0.91) / 0.015, 2.0)) * aIsFireball;
    vIntensity *= 1.0 + burst * 15.0;
    // 颜色：英仙座蓝白 / 天鹅座κ橙黄（uPhenomenon 为 float）；火流星混镁绿 518 nm
    vec3 base = mix(vec3(0.62, 0.76, 1.0), vec3(1.0, 0.68, 0.32), uPhenomenon);
    vColor = mix(base, vec3(0.1, 0.95, 0.3), aIsFireball * clamp(0.45 + 0.4 * burst, 0.0, 0.85));
    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    // 尺寸：头大尾小 × 强度 × 透视衰减（碎片略小）
    float head = mix(6.0, 1.5, aLag) * mix(1.0, 0.65, step(0.5, aFragIndex));
    gl_PointSize = clamp(head * clamp(vIntensity, 0.2, 3.0) * (uScale / -mvPosition.z), 0.0, 48.0);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const METEOR_FRAGMENT_SHADER = /* glsl */ `
  varying float vIntensity;
  varying vec3 vColor;
  void main() {
    if (vIntensity <= 0.0) discard;
    vec2 c = gl_PointCoord - vec2(0.5);
    float d2 = dot(c, c);
    if (d2 > 0.25) discard;
    // softstep 圆点 × 颜色 × 强度（允许 >1 HDR 值，Composer Bloom 拾取）
    float soft = 1.0 - smoothstep(0.02, 0.25, d2);
    gl_FragColor = vec4(vColor * vIntensity * soft, soft);
  }
`;

interface MeteorAssets {
  geometry: THREE.BufferGeometry;
  material: THREE.ShaderMaterial;
}

/**
 * 一次性烘焙全部槽位 attribute（初始化/页签切换路径，契约 C2.1）：
 * 每槽位 = 条痕 24 顶点 + 3 碎片组 × 6 子顶点 = 42 顶点。
 * 碎片方向 = 随机单位向量 × fragmentLateralMagnitudeKm（锥角半角 ≤2° 量级，
 * M1 纯函数），非火流星槽位同样消费随机数（确定性顺序）但顶点被 shader 剔除。
 */
function buildMeteorAssets(slots: readonly MeteorSlot[]): MeteorAssets {
  const vertsPerSlot = METEOR_TRAIL_VERTICES + METEOR_FRAGMENT_GROUPS * METEOR_FRAGMENT_VERTICES;
  const n = slots.length * vertsPerSlot;
  const positions = new Float32Array(n * 3);
  const seeds = new Float32Array(n);
  const gateRanks = new Float32Array(n);
  const fireballRanks = new Float32Array(n);
  const durations = new Float32Array(n);
  const isFireballs = new Float32Array(n);
  const lags = new Float32Array(n);
  const fragIndices = new Float32Array(n);
  const startPositions = new Float32Array(n * 3);
  const dispCoefs = new Float32Array(n * 3);
  const intenCoefs = new Float32Array(n * 3);
  const fragDirs = new Float32Array(n * 3);

  const rand = createSeededRandom(FRAGMENT_DIR_SEED);
  let v = 0;
  const writeVertex = (
    slot: MeteorSlot,
    lag: number,
    fragIndex: number,
    fragDir: readonly [number, number, number]
  ): void => {
    seeds[v] = slot.aSeed;
    gateRanks[v] = slot.aGateRank;
    fireballRanks[v] = slot.aFireballRank;
    durations[v] = slot.lifetimeSec;
    isFireballs[v] = slot.isFireball ? 1 : 0;
    lags[v] = lag;
    fragIndices[v] = fragIndex;
    startPositions[v * 3] = slot.startPos[0];
    startPositions[v * 3 + 1] = slot.startPos[1];
    startPositions[v * 3 + 2] = slot.startPos[2];
    dispCoefs[v * 3] = slot.dispCoefs[0];
    dispCoefs[v * 3 + 1] = slot.dispCoefs[1];
    dispCoefs[v * 3 + 2] = slot.dispCoefs[2];
    intenCoefs[v * 3] = slot.intenCoefs[0];
    intenCoefs[v * 3 + 1] = slot.intenCoefs[1];
    intenCoefs[v * 3 + 2] = slot.intenCoefs[2];
    fragDirs[v * 3] = fragDir[0];
    fragDirs[v * 3 + 1] = fragDir[1];
    fragDirs[v * 3 + 2] = fragDir[2];
    v += 1;
  };

  for (const slot of slots) {
    // 主体条痕：aLag 0→1（头 → 尾）
    for (let k = 0; k < METEOR_TRAIL_VERTICES; k++) {
      writeVertex(slot, k / (METEOR_TRAIL_VERTICES - 1), 0, [0, 0, 0]);
    }
    // 碎片组：每组一个独立锥角方向（球面均匀采样 × 横向量级）
    const fragMag = fragmentLateralMagnitudeKm(slot.dispCoefs, slot.lifetimeSec);
    for (let g = 1; g <= METEOR_FRAGMENT_GROUPS; g++) {
      const z = rand() * 2 - 1;
      const phi = rand() * Math.PI * 2;
      const s = Math.sqrt(Math.max(1 - z * z, 0));
      const dir: [number, number, number] = [
        s * Math.cos(phi) * fragMag,
        s * Math.sin(phi) * fragMag,
        z * fragMag,
      ];
      for (let j = 0; j < METEOR_FRAGMENT_VERTICES; j++) {
        writeVertex(slot, (j / (METEOR_FRAGMENT_VERTICES - 1)) * FRAGMENT_LAG_MAX, g, dir);
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  // position 仅占位（实际位置全在顶点 shader，Comet.tsx 范式）
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
  geometry.setAttribute('aGateRank', new THREE.BufferAttribute(gateRanks, 1));
  geometry.setAttribute('aFireballRank', new THREE.BufferAttribute(fireballRanks, 1));
  geometry.setAttribute('aDuration', new THREE.BufferAttribute(durations, 1));
  geometry.setAttribute('aIsFireball', new THREE.BufferAttribute(isFireballs, 1));
  geometry.setAttribute('aLag', new THREE.BufferAttribute(lags, 1));
  geometry.setAttribute('aFragIndex', new THREE.BufferAttribute(fragIndices, 1));
  geometry.setAttribute('aStartPos', new THREE.BufferAttribute(startPositions, 3));
  geometry.setAttribute('aDispCoefs', new THREE.BufferAttribute(dispCoefs, 3));
  geometry.setAttribute('aIntenCoefs', new THREE.BufferAttribute(intenCoefs, 3));
  geometry.setAttribute('aFragDir', new THREE.BufferAttribute(fragDirs, 3));

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      // 契约 C2 默认常量；每帧被 shower.cyclePeriodSec 覆写（量化差异登记）
      uCyclePeriod: { value: METEOR_CYCLE_PERIOD_SEC },
      uLagSpan: { value: METEOR_LAG_SPAN_SEC },
      uFluxFraction: { value: 0 },
      uFireballFraction: { value: 0 },
      uVelocityDir: { value: new THREE.Vector3(0, -1, 0) },
      uPhenomenon: { value: 0 },
      uScale: { value: 400 },
    },
    vertexShader: METEOR_VERTEX_SHADER,
    fragmentShader: METEOR_FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  return { geometry, material };
}

interface MeteorFieldProps {
  slots: readonly MeteorSlot[];
  refs: LabFrameRefs;
}

/** 流星条痕粒子系统（1 draw call；每帧只更新 uniforms） */
export function MeteorField({ slots, refs }: MeteorFieldProps): JSX.Element {
  const { geometry, material } = useMemo(() => buildMeteorAssets(slots), [slots]);

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
    // 流量链（每帧，全部 M1 纯函数）：LST → 辐射点高度 → HR → 门控分数
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
    (u.uVelocityDir.value as THREE.Vector3).set(-dir[0], -dir[1], -dir[2]);
    u.uPhenomenon.value = shower.id === 'perseids' ? 0 : 1;
    u.uScale.value = state.gl.domElement.height * 0.5;
  });

  // attribute 为占位零点（真实位置由 shader 求得），必须关视锥剔除
  return <points geometry={geometry} material={material} frustumCulled={false} />;
}
