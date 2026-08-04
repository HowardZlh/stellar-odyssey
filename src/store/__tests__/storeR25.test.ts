/**
 * Store R2-5 测试：通用视角域天体切换（cycleScopeBody）与各域序列位置记忆
 * （IMPROVEMENT_REQUIREMENTS_2 §R2-5 §5.1-B / §5.2）
 */

import { useSimulationStore } from '@/store';
import { DEFAULT_ANCHOR_BODY_ID } from '@/utils/bodyCycle';
import { SCOPE_DEFAULT_BODY } from '@/utils/cycleScopes';

function resetStore(): void {
  useSimulationStore.setState({
    viewLevel: 'L3',
    continuousLevel: 3,
    cycleScope: 'galaxy',
    viewTransitionId: 0,
    followBodyId: null,
    flyToBodyId: null,
    flyToRequestId: 0,
    anchorBodyId: DEFAULT_ANCHOR_BODY_ID,
    galaxyAnchorBodyId: SCOPE_DEFAULT_BODY.galaxy,
    universeAnchorBodyId: SCOPE_DEFAULT_BODY.universe,
    selectedBodyId: null,
    activeSupernova: null,
    supernovaRemnants: [],
    realScaleMode: false,
  });
}

describe('各域记忆初始值（§5.1-B）', () => {
  beforeEach(resetStore);

  it('L3 默认人马座 A*，L4 默认 M31', () => {
    expect(useSimulationStore.getState().galaxyAnchorBodyId).toBe('sgr-a-star');
    expect(useSimulationStore.getState().universeAnchorBodyId).toBe('m31');
  });
});

describe('cycleScopeBody：L3 银河系域（§5.1-B）', () => {
  beforeEach(resetStore);

  it('未跟随时点击"下一个"：飞往域记忆天体（初始为默认 sgr-a-star），不跳步', () => {
    useSimulationStore.getState().cycleScopeBody(1);
    const s = useSimulationStore.getState();
    expect(s.flyToBodyId).toBe('sgr-a-star');
    expect(s.followBodyId).toBe('sgr-a-star');
    expect(s.flyToRequestId).toBe(1);
    expect(s.galaxyAnchorBodyId).toBe('sgr-a-star');
  });

  it('跟随域内天体时沿序列前进/后退', () => {
    useSimulationStore.setState({ followBodyId: 'sgr-a-star' });
    useSimulationStore.getState().cycleScopeBody(1);
    expect(useSimulationStore.getState().followBodyId).toBe('betelgeuse');
    expect(useSimulationStore.getState().galaxyAnchorBodyId).toBe('betelgeuse');
    useSimulationStore.getState().cycleScopeBody(-1);
    useSimulationStore.getState().cycleScopeBody(-1);
    expect(useSimulationStore.getState().followBodyId).toBe('heliopause');
  });

  it('遍历一整圈（14 步，sun 已移出序列）回到起点且每步均产生飞往请求', () => {
    useSimulationStore.setState({ followBodyId: 'heliopause' });
    for (let i = 0; i < 14; i += 1) {
      useSimulationStore.getState().cycleScopeBody(1);
    }
    const s = useSimulationStore.getState();
    expect(s.followBodyId).toBe('heliopause');
    expect(s.flyToRequestId).toBe(14);
  });

  it('飞抵太阳后（连续层级读数降低）仍按银河系域继续且离散层级锁定 L3（R3）', () => {
    // 模拟飞抵太阳后相机贴近：连续层级 1.2、跟随 sun（巡游域保持 galaxy；
    // sun 已移出序列 → 点击"下一个"回落到域记忆天体，默认 sgr-a-star）
    useSimulationStore.setState({ continuousLevel: 1.2, followBodyId: 'sun' });
    useSimulationStore.getState().cycleScopeBody(1);
    expect(useSimulationStore.getState().followBodyId).toBe('sgr-a-star');
    expect(useSimulationStore.getState().viewLevel).toBe('L3');
  });

  it('跟随序列外天体（超新星事件）时点击：飞往域记忆天体', () => {
    useSimulationStore.setState({ galaxyAnchorBodyId: 'orion-nebula' });
    useSimulationStore
      .getState()
      .triggerSupernova({ x: 100, y: 0, z: 200 }, 20, 30, 1_000_000);
    const eventId = useSimulationStore.getState().activeSupernova!.id;
    useSimulationStore.setState({ followBodyId: eventId });
    useSimulationStore.getState().cycleScopeBody(1);
    expect(useSimulationStore.getState().followBodyId).toBe('orion-nebula');
  });
});

describe('cycleScopeBody：L4 宇宙域（§5.1-B）', () => {
  beforeEach(() => {
    resetStore();
    useSimulationStore.setState({ viewLevel: 'L4', continuousLevel: 4, cycleScope: 'universe' });
  });

  it('未跟随时点击：飞往域记忆天体（初始 m31）', () => {
    useSimulationStore.getState().cycleScopeBody(1);
    expect(useSimulationStore.getState().followBodyId).toBe('m31');
    expect(useSimulationStore.getState().universeAnchorBodyId).toBe('m31');
  });

  it('跟随域内星系时沿序列切换（milky-way 可解析可飞往）', () => {
    useSimulationStore.setState({ followBodyId: 'milky-way' });
    useSimulationStore.getState().cycleScopeBody(1);
    expect(useSimulationStore.getState().followBodyId).toBe('lmc');
    useSimulationStore.getState().cycleScopeBody(-1);
    useSimulationStore.getState().cycleScopeBody(-1);
    expect(useSimulationStore.getState().followBodyId).toBe('quasar-3c273');
  });

  it('遍历一整圈（8 步）回到起点', () => {
    useSimulationStore.setState({ followBodyId: 'milky-way' });
    for (let i = 0; i < 8; i += 1) {
      useSimulationStore.getState().cycleScopeBody(1);
    }
    expect(useSimulationStore.getState().followBodyId).toBe('milky-way');
  });
});

