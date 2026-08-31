-- 0002_funnel.sql — 匿名转化漏斗按天聚合表（G 迭代 M4 G8，
-- REQUIREMENTS_GROWTH.md §4；执行方式同 0001：
--   npx wrangler d1 migrations apply stellar-unlock --remote）
--
-- 形态裁决（2026-08-31，用户采纳方案 A，差异登记见需求文档 §6 M4 行）：
-- 宽行 = 每天 1 行、7 个计数列，单语句 ON CONFLICT 原子累加——
-- 每次 beacon 仅 1 行写（10k 日活 = 10k 行写/天，Free 100k 余量 10×）；
-- 若按"每键每天 1 行"设计，每请求最多 7 条 UPSERT = 最坏 70k 行写/天，
-- 余量仅 1.4×，测算不过关。新增事件键需随白名单一并 migration 加列
-- （白名单本就是枚举常量，同步成本一致）。
--
-- 隐私纪律：仅日期 + 计数，无任何用户标识/IP/UA 列。
CREATE TABLE funnel_daily (
  d             TEXT PRIMARY KEY,        -- UTC 日期 YYYY-MM-DD
  lock_shown    INTEGER NOT NULL DEFAULT 0, -- 付费墙锁定提示曝光
  lock_cta      INTEGER NOT NULL DEFAULT 0, -- 锁定提示「前往解锁」点击
  unlock_view   INTEGER NOT NULL DEFAULT 0, -- /unlock 页曝光
  tier_cta      INTEGER NOT NULL DEFAULT 0, -- 档位卡「扫码支付」点击
  pay_open      INTEGER NOT NULL DEFAULT 0, -- 支付宝付款 modal 打开
  redeem_submit INTEGER NOT NULL DEFAULT 0, -- 订单号兑换提交
  share_click   INTEGER NOT NULL DEFAULT 0  -- 「分享此刻」点击（追加裁决键）
);
