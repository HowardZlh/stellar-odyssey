/**
 * GLSL 标识符声明一致性静态扫描（LE-M6 补丁 P4 立、P6 扩）
 *
 * 病灶回放：
 * - P4：影盘剖面片元用了 `vUv` 却漏写 `varying vec2 vUv;` → program 编译
 *   失败 → 该图层自 M4-2 起从未渲染过；
 * - P6：**本防守只查了 varying，于是同一类错误立刻在 uniform 上重演**
 *   ——月球视角地球红环片元用了 `uHalfAngle` 却只在顶点侧声明，整个
 *   地球+红环 quad 静默消失。
 *
 * 因此本扫描覆盖 **varying / uniform / attribute 三类**：着色器源里出现的
 * `vXxx` / `uXxx` / `aXxx` 形标识符，必须在**同一块内**声明（限定符声明或
 * 局部变量声明），否则判失败。
 *
 * 为什么必须静态查：**WebGL 着色器只在运行时编译**——jsdom 单测不建 GL
 * 上下文、`next build` 只做 TS 类型检查，四件套全绿也拦不住这类失效，而
 * 失效表现是「整个 mesh 静默消失」，极易被误当成别的问题。
 *
 * 命名约定（前缀 v/u/a + 大驼峰）是本检查的前提，新增着色器沿用即可。
 * GLSL 注释在扫描前剥除——注释里提及的标识符不算使用（P6 实测两处误报）。
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
/** 限定符声明（varying / uniform / attribute） */
const QUALIFIED_DECL_RE = /(?:varying|uniform|attribute)\s+\w+\s+(\w+)/g;
/** 局部变量声明 */
const LOCAL_DECL_RE = /(?:^|[;{(]\s*)(?:float|int|bool|vec[234]|mat[234])\s+(\w+)/gm;
/** 使用侧命名约定：v/u/a + 大驼峰 */
const USE_RE = /\b[uva][A-Z]\w*/g;
/** GLSL 内建/保留名（`uv` 系列大小写不冲突，此处仅列可能撞上的） */
const BUILTIN = new Set(["uv", "uv1", "uv2", "uv3"]);

/** 剥除 GLSL 注释（注释内提及标识符不算使用——否则误报） */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

export interface GlslFinding {
  file: string;
  line: number;
  stage: "FRAG" | "VERT";
  identifier: string;
}

/** 全仓扫描（导出供本测试的两条用例共用） */
function scanUndeclared(): GlslFinding[] {
  const files = collectSources(join(process.cwd(), "src"));
  const findings: GlslFinding[] = [];
  for (const file of files) {
    const src = readFileSync(file, "utf8");
    for (const match of src.matchAll(GLSL_BLOCK_RE)) {
      const body = stripComments(match[1]);
      const stage = /gl_FragColor|pc_fragColor|out\s+vec4/.test(body)
        ? "FRAG"
        : "VERT";
      const declared = new Set<string>();
      for (const d of body.matchAll(QUALIFIED_DECL_RE)) declared.add(d[1]);
      for (const d of body.matchAll(LOCAL_DECL_RE)) declared.add(d[1]);
      const seen = new Set<string>();
      for (const use of body.matchAll(USE_RE)) {
        const id = use[0];
        if (seen.has(id) || declared.has(id) || BUILTIN.has(id)) continue;
        seen.add(id);
        findings.push({
          file: file.slice(process.cwd().length + 1),
          line: src.slice(0, match.index ?? 0).split("\n").length,
          stage,
          identifier: id,
        });
      }
    }
  }
  return findings;
}

describe("GLSL 标识符声明一致性（全仓静态扫描）", () => {
  it("扫描器覆盖面自检：片元块与顶点块都扫得到（防空跑绿）", () => {
    const files = collectSources(join(process.cwd(), "src"));
    let frag = 0;
    let vert = 0;
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(GLSL_BLOCK_RE)) {
        const body = stripComments(m[1]);
        if (/gl_FragColor|pc_fragColor|out\s+vec4/.test(body)) frag += 1;
        else vert += 1;
      }
    }
    expect(frag).toBeGreaterThan(20);
    expect(vert).toBeGreaterThan(20);
  });

  it("着色器不得使用未声明的 varying / uniform / attribute（编译失败会静默丢整个 mesh）", () => {
    expect(
      scanUndeclared().map(
        (f) => `${f.file}:${f.line} [${f.stage}] 未声明 ${f.identifier}`,
      ),
    ).toEqual([]);
  });
});
