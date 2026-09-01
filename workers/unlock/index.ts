/**
 * Cloudflare Worker 入口薄壳（REQUIREMENTS_UNLOCK.md §U4-1）：
 * 只做 fetch 路由 + env 绑定 + Response 构造；业务全在 `lib/redeem.ts` /
 * `lib/gateConfig.ts` 纯逻辑（jest 直测），本文件不含可测分支之外的逻辑。
 *
 * 路由：`stellar.guushu.com/api/*`（静态站留 GitHub Pages，裁决 ④）。
 * 绑定：D1 `UNLOCK_DB`（Z 迭代 M1 起，KV 已退出代码链路——wrangler.toml
 * 的 KV 绑定保留至 M3 回滚窗口关闭后移除）；secrets `AFDIAN_USER_ID` /
 * `AFDIAN_TOKEN` / `ED25519_PRIVATE_KEY`（部署 checklist 见
 * docs/internal/UNLOCK_OPS.md；D1 初始化步骤见 REQUIREMENTS_ALIPAY_UNLOCK §9）。
 */
import {
  handleAlipayCreate,
  handleAlipayNotify,
  handleAlipayStatus,
  handleContributors,
  type AlipayDeps,
} from "./lib/alipayHandlers";
import { buildCorsHeaders, resolveCorsOrigin } from "./lib/cors";
import type { UnlockDbLike } from "./lib/db";
import { handleFunnelEvent } from "./lib/funnel";
import { handleGateConfig } from "./lib/gateConfig";
import { buildOpsMailRaw } from "./lib/opsMime";
import { runOpsNotify, type OpsMailerLike } from "./lib/opsNotify";
import { handleRedeem } from "./lib/redeem";
import { handleRevocations } from "./lib/revocations";
import { runUnifiedSync } from "./lib/refundSync";

/**
 * Worker env 绑定（D1/secrets 可缺省——未配置走 not_configured 降级；
 * UNLOCK_PLAN_ID_* 为 wrangler.toml `[vars]` 非机密映射，U6：任一为空
 * 整体回退纯金额判定；REFUND_* 为 A6 退款巡检 vars——AUTO_REVOKE 默认
 * 空 = 模式 A 只检测登记，检测口径校准前禁开，裁决 ⑧；
 * ALIPAY_* 为 M2 支付宝当面付 secrets——4 项齐备才启用支付链路，
 * 命名 D-z9：ALIPAY_PUBLIC_KEY 是**支付宝公钥**不是应用公钥）
 */
export interface UnlockWorkerEnv {
  readonly UNLOCK_DB?: UnlockDbLike;
  readonly AFDIAN_USER_ID?: string;
  readonly AFDIAN_TOKEN?: string;
  /** 面包多开发者 key（面包多集成，wrangler secret；缺失 = mbd 渠道
   * not_configured 降级，爱发电/支付宝链路不受影响） */
  readonly MBD_DEVELOPER_KEY?: string;
  readonly ED25519_PRIVATE_KEY?: string;
  readonly ALIPAY_APP_ID?: string;
  readonly ALIPAY_PRIVATE_KEY?: string;
  readonly ALIPAY_PUBLIC_KEY?: string;
  readonly ALIPAY_SELLER_ID?: string;
  readonly UNLOCK_PLAN_ID_WEEK?: string;
  readonly UNLOCK_PLAN_ID_MONTH?: string;
  readonly UNLOCK_PLAN_ID_YEAR?: string;
  /** 档位 ↔ 面包多作品 urlkey 映射（非机密 vars，对等 UNLOCK_PLAN_ID_*：
   * 三者全配置启用强制归档，任一为空回退纯金额判定） */
  readonly UNLOCK_MBD_URLKEY_WEEK?: string;
  readonly UNLOCK_MBD_URLKEY_MONTH?: string;
  readonly UNLOCK_MBD_URLKEY_YEAR?: string;
  readonly REFUND_LOOKBACK_DAYS?: string;
  readonly REFUND_AUTO_REVOKE?: string;
  /** 运营通知邮件绑定（自动运营第1步，wrangler.toml `[[send_email]]`——
   * Email Routing 免费通道：旧版 send(EmailMessage) 形态、只能发到已
   * 验证目标地址，通道裁决与实证登记见 lib/opsMime.ts 文件头；与
   * OPS_MAIL_FROM / OPS_MAIL_TO 任一缺失 = 通知层 not_configured
   * 降级，对账主流程不受影响） */
  readonly OPS_MAIL?: SendEmailBindingLike;
  readonly OPS_MAIL_FROM?: string;
  readonly OPS_MAIL_TO?: string;
}

