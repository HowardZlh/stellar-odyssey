/**
 * 天体观察站门控配置（O1，REQUIREMENTS_OBSERVATORY.md §3）
 *
 * **单一事实源**：观察站（/lab/observatory）三层门控的全部可配置项集中于
 * 本文件的 `OBSERVATORY_GATE_CONFIG`——限时免费期起止 / 每日总限次 /
 * 支持者专属天体名单与试玩额度改这里一处即可。
 *
 * 未来"本地管理后台"下发覆盖的预留接口：消费侧一律经
 * `utils/observatoryGate.resolveObservatoryGateConfig(override?)` 取配置
 * （合并覆盖 + 注册期校验），后台实现后把下发的 Partial 配置传入 override
 * 即可，本文件与判定纯函数零改动。
 *
 * 口径登记（§3 决策记录）：
 * - 免费期内全部天体不限次（不计次）；
 * - 免费期外每日总限次 10 次，任意天体每次进入都计次；
 * - 专属天体池 7 个：未解锁用户每天共享 3 次试玩额度，**试玩计次同时
 *   占用每日总额度**；
 * - 持有效解锁凭证（store entitlement 非空）→ 全部天体不限次，均豁免。
 */

/**
 * 限时免费期窗口（UTC ISO 起止）
 *
 * G1（REQUIREMENTS_GROWTH.md §3 M1，D2 裁决）：代码侧默认 `enabled: false`，
 * 限免期一律由远程 `gate:config`（Worker D1 `kv_state`，管理台下发）续期——
 * 历史上"发布时人工改代码日期"曾静默过期 11 天（2026-08-20 到期，
 * v0.1.11/v0.1.12 两次发版均漏更新），故废弃该流程。
 */
export interface ObservatoryFreeWindow {
  /** 免费期总开关（false = 忽略起止日期，直接进入限次+解锁模式） */
  readonly enabled: boolean;
  /** 免费期起点（UTC ISO 8601，含） */
  readonly startUtc: string;
  /** 免费期终点（UTC ISO 8601，不含） */
  readonly endUtc: string;
}

/** 观察站门控配置（全部字段可配置，未来管理后台可下发 Partial 覆盖） */
export interface ObservatoryGateConfig {
  /** 限时免费期（期内全部天体不限次） */
  readonly freeWindow: ObservatoryFreeWindow;
  /** 每日总限次（免费期外，任意天体每次进入都计次；正整数） */
  readonly dailyLimit: number;
  /**
   * 专属天体每日试玩额度（未解锁用户对专属池共享；正整数且 ≤ dailyLimit，
   * 试玩计次同时占用每日总额度）
   */
  readonly premiumTrialDailyLimit: number;
  /** 支持者专属天体 bodyId 名单（须为 PREVIEW_REGISTRY 已注册 id，测试断言） */
  readonly premiumBodyIds: readonly string[];
}

/**
 * 门控配置默认值（需求确认口径：10 次/天、专属池 7 个、试玩 3 次/天）
 *
 * 免费期代码侧**默认关闭**（G1/D2 裁决：防再次静默过期），起止日期仅为
 * 远程覆盖缺席时的占位（enabled=false 下不生效）；续期唯一通道 = 管理台
 * 经远程 `gate:config` 下发 `observatory.freeWindow` 覆盖。
 */
export const OBSERVATORY_GATE_CONFIG: ObservatoryGateConfig = {
  freeWindow: {
    enabled: false,
    startUtc: '2026-08-13T00:00:00Z',
    endUtc: '2026-08-20T00:00:00Z',
  },
  dailyLimit: 10,
  premiumTrialDailyLimit: 3,
  // 热度高的 7 个专属天体（需求决策名单：黑洞/M87/参宿四/星系团透镜/
  // 蟹状星云/类星体/触须星系）
  premiumBodyIds: [
    'blackhole-test',
    'm87',
    'betelgeuse',
    'cluster-lensing',
    'crab-pulsar',
    'quasar-3c273',
    'antennae',
  ],
};
