'use client';

import type { JSX } from 'react';
import { useEffect, useRef, useState } from 'react';
import {
  clampParamValue,
  defaultParamValues,
  previewHasVolumeLayer,
  type PreviewEntry,
} from '@/utils/devPreview';
import { fpsHealth, usedMemoryMB } from '@/utils/performance';
import { useT, useTf } from '@/hooks/useI18n';
import {
  PreviewCanvas,
  usePerfSample,
  type CameraPreset,
} from '@/components/dev/PreviewCanvas';
import { OBSERVATORY_PAGE_PATH } from '@/utils/lab';

/**
 * 天体观察站观察工位（O1，REQUIREMENTS_OBSERVATORY.md §2）
 *
 * dev 工位交互完整保留（需求决策）：性能 HUD（帧率/JS 堆/虚拟时钟/体积
 * 质量档）+ 调参滑杆 + 曝光/Bloom/参考网格 + 预设视角。与
 * DevPreviewHarness 的差异仅在 DOM 覆盖层：文案经 i18n 字典渲染
 * （条目 titleKey / 滑杆 labelKey，缺键回退 dev 中文原文防御），并增加
 * 「返回天体列表」导航。Canvas/后期管线复用共享层 PreviewCanvas
 * （渲染配置与 dev 工位零差异）。
 *
 * 移动端（<sm，LabControlPanel M4-2 同范式）：参数面板转底部抽屉
 * （标题栏常显 + ▾/▴ 开合，默认收起防遮挡场景），HUD 缩宽且隐藏来源
 * 长文案（画廊卡片已展示），触控目标 ≥44pt，safe-area 四向避让；
 * 场景触控（单指旋转/双指捏合缩放）由 OrbitControls 原生支持。
 *
 * 门控在上游 ObservatoryLab 完成（本组件挂载即已放行），不再判定。
 */
export interface ObservatoryHarnessProps {
  entry: PreviewEntry;
}

