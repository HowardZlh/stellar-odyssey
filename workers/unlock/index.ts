/**
 * Cloudflare Worker 入口薄壳（REQUIREMENTS_UNLOCK.md §U4-1）：
 * 只做 fetch 路由 + env 绑定 + Response 构造；业务全在 `lib/redeem.ts` /
 * `lib/gateConfig.ts` 纯逻辑（jest 直测），本文件不含可测分支之外的逻辑。
 *
 * 路由：`stellar.guushu.com/api/*`（静态站留 GitHub Pages，裁决 ④）。
 * 绑定：KV `UNLOCK_KV`；secrets `AFDIAN_USER_ID` / `AFDIAN_TOKEN` /
 * `ED25519_PRIVATE_KEY`（部署 checklist 见 docs/internal/UNLOCK_OPS.md）。
 */
import { buildCorsHeaders, resolveCorsOrigin } from "./lib/cors";
import { handleGateConfig } from "./lib/gateConfig";
import { handleRedeem, type UnlockKvLike } from "./lib/redeem";
import { handleRevocations } from "./lib/revocations";
import { runRefundSync } from "./lib/refundSync";

/**
 * Worker env 绑定（KV/secrets 可缺省——未配置走 not_configured 降级；
 * UNLOCK_PLAN_ID_* 为 wrangler.toml `[vars]` 非机密映射，U6：任一为空
 * 整体回退纯金额判定；REFUND_* 为 A6 退款巡检 vars——AUTO_REVOKE 默认
 * 空 = 模式 A 只检测登记，检测口径校准前禁开，裁决 ⑧）
 */
export interface UnlockWorkerEnv {
  readonly UNLOCK_KV?: UnlockKvLike;
  readonly AFDIAN_USER_ID?: string;
  readonly AFDIAN_TOKEN?: string;
  readonly ED25519_PRIVATE_KEY?: string;
  readonly UNLOCK_PLAN_ID_WEEK?: string;
  readonly UNLOCK_PLAN_ID_MONTH?: string;
  readonly UNLOCK_PLAN_ID_YEAR?: string;
  readonly REFUND_LOOKBACK_DAYS?: string;
  readonly REFUND_AUTO_REVOKE?: string;
}

/** scheduled 执行上下文最小接口（生产 = CF ExecutionContext，测试 = mock） */
export interface ExecutionCtxLike {
  waitUntil(promise: Promise<unknown>): void;
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

    // §A2：GET /api/gate-config（最小追加式分支，redeem 分支语义零变化）
    if (pathname === "/api/gate-config") {
      if (request.method !== "GET") {
        return new Response(
          JSON.stringify({
            ok: false,
            error: "method_not_allowed",
            message: "仅支持 GET。",
          }),
          { status: 405, headers },
        );
      }
      const gateBody = await handleGateConfig(env.UNLOCK_KV);
      return new Response(JSON.stringify(gateBody), {
        status: 200,
        headers: { ...headers, "Cache-Control": "public, max-age=300" },
      });
    }

    // §A6：GET /api/revocations（gate-config 完全同构：透传 + 缓存头 + 零 KV 写）
    if (pathname === "/api/revocations") {
      if (request.method !== "GET") {
        return new Response(
          JSON.stringify({
            ok: false,
            error: "method_not_allowed",
            message: "仅支持 GET。",
          }),
          { status: 405, headers },
        );
      }
      const revBody = await handleRevocations(env.UNLOCK_KV);
      return new Response(JSON.stringify(revBody), {
        status: 200,
        headers: { ...headers, "Cache-Control": "public, max-age=300" },
      });
    }

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
      planTiers: {
        week: env.UNLOCK_PLAN_ID_WEEK,
        month: env.UNLOCK_PLAN_ID_MONTH,
        year: env.UNLOCK_PLAN_ID_YEAR,
      },
    });
    return new Response(JSON.stringify(body), { status: 200, headers });
  },

  /**
   * cron 退款巡检壳（§A6-2，wrangler.toml `[triggers]` 每 3 小时排程）：
   * 业务全在 lib/refundSync.ts 纯逻辑（jest 直测）；本壳只做 env 绑定
   * 注入 + waitUntil 挂接。模式 A（裁决 ⑧）：REFUND_AUTO_REVOKE 为空
   * 时只检测登记疑似单，不自动吊销。
   */
  scheduled(
    _controller: unknown,
    env: UnlockWorkerEnv,
    ctx: ExecutionCtxLike,
  ): void {
    ctx.waitUntil(
      runRefundSync({
        kv: env.UNLOCK_KV ?? null,
        fetchFn: (url, init) => fetch(url, init),
        secrets: {
          afdianUserId: env.AFDIAN_USER_ID,
          afdianToken: env.AFDIAN_TOKEN,
        },
        nowSec: Math.floor(Date.now() / 1000),
        lookbackDays: Number(env.REFUND_LOOKBACK_DAYS ?? ""),
        autoRevoke: env.REFUND_AUTO_REVOKE === "1",
        by: "cron",
      }),
    );
  },
};

export default worker;
