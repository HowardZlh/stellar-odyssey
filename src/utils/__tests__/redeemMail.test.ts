/**
 * 兑换邮件 mailto 拼装纯函数单测（Z 迭代 M3）：
 * - mailto 预填链接：subject/body URL 编码（中文/换行/空格）
 */
import { buildRedeemMailtoHref } from '../redeemMail';

describe('buildRedeemMailtoHref', () => {
  it('拼装 mailto 且 subject/body 均 URL 编码', () => {
    const href = buildRedeemMailtoHref(
      'a@b.co',
      '解锁 兑换',
      '第一行\n第二行',
    );
    expect(href).toBe(
      `mailto:a@b.co?subject=${encodeURIComponent('解锁 兑换')}&body=${encodeURIComponent('第一行\n第二行')}`,
    );
    // 原始未编码字符不得出现在 query 段
    expect(href).not.toContain('解锁 兑换');
    expect(href).not.toContain('\n');
  });
});
