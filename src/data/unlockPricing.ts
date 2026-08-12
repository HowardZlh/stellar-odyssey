/**
 * 解锁定价档位单一事实源（U1-1，REQUIREMENTS_UNLOCK.md §U1-1 / §0.4）
 *
 * 价格同源纪律（§0.4 登记）：前端与 Cloudflare Worker 共享本模块
 * （Worker 侧经相对路径 import，由 wrangler 打包复用，禁止复制两份）；
 * 站外副本（爱发电商品页价格、运营手册、docs 教程）人工同步。
 *
 * 环境无关纪律（硬约束）：本模块禁止引入 React/浏览器/Node 专属 API，
 * 保持浏览器 / Cloudflare Worker / jest 三端可直跑。
 */

/** 解锁档位标识（§0.5 冻结契约中 token payload 的 `tier` 字段取值） */
export type UnlockTier = "week" | "month" | "year";

/** 单档位定价规格 */
export interface UnlockTierSpec {
  /** 人民币定价（元） */
  readonly priceCny: number;
  /** 美元参考价（站外渠道展示用） */
  readonly priceUsd: number;
  /** 权益时长（天）；月卡多月时按 31 × 月数另算 */
  readonly days: number;
}

/** 三档定价（week ¥6/$1/7 天、month ¥15/$2.5/31 天、year ¥88/$13/366 天） */
export const UNLOCK_TIERS: Readonly<Record<UnlockTier, UnlockTierSpec>> = {
  week: { priceCny: 6, priceUsd: 1, days: 7 },
  month: { priceCny: 15, priceUsd: 2.5, days: 31 },
  year: { priceCny: 88, priceUsd: 13, days: 366 },
};

/** `resolveTierFromAmount` 判定结果（days 已含月卡多月折算） */
export interface ResolvedUnlockTier {
  readonly tier: UnlockTier;
  readonly days: number;
}

/**
 * 支付金额 → 档位判定（§0.6 自 stock_analysis 平移的判定顺序，改三档）：
 *
 * 1. `amountCny ≥ 88` → year（366 天）；
 * 2. `amountCny ≥ 15 × months` → month（31 × months 天）；
 * 3. `amountCny ≥ 6` → week（7 天）；
 * 4. 否则 → null（金额不足，Worker 侧对应 `amount_too_low`）。
 *
 * @param amountCny 实付人民币金额（非有限数一律判 null）
 * @param months 月卡月数（缺省 1；非有限数或 <1 防御回退 1，取整）
 */
export function resolveTierFromAmount(
  amountCny: number,
  months = 1,
): ResolvedUnlockTier | null {
  if (!Number.isFinite(amountCny)) return null;
  const safeMonths =
    Number.isFinite(months) && months >= 1 ? Math.floor(months) : 1;
  if (amountCny >= UNLOCK_TIERS.year.priceCny) {
    return { tier: "year", days: UNLOCK_TIERS.year.days };
  }
  if (amountCny >= UNLOCK_TIERS.month.priceCny * safeMonths) {
    return { tier: "month", days: UNLOCK_TIERS.month.days * safeMonths };
  }
  if (amountCny >= UNLOCK_TIERS.week.priceCny) {
    return { tier: "week", days: UNLOCK_TIERS.week.days };
  }
  return null;
}
