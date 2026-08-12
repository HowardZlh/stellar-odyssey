'use client';

/**
 * 盛夏双重流星雨实验室场景（M2 骨架阶段：真实星穹 + 地面剪影 + 环顾相机；
 * 流星条痕/余迹/控件面板随 M3、音频/移动端降级随 M4 递进）
 *
 * 比例尺登记（契约 C5）：1 场景单位 = 1 km（独立比例尺，与主场景
 * SCENE_UNITS_PER_AU 无关）；星穹半径 3000；相机漫游半径 0.1–1.5。
 * 轴向约定（契约 C5，防东西镜像）：+Y = 天顶、−Z = 正北、+X = 正东；
 * 方位角 Az 北起经东（N=0°，E=90°）。星穹投影与相机初始朝向一律经 M1
 * 纯函数（utils/meteorShower.ts 坐标族），组件内不内联球面公式（契约 C1
 * 只消费不改）。
 *
 * 星穹渲染（M2-4，1 draw call THREE.Points）：
 * - position attribute 存赤道系单位向量（equatorialUnitVector，初始化一次）；
 * - 顶点 shader 乘 uEquatorialToHorizontal（CPU 每帧 equatorialToHorizontalMatrix
 *   求得——本阶段硬编码英仙座历元 LST₀=353.5°（2026-08-13 02:00）+ 纬度 40°N，
 *   恒星时随真实流逝缓慢推进；timeScale/hourOffset 控件接入归 M3）；
 * - `aMag > uLimitingMag` 移出裁剪域剔除；B−V → bvToTeffK（Ballesteros 2012，
 *   R4-17 复用）→ blackbodyRGB 黑体色；星等 → 尺寸/亮度简单幂律（M3 目验再调）。
 * - 渲染循环零 attribute 上传、零 GC（契约 C2.1 红线同口径），仅更新 uniforms。
 *
 * 地面剪影登记：暗色圆盘置于 y = −1.7（视觉上与需求 y=0 等价——地平线角偏差
 * atan(1.7/3000) ≈ 0.03°）；下沉理由：环顾相机为 OrbitControls 反转轨道范式
 * （target 固定原点、相机绕至 target 下方仰望天顶，最低点 y = −1.5），圆盘若
 * 严格置于 y=0 会遮挡整个天空。圆盘同时遮蔽地平线以下的星（深度测试）。
 *
 * 临时 debug（M2-CP 目验用）：URL `?lm=<mag>` 覆写极限星等（默认 6.5 全量
 * 显示；调低即暗星批量消失检查点）。M3 接入正式 limitingMag 控件后收编。
 */

import type { JSX } from 'react';
import { useEffect, useMemo, useRef } from 'react';
import Link from 'next/link';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { Bloom, EffectComposer, ToneMapping } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';
import * as THREE from 'three';
import { useT } from '@/hooks/useI18n';
import { useYaleBrightStars } from '@/hooks/useYaleBrightStars';
import type { YaleBrightStar } from '@/utils/bakedData';
import { labEntryForId, LAB_PAGE_PATH } from '@/utils/lab';
import {
  CAMERA_RADIUS_MAX_UNITS,
  CAMERA_RADIUS_MIN_UNITS,
  DEFAULT_OBSERVER_LAT_DEG,
  PERSEIDS,
  STAR_DOME_RADIUS_UNITS,
  equatorialToHorizontalMatrix,
  equatorialUnitVector,
  localSiderealTime,
  sceneDirFromAltAz,
} from '@/utils/meteorShower';
import { bvToTeffK, srgbToLinear01 } from '@/utils/pleiadesCatalog';
import { blackbodyRGB } from '@/utils/starPhysics';

/** 度 → 弧度（单位换算，非球面公式） */
const DEG = Math.PI / 180;

/** 地面剪影圆盘 y（≈0 视觉等价，实现性下沉登记见文件头） */
const GROUND_DISK_Y_UNITS = -1.7;

/** 极限星等默认值（M2 全量显示；M3 控件默认 6.0 届时接管） */
const LIMITING_MAG_DEFAULT = 6.5;

/** 相机初始视线：北偏东 25°、高度角 40°（北极星/仙后座/北斗均在视野可及） */
const INITIAL_VIEW_DIR = sceneDirFromAltAz({ altRad: 40 * DEG, azRad: 25 * DEG });

/** 相机初始轨道半径（场景单位，钳制域 [0.1, 1.5] 内） */
const INITIAL_CAMERA_RADIUS = 1.2;

/** 初始相机位置：反转轨道范式——相机在视线反方向（经原点望向天空） */
const INITIAL_CAMERA_POSITION: [number, number, number] = [
  -INITIAL_VIEW_DIR[0] * INITIAL_CAMERA_RADIUS,
  -INITIAL_VIEW_DIR[1] * INITIAL_CAMERA_RADIUS,
  -INITIAL_VIEW_DIR[2] * INITIAL_CAMERA_RADIUS,
];

