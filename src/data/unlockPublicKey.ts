/**
 * 解锁 token 验签公钥（U3，REQUIREMENTS_UNLOCK.md §0.5）
 *
 * Ed25519 公钥 hex（32 字节）常量内嵌前端——公钥公开无泄密风险；
 * 对应私钥**不入库**（本地签发环境 `secrets/unlock-ed25519-private.hex`
 * （gitignore `/secrets/`）+ Cloudflare Worker secret `ED25519_PRIVATE_KEY`，
 * U4 签发侧共享同一密钥对）。
 *
 * 密钥轮换：更换密钥对需同步更新本常量 + Worker secret + 本地私钥文件，
 * 旧 token 全部失效（预案登记于 U4-4 运营手册）。
 *
 * 环境无关纪律：本模块保持零依赖纯常量，浏览器 / Worker / jest 三端可直用。
 */

/** Ed25519 验签公钥（hex，2026-08-12 生成登记） */
export const UNLOCK_PUBLIC_KEY_HEX =
  "e8c9b1a257eaad798f947be68ab416df847f93bbb5523db70647319cec58dc0f";
