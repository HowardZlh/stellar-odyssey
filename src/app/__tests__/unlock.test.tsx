/**
 * 解锁页 /unlock 单测（U3，REQUIREMENTS_UNLOCK.md §U3 验收）：
 * - 骨架渲染（对价口径 intro / 退款口径 / 免费态状态区 / 返回链接）
 * - 档位价格表消费 UNLOCK_TIERS（价格零硬编码断言）+ isCompact 布局分流
 * - 三通道：爱发电/Ko-fi 同源常量链接、微信二维码展开/收起、邮件 CTA
 * - 爱发电兑换：订单号前端校验、mock fetch 成功 + §0.5 全部错误码 +
 *   非法响应体 + 网络失败可重试
 * - token 粘贴：合法激活 / 篡改（签名）/ 过期 / 格式错三态分开提示
 * - `/unlock?token=` URL 注入自动激活与非法报错
 * - 已激活态：档位/到期日/剩余天数、复制 token（成功/降级）、清除二次确认
 * - zh/EN 切换
 *
 * 判据注入：useViewportKind 经 jest.mock（禁止自建检测的消费方测试范式，
 * 沿用 contributorsMobile.test.tsx）；验签公钥经 jest.mock 懒 getter 注入
 * 测试密钥对（生产公钥对应私钥不在仓库，测试自签闭环；store 的
 * applyUnlockToken/restoreUnlockState 同经该 mock 验签——U2 合流后
 * 页面激活链路全走 store actions）。
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as ed from '@noble/ed25519';

import UnlockPage from '@/app/unlock/page';
import { CONTACT_EMAIL, SPONSOR_AFDIAN_URL } from '@/components/UI/ContactBadge';
import { SPONSOR_KOFI_URL } from '@/data/donationPlatforms';
import { UNLOCK_TIERS } from '@/data/unlockPricing';
import { useSimulationStore } from '@/store';
import { formatExpiryDate } from '@/utils/unlockRedeem';
import { UNLOCK_TOKEN_STORAGE_KEY } from '@/utils/unlockStorage';
import {
  bytesToHex,
  signToken,
  type UnlockTokenPayload,
} from '@/utils/unlockToken';

// M1 视口判据注入（页面消费 useViewportKind 返回值，禁止自建检测）
const mockViewport: {
  isTouch: boolean;
  isCompact: boolean;
  orientation: 'landscape' | 'portrait';
} = { isTouch: false, isCompact: false, orientation: 'landscape' };
jest.mock('@/hooks/useViewportKind', () => ({
  __esModule: true,
  useViewportKind: (): typeof mockViewport => mockViewport,
  useDeviceTierInit: (): void => {},
}));

// 验签公钥注入：懒 getter（jest.mock 工厂 hoist 后于首次属性访问时取值，
// 此时模块级测试密钥常量已初始化完成）
jest.mock('@/data/unlockPublicKey', () => ({
  __esModule: true,
  get UNLOCK_PUBLIC_KEY_HEX(): string {
    return mockPublicKeyHex;
  },
}));

/** 测试专用固定私钥（仅测试代码持有，与生产密钥无关） */
const TEST_PRIVATE_KEY = Uint8Array.from({ length: 32 }, (_, i) => i + 11);
// import '@/utils/unlockToken' 的模块副作用已注入 ed.hashes.sha512
const mockPublicKeyHex = bytesToHex(ed.getPublicKey(TEST_PRIVATE_KEY));

/** 相对真实时钟的基准（页面用 Date.now()，token exp 须相对真实时钟） */
const NOW_SEC = Math.floor(Date.now() / 1000);

function makeToken(overrides: Partial<UnlockTokenPayload> = {}): string {
  return signToken(
    {
      v: 1,
      tier: 'month',
      exp: NOW_SEC + 31 * 86_400,
      iat: NOW_SEC,
      ch: 'afdian',
      ...overrides,
    },
    TEST_PRIVATE_KEY,
  );
}

/** 签名合法但 payload 段被替换的伪造 token（签名不匹配 → signature 拒绝） */
function makeForgedToken(): string {
  const original = makeToken({ tier: 'week' });
  const upgraded = makeToken({ tier: 'year' });
  const sigPart = original.split('.')[2];
  const [prefix, payloadPart] = upgraded.split('.');
  return `${prefix}.${payloadPart}.${sigPart}`;
}

