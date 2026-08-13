'use client';

/**
 * 近景条痕 ribbon（M3.8-4② S2）：近观（≲8 km）下点精灵条痕呈离散光点链
 * （48 顶点 × ~6–9 km 路径 ≈ 150 m 间距 + gl_PointSize 48 px 钳制无法
 * 衔接）——本组件以固定几何三角带补出连续条痕体，与远观点精灵加性共存
 * （远近衔接登记：ribbon 随观距渐显，远观点精灵观感零变化）。
 *
 * 契约 C2.1 零破（本组件立项前提）：几何 attribute 仅 aLag/aSide 烘焙
 * 一次；**顶点位置全在 vertex shader 由 uniforms 求出**（uStartPos/
 * uDispCoefs/uLifetime/uVelocityDir/uElapsed——跟随/演示槽位参数注入），
 * useFrame 只写 uniforms——渲染循环零 buffer 上传、零 CPU 顶点改写。
 *
 * 位移求值与 MeteorField 顶点 shader 严格同式（elapsed_i = uElapsed −
 * aLag×uLagSpan，disp = 三次多项式，pos = start + dir×disp）；宽度沿
 * cross(视线, 路径切向) 屏面展开（路径为直线 → 切向 = uVelocityDir），
 * 头宽尾窄 × 强度曲线渐隐。
 *
 * 渲染归属（登记）：常驻挂载 + 仅跟随/演示激活且相机—头部距离 <
 * RIBBON_NEAR_DISTANCE_KM 时 visible（uniform 淡入）；+1 draw call
 * （仅近观期间，非粒子系统，不占 §4.1 预算）。
 */

import type { JSX } from 'react';
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import {
  evalCubic,
  horizontalFromEquatorial,
  localSiderealTime,
  sceneDirFromAltAz,
  timeLapseLagSpanSec,
  trailLag,
  type MeteorSlot,
} from '@/utils/meteorShower';
import { RIBBON_NEAR_DISTANCE_KM } from '@/utils/labSky';
import type { LabFrameRefs } from '@/components/Lab/labTypes';

/** 三角带顶点对数（K 对 = 2K 顶点；aLag 走 trailLag 头密尾疏同源分布） */
const RIBBON_PAIRS = 32;

/** 头部半宽（km；近观 0.6 km 下张角 ~2.9°，与头部细节层核径衔接） */
const RIBBON_HEAD_HALF_WIDTH_KM = 0.03;

/** 尾部半宽（km；头宽尾窄锥形剖面） */
const RIBBON_TAIL_HALF_WIDTH_KM = 0.006;

/** 渐显窗（观距 < 0.6×阈值全显，阈值处全隐——与点精灵远近平滑衔接） */
const RIBBON_FADE_START_FRACTION = 0.6;

const RIBBON_VERTEX_SHADER = /* glsl */ `
  attribute float aLag;
  attribute float aSide;
  uniform vec3 uStartPos;
  uniform vec3 uDispCoefs;
  uniform float uLifetime;
  uniform vec3 uVelocityDir;
  uniform float uElapsed;
  uniform float uLagSpan;
  uniform vec3 uIntenCoefs;
  varying float vSide;
  varying float vLag;
  varying float vInten;

  void main() {
    // 滞后采样（MeteorField 同式）；raw < 0（头未及）时顶点宽度收敛为 0
    float rawElapsed = uElapsed - aLag * uLagSpan;
    float e = clamp(rawElapsed, 0.0, uLifetime);
    float valid = smoothstep(0.0, 0.02, rawElapsed) * step(rawElapsed, uLifetime);
    // 位移 = RK4 拟合三次多项式（契约 C2 位移公式镜像，禁止匀速直线）
    float disp = dot(uDispCoefs, vec3(e, e * e, e * e * e));
    vec3 pos = uStartPos + uVelocityDir * disp;
    // 强度曲线（首尾抗锯齿叠乘，MeteorField 同式）
    float progress = e / uLifetime;
    float inten = max(dot(uIntenCoefs, vec3(e, e * e, e * e * e)), 0.0)
      * smoothstep(0.0, 0.04, progress) * smoothstep(1.0, 0.97, progress);
    // 屏面展宽：cross(视线, 路径切向)——路径为直线，切向 = uVelocityDir
    vec3 view = normalize(cameraPosition - pos);
    vec3 widthDir = cross(view, uVelocityDir);
    float wLen = length(widthDir);
    widthDir = wLen > 1e-5 ? widthDir / wLen : vec3(0.0, 1.0, 0.0);
    // 头宽尾窄 × 强度调制 × 有效性收敛
    float halfW = mix(${RIBBON_HEAD_HALF_WIDTH_KM.toFixed(4)}, ${RIBBON_TAIL_HALF_WIDTH_KM.toFixed(4)}, aLag)
      * clamp(inten, 0.35, 1.6) * valid;
    pos += widthDir * aSide * halfW;
    vSide = aSide;
    vLag = aLag;
    vInten = inten * valid;
    gl_Position = projectionMatrix * viewMatrix * vec4(pos, 1.0);
  }
`;

