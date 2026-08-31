/**
 * 天文实验室首页 server 薄壳（G 迭代 M3 G7 拆壳：差异化 metadata +
 * canonical 由 server 层导出，客户端主体零改动——见 LabPageClient.tsx）
 *
 * description 追加实验室条目清单（注册表驱动，新条目自动纳入）。
 */

import type { JSX } from "react";
import type { Metadata } from "next";
import { t } from "@/i18n";
import { buildPageMetadata } from "@/utils/siteMeta";
import { registeredLabEntries, LAB_PAGE_PATH } from "@/utils/lab";
import LabPage from "./LabPageClient";

export const metadata: Metadata = buildPageMetadata({
  titleZh: t("zh", "lab.title"),
  description: `${t("zh", "lab.subtitle")}：${registeredLabEntries()
    .map((entry) => t("zh", entry.titleKey))
    .join("、")}。`,
  path: LAB_PAGE_PATH,
});

export default function LabRoute(): JSX.Element {
  return <LabPage />;
}
