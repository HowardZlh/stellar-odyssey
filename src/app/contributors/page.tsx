/**
 * 贡献者宇宙页 server 薄壳（G 迭代 M3 G7 拆壳：差异化 metadata +
 * canonical 由 server 层导出，客户端主体零改动——见
 * ContributorsPageClient.tsx）
 */

import type { JSX } from "react";
import type { Metadata } from "next";
import { t } from "@/i18n";
import { buildPageMetadata } from "@/utils/siteMeta";
import ContributorsPage from "./ContributorsPageClient";

export const metadata: Metadata = buildPageMetadata({
  titleZh: t("zh", "contributors.title"),
  description: `${t("zh", "contributors.subtitle")}。${t("zh", "contributors.intro")}`,
  path: "/contributors",
});

export default function ContributorsRoute(): JSX.Element {
  return <ContributorsPage />;
}