const STAR_DOME_VERTEX_SHADER = /* glsl */ `
  attribute float aMag;
  uniform mat3 uEqToHor;
  uniform float uLimitingMag;
  uniform float uSize;
  uniform float uScale;
  uniform float uDomeRadius;
  varying vec3 vColor;
  void main() {
    // 极限星等剔除：暗于阈值的星直接移出裁剪域（零 fragment 开销）
    if (aMag > uLimitingMag) {
      vColor = vec3(0.0);
      gl_PointSize = 0.0;
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }
    // 赤道系单位向量 → 地平系（CPU 每帧求矩阵，M1 equatorialToHorizontalMatrix）
    vec3 dir = uEqToHor * position;
    vec4 mvPosition = modelViewMatrix * vec4(dir * uDomeRadius, 1.0);
    // 星等 → 尺寸：简单幂律（mag 0 为 uSize 基准；M3 目验再调）
    float size = uSize * pow(1.32, -aMag);
    gl_PointSize = clamp(size * (uScale / -mvPosition.z), 1.0, 24.0);
    // 星等 → 亮度：半对数压缩 10^(−0.2·mag)，亮星微超 1 供 Bloom 拾取
    float brightness = clamp(pow(10.0, -0.2 * aMag), 0.03, 1.6);
    vColor = color * brightness;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const STAR_DOME_FRAGMENT_SHADER = /* glsl */ `
  varying vec3 vColor;
  void main() {
    // 柔边圆形星点（加性混合，Composer 末端统一 ACES）
    float d = length(gl_PointCoord - vec2(0.5));
    float alpha = 1.0 - smoothstep(0.2, 0.5, d);
    if (alpha < 0.01) discard;
    gl_FragColor = vec4(vColor * alpha, alpha);
  }
