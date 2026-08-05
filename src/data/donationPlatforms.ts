/**
 * 捐赠平台注册表（捐赠页 /donate 消费）
 *
 * url 为 null 表示预留位（卡片显示"预留位 · 即将开通"）；开通后填入
 * 链接即上线。爱发电链接复用 ContactBadge 导出的同源常量
 * （README 赞助小节与 .github/FUNDING.yml 同源，对外入口同源纪律）。
 * 平台名为专有名词，zh/en 双字段按 locale 取用；emoji 由组件层持有。
 */
import { SPONSOR_AFDIAN_URL } from '@/components/UI/ContactBadge';
import type { DonationPlatformId } from '@/utils/donors';

/** Ko-fi 主页（README 赞助小节与 .github/FUNDING.yml 同源，对外入口同源纪律） */
export const SPONSOR_KOFI_URL = 'https://ko-fi.com/howardzlh';

export interface DonationPlatform {
  id: DonationPlatformId;
  nameZh: string;
  nameEn: string;
  /** 捐赠链接（null = 无跳转链接：有 qrImage 走二维码形态，否则为预留位） */
  url: string | null;
  /** 收款二维码图片路径（微信赞赏码等无跳转链接的通道，卡片内展开展示） */
  qrImage?: string;
}

export const DONATION_PLATFORMS: readonly DonationPlatform[] = [
  { id: 'afdian', nameZh: '爱发电', nameEn: 'Afdian', url: SPONSOR_AFDIAN_URL },
  {
    id: 'wechat',
    nameZh: '微信赞赏码',
    nameEn: 'WeChat Tip Code',
    url: null,
    qrImage: '/donate/wechat-tip-code.jpg',
  },
  {
    id: 'github-sponsors',
    nameZh: 'GitHub Sponsors',
    nameEn: 'GitHub Sponsors',
    url: null,
  },
  { id: 'kofi', nameZh: 'Ko-fi', nameEn: 'Ko-fi', url: SPONSOR_KOFI_URL },
  {
    id: 'buymeacoffee',
    nameZh: 'Buy Me a Coffee',
    nameEn: 'Buy Me a Coffee',
    url: null,
  },
];
