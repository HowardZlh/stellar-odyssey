/**
 * CORS 判定纯函数（REQUIREMENTS_UNLOCK.md §U4-1 降级与防护）：
 * 仅放行生产站 `https://stellar.guushu.com` 与本地 dev origin
 * （localhost / 127.0.0.1 的 3000/3100/3200 端口，对应 AGENTS.md 端口纪律）。
 */

/** 生产站 origin（GitHub Pages 静态站，Worker 只挂 API 路由） */
export const PROD_ORIGIN = "https://stellar.guushu.com";

const DEV_ORIGIN_RE = /^http:\/\/(localhost|127\.0\.0\.1):(3000|3100|3200)$/;

/** Origin 请求头 → 放行的 origin（不放行返回 null） */
export function resolveCorsOrigin(origin: string | null): string | null {
  if (origin === null) return null;
  if (origin === PROD_ORIGIN) return origin;
  if (DEV_ORIGIN_RE.test(origin)) return origin;
  return null;
}

/**
 * 响应头构造：JSON Content-Type 恒有；仅放行 origin 追加 CORS 头。
 * 不放行时不带 ACAO——浏览器侧自然拦截，curl 等非浏览器调用不受影响。
 */
export function buildCorsHeaders(
  allowedOrigin: string | null,
): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json; charset=utf-8",
  };
  if (allowedOrigin !== null) {
    headers["Access-Control-Allow-Origin"] = allowedOrigin;
    headers["Access-Control-Allow-Methods"] = "POST, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "Content-Type";
    headers["Access-Control-Max-Age"] = "86400";
    headers["Vary"] = "Origin";
  }
  return headers;
}
