'use client';

import type { JSX } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Grid } from '@react-three/drei';
import { Bloom, EffectComposer } from '@react-three/postprocessing';
import {
  clampParamValue,
  defaultParamValues,
  previewEntryForBody,
  registeredPreviewIds,
} from '@/utils/devPreview';
import {
  createFpsCounter,
  formatFpsLabel,
  formatMemoryMB,
  readUsedHeapBytes,
  recordFrame,
} from '@/utils/performance';
import { PreviewScene } from '@/components/dev/PreviewScene';

/**
 * 开发预览工位主界面（R4-1，IMPROVEMENT_REQUIREMENTS_4 §R4-1）
 *
 * 独立 Canvas（黑背景 + 可选参考网格），不挂载主场景任何组件
 * （无 Galaxy/Universe/SolarSystem/音频/store 主循环）。仅在 dev 模式经
 * `/dev/preview` 动态 import 加载，主应用 bundle 零增大。
 */

/** rAF 帧率/堆采样 HUD（组件自持 rAF，不依赖主循环） */
function usePerfHud(): { fps: string; heap: string } {
  const [fps, setFps] = useState('统计中…');
  const [heap, setHeap] = useState('不可用');
  useEffect(() => {
    let frameId = 0;
    let counter = createFpsCounter(performance.now());
    const loop = (nowMs: number): void => {
      const next = recordFrame(counter, nowMs);
      if (next.fps !== counter.fps) {
        setFps(formatFpsLabel(next.fps));
        setHeap(
          formatMemoryMB(
            readUsedHeapBytes(performance as { memory?: { usedJSHeapSize?: number } }),
          ),
        );
      }
      counter = next;
      frameId = requestAnimationFrame(loop);
    };
    frameId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frameId);
  }, []);
  return { fps, heap };
}

export interface DevPreviewHarnessProps {
  /** URL ?body=<id> */
  bodyId: string | null;
}

export function DevPreviewHarness({ bodyId }: DevPreviewHarnessProps): JSX.Element {
  const entry = useMemo(() => previewEntryForBody(bodyId), [bodyId]);
  const [values, setValues] = useState<Record<string, number>>(() =>
    defaultParamValues(entry),
  );
  const [bloom, setBloom] = useState(true);
  const [exposure, setExposure] = useState(1);
  const [showGrid, setShowGrid] = useState(true);

  // body 变化时重置滑杆
  useEffect(() => {
    setValues(defaultParamValues(entry));
  }, [entry]);

  const { fps, heap } = usePerfHud();

  if (!entry) {
    return (
      <div className="flex h-screen w-screen flex-col items-center justify-center gap-3 bg-black text-gray-300">
        <p className="text-lg">未注册的预览对象{bodyId ? `：${bodyId}` : '（缺少 ?body 参数）'}</p>
        <p className="text-sm text-gray-500">可用对象：</p>
        <ul className="text-sm text-sky-400">
          {registeredPreviewIds().map((id) => (
            <li key={id}>
              <a className="underline" href={`/dev/preview?body=${id}`}>
                {id}
              </a>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className="relative h-screen w-screen bg-black">
      <Canvas
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
        <PreviewScene entry={entry} values={values} exposure={exposure} />
        <OrbitControls enablePan minDistance={0.1} maxDistance={100} />
        {bloom && (
          <EffectComposer multisampling={4}>
            <Bloom intensity={0.6} luminanceThreshold={0.6} luminanceSmoothing={0.2} mipmapBlur />
          </EffectComposer>
        )}
      </Canvas>

      {/* 左上：性能 HUD */}
      <div className="pointer-events-none absolute left-4 top-4 select-none rounded-lg bg-black/60 px-3 py-2 text-xs text-gray-100 backdrop-blur">
        <div className="mb-1 font-semibold text-sky-300">{entry.title}</div>
        <div>帧率：{fps}</div>
        <div>JS 堆：{heap}</div>
        {entry.dataSource && (
          <div className="mt-1 max-w-64 text-gray-400">来源：{entry.dataSource}</div>
        )}
      </div>

      {/* 右侧：参数面板 */}
      <div className="absolute right-4 top-4 w-64 select-none space-y-3 rounded-lg bg-black/60 p-3 text-xs text-gray-100 backdrop-blur">
        <label className="flex items-center justify-between gap-2">
          <span>Bloom</span>
          <input type="checkbox" checked={bloom} onChange={(e) => setBloom(e.target.checked)} />
        </label>
        <label className="flex items-center justify-between gap-2">
          <span>参考网格</span>
          <input
            type="checkbox"
            checked={showGrid}
            onChange={(e) => setShowGrid(e.target.checked)}
          />
        </label>
        <div>
          <div className="mb-1 flex justify-between">
            <span>曝光</span>
            <span className="text-gray-400">{exposure.toFixed(2)}</span>
          </div>
          <input
            className="w-full"
            type="range"
            min={0.2}
            max={3}
            step={0.01}
            value={exposure}
            onChange={(e) => setExposure(Number(e.target.value))}
          />
        </div>
        <div className="border-t border-white/10 pt-2 text-gray-400">调试参数</div>
        {entry.params.map((p) => (
          <div key={p.key}>
            <div className="mb-1 flex justify-between">
              <span>{p.label}</span>
              <span className="text-gray-400">{(values[p.key] ?? p.default).toFixed(2)}</span>
            </div>
            <input
              className="w-full"
              type="range"
              min={p.min}
              max={p.max}
              step={p.step ?? (p.max - p.min) / 100}
              value={values[p.key] ?? p.default}
              onChange={(e) =>
                setValues((prev) => ({
                  ...prev,
                  [p.key]: clampParamValue(p, Number(e.target.value)),
                }))
              }
            />
          </div>
        ))}
      </div>
    </div>
  );
}

export default DevPreviewHarness;
