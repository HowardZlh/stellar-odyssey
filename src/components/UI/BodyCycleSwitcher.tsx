'use client';


import type { JSX } from 'react';
import { useSimulationStore } from '@/store';
import { getBodyInfoById } from '@/data/catalog';
import {
  SCOPE_NAME_ZH,
  isScopeCycleBody,
  scopeCyclePositionLabel,
} from '@/utils/cycleScopes';
import { planetSystemIdForBody } from '@/utils/bodyCycle';

/**
 * 视角域天体切换控件（P4 行星序列，需求 3.2.4；R2-5 §5.1-B 泛化至多域；
 * R3 四域重构）：「← 上一个 | 当前天体名 序列位置 | 下一个 →」，按当前
 * 巡游域（store.cycleScope 显式状态）展示对应序列：
 * - L1 行星巡游：当前行星系统内循环（行星 + 其卫星）；无卫星的行星
 *   隐藏"上一个/下一个"按钮（R3 需求 1 确认项）
 * - L2 太阳系巡游：行星 + 矮行星 + 彗星（15 天体，按半长轴排序）
 * - L3 银河系巡游 15 站 / L4 宇宙巡游 8 站
 * 快捷键 [ / ] 按域路由；切换复用飞往运镜 2.5s 并自动跟随，
 * 巡游期间离散层级锁定为域主层级（R3 需求 2）。
 */
export function BodyCycleSwitcher(): JSX.Element | null {
  const scope = useSimulationStore((s) => s.cycleScope);
  const followBodyId = useSimulationStore((s) => s.followBodyId);
  const anchorBodyId = useSimulationStore((s) => s.anchorBodyId);
  const galaxyAnchorBodyId = useSimulationStore((s) => s.galaxyAnchorBodyId);
  const universeAnchorBodyId = useSimulationStore((s) => s.universeAnchorBodyId);
  const cycleScopeBody = useSimulationStore((s) => s.cycleScopeBody);
  // 黑子群/日珥科普卡片（HudInfo，底部居中弹出）可见时上移让位，避免重叠
  const selectedSolarFeature = useSimulationStore((s) => s.selectedSolarFeature);

  // 当前展示天体：跟随域内天体时显示该天体，未跟随时显示域记忆天体
  // （行星域=锚定天体，solar 域锚定为卫星时映射到其所属行星；
  // 点击"下一个"即飞往）
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

  const name = getBodyInfoById(currentId)?.nameZh ?? currentId;
  const position = scopeCyclePositionLabel(scope, currentId);
  // R3 需求 1：行星巡游域中无卫星的行星（单成员序列，position 为 null）
  // 隐藏"上一个/下一个"按钮
  const cycleEnabled = position !== null;

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
          className="rounded bg-white/10 px-2 py-1 hover:bg-white/20"
          aria-label="上一个天体（快捷键 [）"
        >
          ← 上一个
        </button>
      )}
      <span className="min-w-24 text-center text-sm text-space-accent">
        <span className="mr-1.5 text-[10px] text-gray-400">{SCOPE_NAME_ZH[scope]}</span>
        {name}
        {position && <span className="ml-1.5 text-[10px] text-gray-400">{position}</span>}
      </span>
      {cycleEnabled && (
        <button
          type="button"
          onClick={() => cycleScopeBody(1)}
          className="rounded bg-white/10 px-2 py-1 hover:bg-white/20"
          aria-label="下一个天体（快捷键 ]）"
        >
          下一个 →
        </button>
      )}
    </div>
  );
}
