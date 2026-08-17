-- 0001_init.sql — D1 全量建表（Z 迭代 M1 存储层 KV → D1 迁移，
-- REQUIREMENTS_ALIPAY_UNLOCK.md §4；范式对照 stock_analysis 6d147cd）
--
-- 执行方式（上线清单 §9，用户手工执行）：
--   npx wrangler d1 create stellar-unlock          # database_id 回填 wrangler.toml
--   npx wrangler d1 migrations apply stellar-unlock --remote
-- 本地干跑：
--   npx wrangler d1 execute stellar-unlock --local --file migrations/0001_init.sql
--
-- 隐私纪律（D-z8）：买家身份字段（buyer_logon_id / buyer_user_id 等）一律
-- 不建列不落库；订单行只存 out_trade_no/trade_no/金额/档位/时间/昵称留言。
-- M2 要用的支付宝字段（trade_no/nickname/message/contributor_id/paid_at/
-- refunded_at 与 contributors 表）本里程碑一并建齐，避免二次 migration。

-- 订单表（迁移来源：KV `order:<订单号>`，无存量数据只迁逻辑）。
-- ext_order_no UNIQUE 为幂等基石：notify 重复通知、status 补发、
-- 爱发电重复兑换均靠它（同单永远返回首发 token）。
CREATE TABLE orders (
  id             TEXT PRIMARY KEY,      -- crypto.randomUUID()（服务端唯一 ID，禁止拼接键）
  channel        TEXT NOT NULL,         -- 'alipay' | 'afdian'
  ext_order_no   TEXT NOT NULL UNIQUE,  -- alipay=out_trade_no；afdian=订单号（幂等基石）
  trade_no       TEXT,                  -- 支付宝交易号（退款用，M2 回填）
  amount_cny     REAL,                  -- 实付金额（元；服务端定价核验以订单行为准）
  tier           TEXT,                  -- 'week' | 'month' | 'year'
  months         INTEGER,               -- 订阅单月数（商品单 NULL）
  status         TEXT NOT NULL,         -- 'pending' | 'paid' | 'closed' | 'refunded'
  token          TEXT,                  -- SO1 token 明文（幂等找回，安全纪律 §7-5 允许）
  token_hash     TEXT,                  -- sha256(token) hex（吊销联动，免重算）
  expires_at     INTEGER,               -- token exp（epoch 秒；幂等返回 expiresAt 消费）
  plan_id        TEXT,                  -- 仅爱发电：plan_id 审计字段（可 NULL）
  nickname       TEXT,                  -- 支付宝渠道自填昵称（可 NULL=匿名，M2）
  message        TEXT,                  -- 支付宝渠道自填留言（可 NULL，M2）
  contributor_id TEXT,                  -- 关联 contributors.id（M2 发码事务回填）
  created_at     TEXT NOT NULL,         -- ISO8601
  paid_at        TEXT,
  refunded_at    TEXT
);
CREATE INDEX idx_orders_status_created ON orders(status, created_at);

-- 贡献者名单（D-z4：GET /api/contributors 动态名单，M2 启用；
-- 静态 donors.ts 不迁移、并行展示）
CREATE TABLE contributors (
  id         TEXT PRIMARY KEY,          -- crypto.randomUUID()
  nickname   TEXT,                      -- NULL 显示「匿名用户」
  message    TEXT,
  channel    TEXT NOT NULL,             -- 'alipay' | 'afdian'
  amount_cny REAL,
  created_at TEXT NOT NULL,
  hidden     INTEGER NOT NULL DEFAULT 0 -- 管理台隐藏开关（不删行）
);
CREATE INDEX idx_contrib_created ON contributors(created_at);

-- 吊销名单（迁移来源：KV `revoke:list` 单键 JSON → 逐条成行）。
-- 只增不删纪律（安全纪律 §7-6）：解除吊销以 restored 翻转记录；
-- exp 列承载 §0.15 契约条目的 exp 字段（过期条目自然失效判定）。
CREATE TABLE revocations (
  token_hash TEXT PRIMARY KEY,          -- sha256(完整 token) hex 64 位小写
  exp        INTEGER NOT NULL,          -- 被吊销 token 的 expSec
  reason     TEXT,                      -- 'refund' | 'manual' | 自由文本
  revoked_at TEXT NOT NULL,             -- ISO8601（名单条目 at 字段）
  restored   INTEGER NOT NULL DEFAULT 0 -- 1 = 已解除（只翻转不删行）
);

-- 通用键值状态（迁移来源：KV 其余单键 JSON——
-- `refund:suspects` / `revoke:cursor` / `gate:config`；M2 增 `filter:words`）
CREATE TABLE kv_state (
  k          TEXT PRIMARY KEY,
  v          TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
