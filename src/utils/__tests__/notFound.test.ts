/**
 * 404 页跳转逻辑单测（utils/notFound）
 *
 * 覆盖：倒计时推进（递减/下钳 0/非法入参）、返回首页跳转
 * （location.replace 调用与目标路径）。
 */

import {
  NOT_FOUND_REDIRECT_DELAY_SEC,
  countdownNext,
  redirectHome,
} from '../notFound';

describe('NOT_FOUND_REDIRECT_DELAY_SEC', () => {
  it('倒计时时长为 10 真实秒', () => {
    expect(NOT_FOUND_REDIRECT_DELAY_SEC).toBe(10);
  });
});

describe('countdownNext', () => {
  it('每次推进递减 1', () => {
    expect(countdownNext(10)).toBe(9);
    expect(countdownNext(1)).toBe(0);
  });

  it('下钳到 0（归零后不再递减为负）', () => {
    expect(countdownNext(0)).toBe(0);
  });

  it('从时长起点连续推进恰好在第 10 次归零', () => {
    let remaining = NOT_FOUND_REDIRECT_DELAY_SEC;
    for (let i = 0; i < NOT_FOUND_REDIRECT_DELAY_SEC; i += 1) {
      remaining = countdownNext(remaining);
    }
    expect(remaining).toBe(0);
  });

  it('非法入参（负数/NaN/Infinity）抛 RangeError', () => {
    expect(() => countdownNext(-1)).toThrow(RangeError);
    expect(() => countdownNext(Number.NaN)).toThrow(RangeError);
    expect(() => countdownNext(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe('redirectHome', () => {
  it('调用 location.replace 跳转到首页根路径（不留浏览历史）', () => {
    const replace = jest.fn();
    redirectHome({ replace });
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith('/');
  });
});
