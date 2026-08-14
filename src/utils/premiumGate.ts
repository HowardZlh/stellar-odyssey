/**
 * 付费天体白名单与权益判定（U1-3，REQUIREMENTS_UNLOCK.md §U1-3）
 *
 * 白名单收录口径：主应用全部 `useDetailLayer` 消费方的 bodyId
 * （近观细节层 = 付费物），**排除 Heliopause（`heliopause`）及一切
 * L1/L2 内容**；dev preview 专用 id（`/dev/preview` 工位）不入名单。
 *
 * 盘点登记（2026-08，逐一核对 useDetailLayer 消费方；来源模块见行内注释）：
 * 唯一 bodyId 共 25 项，排除免费 heliopause 后入名单 24 项。
 * `cluster-lensing`（星系团透镜特殊天体）无 useDetailLayer 消费方，不入名单。
 */
import type { UnlockTier } from "@/data/unlockPricing";

/**
 * 付费近观细节层 bodyId 白名单（24 项）
 *
 * 来源摘录（文件行号随版本漂移，以符号名为准）：
 * - 特殊天体近观 particles（SpecialBodies.useNearViewGate，
 *   id 定义于 `src/data/specialBodies.ts`）：betelgeuse / rigel / sirius /
 *   delta-cephei / wr-124 / crab-pulsar / orion-nebula / ring-nebula /
 *   horsehead-nebula / m13-cluster（其中 wr-124/crab-pulsar/orion-nebula/
 *   ring-nebula/horsehead-nebula 兼含 nebulaVolumeScene 体积层）
 * - 黑洞引力透镜 lensing（`blackHoleScene.BLACK_HOLE_LENSED_CONFIGS`）：
 *   sgr-a-star / cygnus-x1
 * - 星表近观 starCatalog（`pleiadesCatalog.pleiadesCatalogDetailLayerSpec`）：pleiades
 * - 河外近观（`quasarNearView.QUASAR_BODY_ID` / `antennaeNearView.ANTENNAE_BODY_ID`
 *   / `grbNearView.GRB_BODY_ID`）：quasar-3c273 / antennae-galaxies / grb-221009a
 * - 星系近观 particles（`galaxyNearView.GALAXY_NEAR_VIEW_CONFIGS` 全 8 项；
 *   m31/m33/lmc 兼含 `galaxyDustVolume` 体积层，m87 兼含 M87Environment
 *   星表/lensing 层）：m31 / m33 / lmc / smc / m87 / m32 / m110 /
 *   sagittarius-dwarf
 */
export const PREMIUM_DETAIL_BODY_IDS: ReadonlySet<string> = new Set([
  // 特殊天体近观（src/data/specialBodies.ts）
  "betelgeuse",
  "rigel",
  "sirius",
  "delta-cephei",
  "wr-124",
  "crab-pulsar",
  "orion-nebula",
  "ring-nebula",
  "horsehead-nebula",
  "m13-cluster",
  // 黑洞引力透镜（src/utils/blackHoleScene.ts）
  "sgr-a-star",
  "cygnus-x1",
  // 星表/河外近观（pleiadesCatalog / quasarNearView / antennaeNearView / grbNearView）
  "pleiades",
  "quasar-3c273",
  "antennae-galaxies",
  "grb-221009a",
  // 星系近观（src/utils/galaxyNearView.ts GALAXY_NEAR_VIEW_CONFIGS）
  "m31",
  "m33",
  "lmc",
  "smc",
  "m87",
  "m32",
  "m110",
  "sagittarius-dwarf",
]);

/**
 * bodyId 是否属于付费近观细节层（heliopause 等免费内容恒 false）
 *
 * @param premiumBodyIds 白名单（A1-2 远程配置注入点：整表替换语义，
 *   缺省 = 代码默认 24 项）
 */
export function isPremiumDetailBody(
  bodyId: string,
  premiumBodyIds: ReadonlySet<string> = PREMIUM_DETAIL_BODY_IDS,
): boolean {
  return premiumBodyIds.has(bodyId);
}

/** 已解锁权益（U2 store 持有形态；由 verifyToken 通过后的 payload 降维而来） */
export interface UnlockEntitlement {
  readonly tier: UnlockTier;
  /** 过期时刻（epoch 秒） */
  readonly expSec: number;
}

/**
 * 细节层门控可选参数（A1-2 远程配置注入点；缺省行为与旧版全等）
 *
 * 限免旁路形态登记（§A1-2 二选一）：调用方（A3）自行以
 * `remoteFreeWindowActive(config.detail?.freeWindow, nowMs)` 判定后传入
 * 布尔 `freeWindowActive`——本模块不引入时钟/freeWindow 判定第二副本。
 */
export interface PremiumGateOptions {
  /** 白名单整表替换（缺省 = 代码默认 `PREMIUM_DETAIL_BODY_IDS` 24 项） */
  readonly premiumBodyIds?: ReadonlySet<string>;
  /** 细节层限免旁路（true = 期内全免，无视白名单与权益） */
  readonly freeWindowActive?: boolean;
}

/**
 * 细节层权益门（U2 在 detailGateUpdate 前叠加调用）：
 * - 限免旁路生效（`options.freeWindowActive === true`）→ 恒放行；
 * - 免费天体（不在白名单）→ 恒放行；
 * - 付费天体 → 需持有未过期权益（`expSec > nowSec`；expSec 非有限数判拒绝）。
 */
export function premiumGateAllows(
  entitlement: UnlockEntitlement | null,
  bodyId: string,
  nowSec: number,
  options?: PremiumGateOptions,
): boolean {
  if (options?.freeWindowActive === true) return true;
  if (!isPremiumDetailBody(bodyId, options?.premiumBodyIds)) return true;
  if (entitlement === null) return false;
  return Number.isFinite(entitlement.expSec) && entitlement.expSec > nowSec;
}

/** premiumDetailGateUpdate 判定结果 */
export interface PremiumDetailGateResult {
  /** 叠加权益判定后的门控激活态（无权益的付费天体强制 false） */
  readonly active: boolean;
  /** 本帧命中锁定（原门控已激活但被权益拦截）——调用方据此上报 lockedHint */
  readonly lockedHit: boolean;
}

/**
 * 细节层权益叠加判定（U2-2 纯函数本体，useDetailLayer 在
 * `detailGateUpdate` 之后串接）：
 * - 免费天体 / 有效权益 / 限免旁路：原判定结果原样透传（现状零差异）；
 * - 付费天体且无有效权益：强制 inactive，原判定为激活时报告 lockedHit
 *   （细节层不挂载，沿用既有淡出路径）。
 */
export function premiumDetailGateUpdate(
  gateActive: boolean,
  entitlement: UnlockEntitlement | null,
  bodyId: string,
  nowSec: number,
  options?: PremiumGateOptions,
): PremiumDetailGateResult {
  if (!gateActive || premiumGateAllows(entitlement, bodyId, nowSec, options)) {
    return { active: gateActive, lockedHit: false };
  }
  return { active: false, lockedHit: true };
}
