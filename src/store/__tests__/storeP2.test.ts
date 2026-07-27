/**
 * Store P2 新增功能测试：跟随/飞往、真实比例模式、超新星事件系统
 */

import { useSimulationStore } from '@/store';
import { SN_MAX_REMNANTS } from '@/utils/supernova';

const POSITION = { x: 20000, y: 100, z: -8000 };

function resetStore(): void {
  useSimulationStore.setState({
    viewLevel: 'L2',
    continuousLevel: 2,
    viewTransitionId: 0,
    selectedBodyId: null,
    followBodyId: null,
    flyToBodyId: null,
    flyToRequestId: 0,
    realScaleMode: false,
    activeSupernova: null,
    supernovaRemnants: [],
    supernovaNoticeVisible: false,
    supernovaCounter: 0,
  });
}

describe('天体跟随/飞往（需求 3.2.3）', () => {
  beforeEach(resetStore);

  it('初始状态：无跟随、无飞往请求', () => {
    const state = useSimulationStore.getState();
    expect(state.followBodyId).toBeNull();
    expect(state.flyToBodyId).toBeNull();
    expect(state.flyToRequestId).toBe(0);
  });

  it('setFollowBody 设置/取消跟随', () => {
    useSimulationStore.getState().setFollowBody('earth');
    expect(useSimulationStore.getState().followBodyId).toBe('earth');
    useSimulationStore.getState().setFollowBody(null);
    expect(useSimulationStore.getState().followBodyId).toBeNull();
  });

  it('requestFlyTo 递增请求代次并自动进入跟随模式', () => {
    useSimulationStore.getState().requestFlyTo('halley');
    const state = useSimulationStore.getState();
    expect(state.flyToBodyId).toBe('halley');
    expect(state.flyToRequestId).toBe(1);
    expect(state.followBodyId).toBe('halley');
    // 重复请求同一目标仍递增代次（重新运镜）
    useSimulationStore.getState().requestFlyTo('halley');
    expect(useSimulationStore.getState().flyToRequestId).toBe(2);
  });

  it('视角锚点切换取消跟随与飞往（相机回到固定锚点）', () => {
    useSimulationStore.getState().requestFlyTo('earth');
    useSimulationStore.getState().setViewLevel('L3');
    const state = useSimulationStore.getState();
    expect(state.followBodyId).toBeNull();
    expect(state.flyToBodyId).toBeNull();
  });

  it('跟随中点击相同层级锚点也取消跟随（P4 §3.2.4 行为变更：跟随远距天体时层级读数可能已是目标层级，仍需回到固定锚点）', () => {
    useSimulationStore.getState().setFollowBody('earth');
    useSimulationStore.getState().setViewLevel('L2');
    expect(useSimulationStore.getState().followBodyId).toBeNull();
  });

  it('无跟随时切换相同层级为空操作（不触发过渡）', () => {
    const before = useSimulationStore.getState().viewTransitionId;
    useSimulationStore.getState().setViewLevel('L2');
    expect(useSimulationStore.getState().viewTransitionId).toBe(before);
  });
});

describe('真实比例模式（需求 4.1）', () => {
  beforeEach(resetStore);

  it('默认关闭，可设置与切换', () => {
    expect(useSimulationStore.getState().realScaleMode).toBe(false);
    useSimulationStore.getState().setRealScaleMode(true);
    expect(useSimulationStore.getState().realScaleMode).toBe(true);
    useSimulationStore.getState().toggleRealScaleMode();
    expect(useSimulationStore.getState().realScaleMode).toBe(false);
    useSimulationStore.getState().toggleRealScaleMode();
    expect(useSimulationStore.getState().realScaleMode).toBe(true);
  });
});

