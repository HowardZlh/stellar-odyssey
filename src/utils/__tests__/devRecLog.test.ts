/**
 * dev 录制诊断日志单测：门控矩阵（未启用/生产态零输出）+ 输出格式
 * （单行 JSON）+ 序列化防御（循环引用/BigInt/undefined/console 异常）。
 */

import { configureRecLog, isRecLogEnabled, recLog } from '@/utils/devRecLog';

describe('devRecLog', () => {
  let infoSpy: jest.SpyInstance;

  beforeEach(() => {
    infoSpy = jest.spyOn(console, 'info').mockImplementation(() => undefined);
  });

  afterEach(() => {
    configureRecLog(false);
    infoSpy.mockRestore();
  });

  describe('门控矩阵', () => {
    it('默认未配置 → 零输出', () => {
      recLog('cme.roll', { speedKmS: 500 });
      expect(infoSpy).not.toHaveBeenCalled();
      expect(isRecLogEnabled()).toBe(false);
    });

    it('启用（非生产）→ 输出', () => {
      configureRecLog(true, false);
      expect(isRecLogEnabled()).toBe(true);
      recLog('cme.roll', { speedKmS: 500 });
      expect(infoSpy).toHaveBeenCalledTimes(1);
    });

    it('启用但生产态 → 零输出（生产零行为差异）', () => {
      configureRecLog(true, true);
      expect(isRecLogEnabled()).toBe(false);
      recLog('cme.roll', { speedKmS: 500 });
      expect(infoSpy).not.toHaveBeenCalled();
    });

    it('显式关闭 → 零输出', () => {
      configureRecLog(true, false);
      configureRecLog(false, false);
      recLog('cme.roll', {});
      expect(infoSpy).not.toHaveBeenCalled();
    });

    it('isProduction 默认取 NODE_ENV（test 环境 = 非生产，开关随 enabled）', () => {
      configureRecLog(true);
      expect(isRecLogEnabled()).toBe(true);
    });
  });

  describe('输出格式（单行 JSON，供录制自动化消费）', () => {
    beforeEach(() => configureRecLog(true, false));

    it('console.info("[rec]", tag, 单行 JSON)', () => {
      recLog('aurora.window', { startDays: 1, peakOpacity: 0.75 });
      expect(infoSpy).toHaveBeenCalledWith(
        '[rec]',
        'aurora.window',
        '{"startDays":1,"peakOpacity":0.75}',
      );
    });

    it('JSON 无换行（嵌套对象仍单行）', () => {
      recLog('t', { a: { b: [1, 2, { c: 'x' }] } });
      const json = infoSpy.mock.calls[0][2] as string;
      expect(json).not.toContain('\n');
      expect(JSON.parse(json)).toEqual({ a: { b: [1, 2, { c: 'x' }] } });
    });
  });

  describe('序列化防御（永不抛错）', () => {
    beforeEach(() => configureRecLog(true, false));

    it('循环引用 → 静默降级占位符', () => {
      const circular: Record<string, unknown> = {};
      circular.self = circular;
      expect(() => recLog('bad', circular)).not.toThrow();
      expect(infoSpy).toHaveBeenCalledWith('[rec]', 'bad', '"<unserializable>"');
    });

    it('BigInt → 静默降级占位符', () => {
      expect(() => recLog('bad', { n: BigInt(1) })).not.toThrow();
      expect(infoSpy).toHaveBeenCalledWith('[rec]', 'bad', '"<unserializable>"');
    });

    it('undefined payload → 落为 "null"', () => {
      recLog('t', undefined);
      expect(infoSpy).toHaveBeenCalledWith('[rec]', 't', 'null');
    });

    it('console.info 自身抛错 → 吞掉不外抛', () => {
      infoSpy.mockImplementation(() => {
        throw new Error('console 被篡改');
      });
      expect(() => recLog('t', {})).not.toThrow();
    });
  });
});
