/**
 * 日全食实验室场景页 server 薄壳（G 迭代 M3 G7 拆壳：差异化 metadata +
 * canonical 由 server 层导出，客户端主体零改动——见
 * SolarEclipsePageClient.tsx；H 迭代 H7：服务端预渲染 zh 正文层）
 *
 * 层叠：正文层 z-0（LabSceneLandingArticle，零客户端 JS，禁用 JS 可见
 * ≥300 汉字）在下，客户端场景层 `.lab-scene-layer` z-10 铺满其上——正常
 * 用户体验与拆壳前等价；场景 chunk 与首屏 JS 不变。
 */

import type { JSX } from "react";
import type { Metadata } from "next";
import { t } from "@/i18n";
import { buildPageMetadata } from "@/utils/siteMeta";
import { labSceneLandingFor } from "@/utils/labLanding";
import {
  LabSceneLandingArticle,
  LAB_SCENE_LAYER_CLASS,
} from "@/components/Lab/LabSceneLandingArticle";
import SolarEclipseLabPage from "./SolarEclipsePageClient";

export const metadata: Metadata = buildPageMetadata({
  title: `${t("zh", "lab.solarEclipseTitle")} · ${t("zh", "lab.title")}`,
  description: t("zh", "lab.solarEclipseDescription"),
  path: "/lab/solar-eclipse",
});

/** 正文数据（构建期求值；注册表/配方缺失时返回 null 则不渲染正文层） */
const landing = labSceneLandingFor("solar-eclipse");

export default function SolarEclipseRoute(): JSX.Element {
  return (
    <>
      {landing !== null && <LabSceneLandingArticle landing={landing} />}
      <div className={`${LAB_SCENE_LAYER_CLASS} fixed inset-0 z-10 bg-space-dark`}>
        <SolarEclipseLabPage />
      </div>
    </>
  );
}
