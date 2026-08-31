/**
 * 支持者解锁页 server 薄壳（G 迭代 M3 G7 拆壳：差异化 metadata +
 * canonical 由 server 层导出，客户端主体零改动——见 UnlockPageClient.tsx）
 */

import type { JSX } from "react";
import type { Metadata } from "next";
import { t } from "@/i18n";
import { buildPageMetadata } from "@/utils/siteMeta";
import UnlockPage from "./UnlockPageClient";

export const metadata: Metadata = buildPageMetadata({
  titleZh: t("zh", "unlock.title"),
  description: `${t("zh", "unlock.subtitle")}。${t("zh", "unlock.intro")}`,
  path: "/unlock",
});

export default function UnlockRoute(): JSX.Element {
  return <UnlockPage />;
}
