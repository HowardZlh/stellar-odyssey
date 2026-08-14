'use client';

import type { JSX } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useLocale, useT, useTf } from '@/hooks/useI18n';
import { useUnlockInit } from '@/hooks/useUnlockInit';
import { useSimulationStore } from '@/store';
import {
  previewEntryForBody,
  registeredPreviewIds,
  PREVIEW_REGISTRY,
  type PreviewEntry,
} from '@/utils/devPreview';
import {
  isPremiumObservatoryBody,
  observatoryAccessUpdate,
  observatoryFreeWindowActive,
  observatoryRemaining,
  type ObservatoryAccessResult,
} from '@/utils/observatoryGate';
import { resolveRemoteObservatoryGateConfig } from '@/utils/remoteGateConfigClient';
import {
  persistObservatoryQuota,
  readStoredObservatoryQuota,
} from '@/utils/observatoryStorage';
import {
  LAB_PAGE_PATH,
  OBSERVATORY_PAGE_PATH,
  observatoryBodyPath,
} from '@/utils/lab';
import { UNLOCK_PAGE_PATH } from '@/utils/unlockPage';

/**
 * 天体观察站主组件（O1，REQUIREMENTS_OBSERVATORY.md）
 *
 * 两形态（画廊 `/lab/observatory` 与单天体 `/lab/observatory/<id>` 两条
 * 路由共用本组件，经 bodyId prop 分流；旧 `?body=<id>` 查询串由画廊页
 * 兼容解析）：
 * - bodyId 为 null / 未注册 id → 画廊页（观察对象卡片 + 门控额度横幅）；
 * - 已注册 id → 门控判定（`observatoryAccessUpdate` 纯函数 + localStorage
 *   持久化，每次进入都计次）→ 放行挂载观察工位 / 拒绝显示锁定提示。
 * 画廊 ↔ 观察为跨路由段导航（`observatoryBodyPath` 路径形态），软/硬
 * 导航均正确重挂载。
 *
 * 权益恢复经 useUnlockInit（挂载一次 restore + 30s 到期 tick，与主应用
 * 同源）；门控判定在 effect 中读取 `getState().entitlement`（restore 先于
 * 本组件判定 effect 执行——同组件内 hook 声明序保证）。
 *
 * 观察工位 chunk 嵌套 dynamic：画廊访问不拉取 three/R3F 场景代码。
 */

/** 场景 chunk 加载提示（meteor-shower 页同范式） */
function SceneLoading(): JSX.Element {
  const tr = useT();
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-black">
      <p className="animate-pulse rounded-lg bg-black/60 px-4 py-2 text-sm text-gray-300">
        {tr('lab.loadingScene')}
      </p>
    </div>
  );
}

const ObservatoryHarness = dynamic(
  () => import('@/components/Lab/ObservatoryHarness').then((m) => m.ObservatoryHarness),
  { ssr: false, loading: () => <SceneLoading /> },
);

/** 门控横幅信息（渲染纯度纪律：时钟/存储读取在 effect 完成，不在渲染期） */
interface GateBanner {
  freeWindowActive: boolean;
  freeWindowEndMs: number;
  entitled: boolean;
  remaining: number;
  premiumRemaining: number;
}

