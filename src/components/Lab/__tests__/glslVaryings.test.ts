/**
 * GLSL varying 声明一致性静态扫描（LE-M6 补丁 P4 的结构性防守）
 *
 * 病灶回放：`LunarEclipseSpaceView.tsx` 的影盘剖面片元着色器用了 `vUv` 却
 * 漏写 `varying vec2 vUv;` → WebGL program 编译失败 → 「月距处影盘剖面」
 * 自 M4-2 起从未渲染过。**WebGL 着色器只在运行时编译**，jsdom 单测不建
 * GL 上下文、`next build` 只做 TS 类型检查——四件套全绿也拦不住这类失效。
 *
 * 本测试对全仓 `/* glsl *​/` 模板串做静态扫描：片元块（含 gl_FragColor /
 * out vec4）里出现的 `vXxx` 形标识符，必须要么在同块内 `varying` 声明、
 * 要么是同块内的局部声明。命名约定（varying 一律 `v` + 大驼峰）为本检查
 * 的前提，新增着色器沿用即可。
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** 递归收集 src 下的 .ts/.tsx 源文件 */
function collectSources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      collectSources(full, out);
    } else if (/\.(ts|tsx)$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

/** `/* glsl *​/` 标记的模板串（着色器源的统一书写约定） */
const GLSL_BLOCK_RE = /\/\* glsl \*\/\s*`([\s\S]*?)`/g;
/** varying 声明 */
const VARYING_DECL_RE = /varying\s+\w+\s+(\w+)/g;
/** varying 命名约定：v + 大驼峰 */
const VARYING_USE_RE = /\bv[A-Z]\w*/g;
/** 同块内局部/属性/uniform 声明（排除误报） */
const LOCAL_DECL_RE = (name: string): RegExp =>
  new RegExp(`(?:float|int|bool|vec[234]|mat[234]|uniform\\s+\\w+|attribute\\s+\\w+)\\s+${name}\\b`);

interface GlslFinding {
  file: string;
  line: number;
  identifier: string;
}

function scanUndeclaredVaryings(): GlslFinding[] {
  const files = collectSources(join(process.cwd(), "src"));
  const findings: GlslFinding[] = [];
  for (const file of files) {
    const src = readFileSync(file, "utf8");
    for (const match of src.matchAll(GLSL_BLOCK_RE)) {
      const body = match[1];
      // 只查片元着色器（顶点块里的 varying 是写侧，天然有声明）
      if (!/gl_FragColor|pc_fragColor|out\s+vec4/.test(body)) continue;
      const declared = new Set(
        [...body.matchAll(VARYING_DECL_RE)].map((m) => m[1]),
      );
      const seen = new Set<string>();
      for (const use of body.matchAll(VARYING_USE_RE)) {
        const id = use[0];
        if (seen.has(id) || declared.has(id)) continue;
        if (LOCAL_DECL_RE(id).test(body)) continue;
        seen.add(id);
        findings.push({
          file: file.slice(process.cwd().length + 1),
          line: src.slice(0, match.index ?? 0).split("\n").length,
          identifier: id,
        });
      }
    }
  }
  return findings;
}

describe("GLSL varying 声明一致性（全仓静态扫描）", () => {
  it("扫描器本身能扫到片元块（防空跑绿）", () => {
    const files = collectSources(join(process.cwd(), "src"));
    let fragmentBlocks = 0;
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(GLSL_BLOCK_RE)) {
        if (/gl_FragColor|pc_fragColor|out\s+vec4/.test(m[1])) fragmentBlocks += 1;
      }
    }
    expect(fragmentBlocks).toBeGreaterThan(20);
  });

  it("片元着色器不得使用未声明的 varying（编译失败会静默丢整个 mesh）", () => {
    const findings = scanUndeclaredVaryings();
    expect(
      findings.map((f) => `${f.file}:${f.line} 使用了未声明的 ${f.identifier}`),
    ).toEqual([]);
  });
});