describe('cycleScopeBody：行星域（R3 四域重构）', () => {
  beforeEach(() => {
    resetStore();
    useSimulationStore.setState({ viewLevel: 'L1', continuousLevel: 1, cycleScope: 'system' });
  });

  it('L1 未跟随时先飞往锚定天体（不跳步），跟随后沿系统序列前进', () => {
    useSimulationStore.getState().cycleScopeBody(1);
    expect(useSimulationStore.getState().followBodyId).toBe('earth');
    useSimulationStore.getState().cycleScopeBody(1);
    const s = useSimulationStore.getState();
    expect(s.anchorBodyId).toBe('tiangong');
    expect(s.flyToBodyId).toBe('tiangong');
    expect(s.followBodyId).toBe('tiangong');
  });

  it('不改写 L3/L4 域记忆', () => {
    useSimulationStore.getState().cycleScopeBody(1);
    expect(useSimulationStore.getState().galaxyAnchorBodyId).toBe('sgr-a-star');
    expect(useSimulationStore.getState().universeAnchorBodyId).toBe('m31');
  });

  it('太阳系巡游（solar 域）跟随海王星：下一个为冥王星（不含卫星，R3 需求 1）', () => {
    useSimulationStore.setState({
      viewLevel: 'L2',
      continuousLevel: 2.2,
      cycleScope: 'solar',
      followBodyId: 'neptune',
      anchorBodyId: 'neptune',
    });
    useSimulationStore.getState().cycleScopeBody(1);
    expect(useSimulationStore.getState().followBodyId).toBe('pluto');
    // R3 需求 2：太阳系巡游期间层级锁定 L2
    expect(useSimulationStore.getState().viewLevel).toBe('L2');
  });
});

describe('requestFlyTo 各域记忆联动（§5.1-B 防跨域误写）', () => {
  beforeEach(resetStore);

  it('L3 语境飞往域内天体：记录银河系域记忆', () => {
    useSimulationStore.getState().requestFlyTo('betelgeuse');
    expect(useSimulationStore.getState().galaxyAnchorBodyId).toBe('betelgeuse');
  });

  it('L1/L2 语境飞往太阳（耀斑通知入口）：不改写银河系域记忆', () => {
    useSimulationStore.setState({
      viewLevel: 'L2',
      continuousLevel: 2,
      cycleScope: 'solar',
      galaxyAnchorBodyId: 'orion-nebula',
    });
    useSimulationStore.getState().requestFlyTo('sun');
    expect(useSimulationStore.getState().followBodyId).toBe('sun');
    expect(useSimulationStore.getState().galaxyAnchorBodyId).toBe('orion-nebula');
  });

  it('L4 语境飞往星系：记录宇宙域记忆', () => {
    useSimulationStore.setState({ viewLevel: 'L4', continuousLevel: 4, cycleScope: 'universe' });
    useSimulationStore.getState().requestFlyTo('m87');
    expect(useSimulationStore.getState().universeAnchorBodyId).toBe('m87');
  });

  it('行星域锚定记忆行为不回退（L1 序列天体仍无条件记录）', () => {
    useSimulationStore.setState({ anchorBodyId: 'mars' });
    useSimulationStore.getState().requestFlyTo('earth');
    expect(useSimulationStore.getState().anchorBodyId).toBe('earth');
  });
});

describe('每域独立记忆：切换视角回来序列位置恢复（§5.1-B / §5.2）', () => {
  beforeEach(resetStore);

  it('L3 游到猎户座星云 → 切 L4 游到 M87 → 回 L3 从猎户座星云恢复', () => {
    // L3 游览至猎户座星云
    useSimulationStore.setState({ followBodyId: 'horsehead-nebula' });
    useSimulationStore.getState().cycleScopeBody(-1); // → ring-nebula
    useSimulationStore.getState().cycleScopeBody(-1); // → orion-nebula
    expect(useSimulationStore.getState().followBodyId).toBe('orion-nebula');

    // 切到 L4（锚点切换取消跟随）
    useSimulationStore.getState().setViewLevel('L4');
    useSimulationStore.setState({ continuousLevel: 4 });
    expect(useSimulationStore.getState().followBodyId).toBeNull();

    // L4 游览至 M87
    useSimulationStore.getState().cycleScopeBody(1); // → m31（记忆）
    useSimulationStore.setState({ followBodyId: 'm31' });
    useSimulationStore.getState().cycleScopeBody(1); // → m33
    useSimulationStore.getState().cycleScopeBody(1); // → m87
    expect(useSimulationStore.getState().universeAnchorBodyId).toBe('m87');

    // 回 L3：未跟随，点击即回到猎户座星云（银河系域记忆未被 L4 游览污染）
    useSimulationStore.getState().setViewLevel('L3');
    useSimulationStore.setState({ continuousLevel: 3 });
    useSimulationStore.getState().cycleScopeBody(1);
    expect(useSimulationStore.getState().followBodyId).toBe('orion-nebula');

    // 再回 L4：宇宙域记忆同样恢复
    useSimulationStore.getState().setViewLevel('L4');
    useSimulationStore.setState({ continuousLevel: 4 });
    useSimulationStore.getState().cycleScopeBody(1);
    expect(useSimulationStore.getState().followBodyId).toBe('m87');
  });
});
