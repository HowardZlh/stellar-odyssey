'use client';


import type { JSX } from 'react';
import { SCOPE_NAME_KEYS, displayBodyName } from '@/i18n';
import { useLocale, useT } from '@/hooks/useI18n';
import { useSimulationStore } from '@/store';
import type { CycleScope } from '@/utils/cycleScopes';
import { getBodyInfoById } from '@/data/catalog';
import { isScopeCycleBody, scopeCyclePositionLabel } from '@/utils/cycleScopes';
import { planetSystemIdForBody } from '@/utils/bodyCycle';
import { MainShareMomentButton } from '@/components/UI/ShareMomentButton';

/**
 * 当前巡游域展示天体（M3 提取共用 hook）：BodyCycleSwitcher（桌面
 * 底部中央控件）与 BottomTabBar（移动底部标签栏巡游区）同源消费。
 * 跟随域内天体时显示该天体，未跟随时显示域记忆天体（行星域=锚定
 * 天体，solar 域锚定为卫星时映射到其所属行星；点击"下一个"即飞往）。
 */
export function useCycleCurrentBody(): {
  scope: CycleScope;
  name: string;
  position: string | null;
  cycleEnabled: boolean;
} {
  const locale = useLocale();
  const scope = useSimulationStore((s) => s.cycleScope);
  const followBodyId = useSimulationStore((s) => s.followBodyId);
  const anchorBodyId = useSimulationStore((s) => s.anchorBodyId);
  const galaxyAnchorBodyId = useSimulationStore((s) => s.galaxyAnchorBodyId);
  const universeAnchorBodyId = useSimulationStore((s) => s.universeAnchorBodyId);

  const fallbackId =
    scope === 'system'
      ? anchorBodyId
      : scope === 'solar'
        ? planetSystemIdForBody(anchorBodyId)
        : scope === 'galaxy'
          ? galaxyAnchorBodyId
          : universeAnchorBodyId;
  const currentId =
    followBodyId !== null && isScopeCycleBody(scope, followBodyId) ? followBodyId : fallbackId;

  // B3-C：天体显示名经 displayBodyName 收口（en 取 name、zh 取 nameZh）
  const name = displayBodyName(locale, getBodyInfoById(currentId), currentId);
  const position = scopeCyclePositionLabel(scope, currentId);
  // R3 需求 1：行星巡游域中无卫星的行星（单成员序列，position 为 null）
  // 隐藏"上一个/下一个"按钮
  return { scope, name, position, cycleEnabled: position !== null };
}

/**
 * 视角域天体切换控件（P4 行星序列，需求 3.2.4；R2-5 §5.1-B 泛化至多域；
 * R3 四域重构）：「← 上一个 | 当前天体名 序列位置 | 下一个 →」，按当前
 * 巡游域（store.cycleScope 显式状态）展示对应序列：
 * - L1 行星巡游：当前行星系统内循环（行星 + 其卫星）；无卫星的行星
 *   隐藏"上一个/下一个"按钮（R3 需求 1 确认项）
 * - L2 太阳系巡游：行星 + 矮行星 + 彗星（15 天体，按半长轴排序）
 * - L3 银河系巡游 14 站 / L4 宇宙巡游 8 站
 * 快捷键 [ / ] 按域路由；切换复用飞往运镜 2.5s 并自动跟随，
 * 巡游期间离散层级锁定为域主层级（R3 需求 2）。
 *
 * M3-3：isCompact 下本控件不渲染——巡游入口并入底部标签栏
 * （BottomTabBar 巡游区，同源 useCycleCurrentBody）。桌面
 * bottom-28/bottom-64 定位逻辑不变。
 */
export function BodyCycleSwitcher(): JSX.Element | null {
  const tr = useT();
  const isCompact = useSimulationStore((s) => s.isCompact);
  const cycleScopeBody = useSimulationStore((s) => s.cycleScopeBody);
  // 黑子群/日珥科普卡片（HudInfo，底部居中弹出）可见时上移让位，避免重叠
  const selectedSolarFeature = useSimulationStore((s) => s.selectedSolarFeature);
  // U2-3：L3/L4 巡游为支持者专属——无权益时按钮置灰 + 锁标 + tooltip；
  // 保持可点击（点击经 cycleScopeBody gate 弹锁定提示，非静默禁用）。
  // A3：tour 限免窗口期内锁标随 gate 结果消失（消费派生布尔，渲染期
  // 零时钟纪律；窗口跨界 ≤30s 显隐宽限登记于 store）
  const cycleLocked = useSimulationStore(
    (s) =>
      (s.cycleScope === 'galaxy' || s.cycleScope === 'universe') &&
      s.entitlement === null &&
      !s.remoteTourFreeActive,
  );
  const { scope, name, position, cycleEnabled } = useCycleCurrentBody();

  // M3-3：移动布局由底部标签栏承载巡游入口
  if (isCompact) return null;

  const cycleButtonClass = cycleLocked
    ? 'rounded bg-white/5 px-2 py-1 text-gray-500 hover:bg-white/10'
    : 'rounded bg-white/10 px-2 py-1 hover:bg-white/20';
  const lockedTooltip = cycleLocked ? tr('unlock.cycleLockedTooltip') : undefined;

  return (
    <div
      className={`absolute left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-lg bg-space-panel px-4 py-2 text-xs backdrop-blur transition-[bottom] duration-300 ${
        selectedSolarFeature ? 'bottom-64' : 'bottom-28'
      }`}
    >
      {cycleEnabled && (
        <button
          type="button"
          onClick={() => cycleScopeBody(-1)}
          className={cycleButtonClass}
          title={lockedTooltip}
          aria-label={tr('bodyCycle.prevAria')}
        >
          {cycleLocked ? '🔒' : '←'} {tr('bodyCycle.prev')}
        </button>
      )}
      <span className="min-w-24 text-center text-sm text-space-accent">
        <span className="mr-1.5 text-[10px] text-gray-400">{tr(SCOPE_NAME_KEYS[scope])}</span>
        {name}
        {position && <span className="ml-1.5 text-[10px] text-gray-400">{position}</span>}
      </span>
      {cycleEnabled && (
        <button
          type="button"
          onClick={() => cycleScopeBody(1)}
          className={cycleButtonClass}
          title={lockedTooltip}
          aria-label={tr('bodyCycle.nextAria')}
        >
          {tr('bodyCycle.next')} {cycleLocked ? '🔒' : '→'}
        </button>
      )}
      {/* G5 分享此刻（桌面入口）：分隔线 + 追加钮；移动端入口在 BottomTabBar */}
      <span aria-hidden="true" className="h-4 w-px bg-white/15" />
      <MainShareMomentButton className="rounded bg-white/10 px-2 py-1 hover:bg-white/20">
        🔗 {tr('share.button')}
      </MainShareMomentButton>
    </div>
  );
}
