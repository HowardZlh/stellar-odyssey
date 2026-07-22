/**
 * Store P1 新增功能测试：连续缩放层级同步、显示开关、速率钳制提示
 */

import { useSimulationStore } from '@/store';
import { TIME_COMPRESSION } from '@/utils/time';

describe('连续缩放层级（需求 3.2.2）', () => {
  beforeEach(() => {
    useSimulationStore.setState({
      simDays: 0,
      paused: false,
      speedMultiplier: 1,
      viewLevel: 'L2',
      continuousLevel: 2,
      viewTransitionId: 0,
    });
  });

  it('syncZoomLevel 更新连续层级与离散层级但不触发锚点过渡', () => {
    const before = useSimulationStore.getState().viewTransitionId;
    useSimulationStore.getState().syncZoomLevel(2.8);
    const state = useSimulationStore.getState();
    expect(state.continuousLevel).toBeCloseTo(2.8, 9);
    expect(state.viewLevel).toBe('L3');
    expect(state.viewTransitionId).toBe(before);
  });

  it('syncZoomLevel 钳制到 [1, 4]', () => {
    useSimulationStore.getState().syncZoomLevel(0.2);
    expect(useSimulationStore.getState().continuousLevel).toBe(1);
    useSimulationStore.getState().syncZoomLevel(11);
    expect(useSimulationStore.getState().continuousLevel).toBe(4);
    expect(useSimulationStore.getState().viewLevel).toBe('L4');
  });

  it('syncZoomLevel 相同值时状态不变（避免无谓渲染）', () => {
    useSimulationStore.getState().syncZoomLevel(2.5);
    const state1 = useSimulationStore.getState();
    useSimulationStore.getState().syncZoomLevel(2.5);
    expect(useSimulationStore.getState().continuousLevel).toBe(state1.continuousLevel);
  });

  it('syncCameraDistance 更新距离并换算连续层级', () => {
    const before = useSimulationStore.getState().viewTransitionId;
    useSimulationStore.getState().syncCameraDistance(14000);
    const state = useSimulationStore.getState();
    expect(state.cameraDistanceUnits).toBe(14000);
    expect(state.continuousLevel).toBeCloseTo(4, 5);
    expect(state.viewLevel).toBe('L4');
    expect(state.viewTransitionId).toBe(before);
    // 相同距离重复调用状态不变
    useSimulationStore.getState().syncCameraDistance(14000);
    expect(useSimulationStore.getState().cameraDistanceUnits).toBe(14000);
  });

  it('锚点过渡期间 syncCameraDistance 不回写离散层级（避免过渡目标被改写）', () => {
    useSimulationStore.getState().setViewLevel('L4');
    // 相机尚在近处（100 单位 ≈ L2），过渡中仅更新连续层级
    useSimulationStore.getState().syncCameraDistance(100, false);
    const state = useSimulationStore.getState();
    expect(state.viewLevel).toBe('L4'); // 离散层级保持锚点目标
    expect(state.continuousLevel).toBeCloseTo(2, 5); // 连续层级跟随相机（LOD/音景平滑）
    expect(state.cameraDistanceUnits).toBe(100);
  });

  it('setViewLevel（锚点切换）同步连续层级并触发过渡', () => {
    const before = useSimulationStore.getState().viewTransitionId;
    useSimulationStore.getState().setViewLevel('L4');
    const state = useSimulationStore.getState();
    expect(state.continuousLevel).toBe(4);
    expect(state.viewTransitionId).toBe(before + 1);
  });

  it('tick 使用连续层级的插值压缩比', () => {
    useSimulationStore.getState().syncZoomLevel(2.5);
    useSimulationStore.setState({ simDays: 0 });
    useSimulationStore.getState().tick(1);
    const expected = Math.sqrt(TIME_COMPRESSION.L2 * TIME_COMPRESSION.L3) / 86400;
    expect(useSimulationStore.getState().simDays).toBeCloseTo(expected, 0);
  });
});

describe('P1 显示开关与提示', () => {
  it('卫星轨道线开关（默认开，需求 3.1.1）', () => {
    expect(useSimulationStore.getState().showSatelliteOrbits).toBe(true);
    useSimulationStore.getState().setShowSatelliteOrbits(false);
    expect(useSimulationStore.getState().showSatelliteOrbits).toBe(false);
    useSimulationStore.getState().setShowSatelliteOrbits(true);
  });

  it('You are here 标记开关（默认开，需求 3.1.2）', () => {
    expect(useSimulationStore.getState().showYouAreHere).toBe(true);
    useSimulationStore.getState().setShowYouAreHere(false);
    expect(useSimulationStore.getState().showYouAreHere).toBe(false);
    useSimulationStore.getState().setShowYouAreHere(true);
  });

  it('速度矢量开关（需求 3.1.3）', () => {
    expect(useSimulationStore.getState().showVelocityVectors).toBe(true);
    useSimulationStore.getState().setShowVelocityVectors(false);
    expect(useSimulationStore.getState().showVelocityVectors).toBe(false);
    useSimulationStore.getState().setShowVelocityVectors(true);
  });

  it('速率钳制提示（需求 3.3："运动已减速显示"）', () => {
    expect(useSimulationStore.getState().rateClampNotice).toBe(false);
    useSimulationStore.getState().setRateClampNotice(true);
    expect(useSimulationStore.getState().rateClampNotice).toBe(true);
    useSimulationStore.getState().setRateClampNotice(false);
  });
});
