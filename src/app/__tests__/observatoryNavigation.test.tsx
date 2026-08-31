/**
 * 天体观察站导航回归测试（画廊「进入观察」跳转修复 + URL 路径形态）：
 * - `[body]` 路由：generateStaticParams 覆盖注册表全量 id，
 *   dynamicParams=false（静态导出拒绝未注册 id）；
 * - 画廊卡片链接为路径形态 `/lab/observatory/<id>`（跨路由段导航——
 *   修复旧查询串形态同段软导航 URL 变而页面不动的缺陷，零 `?body=` 残留）；
 * - 画廊页对旧 `?body=<id>` 直达链接的兼容：已注册 id 经
 *   history.replaceState 规范化为路径形态；未注册 id 不改写。
 *
 * 场景 chunk（three/R3F）经 ObservatoryLab 内嵌 dynamic 懒加载，本测试
 * 只驱动画廊 DOM 层；fetch（useUnlockInit 远程配置拉取）mock 为拒绝，
 * 走 A3 静默降级路径。
 */
import { render, screen, waitFor } from "@testing-library/react";

import ObservatoryBodyPage, {
  dynamicParams,
  generateStaticParams,
} from "@/app/lab/observatory/[body]/page";
import ObservatoryGalleryPage from "@/app/lab/observatory/page";
import { ObservatoryLab } from "@/components/Lab/ObservatoryLab";
import { registeredPreviewIds } from "@/utils/devPreview";
import { observatoryBodyPath } from "@/utils/lab";

describe("/lab/observatory/[body] 静态路由", () => {
  it("generateStaticParams 覆盖 PREVIEW_REGISTRY 全量注册 id", () => {
    const params = generateStaticParams();
    expect(params.map((p) => p.body)).toEqual([...registeredPreviewIds()]);
    expect(params.length).toBeGreaterThan(0);
  });

  it("dynamicParams=false（静态导出仅允许预生成 id）", () => {
    expect(dynamicParams).toBe(false);
  });

  it("页面组件把路由参数透传为 bodyId（G6 后场景壳包在 .obs-scene-layer 层内）", async () => {
    const jsx = await ObservatoryBodyPage({
      params: Promise.resolve({ body: "betelgeuse" }),
    });
    // 递归查找 ObservatoryPageShell 的 props（服务端正文 + 场景层的兄弟结构）
    const found: Array<Record<string, unknown>> = [];
    const visit = (node: unknown): void => {
      if (Array.isArray(node)) {
        node.forEach(visit);
        return;
      }
      if (node !== null && typeof node === "object" && "props" in node) {
        const props = (node as { props: Record<string, unknown> }).props;
        if ("bodyId" in props) found.push(props);
        visit(props.children);
      }
    };
    visit(jsx);
    expect(found).toContainEqual(
      expect.objectContaining({ bodyId: "betelgeuse" }),
    );
  });
});

describe("画廊「进入观察」链接（导航修复回归）", () => {
  beforeEach(() => {
    window.localStorage.clear();
    // useUnlockInit 的远程配置拉取：拒绝 → A3 静默降级（warn 一次）
    global.fetch = jest
      .fn()
      .mockRejectedValue(new Error("offline")) as jest.Mock;
    jest.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("卡片链接为路径形态 /lab/observatory/<id>，零 ?body= 查询串", async () => {
    render(<ObservatoryLab bodyId={null} />);
    const enterLinks = await waitFor(() => {
      const links = screen
        .getAllByRole("link")
        .filter((a) => a.getAttribute("href")?.startsWith("/lab/observatory/"));
      expect(links.length).toBe(registeredPreviewIds().length);
      return links;
    });
    const hrefs = enterLinks.map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(
      registeredPreviewIds().map((id) => observatoryBodyPath(id)),
    );
    expect(hrefs.some((h) => h?.includes("?body="))).toBe(false);
  });
});

describe("画廊页旧 ?body= 直达链接兼容", () => {
  beforeEach(() => {
    window.localStorage.clear();
    global.fetch = jest
      .fn()
      .mockRejectedValue(new Error("offline")) as jest.Mock;
    jest.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    jest.restoreAllMocks();
    window.history.replaceState(null, "", "/lab/observatory");
  });

  it("已注册 id：地址栏规范化为路径形态（replaceState，不重载）", async () => {
    window.history.replaceState(null, "", "/lab/observatory?body=betelgeuse");
    render(<ObservatoryGalleryPage />);
    await waitFor(() => {
      expect(window.location.pathname).toBe("/lab/observatory/betelgeuse");
    });
    expect(window.location.search).toBe("");
  });

  it("未注册 id：不改写地址栏（画廊 + 未知 id 提示由 ObservatoryLab 渲染）", async () => {
    window.history.replaceState(null, "", "/lab/observatory?body=not-a-body");
    render(<ObservatoryGalleryPage />);
    // 等挂载 effect 跑完（黑屏占位消失即 bodyId 解析完成）
    await waitFor(() => {
      expect(window.location.search).toBe("?body=not-a-body");
    });
    expect(window.location.pathname).toBe("/lab/observatory");
  });
});
