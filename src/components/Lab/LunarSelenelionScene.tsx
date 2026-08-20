'use client';

/**
 * selenelion 双地平线彩蛋场景（LE 迭代 M5-3，IMPROVEMENT_REQUIREMENTS_LUNAR_ECLIPSE
 * §M5-3 / §7.2 / B9 登记）
 *
 * **真实组合**（M1 评估结论 + M5 站心精算刷新，登记见 utils/lunarEclipseLab
 * M5-3 段）：l1992 北京，1992-12-10 晨（UT 12-09 23:10–23:45）——全食血月
 * 于西北沉落、太阳于东南升起；~23:21–23:29 UT 双体几何高度均在地平下，
 * 仅凭 ~0.6° 大气折射抬升双双可见（场景默认时刻 23:27 UT 即此高光状态）。
 *
 * B9 显式呈现：月/日均按「几何位置（虚圈标记）→ 折射抬升后的视位置（实体）」
 * 双态渲染，HUD 常显真实折射量 ≈0.6°（refractionLiftDeg 示意曲线登记）。
 * 本条目其余场景不建模折射（§1.6）——仅此彩蛋显式建模。
 *
 * 被食之月 = createLunarMoonMaterial 共享材质工厂（契约 C4「同一 GLSL 镜像
 * 换 uniform」第三消费点，禁第二套实现）；影盘偏移/双食分经
 * selenelionFrameState（北京观测者视差角）驱动——丹戎 L/浑浊度/曝光与主
 * 场景同一控件状态源（因果闭环跨场景一致）。全食中的月亮在晨光里极暗
 * （1992 L=0 的真实观感）——诚实呈现，曝光滑杆可辅助辨认（B2 口径）。
 *
 * 场景空间：地面视角契约（+Y 天顶、−Z 正北、+X 正东、观测者原点、反转
 * 轨道相机 + FOV 手势）；高山脊 = ridgeHeightProfile × 3（「高山脊 +
 * 双地平线」底稿 §7.2 口径——高处视野下的双地平线舞台）。晨光蒙影天光
 * 走 labSkyColors 全链（北京站心太阳高度驱动）。
 *
 * draw call：天光穹 1 + 地面盘 1 + 山脊 1 + 月盘 1 + 月虚圈 1 + 日盘 1 +
 * 日虚圈 1 = 7 ≤ 10；渲染循环零 buffer 更新（每帧只写 uniform/位姿/材质色）。
 * 独立小场景（主场景卸载换入，tSec/控件状态由父层保持）；Canvas 子树不
 * 订阅 locale（HUD/控件在 DOM 覆盖层）。
 */

import type { JSX } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import {
  Bloom,
  EffectComposer,
  ToneMapping,
} from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';
import * as THREE from 'three';
import { useT } from '@/hooks/useI18n';
import { useBitmapTexture } from '@/hooks/useBitmapTexture';
import { textureUrl } from '@/data/textures';
import {
  STAR_DOME_RADIUS_UNITS,
  sceneDirFromAltAz,
} from '@/utils/meteorShower';
import {
  LAB_FOV_DEFAULT_DEG,
  LAB_FOV_TELESCOPIC_MIN_DEG,
  LAB_POLAR_MAX_TELESCOPIC_RAD,
  LAB_POLAR_MIN_RAD,
} from '@/utils/labGestures';
import {
  CAMERA_RADIUS_MAX_UNITS,
  CAMERA_RADIUS_MIN_UNITS,
} from '@/utils/meteorShower';
import {
  RIDGE_DARKEN_FACTOR,
  RIDGE_RADIUS_KM,
  RIDGE_SEGMENTS,
  SKY_DOME_RADIUS_FACTOR,
  emptyLabSkyColors,
  labGroundColor,
  labSkyColors,
  ridgeHeightProfile,
} from '@/utils/labSky';
import { SKY_SHELL_RADIUS_KM, SUN_RADIUS_KM } from '@/utils/solarEclipse';
import { turbidityToDanjonL } from '@/utils/lunarEclipse';
import { formatUtcClock } from '@/utils/solarEclipseLab';
import {
  LUNAR_BASE_LIMITING_MAG,
  SELENELION_DEFAULT_SEC,
  SELENELION_END_SEC,
  SELENELION_REFRACTION_HORIZON_DEG,
  SELENELION_START_SEC,
  emptySelenelionFrameState,
  lunarExposureGain,
  selenelionFrameState,
  type LunarSeriesGroup,
} from '@/utils/lunarEclipseLab';
import { createLunarMoonMaterial } from '@/components/Lab/lunarMoonDiskMaterial';
import { TrackpadLookControls } from '@/components/Lab/TrackpadLookControls';
import { LabPanelDrawer } from '@/components/Lab/LabPanelDrawer';
import { BodyFollowRig } from '@/components/Lab/BodyFollowRig';

