/**
 * 日全食实验室场景页 server 薄壳（G 迭代 M3 G7 拆壳：差异化 metadata +
 * canonical 由 server 层导出，客户端主体零改动——见
 * SolarEclipsePageClient.tsx）
 */

import type { JSX } from "react";
import type { Metadata } from "next";
import { t } from "@/i18n";
import { buildPageMetadata } from "@/utils/siteMeta";
import SolarEclipseLabPage from "./SolarEclipsePageClient";

export const metadata: Metadata = buildPageMetadata({
  titleZh: `${t("zh", "lab.solarEclipseTitle")} · ${t("zh", "lab.title")}`,
  description: t("zh", "lab.solarEclipseDescription"),
  path: "/lab/solar-eclipse",
});

export default function SolarEclipseRoute(): JSX.Element {
  return <SolarEclipseLabPage />;
}
