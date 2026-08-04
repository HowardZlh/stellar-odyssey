/**
 * 统一近观细节层管理（R4-2，IMPROVEMENT_REQUIREMENTS_4 §R4-2）
 *
 * 纯逻辑模块（供单元测试）：泛化 R2-7 nearView.ts 滞回门控与 R2-8
 * galaxyNearView.nearViewLruUpdate LRU 为统一"细节层类型注册 + 门控 +
 * LRU 分池 + GPU 显存预算"机制。后续体积层（R4-8）/引力透镜（R4-13）/
 * 真实星表（R4-17）经 DetailLayerKind 扩展挂接，勿另造门控。
 *
 * ── 门控语义（与 R2-7 现状逐项一致，行为零回退）─────────────────────────
 * - 进入：正在跟随/飞往本目标（focused）且 距离 < enterDistanceUnits
 *   （enter = 飞往观察距离 × NEAR_VIEW_ENTER_RATIO=1.5，与
 *   cameraFocus.resolveFocusTarget 同源，单测断言）
 * - 退出：焦点离开本目标 或 距离 > exitDistanceUnits
 *   （exit = enter × NEAR_VIEW_EXIT_RATIO=1.4，滞回防抖）
 * - 淡入淡出 0.5s（DETAIL_LAYER_TRANSITION_SECONDS，nearView.
 *   NEAR_VIEW_TRANSITION_SECONDS 同值同源）
 *
 * ── LRU 分池与预算（附录 A 硬性约束）────────────────────────────────────
 * - LRU 按 kind 分池：particles 沿用 R2-8 容量 1；volume/lensing/
 *   starCatalog 各容量 1（DETAIL_LRU_CAPACITY_BY_KIND）
 * - GPU 显存估算：estimateGpuBytes（粒子按 float32 属性布局
 *   position3+color3+size1 = 28 B/粒，与 GalaxyNearView.tsx 几何布局
 *   一致；体积纹理按 分辨率³ × 通道 × 字节）
 * - 总预算 DETAIL_GPU_BUDGET_BYTES = 64 MB：注册表挂载前先按池容量
 *   逐出，仍超限则跨池按最旧优先继续逐出（新层自身不被逐出）
 *
 * ── 注册表（渲染端单例，测试可重置）─────────────────────────────────────
 * 镜像 galaxyNearView 持有者注册表 / satellitePhase 注册表范式：
 * claimDetailLayer 声明持有权并返回被逐出者（组件侧卸载 dispose），
 * releaseDetailLayer 主动释放（L3"退出即释放"语义），组件按
 * detailLayerHolderIds(kind) 决定挂载（L4 LRU 保留语义）。
 */

// ---------------------------------------------------------------------------
// 类型与常量
// ---------------------------------------------------------------------------

/** 细节层类型（可扩展：R4-8 体积 / R4-13 透镜 / R4-17 真实星表） */
export type DetailLayerKind = 'particles' | 'volume' | 'lensing' | 'starCatalog';

/** 细节层资源预算登记（估算依据见 estimateGpuBytes） */
export interface DetailLayerBudget {
  /** 粒子数（points/sprites 合并计数，附录 A 单目标 ≤12,000） */
  particles?: number;
  /** 体积纹理字节数（≤128³ 约束由 volumeTextureGpuBytes 校验） */
  volumeTexBytes?: number;
  /** GPU 显存估算总量（字节，注册表预算判据；一般 = estimateGpuBytes） */
  gpuBytesEstimate: number;
}

/** 细节层注册规格 */
export interface DetailLayerSpec {
  /** 天体 id（跟随/飞往判据与 store.followBodyId/flyToBodyId 对齐） */
  bodyId: string;
  kind: DetailLayerKind;
  /** 进入阈值（场景单位）= 飞往观察距离 × 1.5（与 resolveFocusTarget 同源） */
  enterDistanceUnits: number;
  /** 退出阈值（场景单位）= 进入阈值 × 1.4（滞回防抖） */
  exitDistanceUnits: number;
  budget: DetailLayerBudget;
}

/** 细节层淡入淡出过渡时长（秒；R2-7 NEAR_VIEW_TRANSITION_SECONDS 同源） */
export const DETAIL_LAYER_TRANSITION_SECONDS = 0.5;

