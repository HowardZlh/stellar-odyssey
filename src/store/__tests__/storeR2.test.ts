/**
 * Store R2-1 测试：视角切换自动关闭信息面板 + 飞往 null 兜底
 * （IMPROVEMENT_REQUIREMENTS_2 §R2-1 §1.1）
 */

import { useSimulationStore } from '@/store';
import { DEFAULT_ANCHOR_BODY_ID } from '@/utils/bodyCycle';

const SAMPLE_SOLAR_FEATURE = {
  kind: 'sunspot' as const,
  titleZh: '黑子群（示例）',
  descZh: '测试用黑子群科普文案',
  earthCount: 12,
};

function resetStore(): void {
  useSimulationStore.setState({
    viewLevel: 'L3',
    continuousLevel: 3,
    viewTransitionId: 0,
    followBodyId: null,
    flyToBodyId: null,
    flyToRequestId: 0,
    anchorBodyId: DEFAULT_ANCHOR_BODY_ID,
    selectedBodyId: null,
    selectedSolarFeature: null,
    activeSupernova: null,
    supernovaRemnants: [],
    realScaleMode: false,
  });
}

describe('setViewLevel 显式锚点切换自动关闭信息面板（R2-1 §1.1-A）', () => {
  beforeEach(resetStore);

  it('L3 选中日球层顶后切 L2：清空 selectedBodyId 与 selectedSolarFeature', () => {
    useSimulationStore.getState().selectBody('heliopause');
    useSimulationStore.setState({ selectedSolarFeature: SAMPLE_SOLAR_FEATURE });
    useSimulationStore.getState().setViewLevel('L2');
    const s = useSimulationStore.getState();
    expect(s.selectedBodyId).toBeNull();
    expect(s.selectedSolarFeature).toBeNull();
  });

  it('切换到 L1（飞往锚定天体分支）同样清空选中', () => {
    useSimulationStore.getState().selectBody('heliopause');
    useSimulationStore.setState({ selectedSolarFeature: SAMPLE_SOLAR_FEATURE });
    useSimulationStore.getState().setViewLevel('L1');
    const s = useSimulationStore.getState();
    expect(s.selectedBodyId).toBeNull();
    expect(s.selectedSolarFeature).toBeNull();
    // L1 分支原有行为不回退：仍飞往并跟随锚定天体
    expect(s.followBodyId).toBe(DEFAULT_ANCHOR_BODY_ID);
  });

  it('切换到 L4 清空选中且无跟随残留', () => {
    useSimulationStore.getState().selectBody('heliopause');
    useSimulationStore.getState().requestFlyTo('heliopause');
    useSimulationStore.getState().setViewLevel('L4');
    const s = useSimulationStore.getState();
    expect(s.selectedBodyId).toBeNull();
    expect(s.followBodyId).toBeNull();
    expect(s.flyToBodyId).toBeNull();
  });

  it('连续滚轮缩放跨层级（syncZoomLevel）不清空选中（遨游面板不闪退）', () => {
    useSimulationStore.setState({ viewLevel: 'L2', continuousLevel: 2.3 });
    useSimulationStore.getState().selectBody('oort-cloud');
    // 模拟滚轮从 L2 连续缩放跨越 2.5 边界进入 L3
    useSimulationStore.getState().syncZoomLevel(2.6);
    expect(useSimulationStore.getState().viewLevel).toBe('L3');
    expect(useSimulationStore.getState().selectedBodyId).toBe('oort-cloud');
  });

  it('相机距离同步（syncCameraDistance）跨层级同样不清空选中', () => {
    useSimulationStore.setState({ viewLevel: 'L2', continuousLevel: 2.3 });
    useSimulationStore.getState().selectBody('heliopause');
    // 2600 单位为 L3 锚点距离（连续层级 3.0）
    useSimulationStore.getState().syncCameraDistance(2600);
    expect(useSimulationStore.getState().viewLevel).toBe('L3');
    expect(useSimulationStore.getState().selectedBodyId).toBe('heliopause');
  });
});

