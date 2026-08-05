/**
 * 捐赠名单排序与平台注册表单测（捐赠页 /donate）：
 * - sortDonorsByAmountDesc 金额降序、同额昵称字典序、纯函数不改入参
 * - DONATION_PLATFORMS：爱发电/Ko-fi 链接同源常量、预留位登记
 * - DONORS 登记数据完整性（当前空名单上线）
 */

import { SPONSOR_AFDIAN_URL } from '@/components/UI/ContactBadge';
import { DONATION_PLATFORMS, SPONSOR_KOFI_URL } from '@/data/donationPlatforms';
import { DONORS } from '@/data/donors';
import type { DonorRecord } from '@/utils/donors';
import { sortDonorsByAmountDesc } from '@/utils/donors';

describe('sortDonorsByAmountDesc', () => {
  const donors: readonly DonorRecord[] = [
    { name: '小行星', amountCny: 20, platform: 'afdian', date: '2026-07-01' },
    { name: '彗星', amountCny: 200, platform: 'wechat', date: '2026-07-02', message: '加油' },
    { name: '流星', amountCny: 66, platform: 'kofi', date: '2026-07-03' },
    { name: 'B星', amountCny: 66, platform: 'afdian', date: '2026-07-04' },
  ];

  it('按金额降序排列', () => {
    const sorted = sortDonorsByAmountDesc(donors);
    expect(sorted.map((d) => d.amountCny)).toEqual([200, 66, 66, 20]);
    expect(sorted[0].name).toBe('彗星');
  });

  it('金额相同按昵称字典序（顺序稳定）', () => {
    const sorted = sortDonorsByAmountDesc(donors);
    const tied = sorted.filter((d) => d.amountCny === 66).map((d) => d.name);
    expect(tied).toEqual(['B星', '流星'].sort((a, b) => a.localeCompare(b)));
  });

  it('纯函数：不修改入参数组', () => {
    const input = [...donors];
    sortDonorsByAmountDesc(input);
    expect(input.map((d) => d.name)).toEqual(donors.map((d) => d.name));
  });

  it('空名单返回空数组', () => {
    expect(sortDonorsByAmountDesc([])).toEqual([]);
  });
});

describe('DONATION_PLATFORMS 注册表', () => {
  it('爱发电链接复用 ContactBadge 同源常量且可用', () => {
    const afdian = DONATION_PLATFORMS.find((p) => p.id === 'afdian');
    expect(afdian?.url).toBe(SPONSOR_AFDIAN_URL);
  });

  it('Ko-fi 链接复用同源常量且可用', () => {
    const kofi = DONATION_PLATFORMS.find((p) => p.id === 'kofi');
    expect(kofi?.url).toBe(SPONSOR_KOFI_URL);
  });

  it('包含五个平台（微信/GitHub Sponsors/Buy Me a Coffee 为预留位）', () => {
    expect(DONATION_PLATFORMS.map((p) => p.id)).toEqual([
      'afdian',
      'wechat',
      'github-sponsors',
      'kofi',
      'buymeacoffee',
    ]);
    const reserved = DONATION_PLATFORMS.filter((p) => p.url === null);
    expect(reserved.map((p) => p.id)).toEqual([
      'wechat',
      'github-sponsors',
      'buymeacoffee',
    ]);
  });

  it('平台名 zh/en 双字段均非空', () => {
    for (const p of DONATION_PLATFORMS) {
      expect(p.nameZh.length).toBeGreaterThan(0);
      expect(p.nameEn.length).toBeGreaterThan(0);
    }
  });
});

describe('DONORS 登记数据', () => {
  it('每条登记金额为正数、日期为 YYYY-MM-DD', () => {
    for (const donor of DONORS) {
      expect(donor.amountCny).toBeGreaterThan(0);
      expect(donor.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(donor.name.length).toBeGreaterThan(0);
    }
  });
});
