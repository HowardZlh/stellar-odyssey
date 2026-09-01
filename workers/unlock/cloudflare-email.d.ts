/**
 * `cloudflare:email` 运行时模块最小声明（仅本 Worker 消费的 EmailMessage
 * 构造器；不引入 @cloudflare/workers-types 全量类型——项目 tsconfig 为
 * DOM lib，全量引入会与 Next.js 前端类型冲突）。
 *
 * 消费点唯一：index.ts 的运营邮件适配器（动态 import，jest 环境不触达，
 * 通道裁决与实证登记见 lib/opsMime.ts 文件头）。
 */
declare module "cloudflare:email" {
  /** 旧版原始 MIME 邮件（Email Routing 免费发信通道入参） */
  export class EmailMessage {
    constructor(from: string, to: string, raw: string);
    readonly from: string;
    readonly to: string;
  }
}