`;

interface StarDomeProps {
  stars: readonly YaleBrightStar[];
  /** 极限星等（暗于此值的星被剔除；M2 经 ?lm= 临时覆写） */
  limitingMag: number;
}

/**
 * 真实星穹（1 draw call）：8,404 颗耶鲁亮星，attribute 初始化一次，
 * 每帧仅更新旋转矩阵/像素尺度 uniforms。
 */
function StarDome({ stars, limitingMag }: StarDomeProps): JSX.Element {
  const { geometry, material } = useMemo(() => {
    const n = stars.length;
    const positions = new Float32Array(n * 3);
    const colors = new Float32Array(n * 3);
    const mags = new Float32Array(n);
    for (let i = 0; i < n; i += 1) {
      const s = stars[i];
      // 赤道系单位向量（xe = cosδ·cosα 约定，M1 equatorialUnitVector）
      const [xe, ye, ze] = equatorialUnitVector(s.ra, s.dec);
      positions[i * 3] = xe;
      positions[i * 3 + 1] = ye;
      positions[i * 3 + 2] = ze;
      // B−V → Teff（Ballesteros 2012）→ 黑体 RGB（R4-6 表复用，sRGB → 线性）
      const rgb = blackbodyRGB(bvToTeffK(s.bv));
      colors[i * 3] = srgbToLinear01(rgb.r);
      colors[i * 3 + 1] = srgbToLinear01(rgb.g);
      colors[i * 3 + 2] = srgbToLinear01(rgb.b);
      mags[i] = s.mag;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('aMag', new THREE.BufferAttribute(mags, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uEqToHor: { value: new THREE.Matrix3() },
        uLimitingMag: { value: LIMITING_MAG_DEFAULT },
        uSize: { value: 30 },
        uScale: { value: 400 },
        uDomeRadius: { value: STAR_DOME_RADIUS_UNITS },
      },
      vertexShader: STAR_DOME_VERTEX_SHADER,
      fragmentShader: STAR_DOME_FRAGMENT_SHADER,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    return { geometry: geo, material: mat };
  }, [stars]);

  useEffect(() => {
    return () => {
      geometry.dispose();
      material.dispose();
    };
  }, [geometry, material]);

  useEffect(() => {
    material.uniforms.uLimitingMag.value = limitingMag;
  }, [material, limitingMag]);

  useFrame((state) => {
    // 点大小随屏幕像素高度衰减（Starfield 同口径）
    material.uniforms.uScale.value = state.gl.domElement.height * 0.5;
    // 恒星时演化：M2 硬编码英仙座历元 + 纬度 40°N（timeScale/hourOffset 归 M3）
    const elapsedHours = state.clock.elapsedTime / 3600;
    const lst = localSiderealTime(PERSEIDS.epochLst0Deg, 0, elapsedHours);
    const m = equatorialToHorizontalMatrix(DEFAULT_OBSERVER_LAT_DEG, lst);
    (material.uniforms.uEqToHor.value as THREE.Matrix3).set(...m);
  });

  // 几何包围球是单位球（attribute 为单位向量，真实位置由 shader 放到半径
  // 3000 处），必须关 frustum culling 防止整批被误剔除
  return <points geometry={geometry} material={material} frustumCulled={false} />;
}

/** 地面剪影圆盘（暗色、不透明——遮蔽地平线以下的星，禁止地景细节工作量） */
function GroundDisk(): JSX.Element {
  return (
    <mesh rotation-x={-Math.PI / 2} position={[0, GROUND_DISK_Y_UNITS, 0]}>
      <circleGeometry args={[STAR_DOME_RADIUS_UNITS, 96]} />
      <meshBasicMaterial color="#04060a" side={THREE.DoubleSide} />
    </mesh>
  );
}

/** 从 URL 读取临时 debug 极限星等（?lm=，钳制 [1, 6.5]；无参数取默认） */
function readLimitingMagOverride(): number {
  if (typeof window === 'undefined') return LIMITING_MAG_DEFAULT;
  const raw = new URLSearchParams(window.location.search).get('lm');
  if (raw === null) return LIMITING_MAG_DEFAULT;
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed)) return LIMITING_MAG_DEFAULT;
  return Math.max(1, Math.min(6.5, parsed));
}

/**
 * 实验室场景主组件（`/lab/meteor-shower` 经 next/dynamic ssr:false 挂载）。
 * DOM 覆盖层（返回链接/加载态/操作提示）订阅 locale；Canvas 子树不订阅
 * （3D 场景 locale 纪律）。
 */
export function MeteorShowerLab(): JSX.Element {
  const tr = useT();
  const { stars, status } = useYaleBrightStars();
  const entry = labEntryForId('meteor-shower');
  // ?lm= 只在挂载时读取一次（目验时刷新生效即可）
  const limitingMagRef = useRef<number | null>(null);
  if (limitingMagRef.current === null) {
    limitingMagRef.current = readLimitingMagOverride();
  }

  return (
    <div className="relative h-screen w-screen bg-black">
      <Canvas
        flat
        gl={{ antialias: true }}
        camera={{
          position: INITIAL_CAMERA_POSITION,
          fov: 65,
          near: 0.05,
          far: STAR_DOME_RADIUS_UNITS * 2.5,
        }}
      >
        <color attach="background" args={['#000004']} />
        {stars && <StarDome stars={stars} limitingMag={limitingMagRef.current} />}
        <GroundDisk />
        {/* 环顾式仰视（§2）：target 固定原点、半径钳制 0.1–1.5、禁平移；
            polar 域 [π/2 − 0.35, π − 0.02]——视线俯角 ≤20°（不看穿地面）、
            仰角上限 ≈88°（避开天顶极点奇异） */}
        <OrbitControls
          target={[0, 0, 0]}
          minDistance={CAMERA_RADIUS_MIN_UNITS}
          maxDistance={CAMERA_RADIUS_MAX_UNITS}
          enablePan={false}
          minPolarAngle={Math.PI / 2 - 0.35}
          maxPolarAngle={Math.PI - 0.02}
          rotateSpeed={0.45}
          zoomSpeed={0.5}
          enableDamping
          dampingFactor={0.12}
        />
        {/* 后期：Bloom + ACES ToneMapping（DevPreviewHarness 同配置；
            M3 火流星 HDR 闪爆复用本管线） */}
        <EffectComposer multisampling={4}>
          <Bloom intensity={0.6} luminanceThreshold={0.6} luminanceSmoothing={0.2} mipmapBlur />
          <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
        </EffectComposer>
      </Canvas>

      {/* 左上：返回实验室 + 条目标题 */}
      <div className="absolute left-4 top-4 select-none rounded-lg bg-black/60 px-3 py-2 text-xs text-gray-100 backdrop-blur">
        <Link href={LAB_PAGE_PATH} className="text-space-accent hover:underline">
          ← {tr('lab.backToLab')}
        </Link>
        {entry && (
          <div className="mt-1 font-semibold text-sky-300">{tr(entry.titleKey)}</div>
        )}
      </div>

      {/* 底部：操作提示 */}
      <p className="pointer-events-none absolute bottom-3 left-1/2 max-w-[calc(100%-1.5rem)] -translate-x-1/2 truncate whitespace-nowrap rounded bg-black/40 px-3 py-1 text-[10px] text-gray-400 backdrop-blur">
        {tr('lab.hintLookAround')}
      </p>

      {/* 亮星星表加载态/失败态覆盖层（场景 chunk 加载提示在路由层） */}
      {status !== 'ready' && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <p className="rounded-lg bg-black/60 px-4 py-2 text-xs text-gray-300 backdrop-blur">
            {status === 'loading' ? tr('lab.loadingStars') : tr('lab.starsFailed')}
          </p>
        </div>
      )}
    </div>
  );
}

export default MeteorShowerLab;
