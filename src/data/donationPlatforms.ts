/**
 * 支持渠道注册表（/donate 页消费；Z 迭代 M3 起统一"支持即解锁"口径）
 *
 * 特殊形态由页面按 id 分流：afdian 为推荐独立面板（跳站外购买 + 回解锁页
 * 兑换）、alipay 为引导面板（跳 /unlock 扫码）；其余 url 为 null 表示预留位
 * （卡片显示"预留位 · 即将开通"），开通后填入链接即上线。爱发电链接
 * 复用 ContactBadge 导出的同源常量（README 赞助小节与 .github/FUNDING.yml
 * 同源，对外入口同源纪律）。平台名为专有名词，zh/en 双字段按 locale
 * 取用；emoji 由组件层持有。
 *
 * 微信赞赏码渠道已下线（不再在任何页面渲染）；`DonationPlatformId` 中保留
 * 'wechat' 仅为历史贡献者记录与已签发 token 的 `ch` 字段兼容。
 */
import { SPONSOR_AFDIAN_URL } from '@/components/UI/ContactBadge';
import type { DonationPlatformId } from '@/utils/donors';

/** Ko-fi 主页（README 赞助小节与 .github/FUNDING.yml 同源，对外入口同源纪律） */
export const SPONSOR_KOFI_URL = 'https://ko-fi.com/howardzlh';

/** 面包多主页（README 赞助小节同源，对外入口同源纪律；商品页挂此主页下） */
export const SPONSOR_MBD_URL = 'https://mbd.pub/o/stellar';

export interface DonationPlatform {
  id: DonationPlatformId;
  nameZh: string;
  nameEn: string;
  /** 捐赠链接（null = 无跳转链接：alipay 为站内引导，其余为预留位） */
  url: string | null;
}

/**
 * 顺序即 /donate 页渲染顺序（渠道重排：爱发电置顶为推荐渠道，微信赞赏码
 * 下线）：爱发电（推荐 · 独立面板，订单号自动兑换）→ 支付宝（引导型：面板
 * 引导跳 /unlock 扫码，付款 modal 只在解锁页）→ 面包多（备选）→
 * Ko-fi（海外备选）→ 预留位。
 */
export const DONATION_PLATFORMS: readonly DonationPlatform[] = [
  { id: 'afdian', nameZh: '爱发电', nameEn: 'Afdian', url: SPONSOR_AFDIAN_URL },
  { id: 'alipay', nameZh: '支付宝扫码支付', nameEn: 'Alipay QR Pay', url: null },
  { id: 'mbd', nameZh: '面包多', nameEn: 'Mianbaoduo', url: SPONSOR_MBD_URL },
  { id: 'kofi', nameZh: 'Ko-fi', nameEn: 'Ko-fi', url: SPONSOR_KOFI_URL },
  {
    id: 'github-sponsors',
    nameZh: 'GitHub Sponsors',
    nameEn: 'GitHub Sponsors',
    url: null,
  },
  {
    id: 'buymeacoffee',
    nameZh: 'Buy Me a Coffee',
    nameEn: 'Buy Me a Coffee',
    url: null,
  },
];