/** 细节层 GPU 显存估算总预算（附录 A：≤64 MB，超限先逐出再挂载） */
export const DETAIL_GPU_BUDGET_BYTES = 64 * 1024 * 1024;

/** LRU 池容量（按 kind 分池；particles 沿用 R2-8 容量 1，其余各 1） */
export const DETAIL_LRU_CAPACITY_BY_KIND: Readonly<Record<DetailLayerKind, number>> = {
  particles: 1,
  volume: 1,
  lensing: 1,
  starCatalog: 1,
};

/**
 * 单粒子 GPU 字节估算：float32 属性布局 position(3) + color(3) + size(1)
 * = 7 × 4 B（与 GalaxyNearView.tsx BufferGeometry 属性一致）
 */
export const GPU_BYTES_PER_PARTICLE = 7 * 4;

/** 体积纹理单边分辨率上限（附录 A：≤128³） */
export const VOLUME_TEXTURE_MAX_SIZE = 128;

// ---------------------------------------------------------------------------
// 门控状态机（泛化 R2-7 nearViewGateUpdate，语义逐项一致）
// ---------------------------------------------------------------------------

/** 门控更新结果（与 nearView.NearViewGateResult / planetDetail 同构） */
export interface DetailGateResult {
  /** 细节层是否激活（挂载/渲染） */
  active: boolean;
  /** 是否应立即释放该目标细节层资源（离开跟随语境/超出退出距离） */
  releaseNow: boolean;
}

/**
 * 细节层门控状态机（每帧调用，滞回防抖；泛化 R2-7 nearViewGateUpdate）：
 * - 未激活 → 激活：正在跟随/飞往本目标（focused）且 距离 < 进入阈值
 * - 激活 → 未激活：焦点离开本目标 或 距离 > 退出阈值
 * - releaseNow：退出即置真（L3"退出即释放"语义；L4 LRU 保留由注册表决定）
 */
export function detailGateUpdate(
  prevActive: boolean,
  focused: boolean,
  distanceToBodyUnits: number,
  enterDistanceUnits: number,
  exitDistanceUnits: number,
): DetailGateResult {
  if (!Number.isFinite(distanceToBodyUnits) || distanceToBodyUnits < 0) {
    throw new RangeError(`相机距离必须为非负有限数，收到 ${distanceToBodyUnits}`);
  }
  if (!Number.isFinite(enterDistanceUnits) || enterDistanceUnits <= 0) {
    throw new RangeError(`进入阈值必须为正有限数，收到 ${enterDistanceUnits}`);
  }
  if (!Number.isFinite(exitDistanceUnits) || exitDistanceUnits < enterDistanceUnits) {
    throw new RangeError(
      `退出阈值必须为 ≥进入阈值的有限数（滞回），收到 ${exitDistanceUnits}`,
    );
  }
  if (prevActive) {
    const exit = !focused || distanceToBodyUnits > exitDistanceUnits;
    if (exit) {
      return { active: false, releaseNow: true };
    }
    return { active: true, releaseNow: false };
  }
  const enter = focused && distanceToBodyUnits < enterDistanceUnits;
  return { active: enter, releaseNow: false };
}

// ---------------------------------------------------------------------------
// LRU（泛化 R2-8 nearViewLruUpdate，语义逐项一致）
// ---------------------------------------------------------------------------

/** LRU 更新结果（与 galaxyNearView.NearViewLruResult 同构） */
export interface DetailLruResult {
  /** 更新后的持有者列表（最新在前） */
  holders: readonly string[];
  /** 因超出容量被挤出、应立即释放细节层资源的 id */
  releasedIds: readonly string[];
}

/**
 * 细节层 LRU 更新（纯函数；泛化 R2-8 nearViewLruUpdate）：
 * activeId 为 null 时保持现状（离开跟随后细节层淡出但保留在 LRU 内，
 * 便于快速切回）；非 null 时提升为最新持有者，超容量的旧持有者进入
 * releasedIds（组件侧卸载 dispose）。
 */