const VALID_ORDER_ID = '20260812123456789012';

/** mock fetch 一次 JSON 响应 */
function mockFetchJsonOnce(body: unknown): jest.Mock {
  const fn = global.fetch as jest.Mock;
  fn.mockResolvedValueOnce({ json: async (): Promise<unknown> => body });
  return fn;
}

beforeEach(() => {
  global.fetch = jest.fn() as unknown as typeof fetch;
});

afterEach(() => {
  useSimulationStore.setState({ locale: 'zh', entitlement: null });
  window.localStorage.clear();
  window.history.replaceState(null, '', '/unlock');
  mockViewport.isCompact = false;
  jest.restoreAllMocks();
});

describe('U3-1 页面骨架与档位表', () => {
  it('渲染标题/副标题/对价口径说明/退款口径/免费态状态区', () => {
    render(<UnlockPage />);
    expect(screen.getByRole('heading', { name: /支持者解锁/ })).toBeInTheDocument();
    expect(screen.getByText(/明码标价的限时访问对价/)).toBeInTheDocument();
    expect(screen.getByText(/未兑换订单可发邮件申请原路退回；已兑换不退；不提供发票/)).toBeInTheDocument();
    expect(screen.getByText(/当前为免费体验/)).toBeInTheDocument();
    // 权益说明：被解锁内容概览
    expect(screen.getByText(/全部近观细节层/)).toBeInTheDocument();
    expect(screen.getByText(/L3\/L4 巡游序列/)).toBeInTheDocument();
    expect(screen.getByText(/事件演示不限次/)).toBeInTheDocument();
  });

  it('返回主站链接指向 /', () => {
    render(<UnlockPage />);
    const back = screen.getAllByRole('link', { name: /返回星图/ });
    expect(back.length).toBeGreaterThan(0);
    expect(back[0]).toHaveAttribute('href', '/');
  });

  it('桌面档位表消费 UNLOCK_TIERS 单一事实源（表格形态）', () => {
    render(<UnlockPage />);
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByText('周卡')).toBeInTheDocument();
    expect(screen.getByText('月卡')).toBeInTheDocument();
    expect(screen.getByText('年卡')).toBeInTheDocument();
    // 价格与时长零硬编码：断言值直接来自 UNLOCK_TIERS
    for (const tier of ['week', 'month', 'year'] as const) {
      expect(
        screen.getByText(`¥${UNLOCK_TIERS[tier].priceCny}`),
      ).toBeInTheDocument();
      expect(
        screen.getByText(`$${UNLOCK_TIERS[tier].priceUsd}`),
      ).toBeInTheDocument();
      expect(
        screen.getByText(`${UNLOCK_TIERS[tier].days} 天`),
      ).toBeInTheDocument();
    }
  });

  it('isCompact 布局分流：堆叠卡片替代表格（价格仍消费 UNLOCK_TIERS）', () => {
    mockViewport.isCompact = true;
    render(<UnlockPage />);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByText(`¥${UNLOCK_TIERS.year.priceCny}`)).toBeInTheDocument();
    expect(screen.getByText('周卡')).toBeInTheDocument();
  });
});

