/**
 * 贡献者名单共享 hook（统一 /donate、/unlock、/contributors 三页数据源）：
 * 启动拉取远程 /api/contributors 与静态 DONORS 合并（金额降序），支付宝
 * 自动上榜等远程贡献者三页同步可见——收敛此前 donate/contributors 两页
 * 各自持有的 fetch+merge 副本，杜绝数据源分裂。
 *
 * 降级口径（与 /contributors 页先例一致）：拉取失败/形状异常/fetch 缺失
 * 环境一律静默降级为仅静态名单，不展示报错 UI。
 *
 * 匿名展示名随 locale 切换（i18n `contributors.anonymous`）——名单随
 * locale 重派生为页面级数据流更新，非主场景重建，可接受（先例登记）。
 */

import { useEffect, useMemo, useState } from 'react';
import { t } from '@/i18n';
import { useSimulationStore } from '@/store';
import { DONORS } from '@/data/donors';
import type { DonorRecord } from '@/utils/donors';
import {
  mergeDonorLists,
  parseContributorsResponse,
  remoteContributorsToDonors,
  resolveContributorsApiUrl,
  type RemoteContributor,
} from '@/utils/contributorsFeed';

/** 名单 API（base 覆写机制与 unlockRedeem 同源） */
const CONTRIBUTORS_API_URL = resolveContributorsApiUrl(
  process.env.NEXT_PUBLIC_UNLOCK_API_BASE,
);

/** 合并后的贡献者名单（静态 + 远程，金额降序） */
export function useContributorsRoster(): readonly DonorRecord[] {
  const locale = useSimulationStore((s) => s.locale);
  const [remoteEntries, setRemoteEntries] = useState<RemoteContributor[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async (): Promise<void> => {
      try {
        const response = await fetch(CONTRIBUTORS_API_URL);
        const parsed = parseContributorsResponse(
          (await response.json()) as unknown,
        );
        // 空响应不 setState（初始态即空数组，语义等价；同时避免测试环境
        // 空名单响应在断言后落地触发 act 警告噪音）
        if (!cancelled && parsed !== null && parsed.length > 0) {
          setRemoteEntries(parsed);
        }
      } catch {
        // 静默降级：仅静态名单
      }
    })();
    return (): void => {
      cancelled = true;
    };
  }, []);

  return useMemo(
    () =>
      mergeDonorLists(
        DONORS,
        remoteContributorsToDonors(
          remoteEntries,
          t(locale, 'contributors.anonymous'),
        ),
      ),
    [remoteEntries, locale],
  );
}