export function detailLruUpdate(
  holders: readonly string[],
  activeId: string | null,
  capacity: number,
): DetailLruResult {
  if (!Number.isInteger(capacity) || capacity < 1) {
    throw new RangeError(`LRU 容量必须为正整数，收到 ${capacity}`);
  }
  if (activeId === null) {
    return { holders, releasedIds: [] };
  }
  const next = [activeId, ...holders.filter((id) => id !== activeId)];
  return { holders: next.slice(0, capacity), releasedIds: next.slice(capacity) };
}

// ---------------------------------------------------------------------------
// GPU 显存估算（纯函数）
// ---------------------------------------------------------------------------

/**
 * 体积纹理 GPU 字节估算：分辨率三次方 × 通道数 × 每通道字节数
 * （R4-3 Data3DTexture：R8 单通道 1 B；分辨率 ≤128 附录 A 约束）
 */
export function volumeTextureGpuBytes(
  size: number,
  channels: number,
  bytesPerChannel = 1,
): number {
  if (!Number.isInteger(size) || size < 1 || size > VOLUME_TEXTURE_MAX_SIZE) {
    throw new RangeError(`体积纹理分辨率必须为 1–${VOLUME_TEXTURE_MAX_SIZE} 整数，收到 ${size}`);
  }
  if (!Number.isInteger(channels) || channels < 1 || channels > 4) {
    throw new RangeError(`通道数必须为 1–4 整数，收到 ${channels}`);
  }
  if (!Number.isInteger(bytesPerChannel) || bytesPerChannel < 1 || bytesPerChannel > 4) {
    throw new RangeError(`每通道字节数必须为 1–4 整数，收到 ${bytesPerChannel}`);
  }
  return size * size * size * channels * bytesPerChannel;
}

/**
 * 细节层 GPU 显存估算（字节）：
 * 粒子按 float32 属性布局（GPU_BYTES_PER_PARTICLE=28 B/粒）+
 * 体积纹理按登记字节数（volumeTexBytes，构建侧经 volumeTextureGpuBytes
 * 估算）。调用方以此填充 spec.budget.gpuBytesEstimate（注册表预算判据）。
 */
export function estimateGpuBytes(
  budget: Pick<DetailLayerBudget, 'particles' | 'volumeTexBytes'>,
): number {
  const particles = budget.particles ?? 0;
  const volumeTexBytes = budget.volumeTexBytes ?? 0;
  if (!Number.isInteger(particles) || particles < 0) {
    throw new RangeError(`粒子数必须为非负整数，收到 ${particles}`);
  }
  if (!Number.isInteger(volumeTexBytes) || volumeTexBytes < 0) {
    throw new RangeError(`体积纹理字节数必须为非负整数，收到 ${volumeTexBytes}`);
  }
  return particles * GPU_BYTES_PER_PARTICLE + volumeTexBytes;
}

// ---------------------------------------------------------------------------
// 预算逐出决策（纯函数，供注册表与单测）
// ---------------------------------------------------------------------------

/** 注册表持有者条目（kind + id 唯一键） */
export interface DetailLayerHolder {
  bodyId: string;
  kind: DetailLayerKind;
  /** 该层 GPU 显存估算（字节，来自 spec.budget.gpuBytesEstimate） */
  gpuBytesEstimate: number;
}

/** claim 决策结果 */
export interface DetailClaimResult {
  /** 更新后的持有者列表（最新在前，跨池合并） */
  holders: readonly DetailLayerHolder[];
  /** 被逐出、应立即释放的持有者（池容量挤出 + 预算逐出） */
  released: readonly DetailLayerHolder[];
}

/** 持有者列表 GPU 估算总量（字节） */
export function detailGpuBytesTotal(holders: readonly DetailLayerHolder[]): number {
  return holders.reduce((sum, h) => sum + h.gpuBytesEstimate, 0);
}

/**
 * 细节层持有权声明决策（纯函数）：
 * 1. 同 kind 池内 LRU 提升（detailLruUpdate 语义，池容量
 *    DETAIL_LRU_CAPACITY_BY_KIND[kind]），超容量旧持有者逐出；
 * 2. 跨池 GPU 预算：总估算 > budgetBytes 时按最旧优先继续逐出
 *    （新声明层自身不被逐出——单层超预算属注册期防错，抛 RangeError）。
 */
