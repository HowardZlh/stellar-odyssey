"use client";

/**
 * 一次性观测安全提示（E-M6-3，需求 §3.4；文案口径逐条对齐底稿 §七）：
 * 首次进入日全食实验室弹出，确认后写 localStorage 已读标记（HelpHint
 * 一次性提示范式 + `stellar-odyssey:` 键名前缀惯例，跨会话不再重复）。
 *
 * 口径五条（i18n 双语）：屏幕内随意观看 / 现实中视网膜损伤无痛觉且
 * 不可逆 / 仅全食阶段 C2→C3 可裸眼且仅限全食 / 墨镜与自制滤镜无效 /
 * 认证滤镜（ISO 12312-2）或间接投影。贝利珠/钻石环阶段的「光球仍在
 * 不安全」口径由 C2/C3 阶段科普卡承载（lab.eclipseCardC2/C3）。
 *
 * 移动端条款：居中弹层天然适配小视口（max-w + p-4 边距），确认按钮
 * ≥44pt（min-h-11）；遮罩不可点击关闭——安全文案须显式确认。
 */

import type { JSX } from "react";
import { useState } from "react";
import { useT } from "@/hooks/useI18n";

/** 已读标记键（键名风格沿用 stellar-odyssey:locale 先例） */
export const ECLIPSE_SAFETY_SEEN_KEY = "stellar-odyssey:eclipseSafetySeen";

/** 已读判定（localStorage 不可用时视作已读——不阻塞场景，静默降级） */
function safetySeen(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(ECLIPSE_SAFETY_SEEN_KEY) === "1";
  } catch {
    return true;
  }
}

/** 一次性观测安全提示弹层（DOM 覆盖层；首次进入显示，确认后不再出现） */
export function EclipseSafetyNotice(): JSX.Element | null {
  const tr = useT();
  const [visible, setVisible] = useState(() => !safetySeen());
  if (!visible) return null;

  const dismiss = (): void => {
    try {
      window.localStorage.setItem(ECLIPSE_SAFETY_SEEN_KEY, "1");
    } catch {
      // 写入失败静默降级（本会话内仍不再显示）
    }
    setVisible(false);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={tr("lab.eclipseSafetyTitle")}
      className="absolute inset-0 z-30 flex items-center justify-center bg-black/70 p-4"
    >
      <div className="max-h-[calc(100vh-2rem)] w-full max-w-md overflow-y-auto rounded-lg border border-amber-400/30 bg-gray-900/95 p-4 text-sm text-gray-100 shadow-xl backdrop-blur">
        <h2 className="mb-2 font-semibold text-amber-300">
          ⚠️ {tr("lab.eclipseSafetyTitle")}
        </h2>
        <ul className="list-disc space-y-1.5 pl-5 text-xs leading-relaxed text-gray-300">
          <li>{tr("lab.eclipseSafetyScreen")}</li>
          <li>{tr("lab.eclipseSafetyRetina")}</li>
          <li>{tr("lab.eclipseSafetyTotalityOnly")}</li>
          <li>{tr("lab.eclipseSafetyNoDiy")}</li>
          <li>{tr("lab.eclipseSafetyCertified")}</li>
        </ul>
        <button
          onClick={dismiss}
          className="mt-3 min-h-11 w-full rounded bg-amber-500/25 px-3 py-2 font-semibold text-amber-200 transition-colors hover:bg-amber-500/35"
        >
          {tr("lab.eclipseSafetyConfirm")}
        </button>
      </div>
    </div>
  );
}
