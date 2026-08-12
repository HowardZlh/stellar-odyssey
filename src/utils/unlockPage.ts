/**
 * `/unlock` 解锁页路径常量（U2-4 先行定义，REQUIREMENTS_UNLOCK.md §U3-1 收敛）
 *
 * 范式沿用 `CONTRIBUTORS_PAGE_PATH`（utils/contributorUniverse.ts，C4-1）：
 * 路径落纯模块单一事实源，锁定提示 HUD / ControlPanel 入口（U2）与
 * `/unlock` 页自身（U3）同源消费。登记：U2 先行创建本模块，U3 实现
 * 页面时直接复用，禁止另立常量。
 */
export const UNLOCK_PAGE_PATH = "/unlock";
