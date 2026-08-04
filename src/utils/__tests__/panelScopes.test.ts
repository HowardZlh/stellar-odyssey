import { VIEW_LEVELS, type ViewLevel } from '@/types';
import {
  PANEL_OPTION_SCOPES,
  panelOptionVisible,
  type PanelOptionId,
} from '@/utils/panelScopes';

/**
 * R3-8 控制面板选项视角作用域注册表单测（需求 §8.1-E）：
 * 17 选项 × L1–L4 可见性矩阵逐格断言 + 全局项四视角恒真 + 未知 id RangeError
 */
describe('panelScopes（R3-8 面板选项视角作用域）', () => {
  /** 期望矩阵（唯一事实来源镜像，需求 §8.1-A 归类表逐行照抄） */
  const EXPECTED: Record<PanelOptionId, Record<ViewLevel, boolean>> = {
    orbits: { L1: true, L2: true, L3: true, L4: true },
    labels: { L1: true, L2: true, L3: true, L4: true },
    realScale: { L1: true, L2: true, L3: true, L4: true },
    bloom: { L1: true, L2: true, L3: true, L4: true },
    performance: { L1: true, L2: true, L3: true, L4: true },
    satelliteOrbits: { L1: true, L2: false, L3: false, L4: false },
    flareDemo: { L1: true, L2: true, L3: false, L4: false },
    cmeDemo: { L1: true, L2: true, L3: false, L4: false },
    sunCutaway: { L1: false, L2: true, L3: false, L4: false },
    galacticFrame: { L1: false, L2: false, L3: true, L4: false },
    verticalExpand: { L1: false, L2: false, L3: true, L4: false },
    youAreHere: { L1: false, L2: false, L3: true, L4: false },
    supernovaDemo: { L1: false, L2: false, L3: true, L4: false },
    velocityVectors: { L1: false, L2: false, L3: false, L4: true },
    mergerDemo: { L1: false, L2: false, L3: false, L4: true },
    galaxyCatalog: { L1: false, L2: false, L3: false, L4: true },
    fermiBubbles: { L1: false, L2: false, L3: true, L4: true },
  };

  const OPTION_IDS = Object.keys(EXPECTED) as PanelOptionId[];
  const GLOBAL_IDS: PanelOptionId[] = ['orbits', 'labels', 'realScale', 'bloom', 'performance'];

  it('注册表恰好登记 17 个选项，与期望矩阵键集一致', () => {
    expect(OPTION_IDS).toHaveLength(17);
    expect(Object.keys(PANEL_OPTION_SCOPES).sort()).toEqual([...OPTION_IDS].sort());
  });

  describe('17 选项 × L1–L4 可见性矩阵逐格断言', () => {
    it.each(OPTION_IDS.flatMap((id) => VIEW_LEVELS.map((level) => [id, level] as const)))(
      '%s @ %s',
      (id, level) => {
        expect(panelOptionVisible(id, level)).toBe(EXPECTED[id][level]);
      },
    );
  });

  it('全局项（轨道线/标签/真实比例/泛光/性能监控）四视角恒真', () => {
    for (const id of GLOBAL_IDS) {
      for (const level of VIEW_LEVELS) {
        expect(panelOptionVisible(id, level)).toBe(true);
      }
    }
  });

  it('注册表可见集合与 panelOptionVisible 判定一致（同源）', () => {
    for (const id of OPTION_IDS) {
      for (const level of VIEW_LEVELS) {
        expect(panelOptionVisible(id, level)).toBe(PANEL_OPTION_SCOPES[id].includes(level));
      }
    }
  });

  it('未知 optionId 抛 RangeError', () => {
    expect(() => panelOptionVisible('unknownOption' as PanelOptionId, 'L1')).toThrow(RangeError);
    expect(() => panelOptionVisible('' as PanelOptionId, 'L3')).toThrow(RangeError);
  });
});
