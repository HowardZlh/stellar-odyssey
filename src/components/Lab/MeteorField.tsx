'use client';

/**
 * 流星条痕系统（M3-1/M3-2，需求 §4.2/§4.3/§4.4 + 契约 C2）：
 * 全部槽位一个 THREE.Points（1 draw call）——条痕 K=48 顶点（M3.6-4①：
 * 24→48 + trailLag 头密尾疏）+ 火流星 3 组 × 6 子顶点碎片（非火流星槽位
 * 的碎片顶点 shader 内剔除）。
 *
 * M3.6-4② 近景细节（零新 draw call）：顶点求屏幕流向 varying（pos 与
 * pos+ε·uVelocityDir 的 NDC 差归一），片元三层径向结构（白炽核 → 雨色
 * 辉晕 → 暗红外缘）沿流向椭圆化拉伸 + NOISE_GLSL 时变闪烁。
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
 *
 * 演示扩展分支（M3.5-3，契约 C2 登记）：aSlotIndex（烘焙期一次写入）+
 * uDemoSlot/uDemoStart uniforms——命中槽位 elapsed 以 uDemoStart 起算并绕过
 * 流量/火流星双门控（时间轴外注入，DOM 层常显标注文案）；其余槽位与核心
 * 调度公式零改动。
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
  trailLag,
  visibleHourlyRate,
  type MeteorSlot,
} from '@/utils/meteorShower';
import { createSeededRandom } from '@/utils/random';
import { fovPointScaleFactor } from '@/utils/labGestures';
import { NOISE_GLSL } from '@/components/Lab/AfterglowField';
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
  attribute float aSlotIndex;
  attribute vec3 aStartPos;
  attribute vec3 aDispCoefs;
  attribute vec3 aIntenCoefs;
  attribute vec3 aFragDir;
  uniform float uTime;
  uniform float uCyclePeriod;
  uniform float uLagSpan;
  uniform float uFluxFraction;
  uniform float uFireballFraction;
  uniform float uDemoSlot;
  uniform float uDemoStart;
  uniform vec3 uVelocityDir;
  uniform float uPhenomenon;
  uniform float uScale;
  uniform float uAspect;
  varying float vIntensity;
  varying vec3 vColor;
  varying vec2 vFlowDir;
  varying float vSeed;

  void main() {
    float cycle   = fract(aSeed + uTime / uCyclePeriod);      // 循环相位（契约 C2）
    float elapsed = cycle * uCyclePeriod - aLag * uLagSpan;   // 条痕滞后采样（§4.3）
    bool gated = aGateRank >= uFluxFraction                   // 流量门控：独立属性（契约 C2）
      || (aIsFireball > 0.5 && aFireballRank >= uFireballFraction); // 火流星门控（§4.2）
    // 演示扩展分支（M3.5-3，契约 C2 登记）：时间轴外注入——命中槽位以
    // uDemoStart 起算 elapsed，绕过双门控；核心调度公式（上方）零改动
    bool isDemo = uDemoSlot >= 0.0 && abs(aSlotIndex - uDemoSlot) < 0.5;
    if (isDemo) {
      elapsed = (uTime - uDemoStart) - aLag * uLagSpan;
      gated = false;
    }
    bool culled = gated
      || elapsed < 0.0 || elapsed > aDuration
      || (aFragIndex > 0.5 && aIsFireball < 0.5);             // 非火流星槽位碎片剔除
    if (culled) {
      vIntensity = 0.0;
      vColor = vec3(0.0);
      vFlowDir = vec2(1.0, 0.0);
      vSeed = 0.0;
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
    // 屏幕流向（M3.6-4②）：投影 pos 与 pos+ε·uVelocityDir 的 NDC 差归一
    // （×uAspect 折算像素域方向），片元沿此向椭圆化点精灵为 streak
    vec4 clipB = projectionMatrix * modelViewMatrix * vec4(pos + uVelocityDir * 0.5, 1.0);
    vec2 ndcA = gl_Position.xy / max(gl_Position.w, 1e-6);
    vec2 ndcB = clipB.xy / max(clipB.w, 1e-6);
    vec2 flow = (ndcB - ndcA) * vec2(uAspect, 1.0);
    float flowLen = length(flow);
    vFlowDir = flowLen > 1e-6 ? flow / flowLen : vec2(1.0, 0.0);
    vSeed = aSeed;
  }
`;

/**
 * 片元三层径向结构 + 各向异性拉伸（M3.6-4②，零新 draw call）：
 * 点精灵局部坐标投影到屏幕流向基（along/across），along 轴除以拉伸因子
 * 把圆点椭圆化为沿运动方向的 streak；径向三层 = 白炽核（0.12）→ 雨色
 * 辉晕 → 暗红外缘；时变值噪声闪烁（NOISE_GLSL 复用，等离子体湍流观感）。
 */
