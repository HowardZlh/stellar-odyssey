/**
 * 捐赠名单纯逻辑（捐赠页 /donate）
 *
 * 名单数据在 src/data/donors.ts 人工登记（本项目为静态导出、无后端，
 * 各捐赠平台亦无公开 API 可自动拉取）；渲染前经 sortDonorsByAmountDesc
 * 按金额降序排列——数据文件无需手工保序。
 */

/** 捐赠平台 id（与 data/donationPlatforms.ts 注册表对应） */
export type DonationPlatformId =
  'afdian' | 'wechat' | 'github-sponsors' | 'kofi' | 'buymeacoffee';

/** 单条捐赠登记（跨平台金额统一折算为人民币元） */
export interface DonorRecord {
  /** 显示昵称（捐赠者公开昵称或其指定的展示名） */
  name: string;
  /** 累计捐赠金额（人民币元；外币按登记日汇率折算） */
  amountCny: number;
  /** 捐赠平台 */
  platform: DonationPlatformId;
  /** 最近一次捐赠日期（YYYY-MM-DD） */
  date: string;
  /** 可选留言 */
  message?: string;
}

/**
 * 按捐赠金额降序排列（金额相同按昵称字典序，保证顺序稳定）；
 * 纯函数，不修改入参。
 */
export function sortDonorsByAmountDesc(
  donors: readonly DonorRecord[],
): DonorRecord[] {
  return [...donors].sort(
    (a, b) => b.amountCny - a.amountCny || a.name.localeCompare(b.name),
  );
}
