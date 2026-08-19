/**
 * LE-M1 月食星历 loader 单测：校验器防御路径 + 加载缓存/降级语义
 * （bakedDataSolarEclipse.test.ts 同范式；合法产物锚点在 lunarEclipseBaked.test.ts）
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  loadLunarEclipses,
  resetBakedDataCache,
  validateLunarEclipses,
} from '../bakedData';

const eclipsesRaw = JSON.parse(
  readFileSync(join(process.cwd(), 'public/data/lunar_eclipses.json'), 'utf8')
) as Record<string, unknown>;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function mutate(fn: (draft: any) => void): unknown {
  const draft = clone(eclipsesRaw);
  fn(draft);
  return draft;
}

afterEach(() => {
  resetBakedDataCache();
  jest.restoreAllMocks();
});

describe('validateLunarEclipses', () => {
  it('接受真实产物', () => {
    expect(validateLunarEclipses(clone(eclipsesRaw))).not.toBeNull();
  });

  it('拒绝非对象/缺 events/事件数错误/顺序错乱', () => {
    expect(validateLunarEclipses(null)).toBeNull();
    expect(validateLunarEclipses('x')).toBeNull();
    expect(validateLunarEclipses({})).toBeNull();
    expect(validateLunarEclipses(mutate((d) => d.events.pop()))).toBeNull();
    expect(validateLunarEclipses(mutate((d) => (d.events[0] = null)))).toBeNull();
    expect(
      validateLunarEclipses(
        mutate((d) => ([d.events[0], d.events[1]] = [d.events[1], d.events[0]]))
      )
    ).toBeNull();
  });

  it('拒绝元数据越界（kind 不匹配/食分/γ/saros/danjonDefault/日期）', () => {
    expect(validateLunarEclipses(mutate((d) => (d.events[0].kind = 'partial')))).toBeNull();
    expect(validateLunarEclipses(mutate((d) => (d.events[0].dateUtc = '')))).toBeNull();
    expect(validateLunarEclipses(mutate((d) => (d.events[0].saros = 1.5)))).toBeNull();
    expect(validateLunarEclipses(mutate((d) => (d.events[0].umbralMag = 4)))).toBeNull();
    expect(validateLunarEclipses(mutate((d) => (d.events[0].penumbralMag = -1)))).toBeNull();
    expect(validateLunarEclipses(mutate((d) => (d.events[0].gamma = 1.7)))).toBeNull();
    expect(validateLunarEclipses(mutate((d) => (d.events[0].danjonDefault = 5)))).toBeNull();
  });

  it('拒绝观测点/接触时刻非法', () => {
    expect(validateLunarEclipses(mutate((d) => (d.events[0].observer = null)))).toBeNull();
    expect(validateLunarEclipses(mutate((d) => (d.events[0].observer.latDeg = 91)))).toBeNull();
    expect(validateLunarEclipses(mutate((d) => (d.events[0].observer.lonDeg = 200)))).toBeNull();
    expect(validateLunarEclipses(mutate((d) => (d.events[0].observer.label = '')))).toBeNull();
    expect(validateLunarEclipses(mutate((d) => (d.events[0].contacts = null)))).toBeNull();
    expect(validateLunarEclipses(mutate((d) => (d.events[0].contacts.p1 = NaN)))).toBeNull();
    expect(validateLunarEclipses(mutate((d) => (d.events[0].contacts.u2 = 'x')))).toBeNull();
    // 接触时刻乱序
    expect(
      validateLunarEclipses(
        mutate((d) => {
          const c = d.events[0].contacts;
          [c.p1, c.p4] = [c.p4, c.p1];
        })
      )
    ).toBeNull();
  });

  it('拒绝类型 ↔ 接触时刻缺省不一致（契约 C2）', () => {
    // 全食缺 U2
    expect(validateLunarEclipses(mutate((d) => (d.events[0].contacts.u2 = null)))).toBeNull();
    // 偏食（l2026，下标 1）冒出 U2
    expect(
      validateLunarEclipses(
        mutate((d) => (d.events[1].contacts.u2 = d.events[1].contacts.u1 + 60))
      )
    ).toBeNull();
    // 半影食（l2027，下标 2）冒出 U1
    expect(
      validateLunarEclipses(
        mutate((d) => (d.events[2].contacts.u1 = d.events[2].contacts.p1 + 60))
      )
    ).toBeNull();
  });

  it('拒绝序列结构非法（行宽/非数值/过短/窗口不覆盖）', () => {
    expect(validateLunarEclipses(mutate((d) => (d.events[0].topo = null)))).toBeNull();
    expect(validateLunarEclipses(mutate((d) => (d.events[0].topo.dtSec = 0)))).toBeNull();
    expect(validateLunarEclipses(mutate((d) => (d.events[0].topo.rows = [[1, 2, 3, 4]])))).toBeNull();
    expect(validateLunarEclipses(mutate((d) => d.events[0].topo.rows[0].push(1)))).toBeNull();
    expect(validateLunarEclipses(mutate((d) => (d.events[0].topo.rows[0][0] = NaN)))).toBeNull();
    expect(validateLunarEclipses(mutate((d) => (d.events[0].geo.rows[0] = [1, 2])))).toBeNull();
    expect(
      validateLunarEclipses(mutate((d) => (d.events[0].topo.t0 = d.events[0].contacts.p1 + 60)))
    ).toBeNull();
    expect(
      validateLunarEclipses(mutate((d) => (d.events[0].geo.t0 = d.events[0].contacts.p1 + 60)))
    ).toBeNull();
  });
});

describe('loadLunarEclipses', () => {
  it('成功加载并按 URL 缓存（第二次不再 fetch）', async () => {
    const mock = jest
      .fn()
      .mockResolvedValue({ ok: true, json: () => Promise.resolve(clone(eclipsesRaw)) });
    global.fetch = mock as unknown as typeof fetch;
    const first = await loadLunarEclipses();
    expect(first).not.toBeNull();
    expect(first?.events).toHaveLength(4);
    const second = await loadLunarEclipses();
    expect(second).toBe(first);
    expect(mock).toHaveBeenCalledTimes(1);
    expect(mock.mock.calls[0][0]).toBe('/data/lunar_eclipses.json');
  });

  it('HTTP 失败 / 网络异常返回 null 且不缓存', async () => {
    const mock = jest.fn().mockResolvedValue({ ok: false });
    global.fetch = mock as unknown as typeof fetch;
    expect(await loadLunarEclipses()).toBeNull();
    // 失败不缓存：再次调用重新 fetch
    await loadLunarEclipses();
    expect(mock).toHaveBeenCalledTimes(2);
    global.fetch = jest.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch;
    expect(await loadLunarEclipses()).toBeNull();
  });
});
