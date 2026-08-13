'use client';

import type { JSX } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  clampParamValue,
  defaultParamValues,
  previewEntryForBody,
  previewHasVolumeLayer,
  registeredPreviewIds,
} from '@/utils/devPreview';
import { formatFpsLabel, formatMemoryMB } from '@/utils/performance';
import {
  PreviewCanvas,
  usePerfSample,
  type CameraPreset,
} from '@/components/dev/PreviewCanvas';

/**
 * 开发预览工位主界面（R4-1，IMPROVEMENT_REQUIREMENTS_4 §R4-1）
 *
 * 独立 Canvas（黑背景 + 可选参考网格），不挂载主场景任何组件
 * （无 Galaxy/Universe/SolarSystem/音频/store 主循环）。仅在 dev 模式经
 * `/dev/preview` 动态 import 加载，主应用 bundle 零增大。
 *
 * O1 重构登记：Canvas/后期管线与帧率采样抽至共享层
 * `components/dev/PreviewCanvas.tsx`（天体观察站复用，渲染配置零变化）；
 * 本文件保留 dev 专属 DOM 覆盖层（HUD/参数面板，硬编码中文不入 i18n）。
 */
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
  // R5-4 预设视角：nonce 递增保证同一预设可重复触发
  const [preset, setPreset] = useState<CameraPreset | null>(null);

  // body 变化时重置滑杆
  useEffect(() => {
    setValues(defaultParamValues(entry));
  }, [entry]);

  const perf = usePerfSample();
  // 虚拟时钟读数（时间流速滑杆的即时数值反馈）：由 PreviewScene 每帧直写
  // textContent，不走 React state（避免 60Hz 重渲染）
  const clockLabelRef = useRef<HTMLSpanElement | null>(null);
  // 体积质量档位读数（R4-4 HUD 指示，实现定夺登记：予以显示）：同上直写
  const qualityLabelRef = useRef<HTMLSpanElement | null>(null);

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
      <PreviewCanvas
        entry={entry}
        values={values}
        exposure={exposure}
        bloom={bloom}
        showGrid={showGrid}
        preset={preset}
        clockLabelRef={clockLabelRef}
        qualityLabelRef={qualityLabelRef}
      />

      {/* 左上：性能 HUD */}
      <div className="pointer-events-none absolute left-4 top-4 select-none rounded-lg bg-black/60 px-3 py-2 text-xs text-gray-100 backdrop-blur">
        <div className="mb-1 font-semibold text-sky-300">{entry.title}</div>
        <div>帧率：{formatFpsLabel(perf.fps)}</div>
        <div>JS 堆：{formatMemoryMB(perf.heapBytes)}</div>
        <div>
          虚拟时钟：<span ref={clockLabelRef}>0.0</span> s
        </div>
        {previewHasVolumeLayer(entry) && (
          <div>
            体积质量档：<span ref={qualityLabelRef}>—</span>
          </div>
        )}
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
        {entry.viewPresets && entry.viewPresets.length > 0 && (
          <div>
            <div className="border-t border-white/10 pt-2 text-gray-400">预设视角</div>
            <div className="mt-2 flex flex-col gap-1">
              {entry.viewPresets.map((v) => (
                <button
                  key={v.key}
                  type="button"
                  className="rounded bg-sky-900/60 px-2 py-1 text-left text-sky-200 hover:bg-sky-800/60"
                  onClick={() =>
                    setPreset((prev) => ({
                      distance: v.distanceUnits,
                      nonce: (prev?.nonce ?? 0) + 1,
                    }))
                  }
                >
                  {v.label}
                </button>
              ))}
            </div>
          </div>
        )}
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