/** 画廊页（23 个观察对象卡片 + 门控额度横幅 + zh/EN 切换） */
function ObservatoryGallery({ unknownBodyId }: { unknownBodyId: string | null }): JSX.Element {
  const tr = useT();
  const trf = useTf();
  const locale = useLocale();
  const setLocale = useSimulationStore((s) => s.setLocale);
  const entitlement = useSimulationStore((s) => s.entitlement);
  const [banner, setBanner] = useState<GateBanner | null>(null);
  // A3：远程 observatory 域覆盖注入（订阅 store——本组件为 DOM 层非 3D
  // 场景；引用仅在 applyRemoteGateConfig 时更换，useMemo 防逐渲染重解析）
  const remoteObservatory = useSimulationStore((s) => s.remoteGateConfig.observatory);
  const config = useMemo(
    () => resolveRemoteObservatoryGateConfig(remoteObservatory),
    [remoteObservatory],
  );

  // 额度横幅：entitlement 恢复/远程配置注入后重算（读时钟与 localStorage，
  // effect 内完成；限免文案/剩余额度随注入配置自动正确）
  useEffect(() => {
    const now = Date.now();
    const { remaining, premiumRemaining } = observatoryRemaining(
      config,
      readStoredObservatoryQuota(),
      now,
    );
    setBanner({
      freeWindowActive: observatoryFreeWindowActive(config, now),
      freeWindowEndMs: Date.parse(config.freeWindow.endUtc),
      entitled: entitlement !== null,
      remaining,
      premiumRemaining,
    });
  }, [entitlement, config]);

  return (
    <main className="hud-scroll fixed inset-0 overflow-y-auto bg-space-dark pb-[calc(2.5rem+env(safe-area-inset-bottom))] pl-[max(1.5rem,env(safe-area-inset-left))] pr-[max(1.5rem,env(safe-area-inset-right))] pt-[max(2.5rem,env(safe-area-inset-top))] text-gray-200">
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_50%_30%,rgba(30,52,96,0.4),rgba(10,10,20,0)_65%)]"
      />

      <div className="relative mx-auto max-w-4xl touch-manipulation">
        {/* 顶部：返回实验室 + 语言切换（/lab 首页同款布局） */}
        <div className="flex items-center justify-between text-xs">
          <Link
            href={LAB_PAGE_PATH}
            className="text-space-accent hover:underline max-md:-my-3 max-md:inline-flex max-md:min-h-11 max-md:items-center"
          >
            ← {tr('lab.backToLab')}
          </Link>
          <div
            role="group"
            aria-label="Language"
            className="flex overflow-hidden rounded border border-white/15 text-[10px] leading-none"
          >
            <button
              type="button"
              onClick={() => setLocale('zh')}
              aria-pressed={locale === 'zh'}
              className={`px-1.5 py-1 max-md:px-4 max-md:py-3.5 max-md:text-xs ${
                locale === 'zh' ? 'bg-space-accent text-black' : 'text-gray-400 hover:text-white'
              }`}
            >
              zh
            </button>
            <button
              type="button"
              onClick={() => setLocale('en')}
              aria-pressed={locale === 'en'}
              className={`px-1.5 py-1 max-md:px-4 max-md:py-3.5 max-md:text-xs ${
                locale === 'en' ? 'bg-space-accent text-black' : 'text-gray-400 hover:text-white'
              }`}
            >
              EN
            </button>
          </div>
        </div>

        <header className="mt-8 text-center">
          <h1 className="text-3xl font-semibold text-space-accent">🔭 {tr('lab.observatoryTitle')}</h1>
          <p className="mt-2 text-sm text-gray-400">{tr('lab.observatoryDescription')}</p>
        </header>

        {/* 门控额度横幅（免费期/权益/剩余次数三态） */}
        {banner && (
          <section className="mt-6 rounded-lg border border-white/10 bg-space-panel px-4 py-3 text-center text-xs text-gray-300 backdrop-blur">
            {banner.entitled ? (
              <p className="text-emerald-300">{tr('lab.observatoryEntitledNote')}</p>
            ) : banner.freeWindowActive ? (
              <p className="text-sky-300">
                {trf('lab.observatoryFreeWindowNote', {
                  date: new Date(banner.freeWindowEndMs).toLocaleDateString(
                    locale === 'zh' ? 'zh-CN' : 'en',
                  ),
                })}
              </p>
            ) : (
              <>
                <p>{trf('lab.observatoryQuotaLine', { count: banner.remaining })}</p>
                <p className="mt-1 text-gray-400">
                  {trf('lab.observatoryPremiumQuotaLine', { count: banner.premiumRemaining })}
                </p>
              </>
            )}
          </section>
        )}

        {/* 未注册 ?body 直达提示 */}
        {unknownBodyId !== null && (
          <p className="mt-4 text-center text-xs text-amber-400">
            {tr('lab.observatoryUnknownBody')}：{unknownBodyId}
          </p>
        )}

        {/* 观察对象卡片（devPreview 注册表驱动，注册序渲染） */}
        <section className="mt-8 grid gap-4 sm:grid-cols-2">
          <h2 className="sr-only">{tr('lab.observatoryPickBody')}</h2>
          {registeredPreviewIds().map((id) => {
            const entry = PREVIEW_REGISTRY.get(id)!;
            const premium = isPremiumObservatoryBody(config, id);
            return (
              <article
                key={id}
                className="flex flex-col rounded-xl border border-white/10 bg-space-panel p-4 backdrop-blur"
              >
                <h3 className="text-sm font-medium text-sky-300">
                  {entry.titleKey ? tr(entry.titleKey) : entry.title}
                </h3>
                {premium && (
                  <p className="mt-1 text-[10px] text-amber-300/90">
                    {tr('lab.observatoryPremiumBadge')}
                  </p>
                )}
                {/* 数据来源署名（豁免惯例：保持原文，不入 i18n 字典） */}
                {entry.dataSource && (
                  <p className="mt-2 line-clamp-3 text-[10px] leading-4 text-gray-600">
                    {tr('lab.dataSourceLabel')}：{entry.dataSource}
                  </p>
                )}
                <Link
                  href={observatoryBodyPath(id)}
                  className="mt-auto inline-flex min-h-11 items-center justify-center self-start rounded bg-space-accent/90 px-4 pt-0.5 text-xs text-black transition-colors hover:bg-space-accent"
                >
                  {tr('lab.observatoryEnter')} →
                </Link>
              </article>
            );
          })}
        </section>

        <footer className="mt-12 pb-6 text-center text-xs text-gray-500">
          <Link
            href={LAB_PAGE_PATH}
            className="text-space-accent hover:underline max-md:inline-flex max-md:min-h-11 max-md:items-center max-md:px-2"
          >
            {tr('lab.backToLab')}
          </Link>
        </footer>
      </div>
    </main>
  );
}

