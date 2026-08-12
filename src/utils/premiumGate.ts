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

/** bodyId 是否属于付费近观细节层（heliopause 等免费内容恒 false） */
export function isPremiumDetailBody(bodyId: string): boolean {
  return PREMIUM_DETAIL_BODY_IDS.has(bodyId);
}

/** 已解锁权益（U2 store 持有形态；由 verifyToken 通过后的 payload 降维而来） */
export interface UnlockEntitlement {
  readonly tier: UnlockTier;
  /** 过期时刻（epoch 秒） */
  readonly expSec: number;
}

/**
 * 细节层权益门（U2 在 detailGateUpdate 前叠加调用）：
 * - 免费天体（不在白名单）→ 恒放行；
 * - 付费天体 → 需持有未过期权益（`expSec > nowSec`；expSec 非有限数判拒绝）。
 */
export function premiumGateAllows(
  entitlement: UnlockEntitlement | null,
  bodyId: string,
  nowSec: number,
): boolean {
  if (!isPremiumDetailBody(bodyId)) return true;
  if (entitlement === null) return false;
  return Number.isFinite(entitlement.expSec) && entitlement.expSec > nowSec;
}
