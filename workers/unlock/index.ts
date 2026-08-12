/**
 * Cloudflare Worker 入口薄壳（REQUIREMENTS_UNLOCK.md §U4-1）：
 * 只做 fetch 路由 + env 绑定 + Response 构造；业务全在 `lib/redeem.ts`
 * 纯逻辑（jest 直测），本文件不含可测分支之外的逻辑。
 *
 * 路由：`stellar.guushu.com/api/*`（静态站留 GitHub Pages，裁决 ④）。
 * 绑定：KV `UNLOCK_KV`；secrets `AFDIAN_USER_ID` / `AFDIAN_TOKEN` /
 * `ED25519_PRIVATE_KEY`（部署 checklist 见 docs/internal/UNLOCK_OPS.md）。
 */
import { buildCorsHeaders, resolveCorsOrigin } from "./lib/cors";
import { handleRedeem, type UnlockKvLike } from "./lib/redeem";

/** Worker env 绑定（全部可缺省——未配置走 not_configured 降级） */
export interface UnlockWorkerEnv {
  readonly UNLOCK_KV?: UnlockKvLike;
  readonly AFDIAN_USER_ID?: string;
  readonly AFDIAN_TOKEN?: string;
  readonly ED25519_PRIVATE_KEY?: string;
}

const worker = {
  async fetch(request: Request, env: UnlockWorkerEnv): Promise<Response> {
    const headers = buildCorsHeaders(
      resolveCorsOrigin(request.headers.get("Origin")),
    );

    // CORS 预检
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }

    const { pathname } = new URL(request.url);
    if (pathname !== "/api/redeem") {
      return new Response(
        JSON.stringify({ ok: false, error: "not_found", message: "接口不存在。" }),
        { status: 404, headers },
      );
    }
    if (request.method !== "POST") {
      return new Response(
        JSON.stringify({
          ok: false,
          error: "method_not_allowed",
          message: "仅支持 POST。",
        }),
        { status: 405, headers },
      );
    }

    let orderIdRaw: unknown = null;
    try {
      const body: unknown = await request.json();
      if (typeof body === "object" && body !== null) {
        orderIdRaw = (body as Record<string, unknown>).orderId;
      }
    } catch {
      orderIdRaw = null; // 非法 JSON → orderId 缺失 → invalid_order
    }

    const body = await handleRedeem(orderIdRaw, {
      kv: env.UNLOCK_KV ?? null,
      fetchFn: (url, init) => fetch(url, init),
      secrets: {
        afdianUserId: env.AFDIAN_USER_ID,
        afdianToken: env.AFDIAN_TOKEN,
        ed25519PrivateKeyHex: env.ED25519_PRIVATE_KEY,
      },
      nowSec: Math.floor(Date.now() / 1000),
    });
    return new Response(JSON.stringify(body), { status: 200, headers });
  },
};

export default worker;
