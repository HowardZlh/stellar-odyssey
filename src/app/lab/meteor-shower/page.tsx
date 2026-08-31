/**
 * 流星雨实验室场景页 server 薄壳（G 迭代 M3 G7 拆壳：差异化 metadata +
 * canonical 由 server 层导出，客户端主体零改动——见
 * MeteorShowerPageClient.tsx）
 */

import type { JSX } from "react";
import type { Metadata } from "next";
import { t } from "@/i18n";
import { buildPageMetadata } from "@/utils/siteMeta";
import MeteorShowerLabPage from "./MeteorShowerPageClient";

export const metadata: Metadata = buildPageMetadata({
  titleZh: `${t("zh", "lab.meteorShowerTitle")} · ${t("zh", "lab.title")}`,
  description: t("zh", "lab.meteorShowerDescription"),
  path: "/lab/meteor-shower",
});

export default function MeteorShowerRoute(): JSX.Element {
  return <MeteorShowerLabPage />;
}
