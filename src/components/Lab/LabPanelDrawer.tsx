"use client";

/**
 * 实验室浮层面板外壳（LE 迭代 M6-2；AGENTS.md「移动端兼容」强制条款 5）
 *
 * 桌面 = 右上侧栏浮层；`<sm` = **底部抽屉**（标题栏常显 + ▾/▴ 开合钮 +
 * `aria-expanded` + safe-area 底衬，默认收起防遮挡 3D 场景）——
 * LabControlPanel / ObservatoryHarness / SolarEclipseLab 既有范式的共享化，
 * 供月食条目各面板复用（**日食侧不改**，其内联实现零改动，M6-2 差异登记）。
 *
 * 判定体系纪律（AGENTS.md 条款 1/2）：布局分流**纯 CSS 断点**（Tailwind
 * `max-sm` 变体，口径与 `deviceCapability` 的 767px/isCompact 一致），
 * 无 JS 断点监听、无 UA 嗅探、无自建判据；开合态为组件本地 state
 * （桌面端不消费——`sm:` 起内容恒展开）。
 *
 * 触控目标（条款 3）：开合钮 `h-11 w-11`（44pt）；safe-area（条款 4）：
 * 抽屉态底衬 `env(safe-area-inset-bottom)` 避让 Home 条。
 *
 * 本组件为 DOM 叶组件（不进 Canvas 子树），文案由调用方传入已本地化字符串
 * （i18n 归调用方，组件层不订阅 locale 字典键）。
 */

import type { JSX, ReactNode } from "react";
import { useState } from "react";

/** 桌面侧栏 + <sm 底部抽屉的容器基类（右上定位/最大高度/滚动/safe-area 底衬） */
export const LAB_DRAWER_CONTAINER_CLASS =
  "absolute right-3 top-3 w-72 max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded-lg bg-black/65 p-3 text-xs text-gray-100 backdrop-blur " +
  "max-sm:bottom-0 max-sm:left-0 max-sm:right-0 max-sm:top-auto max-sm:w-full max-sm:max-w-none max-sm:rounded-b-none " +
  "max-sm:pb-[calc(0.75rem+env(safe-area-inset-bottom))]";

export interface LabPanelDrawerProps {
  /** 标题（常显于标题栏；已本地化） */
  title: string;
  /** 展开态 aria-label（已本地化） */
  expandLabel: string;
  /** 收起态 aria-label（已本地化） */
  collapseLabel: string;
  /** 面板内容（`<sm` 收起时经 `max-sm:hidden` 折叠，DOM 保留——状态不丢失） */
  children: ReactNode;
  /** 容器附加类（桌面最大高度等按页面差异传入） */
  containerClassName?: string;
  /** 标题栏配色类（默认天蓝；月球/彩蛋场景可传琥珀） */
  titleClassName?: string;
}

/** 实验室面板外壳（桌面侧栏 ↔ `<sm` 底部抽屉） */
export function LabPanelDrawer({
  title,
  expandLabel,
  collapseLabel,
  children,
  containerClassName = "",
  titleClassName = "text-sky-300",
}: LabPanelDrawerProps): JSX.Element {
  const [open, setOpen] = useState(false);

  return (
    <div className={`${LAB_DRAWER_CONTAINER_CLASS} ${containerClassName}`}>
      <div className="flex items-center justify-between">
        <h2 className={`font-semibold ${titleClassName}`}>{title}</h2>
        {/* 开合钮：`<sm` 才出现（桌面恒展开）；44pt 触控目标 */}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={open ? collapseLabel : expandLabel}
          className={`-my-2 flex h-11 w-11 items-center justify-center rounded transition-colors hover:bg-white/10 sm:hidden ${titleClassName}`}
        >
          {open ? "▾" : "▴"}
        </button>
      </div>
      <div className={`mt-2 ${open ? "" : "max-sm:hidden"}`}>{children}</div>
    </div>
  );
}