describe('超新星事件系统（需求 3.1.5）', () => {
  beforeEach(resetStore);

  it('triggerSupernova 创建事件：id 递增、时长钳制、通知可见', () => {
    useSimulationStore.getState().triggerSupernova(POSITION, 15, 5, 1000);
    const state = useSimulationStore.getState();
    expect(state.activeSupernova).not.toBeNull();
    expect(state.activeSupernova!.id).toBe('sn-1');
    expect(state.activeSupernova!.positionLy).toEqual(POSITION);
    expect(state.activeSupernova!.startedAtMs).toBe(1000);
    // 时长 5 秒被钳制到下限 10 秒
    expect(state.activeSupernova!.durationSec).toBe(10);
    expect(state.activeSupernova!.progenitorMassSun).toBe(15);
    expect(state.supernovaNoticeVisible).toBe(true);
    expect(state.supernovaCounter).toBe(1);
  });

  it('未提供时长时使用默认时长', () => {
    useSimulationStore.getState().triggerSupernova(POSITION, 15);
    expect(useSimulationStore.getState().activeSupernova!.durationSec).toBe(18);
  });

  it('未提供触发时刻时使用当前时间', () => {
    const before = Date.now();
    useSimulationStore.getState().triggerSupernova(POSITION, 15);
    const startedAt = useSimulationStore.getState().activeSupernova!.startedAtMs;
    expect(startedAt).toBeGreaterThanOrEqual(before);
    expect(startedAt).toBeLessThanOrEqual(Date.now());
  });

  it('已有活跃事件时忽略新触发（避免动画叠加）', () => {
    useSimulationStore.getState().triggerSupernova(POSITION, 15, 18, 1000);
    useSimulationStore.getState().triggerSupernova({ x: 0, y: 0, z: 0 }, 25, 18, 2000);
    const state = useSimulationStore.getState();
    expect(state.activeSupernova!.id).toBe('sn-1');
    expect(state.supernovaCounter).toBe(1);
  });

  it('前身星质量非正时忽略触发', () => {
    useSimulationStore.getState().triggerSupernova(POSITION, 0);
    expect(useSimulationStore.getState().activeSupernova).toBeNull();
  });

  it('archiveSupernova 将活跃事件归档为永久遗迹', () => {
    useSimulationStore.getState().triggerSupernova(POSITION, 15, 18, 1000);
    useSimulationStore.getState().archiveSupernova();
    const state = useSimulationStore.getState();
    expect(state.activeSupernova).toBeNull();
    expect(state.supernovaRemnants).toHaveLength(1);
    expect(state.supernovaRemnants[0].id).toBe('sn-1');
  });

  it('无活跃事件时 archiveSupernova 不改变状态', () => {
    useSimulationStore.getState().archiveSupernova();
    expect(useSimulationStore.getState().supernovaRemnants).toHaveLength(0);
  });

  it('遗迹 FIFO 上限（防内存增长）', () => {
    for (let i = 0; i < SN_MAX_REMNANTS + 2; i += 1) {
      useSimulationStore.getState().triggerSupernova(POSITION, 15, 18, 1000 + i);
      useSimulationStore.getState().archiveSupernova();
    }
    const remnants = useSimulationStore.getState().supernovaRemnants;
    expect(remnants).toHaveLength(SN_MAX_REMNANTS);
    // 最早的遗迹被移除，保留最近的
    expect(remnants[0].id).toBe('sn-3');
    expect(remnants[remnants.length - 1].id).toBe(`sn-${SN_MAX_REMNANTS + 2}`);
  });

  it('dismissSupernovaNotice 关闭通知（事件保持活跃）', () => {
    useSimulationStore.getState().triggerSupernova(POSITION, 15);
    useSimulationStore.getState().dismissSupernovaNotice();
    const state = useSimulationStore.getState();
    expect(state.supernovaNoticeVisible).toBe(false);
    expect(state.activeSupernova).not.toBeNull();
  });

  it('归档后可触发下一次事件（id 连续递增）', () => {
    useSimulationStore.getState().triggerSupernova(POSITION, 15);
    useSimulationStore.getState().archiveSupernova();
    useSimulationStore.getState().triggerSupernova(POSITION, 25);
    expect(useSimulationStore.getState().activeSupernova!.id).toBe('sn-2');
  });

  it('可对超新星事件请求飞往（"飞往观看"按钮）', () => {
    useSimulationStore.getState().triggerSupernova(POSITION, 15);
    const id = useSimulationStore.getState().activeSupernova!.id;
    useSimulationStore.getState().requestFlyTo(id);
    expect(useSimulationStore.getState().flyToBodyId).toBe(id);
    expect(useSimulationStore.getState().followBodyId).toBe(id);
  });
});