/** 旧版 send_email 绑定最小面（生产 = CF SendEmail，入参 EmailMessage） */
export interface SendEmailBindingLike {
  send(message: unknown): Promise<unknown>;
}

/**
 * 绑定 → OpsMailerLike 适配（壳层 IO：EmailMessage 经 cloudflare:email
 * 动态 import 构造——静态 import 会使 jest 解析 index.ts 时报模块不存在，
 * 动态形态仅在生产 send 调用时执行；MIME 组装在 lib/opsMime.ts 纯函数）。
 */
function opsMailerOf(binding: SendEmailBindingLike | undefined): OpsMailerLike | null {
  if (binding === undefined) return null;
  return {
    async send(message) {
      const { EmailMessage } = await import("cloudflare:email");
      await binding.send(
        new EmailMessage(
          message.from.email,
          message.to,
          buildOpsMailRaw(message, Date.now()),
        ),
      );
    },
  };
}

/** 支付宝三接口共享依赖组装（M2；纯映射，无业务分支） */
function alipayDepsOf(env: UnlockWorkerEnv): AlipayDeps {
  return {
    db: env.UNLOCK_DB ?? null,
    env: {
      ALIPAY_APP_ID: env.ALIPAY_APP_ID,
      ALIPAY_PRIVATE_KEY: env.ALIPAY_PRIVATE_KEY,
      ALIPAY_PUBLIC_KEY: env.ALIPAY_PUBLIC_KEY,
      ALIPAY_SELLER_ID: env.ALIPAY_SELLER_ID,
    },
    ed25519PrivateKeyHex: env.ED25519_PRIVATE_KEY,
    nowSec: Math.floor(Date.now() / 1000),
  };
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
      const gateBody = await handleGateConfig(env.UNLOCK_DB);
      return new Response(JSON.stringify(gateBody), {
        status: 200,
        headers: { ...headers, "Cache-Control": "public, max-age=300" },
      });
    }

    // §A6：GET /api/revocations（gate-config 完全同构：透传 + 缓存头 + 零 DB 写）
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
      const revBody = await handleRevocations(env.UNLOCK_DB);
      return new Response(JSON.stringify(revBody), {
        status: 200,
        headers: { ...headers, "Cache-Control": "public, max-age=300" },
      });
    }

    // M2：GET /api/contributors（贡献者名单，D-z4；缓存头 300s 与
    // gate-config 同口径——浏览器侧 HTTP 缓存防轮询消耗，零 DB 写）
    if (pathname === "/api/contributors") {
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
      const contribBody = await handleContributors(env.UNLOCK_DB ?? null);
      return new Response(JSON.stringify(contribBody), {
        status: 200,
        headers: { ...headers, "Cache-Control": "public, max-age=300" },
      });
    }

    // M4（G8）：POST /api/ev（匿名漏斗计数——text/plain beacon 简单请求；
    // 零 KV 访问、无用户标识落库，校验/UPSERT 全在 lib/funnel.ts 纯逻辑）
    if (pathname === "/api/ev") {
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
      let evRaw = "";
      try {
        evRaw = await request.text();
      } catch {
        evRaw = ""; // 读体失败 → 空串 → invalid_body 400
      }
      const evOut = await handleFunnelEvent(
        evRaw,
        env.UNLOCK_DB ?? null,
        Date.now(),
      );
      return new Response(JSON.stringify(evOut.body), {
        status: evOut.status,
        headers,
      });
    }

    // M2：POST /api/alipay/create（当面付预下单）
    if (pathname === "/api/alipay/create") {
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
      let createBodyRaw: unknown = null;
      try {
        createBodyRaw = await request.json();
      } catch {
        createBodyRaw = null; // 非法 JSON → 档位缺失 → invalid_tier
      }
      const createBody = await handleAlipayCreate(
        createBodyRaw,
        alipayDepsOf(env),
      );
      return new Response(JSON.stringify(createBody), { status: 200, headers });
    }

    // M2：POST /api/alipay/notify（支付宝异步通知，安全核心——回纯文本；
    // 服务端对服务端通道，无 CORS 语义）
    if (pathname === "/api/alipay/notify") {
      if (request.method !== "POST") {
        return new Response("failure", {
          status: 405,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      }
      let notifyRaw = "";
      try {
        notifyRaw = await request.text();
      } catch {
        notifyRaw = "";
      }
      const notifyOut = await handleAlipayNotify(notifyRaw, alipayDepsOf(env));
      return new Response(notifyOut, {
        status: 200,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    // M2：GET /api/alipay/status（轮询 + deep=1 trade.query 兜底补发）
    if (pathname === "/api/alipay/status") {
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
      const url = new URL(request.url);
      const statusBody = await handleAlipayStatus(
        url.searchParams.get("out_trade_no"),
        url.searchParams.get("deep") === "1",
        alipayDepsOf(env),
      );
      return new Response(JSON.stringify(statusBody), { status: 200, headers });
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
    let channelRaw: unknown = undefined;
    try {
      const body: unknown = await request.json();
      if (typeof body === "object" && body !== null) {
        orderIdRaw = (body as Record<string, unknown>).orderId;
        channelRaw = (body as Record<string, unknown>).channel;
      }
    } catch {
      orderIdRaw = null; // 非法 JSON → orderId 缺失 → invalid_order
    }

    const body = await handleRedeem(
      orderIdRaw,
      {
        db: env.UNLOCK_DB ?? null,
        fetchFn: (url, init) => fetch(url, init),
        secrets: {
          afdianUserId: env.AFDIAN_USER_ID,
          afdianToken: env.AFDIAN_TOKEN,
          mbdDeveloperKey: env.MBD_DEVELOPER_KEY,
          ed25519PrivateKeyHex: env.ED25519_PRIVATE_KEY,
        },
        nowSec: Math.floor(Date.now() / 1000),
        planTiers: {
          week: env.UNLOCK_PLAN_ID_WEEK,
          month: env.UNLOCK_PLAN_ID_MONTH,
          year: env.UNLOCK_PLAN_ID_YEAR,
        },
        mbdUrlkeys: {
          week: env.UNLOCK_MBD_URLKEY_WEEK,
          month: env.UNLOCK_MBD_URLKEY_MONTH,
          year: env.UNLOCK_MBD_URLKEY_YEAR,
        },
      },
      channelRaw,
    );
    return new Response(JSON.stringify(body), { status: 200, headers });
  },

  /**
   * cron 统一对账壳（§A6-2 爱发电巡检 + M4 支付宝对账，D-z6 单 cron，
   * wrangler.toml `[triggers]` 每 3 小时排程）：业务全在 lib/refundSync.ts
   * 纯逻辑（jest 直测）；本壳只做 env 绑定注入 + waitUntil 挂接。
   * 爱发电模式 A（裁决 ⑧）：REFUND_AUTO_REVOKE 为空时只检测登记疑似单；
   * 支付宝段（超时关单/已付补发/退款吊销）Secrets 未配齐时独立降级。
   *
   * 自动运营第1步：对账完成后接运营通知编排（lib/opsNotify.ts——实时
   * 告警 + 每 UTC 日一封转化日报，每轮至多 1 封邮件；runOpsNotify 永不抛，
   * 通知层异常不连带对账结果）。
   */
  scheduled(
    _controller: unknown,
    env: UnlockWorkerEnv,
    ctx: ExecutionCtxLike,
  ): void {
    const nowSec = Math.floor(Date.now() / 1000);
    const lookbackDays = Number(env.REFUND_LOOKBACK_DAYS ?? "");
    ctx.waitUntil(
      runUnifiedSync(
        {
          db: env.UNLOCK_DB ?? null,
          fetchFn: (url, init) => fetch(url, init),
          secrets: {
            afdianUserId: env.AFDIAN_USER_ID,
            afdianToken: env.AFDIAN_TOKEN,
          },
          nowSec,
          lookbackDays,
          autoRevoke: env.REFUND_AUTO_REVOKE === "1",
          by: "cron",
        },
        {
          db: env.UNLOCK_DB ?? null,
          env: {
            ALIPAY_APP_ID: env.ALIPAY_APP_ID,
            ALIPAY_PRIVATE_KEY: env.ALIPAY_PRIVATE_KEY,
            ALIPAY_PUBLIC_KEY: env.ALIPAY_PUBLIC_KEY,
            ALIPAY_SELLER_ID: env.ALIPAY_SELLER_ID,
          },
          ed25519PrivateKeyHex: env.ED25519_PRIVATE_KEY,
          nowSec,
          lookbackDays,
        },
        {
          db: env.UNLOCK_DB ?? null,
          fetchFn: (url, init) => fetch(url, init),
          secrets: { mbdDeveloperKey: env.MBD_DEVELOPER_KEY },
          nowSec,
          lookbackDays,
          autoRevoke: env.REFUND_AUTO_REVOKE === "1",
        },
      ).then(async (sync) => ({
        sync,
        ops: await runOpsNotify({
          db: env.UNLOCK_DB ?? null,
          mailer: opsMailerOf(env.OPS_MAIL),
          fromEmail: env.OPS_MAIL_FROM,
          toEmail: env.OPS_MAIL_TO,
          nowMs: nowSec * 1000,
          sync,
        }),
      })),
    );
  },
};

export default worker;
