/**
 * dev 录制调参解析/消毒单测（消毒矩阵：合法/非法/边界/缺失/生产态）+
 * 事件参数覆盖纯函数 + 日志换算辅助。
 */

import type { RecordingTuning, Vec3 } from '@/types';
import {
  DEFAULT_RECORDING_TUNING,
  REC_AURORA_BOOST_DEFAULT,
  REC_AURORA_BOOST_MAX,
  REC_AURORA_BOOST_MIN,
  REC_AURORA_DAYS_DEFAULT,
  REC_AURORA_DAYS_MAX,
  REC_AURORA_DAYS_MIN,
  REC_FLARE_MAG_MAX,
  REC_FLARE_MAG_MIN,
  REC_PARAM_KEYS,
  angleBetweenDeg,
  dirToLatLonDeg,
  overrideCmeRoll,
  overrideFlareRoll,
  parseRecordingTuning,
  roundTo,
  simDaysToRealSeconds,
} from '@/utils/recordingTuning';
import { AURORA_ENHANCEMENT_DAYS } from '@/utils/solarActivity';
import { parseLaunchParams } from '@/utils/launchParams';

/** 便捷解析（默认按非生产态——jest NODE_ENV=test） */
function parse(search: string, isProduction = false): RecordingTuning {
  return parseRecordingTuning(new URLSearchParams(search), isProduction);
}

describe('parseRecordingTuning 门控', () => {
  it('无任何 rec* 参数 → 默认快照（active=false）', () => {
    expect(parse('')).toEqual(DEFAULT_RECORDING_TUNING);
    expect(parse('foo=1&mode=kiosk')).toEqual(DEFAULT_RECORDING_TUNING);
  });

  it('生产构建：任意 rec* 参数恒返回默认快照（零行为差异）', () => {
    expect(
      parse('recCmeEarth=1&recCmeSpeed=500&recAuroraDays=8&recAuroraBoost=1.5&recLog=1', true),
    ).toEqual(DEFAULT_RECORDING_TUNING);
  });

  it('任一 rec* 参数出现（含非法值）→ active=true', () => {
    for (const key of REC_PARAM_KEYS) {
      expect(parse(`${key}=garbage`).active).toBe(true);
    }
  });

  it('默认常量登记：auroraDays 默认 = AURORA_ENHANCEMENT_DAYS、boost 默认 1', () => {
    expect(REC_AURORA_DAYS_DEFAULT).toBe(AURORA_ENHANCEMENT_DAYS);
    expect(REC_AURORA_BOOST_DEFAULT).toBe(1);
    expect(DEFAULT_RECORDING_TUNING.auroraDays).toBe(AURORA_ENHANCEMENT_DAYS);
  });

  it('范围常量登记（需求表：量级 1–9.9 / 时长 0.1–30 / 乘数 0.5–3）', () => {
    expect([REC_FLARE_MAG_MIN, REC_FLARE_MAG_MAX]).toEqual([1, 9.9]);
    expect([REC_AURORA_DAYS_MIN, REC_AURORA_DAYS_MAX]).toEqual([0.1, 30]);
    expect([REC_AURORA_BOOST_MIN, REC_AURORA_BOOST_MAX]).toEqual([0.5, 3]);
  });
});

describe('recCmeEarth / recLog（=1 才开启）', () => {
  it.each([
    ['recCmeEarth=1', true],
    ['recCmeEarth=0', false],
    ['recCmeEarth=true', false],
    ['recCmeEarth=', false],
  ])('%s → cmeEarth=%s', (search, expected) => {
    expect(parse(search).cmeEarth).toBe(expected);
  });

  it.each([
    ['recLog=1', true],
    ['recLog=0', false],
    ['recLog=yes', false],
  ])('%s → log=%s', (search, expected) => {
    expect(parse(search).log).toBe(expected);
  });
});

describe('recCmeSpeed（250–3000，越界/非法不覆盖）', () => {
  it.each([
    ['recCmeSpeed=250', 250],
    ['recCmeSpeed=3000', 3000],
    ['recCmeSpeed=500.5', 500.5],
  ])('%s → %d', (search, expected) => {
    expect(parse(search).cmeSpeedKmS).toBe(expected);
  });

  it.each([
    ['recCmeSpeed=249'],
    ['recCmeSpeed=3001'],
    ['recCmeSpeed=-500'],
    ['recCmeSpeed=abc'],
    ['recCmeSpeed='],
    ['recCmeSpeed=Infinity'],
    ['recCmeSpeed=NaN'],
  ])('%s → null（不覆盖）', (search) => {
    expect(parse(search).cmeSpeedKmS).toBeNull();
  });
});

