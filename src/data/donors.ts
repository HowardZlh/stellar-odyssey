/**
 * 捐赠名单登记（捐赠页 /donate 消费）
 *
 * 人工维护：新增捐赠时在数组末尾追加一条即可（无需保序——渲染前经
 * utils/donors.ts sortDonorsByAmountDesc 按金额降序排列）。
 * 跨平台金额统一折算为人民币元；昵称使用捐赠者公开昵称或其指定展示名。
 */
import type { DonorRecord } from '@/utils/donors';

/** 捐赠名单（当前为空名单上线，虚位以待） */
export const DONORS: readonly DonorRecord[] = [];