/** 度 → 弧度 */
const DEG = Math.PI / 180;

/** 地面剪影圆盘 y（主场景同款登记） */
const GROUND_DISK_Y_UNITS = -1.7;

/** 反转轨道相机初始半径（主场景同值） */
const INITIAL_CAMERA_RADIUS = 1.2;

/** 高山脊剖面种子 + 高度放大（§7.2「高山脊」；确定性烘焙） */
const SELENELION_RIDGE_SEED = 0x5e1e11;
const SELENELION_RIDGE_HEIGHT_SCALE = 3;

/** 月面贴图加载优先级（主场景同值） */
const MOON_TEXTURE_PRIORITY = 5;

/** 虚圈（几何位置标记）线宽比例与透明度（B9 显式呈现的视觉侧） */
const GHOST_RING_INNER = 0.88;
const GHOST_RING_ALPHA = 0.45;

/** 帧循环共享 refs（DOM 控件写入，Canvas 子树 useFrame 只读） */
interface SelenelionRefs {
  tSecRef: { current: number };
  ctrlRef: { current: { turbidity01: number; exposure01: number } };
  stateRef: { current: ReturnType<typeof emptySelenelionFrameState> };
}

/** 逐帧状态驱动器（首挂载子组件先行；tSec 单值可重建） */
function SelenelionDriver({
  refs,
  group,
}: {
  refs: SelenelionRefs;
  group: LunarSeriesGroup;
}): null {
  useFrame(() => {
    selenelionFrameState(
      group,
      refs.tSecRef.current,
      turbidityToDanjonL(refs.ctrlRef.current.turbidity01),
      refs.stateRef.current
    );
  });
  return null;
}

/** 快速对准（月/日一键换向；OrbitControls 经 key 重挂从新位姿接管） */
function SelenelionAim({
  refs,
  target,
  aimCount,
}: {
  refs: SelenelionRefs;
  target: 'moon' | 'sun';
  aimCount: number;
}): null {
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    const s = refs.stateRef.current;
    const dir = sceneDirFromAltAz(
      target === 'moon'
        ? { altRad: Math.max(s.moonAppAltDeg, 0.5) * DEG, azRad: s.frame.moonAzDeg * DEG }
        : { altRad: Math.max(s.sunAppAltDeg, 0.5) * DEG, azRad: s.sunAzDeg * DEG }
    );
    camera.position.set(
      -dir[0] * INITIAL_CAMERA_RADIUS,
      -dir[1] * INITIAL_CAMERA_RADIUS,
      -dir[2] * INITIAL_CAMERA_RADIUS
    );
    camera.lookAt(0, 0, 0);
  }, [camera, refs, target, aimCount]);
  return null;
}

// ---------------------------------------------------------------------------
// 天光/地景（labSky 全链：北京站心太阳高度驱动晨光蒙影）
// ---------------------------------------------------------------------------

const SEL_SKY_VERTEX_SHADER = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SEL_SKY_FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  varying vec3 vDir;
  void main() {
    vec3 dir = normalize(vDir);
    float band = pow(1.0 - abs(dir.y), 3.0);
    gl_FragColor = vec4(mix(uZenith, uHorizon, band), 1.0);
  }
