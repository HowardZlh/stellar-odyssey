/**
 * 启动 URL 参数解析单测（B4 §4.2：全分支——合法/非法/边界/空/组合，
 * 模块覆盖率 100%）。含 B2 `parseLangParam` 语义等价迁移用例
 * （统一入口收口后原 i18n 独立解析已删除）。
 */

import {
  DEFAULT_LAUNCH_PARAMS,
  DWELL_DEFAULT_SEC,
  DWELL_MAX_SEC,
  DWELL_MIN_SEC,
  LOGO_URL_MAX_LENGTH,
  parseLaunchParams,
  TOUR_DEFAULT,
} from '@/utils/launchParams';

describe('parseLaunchParams 空/默认路径', () => {
  it.each([[''], ['?'], ['?foo=1&bar=2']])('%j → 全默认', (search) => {
    expect(parseLaunchParams(search)).toEqual({
      mode: null,
      tour: 'solar',
      dwell: 30,
      body: null,
      logo: null,
      lang: null,
    });
  });

  it('DEFAULT_LAUNCH_PARAMS 与空串解析结果一致（store 初始值等价登记）', () => {
    expect(parseLaunchParams('')).toEqual(DEFAULT_LAUNCH_PARAMS);
    expect(TOUR_DEFAULT).toBe('solar');
    expect(DWELL_DEFAULT_SEC).toBe(30);
  });
});

describe('mode（合法值仅 kiosk，大小写不敏感）', () => {
  it.each([
    ['?mode=kiosk', 'kiosk'],
    ['?mode=KIOSK', 'kiosk'],
    ['?mode=Kiosk', 'kiosk'],
  ])('%s → %s', (search, expected) => {
    expect(parseLaunchParams(search).mode).toBe(expected);
  });

  it.each([['?mode=admin'], ['?mode='], ['?foo=1']])('%s → null', (search) => {
    expect(parseLaunchParams(search).mode).toBeNull();
  });
});

describe('tour（solar|galaxy|universe|all，默认 solar）', () => {
  it.each([
    ['?tour=solar', 'solar'],
    ['?tour=galaxy', 'galaxy'],
    ['?tour=universe', 'universe'],
    ['?tour=all', 'all'],
    ['?tour=ALL', 'all'],
    ['?tour=Galaxy', 'galaxy'],
  ])('%s → %s', (search, expected) => {
    expect(parseLaunchParams(search).tour).toBe(expected);
  });

  it.each([['?tour=system'], ['?tour=planets'], ['?tour='], ['']])(
    '%j 非法/缺失 → solar',
    (search) => {
      expect(parseLaunchParams(search).tour).toBe('solar');
    },
  );
});

describe('dwell（整数 5–600，默认 30；非法即默认不钳制）', () => {
  it.each([
    ['?dwell=5', 5],
    ['?dwell=600', 600],
    ['?dwell=45', 45],
    ['?dwell=030', 30],
  ])('合法边界/常规 %s → %d', (search, expected) => {
    expect(parseLaunchParams(search).dwell).toBe(expected);
  });

  it.each([
    ['?dwell=4'],
    ['?dwell=601'],
    ['?dwell=0'],
    ['?dwell=-30'],
    ['?dwell=5.5'],
    ['?dwell=abc'],
    ['?dwell=1e2'],
    ['?dwell='],
    [''],
  ])('%j 非法/越界/缺失 → 30', (search) => {
    expect(parseLaunchParams(search).dwell).toBe(DWELL_DEFAULT_SEC);
  });

  it('边界常量登记（5–600）', () => {
    expect(DWELL_MIN_SEC).toBe(5);
    expect(DWELL_MAX_SEC).toBe(600);
  });
});

describe('body（天体 id 原样透传；空白回退 null）', () => {
  it.each([
    ['?body=jupiter', 'jupiter'],
    ['?body=sgr-a-star', 'sgr-a-star'],
    ['?body=%20earth%20', 'earth'],
    // 非法 id 不在此校验（requestFlyTo 自含校验静默忽略，登记）
    ['?body=not-a-body', 'not-a-body'],
  ])('%s → %j', (search, expected) => {
    expect(parseLaunchParams(search).body).toBe(expected);
  });

  it.each([['?body='], ['?body=%20%20'], ['']])('%j 空白/缺失 → null', (search) => {
    expect(parseLaunchParams(search).body).toBeNull();
  });
});

describe('logo（仅 https、长度 ≤2048，非法静默回退 null）', () => {
  const httpsUrl = 'https://example.com/logo.png';

  it('合法 https URL 原样透传', () => {
    expect(parseLaunchParams(`?logo=${encodeURIComponent(httpsUrl)}`)).toMatchObject({
      logo: httpsUrl,
    });
  });

  it('长度边界：恰 2048 合法、2049 回退 null', () => {
    const base = 'https://example.com/';
    const exact = base + 'a'.repeat(LOGO_URL_MAX_LENGTH - base.length);
    const over = base + 'a'.repeat(LOGO_URL_MAX_LENGTH + 1 - base.length);
    expect(exact).toHaveLength(2048);
    expect(parseLaunchParams(`?logo=${encodeURIComponent(exact)}`).logo).toBe(exact);
    expect(parseLaunchParams(`?logo=${encodeURIComponent(over)}`).logo).toBeNull();
  });

  it.each([
    ['http 明文', 'http://example.com/logo.png'],
    ['javascript 伪协议', 'javascript:alert(1)'],
    ['data URL', 'data:image/png;base64,AAAA'],
    ['相对路径（非合法绝对 URL）', '/logo.png'],
    ['裸字符串', 'not a url'],
  ])('%s → null', (_label, value) => {
    expect(parseLaunchParams(`?logo=${encodeURIComponent(value)}`).logo).toBeNull();
  });

  it.each([['?logo='], ['']])('%j 空/缺失 → null', (search) => {
    expect(parseLaunchParams(search).logo).toBeNull();
  });
});

describe('lang（B2 parseLangParam 语义等价迁移：大小写不敏感，非法 → null）', () => {
  it.each([
    ['?lang=en', 'en'],
    ['?lang=zh', 'zh'],
    ['?lang=EN', 'en'],
    ['?foo=1&lang=en&bar=2', 'en'],
    ['lang=en', 'en'],
  ])('%s → %s', (search, expected) => {
    expect(parseLaunchParams(search).lang).toBe(expected);
  });

  it.each([['?lang=fr'], ['?lang='], ['?foo=1'], ['']])('%j → null', (search) => {
    expect(parseLaunchParams(search).lang).toBeNull();
  });
});

describe('组合与健壮性', () => {
  it('全参数组合解析互不干扰', () => {
    expect(
      parseLaunchParams(
        '?mode=kiosk&tour=all&dwell=60&body=jupiter&logo=https%3A%2F%2Fexample.com%2Fl.svg&lang=en',
      ),
    ).toEqual({
      mode: 'kiosk',
      tour: 'all',
      dwell: 60,
      body: 'jupiter',
      logo: 'https://example.com/l.svg',
      lang: 'en',
    });
  });

  it('非法组合逐项独立回退默认（§4.2 控制台零错误口径：不抛错）', () => {
    expect(
      parseLaunchParams('?mode=hack&tour=nowhere&dwell=99999&body=&logo=javascript:x&lang=xx'),
    ).toEqual(DEFAULT_LAUNCH_PARAMS);
  });

  it('重复参数取首值（URLSearchParams.get 语义登记）', () => {
    expect(parseLaunchParams('?lang=en&lang=zh').lang).toBe('en');
    expect(parseLaunchParams('?dwell=10&dwell=20').dwell).toBe(10);
  });
});
