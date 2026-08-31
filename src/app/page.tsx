/**
 * 主场景页 server 薄壳（G 迭代 M3 G7 拆壳：metadata 由 server 层导出，
 * 客户端主体零改动——见 HomePageClient.tsx）
 *
 * title/description/OG 沿用 layout 全站定义（首页即站点门面），此处仅
 * 补 canonical；主场景首屏 JS 不变（拆壳只动本文件，性能红线口径）。
 */

import type { JSX } from "react";
import type { Metadata } from "next";
import HomePageClient from "./HomePageClient";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

export default function HomeRoute(): JSX.Element {
  return <HomePageClient />;
}
