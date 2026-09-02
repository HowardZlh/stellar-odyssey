/**
 * /unlock 支付宝付款 modal 状态机单测（Z 迭代 M2，REQUIREMENTS_ALIPAY_UNLOCK
 * §5.1(1)/D-z5 验收）：
 * - 档位卡片 CTA（桌面表格列 / isCompact 堆叠卡片）打开 modal
 * - 昵称/留言前端长度预检（不发请求）
 * - create：成功进 qr 态（二维码/金额/直达链接/有效期提示）；敏感词拒绝 /
 *   未配置 / 网络失败回落 input 态错误提示
 * - 轮询：3s 间隔 pending → paid 自动激活（store applyUnlockToken +
 *   persist）+ token 展示；≥60s 带 deep=1；30 分钟过期提示重新生成
 * - 订单关闭 → 过期口径；token 本地验签失败 → 终态错误
 * - isCompact 全屏抽屉分流
 *
 * 判据注入：useViewportKind 经 jest.mock（unlock.test.tsx 同范式）；
 * 验签公钥经 jest.mock 懒 getter 注入测试密钥对。
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { act } from 'react';
import * as ed from '@noble/ed25519';

import UnlockPage from '@/app/unlock/page';
import { useSimulationStore } from '@/store';
import { emptyRevocationList } from '@/utils/revocationList';
import {
  REVOCATIONS_STORAGE_KEY,
  UNLOCK_TOKEN_STORAGE_KEY,
} from '@/utils/unlockStorage';
import {
  bytesToHex,
  signToken,
  type UnlockTokenPayload,
} from '@/utils/unlockToken';

// M1 视口判据注入（禁止自建检测的消费方测试范式）
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

jest.mock('@/data/unlockPublicKey', () => ({
  __esModule: true,
  get UNLOCK_PUBLIC_KEY_HEX(): string {
    return mockPublicKeyHex;
  },
}));

/** 测试专用固定私钥（仅测试代码持有，与生产密钥无关） */
const TEST_PRIVATE_KEY = Uint8Array.from({ length: 32 }, (_, i) => i + 21);
const mockPublicKeyHex = bytesToHex(ed.getPublicKey(TEST_PRIVATE_KEY));

function makeAlipayToken(overrides: Partial<UnlockTokenPayload> = {}): string {
  const nowSec = Math.floor(Date.now() / 1000);
  return signToken(
    {
      v: 1,
      tier: 'week',
      exp: nowSec + 7 * 86_400,
      iat: nowSec,
      ch: 'alipay',
      ...overrides,
    },
    TEST_PRIVATE_KEY,
  );
}

const CREATE_URL = 'https://stellar.guushu.com/api/alipay/create';
const STATUS_URL = 'https://stellar.guushu.com/api/alipay/status';
const QR_CODE = 'https://qr.alipay.com/bax08431lkmutnyi7c0d0017';

/** create 队列 + status 响应器（吊销名单拉取按 URL 分流不占队列） */
type CreateArm = { kind: 'json'; body: unknown } | { kind: 'reject' };
const createQueue: CreateArm[] = [];
let statusResponder: (url: string) => unknown = () => ({
  ok: true,
  status: 'pending',
});
const statusCalls: string[] = [];

function okCreateBody(): unknown {
  return { ok: true, out_trade_no: 'so123abc456', qr_code: QR_CODE, amount: 6 };
}

beforeEach(() => {
  createQueue.length = 0;
  statusCalls.length = 0;
  statusResponder = (): unknown => ({ ok: true, status: 'pending' });
  global.fetch = jest.fn(async (url: unknown) => {
    const u = String(url);
    if (u.includes('/api/revocations')) {
      return { ok: true, json: async (): Promise<unknown> => ({ ok: true, list: {} }) };
    }
    // 燃料补给名单小节（共享组件）mount 拉取：默认空名单
    if (u.includes('/api/contributors')) {
      return {
        json: async (): Promise<unknown> => ({ ok: true, contributors: [] }),
      };
    }
    if (u.startsWith(STATUS_URL)) {
      statusCalls.push(u);
      return { json: async (): Promise<unknown> => statusResponder(u) };
    }
    if (u === CREATE_URL) {
      const arm = createQueue.shift();
      if (arm === undefined) throw new Error('unexpected create fetch');
      if (arm.kind === 'reject') throw new Error('offline');
      return { json: async (): Promise<unknown> => arm.body };
    }
    throw new Error(`unexpected fetch: ${u}`);
  }) as unknown as typeof fetch;
  window.localStorage.setItem(
    REVOCATIONS_STORAGE_KEY,
    JSON.stringify(emptyRevocationList()),
  );
});

