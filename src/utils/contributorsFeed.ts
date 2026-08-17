/**
 * 贡献者名单动态拉取纯逻辑（Z 迭代 M2，REQUIREMENTS_ALIPAY_UNLOCK.md D-z4/§5.3）
 *
 * /contributors 页启动拉取 `GET /api/contributors`（Worker 读 D1
 * contributors 表，仅公开展示字段）并与静态 `DONORS` 合并展示；
 * 拉取失败静默降级为仅静态名单。本模块为可单测的解析/转换纯函数，
 * IO（fetch）留在页面侧。
 */
import type { DonationPlatformId, DonorRecord } from "@/utils/donors";
import { sortDonorsByAmountDesc } from "@/utils/donors";
import { REDEEM_API_DEFAULT_BASE } from "@/utils/unlockRedeem";

/** Worker 端点路径（M2 契约） */
export const CONTRIBUTORS_API_PATH = "/api/contributors";

/** API 基址解析（unlockRedeem 同机制） */
export function resolveContributorsApiUrl(baseOverride?: string | null): string {
  const trimmed = baseOverride?.trim() ?? "";
  const base =
    trimmed === "" ? REDEEM_API_DEFAULT_BASE : trimmed.replace(/\/+$/, "");
  return `${base}${CONTRIBUTORS_API_PATH}`;
}

/** 动态名单条目（Worker ContributorEntry 契约投影） */
export interface RemoteContributor {
  readonly nickname: string | null;
  readonly message: string | null;
  readonly channel: string;
  readonly amountCny: number | null;
  readonly date: string;
}

/** 已注册平台 id 白名单（未知渠道回退 alipay 徽标，防御数据漂移） */
const KNOWN_PLATFORMS: readonly DonationPlatformId[] = [
  "afdian",
  "wechat",
  "github-sponsors",
  "kofi",
  "buymeacoffee",
  "alipay",
];

/**
 * 响应体解析（unknown → 契约类型）：形状不符返回 null（页面静默降级）；
 * 条目逐项防御，非法条目丢弃不拖垮整单。
 */
export function parseContributorsResponse(
  raw: unknown,
): RemoteContributor[] | null {
  if (typeof raw !== "object" || raw === null) return null;
  const rec = raw as Record<string, unknown>;
  if (rec.ok !== true || !Array.isArray(rec.contributors)) return null;
  const out: RemoteContributor[] = [];
  for (const item of rec.contributors) {
    if (typeof item !== "object" || item === null) continue;
    const e = item as Record<string, unknown>;
    if (typeof e.channel !== "string" || typeof e.date !== "string") continue;
    out.push({
      nickname:
        typeof e.nickname === "string" && e.nickname !== "" ? e.nickname : null,
      message:
        typeof e.message === "string" && e.message !== "" ? e.message : null,
      channel: e.channel,
      amountCny:
        typeof e.amountCny === "number" && Number.isFinite(e.amountCny)
          ? e.amountCny
          : null,
      date: e.date,
    });
  }
  return out;
}

/**
 * 动态条目 → DonorRecord（贡献者宇宙/文字名单共用形态）：
 * 空昵称显示传入的匿名展示名（i18n `contributors.anonymous`，E3/D4）；
 * 金额缺失防御回退 0（正常路径 create 均落金额）；id 以 `remote-` 前缀
 * 与静态名单区隔（布点确定性由昵称+平台派生，与 id 无关）。
 */
export function remoteContributorsToDonors(
  entries: readonly RemoteContributor[],
  anonymousName: string,
): DonorRecord[] {
  return entries.map((e, i) => ({
    id: `remote-${i}`,
    name: e.nickname ?? anonymousName,
    amountCny: e.amountCny ?? 0,
    platform: (KNOWN_PLATFORMS as readonly string[]).includes(e.channel)
      ? (e.channel as DonationPlatformId)
      : "alipay",
    date: e.date,
    ...(e.message !== null ? { message: e.message } : {}),
  }));
}

/** 静态 DONORS + 动态名单合并（金额降序，排序器与既有页面同源） */
export function mergeDonorLists(
  staticDonors: readonly DonorRecord[],
  remote: readonly DonorRecord[],
): DonorRecord[] {
  return sortDonorsByAmountDesc([...staticDonors, ...remote]);
}
