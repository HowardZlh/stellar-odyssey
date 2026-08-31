/**
 * 捐赠页 server 薄壳（G 迭代 M3 G7 拆壳：差异化 metadata + canonical
 * 由 server 层导出，客户端主体零改动——见 DonatePageClient.tsx）
 */

import type { JSX } from "react";
import type { Metadata } from "next";
import { t } from "@/i18n";
import { buildPageMetadata } from "@/utils/siteMeta";
import DonatePage from "./DonatePageClient";

export const metadata: Metadata = buildPageMetadata({
  titleZh: t("zh", "donate.title"),
  description: `${t("zh", "donate.subtitle")}。${t("zh", "donate.intro")}`,
  path: "/donate",
});

export default function DonateRoute(): JSX.Element {
  return <DonatePage />;
}