export function detailClaimUpdate(
  holders: readonly DetailLayerHolder[],
  claim: DetailLayerHolder,
  budgetBytes: number = DETAIL_GPU_BUDGET_BYTES,
): DetailClaimResult {
  if (!Number.isFinite(budgetBytes) || budgetBytes <= 0) {
    throw new RangeError(`GPU 预算必须为正有限数，收到 ${budgetBytes}`);
  }
  if (!Number.isInteger(claim.gpuBytesEstimate) || claim.gpuBytesEstimate < 0) {
    throw new RangeError(`GPU 估算必须为非负整数，收到 ${claim.gpuBytesEstimate}`);
  }
  if (claim.gpuBytesEstimate > budgetBytes) {
    throw new RangeError(
      `单层 GPU 估算 ${claim.gpuBytesEstimate} 超出总预算 ${budgetBytes}（注册期防错）`,
    );
  }
  const released: DetailLayerHolder[] = [];
  // 1) 同池 LRU：提升为最新，超容量挤出
  const capacity = DETAIL_LRU_CAPACITY_BY_KIND[claim.kind];
  const samePool = holders.filter(
    (h) => h.kind === claim.kind && h.bodyId !== claim.bodyId,
  );
  const otherPools = holders.filter((h) => h.kind !== claim.kind);
  const pooled = [claim, ...samePool];
  released.push(...pooled.slice(capacity));
  // 最新在前：新声明层置首，其余池保持原相对顺序（旧者靠后）
  let next: DetailLayerHolder[] = [...pooled.slice(0, capacity), ...otherPools];
  // 2) 跨池预算：超限按最旧（列表尾部）优先逐出，新层自身豁免
  while (detailGpuBytesTotal(next) > budgetBytes) {
    for (let i = next.length - 1; i >= 0; i -= 1) {
      if (next[i] !== claim) {
        released.push(next[i]);
        next = [...next.slice(0, i), ...next.slice(i + 1)];
        break;
      }
    }
  }
  return { holders: next, released };
}

// ---------------------------------------------------------------------------
// 持有者注册表（渲染端单例，测试可重置；galaxyNearView 注册表同范式）
// ---------------------------------------------------------------------------

let registryHolders: readonly DetailLayerHolder[] = [];

/**
 * 声明某细节层为当前持有者（门控激活命中时调用）。
 * @returns 被逐出、应立即释放的持有者列表（组件侧卸载 dispose）
 */
export function claimDetailLayer(spec: DetailLayerSpec): readonly DetailLayerHolder[] {
  const result = detailClaimUpdate(registryHolders, {
    bodyId: spec.bodyId,
    kind: spec.kind,
    gpuBytesEstimate: spec.budget.gpuBytesEstimate,
  });
  registryHolders = result.holders;
  return result.released;
}

/**
 * 主动释放持有权（L3"退出即释放"语义 / 组件卸载 dispose 时调用）。
 * 未持有时为幂等空操作。
 */
export function releaseDetailLayer(bodyId: string, kind: DetailLayerKind): void {
  registryHolders = registryHolders.filter(
    (h) => !(h.bodyId === bodyId && h.kind === kind),
  );
}

/** 指定池的当前持有者 id 列表（最新在前；L4 LRU 保留的挂载判据） */
export function detailLayerHolderIds(kind: DetailLayerKind): readonly string[] {
  return registryHolders.filter((h) => h.kind === kind).map((h) => h.bodyId);
}

/** 当前注册表 GPU 估算总量（字节，性能总账登记用） */
export function detailLayerGpuBytesInUse(): number {
  return detailGpuBytesTotal(registryHolders);
}

/** 重置注册表（测试/场景卸载用） */
export function resetDetailLayerRegistry(): void {
  registryHolders = [];
}

// R4-24 集成回归专用：dev 环境暴露注册表只读探针供无头 Chrome CDP 验收脚本
// 验证四类细节层 LRU 交叉逐出与 GPU 预算占用。生产构建剔除；运行时逻辑零影响。
if (process.env.NODE_ENV !== 'production' && typeof window !== 'undefined') {
  (
    window as Window & { __detailLayerDebug?: unknown }
  ).__detailLayerDebug = { detailLayerHolderIds, detailLayerGpuBytesInUse };
}
