'use client';

import { useEffect, useState } from 'react';
import type { ViewLevel } from '@/types';
import { CAMERA_VIEWS } from '@/data/cameraViews';
import { getBodyInfoById } from '@/data/catalog';
import { useSimulationStore } from '@/store';
import { galacticFrameHudLabel } from '@/utils/galacticFrame';
import { galacticYearProgress, sunGalacticPositionLy } from '@/utils/galaxy';
import { formatSceneScaleLabel } from '@/utils/scale';
import { SN_REAL_FREQUENCY_NOTE_ZH } from '@/utils/supernova';
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
  const followBodyId = useSimulationStore((s) => s.followBodyId);
  const setFollowBody = useSimulationStore((s) => s.setFollowBody);
  const requestFlyTo = useSimulationStore((s) => s.requestFlyTo);
  const activeSupernova = useSimulationStore((s) => s.activeSupernova);
  const supernovaNoticeVisible = useSimulationStore((s) => s.supernovaNoticeVisible);
  const dismissSupernovaNotice = useSimulationStore((s) => s.dismissSupernovaNotice);
  const galacticFrameMode = useSimulationStore((s) => s.galacticFrameMode);
  const toggleGalacticFrameMode = useSimulationStore((s) => s.toggleGalacticFrameMode);

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
      // 银河年进度 + 太阳当前银盘面高度（L3 显示，P6 §3.1.2 垂直振荡指示）
      if (state.viewLevel === 'L3') {
        const progress = galacticYearProgress(state.simDays);
        const heightLy = sunGalacticPositionLy(state.simDays).y;
        const heightSign = heightLy >= 0 ? '+' : '−';
        setGalacticText(
          `银河年进度：第 ${progress.orbits + 1} 圈 ${(progress.progress01 * 100).toFixed(1)}%（绕行 ${((progress.orbits + progress.progress01) * 360).toFixed(0)}°）｜银盘面高度 ${heightSign}${Math.abs(heightLy).toFixed(0)} ly`,
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
        <p className="mt-1 text-gray-500">
          {viewLevel === 'L3' ? galacticFrameHudLabel(galacticFrameMode) : REFERENCE_FRAMES[viewLevel]}
        </p>
        {galacticText && <p className="mt-1 text-emerald-300/80">{galacticText}</p>}
        {viewLevel === 'L3' && (
          <p className="mt-1">
            <button
              type="button"
              onClick={toggleGalacticFrameMode}
              className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] hover:bg-white/20"
            >
              🌀 参考系：{galacticFrameMode === 'galactic-center' ? '银心固定' : '跟随太阳系'}（G 切换）
            </button>
          </p>
        )}
        {rateClampNotice && (
          <p className="mt-1 text-amber-300/90">⚠ 快周期卫星运动已减速显示（防闪烁）</p>
        )}
        {followBodyId && (
          <p className="mt-1 text-cyan-300/90">
            🔒 跟随模式：{getBodyInfoById(followBodyId)?.nameZh ?? followBodyId}
            <button
              type="button"
              onClick={() => setFollowBody(null)}
              className="ml-2 rounded bg-white/10 px-1.5 py-0.5 text-[10px] hover:bg-white/20"
            >
              取消（Esc）
            </button>
          </p>
        )}
      </div>

      {/* 超新星爆发事件通知（需求 3.1.5：UI 提示 + "飞往观看"按钮） */}
      {supernovaNoticeVisible && activeSupernova && (
        <div className="absolute left-1/2 top-4 w-96 -translate-x-1/2 rounded-lg border border-amber-400/40 bg-space-panel p-3 text-xs backdrop-blur">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-amber-300">💥 超新星爆发！</p>
            <button
              type="button"
              onClick={dismissSupernovaNotice}
              className="text-gray-400 hover:text-white"
              aria-label="关闭超新星通知"
            >
              ✕
            </button>
          </div>
          <p className="mt-1 text-gray-300">
            银河系旋臂内探测到核坍缩超新星（前身星约{' '}
            {activeSupernova.progenitorMassSun.toFixed(0)} 倍太阳质量）
          </p>
          <p className="mt-1 text-[10px] text-gray-500">{SN_REAL_FREQUENCY_NOTE_ZH}</p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => {
                requestFlyTo(activeSupernova.id);
                dismissSupernovaNotice();
              }}
              className="rounded bg-amber-400/90 px-2 py-1 text-black hover:bg-amber-300"
            >
              🚀 飞往观看
            </button>
            <button
              type="button"
              onClick={() => {
                selectBody(activeSupernova.id);
              }}
              className="rounded bg-white/10 px-2 py-1 hover:bg-white/20"
            >
              查看详情
            </button>
          </div>
        </div>
      )}

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
          {/* 飞往 / 跟随（需求 3.2.3：点选后可飞往，可锁定任意天体跟随） */}
          <div className="mt-2 flex gap-2 border-t border-white/10 pt-2">
            <button
              type="button"
              onClick={() => requestFlyTo(selected.id)}
              className="rounded bg-space-accent/90 px-2 py-1 text-[11px] text-black hover:bg-space-accent"
            >
              🚀 飞往（F）
            </button>
            <button
              type="button"
              onClick={() =>
                setFollowBody(followBodyId === selected.id ? null : selected.id)
              }
              className={`rounded px-2 py-1 text-[11px] ${
                followBodyId === selected.id
                  ? 'bg-cyan-400/90 text-black hover:bg-cyan-300'
                  : 'bg-white/10 hover:bg-white/20'
              }`}
            >
              {followBodyId === selected.id ? '🔓 取消跟随' : '🔒 跟随'}
            </button>
          </div>
          <p className="mt-2 border-t border-white/10 pt-2 text-[10px] text-gray-500">
            数据来源：{selected.dataSource}
          </p>
        </div>
      )}
    </>
  );
}
