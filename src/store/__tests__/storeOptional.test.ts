/**
 * Store 可选项功能测试：性能监控开关（需求 3.5.2）+
 * 银河系—仙女座碰撞合并快进预览状态机（可选需求 3.1.3）
 */

import { useSimulationStore } from '@/store';
import { MERGE_PREVIEW_DURATION_SEC, MERGE_TARGET_SIM_DAYS } from '@/utils/universe';

function resetStore(): void {
  useSimulationStore.setState({
    simDays: 1000,
    paused: false,
    speedMultiplier: 1,
    viewLevel: 'L2',
    continuousLevel: 2,
    viewTransitionId: 0,
    followBodyId: null,
    flyToBodyId: null,
    showPerformance: false,
    mergePreviewActive: false,
    mergePreviewProgress01: 0,
    mergePreviewReturnSimDays: null,
  });
}

describe('性能监控开关（需求 3.5.2）', () => {
  beforeEach(resetStore);

  it('默认关闭，setShowPerformance 开关生效', () => {
    expect(useSimulationStore.getState().showPerformance).toBe(false);
    useSimulationStore.getState().setShowPerformance(true);
    expect(useSimulationStore.getState().showPerformance).toBe(true);
    useSimulationStore.getState().setShowPerformance(false);
    expect(useSimulationStore.getState().showPerformance).toBe(false);
  });
});

describe('合并预览状态机（可选需求 3.1.3）', () => {
  beforeEach(resetStore);

  it('startMergePreview：记录返回时间、切换 L4、触发锚点过渡、取消跟随', () => {
    useSimulationStore.setState({ followBodyId: 'earth', flyToBodyId: 'earth' });
    useSimulationStore.getState().startMergePreview();
    const state = useSimulationStore.getState();
    expect(state.mergePreviewActive).toBe(true);
    expect(state.mergePreviewProgress01).toBe(0);
    expect(state.mergePreviewReturnSimDays).toBe(1000);
    expect(state.viewLevel).toBe('L4');
    expect(state.continuousLevel).toBe(4);
    expect(state.viewTransitionId).toBe(1);
    expect(state.followBodyId).toBeNull();
    expect(state.flyToBodyId).toBeNull();
  });

  it('重复 start 幂等（进行中不重置进度）', () => {
    useSimulationStore.getState().startMergePreview();
    useSimulationStore.getState().tick(MERGE_PREVIEW_DURATION_SEC / 2);
    const progress = useSimulationStore.getState().mergePreviewProgress01;
    useSimulationStore.getState().startMergePreview();
    expect(useSimulationStore.getState().mergePreviewProgress01).toBe(progress);
    expect(useSimulationStore.getState().viewTransitionId).toBe(1);
  });

  it('tick 推进进度且 simDays 单调趋向合并时刻', () => {
    useSimulationStore.getState().startMergePreview();
    let prevSimDays = useSimulationStore.getState().simDays;
    let prevProgress = 0;
    for (let i = 0; i < 5; i += 1) {
      useSimulationStore.getState().tick(MERGE_PREVIEW_DURATION_SEC / 10);
      const state = useSimulationStore.getState();
      expect(state.mergePreviewProgress01).toBeGreaterThan(prevProgress);
      expect(state.simDays).toBeGreaterThanOrEqual(prevSimDays);
      expect(state.simDays).toBeLessThanOrEqual(MERGE_TARGET_SIM_DAYS);
      prevSimDays = state.simDays;
      prevProgress = state.mergePreviewProgress01;
    }
  });

  it('progress 到 1 时预览自动结束并精确到达合并时刻（保留返回时间）', () => {
    useSimulationStore.getState().startMergePreview();
    useSimulationStore.getState().tick(MERGE_PREVIEW_DURATION_SEC * 2);
    const state = useSimulationStore.getState();
    expect(state.mergePreviewActive).toBe(false);
    expect(state.mergePreviewProgress01).toBe(1);
    expect(state.simDays).toBe(MERGE_TARGET_SIM_DAYS);
    expect(state.mergePreviewReturnSimDays).toBe(1000);
  });

  it('restoreFromMergePreview 恢复预览前模拟时间并清空返回时间', () => {
    useSimulationStore.getState().startMergePreview();
    useSimulationStore.getState().tick(MERGE_PREVIEW_DURATION_SEC * 2);
    useSimulationStore.getState().restoreFromMergePreview();
    const state = useSimulationStore.getState();
    expect(state.simDays).toBe(1000);
    expect(state.mergePreviewActive).toBe(false);
    expect(state.mergePreviewProgress01).toBe(0);
    expect(state.mergePreviewReturnSimDays).toBeNull();
  });

  it('预览中途 restore：立即结束并恢复时间', () => {
    useSimulationStore.getState().startMergePreview();
    useSimulationStore.getState().tick(MERGE_PREVIEW_DURATION_SEC / 3);
    useSimulationStore.getState().restoreFromMergePreview();
    const state = useSimulationStore.getState();
    expect(state.mergePreviewActive).toBe(false);
    expect(state.simDays).toBe(1000);
  });

  it('无返回时间时 restore 为空操作', () => {
    const before = useSimulationStore.getState().simDays;
    useSimulationStore.getState().restoreFromMergePreview();
    expect(useSimulationStore.getState().simDays).toBe(before);
  });

  it('预览进行中负时间增量抛出 RangeError', () => {
    useSimulationStore.getState().startMergePreview();
    expect(() => useSimulationStore.getState().tick(-1)).toThrow(RangeError);
  });

  it('预览进行中暂停/倍率不影响快进（按真实时间推进）', () => {
    useSimulationStore.setState({ paused: true, speedMultiplier: 0 });
    useSimulationStore.getState().startMergePreview();
    useSimulationStore.getState().tick(MERGE_PREVIEW_DURATION_SEC / 2);
    expect(useSimulationStore.getState().mergePreviewProgress01).toBeCloseTo(0.5, 9);
  });
});
