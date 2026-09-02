'use client';

/**
 * 燃料补给名单小节（/donate 与 /unlock 共享，统一贡献者展示）：
 * 标题（名单非空时带总计数）→ 排序说明 → 名单（金额降序，可 Top-N 截断）
 * → 贡献者宇宙入口。数据经 useContributorsRoster 共享 hook（静态 + 远程
 * 合并，与 /contributors 页同源）。
 *
 * 截断形态（maxItems，/unlock 传 5）：名单只显 Top-N，尾部以"幽灵行"链接
 * 体现更多支持者（`✨ 还有 {N} 位支持者——进入贡献者宇宙查看全部`，虚线
 * 边框延续名单视觉，整行可点 → /contributors）——真实计数的社会证明，
 * 人少（≤N）时不触发、不产生反向信号；未截断/空态时入口回退为普通
 * `✨ 进入贡献者宇宙` 链接。
 *
 * 文案红线：总计数与"还有 N 位"均为真实合并名单的事实陈述，禁止虚构；
 * 空态用 G9 正向口径。emoji（✨）由组件层持有（i18n 约定）。
 * 移动端：入口/幽灵行命中区 ≥44pt（min-h-11）。
 */

import type { JSX } from 'react';
import Link from 'next/link';
import { useT, useTf } from '@/hooks/useI18n';
import { useContributorsRoster } from '@/hooks/useContributorsRoster';
import { CONTRIBUTORS_PAGE_PATH } from '@/utils/contributorUniverse';

interface ContributorsRosterSectionProps {
  /** 名单最多展示条数（不传 = 全量；/unlock 传 5 控制页长） */
  maxItems?: number;
}

export function ContributorsRosterSection({
  maxItems,
}: ContributorsRosterSectionProps): JSX.Element {
  const tr = useT();
  const trf = useTf();
  const donors = useContributorsRoster();

  const truncated = maxItems !== undefined && donors.length > maxItems;
  const visible = truncated ? donors.slice(0, maxItems) : donors;

  return (
    <section className="mt-10">
      <h2 className="mb-1 text-sm font-semibold text-gray-300">
        {tr('roster.title')}
        {donors.length > 0 && (
          <span className="ml-2 font-normal text-gray-500">
            {trf('roster.titleCount', { count: donors.length })}
          </span>
        )}
      </h2>
      <p className="mb-3 text-[10px] text-gray-500">{tr('roster.note')}</p>
      {donors.length === 0 ? (
        <p className="rounded-lg border border-dashed border-white/15 bg-space-panel p-6 text-center text-xs text-gray-400 backdrop-blur">
          ✨ {tr('roster.empty')}
        </p>
      ) : (
        <ol className="space-y-2">
          {visible.map((donor, index) => (
            <li
              key={`${donor.id}`}
              className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-space-panel px-4 py-3 backdrop-blur"
            >
              <span className="flex min-w-0 items-center gap-3">
                <span className="shrink-0 font-mono text-xs text-gray-500">
                  #{index + 1}
                </span>
                <span className="truncate text-sm text-gray-200">
                  {donor.name}
                </span>
                {donor.message && (
                  <span className="truncate text-xs text-gray-500">
                    「{donor.message}」
                  </span>
                )}
              </span>
              <span className="shrink-0 text-sm font-medium text-amber-200/90">
                {trf('roster.amount', {
                  amount: donor.amountCny.toLocaleString('en-US'),
                })}
              </span>
            </li>
          ))}
        </ol>
      )}
      {truncated ? (
        <Link
          href={CONTRIBUTORS_PAGE_PATH}
          className="mt-2 flex min-h-11 items-center justify-center gap-2 rounded-lg border border-dashed border-space-accent/40 bg-space-panel/60 px-4 text-xs text-space-accent backdrop-blur transition-colors hover:border-space-accent/70 hover:text-white"
        >
          ✨{' '}
          {trf('roster.moreLink', { count: donors.length - visible.length })}
        </Link>
      ) : (
        <Link
          href={CONTRIBUTORS_PAGE_PATH}
          className="mt-3 flex min-h-11 items-center justify-center gap-2 rounded-lg border border-space-accent/30 bg-space-panel px-4 text-xs text-space-accent backdrop-blur transition-colors hover:border-space-accent/60 hover:text-white"
        >
          ✨ {tr('roster.entry')}
        </Link>
      )}
    </section>
  );
}