describe('requestFlyTo 解析兜底（R2-1 §1.1-B）', () => {
  beforeEach(resetStore);

  it('heliopause 可飞往：写入 flyTo/follow（死锁修复）', () => {
    const before = useSimulationStore.getState().flyToRequestId;
    useSimulationStore.getState().requestFlyTo('heliopause');
    const s = useSimulationStore.getState();
    expect(s.flyToBodyId).toBe('heliopause');
    expect(s.followBodyId).toBe('heliopause');
    expect(s.flyToRequestId).toBe(before + 1);
    // 非序列天体不改写 L1 锚定天体
    expect(s.anchorBodyId).toBe(DEFAULT_ANCHOR_BODY_ID);
  });

  it('oort-cloud 可飞往', () => {
    useSimulationStore.getState().requestFlyTo('oort-cloud');
    expect(useSimulationStore.getState().followBodyId).toBe('oort-cloud');
  });

  it('解析失败的未知 id：拒绝进入跟随并静默忽略（防未来死锁）', () => {
    const before = useSimulationStore.getState();
    before.requestFlyTo('no-such-body');
    const s = useSimulationStore.getState();
    expect(s.flyToBodyId).toBeNull();
    expect(s.followBodyId).toBeNull();
    expect(s.flyToRequestId).toBe(before.flyToRequestId);
  });

  it('超新星事件存在时 sn-* 可飞往（事件由 CameraController 单独解析）', () => {
    useSimulationStore
      .getState()
      .triggerSupernova({ x: 100, y: 0, z: 200 }, 20, 30, 1_000_000);
    const eventId = useSimulationStore.getState().activeSupernova!.id;
    useSimulationStore.getState().requestFlyTo(eventId);
    expect(useSimulationStore.getState().followBodyId).toBe(eventId);
  });

  it('不存在的超新星事件 id 被拒绝', () => {
    useSimulationStore.getState().requestFlyTo('sn-999');
    const s = useSimulationStore.getState();
    expect(s.flyToBodyId).toBeNull();
    expect(s.followBodyId).toBeNull();
  });

  it('遗迹中的超新星事件 id 仍可飞往', () => {
    useSimulationStore
      .getState()
      .triggerSupernova({ x: 100, y: 0, z: 200 }, 20, 30, 1_000_000);
    const eventId = useSimulationStore.getState().activeSupernova!.id;
    useSimulationStore.getState().archiveSupernova();
    expect(useSimulationStore.getState().activeSupernova).toBeNull();
    useSimulationStore.getState().requestFlyTo(eventId);
    expect(useSimulationStore.getState().followBodyId).toBe(eventId);
  });

  it('常规天体飞往行为不回退（地球仍记为 L1 锚定天体）', () => {
    useSimulationStore.setState({ anchorBodyId: 'mars' });
    useSimulationStore.getState().requestFlyTo('earth');
    const s = useSimulationStore.getState();
    expect(s.followBodyId).toBe('earth');
    expect(s.anchorBodyId).toBe('earth');
  });
});

describe('行星速率钳制提示（R2-3："行星运动已减速显示"，与卫星文案区分）', () => {
  it('默认关闭，可开可关', () => {
    expect(useSimulationStore.getState().planetRateClampNotice).toBe(false);
    useSimulationStore.getState().setPlanetRateClampNotice(true);
    expect(useSimulationStore.getState().planetRateClampNotice).toBe(true);
    useSimulationStore.getState().setPlanetRateClampNotice(false);
    expect(useSimulationStore.getState().planetRateClampNotice).toBe(false);
  });

  it('与卫星提示（rateClampNotice）互相独立', () => {
    useSimulationStore.getState().setPlanetRateClampNotice(true);
    expect(useSimulationStore.getState().rateClampNotice).toBe(false);
    useSimulationStore.getState().setRateClampNotice(true);
    useSimulationStore.getState().setPlanetRateClampNotice(false);
    expect(useSimulationStore.getState().rateClampNotice).toBe(true);
    useSimulationStore.getState().setRateClampNotice(false);
  });
});