/** 锁定提示页（每日额度/试玩额度用尽；解锁轨口径，链接 /unlock 新标签页） */
function ObservatoryLocked({ result }: { result: ObservatoryAccessResult }): JSX.Element {
  const tr = useT();
  const trf = useTf();
  return (
    <main className="flex h-screen w-screen flex-col items-center justify-center gap-4 bg-space-dark px-6 text-center text-gray-200">
      <h1 className="text-xl font-semibold text-amber-300">
        🔒 {tr('lab.observatoryLockedTitle')}
      </h1>
      <p className="max-w-md text-sm leading-6 text-gray-300">
        {tr(
          result.denyReason === 'premium-exhausted'
            ? 'lab.observatoryLockedPremium'
            : 'lab.observatoryLockedDaily',
        )}
      </p>
      <p className="text-xs text-gray-500">
        {trf('lab.observatoryQuotaLine', { count: result.remaining })} ·{' '}
        {trf('lab.observatoryPremiumQuotaLine', { count: result.premiumRemaining })}
      </p>
      <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
        <a
          href={UNLOCK_PAGE_PATH}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={tr('unlock.lockedGoUnlockAria')}
          className="inline-flex min-h-11 items-center rounded bg-space-accent/90 px-5 text-xs text-black transition-colors hover:bg-space-accent"
        >
          {tr('unlock.lockedGoUnlock')}
        </a>
        <Link
          href={OBSERVATORY_PAGE_PATH}
          className="inline-flex min-h-11 items-center px-2 text-xs text-space-accent hover:underline"
        >
          ← {tr('lab.observatoryBackToGallery')}
        </Link>
      </div>
    </main>
  );
}

/** 观察场景门控包装：进入即消费一次额度（每次进入都计次，需求口径） */
function ObservatoryScene({ entry }: { entry: PreviewEntry }): JSX.Element {
  const [result, setResult] = useState<ObservatoryAccessResult | null>(null);
  // StrictMode 双跑 effect 防重复计次（ref 跨 setup/cleanup/setup 持存）
  const consumedForRef = useRef<string | null>(null);

  useEffect(() => {
    if (consumedForRef.current === entry.bodyId) return;
    consumedForRef.current = entry.bodyId;
    // A3：远程 observatory 域覆盖注入（进入时刻快照，effect 内 getState；
    // 缓存配置在 useUnlockInit 挂载 effect 已同步应用——先于本 effect 执行，
    // ObservatoryLab 的 restored 时序登记同样保证）
    const config = resolveRemoteObservatoryGateConfig(
      useSimulationStore.getState().remoteGateConfig.observatory,
    );
    const entitled = useSimulationStore.getState().entitlement !== null;
    const decision = observatoryAccessUpdate(
      config,
      readStoredObservatoryQuota(),
      entry.bodyId,
      entitled,
      Date.now(),
    );
    persistObservatoryQuota(decision.state);
    setResult(decision);
  }, [entry]);

  if (result === null) {
    return <SceneLoading />;
  }
  if (!result.allowed) {
    return <ObservatoryLocked result={result} />;
  }
  return <ObservatoryHarness entry={entry} />;
}

export interface ObservatoryLabProps {
  /** URL ?body=<id>（null = 画廊） */
  bodyId: string | null;
}

export function ObservatoryLab({ bodyId }: ObservatoryLabProps): JSX.Element {
  // 权益恢复 + 30s 到期检查（与主应用 useUnlockInit 同源）。
  // 时序登记：React 子组件 effect 先于父组件执行——若首帧即挂载
  // ObservatoryScene，其门控判定 effect 会先于本组件的 restore 执行，
  // 支持者首次进入会被误判免费态。因此场景挂载延迟到 restored 置位后
  // （restored 由本组件晚于 useUnlockInit 声明的 effect 置位，同组件内
  // effect 按声明序执行，restore 必已完成）。
  useUnlockInit();
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    setRestored(true);
  }, []);

  const entry = previewEntryForBody(bodyId);
  if (!restored) {
    return <SceneLoading />;
  }
  if (entry) {
    return <ObservatoryScene entry={entry} />;
  }
  return <ObservatoryGallery unknownBodyId={bodyId} />;
}

export default ObservatoryLab;
