'use client';

import { useEffect, useState } from 'react';
import { CAMERA_VIEWS } from '@/data/cameraViews';
import { getPlanetById } from '@/data/planets';
import { useSimulationStore } from '@/store';
import { formatSimDate } from '@/utils/time';

/**
 * HUD 信息（需求 3.5.2）：当前视角、模拟时间、选中天体信息
 */
export function HudInfo(): JSX.Element {
  const viewLevel = useSimulationStore((s) => s.viewLevel);
  const selectedBodyId = useSimulationStore((s) => s.selectedBodyId);
  const selectBody = useSimulationStore((s) => s.selectBody);

  // 模拟时间以低频率刷新（0.25s），避免每帧渲染 React 组件
  const [simDateText, setSimDateText] = useState('');
  useEffect(() => {
    const update = (): void => {
      setSimDateText(formatSimDate(useSimulationStore.getState().simDays));
    };
    update();
    const id = setInterval(update, 250);
    return () => clearInterval(id);
  }, []);

  const selected = selectedBodyId ? getPlanetById(selectedBodyId) : undefined;

  return (
    <>
      <div className="absolute right-4 top-4 rounded-lg bg-space-panel px-4 py-3 text-right text-xs backdrop-blur">
        <p className="text-sm font-medium text-space-accent">{CAMERA_VIEWS[viewLevel].nameZh}</p>
        <p className="mt-1 text-gray-300">模拟时间：{simDateText}</p>
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
          <dl className="space-y-1 text-gray-300">
            <div className="flex justify-between">
              <dt>半径</dt>
              <dd>{selected.radiusKm.toLocaleString('en-US')} km</dd>
            </div>
            <div className="flex justify-between">
              <dt>轨道半长轴</dt>
              <dd>{selected.orbit.semiMajorAxisAu.toFixed(3)} AU</dd>
            </div>
            <div className="flex justify-between">
              <dt>离心率</dt>
              <dd>{selected.orbit.eccentricity.toFixed(4)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>公转周期</dt>
              <dd>{selected.orbitalPeriodYears} 年</dd>
            </div>
            <div className="flex justify-between">
              <dt>自转周期</dt>
              <dd>
                {Math.abs(selected.rotation.siderealPeriodHours).toFixed(1)} 小时
                {selected.rotation.siderealPeriodHours < 0 ? '（逆向）' : ''}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt>轴倾角</dt>
              <dd>{selected.rotation.axialTiltDeg}°</dd>
            </div>
          </dl>
          <p className="mt-2 border-t border-white/10 pt-2 text-[10px] text-gray-500">
            数据来源：{selected.dataSource}
          </p>
        </div>
      )}
    </>
  );
}
