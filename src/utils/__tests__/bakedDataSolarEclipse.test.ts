/**
 * E-M1 日食星历/月缘剖面 loader 单测：校验器防御路径 + 加载缓存/降级语义
 * （bakedData.test.ts 同范式；合法产物锚点在 solarEclipseBaked.test.ts）
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  loadSolarEclipses,
  loadLunarLimbProfile,
  resetBakedDataCache,
  validateSolarEclipses,
  validateLunarLimbProfile,
} from '../bakedData';

const eclipsesRaw = JSON.parse(
  readFileSync(join(process.cwd(), 'public/data/solar_eclipses.json'), 'utf8')
) as Record<string, unknown>;
const limbRaw = JSON.parse(
  readFileSync(join(process.cwd(), 'public/data/lunar_limb_profile.json'), 'utf8')
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

describe('validateSolarEclipses', () => {
  it('接受真实产物', () => {
    expect(validateSolarEclipses(clone(eclipsesRaw))).not.toBeNull();
  });

  it('拒绝非对象/缺 events/事件数错误', () => {
    expect(validateSolarEclipses(null)).toBeNull();
    expect(validateSolarEclipses('x')).toBeNull();
    expect(validateSolarEclipses({})).toBeNull();
    expect(validateSolarEclipses(mutate((d) => d.events.pop()))).toBeNull();
    expect(validateSolarEclipses(mutate((d) => (d.events[0] = null)))).toBeNull();
  });

  it('拒绝事件 id 顺序错乱 / kind 非 total / 元数据越界', () => {
    expect(
      validateSolarEclipses(mutate((d) => ([d.events[0], d.events[1]] = [d.events[1], d.events[0]])))
    ).toBeNull();
    expect(validateSolarEclipses(mutate((d) => (d.events[0].kind = 'annular')))).toBeNull();
    expect(validateSolarEclipses(mutate((d) => (d.events[0].dateUtc = '')))).toBeNull();
    expect(validateSolarEclipses(mutate((d) => (d.events[0].saros = 1.5)))).toBeNull();
    expect(validateSolarEclipses(mutate((d) => (d.events[0].magnitude = 0.9)))).toBeNull();
    expect(validateSolarEclipses(mutate((d) => (d.events[0].gammaAbs = 2)))).toBeNull();
  });

  it('拒绝观测点/接触时刻非法', () => {
    expect(validateSolarEclipses(mutate((d) => (d.events[0].observer = null)))).toBeNull();
    expect(validateSolarEclipses(mutate((d) => (d.events[0].observer.latDeg = 91)))).toBeNull();
    expect(validateSolarEclipses(mutate((d) => (d.events[0].observer.lonDeg = 200)))).toBeNull();
    expect(validateSolarEclipses(mutate((d) => (d.events[0].observer.label = '')))).toBeNull();
    expect(validateSolarEclipses(mutate((d) => (d.events[0].contacts = null)))).toBeNull();
    expect(validateSolarEclipses(mutate((d) => (d.events[0].contacts.c2 = NaN)))).toBeNull();
    // 接触时刻乱序
    expect(
      validateSolarEclipses(
        mutate((d) => {
          const c = d.events[0].contacts;
          [c.c1, c.c4] = [c.c4, c.c1];
        })
      )
    ).toBeNull();
  });

  it('拒绝序列结构非法（行宽/非数值/过短/窗口不覆盖接触时刻）', () => {
    expect(validateSolarEclipses(mutate((d) => (d.events[0].topo = null)))).toBeNull();
    expect(validateSolarEclipses(mutate((d) => (d.events[0].topo.dtSec = 0)))).toBeNull();
    expect(validateSolarEclipses(mutate((d) => (d.events[0].topo.rows = [[1]])))).toBeNull();
    expect(
      validateSolarEclipses(mutate((d) => d.events[0].topo.rows[0].push(1)))
    ).toBeNull();
    expect(
      validateSolarEclipses(mutate((d) => (d.events[0].fineC2.rows[0][0] = NaN)))
    ).toBeNull();
    expect(validateSolarEclipses(mutate((d) => (d.events[0].geo.rows[0] = [1, 2])))).toBeNull();
    // topo 窗口挪出接触时刻域
    expect(
      validateSolarEclipses(mutate((d) => (d.events[0].topo.t0 = d.events[0].contacts.c1 + 60)))
    ).toBeNull();
    expect(
      validateSolarEclipses(mutate((d) => (d.events[0].fineC2.t0 = d.events[0].contacts.c2 + 10)))
    ).toBeNull();
    expect(
      validateSolarEclipses(mutate((d) => (d.events[0].fineC3.t0 = d.events[0].contacts.c3 + 10)))
    ).toBeNull();
  });

  it('拒绝路径折线非法', () => {
    expect(validateSolarEclipses(mutate((d) => (d.events[0].path = [])))).toBeNull();
    expect(validateSolarEclipses(mutate((d) => (d.events[0].path[0] = [1, 2])))).toBeNull();
    expect(validateSolarEclipses(mutate((d) => (d.events[0].path[0][2] = NaN)))).toBeNull();
  });
});

describe('validateLunarLimbProfile', () => {
  it('接受真实产物', () => {
    expect(validateLunarLimbProfile(clone(limbRaw))).not.toBeNull();
  });

  it('拒绝结构/数值域非法', () => {
    expect(validateLunarLimbProfile(null)).toBeNull();
    expect(validateLunarLimbProfile({})).toBeNull();
    const noSource = clone(limbRaw);
    noSource.source = '';
    expect(validateLunarLimbProfile(noSource)).toBeNull();
    const badRadius = clone(limbRaw);
    badRadius.meanRadiusKm = 1700;
    expect(validateLunarLimbProfile(badRadius)).toBeNull();
    const shortSamples = clone(limbRaw);
    (shortSamples.samples as number[]).pop();
    expect(validateLunarLimbProfile(shortSamples)).toBeNull();
    const outOfBound = clone(limbRaw);
    (outOfBound.samples as number[])[0] = 12;
    expect(validateLunarLimbProfile(outOfBound)).toBeNull();
    const nan = clone(limbRaw);
    (nan.samples as number[])[0] = NaN;
    expect(validateLunarLimbProfile(nan)).toBeNull();
  });
});

describe('loadSolarEclipses / loadLunarLimbProfile', () => {
  it('成功加载并按 URL 缓存（第二次不再 fetch）', async () => {
    const mock = jest
      .fn()
      .mockResolvedValue({ ok: true, json: () => Promise.resolve(clone(eclipsesRaw)) });
    global.fetch = mock as unknown as typeof fetch;
    const first = await loadSolarEclipses();
    expect(first).not.toBeNull();
    const second = await loadSolarEclipses();
    expect(second).toBe(first);
    expect(mock).toHaveBeenCalledTimes(1);
    expect(mock.mock.calls[0][0]).toBe('/data/solar_eclipses.json');
  });

  it('HTTP 失败 / 校验失败返回 null 且不缓存', async () => {
    const mock = jest.fn().mockResolvedValue({ ok: false });
    global.fetch = mock as unknown as typeof fetch;
    expect(await loadSolarEclipses()).toBeNull();
    expect(await loadLunarLimbProfile()).toBeNull();
    expect(mock).toHaveBeenCalledTimes(2);
    // 失败不缓存：再次调用重新 fetch
    await loadSolarEclipses();
    expect(mock).toHaveBeenCalledTimes(3);
  });

  it('网络异常返回 null；月缘产物成功路径', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch;
    expect(await loadSolarEclipses()).toBeNull();
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: true, json: () => Promise.resolve(clone(limbRaw)) }) as unknown as typeof fetch;
    const limbData = await loadLunarLimbProfile();
    expect(limbData).not.toBeNull();
    expect(limbData?.samples).toHaveLength(720);
  });
});
