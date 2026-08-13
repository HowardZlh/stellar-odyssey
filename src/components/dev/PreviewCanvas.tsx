'use client';

import type { JSX, RefObject } from 'react';
import { useEffect, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, Grid } from '@react-three/drei';
import { Bloom, EffectComposer, ToneMapping } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';
import {
  previewMinCameraDistance,
  type PreviewEntry,
} from '@/utils/devPreview';
import {
  createFpsCounter,
  readUsedHeapBytes,
  recordFrame,
} from '@/utils/performance';
import { PreviewScene } from '@/components/dev/PreviewScene';
import { ClusterLensingPass } from '@/components/Scene/ClusterLensingEffect';

/**
 * 预览 Canvas 共享层（O1 自 DevPreviewHarness 抽出，渲染配置零变化）
 *
 * dev 工位（/dev/preview）与天体观察站（/lab/observatory）共用：独立
 * Canvas（黑背景 + 可选参考网格）+ PreviewScene 分发 + OrbitControls +
 * 常驻 EffectComposer（透镜 Effect → Bloom → ACES ToneMapping 管线次序
 * 不变）。两侧仅 DOM 覆盖层（HUD/参数面板）不同——dev 侧硬编码中文、
 * 观察站侧 i18n 字典。
 */

/** R4-23 预览透镜强度：常量 1（强度滑杆经持有者 visible01 生效） */
const LENS_STRENGTH_FULL = (): number => 1;

/** 预设视角状态（点击按钮后把相机沿视线移到目标距离；nonce 保证可重复触发） */
export interface CameraPreset {
  distance: number;
  nonce: number;
}

/**
 * 预设视角应用器（R5-4）：点击预设按钮后把相机沿当前视线方向移到目标
 * 距离（OrbitControls target 恒为原点；无 damping，外部写位置即生效）
 */
function CameraDistancePreset({ preset }: { preset: CameraPreset | null }): null {
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    if (!preset) return;
    const len = camera.position.length();
    if (len < 1e-6) {
      camera.position.set(0, 0, preset.distance);
    } else {
      camera.position.multiplyScalar(preset.distance / len);
    }
  }, [preset, camera]);
  return null;
}

/** rAF 帧率/堆采样（组件自持 rAF，不依赖主循环；格式化由消费侧按 locale 完成） */
export function usePerfSample(): { fps: number | null; heapBytes: number | undefined } {
  const [sample, setSample] = useState<{
    fps: number | null;
    heapBytes: number | undefined;
  }>({ fps: null, heapBytes: undefined });
  useEffect(() => {
    let frameId = 0;
    let counter = createFpsCounter(performance.now());
    const loop = (nowMs: number): void => {
      const next = recordFrame(counter, nowMs);
      if (next.fps !== counter.fps) {
        setSample({
          fps: next.fps,
          heapBytes: readUsedHeapBytes(
            performance as { memory?: { usedJSHeapSize?: number } },
          ),
        });
      }
      counter = next;
      frameId = requestAnimationFrame(loop);
    };
    frameId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frameId);
  }, []);
  return sample;
}

export interface PreviewCanvasProps {
  entry: PreviewEntry;
  /** 当前滑杆值映射（key → value） */
  values: Record<string, number>;
  /** 曝光（ToneMapping(ACES) 效果在帧缓冲级生效） */
  exposure: number;
  /** Bloom 开关 */
  bloom: boolean;
  /** 参考网格开关 */
  showGrid: boolean;
  /** 预设视角（null = 未触发） */
  preset: CameraPreset | null;
  /** HUD 虚拟时钟读数节点（每帧直写 textContent，不走 React state） */
  clockLabelRef?: RefObject<HTMLSpanElement | null>;
  /** HUD 体积质量档位读数节点（R4-4，仅体积类条目消费） */
  qualityLabelRef?: RefObject<HTMLSpanElement | null>;
}

export function PreviewCanvas({
  entry,
  values,
  exposure,
  bloom,
  showGrid,
  preset,
  clockLabelRef,
  qualityLabelRef,
}: PreviewCanvasProps): JSX.Element {
  return (
    <>
      {/* flat：关闭 renderer 内建 tone mapping，统一由 EffectComposer 末端的
          ToneMapping(ACES) 在帧缓冲级做映射——曝光对裸 ShaderMaterial（如
          StellarSurface）同样生效，且内建材质不会被双重映射 */}
      <Canvas
        flat
        gl={{ logarithmicDepthBuffer: true, antialias: true }}
        camera={{ position: [0, 0, entry.cameraDistance], near: 0.01, far: 1000 }}
      >
        <color attach="background" args={['#000000']} />
        <ambientLight intensity={0.4} />
        <pointLight position={[5, 5, 5]} intensity={1.2} />
        {showGrid && (
          <Grid
            args={[20, 20]}
            cellColor="#223"
            sectionColor="#335"
            fadeDistance={40}
            infiniteGrid
          />
        )}
        <PreviewScene
          entry={entry}
          values={values}
          exposure={exposure}
          clockLabelRef={clockLabelRef}
          qualityLabelRef={qualityLabelRef}
        />
        {/* minDistance 按条目相机距离推导（可被 minCameraDistance 覆写——
            R5-4 核心推近需允许更近），防止推进到天体内部（单面材质黑屏） */}
        <OrbitControls enablePan minDistance={previewMinCameraDistance(entry)} maxDistance={100} />
        <CameraDistancePreset preset={preset} />
        {/* 常驻 Composer：ToneMapping 必须始终在管线末端（曝光的实现载体），
            Bloom 按开关条件渲染并置于其前（作用于线性 HDR）；
            R4-23 透镜 Effect 置于最前（Bloom 采样已透镜化帧缓冲） */}
        {bloom ? (
          <EffectComposer multisampling={4}>
            {entry.componentKey === 'cluster-lensing-effect' ? (
              <ClusterLensingPass getStrength={LENS_STRENGTH_FULL} />
            ) : (
              <></>
            )}
            <Bloom intensity={0.6} luminanceThreshold={0.6} luminanceSmoothing={0.2} mipmapBlur />
            <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
          </EffectComposer>
        ) : (
          <EffectComposer multisampling={4}>
            {entry.componentKey === 'cluster-lensing-effect' ? (
              <ClusterLensingPass getStrength={LENS_STRENGTH_FULL} />
            ) : (
              <></>
            )}
            <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
          </EffectComposer>
        )}
      </Canvas>
    </>
  );
}

export default PreviewCanvas;
