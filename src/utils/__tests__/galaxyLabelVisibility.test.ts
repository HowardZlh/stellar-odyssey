/**
 * 银河系视角 DOM 文字标签显隐判定单测（修复：drei Html 不受父级 visible 控制，
 * 「You are here」/「银河年 N%」须以 store 驱动的条件渲染门控；R3-4 确认项 2
 * 修订为 L 键 + You are here 双开关）。
 *
 * 用真实 store 驱动：经 setShowLabels / setShowYouAreHere / syncZoomLevel
 * 改状态后，把整份 state 直接传给判定函数（与 Galaxy.tsx 选择器同一调用形态）。
 */

import { useSimulationStore } from '@/store';
import {
  GALAXY_LABEL_MIN_CONTINUOUS_LEVEL,
  galaxyLabelInRange,
  galaxyTextLabelVisible,
} from '@/utils/galaxyLabelVisibility';

const visibleNow = (): boolean => galaxyTextLabelVisible(useSimulationStore.getState());

describe('galaxyLabelInRange（层级门控，与 Galaxy.tsx 原 > 2.5 判据同源）', () => {
  it('阈值常量为 2.5（L2/L3 边界）', () => {
    expect(GALAXY_LABEL_MIN_CONTINUOUS_LEVEL).toBe(2.5);
  });

  it('严格大于阈值才在范围内', () => {
    expect(galaxyLabelInRange(2.5)).toBe(false);
    expect(galaxyLabelInRange(2.51)).toBe(true);
    expect(galaxyLabelInRange(1)).toBe(false);
    expect(galaxyLabelInRange(4)).toBe(true);
  });
});

describe('galaxyTextLabelVisible（store 驱动）', () => {
  beforeEach(() => {
    useSimulationStore.setState({
      showLabels: true,
      showYouAreHere: true,
      continuousLevel: 3,
      viewLevel: 'L3',
    });
  });

  it('默认开关全开 + 银河系层级 → 显示', () => {
    expect(visibleNow()).toBe(true);
  });

  it('按 L 关标签（setShowLabels(false)）→ 隐藏；再开 → 恢复', () => {
    useSimulationStore.getState().setShowLabels(false);
    expect(visibleNow()).toBe(false);
    useSimulationStore.getState().setShowLabels(true);
    expect(visibleNow()).toBe(true);
  });

  it('取消勾选 You are here 标记 → 隐藏（不再依赖父 group visible）', () => {
    useSimulationStore.getState().setShowYouAreHere(false);
    expect(visibleNow()).toBe(false);
    useSimulationStore.getState().setShowYouAreHere(true);
    expect(visibleNow()).toBe(true);
  });

  it('两开关同时关 → 隐藏；只开其一 → 仍隐藏（双开关与）', () => {
    useSimulationStore.getState().setShowLabels(false);
    useSimulationStore.getState().setShowYouAreHere(false);
    expect(visibleNow()).toBe(false);

    useSimulationStore.getState().setShowLabels(true);
    expect(visibleNow()).toBe(false);

    useSimulationStore.getState().setShowLabels(false);
    useSimulationStore.getState().setShowYouAreHere(true);
    expect(visibleNow()).toBe(false);
  });

  it('开关全开但层级未进入银河系（syncZoomLevel 到 L2）→ 隐藏；缩放进入后显示', () => {
    useSimulationStore.getState().syncZoomLevel(2);
    expect(visibleNow()).toBe(false);
    useSimulationStore.getState().syncZoomLevel(2.5);
    expect(visibleNow()).toBe(false);
    useSimulationStore.getState().syncZoomLevel(2.8);
    expect(visibleNow()).toBe(true);
  });

  it('接受最小切片对象（不依赖整份 store）', () => {
    expect(
      galaxyTextLabelVisible({ showLabels: true, showYouAreHere: true, continuousLevel: 3.2 }),
    ).toBe(true);
    expect(
      galaxyTextLabelVisible({ showLabels: false, showYouAreHere: true, continuousLevel: 3.2 }),
    ).toBe(false);
  });
});