describe('recFlareClass（C|M|X 大小写不敏感）/ recFlareMag（1–9.9）', () => {
  it.each([
    ['recFlareClass=X', 'X'],
    ['recFlareClass=x', 'X'],
    ['recFlareClass=m', 'M'],
    ['recFlareClass=C', 'C'],
  ])('%s → %s', (search, expected) => {
    expect(parse(search).flareClass).toBe(expected);
  });

  it.each([['recFlareClass=A'], ['recFlareClass=XX'], ['recFlareClass=']])(
    '%s → null（不覆盖）',
    (search) => {
      expect(parse(search).flareClass).toBeNull();
    },
  );

  it.each([
    ['recFlareMag=1', 1],
    ['recFlareMag=9.9', 9.9],
    ['recFlareMag=2.3', 2.3],
  ])('%s → %d', (search, expected) => {
    expect(parse(search).flareMag).toBe(expected);
  });

  it.each([['recFlareMag=0.9'], ['recFlareMag=10'], ['recFlareMag=abc']])(
    '%s → null（不覆盖）',
    (search) => {
      expect(parse(search).flareMag).toBeNull();
    },
  );
});

describe('recAuroraDays（0.1–30，默认 1.5）/ recAuroraBoost（0.5–3，默认 1）', () => {
  it.each([
    ['recAuroraDays=0.1', 0.1],
    ['recAuroraDays=30', 30],
    ['recAuroraDays=8', 8],
  ])('%s → %d', (search, expected) => {
    expect(parse(search).auroraDays).toBe(expected);
  });

  it.each([['recAuroraDays=0.05'], ['recAuroraDays=31'], ['recAuroraDays=abc']])(
    '%s 越界/非法 → 回默认 1.5',
    (search) => {
      expect(parse(search).auroraDays).toBe(REC_AURORA_DAYS_DEFAULT);
    },
  );

  it.each([
    ['recAuroraBoost=0.5', 0.5],
    ['recAuroraBoost=3', 3],
    ['recAuroraBoost=1.5', 1.5],
  ])('%s → %d', (search, expected) => {
    expect(parse(search).auroraBoost).toBe(expected);
  });

  it.each([['recAuroraBoost=0.4'], ['recAuroraBoost=3.1'], ['recAuroraBoost=x']])(
    '%s 越界/非法 → 回默认 1',
    (search) => {
      expect(parse(search).auroraBoost).toBe(REC_AURORA_BOOST_DEFAULT);
    },
  );
});

describe('parseLaunchParams 接线（rec 字段同源解析）', () => {
  it('组合参数完整解析（示例串）', () => {
    const rec = parseLaunchParams(
      '?recCmeEarth=1&recCmeSpeed=500&recAuroraDays=8&recAuroraBoost=1.5&recLog=1',
    ).rec;
    expect(rec).toEqual({
      cmeEarth: true,
      cmeSpeedKmS: 500,
      flareClass: null,
      flareMag: null,
      auroraDays: 8,
      auroraBoost: 1.5,
      log: true,
      active: true,
    });
  });

  it('rec 参数不影响其余启动参数解析', () => {
    const params = parseLaunchParams('?body=jupiter&recLog=1');
    expect(params.body).toBe('jupiter');
    expect(params.rec.log).toBe(true);
  });
});

describe('overrideCmeRoll（CME 事件参数覆盖）', () => {
  const earthDir: Vec3 = { x: 1, y: 0, z: 0 };
  const base = {
    direction: { x: 0, y: 1, z: 0 },
    speedKmS: 800,
    startedAtSimDays: 100,
    earthDirected: false,
  };

  it('未激活调参 → 原样透传（引用相等，零分配）', () => {
    expect(overrideCmeRoll(base, DEFAULT_RECORDING_TUNING, earthDir)).toBe(base);
  });

  it('cmeEarth：方向直取日→地 + earthDirected 恒真', () => {
    const rec: RecordingTuning = { ...DEFAULT_RECORDING_TUNING, active: true, cmeEarth: true };
    const out = overrideCmeRoll(base, rec, earthDir);
    expect(out.direction).toEqual(earthDir);
    expect(out.earthDirected).toBe(true);
    expect(out.speedKmS).toBe(800);
    expect(out.startedAtSimDays).toBe(100);
  });

  it('cmeSpeedKmS：固定速度（方向/判定不动）', () => {
    const rec: RecordingTuning = { ...DEFAULT_RECORDING_TUNING, active: true, cmeSpeedKmS: 500 };
    const out = overrideCmeRoll(base, rec, earthDir);
    expect(out.speedKmS).toBe(500);
    expect(out.direction).toEqual(base.direction);
    expect(out.earthDirected).toBe(false);
  });

  it('组合覆盖：方向+速度+判定同时生效', () => {
    const rec: RecordingTuning = {
      ...DEFAULT_RECORDING_TUNING,
      active: true,
      cmeEarth: true,
      cmeSpeedKmS: 300,
    };
    expect(overrideCmeRoll(base, rec, earthDir)).toEqual({
      direction: earthDir,
      speedKmS: 300,
      startedAtSimDays: 100,
      earthDirected: true,
    });
  });

  it('active 但无 CME 项覆盖 → 值保持（非引用透传路径）', () => {
    const rec: RecordingTuning = { ...DEFAULT_RECORDING_TUNING, active: true };
    expect(overrideCmeRoll(base, rec, earthDir)).toEqual(base);
  });
});