const RIBBON_FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uColor;
  uniform float uIsFireball;
  uniform float uFade;
  varying float vSide;
  varying float vLag;
  varying float vInten;

  void main() {
    if (vInten <= 0.0) discard;
    // 横向柔边（vSide 插值 −1→+1，中线 0 最亮）+ 沿痕渐隐（头亮尾暗）
    float across = 1.0 - vSide * vSide;
    float alongFade = pow(1.0 - vLag, 1.3);
    // 头部偏白炽、尾部收敛雨色；火流星混镁绿（MeteorField 同口径）
    vec3 base = mix(uColor, vec3(0.25, 0.95, 0.4), uIsFireball * 0.4);
    vec3 col = mix(vec3(1.0, 0.97, 0.92), base, clamp(vLag * 2.2, 0.0, 1.0));
    float a = across * across * alongFade * clamp(vInten, 0.0, 1.5) * uFade;
    if (a < 0.005) discard;
    gl_FragColor = vec4(col * a, a);
  }
`;

interface MeteorTrailRibbonProps {
  slots: readonly MeteorSlot[];
  refs: LabFrameRefs;
}

/** 近景条痕三角带（单 mesh；attribute 烘焙一次，每帧只写 uniforms） */
export function MeteorTrailRibbon({ slots, refs }: MeteorTrailRibbonProps): JSX.Element {
  const meshRef = useRef<THREE.Mesh>(null);

  const geometry = useMemo(() => {
    const n = RIBBON_PAIRS * 2;
    const positions = new Float32Array(n * 3); // 占位（真实位置全在顶点 shader）
    const lags = new Float32Array(n);
    const sides = new Float32Array(n);
    for (let k = 0; k < RIBBON_PAIRS; k += 1) {
      const lag = trailLag(k, RIBBON_PAIRS); // 头密尾疏同源分布（M3.6-4①）
      lags[k * 2] = lag;
      lags[k * 2 + 1] = lag;
      sides[k * 2] = -1;
      sides[k * 2 + 1] = 1;
    }
    const indices = new Uint16Array((RIBBON_PAIRS - 1) * 6);
    for (let k = 0; k < RIBBON_PAIRS - 1; k += 1) {
      indices[k * 6] = k * 2;
      indices[k * 6 + 1] = k * 2 + 1;
      indices[k * 6 + 2] = k * 2 + 2;
      indices[k * 6 + 3] = k * 2 + 2;
      indices[k * 6 + 4] = k * 2 + 1;
      indices[k * 6 + 5] = k * 2 + 3;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aLag', new THREE.BufferAttribute(lags, 1));
    geo.setAttribute('aSide', new THREE.BufferAttribute(sides, 1));
    geo.setIndex(new THREE.BufferAttribute(indices, 1));
    return geo;
  }, []);

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uStartPos: { value: new THREE.Vector3() },
          uDispCoefs: { value: new THREE.Vector3() },
          uLifetime: { value: 1 },
          uVelocityDir: { value: new THREE.Vector3(0, -1, 0) },
          uElapsed: { value: 0 },
          uLagSpan: { value: 0.15 },
          uIntenCoefs: { value: new THREE.Vector3() },
          uColor: { value: new THREE.Color(0.62, 0.76, 1.0) },
          uIsFireball: { value: 0 },
          uFade: { value: 0 },
        },
        vertexShader: RIBBON_VERTEX_SHADER,
        fragmentShader: RIBBON_FRAGMENT_SHADER,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
    []
  );

  useEffect(() => {
    return () => {
      geometry.dispose();
      material.dispose();
    };
  }, [geometry, material]);

  // 帧临时对象（挂载期复用，渲染循环零 GC）
  const tmp = useMemo(() => ({ head: new THREE.Vector3() }), []);

  useFrame((state) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    // 仅跟随/演示激活（MeteorHeadDetail 同源判定，跟随优先）
    const active = refs.followRef.current ?? refs.demoRef.current;
    const slot = active ? (slots[active.slotIndex] as MeteorSlot | undefined) : undefined;
    if (!active || !slot) {
      mesh.visible = false;
      return;
    }
    const elapsed = refs.timeSecRef.current - active.startTimeSec;
    if (elapsed < 0 || elapsed > slot.lifetimeSec) {
      mesh.visible = false;
      return;
    }
    // 头部位置（CPU evalCubic 镜像）→ 观距渐显（< 8 km 淡入）
    const s = refs.settingsRef.current;
    const shower = refs.showerRef.current;
    const lst = localSiderealTime(shower.epochLst0Deg, s.hourOffset, refs.timeSecRef.current / 3600);
    const radiant = horizontalFromEquatorial(
      shower.radiantRaDeg,
      shower.radiantDecDeg,
      s.observerLat,
      lst
    );
    const dir = sceneDirFromAltAz(radiant);
    const disp = evalCubic(slot.dispCoefs, elapsed);
    tmp.head.set(
      slot.startPos[0] - dir[0] * disp,
      slot.startPos[1] - dir[1] * disp,
      slot.startPos[2] - dir[2] * disp
    );
    const distKm = state.camera.position.distanceTo(tmp.head);
    const fadeStart = RIBBON_NEAR_DISTANCE_KM * RIBBON_FADE_START_FRACTION;
    const k = Math.min(
      1,
      Math.max(0, (RIBBON_NEAR_DISTANCE_KM - distKm) / (RIBBON_NEAR_DISTANCE_KM - fadeStart))
    );
    const fade = k * k * (3 - 2 * k); // smoothstep 淡入
    if (fade <= 0.001) {
      mesh.visible = false;
      return;
    }
    const u = material.uniforms;
    (u.uStartPos.value as THREE.Vector3).set(slot.startPos[0], slot.startPos[1], slot.startPos[2]);
    (u.uDispCoefs.value as THREE.Vector3).set(
      slot.dispCoefs[0],
      slot.dispCoefs[1],
      slot.dispCoefs[2]
    );
    u.uLifetime.value = slot.lifetimeSec;
    (u.uVelocityDir.value as THREE.Vector3).set(-dir[0], -dir[1], -dir[2]);
    u.uElapsed.value = elapsed;
    // 条痕跨度与点精灵严格同源（timeLapseLagSpanSec——远近衔接一致）
    u.uLagSpan.value = timeLapseLagSpanSec(s.timeScale);
    (u.uIntenCoefs.value as THREE.Vector3).set(
      slot.intenCoefs[0],
      slot.intenCoefs[1],
      slot.intenCoefs[2]
    );
    // 色相同 MeteorField 口径：天鹅座κ橙黄，其余（英仙座/狮子座暴）蓝白
    const warm = shower.id === 'kappaCygnids';
    (u.uColor.value as THREE.Color).setRGB(warm ? 1.0 : 0.62, warm ? 0.68 : 0.76, warm ? 0.32 : 1.0);
    u.uIsFireball.value = slot.isFireball ? 1 : 0;
    u.uFade.value = fade;
    mesh.visible = true;
  });

  return (
    <mesh
      ref={meshRef}
      geometry={geometry}
      material={material}
      visible={false}
      frustumCulled={false}
    />
  );
}
