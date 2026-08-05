'use client';


import type { JSX } from 'react';
import { useEffect, useState } from 'react';
import { tf } from '@/i18n';
import { useLocale } from '@/hooks/useI18n';
import { useSimulationStore } from '@/store';
import { mergerNotice } from '@/utils/galaxyMerger';
import { galacticYearProgress, sunGalacticPositionLy } from '@/utils/galaxy';
import { formatSceneScaleLabel } from '@/utils/scale';
import { solarCycleState, solarCycleStatusLine } from '@/utils/solarCycle';
import type { SimDateParts } from '@/utils/time';
import { formatSimDateParts } from '@/utils/time';
import { HudStatusPanel } from '@/components/UI/hud/HudStatusPanel';
import { EventNoticeColumn } from '@/components/UI/hud/EventNoticeColumn';
import { SolarFeatureCard } from '@/components/UI/hud/SolarFeatureCard';
import { BodyInfoPanel } from '@/components/UI/hud/BodyInfoPanel';

/**
 * HUD 信息（需求 3.5.2）：当前视角/尺度标尺、参考系、模拟时间、
 * 银河年进度（L3）、速率钳制提示、选中天体信息（统一目录）
 *
 * B3 i18n：壳层框架文案与事件通知（耀斑/CME/CME 抵达/超新星）经字典
 * 查找（hud.* 键组）。
 *
 * i18n 全站覆盖：科学注记常量（SN 频率/耀斑能量/地磁暴/合并结局与来源）
 * 经 `*_EN` 常量族 + pickLocalized 按 locale 取用；合并阶段名经
 * mergerNotice(locale)；信息面板值行经 getBodyInfoById(id, locale)
 * 双目录；黑子/日珥卡片与剖面分层经数据层 `*En` 字段；dataSource 署名
 * 同随 locale（含中文的署名补 `dataSourceEn`/`*_SOURCE_EN`，纯英文原样）。
 *
 * M3-2 拆分：悬浮区机械搬移至 hud/ 子组件（右上 HUD 状态区 /
 * 事件通知列 / 太阳特征卡 / 信息面板），桌面渲染结果不变；本组件
 * 保留低频（0.25s）刷新循环并向下透传计算结果。剖面分层卡
 * （SunLayerCard）左下角布局收口后迁至左侧列容器（LeftColumn）挂载。
 * isCompact 移动布局分流见各子组件文件头。
 */
export function HudInfo(): JSX.Element {
  const locale = useLocale();

  // 模拟时间/标尺以低频率刷新（0.25s），避免每帧渲染 React 组件。
  // 两段式（UI 布局优化）：主行通俗表示 + 大时间尺度专业历元副行
  const [simDate, setSimDate] = useState<SimDateParts>({ primary: '', epoch: null });
  const [scaleText, setScaleText] = useState('');
  const [galacticText, setGalacticText] = useState('');
  // S3 §4.4：太阳活动周期状态行（低频刷新，随快进演变）
  const [cycleLine, setCycleLine] = useState<{ label: string; value: string } | null>(null);
  // R2-11：银河系—仙女座合并演化科普卡片（L4 且模拟时间越过合并时刻时显示；
  // 时间回退（恢复预览前时间）后卡片随之消失——纯模拟时间驱动）
  const [mergerCard, setMergerCard] = useState<{ stageText: string; tauMyr: number } | null>(
    null,
  );
  useEffect(() => {
    const update = (): void => {
      const state = useSimulationStore.getState();
      setSimDate(formatSimDateParts(state.simDays, locale));
      // R2-11 合并演化卡片（仅宇宙视角；合并前为 null）
      setMergerCard(state.viewLevel === 'L4' ? mergerNotice(locale, state.simDays) : null);
      // 尺度标尺：相机距离按当前层级的尺度映射解释（AU / 光年 / Mpc）
      setScaleText(
        formatSceneScaleLabel(state.cameraDistanceUnits, state.continuousLevel, locale),
      );
      // 银河年进度 + 太阳当前银盘面高度（L3 显示，P6 §3.1.2 垂直振荡指示）
      if (state.viewLevel === 'L3') {
        const progress = galacticYearProgress(state.simDays);
        const heightLy = sunGalacticPositionLy(state.simDays).y;
        const heightSign = heightLy >= 0 ? '+' : '−';
        setGalacticText(
          tf(locale, 'hud.galacticYear', {
            orbit: progress.orbits + 1,
            percent: (progress.progress01 * 100).toFixed(1),
            deg: ((progress.orbits + progress.progress01) * 360).toFixed(0),
            sign: heightSign,
            height: Math.abs(heightLy).toFixed(0),
          }),
        );
      } else {
        setGalacticText('');
      }
      // 太阳活动周期状态行（第 N 周期 · 相位名 · 黑子相对数示意）
      setCycleLine(solarCycleStatusLine(solarCycleState(state.simDays), locale));
    };
    update();
    const id = setInterval(update, 250);
    return () => clearInterval(id);
  }, [locale]);

  return (
    <>
      <HudStatusPanel simDate={simDate} scaleText={scaleText} galacticText={galacticText} />
      <EventNoticeColumn mergerCard={mergerCard} />
      <SolarFeatureCard />
      <BodyInfoPanel cycleLine={cycleLine} />
    </>
  );
}
