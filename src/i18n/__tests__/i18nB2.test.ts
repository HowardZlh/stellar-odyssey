/**
 * i18n 基建单测（B2）：字典键一致性 / 拍平与查找 /
 * 启动优先级（?lang > localStorage > zh）/ 持久化与 `<html lang>` 同步
 * 副作用（含存取异常兜底分支）。模块覆盖率目标 100%（附录 A §2）。
 *
 * B4 迁移登记：`parseLangParam` 用例已语义等价迁移至
 * utils/__tests__/launchParams.test.ts（lang 分组）；resolveInitialLocale
 * 经统一入口 parseLaunchParams 取值，优先级链用例原样保留。
 */

import {
  DEFAULT_LOCALE,
  LOCALE_STORAGE_KEY,
  en,
  flattenMessages,
  htmlLangFor,
  persistLocale,
  readStoredLocale,
  resolveInitialLocale,
  syncHtmlLang,
  t,
  zh,
} from '@/i18n';

afterEach(() => {
  // 先还原 mock（documentElement getter 抛错的用例中，复位需走真实 DOM）
  jest.restoreAllMocks();
  window.localStorage.clear();
  document.documentElement.lang = 'zh-CN';
});

describe('字典键一致性（en/zh 键集合，TS 类型强制之上的运行时兜底）', () => {
  it('zh 与 en 拍平后键集合完全一致', () => {
    const zhKeys = Object.keys(flattenMessages(zh)).sort();
    const enKeys = Object.keys(flattenMessages(en)).sort();
    expect(enKeys).toEqual(zhKeys);
    expect(zhKeys.length).toBeGreaterThan(0);
  });

  it('全部叶子均为非空字符串', () => {
    for (const dict of [zh, en]) {
      for (const value of Object.values(flattenMessages(dict))) {
        expect(typeof value).toBe('string');
        expect(value.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('flattenMessages', () => {
  it('嵌套对象拍平为点分键', () => {
    expect(flattenMessages({ a: { b: '1', c: { d: '2' } }, e: '3' })).toEqual({
      'a.b': '1',
      'a.c.d': '2',
      e: '3',
    });
  });

  it('空对象返回空表', () => {
    expect(flattenMessages({})).toEqual({});
  });
});

describe('t 查找', () => {
  it('zh/en 分别命中对应字典', () => {
    expect(t('zh', 'contactBadge.title')).toBe('商业合作');
    expect(t('en', 'contactBadge.title')).toBe('Commercial Partnership');
  });

  it('目标 locale 缺键回退 zh，再缺回退键名（运行时防御路径）', () => {
    type Key = Parameters<typeof t>[1];
    // 编译期 MessageKey 不可能缺键，此处强转覆盖运行时兜底分支
    expect(t('en', 'contactBadge.missing' as Key)).toBe('contactBadge.missing');
  });
});

describe('resolveInitialLocale 启动优先级（?lang > localStorage > zh）', () => {
  it('?lang=en 优先于 localStorage 存值', () => {
    expect(resolveInitialLocale('?lang=en', 'zh')).toBe('en');
    expect(resolveInitialLocale('?lang=zh', 'en')).toBe('zh');
  });

  it('无参数时取 localStorage 合法存值', () => {
    expect(resolveInitialLocale('', 'en')).toBe('en');
    expect(resolveInitialLocale('', 'zh')).toBe('zh');
  });

  it('非法参数不短路优先级链（落到 localStorage）', () => {
    expect(resolveInitialLocale('?lang=fr', 'en')).toBe('en');
  });

  it('参数与存值均缺失/非法时回默认 zh', () => {
    expect(resolveInitialLocale('', null)).toBe(DEFAULT_LOCALE);
    expect(resolveInitialLocale('', 'de')).toBe('zh');
    expect(resolveInitialLocale('?foo=1', null)).toBe('zh');
  });
});

describe('htmlLangFor', () => {
  it('zh → zh-CN（与 SSR 初始值/SEO metadata 一致）、en → en', () => {
    expect(htmlLangFor('zh')).toBe('zh-CN');
    expect(htmlLangFor('en')).toBe('en');
  });
});

describe('persistLocale / readStoredLocale', () => {
  it('写入并读回登记键名', () => {
    persistLocale('en');
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('en');
    expect(readStoredLocale()).toBe('en');
  });

  it('未写入时读回 null', () => {
    expect(readStoredLocale()).toBeNull();
  });

  it('存取异常静默兜底（隐私模式等）', () => {
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(() => persistLocale('en')).not.toThrow();
    expect(readStoredLocale()).toBeNull();
  });
});

describe('syncHtmlLang', () => {
  it('同步 <html lang>（en ↔ zh-CN 往返）', () => {
    syncHtmlLang('en');
    expect(document.documentElement.lang).toBe('en');
    syncHtmlLang('zh');
    expect(document.documentElement.lang).toBe('zh-CN');
  });

  it('无 DOM 环境静默兜底', () => {
    jest.spyOn(document, 'documentElement', 'get').mockImplementation(() => {
      throw new Error('no dom');
    });
    expect(() => syncHtmlLang('en')).not.toThrow();
  });
});
