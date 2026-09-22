// 把 workers/unlock/index.ts 打包成 Pages 高级模式入口 out/_worker.js。
// 用法：node scripts/build-worker.mjs   （npm run build:pages 在 next build 之后调用）
//
// 为什么不用 wrangler：`wrangler deploy --dry-run --outfile` 写出的是上传用
// multipart 表单，`--outdir` 只落 README（wrangler 4.136 实测），拿不到裸 JS；
// esbuild 是 wrangler 的直接依赖，已在 node_modules，这里直接调 API。
// 目标运行时 workerd：ESM、浏览器平台条件、无 Node 内建；@noble/* 纯 JS 可直接打包。
import { mkdirSync, statSync } from "node:fs";
import { build } from "esbuild";

const outfile = "out/_worker.js";
mkdirSync("out", { recursive: true });

await build({
  entryPoints: ["workers/unlock/index.ts"],
  outfile,
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  conditions: ["workerd", "worker", "browser"],
  mainFields: ["module", "main"],
  minify: false,
  sourcemap: false,
  logLevel: "warning",
});

const bytes = statSync(outfile).size;
if (bytes > 1_000_000) {
  throw new Error(`_worker.js ${bytes} bytes 超过 1 MB（Workers Free 压缩前上限提醒）`);
}
console.log(`built ${outfile} (${(bytes / 1024).toFixed(1)} KiB)`);