`;

/** 晨光天光穹（LabSkyDome 同式；太阳高度 = 北京站心值） */
function SelenelionSkyDome({ refs }: { refs: SelenelionRefs }): JSX.Element {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uZenith: { value: new THREE.Color(0, 0, 0) },
          uHorizon: { value: new THREE.Color(0, 0, 0) },
        },
        vertexShader: SEL_SKY_VERTEX_SHADER,
        fragmentShader: SEL_SKY_FRAGMENT_SHADER,
        side: THREE.BackSide,
        depthWrite: false,
      }),
    []
  );
  const sky = useMemo(() => emptyLabSkyColors(), []);
  useEffect(() => {
    return () => {
      material.dispose();
    };
  }, [material]);

  useFrame(() => {
    const s = refs.stateRef.current;
    labSkyColors(LUNAR_BASE_LIMITING_MAG, s.frame.sunAltDeg * DEG, sky);
    (material.uniforms.uZenith.value as THREE.Color).setRGB(
      sky.zenith[0],
      sky.zenith[1],
      sky.zenith[2]
    );
    (material.uniforms.uHorizon.value as THREE.Color).setRGB(
      sky.horizon[0],
      sky.horizon[1],
      sky.horizon[2]
    );
  });

  return (
    <mesh material={material} frustumCulled={false}>
      <sphereGeometry
        args={[STAR_DOME_RADIUS_UNITS * SKY_DOME_RADIUS_FACTOR, 48, 24]}
      />
    </mesh>
  );
}

/** 地面盘 + 高山脊（色 = 晨光地平反照；山脊高度 ×3——双地平线舞台） */
function SelenelionGround({ refs }: { refs: SelenelionRefs }): JSX.Element {
  const groundRef = useRef<THREE.MeshBasicMaterial>(null);
  const ridgeRef = useRef<THREE.MeshBasicMaterial>(null);

  const geometry = useMemo(() => {
    const profile = ridgeHeightProfile(RIDGE_SEGMENTS, SELENELION_RIDGE_SEED);
    const positions = new Float32Array(RIDGE_SEGMENTS * 2 * 3);
    const indices = new Uint16Array(RIDGE_SEGMENTS * 6);
    for (let i = 0; i < RIDGE_SEGMENTS; i += 1) {
      const theta = (i / RIDGE_SEGMENTS) * Math.PI * 2;
      const x = Math.cos(theta) * RIDGE_RADIUS_KM;
      const z = Math.sin(theta) * RIDGE_RADIUS_KM;
      positions[i * 6] = x;
      positions[i * 6 + 1] = GROUND_DISK_Y_UNITS;
      positions[i * 6 + 2] = z;
      positions[i * 6 + 3] = x;
      positions[i * 6 + 4] =
        GROUND_DISK_Y_UNITS + profile[i] * SELENELION_RIDGE_HEIGHT_SCALE;
      positions[i * 6 + 5] = z;
      const next = (i + 1) % RIDGE_SEGMENTS;
      indices[i * 6] = i * 2;
      indices[i * 6 + 1] = i * 2 + 1;
      indices[i * 6 + 2] = next * 2;
      indices[i * 6 + 3] = next * 2;
      indices[i * 6 + 4] = i * 2 + 1;
      indices[i * 6 + 5] = next * 2 + 1;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setIndex(new THREE.BufferAttribute(indices, 1));
    return geo;
  }, []);
  useEffect(() => {
    return () => {
      geometry.dispose();
    };
  }, [geometry]);

  const tmp = useMemo(
    () => ({
      sky: emptyLabSkyColors(),
      ground: [0, 0, 0] as [number, number, number],
    }),
    []
  );

  useFrame(() => {
    const s = refs.stateRef.current;
    labSkyColors(LUNAR_BASE_LIMITING_MAG, s.frame.sunAltDeg * DEG, tmp.sky);
    labGroundColor(tmp.sky, tmp.ground);
    if (groundRef.current) {
      groundRef.current.color.setRGB(tmp.ground[0], tmp.ground[1], tmp.ground[2]);
    }
    if (ridgeRef.current) {
      ridgeRef.current.color.setRGB(
        tmp.ground[0] * RIDGE_DARKEN_FACTOR,
        tmp.ground[1] * RIDGE_DARKEN_FACTOR,
        tmp.ground[2] * RIDGE_DARKEN_FACTOR
      );
    }
  });

  return (
    <>
      <mesh rotation-x={-Math.PI / 2} position={[0, GROUND_DISK_Y_UNITS, 0]}>
        <circleGeometry args={[STAR_DOME_RADIUS_UNITS, 96]} />
        <meshBasicMaterial ref={groundRef} color="#0a0c10" side={THREE.DoubleSide} />
      </mesh>
      <mesh geometry={geometry}>
        <meshBasicMaterial ref={ridgeRef} color="#04050a" side={THREE.DoubleSide} />
      </mesh>
    </>
  );
}

// ---------------------------------------------------------------------------
// 被食之月 + 太阳（视位置实体 + 几何位置虚圈——B9 折射抬升显式呈现）
// ---------------------------------------------------------------------------

/** 天体位姿写入（天穹壳距离 × 方向；lookAt 原点——地面 quad 同约定） */
function placeOnShell(
  mesh: THREE.Mesh,
  altDeg: number,
  azDeg: number
): void {
  const dir = sceneDirFromAltAz({ altRad: altDeg * DEG, azRad: azDeg * DEG });
  mesh.position.set(
    dir[0] * SKY_SHELL_RADIUS_KM,
    dir[1] * SKY_SHELL_RADIUS_KM,
    dir[2] * SKY_SHELL_RADIUS_KM
  );
  mesh.lookAt(0, 0, 0);
}

/** 被食之月（契约 C4 共享材质工厂第三消费点） + 几何位置虚圈 */
function SelenelionMoon({ refs }: { refs: SelenelionRefs }): JSX.Element {
  const meshRef = useRef<THREE.Mesh>(null);
  const ghostRef = useRef<THREE.Mesh>(null);
  const moonTexture = useBitmapTexture(
    textureUrl('moon', 'surface'),
    MOON_TEXTURE_PRIORITY,
    true
  );
  const material = useMemo(() => createLunarMoonMaterial(), []);
  const ghostMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(0.55, 0.7, 1.0),
        transparent: true,
        opacity: GHOST_RING_ALPHA,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    []
  );
  useEffect(() => {
    material.uniforms.uMoonTex.value = moonTexture;
    material.uniforms.uHasTex.value = moonTexture ? 1 : 0;
  }, [material, moonTexture]);
  useEffect(() => {
    return () => {
      material.dispose();
      ghostMaterial.dispose();
    };
  }, [material, ghostMaterial]);

  const quadSize =
    2 * SKY_SHELL_RADIUS_KM * Math.tan((material.uniforms.uHalfAngle.value as number));

  useFrame(() => {
    const mesh = meshRef.current;
    const ghost = ghostRef.current;
    if (!mesh || !ghost) return;
    const s = refs.stateRef.current;
    const ctrl = refs.ctrlRef.current;
    // 实体 = 折射抬升后的视位置；虚圈 = 几何位置（B9 双态呈现）
    placeOnShell(mesh, s.moonAppAltDeg, s.frame.moonAzDeg);
    placeOnShell(ghost, s.frame.moonAltDeg, s.frame.moonAzDeg);
    const sdRad = s.frame.moonSdDeg * DEG;
    ghost.scale.setScalar(SKY_SHELL_RADIUS_KM * Math.tan(sdRad));
    const u = material.uniforms;
    u.uMoonR.value = sdRad;
    (u.uShadowOffset.value as THREE.Vector2).set(
      -s.frame.shadowOffEastRad,
      s.frame.shadowOffUpRad
    );
    u.uUmbraR.value = s.frame.umbraRadRad;
    u.uPenumbraR.value = s.frame.penumbraRadRad;
    u.uDanjonL.value = turbidityToDanjonL(ctrl.turbidity01);
    u.uExposure.value = lunarExposureGain(ctrl.exposure01);
  });

  return (
    <>
      <mesh ref={meshRef} material={material} frustumCulled={false} renderOrder={2}>
        <planeGeometry args={[quadSize, quadSize]} />
      </mesh>
      <mesh ref={ghostRef} material={ghostMaterial} frustumCulled={false} renderOrder={1}>
        <ringGeometry args={[GHOST_RING_INNER, 1, 48]} />
      </mesh>
    </>
  );
}

const SEL_SUN_VERTEX_SHADER = /* glsl */ `
  uniform float uHalfAngle;
  varying vec2 vAng;
  void main() {
    vAng = (uv - 0.5) * 2.0 * uHalfAngle;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/** 初升太阳盘（HDR 核心 + 辉光包络；地平新升的暖色低日） */
const SEL_SUN_FRAGMENT_SHADER = /* glsl */ `
  uniform float uSunR;
  varying vec2 vAng;
  void main() {
    float r = length(vAng);
    float aa = uSunR * 0.12;
    float disk = 1.0 - smoothstep(uSunR - aa, uSunR + aa, r);
    vec3 core = vec3(1.0, 0.72, 0.42) * 5.0 * disk;
    vec3 glow = vec3(1.0, 0.6, 0.3) * exp(-r / (uSunR * 2.6)) * 0.9;
    vec3 col = core + glow;
    float alpha = max(disk, exp(-r / (uSunR * 2.6)) * 0.9);
    if (alpha < 0.01) discard;
    gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
  }
`;

/** 太阳（视位置实体 + 几何位置虚圈） */
function SelenelionSun({ refs }: { refs: SelenelionRefs }): JSX.Element {
  const meshRef = useRef<THREE.Mesh>(null);
  const ghostRef = useRef<THREE.Mesh>(null);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uHalfAngle: { value: 1.2 * DEG },
          uSunR: { value: 0.27 * DEG },
        },
        vertexShader: SEL_SUN_VERTEX_SHADER,
        fragmentShader: SEL_SUN_FRAGMENT_SHADER,
        transparent: true,
        depthWrite: false,
        premultipliedAlpha: true,
      }),
    []
  );
  const ghostMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(1.0, 0.85, 0.55),
        transparent: true,
        opacity: GHOST_RING_ALPHA,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    []
  );
  useEffect(() => {
    return () => {
      material.dispose();
      ghostMaterial.dispose();
    };
  }, [material, ghostMaterial]);

  const quadSize = 2 * SKY_SHELL_RADIUS_KM * Math.tan(1.2 * DEG);

  useFrame(() => {
    const mesh = meshRef.current;
    const ghost = ghostRef.current;
    if (!mesh || !ghost) return;
    const s = refs.stateRef.current;
    placeOnShell(mesh, s.sunAppAltDeg, s.sunAzDeg);
    placeOnShell(ghost, s.frame.sunAltDeg, s.sunAzDeg);
    const sdRad = Math.asin(SUN_RADIUS_KM / s.frame.sunDistKm);
    material.uniforms.uSunR.value = sdRad;
    ghost.scale.setScalar(SKY_SHELL_RADIUS_KM * Math.tan(sdRad));
  });

  return (
    <>
      <mesh ref={meshRef} material={material} frustumCulled={false} renderOrder={2}>
        <planeGeometry args={[quadSize, quadSize]} />
      </mesh>
      <mesh ref={ghostRef} material={ghostMaterial} frustumCulled={false} renderOrder={1}>
        <ringGeometry args={[GHOST_RING_INNER, 1, 48]} />
      </mesh>
    </>
  );
}

