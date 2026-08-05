'use client';

import type { JSX } from 'react';
import { pickLocalized } from '@/i18n';
import { useLocale, useT } from '@/hooks/useI18n';
import { useSimulationStore } from '@/store';

/**
 * S3 §4.5：黑子群/日珥点选科普卡片（含"可容纳 N 个地球"动态换算）。
 * M3-2 自 HudInfo 机械拆分，桌面渲染结果不变。
 *
 * M3 移动布局（isCompact）：并入底部卡区（标签栏上方通栏半屏卡），
 * 与剖面分层卡/信息面板互斥——本卡优先级最高（SunLayerCard/
 * BodyInfoPanel 在 compact 下让位，互斥规则登记于各组件头）。
 */
export function SolarFeatureCard(): JSX.Element | null {
  const tr = useT();
  const locale = useLocale();
  const isCompact = useSimulationStore((s) => s.isCompact);
  const selectedSolarFeature = useSimulationStore((s) => s.selectedSolarFeature);
  const setSelectedSolarFeature = useSimulationStore((s) => s.setSelectedSolarFeature);

  if (!selectedSolarFeature) return null;

  return (
    <div
      className={
        isCompact
          ? 'fixed inset-x-0 bottom-[calc(3rem+env(safe-area-inset-bottom))] z-10 max-h-[40dvh] select-text overflow-y-auto rounded-t-lg border-t border-orange-300/30 bg-space-panel p-4 text-sm backdrop-blur hud-scroll'
          : 'absolute bottom-4 left-1/2 w-80 -translate-x-1/2 select-text rounded-lg border border-orange-300/30 bg-space-panel p-4 text-xs backdrop-blur'
      }
    >
      {/* i18n：titleEn/descEn 数据驱动，按 locale 取用（缺失回退中文） */}
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-orange-300 max-md:text-base">
          {pickLocalized(locale, selectedSolarFeature.titleZh, selectedSolarFeature.titleEn)}
        </h3>
        <button
          type="button"
          onClick={() => setSelectedSolarFeature(null)}
          className="text-gray-400 hover:text-white max-md:-my-2.5 max-md:-mx-1.5 max-md:flex max-md:h-11 max-md:w-11 max-md:shrink-0 max-md:items-center max-md:justify-center"
          aria-label={tr('hud.featureCloseAria')}
        >
          ✕
        </button>
      </div>
      <p className="leading-5 text-gray-300 max-md:leading-6">
        {pickLocalized(locale, selectedSolarFeature.descZh, selectedSolarFeature.descEn)}
      </p>
      {selectedSolarFeature.earthCount !== null && (
        <p className="mt-2 rounded bg-orange-400/10 px-2 py-1 text-orange-200">
          🌍 {tr('hud.sunspotEarthsPre')}{' '}
          <span className="font-semibold">
            {selectedSolarFeature.earthCount.toLocaleString('zh-CN')}
          </span>{' '}
          {tr('hud.sunspotEarthsPost')}
        </p>
      )}
    </div>
  );
}
