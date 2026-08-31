/**
 * 支持渠道注册表（/donate 页消费；Z 迭代 M3 起统一"支持即解锁"口径）
 *
 * 特殊形态由页面按 id 分流：alipay 为引导面板（跳 /unlock 扫码）、
 * wechat 为二维码独立 panel（qrImage）；其余 url 为 null 表示预留位
 * （卡片显示"预留位 · 即将开通"），开通后填入链接即上线。爱发电链接
 * 复用 ContactBadge 导出的同源常量（README 赞助小节与 .github/FUNDING.yml
 * 同源，对外入口同源纪律）。平台名为专有名词，zh/en 双字段按 locale
 * 取用；emoji 由组件层持有。
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
  /** 捐赠链接（null = 无跳转链接：有 qrImage 走二维码形态，否则为预留位） */
  url: string | null;
  /** 收款二维码图片路径（微信赞赏码等无跳转链接的通道，卡片内展开展示） */
  qrImage?: string;
}

/**
 * 顺序即 /donate 页渲染顺序（Z 迭代 M3 渠道重排，需求 E2(a)；面包多
 * 集成插位于微信之后、爱发电之前——扫码即付无需注册，体验优于爱发电）：
 * 支付宝（引导型：面板引导跳 /unlock 扫码，付款 modal 只在解锁页）→
 * 微信赞赏码（独立 panel）→ 面包多（备选）→ 爱发电（备选）→
 * Ko-fi（海外备选）→ 预留位。
 */
export const DONATION_PLATFORMS: readonly DonationPlatform[] = [
  { id: 'alipay', nameZh: '支付宝扫码支付', nameEn: 'Alipay QR Pay', url: null },
  {
    id: 'wechat',
    nameZh: '微信赞赏码',
    nameEn: 'WeChat Tip Code',
    url: null,
    qrImage: '/donate/wechat-tip-code.jpg',
  },
  { id: 'mbd', nameZh: '面包多', nameEn: 'Mianbaoduo', url: SPONSOR_MBD_URL },
  { id: 'afdian', nameZh: '爱发电', nameEn: 'Afdian', url: SPONSOR_AFDIAN_URL },
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
