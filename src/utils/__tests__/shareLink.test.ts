/**
 * shareLink 分享链接组装单测（G5，REQUIREMENTS_GROWTH §3 M2）
 *
 * 验收锁定三分支：无选中天体 / 观察站路径形态 / locale 非默认；
 * 另锁硬性约束：URL 只携带 body/lang，恒不含 token 及其他参数键。
 */
import { buildShareUrl } from '@/utils/shareLink';

const ORIGIN = 'https://stellar.guushu.com';

describe('buildShareUrl 主场景形态', () => {
  it('有跟随天体 + 默认语言 zh：仅携带 ?body=（不带 lang）', () => {
    expect(buildShareUrl(ORIGIN, { kind: 'main', bodyId: 'sgr-a-star' }, 'zh')).toBe(
      'https://stellar.guushu.com/?body=sgr-a-star',
    );
  });

  it('无选中/跟随天体：输出站点根 URL，零参数', () => {
    expect(buildShareUrl(ORIGIN, { kind: 'main', bodyId: null }, 'zh')).toBe(
      'https://stellar.guushu.com/',
    );
  });

  it('空白 bodyId 视同无选中（与 launchParams parseBody 空白回退同口径）', () => {
    expect(buildShareUrl(ORIGIN, { kind: 'main', bodyId: '  ' }, 'zh')).toBe(
      'https://stellar.guushu.com/',
    );
  });

  it('locale 非默认（en）：追加 ?lang=en；无天体时仅 lang', () => {
    expect(buildShareUrl(ORIGIN, { kind: 'main', bodyId: 'orion-nebula' }, 'en')).toBe(
      'https://stellar.guushu.com/?body=orion-nebula&lang=en',
    );
    expect(buildShareUrl(ORIGIN, { kind: 'main', bodyId: null }, 'en')).toBe(
      'https://stellar.guushu.com/?lang=en',
    );
  });

  it('origin 尾部斜杠安全（不产生双斜杠）', () => {
    expect(buildShareUrl(`${ORIGIN}/`, { kind: 'main', bodyId: 'm31' }, 'zh')).toBe(
      'https://stellar.guushu.com/?body=m31',
    );
  });

  it('bodyId 特殊字符经 URLSearchParams 编码（防注入畸形串）', () => {
    expect(buildShareUrl(ORIGIN, { kind: 'main', bodyId: 'a b&c' }, 'zh')).toBe(
      'https://stellar.guushu.com/?body=a+b%26c',
    );
  });
});

describe('buildShareUrl 观察站路径形态', () => {
  it('输出 /lab/observatory/<id> 路径（与 observatoryBodyPath 同源）', () => {
    expect(
      buildShareUrl(ORIGIN, { kind: 'observatory', bodyId: 'orion-nebula' }, 'zh'),
    ).toBe('https://stellar.guushu.com/lab/observatory/orion-nebula');
  });

  it('观察站 + locale 非默认：路径 + ?lang=en（不重复携带 body 参数）', () => {
    expect(
      buildShareUrl(ORIGIN, { kind: 'observatory', bodyId: 'sgr-a-star' }, 'en'),
    ).toBe('https://stellar.guushu.com/lab/observatory/sgr-a-star?lang=en');
  });
});

describe('硬性约束：仅 body/lang 两个参数键，恒不含 token', () => {
  it.each([
    ['main + body + en', { kind: 'main', bodyId: 'm31' } as const, 'en' as const],
    ['main 空态', { kind: 'main', bodyId: null } as const, 'zh' as const],
    [
      'observatory + en',
      { kind: 'observatory', bodyId: 'm31' } as const,
      'en' as const,
    ],
  ])('%s', (_label, context, locale) => {
    const url = new URL(buildShareUrl(ORIGIN, context, locale));
    for (const key of url.searchParams.keys()) {
      expect(['body', 'lang']).toContain(key);
    }
    expect(url.searchParams.get('token')).toBeNull();
    expect(url.href).not.toMatch(/token/i);
  });
});
