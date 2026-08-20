/**
 * 一次性观测安全提示单测（E-M6-3，需求 §3.4）：
 * - 首次进入显示（dialog 语义 + 五条口径文案齐备）；
 * - 确认后关闭并写 localStorage 已读标记；
 * - 已读后再次挂载不再显示（跨会话一次性语义）。
 */

import { fireEvent, render, screen } from "@testing-library/react";

import {
  ECLIPSE_SAFETY_SEEN_KEY,
  EclipseSafetyNotice,
} from "../EclipseSafetyNotice";

afterEach(() => {
  window.localStorage.clear();
});

describe("EclipseSafetyNotice 一次性安全提示", () => {
  it("首次进入显示 dialog，五条安全口径逐条在场", () => {
    render(<EclipseSafetyNotice />);
    expect(
      screen.getByRole("dialog", { name: "观测安全提示" }),
    ).toBeInTheDocument();
    // §3.4 口径逐条（关键词断言，避免与全文强耦合）
    expect(screen.getByText(/屏幕内.*可随意观看/)).toBeInTheDocument();
    expect(screen.getByText(/没有痛觉、且不可逆/)).toBeInTheDocument();
    expect(
      screen.getByText(/仅全食阶段（食既 C2 → 生光 C3 之间）/),
    ).toBeInTheDocument();
    expect(screen.getByText(/墨镜、自制滤镜/)).toBeInTheDocument();
    expect(screen.getByText(/ISO 12312-2/)).toBeInTheDocument();
  });

  it("确认后关闭并写入已读标记", () => {
    render(<EclipseSafetyNotice />);
    fireEvent.click(screen.getByRole("button", { name: "我已了解" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(window.localStorage.getItem(ECLIPSE_SAFETY_SEEN_KEY)).toBe("1");
  });

  it("已读后再次挂载不再显示（跨会话一次性）", () => {
    window.localStorage.setItem(ECLIPSE_SAFETY_SEEN_KEY, "1");
    const { container } = render(<EclipseSafetyNotice />);
    expect(container).toBeEmptyDOMElement();
  });
});
