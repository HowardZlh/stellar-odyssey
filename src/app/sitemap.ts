/**
 * sitemap.xml（G 迭代 M3 G7，构建期静态产出到 out/sitemap.xml）
 *
 * 静态导出（output: 'export'）方案登记：二选一（app/sitemap.ts vs
 * 构建脚本写 public/）取 **app/sitemap.ts**——Next 元数据路由在静态导出
 * 下构建期直接产出 sitemap.xml（`npm run build` 后 out/sitemap.xml 存在，
 * M3 验收实测），无需自建脚本与构建钩子。
 *
 * 收录范围（REQUIREMENTS_GROWTH §3 G7）：首页 + /lab + 4 个实验室场景页
 * （流星雨/观察站画廊/日全食/月食，注册表驱动）+ 23 个天体观察页
 * （PREVIEW_REGISTRY 驱动，新增条目自动收录）+ /unlock /donate
 * /contributors，共 32 URL。/dev/preview（生产空页）与 not-found 不收录。
 */

import type { MetadataRoute } from "next";
import { registeredPreviewIds } from "@/utils/devPreview";
import {
  labScenePath,
  observatoryBodyPath,
  registeredLabEntries,
  LAB_PAGE_PATH,
} from "@/utils/lab";
import { absoluteUrl } from "@/utils/siteMeta";

/** 静态导出下强制构建期产出（元数据路由无运行时） */
export const dynamic = "force-static";

/** 站内收录路径全量（导出供 sitemap 单测断言收录范围） */
export function sitemapPaths(): readonly string[] {
  return [
    "/",
    LAB_PAGE_PATH,
    ...registeredLabEntries().map((entry) => labScenePath(entry)),
    ...registeredPreviewIds().map((id) => observatoryBodyPath(id)),
    "/unlock",
    "/donate",
    "/contributors",
  ];
}

export default function sitemap(): MetadataRoute.Sitemap {
  return sitemapPaths().map((path) => ({
    url: absoluteUrl(path),
    changeFrequency: "weekly",
    priority: path === "/" ? 1 : 0.7,
  }));
}