// ---------------------------------------------------------------------------
// 场景主组件（DOM 覆盖层订阅 locale；Canvas 子树不订阅）
// ---------------------------------------------------------------------------

export interface LunarSelenelionSceneProps {
  /** l1992 事件星历序列组 */
  group: LunarSeriesGroup;
  /** 浑浊度（主场景控件状态透传——红环/血月/本场景同一状态源） */
  turbidity01: number;
  /** 曝光（主场景控件状态透传） */
  exposure01: number;
  /** Bloom 开关（labQualityParams 透传；reduced 档关） */
  bloomEnabled: boolean;
  /** 返回主场景 */
  onClose: () => void;
}

/** selenelion 彩蛋场景（l1992 页签「亲眼看看」入口挂载；主场景卸载换入） */
export function LunarSelenelionScene({
  group,
  turbidity01,
  exposure01,
  bloomEnabled,
  onClose,
}: LunarSelenelionSceneProps): JSX.Element {
  const tr = useT();
  const [tSec, setTSec] = useState(SELENELION_DEFAULT_SEC);
  const [aim, setAim] = useState<{ target: 'moon' | 'sun'; count: number }>({
    target: 'moon',
    count: 0,
  });

  const tSecRef = useRef(tSec);
  const ctrlRef = useRef({ turbidity01, exposure01 });
  ctrlRef.current = { turbidity01, exposure01 };
  const stateRef = useRef(emptySelenelionFrameState());
  const refs: SelenelionRefs = useMemo(
    () => ({ tSecRef, ctrlRef, stateRef }),
    []
  );

  // HUD（slider 值的纯函数——拖动即时重算；B9 折射量常显）
  const hud = useMemo(
    () => selenelionFrameState(group, tSec, turbidityToDanjonL(turbidity01)),
    [group, tSec, turbidity01]
  );

  // 初始机位：对准被食之月（西北地平）
  const initialCamera = useMemo(() => {
    const s = selenelionFrameState(
      group,
      SELENELION_DEFAULT_SEC,
      turbidityToDanjonL(turbidity01)
    );
    const dir = sceneDirFromAltAz({
      altRad: Math.max(s.moonAppAltDeg, 0.5) * DEG,
      azRad: s.frame.moonAzDeg * DEG,
    });
    return [
      -dir[0] * INITIAL_CAMERA_RADIUS,
      -dir[1] * INITIAL_CAMERA_RADIUS,
      -dir[2] * INITIAL_CAMERA_RADIUS,
    ] as [number, number, number];
    // 初始机位只取挂载时刻状态（此后由用户手势/对准按钮接管）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fmtAlt = (v: number): string => `${v >= 0 ? '+' : ''}${v.toFixed(2)}°`;

  return (
    <div className="relative h-screen w-screen bg-black">
      <Canvas
        flat
        gl={{ antialias: true }}
        dpr={[1, 2]}
        camera={{
          position: initialCamera,
          fov: LAB_FOV_DEFAULT_DEG,
          near: 0.05,
          far: STAR_DOME_RADIUS_UNITS * 2.5,
        }}
      >
        <color attach="background" args={['#000004']} />
        <SelenelionDriver refs={refs} group={group} />
        <SelenelionAim refs={refs} target={aim.target} aimCount={aim.count} />
        {/* P5 天体跟随（跟随当前「一键对准」选中的那个天体；35 分钟窗内
            日月各走 ~5.6°，望远档下不跟随即漂出画面）。复位令牌复用对准
            计数 aim.count——点「看被食之月/看初升太阳」即同时完成复位 */}
        <BodyFollowRig
          enabled
          recenterToken={aim.count}
          getBodyDir={(out) => {
            const st = refs.stateRef.current;
            const d = sceneDirFromAltAz(
              aim.target === 'moon'
                ? {
                    altRad: Math.max(st.moonAppAltDeg, 0.5) * DEG,
                    azRad: st.frame.moonAzDeg * DEG,
                  }
                : {
                    altRad: Math.max(st.sunAppAltDeg, 0.5) * DEG,
                    azRad: st.sunAzDeg * DEG,
                  }
            );
            out[0] = d[0];
            out[1] = d[1];
            out[2] = d[2];
            return out;
          }}
        />
        <SelenelionSkyDome refs={refs} />
        <SelenelionMoon refs={refs} />
        <SelenelionSun refs={refs} />
        <SelenelionGround refs={refs} />
        <OrbitControls
          key={`sel-${aim.target}-${aim.count}`}
          makeDefault
          target={[0, 0, 0]}
          minDistance={CAMERA_RADIUS_MIN_UNITS}
          maxDistance={CAMERA_RADIUS_MAX_UNITS}
          enablePan={false}
          enableZoom={false}
          minPolarAngle={LAB_POLAR_MIN_RAD}
          maxPolarAngle={LAB_POLAR_MAX_TELESCOPIC_RAD}
          rotateSpeed={0.45}
          enableDamping
          dampingFactor={0.12}
        />
        <TrackpadLookControls
          minFovDeg={LAB_FOV_TELESCOPIC_MIN_DEG}
          maxPolarRad={LAB_POLAR_MAX_TELESCOPIC_RAD}
          orientationManaged
        />
        {bloomEnabled ? (
          <EffectComposer multisampling={4}>
            <Bloom
              intensity={0.6}
              luminanceThreshold={0.6}
              luminanceSmoothing={0.2}
              mipmapBlur
            />
            <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
          </EffectComposer>
        ) : (
          <EffectComposer multisampling={0}>
            <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
          </EffectComposer>
        )}
      </Canvas>

      {/* 左上：返回 + 场景标题 */}
      <div className="absolute left-[max(1rem,env(safe-area-inset-left))] top-[max(1rem,env(safe-area-inset-top))] select-none rounded-lg bg-black/60 px-3 py-2 text-xs text-gray-100 backdrop-blur">
        <button
          type="button"
          onClick={onClose}
          className="text-space-accent hover:underline max-md:min-h-11"
        >
          {tr('lab.lunarSelenelionExit')}
        </button>
        <div className="mt-1 font-semibold text-amber-300 max-sm:hidden">
          {tr('lab.lunarSelenelionTitle')}
        </div>
      </div>

      {/* 右上：HUD + 折射说明（B9 用户可见侧）。<sm 转底部抽屉
          （M6-2 共享外壳；标题即场景名，桌面左上标题保持） */}
      <LabPanelDrawer
        title={tr('lab.lunarSelenelionTitle')}
        expandLabel={tr('lab.panelExpandAria')}
        collapseLabel={tr('lab.panelCollapseAria')}
        containerClassName="max-h-[calc(100vh-8rem)] max-sm:max-h-[55vh]"
        titleClassName="text-amber-300"
      >
        <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 rounded bg-sky-950/60 px-2 py-1 font-mono text-[11px] text-sky-200">
          <span className="text-gray-400">UTC</span>
          <span>{formatUtcClock(tSec)}</span>
          <span className="text-gray-400">{tr('lab.lunarSelenelionHudMoon')}</span>
          <span>
            {fmtAlt(hud.frame.moonAltDeg)} → {fmtAlt(hud.moonAppAltDeg)}
          </span>
          <span className="text-gray-400">{tr('lab.lunarSelenelionHudSun')}</span>
          <span>
            {fmtAlt(hud.frame.sunAltDeg)} → {fmtAlt(hud.sunAppAltDeg)}
          </span>
          <span className="text-gray-400">{tr('lab.lunarSelenelionHudLift')}</span>
          <span>≈{SELENELION_REFRACTION_HORIZON_DEG.toFixed(1)}°</span>
        </div>
        {/* 双地平线一键对准（≥44pt 触控目标） */}
        <div className="mt-2 flex gap-1">
          {(
            [
              ['moon', 'lab.lunarSelenelionAimMoon'],
              ['sun', 'lab.lunarSelenelionAimSun'],
            ] as const
          ).map(([target, key]) => (
            <button
              key={target}
              onClick={() =>
                setAim((prev) => ({ target, count: prev.count + 1 }))
              }
              className={`flex-1 rounded px-1 py-1 text-[10px] transition-colors max-md:min-h-11 ${
                aim.target === target
                  ? 'bg-amber-500/30 font-semibold text-amber-200'
                  : 'bg-white/5 text-gray-400 hover:bg-white/10'
              }`}
            >
              {tr(key)}
            </button>
          ))}
        </div>
        <p className="mt-2 rounded bg-amber-950/40 px-2 py-1.5 text-[10px] leading-relaxed text-amber-200/90">
          {tr('lab.lunarSelenelionRefractionCard')}
        </p>
      </LabPanelDrawer>

      {/* 底部：时间滑杆（35 分钟真实窗口）；<sm 抬高避让抽屉标题栏 + Home 条 */}
      <div className="absolute bottom-[max(0.75rem,env(safe-area-inset-bottom))] left-1/2 w-[min(34rem,calc(100vw-1.5rem))] -translate-x-1/2 rounded-lg bg-black/60 px-3 py-2 backdrop-blur max-sm:bottom-[calc(4.5rem+env(safe-area-inset-bottom))]">
        <input
          type="range"
          min={SELENELION_START_SEC}
          max={SELENELION_END_SEC}
          step={10}
          value={tSec}
          aria-label={tr('lab.lunarSelenelionTimeAria')}
          onChange={(e) => {
            const v = Number.parseInt(e.target.value, 10);
            setTSec(v);
            tSecRef.current = v;
          }}
          className="h-1.5 w-full cursor-pointer accent-amber-400"
        />
        <p className="mt-1 text-center text-[10px] text-gray-400">
          {tr('lab.lunarSelenelionHint')}
        </p>
      </div>
    </div>
  );
}