afterEach(() => {
  useSimulationStore.setState({
    locale: 'zh',
    entitlement: null,
    entitlementTokenHash: null,
    entitlementRevoked: false,
    revocationCheckPending: false,
    revocationListReady: false,
    revocationCheckFailed: false,
    revocationList: emptyRevocationList(),
    lockedHint: null,
  });
  window.localStorage.clear();
  mockViewport.isCompact = false;
  jest.useRealTimers();
  jest.restoreAllMocks();
});

/** 打开周卡 modal（CTA aria-label 经 tierCtaAria 插值） */
function openWeekModal(): void {
  fireEvent.click(
    screen.getAllByRole('button', { name: /选择周卡，打开支付宝扫码付款窗口/ })[0],
  );
}

/** 进入 qr 态（默认排入一次成功 create） */
async function enterQrPhase(): Promise<void> {
  createQueue.push({ kind: 'json', body: okCreateBody() });
  openWeekModal();
  fireEvent.click(screen.getByRole('button', { name: '生成付款码' }));
  expect(await screen.findByText(/应付金额 ¥6/)).toBeInTheDocument();
}

describe('档位 CTA 与 modal 打开', () => {
  it('桌面表格：三档均有支付宝扫码 CTA，点击打开 modal（档位/价格行）', () => {
    render(<UnlockPage />);
    expect(
      screen.getAllByRole('button', { name: /打开支付宝扫码付款窗口/ }),
    ).toHaveLength(3);
    openWeekModal();
    const dialog = screen.getByRole('dialog', { name: '支付宝扫码支付' });
    expect(dialog.textContent).toContain('周卡 · ¥6 / 7 天');
    expect(screen.getByLabelText('昵称（可选）')).toBeInTheDocument();
    expect(screen.getByLabelText('留言（可选）')).toBeInTheDocument();
    expect(screen.getByText(/公开展示在贡献者名单/)).toBeInTheDocument();
  });

  it('关闭按钮收起 modal', () => {
    render(<UnlockPage />);
    openWeekModal();
    fireEvent.click(screen.getByRole('button', { name: '关闭付款窗口' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('isCompact：堆叠卡片 CTA + modal 转全屏抽屉（AGENTS 移动端 8 条）', () => {
    mockViewport.isCompact = true;
    render(<UnlockPage />);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    openWeekModal();
    const dialog = screen.getByRole('dialog', { name: '支付宝扫码支付' });
    expect(dialog.className).toContain('h-full'); // 全屏抽屉形态
    expect(dialog.className).toContain('safe-area-inset-bottom');
  });
});

describe('输入校验与 create 错误态', () => {
  it('昵称超长前端预检：直接报错不发 create 请求', () => {
    render(<UnlockPage />);
    openWeekModal();
    fireEvent.change(screen.getByLabelText('昵称（可选）'), {
      target: { value: 'x'.repeat(21) },
    });
    fireEvent.click(screen.getByRole('button', { name: '生成付款码' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/昵称过长/);
    expect(global.fetch).not.toHaveBeenCalledWith(CREATE_URL, expect.anything());
  });

  it('留言超长前端预检', () => {
    render(<UnlockPage />);
    openWeekModal();
    fireEvent.change(screen.getByLabelText('留言（可选）'), {
      target: { value: 'y'.repeat(51) },
    });
    fireEvent.click(screen.getByRole('button', { name: '生成付款码' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/留言过长/);
  });

  it.each([
    ['nickname_blocked', /昵称包含不适宜公开展示的内容/],
    ['message_blocked', /留言包含不适宜公开展示的内容/],
    ['not_configured', /支付宝支付尚未开通/],
    ['gateway_error', /支付宝预下单失败/],
    ['some_future_code', /未知错误/],
  ] as const)('服务端拒绝 %s → 可读提示并回落输入态', async (code, message) => {
    createQueue.push({ kind: 'json', body: { ok: false, error: code } });
    render(<UnlockPage />);
    openWeekModal();
    fireEvent.click(screen.getByRole('button', { name: '生成付款码' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    // 回落 input 态可修改重试
    expect(screen.getByRole('button', { name: '生成付款码' })).toBeInTheDocument();
  });

  it('网络失败 → 可重试提示；重试成功进 qr 态', async () => {
    createQueue.push({ kind: 'reject' });
    render(<UnlockPage />);
    openWeekModal();
    fireEvent.click(screen.getByRole('button', { name: '生成付款码' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/网络请求失败/);

    createQueue.push({ kind: 'json', body: okCreateBody() });
    fireEvent.click(screen.getByRole('button', { name: '生成付款码' }));
    expect(await screen.findByText(/应付金额 ¥6/)).toBeInTheDocument();
  });

  it('create 请求体：tier + trim 后昵称留言（服务端定价，不带金额）', async () => {
    createQueue.push({ kind: 'json', body: okCreateBody() });
    render(<UnlockPage />);
    openWeekModal();
    fireEvent.change(screen.getByLabelText('昵称（可选）'), {
      target: { value: ' 星友 ' },
    });
    fireEvent.change(screen.getByLabelText('留言（可选）'), {
      target: { value: '加油 ' },
    });
    fireEvent.click(screen.getByRole('button', { name: '生成付款码' }));
    await screen.findByText(/应付金额 ¥6/);
    expect(global.fetch).toHaveBeenCalledWith(
      CREATE_URL,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ tier: 'week', nickname: '星友', message: '加油' }),
      }),
    );
  });
});

describe('qr 态展示', () => {
  it('二维码画布 + 手机直达链接 + 金额与 30 分钟有效期提示 + 等待态', async () => {
    render(<UnlockPage />);
    await enterQrPhase();
    expect(
      screen.getByRole('img', { name: '支付宝付款二维码' }),
    ).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /在手机上打开支付宝付款/ });
    expect(link).toHaveAttribute('href', QR_CODE);
    expect(screen.getByText(/二维码 30 分钟内有效/)).toBeInTheDocument();
    expect(screen.getByText(/等待支付确认/)).toBeInTheDocument();
  });
});

describe('轮询状态机（D-z5，fake timers）', () => {
  it('pending → paid：自动激活（store persist）+ token 展示提示保存', async () => {
    jest.useFakeTimers();
    const token = makeAlipayToken();
    let polls = 0;
    statusResponder = (): unknown => {
      polls += 1;
      if (polls < 2) return { ok: true, status: 'pending' };
      return {
        ok: true,
        status: 'paid',
        token,
        tier: 'week',
        expiresAt: Math.floor(Date.now() / 1000) + 7 * 86_400,
      };
    };
    render(<UnlockPage />);
    await enterQrPhase();

    // 第 1 轮（3s）：pending，继续轮询
    await act(async () => {
      await jest.advanceTimersByTimeAsync(3_000);
    });
    expect(statusCalls).toHaveLength(1);
    expect(statusCalls[0]).toContain('out_trade_no=so123abc456');
    expect(statusCalls[0]).not.toContain('deep=1');

    // 第 2 轮（6s）：paid → applyUnlockToken 自动激活
    await act(async () => {
      await jest.advanceTimersByTimeAsync(3_000);
    });
    expect(screen.getByText(/支付成功，权益已激活/)).toBeInTheDocument();
    expect(screen.getByDisplayValue(token)).toBeInTheDocument();
    expect(screen.getByText(/请妥善保存/)).toBeInTheDocument();
    expect(window.localStorage.getItem(UNLOCK_TOKEN_STORAGE_KEY)).toBe(token);
    expect(useSimulationStore.getState().entitlement?.tier).toBe('week');
    // 页面权益状态区同步激活态
    expect(screen.getByText('✅ 权益已激活')).toBeInTheDocument();
    // 付款成功强引导：支付宝即时上榜，一键看自己的贡献者星（→ /contributors）
    expect(
      screen.getByRole('link', { name: /看看我的贡献者星/ }),
    ).toHaveAttribute('href', '/contributors');
  });

  it('≥60s 仍 pending：轮询带 deep=1（服务端 trade.query 兜底）', async () => {
    jest.useFakeTimers();
    render(<UnlockPage />);
    await enterQrPhase();
    await act(async () => {
      // 64s：60s 时点计划的下一轮（63s 触发）才带 deep（计划先于触发 3s）
      await jest.advanceTimersByTimeAsync(64_000);
    });
    expect(statusCalls.length).toBeGreaterThan(1);
    expect(statusCalls[0]).not.toContain('deep=1');
    expect(statusCalls[statusCalls.length - 1]).toContain('deep=1');
  });

  it('30 分钟过期：停止轮询 + 过期提示 + 重新生成回输入态', async () => {
    jest.useFakeTimers();
    render(<UnlockPage />);
    await enterQrPhase();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(30 * 60_000 + 1_000);
    });
    expect(screen.getByRole('alert')).toHaveTextContent(/二维码已过期/);
    const callsAtExpiry = statusCalls.length;
    await act(async () => {
      await jest.advanceTimersByTimeAsync(60_000);
    });
    expect(statusCalls).toHaveLength(callsAtExpiry); // 过期后零轮询

    fireEvent.click(screen.getByRole('button', { name: '重新生成付款码' }));
    expect(screen.getByRole('button', { name: '生成付款码' })).toBeInTheDocument();
  });

  it('订单被关（closed）：按过期口径提示重新生成', async () => {
    jest.useFakeTimers();
    statusResponder = (): unknown => ({ ok: true, status: 'closed' });
    render(<UnlockPage />);
    await enterQrPhase();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(3_000);
    });
    expect(screen.getByRole('alert')).toHaveTextContent(/二维码已过期/);
  });

  it('status 失败体（order_not_found）：终态错误 + 重新生成', async () => {
    jest.useFakeTimers();
    statusResponder = (): unknown => ({ ok: false, error: 'order_not_found' });
    render(<UnlockPage />);
    await enterQrPhase();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(3_000);
    });
    expect(screen.getByRole('alert')).toHaveTextContent(/订单状态查询异常/);
    expect(
      screen.getByRole('button', { name: '重新生成付款码' }),
    ).toBeInTheDocument();
  });

  it('服务端回票但本地验签不过：errTokenVerify 终态（不激活）', async () => {
    jest.useFakeTimers();
    statusResponder = (): unknown => ({
      ok: true,
      status: 'paid',
      token: 'SO1.forged.token',
      tier: 'week',
      expiresAt: Math.floor(Date.now() / 1000) + 7 * 86_400,
    });
    render(<UnlockPage />);
    await enterQrPhase();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(3_000);
    });
    expect(screen.getByRole('alert')).toHaveTextContent(/凭证校验失败/);
    expect(window.localStorage.getItem(UNLOCK_TOKEN_STORAGE_KEY)).toBeNull();
    expect(useSimulationStore.getState().entitlement).toBeNull();
  });

  it('网络抖动：单轮 fetch 失败不终止轮询，下一轮成功激活', async () => {
    jest.useFakeTimers();
    const token = makeAlipayToken({ tier: 'month', exp: Math.floor(Date.now() / 1000) + 31 * 86_400 });
    let polls = 0;
    statusResponder = (): unknown => {
      polls += 1;
      if (polls === 1) throw new Error('offline');
      return {
        ok: true,
        status: 'paid',
        token,
        tier: 'month',
        expiresAt: Math.floor(Date.now() / 1000) + 31 * 86_400,
      };
    };
    render(<UnlockPage />);
    await enterQrPhase();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(3_000);
    });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(3_000);
    });
    expect(screen.getByText(/支付成功，权益已激活/)).toBeInTheDocument();
  });
});