export function ObservatoryHarness({ entry }: ObservatoryHarnessProps): JSX.Element {
  const tr = useT();
  const trf = useTf();
  const [values, setValues] = useState<Record<string, number>>(() =>
    defaultParamValues(entry),
  );
  const [bloom, setBloom] = useState(true);
  const [exposure, setExposure] = useState(1);
  const [showGrid, setShowGrid] = useState(true);
  const [preset, setPreset] = useState<CameraPreset | null>(null);
  // 移动端底部抽屉展开态（<sm 生效；桌面右侧栏不受影响，LabControlPanel 同范式）
  const [drawerOpen, setDrawerOpen] = useState(false);

  // body 变化时重置滑杆（画廊往返为整页导航，此处为防御）
  useEffect(() => {
    setValues(defaultParamValues(entry));
  }, [entry]);

  const perf = usePerfSample();
  const clockLabelRef = useRef<HTMLSpanElement | null>(null);
  const qualityLabelRef = useRef<HTMLSpanElement | null>(null);

  // 帧率读数按 locale 格式化（perfMonitor.* 键组，与主应用性能监控同源阈值）
  const health = fpsHealth(perf.fps);
  const fpsLabel =
    health === 'measuring'
      ? tr('perfMonitor.measuring')
      : health === 'good'
        ? `${perf.fps} FPS`
        : trf(health === 'fair' ? 'perfMonitor.fpsFair' : 'perfMonitor.fpsLow', {
            fps: perf.fps ?? 0,
          });
  const heapMb = usedMemoryMB(perf.heapBytes);
  const heapLabel = heapMb === null ? tr('perfMonitor.unavailable') : `${heapMb} MB`;

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

      {/* 左上：返回导航 + 性能 HUD（safe-area 避让；移动端缩宽、来源长文案隐藏） */}
      <div className="absolute left-[max(1rem,env(safe-area-inset-left))] top-[max(1rem,env(safe-area-inset-top))] select-none space-y-2 max-sm:max-w-[70vw]">
        <a
          href={OBSERVATORY_PAGE_PATH}
          className="inline-flex min-h-11 items-center rounded-lg bg-black/60 px-3 text-xs text-space-accent backdrop-blur hover:underline"
        >
          ← {tr('lab.observatoryBackToGallery')}
        </a>
        <div className="pointer-events-none rounded-lg bg-black/60 px-3 py-2 text-xs text-gray-100 backdrop-blur">
          <div className="mb-1 font-semibold text-sky-300">
            {entry.titleKey ? tr(entry.titleKey) : entry.title}
          </div>
          <div>
            {tr('lab.obsHudFps')}：{fpsLabel}
          </div>
          <div>
            {tr('lab.obsHudHeap')}：{heapLabel}
          </div>
          <div>
            {tr('lab.obsHudClock')}：<span ref={clockLabelRef}>0.0</span> s
          </div>
          {previewHasVolumeLayer(entry) && (
            <div>
              {tr('lab.obsHudQuality')}：<span ref={qualityLabelRef}>—</span>
            </div>
          )}
          {entry.dataSource && (
            <div className="mt-1 max-w-64 text-gray-400 max-sm:hidden">
              {/* 数据来源署名（豁免惯例：保持原文，不入 i18n 字典）；
                  移动端隐藏（画廊卡片已展示，防长文案占满小屏） */}
              {tr('lab.obsHudSource')}：{entry.dataSource}
            </div>
          )}
        </div>
      </div>

      {/* 右侧：观察参数面板（<sm 转底部抽屉，LabControlPanel M4-2 同范式：
          标题栏常显 + ▾/▴ 开合钮，内容随抽屉折叠；桌面侧栏不受影响） */}
      <div className="hud-scroll absolute right-4 top-4 max-h-[calc(100vh-2rem)] w-64 max-w-[calc(100vw-2rem)] select-none overflow-y-auto rounded-lg bg-black/60 p-3 text-xs text-gray-100 backdrop-blur max-sm:bottom-0 max-sm:left-0 max-sm:right-0 max-sm:top-auto max-sm:max-h-[55vh] max-sm:w-full max-sm:max-w-none max-sm:rounded-b-none max-sm:pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-sky-300">{tr('lab.obsPanelParams')}</h2>
          <button
            type="button"
            onClick={() => setDrawerOpen((open) => !open)}
            aria-expanded={drawerOpen}
            aria-label={tr(drawerOpen ? 'lab.panelCollapseAria' : 'lab.panelExpandAria')}
            className="-my-2 flex h-11 w-11 items-center justify-center rounded text-sky-300 transition-colors hover:bg-white/10 sm:hidden"
          >
            {drawerOpen ? '▾' : '▴'}
          </button>
        </div>
        <div className={`mt-2 space-y-3 ${drawerOpen ? '' : 'max-sm:hidden'}`}>
          <label className="flex min-h-6 items-center justify-between gap-2 max-md:min-h-11">
            <span>{tr('lab.obsPanelBloom')}</span>
            <input type="checkbox" checked={bloom} onChange={(e) => setBloom(e.target.checked)} />
          </label>
          <label className="flex min-h-6 items-center justify-between gap-2 max-md:min-h-11">
            <span>{tr('lab.obsPanelGrid')}</span>
            <input
              type="checkbox"
              checked={showGrid}
              onChange={(e) => setShowGrid(e.target.checked)}
            />
          </label>
          <div>
            <div className="mb-1 flex justify-between">
              <span>{tr('lab.obsPanelExposure')}</span>
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
              <div className="border-t border-white/10 pt-2 text-gray-400">
                {tr('lab.obsPanelPresets')}
              </div>
              <div className="mt-2 flex flex-col gap-1">
                {entry.viewPresets.map((v) => (
                  <button
                    key={v.key}
                    type="button"
                    className="rounded bg-sky-900/60 px-2 py-1 text-left text-sky-200 hover:bg-sky-800/60 max-md:min-h-11"
                    onClick={() =>
                      setPreset((prev) => ({
                        distance: v.distanceUnits,
                        nonce: (prev?.nonce ?? 0) + 1,
                      }))
                    }
                  >
                    {v.labelKey ? tr(v.labelKey) : v.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="border-t border-white/10 pt-2 text-gray-400">
            {tr('lab.obsPanelParams')}
          </div>
          {entry.params.map((p) => (
            <div key={p.key}>
              <div className="mb-1 flex justify-between">
                <span>{p.labelKey ? tr(p.labelKey) : p.label}</span>
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
    </div>
  );
}

export default ObservatoryHarness;
