'use client';

import { useEffect, useState } from 'react';
import type { ViewLevel } from '@/types';
import { CAMERA_VIEWS } from '@/data/cameraViews';
import { getBodyInfoById } from '@/data/catalog';
import { useSimulationStore } from '@/store';
import { galacticYearProgress } from '@/utils/galaxy';
import { formatSceneScaleLabel } from '@/utils/scale';
import { formatSimDate } from '@/utils/time';

/** 各层级运动参考系说明（需求 3.1.3 参考系定义） */
const REFERENCE_FRAMES: Record<ViewLevel, string> = {
  L1: '参考系：日心系（行星/卫星运动）',
  L2: '参考系：日心系（黄道坐标）',
  L3: '参考系：银心系（太阳系绕银心）',
  L4: '参考系：本星系群质心系（本动以矢量指示）',
};

/**
 * HUD 信息（需求 3.5.2）：当前视角/尺度标尺、参考系、模拟时间、
 * 银河年进度（L3）、速率钳制提示、选中天体信息（统一目录）
 */
export function HudInfo(): JSX.Element {
  const viewLevel = useSimulationStore((s) => s.viewLevel);
  const selectedBodyId = useSimulationStore((s) => s.selectedBodyId);
  const selectBody = useSimulationStore((s) => s.selectBody);
  const rateClampNotice = useSimulationStore((s) => s.rateClampNotice);

  // 模拟时间/标尺以低频率刷新（0.25s），避免每帧渲染 React 组件
  const [simDateText, setSimDateText] = useState('');
  const [scaleText, setScaleText] = useState('');
  const [galacticText, setGalacticText] = useState('');
  useEffect(() => {
    const update = (): void => {
      const state = useSimulationStore.getState();
      setSimDateText(formatSimDate(state.simDays));
      // 尺度标尺：相机距离按当前层级的尺度映射解释（AU / 光年 / Mpc）
      setScaleText(formatSceneScaleLabel(state.cameraDistanceUnits, state.continuousLevel));
      // 银河年进度（L3 显示）
      if (state.viewLevel === 'L3') {
        const progress = galacticYearProgress(state.simDays);
        setGalacticText(
          `银河年进度：第 ${progress.orbits + 1} 圈 ${(progress.progress01 * 100).toFixed(1)}%（绕行 ${((progress.orbits + progress.progress01) * 360).toFixed(0)}°）`,
        );
      } else {
        setGalacticText('');
      }
    };
    update();
    const id = setInterval(update, 250);
    return () => clearInterval(id);
  }, []);

  const selected = selectedBodyId ? getBodyInfoById(selectedBodyId) : undefined;

  return (
    <>
      <div className="absolute right-4 top-4 rounded-lg bg-space-panel px-4 py-3 text-right text-xs backdrop-blur">
        <p className="text-sm font-medium text-space-accent">{CAMERA_VIEWS[viewLevel].nameZh}</p>
        <p className="mt-1 text-gray-300">模拟时间：{simDateText}</p>
        <p className="mt-1 text-gray-300">当前尺度：{scaleText}</p>
        <p className="mt-1 text-gray-500">{REFERENCE_FRAMES[viewLevel]}</p>
        {galacticText && <p className="mt-1 text-emerald-300/80">{galacticText}</p>}
        {rateClampNotice && (
          <p className="mt-1 text-amber-300/90">⚠ 快周期卫星运动已减速显示（防闪烁）</p>
        )}
      </div>

      {selected && (
        <div className="absolute bottom-4 right-4 w-72 rounded-lg bg-space-panel p-4 text-xs backdrop-blur">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-space-accent">
              {selected.nameZh}（{selected.name}）
            </h3>
            <button
              type="button"
              onClick={() => selectBody(null)}
              className="text-gray-400 hover:text-white"
              aria-label="关闭信息面板"
            >
              ✕
            </button>
          </div>
          <p className="mb-2 text-[11px] text-gray-400">{selected.typeZh}</p>
          <dl className="space-y-1 text-gray-300">
            {selected.lines.map((line) => (
              <div key={line.label} className="flex justify-between gap-2">
                <dt className="shrink-0">{line.label}</dt>
                <dd className="text-right">{line.value}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-2 border-t border-white/10 pt-2 text-[10px] text-gray-500">
            数据来源：{selected.dataSource}
          </p>
        </div>
      )}
    </>
  );
}
