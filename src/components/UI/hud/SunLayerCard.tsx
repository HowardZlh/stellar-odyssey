'use client';

import type { JSX } from 'react';
import { pickLocalized } from '@/i18n';
import { useLocale, useT, useTf } from '@/hooks/useI18n';
import {
  SUN_STRUCTURE_DATA_SOURCE,
  SUN_STRUCTURE_DATA_SOURCE_EN,
  getSunLayerById,
} from '@/data/sunStructure';
import { useSimulationStore } from '@/store';

/**
 * 剖面分层科普卡片（S2 §4.1：各层可点选高亮并显示说明）。
 * M3-2 自 HudInfo 机械拆分，桌面渲染结果不变。
 *
 * M3 移动布局（isCompact）：并入底部卡区（与太阳特征卡同一插槽），
 * 互斥规则——太阳特征卡（SolarFeatureCard）可见时本卡让位隐藏，
 * 特征卡关闭即恢复（桌面两卡各占左下/底部中央，互不影响照旧）。
 */
export function SunLayerCard(): JSX.Element | null {
  const tr = useT();
  const trf = useTf();
  const locale = useLocale();
  const isCompact = useSimulationStore((s) => s.isCompact);
  const sunCutawayMode = useSimulationStore((s) => s.sunCutawayMode);
  const sunCutawayLayer = useSimulationStore((s) => s.sunCutawayLayer);
  const setSunCutawayLayer = useSimulationStore((s) => s.setSunCutawayLayer);
  const selectedSolarFeature = useSimulationStore((s) => s.selectedSolarFeature);

  if (!sunCutawayMode || !sunCutawayLayer) return null;
  // M3 底部卡区互斥：compact 下特征卡优先占用底部插槽
  if (isCompact && selectedSolarFeature) return null;

  const layer = getSunLayerById(sunCutawayLayer);
  if (!layer) return null;

  return (
    <div
      className={
        isCompact
          ? 'fixed inset-x-0 bottom-[calc(3rem+env(safe-area-inset-bottom))] z-10 max-h-[40dvh] select-text overflow-y-auto rounded-t-lg border-t border-orange-300/30 bg-space-panel p-4 text-sm backdrop-blur hud-scroll'
          : 'absolute bottom-4 left-4 w-72 select-text rounded-lg border border-orange-300/30 bg-space-panel p-4 text-xs backdrop-blur'
      }
    >
      <div className="mb-2 flex items-center justify-between">
        {/* 标题：zh 中英并列、en 仅英文（hud.bodyTitle，实现差异登记） */}
        <h3 className="text-sm font-semibold text-orange-300 max-md:text-base">
          {trf('hud.bodyTitle', { nameZh: layer.nameZh, nameEn: layer.name })}
        </h3>
        <button
          type="button"
          onClick={() => setSunCutawayLayer(null)}
          className="text-gray-400 hover:text-white max-md:-my-2.5 max-md:-mx-1.5 max-md:flex max-md:h-11 max-md:w-11 max-md:shrink-0 max-md:items-center max-md:justify-center"
          aria-label={tr('hud.layerCloseAria')}
        >
          ✕
        </button>
      </div>
      {/* i18n：分层范围/温度/说明按 locale 取用（缺失回退中文） */}
      <dl className="space-y-1 text-gray-300">
        <div className="flex justify-between gap-2">
          <dt className="shrink-0">{tr('hud.layerRange')}</dt>
          <dd className="text-right">{pickLocalized(locale, layer.rangeZh, layer.rangeEn)}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="shrink-0">{tr('hud.layerTemp')}</dt>
          <dd className="text-right">
            {pickLocalized(locale, layer.temperatureZh, layer.temperatureEn)}
          </dd>
        </div>
      </dl>
      <p className="mt-2 leading-5 text-gray-300 max-md:leading-6">
        {pickLocalized(locale, layer.descriptionZh, layer.descriptionEn)}
      </p>
      {/* i18n：结构数据来源按 locale 取用 */}
      <p className="mt-2 border-t border-white/10 pt-2 text-[10px] text-gray-500 max-md:text-xs">
        {trf('hud.dataSource', {
          value: pickLocalized(locale, SUN_STRUCTURE_DATA_SOURCE, SUN_STRUCTURE_DATA_SOURCE_EN),
        })}
      </p>
    </div>
  );
}
