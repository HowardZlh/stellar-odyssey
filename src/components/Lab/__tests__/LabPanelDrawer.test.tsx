/**
 * 实验室面板外壳（桌面侧栏 ↔ `<sm` 底部抽屉）单测
 * （LE-M6-2；AGENTS.md「移动端兼容」条款 1–5 的机器保证）：
 * - 标题栏常显、内容默认收起（`max-sm:hidden`）防遮挡场景；
 * - ▾/▴ 开合钮切换 `aria-expanded` 与内容折叠类，内容 DOM 常在（状态不丢）；
 * - 开合钮 44pt（`h-11 w-11`）且 `sm:hidden`（桌面不出现）；
 * - 容器带底部抽屉断点类与 safe-area 底衬，宽度受 `100vw` 钳制（无横向溢出）；
 * - 分流判据为纯 CSS 断点：渲染期不触碰 matchMedia / userAgent（禁 UA 嗅探）。
 */

import { fireEvent, render, screen } from "@testing-library/react";

import {
  LAB_DRAWER_CONTAINER_CLASS,
  LabPanelDrawer,
} from "../LabPanelDrawer";

function renderDrawer(): HTMLElement {
  render(
    <LabPanelDrawer
      title="月食实验室"
      expandLabel="展开面板"
      collapseLabel="收起面板"
    >
      <p>面板内容</p>
    </LabPanelDrawer>,
  );
  return screen.getByRole("heading", { name: "月食实验室" });
}

describe("LabPanelDrawer 面板外壳", () => {
  it("标题常显，内容默认经 max-sm:hidden 收起（桌面 sm: 起恒展开）", () => {
    renderDrawer();
    const content = screen.getByText("面板内容").parentElement;
    expect(content).toHaveClass("max-sm:hidden");
    expect(screen.getByRole("button", { name: "展开面板" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("点击开合钮展开：aria-expanded 翻转、折叠类移除、aria-label 切换", () => {
    renderDrawer();
    fireEvent.click(screen.getByRole("button", { name: "展开面板" }));
    const collapse = screen.getByRole("button", { name: "收起面板" });
    expect(collapse).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("面板内容").parentElement).not.toHaveClass(
      "max-sm:hidden",
    );
    // 再次点击收起
    fireEvent.click(collapse);
    expect(screen.getByText("面板内容").parentElement).toHaveClass(
      "max-sm:hidden",
    );
  });

  it("收起态内容仍在 DOM（折叠只切类——控件状态与滚动位置不丢失）", () => {
    renderDrawer();
    expect(screen.getByText("面板内容")).toBeInTheDocument();
  });

  it("开合钮为 44pt 触控目标且仅 <sm 出现（桌面 sm:hidden）", () => {
    renderDrawer();
    const btn = screen.getByRole("button", { name: "展开面板" });
    expect(btn).toHaveClass("h-11");
    expect(btn).toHaveClass("w-11");
    expect(btn).toHaveClass("sm:hidden");
  });

  it("容器带底部抽屉断点类 + safe-area 底衬 + 100vw 宽度钳制（375px 无横向溢出）", () => {
    const heading = renderDrawer();
    const container = heading.parentElement?.parentElement as HTMLElement;
    for (const cls of [
      "max-sm:bottom-0",
      "max-sm:left-0",
      "max-sm:right-0",
      "max-sm:top-auto",
      "max-sm:w-full",
      "max-sm:rounded-b-none",
      "max-sm:pb-[calc(0.75rem+env(safe-area-inset-bottom))]",
      "max-w-[calc(100vw-1.5rem)]",
    ]) {
      expect(container.className).toContain(cls);
    }
    expect(LAB_DRAWER_CONTAINER_CLASS).toContain("max-sm:bottom-0");
  });

  it("容器附加类与标题配色可注入（各页面差异走 props，不复制外壳）", () => {
    render(
      <LabPanelDrawer
        title="selenelion"
        expandLabel="展开"
        collapseLabel="收起"
        containerClassName="max-h-[calc(100vh-9rem)]"
        titleClassName="text-amber-300"
      >
        <span>子内容</span>
      </LabPanelDrawer>,
    );
    const heading = screen.getByRole("heading", { name: "selenelion" });
    expect(heading).toHaveClass("text-amber-300");
    expect(
      (heading.parentElement?.parentElement as HTMLElement).className,
    ).toContain("max-h-[calc(100vh-9rem)]");
  });

  it("分流判据为纯 CSS 断点：渲染与开合期间零 matchMedia 调用（禁 JS 断点/UA 嗅探）", () => {
    const spy = jest.fn();
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      configurable: true,
      value: (query: string) => {
        spy(query);
        return { matches: false, addEventListener() {}, removeEventListener() {} };
      },
    });
    renderDrawer();
    fireEvent.click(screen.getByRole("button", { name: "展开面板" }));
    expect(spy).not.toHaveBeenCalled();
  });
});
