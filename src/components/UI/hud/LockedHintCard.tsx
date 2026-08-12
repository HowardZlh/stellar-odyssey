"use client";

import type { JSX } from "react";
import { useEffect } from "react";
import { useT, useTf } from "@/hooks/useI18n";
import { useSimulationStore } from "@/store";
import { UNLOCK_PAGE_PATH } from "@/utils/unlockPage";

/** 锁定提示自动收起时限（毫秒；口径沿用 G 键引导 toast 的 12 秒） */
export const LOCKED_HINT_AUTO_DISMISS_MS = 12_000;

/**
 * 锁定提示卡片（U2-4：非阻断 HUD，独立于事件通知流）：
 * 细节层命中 / 巡游被拦 / 演示配额用尽三场景共用，视觉沿用
 * EventNoticeColumn 卡片风格（space-panel + 彩边 + backdrop-blur）。
 * 「前往解锁」新标签页打开 /unlock（UNLOCK_PAGE_PATH 同源常量）；
 * 12 秒自动收起（登记：口径同 G 键引导 toast）+ 手动关闭。
 * 节流：detail 场景同会话同天体一次（store reportLockedHint 承担）。
 */
export function LockedHintCard(): JSX.Element | null {
  const tr = useT();
  const trf = useTf();
  const isCompact = useSimulationStore((s) => s.isCompact);
  const lockedHint = useSimulationStore((s) => s.lockedHint);
  const dismissLockedHint = useSimulationStore((s) => s.dismissLockedHint);
  // 渲染纯度纪律：剩余次数读 store 派生字段（渲染期零时钟调用）
  const demoRemaining = useSimulationStore((s) => s.demoRemainingToday);

  useEffect(() => {
    if (lockedHint === null) return undefined;
    const timer = setTimeout(dismissLockedHint, LOCKED_HINT_AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [lockedHint, dismissLockedHint]);

  if (lockedHint === null) return null;

  const body =
    lockedHint.context === "detail"
      ? tr("unlock.lockedDetailBody")
      : lockedHint.context === "cycle"
        ? tr("unlock.lockedCycleBody")
        : tr("unlock.lockedQuotaBody");

  return (
    /* 独立定位：底部居中（避让顶部事件通知列与底部巡游控件） */
    <div
      className={`absolute left-1/2 z-20 w-[calc(100vw-2rem)] max-w-96 -translate-x-1/2 ${
        isCompact
          ? "bottom-[calc(env(safe-area-inset-bottom)+5.5rem)]"
          : "bottom-40"
      }`}
    >
      <div className="rounded-lg border border-violet-400/40 bg-space-panel p-3 text-xs backdrop-blur max-md:text-sm">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-violet-300 max-md:text-base">
            🔒 {tr("unlock.lockedTitle")}
          </p>
          <button
            type="button"
            onClick={dismissLockedHint}
            className="text-gray-400 hover:text-white max-md:-my-2.5 max-md:-mx-1.5 max-md:flex max-md:h-11 max-md:w-11 max-md:shrink-0 max-md:items-center max-md:justify-center"
            aria-label={tr("unlock.lockedCloseAria")}
          >
            ✕
          </button>
        </div>
        <p className="mt-1 text-gray-200">{body}</p>
        {lockedHint.context === "quota" && (
          <p className="mt-1 text-[10px] text-gray-400 max-md:text-xs">
            {trf("unlock.demoQuotaRemaining", { count: demoRemaining })}
          </p>
        )}
        <a
          href={UNLOCK_PAGE_PATH}
          target="_blank"
          rel="noopener noreferrer"
          onClick={dismissLockedHint}
          aria-label={tr("unlock.lockedGoUnlockAria")}
          className="mt-2 inline-block rounded bg-violet-400/90 px-2 py-1 text-black hover:bg-violet-300 max-md:px-3 max-md:py-3"
        >
          ✨ {tr("unlock.lockedGoUnlock")}
        </a>
      </div>
    </div>
  );
}