describe('overrideFlareRoll（耀斑级别/量级覆盖）', () => {
  const rolled = { flareClass: 'C' as const, magnitude: 2.5 };

  it('未激活 → 原样透传', () => {
    expect(overrideFlareRoll(rolled, DEFAULT_RECORDING_TUNING)).toBe(rolled);
  });

  it('X9 覆盖（最大爆发演示）', () => {
    const rec: RecordingTuning = {
      ...DEFAULT_RECORDING_TUNING,
      active: true,
      flareClass: 'X',
      flareMag: 9,
    };
    expect(overrideFlareRoll(rolled, rec)).toEqual({ flareClass: 'X', magnitude: 9 });
  });

  it('单项覆盖：仅级别 / 仅量级', () => {
    expect(
      overrideFlareRoll(rolled, { ...DEFAULT_RECORDING_TUNING, active: true, flareClass: 'M' }),
    ).toEqual({ flareClass: 'M', magnitude: 2.5 });
    expect(
      overrideFlareRoll(rolled, { ...DEFAULT_RECORDING_TUNING, active: true, flareMag: 7.7 }),
    ).toEqual({ flareClass: 'C', magnitude: 7.7 });
  });
});

describe('日志换算辅助', () => {
  it('dirToLatLonDeg：极向/赤道方向', () => {
    expect(dirToLatLonDeg({ x: 0, y: 1, z: 0 }).latDeg).toBeCloseTo(90);
    const eq = dirToLatLonDeg({ x: 1, y: 0, z: 0 });
    expect(eq.latDeg).toBeCloseTo(0);
    expect(eq.lonDeg).toBeCloseTo(0);
    expect(dirToLatLonDeg({ x: 0, y: 0, z: 1 }).lonDeg).toBeCloseTo(90);
    // 浮点越界钳制（|y| 微超 1 不 NaN）
    expect(dirToLatLonDeg({ x: 0, y: 1.0000001, z: 0 }).latDeg).toBeCloseTo(90);
  });

  it('angleBetweenDeg：同向 0 / 垂直 90 / 反向 180（含浮点钳制）', () => {
    const x: Vec3 = { x: 1, y: 0, z: 0 };
    expect(angleBetweenDeg(x, x)).toBeCloseTo(0);
    expect(angleBetweenDeg(x, { x: 0, y: 1, z: 0 })).toBeCloseTo(90);
    expect(angleBetweenDeg(x, { x: -1, y: 0, z: 0 })).toBeCloseTo(180);
    expect(angleBetweenDeg({ x: 1.0000001, y: 0, z: 0 }, x)).toBeCloseTo(0);
  });

  it('simDaysToRealSeconds：正常换算（L1 压缩比 1 秒 = 4 模拟时）', () => {
    // 1 模拟天 @ 压缩比 14400（L1）× 倍速 1 = 6 真实秒
    expect(simDaysToRealSeconds(1, 14400, 1)).toBeCloseTo(6);
    // 倍速 2 → 减半
    expect(simDaysToRealSeconds(1, 14400, 2)).toBeCloseTo(3);
  });

  it.each([
    [0, '零倍速（暂停）'],
    [Number.NaN, 'NaN 倍速'],
    [Number.POSITIVE_INFINITY, '无穷倍速'],
  ])('倍速 %s（%s）→ null', (multiplier) => {
    expect(simDaysToRealSeconds(1, 14400, multiplier)).toBeNull();
  });

  it('roundTo：按小数位取整', () => {
    expect(roundTo(3.14159, 2)).toBe(3.14);
    expect(roundTo(3.14159, 0)).toBe(3);
    expect(roundTo(-1.005, 1)).toBe(-1);
  });
});
