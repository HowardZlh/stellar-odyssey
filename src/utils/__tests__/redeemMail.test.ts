/**
 * 兑换邮件模板拼装纯函数单测（Z 迭代 M3）：
 * - mailto 预填链接：subject/body URL 编码（中文/换行/空格）
 * - 展示用模板全文：标签行 + 空行 + 正文（/unlock 与 /donate 同源消费）
 */
import {
  buildRedeemMailtoHref,
  formatRedeemMailTemplate,
} from '../redeemMail';

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

describe('formatRedeemMailTemplate', () => {
  it('输出 收件人/主题 标签行 + 空行 + 正文', () => {
    const text = formatRedeemMailTemplate({
      toLabel: '收件人',
      subjectLabel: '主题',
      email: 'a@b.co',
      subject: '兑换申请',
      body: '昵称:\n档位:',
    });
    expect(text).toBe('收件人: a@b.co\n主题: 兑换申请\n\n昵称:\n档位:');
  });

  it('英文标签同构（双语消费同一函数）', () => {
    const text = formatRedeemMailTemplate({
      toLabel: 'To',
      subjectLabel: 'Subject',
      email: 'a@b.co',
      subject: 'Redeem',
      body: 'Nickname:',
    });
    expect(text).toBe('To: a@b.co\nSubject: Redeem\n\nNickname:');
  });
});
