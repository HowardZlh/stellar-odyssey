'use client';

import { useSimulationStore } from '@/store';
import { getBodyInfoById } from '@/data/catalog';
import {
  SCOPE_NAME_ZH,
  isScopeCycleBody,
  scopeCyclePositionLabel,
  scopeForViewLevel,
} from '@/utils/cycleScopes';

/**
 * 视角域天体切换控件（P4 行星序列，需求 3.2.4；R2-5 §5.1-B 泛化至三域）：
 * 「← 上一个 | 当前天体名 序列位置 | 下一个 →」，按当前视角域展示对应
 * 序列（L1/L2 行星 20 天体 / L3 银河系 15 站 / L4 宇宙 8 站）。
 * 快捷键 [ / ] 按域路由；切换复用飞往运镜 2.5s 并自动跟随；
 * L3/L4 未跟随时点击即飞往该域记忆天体（初始为域默认）开始游览。
 */
export function BodyCycleSwitcher(): JSX.Element | null {
  const continuousLevel = useSimulationStore((s) => s.continuousLevel);
  const followBodyId = useSimulationStore((s) => s.followBodyId);
  const anchorBodyId = useSimulationStore((s) => s.anchorBodyId);
  const galaxyAnchorBodyId = useSimulationStore((s) => s.galaxyAnchorBodyId);
  const universeAnchorBodyId = useSimulationStore((s) => s.universeAnchorBodyId);
  const cycleScopeBody = useSimulationStore((s) => s.cycleScopeBody);
  // 黑子群/日珥科普卡片（HudInfo，底部居中弹出）可见时上移让位，避免重叠
  const selectedSolarFeature = useSimulationStore((s) => s.selectedSolarFeature);

  const scope = scopeForViewLevel(continuousLevel, followBodyId);

  // 当前展示天体：行星域沿用锚定天体（P4 现状）；L3/L4 域跟随域内天体时
  // 显示该天体，未跟随时显示域记忆天体（点击"下一个"即飞往）
  const currentId =
    scope === 'planet'
      ? anchorBodyId
      : followBodyId !== null && isScopeCycleBody(scope, followBodyId)
        ? followBodyId
        : scope === 'galaxy'
          ? galaxyAnchorBodyId
          : universeAnchorBodyId;

  const name = getBodyInfoById(currentId)?.nameZh ?? currentId;
  const position = scopeCyclePositionLabel(scope, currentId);

  return (
    <div
      className={`absolute left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-lg bg-space-panel px-4 py-2 text-xs backdrop-blur transition-[bottom] duration-300 ${
        selectedSolarFeature ? 'bottom-64' : 'bottom-28'
      }`}
    >
      <button
        type="button"
        onClick={() => cycleScopeBody(-1)}
        className="rounded bg-white/10 px-2 py-1 hover:bg-white/20"
        aria-label="上一个天体（快捷键 [）"
      >
        ← 上一个
      </button>
      <span className="min-w-24 text-center text-sm text-space-accent">
        <span className="mr-1.5 text-[10px] text-gray-400">{SCOPE_NAME_ZH[scope]}</span>
        {name}
        {position && <span className="ml-1.5 text-[10px] text-gray-400">{position}</span>}
      </span>
      <button
        type="button"
        onClick={() => cycleScopeBody(1)}
        className="rounded bg-white/10 px-2 py-1 hover:bg-white/20"
        aria-label="下一个天体（快捷键 ]）"
      >
        下一个 →
      </button>
    </div>
  );
}
