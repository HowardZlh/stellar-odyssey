/**
 * 天体观察站画廊页 server 薄壳（G 迭代 M3 G7 拆壳：差异化 metadata +
 * canonical 由 server 层导出，客户端主体零改动——见
 * ObservatoryGalleryPageClient.tsx，含旧 `?body=` 直达兼容逻辑）
 */

import type { JSX } from "react";
import type { Metadata } from "next";
import { t } from "@/i18n";
import { buildPageMetadata } from "@/utils/siteMeta";
import { OBSERVATORY_PAGE_PATH } from "@/utils/lab";
import ObservatoryPage from "./ObservatoryGalleryPageClient";

export const metadata: Metadata = buildPageMetadata({
  titleZh: `${t("zh", "lab.observatoryTitle")} · ${t("zh", "lab.title")}`,
  description: t("zh", "lab.observatoryDescription"),
  path: OBSERVATORY_PAGE_PATH,
});

export default function ObservatoryGalleryRoute(): JSX.Element {
  return <ObservatoryPage />;
}