describe('U3-2 三通道兑换', () => {
  it('爱发电/Ko-fi 链接为同源常量（新标签页）', () => {
    render(<UnlockPage />);
    const afdian = screen.getByRole('link', { name: '前往爱发电购买' });
    expect(afdian).toHaveAttribute('href', SPONSOR_AFDIAN_URL);
    expect(afdian).toHaveAttribute('target', '_blank');
    const kofi = screen.getByRole('link', { name: /前往 Ko-fi 支付/ });
    expect(kofi).toHaveAttribute('href', SPONSOR_KOFI_URL);
    expect(kofi).toHaveAttribute('target', '_blank');
  });

  it('微信/Ko-fi 邮件兑换 CTA 指向同源邮箱（mailto）', () => {
    render(<UnlockPage />);
    const mails = screen.getAllByRole('link', { name: /发送兑换邮件/ });
    expect(mails).toHaveLength(2);
    for (const mail of mails) {
      expect(mail.getAttribute('href')).toContain(`mailto:${CONTACT_EMAIL}`);
    }
    // 指引文案中的邮箱经 {email} 插值为同源常量
    const guides = screen.getAllByText(new RegExp(CONTACT_EMAIL));
    expect(guides.length).toBeGreaterThanOrEqual(2);
  });

  it('微信赞赏码：展开二维码与档位金额提示、点图收起', () => {
    render(<UnlockPage />);
    expect(screen.queryByRole('img', { name: '微信赞赏码' })).not.toBeInTheDocument();
    const toggle = screen.getByRole('button', { name: '展开赞赏码' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(toggle);
    const qr = screen.getByRole('img', { name: '微信赞赏码' });
    expect(qr).toHaveAttribute('src', '/donate/wechat-tip-code.jpg');
    expect(screen.getByText(/金额请按档位价格支付/)).toBeInTheDocument();
    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(qr);
    expect(screen.queryByRole('img', { name: '微信赞赏码' })).not.toBeInTheDocument();
  });

  it('订单号前端校验：非 14-40 位数字直接报错且不发请求', () => {
    render(<UnlockPage />);
    const input = screen.getByLabelText('爱发电订单号');
    fireEvent.change(input, { target: { value: '123' } });
    fireEvent.click(screen.getByRole('button', { name: '兑换' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/订单号应为 14-40 位数字/);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('兑换成功：POST 生产端点 → store applyUnlockToken → 激活态展示', async () => {
    const token = makeToken({ tier: 'year', exp: NOW_SEC + 366 * 86_400 });
    const fetchMock = mockFetchJsonOnce({
      ok: true,
      token,
      tier: 'year',
      expiresAt: NOW_SEC + 366 * 86_400,
    });
    render(<UnlockPage />);
    fireEvent.change(screen.getByLabelText('爱发电订单号'), {
      target: { value: VALID_ORDER_ID },
    });
    fireEvent.click(screen.getByRole('button', { name: '兑换' }));

    expect(await screen.findByText(/兑换成功，权益已激活/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      'https://stellar.guushu.com/api/redeem',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ orderId: VALID_ORDER_ID }),
      }),
    );
    // 权益状态区切换为激活态 + store 验签成功后 persist（U2 链路收敛）
    expect(screen.getByText('✅ 权益已激活')).toBeInTheDocument();
    // 档位名同时出现在档位表与状态区（激活态字段展示）
    expect(screen.getAllByText('年卡')).toHaveLength(2);
    expect(window.localStorage.getItem(UNLOCK_TOKEN_STORAGE_KEY)).toBe(token);
  });

  it.each([
    ['invalid_order', /订单号无效/],
    ['order_not_paid', /订单未完成支付/],
    ['amount_too_low', /订单金额不足最低档位/],
    ['already_redeemed_conflict', /该订单已被兑换过/],
    ['upstream_error', /订单查询服务暂时不可用/],
    ['not_configured', /兑换服务尚未开通/],
  ] as const)('错误码 %s → 用户可读提示', async (code, message) => {
    mockFetchJsonOnce({ ok: false, error: code });
    render(<UnlockPage />);
    fireEvent.change(screen.getByLabelText('爱发电订单号'), {
      target: { value: VALID_ORDER_ID },
    });
    fireEvent.click(screen.getByRole('button', { name: '兑换' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(window.localStorage.getItem(UNLOCK_TOKEN_STORAGE_KEY)).toBeNull();
  });

  it('响应体形状不符/非 JSON → 未知错误提示', async () => {
    mockFetchJsonOnce({ unexpected: true });
    render(<UnlockPage />);
    fireEvent.change(screen.getByLabelText('爱发电订单号'), {
      target: { value: VALID_ORDER_ID },
    });
    fireEvent.click(screen.getByRole('button', { name: '兑换' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/未知错误/);

    // 非 JSON 响应体（json() 抛错）同样按未知错误提示
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      json: async (): Promise<unknown> => {
        throw new Error('not json');
      },
    });
    fireEvent.click(screen.getByRole('button', { name: '兑换' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/未知错误/);
  });

  it('服务端返回 token 但本地验签不过 → 签名错误提示（不激活）', async () => {
    mockFetchJsonOnce({
      ok: true,
      token: makeForgedToken(),
      tier: 'year',
      expiresAt: NOW_SEC + 366 * 86_400,
    });
    render(<UnlockPage />);
    fireEvent.change(screen.getByLabelText('爱发电订单号'), {
      target: { value: VALID_ORDER_ID },
    });
    fireEvent.click(screen.getByRole('button', { name: '兑换' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/签名校验失败/);
    expect(window.localStorage.getItem(UNLOCK_TOKEN_STORAGE_KEY)).toBeNull();
  });

  it('网络失败 → 可重试提示，重试成功', async () => {
    const token = makeToken();
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('offline'));
    render(<UnlockPage />);
    fireEvent.change(screen.getByLabelText('爱发电订单号'), {
      target: { value: VALID_ORDER_ID },
    });
    fireEvent.click(screen.getByRole('button', { name: '兑换' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/网络请求失败/);

    mockFetchJsonOnce({
      ok: true,
      token,
      tier: 'month',
      expiresAt: NOW_SEC + 31 * 86_400,
    });
    fireEvent.click(screen.getByRole('button', { name: '兑换' }));
    expect(await screen.findByText(/兑换成功，权益已激活/)).toBeInTheDocument();
    expect(window.localStorage.getItem(UNLOCK_TOKEN_STORAGE_KEY)).toBe(token);
  });
});

describe('U3-2 token 粘贴激活（三态分开提示）', () => {
  it('合法 token → 激活 + persist + 输入框清空', async () => {
    const token = makeToken();
    render(<UnlockPage />);
    const input = screen.getByLabelText('解锁 token');
    fireEvent.change(input, { target: { value: `  ${token}  ` } });
    fireEvent.click(screen.getByRole('button', { name: '激活' }));

    expect(await screen.findByText(/权益已激活！/)).toBeInTheDocument();
    expect(screen.getAllByText('月卡')).toHaveLength(2);
    expect(window.localStorage.getItem(UNLOCK_TOKEN_STORAGE_KEY)).toBe(token);
    expect(input).toHaveValue('');
  });

  it('篡改 token（payload 换段）→ 签名错误提示', () => {
    render(<UnlockPage />);
    fireEvent.change(screen.getByLabelText('解锁 token'), {
      target: { value: makeForgedToken() },
    });
    fireEvent.click(screen.getByRole('button', { name: '激活' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/签名校验失败/);
    expect(window.localStorage.getItem(UNLOCK_TOKEN_STORAGE_KEY)).toBeNull();
  });

  it('过期 token → 过期提示', () => {
    render(<UnlockPage />);
    fireEvent.change(screen.getByLabelText('解锁 token'), {
      target: { value: makeToken({ exp: NOW_SEC - 100, iat: NOW_SEC - 86_400 }) },
    });
    fireEvent.click(screen.getByRole('button', { name: '激活' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/token 已过期/);
  });

  it('格式错 token → 格式提示', () => {
    render(<UnlockPage />);
    fireEvent.change(screen.getByLabelText('解锁 token'), {
      target: { value: 'garbage-not-a-token' },
    });
    fireEvent.click(screen.getByRole('button', { name: '激活' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/token 格式不正确/);
  });
});

describe('U3-3 URL 注入与已激活态', () => {
  it('`/unlock?token=` 合法 → 自动激活并 persist', async () => {
    const token = makeToken({ tier: 'week', exp: NOW_SEC + 7 * 86_400 });
    window.history.replaceState(null, '', `/unlock?token=${token}`);
    render(<UnlockPage />);
    expect(await screen.findByText('✅ 权益已激活')).toBeInTheDocument();
    expect(screen.getAllByText('周卡')).toHaveLength(2);
    expect(window.localStorage.getItem(UNLOCK_TOKEN_STORAGE_KEY)).toBe(token);
  });

  it('`?token=` 非法 → token 区报错，保持免费态', async () => {
    window.history.replaceState(null, '', '/unlock?token=SO1.bad.token');
    render(<UnlockPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/token 格式不正确/);
    expect(screen.getByText(/当前为免费体验/)).toBeInTheDocument();
  });

  it('localStorage 存有合法 token → 启动即恢复激活态（档位/到期日/剩余天数）', async () => {
    const exp = NOW_SEC + 31 * 86_400;
    const token = makeToken({ exp });
    window.localStorage.setItem(UNLOCK_TOKEN_STORAGE_KEY, token);
    render(<UnlockPage />);
    expect(await screen.findByText('✅ 权益已激活')).toBeInTheDocument();
    expect(screen.getAllByText('月卡')).toHaveLength(2);
    expect(screen.getByText(formatExpiryDate(exp, 'zh'))).toBeInTheDocument();
    // "31 天" 同时出现在档位表（月卡时长）与状态区（剩余天数）
    expect(screen.getAllByText('31 天')).toHaveLength(2);
  });

  it('localStorage 存过期 token → 保持免费态（到期降级）', () => {
    window.localStorage.setItem(
      UNLOCK_TOKEN_STORAGE_KEY,
      makeToken({ exp: NOW_SEC - 100, iat: NOW_SEC - 86_400 }),
    );
    render(<UnlockPage />);
    expect(screen.getByText(/当前为免费体验/)).toBeInTheDocument();
    expect(screen.queryByText('✅ 权益已激活')).not.toBeInTheDocument();
  });

  it('复制我的 token：clipboard 成功 → 已复制提示', async () => {
    const token = makeToken();
    window.localStorage.setItem(UNLOCK_TOKEN_STORAGE_KEY, token);
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    render(<UnlockPage />);
    fireEvent.click(
      await screen.findByRole('button', { name: /复制解锁 token/ }),
    );
    expect(await screen.findByText(/已复制到剪贴板/)).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith(token);
  });

  it('复制失败 → 降级提示 + 只读文本框展示完整 token', async () => {
    const token = makeToken();
    window.localStorage.setItem(UNLOCK_TOKEN_STORAGE_KEY, token);
    Object.defineProperty(window.navigator, 'clipboard', {
      value: { writeText: jest.fn().mockRejectedValue(new Error('denied')) },
      configurable: true,
    });
    render(<UnlockPage />);
    fireEvent.click(
      await screen.findByRole('button', { name: /复制解锁 token/ }),
    );
    expect(await screen.findByText(/自动复制失败/)).toBeInTheDocument();
    expect(screen.getByDisplayValue(token)).toBeInTheDocument();
  });

  it('清除权益：二次确认后清 localStorage 回免费态；取消不清除', async () => {
    const token = makeToken();
    window.localStorage.setItem(UNLOCK_TOKEN_STORAGE_KEY, token);
    render(<UnlockPage />);
    await screen.findByText('✅ 权益已激活');

    // 取消路径
    fireEvent.click(screen.getByRole('button', { name: '清除权益' }));
    expect(screen.getByText(/请先妥存 token/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(screen.queryByText(/请先妥存 token/)).not.toBeInTheDocument();
    expect(window.localStorage.getItem(UNLOCK_TOKEN_STORAGE_KEY)).toBe(token);

    // 确认路径
    fireEvent.click(screen.getByRole('button', { name: '清除权益' }));
    fireEvent.click(screen.getByRole('button', { name: '确认清除' }));
    await waitFor(() => {
      expect(screen.getByText(/当前为免费体验/)).toBeInTheDocument();
    });
    expect(window.localStorage.getItem(UNLOCK_TOKEN_STORAGE_KEY)).toBeNull();
  });
});

describe('i18n zh/EN 切换', () => {
  it('EN 切换后标题/档位/通道/退款文案切英文', () => {
    render(<UnlockPage />);
    fireEvent.click(screen.getByRole('button', { name: 'EN' }));
    expect(
      screen.getByRole('heading', { name: /Supporter Unlock/ }),
    ).toBeInTheDocument();
    expect(screen.getByText('Week Pass')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Buy on Afdian' })).toBeInTheDocument();
    expect(screen.getByText(/non-refundable/)).toBeInTheDocument();
    // intro 与状态区均含 "free experience"（i18n 文案二义），收紧为状态区句首
    expect(screen.getByText(/^You are on the free experience/)).toBeInTheDocument();
  });

  it('EN 已激活态字段切英文（档位/剩余天数）', async () => {
    window.localStorage.setItem(UNLOCK_TOKEN_STORAGE_KEY, makeToken());
    render(<UnlockPage />);
    fireEvent.click(screen.getByRole('button', { name: 'EN' }));
    expect(await screen.findByText(/Access active/)).toBeInTheDocument();
    expect(screen.getAllByText('Month Pass')).toHaveLength(2);
    expect(screen.getAllByText('31 days')).toHaveLength(2);
  });
});