const METEOR_FRAGMENT_SHADER = /* glsl */ `
  uniform float uTime;
  varying float vIntensity;
  varying vec3 vColor;
  varying vec2 vFlowDir;
  varying float vSeed;
  ${NOISE_GLSL}
  void main() {
    if (vIntensity <= 0.0) discard;
    vec2 c = gl_PointCoord - vec2(0.5);
    // 流向对齐坐标：along 沿运动方向压缩半径（= 视觉拉伸 ×1.8）
    vec2 perp = vec2(-vFlowDir.y, vFlowDir.x);
    float along = dot(c, vFlowDir) / 1.8;
    float across = dot(c, perp);
    // 归一椭圆半径（0 = 中心，1 = 外缘；长轴半径 0.5）
    float r = length(vec2(along, across)) * 2.0;
    if (r > 1.0) discard;
    // 三层径向结构：白炽核 → 雨色辉晕 → 暗红外缘
    float core = 1.0 - smoothstep(0.0, 0.12, r);
    float halo = (1.0 - smoothstep(0.08, 0.6, r)) * (1.0 - core);
    float rim = smoothstep(0.35, 0.72, r) * (1.0 - smoothstep(0.72, 1.0, r));
    vec3 col = vec3(1.0, 0.97, 0.9) * core * 1.8
      + vColor * halo
      + vec3(0.5, 0.1, 0.04) * rim * 0.55;
    // 时变闪烁（大气湍流/烧蚀脉动）：每槽位独立种子，±18% 幅度
    float flicker = 0.82 + 0.36 * valueNoise3(vec3(vSeed * 917.3, uTime * 22.0, r * 2.0));
    float alpha = 1.0 - smoothstep(0.0, 1.0, r);
    gl_FragColor = vec4(col * vIntensity * flicker * alpha, alpha);
  }
`;

interface MeteorAssets {
  geometry: THREE.BufferGeometry;
  material: THREE.ShaderMaterial;
}

/**
 * 一次性烘焙全部槽位 attribute（初始化/页签切换路径，契约 C2.1）：
 * 每槽位 = 条痕 48 顶点（trailLag 头密尾疏，M3.6-4①）+ 3 碎片组 × 6
 * 子顶点 = 66 顶点（200 槽位共 13,200，预算无压力）。
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
  const slotIndices = new Float32Array(n);
  const startPositions = new Float32Array(n * 3);
  const dispCoefs = new Float32Array(n * 3);
  const intenCoefs = new Float32Array(n * 3);
  const fragDirs = new Float32Array(n * 3);

  const rand = createSeededRandom(FRAGMENT_DIR_SEED);
  let v = 0;
  const writeVertex = (
    slot: MeteorSlot,
    slotIndex: number,
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
    slotIndices[v] = slotIndex; // 演示注入寻址（uDemoSlot，M3.5-3；烘焙期一次写入）
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

  for (let si = 0; si < slots.length; si++) {
    const slot = slots[si];
    // 主体条痕：aLag 0→1（头 → 尾），trailLag 头密尾疏非线性分布
    // （M3.6-4①：头部相邻间距 < 尾部，近观条痕连续无颗粒断点）
    for (let k = 0; k < METEOR_TRAIL_VERTICES; k++) {
      writeVertex(slot, si, trailLag(k, METEOR_TRAIL_VERTICES), 0, [0, 0, 0]);
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
        writeVertex(slot, si, (j / (METEOR_FRAGMENT_VERTICES - 1)) * FRAGMENT_LAG_MAX, g, dir);
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
  geometry.setAttribute('aSlotIndex', new THREE.BufferAttribute(slotIndices, 1));
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
      // 演示注入（M3.5-3）：-1 = 无演示；DOM 触发经 demoRef → useFrame 写入
      uDemoSlot: { value: -1 },
      uDemoStart: { value: 0 },
      uVelocityDir: { value: new THREE.Vector3(0, -1, 0) },
      uPhenomenon: { value: 0 },
      uScale: { value: 400 },
      uAspect: { value: 16 / 9 }, // 每帧覆写（屏幕流向的像素域折算，M3.6-4②）
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
    // 演示注入消费（M3.5-3：交互事件写 demoRef，此处仅 uniforms 透传）
    const demo = refs.demoRef.current;
    u.uDemoSlot.value = demo ? demo.slotIndex : -1;
    u.uDemoStart.value = demo ? demo.startTimeSec : 0;
    (u.uVelocityDir.value as THREE.Vector3).set(-dir[0], -dir[1], -dir[2]);
    u.uPhenomenon.value = shower.id === 'perseids' ? 0 : 1;
    // 像素尺度 + FOV 缩放补偿（触控板捏合缩放时与星穹同步等比，方案 A）
    u.uScale.value =
      state.gl.domElement.height *
      0.5 *
      fovPointScaleFactor((state.camera as THREE.PerspectiveCamera).fov);
    u.uAspect.value = (state.camera as THREE.PerspectiveCamera).aspect;
  });

  // attribute 为占位零点（真实位置由 shader 求得），必须关视锥剔除
  return <points geometry={geometry} material={material} frustumCulled={false} />;
}
